// Autonomous sequences: leads in a funnel stage enter a multi-step sequence, each due step becomes a pending
// "send" approval (never a send), the next step waits for the previous one to be executed, and the guards
// hold: unknown consent never enters, SMS needs opt-in, reply / won / unsubscribe stop, quiet hours and
// frequency caps defer, budget caps block paid steps, paused products do nothing. File tests use a temp
// root, so the repo is never touched.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planSequences, validateSequence, runSequences, writeSequenceState, suppressCheck, inQuietHours, templateFile, hourIn } from '../sequences.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-seq-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const NOW = '2026-11-04T14:00:00.000Z'; // 14:00 UTC, outside default quiet hours
const H = 3600000;
const at = (iso, hours) => new Date(Date.parse(iso) + hours * H).toISOString();
const product = { stage: 'growth', budget: { mode: 'free', monthly_cap: 0, daily_cap: 0, currency: 'USD' }, channels: { enabled: ['email', 'social'] } };
const lead = (id, extra = {}) => ({ id, stage: 'new', stage_at: '2026-11-04T10:00:00.000Z', consent: 'opted-in', channel: 'organic', last_channel: 'organic', history: [{ stage: 'new', at: '2026-11-04T10:00:00.000Z', source: 'lead' }], ...extra });
const seqDef = (extra = {}) => ({ id: 'welcome', name: 'Welcome', trigger: { stage: 'new' }, steps: [
  { delay_hours: 0, channel: 'email', template: 'sequences/w1.md' },
  { delay_hours: 48, channel: 'email', template: 'sequences/w2.md' },
], ...extra });
const seq = (extra) => { const v = validateSequence(seqDef(extra)); assert.ok(v.ok, v.errors.join('; ')); return v.sequence; };

test('validation: bad definitions are reported, templates must stay inside outbox/', () => {
  assert.equal(templateFile('sequences/a.md'), 'outbox/sequences/a.md');
  assert.equal(templateFile('outbox/a.md'), 'outbox/a.md');
  assert.equal(templateFile('../secrets.md'), null);
  assert.equal(templateFile('a/../../x.md'), null);
  assert.equal(templateFile('C:/x.md'), null);
  assert.equal(templateFile(''), null);
  const bad = validateSequence({ trigger: { stage: 'whatever' }, steps: [{ channel: 'fax', template: '../x', delay_hours: -1 }], stop: ['moon'] });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /unknown stage/.test(e)));
  assert.ok(bad.errors.some((e) => /channel "fax"/.test(e)));
  assert.ok(bad.errors.some((e) => /inside outbox/.test(e)));
  assert.ok(bad.errors.some((e) => /negative/.test(e)));
  assert.ok(bad.errors.some((e) => /moon/.test(e)));
  assert.equal(validateSequence(null).ok, false);
  assert.equal(validateSequence({ trigger: { stage: 'new' }, steps: [] }).ok, false);
  const missing = validateSequence(seqDef(), { templateExists: () => false });
  assert.ok(missing.errors.some((e) => /does not exist/.test(e)));
  // unsubscribe and no_consent cannot be switched off
  assert.deepEqual(seq({ stop: ['reply'] }).stop, ['no_consent', 'reply', 'unsubscribe']);
  // stage aliases map to canonical stages
  assert.deepEqual(seq({ trigger: { stage: ['signup', 'trial'] } }).trigger.stages, ['new', 'opportunity']);
});

