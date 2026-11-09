// SMS and WhatsApp through the Twilio Messages API (fetch only, no SDK).
//
// Outbound (connector "twilio-messaging"): an approved item {type: "send", channel: "sms" | "whatsapp", lead,
// file?} sends ONE message to the lead's own number on file. There is no bulk send: an item with several
// recipients is refused, and the executor only runs approved items (tools/execute.mjs, whose send guard also
// checks suppression.json, sequence stops and quiet hours). Before any network the message must pass
// checkMessageConsent(), which fails closed:
//   - kill switch: OM_KILL=1, a paused product or product.json autonomy.kill;
//   - product.json messaging.enabled === true and budget.mode not "free" (messages cost money), with
//     budget.daily_cap and monthly_cap set; the estimated cost (messaging.cost_per_message, default 0.05)
//     of today's messages plus this one must fit daily_cap, spend this month plus this one monthly_cap;
//   - explicit opt-in per channel on record in messaging/consent.json
//     ({records: [{phone_hash, channel: "sms"|"whatsapp", type: "opt_in", opted_in_at, source?, revoked_at?}]});
//     a revocation for the number voids every opt-in given before it; a lead in funnel/pipeline.json whose
//     consent is withdrawn or who unsubscribed is never messaged;
//   - suppression.json (phone_hash or lead) and messaging/optouts.json (STOP replies) always block;
//   - quiet hours in the recipient's own time zone (lead, consent record, or the country code when the
//     country has one zone; unknown means no send), default 21:00-08:00, from product.json
//     messaging.quiet_hours or the item;
//   - per-lead caps across both channels (default 1 a day, 3 in 7 days, 20 h apart; tighten only);
//   - WhatsApp: a business-initiated message needs an approved template (content_sid on the item or the
//     draft, sent as ContentSid); free text only inside the 24 h window after the lead's last inbound
//     message on record (messaging/messages.jsonl event "received").
// Quiet hours can be widened by the owner (product.json messaging.quiet_hours or the item), never shortened
// below 21:00-08:00 local.
// SMS bodies get "Reply STOP to opt out." when they carry no opt-out wording.
// Files (products/<slug>/):
//   messaging/consent.json      opt-in records (phone hashes only)
//   messaging/optouts.json      {entries: [{phone_hash, channel?, at, source}]}
//   messaging/messages.jsonl    send log: sid, approval, lead, phone_hash, channel, event, at (no raw numbers)
// Env (keys only from env): TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_FROM (E.164 sender or a
//   Messaging Service SID "MG..."), TWILIO_WHATSAPP_FROM (E.164 WhatsApp sender, sent as whatsapp:+...),
//   optional TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET, TWILIO_MESSAGING_STATUS_URL (https status callback).
// Personal data: the number appears only in the lead's file and the request to Twilio; logs, details and
// refs carry a hash or a mask. Every detail passes through redact() and maskPhones().
// Usage: node tools/connectors/twilio-messaging.mjs check <slug> <lead> --channel sms|whatsapp [--now ISO]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, root } from '../lib/env.mjs';
import { defineConnector, request, redact, loadDraft } from './_http.mjs';
import { normalizePhone, phoneHash, maskPhones, calleeTimeZone, findLead } from './voice.mjs';
import { inQuietHours } from '../sequences.mjs';
import { spentThisMonth } from '../budget.mjs';

export const API_BASE = 'https://api.twilio.com/2010-04-01';
export const CHANNELS = ['sms', 'whatsapp'];
export const BASE_NEEDS = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'];
export const FROM_KEY = { sms: 'TWILIO_MESSAGING_FROM', whatsapp: 'TWILIO_WHATSAPP_FROM' };
export const NEEDS = [...BASE_NEEDS, 'TWILIO_MESSAGING_FROM | TWILIO_WHATSAPP_FROM'];
export const DEFAULT_QUIET = { start: 21, end: 8 };
export const DEFAULT_CAPS = { per_day: 1, per_week: 3, min_gap_hours: 20 };
export const DEFAULT_COST_PER_MESSAGE = 0.05;
export const SESSION_HOURS = 24;
export const BODY_MAX = 1600; // Twilio's limit for a message body
const STOP_HINT = /\b(stop|unsubscribe|opt[ -]?out)\b/i;
const WITHDRAWN = new Set(['withdrawn', 'unsubscribed', 'revoked', 'none', 'no']);

