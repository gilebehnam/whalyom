// Operating modes: Economy, Balanced, Aggressive. A mode decides how Whalyom spends AI tokens: which Claude
// model each agent runs on, how many reviewers check each draft, which workflows the hub runs how often,
// whether every lead or only hot leads get an AI reply, and a hard monthly AI budget. All AI work runs on
// Claude Platform through WHALYOM_ANTHROPIC_API_KEY (tools/lib/claude-run.mjs), never the Claude Code
// subscription. The deterministic tools (funnel, scoring, sequences, policy, executor, reports) cost nothing.
//   config/ai-modes.json      the modes, the planning cost per agent run, leads per month
//   state/ai-schedule.json    when each workflow last ran per product
//   state/ai-spend.jsonl      the estimated cost of every headless run (the budget guard reads it)
// Usage:
//   node tools/ai-modes.mjs plan                 setup and monthly cost of each mode for one product
//   node tools/ai-modes.mjs set <mode>           switch mode: writes config/ai-cost.json, rebuilds agents
//   node tools/ai-modes.mjs status               mode, this month's AI spend and budget left
//   node tools/ai-modes.mjs schedule [--now ISO] queue the workflows due now (the daemon runs this)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, root, loadEnv } from './lib/env.mjs';

const CONFIG = path.join(root, 'config', 'ai-modes.json');
export const loadModes = (file = CONFIG) => readJson(file, null) ?? { mode: 'economy', modes: {}, cost_per_agent_run: { haiku: 0.02, sonnet: 0.27, opus: 0.55 }, leads_per_month: 50 };

// Agent runs per workflow run, by role. mech: mechanical steps (always Haiku); spec: specialists; head:
// department heads; guard: reviewers and checkers. r = reviewers per draft, n = channels or articles.
export const MIX = {
  // Lean runs (r = 1) review every draft of the run in one pass instead of one review per channel or lead.
  'om-free-growth': (r, n = 6) => ({ mech: 9, spec: 3 + n, head: 1, guard: r === 1 ? 2 : n * r + 1 }),
  'om-lead-to-sale': (r) => (r === 1 ? { mech: 1, spec: 2, head: 0, guard: 0.2 } : { mech: 1, spec: 5, head: 0, guard: r }), // per lead; a lean run reviews ~5 leads at once
  'om-seo-sprint': (r, n = 4) => ({ mech: 6, spec: 3 + 3 * n, head: 0, guard: n * r + 1 }),
  'om-cro-loop': () => ({ mech: 4, spec: 5, head: 0, guard: 3 }),
  'om-content-engine': (r) => ({ mech: 5, spec: 10, head: 0, guard: 2 * r + 1 }),
  'om-competitor-watch': (r) => ({ mech: 4, spec: 4, head: 0, guard: r + 1 }),
  'om-weekly-retro': () => ({ mech: 3, spec: 4, head: 0, guard: 0 }),
  'om-knowledge-refresh': () => ({ mech: 6, spec: 6, head: 0, guard: 2 }),
  'om-evolve': () => ({ mech: 6, spec: 6, head: 0, guard: 4 }),
  'om-mega-sweep': () => ({ mech: 4, spec: 0, head: 24, guard: 2 }),
  'om-product-evolution': () => ({ mech: 5, spec: 2, head: 1, guard: 3 }),
  'om-onboard': () => ({ mech: 8, spec: 14, head: 2, guard: 3 }),
};
// Which model each role runs on in a tier (tools/lib/ai-cost.mjs). In minimal only the compliance guard
// (an override) is on Sonnet, so the first reviewer of each draft is Sonnet and the rest Haiku.
const ROLE_MODEL = {
  max: { spec: 'sonnet', head: 'opus', guard: 'sonnet' },
  standard: { spec: 'sonnet', head: 'sonnet', guard: 'sonnet' },
  economy: { spec: 'haiku', head: 'sonnet', guard: 'sonnet' },
  minimal: { spec: 'haiku', head: 'haiku', guard: 'haiku' },
};

const flowArgN = (flow, args = {}) => Number(args.max_channels ?? args.articles ?? args.assets ?? 0) || undefined;

