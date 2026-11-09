// SMS and WhatsApp through the Twilio Messages API: explicit opt-in per channel, suppression and STOP
// opt-outs, quiet hours in the recipient's time zone, per-lead caps, money caps, kill switch, WhatsApp
// templates outside the 24 h window, one message per approval, and no raw phone number in any log, detail
// or ref. fetch is mocked; nothing touches the network. Runs in a temp folder.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { twilioMessaging, checkMessageConsent, messageCaps, missingFor, senderParams } from '../connectors/twilio-messaging.mjs';
import { phoneHash } from '../connectors/voice.mjs';
import { pick } from '../connectors/index.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-twilio-msg-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const NOW = '2026-11-04T14:00:00.000Z'; // 14:00 in London (GMT)
const UK = '+447700900123';
const H = phoneHash(UK);
const ENV = { TWILIO_ACCOUNT_SID: ['AC', '0123456789abcdef'.repeat(2)].join('') /* a fake SID, built so secret scanners do not mistake it for a real one */, TWILIO_AUTH_TOKEN: 'tok-secret-987654', TWILIO_MESSAGING_FROM: '+15005550006', TWILIO_WHATSAPP_FROM: '+14155238886' };
const TEMPLATE = 'HX0123456789abcdef0123456789abcdef';

let n = 0;
function product({ prod = {}, consent = [{ phone_hash: H, channel: 'sms', type: 'opt_in', opted_in_at: '2026-10-01T10:00:00Z' }, { phone_hash: H, channel: 'whatsapp', type: 'opt_in', opted_in_at: '2026-10-01T10:00:00Z' }], history = [], suppression = null, optouts = null, lead = {}, pipeline = null } = {}) {
  const dir = path.join(tmp, `p${++n}`);
  const w = (f, v) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), typeof v === 'string' ? v : JSON.stringify(v)); };
  w('product.json', { name: 'Acme Desk', stage: 'active', budget: { mode: 'paid', daily_cap: 10, monthly_cap: 100, currency: 'USD' }, messaging: { enabled: true }, autonomy: {}, ...prod });
  w('leads.jsonl', `${JSON.stringify({ id: 'L-1', phone: UK, ...lead })}\n`);
  w('messaging/consent.json', { records: consent });
  if (history.length) w('messaging/messages.jsonl', history.map((r) => JSON.stringify(r)).join('\n') + '\n');
  if (suppression) w('suppression.json', suppression);
  if (optouts) w('messaging/optouts.json', optouts);
  if (pipeline) w('funnel/pipeline.json', pipeline);
  w('outbox/sms/hello.md', '---\ntitle: Hello\n---\nYour desk is ready to try.\n');
  return dir;
}
function mockFetch(reply = { status: 201, json: { sid: 'SM0123456789abcdef0123456789abcdef', status: 'queued' } }) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, init, form: Object.fromEntries(new URLSearchParams(String(init.body ?? ''))) });
    const body = JSON.stringify(reply.json ?? {});
    return { ok: (reply.status ?? 200) < 400, status: reply.status ?? 200, headers: new Map(), text: async () => body };
  };
  f.calls = calls;
  return f;
}
const sms = (extra = {}) => ({ id: 'A-sms-1', type: 'send', channel: 'sms', lead: 'L-1', file: 'outbox/sms/hello.md', status: 'approved', ...extra });
const run = (dir, item, { env = ENV, fetch = mockFetch(), now = NOW, dryRun = false } = {}) => twilioMessaging.execute(item, { dir, env, fetch, now, dryRun });
const logOf = (dir) => { const f = path.join(dir, 'messaging', 'messages.jsonl'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; };

test('accepts one send on sms or whatsapp only, and only with that channel\'s sender key', () => {
  assert.equal(twilioMessaging.accepts({ type: 'send', channel: 'sms' }, ENV), true);
  assert.equal(twilioMessaging.accepts({ type: 'send', channel: 'WhatsApp' }, ENV), true);
  assert.equal(twilioMessaging.accepts({ type: 'send', channel: 'whatsapp' }, { ...ENV, TWILIO_WHATSAPP_FROM: '' }), false);
  assert.equal(twilioMessaging.accepts({ type: 'send', channel: 'email' }, ENV), false);
  assert.equal(twilioMessaging.accepts({ type: 'call', channel: 'sms' }, ENV), false);
  assert.equal(twilioMessaging.configured({}), false);
  assert.equal(twilioMessaging.configured(ENV), true);
  assert.deepEqual(missingFor({ TWILIO_ACCOUNT_SID: 'a', TWILIO_AUTH_TOKEN: 'b' }), ['TWILIO_MESSAGING_FROM or TWILIO_WHATSAPP_FROM']);
  assert.deepEqual(missingFor({ TWILIO_ACCOUNT_SID: 'a', TWILIO_AUTH_TOKEN: 'b' }, 'whatsapp'), ['TWILIO_WHATSAPP_FROM']);
  assert.deepEqual(senderParams('sms', { TWILIO_MESSAGING_FROM: 'MG0123456789abcdef0123456789abcdef' }), { MessagingServiceSid: 'MG0123456789abcdef0123456789abcdef' });
  assert.deepEqual(senderParams('whatsapp', { TWILIO_WHATSAPP_FROM: 'whatsapp:+14155238886' }), { From: 'whatsapp:+14155238886' });
});

test('registry: sms and whatsapp sends route to twilio-messaging, email still to resend, nothing without keys', () => {
  assert.equal(pick({ type: 'send', channel: 'sms' }, ENV)?.name, 'twilio-messaging');
  assert.equal(pick({ type: 'send', channel: 'whatsapp' }, ENV)?.name, 'twilio-messaging');
  assert.equal(pick({ type: 'send', channel: 'email' }, { ...ENV, RESEND_API_KEY: 'r', OM_EMAIL_FROM: 'a@b.example' })?.name, 'resend');
  assert.equal(pick({ type: 'send', channel: 'sms' }, {}), null);
});

test('sends one SMS with the documented Messages.json request; logs and details carry no number', async () => {
  const dir = product();
  const f = mockFetch();
  const r = await run(dir, sms(), { fetch: f });
  assert.equal(r.ok, true, r.detail);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, `https://api.twilio.com/2010-04-01/Accounts/${ENV.TWILIO_ACCOUNT_SID}/Messages.json`);
  assert.equal(f.calls[0].init.method, 'POST');
  assert.match(f.calls[0].init.headers.authorization, /^Basic /);
  assert.equal(f.calls[0].form.To, UK);
  assert.equal(f.calls[0].form.From, ENV.TWILIO_MESSAGING_FROM);
  assert.match(f.calls[0].form.Body, /^Your desk is ready to try\./);
  assert.match(f.calls[0].form.Body, /Reply STOP to opt out\.$/, 'SMS carries the opt-out wording');
  const log = logOf(dir);
  assert.match(log, new RegExp(H));
  assert.ok(!log.includes('7700900123'), 'raw number in the log');
  assert.ok(!String(r.detail).includes('7700900123') && !String(r.ref).includes('7700900123'));
  // A second message the same day hits the per-lead cap before any request.
  const f2 = mockFetch();
  const r2 = await run(dir, sms({ id: 'A-sms-2' }), { fetch: f2, now: '2026-11-04T15:00:00.000Z' });
  assert.equal(r2.ok, false);
  assert.match(r2.detail, /cap reached: 1 per day/);
  assert.equal(f2.calls.length, 0);
});

