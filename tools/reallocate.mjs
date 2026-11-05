// Automatic ad budget reallocation: proposes a new daily budget per live campaign from what each one
// returns, inside product.json budget caps. It never changes a budget itself: every change is a "spend"
// approval of kind "budget_update" (campaign, old and new daily amount) that the owner approves and the
// executor carries out through tools/connectors/budgets.mjs, which checks the live caps again.
//   reads   products/<slug>/product.json, metrics/kpis.json, funnel/report.json, approvals.json,
//           killswitch.json, ledger.jsonl
//   writes  products/<slug>/reports/reallocation.json   the plan (stats, scores, old -> new per campaign)
//           products/<slug>/runs/REALLOC-<date>.json     approvals + experiment, merged by apply-results.mjs
// Rule (a bandit with probability matching):
//   * Per campaign over the last `days` (14): spend from kpis; leads, sales and revenue from server-side
//     kpis rows (never 'client_conversions' or satellite rows) or the funnel's per-campaign counts (the larger,
//     never the sum). Cost per lead, cost per sale and ROAS are reported per campaign and channel.
//   * Objective: ROAS when the north star is revenue and revenue exists, else sales per spend, else leads per
//     spend. Each campaign's rate gets a Gamma(1 + results, prior_spend + spend) posterior; a seeded Monte
//     Carlo gives P(best). Weight = explore / K + (1 - explore) * P(best), explore clamped to 10-20% (15%).
//   * Minimum data before money moves: spend >= min_spend (max(20, 2 x goals.cpa_max)) over >= min_days (3)
//     days with spend. Other campaigns keep their budget ("learning").
//   * Pool: the eligible campaigns' current daily total (grow_to_cap: true lets it rise to the cap room),
//     never above min(daily_cap, (monthly_cap - spent) / days left) minus the other live campaigns.
//   * Each campaign moves at most max_change (20%) per day; residual money is water-filled to campaigns
//     that are not at a limit. Only when the caps themselves shrank below the floor are cuts deeper (caps win).
//   * No proposal for a campaign that already has a budget_update waiting or created today, a killed
//     campaign, a free-mode product, or a change below max(0.5, 2%).
// Options: product.json budget.reallocate {explore, min_spend, min_days, max_change, days, grow_to_cap, min_daily}.
// Personal data: only campaign-level numbers; no lead rows are read.
// Usage: node tools/reallocate.mjs <slug> [--now ISO] [--dry-run]
//        node tools/reallocate.mjs --all [--now ISO] [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, root } from './lib/env.mjs';
import { spentThisMonth, daysLeftInMonth } from './budget.mjs';
import { platformOf, isBudgetUpdate, liveCommittedDaily, MAX_CHANGE } from './connectors/budgets.mjs';

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const floor2 = (n) => Math.floor(Number(n) * 100 + 1e-6) / 100;
const ratio = (a, b) => (b > 0 && a != null ? round2(a / b) : null);
const keyOf = (channel, campaign) => `${platformOf(channel) ?? String(channel ?? '').toLowerCase()}|${String(campaign ?? '')}`;
const LEAD_METRICS = new Set(['leads', 'lead', 'signups', 'conversions']);
const SALE_METRICS = new Set(['sales', 'purchases', 'orders', 'won']);
const serverSide = (r) => r?.source !== 'satellite' && r?.metric !== 'client_conversions';
export const approvalId = (channel, campaign, day) => `A-BUDGET-${platformOf(channel) ?? channel}-${String(campaign).replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 60)}-${day}`;

export function options(product = {}) {
  const o = product.budget?.reallocate ?? {};
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
  return {
    explore: Math.min(0.2, Math.max(0.1, num(o.explore, 0.15))),
    min_spend: Math.max(0, num(o.min_spend, Math.max(20, 2 * num(product.goals?.cpa_max, 0)))),
    min_days: Math.max(1, num(o.min_days, 3)),
    max_change: Math.min(MAX_CHANGE, Math.max(0, num(o.max_change, MAX_CHANGE))), // never above 20%
    days: Math.max(1, num(o.days, 14)),
    grow_to_cap: o.grow_to_cap === true,
    min_daily: Math.max(0, num(o.min_daily, 1)),
  };
}

