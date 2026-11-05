// AI voice calling through Twilio Programmable Voice: approved outbound calls, an inbound call webhook,
// and call outcomes written as funnel updates.
//
// Outbound (connector): an approved item {type: "call", channel: "voice", lead, purpose} places ONE call.
// There is no dialer and no list: an item with several numbers is refused, and the executor only runs
// approved items (tools/execute.mjs). Before any network the call must pass checkCallConsent():
//   - product.voice.enabled === true, product not paused, budget.mode not "free" (calls cost money);
//   - a consent record in voice/consent.json for the callee's number, not revoked. Marketing calls need
//     prior express written consent (type "express_written", signed_at, covers AI/artificial voice);
//     informational and callback calls need at least prior express consent (AI voice is an artificial
//     voice under the TCPA, FCC declaratory ruling 2024);
//   - the product's suppression list (suppression.json, phone_hash or lead) and voice opt-outs
//     (voice/optouts.json) always block;
//   - national do-not-call: marketing calls need a DNC scrub (voice/dnc.json) no older than 31 days; a
//     listed number is only called with prior express written consent on record;
//   - calling hours in the callee's own time zone (default 9:00-20:00, never wider than 8:00-21:00, no
//     Sundays by default); a callee whose time zone cannot be known is not called;
//   - frequency caps per number (default 1 per day, 2 per 7 days, 3 per 30 days, 24 h apart).
// The approval must be the owner's (an item decided by autonomy policy, decided_by "policy:*", is refused),
// "to" may not differ from the lead's number on file, and checkCallBudget() re-checks the budget caps with
// an estimated cost per call (product.voice.cost_per_call, default 1); every call carries a TimeLimit
// (product.voice.max_minutes, default 10, never above 30). Consent revoked by any later record wins.
// Every call opens with an AI disclosure (who calls, for which seller, why, how to stop calls). Recording
// happens only when product.voice.record is true, the consent record does not refuse it, and the callee
// presses 1 or says yes after the recording announcement; only then <Start><Recording> runs.
// The conversation runs on ConversationRelay (<Connect><ConversationRelay url="wss://...">) when a relay
// URL is set, else on a TwiML <Gather> script for qualification and booking. Nothing else is sent: a
// booking request becomes a funnel update ("booked") so om-follow-up proposes the booking link through
// an approval.
//
// Inbound (handleVoiceWebhook): POST /voice/<slug>/inbound|gather|status, validated with X-Twilio-Signature
// (HMAC-SHA1 of the public URL plus sorted form params, keyed with TWILIO_AUTH_TOKEN). Inbound callers hear
// the AI disclosure, then get answers built only from verified rows of claims.md, then book or are handed
// off to a person (TWILIO_VOICE_HANDOFF) or leave a callback request.
//
// Files (products/<slug>/):
//   voice/consent.json    {records: [{phone_hash, type, signed_at, scope?, revoked_at?, recording?, timezone?}]}
//   voice/dnc.json        {scrubbed_at, source, listed: [phone_hash]}   national DNC scrub (owner provides)
//   voice/optouts.json    {entries: [{phone_hash, at, source}]}         written here when a callee says stop
//   voice/calls.jsonl     call log: call_sid, lead, phone_hash, event, at (no raw numbers)
//   funnel/updates/voice-*.json   outcomes for tools/funnel.mjs
//   leads/voice-<hash>.json       a new inbound caller as a lead (contact details live with leads only)
// Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VOICE_FROM (a Twilio number, E.164),
//      optional TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET (REST auth instead of the auth token),
//      TWILIO_VOICE_WEBHOOK_BASE (https://edge.example/voice/<slug>), TWILIO_VOICE_RELAY_URL (wss://...),
//      TWILIO_VOICE_HANDOFF (E.164 of the person who takes handoffs).
// Personal data: phone numbers appear only in leads files and in the request to Twilio; logs, details,
// refs and funnel updates carry a hash. Secrets come from env only and pass through redact().
// Usage: node tools/connectors/voice.mjs check <slug> <lead> [--purpose marketing|informational|callback] [--now ISO]
//        node tools/connectors/voice.mjs twiml <slug> [--inbound] [--purpose ...]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, root } from '../lib/env.mjs';
import { defineConnector, request, redact, missingKeys } from './_http.mjs';
import { spentThisMonth } from '../budget.mjs';