test('WhatsApp: a template outside the 24 h session, free text only inside it', async () => {
  const dir = product();
  const f = mockFetch();
  const blocked = await run(dir, sms({ channel: 'whatsapp' }), { fetch: f });
  assert.equal(blocked.ok, false);
  assert.match(blocked.detail, /approved template \(content_sid\)/);
  assert.equal(f.calls.length, 0);
  const ok = await run(dir, sms({ channel: 'whatsapp', content_sid: TEMPLATE, content_variables: { 1: 'Sam' } }), { fetch: f });
  assert.equal(ok.ok, true, ok.detail);
  assert.equal(f.calls[0].form.To, `whatsapp:${UK}`);
  assert.equal(f.calls[0].form.From, `whatsapp:${ENV.TWILIO_WHATSAPP_FROM}`);
  assert.equal(f.calls[0].form.ContentSid, TEMPLATE);
  assert.equal(f.calls[0].form.ContentVariables, JSON.stringify({ 1: 'Sam' }));
  assert.equal(f.calls[0].form.Body, undefined);
  // Inside the session window (the lead wrote 2 h ago) free text is allowed.
  const dir2 = product({ history: [{ phone_hash: H, channel: 'whatsapp', event: 'received', at: '2026-11-04T12:00:00.000Z' }] });
  const f2 = mockFetch();
  const r2 = await run(dir2, sms({ channel: 'whatsapp' }), { fetch: f2 });
  assert.equal(r2.ok, true, r2.detail);
  assert.match(f2.calls[0].form.Body, /^Your desk is ready to try\.$/, 'no SMS footer on WhatsApp');
  const bad = await run(product(), sms({ channel: 'whatsapp', content_sid: 'not-a-sid' }), { fetch: mockFetch() });
  assert.match(bad.detail, /Content SID/);
});