// Per-campaign stats from kpis rows {date, channel, campaign, metric, value, source?} and funnel campaigns.
export function campaignStats(kpis = [], { now = new Date().toISOString(), days = 14, funnel = null } = {}) {
  const since = new Date(Date.parse(now) - days * 86400000).toISOString().slice(0, 10);
  const out = {};
  const get = (ch, c) => (out[keyOf(ch, c)] ??= { channel: String(ch), platform: platformOf(ch), campaign: String(c), spend: 0, leads: 0, sales: 0, revenue: 0, days: new Set(), daily_budget: null, budget_date: '' });
  for (const r of kpis) {
    if (!r?.campaign || !r.channel || String(r.date ?? '') < since || String(r.date ?? '') > now.slice(0, 10)) continue;
    const s = get(r.channel, r.campaign); const v = Math.max(0, Number(r.value) || 0); const m = String(r.metric ?? '');
    if (m === 'spend' && v > 0) { s.spend += v; s.days.add(String(r.date)); }
    else if (m === 'daily_budget' && v > 0 && String(r.date) >= s.budget_date) { s.daily_budget = v; s.budget_date = String(r.date); }
    else if (!serverSide(r)) continue;
    else if (LEAD_METRICS.has(m)) s.leads += v;
    else if (SALE_METRICS.has(m)) s.sales += v;
    else if (m === 'revenue') s.revenue += v;
  }
  // Funnel counts (leads that carried a campaign, sales won): the larger of kpis and funnel, never both.
  for (const f of Array.isArray(funnel?.campaigns) ? funnel.campaigns : []) {
    const s = out[keyOf(f?.channel, f?.campaign)];
    if (!s) continue;
    s.leads = Math.max(s.leads, Number(f.leads) || 0); s.sales = Math.max(s.sales, Number(f.won) || 0); s.revenue = Math.max(s.revenue, Number(f.revenue) || 0);
  }
  return Object.values(out).map((s) => ({
    channel: s.channel, platform: s.platform, campaign: s.campaign, spend: round2(s.spend), leads: s.leads, sales: s.sales, revenue: round2(s.revenue),
    data_days: s.days.size, daily_budget: s.daily_budget, cpl: s.leads ? ratio(s.spend, s.leads) : null, cps: s.sales ? ratio(s.spend, s.sales) : null, roas: s.spend ? ratio(s.revenue, s.spend) : null,
  }));
}

// Channel totals for the report (cost per lead, cost per sale, ROAS).
export function channelStats(stats) {
  const by = {};
  for (const s of stats) { const c = (by[s.channel] ??= { channel: s.channel, spend: 0, leads: 0, sales: 0, revenue: 0 }); c.spend += s.spend; c.leads += s.leads; c.sales += s.sales; c.revenue += s.revenue; }
  return Object.values(by).map((c) => ({ ...c, spend: round2(c.spend), revenue: round2(c.revenue), cpl: c.leads ? ratio(c.spend, c.leads) : null, cps: c.sales ? ratio(c.spend, c.sales) : null, roas: c.spend ? ratio(c.revenue, c.spend) : null }));
}

// Seeded PRNG and Gamma sampler (Marsaglia-Tsang), so the same inputs give the same plan.
function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const seedOf = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
function gamma(shape, rnd) {
  if (shape < 1) return gamma(shape + 1, rnd) * Math.pow(rnd() || 1e-12, 1 / shape);
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { const u1 = rnd() || 1e-12, u2 = rnd(); x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); v = 1 + c * x; } while (v <= 0);
    v = v * v * v; const u = rnd();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u || 1e-12) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function objectiveOf(product, stats) {
  if (String(product?.goals?.north_star ?? 'revenue') === 'revenue' && stats.some((s) => s.revenue > 0)) return 'roas';
  if (stats.some((s) => s.sales > 0)) return 'sales';
  return 'leads';
}