export const API_BASE = 'https://api.twilio.com/2010-04-01';
export const NEEDS = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VOICE_FROM'];
export const PURPOSES = ['marketing', 'informational', 'callback'];
export const DEFAULT_HOURS = { start: 9, end: 20, days: [1, 2, 3, 4, 5, 6] }; // local hours; 0 = Sunday
export const LEGAL_HOURS = { start: 8, end: 21 };
export const DEFAULT_CAPS = { per_day: 1, per_week: 2, per_30d: 3, min_gap_hours: 24 };
export const DNC_MAX_AGE_DAYS = 31;
export const TWIML_MAX = 4000; // Twilio limit for the Twiml parameter
export const OUTCOMES = {
  answered: 'called', no_answer: 'attempted', interested: 'qualified', qualified: 'qualified',
  booking_requested: 'booked', handoff: 'engaged', callback_requested: 'engaged',
  not_interested: 'not_now', optout: 'unsubscribed',
};
// Call cost guard: every call is capped in length (TimeLimit) and its estimated cost must fit the budget.
export const DEFAULT_COST_PER_CALL = 1; // conservative estimate in the budget currency (telephony + AI)
export const DEFAULT_MAX_MINUTES = 10;
export const MAX_MINUTES = 30;
const STOP_WORDS = /\b(stop call|stop calling|do not call|don't call|dont call|remove me|unsubscribe|take me off)\b/i;
const YES = /\b(yes|yeah|yep|sure|ok|okay|please|book|interested)\b/i;
// Any negation turns a "yes"-looking answer into a no ("not interested", "no, please don't record").
const NO = /\b(no|not|nope|nah|don'?t|do not|never|stop|refuse)\b/i;
// Recording consent is narrower than interest: only an explicit agreement counts.
const RECORD_YES = /\b(yes|yeah|yep|sure|ok|okay|agree|i agree)\b/i;

// ---------- small helpers ----------
export const xmlEscape = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
export function normalizePhone(s) {
  const raw = String(s ?? '').trim();
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, '');
  const e164 = raw.startsWith('+') ? `+${digits}` : raw.startsWith('00') ? `+${digits.slice(2)}` : digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : null;
  return e164 && /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}
export const phoneHash = (p) => { const n = normalizePhone(p); return n ? crypto.createHash('sha256').update(n).digest('hex').slice(0, 16) : null; };
// Phone-number-like runs are masked in anything that leaves this module as text.
export const maskPhones = (s) => String(s ?? '').replace(/\+?\d[\d\s().-]{6,}\d/g, '***');
const clean = (s, env) => maskPhones(redact(s, env));
const hoursBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 3600000;
const readJsonl = (f) => { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const appendJsonl = (f, row) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, `${JSON.stringify(row)}\n`); };
const safeId = (s) => String(s ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);

// Time zone of a number when the country has only one. Multi-zone countries (US, CA, AU, BR, MX, RU ...)
// need a time zone on the lead or the consent record; without it the call is not placed.
const SINGLE_ZONE = {
  '+44': 'Europe/London', '+353': 'Europe/Dublin', '+49': 'Europe/Berlin', '+33': 'Europe/Paris', '+34': 'Europe/Madrid',
  '+39': 'Europe/Rome', '+31': 'Europe/Amsterdam', '+32': 'Europe/Brussels', '+41': 'Europe/Zurich', '+43': 'Europe/Vienna',
  '+45': 'Europe/Copenhagen', '+46': 'Europe/Stockholm', '+47': 'Europe/Oslo', '+358': 'Europe/Helsinki', '+48': 'Europe/Warsaw',
  '+64': 'Pacific/Auckland', '+65': 'Asia/Singapore', '+81': 'Asia/Tokyo', '+82': 'Asia/Seoul', '+91': 'Asia/Kolkata',
  '+971': 'Asia/Dubai', '+972': 'Asia/Jerusalem', '+98': 'Asia/Tehran', '+90': 'Europe/Istanbul', '+27': 'Africa/Johannesburg',
};
const validZone = (tz) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };
export function calleeTimeZone(phone, ...hints) {
  for (const h of hints) if (h && validZone(h)) return h;
  const n = normalizePhone(phone);
  if (!n) return null;
  const code = Object.keys(SINGLE_ZONE).sort((a, b) => b.length - a.length).find((c) => n.startsWith(c));
  return code ? SINGLE_ZONE[code] : null;
}
export function localClock(iso, tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', weekday: 'short', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { hour: Number(get('hour')) % 24, minute: Number(get('minute')), day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')) };
}
// Product calling hours, clamped inside the legal window: an owner can narrow it, never widen it.
export function callingHours(product = {}) {
  const h = product.voice?.calling_hours ?? {};
  const start = Math.max(LEGAL_HOURS.start, Number.isFinite(Number(h.start)) ? Number(h.start) : DEFAULT_HOURS.start);
  const end = Math.min(LEGAL_HOURS.end, Number.isFinite(Number(h.end)) ? Number(h.end) : DEFAULT_HOURS.end);
  const days = Array.isArray(h.days) && h.days.length ? h.days.map(Number).filter((d) => d >= 0 && d <= 6) : DEFAULT_HOURS.days;
  return { start, end: Math.max(start, end), days };
}
export function callCaps(product = {}) {
  const c = product.voice?.caps ?? {};
  // Caps can only be tightened: a higher value than the default is ignored.
  const tight = (k) => Math.min(DEFAULT_CAPS[k], Number.isFinite(Number(c[k])) ? Number(c[k]) : DEFAULT_CAPS[k]);
  return { per_day: tight('per_day'), per_week: tight('per_week'), per_30d: tight('per_30d'), min_gap_hours: Math.max(DEFAULT_CAPS.min_gap_hours, Number(c.min_gap_hours) || 0) };
}
// Longest call allowed (seconds, sent as TimeLimit): the owner can shorten it, never past MAX_MINUTES.
export function callTimeLimit(product = {}) {
  const m = Number(product.voice?.max_minutes);
  return Math.round(60 * Math.min(MAX_MINUTES, Number.isFinite(m) && m > 0 ? m : DEFAULT_MAX_MINUTES));
}
// Budget re-check before a call (pure): budget caps must exist, and the estimated cost of this call plus
// today's dialed calls must fit daily_cap, and spend this month plus this call must fit monthly_cap.
export function checkCallBudget({ product = {}, history = [], spent = 0, now = new Date().toISOString() } = {}) {
  const b = product.budget ?? {};
  const daily = Number(b.daily_cap), monthly = Number(b.monthly_cap);
  const raw = Number(product.voice?.cost_per_call);
  const est = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_COST_PER_CALL;
  const day = String(now).slice(0, 10);
  const today = history.filter((r) => r?.event === 'dialed' && String(r.at ?? '').startsWith(day)).length;
  const reasons = [];
  if (!(daily > 0) || !(monthly > 0)) reasons.push('budget.daily_cap and budget.monthly_cap must be set (calls cost money)');
  else {
    if ((today + 1) * est > daily) reasons.push(`estimated call cost ${Math.round((today + 1) * est * 100) / 100} today is over daily_cap ${daily}`);
    if (Number(spent || 0) + est > monthly) reasons.push(`spent ${spent} + estimated call cost ${est} is over monthly_cap ${monthly}`);
  }
  return { ok: !reasons.length, reasons, estimate: est };
}

