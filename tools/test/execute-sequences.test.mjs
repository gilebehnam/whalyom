// Executor send guards for sequences and replies: suppressCheck() from tools/sequences.mjs, the hashed
// suppression list from tools/inbox.mjs, expiry and quiet hours. No keys are set, so a send that passes
// every guard reaches the connector step and waits for a key; nothing goes out.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testEnv } from './_env.mjs';
import { hashEmail } from '../inbox.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const slug = `zz-exec-seq-${process.pid}`;
const P = (f = '') => path.join(root, 'products', slug, f);
const noKeys = testEnv(Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(META_|RESEND_|OM_WEBHOOK_|OM_SITE_REPO|STRIPE_|OM_KILL|OM_SCHEDULER_HOLDER)/.test(k))));
// 14:00 UTC: outside the default quiet hours (21-8) in UTC.
const NOON = '2026-11-04T14:00:00.000Z';
const run = (args = []) => {
  const r = spawnSync(process.execPath, [path.join(root, 'tools', 'execute.mjs'), slug, ...args], { encoding: 'utf8', env: noKeys, cwd: root });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return JSON.parse(r.stdout.trim().split(/\r?\n/).at(-1));
};
const write = (f, v) => { fs.mkdirSync(path.dirname(P(f)), { recursive: true }); fs.writeFileSync(P(f), typeof v === 'string' ? v : JSON.stringify(v)); };
const approvalsById = () => Object.fromEntries(JSON.parse(fs.readFileSync(P('approvals.json'), 'utf8')).map((a) => [a.id, a]));
const resultOf = (out, id) => out.items.find((i) => i.id === id)?.result;

const lead = (id, extra = {}) => ({ id, stage: 'engaged', consent: 'opted-in', email_hash: hashEmail(`${id}@example.test`), ...extra });
const seqSend = (id, leadId, extra = {}) => ({ id, type: 'send', channel: 'email', title: `Step for ${leadId}`, file: 'outbox/email/step1.md', target: leadId, lead: leadId, sequence: 'welcome', step: 0, status: 'approved', ...extra });
const enrolled = (pairs) => ({ enrollments: Object.fromEntries(pairs.map(([leadId, apId, status = 'active']) => [leadId, { welcome: { sequence: 'welcome', status, step: 0, pending: status === 'active' ? { approval_id: apId, step: 0 } : null, history: [{ step: 0, approval_id: apId, status: 'proposed' }] } }])) });

beforeEach(() => {
  fs.rmSync(P(), { recursive: true, force: true });
  write('product.json', { name: 'Exec Seq Test', stage: 'active', budget: { mode: 'free' }, autonomy: {} });
  write('outbox/email/step1.md', '---\nsubject: Hello\n---\nHello there.\n');
});
after(() => { fs.rmSync(P(), { recursive: true, force: true }); });

test('a live sequence send passes the guards; a stopped enrolment is skipped as suppressed', () => {
  write('funnel/pipeline.json', { leads: [lead('L-ok'), lead('L-stop'), lead('L-unsub', { unsubscribed: true })] });
  write('funnel/sequence-state.json', enrolled([['L-ok', 'SEQ-welcome-L-ok-1-0'], ['L-stop', 'SEQ-welcome-L-stop-1-0', 'stopped'], ['L-unsub', 'SEQ-welcome-L-unsub-1-0']]));
  write('approvals.json', [seqSend('SEQ-welcome-L-ok-1-0', 'L-ok'), seqSend('SEQ-welcome-L-stop-1-0', 'L-stop'), seqSend('SEQ-welcome-L-unsub-1-0', 'L-unsub')]);
  const out = run(['--now', NOON]);
  assert.equal(resultOf(out, 'SEQ-welcome-L-ok-1-0'), 'waiting for connector key');
  assert.equal(resultOf(out, 'SEQ-welcome-L-stop-1-0'), 'skipped (suppressed)');
  assert.equal(resultOf(out, 'SEQ-welcome-L-unsub-1-0'), 'skipped (suppressed)');
  const ap = approvalsById();
  assert.equal(ap['SEQ-welcome-L-ok-1-0'].status, 'approved');
  assert.equal(ap['SEQ-welcome-L-stop-1-0'].status, 'skipped-suppressed');
  assert.match(ap['SEQ-welcome-L-stop-1-0'].review_notes, /enrollment_stopped/);
  assert.equal(ap['SEQ-welcome-L-unsub-1-0'].status, 'skipped-suppressed');
  assert.match(ap['SEQ-welcome-L-unsub-1-0'].review_notes, /unsubscribe/);
  assert.equal(out.executed, 0);
});

