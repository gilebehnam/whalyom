// Spend caps across live campaigns, the per-product executor lock, the scheduler lease, and the
// no-connector path (audit items 3, 9, 10, 11, 28). No network: only a local HTTP server.
// Run: node --test tools/test/spend-guard.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { committedDaily, checkSpendCaps, spentThisMonth, daysLeftInMonth, kpiSpendByDay, isServerSideRow } from '../budget.mjs';
import { tryLock, acquireLock, takeLease, releaseLease, holdsLease } from '../lib/lock.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const slug = `zz-guard-${process.pid}`;
const dir = path.join(root, 'products', slug);
const P = (f = '') => path.join(dir, f);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-guard-'));
const leaseFile = path.join(tmp, 'scheduler.json');
// No connector keys at all, a private lease file, and no lock wait.
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(META_|RESEND_|OM_WEBHOOK_|OM_SITE_REPO|STRIPE_|OM_KILL|GOOGLE_|MSADS_|MASTODON_|TIKTOK_|LINKEDIN_|REDDIT_|X_|APPLE_|OM_ADS_CSV|OM_SCHEDULER|BLUESKY_|TELEGRAM_|DISCORD_|SLACK_|BUFFER_|DEVTO_|HASHNODE_|MEDIUM_|WP_|GHOST_|MAILCHIMP_|BREVO_|KIT_|INDEXNOW_)/.test(k))),
  OM_SCHEDULER_FILE: leaseFile, OM_EXECUTE_LOCK_WAIT_MS: '0', OM_KNOWLEDGE_OFFLINE: '1', OM_NO_DOTENV: '1',
};
const lastJson = (s) => { const l = s.trim().split(/\r?\n/).at(-1); try { return JSON.parse(l); } catch { return l; } };
const run = (script, args = [], extra = {}) => {
  const r = spawnSync(process.execPath, [path.join(root, 'tools', script), ...args], { encoding: 'utf8', env: { ...env, ...extra }, cwd: root });
  assert.equal(r.status, 0, `${script}: ${r.stderr || r.stdout}`);
  return lastJson(r.stdout);
};
const runAsync = (script, args = [], extra = {}) => new Promise((resolve, reject) => {
  const c = spawn(process.execPath, [path.join(root, 'tools', script), ...args], { env: { ...env, ...extra }, cwd: root });
  let out = '', err = '';
  c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (err += d));
  c.on('close', (code) => (code === 0 ? resolve(lastJson(out)) : reject(new Error(err || out))));
});
const readJ = (f) => JSON.parse(fs.readFileSync(P(f), 'utf8'));
const writeJ = (f, v) => fs.writeFileSync(P(f), JSON.stringify(v, null, 2));
const byId = () => Object.fromEntries(readJ('approvals.json').map((a) => [a.id, a]));
const NOW = '2026-11-04T12:00:00.000Z'; // 27 days left in November, today included

before(() => {
  run('new-product.mjs', [slug, '--name', 'Guard Test', '--budget', '1000', '--domain', 'guard.example']);
  const p = readJ('product.json');
  p.budget = { ...p.budget, mode: 'paid', monthly_cap: 1000, daily_cap: 10 };
  writeJ('product.json', p);
  fs.mkdirSync(P('outbox'), { recursive: true });
  fs.writeFileSync(P('outbox/post.md'), 'Hello');
});
after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(tmp, { recursive: true, force: true }); });

// ── Item 3: caps across every live campaign ──
test('committedDaily sums live spend items and skips paused, killed and non-spend ones', () => {
  const approvals = [
    { id: 'S1', type: 'spend', status: 'executed', committed_daily: 4 },
    { id: 'S2', type: 'spend', status: 'executed', result_ref: 'c2/as2' },      // from the ledger row
    { id: 'S3', type: 'spend', status: 'executed', committed_daily: 9, paused_at: '2026-11-01' },
    { id: 'S4', type: 'spend', status: 'executed', committed_daily: 9, result_ref: 'k1/x', channel: 'meta' }, // kill-switched
    { id: 'S5', type: 'spend', status: 'executing', amount: 2 },                // in flight: counts its amount
    { id: 'S6', type: 'spend', status: 'pending', amount: 50 },
    { id: 'P1', type: 'post', status: 'executed', committed_daily: 99 },
  ];
  const ledger = [{ kind: 'committed_daily', approval: 'S2', amount: 3 }];
  const killed = [{ channel: 'meta', campaign: 'k1' }];
  assert.equal(committedDaily({ approvals, ledger, killed }), 9);
  assert.equal(committedDaily({ approvals, ledger, killed, excludeId: 'S1' }), 5);
});

