// Funnel management: one pipeline ledger per product that follows every lead from first touch to sale.
//   products/<slug>/funnel/pipeline.json   the ledger (single writer: this tool). One row per person:
//                                           stage, history, channel (first and last touch), value, next action.
//   products/<slug>/funnel/report.json     counts per stage, stage-to-stage conversion, channels, cohorts,
//                                           speed to lead, time to win, stuck leads, revenue (verified or not)
//   products/<slug>/funnel/FUNNEL.md       the same report for people
//   products/<slug>/funnel/next-actions.json  stuck and new leads with the agent that should act next
//   state/funnel.json, state/live-funnel.json  every product, no personal data (dashboard and live page)
// Sources, all optional:
//   1. leads.jsonl (tools/sync-sites.mjs: satellite, edge, WordPress) and leads/*.json|csv (owner or CRM
//      exports): each becomes a lead at stage "new". The same person (lead id or email) is one row.
//   2. funnel/updates/*.json|jsonl|csv: stage changes {lead | email, stage, at?, value?, currency?, source?,
//      note?, reason?}. Agents write them (never the ledger), so do CRM exports and n8n flows. Moved to
//      funnel/updates/done/ once merged; one whose lead is not in the ledger yet waits in
//      funnel/updates/pending-*.jsonl and retries. Stage names may be preset words (add_to_cart, trial,
//      booked_job …); refunded, refund and chargeback also take the money back out of revenue.
//   3. Stripe, when STRIPE_API_KEY (restricted, read-only) is set: paid charges are matched to leads by
//      email and mark them won with the real amount (verified revenue). Unmatched payments are counted as
//      sales without a tracked lead. Skip with --no-stripe or OM_FUNNEL_STRIPE=0.
// Personal data: the ledger keeps a hash of the email and the lead id, never the address itself; raw
// contact details stay in leads.jsonl. Never invents data: a stage only changes when a source says so.
// Usage: node tools/funnel.mjs <slug> [--no-stripe] [--no-alerts]
//        node tools/funnel.mjs --all            every active product, then state/funnel.json
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadEnv, readJson, writeJson, root } from './lib/env.mjs';

// Canonical stages, in order. "lost" and "nurture" sit outside the line: a lead can drop to them from
// any stage and come back later.
export const STAGES = ['new', 'contacted', 'engaged', 'qualified', 'opportunity', 'won'];
export const SIDE = ['nurture', 'lost'];
const RANKS = Object.fromEntries(STAGES.map((s, i) => [s, i]));

// Words used by presets, CRMs and agents, mapped to the canonical stage.
const ALIASES = {
  new: ['new', 'lead', 'signup', 'sign_up', 'subscribed', 'subscriber', 'inquiry', 'enquiry', 'call_or_form', 'lead_magnet', 'install', 'signup_demand', 'signup_supply', 'follow', 'form'],
  contacted: ['contacted', 'reached', 'sent', 'first_reply', 'replied_by_us', 'emailed', 'called', 'messaged', 'attempted'],
  engaged: ['engaged', 'replied', 'reply', 'opened', 'clicked', 'responded', 'conversation', 'interested', 'activated'],
  qualified: ['qualified', 'mql', 'sql', 'pql', 'fit', 'quote_requested', 'quote', 'discovery'],
  opportunity: ['opportunity', 'demo', 'booked', 'meeting', 'proposal', 'quote_sent', 'negotiation', 'add_to_cart', 'cart', 'checkout', 'checkout_started', 'trial', 'trial_started'],
  won: ['won', 'purchase', 'purchased', 'paid', 'customer', 'order', 'sale', 'closed_won', 'trial_to_paid', 'subscribed_paid', 'booked_job', 'first_transaction', 'paid_member', 'repeat_purchase', 'upsell', 'renewed'],
  nurture: ['nurture', 'not_now', 'later', 'parked', 'cold'],
  lost: ['lost', 'closed_lost', 'unsubscribed', 'unsubscribe', 'refunded', 'refund', 'chargeback', 'charged_back', 'churned', 'disqualified', 'spam', 'bounced', 'no_fit'],
};
// Words that also take money back: the lead drops to "lost" and the refunded amount leaves its revenue.
const REFUND_WORDS = ['refund', 'refunded', 'chargeback', 'charged_back'];
const stageWord = (s) => String(s ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const ALIAS = Object.fromEntries(Object.entries(ALIASES).flatMap(([s, list]) => list.map((w) => [w, s])));
export const canonicalStage = (s) => ALIAS[stageWord(s)] ?? null;

// Hours a lead may sit in a stage before it counts as stuck (product.json funnel_sla overrides).
export const DEFAULT_SLA = { new: 24, contacted: 72, engaged: 168, qualified: 336, opportunity: 504, nurture: 1440, lost: 1440 };
// Who acts next for a lead in each stage (store presets get the cart and checkout specialists).
const NEXT = {
  new: { agent: 'om-speed-to-lead', action: 'First reply that answers their question and offers the next step' },
  contacted: { agent: 'om-follow-up', action: 'Follow-up with a new reason to reply' },
  engaged: { agent: 'om-sdr', action: 'Qualify: need, timing, fit; offer a demo, quote or trial' },
  qualified: { agent: 'om-checkout-finisher', action: 'Send the right checkout, booking or proposal link' },
  opportunity: { agent: 'om-follow-up', action: 'Remove the last objection and ask for the decision' },
  nurture: { agent: 'om-email-nurture', action: 'Move to the nurture sequence (consented leads only)' },
  lost: { agent: 'om-winback', action: 'Win-back after 60 days, only with consent' },
};
const STORE_NEXT = {
  qualified: { agent: 'om-checkout-finisher', action: 'Send the product or cart link with the offer that fits' },
  opportunity: { agent: 'om-cart-recovery', action: 'Cart or checkout recovery message (consented leads only)' },
};

const hash = (s) => crypto.createHash('sha256').update(String(s).trim().toLowerCase()).digest('hex').slice(0, 16);
const isoOk = (s) => Boolean(s) && !Number.isNaN(Date.parse(s));
const hoursBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 3600000;
const median = (xs) => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); if (!v.length) return null; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const round = (n, d = 1) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);
const pct = (a, b) => (b > 0 ? round((100 * a) / b, 1) : null);
const weekOf = (iso) => { const d = new Date(iso); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10); };
const channelOf = (x) => String(x.channel || x.utm?.source || x.source_channel || 'direct').toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').slice(0, 40) || 'direct';

