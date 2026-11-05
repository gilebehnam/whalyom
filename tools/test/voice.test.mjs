// Twilio AI voice connector: consent checks, approval-only outbound calls, AI disclosure, recording only on
// announced consent, X-Twilio-Signature validation, inbound answers from verified claims, opt-outs and
// funnel updates. Mock fetch only; no network.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  voice, checkCallConsent, normalizePhone, phoneHash, parseClaims, answerFromClaims, buildOutboundTwiml, buildInboundTwiml,
  twilioSignature, validateTwilioSignature, handleVoiceWebhook, callingHours, callCaps, calleeTimeZone, outcomeUpdate, checkCallBudget, callTimeLimit,
} from '../connectors/voice.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-voice-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const PHONE = '+442071234567'; // UK: single time zone
const US = '+14155550123';
const H = phoneHash(PHONE);
const NOW = '2026-11-04T11:00:00Z'; // Wednesday, 11:00 in London
const env = { TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32), TWILIO_AUTH_TOKEN: 'tok-' + 'z'.repeat(28), TWILIO_VOICE_FROM: '+15005550006', TWILIO_VOICE_WEBHOOK_BASE: 'https://edge.example/voice/demo' };
const product = { name: 'Demo Co', stage: 'active', budget: { mode: 'paid', monthly_cap: 100, daily_cap: 10 }, voice: { enabled: true, offer: 'Demo proposals' } };
const pewc = { phone_hash: H, type: 'express_written', signed_at: '2026-10-01T00:00:00Z', scope: ['marketing_calls', 'ai_voice'] };
const freshDnc = { scrubbed_at: '2026-10-20T00:00:00Z', source: 'test', listed: [] };
const base = { phone: PHONE, lead: { id: 'L1' }, purpose: 'marketing', product, consent: { records: [pewc] }, dnc: freshDnc, now: NOW };

function productDir(name, extra = {}) {
  const dir = path.join(tmp, name);
  const w = (f, v) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), typeof v === 'string' ? v : JSON.stringify(v)); };
  w('product.json', { ...product, ...(extra.product ?? {}) });
  w('claims.md', '| id | claim | status | source |\n|---|---|---|---|\n| C1 | Demo Co turns a brief into a priced proposal. | verified | owner |\n| C2 | Pro plan costs $19 per month. | verified | owner |\n| C3 | Demo Co doubles your revenue. | needs-proof | none |\n');
  w('leads.jsonl', `${JSON.stringify({ lead_id: 'L1', email: 'a@example.com', phone: PHONE })}\n`);
  w('voice/consent.json', { records: [extra.consent ?? pewc] });
  w('voice/dnc.json', freshDnc);
  return dir;
}
function mock(router) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body instanceof URLSearchParams ? init.body : new URLSearchParams(String(init.body ?? '')) });
    const [status, body] = router(calls.at(-1)) ?? [201, {}];
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetch };
}
const noFetch = async () => { throw new Error('network must not be used'); };
const item = (extra = {}) => ({ id: 'A-CALL-1', type: 'call', channel: 'voice', lead: 'L1', purpose: 'marketing', status: 'approved', ...extra });
const signed = (url, p) => { const params = { AccountSid: env.TWILIO_ACCOUNT_SID, ...p }; return { url, body: new URLSearchParams(params).toString(), headers: { 'x-twilio-signature': twilioSignature(env.TWILIO_AUTH_TOKEN, url, params) } }; };

test('phone helpers and time zones', () => {
  assert.equal(normalizePhone('(415) 555-0123'), US);
  assert.equal(normalizePhone('0044 20 7123 4567'), PHONE);
  assert.equal(normalizePhone('12'), null);
  assert.equal(calleeTimeZone(PHONE), 'Europe/London');
  assert.equal(calleeTimeZone(US), null, 'multi-zone country needs an explicit time zone');
  assert.equal(calleeTimeZone(US, 'America/Los_Angeles'), 'America/Los_Angeles');
});