test('checkSpendCaps refuses an item when the daily total of live campaigns would pass daily_cap', () => {
  const live = [{ id: 'S1', type: 'spend', status: 'executed', committed_daily: 4 }, { id: 'S2', type: 'spend', status: 'executed', committed_daily: 4 }];
  const budget = { daily_cap: 10, monthly_cap: 100000 };
  const each = checkSpendCaps({ item: { id: 'N', amount: 4 }, budget, approvals: [], now: NOW });
  assert.equal(each.ok, true, 'on its own the item fits the daily cap');
  const together = checkSpendCaps({ item: { id: 'N', amount: 4 }, budget, approvals: live, now: NOW });
  assert.equal(together.ok, false);
  assert.match(together.why, /daily total 12 .* over daily_cap 10/);
  assert.equal(checkSpendCaps({ item: { id: 'N', amount: 2 }, budget, approvals: live, now: NOW }).ok, true, 'exactly at the cap is allowed');
});

test('checkSpendCaps refuses when spend so far + daily total x days left passes monthly_cap', () => {
  const f = path.join(tmp, 'm', 'ledger.jsonl');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ at: '2026-11-02T10:00:00Z', channel: 'meta', amount: 50, kind: 'spend' }) + '\n');
  assert.equal(daysLeftInMonth(NOW), 27);
  assert.equal(daysLeftInMonth('2026-02-28T00:00:00Z'), 1);
  const budget = { daily_cap: 10, monthly_cap: 300 };
  const r = checkSpendCaps({ item: { id: 'N', amount: 10 }, budget, approvals: [], ledgerFile: f, now: NOW });
  assert.equal(r.ok, false); assert.equal(r.projected, 50 + 10 * 27);
  assert.match(r.why, /monthly_cap 300/);
  assert.equal(checkSpendCaps({ item: { id: 'N', amount: 9 }, budget, approvals: [], ledgerFile: f, now: NOW }).ok, true, '50 + 9 x 27 = 293 fits');
});

test('spentThisMonth counts kpis spend rows, never twice with the ledger', () => {
  const d = path.join(tmp, 's');
  fs.mkdirSync(path.join(d, 'metrics'), { recursive: true });
  const f = path.join(d, 'ledger.jsonl');
  fs.writeFileSync(f, [
    { at: '2026-11-01T09:00:00Z', channel: 'meta', amount: 20, kind: 'spend' },   // same money as the kpis row below
    { at: '2026-11-02T09:00:00Z', channel: 'google', amount: 5, kind: 'spend' },  // only in the ledger
    { at: '2026-10-30T09:00:00Z', channel: 'meta', amount: 999, kind: 'spend' },  // last month
    { at: '2026-11-02T09:00:00Z', channel: 'meta', amount: 7, kind: 'committed_daily' },
  ].map((x) => JSON.stringify(x)).join('\n') + '\n');
  fs.writeFileSync(path.join(d, 'metrics', 'kpis.json'), JSON.stringify([
    { date: '2026-11-01', channel: 'meta', metric: 'spend', value: 25 },
    { date: '2026-11-03', channel: 'meta', campaign: 'c1', metric: 'spend', value: 6 },
    { date: '2026-11-03', channel: 'meta', campaign: 'c2', metric: 'spend', value: 4 },
    { date: '2026-11-03', channel: 'all', metric: 'spend', value: 8 },            // a smaller total row: the parts win
    { date: '2026-11-03', channel: 'meta', metric: 'conversions', value: 3 },
  ]));
  // Nov 1: max(20, 25) = 25; Nov 2: 5; Nov 3: max(0, 6 + 4) = 10
  assert.equal(spentThisMonth(f, NOW), 40);
  assert.equal(spentThisMonth(f, NOW, { kpis: false }), 25, 'ledger only');
  assert.equal(kpiSpendByDay([{ date: '2026-11-05', channel: 'all', metric: 'spend', value: 30 }, { date: '2026-11-05', channel: 'x', metric: 'spend', value: 10 }], '2026-11')['2026-11-05'].total, 30);
});

