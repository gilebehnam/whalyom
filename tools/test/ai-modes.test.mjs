// Operating modes: three modes with a setup and monthly cost per product, a hard monthly AI budget the
// scheduler and the hub respect, lean (batched) reviews in the cheaper modes, and headless runs that bill
// Claude Platform only, never the Claude Code subscription.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { estimate, runCost, canSpend, recordSpend, monthSpend, dueFlows, loadModes } from '../ai-modes.mjs';
import { platformEnv } from '../lib/claude-run.mjs';
import { nextQueueJob } from '../lib/queue.mjs';
import { createIgniter } from '../lib/hub.mjs';

const cfg = loadModes();

test('three modes, each cheaper per month than the next, every budget covers its own plan', () => {
  assert.deepEqual(Object.keys(cfg.modes), ['economy', 'balanced', 'aggressive']);
  const e = Object.fromEntries(Object.keys(cfg.modes).map((m) => [m, estimate(m, cfg)]));
  assert.ok(e.economy.monthly < e.balanced.monthly && e.balanced.monthly < e.aggressive.monthly);
  assert.ok(e.economy.setup < e.balanced.setup && e.balanced.setup <= e.aggressive.setup);
  for (const m of Object.values(e)) assert.ok(m.budget >= m.monthly, `${m.mode}: budget ${m.budget} covers ~${m.monthly}`);
  assert.ok(e.economy.monthly < 10, `economy stays under $10/month (${e.economy.monthly})`);
});

test('lean runs review a whole batch once, so a lead costs far less in economy than with three reviewers', () => {
  const lean = runCost('om-lead-to-sale', 'economy', cfg);
  const full = runCost('om-lead-to-sale', 'economy', { ...cfg, modes: { ...cfg.modes, economy: { ...cfg.modes.economy, reviewers: 3 } } });
  assert.ok(lean * 3 < full, `${lean} vs ${full}`);
});

test('budget guard: spend is booked per run and new runs stop at the monthly budget', () => {
  const file = path.join(os.tmpdir(), `om-spend-${process.pid}.jsonl`);
  try {
    const now = '2026-11-05T10:00:00Z';
    const c = { ...cfg, mode: 'economy', modes: { ...cfg.modes, economy: { ...cfg.modes.economy, monthly_budget_usd: 1 } } };
    assert.ok(canSpend(0.5, { now, cfg: c, env: {}, file }).ok);
    recordSpend({ kind: 'flow', slug: 'a', flow: 'om-free-growth', usd: 0.8, now }, file);
    recordSpend({ kind: 'flow', slug: 'a', flow: 'om-free-growth', usd: 5, now: '2026-10-30T10:00:00Z' }, file);
    assert.equal(monthSpend(now, file), 0.8, 'only this month counts');
    assert.equal(canSpend(0.5, { now, cfg: c, env: {}, file }).ok, false);
  } finally { fs.rmSync(file, { force: true }); }
});

test('the scheduler spaces each workflow by its monthly count', () => {
  const now = '2026-11-05T10:00:00Z';
  const first = dueFlows({ products: ['a'], cfg, last: {}, now });
  assert.ok(first.some((d) => d.flow === 'om-free-growth'));
  const last = Object.fromEntries(first.map((d) => [`a|${d.flow}`, now]));
  assert.equal(dueFlows({ products: ['a'], cfg, last, now: '2026-11-06T10:00:00Z' }).length, 0, 'nothing is due again the next day');
});

test('headless runs bill Claude Platform: the Platform key replaces the subscription, no key means no run', () => {
  const env = platformEnv({ WHALYOM_ANTHROPIC_API_KEY: 'sk-platform', ANTHROPIC_AUTH_TOKEN: 'subscription-token', PATH: 'x' });
  assert.equal(env.ANTHROPIC_API_KEY, 'sk-platform');
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.throws(() => platformEnv({ PATH: 'x' }), /WHALYOM_ANTHROPIC_API_KEY/);
  assert.ok(platformEnv({ OM_ALLOW_SUBSCRIPTION: '1' }));
});

test('the hub runs scheduled flows after onboardings and replies, and waits when the budget is spent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-flowq-'));
  const queueDir = path.join(dir, 'queue'); fs.mkdirSync(queueDir);
  try {
    fs.writeFileSync(path.join(queueDir, 'flow-shop--om-free-growth.json'), JSON.stringify({ slug: 'shop', flow: 'om-free-growth', args: { reviewers: 1 } }));
    const job = nextQueueJob({ queueDir, productsDir: dir });
    assert.deepEqual([job.kind, job.slug, job.flow], ['flow', 'shop', 'om-free-growth']);
    const lines = [];
    const ig = createIgniter({ root: dir, queueDir, productsDir: dir, stateDir: dir, log: (m) => lines.push(m), canSpend: () => ({ ok: false, spent: 6, budget: 6, left: 0 }), recordSpend: () => {}, runClaude: () => { throw new Error('must not start'); } });
    assert.equal(ig.igniteNext(), null);
    assert.ok(fs.existsSync(path.join(queueDir, 'flow-shop--om-free-growth.json')), 'the job waits in the queue');
    assert.ok(lines.some((l) => /AI budget/.test(l)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a customer product runs on the mode it paid for and adds its budget to the month', async () => {
  const { productMode, totalBudget, dueFlows } = await import('../ai-modes.mjs');
  const fsx = await import('node:fs'); const osx = await import('node:os'); const px = await import('node:path');
  const dir = fsx.mkdtempSync(px.join(osx.tmpdir(), 'om-modes-'));
  const put = (slug, p) => { fsx.mkdirSync(px.join(dir, slug)); fsx.writeFileSync(px.join(dir, slug, 'product.json'), JSON.stringify(p)); };
  put('own', { stage: 'launch' }); put('cust-a', { stage: 'launch', ai_mode: 'aggressive' }); put('cust-b', { stage: 'paused', ai_mode: 'balanced' });
  const cfg = { mode: 'economy', modes: { economy: { monthly_budget_usd: 6, reviewers: 1, flows: { 'om-weekly-retro': { per_month: 1 } } }, balanced: { monthly_budget_usd: 33, flows: {} }, aggressive: { monthly_budget_usd: 91, reviewers: 1, flows: { 'om-free-growth': { per_month: 8 } } } }, cost_per_agent_run: { haiku: 0.02, sonnet: 0.27, opus: 0.55 } };
  assert.equal(productMode('own', cfg, dir), 'economy');
  assert.equal(productMode('cust-a', cfg, dir), 'aggressive');
  assert.equal(totalBudget(cfg, {}, dir), 6 + 91, 'paused products add nothing');
  assert.equal(totalBudget(cfg, { OM_AI_MONTHLY_BUDGET_USD: '50' }, dir), 50);
  const due = dueFlows({ products: ['own', 'cust-a'], cfg, modeOf: (s) => productMode(s, cfg, dir) });
  assert.deepEqual(due.map((d) => `${d.slug}:${d.flow}:${d.mode}`).sort(), ['cust-a:om-free-growth:aggressive', 'own:om-weekly-retro:economy']);
  fsx.rmSync(dir, { recursive: true, force: true });
});
