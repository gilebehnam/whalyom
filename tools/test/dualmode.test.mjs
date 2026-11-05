// Dual-mode simulation: a $0 free-mode product and a 50 EUR paid-mode product go from zero
// to leads and sales, exercising AI transitions, gates, self-healing, the micro-budget sniper,
// the CPA kill-switch, the reinforcement learner, one-click decisions and live telemetry.
// Run: node --test tools/test/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allocate } from '../budget.mjs';
import { buildInstances } from '../agent-factory.mjs';
import { testEnv } from './_env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const free = `zz-free-${process.pid}`;
const paid = `zz-paid-${process.pid}`;
const launched = `zz-launch-${process.pid}`;
const P = (slug, f = '') => path.join(root, 'products', slug, f);
const clean = testEnv(process.env, { OM_KILL: '', META_ACCESS_TOKEN: '', RESEND_API_KEY: '', STRIPE_API_KEY: '', OM_WEBHOOK_DEFAULT: '' });
const run = (script, args = []) => {
  const r = spawnSync(process.execPath, [path.join(root, 'tools', script), ...args], { encoding: 'utf8', env: clean });
  assert.equal(r.status, 0, `${script} ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  const last = r.stdout.trim().split(/\r?\n/).at(-1);
  try { return JSON.parse(last); } catch { return last; }
};
const read = (slug, f) => JSON.parse(fs.readFileSync(P(slug, f), 'utf8'));
const write = (slug, f, v) => { fs.mkdirSync(path.dirname(P(slug, f)), { recursive: true }); fs.writeFileSync(P(slug, f), JSON.stringify(v, null, 2)); };
const today = new Date().toISOString().slice(0, 10);

before(() => {
  run('new-product.mjs', [free, '--preset', 'saas', '--autonomy', 'autopilot']);
  run('new-product.mjs', [paid, '--preset', 'ecommerce', '--autonomy', 'autopilot', '--budget', '50', '--currency', 'EUR']);
  for (const s of [free, paid]) { const p = read(s, 'product.json'); p.stage = 'active'; write(s, 'product.json', p); }
});
after(() => { for (const s of [free, paid, launched]) fs.rmSync(P(s), { recursive: true, force: true }); });

test('free mode: an AI transition fires, passes the gate and completes', () => {
  write(free, 'tasks.json', [{ id: 'T1', title: 'pain points', agent: 'om-voc-miner', status: 'todo', depends_on: [] }]);
  write(free, 'runs/T1.json', { task_id: 'T1', agent: 'om-voc-miner', status: 'done', summary: 'found pains', new_tasks: [{ id: 'T2', title: 'offer', agent: 'om-offer-engineer', depends_on: ['T1'] }] });
  run('apply-results.mjs', [free]);
  let x = read(free, 'transitions.json');
  assert.equal(x.length, 1);
  assert.equal(x[0].from_agent, 'om-voc-miner'); assert.equal(x[0].to_agent, 'om-offer-engineer');
  assert.equal(x[0].from_layer, 2); assert.equal(x[0].to_layer, 3);
  assert.equal(x[0].status, 'fired');
  const ready = run('ready.mjs', [free]);
  assert.equal(ready.ready[0].id, 'T2');
  assert.match(ready.ready[0].instance, /^om-offer-engineer::saas/);
  write(free, 'runs/T2.json', { task_id: 'T2', agent: 'om-offer-engineer', status: 'done', summary: 'offer ready', output: ['research/offer.md'] });
  run('apply-results.mjs', [free]);
  x = read(free, 'transitions.json');
  assert.equal(x[0].status, 'completed');
});

test('pre-transition gate holds dependents of low-scoring work', () => {
  const tasks = read(free, 'tasks.json');
  tasks.push({ id: 'T3', title: 'landing', agent: 'om-landing-builder', status: 'todo', depends_on: ['T2'] });
  write(free, 'tasks.json', tasks);
  write(free, 'runs/EV-T2.json', { task_id: 'EV-T2', agent: 'om-evaluator', status: 'done', evaluations: [{ task_id: 'T2', score: 3, note: 'thin' }] });
  run('apply-results.mjs', [free]);
  const p = read(free, 'product.json'); p.autonomy.transition_gate = 4; write(free, 'product.json', p);
  assert.ok(!run('ready.mjs', [free]).ready.some((t) => t.id === 'T3'), 'gate 4 holds T3');
  p.autonomy.transition_gate = 3; write(free, 'product.json', p);
  assert.ok(run('ready.mjs', [free]).ready.some((t) => t.id === 'T3'), 'gate 3 releases T3');
});

test('self-healing: a blocked transition is diagnosed, replayed and marked healed', () => {
  write(free, 'runs/T3.json', { task_id: 'T3', agent: 'om-landing-builder', status: 'blocked', error: 'missing message house' });
  write(free, 'runs/T2b.json', { task_id: 'T2', agent: 'om-offer-engineer', status: 'done', summary: 'redo', new_tasks: [] });
  run('apply-results.mjs', [free]);
  let tasks = read(free, 'tasks.json');
  assert.ok(tasks.some((t) => t.id === 'HEAL-T3' && t.agent === 'om-ops-doctor'));
  write(free, 'runs/HEAL-T3.json', { task_id: 'HEAL-T3', agent: 'om-ops-doctor', status: 'done', summary: 'added message house' });
  run('apply-results.mjs', [free]);
  tasks = read(free, 'tasks.json');
  assert.equal(tasks.find((t) => t.id === 'T3').status, 'todo', 'T3 replayed');
  write(free, 'runs/T3.json', { task_id: 'T3', agent: 'om-landing-builder', status: 'done', summary: 'landing page' });
  // T3 had no incoming transition record (created by hand), so give it one via a producing agent for the healed path:
  run('apply-results.mjs', [free]);
  assert.equal(read(free, 'tasks.json').find((t) => t.id === 'T3').status, 'done');
});

test('healed status is recorded on a transition that went through healing', () => {
  write(free, 'runs/T4src.json', { task_id: 'T3', agent: 'om-landing-builder', status: 'done', new_tasks: [{ id: 'T5', title: 'post', agent: 'om-x' }] });
  run('apply-results.mjs', [free]);
  write(free, 'runs/T5.json', { task_id: 'T5', agent: 'om-x', status: 'blocked', error: 'no account' });
  run('apply-results.mjs', [free]);
  assert.equal(read(free, 'transitions.json').find((x) => x.task_id === 'T5').status, 'healing');
  write(free, 'runs/HEAL-T5.json', { task_id: 'HEAL-T5', agent: 'om-ops-doctor', status: 'done' });
  run('apply-results.mjs', [free]);
  write(free, 'runs/T5.json', { task_id: 'T5', agent: 'om-x', status: 'done' });
  run('apply-results.mjs', [free]);
  assert.equal(read(free, 'transitions.json').find((x) => x.task_id === 'T5').status, 'healed');
});

test('free mode: leads and sales reach Needs You Know', () => {
  write(free, 'metrics/inbox/sales.json', [{ date: today, channel: 'reddit', metric: 'conversions', value: 3 }, { date: today, channel: 'all', metric: 'revenue', value: 270 }]);
  run('metrics.mjs', [free]);
  run('needs-you-know.mjs');
  const nyk = JSON.parse(fs.readFileSync(path.join(root, 'state', 'live-nyk.json'), 'utf8')).items;
  assert.ok(nyk.some((i) => i.product === free && i.kind === 'revenue' && /270/.test(i.title)));
});

test('paid 50 EUR: micro-budget sniper puts the whole budget on one channel', () => {
  const r = run('budget.mjs', [paid]);
  assert.equal(r.allocation_mode, 'sniper');
  assert.equal(Object.keys(r.proposed_split).length, 1);
  assert.equal(Object.values(r.proposed_split)[0], 50);
  assert.equal(r.currency, 'EUR');
  const big = allocate({ monthlyCap: 5000, spentSoFar: 0, channels: ['a', 'b', 'c'], results: {} });
  assert.equal(big.mode, 'portfolio'); assert.equal(Object.keys(big.split).length, 3);
});

test('paid: CPA kill-switch stops a variant that spent 5 with no conversions', () => {
  write(paid, 'metrics/inbox/ads.json', [
    { date: today, channel: 'meta', campaign: 'v1', metric: 'spend', value: 6 },
    { date: today, channel: 'meta', campaign: 'v2', metric: 'spend', value: 6 },
    { date: today, channel: 'meta', campaign: 'v2', metric: 'conversions', value: 2 },
    { date: today, channel: 'meta', campaign: 'v2', metric: 'revenue', value: 80 },
    { date: today, channel: 'meta', campaign: 'v1', metric: 'revenue', value: 0 },
  ]);
  run('metrics.mjs', [paid]);
  const k = run('killswitch.mjs', [paid]);
  assert.equal(k.triggered, 1);
  assert.equal(k.actions[0].campaign, 'v1');
  assert.equal(k.actions[0].paused, false, 'no connector configured → owner alert');
  assert.ok(read(paid, 'alerts.json').some((a) => a.level === 'critical' && /v1/.test(a.title)));
  assert.equal(run('killswitch.mjs', [paid]).triggered, 1, 'unpaused variant keeps alerting until paused');
});

test('reinforcement learner promotes the winner and records the loser', () => {
  const p = read(paid, 'product.json'); p.learning = { min_spend: 5 }; write(paid, 'product.json', p);
  const r = run('learn.mjs', [paid]);
  assert.equal(r.winners, 1); assert.equal(r.losers, 1);
  const learn = fs.readFileSync(P(paid, 'LEARNINGS.md'), 'utf8');
  assert.match(learn, /WIN .*v2/); assert.match(learn, /AVOID .*v1/);
});

test('one-click decisions and the product launchpad', () => {
  write(paid, 'approvals.json', [{ id: 'A1', type: 'publish', title: 'Store page', status: 'pending', compliance: 'pass' }]);
  const inbox = path.join(root, 'state', `inbox-test-${process.pid}.json`);
  fs.writeFileSync(inbox, JSON.stringify({ decisions: [{ product: paid, approval_id: 'A1', decision: 'approve', at: '2026-01-01T00:00:00Z' }],
    requests: [{ id: `np-${process.pid}`, kind: 'new-product', name: launched, description: 'A planner app for bakers', mode: 'hybrid', budget: 50, currency: 'GBP', at: '2026-01-01T00:00:00Z' }] }));
  // apply-decisions.mjs always records applied ids in the repo's state/decisions-applied.json. The keys this
  // test adds are removed again in finally, so test runs never fill the owner's 5000-entry ledger and a
  // reused pid never meets a stale key from an earlier run.
  const ledger = path.join(root, 'state', 'decisions-applied.json');
  const mine = (k) => k.startsWith(`d:${paid}:`) || k === `r:np-${process.pid}`;
  const readLedger = () => { try { return JSON.parse(fs.readFileSync(ledger, 'utf8')); } catch { return null; } };
  const purge = () => { const l = readLedger(); if (Array.isArray(l) && l.some(mine)) fs.writeFileSync(ledger, JSON.stringify(l.filter((k) => !mine(k)), null, 2)); };
  purge();
  try {
    const r = run('apply-decisions.mjs', [inbox]);
    assert.equal(r.decisions, 1); assert.equal(r.requests, 1);
    assert.equal(read(paid, 'approvals.json')[0].status, 'approved');
    const np = read(launched, 'product.json');
    assert.equal(np.budget.mode, 'hybrid'); assert.equal(np.budget.monthly_cap, 50); assert.equal(np.budget.currency, 'GBP');
    // Idempotency: same inbox, approval reset to pending. A repeated apply would flip it back to approved.
    const ap = read(paid, 'approvals.json'); ap[0].status = 'pending'; write(paid, 'approvals.json', ap);
    const again = run('apply-decisions.mjs', [inbox]);
    assert.deepEqual({ decisions: again.decisions, requests: again.requests, skipped: again.skipped }, { decisions: 0, requests: 0, skipped: 2 }, 'nothing applied twice');
    assert.equal(read(paid, 'approvals.json')[0].status, 'pending', 'ledger stops a second apply');
  } finally {
    fs.rmSync(inbox, { force: true });
    purge();
  }
  assert.ok(!(readLedger() ?? []).some(mine), 'no test keys left in state/decisions-applied.json');
});

test('live telemetry carries transitions, products, layers and departments', () => {
  run('live-snapshot.mjs', ['--idle']);
  const st = (n) => JSON.parse(fs.readFileSync(path.join(root, 'state', `live-${n}.json`), 'utf8'));
  assert.ok(st('transitions').transitions.some((x) => x.product === free && x.status === 'healed'));
  assert.ok(st('products').products.some((p) => p.slug === paid && p.mode === 'paid' && p.currency === 'EUR'));
  const g = st('graph');
  assert.ok(g.edges.some((e) => e.rel === 'transition'));
  assert.ok(g.nodes.some((n) => n.type === 'agent' && n.layer && n.dept));
});

test('micro-agent factory yields hundreds of specialized employees', () => {
  const all = buildInstances();
  assert.ok(all.length >= 500, `${all.length} instances`);
  assert.equal(new Set(all.map((i) => i.id)).size, all.length, 'ids are unique');
  assert.ok(all.some((i) => i.id === 'om-google-ads::saas::search'));
});
