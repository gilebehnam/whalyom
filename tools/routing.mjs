// Outcome-led routing (stage 5): which agent tends to get results for a kind of task, on a channel.
// Reads the market's verdict (lead, sale and revenue credit from tools/outcomes.mjs), the evaluator's
// verdict (task scores in tasks.json) and the roster, and ranks agents per task family and per channel:
//   - results per item out: leads, sales and revenue divided by the items that went out
//   - evaluator score: the average task score (1-5) for that agent on that family of task
//   - minimum sample: below MIN_ITEMS items (or MIN_SCORES scored tasks) the observation is blended with
//     the prior, weight n/(n+min), and marked "thin"; with nothing observed the prior alone ranks
//   - prior from the roster: a new agent whose pod or title fits the family starts above one that does not
//   - agents with items out 14+ days and no lead or sale are listed as "improve or retire" candidates for
//     om-evolve (it decides; nothing is changed here)
// Advisory only: this tool never edits tasks.json, approvals.json or any ledger and never reassigns a
// task. The CMO, the dispatcher and om-evolve read state/agent-routing.json and recommend() as a hint.
// Only counts and agent names leave this tool: no lead rows, emails or names of people.
//   state/agent-routing.json  { updated_at, advisory, rule, families: {family: [{agent, score, evidence}]},
//                               channels: {family: {channel: [{agent, score, evidence}]}}, improve_or_retire }
// Usage: node tools/routing.mjs                      rebuild state/agent-routing.json
//        node tools/routing.mjs <family> [channel]   print the advisory recommendation
//        node tools/routing.mjs --dir <path> ...     work on another root (tests)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, root } from './lib/env.mjs';

export const MIN_ITEMS = 5;      // items out before results count at full trust (blended below it)
export const MIN_SCORES = 3;     // scored tasks before the evaluator average counts at full trust
export const STALE_DAYS = 14;    // items out this long with no result make an "improve or retire" candidate
export const PER_FAMILY = 12;    // agents kept per family in the state file
const DAY = 86400000;
const W_OUTCOME = 0.65;          // market results weigh more than the evaluator's opinion
const W_EVAL = 0.35;

// Task families: pods that own them, and words in a task title or brief that point to them.
export const FAMILIES = {
  seo: { pods: ['seo'], words: ['seo', 'serp', 'keyword', 'schema', 'sitemap', 'backlink', 'link building', 'aeo', 'geo', 'llms.txt', 'ai visibility', 'search console', 'ranking', 'crawl', 'index'] },
  content: { pods: ['content'], words: ['article', 'blog', 'case study', 'guide', 'whitepaper', 'ebook', 'pillar', 'editorial', 'content'] },
  conversion: { pods: ['conversion'], words: ['landing', 'cro', 'checkout', 'signup', 'sign-up', 'form', 'onboarding', 'pricing page', 'conversion', 'lead magnet', 'popup', 'a/b'] },
  email: { pods: ['lifecycle'], words: ['email', 'newsletter', 'sequence', 'nurture', 'drip', 'win-back', 'reactivation', 'retention', 'churn'] },
  social: { pods: ['social'], words: ['social', 'linkedin', 'reddit', 'twitter', 'tiktok', 'instagram', 'youtube', 'community', 'post', 'thread', 'forum'] },
  paid: { pods: ['paid'], words: ['ads', 'ad ', 'ppc', 'bid', 'campaign', 'spend', 'retargeting', 'meta ads', 'google ads', 'roas', 'cpa', 'creative test'] },
  sales: { pods: ['sales'], words: ['outreach', 'sdr', 'demo', 'prospect', 'follow-up', 'follow up', 'pipeline', 'deal', 'objection', 'proposal', 'speed to lead'] },
  research: { pods: ['research', 'intel', 'consulting'], words: ['research', 'competitor', 'icp', 'jtbd', 'interview', 'survey', 'persona', 'market sizing', 'pricing intel', 'voice of customer', 'fact check'] },
  analytics: { pods: ['analytics'], words: ['tracking', 'analytics', 'attribution', 'metrics', 'dashboard', 'kpi', 'utm', 'report'] },
  authority: { pods: ['authority'], words: ['pr ', 'press', 'podcast', 'award', 'directory', 'launch', 'product hunt', 'media', 'review site'] },
  creative: { pods: ['creative'], words: ['video', 'design', 'image', 'visual', 'banner', 'thumbnail', 'brand asset'] },
  partners: { pods: ['partners', 'distribution', 'frontier'], words: ['partner', 'affiliate', 'marketplace', 'integration', 'reseller', 'co-marketing', 'retail media'] },
  intl: { pods: ['intl'], words: ['locali', 'translat', 'international', 'hreflang'] },
  general: { pods: ['command', 'selfops', 'knowledge', 'mega', 'micro', 'ai', 'depts', 'zero', 'grown', 'platforms'], words: [] },
};