const clean = (s, env) => maskPhones(redact(String(s ?? ''), env));
const hoursBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 3600000;
const readJsonl = (f) => { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const appendJsonl = (f, row) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, `${JSON.stringify(row)}\n`); };
const safeId = (s) => String(s ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
const has = (env, k) => typeof env?.[k] === 'string' && env[k].trim() !== '';
export const channelOf = (item) => String(item?.channel ?? '').trim().toLowerCase();

// Missing env keys for one channel (or for "any channel" when channel is omitted).
export function missingFor(env = {}, channel = null) {
  const miss = BASE_NEEDS.filter((k) => !has(env, k));
  if (channel) { if (!has(env, FROM_KEY[channel])) miss.push(FROM_KEY[channel]); }
  else if (!has(env, FROM_KEY.sms) && !has(env, FROM_KEY.whatsapp)) miss.push(`${FROM_KEY.sms} or ${FROM_KEY.whatsapp}`);
  return miss;
}

// Caps can only be tightened: a looser value than the default is ignored.
export function messageCaps(product = {}) {
  const c = product.messaging?.caps ?? {};
  const tight = (k) => Math.min(DEFAULT_CAPS[k], Number.isFinite(Number(c[k])) ? Number(c[k]) : DEFAULT_CAPS[k]);
  return { per_day: tight('per_day'), per_week: tight('per_week'), min_gap_hours: Math.max(DEFAULT_CAPS.min_gap_hours, Number(c.min_gap_hours) || 0) };
}
export function quietHours(product = {}, item = {}) {
  const q = item.quiet_hours ?? product.messaging?.quiet_hours ?? DEFAULT_QUIET;
  return q && Number.isFinite(Number(q.start)) && Number.isFinite(Number(q.end)) ? { start: Number(q.start), end: Number(q.end) } : DEFAULT_QUIET;
}
export const killed = (product = {}, env = {}) => env.OM_KILL === '1' || product.stage === 'paused' || product.autonomy?.kill === true;

// Pure check for one message. Returns {ok, reasons[], timezone, phone_hash, session}.
export function checkMessageConsent({ phone, channel, lead = {}, pipelineLead = null, product = {}, consent = null, suppression = null, optouts = null, history = [], spent = 0, item = {}, env = {}, now = new Date().toISOString() } = {}) {
  const reasons = [];
  if (!Number.isFinite(Date.parse(now))) return { ok: false, reasons: ['invalid current time'], timezone: null, phone_hash: null, session: false };
  const n = normalizePhone(phone);
  const h = n ? phoneHash(n) : null;
  if (!CHANNELS.includes(channel)) reasons.push(`unknown channel "${channel}" (sms or whatsapp)`);
  if (!n) reasons.push('no valid phone number for this lead');
  if (killed(product, env)) reasons.push('kill switch on (OM_KILL, paused stage or autonomy.kill)');
  if (product.messaging?.enabled !== true) reasons.push('messaging is not enabled (product.json messaging.enabled)');
  if (!String(product.name ?? '').trim()) reasons.push('product.json has no name to identify the sender');
  // Suppression and opt-outs block every message.
  const sup = Array.isArray(suppression) ? suppression : Array.isArray(suppression?.entries) ? suppression.entries : [];
  if ((h && sup.some((e) => e?.phone_hash === h)) || (lead.id != null && sup.some((e) => e?.lead != null && String(e.lead) === String(lead.id)))) reasons.push('recipient is on the product suppression list');
  const outs = Array.isArray(optouts) ? optouts : Array.isArray(optouts?.entries) ? optouts.entries : [];
  if (h && outs.some((e) => e?.phone_hash === h && (!e.channel || e.channel === channel))) reasons.push('recipient replied STOP (messaging opt-out)');
  if (pipelineLead && (pipelineLead.unsubscribed === true || WITHDRAWN.has(String(pipelineLead.consent ?? '').toLowerCase()))) reasons.push('lead withdrew consent or unsubscribed');
  // Explicit opt-in for this channel.
  const all = Array.isArray(consent) ? consent : Array.isArray(consent?.records) ? consent.records : [];
  const recs = h ? all.filter((r) => r?.phone_hash === h && (!r.channel || r.channel === channel)) : [];
  const revs = recs.filter((r) => r.revoked_at).map((r) => Date.parse(r.revoked_at));
  const lastRev = revs.length ? (revs.some((t) => !Number.isFinite(t)) ? Infinity : Math.max(...revs)) : -Infinity;
  const optIn = recs.find((r) => !r.revoked_at && r.channel === channel && r.type === 'opt_in' && Number.isFinite(Date.parse(r.opted_in_at ?? '')) && Date.parse(r.opted_in_at) <= Date.parse(now) && Date.parse(r.opted_in_at) > lastRev);
  if (!optIn) reasons.push(`no explicit ${channel} opt-in on record (messaging/consent.json, type "opt_in" with opted_in_at)`);
  // Quiet hours in the recipient's time zone.
  const tz = n ? calleeTimeZone(n, item.timezone, lead.timezone, pipelineLead?.timezone, optIn?.timezone) : null;
  if (n && !tz) reasons.push('recipient time zone unknown; set timezone on the lead or the opt-in record');
  const q = quietHours(product, item);
  // The owner can widen the quiet window, never shorten it below the default (21:00-08:00 local).
  if (tz && (inQuietHours(now, q, tz) || inQuietHours(now, DEFAULT_QUIET, tz))) reasons.push(`quiet hours ${q.start}:00-${q.end}:00 (at least ${DEFAULT_QUIET.start}:00-${DEFAULT_QUIET.end}:00) in ${tz}`);
  // Per-lead caps across sms and whatsapp.
  const sent = h ? history.filter((r) => r?.phone_hash === h && r.event === 'sent' && Number.isFinite(Date.parse(r.at)) && Date.parse(r.at) <= Date.parse(now)) : [];
  const caps = messageCaps(product);
  const within = (hrs) => sent.filter((r) => hoursBetween(r.at, now) < hrs).length;
  if (within(24) >= caps.per_day) reasons.push(`message cap reached: ${caps.per_day} per day`);
  else if (within(168) >= caps.per_week) reasons.push(`message cap reached: ${caps.per_week} per 7 days`);
  const last = sent.map((r) => r.at).sort().pop();
  if (last && hoursBetween(last, now) < caps.min_gap_hours) reasons.push(`last message was less than ${caps.min_gap_hours} h ago`);
  // Money: messages cost money, so free mode never sends and both caps must hold.
  const b = product.budget ?? {};
  const daily = Number(b.daily_cap), monthly = Number(b.monthly_cap);
  const raw = Number(product.messaging?.cost_per_message);
  const est = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_COST_PER_MESSAGE;
  const day = String(now).slice(0, 10);
  const today = history.filter((r) => r?.event === 'sent' && String(r.at ?? '').startsWith(day)).length;
  if ((b.mode ?? 'free') === 'free') reasons.push('budget.mode is free and messages cost money');
  else if (!(daily > 0) || !(monthly > 0)) reasons.push('budget.daily_cap and budget.monthly_cap must be set (messages cost money)');
  else {
    if ((today + 1) * est > daily + 1e-9) reasons.push(`estimated message cost ${Math.round((today + 1) * est * 100) / 100} today is over daily_cap ${daily}`);
    if (Number(spent || 0) + est > monthly + 1e-9) reasons.push(`spent ${spent} + estimated message cost ${est} is over monthly_cap ${monthly}`);
  }
  // WhatsApp session: free text only within 24 h of the lead's last inbound message.
  const lastIn = h ? history.filter((r) => r?.phone_hash === h && r.event === 'received' && r.channel === 'whatsapp').map((r) => r.at).sort().pop() : null;
  const session = Boolean(lastIn && hoursBetween(lastIn, now) >= 0 && hoursBetween(lastIn, now) < SESSION_HOURS);
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)], timezone: tz, phone_hash: h, session, estimate: est };
}