test('main path: due step becomes a pending send proposal; next step waits for execution and its delay', () => {
  const s = seq();
  const p1 = planSequences({ pipeline: { leads: [lead('L-a')] }, sequences: [s], product, now: NOW });
  assert.equal(p1.stats.enrolled, 1);
  assert.equal(p1.approvals.length, 1);
  const ap = p1.approvals[0];
  assert.equal(ap.type, 'send');
  assert.equal(ap.channel, 'email');
  assert.equal(ap.lead, 'L-a');
  assert.equal(ap.target, 'L-a');
  assert.equal(ap.template, 'sequences/w1.md');
  assert.equal(ap.file, 'outbox/sequences/w1.md');
  assert.equal(ap.funnel_stage, 'contacted', 'stage the executor records after the send');
  assert.equal(ap.sequence, 'welcome');
  assert.equal(ap.step, 1);
  assert.equal(ap.status, undefined, 'proposals carry no status; apply-results sets pending');
  assert.ok(!JSON.stringify(p1).includes('@'), 'no email addresses anywhere');

  // Deterministic: same input, same output.
  assert.deepEqual(planSequences({ pipeline: { leads: [lead('L-a')] }, sequences: [s], product, now: NOW }), p1);

  // Still pending: nothing new, even long after the delay.
  const later = at(NOW, 50);
  const p2 = planSequences({ pipeline: { leads: [lead('L-a')] }, sequences: [s], state: p1.state, approvals: [{ id: ap.id, status: 'pending' }], product, now: later });
  assert.equal(p2.approvals.length, 0);
  assert.equal(p2.stats.waiting_approval, 1);

  // Executed at NOW+1h: step 2 is due 48 h after that, not before.
  const exec = [{ id: ap.id, status: 'executed', executed_at: at(NOW, 1) }];
  const early = planSequences({ pipeline: { leads: [lead('L-a')] }, sequences: [s], state: p1.state, approvals: exec, product, now: at(NOW, 30) });
  assert.equal(early.approvals.length, 0);
  assert.equal(early.stats.not_due, 1);
  const p3 = planSequences({ pipeline: { leads: [lead('L-a')] }, sequences: [s], state: p1.state, approvals: exec, product, now: at(NOW, 49) });
  assert.equal(p3.approvals.length, 1);
  assert.equal(p3.approvals[0].step, 2);
  assert.equal(p3.approvals[0].template, 'sequences/w2.md');
  assert.notEqual(p3.approvals[0].id, ap.id);

  // Step 2 executed: the enrolment completes and never re-enters.
  const p4 = planSequences({ pipeline: { leads: [lead('L-a')] }, sequences: [s], state: p3.state, approvals: [...exec, { id: p3.approvals[0].id, status: 'executed', executed_at: at(NOW, 50) }], product, now: at(NOW, 200) });
  assert.equal(p4.stats.completed, 1);
  assert.equal(p4.state.enrollments['L-a'].welcome.status, 'completed');
  const p5 = planSequences({ pipeline: { leads: [lead('L-a')] }, sequences: [s], state: p4.state, product, now: at(NOW, 400) });
  assert.equal(p5.approvals.length, 0);
  assert.equal(p5.stats.enrolled, 0);
});

