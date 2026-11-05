// Ledger safety of tools/apply-results.mjs: corrupt ledgers are never wiped, the product lock is taken,
// approvals another writer changed keep their status, agents cannot set the owner's go-live flag, and a
// run whose move failed is not applied twice. Run: node --test tools/test/apply-results.test.mjs
// Works in a throwaway product folder (products/zz-ar-*) that is removed afterwards.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tryLock, productLockFile } from '../lib/lock.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const slug = `zz-ar-${process.pid}`;
const dir = path.join(root, 'products', slug);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-ar-'));
const exec = (script, args = [], env = {}) => {
  const r = spawnSync(process.execPath, [path.join(root, 'tools', script), ...args], { encoding: 'utf8', env: { ...process.env, OM_KILL: '', OM_EXECUTE_LOCK_WAIT_MS: '200', ...env } });
  const last = r.stdout.trim().split(/\r?\n/).at(-1) ?? '';
  let out; try { out = JSON.parse(last); } catch { out = last; }
  return { status: r.status, out, stdout: r.stdout, stderr: r.stderr };
};
const run = (script, args, env) => { const r = exec(script, args, env); assert.equal(r.status, 0, `${script} failed: ${r.stderr || r.stdout}`); return r.out; };
const P = (f) => path.join(dir, f);
const read = (f) => JSON.parse(fs.readFileSync(P(f), 'utf8'));
const write = (f, v) => fs.writeFileSync(P(f), typeof v === 'string' ? v : JSON.stringify(v, null, 2));
const queued = (f) => fs.existsSync(P(`runs/${f}`));

before(() => { run('new-product.mjs', [slug, '--preset', 'saas', '--autonomy', 'autopilot', '--budget', '60', '--domain', 'zz-ar.example']); });
after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(tmp, { recursive: true, force: true }); });
beforeEach(() => {
  for (const f of fs.readdirSync(P('runs'))) if (f.endsWith('.json')) fs.rmSync(P(`runs/${f}`));
  fs.rmSync(P('runs/applied/index.json'), { force: true });
  write('tasks.json', []); write('approvals.json', []); write('experiments.json', []); write('transitions.json', []);
});

test('a corrupt tasks.json stops the pass: nothing is written and the run stays queued', () => {
  write('tasks.json', '{"broken":');
  write('approvals.json', [{ id: 'A1', type: 'post', title: 'keep me', status: 'pending' }]);
  write('runs/T1.json', { task_id: 'T1', agent: 'om-writer', status: 'done', approvals: [{ type: 'post', title: 'new' }] });
  const before = fs.readFileSync(P('tasks.json'));
  const r = exec('apply-results.mjs', [slug]);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /tasks\.json is unreadable/);
  assert.deepEqual(fs.readFileSync(P('tasks.json')), before, 'tasks.json byte-identical');
  assert.equal(read('approvals.json').length, 1, 'approvals untouched');
  assert.ok(queued('T1.json'), 'run file still queued');
  assert.ok(!fs.readdirSync(dir).some((f) => /\.tmp-\d+$/.test(f)), 'no temp files left');
});

test('a ledger that parses but is not an array is refused too; alerts.json follows the same rule', () => {
  write('approvals.json', '{}');
  write('runs/T1.json', { task_id: 'T1', agent: 'om-writer', status: 'done' });
  let r = exec('apply-results.mjs', [slug]);
  assert.notEqual(r.status, 0); assert.match(r.stdout, /approvals\.json is unreadable/);
  assert.equal(fs.readFileSync(P('approvals.json'), 'utf8'), '{}');
  write('approvals.json', []);
  write('alerts.json', '[{"title":"old"'); // truncated
  write('runs/T1.json', { task_id: 'T1', agent: 'om-writer', status: 'done', alerts: [{ title: 'new' }] });
  r = exec('apply-results.mjs', [slug]);
  assert.notEqual(r.status, 0); assert.match(r.stdout, /alerts\.json is unreadable/);
  assert.equal(fs.readFileSync(P('alerts.json'), 'utf8'), '[{"title":"old"');
  assert.deepEqual(read('tasks.json'), [], 'no ledger written before the refusal');
  assert.ok(queued('T1.json'));
  fs.rmSync(P('alerts.json'));
});

