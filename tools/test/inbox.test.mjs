// Inbound reply handling (tools/inbox.mjs): replies dropped in products/<slug>/inbox/ are matched to
// leads, sorted by fixed rules, turned into funnel updates, suppressions, follow-up tasks and an answer
// queue, and moved to inbox/done/. Every file test runs in a temp root; nothing touches the repo or
// the network.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hashEmail, parseEml, normalizeReply, stripQuoted, classifyReply, parseReturnDate, buildLeadIndex, matchLead,
  processReplies, runInbox, isAutomated, bouncedRecipient, redact,
} from '../inbox.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const tool = path.join(here, '..', 'inbox.mjs');
const NOW = '2026-11-04T12:00:00.000Z';
const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

const R = (x) => { const r = normalizeReply({ at: '2026-11-04T10:00:00Z', subject: 'Re: Quick question', ...x }, { now: NOW }); assert.ok(!r.error, r.error); return r; };
const cls = (text, extra = {}) => classifyReply(R({ from: 'ann@example.com', text, ...extra })).class;

const makeRoot = ({ product = {}, pipeline = null, leads = [] } = {}) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'om-inbox-'));
  tmps.push(base);
  const dir = path.join(base, 'products', 'acme');
  fs.mkdirSync(path.join(dir, 'inbox'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'product.json'), JSON.stringify({ name: 'Acme', slug: 'acme', stage: 'active', budget: { mode: 'free', monthly_cap: 0, daily_cap: 0 }, ...product }));
  if (pipeline) { fs.mkdirSync(path.join(dir, 'funnel'), { recursive: true }); fs.writeFileSync(path.join(dir, 'funnel', 'pipeline.json'), JSON.stringify(pipeline)); }
  if (leads.length) fs.writeFileSync(path.join(dir, 'leads.jsonl'), leads.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return { base, dir, P: (...f) => path.join(dir, ...f), drop: (name, body) => fs.writeFileSync(path.join(dir, 'inbox', name), typeof body === 'string' ? body : JSON.stringify(body)) };
};
const PIPE = { leads: [
  { id: 'L-ann1', lead_id: 'L-ann1', email_hash: hashEmail('ann@example.com'), stage: 'contacted', consent: true },
  { id: 'L-bob1', lead_id: 'L-bob1', email_hash: hashEmail('bob@example.com'), stage: 'contacted', consent: true, aliases: ['crm-777'] },
] };
const ENV = { OM_AUTO_RESPOND: '1' };

test('rules: each reply type gets the right class and stage', () => {
  assert.equal(cls('Please unsubscribe me from this list.'), 'unsubscribe');
  assert.equal(cls('STOP'), 'unsubscribe');
  assert.equal(cls('Remove me please'), 'unsubscribe');
  assert.equal(cls('I am out of the office until November 12 with limited access to email.'), 'out_of_office');
  assert.equal(cls('Not interested, thanks.'), 'not_interested');
  assert.equal(cls('Not right now, maybe next quarter.'), 'not_now');
  assert.equal(cls("I'm the wrong person for this, sorry."), 'wrong_person');
  assert.equal(cls('The best person for this is our ops lead, dana@acme.io'), 'referral');
  assert.equal(cls('Yes, could we book a call next week for a demo?'), 'opportunity');
  assert.equal(cls('Sounds interesting. What does pricing look like?'), 'interested');
  assert.equal(cls('Who are you?'), 'question');
  assert.equal(cls('ok'), 'other');
  const c = classifyReply(R({ from: 'ann@example.com', text: 'How much is it for 10 seats? Interested.' }));
  assert.deepEqual([c.stage, c.intent], ['engaged', 'pricing']);
  assert.equal(classifyReply(R({ from: 'a@x.io', text: 'Send me the proposal' })).stage, 'opportunity');
  assert.equal(classifyReply(R({ from: 'a@x.io', text: 'later, after the holidays' })).stage, 'nurture');
});