test('guard: unknown consent never enters; SMS needs opt-in; channels must be enabled', () => {
  const s = seq({ steps: [{ delay_hours: 0, channel: 'sms', template: 's.md' }, { delay_hours: 0, channel: 'email', template: 'e.md' }] });
  const prod = { ...product, channels: { enabled: ['email', 'sms'] } };
  const r = planSequences({ pipeline: { leads: [lead('L-u', { consent: 'unknown' }), lead('L-i', { consent: 'inbound' }), lead('L-n', { consent: undefined })] }, sequences: [s], product: prod, now: NOW });
  assert.equal(r.state.enrollments['L-u'], undefined);
  assert.equal(r.state.enrollments['L-n'], undefined);
  // inbound: SMS skipped (needs opt-in), email goes
  assert.equal(r.approvals.length, 1);
  assert.equal(r.approvals[0].lead, 'L-i');
  assert.equal(r.approvals[0].channel, 'email');
  assert.equal(r.state.enrollments['L-i'].welcome.history[0].status, 'skipped_consent');
  // sequence consent cannot loosen SMS
  const loose = seq({ consent: ['inbound'], steps: [{ delay_hours: 0, channel: 'sms', template: 's.md' }] });
  assert.equal(planSequences({ pipeline: { leads: [lead('L-i', { consent: 'inbound' })] }, sequences: [loose], product: prod, now: NOW }).approvals.length, 0);
  // per-channel consent wins over the lead-wide value
  const ok = planSequences({ pipeline: { leads: [lead('L-c', { consent: 'inbound', channel_consent: { sms: 'opted-in' } })] }, sequences: [loose], product: prod, now: NOW });
  assert.equal(ok.approvals[0].channel, 'sms');
  // WhatsApp not in channels.enabled: the step is skipped, no proposal
  const wa = seq({ steps: [{ delay_hours: 0, channel: 'whatsapp', template: 'w.md' }] });
  const off = planSequences({ pipeline: { leads: [lead('L-w')] }, sequences: [wa], product, now: NOW });
  assert.equal(off.approvals.length, 0);
  assert.equal(off.stats.skipped_channel, 1);
  // LinkedIn steps are manual tasks for the owner
  const li = seq({ steps: [{ delay_hours: 0, channel: 'linkedin', template: 'li.md' }] });
  assert.equal(planSequences({ pipeline: { leads: [lead('L-l')] }, sequences: [li], product, now: NOW }).approvals[0].manual, true);
});

test('trigger: stage, channel and segment filters', () => {
  const s = seq({ trigger: { stage: 'qualified', channel: 'community', segment: 'agency' } });
  const leads = [
    lead('L-1', { stage: 'qualified', channel: 'community', segment: 'agency' }),
    lead('L-2', { stage: 'qualified', channel: 'organic', last_channel: 'organic', segment: 'agency' }),
    lead('L-3', { stage: 'qualified', channel: 'community', segment: 'store' }),
    lead('L-4', { stage: 'new', channel: 'community', segment: 'agency' }),
    lead('L-5', { stage: 'qualified', channel: 'organic', last_channel: 'community', segments: ['agency'] }),
  ];
  const r = planSequences({ pipeline: { leads }, sequences: [s], product, now: NOW });
  assert.deepEqual(r.approvals.map((a) => a.lead), ['L-1', 'L-5']);
});

test('stop rules: reply, won, unsubscribe and owner rejection stop the sequence and flag open approvals', () => {
  const s = seq();
  const base = planSequences({ pipeline: { leads: [lead('L-r'), lead('L-w'), lead('L-x'), lead('L-j'), lead('L-k')] }, sequences: [s], product, now: NOW });
  assert.equal(base.approvals.length, 5);
  const ids = Object.fromEntries(base.approvals.map((a) => [a.lead, a.id]));
  const t = at(NOW, 2);
  const leads = [
    lead('L-r', { stage: 'engaged', history: [...lead('x').history, { stage: 'engaged', at: t, source: 'update' }] }),
    lead('L-w', { stage: 'won' }),
    lead('L-x', { stage: 'lost', lost_reason: 'unsubscribed', history: [...lead('x').history, { stage: 'lost', at: t, reason: 'unsubscribe link' }] }),
    lead('L-j'),
    // our own send moved the lead to "contacted": that is not a reply
    lead('L-k', { stage: 'contacted', history: [...lead('x').history, { stage: 'contacted', at: t, source: 'om-email-nurture' }] }),
  ];
  const approvals = [{ id: ids['L-j'], status: 'rejected' }, { id: ids['L-k'], status: 'executed', executed_at: t }];
  const r = planSequences({ pipeline: { leads }, sequences: [s], state: base.state, approvals, product, now: at(NOW, 3) });
  const e = (id) => r.state.enrollments[id].welcome;
  assert.equal(e('L-r').stop_reason, 'reply');
  assert.equal(e('L-w').stop_reason, 'won');
  assert.equal(e('L-x').stop_reason, 'unsubscribe');
  assert.equal(e('L-j').stop_reason, 'rejected_by_owner');
  assert.equal(e('L-k').status, 'active');
  assert.equal(r.approvals.length, 0);
  // the three still-open approvals of stopped leads raise an alert each; the rejected one does not
  assert.equal(r.alerts.length, 3);
  assert.ok(r.alerts.every((a) => /^Reject sequence step SEQ-/.test(a.title)));
  // the executor drops them
  assert.equal(suppressCheck(base.approvals.find((a) => a.lead === 'L-x'), { pipeline: { leads }, state: r.state }).suppress, true);
  assert.equal(suppressCheck(base.approvals.find((a) => a.lead === 'L-r'), { pipeline: { leads }, state: r.state }).suppress, true);
  assert.equal(suppressCheck({ type: 'publish' }, {}).suppress, false);
  // unsubscribe stops every sequence and blocks new ones
  const other = seq({ id: 'other', trigger: { stage: 'lost' } });
  assert.equal(planSequences({ pipeline: { leads }, sequences: [s, other], state: r.state, product, now: at(NOW, 4) }).state.enrollments['L-x'].other, undefined);
});