test('consent: prior express written consent, fresh DNC scrub, inside hours → ok', () => {
  const r = checkCallConsent(base);
  assert.equal(r.ok, true, r.reasons.join('; '));
  assert.equal(r.timezone, 'Europe/London');
  assert.equal(r.recording_allowed, false, 'recording is off unless product.voice.record');
});

test('consent: every guard fails closed', () => {
  const bad = (over, re) => { const r = checkCallConsent({ ...base, ...over }); assert.equal(r.ok, false); assert.ok(r.reasons.some((x) => re.test(x)), `${re} not in ${r.reasons}`); };
  bad({ consent: { records: [] } }, /express written consent/);
  bad({ consent: { records: [{ ...pewc, type: 'express' }] } }, /express written consent/);
  bad({ consent: { records: [{ ...pewc, revoked_at: '2026-10-10T00:00:00Z' }] } }, /revoked/);
  bad({ dnc: null }, /do-not-call scrub/);
  bad({ dnc: { ...freshDnc, scrubbed_at: '2026-09-01T00:00:00Z' } }, /older than 31 days/);
  bad({ suppression: { entries: [{ phone_hash: H }] } }, /suppression/);
  bad({ suppression: [{ lead: 'L1' }] }, /suppression/);
  bad({ optouts: { entries: [{ phone_hash: H }] } }, /opt-out/);
  bad({ now: '2026-11-04T21:30:00Z' }, /outside calling hours/);
  bad({ now: '2026-11-08T12:00:00Z' }, /outside calling hours/); // Sunday
  bad({ phone: US, consent: { records: [{ ...pewc, phone_hash: phoneHash(US) }] } }, /time zone unknown/);
  bad({ history: [{ phone_hash: H, event: 'dialed', at: '2026-11-04T08:00:00Z' }] }, /per day/);
  bad({ history: [{ phone_hash: H, event: 'dialed', at: '2026-11-01T10:00:00Z' }, { phone_hash: H, event: 'dialed', at: '2026-11-02T10:00:00Z' }] }, /per 7 days/);
  bad({ product: { ...product, budget: { mode: 'free' } } }, /free/);
  bad({ product: { ...product, voice: { enabled: false } } }, /not enabled/);
  bad({ product: { ...product, stage: 'paused' } }, /paused/);
  bad({ purpose: 'robocall' }, /unknown purpose/);
  // DNC-listed: only with written consent; express consent alone is not enough for marketing.
  assert.equal(checkCallConsent({ ...base, dnc: { ...freshDnc, listed: [H] } }).ok, true);
  // Non-marketing calls need prior express consent but no DNC scrub.
  assert.equal(checkCallConsent({ ...base, purpose: 'callback', dnc: null, consent: { records: [{ phone_hash: H, type: 'express' }] } }).ok, true);
});

test('owner settings can tighten hours and caps, never loosen them', () => {
  assert.deepEqual(callingHours({ voice: { calling_hours: { start: 6, end: 23 } } }).start, 8);
  assert.equal(callingHours({ voice: { calling_hours: { start: 6, end: 23 } } }).end, 21);
  assert.equal(callingHours({ voice: { calling_hours: { start: 10, end: 17 } } }).end, 17);
  assert.equal(callCaps({ voice: { caps: { per_day: 10, per_week: 1, min_gap_hours: 2 } } }).per_day, 1);
  assert.equal(callCaps({ voice: { caps: { per_week: 1 } } }).per_week, 1);
  assert.equal(callCaps({ voice: { caps: { min_gap_hours: 2 } } }).min_gap_hours, 24);
});