test('validate reports a non-array ledger as a problem instead of throwing', () => {
  write('tasks.json', '{}');
  const r = exec('validate.mjs', [slug]);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /tasks\.json: not an array/);
  assert.doesNotMatch(r.stderr, /TypeError/);
});

test('when the product lock is held nothing is written and the runs stay queued', () => {
  write('runs/T1.json', { task_id: 'T1', agent: 'om-writer', status: 'done', approvals: [{ type: 'post', title: 'x' }] });
  const release = tryLock(productLockFile(dir), { owner: 'test' });
  assert.ok(release, 'test took the lock');
  try {
    const out = run('apply-results.mjs', [slug]);
    assert.equal(out.skipped, 'product lock held');
  } finally { release(); }
  assert.deepEqual(read('tasks.json'), []); assert.deepEqual(read('approvals.json'), []);
  assert.ok(queued('T1.json'));
  run('apply-results.mjs', [slug]);
  assert.ok(!queued('T1.json'), 'applied once the lock is free');
  assert.ok(!fs.existsSync(productLockFile(dir)), 'lock released');
});

test('an approval executed by another writer during the pass keeps executed and executed_at', () => {
  write('approvals.json', [{ id: 'A1', type: 'spend', title: 'Ad', status: 'approved', compliance: 'pass' }]);
  // What execute.mjs (or a writer without the lock) saved after this pass read approvals.json.
  const concurrent = path.join(tmp, 'concurrent.json');
  fs.writeFileSync(concurrent, JSON.stringify([{ id: 'A1', type: 'spend', title: 'Ad', status: 'executed', executed_at: '2026-01-01T00:30:00Z', compliance: 'pass' },
    { id: 'A2', type: 'post', title: 'Taken by the other writer', status: 'pending' }]));
  write('runs/T1.json', { task_id: 'T1', agent: 'om-writer', status: 'done', approvals: [{ type: 'post', title: 'New post' }] });
  write('runs/REVIEW-1.json', { agent: 'om-compliance-guard', reviews: [{ approval_id: 'A2', compliance: 'pass' }] });
  run('apply-results.mjs', [slug, '--now', '2026-01-01T01:00:00Z'], { OM_TEST_APPROVALS_BEFORE_SAVE: concurrent });
  const ap = read('approvals.json');
  const a1 = ap.find((x) => x.id === 'A1');
  assert.equal(a1.status, 'executed'); assert.equal(a1.executed_at, '2026-01-01T00:30:00Z');
  assert.equal(ap.find((x) => x.id === 'A2').title, 'Taken by the other writer');
  const mine = ap.find((x) => x.title === 'New post');
  assert.ok(mine && mine.id !== 'A2', 'new approval renumbered instead of lost or clobbering A2');
  assert.equal(ap.find((x) => x.id === 'A2').compliance, undefined, 'the verdict for this pass\'s A2 never lands on the other writer\'s A2');
  assert.equal(mine.compliance, 'pass', 'the verdict follows the renumbered approval');
  assert.equal(ap.length, 3);
});