test('rules: our own quoted email and its unsubscribe footer never count as the reader\'s words', () => {
  const text = 'Yes, interested! Send more info.\n\nOn Mon, Nov 2, 2026 at 9:00 AM Sam <sam@acme.io> wrote:\n> Hi Ann, want a demo?\n> Unsubscribe: reply STOP';
  assert.equal(stripQuoted(text), 'Yes, interested! Send more info.');
  assert.equal(cls(text), 'interested');
  assert.equal(cls('Thanks\n> please unsubscribe here'), 'other');
  assert.equal(cls('Sounds good\n-- \nAnn\nCEO, call me 555 123 4567'), 'interested');
  assert.equal(cls('I have left you a voicemail, can we schedule a call?'), 'opportunity', 'voicemail is not "left the company"');
  // "not interested" must win over "interested"; unsubscribe wins over everything a person says.
  assert.equal(cls('We are not interested in a demo'), 'not_interested');
  assert.equal(cls('Interested, but unsubscribe me from the newsletter'), 'unsubscribe');
});

test('out of office: stage kept, follow-up the day after the return date, default 7 days, capped', () => {
  const ooo = classifyReply(R({ from: 'ann@example.com', subject: 'Automatic reply: Quick question', text: 'I will be back on Thursday, November 12. For urgent matters call the office.', headers: { 'Auto-Submitted': 'auto-replied' } }));
  assert.equal(ooo.class, 'out_of_office');
  assert.equal(ooo.stage, null);
  assert.equal(ooo.followup_at, '2026-11-13T00:00:00.000Z');
  assert.equal(parseReturnDate('back on 2026-11-20', NOW), '2026-11-20T00:00:00.000Z');
  assert.equal(parseReturnDate('away until 3rd January', NOW), '2027-01-03T00:00:00.000Z', 'year rolls over');
  assert.equal(parseReturnDate('back soon', NOW), null);
  assert.equal(parseReturnDate('back on 31 February', NOW), null, 'invalid dates are rejected');
  const vague = classifyReply(R({ from: 'a@x.io', subject: 'Out of Office', text: 'I am away.' }));
  assert.equal(vague.followup_at, '2026-11-11T10:00:00.000Z');
  const far = classifyReply(R({ from: 'a@x.io', subject: 'Out of office', text: 'on leave until 2027-09-01' }));
  assert.equal(far.followup_at, '2026-11-11T10:00:00.000Z', 'return dates past 60 days fall back to +7');
});

test('.eml: headers, encoded subject, multipart, quoted-printable and auto-reply flags', () => {
  const eml = [
    'From: "Ann Lee" <Ann@Example.com>', 'To: sam@acme.io', 'Subject: =?UTF-8?B?UmU6IFF1aWNrIHF1ZXN0aW9u?=', 'Date: Wed, 04 Nov 2026 09:30:00 +0000',
    'Message-ID: <abc123@mail.example.com>', 'In-Reply-To: <om-L-ann1-0001@acme.io>', 'MIME-Version: 1.0', 'Content-Type: multipart/alternative; boundary="b1"', '',
    '--b1', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '',
    'Yes please, I=E2=80=99d love a demo next week.=', ' Thanks', '', '--b1', 'Content-Type: text/html; charset=utf-8', '', '<p>Yes please</p>', '--b1--', '',
  ].join('\r\n');
  const p = parseEml(eml);
  assert.equal(p.subject, 'Re: Quick question');
  assert.match(p.text, /I’d love a demo next week\. Thanks/);
  const r = normalizeReply(p, { now: NOW });
  assert.equal(r.from_email, 'ann@example.com');
  assert.equal(r.at, '2026-11-04T09:30:00.000Z');
  assert.equal(r.automated, false);
  assert.equal(matchLead(r, buildLeadIndex({ pipeline: PIPE })).by, 'in_reply_to');
  const html = normalizeReply(parseEml('From: x@y.io\nSubject: Re: hi\nContent-Type: text/html\n\n<div>Tell me <b>more</b></div><blockquote>unsubscribe</blockquote>'), { now: NOW });
  assert.equal(classifyReply(html).class, 'interested');
  assert.equal(isAutomated({ from_email: 'no-reply@x.io', headers: {} }), true);
  assert.equal(isAutomated({ from_email: 'a@x.io', headers: { precedence: 'bulk' } }), true);
  assert.equal(isAutomated({ from_email: 'a@x.io', headers: { 'auto-submitted': 'no' } }), false);
});

