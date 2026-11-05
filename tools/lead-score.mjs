// Lead scoring: every lead in the funnel ledger gets a 0-100 score from fit (who they are, against the
// product's ICP rules) plus behaviour (what they did), a tier (hot / warm / cold) and its top reasons.
// Hot leads raise one owner alert each; the alert resolves itself once the lead has been contacted.
// Once 20+ leads have an outcome (won or lost), a calibration report compares the scores with the results.
//   products/<slug>/funnel/pipeline.json  input: the ledger (tools/funnel.mjs, single writer). Stage,
//                                          history, touches, consent, bot flag per lead.
//   products/<slug>/leads.jsonl, leads/*.json|jsonl|csv
//                                          input: raw lead rows with form fields (contact.*, fields.*),
//                                          joined to the ledger by lead id or email hash. Raw contact
//                                          details are read in memory only and never written anywhere.
//   products/<slug>/product.json           input: "market" (default ICP markets), "model" and the optional
//                                          "lead_scoring" block (see DEFAULTS below):
//     { "thresholds": {"hot": 70, "warm": 40}, "weights": {"fit": 0.5, "behaviour": 0.5},
//       "icp": { "company_size": {"min": 10, "max": 500}, "roles": ["founder", "head of marketing"],
//                "markets": ["US", "UK"], "industries": ["saas"], "penalize_personal_email": true },
//       "rules": [{"field": "budget", "op": "gte", "value": 1000, "points": 15, "reason": "Budget 1000+"}],
//       "min_outcomes": 20, "propose_tasks": true }
//   products/<slug>/funnel/scores.json     output: one row per lead (id, score, delta since the last run,
//                                          tier, fit, behaviour, reasons, hot_since), totals and the
//                                          calibration report. Rules on protected or special-category
//                                          fields (age, gender, health, religion...) are ignored.
//                                          A pipeline.json that does not parse stops the run (no writes).
//                                          Lead ids and hashes only, no personal data.
//   products/<slug>/alerts.json            output: key funnel:hot:<lead>, resolved when the lead is
//                                          contacted (any stage change after it became hot), cools, wins
//                                          or is lost.
//   products/<slug>/runs/LEADSCORE-<date>.json
//                                          output (only with consent and propose_tasks): new tasks for
//                                          om-sdr to DRAFT a reply to each new hot lead. Drafts go to
//                                          outbox/ and approvals.json like every other draft; this tool
//                                          never sends, posts or spends anything.
//   state/lead-scores.json                 output of --all: tier counts per product, no lead ids.
// Deterministic: the same ledger, rows, config and --now give byte-identical scores.json.
// Usage: node tools/lead-score.mjs <slug> [--now ISO] [--no-alerts] [--no-propose]
//        node tools/lead-score.mjs --all    every active product, then state/lead-scores.json
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, root as repoRoot } from './lib/env.mjs';

export const DEFAULTS = {
  thresholds: { hot: 70, warm: 40 },
  weights: { fit: 0.5, behaviour: 0.5 },
  min_outcomes: 20,
  propose_tasks: true,
};
// Points available per fit component (only configured components count; the total is scaled to 100).
const FIT_POINTS = { company_size: 30, role: 30, market: 20, industry: 20 };
const UNKNOWN_SHARE = 0.4; // missing data earns 40 % of a component: neither rewarded nor punished hard
// Behaviour points (sum 100).
const BEH_POINTS = { pages: 20, touches: 15, recency: 25, stage: 25, replies: 10, intent: 5 };
const STAGE_POINTS = { new: 0, contacted: 5, engaged: 14, qualified: 20, opportunity: 25, won: 25, nurture: 3, lost: 0 };
const LINE = ['new', 'contacted', 'engaged', 'qualified', 'opportunity', 'won'];
const INTENT = /(^|[^a-z])(pricing|demo|quote|book|booking|checkout|contact|trial|signup|sign-up|cart)([^a-z]|$)/i;
// Special-category and protected attributes (GDPR art. 9, anti-discrimination): never scored on.
const PROTECTED = /(^|_)(gender|sex|age|birth|dob|race|ethnic|ethnicity|religion|faith|health|medical|disability|sexual|orientation|politic|political|union|biometric|genetic|pregnan|pregnancy|marital|nationality)(_|$)/;
const MAX_NEW_ALERTS = 10; // per run, highest scores first; the rest open on later runs
const PERSONAL_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.de', 'web.de', 'mail.com', 'yandex.com', 'qq.com', '163.com']);
const OPS = new Set(['eq', 'neq', 'in', 'contains', 'gte', 'lte', 'exists']);
const MAX_RULES = 50;