test('TwiML: AI disclosure first, no recording before consent, ConversationRelay or script', () => {
  const t = buildOutboundTwiml({ seller: 'Demo Co', purpose: 'marketing', base: env.TWILIO_VOICE_WEBHOOK_BASE, ref: 'A1' });
  assert.match(t, /^<\?xml[^>]*\?><Response><Say[^>]*>Hello, this is an AI assistant, an automated voice calling on behalf of Demo Co/);
  assert.match(t, /stop calling or press 9/);
  assert.doesNotMatch(t, /<Recording/);
  assert.match(t, /<Gather input="dtmf speech"[^>]*step=interest/);
  const rec = buildOutboundTwiml({ seller: 'Demo Co', record: true, base: env.TWILIO_VOICE_WEBHOOK_BASE, ref: 'A1' });
  assert.doesNotMatch(rec, /<Recording/, 'recording only starts after the callee agrees');
  assert.match(rec, /only do so if you agree/);
  assert.match(rec, /step=record/);
  const relay = buildOutboundTwiml({ seller: 'Demo & Co', relayUrl: 'wss://relay.example/ws', base: env.TWILIO_VOICE_WEBHOOK_BASE, ref: 'A1' });
  assert.match(relay, /<Connect action="[^"]*step=relay-end[^"]*" method="POST"><ConversationRelay url="wss:\/\/relay.example\/ws"/);
  assert.match(relay, /Demo &amp; Co/);
  assert.ok(relay.indexOf('AI assistant') < relay.indexOf('<Connect'));
  assert.doesNotMatch(buildOutboundTwiml({ seller: 'X', relayUrl: 'http://insecure', base: 'https://e' }), /ConversationRelay/);
  assert.match(buildInboundTwiml({ seller: 'Demo Co', base: 'https://e/voice/demo' }), /You are speaking with an AI assistant/);
});

test('connector: dry run and missing keys make no call; blocked calls never reach the network', async () => {
  const dir = productDir('dry');
  assert.equal(voice.accepts({ type: 'call', channel: 'voice' }), true);
  assert.equal(voice.accepts({ type: 'send', channel: 'sms' }), false);
  const d = await voice.execute(item(), { slug: 'demo', dir, env, now: NOW, dryRun: true, fetch: noFetch });
  assert.equal(d.ok, true); assert.match(d.detail, /would place 1 marketing AI call to lead L1/);
  const m = await voice.execute(item(), { slug: 'demo', dir, env: { TWILIO_VOICE_WEBHOOK_BASE: env.TWILIO_VOICE_WEBHOOK_BASE }, now: NOW, dryRun: false, fetch: noFetch });
  assert.equal(m.ok, false); assert.match(m.detail, /missing TWILIO_ACCOUNT_SID/);
  const night = await voice.execute(item(), { slug: 'demo', dir, env, now: '2026-11-04T22:00:00Z', dryRun: false, fetch: noFetch });
  assert.equal(night.ok, false); assert.match(night.detail, /call blocked: outside calling hours/);
  const list = await voice.execute(item({ to: [PHONE, US] }), { slug: 'demo', dir, env, now: NOW, dryRun: false, fetch: noFetch });
  assert.equal(list.ok, false); assert.match(list.detail, /one call per approval/);
  const nobase = await voice.execute(item(), { slug: 'demo', dir, env: { ...env, TWILIO_VOICE_WEBHOOK_BASE: '' }, now: NOW, dryRun: false, fetch: noFetch });
  assert.equal(nobase.ok, false); assert.match(nobase.detail, /TWILIO_VOICE_WEBHOOK_BASE/);
});

test('connector: places one call with the documented Calls.json request and logs only a hash', async () => {
  const dir = productDir('send');
  const { calls, fetch } = mock(() => [201, { sid: 'CA' + '1'.repeat(32), status: 'queued' }]);
  const r = await voice.execute(item(), { slug: 'demo', dir, env, now: NOW, dryRun: false, fetch });
  assert.equal(r.ok, true, r.detail);
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.url, `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls.json`);
  assert.equal(c.method, 'POST');
  assert.equal(c.headers.authorization, `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`);
  assert.equal(c.body.get('To'), PHONE);
  assert.equal(c.body.get('From'), env.TWILIO_VOICE_FROM);
  assert.match(c.body.get('Twiml'), /AI assistant/);
  assert.doesNotMatch(c.body.get('Twiml'), /<Recording/);
  assert.equal(c.body.get('StatusCallback'), 'https://edge.example/voice/demo/status?step=call&ref=A-CALL-1');
  assert.deepEqual(c.body.getAll('StatusCallbackEvent'), ['initiated', 'ringing', 'answered', 'completed']);
  const out = JSON.stringify(r);
  assert.ok(!out.includes(PHONE) && !out.includes('2071234567'), 'phone number leaked into result');
  assert.ok(!out.includes(env.TWILIO_AUTH_TOKEN));
  const log = fs.readFileSync(path.join(dir, 'voice', 'calls.jsonl'), 'utf8');
  assert.ok(!log.includes(PHONE) && log.includes(H) && log.includes('"event":"dialed"'));
  // The same number again the same day hits the frequency cap without a request.
  const again = await voice.execute(item({ id: 'A-CALL-2' }), { slug: 'demo', dir, env, now: '2026-11-04T15:00:00Z', dryRun: false, fetch: noFetch });
  assert.equal(again.ok, false); assert.match(again.detail, /per day/);
});