test('guards: malformed input is rejected, not guessed', () => {
  assert.ok(normalizeReply(null).error);
  assert.ok(normalizeReply([1, 2]).error);
  assert.ok(normalizeReply({ text: 'hi' }).error, 'no sender and no lead');
  assert.ok(normalizeReply({ from: 'a@x.io' }).error, 'no text and no subject');
  const r = normalizeReply({ lead: 'L-ann1', text: 'yes', at: 'not a date' }, { now: NOW });
  assert.equal(r.at, NOW, 'bad dates fall back to now');
  assert.equal(r.from_email, null);
  const a = normalizeReply({ from: 'a@x.io', text: 'yes', at: '2026-11-01T00:00:00Z' });
  const b = normalizeReply({ from: 'a@x.io', text: 'yes', at: '2026-11-01T00:00:00Z' });
  assert.equal(a.id, b.id, 'ids are deterministic');
  assert.equal(redact('call +1 (555) 123-4567 or mail ann@example.com'), 'call [phone] or mail [email]');
  assert.equal(bouncedRecipient('Final-Recipient: rfc822; Bob@Example.com\nAction: failed'), 'bob@example.com');
});

test('matching: explicit lead id, alias, In-Reply-To token, then email hash; short ids never match by accident', () => {
  const idx = buildLeadIndex({ pipeline: PIPE, leads: [{ lead_id: 'site-9', contact: { email: 'cy@example.com' } }] });
  assert.equal(matchLead(R({ lead: 'crm-777', text: 'yes' }), idx).id, 'L-bob1');
  assert.equal(matchLead(R({ from: 'BOB@example.com ', text: 'yes' }), idx).by, 'email_hash');
  assert.equal(matchLead(R({ from: 'cy@example.com', text: 'yes' }), idx).id, 'site-9', 'raw site log leads match too');
  assert.equal(matchLead(R({ from: 'zed@nowhere.io', text: 'yes', in_reply_to: '<a1@x>' }), buildLeadIndex({ pipeline: { leads: [{ id: 'a1', lead_id: 'a1' }] } })), null);
  assert.equal(matchLead(R({ lead: 'ghost', text: 'yes' }), idx).unknown, true);
});

test('process: updates, suppression, answer list and run file; nothing outbound, no raw addresses', () => {
  const replies = [
    R({ from: 'ann@example.com', text: 'Yes, interested. How much is it?', at: '2026-11-04T09:00:00Z' }),
    R({ from: 'bob@example.com', text: 'Please remove me from your list', at: '2026-11-04T08:00:00Z' }),
    R({ from: 'zed@nowhere.io', text: 'Can we book a call?', at: '2026-11-04T07:00:00Z' }),
  ];
  const out = processReplies({ replies, pipeline: PIPE, now: NOW, env: ENV });
  assert.equal(out.stats.processed, 3);
  assert.deepEqual(out.updates.map((u) => [u.update.lead, u.update.stage]), [['L-bob1', 'lost'], ['L-ann1', 'engaged']], 'unmatched replies make no funnel update; time order');
  assert.equal(out.updates[0].file, `inbox-${replies[1].id}.json`);
  assert.ok(!('id' in out.updates[0].update), 'no "id" key that tools/funnel.mjs would read as the lead');
  assert.deepEqual(out.suppression.entries.map((e) => [e.email_hash, e.lead, e.reason]), [[hashEmail('bob@example.com'), 'L-bob1', 'unsubscribed']]);
  assert.deepEqual(out.respond.open.map((x) => [x.lead, x.class, x.matched]), [[null, 'opportunity', false], ['L-ann1', 'interested', true]]);
  assert.ok(out.queue, 'interested human replies queue an answer run');
  assert.equal(out.run.approvals.length, 1);
  assert.equal(out.run.approvals[0].type, 'suppress');
  assert.equal(out.run.approvals[0].status, undefined, 'apply-results sets the status (pending)');
  assert.ok(out.run.alerts.some((a) => /did not match/.test(a.title)));
  const blob = JSON.stringify({ u: out.updates, s: out.suppression, l: out.ledger, r: out.respond, run: out.run });
  for (const raw of ['ann@example.com', 'bob@example.com', 'zed@nowhere.io']) assert.ok(!blob.includes(raw), `${raw} leaked`);
  // Deterministic: same input, same output.
  assert.deepEqual(processReplies({ replies: [...replies].reverse(), pipeline: PIPE, now: NOW, env: ENV }), out);
});