test('every guard fails closed before the network', async () => {
  const cases = [
    [{ consent: [] }, /no explicit sms opt-in/],
    [{ consent: [{ phone_hash: H, channel: 'whatsapp', type: 'opt_in', opted_in_at: '2026-10-01T10:00:00Z' }] }, /no explicit sms opt-in/],
    [{ consent: [{ phone_hash: H, channel: 'sms', type: 'opt_in', opted_in_at: '2026-10-01T10:00:00Z' }, { phone_hash: H, channel: 'sms', revoked_at: '2026-10-20T10:00:00Z' }] }, /no explicit sms opt-in/],
    [{ consent: [{ phone_hash: H, channel: 'sms', type: 'opt_in', opted_in_at: '2026-12-01T10:00:00Z' }] }, /no explicit sms opt-in/],
    [{ suppression: { entries: [{ phone_hash: H, reason: 'bounced' }] } }, /suppression list/],
    [{ suppression: { entries: [{ lead: 'L-1', reason: 'unsubscribe' }] } }, /suppression list/],
    [{ optouts: { entries: [{ phone_hash: H, at: '2026-10-02T00:00:00Z', source: 'sms-stop' }] } }, /replied STOP/],
    [{ pipeline: { leads: [{ id: 'L-1', stage: 'engaged', consent: 'withdrawn' }] } }, /withdrew consent/],
    [{ prod: { messaging: { enabled: false } } }, /not enabled/],
    [{ prod: { budget: { mode: 'free' } } }, /free and messages cost money/],
    [{ prod: { budget: { mode: 'paid' } } }, /daily_cap and budget\.monthly_cap must be set/],
    [{ prod: { budget: { mode: 'paid', daily_cap: 0.01, monthly_cap: 100 } } }, /over daily_cap/],
    [{ prod: { stage: 'paused' } }, /kill switch/],
    [{ prod: { autonomy: { kill: true } } }, /kill switch/],
    [{ history: [{ phone_hash: H, channel: 'whatsapp', event: 'sent', at: '2026-11-03T20:00:00.000Z' }] }, /less than 20 h ago/],
    [{ lead: { phone: '+12025550143' } }, /time zone unknown/],
  ];
  for (const [opts, re] of cases) {
    const dir = product(opts);
    const f = mockFetch();
    const r = await run(dir, sms(), { fetch: f });
    assert.equal(r.ok, false, `${JSON.stringify(opts)} passed`);
    assert.match(r.detail, re, JSON.stringify(opts));
    assert.equal(f.calls.length, 0, `network reached for ${JSON.stringify(opts)}`);
    assert.ok(!r.detail.includes('7700900123') && !r.detail.includes('2025550143'), 'number in the detail');
  }
  // OM_KILL in the environment.
  const r = await run(product(), sms(), { env: { ...ENV, OM_KILL: '1' }, fetch: mockFetch() });
  assert.match(r.detail, /kill switch/);
});