test('executor holds a spend item that fits daily_cap alone but not with the live campaigns', () => {
  writeJ('approvals.json', [
    { id: 'L1', type: 'spend', channel: 'meta', title: 'Live 1', amount: 4, status: 'executed', executed_at: '2026-11-01T00:00:00Z', committed_daily: 4 },
    { id: 'L2', type: 'spend', channel: 'meta', title: 'Live 2', amount: 4, status: 'executed', executed_at: '2026-11-01T00:00:00Z', committed_daily: 4 },
    { id: 'N1', type: 'spend', channel: 'meta', title: 'Third', amount: 4, file: 'outbox/post.md', compliance: 'pass', status: 'approved' },
  ]);
  run('execute.mjs', [slug, '--now', NOW]);
  const a = byId();
  assert.equal(a.N1.status, 'pending');
  assert.match(a.N1.review_notes, /held by executor: daily total 12/);
  assert.equal(a.L1.status, 'executed', 'other items untouched');
});

test('executor holds spend when platform spend in kpis leaves too little for the rest of the month', () => {
  fs.mkdirSync(P('metrics'), { recursive: true });
  writeJ('metrics/kpis.json', [{ date: '2026-11-02', channel: 'meta', metric: 'spend', value: 900, source: 'meta-api' }]);
  writeJ('approvals.json', [{ id: 'N2', type: 'spend', channel: 'meta', title: 'Small', amount: 5, file: 'outbox/post.md', compliance: 'pass', status: 'approved' }]);
  run('execute.mjs', [slug, '--now', NOW]);
  const a = byId();
  assert.equal(a.N2.status, 'pending');
  assert.match(a.N2.review_notes, /spent 900 \+ 5\/day x 27/);
  fs.rmSync(P('metrics/kpis.json'));
});

// ── Item 11: the allocator scores server-side conversions only ──
test('budget allocator ignores client_conversions and satellite rows', () => {
  assert.equal(isServerSideRow({ metric: 'conversions', source: 'stripe' }), true);
  assert.equal(isServerSideRow({ metric: 'client_conversions' }), false);
  assert.equal(isServerSideRow({ metric: 'conversions', source: 'satellite' }), false);
  const p = readJ('product.json'); p.channels = { ...(p.channels ?? {}), paid: ['google', 'meta'] }; writeJ('product.json', p);
  fs.mkdirSync(P('metrics'), { recursive: true });
  writeJ('metrics/kpis.json', [
    { date: '2026-11-02', channel: 'google', metric: 'conversions', value: 3, source: 'stripe' },
    { date: '2026-11-02', channel: 'meta', metric: 'client_conversions', value: 500, source: 'satellite' },
    { date: '2026-11-02', channel: 'meta', metric: 'conversions', value: 400, source: 'satellite' },
  ]);
  const r = run('budget.mjs', [slug]);
  assert.equal(r.results.google.conversions, 3);
  assert.equal(r.results.meta?.conversions ?? 0, 0, 'forgeable browser conversions never score');
  assert.ok(r.proposed_split.google > r.proposed_split.meta);
  fs.rmSync(P('metrics/kpis.json'));
});