test('process guards: duplicates skipped, suppressed senders never queued, kill switches stop the queue', () => {
  const first = processReplies({ replies: [R({ from: 'ann@example.com', text: 'unsubscribe' })], pipeline: PIPE, now: NOW, env: ENV });
  const again = processReplies({ replies: [R({ from: 'ann@example.com', text: 'unsubscribe' })], pipeline: PIPE, ledger: first.ledger, suppression: first.suppression, now: NOW, env: ENV });
  assert.equal(again.stats.duplicates, 1);
  assert.equal(again.stats.processed, 0);
  assert.equal(again.run, null);
  const later = processReplies({ replies: [R({ from: 'ann@example.com', text: 'Actually yes, pricing please', at: '2026-11-05T00:00:00Z' })], pipeline: PIPE, ledger: first.ledger, suppression: first.suppression, now: NOW, env: ENV });
  assert.equal(later.respond.open.length, 0, 'suppressed sender is not queued for an answer');
  assert.equal(later.queue, null);
  assert.ok(later.run.alerts.some((a) => a.level === 'decision' && /suppressed contact/.test(a.title)));
  assert.equal(later.stats.suppressed_new, 0, 'no duplicate suppression');
  const yes = [R({ from: 'ann@example.com', text: 'Yes, interested' })];
  assert.equal(processReplies({ replies: yes, pipeline: PIPE, now: NOW, env: { OM_AUTO_RESPOND: '0' } }).queue, null);
  assert.equal(processReplies({ replies: yes, pipeline: PIPE, now: NOW, env: ENV, product: { stage: 'paused' } }).queue, null);
  assert.equal(processReplies({ replies: yes, pipeline: PIPE, now: NOW, env: ENV, product: { autonomy: { kill: true } } }).queue, null);
  const auto = processReplies({ replies: [R({ from: 'ann@example.com', text: 'Yes interested', headers: { 'X-Autoreply': 'yes' } })], pipeline: PIPE, now: NOW, env: ENV });
  assert.equal(auto.respond.open.length, 0, 'automated mail is never answered');
});

test('process: bounces suppress the bounced recipient, not the mail daemon; follow-ups and referrals become tasks', () => {
  const bounce = R({ from: 'MAILER-DAEMON@mx.example.com', subject: 'Undeliverable: Quick question', text: 'Delivery failed.\nFinal-Recipient: rfc822; bob@example.com\nStatus: 5.1.1' });
  const ooo = R({ from: 'ann@example.com', subject: 'Out of office', text: 'Back on November 9.', at: '2026-11-04T11:00:00Z' });
  const ref = R({ lead: 'L-bob1', text: 'I have cc\'d our CTO, he handles this for us: cto@bob.io', at: '2026-11-04T11:30:00Z' });
  const out = processReplies({ replies: [bounce, ooo, ref], pipeline: PIPE, now: NOW, env: ENV });
  assert.deepEqual(out.suppression.entries.map((e) => [e.email_hash, e.lead, e.reason]), [[hashEmail('bob@example.com'), 'L-bob1', 'bounced']]);
  assert.equal(out.updates.find((u) => u.update.lead === 'L-ann1'), undefined, 'out of office keeps the stage');
  const fu = out.run.new_tasks.find((t) => t.id === `FU-${ooo.id}`);
  assert.equal(fu.agent, 'om-follow-up');
  assert.equal(fu.not_before, '2026-11-10T00:00:00.000Z');
  const rt = out.run.new_tasks.find((t) => t.id === `REF-${ref.id}`);
  assert.equal(rt.agent, 'om-sdr');
  const row = out.ledger.replies.find((x) => x.id === ref.id);
  assert.equal(row.referral_hash, hashEmail('cto@bob.io'));
  assert.ok(!JSON.stringify(out.ledger).includes('cto@bob.io'));
});