// CRM and spreadsheet headers → the field names used here ("Email Address" → email, "Lead ID" → lead_id).
const HEADER_MAP = {
  email_address: 'email', e_mail: 'email', mail: 'email', contact_email: 'email',
  leadid: 'lead_id', contact_id: 'lead_id',
  date: 'at', created_at: 'at', created: 'at', timestamp: 'at', date_time: 'at', updated_at: 'at',
  amount: 'value', deal_value: 'value', deal_amount: 'value',
  deal_stage: 'stage', lifecycle_stage: 'stage', pipeline_stage: 'stage',
};
// RFC 4180: quoted fields, doubled quotes, commas and line breaks inside quotes; a UTF-8 BOM is dropped.
const parseCsv = (text) => {
  const s = text.replace(/^﻿/, '');
  const recs = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"' && !f.trim()) { f = ''; q = true; }
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(f); recs.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); recs.push(row); }
  const [head, ...lines] = recs.filter((r) => r.some((v) => v.trim()));
  if (!head) return [];
  const raw = head.map((c) => c.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  // A mapped name only when the file has no column with that name already (amount and value both present).
  const cols = raw.map((c) => (HEADER_MAP[c] && !raw.includes(HEADER_MAP[c]) ? HEADER_MAP[c] : c));
  return lines.map((l) => Object.fromEntries(cols.map((c, i) => [c, (l[i] ?? '').trim()])));
};
const readRows = (file) => {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  if (/\.csv$/i.test(file)) return parseCsv(text);
  if (/\.jsonl$/i.test(file)) return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const j = JSON.parse(text);
  if (Array.isArray(j)) return j;
  // One update or lead on its own ({lead, stage, at}), the shape agents and n8n flows write.
  if (j && typeof j === 'object' && (j.stage || j.lead || j.lead_id || j.email)) return [j];
  return j?.updates ?? j?.leads ?? j?.rows ?? [];
};

// '' (an empty CSV cell) and whitespace count as missing, so they never become an id or an email.
const blank = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
// Money as CRMs export it: 1200, "1,200", "1,200.50", "$1200", "12,5" (decimal comma).
const amount = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v ?? '').replace(/[^\d.,-]/g, '');
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^-?\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  return Number(s) || 0;
};

// A raw lead (sync log, CRM row) → its identity. Same lead id or same email = same person.
const identity = (x) => {
  const email = blank(x.contact?.email) ?? blank(x.email);
  const email_hash = email ? hash(email) : blank(x.email_hash);
  // No id and no email (a bare CRM row): a stable hash of the row, so re-reading the file finds it again.
  const { source, ...rest } = x;
  return { lead_id: blank(x.lead_id) ?? blank(x.id) ?? (email_hash ? null : `L-${hash(JSON.stringify(rest))}`), email_hash };
};

