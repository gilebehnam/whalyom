// Earned autonomy made visible: streaks per action type and channel, what is automatic by level, by earned
// trust or still manual, the next milestone, info alerts when a channel earns or loses autonomy, and a
// dashboard file with no personal data. Approvals are never written. Runs in a temp folder, no network.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { streaks, autonomyRows, autonomyAlerts, runAutonomy, runAll, safeLabel } from '../autonomy-report.mjs';
import { testEnv } from './_env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'om-autonomy-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));

const day = (n) => new Date(Date.UTC(2026, 9, 1 + n)).toISOString();
const ap = (n, type, channel, status = 'approved', extra = {}) => ({ id: `a${type}${channel}${n}`, type, channel, status, decided_by: 'owner', decided_at: day(n), title: 'Post to jane@example.com', to: 'jane@example.com', ...extra });
const series = (type, channel, count, from = 0) => Array.from({ length: count }, (_, i) => ap(from + i, type, channel));

function product(slug, prod, approvals) {
  const d = path.join(base, 'products', slug);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'product.json'), JSON.stringify({ name: slug, domain: 'example.com', stage: 'live', ...prod }));
  fs.writeFileSync(path.join(d, 'approvals.json'), JSON.stringify(approvals, null, 2));
  return d;
}

test('streak counts only clean owner approvals, newest first, and records what broke it', () => {
  const list = [...series('post', 'linkedin', 4, 0), ap(4, 'post', 'linkedin', 'rejected'), ...series('post', 'linkedin', 3, 5), ap(9, 'post', 'x', 'approved', { decided_by: 'policy:autopilot' })];
  const s = streaks(list);
  assert.equal(s['post|linkedin'].streak, 3);
  assert.equal(s['post|linkedin'].last_break.reason, 'rejected');
  assert.equal(s['post|x'], undefined, 'policy decisions never count');
  const e = streaks([...series('send', 'email', 2, 0), ap(2, 'send', 'email', 'approved', { edited_by_owner: true })]);
  assert.equal(e['send|email'].streak, 0);
  assert.equal(e['send|email'].last_break.reason, 'edited by the owner');
});

test('rows show level, earned, eligible, manual and never with the next milestone', () => {
  const list = [...series('post', 'linkedin', 7), ...series('send', 'email', 10), ...series('outreach', 'reddit', 10), ...series('price', 'site', 12), ...series('publish', 'blog', 2)];
  const on = autonomyRows({ domain: 'x.com', autonomy: { level: 'supervised', earned: true, never_auto: ['outreach'] } }, list);
  const by = Object.fromEntries(on.rows.map((r) => [r.key, r]));
  assert.equal(by['post|linkedin'].mode, 'manual');
  assert.equal(by['post|linkedin'].next, 'post|linkedin: 7 of 10');
  assert.equal(by['send|email'].mode, 'earned');
  assert.equal(by['outreach|reddit'].mode, 'never');
  assert.equal(by['price|site'].mode, 'never');
  const lvl = autonomyRows({ domain: 'x.com', autonomy: { level: 'autopilot' } }, list);
  const byL = Object.fromEntries(lvl.rows.map((r) => [r.key, r]));
  assert.equal(byL['publish|blog'].mode, 'level');
  assert.equal(byL['send|email'].mode, 'eligible', 'streak reached but the switch is off: still manual in policy');
  const strict = autonomyRows({ domain: 'x.com', autonomy: { level: 'manual', earned: { streak: 2 } } }, list);
  assert.equal(strict.need, 5, 'never fewer than 5');
  const held = autonomyRows({ domain: '', autonomy: { level: 'autopilot' } }, list);
  assert.equal(held.rows.find((r) => r.key === 'publish|blog').held, 'no domain yet');
});

test('alerts fire on earning and on losing after a rejection, not on the first baseline', () => {
  const prod = { autonomy: { level: 'supervised', earned: true } };
  const r1 = autonomyRows(prod, series('post', 'linkedin', 9));
  assert.deepEqual(autonomyAlerts(null, r1), []);
  const r2 = autonomyRows(prod, series('post', 'linkedin', 10));
  const a2 = autonomyAlerts(r1, r2);
  assert.equal(a2.length, 1);
  assert.equal(a2[0].key, 'autonomy:post|linkedin');
  assert.equal(a2[0].level, 'info');
  assert.equal(a2[0].kind, 'earned');
  const r3 = autonomyRows(prod, [...series('post', 'linkedin', 10), ap(10, 'post', 'linkedin', 'rejected')]);
  const a3 = autonomyAlerts(r2, r3);
  assert.equal(a3[0].kind, 'lost');
  assert.match(a3[0].title, /after a rejection/);
});