test('runInbox: files are read, written and moved to done/; bad files go to failed/; a second run is a no-op', () => {
  const t = makeRoot({ pipeline: PIPE });
  t.drop('a-ann.json', { from: 'Ann <ann@example.com>', subject: 'Re: hi', text: 'Yes! Interested, what is the price?', at: '2026-11-04T09:00:00Z', in_reply_to: '<x@y>' });
  t.drop('b-bob.json', { replies: [{ from: 'bob@example.com', text: 'STOP', at: '2026-11-04T08:00:00Z' }] });
  t.drop('c-bad.json', '{not json');
  t.drop('d-empty.json', { from: 'x@y.io' });
  t.drop('notes.txt', 'ignored');
  const res = runInbox('acme', { now: NOW, env: ENV, root: t.base });
  assert.equal(res.processed, 2);
  assert.equal(res.failed, 2);
  assert.equal(res.respond_queued, true);
  assert.deepEqual(fs.readdirSync(t.P('inbox')).sort(), ['done', 'failed', 'notes.txt', 'replies.json', 'respond.json']);
  assert.deepEqual(fs.readdirSync(t.P('inbox', 'done')).sort(), ['a-ann.json', 'b-bob.json']);
  assert.ok(fs.existsSync(t.P('inbox', 'failed', 'c-bad.json.error.json')));
  const ups = fs.readdirSync(t.P('funnel', 'updates')).sort();
  assert.equal(ups.length, 2);
  const stages = ups.map((f) => JSON.parse(fs.readFileSync(t.P('funnel', 'updates', f), 'utf8')).stage).sort();
  assert.deepEqual(stages, ['engaged', 'lost']);
  const sup = JSON.parse(fs.readFileSync(t.P('suppression.json'), 'utf8'));
  assert.equal(sup.entries[0].email_hash, hashEmail('bob@example.com'));
  const job = JSON.parse(fs.readFileSync(path.join(t.base, 'state', 'queue', 'respond-acme.json'), 'utf8'));
  assert.deepEqual([job.slug, job.by, job.inbox_replies], ['acme', 'inbox', 1]);
  const runs = fs.readdirSync(t.P('runs'));
  assert.deepEqual(runs, ['INBOX-20261104T1200.json']);
  const run = JSON.parse(fs.readFileSync(t.P('runs', runs[0]), 'utf8'));
  assert.equal(run.task_id, 'INBOX-20261104T1200');
  assert.equal(run.approvals[0].file, 'suppression.json');
  const ledger = JSON.parse(fs.readFileSync(t.P('inbox', 'replies.json'), 'utf8'));
  assert.ok(ledger.replies.every((r) => r.file.startsWith('done/')));
  // Shared state (the queue job) carries no personal data.
  assert.ok(!JSON.stringify(job).includes('@'));
  assert.ok(fs.readFileSync(t.P('events.jsonl'), 'utf8').includes('om-reply-handler'));
  // The same reply dropped again is a duplicate.
  t.drop('a-ann.json', { from: 'Ann <ann@example.com>', subject: 'Re: hi', text: 'Yes! Interested, what is the price?', at: '2026-11-04T09:00:00Z', in_reply_to: '<x@y>' });
  const res2 = runInbox('acme', { now: NOW, env: ENV, root: t.base });
  assert.deepEqual([res2.processed, res2.duplicates], [0, 1]);
  assert.ok(fs.existsSync(t.P('inbox', 'done', 'a-ann-1.json')), 'moved without overwriting');
  assert.equal(fs.readdirSync(t.P('funnel', 'updates')).length, 2);
});

test('runInbox guards: running hub job untouched, paused product not queued, dry run writes nothing, bad slug refused', () => {
  const t = makeRoot({ pipeline: PIPE });
  fs.mkdirSync(path.join(t.base, 'state', 'queue'), { recursive: true });
  fs.writeFileSync(path.join(t.base, 'state', 'queue', 'respond-acme.json.running'), '{}');
  t.drop('a.json', { from: 'ann@example.com', text: 'interested', at: '2026-11-04T09:00:00Z' });
  const dry = runInbox('acme', { now: NOW, env: ENV, root: t.base, dryRun: true });
  assert.equal(dry.processed, 1);
  assert.ok(fs.existsSync(t.P('inbox', 'a.json')), 'dry run moves nothing');
  assert.ok(!fs.existsSync(t.P('inbox', 'replies.json')));
  const res = runInbox('acme', { now: NOW, env: ENV, root: t.base });
  assert.equal(res.respond_queued, false, 'a running job is not touched');
  assert.ok(!fs.existsSync(path.join(t.base, 'state', 'queue', 'respond-acme.json')));
  const p = makeRoot({ pipeline: PIPE, product: { stage: 'paused' } });
  p.drop('a.json', { from: 'ann@example.com', text: 'interested', at: '2026-11-04T09:00:00Z' });
  const pr = runInbox('acme', { now: NOW, env: ENV, root: p.base });
  assert.deepEqual([pr.processed, pr.respond_queued, pr.paused], [1, false, true]);
  assert.throws(() => runInbox('../etc', { root: t.base }), /invalid product slug/);
  assert.throws(() => runInbox('nope', { root: t.base }), /no product.json/);
  assert.deepEqual(runInbox('acme', { now: NOW, root: t.base }), { slug: 'acme', files: 0, processed: 0, failed: 0, respond_queued: false });
});