test('connector: API key auth, Twilio errors redacted and phone-masked', async () => {
  const dir = productDir('err');
  const kenv = { ...env, TWILIO_API_KEY_SID: 'SK' + 'b'.repeat(32), TWILIO_API_KEY_SECRET: 'sec-' + 'q'.repeat(28) };
  const { calls, fetch } = mock(() => [400, { code: 21211, message: `The 'To' number ${PHONE} is not valid. key ${kenv.TWILIO_API_KEY_SECRET}` }]);
  const r = await voice.execute(item(), { slug: 'demo', dir, env: kenv, now: NOW, dryRun: false, fetch });
  assert.equal(r.ok, false);
  assert.equal(calls[0].headers.authorization, `Basic ${Buffer.from(`${kenv.TWILIO_API_KEY_SID}:${kenv.TWILIO_API_KEY_SECRET}`).toString('base64')}`);
  assert.ok(!r.detail.includes(PHONE) && !r.detail.includes(kenv.TWILIO_API_KEY_SECRET), r.detail);
  assert.ok(!fs.existsSync(path.join(dir, 'voice', 'calls.jsonl')), 'a failed call is not logged as dialed');
});

test('recording consent is announced, and only a yes starts <Recording>', () => {
  const dir = productDir('rec', { product: { voice: { enabled: true, record: true } } });
  const url = 'https://edge.example/voice/demo/gather?step=record&ref=A1';
  const yes = handleVoiceWebhook(signed(url, { CallSid: 'CA1', To: PHONE, Digits: '1', AccountSid: env.TWILIO_ACCOUNT_SID }), { dir, env, now: NOW });
  assert.equal(yes.status, 200); assert.match(yes.body, /<Start><Recording channels="dual"/);
  const no = handleVoiceWebhook(signed(url, { CallSid: 'CA1', To: PHONE, Digits: '2' }), { dir, env, now: NOW });
  assert.doesNotMatch(no.body, /<Recording/);
  const silent = handleVoiceWebhook(signed(`${url}&none=1`, { CallSid: 'CA1', To: PHONE }), { dir, env, now: NOW });
  assert.doesNotMatch(silent.body, /<Recording/);
});

test('X-Twilio-Signature: valid, tampered, wrong token, port variant', () => {
  const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
  const params = { CallSid: 'CA1234567890ABCDE', Caller: '+12349013030', Digits: '1234', From: '+12349013030', To: '+18005551212' };
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = crypto.createHmac('sha1', '12345').update(data).digest('base64');
  assert.equal(twilioSignature('12345', url, params), expected);
  assert.equal(validateTwilioSignature('12345', url, params, expected), true);
  assert.equal(validateTwilioSignature('12345', url, { ...params, Digits: '9' }, expected), false);
  assert.equal(validateTwilioSignature('54321', url, params, expected), false);
  assert.equal(validateTwilioSignature('12345', url, params, ''), false);
  const withPort = twilioSignature('12345', 'https://mycompany.com:443/myapp.php?foo=1&bar=2', params);
  assert.equal(validateTwilioSignature('12345', url, params, withPort), true);
  const dir = productDir('sig');
  const bad = handleVoiceWebhook({ url: 'https://edge.example/voice/demo/inbound', body: 'From=%2B442071234567', headers: { 'x-twilio-signature': 'nope' } }, { dir, env, now: NOW });
  assert.equal(bad.status, 403);
  assert.ok(!fs.existsSync(path.join(dir, 'voice', 'calls.jsonl')), 'nothing written for an unsigned request');
});