const round = (n, d = 3) => { const f = 10 ** d; return Math.round(n * f) / f; };
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').slice(0, 40);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const pos = (v) => Math.max(0, num(v));          // counts and money are never negative
// Lookup tables keyed by names that come from ledgers have no prototype, so '__proto__' or
// 'constructor' can neither pollute Object.prototype nor resolve to a built-in.
const dict = () => Object.create(null);
const own = (o, k) => (o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
// Agent names are om-style slugs; anything else (an email, a person's name, '__proto__') is dropped.
const AGENT_RE = /^[a-z0-9][a-z0-9_.-]{0,79}$/i;
export const validAgent = (a) => typeof a === 'string' && AGENT_RE.test(a);
// Channel label: normalised, and dropped when it looks like personal data (an email or a phone number).
export function safeChannel(c) {
  const raw = String(c ?? '');
  if (!raw || raw.includes('@') || /\d[\d\s().+-]{6,}\d/.test(raw)) return null;
  const n = norm(raw).replace(/^[-_.]+/, '');
  return n || null;
}
// A family word matches at the start of a word ('form' in "signup form", not in "information").
const reCache = new Map();
const wordRe = (w) => {
  if (!reCache.has(w)) reCache.set(w, new RegExp(`(?<![a-z0-9])${w.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`));
  return reCache.get(w);
};

// Family of a free text (task title + brief): the family with the most word hits, or null.
export function familyOfText(text) {
  const t = ` ${String(text ?? '').toLowerCase()} `;
  let best = null; let hits = 0;
  for (const [fam, def] of Object.entries(FAMILIES)) {
    const n = def.words.filter((w) => wordRe(w).test(t)).length;
    if (n > hits) { best = fam; hits = n; }
  }
  return best;
}

// Family of a pod name ('seo', 'Web & SEO' both work).
export function familyOfPod(pod) {
  const p = String(pod ?? '').toLowerCase();
  for (const [fam, def] of Object.entries(FAMILIES)) if (def.pods.includes(p)) return fam;
  return null;
}

// Family of a task: explicit task.family, else its words, else its agent's pod, else "general".
export function familyOfTask(task, rosterByName = {}) {
  if (typeof task?.family === 'string' && Object.hasOwn(FAMILIES, task.family)) return task.family;
  return familyOfText(`${task?.title ?? ''} ${task?.brief ?? ''}`) ?? familyOfPod(own(rosterByName, task?.agent)?.pod) ?? 'general';
}

// Family an agent belongs to by the roster: its pod, else its title and description.
export function familyOfAgent(agent) {
  if (!agent) return null;
  const byPod = familyOfPod(agent.pod);
  if (byPod && byPod !== 'general') return byPod;
  return familyOfText(`${agent.title ?? ''} ${agent.does ?? ''}`) ?? byPod;
}

// Prior (0..1) before any result: fit between the agent's roster entry and the family.
export function rosterPrior(agent, family) {
  if (!agent) return 0.3;                       // not in the roster (grown or renamed): neutral
  const fits = familyOfAgent(agent) === family;
  if (agent.tier === 'micro') return fits ? 0.4 : 0.15;
  if (agent.tier === 'mega') return fits ? 0.45 : 0.2;
  return fits ? 0.5 : 0.2;
}

// Results per item mapped to 0..1. A lead per item is good, a sale per item better, revenue adds a
// little on a log scale so one big deal does not swamp the rest.
export function outcomeValue({ items = 0, leads = 0, won = 0, revenue = 0 } = {}) {
  items = pos(items); leads = pos(leads); won = pos(won); revenue = pos(revenue);
  if (!items) return null;
  const x = leads / items + 3 * (won / items) + Math.log10(1 + revenue / items) / 2;
  return clamp01(1 - Math.exp(-2 * x));
}

// Score one agent on one family (or family + channel). Returns {score, evidence}.
export function scoreAgent({ prior, items = 0, leads = 0, won = 0, revenue = 0, scores = [], fallbackScore = null }) {
  items = pos(items); leads = pos(leads); won = pos(won); revenue = pos(revenue);
  prior = Number.isFinite(prior) ? clamp01(prior) : 0.3;
  const okScore = (s) => Number.isFinite(s) && s >= 1 && s <= 5;   // the evaluator scale is 1-5
  if (!okScore(fallbackScore)) fallbackScore = null;
  const obs = outcomeValue({ items, leads, won, revenue });
  const wO = obs === null ? 0 : items / (items + MIN_ITEMS);
  const out = wO * (obs ?? 0) + (1 - wO) * prior;
  const list = (Array.isArray(scores) ? scores : []).filter(okScore);
  const avg = list.length ? list.reduce((s, x) => s + x, 0) / list.length : fallbackScore;
  const m = list.length || (avg !== null ? 1 : 0);
  const evalObs = avg === null ? null : clamp01((avg - 1) / 4);
  const wE = evalObs === null ? 0 : m / (m + MIN_SCORES);
  const ev = wE * (evalObs ?? 0) + (1 - wE) * prior;
  const sample = items >= MIN_ITEMS || list.length >= MIN_SCORES ? 'enough' : items > 0 || m > 0 ? 'thin' : 'prior';
  return {
    score: round(W_OUTCOME * out + W_EVAL * ev),
    evidence: {
      items, leads: round(leads, 2), won: round(won, 2), revenue: round(revenue, 2),
      per_item: items ? { leads: round(leads / items), won: round(won / items), revenue: round(revenue / items, 2) } : null,
      avg_score: avg === null ? null : round(avg, 2), scored_tasks: list.length,
      sample, prior: round(prior, 2),
    },
  };
}

// Sums per-product outcome rows into one row per agent (channels unioned, avg_score averaged).
export function mergeOutcomes(rows = []) {
  const out = dict();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!validAgent(r?.agent)) continue;
    const t = (out[r.agent] ??= { agent: r.agent, items_out: 0, leads: 0, won: 0, revenue: 0, no_result_items: 0, waiting_items: 0, tasks_done: 0, channels: [], _s: [] });
    for (const k of ['items_out', 'leads', 'won', 'revenue', 'no_result_items', 'waiting_items', 'tasks_done']) t[k] = round(t[k] + pos(r[k]), 2);
    for (const c of Array.isArray(r.channels) ? r.channels : []) { const ch = safeChannel(c); if (ch && !t.channels.includes(ch)) t.channels.push(ch); }
    if (r.avg_score !== null && r.avg_score !== undefined && r.avg_score !== '' && Number(r.avg_score) >= 1 && Number(r.avg_score) <= 5) t._s.push(Number(r.avg_score));
  }
  return Object.values(out).map(({ _s, ...r }) => ({ ...r, avg_score: _s.length ? round(_s.reduce((s, x) => s + x, 0) / _s.length, 2) : null }));
}