test('a merged approval with only an SEQ- id and target is still checked', () => {
  write('funnel/pipeline.json', { leads: [lead('L-a')] });
  write('funnel/sequence-state.json', { enrollments: {} });
  write('approvals.json', [{ id: 'SEQ-welcome-L-a-1-0', type: 'send', channel: 'email', title: 'x', file: 'outbox/email/step1.md', target: 'L-a', status: 'auto-approved' }]);
  const out = run(['--now', NOON]);
  assert.equal(resultOf(out, 'SEQ-welcome-L-a-1-0'), 'skipped (suppressed)');
  assert.match(approvalsById()['SEQ-welcome-L-a-1-0'].review_notes, /not_enrolled/);
});

test('suppression.json blocks every send to the lead, by lead id or by email hash, sequence or not', () => {
  write('funnel/pipeline.json', { leads: [lead('L-ok'), lead('L-hash'), lead('L-id')] });
  write('funnel/sequence-state.json', enrolled([['L-ok', 'SEQ-welcome-L-ok-1-0'], ['L-hash', 'SEQ-welcome-L-hash-1-0']]));
  write('suppression.json', { updated_at: NOON, entries: [{ email_hash: hashEmail('L-hash@example.test'), at: NOON, reason: 'unsubscribe', source: 'inbox' }, { lead: 'L-id', at: NOON, reason: 'bounced', source: 'inbox' }] });
  write('approvals.json', [
    seqSend('SEQ-welcome-L-ok-1-0', 'L-ok'),
    seqSend('SEQ-welcome-L-hash-1-0', 'L-hash'),
    { id: 'A-reply-1', type: 'reply', channel: 'email', title: 'Answer', file: 'outbox/email/step1.md', lead: 'L-id', status: 'approved' },
    { id: 'A-raw', type: 'send', channel: 'email', title: 'Raw', file: 'outbox/email/step1.md', email_hash: hashEmail('L-hash@example.test'), status: 'approved' },
  ]);
  const out = run(['--now', NOON]);
  assert.equal(resultOf(out, 'SEQ-welcome-L-ok-1-0'), 'waiting for connector key');
  for (const id of ['SEQ-welcome-L-hash-1-0', 'A-reply-1', 'A-raw']) assert.equal(resultOf(out, id), 'skipped (suppressed)', id);
  const ap = approvalsById();
  assert.equal(ap['A-reply-1'].status, 'skipped-suppressed');
  assert.match(ap['A-reply-1'].review_notes, /suppression\.json/);
  // No raw address is written into approvals.json or events.
  const all = fs.readFileSync(P('approvals.json'), 'utf8') + (fs.existsSync(P('events.jsonl')) ? fs.readFileSync(P('events.jsonl'), 'utf8') : '');
  assert.doesNotMatch(all, /@example\.test/);
});

test('an unreadable suppression.json holds lead sends without changing them; other items are unaffected', () => {
  write('funnel/pipeline.json', { leads: [lead('L-ok')] });
  write('funnel/sequence-state.json', enrolled([['L-ok', 'SEQ-welcome-L-ok-1-0']]));
  write('suppression.json', '{ not json');
  write('approvals.json', [seqSend('SEQ-welcome-L-ok-1-0', 'L-ok'), { id: 'A-post', type: 'post', channel: 'x', title: 'Post', file: 'outbox/email/step1.md', status: 'approved' }]);
  const out = run(['--now', NOON]);
  assert.equal(resultOf(out, 'SEQ-welcome-L-ok-1-0'), 'held');
  assert.notEqual(resultOf(out, 'A-post'), 'held');
  assert.equal(approvalsById()['SEQ-welcome-L-ok-1-0'].status, 'approved');
});

test('missing sequence state holds sequence sends (fail closed, not terminal)', () => {
  write('funnel/pipeline.json', { leads: [lead('L-ok')] });
  write('approvals.json', [seqSend('SEQ-welcome-L-ok-1-0', 'L-ok')]);
  const out = run(['--now', NOON]);
  assert.equal(resultOf(out, 'SEQ-welcome-L-ok-1-0'), 'held');
  assert.match(out.items[0].why, /sequence-state\.json is missing/);
  assert.equal(approvalsById()['SEQ-welcome-L-ok-1-0'].status, 'approved');
});