// ── Item 10: no connector ──
test('no connector: the item stays approved and waits; manual after 7 days or when item.manual', () => {
  writeJ('approvals.json', [
    { id: 'W1', type: 'post', channel: 'linkedin', title: 'Founder post', file: 'outbox/post.md', compliance: 'pass', status: 'approved' },
    { id: 'W2', type: 'post', channel: 'linkedin', title: 'By hand please', file: 'outbox/post.md', compliance: 'pass', status: 'approved', manual: true },
  ]);
  let r = run('execute.mjs', [slug, '--now', NOW]);
  assert.equal(r.waiting, 1); assert.equal(r.manual, 1);
  let a = byId();
  assert.equal(a.W1.status, 'approved');
  assert.equal(a.W1.waiting_for, 'connector key');
  assert.equal(a.W1.waiting_since, NOW);
  assert.ok(!fs.existsSync(P('outbox/manual/W1.md')));
  assert.equal(a.W2.status, 'approved-manual');
  assert.ok(fs.existsSync(P('outbox/manual/W2.md')));

  r = run('execute.mjs', [slug, '--now', '2026-11-08T12:00:00.000Z']);
  a = byId();
  assert.equal(a.W1.status, 'approved', 'still waiting after 4 days');
  assert.equal(a.W1.waiting_since, NOW, 'waiting_since is kept');

  r = run('execute.mjs', [slug, '--now', '2026-11-11T12:00:01.000Z']);
  a = byId();
  assert.equal(a.W1.status, 'approved-manual');
  assert.equal(a.W1.manual_steps, 'outbox/manual/W1.md');
  assert.ok(fs.existsSync(P('outbox/manual/W1.md')));
});

test('a waiting item executes once its key appears, and the waiting note is cleared', async () => {
  writeJ('approvals.json', [{ id: 'K1', type: 'post', channel: 'x', title: 'Thread', file: 'outbox/post.md', compliance: 'pass', status: 'approved', waiting_for: 'connector key', waiting_since: NOW }]);
  const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => res.end('ok')); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const r = await runAsync('execute.mjs', [slug, '--now', '2026-11-05T00:00:00.000Z'], { OM_WEBHOOK_DEFAULT: `http://127.0.0.1:${srv.address().port}/hook` });
    assert.equal(r.executed, 1, JSON.stringify(r));
  } finally { srv.close(); }
  const a = byId().K1;
  assert.equal(a.status, 'executed');
  assert.equal(a.waiting_for, undefined);
  assert.equal(a.executing_at, undefined);
});

// ── Item 9: lock, 'executing' claim, merge on write ──
test('tryLock: one holder at a time, stale or dead locks are taken over, release removes it', () => {
  const f = path.join(tmp, 'a.lock');
  const rel = tryLock(f);
  assert.ok(rel);
  assert.equal(tryLock(f), null, 'held by a live process');
  rel();
  assert.ok(!fs.existsSync(f));
  fs.writeFileSync(f, JSON.stringify({ pid: process.pid, host: os.hostname(), at: '2026-01-01T00:00:00Z' }));
  const rel2 = tryLock(f, { nowMs: Date.parse('2026-01-01T00:11:00Z') });
  assert.ok(rel2, 'older than 10 minutes: stale');
  rel2();
  fs.writeFileSync(f, JSON.stringify({ pid: 2 ** 30, host: os.hostname(), at: new Date().toISOString() }));
  const rel3 = acquireLock(f);
  assert.ok(rel3, 'its process is gone: stale');
  rel3();
});

test('tryLock: a live holder on this host past staleMs keeps the lock; refresh() rewrites at', async () => {
  const f = path.join(tmp, 'live.lock');
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},5000)'], { stdio: 'ignore' });
  try {
    await new Promise((r) => child.once('spawn', r));
    fs.writeFileSync(f, JSON.stringify({ pid: child.pid, host: os.hostname(), at: new Date(Date.now() - 11 * 60 * 1000).toISOString() }));
    assert.equal(tryLock(f), null, 'alive on this host and under the hard ceiling');
    assert.ok(fs.existsSync(f), 'its lock is untouched');
    const far = tryLock(f, { nowMs: Date.now() + 61 * 60 * 1000 });
    assert.ok(far, 'past the hard ceiling (6 x staleMs) it is stale even when alive');
    far();
    fs.writeFileSync(f, JSON.stringify({ pid: child.pid, host: os.hostname(), at: new Date(Date.now() - 11 * 60 * 1000).toISOString() }));
  } finally { child.kill(); }
  await new Promise((r) => (child.exitCode !== null || child.signalCode ? r() : child.once('exit', r)));
  const rel = tryLock(f);
  assert.ok(rel, 'its process is gone: taken over');
  const before = JSON.parse(fs.readFileSync(f, 'utf8')).at;
  assert.ok(Date.parse(before) > Date.now() - 60 * 1000, 'the new lock carries a fresh at');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(rel.refresh(), true);
  assert.ok(Date.parse(JSON.parse(fs.readFileSync(f, 'utf8')).at) >= Date.parse(before), 'refresh rewrote at');
  rel();
  assert.ok(!fs.existsSync(f), 'release still removes the refreshed lock');
  assert.equal(rel.refresh(), false, 'nothing to refresh after release');
});