// ---------- consent checks (pure) ----------
// Returns {ok, reasons[], notes[], timezone}. Everything fails closed: missing data blocks the call.
export function checkCallConsent({ phone, lead = {}, purpose = 'marketing', product = {}, consent = null, dnc = null, suppression = null, optouts = null, history = [], now = new Date().toISOString() } = {}) {
  const reasons = []; const notes = [];
  if (!Number.isFinite(Date.parse(now))) return { ok: false, reasons: ['invalid current time'], notes, timezone: null, phone_hash: null, recording_allowed: false };
  const n = normalizePhone(phone);
  const h = n ? phoneHash(n) : null;
  if (!PURPOSES.includes(purpose)) reasons.push(`unknown purpose "${purpose}"`);
  if (!n) reasons.push('no valid phone number for this lead');
  if (product.stage === 'paused') reasons.push('product is paused');
  if (product.voice?.enabled !== true) reasons.push('voice calling is not enabled (product.json voice.enabled)');
  if ((product.budget?.mode ?? 'free') === 'free') reasons.push('budget.mode is free and calls cost money');
  if (!String(product.name ?? '').trim()) reasons.push('product.json has no name to identify the seller');
  // Suppression and opt-outs block every purpose.
  const sup = Array.isArray(suppression) ? suppression : Array.isArray(suppression?.entries) ? suppression.entries : [];
  if (h && sup.some((e) => e?.phone_hash === h || (lead.id != null && e?.lead === lead.id))) reasons.push('number is on the product suppression list');
  const outs = Array.isArray(optouts) ? optouts : Array.isArray(optouts?.entries) ? optouts.entries : [];
  if (h && outs.some((e) => e?.phone_hash === h)) reasons.push('callee asked not to be called (voice opt-out)');
  // Consent record for this number.
  const allRecs = Array.isArray(consent) ? consent : Array.isArray(consent?.records) ? consent.records : [];
  const recs = h ? allRecs.filter((r) => r?.phone_hash === h) : [];
  // A revocation anywhere for this number (its own record or a separate one) voids every consent given
  // before it; an unparseable revocation date voids all of them.
  const revs = recs.filter((r) => r.revoked_at).map((r) => Date.parse(r.revoked_at));
  const lastRev = revs.length ? (revs.some((t) => !Number.isFinite(t)) ? Infinity : Math.max(...revs)) : -Infinity;
  const live = recs.filter((r) => !r.revoked_at && (!r.expires_at || Date.parse(r.expires_at) > Date.parse(now)) && (lastRev === -Infinity || Date.parse(r.signed_at ?? '') > lastRev));
  if (recs.length && !live.length) reasons.push('consent was revoked or expired');
  // Written consent for marketing must name AI / artificial voice calls in its scope.
  const written = live.find((r) => r.type === 'express_written' && r.signed_at && Date.parse(r.signed_at) <= Date.parse(now) && Array.isArray(r.scope) && r.scope.includes('ai_voice'));
  const express = written ?? live.find((r) => ['express', 'express_written'].includes(r.type));
  if (purpose === 'marketing' && !written) reasons.push('marketing call needs prior express written consent covering AI voice (scope "ai_voice") on record (voice/consent.json)');
  if (purpose !== 'marketing' && !express) reasons.push('call needs prior express consent on record (voice/consent.json)');
  // National do-not-call scrub (marketing only), fresh within 31 days.
  if (purpose === 'marketing') {
    const at = Date.parse(dnc?.scrubbed_at ?? '');
    if (!Number.isFinite(at)) reasons.push('no national do-not-call scrub on record (voice/dnc.json)');
    else if (at > Date.parse(now)) reasons.push('do-not-call scrub date is in the future');
    else if ((Date.parse(now) - at) / 86400000 > DNC_MAX_AGE_DAYS) reasons.push(`do-not-call scrub is older than ${DNC_MAX_AGE_DAYS} days`);
    else if (dnc.listed != null && !Array.isArray(dnc.listed)) reasons.push('voice/dnc.json "listed" is not a list');
    else if (h && (dnc.listed ?? []).includes(h)) { if (written) notes.push('number is on the national DNC list; called on prior express written consent'); else reasons.push('number is on the national do-not-call list'); }
  }
  // Calling hours in the callee's time zone.
  const tz = n ? calleeTimeZone(n, lead.timezone, lead.tz, express?.timezone) : null;
  if (n && !tz) reasons.push('callee time zone unknown; set timezone on the lead or consent record');
  if (tz) {
    const win = callingHours(product); const c = localClock(now, tz);
    if (!win.days.includes(c.day) || c.hour < win.start || c.hour >= win.end) reasons.push(`outside calling hours in ${tz} (${win.start}:00-${win.end}:00)`);
  }
  // Frequency caps on dialed calls to this number.
  if (h) {
    const caps = callCaps(product);
    const dialed = history.filter((r) => r?.phone_hash === h && r.event === 'dialed' && Number.isFinite(Date.parse(r.at)) && Date.parse(r.at) <= Date.parse(now));
    const within = (hrs) => dialed.filter((r) => hoursBetween(r.at, now) < hrs).length;
    if (within(24) >= caps.per_day) reasons.push(`call cap reached: ${caps.per_day} per day`);
    else if (within(168) >= caps.per_week) reasons.push(`call cap reached: ${caps.per_week} per 7 days`);
    else if (within(720) >= caps.per_30d) reasons.push(`call cap reached: ${caps.per_30d} per 30 days`);
    const last = dialed.map((r) => r.at).sort().pop();
    if (last && hoursBetween(last, now) < caps.min_gap_hours) reasons.push(`last call was less than ${caps.min_gap_hours} h ago`);
  }
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)], notes, timezone: tz, phone_hash: h, recording_allowed: product.voice?.record === true && express?.recording !== false };
}