test('an expired item is marked expired and never sent', () => {
  write('funnel/pipeline.json', { leads: [lead('L-ok'), lead('L-late')] });
  write('funnel/sequence-state.json', enrolled([['L-ok', 'SEQ-welcome-L-ok-1-0'], ['L-late', 'SEQ-welcome-L-late-1-0']]));
  write('approvals.json', [seqSend('SEQ-welcome-L-ok-1-0', 'L-ok', { expires_at: '2026-11-10T00:00:00.000Z' }), seqSend('SEQ-welcome-L-late-1-0', 'L-late', { expires_at: '2026-11-01T00:00:00.000Z' })]);
  const out = run(['--now', NOON]);
  assert.equal(resultOf(out, 'SEQ-welcome-L-ok-1-0'), 'waiting for connector key');
  assert.equal(resultOf(out, 'SEQ-welcome-L-late-1-0'), 'skipped (expired)');
  assert.equal(approvalsById()['SEQ-welcome-L-late-1-0'].status, 'expired');
});

test('quiet hours defer the send in the lead time zone and leave the approval as it was', () => {
  write('funnel/pipeline.json', { leads: [lead('L-ny', { timezone: 'America/New_York' }), lead('L-tokyo', { timezone: 'Asia/Tokyo' })] });
  write('funnel/sequence-state.json', enrolled([['L-ny', 'SEQ-welcome-L-ny-1-0'], ['L-tokyo', 'SEQ-welcome-L-tokyo-1-0']]));
  write('approvals.json', [seqSend('SEQ-welcome-L-ny-1-0', 'L-ny'), seqSend('SEQ-welcome-L-tokyo-1-0', 'L-tokyo', { quiet_hours: { start: 21, end: 8 }, timezone: 'Asia/Tokyo' })]);
  // 14:00 UTC is 09:00 in New York (allowed) and 23:00 in Tokyo (quiet).
  const out = run(['--now', NOON]);
  assert.equal(resultOf(out, 'SEQ-welcome-L-ny-1-0'), 'waiting for connector key');
  assert.equal(resultOf(out, 'SEQ-welcome-L-tokyo-1-0'), 'deferred (quiet hours)');
  const ap = approvalsById();
  assert.equal(ap['SEQ-welcome-L-tokyo-1-0'].status, 'approved');
  assert.equal(ap['SEQ-welcome-L-tokyo-1-0'].waiting_since, undefined);
  // The default quiet hours (21-8) apply to sequence sends without their own setting: 03:00 UTC is quiet.
  const night = run(['--now', '2026-11-05T03:00:00.000Z']);
  assert.equal(resultOf(night, 'SEQ-welcome-L-ny-1-0'), 'deferred (quiet hours)');
});

test('a dry run reports the guards and writes nothing', () => {
  write('funnel/pipeline.json', { leads: [lead('L-stop')] });
  write('funnel/sequence-state.json', enrolled([['L-stop', 'SEQ-welcome-L-stop-1-0', 'stopped']]));
  write('approvals.json', [seqSend('SEQ-welcome-L-stop-1-0', 'L-stop')]);
  const before = fs.readFileSync(P('approvals.json'), 'utf8');
  const out = run(['--dry-run', '--now', NOON]);
  assert.equal(resultOf(out, 'SEQ-welcome-L-stop-1-0'), 'skipped (suppressed)');
  assert.equal(fs.readFileSync(P('approvals.json'), 'utf8'), before);
  assert.equal(fs.existsSync(P('events.jsonl')), false);
});

test('a send with only a raw address (no lead id or hash) is still checked against suppression.json', () => {
  write('suppression.json', [{ email_hash: hashEmail('gone@example.test'), at: NOON, reason: 'unsubscribe', source: 'inbox' }]);
  write('approvals.json', [{ id: 'A-to', type: 'email', channel: 'email', title: 'Raw to', file: 'outbox/email/step1.md', to: 'Gone@Example.test ', status: 'approved' }]);
  const out = run(['--now', NOON]);
  assert.equal(resultOf(out, 'A-to'), 'skipped (suppressed)');
  assert.equal(approvalsById()['A-to'].status, 'skipped-suppressed');
});