test('an agent cannot set activate; only the owner go-live flag on a decision does', () => {
  write('runs/T1.json', { task_id: 'T1', agent: 'om-writer', status: 'done', approvals: [
    { type: 'spend', channel: 'google_ads', amount: 5, activate: true, title: 'live please' },
    { type: 'spend', channel: 'google_ads', amount: 5, activate: true, title: 'live please 2' }] });
  run('apply-results.mjs', [slug]);
  const ap = read('approvals.json');
  for (const a of ap) { assert.ok(!('activate' in a), 'no activate key'); assert.equal(a.activate_requested, true); }
  const inbox = path.join(tmp, 'inbox.json');
  const at = `2026-01-01T00:00:00.${String(process.pid % 1000).padStart(3, '0')}Z`;
  fs.writeFileSync(inbox, JSON.stringify({ decisions: [
    { product: slug, approval_id: ap[0].id, decision: 'approve', activate: true, at },
    { product: slug, approval_id: ap[1].id, decision: 'approve', at }] }));
  const r = run('apply-decisions.mjs', [inbox]);
  assert.equal(r.decisions, 2, JSON.stringify(r));
  const after = read('approvals.json');
  assert.equal(after[0].status, 'approved'); assert.equal(after[0].activate, true);
  assert.equal(after[1].status, 'approved'); assert.ok(!('activate' in after[1]), 'stays unset without the owner flag');
});

test('apply-decisions waits for the product lock and retries later instead of racing', () => {
  write('approvals.json', [{ id: 'A1', type: 'post', title: 'x', status: 'pending', compliance: 'pass' }]);
  const inbox = path.join(tmp, 'inbox-lock.json');
  fs.writeFileSync(inbox, JSON.stringify({ decisions: [{ product: slug, approval_id: 'A1', decision: 'reject', at: `2026-01-02T00:00:00.${process.pid % 1000}Z` }] }));
  const release = tryLock(productLockFile(dir), { owner: 'test' });
  try {
    const r = run('apply-decisions.mjs', [inbox]);
    assert.equal(r.decisions, 0); assert.match(r.errors.join(' '), /product lock held/);
    assert.equal(read('approvals.json')[0].status, 'pending');
  } finally { release(); }
  assert.equal(run('apply-decisions.mjs', [inbox]).decisions, 1, 'not marked applied while locked');
  assert.equal(read('approvals.json')[0].status, 'rejected');
});

test('a run whose move failed is not applied twice', () => {
  const body = { task_id: 'T9', agent: 'om-writer', status: 'done', summary: 'once',
    approvals: [{ type: 'post', title: 'Only one' }], new_tasks: [{ title: 'follow up', agent: 'om-editor' }], alerts: [{ title: 'once' }] };
  write('runs/T9.json', body);
  const raw = fs.readFileSync(P('runs/T9.json'));
  run('apply-results.mjs', [slug, '--now', '2026-01-03T00:00:00Z']);
  assert.ok(!queued('T9.json'));
  fs.writeFileSync(P('runs/T9.json'), raw); // as if the rename had failed
  const s = run('apply-results.mjs', [slug, '--now', '2026-01-03T01:00:00Z']);
  assert.equal(s.duplicates, 1); assert.equal(s.files, 0);
  assert.equal(read('approvals.json').length, 1);
  const tasks = read('tasks.json');
  assert.equal(tasks.length, 2, 'T9 plus one follow-up');
  assert.equal(tasks.find((t) => t.id === 'T9').attempts, 1);
  assert.equal(read('transitions.json').length, 1);
  assert.equal(read('alerts.json').length, 1);
  assert.ok(!queued('T9.json'), 'the move is retried');
  fs.rmSync(P('alerts.json'));
});