test('sequences triggered on won ignore the won stop; a pending step expires after stale_hours', () => {
  const onb = seq({ id: 'onboard', trigger: { stage: 'won' } });
  const r = planSequences({ pipeline: { leads: [lead('L-w', { stage: 'won' })] }, sequences: [onb], product, now: NOW });
  assert.equal(r.approvals.length, 1);
  const r2 = planSequences({ pipeline: { leads: [lead('L-w', { stage: 'won' })] }, sequences: [onb], state: r.state, approvals: [{ id: r.approvals[0].id, status: 'executed', executed_at: NOW }], product, now: at(NOW, 49) });
  assert.equal(r2.approvals.length, 1);
  const stale = planSequences({ pipeline: { leads: [lead('L-w', { stage: 'won' })] }, sequences: [onb], state: r2.state, approvals: [], product, now: at(NOW, 49 + 169) });
  assert.equal(stale.state.enrollments['L-w'].onboard.status, 'expired');
  assert.equal(stale.alerts.length, 1);
});

test('quiet hours in the lead time zone defer the step', () => {
  assert.equal(hourIn('2026-11-04T14:00:00Z', 'UTC'), 14);
  assert.equal(hourIn('2026-11-04T14:00:00Z', 'Not/AZone'), 14);
  assert.equal(inQuietHours('2026-11-04T23:00:00Z', { start: 21, end: 8 }, 'UTC'), true);
  assert.equal(inQuietHours('2026-11-04T07:00:00Z', { start: 21, end: 8 }, 'UTC'), true);
  assert.equal(inQuietHours('2026-11-04T12:00:00Z', { start: 21, end: 8 }, 'UTC'), false);
  assert.equal(inQuietHours('2026-11-04T12:00:00Z', { start: 12, end: 14 }, 'UTC'), true);
  assert.equal(inQuietHours('2026-11-04T12:00:00Z', { start: 5, end: 5 }, 'UTC'), false);
  // 14:00 UTC is 23:00 in Tokyo
  const s = seq();
  const r = planSequences({ pipeline: { leads: [lead('L-t', { timezone: 'Asia/Tokyo' }), lead('L-u')] }, sequences: [s], product, now: NOW });
  assert.deepEqual(r.approvals.map((a) => a.lead), ['L-u']);
  assert.equal(r.stats.deferred_quiet, 1);
  assert.equal(r.state.enrollments['L-t'].welcome.status, 'active');
});