// Merges leads, updates and payments into the pipeline. Pure: the caller reads and writes files.
// pipeline: {leads: []}; returns {pipeline, stats}.
export function mergeFunnel(pipeline, { leads = [], updates = [], payments = [], now = new Date().toISOString() } = {}) {
  const rows = pipeline.leads ?? [];
  const byId = new Map(); const byEmail = new Map();
  // Ids are compared as strings, so 123 in an old ledger and "123" from a CSV are the same lead.
  const index = (r) => { if (blank(r.lead_id)) byId.set(String(r.lead_id), r); for (const a of r.aliases ?? []) if (blank(a)) byId.set(String(a), r); if (r.email_hash) byEmail.set(r.email_hash, r); };
  rows.forEach(index);
  const find = ({ lead_id, email_hash }) => (lead_id && byId.get(String(lead_id))) || (email_hash && byEmail.get(email_hash)) || null;
  const stats = { leads_in: 0, new_leads: 0, merged: 0, updates_in: 0, updates_applied: 0, updates_unmatched: 0, payments_in: payments.length, payments_matched: 0 };
  const unmatchedUpdates = [];
  const later = (a, b) => (!a ? b : !b ? a : Date.parse(b) > Date.parse(a) ? b : a);
  const earlier = (a, b) => (!a ? b : !b ? a : Date.parse(b) < Date.parse(a) ? b : a);
  // stage_at only moves forward: an older event that still applies (CRM history, an earlier charge)
  // does not make the lead look fresher or staler than its latest change.
  const touch = (r, stage, at, source, extra = {}) => {
    r.history.push({ stage, at, source, ...extra });
    r.stage = stage; r.stage_at = later(r.stage_at, at);
    if (STAGES.includes(stage) && (r.max_rank ?? -1) < RANKS[stage]) r.max_rank = RANKS[stage];
  };

  for (const x of leads) {
    stats.leads_in++;
    const id = identity(x);
    const at = isoOk(x.at) ? new Date(x.at).toISOString() : now;
    const ch = channelOf(x);
    let r = find(id);
    if (r) {
      if (!isoOk(x.at)) continue; // undated rows re-read from leads/ add nothing new
      // Another touch from someone already in the pipeline: record it, keep first touch, move last touch.
      const seen = (r.touches ?? []).some((t) => t.at === at && t.channel === ch);
      if (!seen) { (r.touches ??= []).push({ at, channel: ch, campaign: x.campaign ?? x.utm?.campaign ?? '', path: x.path ?? '' }); r.last_channel = ch; stats.merged++; }
      if (id.lead_id && String(r.lead_id) !== id.lead_id && !(r.aliases ??= []).map(String).includes(id.lead_id)) { r.aliases.push(id.lead_id); byId.set(id.lead_id, r); }
      if (!r.email_hash && id.email_hash) { r.email_hash = id.email_hash; byEmail.set(id.email_hash, r); }
      if (Date.parse(at) < Date.parse(r.first_seen)) r.first_seen = at;
      continue;
    }
    r = {
      id: id.lead_id ?? `L-${id.email_hash ?? hash(JSON.stringify(x))}`,
      lead_id: id.lead_id, email_hash: id.email_hash,
      first_seen: at, channel: ch, last_channel: ch, campaign: x.campaign ?? x.utm?.campaign ?? '', path: x.path ?? '', form: x.form ?? x.type ?? '',
      consent: x.consent === true || x.consent === 'true' || x.consent === 'opted-in' ? 'opted-in' : (x.consent === 'inbound' ? 'inbound' : 'unknown'),
      suspected_bot: Boolean(x.bot_hint), stage: 'new', stage_at: at, max_rank: 0, value: 0, orders: 0, payments: [], history: [{ stage: 'new', at, source: x.source ?? 'lead' }],
      touches: [{ at, channel: ch, campaign: x.campaign ?? x.utm?.campaign ?? '', path: x.path ?? '' }],
    };
    if (!r.lead_id) r.lead_id = r.id;
    rows.push(r); index(r); stats.new_leads++;
  }

  // Oldest first; undated updates last (they get the run time, so they are the newest thing known).
  const ts = (u) => (isoOk(u.at) ? Date.parse(u.at) : Infinity);
  for (const u of [...updates].sort((a, b) => (ts(a) === ts(b) ? 0 : ts(a) < ts(b) ? -1 : 1))) {
    stats.updates_in++;
    const word = stageWord(u.stage);
    const stage = canonicalStage(u.stage);
    const email = blank(u.email);
    const r = find({ lead_id: blank(u.lead) ?? blank(u.lead_id) ?? blank(u.id), email_hash: email ? hash(email) : blank(u.email_hash) });
    if (!stage) { stats.updates_unmatched++; continue; }
    // Known stage, lead not in the ledger yet (it arrives with the next sync): the caller retries it.
    if (!r) { stats.updates_unmatched++; unmatchedUpdates.push(u); continue; }
    const dated = isoOk(u.at);
    const at = dated ? new Date(u.at).toISOString() : now;
    const value = amount(u.value ?? u.amount ?? 0);
    const source = u.source ?? 'update';
    const ref = blank(u.order_id) ?? blank(u.order) ?? blank(u.ref);
    // Same update merged before (files re-dropped, CRM re-exported): skip. Undated rows get a new "at"
    // every run, so they match on stage, value and source (or an explicit order id) instead.
    const same = (h) => h.stage === stage && (ref ? h.ref === ref : dated ? h.at === at && (h.value ?? 0) === value : h.undated && h.source === source && (h.value ?? 0) === value);
    if (r.history.some(same)) continue;
    // Forward moves only, so an old CRM row cannot pull a customer back to "contacted". A dated update
    // older than the current stage still applies when it moves the lead forward (CRM history for a lead
    // first seen in a lead file), but never pulls a lead out of lost or nurture. Side stages (lost,
    // nurture) apply unless they are older than the current stage; a lead leaves them when a later
    // update moves it on. Won always applies (every sale counts).
    const inLine = STAGES.includes(stage);
    const current = STAGES.includes(r.stage) ? RANKS[r.stage] : -1;
    const older = Date.parse(at) < Date.parse(r.stage_at);
    const forward = inLine && RANKS[stage] > current;
    const mark = { ...(dated ? {} : { undated: true }), ...(ref ? { ref } : {}), ...(value ? { value } : {}) };
    if (stage !== 'won' && ((older && (!forward || SIDE.includes(r.stage))) || (inLine && !forward && !SIDE.includes(r.stage)))) { r.history.push({ stage, at, source, note: 'kept: already further along', kept: true, ...mark }); continue; }
    const extra = { ...mark };
    if (u.note) extra.note = String(u.note).slice(0, 200);
    if (u.reason) extra.reason = String(u.reason).slice(0, 120);
    if (stage === 'won') { r.orders = (r.orders ?? 0) + 1; r.value = round((r.value ?? 0) + value, 2); r.won_at = earlier(r.won_at, at); extra.value = value; extra.verified = Boolean(u.verified) || ['stripe', 'owner', 'crm', 'shopify', 'paddle'].includes(String(source).toLowerCase()); if (u.currency) r.currency = String(u.currency).toUpperCase(); }
    // A refund or chargeback takes the money back: the stated amount, or all of it when none is given.
    if (stage === 'lost' && REFUND_WORDS.includes(word) && (r.value ?? 0) > 0) { const back = round(Math.min(value || r.value, r.value), 2); r.value = round(r.value - back, 2); extra.refund = back; }
    if (stage === 'lost' && u.reason) r.lost_reason = String(u.reason).slice(0, 120);
    touch(r, stage, at, source, extra);
    stats.updates_applied++;
  }

  // Payments oldest first, so won_at is the first sale and stage_at the latest one.
  const unmatched = [];
  const payAt = (p) => (isoOk(p.at) ? new Date(p.at).toISOString() : now);
  for (const p of [...payments].sort((a, b) => payAt(a).localeCompare(payAt(b)))) {
    const email = blank(p.email);
    const r = email ? byEmail.get(hash(email)) : null;
    if (!r) { unmatched.push({ id: p.id, at: p.at, amount: p.amount, currency: p.currency }); continue; }
    if ((r.payments ?? []).includes(p.id)) continue;
    const at = payAt(p);
    (r.payments ??= []).push(p.id);
    r.orders = (r.orders ?? 0) + 1; r.value = round((r.value ?? 0) + Number(p.amount || 0), 2); r.won_at = earlier(r.won_at, at); if (p.currency) r.currency = String(p.currency).toUpperCase();
    touch(r, 'won', at, 'stripe', { value: Number(p.amount || 0), verified: true });
    stats.payments_matched++;
  }
  return { pipeline: { ...pipeline, updated_at: now, leads: rows }, stats, unmatched_payments: unmatched, unmatched_updates: unmatchedUpdates };
}