// ---------- claims ----------
// Verified rows of claims.md: | id | claim | status | source |
export function parseClaims(md) {
  return String(md ?? '').split(/\r?\n/).map((l) => l.split('|').map((c) => c.trim())).filter((c) => c.length >= 5 && /^C\d+/i.test(c[1]) && c[3].toLowerCase() === 'verified' && c[2]).map((c) => ({ id: c[1], claim: c[2] }));
}
const words = (s) => String(s ?? '').toLowerCase().match(/[a-z0-9$]+/g)?.filter((w) => w.length > 2 && !['the', 'and', 'for', 'you', 'your', 'what', 'how', 'does', 'can', 'are', 'with', 'this', 'that', 'have', 'about'].includes(w)) ?? [];
// The verified claims that best match a caller's question (word overlap). No match → no answer.
export function answerFromClaims(question, claims = [], max = 2) {
  const q = new Set(words(question));
  const scored = claims.map((c) => ({ ...c, score: words(c.claim).filter((w) => q.has(w) || q.has(w.replace(/s$/, ''))).length })).filter((c) => c.score > 0).sort((a, b) => b.score - a.score).slice(0, max);
  return scored.length ? { answered: true, text: scored.map((c) => c.claim).join(' '), claims: scored.map((c) => c.id) } : { answered: false, text: "I don't have a verified answer to that, so I won't guess.", claims: [] };
}

// ---------- TwiML ----------
const say = (text, o = {}) => `<Say${o.voice ? ` voice="${xmlEscape(o.voice)}"` : ''}${o.language ? ` language="${xmlEscape(o.language)}"` : ''}>${xmlEscape(text)}</Say>`;
const response = (inner) => `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
const hook = (base, step, q = {}) => `${String(base ?? '').replace(/\/+$/, '')}/${step}?${new URLSearchParams(q).toString()}`;
export function disclosureText({ seller, purpose = 'marketing', direction = 'outbound', record = false }) {
  const why = { marketing: `to tell you about ${seller}`, informational: `with information from ${seller}`, callback: `because you asked ${seller} to call you back` }[purpose] ?? `on behalf of ${seller}`;
  const who = direction === 'inbound' ? `Thanks for calling ${seller}. You are speaking with an AI assistant, an automated voice, not a person.` : `Hello, this is an AI assistant, an automated voice calling on behalf of ${seller}, ${why}.`;
  const rec = record ? ' We would like to record this call, and we only do so if you agree.' : ' This call is not recorded.';
  const stop = direction === 'inbound' ? '' : ' If you do not want calls from us, say stop calling or press 9 at any time.';
  return `${who}${rec}${stop}`;
}
const gather = (action, inner, o = {}) => `<Gather input="dtmf speech" numDigits="1" timeout="6" speechTimeout="auto" action="${xmlEscape(action)}" method="POST"${o.language ? ` language="${xmlEscape(o.language)}"` : ''}>${inner}</Gather>`;
// The conversation after the disclosure: ConversationRelay when a wss:// URL is set, else the Gather script.
export function conversationTwiml({ seller, offer, relayUrl, base, ref, direction = 'outbound', language = 'en-US', voice }) {
  if (relayUrl && /^wss:\/\//.test(relayUrl)) {
    const greet = direction === 'inbound' ? 'How can I help you today?' : `Is now a good moment for a quick question about ${offer || seller}?`;
    return `<Connect action="${xmlEscape(hook(base, 'status', { step: 'relay-end', ref }))}" method="POST"><ConversationRelay url="${xmlEscape(relayUrl)}" welcomeGreeting="${xmlEscape(greet)}" language="${xmlEscape(language)}" interruptible="any" dtmfDetection="true"><Parameter name="ref" value="${xmlEscape(ref)}"/><Parameter name="direction" value="${xmlEscape(direction)}"/></ConversationRelay></Connect>`;
  }
  if (direction === 'inbound') return gather(hook(base, 'gather', { step: 'ask', ref }), say('What would you like to know?', { language, voice }), { language }) + say('I did not hear anything. Goodbye.', { language, voice }) + '<Hangup/>';
  return gather(hook(base, 'gather', { step: 'interest', ref }), say(`Would you like to hear how ${offer || seller} could help you? Say yes or press 1. Say no or press 2.`, { language, voice }), { language }) + say('Thanks for your time. Goodbye.', { language, voice }) + '<Hangup/>';
}
// The TwiML an outbound call starts with: disclosure first, then the recording question (only when
// recording is allowed), then the conversation. No <Recording> is ever started here.
export function buildOutboundTwiml({ seller, offer, purpose = 'marketing', record = false, relayUrl, base, ref, language = 'en-US', voice }) {
  const o = { language, voice };
  const first = say(disclosureText({ seller, purpose, record }), o);
  if (record) return response(first + gather(hook(base, 'gather', { step: 'record', ref }), say('To allow recording, say yes or press 1. To continue without recording, press 2.', o), { language }) + `<Redirect method="POST">${xmlEscape(hook(base, 'gather', { step: 'record', ref, none: '1' }))}</Redirect>`);
  return response(first + conversationTwiml({ seller, offer, relayUrl, base, ref, language, voice }));
}
export function buildInboundTwiml({ seller, relayUrl, base, language = 'en-US', voice }) {
  return response(say(disclosureText({ seller, direction: 'inbound' }), { language, voice }) + conversationTwiml({ seller, relayUrl, base, ref: 'inbound', direction: 'inbound', language, voice }));
}

// ---------- X-Twilio-Signature ----------
// base64(HMAC-SHA1(authToken, url + each POST param name and value, sorted by name)).
export function twilioSignature(authToken, url, params = {}) {
  const keys = Object.keys(params).sort();
  const data = keys.reduce((s, k) => s + (Array.isArray(params[k]) ? [...params[k]].sort().map((v) => k + v).join('') : k + (params[k] ?? '')), String(url));
  return crypto.createHmac('sha1', String(authToken)).update(Buffer.from(data, 'utf8')).digest('base64');
}
// Twilio may sign the URL with or without the default port, so both forms are tried.
export function validateTwilioSignature(authToken, url, params, signature) {
  if (!authToken || !signature || !url) return false;
  const variants = new Set([url]);
  try {
    const u = new URL(url); const dflt = u.protocol === 'https:' ? '443' : '80';
    if (u.port) { const v = new URL(url); v.port = ''; variants.add(v.toString()); } else variants.add(url.replace(`${u.protocol}//${u.host}`, `${u.protocol}//${u.hostname}:${dflt}`));
  } catch { return false; }
  const got = Buffer.from(String(signature));
  return [...variants].some((v) => { const exp = Buffer.from(twilioSignature(authToken, v, params)); return exp.length === got.length && crypto.timingSafeEqual(exp, got); });
}