const hash = (s) => crypto.createHash('sha256').update(String(s).trim().toLowerCase()).digest('hex').slice(0, 16);
const isoOk = (s) => typeof s === 'string' && s !== '' && !Number.isNaN(Date.parse(s));
const hist = (lead) => (Array.isArray(lead?.history) ? lead.history.filter((h) => h && typeof h === 'object') : []);
const clamp = (n, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const normKey = (k) => String(k).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const normText = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const strList = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map(normText).filter(Boolean).slice(0, 200);

// ---------- config ----------

// product.json → a clean, validated scoring config plus warnings for anything ignored.
export function scoringConfig(product = {}) {
  const raw = product && typeof product.lead_scoring === 'object' && !Array.isArray(product.lead_scoring) ? product.lead_scoring : {};
  const warnings = [];
  let hot = num(raw.thresholds?.hot) ?? DEFAULTS.thresholds.hot;
  let warm = num(raw.thresholds?.warm) ?? DEFAULTS.thresholds.warm;
  if (!(hot > warm && warm >= 0 && hot <= 100)) { warnings.push(`thresholds ${hot}/${warm} invalid (need 0 <= warm < hot <= 100); using defaults`); ({ hot, warm } = DEFAULTS.thresholds); }
  let wf = num(raw.weights?.fit) ?? DEFAULTS.weights.fit;
  let wb = num(raw.weights?.behaviour ?? raw.weights?.behavior) ?? DEFAULTS.weights.behaviour;
  if (wf < 0 || wb < 0 || wf + wb <= 0) { warnings.push('weights invalid; using defaults'); ({ fit: wf, behaviour: wb } = DEFAULTS.weights); }
  const sum = wf + wb; wf = round(wf / sum, 4); wb = round(1 - wf, 4);

  const icpRaw = raw.icp && typeof raw.icp === 'object' ? raw.icp : {};
  const icp = {};
  const size = icpRaw.company_size;
  if (size && typeof size === 'object') {
    const min = num(size.min); const max = num(size.max);
    if ((min != null || max != null) && !(min != null && max != null && min > max)) icp.company_size = { min: min ?? 0, max: max ?? Infinity };
    else warnings.push('icp.company_size ignored (needs min and/or max, min <= max)');
  }
  const roles = strList(icpRaw.roles); if (roles.length) icp.roles = roles;
  const markets = strList(icpRaw.markets ?? product.market); if (markets.length) icp.markets = markets;
  const industries = strList(icpRaw.industries); if (industries.length) icp.industries = industries;
  const b2b = /b2b|saas|agency|services|enterprise/i.test(String(product.model ?? ''));
  icp.penalize_personal_email = icpRaw.penalize_personal_email ?? b2b;

  const rules = [];
  for (const [i, r] of (Array.isArray(raw.rules) ? raw.rules : []).slice(0, MAX_RULES).entries()) {
    const points = num(r?.points);
    if (!r || typeof r.field !== 'string' || !r.field.trim() || !OPS.has(r.op) || points == null) { warnings.push(`rules[${i}] ignored (needs field, op in ${[...OPS].join('|')}, points)`); continue; }
    if (PROTECTED.test(normKey(r.field))) { warnings.push(`rules[${i}] ignored: "${r.field}" is a protected or special-category attribute`); continue; }
    rules.push({ field: normKey(r.field), op: r.op, value: r.value, points: clamp(points, -50, 50), reason: String(r.reason ?? `${r.field} ${r.op} ${Array.isArray(r.value) ? r.value.join('/') : r.value ?? ''}`).trim().slice(0, 80) });
  }
  const minOutcomes = Math.max(5, Math.floor(num(raw.min_outcomes) ?? DEFAULTS.min_outcomes));
  return { thresholds: { hot, warm }, weights: { fit: wf, behaviour: wb }, icp, rules, min_outcomes: minOutcomes, propose_tasks: raw.propose_tasks !== false, warnings };
}

// ---------- profiles (raw rows → fit fields, in memory) ----------

// Flattens a raw lead row into lower_snake keys: top level, contact.*, fields.*, answers.*, utm.*.
const flatten = (x) => {
  const out = {};
  const put = (obj) => { if (obj && typeof obj === 'object' && !Array.isArray(obj)) for (const [k, v] of Object.entries(obj)) if (v != null && typeof v !== 'object' && String(v).trim() !== '') out[normKey(k)] ??= String(v).trim().slice(0, 200); };
  put(x.fields); put(x.answers); put(x.contact); put(x.utm); put(x);
  return out;
};
const pick = (f, keys) => { for (const k of keys) if (f[k] != null && f[k] !== '') return f[k]; return null; };

// Raw lead rows → Map(lead key → profile). Keys are the lead id and "h:<email hash>". Later rows fill in
// fields the earlier rows lacked; they never overwrite (first answer wins, deterministic by file order).
export function buildProfiles(rows = []) {
  const map = new Map();
  for (const x of Array.isArray(rows) ? rows : []) {
    if (!x || typeof x !== 'object') continue;
    const f = flatten(x);
    const email = pick(f, ['email', 'email_address']);
    const keys = [x.lead_id ?? x.id, email ? `h:${hash(email)}` : (x.email_hash ? `h:${x.email_hash}` : null)].filter(Boolean).map(String);
    if (!keys.length) continue;
    const fields = { ...f };
    delete fields.email; delete fields.email_address; delete fields.phone; delete fields.tel; delete fields.mobile; delete fields.name; delete fields.first_name; delete fields.last_name;
    if (email && String(email).includes('@')) fields.email_domain = String(email).split('@').pop().toLowerCase();
    let prof = keys.map((k) => map.get(k)).find(Boolean);
    if (!prof) prof = {};
    for (const [k, v] of Object.entries(fields)) prof[k] ??= v;
    for (const k of keys) map.set(k, prof);
  }
  return map;
}
const profileFor = (profiles, lead) => {
  if (!profiles) return {};
  for (const k of [lead.lead_id, lead.id, ...(lead.aliases ?? []), lead.email_hash ? `h:${lead.email_hash}` : null]) if (k && profiles.get(String(k))) return profiles.get(String(k));
  return {};
};

// "11-50" → 30.5, "200+" → 200, "1,000" → 1000, "about 40" → 40.
export function parseSize(v) {
  if (v == null) return null;
  const nums = String(v).replace(/(\d),(\d{3})/g, '$1$2').match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
  if (!nums.length) return null;
  const k = /\d\s*k\b/i.test(String(v)) ? 1000 : 1;
  return nums.length >= 2 ? ((nums[0] + nums[1]) / 2) * k : nums[0] * k;
}

// ---------- scoring ----------

const evalRule = (r, fields) => {
  const raw = fields[r.field];
  if (r.op === 'exists') return raw != null && raw !== '';
  if (raw == null) return false;
  const v = normText(raw);
  const n = num(raw);
  switch (r.op) {
    case 'eq': return v === normText(r.value);
    case 'neq': return v !== normText(r.value);
    case 'in': return strList(r.value).includes(v);
    case 'contains': return normText(r.value) !== '' && v.includes(normText(r.value));
    case 'gte': return n != null && num(r.value) != null && n >= num(r.value);
    case 'lte': return n != null && num(r.value) != null && n <= num(r.value);
    default: return false;
  }
};

// Fit 0-100 from the profile and the ICP. Returns {fit, reasons: [{text, points}]} with points on the
// 0-100 fit scale (negative = what a mismatch cost).
export function fitScore(profile = {}, cfg) {
  const icp = cfg.icp ?? {};
  const parts = [];
  const comp = (key, state, text) => { const max = FIT_POINTS[key]; const got = state === 'match' ? max : state === 'unknown' ? max * UNKNOWN_SHARE : 0; parts.push({ max, got, text, state }); };
  if (icp.company_size) {
    const s = parseSize(pick(profile, ['company_size', 'employees', 'employee_count', 'team_size', 'headcount', 'company_employees', 'size']));
    const { min, max } = icp.company_size;
    const range = `${min}-${Number.isFinite(max) ? max : '+'}`;
    comp('company_size', s == null ? 'unknown' : s >= min && s <= max ? 'match' : 'miss', s == null ? 'Company size unknown' : s >= min && s <= max ? `Company size in ICP range (${range})` : `Company size outside ICP range (${range})`);
  }
  if (icp.roles) {
    const role = normText(pick(profile, ['role', 'job_title', 'title', 'position', 'jobtitle', 'job_role']));
    const hit = role ? icp.roles.find((r) => role.includes(r)) : null;
    comp('role', !role ? 'unknown' : hit ? 'match' : 'miss', !role ? 'Role unknown' : hit ? `Role matches ICP: ${hit}` : 'Role outside ICP roles');
  }
  if (icp.markets) {
    const m = normText(pick(profile, ['country', 'country_code', 'market', 'region', 'geo']));
    const hit = m ? icp.markets.find((x) => m === x || (x.length > 2 && m.includes(x))) : null;
    comp('market', !m ? 'unknown' : hit ? 'match' : 'miss', !m ? 'Market unknown' : hit ? `In a target market: ${hit.toUpperCase()}` : 'Outside target markets');
  }
  if (icp.industries) {
    const ind = normText(pick(profile, ['industry', 'sector', 'vertical', 'business_type']));
    const hit = ind ? icp.industries.find((x) => ind.includes(x)) : null;
    comp('industry', !ind ? 'unknown' : hit ? 'match' : 'miss', !ind ? 'Industry unknown' : hit ? `Industry matches ICP: ${hit}` : 'Industry outside ICP');
  }
  const totalMax = parts.reduce((s, p) => s + p.max, 0);
  const reasons = [];
  let fit;
  if (!totalMax) { fit = 50; reasons.push({ text: 'No ICP rules set (fit neutral)', points: 0 }); }
  else {
    const scale = 100 / totalMax;
    fit = parts.reduce((s, p) => s + p.got, 0) * scale;
    for (const p of parts) reasons.push({ text: p.text, points: round(p.state === 'match' ? p.got * scale : p.state === 'miss' ? -p.max * scale : 0, 1) });
  }
  if (icp.penalize_personal_email && profile.email_domain && PERSONAL_DOMAINS.has(profile.email_domain)) { fit -= 15; reasons.push({ text: 'Personal email address, not a work domain', points: -15 }); }
  for (const r of cfg.rules ?? []) if (evalRule(r, profile)) { fit += r.points; reasons.push({ text: r.reason, points: r.points }); }
  return { fit: round(clamp(fit), 1), reasons };
}

// The lead as it stood at time `at` (for calibration): history and touches after it are dropped.
export function leadAsOf(lead, at) {
  const t = Date.parse(at);
  const history = hist(lead).filter((h) => isoOk(h.at) && Date.parse(h.at) < t);
  const last = history.at(-1);
  return { ...lead, history, touches: (Array.isArray(lead.touches) ? lead.touches : []).filter((x) => x && isoOk(x.at) && Date.parse(x.at) < t), stage: last?.stage ?? 'new', stage_at: last?.at ?? lead.first_seen, won_at: undefined };
}

// Behaviour 0-100 from the ledger row. Returns {behaviour, reasons, last_activity}.
export function behaviourScore(lead, profile = {}, now) {
  const reasons = [];
  const touches = Array.isArray(lead.touches) ? lead.touches.filter((t) => t && typeof t === 'object') : [];
  const history = Array.isArray(lead.history) ? lead.history.filter((h) => h && typeof h === 'object') : [];
  const paths = new Set(touches.map((t) => String(t.path ?? '')).filter(Boolean));
  if (lead.path) paths.add(String(lead.path));
  const reported = num(pick(profile, ['pages_seen', 'page_views', 'pageviews', 'pages']));
  const pages = Math.max(paths.size, reported ?? 0);
  const pagePts = Math.min(BEH_POINTS.pages, pages * 4);
  if (pages) reasons.push({ text: `${pages} page(s) seen`, points: pagePts });
  const nTouch = Math.max(touches.length, 1);
  const touchPts = Math.min(BEH_POINTS.touches, (nTouch - 1) * 5);
  if (nTouch > 1) reasons.push({ text: `${nTouch} touches across visits`, points: touchPts });
  const stamps = [lead.first_seen, lead.stage_at, ...touches.map((t) => t.at), ...history.map((h) => h.at)].filter(isoOk).map(Date.parse).filter((t) => t <= Date.parse(now));
  const lastMs = stamps.length ? Math.max(...stamps) : null;
  const days = lastMs == null ? null : (Date.parse(now) - lastMs) / 86400000;
  const recPts = days == null ? 0 : days <= 1 ? 25 : days <= 3 ? 20 : days <= 7 ? 15 : days <= 14 ? 10 : days <= 30 ? 5 : 0;
  reasons.push({ text: days == null ? 'No dated activity' : days <= 1 ? 'Active in the last 24 h' : `Last active ${Math.floor(days)} day(s) ago`, points: recPts - 12.5 });
  const stage = String(lead.stage ?? 'new');
  const stagePts = STAGE_POINTS[stage] ?? 0;
  if (stagePts) reasons.push({ text: `Stage: ${stage}`, points: stagePts });
  const replies = Math.max(history.filter((h) => h.stage === 'engaged' || /repl/i.test(String(h.note ?? ''))).length, num(pick(profile, ['replies', 'reply_count'])) ?? 0);
  const replyPts = Math.min(BEH_POINTS.replies, replies * 5);
  if (replies) reasons.push({ text: `${replies} reply(ies) from the lead`, points: replyPts });
  const intent = INTENT.test(String(lead.form ?? '')) || [...paths].some((p) => INTENT.test(p));
  if (intent) reasons.push({ text: 'Visited or used a high-intent page or form', points: BEH_POINTS.intent });
  const behaviour = pagePts + touchPts + recPts + stagePts + replyPts + (intent ? BEH_POINTS.intent : 0);
  return { behaviour: round(clamp(behaviour), 1), reasons, last_activity: lastMs == null ? null : new Date(lastMs).toISOString() };
}

const statusOf = (lead) => (lead.stage === 'won' || lead.won_at ? 'won' : lead.stage === 'lost' ? 'lost' : 'open');
export const tierOf = (score, { hot, warm }) => (score >= hot ? 'hot' : score >= warm ? 'warm' : 'cold');

// One lead → {lead, score, tier, fit, behaviour, status, stage, reasons (top 3), last_activity}.
export function scoreLead(lead, profile, cfg, now) {
  const status = statusOf(lead);
  if (lead.suspected_bot) return { lead: String(lead.id), score: 0, tier: 'cold', fit: 0, behaviour: 0, status, stage: lead.stage ?? 'new', reasons: ['Suspected bot: not scored'], last_activity: null };
  const f = fitScore(profile, cfg);
  const b = behaviourScore(lead, profile, now);
  let score = round(f.fit * cfg.weights.fit + b.behaviour * cfg.weights.behaviour, 0);
  const all = [...f.reasons.map((r) => ({ ...r, w: r.points * cfg.weights.fit })), ...b.reasons.map((r) => ({ ...r, w: r.points * cfg.weights.behaviour }))];
  if (status === 'lost') { score = Math.min(score, 15); all.push({ text: 'Marked lost', w: -100 }); }
  const reasons = all.filter((r) => r.w !== 0 || r.text.startsWith('No ICP')).sort((a, c) => Math.abs(c.w) - Math.abs(a.w) || a.text.localeCompare(c.text)).slice(0, 3)
    .map((r) => `${r.w > 0 ? '+' : r.w < 0 ? '-' : ''}${r.text}`);
  return { lead: String(lead.id), score, tier: tierOf(score, cfg.thresholds), fit: f.fit, behaviour: b.behaviour, status, stage: lead.stage ?? 'new', reasons, last_activity: b.last_activity };
}

// ---------- calibration ----------

const outcomeAt = (lead) => {
  if (lead.won_at && isoOk(lead.won_at)) return lead.won_at;
  const h = [...hist(lead)].reverse().find((x) => (x.stage === 'won' || x.stage === 'lost') && isoOk(x.at));
  return h?.at ?? (isoOk(lead.stage_at) ? lead.stage_at : null);
};

// Rank AUC (Mann-Whitney), ties count half. null without both classes.
export function auc(pairs) {
  const pos = pairs.filter((p) => p.won).map((p) => p.score); const neg = pairs.filter((p) => !p.won).map((p) => p.score);
  if (!pos.length || !neg.length) return null;
  let s = 0; for (const a of pos) for (const b of neg) s += a > b ? 1 : a === b ? 0.5 : 0;
  return round(s / (pos.length * neg.length), 3);
}

// Scores each closed lead as it stood just before its outcome (no leakage from the won/lost stage), then
// compares tiers and score bands with what happened.
export function calibrate(leads, profiles, cfg) {
  const closed = (leads ?? []).filter((l) => l && !l.suspected_bot && statusOf(l) !== 'open');
  const pairs = [];
  for (const l of closed) {
    const at = outcomeAt(l); if (!at) continue;
    const s = scoreLead(leadAsOf(l, at), profileFor(profiles, l), cfg, at);
    pairs.push({ lead: String(l.id), score: s.score, tier: s.tier, won: statusOf(l) === 'won' });
  }
  const n = pairs.length;
  if (n < cfg.min_outcomes) return { status: 'waiting', outcomes: n, needed: cfg.min_outcomes, note: `Calibration starts at ${cfg.min_outcomes} won or lost leads.` };
  const won = pairs.filter((p) => p.won).length;
  const base = won / n;
  const rate = (xs) => (xs.length ? round((100 * xs.filter((p) => p.won).length) / xs.length, 1) : null);
  const tiers = Object.fromEntries(['hot', 'warm', 'cold'].map((t) => { const xs = pairs.filter((p) => p.tier === t); return [t, { leads: xs.length, won: xs.filter((p) => p.won).length, win_rate_pct: rate(xs) }]; }));
  const bands = [0, 20, 40, 60, 80].map((lo) => { const hi = lo === 80 ? 100 : lo + 19; const xs = pairs.filter((p) => p.score >= lo && p.score <= hi); return { band: `${lo}-${hi}`, leads: xs.length, won: xs.filter((p) => p.won).length, win_rate_pct: rate(xs) }; });
  const mean = (xs) => (xs.length ? round(xs.reduce((s, p) => s + p.score, 0) / xs.length, 1) : null);
  const a = auc(pairs);
  // Lowest threshold whose leads at or above it win at 2x the base rate (5+ leads): a suggested "hot".
  let suggested = null;
  if (base > 0 && base < 1) for (let t = 30; t <= 95; t += 5) { const xs = pairs.filter((p) => p.score >= t); if (xs.length >= 5 && xs.filter((p) => p.won).length / xs.length >= Math.min(1, 2 * base)) { suggested = t; break; } }
  const findings = [];
  if (a != null) findings.push(a >= 0.75 ? `Scores separate wins from losses well (AUC ${a}).` : a >= 0.6 ? `Scores separate wins from losses somewhat (AUC ${a}); review the ICP rules and weights.` : `Scores barely separate wins from losses (AUC ${a}); the ICP rules or weights need rework.`);
  if (tiers.hot.leads && tiers.warm.leads && tiers.hot.win_rate_pct <= tiers.warm.win_rate_pct) findings.push('Hot leads do not win more often than warm leads: raise the hot threshold or reweight.');
  if (suggested != null && suggested !== cfg.thresholds.hot) findings.push(`A hot threshold of ${suggested} would match the leads that win at twice the base rate (current ${cfg.thresholds.hot}). Owner decision; change product.json lead_scoring.thresholds.`);
  if (!tiers.hot.leads) findings.push('No closed lead scored hot before its outcome.');
  return { status: 'ready', outcomes: n, won, lost: n - won, base_win_rate_pct: round(100 * base, 1), auc: a, mean_score_won: mean(pairs.filter((p) => p.won)), mean_score_lost: mean(pairs.filter((p) => !p.won)), tiers, bands, suggested_hot_threshold: suggested, findings };
}

// ---------- whole ledger (pure) ----------

// pipeline: funnel/pipeline.json; rows: raw lead rows; previous: the last scores.json (keeps hot_since).
export function scoreFunnel(pipeline, { rows = [], product = {}, previous = null, now = new Date().toISOString() } = {}) {
  if (!isoOk(now)) throw new Error(`invalid now: ${now}`);
  now = new Date(Date.parse(now)).toISOString(); // one UTC form for hot_since, alerts and run ids
  const cfg = scoringConfig(product);
  const profiles = buildProfiles(rows);
  const prev = new Map((Array.isArray(previous?.leads) ? previous.leads : []).filter((r) => r && r.lead).map((r) => [String(r.lead), r]));
  const leads = (Array.isArray(pipeline?.leads) ? pipeline.leads : []).filter((l) => l && typeof l === 'object' && l.id != null);
  const out = [];
  const seen = new Set();
  for (const l of leads) {
    if (seen.has(String(l.id))) continue; seen.add(String(l.id));
    const s = scoreLead(l, profileFor(profiles, l), cfg, now);
    const p = prev.get(s.lead);
    s.delta = p && Number.isFinite(p.score) ? s.score - p.score : null;
    if (s.tier === 'hot' && s.status === 'open') {
      s.hot_since = p?.tier === 'hot' && p?.status === 'open' && isoOk(p.hot_since) ? p.hot_since : now;
      // Contacted = any stage change recorded at or after the moment it became hot.
      s.contacted_since_hot = hist(l).some((h) => isoOk(h.at) && Date.parse(h.at) >= Date.parse(s.hot_since) && h.stage !== 'new' && !String(h.note ?? '').startsWith('kept:'));
      if (p?.proposed_for === s.hot_since) s.proposed_for = p.proposed_for;
    }
    s.consent = ['opted-in', 'inbound'].includes(l.consent) ? l.consent : 'unknown';
    out.push(s);
  }
  out.sort((a, b) => b.score - a.score || a.lead.localeCompare(b.lead));
  const count = (t, st = null) => out.filter((r) => r.tier === t && (!st || r.status === st)).length;
  const totals = { leads: out.length, hot: count('hot'), warm: count('warm'), cold: count('cold'), open_hot: count('hot', 'open'), open_warm: count('warm', 'open'), won: out.filter((r) => r.status === 'won').length, lost: out.filter((r) => r.status === 'lost').length };
  return {
    updated_at: now, version: 1,
    config: { thresholds: cfg.thresholds, weights: cfg.weights, icp: Object.keys(cfg.icp).filter((k) => k !== 'penalize_personal_email' || cfg.icp[k]), rules: cfg.rules.length, min_outcomes: cfg.min_outcomes },
    totals, leads: out, calibration: calibrate(leads, profiles, cfg), warnings: cfg.warnings,
  };
}

// Desired hot-lead alerts and which open ones resolve. Pure: returns the new list and whether it changed.
export function hotAlerts(list, scores, now) {
  const alerts = Array.isArray(list) ? list.map((a) => ({ ...a })) : [];
  const byLead = new Map(scores.leads.map((r) => [r.lead, r]));
  let changed = false; let opened = 0; let resolved = 0;
  for (const r of scores.leads) {
    if (r.tier !== 'hot' || r.status !== 'open' || r.contacted_since_hot) continue;
    const key = `funnel:hot:${r.lead}`;
    const title = `Hot lead ${r.lead.slice(0, 12)} scored ${r.score}: reply first`;
    const detail = `${r.reasons.join('; ')}. Stage ${r.stage}, consent ${r.consent}. ${r.consent === 'unknown' ? 'Answer only their own message; no sequences.' : 'om-sdr drafts the reply; it goes out only after your approval.'}`;
    const open = alerts.find((a) => !a.resolved && a.key === key);
    if (open) { if (open.title !== title) { Object.assign(open, { title, detail, last_seen: now }); changed = true; } continue; }
    // Already alerted and resolved for this same hot spell: do not reopen.
    if (alerts.some((a) => a.key === key && a.hot_since === r.hot_since)) continue;
    if (opened >= MAX_NEW_ALERTS) continue; // no flood in the owner feed; later runs open the rest
    alerts.push({ key, level: 'warning', title, detail, agent: 'om-lead-scorer', at: now, hot_since: r.hot_since, resolved: false }); changed = true; opened++;
  }
  for (const a of alerts) {
    if (a.resolved || !/^funnel:hot:/.test(a.key ?? '')) continue;
    const r = byLead.get(a.key.slice('funnel:hot:'.length));
    const why = !r ? 'lead no longer in the pipeline' : r.status !== 'open' ? `lead ${r.status}` : r.tier !== 'hot' ? `cooled to ${r.tier}` : r.contacted_since_hot ? 'contacted' : null;
    if (why) { Object.assign(a, { resolved: true, resolved_at: now, resolved_by: 'om-lead-scorer', resolution: why }); changed = true; resolved++; }
  }
  return { alerts, changed, opened, resolved };
}

// Draft-reply tasks for new hot, consented, uncontacted leads (run-file shape for apply-results.mjs).
// Never an outbound action: om-sdr writes a draft to outbox/ plus an approvals entry for the owner.
export function proposals(scores, now) {
  const items = scores.leads.filter((r) => r.tier === 'hot' && r.status === 'open' && !r.contacted_since_hot && r.consent !== 'unknown' && r.proposed_for !== r.hot_since);
  return items.map((r) => ({
    lead: r.lead, hot_since: r.hot_since,
    task: { title: `Draft reply to hot lead ${r.lead.slice(0, 12)} (score ${r.score})`.slice(0, 90), agent: 'om-sdr', priority: 1, depends_on: [],
      brief: `Lead ${r.lead} scored ${r.score} (${r.reasons.join('; ')}), stage ${r.stage}, consent ${r.consent}. Read funnel/pipeline.json and the lead's own message, draft one reply that answers it and offers the next step, write it to outbox/ and an approvals entry (type send_email). Use only claims.md. Do not send.` },
  }));
}

// ---------- files ----------

// RFC 4180-style CSV: quoted fields, "" escapes, commas and line breaks inside quotes.
export function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const readRows = (file) => {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  if (/\.jsonl$/i.test(file)) return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (/\.csv$/i.test(file)) {
    const [head, ...lines] = parseCsv(text);
    const cols = (head ?? []).map((c) => c.trim().toLowerCase());
    return lines.filter((l) => l.some((v) => v.trim())).map((l) => Object.fromEntries(l.map((v, i) => [cols[i] || `col_${i}`, v.trim()])));
  }
  const j = JSON.parse(text);
  return Array.isArray(j) ? j : (j.leads ?? j.rows ?? []);
};

// One product: read, score, write scores.json, alerts and (optionally) the proposal run file.
export function runLeadScore(slug, { now = new Date().toISOString(), alerts = true, propose = true, root = repoRoot } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(String(slug ?? ''))) throw new Error(`invalid slug: ${slug}`);
  if (!isoOk(now)) throw new Error(`invalid now: ${now}`);
  now = new Date(Date.parse(now)).toISOString();
  const dir = path.join(root, 'products', slug);
  const product = readJson(path.join(dir, 'product.json'), null);
  if (!product) throw new Error(`no product ${slug}`);
  const fdir = path.join(dir, 'funnel');
  // A pipeline.json that exists but does not parse (mid-write, hand edit) stops the run: scoring an empty
  // ledger would wipe scores.json and resolve every hot alert as "lead no longer in the pipeline".
  const pfile = path.join(fdir, 'pipeline.json');
  const pipeline = fs.existsSync(pfile) ? readJson(pfile, undefined) : { leads: [] };
  if (!pipeline || typeof pipeline !== 'object' || Array.isArray(pipeline) || (pipeline.leads != null && !Array.isArray(pipeline.leads))) throw new Error(`${slug}: funnel/pipeline.json is not valid; nothing written`);
  const rows = []; const errors = [];
  const log = path.join(dir, 'leads.jsonl');
  if (fs.existsSync(log)) { try { rows.push(...readRows(log)); } catch (e) { errors.push(`leads.jsonl: ${e.message}`); } }
  const ldir = path.join(dir, 'leads');
  if (fs.existsSync(ldir)) for (const f of fs.readdirSync(ldir).filter((x) => /\.(json|jsonl|csv)$/i.test(x)).sort()) { try { rows.push(...readRows(path.join(ldir, f))); } catch (e) { errors.push(`${f}: ${e.message}`); } }
  const scoresFile = path.join(fdir, 'scores.json');
  const previous = readJson(scoresFile, null);
  const scores = scoreFunnel(pipeline, { rows, product, previous, now });

  let alertStats = { opened: 0, resolved: 0 };
  if (alerts) {
    const afile = path.join(dir, 'alerts.json');
    // Shared with other tools: if it exists but does not parse, leave it alone rather than overwrite it.
    const list = fs.existsSync(afile) ? readJson(afile, undefined) : [];
    if (!Array.isArray(list)) errors.push('alerts.json is not a JSON array; alerts skipped');
    else {
      const res = hotAlerts(list, scores, now);
      if (res.changed) writeJson(afile, res.alerts);
      alertStats = { opened: res.opened, resolved: res.resolved };
    }
  }
  let proposed = 0;
  if (propose && scoringConfig(product).propose_tasks && product.stage !== 'paused') {
    const items = proposals(scores, now);
    if (items.length) {
      const runs = path.join(dir, 'runs');
      fs.mkdirSync(runs, { recursive: true });
      const taskId = `LEADSCORE-${now.slice(0, 10)}`;
      const file = path.join(runs, `${taskId}.json`);
      const existing = readJson(file, null);
      const had = Array.isArray(existing?.new_tasks) ? existing.new_tasks : [];
      const newTasks = [...had, ...items.map((i) => i.task).filter((t) => !had.some((h) => h.title === t.title))];
      writeJson(file, { task_id: taskId, agent: 'om-lead-scorer', status: 'done', output: ['funnel/scores.json'], summary: `Lead scores: ${scores.totals.open_hot} hot open lead(s); ${newTasks.length} reply draft(s) queued for om-sdr`, new_tasks: newTasks, approvals: [] });
      const ids = new Set(items.map((i) => i.lead));
      for (const r of scores.leads) if (ids.has(r.lead)) r.proposed_for = r.hot_since;
      proposed = items.length;
    }
  }
  fs.mkdirSync(fdir, { recursive: true });
  writeJson(scoresFile, scores);
  return { slug, ...scores.totals, calibration: scores.calibration.status, alerts_opened: alertStats.opened, alerts_resolved: alertStats.resolved, proposed, warnings: scores.warnings, errors };
}