// Builds the report from the ledger. kpis: metrics/kpis.json rows (visits per channel); opts: {now, sla, store, days}.
export function funnelReport(pipeline, { kpis = [], now = new Date().toISOString(), sla = {}, store = false, days = 30, unmatchedPayments = [], currency = 'USD' } = {}) {
  const SLA = { ...DEFAULT_SLA, ...sla };
  const real = (pipeline.leads ?? []).filter((r) => !r.suspected_bot);
  const since = new Date(Date.parse(now) - days * 86400000).toISOString();
  const recent = real.filter((r) => r.first_seen >= since);
  // An update kept in history but not applied ("kept: already further along") reached nothing.
  const applied = (h) => !h.kept && !/^kept:/.test(h.note ?? '');
  const reached = (rows, s) => rows.filter((r) => (r.max_rank ?? 0) >= RANKS[s] || r.history?.some((h) => h.stage === s && applied(h))).length;

  const stageCounts = Object.fromEntries([...STAGES, ...SIDE].map((s) => [s, real.filter((r) => r.stage === s).length]));
  const funnel = STAGES.map((s, i) => {
    const n = reached(real, s);
    const prev = i ? reached(real, STAGES[i - 1]) : null;
    return { stage: s, reached: n, now: stageCounts[s], from_previous_pct: i ? pct(n, prev) : null, from_lead_pct: pct(n, real.length) };
  });

  // Visits per channel from metrics (sessions/visits/visitors), so channels show visit → lead → sale.
  const visits = {};
  for (const k of kpis) if (['sessions', 'visits', 'visitors', 'users', 'client_visits', 'pageviews_unique'].includes(k.metric) && String(k.date) >= since.slice(0, 10)) visits[String(k.channel || 'all').toLowerCase()] = (visits[String(k.channel || 'all').toLowerCase()] ?? 0) + Number(k.value || 0);

  const byChannel = {};
  for (const r of real) {
    const c = (byChannel[r.channel] ??= { channel: r.channel, leads: 0, leads_30d: 0, qualified: 0, opportunities: 0, won: 0, lost: 0, revenue: 0 });
    c.leads++; if (r.first_seen >= since) c.leads_30d++;
    if ((r.max_rank ?? 0) >= RANKS.qualified) c.qualified++;
    if ((r.max_rank ?? 0) >= RANKS.opportunity) c.opportunities++;
    if (r.history.some((h) => h.stage === 'won')) { c.won++; c.revenue = round(c.revenue + (r.value ?? 0), 2); }
    if (r.stage === 'lost') c.lost++;
  }
  const channels = Object.values(byChannel).map((c) => ({ ...c, visits_30d: visits[c.channel] ?? null, visit_to_lead_pct: visits[c.channel] ? pct(c.leads_30d, visits[c.channel]) : null, lead_to_sale_pct: pct(c.won, c.leads), revenue_per_lead: c.leads ? round(c.revenue / c.leads, 2) : 0 }))
    .sort((a, b) => b.revenue - a.revenue || b.won - a.won || b.leads - a.leads);

  const byCampaign = {};
  for (const r of real.filter((x) => x.campaign)) { const c = (byCampaign[`${r.channel}|${r.campaign}`] ??= { channel: r.channel, campaign: r.campaign, leads: 0, won: 0, revenue: 0 }); c.leads++; if (r.history.some((h) => h.stage === 'won')) { c.won++; c.revenue = round(c.revenue + (r.value ?? 0), 2); } }

  const cohorts = {};
  for (const r of real) { const w = weekOf(r.first_seen); const c = (cohorts[w] ??= { week: w, leads: 0, contacted: 0, qualified: 0, won: 0, revenue: 0 }); c.leads++; if ((r.max_rank ?? 0) >= RANKS.contacted) c.contacted++; if ((r.max_rank ?? 0) >= RANKS.qualified) c.qualified++; if (r.history.some((h) => h.stage === 'won')) { c.won++; c.revenue = round(c.revenue + (r.value ?? 0), 2); } }

  const firstAt = (r, s) => r.history.find((h) => h.stage === s || (STAGES.includes(h.stage) && RANKS[h.stage] >= RANKS[s]))?.at;
  const speed = real.map((r) => { const c = firstAt(r, 'contacted'); return c ? hoursBetween(r.first_seen, c) : null; });
  const toWin = real.filter((r) => r.won_at).map((r) => hoursBetween(r.first_seen, r.won_at) / 24);

  const nextFor = (s) => (store && STORE_NEXT[s]) || NEXT[s];
  const actions = [];
  for (const r of real) {
    if (r.stage === 'won' || !SLA[r.stage]) continue;
    const age = hoursBetween(r.stage_at, now);
    const due = age >= SLA[r.stage];
    if (!due && r.stage !== 'new') continue;
    const n = nextFor(r.stage);
    // Unknown consent: answer their own message only; no sequences, no win-back.
    if (r.consent === 'unknown' && ['nurture', 'lost'].includes(r.stage)) continue;
    actions.push({ lead: r.id, stage: r.stage, hours_in_stage: round(age, 1), overdue: due, channel: r.channel, consent: r.consent, agent: n.agent, action: n.action });
  }
  actions.sort((a, b) => Number(b.overdue) - Number(a.overdue) || RANKS[b.stage] - RANKS[a.stage] || b.hours_in_stage - a.hours_in_stage);

  const wonRows = real.filter((r) => r.history.some((h) => h.stage === 'won'));
  // Refunds and chargebacks leave both figures: r.value is already net, and a row's verified revenue is
  // its verified sales less what was refunded.
  const refundedOf = (r) => r.history.reduce((t, h) => t + (h.refund ?? 0), 0);
  const verifiedRevenue = round(wonRows.reduce((s, r) => s + Math.max(0, r.history.filter((h) => h.stage === 'won' && h.verified).reduce((t, h) => t + (h.value ?? 0), 0) - refundedOf(r)), 0), 2);
  const revenue = round(wonRows.reduce((s, r) => s + (r.value ?? 0), 0), 2);
  const refunded = round(real.reduce((s, r) => s + refundedOf(r), 0), 2);
  // Open: neither sold nor lost. A customer who later refunded counts as won and lost, never as open.
  const open = real.filter((r) => !['won', 'lost'].includes(r.stage) && !r.history.some((h) => h.stage === 'won')).length;
  const lostReasons = {};
  for (const r of real.filter((x) => x.stage === 'lost')) lostReasons[r.lost_reason || 'unknown'] = (lostReasons[r.lost_reason || 'unknown'] ?? 0) + 1;
  const leak = funnel.slice(1).filter((f) => f.from_previous_pct != null).sort((a, b) => a.from_previous_pct - b.from_previous_pct)[0] ?? null;

  return {
    updated_at: now,
    currency,
    totals: {
      leads: real.length, leads_30d: recent.length, suspected_bots: (pipeline.leads ?? []).length - real.length,
      won: wonRows.length, lost: stageCounts.lost, open,
      lead_to_sale_pct: pct(wonRows.length, real.length), revenue, revenue_verified: verifiedRevenue, revenue_refunded: refunded,
      avg_order_value: wonRows.length ? round(revenue / Math.max(1, wonRows.reduce((s, r) => s + (r.orders || 1), 0)), 2) : null,
      sales_without_tracked_lead: unmatchedPayments.length,
      speed_to_lead_median_h: round(median(speed)), time_to_win_median_d: round(median(toWin)),
      uncontacted_over_sla: actions.filter((a) => a.stage === 'new' && a.overdue).length,
      stuck: actions.filter((a) => a.overdue).length,
    },
    stages: stageCounts,
    funnel,
    biggest_leak: leak ? { into: leak.stage, from_previous_pct: leak.from_previous_pct } : null,
    channels,
    campaigns: Object.values(byCampaign).sort((a, b) => b.revenue - a.revenue || b.leads - a.leads).slice(0, 15),
    cohorts: Object.values(cohorts).sort((a, b) => b.week.localeCompare(a.week)).slice(0, 12),
    lost_reasons: lostReasons,
    next_actions: actions.slice(0, 50),
    sla_hours: SLA,
  };
}