test('tryLock: stale takeover does not delete a fresh lock written by a racing process', () => {
  const f = path.join(tmp, 'race.lock');
  fs.writeFileSync(f, JSON.stringify({ pid: 2 ** 30, host: os.hostname(), at: '2026-01-01T00:00:00Z' }));
  const fresh = JSON.stringify({ pid: process.pid + 1, host: 'other-host', at: new Date().toISOString(), owner: 'racer' });
  let raced = false;
  // Between our stale read and our takeover, process A removes the stale lock and takes a fresh one.
  const fsImpl = { ...fs, renameSync: (a, b) => {
    if (!raced && a === f) { raced = true; fs.unlinkSync(f); fs.writeFileSync(f, fresh); }
    return fs.renameSync(a, b);
  } };
  assert.equal(tryLock(f, { fsImpl }), null, 'the second caller does not get the lock');
  assert.ok(raced);
  assert.equal(fs.readFileSync(f, 'utf8'), fresh, 'the fresh lock survives');
  assert.deepEqual(fs.readdirSync(tmp).filter((n) => n.startsWith('race.lock.stale-')), [], 'no file left aside');
  fs.unlinkSync(f);
});

test('executor skips while another live process holds the product lock, and runs after it is stale', () => {
  writeJ('approvals.json', [{ id: 'X1', type: 'post', channel: 'linkedin', title: 'Locked', file: 'outbox/post.md', compliance: 'pass', status: 'approved' }]);
  const lock = P('.execute.lock');
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, host: os.hostname(), at: new Date().toISOString(), owner: 'test' }));
  let r = run('execute.mjs', [slug, '--now', NOW]);
  assert.match(r.skipped, /another executor holds/);
  assert.equal(byId().X1.waiting_for, undefined, 'nothing was touched');
  // The holder (this test process) is alive on this host: 11 minutes is not enough, only the hard ceiling.
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, host: os.hostname(), at: new Date(Date.now() - 11 * 60 * 1000).toISOString(), owner: 'test' }));
  r = run('execute.mjs', [slug, '--now', NOW]);
  assert.match(r.skipped, /another executor holds/, 'a live holder past 10 minutes keeps the lock');
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, host: os.hostname(), at: new Date(Date.now() - 61 * 60 * 1000).toISOString(), owner: 'test' }));
  r = run('execute.mjs', [slug, '--now', NOW]);
  assert.equal(r.waiting, 1);
  assert.ok(!fs.existsSync(lock), 'the executor released its own lock');
});

test("executor saves 'executing' before the connector call and keeps writes made meanwhile", async () => {
  writeJ('approvals.json', [{ id: 'C1', type: 'post', channel: 'x', title: 'Claimed', file: 'outbox/post.md', compliance: 'pass', status: 'approved' }]);
  let seen = null;
  const srv = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      // While the connector runs: the item is already claimed on disk, and another writer adds an item.
      const list = readJ('approvals.json');
      seen = list.find((a) => a.id === 'C1')?.status;
      list.push({ id: 'C2', type: 'post', title: 'Added by someone else', status: 'pending' });
      writeJ('approvals.json', list);
      res.end('ok');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const r = await runAsync('execute.mjs', [slug, '--now', NOW], { OM_WEBHOOK_DEFAULT: `http://127.0.0.1:${srv.address().port}/hook` });
    assert.equal(r.executed, 1, JSON.stringify(r));
  } finally { srv.close(); }
  assert.equal(seen, 'executing');
  const a = byId();
  assert.equal(a.C1.status, 'executed');
  assert.ok(a.C2, 'the concurrent write survived');
  assert.equal(a.C2.status, 'pending');
});