// ---------- product files ----------
export function loadVoiceContext(dir) {
  const v = (f, d) => readJson(path.join(dir, 'voice', f), d);
  return {
    product: readJson(path.join(dir, 'product.json'), {}),
    consent: v('consent.json', { records: [] }), dnc: v('dnc.json', null), optouts: v('optouts.json', { entries: [] }),
    suppression: readJson(path.join(dir, 'suppression.json'), { entries: [] }),
    history: readJsonl(path.join(dir, 'voice', 'calls.jsonl')),
    claims: (() => { try { return parseClaims(fs.readFileSync(path.join(dir, 'claims.md'), 'utf8')); } catch { return []; } })(),
  };
}
// A lead's contact row from leads.jsonl or leads/*.json (where contact details live).
export function findLead(dir, id) {
  if (id == null || id === '') return null;
  const rows = [...readJsonl(path.join(dir, 'leads.jsonl'))];
  const ld = path.join(dir, 'leads');
  if (fs.existsSync(ld)) for (const f of fs.readdirSync(ld).filter((x) => x.endsWith('.json'))) { const j = readJson(path.join(ld, f), null); rows.push(...(Array.isArray(j) ? j : j?.leads ?? (j ? [j] : []))); }
  const hit = rows.filter((r) => r && [r.lead_id, r.id].map(String).includes(String(id)));
  if (!hit.length) return null;
  const m = Object.assign({}, ...hit);
  return { id: String(id), phone: m.phone ?? m.contact?.phone ?? null, timezone: m.timezone ?? m.tz ?? null };
}
export function leadByPhoneHash(dir, h) {
  const rows = [...readJsonl(path.join(dir, 'leads.jsonl'))];
  const ld = path.join(dir, 'leads');
  if (fs.existsSync(ld)) for (const f of fs.readdirSync(ld).filter((x) => x.endsWith('.json'))) { const j = readJson(path.join(ld, f), null); rows.push(...(Array.isArray(j) ? j : j?.leads ?? (j ? [j] : []))); }
  const r = rows.find((x) => x && phoneHash(x.phone ?? x.contact?.phone) === h);
  return r ? String(r.lead_id ?? r.id) : null;
}