export function funnelMarkdown(name, rep) {
  const t = rep.totals; const c = rep.currency;
  const lines = [
    `# Funnel: ${name}`, '', `Updated ${rep.updated_at}. Built by tools/funnel.mjs from leads, stage updates and payments; nothing is estimated.`, '',
    `- **Leads:** ${t.leads} in total, ${t.leads_30d} in the last 30 days${t.suspected_bots ? ` (${t.suspected_bots} suspected bots left out)` : ''}`,
    `- **Sales:** ${t.won} leads became customers (${t.lead_to_sale_pct ?? 0}% of leads); ${t.open} still open, ${t.lost} lost`,
    `- **Revenue from tracked leads:** ${t.revenue} ${c} (${t.revenue_verified} ${c} verified by payments or the owner${t.revenue_refunded ? `; ${t.revenue_refunded} ${c} refunded and left out` : ''})`,
    t.sales_without_tracked_lead ? `- **Payments with no tracked lead:** ${t.sales_without_tracked_lead} (direct buyers, or leads captured without an email)` : null,
    `- **Speed to lead:** ${t.speed_to_lead_median_h ?? '–'} h median; **time to sale:** ${t.time_to_win_median_d ?? '–'} days median`,
    `- **Needs action:** ${t.uncontacted_over_sla} new leads with no reply past the limit, ${t.stuck} leads stuck in total`,
    rep.biggest_leak ? `- **Biggest leak:** only ${rep.biggest_leak.from_previous_pct}% move on to "${rep.biggest_leak.into}"` : null,
    '', '## Stages', '', '| Stage | Reached | Now here | From previous | From lead |', '|---|---|---|---|---|',
    ...rep.funnel.map((f) => `| ${f.stage} | ${f.reached} | ${f.now} | ${f.from_previous_pct ?? '–'}% | ${f.from_lead_pct ?? '–'}% |`),
    `| nurture | – | ${rep.stages.nurture} | | |`, `| lost | – | ${rep.stages.lost} | | |`,
    '', '## Channels', '', `| Channel | Visits 30d | Leads | Visit→lead | Qualified | Sales | Lead→sale | Revenue (${c}) | Per lead |`, '|---|---|---|---|---|---|---|---|---|',
    ...rep.channels.map((x) => `| ${x.channel} | ${x.visits_30d ?? '–'} | ${x.leads} | ${x.visit_to_lead_pct ?? '–'}% | ${x.qualified} | ${x.won} | ${x.lead_to_sale_pct ?? 0}% | ${x.revenue} | ${x.revenue_per_lead} |`),
    '', '## Weekly cohorts', '', '| Week | Leads | Contacted | Qualified | Sales | Revenue |', '|---|---|---|---|---|---|',
    ...rep.cohorts.map((x) => `| ${x.week} | ${x.leads} | ${x.contacted} | ${x.qualified} | ${x.won} | ${x.revenue} |`),
    '', '## Next actions', '', ...(rep.next_actions.length ? rep.next_actions.slice(0, 20).map((a) => `- ${a.overdue ? '**overdue** ' : ''}${a.lead} (${a.stage}, ${a.hours_in_stage} h, ${a.channel}, consent ${a.consent}) → ${a.agent}: ${a.action}`) : ['- Nothing waiting.']),
  ];
  if (Object.keys(rep.lost_reasons).length) lines.push('', '## Why leads were lost', '', ...Object.entries(rep.lost_reasons).map(([k, v]) => `- ${k}: ${v}`));
  return lines.filter((l) => l !== null).join('\n') + '\n';
}