// P(best) per campaign under a Gamma-Poisson model of results per unit spent.
export function probBest(stats, { objective = 'leads', seed = 1, draws = 4000, priorSpend = 10 } = {}) {
  if (!stats.length) return [];
  const totalSales = stats.reduce((a, s) => a + s.sales, 0), totalRev = stats.reduce((a, s) => a + s.revenue, 0);
  const aov = objective === 'roas' ? (totalSales > 0 ? totalRev / totalSales : Math.max(1, totalRev / Math.max(1, stats.length))) : 1;
  const count = (s) => (objective === 'roas' ? s.revenue / aov : objective === 'sales' ? s.sales : s.leads);
  const rnd = mulberry32(seed);
  const wins = stats.map(() => 0);
  for (let d = 0; d < draws; d++) {
    let best = -1, bi = 0;
    stats.forEach((s, i) => { const x = gamma(1 + count(s), rnd) / (priorSpend + s.spend); if (x > best) { best = x; bi = i; } });
    wins[bi]++;
  }
  return wins.map((w) => w / draws);
}

// Water-filling inside [lo, hi] per campaign so the total is the pool (or less when every one is at hi).
export function fitToPool(targets, lo, hi, pool, weights) {
  const n = targets.length; const x = targets.map((t, i) => Math.min(hi[i], Math.max(lo[i], t)));
  for (let it = 0; it < 20; it++) {
    const diff = pool - x.reduce((a, b) => a + b, 0);
    if (Math.abs(diff) < 0.005) break;
    const free = [...Array(n).keys()].filter((i) => (diff > 0 ? x[i] < hi[i] - 1e-9 : x[i] > lo[i] + 1e-9));
    if (!free.length) break;
    const wsum = free.reduce((a, i) => a + (weights[i] || 1e-9), 0);
    for (const i of free) x[i] = Math.min(hi[i], Math.max(lo[i], x[i] + diff * ((weights[i] || 1e-9) / wsum)));
  }
  const sum = x.reduce((a, b) => a + b, 0);
  if (sum > pool + 0.005 && sum > 0) return { values: x.map((v) => v * (pool / sum)), capped: true }; // caps win over the change limit
  return { values: x, capped: false };
}

// Live campaigns known from approvals: creating spend items (executed) and their latest budget_update.
export function liveCampaigns(approvals = [], killed = []) {
  const killedKeys = new Set(killed.map((k) => keyOf(k.channel, k.campaign)));
  const live = {};
  const isLive = (a) => ['executed', 'live'].includes(a.status) && !a.paused_at && !a.ended_at && !['paused', 'ended'].includes(a.campaign_status);
  for (const a of approvals.filter((x) => x?.type === 'spend' && !isBudgetUpdate(x) && isLive(x) && x.result_ref)) {
    const campaign = String(a.campaign ?? a.result_ref);
    const k = keyOf(a.channel, campaign);
    if (killedKeys.has(k) || killedKeys.has(keyOf(a.channel, String(a.result_ref).split('/')[0]))) continue;
    live[k] = { channel: a.channel, campaign, ref: String(a.result_ref), source_approval: a.id, daily: Number(a.committed_daily ?? a.amount ?? 0), aliases: [campaign, String(a.result_ref), String(a.result_ref).split('/')[0]] };
  }
  const updates = approvals.filter((x) => isBudgetUpdate(x) && isLive(x)).sort((a, b) => String(a.executed_at ?? '').localeCompare(String(b.executed_at ?? '')));
  for (const u of updates) {
    const hit = Object.values(live).find((l) => platformOf(l.channel) === platformOf(u.channel) && l.aliases.includes(String(u.campaign)));
    if (hit) hit.daily = Number(u.new_daily ?? hit.daily);
  }
  return Object.values(live);
}