test('quiet hours in the recipient\'s zone: default 21-8 always, the owner may widen it, never shorten it', async () => {
  const late = '2026-11-04T22:30:00.000Z'; // 22:30 in London
  const r = await run(product(), sms(), { now: late });
  assert.match(r.detail, /quiet hours/);
  const r2 = await run(product({ prod: { messaging: { enabled: true, quiet_hours: { start: 23, end: 6 } } } }), sms(), { now: late });
  assert.match(r2.detail, /quiet hours/, 'a shorter owner window does not open 22:30');
  const r3 = await run(product({ prod: { messaging: { enabled: true, quiet_hours: { start: 12, end: 18 } } } }), sms());
  assert.match(r3.detail, /quiet hours 12:00-18:00/, 'a wider owner window holds 14:00');
  // A US number with the lead's own time zone: 14:00 UTC is 09:00 in New York.
  const ok = await run(product({ lead: { phone: '+12025550143', timezone: 'America/New_York' }, consent: [{ phone_hash: phoneHash('+12025550143'), channel: 'sms', type: 'opt_in', opted_in_at: '2026-10-01T10:00:00Z' }] }), sms());
  assert.equal(ok.ok, true, ok.detail);
});

test('one message per approval, no redirection, dry run and missing keys make no request', async () => {
  const dir = product();
  for (const item of [sms({ to: [UK, '+447700900124'] }), sms({ to: `${UK},+447700900124` }), sms({ lead: ['L-1', 'L-2'] })]) {
    const r = await run(dir, item);
    assert.match(r.detail, /one message per approval/);
  }
  const redirected = await run(dir, sms({ to: '+447700900999' }));
  assert.match(redirected.detail, /does not match the lead's number/);
  const f = mockFetch();
  const dry = await run(dir, sms(), { dryRun: true, fetch: f });
  assert.equal(dry.ok, true);
  assert.match(dry.detail, /^would send 1 sms message to lead L-1/);
  const miss = await run(dir, sms(), { env: { ...ENV, TWILIO_AUTH_TOKEN: '' }, fetch: f });
  assert.equal(miss.dry_run, true);
  assert.match(miss.detail, /missing TWILIO_AUTH_TOKEN/);
  assert.equal(f.calls.length, 0);
  assert.equal(logOf(dir), '');
});

test('Twilio errors are redacted and phone-masked; caps can only be tightened', async () => {
  const dir = product();
  const f = mockFetch({ status: 400, json: { code: 21211, message: `Invalid 'To' Phone Number: ${UK} (token ${ENV.TWILIO_AUTH_TOKEN})` } });
  const r = await run(dir, sms(), { fetch: f });
  assert.equal(r.ok, false);
  assert.match(r.detail, /HTTP 400/);
  assert.ok(!r.detail.includes('7700900123'), r.detail);
  assert.ok(!r.detail.includes(ENV.TWILIO_AUTH_TOKEN), r.detail);
  assert.equal(logOf(dir), '', 'a failed send is not logged as sent');
  assert.deepEqual(messageCaps({ messaging: { caps: { per_day: 5, per_week: 2, min_gap_hours: 1 } } }), { per_day: 1, per_week: 2, min_gap_hours: 20 });
  const c = checkMessageConsent({ phone: UK, channel: 'fax', product: {}, now: 'nope' });
  assert.equal(c.ok, false);
});

test('integrations catalog lists twilio-messaging as a messaging connector that needs approval', async () => {
  const { loadConnectors } = await import('../integrations.mjs');
  const { rows } = await loadConnectors({ env: {} });
  const row = rows.find((r) => r.name === 'twilio-messaging');
  assert.ok(row, 'twilio-messaging missing from the catalog');
  assert.equal(row.category, 'messaging');
  assert.equal(row.source, 'connector');
  assert.equal(row.requires_approval, true);
  assert.equal(row.configured, false);
});