// Planning cost of one workflow run in a mode (USD).
export function runCost(flow, mode, cfg = loadModes(), args = {}) {
  const m = cfg.modes[mode];
  const price = cfg.cost_per_agent_run;
  const roles = ROLE_MODEL[m.tier] ?? ROLE_MODEL.economy;
  const r = Number(m.reviewers) || 1;
  const mix = (MIX[flow] ?? (() => ({ mech: 5, spec: 5, head: 0, guard: r })))(r, flowArgN(flow, args));
  // Copy agents the mode puts on Sonnet (overrides): about 40% of specialist runs in a growth workflow.
  const sonnetShare = roles.spec === 'haiku' && Object.values(m.overrides ?? {}).filter((x) => x === 'sonnet').length > 3 ? 0.4 : 0;
  const spec = mix.spec * ((1 - sonnetShare) * price[roles.spec] + sonnetShare * price.sonnet);
  // Guards: the compliance check stays on Sonnet in every mode (override in minimal).
  const guard = mix.guard === 0 ? 0 : roles.guard === 'haiku' ? (mix.guard / r) * price.sonnet + (mix.guard - mix.guard / r) * price.haiku : mix.guard * price[roles.guard];
  return Math.round((mix.mech * price.haiku + spec + mix.head * price[roles.head] + guard) * 100) / 100;
}

// Setup (once per product) and monthly cost of a mode for one product, with the per-workflow breakdown.
export function estimate(mode, cfg = loadModes()) {
  const m = cfg.modes[mode];
  if (!m) throw new Error(`unknown mode ${mode}`);
  const rows = Object.entries(m.flows ?? {}).map(([flow, f]) => ({ flow, per_month: f.per_month, per_run: runCost(flow, mode, cfg, f.args), monthly: Math.round(runCost(flow, mode, cfg, f.args) * f.per_month * 100) / 100 }));
  const SHARE = { hot: 0.2, warm: 0.5, all: 1 };
  const replied = Math.round((cfg.leads_per_month ?? 50) * (SHARE[m.reply] ?? 1));
  const perLead = runCost('om-lead-to-sale', mode, cfg);
  rows.push({ flow: `lead replies (${replied} of ${cfg.leads_per_month ?? 50} leads, ${m.reply === 'all' ? 'every lead' : `${m.reply === 'hot' ? 'hot' : 'hot and warm'} leads; the rest by templates`})`, per_month: replied, per_run: perLead, monthly: Math.round(perLead * replied * 100) / 100 });
  const monthly = Math.round(rows.reduce((s, x) => s + x.monthly, 0) * 100) / 100;
  const setup = Math.round((runCost('om-onboard', mode, cfg) + runCost('om-free-growth', mode, cfg, m.flows?.['om-free-growth']?.args)) * 100) / 100;
  const range = (x) => [Math.round(x * 0.65 * 100) / 100, Math.round(x * 1.35 * 100) / 100];
  return { mode, label: m.label, tier: m.tier, reviewers: m.reviewers, reply: m.reply, budget: m.monthly_budget_usd, setup, setup_range: range(setup), monthly, monthly_range: range(monthly), rows };
}

// ── Spend ledger and budget guard ──────────────────────────────────────────
const SPEND = path.join(root, 'state', 'ai-spend.jsonl');
export function monthSpend(now = new Date().toISOString(), file = SPEND) {
  const month = now.slice(0, 7);
  let total = 0;
  try { for (const l of fs.readFileSync(file, 'utf8').split(/\r?\n/)) { if (!l.trim()) continue; try { const x = JSON.parse(l); if (String(x.at).startsWith(month)) total += Number(x.usd) || 0; } catch { /* skip */ } } } catch { /* none yet */ }
  return Math.round(total * 100) / 100;
}
export function recordSpend({ kind, slug, flow, usd, outcome, real = false, tokens = null, now = new Date().toISOString() }, file = SPEND) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ at: now, kind, slug: slug ?? null, flow: flow ?? null, usd: Math.round((Number(usd) || 0) * 10000) / 10000, outcome: outcome ?? null, estimate: !real, ...(tokens ? { tokens } : {}) }) + '\n');
  if (file === SPEND) { try { writeUsageState({ now }); } catch { /* the view is rebuilt on the next schedule */ } }
}

