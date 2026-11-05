// The hub's reliability helpers (tools/lib/queue.mjs, tools/lib/hub.mjs): crash recovery of .running jobs,
// the watchdog that kills a hung headless run, the stale pid-file check, closing each run's log
// descriptor, and the tool runner's in-flight guard and daemon timeout. Nothing here starts the hub.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recoverQueue } from '../lib/queue.mjs';
import { createIgniter, createRunner, hubPidStale, overdue, toolTimeoutMs, TOOL_TIMEOUT_MS } from '../lib/hub.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-hubq-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));
const readJ = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, ms = 20000, tick = () => {}) => { const end = Date.now() + ms; while (Date.now() < end) { tick(); if (cond()) return true; await sleep(100); } return cond(); };
const ws = (dir) => { const d = path.join(base, dir); for (const s of ['queue', 'state', 'products']) fs.mkdirSync(path.join(d, s), { recursive: true }); return { root: d, queueDir: path.join(d, 'queue'), stateDir: path.join(d, 'state'), productsDir: path.join(d, 'products') }; };

// A stand-in for claude: FAKE_MODE=sleep hangs forever, anything else exits 0 at once.
const fakeDir = path.join(base, 'bin');
fs.mkdirSync(fakeDir);
fs.writeFileSync(path.join(fakeDir, 'fake.mjs'), "process.stdin.resume(); if (process.env.FAKE_MODE === 'sleep') setInterval(() => {}, 1e6); else process.exit(0);\n");
const fakeBin = process.platform === 'win32' ? path.join(fakeDir, 'claude.cmd') : path.join(fakeDir, 'claude.sh');
fs.writeFileSync(fakeBin, process.platform === 'win32'
  ? `@"${process.execPath}" "%~dp0fake.mjs" %*\r\n`
  : `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake.mjs" "$@"\n`, { mode: 0o755 });
const fakeEnv = (extra) => ({ WHALYOM_ANTHROPIC_API_KEY: 'test-platform-key', ...process.env, OM_CLAUDE_BIN: fakeBin, OM_AUTO_IGNITE: '', OM_DAILY_RUN_HOUR: '', ...extra });

// ── 1. crash recovery ──
test('recoverQueue requeues interrupted jobs with attempts + 1 and gives up after 3 with an alert', () => {
  const w = ws('recover');
  fs.writeFileSync(path.join(w.queueDir, 'onboard-a.json.running'), JSON.stringify({ slug: 'a', attempts: 0 }));
  fs.writeFileSync(path.join(w.queueDir, 'onboard-b.json.running'), JSON.stringify({ slug: 'b', attempts: 3 }));
  fs.writeFileSync(path.join(w.queueDir, 'respond-c.json.running'), JSON.stringify({ slug: 'c' }));
  fs.writeFileSync(path.join(w.queueDir, 'onboard-d.json.running'), '{broken');
  fs.writeFileSync(path.join(w.queueDir, 'notes.json.running'), '{}');
  const alertsFile = path.join(w.stateDir, 'system-alerts.json');
  const lines = [];
  const res = recoverQueue(w.queueDir, { alertsFile, log: (m) => lines.push(m) });
  assert.deepEqual(res.requeued.sort(), ['onboard-a.json', 'respond-c.json']);
  assert.deepEqual(res.failed.sort(), ['onboard-b.json', 'onboard-d.json']);
  assert.equal(readJ(path.join(w.queueDir, 'onboard-a.json')).attempts, 1);
  assert.equal(readJ(path.join(w.queueDir, 'onboard-a.json')).slug, 'a', 'the job keeps its fields');
  assert.equal(readJ(path.join(w.queueDir, 'respond-c.json')).attempts, 1);
  assert.ok(fs.existsSync(path.join(w.queueDir, 'onboard-b.json.failed')));
  assert.deepEqual(fs.readdirSync(w.queueDir).filter((f) => f.endsWith('.running')), ['notes.json.running'], 'only names the hub owns are touched');
  assert.ok(lines.some((l) => l === 'requeued onboard-a.json after hub restart (attempt 1 of 3)'));
  const alerts = readJ(alertsFile);
  assert.equal(alerts.filter((a) => a.source === 'hub' && !a.resolved).length, 2);
  assert.ok(alerts.some((a) => a.key === 'hub-queue-onboard-b.json' && /interrupted 3 times/.test(a.detail)));
  // A second start finds nothing to do and does not duplicate alerts.
  assert.deepEqual(recoverQueue(w.queueDir, { alertsFile }), { requeued: [], failed: [] });
  assert.equal(readJ(alertsFile).length, 2);
  // The count survives: two more interruptions of onboard-a, then it fails.
  for (let i = 0; i < 3; i++) { fs.renameSync(path.join(w.queueDir, 'onboard-a.json'), path.join(w.queueDir, 'onboard-a.json.running')); recoverQueue(w.queueDir, { alertsFile }); }
  assert.ok(fs.existsSync(path.join(w.queueDir, 'onboard-a.json.failed')));
});