export function loadMessagingContext(dir) {
  const m = (f, d) => readJson(path.join(dir, 'messaging', f), d);
  const pipeline = readJson(path.join(dir, 'funnel', 'pipeline.json'), { leads: [] });
  return {
    product: readJson(path.join(dir, 'product.json'), {}),
    consent: m('consent.json', { records: [] }), optouts: m('optouts.json', { entries: [] }),
    suppression: readJson(path.join(dir, 'suppression.json'), { entries: [] }),
    history: readJsonl(path.join(dir, 'messaging', 'messages.jsonl')),
    pipelineLeads: Array.isArray(pipeline?.leads) ? pipeline.leads : [],
  };
}

// The text to send: the approval's draft (markdown body or JSON text/body), else item.text.
export function messageBody(item, ctx, channel) {
  const d = loadDraft(item, ctx);
  let body = String(d.body ?? '').replace(/^---[\s\S]*?---\s*/, '').trim();
  if (channel === 'sms' && body && !STOP_HINT.test(body)) body = `${body}\n\nReply STOP to opt out.`;
  return { body, meta: d.meta ?? {}, spec: d.spec ?? null };
}

const authHeader = (env) => `Basic ${Buffer.from(has(env, 'TWILIO_API_KEY_SID') && has(env, 'TWILIO_API_KEY_SECRET') ? `${env.TWILIO_API_KEY_SID}:${env.TWILIO_API_KEY_SECRET}` : `${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`;
const address = (channel, e164) => (channel === 'whatsapp' ? `whatsapp:${e164}` : e164);
// SMS sender: an E.164 number or a Messaging Service SID; WhatsApp sender: an E.164 number (whatsapp: is added).
export function senderParams(channel, env = {}) {
  const raw = String(env[FROM_KEY[channel]] ?? '').trim();
  if (channel === 'sms' && /^MG[0-9a-f]{32}$/i.test(raw)) return { MessagingServiceSid: raw };
  const n = normalizePhone(raw.replace(/^whatsapp:/i, ''));
  return n ? { From: address(channel, n) } : null;
}

export const twilioMessaging = defineConnector({
  name: 'twilio-messaging',
  handles: 'type "send" with channel "sms" or "whatsapp" (one message to one opted-in lead; suppression, quiet hours, caps and kill switch checked first)',
  needs: NEEDS,
  required: (env) => missingFor(env),
  accepts: (item, env) => item?.type === 'send' && CHANNELS.includes(channelOf(item)) && (env == null || has(env, FROM_KEY[channelOf(item)])),
  prepare(item, ctx) {
    const channel = channelOf(item);
    if (Array.isArray(item.to) || Array.isArray(item.leads) || Array.isArray(item.lead) || /[,;]/.test(String(item.to ?? ''))) return { error: 'one message per approval: lists and bulk sends are refused' };
    const mc = loadMessagingContext(ctx.dir);
    const lead = findLead(ctx.dir, item.lead) ?? { id: item.lead ?? null };
    // The number messaged is the lead's own number on file; an approval cannot redirect it elsewhere.
    if (item.to != null && lead.phone && normalizePhone(String(item.to).replace(/^whatsapp:/i, '')) !== normalizePhone(lead.phone)) return { error: 'message blocked: "to" does not match the lead\'s number on file' };
    const phone = normalizePhone(item.to != null ? String(item.to).replace(/^whatsapp:/i, '') : lead.phone);
    const now = ctx.now ?? new Date().toISOString();
    const pipelineLead = item.lead != null ? mc.pipelineLeads.find((l) => l && (String(l.id) === String(item.lead) || (Array.isArray(l.aliases) && l.aliases.includes(item.lead)))) ?? null : null;
    const chk = checkMessageConsent({ phone, channel, lead, pipelineLead, product: mc.product, consent: mc.consent, suppression: mc.suppression, optouts: mc.optouts, history: mc.history,
      spent: spentThisMonth(path.join(ctx.dir, 'ledger.jsonl'), now), item, env: ctx.env, now });
    if (!chk.ok) return { error: `message blocked: ${chk.reasons.join('; ')}` };
    const { body, meta, spec } = messageBody(item, ctx, channel);
    const contentSid = item.content_sid ?? meta.content_sid ?? spec?.content_sid ?? null;
    const vars = item.content_variables ?? spec?.content_variables ?? null;
    if (contentSid != null && !/^HX[0-9a-f]{32}$/i.test(String(contentSid))) return { error: 'content_sid must be a Twilio Content SID (HX...)' };
    if (channel === 'whatsapp' && !contentSid && !chk.session) return { error: `message blocked: WhatsApp outside the ${SESSION_HOURS} h session window needs an approved template (content_sid)` };
    if (!contentSid && !body) return { error: 'message blocked: the draft has no text' };
    if (body.length > BODY_MAX) return { error: `message is ${body.length} characters (limit ${BODY_MAX})` };
    const from = senderParams(channel, ctx.env);
    if (!from && !ctx.dryRun) return { error: `${FROM_KEY[channel]} is not a valid sender` };
    const form = new URLSearchParams({ To: address(channel, phone), ...(from ?? {}) });
    if (contentSid) { form.set('ContentSid', String(contentSid)); if (vars && typeof vars === 'object') form.set('ContentVariables', JSON.stringify(vars)); }
    else form.set('Body', body);
    const cb = String(ctx.env.TWILIO_MESSAGING_STATUS_URL ?? '');
    if (/^https:\/\//.test(cb)) form.set('StatusCallback', cb);
    return { form, channel, lead: lead.id, phone_hash: chk.phone_hash, preview: `send 1 ${channel} message to lead ${lead.id ?? '(no id)'} (${chk.timezone}${contentSid ? ', template' : ''})` };
  },
  async send(p, item, ctx) {
    if (killed(readJson(path.join(ctx.dir, 'product.json'), {}), ctx.env)) return { ok: false, ref: '', detail: 'kill switch on: message not sent' };
    const url = `${API_BASE}/Accounts/${encodeURIComponent(ctx.env.TWILIO_ACCOUNT_SID)}/Messages.json`;
    const r = await request(ctx, { url, headers: { authorization: authHeader(ctx.env) }, form: p.form });
    if (!r.ok || !r.data?.sid) return { ok: false, ref: '', detail: clean(`twilio ${p.channel}: HTTP ${r.status} ${r.data?.message ?? r.text ?? ''}`.slice(0, 240), ctx.env) };
    appendJsonl(path.join(ctx.dir, 'messaging', 'messages.jsonl'), { sid: safeId(r.data.sid), approval: safeId(item.id), lead: p.lead ?? null, phone_hash: p.phone_hash, channel: p.channel, event: 'sent', at: ctx.now ?? new Date().toISOString() });
    return { ok: true, ref: safeId(r.data.sid), detail: clean(`${p.channel} ${r.data.status ?? 'queued'} for lead ${p.lead ?? '(no id)'}`, ctx.env) };
  },
});

export default twilioMessaging;

// ---------- CLI ----------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : d; };
  const pos = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
  const [cmd, slug, leadId] = pos;
  const channel = opt('--channel', 'sms');
  const usage = 'Usage: node tools/connectors/twilio-messaging.mjs check <slug> <lead> --channel sms|whatsapp [--now ISO]';
  if (cmd !== 'check' || !slug || !/^[a-z0-9-]+$/i.test(slug) || !leadId) { console.error(usage); process.exit(2); }
  const dir = path.join(root, 'products', slug);
  if (!fs.existsSync(path.join(dir, 'product.json'))) { console.error(`no product ${slug}`); process.exit(2); }
  const mc = loadMessagingContext(dir);
  const lead = findLead(dir, leadId) ?? { id: leadId };
  const now = opt('--now', new Date().toISOString());
  const pipelineLead = mc.pipelineLeads.find((l) => l && String(l.id) === String(leadId)) ?? null;
  const r = checkMessageConsent({ phone: lead.phone, channel, lead, pipelineLead, product: mc.product, consent: mc.consent, suppression: mc.suppression, optouts: mc.optouts, history: mc.history, spent: spentThisMonth(path.join(dir, 'ledger.jsonl'), now), env: process.env, now });
  console.log(JSON.stringify({ slug, lead: leadId, channel, ok: r.ok, reasons: r.reasons, timezone: r.timezone, whatsapp_session: r.session }, null, 2));
  process.exit(r.ok ? 0 : 1);
}