// The AI usage view (state/live-ai.json, streamed to the Command Center): mode, budget, spend this
// month (real where the run reported it), by product and by workflow, tokens, and the last runs.
export function usageSummary({ now = new Date().toISOString(), cfg = loadModes(), file = SPEND } = {}) {
  const month = now.slice(0, 7);
  const rows = [];
  try { for (const l of fs.readFileSync(file, 'utf8').split(/\r?\n/)) { if (!l.trim()) continue; try { const x = JSON.parse(l); if (String(x.at).startsWith(month)) rows.push(x); } catch { /* skip */ } } } catch { /* none yet */ }
  const sum = (xs) => Math.round(xs.reduce((s, x) => s + (Number(x.usd) || 0), 0) * 100) / 100;
  const group = (key) => Object.entries(rows.reduce((m, x) => { const k = x[key] ?? x.kind ?? 'other'; (m[k] ??= []).push(x); return m; }, {})).map(([k, xs]) => ({ name: k, runs: xs.length, usd: sum(xs) })).sort((a, b) => b.usd - a.usd);
  const m = cfg.modes[cfg.mode] ?? {};
  const budget = totalBudget(cfg);
  const spent = sum(rows);
  const tokens = rows.reduce((t, x) => ({ input: t.input + (x.tokens?.input ?? 0), output: t.output + (x.tokens?.output ?? 0), cache_read: t.cache_read + (x.tokens?.cache_read ?? 0) }), { input: 0, output: 0, cache_read: 0 });
  const day = Number(now.slice(8, 10)) || 1;
  return {
    updated_at: now, month, mode: cfg.mode, label: m.label ?? cfg.mode, budget_usd: budget, spent_usd: spent, left_usd: Math.round((budget - spent) * 100) / 100,
    used_pct: budget > 0 ? Math.round((100 * spent) / budget) : null, projected_usd: Math.round((spent / day) * 30 * 100) / 100,
    real_share_pct: rows.length ? Math.round((100 * rows.filter((x) => !x.estimate).length) / rows.length) : null,
    runs: rows.length, tokens, by_product: group('slug'), by_workflow: group('flow'),
    plan: (() => { try { const e = estimate(cfg.mode, cfg); return { setup_usd: e.setup, monthly_usd: e.monthly }; } catch { return null; } })(),
    platform_key: Boolean(String(process.env.WHALYOM_ANTHROPIC_API_KEY ?? '').trim()),
    last: rows.slice(-8).reverse().map((x) => ({ at: x.at, slug: x.slug, what: x.flow ?? x.kind, usd: x.usd, real: !x.estimate, outcome: x.outcome })),
  };
}
export function writeUsageState({ now = new Date().toISOString() } = {}) {
  const v = usageSummary({ now });
  fs.mkdirSync(path.join(root, 'state'), { recursive: true });
  fs.writeFileSync(path.join(root, 'state', 'live-ai.json'), JSON.stringify(v));
  return v;
}
// Per-product mode: a customer's product carries the mode it paid for in product.json (ai_mode, written by
// the online app, tools/cloud/web.mjs). Products without one run on the installation's mode.
export function productMode(slug, cfg = loadModes(), dir = path.join(root, 'products')) {
  const p = slug ? readJson(path.join(dir, slug, 'product.json'), null) : null;
  return p?.ai_mode && cfg.modes?.[p.ai_mode] ? p.ai_mode : cfg.mode;
}
// The month's AI budget: OM_AI_MONTHLY_BUDGET_USD if set, else the installation mode's budget plus the
// budget of every active product that carries its own paid mode (each customer pays for its share).
export function totalBudget(cfg = loadModes(), env = process.env, dir = path.join(root, 'products')) {
  if (env.OM_AI_MONTHLY_BUDGET_USD != null && String(env.OM_AI_MONTHLY_BUDGET_USD).trim() !== '') return Number(env.OM_AI_MONTHLY_BUDGET_USD);
  let sum = Number(cfg.modes?.[cfg.mode]?.monthly_budget_usd ?? 0);
  for (const s of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (s.startsWith('_')) continue;
    const p = readJson(path.join(dir, s, 'product.json'), null);
    if (p?.ai_mode && cfg.modes?.[p.ai_mode] && p.stage !== 'paused') sum += Number(cfg.modes[p.ai_mode].monthly_budget_usd ?? 0);
  }
  return Math.round(sum * 100) / 100;
}
// Whether a run of `usd` fits this month's budget (totalBudget above, or OM_AI_MONTHLY_BUDGET_USD).
export function canSpend(usd, { now = new Date().toISOString(), cfg = loadModes(), env = process.env, file = SPEND } = {}) {
  const budget = totalBudget(cfg, env);
  const spent = monthSpend(now, file);
  return { ok: budget > 0 && spent + usd <= budget, budget, spent, left: Math.round((budget - spent) * 100) / 100 };
}
// Estimated cost of one hub job (the hub records it after the run).
export function jobCost(job, cfg = loadModes()) {
  const mode = job.mode && cfg.modes?.[job.mode] ? job.mode : productMode(job.slug, cfg);
  if (job.kind === 'onboard') return runCost('om-onboard', mode, cfg);
  if (job.kind === 'respond') return runCost('om-lead-to-sale', mode, cfg) * Math.max(1, Math.min(10, Number(job.leads) || 1));
  if (job.kind === 'flow') return runCost(job.flow, mode, cfg, job.args);
  return 0;
}

