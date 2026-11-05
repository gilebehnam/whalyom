// A/B and multi-armed bandit testing: one bandit ledger per product, Thompson sampling with an
// exploration floor, deterministic per-visitor assignment, stop rules and a winner report.
//   products/<slug>/experiments/bandits.json        the ledger (single writer: this tool). One entry per
//                                                    experiment: id, element, goal, arms (id, label, variant),
//                                                    status, stats, winner, stop reason.
//   products/<slug>/experiments/bandit-drafts/*.json new experiments proposed by agents (agents never edit the
//                                                    ledger); merged as "draft" and moved to bandit-drafts/done/.
//   products/<slug>/experiments/bandit-events.jsonl  exposures and conversions written by the edge/satellite
//                                                    route (normalizeBeacon): {at, exp, arm, vid (hashed), kind}.
//   products/<slug>/experiments/bandit-report.json   per experiment: arms, rates, credible intervals,
//                                                    probability to be best / beat control, allocation, verdict
//   products/<slug>/experiments/BANDITS.md           the same report for people
//   products/<slug>/experiments/bandit-live.json     the allocation table the client snippet serves
//   products/<slug>/runs/BANDIT-<date>.json          approval proposals (start a test, roll out a winner) and
//                                                    experiment results, merged by tools/apply-results.mjs
//   state/bandits.json                               every product, no personal data (dashboard)
// How it works:
//   * Each arm has a Beta(1 + conversions, 1 + exposures - conversions) posterior. A seeded Monte Carlo gives
//     every arm's probability of being best; traffic weight = explore / K + (1 - explore) * P(best)
//     (Thompson sampling as probability matching, with a 10% exploration floor by default).
//   * A visitor id is hashed (FNV-1a, same code on the server and in the client snippet) to a number in
//     [0, 1) that picks the arm from the cumulative weights: the same visitor sees the same arm while the
//     weights hold. thompsonChoose() offers the literal per-visitor posterior draw for server-side rendering.
//   * Exposures and conversions count unique visitors; a conversion counts for the arm the visitor first saw,
//     only after that exposure and inside the test window. Conversions also come from the funnel ledger
//     (rows that carry a visitor id) and from conversion events without an experiment id.
//   * Stop rules: the leader's probability to be best >= threshold (0.95) with every arm at min_samples
//     exposures declares a winner; max_days without a winner stops the test (inconclusive, the original
//     page is served again). A winner is never rolled out on its own: the tool proposes an approval.
// Nothing outbound without approval: a draft is served to visitors only after the owner approves the
// "start" proposal (approvals.json target "bandit:<id>:start"); a winner goes to 100% only after the
// "rollout" proposal is approved (approval ids A-BANDIT-<id>-start / -rollout, so a proposal is never
// queued twice). Approving target "bandit:<id>:stop" stops a live test. Tests that cost money (cost.daily)
// must fit product.json budget caps. A ledger that does not parse is left untouched and the run fails.
// Personal data: visitor ids are hashed before they are stored; raw emails or phone numbers are never read.
// Usage: node tools/bandit.mjs <slug> [--now ISO]     update one product
//        node tools/bandit.mjs --all                  every product, then state/bandits.json
//        node tools/bandit.mjs snippet <slug> [--endpoint https://edge.example]   print the client snippet
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, root } from './lib/env.mjs';

export const DEFAULTS = Object.freeze({ explore: 0.1, threshold: 0.95, min_samples: 200, max_days: 28, draws: 10000 });
export const STATUSES = ['draft', 'running', 'winner', 'rolled_out', 'stopped'];
export const VARIANT_TYPES = ['text', 'class', 'attr', 'hide', 'none'];
const SAFE_ATTRS = ['href', 'src', 'alt', 'title', 'placeholder', 'aria-label', 'value'];
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const DAY = 86400000;

