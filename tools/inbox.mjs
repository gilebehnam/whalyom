// Inbound reply handling for the AI SDR: reads the replies people send back to outreach and nurture
// email, matches each one to a lead, sorts it with fixed rules and moves the funnel. It sends nothing.
//   products/<slug>/inbox/*.json|.eml       replies dropped by a webhook, n8n flow or mailbox export.
//                                           JSON: {from, subject, text, at, in_reply_to, lead?, message_id?,
//                                           headers?, auto?} (one object, an array, or {replies: [...]}).
//                                           .eml: a raw RFC 822 message (multipart, quoted-printable and
//                                           base64 bodies are decoded; HTML-only bodies are stripped).
//                                           Names starting with "." or "_" are skipped (write, then rename).
//   products/<slug>/inbox/done/             every processed file is moved here (failed/ for unreadable ones)
//   products/<slug>/inbox/replies.json      this tool's ledger (single writer): one row per reply with its
//                                           class, lead, hashed sender, redacted snippet, follow-up date.
//                                           Also the dedupe key, so a re-dropped reply is not counted twice.
//   products/<slug>/inbox/respond.json      interested human replies still waiting for an answer
//   products/<slug>/funnel/updates/inbox-<reply id>.json   stage change for tools/funnel.mjs (never the
//                                           ledger): {lead, email_hash, stage, at, source, reason, note}
//   products/<slug>/suppression.json        hashed addresses that must never be emailed again
//                                           (unsubscribe, stop, hard bounce). Honoured at once here.
//   products/<slug>/runs/INBOX-<stamp>.json  for tools/apply-results.mjs: pending approvals to copy the
//                                           suppressions into the email tool, dated follow-up tasks
//                                           (out of office, not now, referrals) and owner alerts.
//   state/queue/respond-<slug>.json         queued AI reply run for the hub (tools/hub-service.mjs), only
//                                           when a human-sounding interested reply needs an answer.
// Rules, first match wins: bounce → lost + suppression; unsubscribe/stop/remove me → lost + suppression;
// out of office or other auto-reply → stage kept, follow-up after the return date (default +7 days);
// not interested → lost (not suppressed); not now/later → nurture with a follow-up (default +90 days);
// wrong person/referral → note and an om-sdr task; demo/call/meeting/proposal/trial → opportunity;
// interested/yes/pricing/tell me more → engaged; any other question → engaged, flagged for review;
// anything else → no stage change, flagged for review. Quoted history and signatures are removed first,
// so the unsubscribe footer of our own email never counts as the reader's words.
// Guards: nothing outbound (answers are drafted by om-lead-to-sale as approvals); a suppressed sender is
// never queued for an answer; no queue when the product is paused, autonomy.kill is set or
// OM_AUTO_RESPOND=0; spends nothing, so budget caps are untouched; raw addresses and phone numbers stay
// inside products/<slug>/ (the moved source files) and every derived file keeps only a 16-char hash.
// A corrupt suppression.json, replies.json or respond.json stops the run before any file is moved, so
// earlier opt-outs are never overwritten. Unsubscribe footers in automated mail never suppress; an
// erasure ("delete my data", GDPR) request also raises a decision alert for the owner.
// Usage: node tools/inbox.mjs <slug> [--now ISO] [--dry-run]
//        node tools/inbox.mjs --all              every product that is not paused
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadEnv, readJson, writeJson, root as repoRoot } from './lib/env.mjs';

// Same hash as tools/funnel.mjs, so a reply's sender matches the funnel row's email_hash.
export const hashEmail = (s) => crypto.createHash('sha256').update(String(s).trim().toLowerCase()).digest('hex').slice(0, 16);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const isoOk = (s) => typeof s === 'string' && s !== '' && !Number.isNaN(Date.parse(s));
const toIso = (s, fallback) => (isoOk(String(s ?? '')) ? new Date(Date.parse(String(s))).toISOString() : fallback);
const addDays = (iso, d) => new Date(Date.parse(iso) + d * 86400000).toISOString();
const str = (v, max = 100000) => (v == null ? '' : String(v)).slice(0, max);

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_LEDGER = 5000;
const EMAIL_RE = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/g;

export const extractEmail = (s) => { const m = str(s, 2000).match(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/); return m ? m[0].toLowerCase() : null; };
export const redact = (s) => str(s, 4000).replace(EMAIL_RE, '[email]').replace(PHONE_RE, '[phone]');

// ---------- .eml parsing ----------

const decodeWords = (s) => s.replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (_, cs, enc, data) => {
  try {
    const buf = enc.toUpperCase() === 'B' ? Buffer.from(data, 'base64') : Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
    return buf.toString(/^utf-?8$/i.test(cs) ? 'utf8' : 'latin1');
  } catch { return data; }
});

const parseHeaders = (block) => {
  const headers = {};
  const lines = block.replace(/\r\n/g, '\n').split('\n');
  let last = null;
  for (const l of lines) {
    if (/^[ \t]/.test(l) && last) { headers[last] += ' ' + l.trim(); continue; }
    const m = l.match(/^([A-Za-z0-9-]+):\s*(.*)$/);
    if (!m) continue;
    last = m[1].toLowerCase();
    headers[last] = headers[last] ? `${headers[last]}, ${m[2]}` : m[2];
  }
  for (const k of Object.keys(headers)) headers[k] = decodeWords(headers[k].trim());
  return headers;
};