test('review guards: footers of automated mail and our own "Stop ..." subjects never suppress; erasure raises a decision', () => {
  const ack = R({ from: 'support@vendor.io', subject: 'Re: Quick question', text: 'We received your request #123.\nTo unsubscribe from these notifications click here.', headers: { 'auto-submitted': 'auto-replied' } });
  const c = classifyReply(ack);
  assert.notEqual(c.class, 'unsubscribe');
  assert.equal(c.suppress, false);
  assert.equal(cls('Yes, interested. Tell me more.', { subject: 'Re: Stop losing leads to slow replies' }), 'interested');
  assert.equal(cls('', { subject: 'STOP' }), 'unsubscribe');
  const out = processReplies({ replies: [R({ from: 'ann@example.com', text: 'Unsubscribe me and delete my data under GDPR.' })], pipeline: PIPE, now: NOW, env: ENV });
  assert.equal(out.suppression.entries.length, 1);
  assert.ok(out.run.alerts.some((a) => a.level === 'decision' && /erasure/i.test(a.title)));
  assert.ok(!JSON.stringify(out.run).includes('ann@example.com'));
  // A bare-array suppression list keeps its entries; malformed ledger rows do not crash the sort.
  const keep = processReplies({ replies: [R({ from: 'bob@example.com', text: 'stop' })], pipeline: PIPE, suppression: [{ email_hash: 'aaaa', at: '2026-01-01' }], ledger: { replies: [null, { id: 'R-x' }] }, now: NOW, env: ENV });
  assert.deepEqual(keep.suppression.entries.map((e) => e.email_hash), ['aaaa', hashEmail('bob@example.com')]);
});

test('runInbox guard: a corrupt suppression.json stops the run and moves nothing', () => {
  const t = makeRoot({ pipeline: PIPE });
  fs.writeFileSync(t.P('suppression.json'), '{"entries": [ {"email_hash": "abc"');
  t.drop('a.json', { from: 'ann@example.com', text: 'interested', at: '2026-11-04T09:00:00Z' });
  assert.throws(() => runInbox('acme', { now: NOW, env: ENV, root: t.base }), /suppression\.json is not valid JSON/);
  assert.ok(fs.existsSync(t.P('inbox', 'a.json')), 'reply left in place');
  assert.equal(fs.readFileSync(t.P('suppression.json'), 'utf8'), '{"entries": [ {"email_hash": "abc"', 'not overwritten');
  assert.ok(!fs.existsSync(path.join(t.base, 'state', 'queue')));
});

test('CLI: runs one product and prints a JSON summary; usage error without a slug', () => {
  const t = makeRoot({ pipeline: PIPE });
  t.drop('x.eml', 'From: bob@example.com\nSubject: Re: hi\nDate: Wed, 04 Nov 2026 08:00:00 +0000\n\nNot now, check back next year.');
  const env = { ...process.env, OM_AUTO_RESPOND: '0' };
  const r = spawnSync(process.execPath, [tool, 'acme', '--now', NOW, '--root', t.base], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split(/\r?\n/).at(-1));
  assert.deepEqual([out.processed, out.by_class.not_now, out.updates], [1, 1, 1]);
  const run = JSON.parse(fs.readFileSync(t.P('runs', 'INBOX-20261104T1200.json'), 'utf8'));
  assert.equal(run.new_tasks[0].not_before, '2027-05-03T08:00:00.000Z');
  const u = spawnSync(process.execPath, [tool, '--root', t.base], { encoding: 'utf8', env });
  assert.equal(u.status, 2);
});