// ── 2. watchdog ──
test('overdue: 120 min default for onboarding and replies, 240 for the daily run, env overrides', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');
  const ago = (min) => now - min * 60000;
  assert.equal(overdue({ kind: 'onboard', startedAt: ago(121) }, now, {}), true);
  assert.equal(overdue({ kind: 'onboard', startedAt: ago(119) }, now, {}), false);
  assert.equal(overdue({ kind: 'respond', startedAt: ago(121) }, now, {}), true);
  assert.equal(overdue({ kind: 'daily', startedAt: ago(200) }, now, {}), false);
  assert.equal(overdue({ kind: 'daily', startedAt: ago(241) }, now, {}), true);
  assert.equal(overdue({ kind: 'onboard', startedAt: ago(31) }, now, { OM_IGNITE_TIMEOUT_MIN: '30' }), true);
  assert.equal(overdue({ kind: 'onboard', startedAt: ago(119) }, now, { OM_IGNITE_TIMEOUT_MIN: 'abc' }), false, 'a bad value keeps the default');
  assert.equal(overdue({ kind: 'daily', startedAt: ago(61) }, now, { OM_DAILY_TIMEOUT_MIN: '60' }), true);
  assert.equal(overdue(null, now, {}), false);
});

test('a hung onboarding is killed, ends .failed with an alert, and the next job starts', async () => {
  const w = ws('watchdog');
  fs.writeFileSync(path.join(w.queueDir, 'onboard-x.json'), JSON.stringify({ slug: 'x' }));
  fs.writeFileSync(path.join(w.queueDir, 'onboard-y.json'), JSON.stringify({ slug: 'y' }));
  const lines = [];
  const ig = createIgniter({ canSpend: () => ({ ok: true, spent: 0, budget: 100, left: 100 }), recordSpend: () => {}, ...w, log: (m) => lines.push(m), env: fakeEnv({ FAKE_MODE: 'sleep', OM_IGNITE_TIMEOUT_MIN: '0.02' }) });
  try {
    const first = ig.igniteNext();
    assert.equal(first.slug, 'x');
    assert.ok(fs.existsSync(path.join(w.queueDir, 'onboard-x.json.running')));
    assert.equal(ig.igniteNext(), null, 'one run at a time');
    const ok = await until(() => fs.existsSync(path.join(w.queueDir, 'onboard-y.json.running')), 20000, () => ig.igniteNext());
    assert.ok(ok, `next job did not start; log: ${lines.join(' | ')}`);
    assert.ok(fs.existsSync(path.join(w.queueDir, 'onboard-x.json.failed')));
    assert.equal(fs.existsSync(path.join(w.queueDir, 'onboard-x.json.running')), false);
    assert.equal(ig.current().slug, 'y');
    assert.ok(lines.some((l) => /onboarding x: no result after \d+ min; killing pid/.test(l)));
    assert.ok(readJ(path.join(w.stateDir, 'system-alerts.json')).some((a) => a.key === 'hub-timeout-onboard-x'));
  } finally {
    ig.stop();
    await until(() => !ig.current(), 15000);
  }
});

test('the daily run renews its lease on every tick and releases it when killed', async () => {
  const w = ws('daily');
  const calls = { take: [], release: [] };
  const ig = createIgniter({ canSpend: () => ({ ok: true, spent: 0, budget: 100, left: 100 }), recordSpend: () => {},
    ...w, env: fakeEnv({ FAKE_MODE: 'sleep', OM_DAILY_RUN_HOUR: String(new Date().getUTCHours()), OM_DAILY_TIMEOUT_MIN: '0.03' }),
    takeLease: (o) => { calls.take.push(o); return { ok: true }; }, releaseLease: (o) => { calls.release.push(o); return true; },
  });
  try {
    const r = ig.dailyTick();
    assert.equal(r?.kind, 'daily');
    assert.equal(ig.dailyTick(), null, 'once a day');
    ig.igniteNext(); ig.igniteNext();
    assert.equal(calls.take.length, 3, 'taken once, renewed on each tick');
    assert.ok(calls.take.every((o) => o.holder === 'hub-daily' && o.ttlMs === 4 * 3600 * 1000));
    assert.ok(await until(() => !ig.current(), 20000, () => ig.igniteNext()), 'killed after its deadline');
    assert.deepEqual(calls.release, [{ holder: 'hub-daily' }]);
  } finally { ig.stop(); }
});