const splitMessage = (raw) => {
  const t = raw.replace(/\r\n/g, '\n');
  const i = t.indexOf('\n\n');
  return i === -1 ? { head: t, body: '' } : { head: t.slice(0, i), body: t.slice(i + 2) };
};

const charsetOf = (ct) => (ct.match(/charset="?([^";\s]+)"?/i)?.[1] ?? 'utf-8');
const decodeBody = (body, headers) => {
  const enc = String(headers['content-transfer-encoding'] ?? '').toLowerCase();
  const utf = /^utf-?8$/i.test(charsetOf(String(headers['content-type'] ?? '')));
  let buf;
  if (enc === 'base64') buf = Buffer.from(body.replace(/\s+/g, ''), 'base64');
  else if (enc === 'quoted-printable') buf = Buffer.from(body.replace(/=\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
  else return body;
  return buf.toString(utf ? 'utf8' : 'latin1');
};

export const htmlToText = (html) => str(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d)>/gi, '\n').replace(/<blockquote[\s\S]*?<\/blockquote>/gi, '\n')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

// The text/plain part of a (possibly nested) MIME body; HTML only when there is no plain part.
const textOf = (headers, body, depth = 0) => {
  const ct = String(headers['content-type'] ?? 'text/plain');
  const boundary = ct.match(/boundary="?([^";]+)"?/i)?.[1];
  if (/^multipart\//i.test(ct) && boundary && depth < 5) {
    const parts = body.split(`--${boundary}`).slice(1).filter((p) => !p.startsWith('--'));
    let html = null;
    for (const p of parts) {
      const { head, body: b } = splitMessage(p.replace(/^\n/, ''));
      const h = parseHeaders(head);
      if (/attachment/i.test(String(h['content-disposition'] ?? ''))) continue;
      const pct = String(h['content-type'] ?? 'text/plain');
      if (/^multipart\//i.test(pct)) { const t = textOf(h, b, depth + 1); if (t.plain) return t; html ??= t.html; continue; }
      if (/^text\/plain/i.test(pct)) return { plain: decodeBody(b, h) };
      if (/^text\/html/i.test(pct)) html ??= decodeBody(b, h);
    }
    return { plain: null, html };
  }
  const decoded = decodeBody(body, headers);
  return /^text\/html/i.test(ct) ? { plain: null, html: decoded } : { plain: decoded };
};

export function parseEml(raw) {
  const { head, body } = splitMessage(str(raw, MAX_FILE_BYTES));
  const headers = parseHeaders(head);
  const t = textOf(headers, body);
  return {
    from: headers.from ?? '', to: headers.to ?? '', subject: headers.subject ?? '', at: headers.date ?? '',
    in_reply_to: [headers['in-reply-to'], headers.references].filter(Boolean).join(' '), message_id: headers['message-id'] ?? '',
    text: t.plain ?? (t.html ? htmlToText(t.html) : ''), headers,
  };
}

// ---------- normalising ----------

// Auto-generated mail (auto-replies, bounces, lists, no-reply senders) is never "human-sounding".
export function isAutomated(r) {
  const h = r.headers ?? {};
  const get = (k) => String(h[k] ?? h[k.toLowerCase()] ?? '').toLowerCase();
  if (r.auto === true) return true;
  const as = get('auto-submitted');
  if (as && as !== 'no') return true;
  if (get('x-autoreply') || get('x-autorespond') || get('x-auto-response-suppress').includes('all')) return true;
  if (/^(bulk|junk|list|auto_reply)$/.test(get('precedence'))) return true;
  return /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?)[@+.-]/.test(r.from_email ?? '');
}

// One raw input (JSON object or parsed .eml) → a clean reply, or {error}.
export function normalizeReply(x, { now = new Date().toISOString(), file = '' } = {}) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return { error: 'reply is not an object' };
  const fromRaw = str(x.from ?? x.sender ?? x.email ?? x.from_email, 500);
  const from_email = extractEmail(fromRaw);
  const text = str(x.text ?? x.body ?? x.plain ?? (x.html ? htmlToText(x.html) : ''), 200000);
  const subject = str(x.subject, 500).replace(/[\r\n]+/g, ' ').trim();
  const lead = x.lead ?? x.lead_id ?? null;
  if (!from_email && !lead) return { error: 'reply has no sender address and no lead id' };
  if (!text.trim() && !subject) return { error: 'reply has no text and no subject' };
  const headers = x.headers && typeof x.headers === 'object' ? Object.fromEntries(Object.entries(x.headers).map(([k, v]) => [k.toLowerCase(), str(v, 1000)])) : {};
  const at = toIso(x.at ?? x.date ?? x.received_at ?? headers.date, now);
  const message_id = str(x.message_id ?? x.messageId ?? headers['message-id'], 500).trim();
  const in_reply_to = str(x.in_reply_to ?? x.inReplyTo ?? headers['in-reply-to'], 2000).trim();
  const id = `R-${sha(message_id || `${from_email ?? lead}|${at}|${subject}|${text.slice(0, 2000)}`).slice(0, 12)}`;
  const r = { id, from_email, lead: lead == null || lead === '' ? null : str(lead, 200), subject, text, at, in_reply_to, message_id, headers, auto: x.auto === true, file };
  r.automated = isAutomated(r);
  return r;
}