test('claims: only verified rows, answers never go beyond them', () => {
  const claims = parseClaims(fs.readFileSync(path.join(productDir('claims'), 'claims.md'), 'utf8'));
  assert.deepEqual(claims.map((c) => c.id), ['C1', 'C2']);
  const a = answerFromClaims('How much is the pro plan per month?', claims);
  assert.equal(a.answered, true); assert.deepEqual(a.claims, ['C2']);
  const n = answerFromClaims('Will it double my revenue?', claims);
  assert.equal(n.answered, false); assert.doesNotMatch(n.text, /double/);
});

test('inbound call: disclosure, new caller becomes a lead, answer from claims, book or hand off → funnel updates', () => {
  const dir = productDir('inbound');
  const caller = '+447700900123';
  const ch = phoneHash(caller);
  const r = handleVoiceWebhook(signed('https://edge.example/voice/demo/inbound', { CallSid: 'CA9', From: caller, To: env.TWILIO_VOICE_FROM, Direction: 'inbound' }), { dir, env, now: NOW });
  assert.equal(r.status, 200); assert.match(r.headers['content-type'], /text\/xml/);
  assert.match(r.body, /Thanks for calling Demo Co\. You are speaking with an AI assistant/);
  const leadFile = path.join(dir, 'leads', `voice-${ch.slice(0, 12)}.json`);
  assert.equal(JSON.parse(fs.readFileSync(leadFile, 'utf8')).consent, 'inbound');
  const ask = handleVoiceWebhook(signed('https://edge.example/voice/demo/gather?step=ask&ref=inbound', { CallSid: 'CA9', From: caller, Direction: 'inbound', SpeechResult: 'how much does the pro plan cost' }), { dir, env, now: NOW });
  assert.match(ask.body, /Pro plan costs \$19 per month/);
  const book = handleVoiceWebhook(signed('https://edge.example/voice/demo/gather?step=next&ref=inbound', { CallSid: 'CA9', From: caller, Direction: 'inbound', Digits: '1' }), { dir, env, now: NOW });
  assert.match(book.body, /send you a link/);
  const u = JSON.parse(fs.readFileSync(path.join(dir, 'funnel', 'updates', 'voice-CA9-booking_requested.json'), 'utf8'));
  assert.deepEqual({ lead: u.lead, stage: u.stage, source: u.source }, { lead: `call-${ch.slice(0, 12)}`, stage: 'booked', source: 'voice' });
  assert.ok(!JSON.stringify(u).includes(caller));
  const person = handleVoiceWebhook(signed('https://edge.example/voice/demo/gather?step=next&ref=inbound', { CallSid: 'CA9', From: caller, Direction: 'inbound', SpeechResult: 'a person please' }), { dir, env: { ...env, TWILIO_VOICE_HANDOFF: '+442079460000' }, now: NOW });
  assert.match(person.body, /<Dial>\+442079460000<\/Dial>/);
  assert.ok(fs.existsSync(path.join(dir, 'funnel', 'updates', 'voice-CA9-handoff.json')));
});