// The whole plan. Pure: returns {plan, proposals, experiments}.
export function planReallocation({ product = {}, kpis = [], funnel = null, approvals = [], killed = [], spent = 0, now = new Date().toISOString(), slug = '' } = {}) {
  const o = options(product); const day = now.slice(0, 10); const b = product.budget ?? {};
  const currency = b.currency ?? 'USD';
  const stats = campaignStats(kpis, { now, days: o.days, funnel });
  const base = { generated_at: now, product: slug, currency, options: o, channels: channelStats(stats), campaigns: [], changes: [], notes: [] };
  if ((b.mode ?? 'free') === 'free') return { plan: { ...base, notes: ['free mode: no ad budget to reallocate'] }, proposals: [], experiments: [] };
  const live = liveCampaigns(approvals, killed);
  const killedKeys = new Set(killed.map((k) => keyOf(k.channel, k.campaign)));
  const waiting = new Set(approvals.filter((a) => isBudgetUpdate(a) && (['pending', 'approved', 'executing', 'approved-manual'].includes(a.status) || String(a.created_at ?? '').startsWith(day))).map((a) => keyOf(a.channel, a.campaign)));

  const rows = [];
  for (const l of live) {
    const s = stats.find((x) => x.platform === platformOf(l.channel) && l.aliases.includes(x.campaign)) ?? { channel: l.channel, platform: platformOf(l.channel), campaign: l.campaign, spend: 0, leads: 0, sales: 0, revenue: 0, data_days: 0, daily_budget: null, cpl: null, cps: null, roas: null };
    const old = Number(s.daily_budget ?? l.daily ?? 0);
    let hold = '';
    if (!s.platform) hold = 'no budget connector for this channel';
    else if (killedKeys.has(keyOf(l.channel, l.campaign))) hold = 'paused by the kill switch';
    else if (waiting.has(keyOf(l.channel, l.campaign))) hold = 'a budget change is already waiting or was made today';
    else if (!(old > 0)) hold = 'current daily budget unknown';
    else if (s.spend < o.min_spend || s.data_days < o.min_days) hold = `learning: ${s.spend} spent over ${s.data_days} day(s), needs ${o.min_spend} over ${o.min_days}`;
    rows.push({ ...s, campaign: l.campaign, ref: l.ref, source_approval: l.source_approval, old_daily: round2(old), hold });
  }
  const eligible = rows.filter((r) => !r.hold);
  const heldDaily = round2(liveCommittedDaily({ approvals, killed }) - eligible.reduce((a, r) => a + r.old_daily, 0));
  const daysLeft = daysLeftInMonth(now);
  const capRoom = Math.max(0, Math.min(Number(b.daily_cap ?? 0), (Number(b.monthly_cap ?? 0) - spent) / daysLeft) - Math.max(0, heldDaily));
  const current = eligible.reduce((a, r) => a + r.old_daily, 0);
  const pool = floor2(Math.max(0, o.grow_to_cap ? capRoom : Math.min(current, capRoom)));
  const objective = objectiveOf(product, eligible);
  const p = probBest(eligible, { objective, seed: seedOf(`${slug}|${day}`) });
  const K = eligible.length;
  const weights = p.map((x) => o.explore / K + (1 - o.explore) * x);
  const lo = eligible.map((r) => Math.max(o.min_daily, r.old_daily * (1 - o.max_change)));
  const hi = eligible.map((r) => r.old_daily * (1 + o.max_change));
  const fit = K ? fitToPool(weights.map((w) => w * pool), lo, hi, pool, weights) : { values: [], capped: false };
  const proposals = []; const changes = [];
  eligible.forEach((r, i) => {
    let nd = floor2(fit.values[i]);
    if (nd > r.old_daily) nd = Math.min(nd, floor2(r.old_daily * (1 + o.max_change)));
    r.prob_best = round2(p[i]); r.weight = round2(weights[i]); r.new_daily = nd;
    if (Math.abs(nd - r.old_daily) < Math.max(0.5, r.old_daily * 0.02) || !(nd > 0)) { r.hold = 'change too small'; return; }
    const id = approvalId(r.channel, r.campaign, day);
    const why = `${objective === 'roas' ? `ROAS ${r.roas ?? 0}` : objective === 'sales' ? `cost per sale ${r.cps ?? 'none yet'}` : `cost per lead ${r.cpl ?? 'none yet'}`}, P(best) ${r.prob_best}`;
    const change = { approval_id: id, channel: r.channel, campaign: r.campaign, ref: r.ref, source_approval: r.source_approval, old_daily: r.old_daily, new_daily: nd, delta: round2(nd - r.old_daily), currency, reason: why };
    changes.push(change);
    proposals.push({ id, type: 'spend', kind: 'budget_update', channel: r.channel, campaign: r.campaign, ref: r.ref, source_approval: r.source_approval, old_daily: r.old_daily, new_daily: nd, amount: nd, currency,
      target: `budget:${platformOf(r.channel)}:${r.campaign}`, file: 'reports/reallocation.json',
      title: `${nd > r.old_daily ? 'Raise' : 'Lower'} ${r.channel} campaign "${r.campaign}" daily budget ${r.old_daily} -> ${nd} ${currency} (${why})` });
  });
  const experiments = changes.length ? [{ id: `EXP-REALLOC-${day}`, hypothesis: `Moving daily budget toward the campaigns with the best ${objective === 'roas' ? 'ROAS' : objective === 'sales' ? 'cost per sale' : 'cost per lead'} improves it across ${K} campaign(s)`, metric: objective === 'roas' ? 'roas' : objective === 'sales' ? 'cost_per_sale' : 'cost_per_lead', status: 'running', result: null }] : [];
  if (fit.capped) base.notes.push('the caps are below the 20% floor: every eligible campaign is cut in proportion');
  if (!K) base.notes.push('no campaign has enough data to move money yet');
  return { plan: { ...base, objective, pool, cap_room: round2(capRoom), held_daily: Math.max(0, heldDaily), campaigns: rows, changes }, proposals, experiments };
}