// Removes quoted history, forwarded blocks and signatures: only the sender's own words are classified.
export function stripQuoted(text) {
  const out = [];
  for (const line of str(text).replace(/\r\n/g, '\n').split('\n')) {
    const l = line.trim();
    if (/^On .{4,200}wrote:?$/i.test(l) || /^-{2,}\s*(Original Message|Forwarded message)\s*-{2,}/i.test(l) || /^_{5,}$/.test(l)) break;
    if (/^(From|Sent|De|Von):\s.+/i.test(l) && out.length) break;
    if (l === '--' || l === '-- ' || /^Sent from my (iPhone|iPad|Android|phone|mobile)/i.test(l)) break;
    if (l.startsWith('>')) continue;
    out.push(line);
  }
  return out.join('\n').trim();
}

// ---------- classification ----------

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
// The return date in an out-of-office note, or null. Only unambiguous forms (ISO, "12 Nov", "Nov 12").
export function parseReturnDate(text, at) {
  const t = str(text, 5000).toLowerCase();
  const lead = '(?:until|till|through|back (?:in the office )?(?:on )?|return(?:ing)? (?:on )?|returns? (?:on )?|be back (?:on )?|away until )';
  const day = '(?:(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*,?\\s+)?';
  const base = new Date(at);
  const mk = (y, m, d) => { const dt = new Date(Date.UTC(y, m, d)); return dt.getUTCMonth() === m && dt.getUTCDate() === d ? dt : null; };
  const withYear = (m, d, y) => {
    if (y) return mk(Number(y), m, d);
    let dt = mk(base.getUTCFullYear(), m, d);
    if (dt && dt.getTime() < base.getTime() - 86400000) dt = mk(base.getUTCFullYear() + 1, m, d);
    return dt;
  };
  let m = t.match(new RegExp(`${lead}${day}(\\d{4})-(\\d{2})-(\\d{2})`));
  let dt = m ? mk(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  if (!dt && (m = t.match(new RegExp(`${lead}${day}${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`)))) dt = withYear(MONTHS[m[1].slice(0, m[1].startsWith('sept') ? 4 : 3)], Number(m[2]), m[3]);
  if (!dt && (m = t.match(new RegExp(`${lead}${day}(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\.?(?:,?\\s+(\\d{4}))?`)))) dt = withYear(MONTHS[m[2].slice(0, m[2].startsWith('sept') ? 4 : 3)], Number(m[1]), m[3]);
  return dt ? dt.toISOString() : null;
}

const RULES = {
  bounce_from: /^(mailer-daemon|postmaster)@/,
  bounce_subject: /(undeliverable|undelivered mail|delivery status notification|mail delivery (failed|failure|subsystem)|returned mail|delivery failure|failure notice|address not found)/i,
  unsubscribe: /\b(unsubscribe|unsub|remove me|take me off|opt(?:\s|-)?out|stop (?:emailing|contacting|sending|messaging|writing)|do not (?:contact|email|e-mail|write)|don'?t (?:contact|email|e-mail|write to) me|no more (?:emails|e-mails|messages)|remove (?:my (?:email|address)|us) from|please remove|not contact me again|gdpr erasure|delete my data)\b/i,
  erasure: /\b(gdpr|erasure|delete (?:all )?(?:my|our) (?:data|details|information|personal data)|right to be forgotten|forget me)\b/i,
  stop_only: /^\s*(stop|stop\s*all|end|quit|cancel|unsubscribe)\s*[.!]*\s*$/i,
  ooo_subject: /(out of (?:the )?office|automatic reply|auto(?:matic)?[- ]?reply|autoreply|\booo\b|away from (?:the )?office|on vacation|on leave|abwesenheit|absence)/i,
  ooo_text: /\b(out of (?:the )?office|i am (?:currently )?away|i'?m (?:currently )?away|on (?:annual |parental |maternity |paternity )?(?:leave|vacation|holiday)|limited access to (?:my )?e-?mail|away from (?:my )?(?:desk|email)|will (?:respond|reply) (?:to your (?:email|message) )?(?:when|upon) (?:i|my) return|currently travell?ing)\b/i,
  not_interested: /\b(not interested|no,? thanks|no,? thank you|not for us|not a fit|not a good fit|we(?:'re| are) (?:all )?(?:good|set|covered)|already (?:have|use|using|work with)|we(?:'ll| will) pass|i(?:'ll| will) pass|no need|not looking|please don'?t follow up)\b/i,
  not_now: /\b(not (?:right )?now|not at (?:this|the moment|the present) time|maybe later|(?:reach|check|circle|touch) (?:back|base)|follow up (?:in|next|later)|next (?:quarter|month|year)|in (?:a few|a couple of|\d+) (?:weeks|months)|later this year|bad timing|not a priority|no budget|budget (?:is )?(?:frozen|freeze)|after (?:the )?(?:holidays|summer|new year)|too busy)\b/i,
  wrong_person: /\b(wrong person|not the right (?:person|contact)|no longer (?:with|at|work(?:s|ing)? (?:at|for|here))|(?:has|have) left the (?:company|business|team|organisation|organization)|i don'?t (?:handle|work on|own) (?:this|that)|not (?:my|in my) (?:area|department|remit|role)|not responsible for)\b/i,
  referral: /\b(you should (?:talk|speak|reach out|contact|email)|(?:the )?(?:best|right) person (?:is|would be|to talk to|for this)|(?:i'?ve |i have )?(?:cc'?d|copied|looped in|forwarded (?:this|your email|your message) to)|(?:handles?|owns?) (?:this|that|it) (?:for us|here))\b/i,
  referral_weak: /\b((?:reach out|talk|speak|write) to|(?:please )?contact (?!me\b))/i,
  opportunity: /\b(demo|book (?:a|some) (?:call|time|meeting)|schedule (?:a|some)? ?(?:call|time|meeting|demo)|set up (?:a )?(?:call|meeting|time)|hop on a call|jump on a call|(?:a|quick) call|meeting|calendly|calendar (?:link|invite)|available (?:on|next|this|tomorrow)|send (?:me |us |over )?(?:a |the )?(?:proposal|quote|contract|agreement|invoice|order form)|free trial|start (?:a|the) trial|sign (?:us )?up|ready to (?:buy|start|go|move forward)|let'?s (?:do it|go ahead|move forward|get started|talk|chat))\b/i,
  interested: /\b(interested|sounds (?:good|great|interesting)|tell me more|more (?:info|information|details)|learn more|keen|curious|yes|yeah|sure|please send|send (?:me |over )?(?:more|details|info|the deck|a deck)|pricing|price|prices|how much|what (?:does|would) it cost|cost|rates?|quote|budget for|love to|happy to (?:chat|talk|learn))\b/i,
};

// Pure: one normalised reply → its class and what to do. `now` only feeds the default follow-up dates.
export function classifyReply(reply) {
  const subject = str(reply.subject, 500);
  const subj = subject.replace(/^\s*((re|aw|fw|fwd|sv|antw)\s*:\s*)+/i, '').trim();
  const own = stripQuoted(reply.text);
  const body = own || '';
  const words = body.split(/\s+/).filter(Boolean).length;
  const from = reply.from_email ?? '';
  const res = (cls, extra = {}) => ({ class: cls, stage: null, reason: cls, intent: null, suppress: false, followup_at: null, needs_review: false, words, ...extra });

  if (RULES.bounce_from.test(from) || (reply.automated && RULES.bounce_subject.test(subj))) return res('bounce', { stage: 'lost', reason: 'bounced', suppress: true });
  // Automated mail (helpdesk acks, list mail) carries unsubscribe footers of its own, so only a person's
  // words count there. Our own subject lines may start with "Stop ...", so a subject counts only when it is
  // the keyword alone, or starts with unsubscribe / remove me / opt out.
  const unsubBody = !reply.automated && (RULES.unsubscribe.test(body) || RULES.stop_only.test(body));
  if (unsubBody || RULES.stop_only.test(subj) || /^(unsubscribe|remove me|opt[- ]?out)\b/i.test(subj)) return res('unsubscribe', { stage: 'lost', reason: 'unsubscribed', suppress: true, erasure: !reply.automated && RULES.erasure.test(body) });
  if (RULES.ooo_subject.test(subj) || (RULES.ooo_text.test(body) && (reply.automated || words < 120))) {
    const back = parseReturnDate(body || subj, reply.at);
    const cap = addDays(reply.at, 60);
    const followup_at = back && back > reply.at && back <= cap ? addDays(back, 1) : addDays(reply.at, 7);
    return res('out_of_office', { followup_at, return_date: back && back > reply.at && back <= cap ? back : null });
  }
  if (reply.automated) return res('auto_reply', { needs_review: false });
  if (RULES.not_interested.test(body)) return res('not_interested', { stage: 'lost', reason: 'not_interested' });
  if (RULES.not_now.test(body)) {
    const t = body.toLowerCase();
    const n = Number(t.match(/in (\d+) months/)?.[1]);
    const days = /next year|after (?:the )?new year/.test(t) ? 180 : n > 0 && n <= 24 ? n * 30 : /in (\d+) weeks/.test(t) ? Math.min(Number(t.match(/in (\d+) weeks/)[1]), 52) * 7 : /next month|few weeks|couple of weeks/.test(t) ? 30 : 90;
    return res('not_now', { stage: 'nurture', reason: 'not_now', followup_at: addDays(reply.at, days) });
  }
  const others = (body.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()).filter((e) => e !== from);
  const wrong = RULES.wrong_person.test(body);
  const strong = RULES.referral.test(body);
  if (wrong || strong || (others.length && RULES.referral_weak.test(body))) {
    return res(others.length || strong ? 'referral' : 'wrong_person', { referral_hash: others.length ? hashEmail(others[0]) : null, note: wrong ? 'Wrong person' : 'Referred to someone else' });
  }
  if (RULES.opportunity.test(body)) return res('opportunity', { stage: 'opportunity', reason: 'meeting_or_proposal', intent: (body.match(RULES.opportunity)?.[1] ?? '').toLowerCase() || 'meeting' });
  if (RULES.interested.test(body)) {
    const kw = (body.match(RULES.interested)?.[1] ?? '').toLowerCase();
    return res('interested', { stage: 'engaged', reason: 'interested', intent: /pric|cost|how much|rate|quote|budget/.test(kw) ? 'pricing' : 'interested' });
  }
  if (/\?/.test(body)) return res('question', { stage: 'engaged', reason: 'question', needs_review: true });
  return res('other', { needs_review: true });
}

// A reply worth a human answer: a real person (not automated), a short message, buying intent.
export const needsAnswer = (reply, c) => !reply.automated && (c.class === 'interested' || c.class === 'opportunity') && c.words >= 1 && c.words <= 1500;

// ---------- lead matching ----------

// Index of every known lead (funnel ledger rows plus the raw site log), by id/alias and by email hash.
export function buildLeadIndex({ pipeline = null, leads = [] } = {}) {
  const byId = new Map(); const byHash = new Map();
  for (const r of Array.isArray(pipeline?.leads) ? pipeline.leads : []) {
    if (!r || typeof r !== 'object') continue;
    const id = r.lead_id ?? r.id;
    for (const k of [r.id, r.lead_id, ...(Array.isArray(r.aliases) ? r.aliases : [])]) if (k) byId.set(String(k), { id: String(id), stage: r.stage ?? null, consent: r.consent });
    if (r.email_hash && id) byHash.set(r.email_hash, { id: String(id), stage: r.stage ?? null, consent: r.consent });
  }
  for (const x of Array.isArray(leads) ? leads : []) {
    if (!x || typeof x !== 'object') continue;
    const id = x.lead_id ?? x.id;
    const email = x.contact?.email ?? x.email;
    const h = email ? hashEmail(email) : (x.email_hash ?? null);
    if (id && !byId.has(String(id))) byId.set(String(id), { id: String(id), stage: 'new', consent: x.consent });
    if (h && !byHash.has(h)) byHash.set(h, byId.get(String(id)) ?? { id: id ? String(id) : null, stage: 'new', consent: x.consent });
  }
  return { byId, byHash };
}

// Explicit lead id first, then a lead id inside In-Reply-To/References (ids of 4+ chars only, so short
// ids never match by accident), then the sender's email hash.
export function matchLead(reply, index) {
  if (reply.lead && index.byId.has(reply.lead)) return { ...index.byId.get(reply.lead), by: 'lead_id' };
  if (reply.in_reply_to) {
    // A known id inside a Message-ID (e.g. <om-L-ann1-0001@acme.io>), bounded by non-alphanumerics;
    // the longest id wins, then the alphabetically first, so the result never depends on map order.
    const hay = reply.in_reply_to.slice(0, 2000);
    const hits = [...index.byId.keys()].filter((k) => k.length >= 4 && hay.includes(k)).filter((k) => {
      const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?<![A-Za-z0-9])${esc}(?![A-Za-z0-9])`).test(hay);
    }).sort((a, b) => b.length - a.length || a.localeCompare(b));
    if (hits.length) return { ...index.byId.get(hits[0]), by: 'in_reply_to' };
  }
  const h = reply.from_email ? hashEmail(reply.from_email) : null;
  if (h && index.byHash.has(h) && index.byHash.get(h).id) return { ...index.byHash.get(h), by: 'email_hash' };
  if (reply.lead) return { id: reply.lead, stage: null, by: 'lead_id_unknown', unknown: true };
  return null;
}

// ---------- the pure core ----------

// The address a bounce was for (DSN Final-Recipient, else the first address that is not a mail system).
export function bouncedRecipient(text) {
  const t = str(text, 200000);
  const m = t.match(/(?:final|original)-recipient:\s*rfc822;\s*<?([^\s<>;]+@[^\s<>;]+)>?/i);
  if (m) return m[1].toLowerCase();
  return (t.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()).find((e) => !/^(mailer-daemon|postmaster|no-?reply|bounces?)[@+.-]/.test(e)) ?? null;
}

const FOLLOW_AGENT = { out_of_office: 'om-follow-up', not_now: 'om-email-nurture', referral: 'om-sdr', wrong_person: 'om-sdr' };

// Pure: replies (normalised) + current state → every file this run writes. Deterministic for the same
// input and `now`: replies are handled in time order, then by id; outputs are sorted.
export function processReplies({ replies = [], pipeline = null, leads = [], suppression = null, ledger = null, respondList = null, product = {}, now = new Date().toISOString(), env = {} } = {}) {
  const index = buildLeadIndex({ pipeline, leads });
  // suppression.json may be {entries: [...]} or a bare array (hand-made); both keep every entry.
  const supRows = Array.isArray(suppression) ? suppression : Array.isArray(suppression?.entries) ? suppression.entries : [];
  const sup = { ...(Array.isArray(suppression) || !suppression || typeof suppression !== 'object' ? {} : suppression), updated_at: suppression?.updated_at ?? null, entries: supRows.filter((e) => e && typeof e === 'object').map((e) => ({ ...e })) };
  const supSet = new Set(sup.entries.map((e) => e.email_hash).filter(Boolean));
  const supLeads = new Set(sup.entries.map((e) => e.lead).filter(Boolean));
  const led = { updated_at: ledger?.updated_at ?? null, replies: Array.isArray(ledger?.replies) ? ledger.replies.map((r) => ({ ...r })) : [] };
  const seen = new Set(led.replies.map((r) => r.id));
  const respond = { updated_at: respondList?.updated_at ?? null, open: Array.isArray(respondList?.open) ? respondList.open.map((r) => ({ ...r })) : [] };
  const updates = []; const approvals = []; const newTasks = []; const alerts = [];
  const stats = { replies_in: replies.length, processed: 0, duplicates: 0, matched: 0, unmatched: 0, updates: 0, suppressed_new: 0, needs_answer: 0, needs_review: 0, by_class: {} };

  const sorted = [...replies].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  for (const r of sorted) {
    if (seen.has(r.id)) { stats.duplicates++; continue; }
    seen.add(r.id);
    stats.processed++;
    const c = classifyReply(r);
    stats.by_class[c.class] = (stats.by_class[c.class] ?? 0) + 1;
    const who = c.class === 'bounce' ? { ...r, from_email: bouncedRecipient(r.text) } : r;
    const m = matchLead(who, index);
    const matched = Boolean(m && !m.unknown);
    stats[matched ? 'matched' : 'unmatched']++;
    const email_hash = who.from_email ? hashEmail(who.from_email) : null;
    const leadId = m?.id ?? null;
    const wasSuppressed = (email_hash && supSet.has(email_hash)) || (leadId && supLeads.has(leadId));

    if (c.suppress && (email_hash || leadId) && !wasSuppressed) {
      sup.entries.push({ email_hash, lead: leadId, at: r.at, reason: c.reason, reply: r.id, source: 'inbox' });
      if (email_hash) supSet.add(email_hash);
      if (leadId) supLeads.add(leadId);
      stats.suppressed_new++;
      approvals.push({ id: `A-SUP-${(email_hash ?? sha(leadId)).slice(0, 12)}`, type: 'suppress', channel: 'suppression', target: 'email-tool', title: `Add ${c.reason === 'bounced' ? 'a bounced' : 'an unsubscribed'} address to the email tool's suppression list (lead ${leadId ?? 'unmatched'})`, file: 'suppression.json' });
    }
    if (c.stage && matched) {
      updates.push({ file: `inbox-${r.id}.json`, update: { lead: leadId, email_hash, stage: c.stage, at: r.at, source: 'inbox', reason: c.reason, reply_id: r.id, note: `Reply classified ${c.class}${c.intent ? ` (${c.intent})` : ''}` } });
      stats.updates++;
    }
    if (c.erasure) alerts.push({ level: 'decision', title: `Data erasure request from lead ${leadId ?? 'unmatched'}`, detail: `Reply ${r.id} asks for personal data to be deleted. The address is suppressed; delete the contact from the CRM, email tool and products/<slug>/ files within one month (GDPR Art. 17), then confirm to the person through an approved reply.` });
    const answer = needsAnswer(r, c) && !wasSuppressed && !(c.suppress);
    if (answer) {
      stats.needs_answer++;
      if (!respond.open.some((x) => x.reply_id === r.id)) respond.open.push({ reply_id: r.id, lead: leadId, matched, email_hash, class: c.class, intent: c.intent, at: r.at, file: r.done_file ?? r.file ?? '', status: 'open' });
    }
    if (needsAnswer(r, c) && wasSuppressed) alerts.push({ level: 'decision', title: `A suppressed contact replied with interest (lead ${leadId ?? 'unmatched'})`, detail: `Reply ${r.id} is not queued for an answer because the sender is on suppression.json. Remove the entry only if the person asked to hear from you again.` });
    if (c.followup_at && FOLLOW_AGENT[c.class]) {
      newTasks.push({ id: `FU-${r.id}`, title: `${c.class === 'out_of_office' ? 'Follow up after out of office' : 'Nurture follow-up (not now)'}: lead ${leadId ?? 'unmatched'}`.slice(0, 90), agent: FOLLOW_AGENT[c.class], brief: `Reply ${r.id} (${c.class}) from lead ${leadId ?? 'unmatched'}. Do not contact before ${c.followup_at.slice(0, 10)}. Draft the follow-up as an approval; consented or replying contacts only; skip anyone on suppression.json.`, depends_on: [], priority: 3, not_before: c.followup_at });
    }
    if (c.class === 'referral' || c.class === 'wrong_person') {
      newTasks.push({ id: `REF-${r.id}`, title: `${c.class === 'referral' ? 'Referral' : 'Wrong contact'} from lead ${leadId ?? 'unmatched'}`.slice(0, 90), agent: 'om-sdr', brief: `Reply ${r.id}: ${c.note}. Read the original in products/<slug>/inbox/done/ (${r.done_file ?? r.file ?? ''}). Draft a short intro that names who referred them, as an approval; no message goes out without the owner.`, depends_on: [], priority: 2 });
    }
    if (c.needs_review) stats.needs_review++;
    const snippet = redact(stripQuoted(r.text).replace(/\s+/g, ' ').trim()).slice(0, 200);
    led.replies.push({ id: r.id, at: r.at, processed_at: now, file: r.done_file ?? r.file ?? '', lead: leadId, matched, matched_by: m?.by ?? null, email_hash, class: c.class, stage: c.stage, reason: c.reason, intent: c.intent, automated: r.automated, suppressed: Boolean(c.suppress || wasSuppressed), needs_answer: answer, needs_review: c.needs_review, followup_at: c.followup_at, referral_hash: c.referral_hash ?? null, snippet });
  }
  led.replies = led.replies.filter((x) => x && typeof x === 'object');
  respond.open = respond.open.filter((x) => x && typeof x === 'object');
  led.replies.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')) || String(a.id ?? '').localeCompare(String(b.id ?? '')));
  if (led.replies.length > MAX_LEDGER) led.replies = led.replies.slice(-MAX_LEDGER);
  sup.entries.sort((a, b) => String(a.at).localeCompare(String(b.at)) || String(a.email_hash ?? a.lead).localeCompare(String(b.email_hash ?? b.lead)));
  respond.open.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')) || String(a.reply_id ?? '').localeCompare(String(b.reply_id ?? '')));
  if (stats.processed) { led.updated_at = now; respond.updated_at = now; }
  if (stats.suppressed_new) sup.updated_at = now;
  if (stats.unmatched) alerts.push({ level: 'info', title: `${stats.unmatched} inbound repl${stats.unmatched === 1 ? 'y' : 'ies'} did not match a lead`, detail: 'See inbox/replies.json (matched: false). Add the lead id to the webhook payload, or import the contact as a lead.' });
  if (stats.needs_review) alerts.push({ level: 'info', title: `${stats.needs_review} repl${stats.needs_review === 1 ? 'y needs' : 'ies need'} a human look`, detail: 'The rules could not tell what the sender wants; see inbox/replies.json (needs_review: true).' });

  const paused = product?.stage === 'paused' || product?.autonomy?.kill === true || env.OM_KILL === '1';
  const queueWanted = respond.open.length > 0 && stats.needs_answer > 0 && !paused && env.OM_AUTO_RESPOND !== '0';
  const run = (approvals.length || newTasks.length || alerts.length) ? {
    agent: 'om-reply-handler', status: 'done', output: ['inbox/replies.json', ...(stats.suppressed_new ? ['suppression.json'] : [])],
    summary: `Inbox: ${stats.processed} repl${stats.processed === 1 ? 'y' : 'ies'} handled (${Object.entries(stats.by_class).sort().map(([k, v]) => `${v} ${k}`).join(', ')}); ${stats.updates} stage change(s), ${stats.suppressed_new} new suppression(s), ${stats.needs_answer} waiting for an answer.`,
    approvals, new_tasks: newTasks, alerts,
  } : null;
  return { updates, suppression: sup, ledger: led, respond, run, queue: queueWanted ? { by: 'inbox', replies: stats.needs_answer } : null, paused, stats };
}

// ---------- files ----------

const moveUnique = (from, dir) => {
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(from); const base = path.basename(from, ext);
  let to = path.join(dir, path.basename(from)); let n = 1;
  while (fs.existsSync(to)) to = path.join(dir, `${base}-${n++}${ext}`);
  fs.renameSync(from, to);
  return path.basename(to);
};

// This tool's own files in inbox/ are never read as replies (nor are names starting with "." or "_",
// so a webhook can write "_tmp.json" and rename it when complete).
export const RESERVED = new Set(['replies.json', 'respond.json']);

// Reads inbox/*.json|.eml into raw reply objects, with per-file errors (never throws on one bad file).
export function readInboxFiles(inboxDir, now) {
  const files = fs.existsSync(inboxDir) ? fs.readdirSync(inboxDir).filter((f) => /\.(json|eml)$/i.test(f) && !RESERVED.has(f.toLowerCase()) && !/^[._]/.test(f) && fs.statSync(path.join(inboxDir, f)).isFile()).sort() : [];
  const out = [];
  for (const f of files) {
    const full = path.join(inboxDir, f);
    try {
      const size = fs.statSync(full).size;
      if (size > MAX_FILE_BYTES) { out.push({ file: f, error: `file larger than ${MAX_FILE_BYTES} bytes` }); continue; }
      const text = fs.readFileSync(full, 'utf8');
      const raws = /\.eml$/i.test(f) ? [parseEml(text)] : (() => { const j = JSON.parse(text); return Array.isArray(j) ? j : Array.isArray(j?.replies) ? j.replies : [j]; })();
      if (!raws.length) { out.push({ file: f, error: 'no replies in file' }); continue; }
      const replies = []; const errors = [];
      for (const x of raws.slice(0, 1000)) { const r = normalizeReply(x, { now, file: f }); if (r.error) errors.push(r.error); else replies.push(r); }
      out.push({ file: f, replies, errors, ...(replies.length ? {} : { error: errors[0] ?? 'no valid reply' }) });
    } catch (e) { out.push({ file: f, error: `unreadable: ${e.message}`.slice(0, 200) }); }
  }
  return out;
}

const readJsonl = (f) => { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l.trim()).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }); } catch { return []; } };

// Reads, processes and writes one product. opts: { now, dryRun, env, root } (root only for tests).
export function runInbox(slug, { now = new Date().toISOString(), dryRun = false, env = process.env, root = repoRoot } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(String(slug ?? ''))) throw new Error(`invalid product slug: ${slug}`);
  const dir = path.join(root, 'products', slug);
  if (!fs.existsSync(path.join(dir, 'product.json'))) throw new Error(`no product.json for ${slug}`);
  const product = readJson(path.join(dir, 'product.json'), {});
  const inboxDir = path.join(dir, 'inbox');
  // A corrupt suppression list (or ledger) must stop the run: overwriting it would drop every earlier
  // opt-out and could queue answers to people who asked not to be contacted. Nothing is moved first.
  const strict = (f) => {
    if (!fs.existsSync(f)) return null;
    const raw = fs.readFileSync(f, 'utf8');
    if (!raw.trim()) return null;
    try { const j = JSON.parse(raw); if (j && typeof j === 'object') return j; } catch { /* below */ }
    throw new Error(`${path.relative(dir, f).replace(/\\/g, '/')} is not valid JSON; fix or restore it before the inbox runs`);
  };
  const suppression = strict(path.join(dir, 'suppression.json'));
  const ledger = strict(path.join(inboxDir, 'replies.json'));
  const respondList = strict(path.join(inboxDir, 'respond.json'));
  const read = readInboxFiles(inboxDir, now);
  const good = read.filter((x) => x.replies?.length);
  const failed = read.filter((x) => !x.replies?.length);
  if (!read.length) return { slug, files: 0, processed: 0, failed: 0, respond_queued: false };

  // Move first (the ledger records the done/ name), then process; a dry run reads only.
  if (!dryRun) {
    for (const x of good) { const name = moveUnique(path.join(inboxDir, x.file), path.join(inboxDir, 'done')); for (const r of x.replies) r.done_file = `done/${name}`; }
    for (const x of failed) { const name = moveUnique(path.join(inboxDir, x.file), path.join(inboxDir, 'failed')); writeJson(path.join(inboxDir, 'failed', `${name}.error.json`), { file: x.file, error: x.error, at: now }); }
  }
  const res = processReplies({
    replies: good.flatMap((x) => x.replies),
    pipeline: readJson(path.join(dir, 'funnel', 'pipeline.json'), null),
    leads: readJsonl(path.join(dir, 'leads.jsonl')),
    suppression, ledger, respondList,
    product, now, env,
  });
  let queued = false; let runFile = null;
  if (!dryRun) {
    if (res.updates.length) {
      const ud = path.join(dir, 'funnel', 'updates');
      fs.mkdirSync(ud, { recursive: true });
      for (const u of res.updates) writeJson(path.join(ud, u.file), u.update);
    }
    if (res.stats.suppressed_new) writeJson(path.join(dir, 'suppression.json'), res.suppression);
    if (res.stats.processed) { writeJson(path.join(inboxDir, 'replies.json'), res.ledger); writeJson(path.join(inboxDir, 'respond.json'), res.respond); }
    if (res.run) {
      const runs = path.join(dir, 'runs');
      fs.mkdirSync(runs, { recursive: true });
      const stamp = now.slice(0, 16).replace(/[-:]/g, '');
      let id = `INBOX-${stamp}`; let n = 1;
      while (fs.existsSync(path.join(runs, `${id}.json`)) || fs.existsSync(path.join(runs, 'applied', `${id}.json`))) id = `INBOX-${stamp}-${n++}`;
      writeJson(path.join(runs, `${id}.json`), { task_id: id, ...res.run });
      runFile = `runs/${id}.json`;
    }
    if (res.queue) {
      const q = path.join(root, 'state', 'queue');
      const job = path.join(q, `respond-${slug}.json`);
      if (!fs.existsSync(`${job}.running`)) {
        fs.mkdirSync(q, { recursive: true });
        const prev = readJson(job, null);
        writeJson(job, prev ? { ...prev, inbox_replies: res.respond.open.length, inbox_at: now } : { slug, at: now, leads: 0, inbox_replies: res.respond.open.length, by: 'inbox' });
        queued = true;
      }
    }
    if (res.stats.processed) {
      const s = res.stats;
      fs.appendFileSync(path.join(dir, 'events.jsonl'), JSON.stringify({ at: now, agent: 'om-reply-handler', product: slug, kind: 'lead', text: `Inbox: ${s.processed} repl${s.processed === 1 ? 'y' : 'ies'}, ${s.updates} stage change(s), ${s.suppressed_new} suppressed, ${s.needs_answer} to answer` }) + '\n');
    }
  }
  return { slug, files: read.length, failed: failed.length, ...res.stats, run: runFile, respond_queued: queued, paused: res.paused, dry_run: dryRun };
}

const activeSlugs = (root = repoRoot) => {
  const d = path.join(root, 'products');
  return (fs.existsSync(d) ? fs.readdirSync(d) : []).filter((s) => !s.startsWith('_') && /^[a-z0-9-]+$/i.test(s) && fs.existsSync(path.join(d, s, 'product.json')) && readJson(path.join(d, s, 'product.json'), {}).stage !== 'paused');
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  loadEnv();
  const argv = process.argv.slice(2);
  const val = (k) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : null; };
  const now = val('--now') ?? new Date().toISOString();
  if (!isoOk(now)) { console.error('--now must be an ISO date'); process.exit(2); }
  const base = val('--root') ? path.resolve(val('--root')) : repoRoot;
  const flagVals = new Set([val('--now'), val('--root')].filter(Boolean));
  const slugs = argv.includes('--all') ? activeSlugs(base) : argv.filter((a) => !a.startsWith('--') && !flagVals.has(a)).slice(0, 1);
  if (!slugs.length) { console.error('Usage: node tools/inbox.mjs <slug> [--now ISO] [--dry-run] | --all'); process.exit(2); }
  const out = [];
  for (const s of slugs) { try { out.push(runInbox(s, { now, dryRun: argv.includes('--dry-run'), root: base })); } catch (e) { out.push({ slug: s, error: e.message }); } }
  console.log(JSON.stringify(slugs.length === 1 ? out[0] : out));
  if (slugs.length === 1 && out[0].error) process.exit(1);
}