test('outbound outcomes: stop → opt-out list and no more calls; status and relay-end → funnel updates', async () => {
  const dir = productDir('outcomes');
  const { fetch } = mock(() => [201, { sid: 'CA' + '2'.repeat(32), status: 'queued' }]);
  const sid = 'CA' + '2'.repeat(32);
  assert.equal((await voice.execute(item(), { slug: 'demo', dir, env, now: NOW, dryRun: false, fetch })).ok, true);
  const yes = handleVoiceWebhook(signed('https://edge.example/voice/demo/gather?step=interest&ref=A-CALL-1', { CallSid: sid, To: PHONE, SpeechResult: 'yes please' }), { dir, env, now: NOW });
  assert.match(yes.body, /step=book/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'funnel', 'updates', `voice-${sid}-interested.json`), 'utf8')).stage, 'qualified');
  const st = handleVoiceWebhook(signed('https://edge.example/voice/demo/status?step=call&ref=A-CALL-1', { CallSid: sid, To: PHONE, CallStatus: 'completed', CallDuration: '42' }), { dir, env, now: NOW });
  assert.equal(st.status, 200);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'funnel', 'updates', `voice-${sid}-answered.json`), 'utf8')).lead, 'L1');
  const relay = handleVoiceWebhook(signed('https://edge.example/voice/demo/status?step=relay-end&ref=A-CALL-1', { CallSid: sid, To: PHONE, HandoffData: JSON.stringify({ outcome: 'booking_requested', handoff: false }) }), { dir, env, now: NOW });
  assert.match(relay.body, /<Hangup\/>/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'funnel', 'updates', `voice-${sid}-booking_requested.json`), 'utf8')).stage, 'booked');
  const stop = handleVoiceWebhook(signed('https://edge.example/voice/demo/gather?step=book&ref=A-CALL-1', { CallSid: sid, To: PHONE, Digits: '9' }), { dir, env, now: NOW });
  assert.match(stop.body, /will not call you again/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'funnel', 'updates', `voice-${sid}-optout.json`), 'utf8')).stage, 'unsubscribed');
  const outs = JSON.parse(fs.readFileSync(path.join(dir, 'voice', 'optouts.json'), 'utf8'));
  assert.equal(outs.entries[0].phone_hash, H);
  assert.ok(!JSON.stringify(outs).includes(PHONE));
  const later = await voice.execute(item({ id: 'A-CALL-3' }), { slug: 'demo', dir, env, now: '2026-11-20T11:00:00Z', dryRun: false, fetch: noFetch });
  assert.equal(later.ok, false); assert.match(later.detail, /opt-out/);
  assert.equal(outcomeUpdate({ lead: 'L1', outcome: 'made_up', at: NOW }), null);
});

test('review guards: AI-voice scope, later revocation, DNC shape, bad clock', () => {
  const bad = (over, re) => { const r = checkCallConsent({ ...base, ...over }); assert.equal(r.ok, false); assert.ok(r.reasons.some((x) => re.test(x)), `${re} not in ${r.reasons}`); };
  bad({ consent: { records: [{ ...pewc, scope: undefined }] } }, /ai_voice/);
  bad({ consent: { records: [{ ...pewc, scope: ['marketing_calls'] }] } }, /ai_voice/);
  bad({ consent: { records: [pewc, { phone_hash: H, revoked_at: '2026-10-15T00:00:00Z' }] } }, /revoked/);
  bad({ consent: { records: [pewc, { phone_hash: H, revoked_at: 'garbage' }] } }, /revoked/);
  bad({ dnc: { ...freshDnc, listed: 42 } }, /not a list/);
  bad({ dnc: { ...freshDnc, scrubbed_at: '2027-01-01T00:00:00Z' } }, /future/);
  assert.equal(checkCallConsent({ ...base, now: 'not a date' }).ok, false);
  // Consent given again after a revocation counts.
  assert.equal(checkCallConsent({ ...base, consent: { records: [{ phone_hash: H, revoked_at: '2026-09-01T00:00:00Z' }, pewc] } }).ok, true);
});

test('review guards: budget re-check and call time limit', () => {
  assert.equal(checkCallBudget({ product, history: [], spent: 0, now: NOW }).ok, true);
  assert.match(checkCallBudget({ product: { ...product, budget: { mode: 'paid' } }, now: NOW }).reasons.join(), /daily_cap/);
  assert.match(checkCallBudget({ product, spent: 99.5, now: NOW }).reasons.join(), /monthly_cap/);
  const dialed = Array.from({ length: 10 }, () => ({ event: 'dialed', at: '2026-11-04T09:00:00Z' }));
  assert.match(checkCallBudget({ product, history: dialed, now: NOW }).reasons.join(), /daily_cap/);
  assert.equal(callTimeLimit({}), 600);
  assert.equal(callTimeLimit({ voice: { max_minutes: 500 } }), 1800);
  assert.equal(callTimeLimit({ voice: { max_minutes: 3 } }), 180);
});

