// End-to-end tests for the OM ledger pipeline. Run: node --test tools/test/
// Each test works in a throwaway product folder (products/zz-test-*) that is removed afterwards.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allocate } from '../budget.mjs';
import { testEnv } from './_env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const slug = `zz-test-${process.pid}`;
const dir = path.join(root, 'products', slug);
const run = (script, args = [], env = {}) => {
  const r = spawnSync(process.execPath, [path.join(root, 'tools', script), ...args], { encoding: 'utf8', env: testEnv(process.env, { OM_KILL: '', ...env }) });
  assert.equal(r.status, 0, `${script} failed: ${r.stderr || r.stdout}`);
  const last = r.stdout.trim().split(/\r?\n/).at(-1);
  try { return JSON.parse(last); } catch { return last; }
};
// Async variant: the in-process HTTP test server can only answer while the event loop is free.
const runAsync = (script, args = [], env = {}) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(root, 'tools', script), ...args], { env: testEnv(process.env, { OM_KILL: '', ...env }) });
  let out = '', err = '';
  child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (err += d));
  child.on('close', (code) => {
    if (code !== 0) return reject(new Error(`${script} failed: ${err || out}`));
    const last = out.trim().split(/\r?\n/).at(-1);
    try { resolve(JSON.parse(last)); } catch { resolve(last); }
  });
});
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const write = (f, v) => fs.writeFileSync(path.join(dir, f), typeof v === 'string' ? v : JSON.stringify(v, null, 2));