const ZERO_DEC = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);
// Paid Stripe charges with an email, for matching. ctx.fetch is injectable for tests.
export async function stripePayments(key, { fetch: f = fetch, days = 90 } = {}) {
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const out = [];
  let url = `https://api.stripe.com/v1/charges?limit=100&created[gte]=${since}`;
  for (let page = 0; page < 20 && url; page++) {
    const res = await f(url, { headers: { authorization: `Bearer ${key}` } });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
    for (const c of json.data ?? []) {
      if (c.status !== 'succeeded' || c.refunded) continue;
      const email = c.billing_details?.email ?? c.receipt_email ?? null;
      // Zero-decimal currencies (JPY, KRW …) are already whole units in Stripe; the rest are in cents.
      out.push({ id: c.id, email, amount: ZERO_DEC.has(String(c.currency ?? '').toLowerCase()) ? c.amount : c.amount / 100, currency: c.currency, at: new Date(c.created * 1000).toISOString() });
    }
    url = json.has_more && json.data?.length ? `https://api.stripe.com/v1/charges?limit=100&created[gte]=${since}&starting_after=${json.data.at(-1).id}` : null;
  }
  return out;
}

// Fields an unmatched update keeps while it waits for its lead (no raw email, no free-form extras).
const RETRY_FIELDS = ['lead', 'lead_id', 'id', 'email_hash', 'stage', 'at', 'value', 'amount', 'currency', 'source', 'note', 'reason', 'verified', 'order_id', 'order', 'ref', 'attempts', 'queued_at'];
const RETRY_RUNS = 10;
const earlierIso = (a, b) => (Date.parse(b) < Date.parse(a) ? b : a);