test('review guards: connector refuses policy approvals, redirected numbers, lists and spent budgets', async () => {
  const dir = productDir('guards');
  const run = (it, extra = {}) => voice.execute(it, { slug: 'demo', dir, env, now: NOW, dryRun: false, fetch: noFetch, ...extra });
  assert.match((await run(item({ decided_by: 'policy:full' }))).detail, /owner's own approval/);
  assert.match((await run(item({ decided_by: 'policy:earned' }))).detail, /owner's own approval/);
  assert.match((await run(item({ to: US }))).detail, /does not match/);
  assert.match((await run(item({ lead: ['L1', 'L2'] }))).detail, /one call per approval/);
  assert.match((await run(item({ to: `${PHONE};${US}` }))).detail, /one call per approval/);
  fs.writeFileSync(path.join(dir, 'ledger.jsonl'), `${JSON.stringify({ at: '2026-11-02T00:00:00Z', kind: 'spend', amount: 99.5, channel: 'meta' })}\n`);
  const r = await run(item());
  assert.equal(r.ok, false); assert.match(r.detail, /monthly_cap/);
  // A sent call carries a TimeLimit.
  const dir2 = productDir('timelimit');
  const { calls, fetch } = mock(() => [201, { sid: 'CA' + '3'.repeat(32), status: 'queued' }]);
  assert.equal((await voice.execute(item(), { slug: 'demo', dir: dir2, env, now: NOW, dryRun: false, fetch })).ok, true);
  assert.equal(calls[0].body.get('TimeLimit'), '600');
});

test('review guards: negations are not a yes; recording needs the product setting; unsigned account refused', () => {
  const dir = productDir('neg', { product: { voice: { enabled: true, record: true } } });
  const sid = 'CA' + '4'.repeat(32);
  const ni = handleVoiceWebhook(signed('https://edge.example/voice/demo/gather?step=interest&ref=A1', { CallSid: sid, To: PHONE, SpeechResult: 'not interested' }), { dir, env, now: NOW });
  assert.match(ni.body, /Thanks for your time/);
  assert.ok(fs.existsSync(path.join(dir, 'funnel', 'updates', `voice-${sid}-not_interested.json`)));
  const rec = 'https://edge.example/voice/demo/gather?step=record&ref=A1';
  assert.doesNotMatch(handleVoiceWebhook(signed(rec, { CallSid: sid, To: PHONE, SpeechResult: 'no please do not record' }), { dir, env, now: NOW }).body, /<Recording/);
  assert.doesNotMatch(handleVoiceWebhook(signed(rec, { CallSid: sid, To: PHONE, SpeechResult: 'please' }), { dir, env, now: NOW }).body, /<Recording/);
  const off = productDir('recoff', { product: { voice: { enabled: true, record: false } } });
  assert.doesNotMatch(handleVoiceWebhook(signed(rec, { CallSid: sid, To: PHONE, Digits: '1' }), { dir: off, env, now: NOW }).body, /<Recording/);
  const url = 'https://edge.example/voice/demo/inbound';
  const p = { CallSid: 'CA5', From: '+447700900999', Direction: 'inbound' };
  const noAcct = handleVoiceWebhook({ url, body: new URLSearchParams(p).toString(), headers: { 'x-twilio-signature': twilioSignature(env.TWILIO_AUTH_TOKEN, url, p) } }, { dir, env, now: NOW });
  assert.equal(noAcct.status, 403);
});

test('CLI check prints reasons without the phone number', () => {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'connectors', 'voice.mjs');
  const r = spawnSync(process.execPath, [script, 'check'], { encoding: 'utf8', env: { ...process.env, OM_NO_DOTENV: '1' } });
  assert.equal(r.status, 2); assert.match(r.stderr, /Usage/);
  const s = spawnSync(process.execPath, [script, 'twiml', 'no-such-product-xyz'], { encoding: 'utf8', env: { ...process.env, OM_NO_DOTENV: '1' } });
  assert.equal(s.status, 2);
});