// Pure. outcomes = merged agent rows (tools/outcomes.mjs), tasks = task rows (agent, title, brief,
// status, score, family?), approvals = approval rows (agent, status, executed_at, channel | utm_source),
// roster = [{name, pod, tier, title, does}]. Nothing in the inputs is changed.
export function buildRouting({ outcomes = [], tasks = [], approvals = [], roster = [], now = new Date().toISOString(), perFamily = PER_FAMILY } = {}) {
  roster = (Array.isArray(roster) ? roster : []).filter((a) => validAgent(a?.name));
  tasks = Array.isArray(tasks) ? tasks : []; approvals = Array.isArray(approvals) ? approvals : [];
  const byName = dict(); for (const a of roster) byName[a.name] = a;
  const oc = dict(); for (const r of mergeOutcomes(outcomes)) oc[r.agent] = r;
  const nowMs = Number.isFinite(Date.parse(now)) ? Date.parse(now) : Date.now();

  // Evaluator scores and task counts per agent and family.
  const taskStats = dict();
  for (const t of tasks) {
    if (!validAgent(t?.agent)) continue;
    const fam = familyOfTask(t, byName);
    const s = ((taskStats[fam] ??= dict())[t.agent] ??= { tasks: 0, done: 0, scores: [] });
    s.tasks++; if (t.status === 'done') s.done++;
    if (t.score !== null && t.score !== undefined && t.score !== '' && Number.isFinite(Number(t.score))) s.scores.push(Number(t.score));
  }

  // Items out per agent and channel (executed approvals), and the age of the oldest one.
  const items = dict();
  for (const a of approvals) {
    if (!validAgent(a?.agent) || a.status !== 'executed') continue;
    const ch = safeChannel(a.utm_source ?? a.channel ?? 'site') ?? 'other';
    const r = ((items[a.agent] ??= dict())[ch] ??= { items: 0, oldest: null });
    r.items++;
    const t = Date.parse(a.executed_at ?? '');
    if (Number.isFinite(t) && (r.oldest === null || t < r.oldest)) r.oldest = t;
  }

  // Candidates per family: agents that worked in it, plus roster agents that fit it.
  const families = dict(); const channels = dict();
  for (const fam of Object.keys(FAMILIES)) {
    const names = new Set(Object.keys(taskStats[fam] ?? {}));
    for (const a of roster) if (familyOfAgent(a) === fam) names.add(a.name);
    for (const r of Object.values(oc)) if (familyOfAgent(byName[r.agent]) === fam) names.add(r.agent);
    const ranked = [];
    for (const agent of names) {
      const o = oc[agent]; const ts = taskStats[fam]?.[agent];
      const prior = rosterPrior(byName[agent], fam);
      const fromFamilyTasks = Boolean(ts) || familyOfAgent(byName[agent]) === fam;
      const { score, evidence } = scoreAgent({
        prior,
        items: fromFamilyTasks ? num(o?.items_out) : 0,
        leads: fromFamilyTasks ? num(o?.leads) : 0,
        won: fromFamilyTasks ? num(o?.won) : 0,
        revenue: fromFamilyTasks ? num(o?.revenue) : 0,
        scores: ts?.scores ?? [],
        fallbackScore: ts ? null : (o?.avg_score ?? null),
      });
      evidence.tasks = ts?.tasks ?? 0; evidence.tasks_done = ts?.done ?? 0;
      evidence.channels = Object.keys(items[agent] ?? {}).length ? Object.keys(items[agent]).sort() : (o?.channels ?? []);
      ranked.push({ agent, score, evidence });
    }
    ranked.sort((a, b) => b.score - a.score || b.evidence.items - a.evidence.items || a.agent.localeCompare(b.agent));
    if (ranked.length) families[fam] = ranked.slice(0, perFamily);

    // Per channel: the agent's results prorated by its share of items on that channel.
    for (const agent of names) {
      const o = oc[agent];
      const total = Object.values(items[agent] ?? {}).reduce((s, r) => s + r.items, 0);
      for (const [ch, r] of Object.entries(items[agent] ?? {})) {
        const share = total ? r.items / total : 0;
        const ts = taskStats[fam]?.[agent];
        const { score, evidence } = scoreAgent({ prior: rosterPrior(byName[agent], fam), items: r.items, leads: num(o?.leads) * share, won: num(o?.won) * share, revenue: num(o?.revenue) * share, scores: ts?.scores ?? [], fallbackScore: ts ? null : (o?.avg_score ?? null) });
        evidence.prorated = share < 1;
        (((channels[fam] ??= dict())[ch]) ??= []).push({ agent, score, evidence });
      }
    }
    for (const list of Object.values(channels[fam] ?? {})) list.sort((a, b) => b.score - a.score || b.evidence.items - a.evidence.items || a.agent.localeCompare(b.agent));
  }

  // Improve-or-retire candidates: items out STALE_DAYS+ and no lead or sale anywhere.
  const improve = [];
  const agents = new Set([...Object.keys(oc), ...Object.keys(items)]);
  for (const agent of agents) {
    const o = oc[agent];
    const leads = num(o?.leads); const won = num(o?.won);
    if (leads > 0 || won > 0) continue;
    const oldest = Math.min(...Object.values(items[agent] ?? {}).map((r) => r.oldest ?? Infinity));
    const days = Number.isFinite(oldest) ? Math.floor((nowMs - oldest) / DAY) : null;
    const staleItems = Math.max(num(o?.no_result_items), Object.values(items[agent] ?? {}).length && days !== null && days >= STALE_DAYS ? 1 : 0);
    if (!staleItems) continue;
    const itemsOut = Math.max(num(o?.items_out), Object.values(items[agent] ?? {}).reduce((s, r) => s + r.items, 0));
    const avg = o?.avg_score ?? null;
    const retire = (avg !== null && avg < 3) || itemsOut >= 2 * MIN_ITEMS;
    improve.push({
      agent, items_out: itemsOut, no_result_items: num(o?.no_result_items) || staleItems, oldest_item_days: days,
      avg_score: avg, suggestion: retire ? 'retire' : 'improve',
      reason: `${itemsOut} item(s) out, oldest ${days ?? STALE_DAYS + '+'} days, no lead or sale${avg !== null ? `, evaluator ${avg}` : ''}`,
      for: 'om-evolve',
    });
  }
  improve.sort((a, b) => b.items_out - a.items_out || a.agent.localeCompare(b.agent));

  return {
    updated_at: new Date(nowMs).toISOString(),
    advisory: true,
    rule: { min_items: MIN_ITEMS, min_scores: MIN_SCORES, stale_days: STALE_DAYS, weights: { outcome: W_OUTCOME, evaluator: W_EVAL }, note: 'Hint only: never reassigns a task. Below the minimum sample, results blend with the roster prior.' },
    families: { ...families },
    channels: Object.fromEntries(Object.entries(channels).map(([f, c]) => [f, { ...c }])),
    improve_or_retire: improve,
  };
}