let server; let received = [];
before(async () => {
  run('new-product.mjs', [slug, '--preset', 'saas', '--autonomy', 'autopilot', '--budget', '60', '--domain', 'zz-test.example']);
  server = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { received.push(JSON.parse(b)); res.end('ok'); }); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
});
after(() => { server?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('new product takes preset, autonomy and budget', () => {
  const p = read('product.json');
  assert.equal(p.preset, 'saas');
  assert.equal(p.goals.north_star, 'MRR');
  assert.equal(p.autonomy.level, 'autopilot');
  assert.equal(p.budget.monthly_cap, 60);
  assert.equal(p.budget.daily_cap, 2);
});

test('apply-results merges tasks, approvals, alerts and rejects unknown agents', () => {
  write('tasks.json', [{ id: 'T1', title: 'x', agent: 'om-writer', status: 'todo', depends_on: [] }]);
  write('runs/T1.start', { task_id: 'T1', agent: 'om-writer', doing: 'writing', started_at: '2026-01-01T00:00:00Z' });
  write('runs/T1.json', { task_id: 'T1', agent: 'om-writer', status: 'done', summary: 'wrote it',
    approvals: [{ type: 'post', channel: 'x', title: 'Launch thread', file: 'outbox/x.md' }],
    new_tasks: [{ title: 'edit', agent: 'om-editor', depends_on: ['T1'] }, { title: 'bad', agent: 'om-nobody' }],
    alerts: [{ level: 'decision', title: 'Pick a launch date' }] });
  const s = run('apply-results.mjs', [slug, '--now', '2026-01-01T01:00:00Z']);
  assert.equal(s.tasks, 1); assert.equal(s.approvals, 1); assert.equal(s.new_tasks, 1); assert.equal(s.rejected.length, 1);
  const tasks = read('tasks.json');
  assert.equal(tasks.find((t) => t.id === 'T1').status, 'done');
  assert.equal(tasks.length, 2);
  assert.ok(!fs.existsSync(path.join(dir, 'runs', 'T1.start')), 'heartbeat removed');
  assert.equal(read('alerts.json')[0].title, 'Pick a launch date');
  const ready = run('ready.mjs', [slug]);
  assert.deepEqual(ready.ready.map((t) => t.agent), ['om-editor']);
});

test('policy auto-approves only what passed review and the level allows', () => {
  const ap = read('approvals.json');
  ap[0].compliance = 'pass';
  ap.push({ id: 'A2', type: 'outreach', title: 'Cold email', compliance: 'pass', status: 'pending' });
  ap.push({ id: 'A3', type: 'post', title: 'Blocked post', compliance: 'block', status: 'pending' });
  ap.push({ id: 'A4', type: 'spend', channel: 'meta', title: 'Too much', amount: 5, compliance: 'pass', status: 'pending' });
  write('approvals.json', ap);
  const p = read('product.json'); p.autonomy.auto_spend_per_day = 2; write('product.json', p);
  const r = run('policy.mjs', [slug]);
  const d = Object.fromEntries(r.decisions.map((x) => [x.id, x.decision]));
  assert.equal(d.A1, 'auto');      // post at autopilot
  assert.equal(d.A2, 'owner');     // outreach needs the owner at autopilot
  assert.equal(d.A3, 'owner');     // blocked by review
  assert.equal(d.A4, 'owner');     // over the automatic spend limit
});

test('executor sends approved items through the webhook and marks them executed', async () => {
  received = [];
  const url = `http://127.0.0.1:${server.address().port}/hook`;
  fs.mkdirSync(path.join(dir, 'outbox'), { recursive: true });
  write('outbox/x.md', 'Launch day thread');
  const r = await runAsync('execute.mjs', [slug], { OM_WEBHOOK_DEFAULT: url });
  assert.equal(r.executed, 1, JSON.stringify(r));
  const a1 = read('approvals.json').find((a) => a.id === 'A1');
  assert.equal(a1.status, 'executed');
  assert.equal(a1.executed_by, 'webhook');
  assert.equal(received.length, 1);
  assert.equal(received[0].content, 'Launch day thread');
  assert.equal(received[0].product, slug);
});

test('executor writes manual steps when no connector is configured, and holds spend over the cap', () => {
  const ap = read('approvals.json');
  ap.push({ id: 'A5', type: 'post', channel: 'linkedin', title: 'Founder post', file: 'outbox/x.md', compliance: 'pass', status: 'approved' });
  ap.push({ id: 'A6', type: 'spend', channel: 'meta', title: 'Big test', amount: 100, file: 'outbox/x.md', compliance: 'pass', status: 'approved' });
  write('approvals.json', ap);
  const env = Object.fromEntries(Object.keys(process.env).filter((k) => k.startsWith('OM_WEBHOOK_')).map((k) => [k, '']));
  run('execute.mjs', [slug], env);
  const after = Object.fromEntries(read('approvals.json').map((a) => [a.id, a]));
  assert.equal(after.A5.status, 'approved', 'no connector: stays approved so a later run with the key executes it');
  assert.equal(after.A5.waiting_for, 'connector key');
  assert.ok(!fs.existsSync(path.join(dir, 'outbox', 'manual', 'A5.md')));
  assert.equal(after.A6.status, 'pending');
  assert.match(after.A6.review_notes, /held by executor/);
});

test('kill switch stops the executor', () => {
  const r = run('execute.mjs', [slug], { OM_KILL: '1' });
  assert.match(r.skipped, /kill switch/);
});

test('budget ledger and allocator', () => {
  const r = run('budget.mjs', [slug, '--record', '12.5', 'google_search']);
  assert.equal(r.spent_this_month, 12.5);
  assert.equal(r.left, 47.5);
  const results = { a: { spend: 50, conversions: 10 }, b: { spend: 50, conversions: 0 } };
  const plan = allocate({ monthlyCap: 1000, spentSoFar: 0, channels: ['a', 'b'], results });
  assert.equal(plan.mode, 'portfolio');
  assert.ok(plan.split.a > plan.split.b, 'better channel gets more');
  assert.ok(plan.split.b > 0, 'exploration keeps the weaker channel alive');
  assert.ok(Math.abs(plan.split.a + plan.split.b - 1000) < 0.05);
  const small = allocate({ monthlyCap: 100, spentSoFar: 0, channels: ['a', 'b'], results });
  assert.deepEqual(small, { left: 100, split: { a: 100 }, mode: 'sniper' }, 'micro-budget goes to the best channel only');
});

test('needs-you-know ranks owner items and live snapshot builds a graph', () => {
  run('needs-you-know.mjs');
  const nyk = JSON.parse(fs.readFileSync(path.join(root, 'state', 'live-nyk.json'), 'utf8')).items.filter((i) => i.product === slug);
  assert.ok(nyk.some((i) => i.title === 'Pick a launch date'));
  run('live-snapshot.mjs', ['--idle']);
  const g = JSON.parse(fs.readFileSync(path.join(root, 'state', 'live-graph.json'), 'utf8'));
  assert.ok(g.nodes.some((n) => n.id === `p:${slug}`));
  assert.ok(g.edges.some((e) => e.rel === 'unblocks' && e.to.startsWith(`t:${slug}:`)));
});

test('metrics import from a CSV drop', () => {
  fs.mkdirSync(path.join(dir, 'metrics', 'inbox'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'metrics', 'inbox', 'ga4.csv'), 'date,channel,metric,value\n2026-01-01,organic,sessions,120\n2026-01-01,organic,conversions,4\n');
  const r = run('metrics.mjs', [slug], { STRIPE_API_KEY: '' });
  assert.equal(r.rows_in, 2);
  assert.equal(read('metrics/kpis.json').find((k) => k.metric === 'conversions').value, 4);
});

test('policy never auto-approves outward actions for a paused product or one without a domain', () => {
  const p = read('product.json');
  const ap = read('approvals.json');
  ap.push({ id: 'A90', type: 'post', title: 'Guarded post', compliance: 'pass', status: 'pending' });
  write('approvals.json', ap);
  for (const [over, why] of [[{ stage: 'paused' }, /paused/], [{ domain: '' }, /domain/]]) {
    write('product.json', { ...p, ...over });
    const d = run('policy.mjs', [slug]).decisions.find((x) => x.id === 'A90');
    assert.equal(d.decision, 'owner');
    assert.match(d.why, why);
  }
  write('product.json', p);
});