// One product: read sources, merge, report, alert. Returns a summary.
export async function runFunnel(slug, { now = new Date().toISOString(), stripe = true, alerts = true, fetch: f } = {}) {
  const dir = path.join(root, 'products', slug);
  const product = readJson(path.join(dir, 'product.json'), null);
  if (!product) throw new Error(`no product ${slug}`);
  const fdir = path.join(dir, 'funnel');
  const updDir = path.join(fdir, 'updates');
  fs.mkdirSync(path.join(updDir, 'done'), { recursive: true });
  const ledgerFile = path.join(fdir, 'pipeline.json');
  const pipeline = readJson(ledgerFile, { leads: [] });
  pipeline.cursor ??= {};

  // Leads: only lines after the last merged one are new (sync appends). Lead files are re-read; the
  // merge recognises people it already has.
  const leads = []; const errors = [];
  const logFile = path.join(dir, 'leads.jsonl');
  if (fs.existsSync(logFile)) {
    // Sync and the edge append without a lock: a last line with no newline may still be half written,
    // so only finished lines count. The cursor stops after the last line that parsed, so a line cut off
    // now is read once it is complete. A file rewritten shorter (DSAR deletion, cleanup) is read again
    // from the top; the merge recognises people it already has.
    const text = fs.readFileSync(logFile, 'utf8');
    const lines = text.split(/\r?\n/).slice(0, -1).filter((l) => l.trim());
    const bytes = Buffer.byteLength(text);
    let start = Number(pipeline.cursor.leads_jsonl ?? 0);
    if (!Number.isInteger(start) || start < 0 || start > lines.length || bytes < Number(pipeline.cursor.leads_jsonl_bytes ?? 0)) start = 0;
    pipeline.cursor.leads_jsonl_bytes = bytes;
    let next = start;
    for (let i = start; i < lines.length; i++) {
      try { leads.push({ ...JSON.parse(lines[i]), source: 'site' }); next = i + 1; } catch { errors.push(`leads.jsonl line ${i + 1}: not valid JSON, skipped`); }
    }
    pipeline.cursor.leads_jsonl = next;
  }
  const leadsDir = path.join(dir, 'leads');
  if (fs.existsSync(leadsDir)) for (const f of fs.readdirSync(leadsDir).filter((x) => /\.(json|jsonl|csv)$/i.test(x))) { try { for (const r of readRows(path.join(leadsDir, f))) leads.push({ ...r, source: r.source ?? f }); } catch (e) { errors.push(`${f}: ${e.message}`); } }

  const updates = []; const usedFiles = [];
  for (const f of fs.readdirSync(updDir).filter((x) => /\.(json|jsonl|csv)$/i.test(x))) {
    try { for (const u of readRows(path.join(updDir, f))) updates.push(u); usedFiles.push(f); } catch (e) { errors.push(`${f}: ${e.message}`); }
  }

  let payments = [];
  const key = process.env.STRIPE_API_KEY;
  if (stripe && key && process.env.OM_FUNNEL_STRIPE !== '0') {
    try { payments = await stripePayments(key, { fetch: f ?? fetch }); } catch (e) { errors.push(`stripe: ${e.message}`); }
  }

  const { pipeline: next, stats, unmatched_payments, unmatched_updates } = mergeFunnel(pipeline, { leads, updates, payments, now });
  const store = ['ecommerce', 'marketplace'].includes(product.preset) || /commerce|store|shop|d2c/i.test(product.model ?? '');
  const kpis = readJson(path.join(dir, 'metrics', 'kpis.json'), []);
  const report = funnelReport(next, { kpis, now, sla: product.funnel_sla ?? {}, store, unmatchedPayments: unmatched_payments, currency: product.budget?.currency ?? 'USD' });

  writeJson(ledgerFile, next);
  writeJson(path.join(fdir, 'report.json'), report);
  writeJson(path.join(fdir, 'next-actions.json'), { updated_at: now, actions: report.next_actions });
  fs.writeFileSync(path.join(fdir, 'FUNNEL.md'), funnelMarkdown(product.name ?? slug, report));
  for (const f of usedFiles) fs.renameSync(path.join(updDir, f), path.join(updDir, 'done', `${Date.now()}-${f}`));
  // Updates for a lead the ledger does not have yet (an agent's "contacted" written before the next sync
  // brings the lead in) wait in a pending file and retry on each run, up to RETRY_RUNS runs or 30 days.
  // The retry file keeps a hash of the email, never the address.
  const pending = new Map();
  for (const u of unmatched_updates) {
    const email = blank(u.email);
    const row = Object.fromEntries(Object.entries({ ...u, email: undefined, email_hash: email ? hash(email) : blank(u.email_hash) }).filter(([k, v]) => RETRY_FIELDS.includes(k) && v != null && v !== ''));
    row.attempts = (Number(u.attempts) || 0) + 1;
    row.queued_at = isoOk(u.queued_at) ? u.queued_at : now;
    if (row.attempts > RETRY_RUNS || Date.parse(now) - Date.parse(row.queued_at) > 30 * 86400000) continue;
    // The same CRM row re-exported while it waits is one pending row, not one per run.
    const key = JSON.stringify(RETRY_FIELDS.filter((k) => !['attempts', 'queued_at'].includes(k)).map((k) => row[k] ?? null));
    const had = pending.get(key);
    if (!had || had.attempts < row.attempts) pending.set(key, had ? { ...row, queued_at: earlierIso(had.queued_at, row.queued_at) } : row);
  }
  if (pending.size) fs.writeFileSync(path.join(updDir, `pending-${Date.now()}.jsonl`), [...pending.values()].map((x) => JSON.stringify(x)).join('\n') + '\n');
  stats.updates_pending = pending.size;

  // Alerts for the owner, one open alert per key (resolved here when the cause is gone).
  if (alerts) {
    const afile = path.join(dir, 'alerts.json');
    const list = readJson(afile, []);
    const want = [];
    const t = report.totals;
    if (t.uncontacted_over_sla > 0) want.push({ key: 'funnel:uncontacted', level: 'critical', title: `${t.uncontacted_over_sla} new lead(s) have had no reply for over ${report.sla_hours.new} h`, detail: 'Every hour lowers the chance of a sale. Run /om run (om-lead-to-sale) or approve the replies waiting.' });
    if (t.stuck - t.uncontacted_over_sla > 0) want.push({ key: 'funnel:stuck', level: 'warning', title: `${t.stuck - t.uncontacted_over_sla} lead(s) stuck past their stage limit`, detail: 'See funnel/FUNNEL.md, Next actions.' });
    const firstWin = (next.leads ?? []).filter((r) => r.won_at && r.won_at > new Date(Date.parse(now) - 86400000).toISOString()).length;
    if (firstWin) want.push({ key: `funnel:won:${now.slice(0, 10)}`, level: 'info', title: `${firstWin} lead(s) became customers in the last 24 h`, detail: `Revenue from tracked leads so far: ${t.revenue} ${report.currency}.` });
    let changed = false;
    for (const w of want) {
      const open = list.find((a) => !a.resolved && a.key === w.key);
      if (open) { if (open.title !== w.title) { Object.assign(open, w, { last_seen: now }); changed = true; } continue; }
      list.push({ ...w, agent: 'om-funnel-manager', at: now, resolved: false }); changed = true;
    }
    for (const a of list) if (!a.resolved && /^funnel:(uncontacted|stuck)$/.test(a.key ?? '') && !want.some((w) => w.key === a.key)) { a.resolved = true; a.resolved_at = now; a.resolved_by = 'om-funnel-manager'; changed = true; }
    if (changed) writeJson(afile, list);
    if (stats.new_leads || stats.updates_applied || stats.payments_matched) {
      fs.appendFileSync(path.join(dir, 'events.jsonl'), JSON.stringify({ at: now, agent: 'om-funnel-manager', product: slug, kind: 'lead', text: `Funnel: ${stats.new_leads} new lead(s), ${stats.updates_applied} stage change(s), ${stats.payments_matched} payment(s) matched; ${t.won} customers from ${t.leads} leads` }) + '\n');
    }
  }
  // New leads waiting for a first reply: queue an AI reply run for the hub (tools/hub-service.mjs runs
  // om-lead-to-sale headless). One job per product at a time; OM_AUTO_RESPOND=0 turns it off.
  // OM_QUEUE_DIR moves the queue (tests point it at a temp folder so a running hub never picks up a job).
  let queued = false;
  const modesCfg = readJson(path.join(root, 'config', 'ai-modes.json'), {});
  const replyMode = process.env.OM_AI_REPLY || modesCfg?.modes?.[modesCfg?.mode]?.reply || 'all';
  const tiers = Object.fromEntries((readJson(path.join(fdir, 'scores.json'), {})?.leads ?? []).map((x) => [String(x.lead), x.tier]));
  const wantsAi = (a) => a.stage === 'new' && (replyMode === 'all' || tiers[String(a.lead)] === 'hot' || (replyMode === 'warm' && tiers[String(a.lead)] === 'warm'));
  if (process.env.OM_AUTO_RESPOND !== '0' && product.stage !== 'paused' && report.next_actions.some(wantsAi)) {
    const q = process.env.OM_QUEUE_DIR || path.join(root, 'state', 'queue');
    const job = path.join(q, `respond-${slug}.json`);
    if (!fs.existsSync(job) && !fs.existsSync(`${job}.running`)) {
      fs.mkdirSync(q, { recursive: true });
      writeJson(job, { slug, at: now, leads: report.next_actions.filter(wantsAi).length, reply: replyMode, by: 'funnel' });
      queued = true;
    }
  }
  return { slug, ...stats, unmatched_payments: unmatched_payments.length, totals: report.totals, respond_queued: queued, errors };
}