// Advisory recommendation for a family (or free text) and an optional channel. Never assigns anything.
export function recommend(family, channel = null, { routing = null, dir = root, limit = 3 } = {}) {
  const r = routing ?? readJson(path.join(dir, 'state', 'agent-routing.json'), null);
  const fam = typeof family === 'string' && Object.hasOwn(FAMILIES, family) ? family : (familyOfText(family) ?? 'general');
  const ch = channel ? safeChannel(channel) : null;
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => validAgent(x?.agent)) : []);
  const famList = arr(own(own(r, 'families'), fam));
  let basis = 'family'; let list = famList;
  const chList = ch ? arr(own(own(own(r, 'channels'), fam), ch)) : [];
  if (chList.length) { basis = 'channel'; list = chList; }
  else if (ch) {
    const on = famList.filter((x) => Array.isArray(x.evidence?.channels) && x.evidence.channels.includes(ch));
    if (on.length) { basis = 'channel'; list = on; }
  }
  if (list.length && list.every((x) => x.evidence?.sample === 'prior')) basis = 'prior';
  if (!list.length) basis = 'none';
  const n = Math.max(0, Math.floor(num(limit))) || 3;
  return { family: fam, channel: ch, advisory: true, basis, candidates: list.slice(0, n).map((x) => ({ agent: x.agent, score: num(x.score), sample: x.evidence?.sample ?? null })) };
}