// ── Scheduling: which workflows are due, queued for the hub ────────────────
const SCHEDULE = path.join(root, 'state', 'ai-schedule.json');
export function dueFlows({ products, cfg = loadModes(), last = {}, now = new Date().toISOString(), modeOf = () => cfg.mode }) {
  const out = [];
  for (const slug of products) {
    const mode = modeOf(slug);
    const m = cfg.modes[mode];
    if (!m) continue;
    for (const [flow, f] of Object.entries(m.flows ?? {})) {
      const every = (30 * 86400000) / Math.max(1, Number(f.per_month) || 1);
      const prev = last[`${slug}|${flow}`];
      if (!prev || Date.parse(now) - Date.parse(prev) >= every) out.push({ slug, flow, mode, args: f.args ?? {}, usd: runCost(flow, mode, cfg, f.args) });
    }
  }
  // Cheapest and most revenue-relevant first: growth, then the rest.
  return out.sort((a, b) => (a.flow === 'om-free-growth' ? -1 : 0) - (b.flow === 'om-free-growth' ? -1 : 0) || a.usd - b.usd);
}

export function schedule({ now = new Date().toISOString(), env = process.env } = {}) {
  const cfg = loadModes();
  const pdir = path.join(root, 'products');
  const products = (fs.existsSync(pdir) ? fs.readdirSync(pdir) : []).filter((s) => {
    if (s.startsWith('_') || s.startsWith('zz-')) return false;
    const p = readJson(path.join(pdir, s, 'product.json'), null);
    return p && p.stage !== 'paused' && String(p.domain ?? '').trim();
  });
  const last = readJson(SCHEDULE, {});
  const q = path.join(root, 'state', 'queue');
  const queued = []; const skipped = [];
  let planned = 0;
  for (const d of dueFlows({ products, cfg, last, now, modeOf: (s) => productMode(s, cfg) })) {
    const file = path.join(q, `flow-${d.slug}--${d.flow}.json`);
    if (fs.existsSync(file) || fs.existsSync(`${file}.running`)) continue;
    const c = canSpend(planned + d.usd, { now, cfg, env });
    if (!c.ok) { skipped.push({ ...d, why: `budget: ${c.spent} of ${c.budget} USD spent this month` }); continue; }
    fs.mkdirSync(q, { recursive: true });
    writeJson(file, { slug: d.slug, flow: d.flow, args: { ...d.args, reviewers: cfg.modes[d.mode].reviewers }, usd: d.usd, at: now, mode: d.mode });
    last[`${d.slug}|${d.flow}`] = now;
    planned += d.usd;
    queued.push(`${d.slug}:${d.flow}`);
  }
  writeJson(SCHEDULE, last);
  try { writeUsageState({ now }); } catch { /* view only */ }
  return { mode: cfg.mode, queued, skipped: skipped.map((s) => `${s.slug}:${s.flow} (${s.why})`), spent_this_month: monthSpend(now) };
}

// Switch mode: config/ai-cost.json (models) follows the mode, then the agent files are rebuilt.
export function setMode(mode) {
  const cfg = loadModes();
  if (!cfg.modes[mode]) throw new Error(`unknown mode ${mode}; choose ${Object.keys(cfg.modes).join(', ')}`);
  cfg.mode = mode;
  writeJson(CONFIG, cfg);
  const costFile = path.join(root, 'config', 'ai-cost.json');
  const cost = readJson(costFile, {});
  writeJson(costFile, { ...cost, tier: cfg.modes[mode].tier, overrides: cfg.modes[mode].overrides ?? {} });
  const r = spawnSync(process.execPath, [path.join(root, 'tools', 'build-agents.mjs')], { cwd: root, encoding: 'utf8' });
  return { mode, built: (r.stdout ?? '').trim().split(/\r?\n/).slice(-1)[0] ?? '' };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  loadEnv();
  const [cmd, arg] = process.argv.slice(2);
  const i = process.argv.indexOf('--now');
  const now = i > -1 ? process.argv[i + 1] : new Date().toISOString();
  const cfg = loadModes();
  if (cmd === 'plan' || !cmd) {
    for (const mode of Object.keys(cfg.modes)) {
      const e = estimate(mode, cfg);
      console.log(`\n${e.label}${mode === cfg.mode ? ' (current)' : ''}: setup ~$${e.setup} (${e.setup_range.join('–')}), then ~$${e.monthly}/month (${e.monthly_range.join('–')}); hard budget $${e.budget}/month`);
      for (const r of e.rows) console.log(`  ${r.flow}: ${r.per_month}×/month × $${r.per_run} = $${r.monthly}`);
    }
  } else if (cmd === 'set') console.log(JSON.stringify(setMode(arg)));
  else if (cmd === 'status' || cmd === 'usage') console.log(JSON.stringify(writeUsageState({ now }), null, cmd === 'usage' ? 2 : 0));
  else if (cmd === 'schedule') console.log(JSON.stringify(schedule({ now })));
  else { console.error('Usage: node tools/ai-modes.mjs plan | set <mode> | status | schedule [--now ISO]'); process.exit(2); }
}