// One product: reads its files, writes the plan and (when there are changes) a run file for apply-results.
export function runReallocate(slug, { base = root, now = new Date().toISOString(), dryRun = false } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(slug ?? ''))) throw new Error(`bad product slug: ${slug}`);
  const dir = path.join(base, 'products', slug);
  if (!fs.existsSync(path.join(dir, 'product.json'))) throw new Error(`no product ${slug}`);
  const arr = (v) => (Array.isArray(v) ? v : []);
  const { plan, proposals, experiments } = planReallocation({
    slug, now, product: readJson(path.join(dir, 'product.json'), {}), kpis: arr(readJson(path.join(dir, 'metrics', 'kpis.json'), [])),
    funnel: readJson(path.join(dir, 'funnel', 'report.json'), null), approvals: arr(readJson(path.join(dir, 'approvals.json'), [])),
    killed: arr(readJson(path.join(dir, 'killswitch.json'), [])), spent: spentThisMonth(path.join(dir, 'ledger.jsonl'), now),
  });
  let runFile = null;
  if (!dryRun) {
    fs.mkdirSync(path.join(dir, 'reports'), { recursive: true });
    writeJson(path.join(dir, 'reports', 'reallocation.json'), plan);
    if (proposals.length) {
      const task = `REALLOC-${now.slice(0, 10)}`;
      fs.mkdirSync(path.join(dir, 'runs'), { recursive: true });
      runFile = path.join(dir, 'runs', `${task}.json`);
      writeJson(runFile, { task_id: task, agent: 'om-budget-allocator', status: 'done', output: ['reports/reallocation.json'],
        summary: `Budget reallocation: ${proposals.length} budget change(s) proposed (${plan.objective}, pool ${plan.pool} ${plan.currency}/day).`, approvals: proposals, experiments });
    }
  }
  return { product: slug, objective: plan.objective ?? null, pool: plan.pool ?? 0, proposals: proposals.length, held: plan.campaigns.filter((c) => c.hold).length, notes: plan.notes, run_file: runFile ? path.relative(base, runFile).replace(/\\/g, '/') : null };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--now');
  const now = i >= 0 && !Number.isNaN(Date.parse(args[i + 1])) ? new Date(args[i + 1]).toISOString() : new Date().toISOString();
  const dryRun = args.includes('--dry-run');
  try {
    if (args[0] === '--all') {
      const slugs = fs.readdirSync(path.join(root, 'products')).filter((s) => !s.startsWith('_') && fs.existsSync(path.join(root, 'products', s, 'product.json')));
      console.log(JSON.stringify(slugs.map((s) => runReallocate(s, { now, dryRun }))));
    } else if (args[0] && !args[0].startsWith('--')) console.log(JSON.stringify(runReallocate(args[0], { now, dryRun })));
    else { console.error('Usage: node tools/reallocate.mjs <slug>|--all [--now ISO] [--dry-run]'); process.exit(2); }
  } catch (e) { console.error(String(e.message ?? e)); process.exit(1); }
}