test('caps: per lead across sequences, per step and per sequence per day', () => {
  const a = seq({ id: 'a' }); const b = seq({ id: 'b' });
  const r = planSequences({ pipeline: { leads: [lead('L-1')] }, sequences: [a, b], product, now: NOW });
  assert.equal(r.approvals.length, 1, 'one send per lead per day across all sequences');
  assert.equal(r.approvals[0].sequence, 'a');
  assert.equal(r.stats.deferred_cap, 1);
  // min gap: 10 h later still blocked, 21 h later (next day, gap > 20 h) the other sequence goes
  assert.equal(planSequences({ pipeline: { leads: [lead('L-1')] }, sequences: [a, b], state: r.state, product, now: at(NOW, 10) }).approvals.length, 0);
  const n = planSequences({ pipeline: { leads: [lead('L-1')] }, sequences: [a, b], state: r.state, product, now: at(NOW, 25) });
  assert.deepEqual(n.approvals.map((x) => x.sequence), ['b']);
  // per-step and per-sequence daily volume caps
  const leads = ['L-1', 'L-2', 'L-3'].map((id) => lead(id));
  const step = validateSequence({ ...seqDef(), steps: [{ delay_hours: 0, channel: 'email', template: 'x.md', max_per_day: 2 }] }).sequence;
  assert.equal(planSequences({ pipeline: { leads }, sequences: [step], product, now: NOW }).approvals.length, 2);
  assert.equal(planSequences({ pipeline: { leads }, sequences: [seq({ max_per_day: 1 })], product, now: NOW }).approvals.length, 1);
  // owner caps in product.json
  const loose = { ...product, sequences: { caps: { per_day: 5, per_week: 5, min_gap_hours: 0 } } };
  assert.equal(planSequences({ pipeline: { leads: [lead('L-1')] }, sequences: [a, b], product: loose, now: NOW }).approvals.length, 2);
});

test('budget: paid steps need a paid budget and stay inside the caps', () => {
  const sms = validateSequence({ ...seqDef(), steps: [{ delay_hours: 0, channel: 'sms', template: 's.md', cost: 0.5 }] }).sequence;
  const leads = ['L-1', 'L-2', 'L-3'].map((id) => lead(id));
  const prodFree = { ...product, channels: { enabled: ['sms'] } };
  assert.equal(planSequences({ pipeline: { leads }, sequences: [sms], product: prodFree, now: NOW }).stats.skipped_budget, 3);
  const paid = { ...prodFree, budget: { mode: 'paid', daily_cap: 1, monthly_cap: 100, spent_this_month: 0, currency: 'EUR' } };
  const r = planSequences({ pipeline: { leads }, sequences: [sms], product: paid, now: NOW });
  assert.equal(r.approvals.length, 2);
  assert.equal(r.approvals[0].amount, 0.5);
  assert.equal(r.approvals[0].currency, 'EUR');
  assert.equal(r.stats.skipped_budget, 1);
  const monthFull = { ...paid, budget: { ...paid.budget, spent_this_month: 100 } };
  assert.equal(planSequences({ pipeline: { leads }, sequences: [sms], product: monthFull, now: NOW }).approvals.length, 0);
});

test('guard: paused product, disabled sequences, bots and bad input do nothing', () => {
  const s = seq();
  assert.equal(planSequences({ pipeline: { leads: [lead('L-1')] }, sequences: [s], product: { ...product, stage: 'paused' }, now: NOW }).approvals.length, 0);
  assert.equal(planSequences({ pipeline: { leads: [lead('L-1')] }, sequences: [s], product: { ...product, sequences: { enabled: false } }, now: NOW }).approvals.length, 0);
  assert.equal(planSequences({ pipeline: { leads: [lead('L-1')] }, sequences: [{ ...s, enabled: false }], product, now: NOW }).approvals.length, 0);
  assert.equal(planSequences({ pipeline: { leads: [lead('L-b', { suspected_bot: true })] }, sequences: [s], product, now: NOW }).approvals.length, 0);
  const junk = planSequences({ pipeline: { leads: [null, 7, {}, lead('L-1')] }, sequences: [s, null], state: { enrollments: {} }, approvals: 'nope', product: null, now: NOW });
  assert.equal(junk.approvals.length, 1);
  assert.equal(planSequences({ pipeline: null, sequences: [s], now: NOW }).approvals.length, 0);
  assert.throws(() => planSequences({ pipeline: { leads: [] }, now: 'not a date' }), /ISO/);
});