// Outcome → funnel update file (tools/funnel.mjs merges funnel/updates/*.json) plus a call log row.
export function outcomeUpdate({ lead, outcome, at, direction = 'outbound', callSid }) {
  const stage = OUTCOMES[outcome];
  if (!stage || !lead) return null;
  return { lead, stage, at, source: 'voice', note: `voice ${direction}: ${outcome}`, ref: callSid ? `voice:${safeId(callSid)}` : undefined };
}
export function recordOutcome(dir, { callSid, lead, outcome, at, direction = 'outbound', phone_hash = null }) {
  appendJsonl(path.join(dir, 'voice', 'calls.jsonl'), { call_sid: safeId(callSid), lead: lead ?? null, phone_hash, direction, event: outcome, at });
  const u = outcomeUpdate({ lead, outcome, at, direction, callSid });
  if (!u) return null;
  const d = path.join(dir, 'funnel', 'updates');
  fs.mkdirSync(d, { recursive: true });
  const file = path.join(d, `voice-${safeId(callSid) || crypto.randomUUID().slice(0, 8)}-${outcome}.json`);
  writeJson(file, u);
  return { file: path.relative(dir, file).replace(/\\/g, '/'), update: u };
}
function addOptout(dir, h, at, source) {
  const f = path.join(dir, 'voice', 'optouts.json');
  const j = readJson(f, { entries: [] });
  if (!(j.entries ??= []).some((e) => e.phone_hash === h)) j.entries.push({ phone_hash: h, at, source });
  fs.mkdirSync(path.dirname(f), { recursive: true });
  writeJson(f, j);
}