// Every product's report, without personal data, for the dashboard and the live page.
export function writeFunnelState(slugs) {
  const products = [];
  for (const slug of slugs) {
    const rep = readJson(path.join(root, 'products', slug, 'funnel', 'report.json'), null);
    if (!rep) continue;
    const p = readJson(path.join(root, 'products', slug, 'product.json'), {});
    products.push({ product: slug, name: p.name ?? slug, mode: p.budget?.mode ?? 'free', currency: rep.currency, updated_at: rep.updated_at, totals: rep.totals, funnel: rep.funnel, stages: rep.stages, channels: rep.channels.slice(0, 12), cohorts: rep.cohorts.slice(0, 8), biggest_leak: rep.biggest_leak, next_actions: rep.next_actions.slice(0, 10).map(({ lead, ...a }) => ({ ...a, lead: String(lead).slice(0, 12) })) });
  }
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  const rows = products.flatMap((p) => p.funnel.map((f) => ({ product: p.product, stage: f.stage, reached: f.reached, now: f.now, from_previous_pct: f.from_previous_pct })));
  writeJson(path.join(stateDir, 'funnel.json'), rows.length ? rows : [{ product: null, stage: null, reached: null, now: null, from_previous_pct: null, _empty: true }]);
  fs.writeFileSync(path.join(stateDir, 'live-funnel.json'), JSON.stringify({ updated_at: new Date().toISOString(), products }));
  return products.length;
}

const activeSlugs = () => {
  const dir = path.join(root, 'products');
  return (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((s) => !s.startsWith('_') && /^[a-z0-9-]+$/i.test(s) && fs.existsSync(path.join(dir, s, 'product.json')));
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  loadEnv();
  const argv = process.argv.slice(2);
  const opts = { stripe: !argv.includes('--no-stripe'), alerts: !argv.includes('--no-alerts') };
  const slugs = argv.includes('--all') ? activeSlugs().filter((s) => readJson(path.join(root, 'products', s, 'product.json'), {}).stage !== 'paused') : argv.filter((a) => !a.startsWith('--')).slice(0, 1);
  if (!slugs.length) { console.error('Usage: node tools/funnel.mjs <slug> | --all'); process.exit(2); }
  const out = [];
  for (const s of slugs) { try { out.push(await runFunnel(s, opts)); } catch (e) { out.push({ slug: s, error: e.message }); } }
  writeFunnelState(activeSlugs());
  console.log(JSON.stringify(slugs.length === 1 ? out[0] : { products: out }));
  if (out.some((o) => o.error)) process.exit(1);
}