const productDirs = (dir) => {
  const p = path.join(dir, 'products');
  return (fs.existsSync(p) ? fs.readdirSync(p) : []).filter((s) => !s.startsWith('_') && fs.existsSync(path.join(p, s, 'product.json'))).map((s) => path.join(p, s));
};

// Reads the inputs from disk (read-only): per-product outcome reports, tasks and approvals, falling back
// to state/agent-outcomes.json and state/tasks.json.
export function loadInputs(dir = root) {
  const outcomes = []; const tasks = []; const approvals = [];
  const list = (v) => (Array.isArray(v) ? v : []);   // a malformed file counts as empty and never crashes the run
  for (const p of productDirs(dir)) {
    outcomes.push(...list(readJson(path.join(p, 'reports', 'agent-outcomes.json'), null)?.agents));
    tasks.push(...list(readJson(path.join(p, 'tasks.json'), [])));
    approvals.push(...list(readJson(path.join(p, 'approvals.json'), [])));
  }
  if (!outcomes.length) outcomes.push(...list(readJson(path.join(dir, 'state', 'agent-outcomes.json'), null)?.agents));
  if (!tasks.length) tasks.push(...list(readJson(path.join(dir, 'state', 'tasks.json'), [])));
  return { outcomes, tasks: tasks.filter(Boolean), approvals: approvals.filter(Boolean) };
}

const loadRoster = async () => {
  try { const m = await import('./roster.mjs'); return m.roster; } catch { return []; }
};

// Builds and writes state/agent-routing.json. roster may be injected (tests).
export async function runRouting({ dir = root, now = new Date().toISOString(), roster = null } = {}) {
  const r = Array.isArray(roster) ? roster : await loadRoster();
  const routing = buildRouting({ ...loadInputs(dir), roster: r, now });
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  writeJson(path.join(dir, 'state', 'agent-routing.json'), routing);
  return { families: Object.keys(routing.families).length, improve_or_retire: routing.improve_or_retire.length };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const di = args.indexOf('--dir');
  if (di >= 0 && !args[di + 1]) { console.error('usage: node tools/routing.mjs [--dir <path>] [family] [channel]'); process.exit(2); }
  const dir = di >= 0 ? path.resolve(args[di + 1]) : root;
  const rest = args.filter((_, i) => i !== di && i !== di + 1);
  if (rest.length) console.log(JSON.stringify(recommend(rest[0], rest[1] ?? null, { dir }), null, 2));
  else console.log(JSON.stringify(await runRouting({ dir })));
}