// ---------- outbound connector ----------
const authHeader = (env) => `Basic ${Buffer.from(env.TWILIO_API_KEY_SID && env.TWILIO_API_KEY_SECRET ? `${env.TWILIO_API_KEY_SID}:${env.TWILIO_API_KEY_SECRET}` : `${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`;
const settings = (product, env) => ({
  seller: String(product.name ?? '').trim(), offer: product.voice?.offer ?? '', language: product.voice?.language ?? 'en-US', voice: product.voice?.voice,
  relayUrl: env.TWILIO_VOICE_RELAY_URL || product.voice?.relay_url || null, base: env.TWILIO_VOICE_WEBHOOK_BASE || product.voice?.webhook_base || null,
});

export const voice = defineConnector({
  name: 'twilio-voice',
  handles: 'type "call" with channel "voice" (one approved AI call; consent, DNC, hours and caps checked first)',
  needs: NEEDS,
  required: (env) => missingKeys(env, NEEDS),
  accepts: (item) => item.type === 'call' && (item.channel ?? 'voice') === 'voice',
  prepare(item, ctx) {
    if (Array.isArray(item.to) || Array.isArray(item.leads) || Array.isArray(item.lead) || /[,;]/.test(String(item.to ?? ''))) return { error: 'one call per approval: lists and dialing campaigns are refused' };
    // AI calls never run on autonomy policy (level, always_auto or earned): the owner approves each one.
    if (/^policy:/.test(String(item.decided_by ?? ''))) return { error: 'call blocked: AI calls need the owner\'s own approval, not an automatic one' };
    const purpose = item.purpose ?? 'marketing';
    const vc = loadVoiceContext(ctx.dir);
    const lead = findLead(ctx.dir, item.lead) ?? { id: item.lead ?? null };
    // The number dialed is the lead's own number on file; an approval cannot redirect the call elsewhere.
    if (item.to != null && lead.phone && normalizePhone(item.to) !== normalizePhone(lead.phone)) return { error: 'call blocked: "to" does not match the lead\'s number on file' };
    const phone = normalizePhone(item.to ?? lead.phone);
    const now = ctx.now ?? new Date().toISOString();
    const chk = checkCallConsent({ phone, lead, purpose, product: vc.product, consent: vc.consent, dnc: vc.dnc, suppression: vc.suppression, optouts: vc.optouts, history: vc.history, now });
    if (!chk.ok) return { error: `call blocked: ${chk.reasons.join('; ')}` };
    const bud = checkCallBudget({ product: vc.product, history: vc.history, spent: spentThisMonth(path.join(ctx.dir, 'ledger.jsonl'), now), now });
    if (!bud.ok) return { error: `call blocked: ${bud.reasons.join('; ')}` };
    const s = settings(vc.product, ctx.env);
    if (!s.base || !/^https:\/\//.test(s.base)) return { error: 'TWILIO_VOICE_WEBHOOK_BASE (https) is needed so the call can report outcomes and honour opt-outs' };
    const twiml = buildOutboundTwiml({ ...s, purpose, record: chk.recording_allowed, ref: safeId(item.id) });
    if (twiml.length > TWIML_MAX) return { error: `TwiML is ${twiml.length} characters (Twilio limit ${TWIML_MAX})` };
    const form = new URLSearchParams({ To: phone, From: String(ctx.env.TWILIO_VOICE_FROM ?? ''), Twiml: twiml, StatusCallback: hook(s.base, 'status', { step: 'call', ref: safeId(item.id) }), StatusCallbackMethod: 'POST', Timeout: '25', TimeLimit: String(callTimeLimit(vc.product)) });
    for (const ev of ['initiated', 'ringing', 'answered', 'completed']) form.append('StatusCallbackEvent', ev);
    return { form, lead: lead.id, phone_hash: chk.phone_hash, purpose, twiml, notes: chk.notes, preview: `place 1 ${purpose} AI call to lead ${lead.id ?? '(no id)'} (${chk.timezone}${chk.recording_allowed ? ', recording only on consent' : ', no recording'})` };
  },
  async send(p, item, ctx) {
    const url = `${API_BASE}/Accounts/${encodeURIComponent(ctx.env.TWILIO_ACCOUNT_SID)}/Calls.json`;
    const r = await request(ctx, { url, headers: { authorization: authHeader(ctx.env) }, form: p.form });
    if (!r.ok || !r.data?.sid) return { ok: false, ref: '', detail: clean(`twilio voice: HTTP ${r.status} ${r.data?.message ?? r.text ?? ''}`.slice(0, 240), ctx.env) };
    appendJsonl(path.join(ctx.dir, 'voice', 'calls.jsonl'), { call_sid: safeId(r.data.sid), approval: safeId(item.id), lead: p.lead ?? null, phone_hash: p.phone_hash, purpose: p.purpose, direction: 'outbound', event: 'dialed', at: ctx.now ?? new Date().toISOString() });
    return { ok: true, ref: r.data.sid, detail: clean(`call ${r.data.status ?? 'queued'} for lead ${p.lead ?? '(no id)'}${p.notes.length ? `; ${p.notes.join('; ')}` : ''}`, ctx.env) };
  },
});

// ---------- webhook (inbound calls, gather steps, status callbacks) ----------
const twimlRes = (body, status = 200) => ({ status, headers: { 'content-type': 'text/xml; charset=utf-8' }, body });
const isYes = (p) => p.Digits === '1' || (!p.Digits && YES.test(p.SpeechResult ?? '') && !NO.test(p.SpeechResult ?? ''));
const isRecordYes = (p) => p.Digits === '1' || (!p.Digits && RECORD_YES.test(p.SpeechResult ?? '') && !NO.test(p.SpeechResult ?? ''));
const isStop = (p) => p.Digits === '9' || STOP_WORDS.test(p.SpeechResult ?? '');
// The public URL Twilio called, rebuilt from TWILIO_VOICE_WEBHOOK_BASE's origin (proxies change Host).
export function publicUrlFor(env, reqUrl) { try { return new URL(reqUrl, new URL(env.TWILIO_VOICE_WEBHOOK_BASE).origin).toString(); } catch { return null; } }

// req: {url: public URL Twilio called, body: raw form string or object, headers: {x-twilio-signature}}.
// Returns {status, headers, body}. Writes only voice/*, funnel/updates/voice-* and leads/voice-*.
export function handleVoiceWebhook(req, { dir, env = process.env, now = new Date().toISOString() } = {}) {
  const params = typeof req.body === 'string' ? Object.fromEntries(new URLSearchParams(req.body)) : { ...(req.body ?? {}) };
  const sig = req.headers?.['x-twilio-signature'] ?? req.headers?.['X-Twilio-Signature'];
  if (!validateTwilioSignature(env.TWILIO_AUTH_TOKEN, req.url, params, sig)) return { status: 403, headers: { 'content-type': 'text/plain' }, body: 'invalid signature' };
  if (env.TWILIO_ACCOUNT_SID && params.AccountSid !== env.TWILIO_ACCOUNT_SID) return { status: 403, headers: { 'content-type': 'text/plain' }, body: 'wrong account' };
  const u = new URL(req.url);
  const route = u.pathname.replace(/\/+$/, '').split('/').pop();
  const step = u.searchParams.get('step') ?? '';
  const vc = loadVoiceContext(dir);
  const s = settings(vc.product, env);
  s.base = s.base || `${u.origin}${u.pathname.replace(/\/[^/]*$/, '')}`;
  const o = { language: s.language, voice: s.voice };
  const callSid = safeId(params.CallSid);
  const inbound = params.Direction === 'inbound' || u.searchParams.get('ref') === 'inbound' || route === 'inbound';
  const remote = inbound ? params.From : params.To;
  const h = phoneHash(remote);
  const logged = vc.history.find((r) => r.call_sid === callSid && r.lead);
  const lead = logged?.lead ?? (h ? leadByPhoneHash(dir, h) : null) ?? (inbound && h ? `call-${h.slice(0, 12)}` : null);
  const done = (outcome) => recordOutcome(dir, { callSid, lead, outcome, at: now, direction: inbound ? 'inbound' : 'outbound', phone_hash: h });
  const handoff = normalizePhone(env.TWILIO_VOICE_HANDOFF);
  const dialHandoff = () => (handoff ? say('Connecting you to a person now.', o) + `<Dial>${xmlEscape(handoff)}</Dial>` : say('A person from our team will call you back. Goodbye.', o) + '<Hangup/>');
  const optout = () => { if (h) addOptout(dir, h, now, inbound ? 'voice-inbound' : 'voice-outbound'); done('optout'); return twimlRes(response(say('Understood. We will not call you again. Goodbye.', o) + '<Hangup/>')); };

  if (route === 'inbound') {
    if (!h) return twimlRes(response(say(disclosureText({ seller: s.seller || 'us', direction: 'inbound' }), o) + '<Hangup/>'));
    // A caller we do not know becomes a lead (consent "inbound": they called us).
    if (!leadByPhoneHash(dir, h)) {
      const f = path.join(dir, 'leads', `voice-${h.slice(0, 12)}.json`);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      if (!fs.existsSync(f)) writeJson(f, { lead_id: lead, phone: normalizePhone(remote), channel: 'phone', source: 'voice-inbound', consent: 'inbound', created_at: now });
    }
    appendJsonl(path.join(dir, 'voice', 'calls.jsonl'), { call_sid: callSid, lead, phone_hash: h, direction: 'inbound', event: 'received', at: now });
    return twimlRes(buildInboundTwiml({ ...s, seller: s.seller || 'us' }));
  }
  if (route === 'gather') {
    if (step !== 'record' && isStop(params)) return optout();
    const ref = safeId(u.searchParams.get('ref'));
    if (step === 'record') {
      // Recording needs the product setting still on (re-read now) and an explicit yes from the callee.
      const yes = vc.product.voice?.record === true && u.searchParams.get('none') !== '1' && isRecordYes(params);
      const rec = yes ? `<Start><Recording channels="dual" recordingStatusCallback="${xmlEscape(hook(s.base, 'status', { step: 'recording', ref }))}" recordingStatusCallbackEvent="completed"/></Start>${say('Thank you. Recording is on.', o)}` : say('No problem, this call is not recorded.', o);
      if (isStop(params)) return optout();
      return twimlRes(response(rec + conversationTwiml({ ...s, ref, direction: 'outbound' })));
    }
    if (step === 'interest') {
      if (!isYes(params)) { done('not_interested'); return twimlRes(response(say('Thanks for your time. Goodbye.', o) + '<Hangup/>')); }
      done('interested');
      return twimlRes(response(gather(hook(s.base, 'gather', { step: 'book', ref }), say('Would you like to book a short call with our team? Say yes or press 1. Say no or press 2.', o), o) + say('Thanks. Goodbye.', o) + '<Hangup/>'));
    }
    if (step === 'book') {
      if (!isYes(params)) return twimlRes(response(say('Thanks, that is fine. Goodbye.', o) + '<Hangup/>'));
      done('booking_requested');
      return twimlRes(response(handoff ? dialHandoff() : say('Great. Our team will send you a link to pick a time. Goodbye.', o) + '<Hangup/>'));
    }
    if (step === 'ask') {
      const a = answerFromClaims(params.SpeechResult ?? '', vc.claims);
      return twimlRes(response(say(a.text, o) + gather(hook(s.base, 'gather', { step: 'next', ref: 'inbound' }), say('Would you like to book a call, say book or press 1, or speak to a person, say person or press 2?', o), o) + say('Thanks for calling. Goodbye.', o) + '<Hangup/>'));
    }
    if (step === 'next') {
      const sp = String(params.SpeechResult ?? '');
      if (params.Digits === '1' || /\bbook/i.test(sp)) { done('booking_requested'); return twimlRes(response(say('Thank you. Our team will send you a link to pick a time. Goodbye.', o) + '<Hangup/>')); }
      if (params.Digits === '2' || /\b(person|human|agent|someone)\b/i.test(sp)) { done(handoff ? 'handoff' : 'callback_requested'); return twimlRes(response(dialHandoff())); }
      return twimlRes(response(say('Thanks for calling. Goodbye.', o) + '<Hangup/>'));
    }
    return twimlRes(response('<Hangup/>'));
  }
  if (route === 'status') {
    if (step === 'relay-end') {
      // ConversationRelay ends with HandoffData set by the relay app: {"outcome": "...", "handoff": true}.
      let hd = {}; try { hd = JSON.parse(params.HandoffData ?? '{}') ?? {}; } catch { hd = {}; }
      if (hd.outcome === 'optout') return optout();
      if (OUTCOMES[hd.outcome]) done(hd.outcome);
      return twimlRes(response(hd.handoff === true ? dialHandoff() : '<Hangup/>'));
    }
    if (step === 'recording') { appendJsonl(path.join(dir, 'voice', 'calls.jsonl'), { call_sid: callSid, lead, event: 'recorded', at: now }); return twimlRes(response('')); }
    const st = String(params.CallStatus ?? '');
    if (st === 'completed') done(Number(params.CallDuration ?? 0) > 0 ? 'answered' : 'no_answer');
    else if (['busy', 'no-answer', 'failed', 'canceled'].includes(st)) done('no_answer');
    return twimlRes(response(''));
  }
  return { status: 404, headers: { 'content-type': 'text/plain' }, body: 'not found' };
}

export default voice;

// ---------- CLI ----------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : d; };
  const pos = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--purpose') && !argv[i - 1]?.startsWith('--now'));
  const [cmd, slug, leadId] = pos;
  const usage = 'Usage: node tools/connectors/voice.mjs check <slug> <lead> [--purpose marketing|informational|callback] [--now ISO] | twiml <slug> [--inbound] [--purpose ...]';
  if (!slug || !/^[a-z0-9-]+$/i.test(slug) || !['check', 'twiml'].includes(cmd)) { console.error(usage); process.exit(2); }
  const dir = path.join(root, 'products', slug);
  if (!fs.existsSync(path.join(dir, 'product.json'))) { console.error(`no product ${slug}`); process.exit(2); }
  const vc = loadVoiceContext(dir);
  const purpose = opt('--purpose', 'marketing');
  if (cmd === 'check') {
    if (!leadId) { console.error(usage); process.exit(2); }
    const lead = findLead(dir, leadId) ?? { id: leadId };
    const r = checkCallConsent({ phone: lead.phone, lead, purpose, product: vc.product, consent: vc.consent, dnc: vc.dnc, suppression: vc.suppression, optouts: vc.optouts, history: vc.history, now: opt('--now', new Date().toISOString()) });
    console.log(JSON.stringify({ slug, lead: leadId, purpose, ok: r.ok, reasons: r.reasons, notes: r.notes, timezone: r.timezone, recording_allowed: r.recording_allowed }, null, 2));
    process.exit(r.ok ? 0 : 1);
  }
  const s = settings(vc.product, process.env);
  s.base = s.base || 'https://edge.example/voice/' + slug;
  console.log(argv.includes('--inbound') ? buildInboundTwiml({ ...s, seller: s.seller || slug }) : buildOutboundTwiml({ ...s, seller: s.seller || slug, purpose, record: vc.product.voice?.record === true, ref: 'preview' }));
}