// ── 3. stale pid file ──
test('hubPidStale: pid reuse, a dead pid, another host and the old bare-number format', () => {
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const alive = (pid) => pid === process.pid;
  const host = os.hostname();
  assert.equal(hubPidStale({ pid: process.pid, heartbeat_at: iso(now - 10 * 60000) }, now, alive), true, 'live pid but old heartbeat = reused pid');
  assert.equal(hubPidStale({ pid: process.pid, host, heartbeat_at: iso(now - 30000) }, now, alive), false);
  assert.equal(hubPidStale({ pid: process.pid, heartbeat_at: iso(now - 30000) }, now, alive), false, 'no host field');
  assert.equal(hubPidStale({ pid: 999999, host, heartbeat_at: iso(now - 30000) }, now, alive), true, 'dead pid');
  assert.equal(hubPidStale({ pid: process.pid, host: `${host}-other`, heartbeat_at: iso(now - 30000) }, now, alive), true, 'other host');
  assert.equal(hubPidStale({ pid: process.pid, host }, now, alive), true, 'no heartbeat at all');
  assert.equal(hubPidStale(process.pid, now, alive), false, 'old format, live pid');
  assert.equal(hubPidStale(999999, now, alive), true, 'old format, dead pid');
  assert.equal(hubPidStale(null, now, alive), true);
  assert.equal(hubPidStale({ pid: 'x' }, now, alive), true);
});

// ── 4. log descriptors ──
test('every run closes its log descriptor: 20 lead replies, 20 opens, 20 closes', async () => {
  const w = ws('fds');
  const slugs = Array.from({ length: 20 }, (_, i) => `r${String(i).padStart(2, '0')}`);
  for (const s of slugs) fs.writeFileSync(path.join(w.queueDir, `respond-${s}.json`), JSON.stringify({ slug: s }));
  const opened = []; const closed = [];
  const ig = createIgniter({ canSpend: () => ({ ok: true, spent: 0, budget: 100, left: 100 }), recordSpend: () => {},
    ...w, env: fakeEnv({ FAKE_MODE: 'exit' }),
    open: (f) => { const fd = fs.openSync(f, 'a'); opened.push(fd); return fd; },
    close: (fd) => { closed.push(fd); fs.closeSync(fd); },
  });
  const done = () => slugs.every((s) => fs.existsSync(path.join(w.queueDir, `respond-${s}.json.done`)));
  assert.ok(await until(done, 60000, () => ig.igniteNext()), 'all 20 replies ran');
  assert.equal(opened.length, 20);
  assert.deepEqual([...closed].sort(), [...opened].sort(), 'each descriptor closed exactly once');
  for (const s of slugs) fs.renameSync(path.join(w.stateDir, `ignite-${s}.log`), path.join(w.stateDir, `ignite-${s}.log.1`));
});

// ── 5. tool runner ──
test('runTool skips a script that is still running and gives daemon.mjs its own timeout', () => {
  const started = [];
  const fakeExec = (bin, args, opts, cb) => { started.push({ script: path.basename(args[0]), opts, cb }); return { pid: 4242 }; };
  const lines = [];
  const runTool = createRunner({ execFile: fakeExec, root: base, log: (m) => lines.push(m), env: {} });
  runTool('sync-sites.mjs');
  assert.equal(runTool('sync-sites.mjs'), null);
  assert.equal(started.filter((s) => s.script === 'sync-sites.mjs').length, 1);
  assert.ok(lines.some((l) => /sync-sites\.mjs: still running/.test(l)));
  runTool('daemon.mjs');
  const daemon = started.find((s) => s.script === 'daemon.mjs');
  assert.ok(daemon.opts.timeout >= 55 * 60 * 1000 && daemon.opts.timeout < 60 * 60 * 1000);
  assert.equal(started[0].opts.timeout, TOOL_TIMEOUT_MS);
  assert.equal(toolTimeoutMs('daemon.mjs', { OM_HUB_DAEMON_TIMEOUT_MIN: '40' }), 40 * 60 * 1000);
  // A timeout is logged as such and frees the slot.
  daemon.cb(Object.assign(new Error('timeout'), { killed: true, signal: 'SIGTERM' }), '', '');
  assert.ok(lines.includes('daemon.mjs: killed after 55 min (timeout; its last step did not finish)'));
  started[0].cb(null, 'line1\nsynced 3 sites\n', '');
  assert.ok(lines.includes('sync-sites.mjs: synced 3 sites'));
  runTool('sync-sites.mjs');
  assert.equal(started.filter((s) => s.script === 'sync-sites.mjs').length, 2, 'runs again once the first finished');
});