test('files: runSequences writes state and a SEQ run file for apply-results, idempotent within a day', () => {
  const dir = path.join(tmp, 'products', 'acme');
  fs.mkdirSync(path.join(dir, 'funnel'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'sequences'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'outbox', 'sequences'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'product.json'), JSON.stringify(product));
  fs.writeFileSync(path.join(dir, 'outbox', 'sequences', 'w1.md'), '# Hi');
  fs.writeFileSync(path.join(dir, 'outbox', 'sequences', 'w2.md'), '# Again');
  fs.writeFileSync(path.join(dir, 'sequences', 'welcome.json'), JSON.stringify(seqDef()));
  fs.writeFileSync(path.join(dir, 'sequences', 'broken.json'), '{ nope');
  fs.writeFileSync(path.join(dir, 'sequences', 'missing.json'), JSON.stringify({ ...seqDef(), id: 'missing', steps: [{ delay_hours: 0, channel: 'email', template: 'nope.md' }] }));
  fs.writeFileSync(path.join(dir, 'funnel', 'pipeline.json'), JSON.stringify({ leads: [lead('L-a'), lead('L-b', { consent: 'unknown' })] }));

  const dry = runSequences('acme', { rootDir: tmp, now: NOW, dryRun: true });
  assert.equal(dry.proposed, 1);
  assert.equal(fs.existsSync(path.join(dir, 'funnel', 'sequence-state.json')), false, 'dry run writes nothing');

  const r = runSequences('acme', { rootDir: tmp, now: NOW });
  assert.equal(r.sequences, 1);
  assert.equal(r.errors.length, 2);
  assert.equal(r.run_file, 'products/acme/runs/SEQ-2026-11-04.json');
  const run = JSON.parse(fs.readFileSync(path.join(tmp, r.run_file), 'utf8'));
  assert.equal(run.task_id, 'SEQ-2026-11-04');
  assert.equal(run.status, 'done');
  assert.equal(run.approvals.length, 1);
  assert.equal(run.approvals[0].type, 'send');
  assert.equal(run.alerts.length, 2, 'invalid definitions surface as alerts');
  const st = JSON.parse(fs.readFileSync(path.join(dir, 'funnel', 'sequence-state.json'), 'utf8'));
  assert.ok(st.enrollments['L-a'].welcome.pending);
  assert.equal(st.enrollments['L-b'], undefined);

  // A second run the same day adds nothing and keeps the first proposal.
  const again = runSequences('acme', { rootDir: tmp, now: at(NOW, 1) });
  assert.equal(again.proposed, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, r.run_file), 'utf8')).approvals.length, 1);

  // Shared state: counts only, no lead ids.
  assert.equal(writeSequenceState(['acme', '../evil'], { rootDir: tmp, now: NOW }), 1);
  const shared = fs.readFileSync(path.join(tmp, 'state', 'sequences.json'), 'utf8');
  assert.ok(!shared.includes('L-a'));
  assert.equal(JSON.parse(shared).sequences[0].waiting_approval, 1);

  assert.throws(() => runSequences('../acme', { rootDir: tmp }), /invalid product slug/);
  assert.throws(() => runSequences('ghost', { rootDir: tmp }), /no product.json/);
});