test('approval hints the new modules need are kept; status, compliance and activate never come from an agent', () => {
  write('runs/SEQ-2026-01-01.json', { task_id: 'SEQ-2026-01-01', agent: 'om-email-nurture', status: 'done', approvals: [
    { id: 'A-SEQ-1', type: 'send', title: 'Step 2', file: 'outbox/nurture-2.md', channel: 'email', target: 'L-1', lead: 'L-1', template: 'outbox/nurture-2.md',
      funnel_stage: 'mql', sequence: 'welcome', step: 2, manual: false, expires_at: '2026-01-08T00:00:00Z', quiet_hours: { start: '21:00', end: '08:00' },
      timezone: 'Europe/Berlin', utm_source: 'nurture', status: 'approved', compliance: 'pass', activate: true, executed_at: '2026-01-01T00:00:00Z', compliance_by: 'me' },
    { id: 'A-MMM-1', type: 'budget_shift', title: 'Shift', channel: 'google_ads', from_channel: 'meta_ads', amount: 10, currency: 'EUR' },
    { id: 'A-BIG', type: 'send', title: 'Huge hint', quiet_hours: { pad: 'x'.repeat(5000) }, template: 'y'.repeat(900) }] });
  run('apply-results.mjs', [slug, '--now', '2026-01-01T01:00:00Z']);
  const ap = read('approvals.json');
  const s = ap.find((x) => x.id === 'A-SEQ-1');
  assert.deepEqual({ lead: s.lead, template: s.template, funnel_stage: s.funnel_stage, sequence: s.sequence, step: s.step, manual: s.manual, expires_at: s.expires_at,
    quiet_hours: s.quiet_hours, timezone: s.timezone, utm_source: s.utm_source, channel: s.channel, target: s.target },
  { lead: 'L-1', template: 'outbox/nurture-2.md', funnel_stage: 'mql', sequence: 'welcome', step: 2, manual: false, expires_at: '2026-01-08T00:00:00Z',
    quiet_hours: { start: '21:00', end: '08:00' }, timezone: 'Europe/Berlin', utm_source: 'nurture', channel: 'email', target: 'L-1' });
  assert.equal(s.status, 'pending'); assert.equal(s.compliance, 'unchecked');
  assert.ok(!('activate' in s)); assert.equal(s.activate_requested, true);
  assert.ok(!('executed_at' in s)); assert.ok(!('compliance_by' in s));
  const m = ap.find((x) => x.id === 'A-MMM-1');
  assert.equal(m.from_channel, 'meta_ads'); assert.equal(m.amount, 10); assert.equal(m.currency, 'EUR');
  const big = ap.find((x) => x.id === 'A-BIG');
  assert.ok(!('quiet_hours' in big), 'oversized object hint dropped');
  assert.equal(big.template.length, 500);
  // Re-applying the same id adds no duplicate.
  write('runs/SEQ-2026-01-01b.json', { task_id: 'SEQ-2026-01-01', agent: 'om-email-nurture', status: 'done', approvals: [{ id: 'A-SEQ-1', type: 'send', title: 'again' }] });
  run('apply-results.mjs', [slug, '--now', '2026-01-01T02:00:00Z']);
  assert.equal(read('approvals.json').filter((x) => x.id === 'A-SEQ-1').length, 1);
});

test('a voice-guard review sets compliance on pending approvals only, and only from a known reviewer', () => {
  write('approvals.json', [
    { id: 'A1', type: 'publish', title: 'Post', status: 'pending', compliance: 'unchecked' },
    { id: 'A2', type: 'publish', title: 'Done', status: 'approved', compliance: 'pass' }]);
  write('runs/REVIEW-voice-guard-2026-01-01.json', { task_id: 'REVIEW-voice-guard-2026-01-01', agent: 'om-micro-claim-check', status: 'done', summary: 'guard', output: ['reports/voice-guard.json'],
    reviews: [{ approval_id: 'A1', compliance: 'fix', notes: 'unbacked number' }, { approval_id: 'A2', compliance: 'block', notes: 'late' }, { approval_id: 'A1', compliance: 'approved' }] });
  write('runs/REVIEW-rogue.json', { agent: 'om-writer', reviews: [{ approval_id: 'A1', compliance: 'block' }] });
  run('apply-results.mjs', [slug, '--now', '2026-01-01T01:00:00Z']);
  const ap = read('approvals.json');
  const a1 = ap.find((x) => x.id === 'A1');
  assert.equal(a1.compliance, 'fix'); assert.equal(a1.compliance_by, 'om-micro-claim-check'); assert.equal(a1.review_notes, 'unbacked number');
  assert.equal(a1.status, 'pending', 'a review never changes status');
  const a2 = ap.find((x) => x.id === 'A2');
  assert.equal(a2.compliance, 'pass'); assert.equal(a2.status, 'approved');
});