// Tier counts per product for the dashboard (no lead ids, no personal data).
export function writeLeadScoreState(slugs, { root = repoRoot, now = new Date().toISOString() } = {}) {
  const products = [];
  for (const slug of slugs) {
    const s = readJson(path.join(root, 'products', slug, 'funnel', 'scores.json'), null);
    if (!s) continue;
    const c = s.calibration ?? {};
    products.push({ product: slug, updated_at: s.updated_at, thresholds: s.config?.thresholds, totals: s.totals, calibration: { status: c.status ?? 'waiting', outcomes: c.outcomes ?? 0, auc: c.auc ?? null, suggested_hot_threshold: c.suggested_hot_threshold ?? null } });
  }
  fs.mkdirSync(path.join(root, 'state'), { recursive: true });
  writeJson(path.join(root, 'state', 'lead-scores.json'), { updated_at: now, products });
  return products.length;
}

const activeSlugs = (root = repoRoot) => {
  const dir = path.join(root, 'products');
  return (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((s) => !s.startsWith('_') && /^[a-z0-9-]+$/i.test(s) && fs.existsSync(path.join(dir, s, 'product.json'))).sort();
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const ni = argv.indexOf('--now');
  const now = ni > -1 ? argv[ni + 1] : new Date().toISOString();
  if (!isoOk(now)) { console.error('--now needs an ISO date'); process.exit(2); }
  const opts = { now, alerts: !argv.includes('--no-alerts'), propose: !argv.includes('--no-propose') };
  const all = argv.includes('--all');
  const slugs = all ? activeSlugs().filter((s) => fs.existsSync(path.join(repoRoot, 'products', s, 'funnel', 'pipeline.json'))) : argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--now').slice(0, 1);
  if (!slugs.length && !all) { console.error('Usage: node tools/lead-score.mjs <slug> [--now ISO] [--no-alerts] [--no-propose] | --all'); process.exit(2); }
  const out = [];
  for (const s of slugs) { try { out.push(runLeadScore(s, opts)); } catch (e) { out.push({ slug: s, error: e.message }); } }
  if (all) writeLeadScoreState(slugs, { now });
  console.log(JSON.stringify(out.length === 1 ? out[0] : out));
  if (!all && out[0]?.error) process.exit(1);
}