test('review fixes: merged approvals still suppressed, own sends are not replies, no back-fill, unique ids', () => {
  const s = seq({ steps: [{ delay_hours: 0, channel: 'email', template: 'a.md', title: 'Reply nudge: stop by' }, { delay_hours: 1, channel: 'email', template: 'b.md' }] });
  const loose = { ...product, sequences: { caps: { per_day: 9, per_week: 9, min_gap_hours: 0 } } };
  const r = planSequences({ pipeline: { leads: [lead('L-a')] }, sequences: [s], product: loose, now: NOW });
  const ap = r.approvals[0];
  assert.equal(ap.funnel_stage, 'contacted', 'a send to a new lead moves it to contacted');
  // What apply-results.mjs keeps of the proposal: no sequence, no lead field.
  const merged = { id: ap.id, type: 'send', channel: ap.channel, target: ap.target, task_id: 'SEQ-2026-11-04', status: 'approved' };
  const unsub = [lead('L-a', { unsubscribed: true })];
  assert.deepEqual(suppressCheck(merged, { pipeline: { leads: unsub }, state: r.state }), { suppress: true, reason: 'unsubscribe' });
  assert.equal(suppressCheck({ ...merged, target: undefined }, { pipeline: { leads: unsub }, state: r.state }).suppress, true);
  assert.equal(suppressCheck(merged, { pipeline: { leads: [lead('L-a')] }, state: r.state }).suppress, false);
  assert.equal(suppressCheck(merged, { pipeline: { leads: [lead('L-a')] }, state: {} }).suppress, true);
  // The executor logs the send with the step title ("Reply nudge: stop by"): that is no reply, no unsubscribe.
  const t = at(NOW, 1);
  const sent = lead('L-a', { stage: 'contacted', history: [...lead('x').history, { stage: 'contacted', at: t, source: 'om-executor', note: ap.title }] });
  const r2 = planSequences({ pipeline: { leads: [sent] }, sequences: [s], state: r.state, approvals: [{ id: ap.id, status: 'executed', executed_at: t }], product: loose, now: at(NOW, 3) });
  assert.equal(r2.state.enrollments['L-a'].welcome.status, 'active');
  assert.equal(r2.approvals.length, 1);
  // LinkedIn / manual hand-off counts as done; skipped-free-mode stops the sequence.
  const r3 = planSequences({ pipeline: { leads: [lead('L-a')] }, sequences: [s], state: r.state, approvals: [{ id: ap.id, status: 'approved-manual', decided_at: t }], product: loose, now: at(NOW, 3) });
  assert.equal(r3.approvals[0].step, 2);
  const r4 = planSequences({ pipeline: { leads: [lead('L-a')] }, sequences: [s], state: r.state, approvals: [{ id: ap.id, status: 'skipped-free-mode' }], product: loose, now: at(NOW, 3) });
  assert.equal(r4.state.enrollments['L-a'].welcome.status, 'stopped');
  // No back-fill: a lead that reached the stage 60 days ago is not enrolled unless enroll_existing.
  const old = lead('L-old', { stage_at: at(NOW, -24 * 60) });
  assert.equal(planSequences({ pipeline: { leads: [old] }, sequences: [s], product: loose, now: NOW }).approvals.length, 0);
  assert.equal(planSequences({ pipeline: { leads: [old] }, sequences: [seq({ enroll_existing: true })], product: loose, now: NOW }).approvals.length, 1);
  // Long ids with a shared prefix, or differing only by case, get distinct approval ids; emails are hashed in titles.
  const ids = planSequences({ pipeline: { leads: [lead('hubspot-contact-0000-12345'), lead('hubspot-contact-0000-12346'), lead('L-A'), lead('L-a'), lead('jo@example.com')] }, sequences: [s], product: loose, now: NOW }).approvals;
  assert.equal(new Set(ids.map((a) => a.id)).size, 5);
  assert.ok(!ids.some((a) => a.title.includes('@') || a.id.includes('example')));
  // A corrupt state file does not crash the planner.
  const bad = planSequences({ pipeline: { leads: [lead('L-a')] }, sequences: [s], state: { enrollments: { 'L-a': { welcome: { status: 'active', history: 'x', pending: 'y' } } } }, product: loose, now: NOW });
  assert.equal(bad.errors.length, 0);
});

test('CLI: usage error without a product', () => {
  const r = spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sequences.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Usage/);
});