test('an item left executing by a dead run is marked failed, never retried', () => {
  writeJ('approvals.json', [{ id: 'D1', type: 'post', channel: 'x', title: 'Half done', status: 'executing', executing_at: '2026-11-04T11:00:00.000Z' }]);
  run('execute.mjs', [slug, '--now', NOW]);
  const a = byId().D1;
  assert.equal(a.status, 'failed');
  assert.match(a.last_error, /interrupted while executing/);
});

// ── Item 28: scheduler lease ──
test('scheduler lease: one holder, renewable, released, expired leases are free', () => {
  const f = path.join(tmp, 'lease.json');
  const t0 = Date.parse(NOW);
  assert.equal(takeLease({ holder: 'hub', ttlMs: 60000, file: f, nowMs: t0 }).ok, true);
  assert.equal(holdsLease('hub', { file: f, nowMs: t0 + 1000 }), true);
  const other = takeLease({ holder: 'gha', ttlMs: 60000, file: f, nowMs: t0 + 1000 });
  assert.equal(other.ok, false); assert.equal(other.holder, 'hub');
  assert.equal(takeLease({ holder: 'hub', ttlMs: 60000, file: f, nowMs: t0 + 2000 }).ok, true, 'renew');
  assert.equal(takeLease({ holder: 'gha', ttlMs: 60000, file: f, nowMs: t0 + 70000 }).ok, true, 'expired: free');
  assert.equal(releaseLease({ holder: 'gha', file: f, nowMs: t0 + 71000 }), true);
  assert.equal(takeLease({ holder: 'hub', ttlMs: 60000, file: f, nowMs: t0 + 72000 }).ok, true, 'released: free');
  const l = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const k of ['holder', 'pid', 'host', 'until']) assert.ok(k in l, k);
});

test('daemon skips the cycle while another scheduler holds the lease; execute checks it too', () => {
  fs.writeFileSync(leaseFile, JSON.stringify({ holder: 'other-host:1', pid: 1, host: 'other-host', until: new Date(Date.now() + 3600e3).toISOString() }));
  const s = run('daemon.mjs', []);
  assert.match(s.skipped, /scheduler lease held by other-host:1/);
  assert.deepEqual(s.products, []);
  const r = run('execute.mjs', [slug], { OM_SCHEDULER_HOLDER: 'me' });
  assert.match(r.skipped, /scheduler lease not held by me/);
  fs.rmSync(leaseFile, { force: true });
});