const str = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const isoOk = (s) => typeof s === 'string' && Number.isFinite(Date.parse(s));
const clamp = (x, lo, hi, d) => { const n = Number(x); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const round = (n, d = 4) => { const f = 10 ** d; return Math.round(n * f) / f; };
// Browsers drop ASCII whitespace and control characters inside a URL scheme ("java\tscript:"), so they are
// stripped before the check. The client snippet carries the same rule.
export const unsafeUrl = (v) => /^(javascript|data|vbscript):/i.test(String(v ?? '').replace(/[\u0000- \u007f]+/g, ''));
export const approvalId = (expId, action) => `A-BANDIT-${expId}-${action}`;
export const hashVisitor = (vid) => crypto.createHash('sha256').update(`om-bandit:${vid}`).digest('hex').slice(0, 16);

// ------------------------------------------------------------------------------------------------
// Deterministic randomness. fnv1a must stay byte-identical to the copy inside clientSnippet().
export function fnv1a(s) {
  let h = 0x811c9dc5;
  const t = String(s);
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
export const hashUnit = (s) => fnv1a(s) / 4294967296;
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normal(rng) {
  let u = 0; while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}
// Marsaglia-Tsang; shape < 1 uses the boost gamma(a + 1) * U^(1/a).
function gamma(a, rng) {
  if (a < 1) { let u = 0; while (u === 0) u = rng(); return gamma(a + 1, rng) * u ** (1 / a); }
  const d = a - 1 / 3; const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x; let v;
    do { x = normal(rng); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
export function betaSample(a, b, rng) { const x = gamma(a, rng); const y = gamma(b, rng); return x / (x + y); }

// ------------------------------------------------------------------------------------------------
// Validation and normalisation of one experiment (from a draft or the ledger).
export function validateExperiment(x) {
  const errors = [];
  if (!x || typeof x !== 'object' || Array.isArray(x)) return { errors: ['experiment must be an object'] };
  const id = str(x.id, 40);
  if (!ID.test(id)) errors.push('id must be 1-40 letters, digits, "_" or "-"');
  const element = str(x.element, 200);
  if (!element) errors.push('element (CSS selector or slot) is required');
  const arms = Array.isArray(x.arms) ? x.arms : [];
  if (arms.length < 2 || arms.length > 8) errors.push('2 to 8 arms are required (arm 1 is the control)');
  const seen = new Set();
  const outArms = arms.map((a, i) => {
    const aid = str(a?.id, 40);
    if (!ID.test(aid)) errors.push(`arm ${i + 1}: bad id`);
    if (seen.has(aid)) errors.push(`arm ${i + 1}: duplicate id ${aid}`);
    seen.add(aid);
    const v = a?.variant ?? { type: 'none' };
    const type = str(v.type, 10) || 'none';
    if (!VARIANT_TYPES.includes(type)) errors.push(`arm ${aid}: variant type must be one of ${VARIANT_TYPES.join(', ')}`);
    if (type === 'attr' && !SAFE_ATTRS.includes(str(v.name, 20))) errors.push(`arm ${aid}: attr must be one of ${SAFE_ATTRS.join(', ')}`);
    const ref = str(v.ref, 200);
    if (ref && (ref.includes('..') || path.isAbsolute(ref) || /^[a-z]+:/i.test(ref))) errors.push(`arm ${aid}: ref must be a path inside the product folder`);
    const variant = { type };
    if (v.value !== undefined) variant.value = str(String(v.value), 2000);
    if (ref) variant.ref = ref;
    if (type === 'attr') variant.name = str(v.name, 20);
    if (type === 'class') variant.value = str(String(v.value ?? ''), 200).replace(/[^A-Za-z0-9_ -]/g, '');
    if (type === 'attr' && unsafeUrl(variant.value)) errors.push(`arm ${aid}: unsafe attribute value`);
    return { id: aid, label: str(a?.label, 120) || aid, variant };
  });
  if (outArms[0] && outArms[0].variant.type !== 'none' && x.control_has_variant !== true) outArms[0].variant = { type: 'none' };
  const exp = {
    id, name: str(x.name, 160) || id, element, page: str(x.page, 300),
    goal: { kind: ['click', 'submit', 'event'].includes(x.goal?.kind) ? x.goal.kind : 'event', selector: str(x.goal?.selector, 200) },
    hypothesis: str(x.hypothesis, 500), metric: str(x.metric, 80) || 'conversion_rate',
    explore: clamp(x.explore, 0.01, 1, DEFAULTS.explore), threshold: clamp(x.threshold, 0.5, 0.999, DEFAULTS.threshold),
    min_samples: Math.round(clamp(x.min_samples, 1, 1e7, DEFAULTS.min_samples)), max_days: clamp(x.max_days, 1, 365, DEFAULTS.max_days),
    arms: outArms, status: STATUSES.includes(x.status) ? x.status : 'draft',
  };
  for (const k of ['created_at', 'approved_at', 'started_at', 'stopped_at', 'rolled_out_at', 'stop_reason', 'winner', 'agent']) if (x[k] !== undefined && x[k] !== null) exp[k] = x[k];
  if (x.cost && Number(x.cost.daily) > 0) exp.cost = { daily: Number(x.cost.daily), currency: str(x.cost.currency, 3) || 'USD' };
  return errors.length ? { errors } : { experiment: exp };
}

// Owner-side guard: tests that spend money must fit the product's caps (and paid mode).
export function budgetGuard(exp, product = {}) {
  const daily = Number(exp?.cost?.daily ?? 0);
  if (!(daily > 0)) return { ok: true };
  const b = product.budget ?? {};
  if ((b.mode ?? 'free') === 'free') return { ok: false, reason: 'product is in free mode: a test with spend cannot start' };
  if (!(Number(b.daily_cap) > 0) || daily > Number(b.daily_cap)) return { ok: false, reason: `cost ${daily}/day exceeds daily_cap ${b.daily_cap ?? 0}` };
  const left = Number(b.monthly_cap ?? 0) - Number(b.spent_this_month ?? 0);
  if (daily * Math.min(30, exp.max_days ?? DEFAULTS.max_days) > left) return { ok: false, reason: `projected spend exceeds the monthly cap left (${left})` };
  return { ok: true };
}

// ------------------------------------------------------------------------------------------------
// Beacons from the edge/satellite route. Returns {event} (vid hashed) or {error}.
export function normalizeBeacon(b, now = new Date()) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: 'bad beacon' };
  const exp = str(b.exp, 40); const arm = str(b.arm, 40); const vid = str(b.vid, 80);
  const kind = str(b.kind, 12);
  if (!['exposure', 'conversion'].includes(kind)) return { error: 'kind must be exposure or conversion' };
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(vid)) return { error: 'bad visitor id' };
  if (kind === 'exposure' && (!ID.test(exp) || !ID.test(arm))) return { error: 'exposure needs exp and arm' };
  if (exp && !ID.test(exp)) return { error: 'bad exp' };
  const event = { at: (now instanceof Date ? now : new Date(now)).toISOString(), kind, vid: hashVisitor(vid) };
  if (exp) event.exp = exp;
  if (arm && ID.test(arm)) event.arm = arm;
  const v = Number(b.value); if (kind === 'conversion' && Number.isFinite(v) && v >= 0 && v < 1e9) event.value = v;
  return { event };
}

// Conversions from the funnel ledger: rows that carry a visitor id (vid / bandit_vid) and reached `stage`.
export function conversionsFromFunnel(pipeline, { stage = 'new' } = {}) {
  const STAGES = ['new', 'contacted', 'engaged', 'qualified', 'opportunity', 'won'];
  const rank = Math.max(0, STAGES.indexOf(stage));
  const rows = Array.isArray(pipeline) ? pipeline : (pipeline?.leads ?? []);
  const out = [];
  for (const r of rows) {
    const raw = str(r?.bandit_vid ?? r?.vid, 80);
    if (!raw || (r.max_rank ?? 0) < rank) continue;
    const h = (r.history ?? []).find((x) => STAGES.indexOf(x.stage) >= rank && isoOk(x.at));
    const at = h?.at ?? r.stage_at ?? r.first_seen;
    if (!isoOk(at)) continue;
    out.push({ at: new Date(at).toISOString(), kind: 'conversion', vid: /^[0-9a-f]{16}$/.test(raw) ? raw : hashVisitor(raw), source: 'funnel', ...(Number(r.value) > 0 ? { value: Number(r.value) } : {}) });
  }
  return out;
}

// Unique-visitor tallies per experiment and arm. Pure and order independent (events are sorted).
export function tally(experiments, events) {
  // Times are compared as instants, not strings, so offsets ("+02:00") and missing milliseconds sort right.
  const sorted = [...(events ?? [])].filter((e) => e && isoOk(e.at) && e.vid).map((e) => ({ ...e, t: Date.parse(e.at) }))
    .sort((a, b) => a.t - b.t || String(a.vid).localeCompare(String(b.vid)) || (a.kind === b.kind ? 0 : a.kind === 'exposure' ? -1 : 1));
  const out = {};
  for (const x of experiments) {
    const start = isoOk(x.started_at) ? Date.parse(x.started_at) : null;
    const end = isoOk(x.stopped_at) ? Date.parse(x.stopped_at) : null;
    const arms = Object.fromEntries(x.arms.map((a) => [a.id, { exposures: 0, conversions: 0, value: 0 }]));
    const assigned = new Map(); const converted = new Set();
    if (start) {
      for (const e of sorted) {
        if (e.t < start || (end !== null && e.t > end)) continue;
        if (e.kind === 'exposure' && e.exp === x.id && arms[e.arm] && !assigned.has(e.vid)) { assigned.set(e.vid, e.arm); arms[e.arm].exposures++; }
        else if (e.kind === 'conversion' && (!e.exp || e.exp === x.id) && assigned.has(e.vid) && !converted.has(e.vid)) {
          converted.add(e.vid); const a = arms[assigned.get(e.vid)]; a.conversions++; a.value = round(a.value + (Number(e.value) || 0), 2);
        }
      }
    }
    out[x.id] = arms;
  }
  return out;
}

// Posterior summary: P(best), P(beat control), 95% credible interval per arm. Seeded, so deterministic.
export function posterior(armStats, { draws = DEFAULTS.draws, seed = 1 } = {}) {
  const ids = Object.keys(armStats);
  const rng = mulberry32(seed);
  const n = Math.max(200, Math.min(200000, Math.round(draws)));
  const wins = ids.map(() => 0); const beat = ids.map(() => 0);
  const samples = ids.map(() => new Float64Array(n));
  for (let d = 0; d < n; d++) {
    let best = 0; let bestV = -1;
    const row = ids.map((id, i) => {
      const s = armStats[id];
      const v = betaSample(1 + s.conversions, 1 + Math.max(0, s.exposures - s.conversions), rng);
      samples[i][d] = v;
      if (v > bestV) { bestV = v; best = i; }
      return v;
    });
    wins[best]++;
    for (let i = 1; i < ids.length; i++) if (row[i] > row[0]) beat[i]++;
  }
  return Object.fromEntries(ids.map((id, i) => {
    const s = armStats[id]; const q = samples[i].sort();
    return [id, {
      exposures: s.exposures, conversions: s.conversions, value: s.value ?? 0,
      rate: s.exposures ? round(s.conversions / s.exposures) : 0,
      ci95: [round(q[Math.floor(0.025 * (n - 1))]), round(q[Math.floor(0.975 * (n - 1))])],
      prob_best: round(wins[i] / n), prob_beat_control: i === 0 ? null : round(beat[i] / n),
    }];
  }));
}

// Traffic weights: explore / K to every arm plus (1 - explore) split by P(best). Sums to 1.
export function allocation(exp, post) {
  const ids = exp.arms.map((a) => a.id);
  if (exp.status === 'rolled_out' && exp.winner) return Object.fromEntries(ids.map((id) => [id, id === exp.winner ? 1 : 0]));
  const k = ids.length; const e = exp.explore ?? DEFAULTS.explore;
  const w = ids.map((id) => e / k + (1 - e) * (post?.[id]?.prob_best ?? 1 / k));
  const r = w.map((x) => round(x));
  r[r.length - 1] = round(1 - r.slice(0, -1).reduce((s, x) => s + x, 0));
  return Object.fromEntries(ids.map((id, i) => [id, r[i]]));
}

export function pickByWeights(weights, u) {
  const ids = Object.keys(weights);
  let acc = 0;
  for (const id of ids) { acc += weights[id]; if (u < acc) return id; }
  return ids.at(-1);
}
// Deterministic per-visitor assignment from the allocation table (the client snippet does the same).
export const chooseArm = (exp, vid, weights) => pickByWeights(weights, hashUnit(`${exp.id}:${vid}`));
// Literal Thompson draw per visitor: exploration floor first, then the argmax of seeded posterior draws.
export function thompsonChoose(exp, vid, armStats, { explore = exp.explore ?? DEFAULTS.explore } = {}) {
  const ids = exp.arms.map((a) => a.id);
  if (hashUnit(`${exp.id}:explore:${vid}`) < explore) return ids[Math.floor(hashUnit(`${exp.id}:uniform:${vid}`) * ids.length) % ids.length];
  const rng = mulberry32(fnv1a(`${exp.id}:${vid}`));
  let best = ids[0]; let bestV = -1;
  for (const id of ids) { const s = armStats?.[id] ?? { exposures: 0, conversions: 0 }; const v = betaSample(1 + s.conversions, 1 + Math.max(0, s.exposures - s.conversions), rng); if (v > bestV) { bestV = v; best = id; } }
  return best;
}

// Stop rules. Returns {verdict: 'running'|'winner'|'inconclusive', leader, reason}.
export function decide(exp, post, now) {
  const ids = exp.arms.map((a) => a.id);
  const leader = ids.reduce((b, id) => (post[id].prob_best > post[b].prob_best ? id : b), ids[0]);
  const enough = ids.every((id) => post[id].exposures >= exp.min_samples);
  if (enough && post[leader].prob_best >= exp.threshold) return { verdict: 'winner', leader, reason: `P(best) ${post[leader].prob_best} >= ${exp.threshold} with ${exp.min_samples}+ visitors per arm` };
  const days = isoOk(exp.started_at) ? (Date.parse(now) - Date.parse(exp.started_at)) / DAY : 0;
  if (days >= exp.max_days) return { verdict: 'inconclusive', leader, reason: `max duration ${exp.max_days} days reached without a winner` };
  return { verdict: 'running', leader, reason: enough ? `P(best) ${post[leader].prob_best} below ${exp.threshold}` : `waiting for ${exp.min_samples} visitors per arm` };
}

// Approval state for a target from approvals.json (read-only).
const approvalState = (approvals, target) => {
  const list = (approvals ?? []).filter((a) => a?.target === target);
  if (list.some((a) => ['approved', 'executed'].includes(a.status))) return 'approved';
  if (list.some((a) => a.status === 'rejected')) return 'rejected';
  return list.length ? 'pending' : 'none';
};

// One full pass over a product's ledger. Pure: returns the new ledger, report, live table and proposals.
export function stepBandits(ledger, { events = [], approvals = [], product = {}, now = new Date().toISOString(), drafts = [] } = {}) {
  const doc = { version: 1, experiments: [], ...(ledger && typeof ledger === 'object' && !Array.isArray(ledger) ? ledger : {}) };
  const rejected = [];
  const list = [];
  // Ledger entries that no longer validate (a hand edit) are kept aside in `invalid`, never dropped.
  const invalid = Array.isArray(doc.invalid) ? [...doc.invalid] : [];
  for (const raw of Array.isArray(doc.experiments) ? doc.experiments : []) {
    const v = validateExperiment(raw);
    if (v.experiment && list.some((x) => x.id === v.experiment.id)) v.errors = ['duplicate id in the ledger'];
    if (v.experiment && !v.errors) list.push({ ...v.experiment, stats: raw.stats });
    else { rejected.push({ id: raw?.id ?? null, errors: v.errors }); invalid.push({ entry: raw, errors: v.errors, at: now }); }
  }
  for (const d of drafts) {
    const v = validateExperiment({ ...d, status: 'draft' });
    if (!v.experiment) { rejected.push({ id: d?.id ?? null, errors: v.errors }); continue; }
    if (list.some((x) => x.id === v.experiment.id)) { rejected.push({ id: v.experiment.id, errors: ['id already exists'] }); continue; }
    list.push({ ...v.experiment, created_at: isoOk(d.created_at) ? d.created_at : now });
  }
  const proposals = []; const results = [];
  for (const x of list) {
    if (x.status === 'draft') {
      const st = approvalState(approvals, `bandit:${x.id}:start`);
      const guard = budgetGuard(x, product);
      if (st === 'approved' && guard.ok) Object.assign(x, { status: 'running', approved_at: now, started_at: now });
      else if (st === 'rejected') Object.assign(x, { status: 'stopped', stopped_at: now, stop_reason: 'start rejected by owner' });
      else if (st === 'none' && guard.ok) {
        const spend = x.cost ? { amount: round(x.cost.daily * Math.min(30, x.max_days), 2), currency: x.cost.currency } : {};
        proposals.push({ id: approvalId(x.id, 'start'), type: 'publish', channel: 'onsite-bandit', title: `Start A/B bandit test "${x.name}" (${x.arms.length} arms on ${x.element})${x.cost ? `, up to ${spend.amount} ${spend.currency}` : ''}`, file: 'experiments/bandits.json', target: `bandit:${x.id}:start`, ...spend });
      } else if (!guard.ok) x.blocked = guard.reason;
    }
    // The owner can stop any live test at any time (approve target "bandit:<id>:stop"); the original page returns.
    if (['running', 'winner', 'rolled_out'].includes(x.status) && approvalState(approvals, `bandit:${x.id}:stop`) === 'approved') Object.assign(x, { status: 'stopped', stopped_at: x.stopped_at ?? now, stop_reason: 'stopped by owner' });
    if (x.status === 'running' && !budgetGuard(x, product).ok) Object.assign(x, { status: 'stopped', stopped_at: now, stop_reason: `budget guard: ${budgetGuard(x, product).reason}` });
  }
  const counts = tally(list, events);
  const report = { generated_at: now, experiments: [], rejected };
  const live = { generated_at: now, experiments: [] };
  for (const x of list) {
    const post = posterior(counts[x.id], { seed: fnv1a(`${x.id}:${JSON.stringify(counts[x.id])}`) });
    x.stats = Object.fromEntries(Object.entries(post).map(([id, p]) => [id, { exposures: p.exposures, conversions: p.conversions, value: p.value }]));
    if (x.status === 'running') {
      const d = decide(x, post, now);
      if (d.verdict === 'winner') { Object.assign(x, { status: 'winner', winner: d.leader, stopped_at: now, stop_reason: d.reason }); results.push({ id: `BX-${x.id}`, hypothesis: x.hypothesis || `One of ${x.arms.map((a) => a.id).join(', ')} beats the control on ${x.element}`, metric: x.metric, status: 'done', result: `winner ${d.leader}: ${post[d.leader].rate} vs control ${post[x.arms[0].id].rate}; ${d.reason}` }); }
      else if (d.verdict === 'inconclusive') { Object.assign(x, { status: 'stopped', stopped_at: now, stop_reason: d.reason }); results.push({ id: `BX-${x.id}`, hypothesis: x.hypothesis || `A variant beats the control on ${x.element}`, metric: x.metric, status: 'done', result: `inconclusive: ${d.reason}; leader ${d.leader} at P(best) ${post[d.leader].prob_best}` }); }
    }
    if (x.status === 'winner') {
      const st = approvalState(approvals, `bandit:${x.id}:rollout`);
      if (st === 'approved') Object.assign(x, { status: 'rolled_out', rolled_out_at: now });
      else if (st === 'none' && x.winner !== x.arms[0].id) proposals.push({ id: approvalId(x.id, 'rollout'), type: 'publish', channel: 'onsite-bandit', title: `Roll out winner "${x.winner}" of "${x.name}" to 100% of visitors`, file: 'experiments/bandit-report.json', target: `bandit:${x.id}:rollout` });
    }
    const alloc = ['running', 'rolled_out'].includes(x.status) ? allocation(x, post) : null;
    const control = post[x.arms[0].id];
    report.experiments.push({
      id: x.id, name: x.name, element: x.element, status: x.status, winner: x.winner ?? null, stop_reason: x.stop_reason ?? null, blocked: x.blocked ?? null,
      started_at: x.started_at ?? null, arms: x.arms.map((a) => ({ id: a.id, label: a.label, ...post[a.id], lift_vs_control: control.rate > 0 ? round(post[a.id].rate / control.rate - 1) : null })),
      allocation: alloc,
    });
    if (alloc) live.experiments.push({ id: x.id, element: x.element, page: x.page, goal: x.goal, weights: alloc, arms: x.arms.map((a) => ({ id: a.id, variant: a.variant })) });
  }
  for (const x of list) delete x.blocked;
  const ledgerOut = { ...doc, version: 1, updated_at: now, experiments: list };
  if (invalid.length) ledgerOut.invalid = invalid; else delete ledgerOut.invalid;
  return { ledger: ledgerOut, report, live, proposals, results };
}

// Resolves variant refs (files in the product folder) into values for the live table.
export function resolveLive(live, readRef = () => null) {
  return { ...live, experiments: live.experiments.map((x) => ({ ...x, arms: x.arms.map((a) => {
    const v = { ...a.variant };
    if (v.ref && v.value === undefined) { const t = readRef(v.ref); if (typeof t === 'string') v.value = t.replace(/^---[\s\S]*?---\s*/, '').trim().slice(0, 2000); }
    delete v.ref;
    // A ref file is read after validation, so the same guards run again on what it holds.
    if (v.type === 'attr' && unsafeUrl(v.value)) v.type = 'none';
    if (v.type === 'class') v.value = String(v.value ?? '').slice(0, 200).replace(/[^A-Za-z0-9_ -]/g, '');
    if (v.type === 'none') delete v.value;
    return { id: a.id, variant: v };
  }) })) };
}

export function banditMarkdown(name, report) {
  const lines = [`# A/B and bandit tests: ${name}`, '', `Updated ${report.generated_at}.`, ''];
  if (!report.experiments.length) lines.push('No experiments yet. Agents propose them in experiments/bandit-drafts/.');
  for (const x of report.experiments) {
    lines.push(`## ${x.name} (${x.id})`, '', `Status: ${x.status}${x.winner ? `, winner ${x.winner}` : ''}${x.stop_reason ? ` (${x.stop_reason})` : ''}${x.blocked ? `. Blocked: ${x.blocked}` : ''}`, '');
    lines.push('| Arm | Visitors | Conversions | Rate | 95% interval | P(best) | P(beat control) | Lift | Traffic |', '|---|---|---|---|---|---|---|---|---|');
    for (const a of x.arms) lines.push(`| ${a.label} | ${a.exposures} | ${a.conversions} | ${(a.rate * 100).toFixed(2)}% | ${(a.ci95[0] * 100).toFixed(1)}-${(a.ci95[1] * 100).toFixed(1)}% | ${a.prob_best} | ${a.prob_beat_control ?? '-'} | ${a.lift_vs_control === null ? '-' : `${(a.lift_vs_control * 100).toFixed(1)}%`} | ${x.allocation ? `${(x.allocation[a.id] * 100).toFixed(1)}%` : '-'} |`);
    lines.push('');
  }
  return lines.join('\n');
}

// ------------------------------------------------------------------------------------------------
// The client snippet the edge/satellite serves (GET /whalyom-bandit.js). Self-contained, no cookies:
// a visitor id is kept in localStorage only when window.whalyomConsent === true, otherwise it lives for
// the page view. Global Privacy Control or Do Not Track: the original page is shown and nothing is sent.
export function clientSnippet(live, { endpoint = '', site = '' } = {}) {
  const cfg = JSON.stringify({ e: String(endpoint).replace(/\/+$/, ''), s: String(site).slice(0, 60), x: (live?.experiments ?? []).map((x) => ({ id: x.id, el: x.element, p: x.page || '', g: x.goal, w: x.weights, a: x.arms })) }).replace(/</g, '\\u003c');
  return `/*! Whalyom bandit 1.0.0 | cookieless */
(function(){var C=${cfg};var n=navigator,w=window,d=document;
if(n.globalPrivacyControl||n.doNotTrack==='1')return;
function h(s){var x=0x811c9dc5;for(var i=0;i<s.length;i++){x^=s.charCodeAt(i);x=Math.imul(x,0x01000193);}return (x>>>0)/4294967296;}
function rid(){var a='',c='abcdefghijklmnopqrstuvwxyz0123456789';for(var i=0;i<20;i++)a+=c[Math.floor(Math.random()*36)];return a;}
var vid=w.whalyomVid;if(!vid){try{if(w.whalyomConsent===true){vid=localStorage.getItem('wlyb');if(!vid){vid=rid();localStorage.setItem('wlyb',vid);}}}catch(e){}}if(!vid)vid=rid();
function send(b){if(!C.e)return;b.site=C.s;b.vid=vid;var s=JSON.stringify(b);try{if(n.sendBeacon&&n.sendBeacon(C.e+'/bandit',new Blob([s],{type:'application/json'})))return;}catch(e){}try{fetch(C.e+'/bandit',{method:'POST',body:s,headers:{'content-type':'application/json'},keepalive:true});}catch(e){}}
function pick(x){var u=h(x.id+':'+vid),acc=0,k=Object.keys(x.w);for(var i=0;i<k.length;i++){acc+=x.w[k[i]];if(u<acc)return k[i];}return k[k.length-1];}
function apply(el,v){if(!v||v.type==='none')return;if(v.type==='text')el.textContent=v.value||'';else if(v.type==='class'&&v.value)el.className+=' '+v.value;else if(v.type==='hide')el.style.display='none';else if(v.type==='attr'&&v.name&&!/^(javascript|data|vbscript):/i.test(String(v.value||'').replace(/[\\u0000-\\u0020\\u007f]+/g,'')))el.setAttribute(v.name,v.value||'');}
var mine={};
C.x.forEach(function(x){if(x.p&&location.pathname!==x.p)return;var el=d.querySelector(x.el);if(!el)return;var arm=pick(x),A=null;for(var i=0;i<x.a.length;i++)if(x.a[i].id===arm)A=x.a[i];apply(el,A&&A.variant);mine[x.id]=arm;send({kind:'exposure',exp:x.id,arm:arm});
if(x.g&&x.g.selector&&(x.g.kind==='click'||x.g.kind==='submit'))d.addEventListener(x.g.kind,function(ev){var t=ev.target;if(t&&t.closest&&t.closest(x.g.selector))conv(x.id);},true);});
var done={};function conv(id,val){var ids=id?[id]:Object.keys(mine);ids.forEach(function(e){if(!mine[e]||done[e])return;done[e]=1;var b={kind:'conversion',exp:e,arm:mine[e]};if(val>=0)b.value=val;send(b);});}
w.whalyomBandit={arm:function(id){return mine[id]||null;},convert:conv,vid:function(){return vid;}};})();
`;
}

// ------------------------------------------------------------------------------------------------
// File I/O around stepBandits for one product.
const readJsonl = (f) => { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const slugOk = (s) => /^[a-z0-9][a-z0-9-]{0,60}$/.test(String(s ?? ''));

export function runBandits(slug, { now = new Date().toISOString(), base = root } = {}) {
  if (!slugOk(slug)) throw new Error(`bad product slug: ${slug}`);
  const dir = path.join(base, 'products', slug);
  if (!fs.existsSync(path.join(dir, 'product.json'))) throw new Error(`no product ${slug}`);
  const xdir = path.join(dir, 'experiments');
  fs.mkdirSync(xdir, { recursive: true });
  const product = readJson(path.join(dir, 'product.json'), {});
  const draftDir = path.join(xdir, 'bandit-drafts');
  const draftFiles = fs.existsSync(draftDir) ? fs.readdirSync(draftDir).filter((f) => f.endsWith('.json')).sort() : [];
  const drafts = draftFiles.flatMap((f) => { const j = readJson(path.join(draftDir, f), null); return Array.isArray(j) ? j : j ? [j] : []; });
  const events = [...readJsonl(path.join(xdir, 'bandit-events.jsonl')), ...conversionsFromFunnel(readJson(path.join(dir, 'funnel', 'pipeline.json'), {}))];
  const approvals = readJson(path.join(dir, 'approvals.json'), []);
  // A ledger that exists but does not parse is never overwritten (that would erase every test).
  const ledgerFile = path.join(xdir, 'bandits.json');
  const ledger = readJson(ledgerFile, undefined);
  if (ledger === undefined && fs.existsSync(ledgerFile) && fs.readFileSync(ledgerFile, 'utf8').trim()) throw new Error(`${slug}: experiments/bandits.json is not valid JSON; fix or remove it (nothing was written)`);
  const out = stepBandits(ledger ?? null, { events, approvals: Array.isArray(approvals) ? approvals : [], product, now, drafts });
  writeJson(path.join(xdir, 'bandits.json'), out.ledger);
  writeJson(path.join(xdir, 'bandit-report.json'), out.report);
  fs.writeFileSync(path.join(xdir, 'BANDITS.md'), banditMarkdown(product.name ?? slug, out.report));
  const readRef = (ref) => { const f = path.resolve(dir, ref); if (!f.startsWith(dir + path.sep)) return null; try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
  writeJson(path.join(xdir, 'bandit-live.json'), resolveLive(out.live, readRef));
  if (draftFiles.length) { fs.mkdirSync(path.join(draftDir, 'done'), { recursive: true }); for (const f of draftFiles) fs.renameSync(path.join(draftDir, f), path.join(draftDir, 'done', f)); }
  let runFile = null;
  if (out.proposals.length || out.results.length) {
    const task = `BANDIT-${now.slice(0, 10)}`;
    fs.mkdirSync(path.join(dir, 'runs'), { recursive: true });
    runFile = path.join(dir, 'runs', `${task}.json`);
    const prev = readJson(runFile, null);
    const merge = (a = [], b = [], key) => [...a, ...b.filter((x) => !a.some((y) => y[key] === x[key]))];
    writeJson(runFile, { task_id: task, agent: 'om-bandit', status: 'done', output: ['experiments/bandits.json', 'experiments/bandit-report.json', 'experiments/BANDITS.md'],
      summary: `Bandit tests: ${out.report.experiments.length} experiment(s), ${out.proposals.length} approval(s) proposed, ${out.results.length} result(s).`,
      approvals: merge(prev?.approvals, out.proposals, 'target'), experiments: merge(prev?.experiments, out.results, 'id') });
  }
  return { product: slug, experiments: out.report.experiments.length, running: out.ledger.experiments.filter((x) => x.status === 'running').length, proposals: out.proposals.length, results: out.results.length, rejected: out.report.rejected.length, run_file: runFile ? path.relative(base, runFile).replace(/\\/g, '/') : null };
}

// Dashboard summary across products (no visitor ids).
export function writeBanditState(slugs, { base = root, now = new Date().toISOString() } = {}) {
  const products = slugs.map((s) => {
    const r = readJson(path.join(base, 'products', s, 'experiments', 'bandit-report.json'), null);
    return { product: s, experiments: (r?.experiments ?? []).map((x) => ({ id: x.id, name: x.name, status: x.status, winner: x.winner, arms: x.arms.map((a) => ({ id: a.id, exposures: a.exposures, conversions: a.conversions, rate: a.rate, prob_best: a.prob_best })) })) };
  }).filter((p) => p.experiments.length);
  fs.mkdirSync(path.join(base, 'state'), { recursive: true });
  writeJson(path.join(base, 'state', 'bandits.json'), { generated_at: now, products });
  return products.length;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const now = isoOk(opt('--now')) ? new Date(opt('--now')).toISOString() : new Date().toISOString();
  try {
    if (args[0] === 'snippet') {
      const slug = args[1];
      if (!slugOk(slug)) throw new Error('usage: node tools/bandit.mjs snippet <slug> [--endpoint URL]');
      const live = readJson(path.join(root, 'products', slug, 'experiments', 'bandit-live.json'), { experiments: [] });
      process.stdout.write(clientSnippet(live, { endpoint: opt('--endpoint') ?? '', site: slug }));
    } else if (args[0] === '--all') {
      const pdir = path.join(root, 'products');
      const slugs = fs.readdirSync(pdir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_') && fs.existsSync(path.join(pdir, d.name, 'product.json'))).map((d) => d.name);
      const results = slugs.map((s) => { try { return runBandits(s, { now }); } catch (e) { return { product: s, error: e.message }; } });
      console.log(JSON.stringify({ products: results.length, with_tests: writeBanditState(slugs, { now }), results }));
    } else if (args[0] && !args[0].startsWith('-')) {
      console.log(JSON.stringify(runBandits(args[0], { now })));
    } else {
      console.error('usage: node tools/bandit.mjs <slug> | --all | snippet <slug> [--endpoint URL]');
      process.exit(2);
    }
  } catch (e) { console.error(e.message); process.exit(1); }
}