test('runAutonomy writes the report and alerts, never touches approvals; runAll writes clean state', () => {
  const slug = 'zz-auto';
  const approvals = series('post', 'linkedin', 9);
  const d = product(slug, { autonomy: { level: 'supervised', earned: true } }, approvals);
  const before = fs.readFileSync(path.join(d, 'approvals.json'), 'utf8');
  const first = runAutonomy(slug, { base, now: day(20) });
  assert.equal(first.alerted, 0);
  assert.ok(fs.readFileSync(path.join(d, 'reports', 'autonomy.md'), 'utf8').includes('post|linkedin: 9 of 10'));
  assert.equal(fs.readFileSync(path.join(d, 'approvals.json'), 'utf8'), before);

  fs.writeFileSync(path.join(d, 'approvals.json'), JSON.stringify(series('post', 'linkedin', 10)));
  const second = runAutonomy(slug, { base, now: day(21) });
  assert.equal(second.alerted, 1);
  let alerts = JSON.parse(fs.readFileSync(path.join(d, 'alerts.json'), 'utf8'));
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].key, 'autonomy:post|linkedin');
  assert.equal(alerts[0].resolved, false);
  runAutonomy(slug, { base, now: day(22) });
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'alerts.json'), 'utf8')).length, 1, 'no repeat without a change');

  fs.writeFileSync(path.join(d, 'approvals.json'), JSON.stringify([...series('post', 'linkedin', 10), ap(11, 'post', 'linkedin', 'rejected')]));
  runAutonomy(slug, { base, now: day(23) });
  alerts = JSON.parse(fs.readFileSync(path.join(d, 'alerts.json'), 'utf8'));
  assert.equal(alerts.length, 1, 'one open alert per key');
  assert.match(alerts[0].title, /back to manual/);

  product('zz-other', { autonomy: { level: 'autopilot' } }, [ap(1, 'post', 'Jane@Example.com')]);
  runAll({ base, now: day(24) });
  const state = fs.readFileSync(path.join(base, 'state', 'live-autonomy.json'), 'utf8');
  assert.equal(JSON.parse(state).products.length, 2);
  assert.ok(!/example\.com|jane/i.test(state), 'no personal data in state');
  assert.equal(safeLabel('Jane@Example.com'), 'other');
});

test('never shows as automatic what policy.mjs holds; malformed input does not crash', () => {
  const list = [...series('send', 'email', 10), ...series('post', 'x', 10), ...series('spend', 'meta', 10)];
  const byKey = (rep) => Object.fromEntries(rep.rows.map((r) => [r.key, r]));
  // never_auto as a string is read the way policy.mjs reads it (includes), so it still wins.
  const s = byKey(autonomyRows({ domain: 'x.com', autonomy: { level: 'supervised', earned: true, never_auto: 'send' } }, list, { env: {} }));
  assert.equal(s['send|email'].mode, 'never');
  // A malformed earned.types list earns nothing.
  const t = byKey(autonomyRows({ domain: 'x.com', autonomy: { level: 'supervised', earned: { types: { post: 1 } } } }, list, { env: {} }));
  assert.equal(t['post|x'].mode, 'manual');
  // OM_KILL holds everything automatic, as in policy.mjs, and a paused product holds non-outward types too.
  const k = autonomyRows({ domain: 'x.com', autonomy: { level: 'supervised', earned: true } }, list, { env: { OM_KILL: '1' } });
  assert.equal(k.held, 'paused');
  assert.ok(k.rows.filter((r) => r.mode === 'earned').every((r) => r.held === 'product paused or kill-switched'));
  const p = autonomyRows({ domain: 'x.com', stage: 'paused', autonomy: { level: 'manual', always_auto: ['report'] } }, [ap(1, 'report', 'internal', 'pending')], { env: {} });
  assert.equal(p.rows[0].mode, 'level');
  assert.equal(p.rows[0].held, 'product paused or kill-switched');
  // Spend with no automatic daily limit is held: policy.mjs never spends it on its own.
  const sp = byKey(autonomyRows({ domain: 'x.com', autonomy: { level: 'autopilot' } }, list, { env: {} }));
  assert.match(sp['spend|meta'].held, /auto_spend_per_day/);
  const sp2 = byKey(autonomyRows({ domain: 'x.com', autonomy: { level: 'autopilot', auto_spend_per_day: 20 } }, list, { env: {} }));
  assert.equal(sp2['spend|meta'].held, null);
  // Malformed input: null entries, null product, junk baseline and alert list.
  assert.doesNotThrow(() => autonomyRows(null, [null, 1, 'x', ...series('post', 'x', 2)], { env: {} }));
  const cur = autonomyRows({ autonomy: { level: 'supervised', earned: true } }, series('post', 'x', 10), { env: {} });
  assert.equal(autonomyAlerts({ rows: [null, 3, { key: 7 }] }, cur).length, 1);
  assert.throws(() => runAutonomy('../../etc', { base }), /bad product slug/);
});

test('CLI prints usage without arguments', () => {
  const r = spawnSync(process.execPath, [path.join(root, 'tools', 'autonomy-report.mjs')], { encoding: 'utf8', env: testEnv() });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Usage/);
});