// ── Executor fixes: spend with no reported daily amount, fresh records, mid-run stop, redaction ──
// Runs execute.mjs against a local webhook server; onHook(approvalId, body) runs inside each request.
const withHook = async (onHook, args = [slug, '--now', NOW], extra = {}) => {
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => { const body = JSON.parse(b); const r = onHook(body.approval.id, body); res.statusCode = r?.status ?? 200; res.end(r?.text ?? 'ok'); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try { return await runAsync('execute.mjs', args, { OM_WEBHOOK_DEFAULT: `http://127.0.0.1:${srv.address().port}/hook`, ...extra }); } finally { srv.close(); }
};
const setProduct = (fn) => { const p = readJ('product.json'); fn(p); writeJ('product.json', p); };

test('committedDaily counts an executed or approved-manual spend with no daily amount at its amount', () => {
  assert.equal(committedDaily({ approvals: [{ type: 'spend', status: 'executed', amount: 20 }] }), 20);
  assert.equal(committedDaily({ approvals: [{ type: 'spend', status: 'approved-manual', amount: 20 }] }), 20);
  assert.equal(committedDaily({ approvals: [{ type: 'spend', status: 'executed', amount: 20, committed_daily: 0 }] }), 0, 'created paused');
});

test('a webhook spend with no committed_daily counts its amount, so a second one is held at daily_cap', async () => {
  fs.rmSync(P('ledger.jsonl'), { force: true });
  setProduct((p) => { p.budget.daily_cap = 20; });
  writeJ('approvals.json', [
    { id: 'H1', type: 'spend', channel: 'meta', title: 'First', amount: 20, file: 'outbox/post.md', compliance: 'pass', status: 'approved' },
    { id: 'H2', type: 'spend', channel: 'meta', title: 'Second', amount: 20, file: 'outbox/post.md', compliance: 'pass', status: 'approved' },
  ]);
  try {
    const r = await withHook(() => null);
    assert.equal(r.executed, 1, JSON.stringify(r));
  } finally { setProduct((p) => { p.budget.daily_cap = 10; }); }
  const a = byId();
  assert.equal(a.H1.status, 'executed'); assert.equal(a.H1.committed_daily, 20);
  assert.match(fs.readFileSync(P('ledger.jsonl'), 'utf8'), /"kind":"committed_daily".*"approval":"H1"/);
  assert.equal(a.H2.status, 'pending');
  assert.match(a.H2.review_notes, /held by executor: daily total 40 .* over daily_cap 20/);
  fs.rmSync(P('ledger.jsonl'), { force: true });
});

test("the executor counts 'approved-manual' and owner-marked executed spend at its amount", () => {
  writeJ('approvals.json', [
    { id: 'M1', type: 'spend', channel: 'meta', title: 'By hand', amount: 6, status: 'approved-manual', manual_steps: 'outbox/manual/M1.md' },
    { id: 'M2', type: 'spend', channel: 'meta', title: 'Marked done', amount: 3, status: 'executed', executed_at: '2026-11-01T00:00:00Z' },
    { id: 'N3', type: 'spend', channel: 'meta', title: 'New', amount: 2, file: 'outbox/post.md', compliance: 'pass', status: 'approved' },
  ]);
  run('execute.mjs', [slug, '--now', NOW]);
  const a = byId();
  assert.equal(a.N3.status, 'pending');
  assert.match(a.N3.review_notes, /daily total 11 \(live 9 \+ this 2\)/);
  assert.equal(a.M1.status, 'approved-manual', 'the manual item itself is untouched');
});

test('an owner edit made during the run is used for the next item and survives the save', async () => {
  writeJ('approvals.json', [
    { id: 'A1', type: 'post', channel: 'x', title: 'Post', file: 'outbox/post.md', compliance: 'pass', status: 'approved' },
    { id: 'A2', type: 'spend', channel: 'meta', title: 'Spend', amount: 50, activate: true, file: 'outbox/post.md', compliance: 'pass', status: 'approved' },
  ]);
  const sent = {};
  const r = await withHook((id, body) => {
    sent[id] = body.approval;
    if (id === 'A1') {
      const list = readJ('approvals.json');
      const a2 = list.find((x) => x.id === 'A2');
      a2.amount = 5; delete a2.activate; a2.owner_note = 'lowered by owner';
      writeJ('approvals.json', list);
    }
    return null;
  });
  assert.equal(r.executed, 2, JSON.stringify(r));
  assert.equal(sent.A2.amount, 5, 'the connector got the lowered amount');
  assert.equal(sent.A2.activate, undefined, 'and not the dropped activate');
  const a = byId().A2;
  assert.equal(a.status, 'executed'); assert.equal(a.amount, 5); assert.equal(a.committed_daily, 5);
  assert.equal(a.owner_note, 'lowered by owner');
  fs.rmSync(P('ledger.jsonl'), { force: true });
});

test('autonomy.kill set during the run stops it before the next connector call', async () => {
  writeJ('approvals.json', [
    { id: 'A1', type: 'post', channel: 'x', title: 'One', file: 'outbox/post.md', compliance: 'pass', status: 'approved' },
    { id: 'A2', type: 'post', channel: 'x', title: 'Two', file: 'outbox/post.md', compliance: 'pass', status: 'approved' },
  ]);
  const seen = [];
  let r;
  try {
    r = await withHook((id) => { seen.push(id); if (id === 'A1') setProduct((p) => { p.autonomy = { ...(p.autonomy ?? {}), kill: true }; }); return null; });
  } finally { setProduct((p) => { delete p.autonomy.kill; }); }
  assert.deepEqual(seen, ['A1']);
  assert.match(r.stopped, /kill switch/);
  const a = byId();
  assert.equal(a.A1.status, 'executed');
  assert.equal(a.A2.status, 'approved'); assert.equal(a.A2.executed_at, undefined); assert.equal(a.A2.executing_at, undefined);
});

test('a scheduler lease lost during the run stops it before the next connector call', async () => {
  fs.writeFileSync(leaseFile, JSON.stringify({ holder: 'me', pid: 1, host: 'h', until: new Date(Date.now() + 3600e3).toISOString() }));
  writeJ('approvals.json', [
    { id: 'A1', type: 'post', channel: 'x', title: 'One', file: 'outbox/post.md', compliance: 'pass', status: 'approved' },
    { id: 'A2', type: 'post', channel: 'x', title: 'Two', file: 'outbox/post.md', compliance: 'pass', status: 'approved' },
  ]);
  try {
    const r = await withHook((id) => { if (id === 'A1') fs.writeFileSync(leaseFile, JSON.stringify({ holder: 'other', pid: 2, host: 'h2', until: new Date(Date.now() + 3600e3).toISOString() })); return null; },
      [slug, '--now', NOW], { OM_SCHEDULER_HOLDER: 'me' });
    assert.match(r.stopped, /lease lost/);
  } finally { fs.rmSync(leaseFile, { force: true }); }
  assert.equal(byId().A2.status, 'approved');
});

test('a connector failure echoing a key value is redacted in approvals.json, events and stdout', async () => {
  const echoed = ['fake', 'hook', 'value', process.pid].join('-');
  writeJ('approvals.json', [{ id: 'E1', type: 'post', channel: 'x', title: 'Echo', file: 'outbox/post.md', compliance: 'pass', status: 'approved' }]);
  const r = await withHook(() => ({ status: 500, text: `denied for ${echoed}` }), [slug, '--now', NOW], { OM_WEBHOOK_SECRET: echoed });
  assert.equal(r.failed, 1);
  assert.ok(!JSON.stringify(r).includes(echoed)); assert.match(r.items[0].detail, /\*\*\*/);
  const e = byId().E1;
  assert.ok(!e.last_error.includes(echoed)); assert.match(e.last_error, /\*\*\*/);
  assert.ok(!fs.readFileSync(P('events.jsonl'), 'utf8').includes(echoed));
});

// ── The product-level kill switches (OM_KILL is covered in the pipeline and daemon tests) ──
test('autonomy.kill and a paused stage each stop the executor before it touches anything', () => {
  const k9 = [{ id: 'K9', type: 'post', channel: 'x', title: 'Killed', file: 'outbox/post.md', compliance: 'pass', status: 'approved' }];
  const original = fs.readFileSync(P('product.json'), 'utf8');
  const events = () => (fs.existsSync(P('events.jsonl')) ? fs.readFileSync(P('events.jsonl'), 'utf8') : '');
  try {
    for (const flip of [(p) => { p.autonomy = { ...(p.autonomy ?? {}), kill: true }; }, (p) => { p.stage = 'paused'; }]) {
      fs.writeFileSync(P('product.json'), original);
      setProduct(flip);
      writeJ('approvals.json', k9);
      const before = fs.readFileSync(P('approvals.json'), 'utf8');
      const ev = events();
      const r = run('execute.mjs', [slug, '--now', NOW], { OM_WEBHOOK_DEFAULT: 'http://127.0.0.1:9/never' });
      assert.match(r.skipped, /kill switch/);
      assert.equal(r.executed, 0);
      assert.equal(fs.readFileSync(P('approvals.json'), 'utf8'), before, 'K9 is byte-identical');
      assert.equal(events(), ev, 'no event appended');
    }
  } finally { fs.writeFileSync(P('product.json'), original); }
});
