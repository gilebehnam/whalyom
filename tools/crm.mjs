// Native CRM over the funnel ledger: contacts and deals per product, kept in step with the funnel, owner
// edits and HubSpot / Pipedrive CSV files, plus a pipeline view (stage totals, weighted forecast,
// deals slipping past their close date). Closes "Native CRM / pipeline".
//   products/<slug>/crm/contacts.json   {contacts: {<lead id>: contact}}. Raw contact details (name, email,
//                                        phone) live here and only here, inside the product folder.
//   products/<slug>/crm/deals.json      {deals: [deal]}: amount, currency, stage, probability, close date,
//                                        owner, next step, notes, history. Single writer: this tool.
//   products/<slug>/crm/pipeline.json   the pipeline view (no raw emails or phones)
//   products/<slug>/crm/CRM.md          the same view for people
//   products/<slug>/crm/exports/        HubSpot / Pipedrive CSV exports (raw details, product folder only)
//   state/crm.json                      every product, stage totals and counts only (no names, ids, emails)
// Sources, all optional:
//   1. funnel/pipeline.json (tools/funnel.mjs) + leads.jsonl: every lead becomes a contact; a lead that
//      reaches "qualified" gets a deal. Funnel moves deals forward only (qualified, proposal, won, lost).
//   2. crm/edits/*.json|jsonl: owner field edits [{lead | deal, contact: {...}, deal: {...}, note?, at?, by?}]
//      or flat {lead, amount, close_date, next_step, owner, stage, ...}. Unknown fields are rejected, not
//      guessed. Moved to crm/edits/done/ once read.
//   3. crm/imports/*.csv or `import <slug> <file>`: HubSpot or Pipedrive exports (contacts and/or deals).
// Stages belong to the funnel: a deal stage changed by an edit or import is also written as a stage
// change to funnel/updates/crm-*.json (tools/funnel.mjs merges it), and imported people who are not in
// the funnel yet are written to leads/crm-import-*.json. This tool never sends, posts or spends: with
// --propose it lists follow-ups for slipping deals as pending approvals in runs/CRM-<date>.json, only for
// contacts with consent (opted-in or inbound).
// Usage: node tools/crm.mjs <slug> [--propose]          sync, apply edits and drop-in imports, write view
//        node tools/crm.mjs import <slug> <file.csv> [--format hubspot|pipedrive]
//        node tools/crm.mjs export <slug> <hubspot|pipedrive> [contacts|deals]
//        node tools/crm.mjs --all                        every active product, then state/crm.json
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, root } from './lib/env.mjs';
import { canonicalStage } from './funnel.mjs';

// Deal stages, in order. "won" and "lost" close a deal.
export const DEAL_STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
export const OPEN_STAGES = ['lead', 'qualified', 'proposal', 'negotiation'];
const RANK = Object.fromEntries(DEAL_STAGES.map((s, i) => [s, i]));
// Default win probability per stage (product.json crm.stage_probability overrides, 0–1 or 0–100).
export const DEFAULT_PROBABILITY = { lead: 0.1, qualified: 0.2, proposal: 0.5, negotiation: 0.7, won: 1, lost: 0 };

// Words from HubSpot, Pipedrive and people, mapped to a deal stage (keys: lowercase letters and digits).
const STAGE_WORDS = {
  lead: ['lead', 'new', 'open', 'leadin', 'appointmentscheduled', 'contactmade', 'contacted', 'engaged'],
  qualified: ['qualified', 'qualifiedtobuy', 'discovery', 'sql', 'mql', 'salesqualifiedlead', 'marketingqualifiedlead'],
  proposal: ['proposal', 'proposalmade', 'presentationscheduled', 'demoscheduled', 'demo', 'quote', 'quotesent', 'decisionmakerboughtin', 'opportunity', 'meeting', 'booked'],
  negotiation: ['negotiation', 'negotiationsstarted', 'contractsent', 'commit', 'decision'],
  won: ['won', 'closedwon', 'customer', 'paid'],
  lost: ['lost', 'closedlost', 'disqualified', 'unqualified', 'nofit'],
};
const STAGE_WORD = Object.fromEntries(Object.entries(STAGE_WORDS).flatMap(([s, ws]) => ws.map((w) => [w, s])));
const FROM_FUNNEL = { new: 'lead', contacted: 'lead', engaged: 'lead', qualified: 'qualified', opportunity: 'proposal', won: 'won', lost: 'lost' };
const TO_FUNNEL = { qualified: 'qualified', proposal: 'opportunity', negotiation: 'opportunity', won: 'won', lost: 'lost' };
export function dealStage(s) {
  const k = String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!k) return null;
  return STAGE_WORD[k] ?? FROM_FUNNEL[canonicalStage(s)] ?? null;
}

const CONTACT_FIELDS = ['name', 'first_name', 'last_name', 'email', 'phone', 'company', 'title', 'owner', 'tags'];
const DEAL_FIELDS = ['deal_title', 'amount', 'currency', 'stage', 'probability', 'close_date', 'owner', 'next_step', 'note', 'notes'];
const META_FIELDS = ['lead', 'lead_id', 'contact_id', 'deal', 'deal_id', 'at', 'by', 'contact', 'source'];

const hash = (s) => crypto.createHash('sha256').update(String(s).trim().toLowerCase()).digest('hex').slice(0, 16);
const isoOk = (s) => Boolean(s) && !Number.isNaN(Date.parse(s));
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const clip = (s, n = 300) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n);
const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;
const cleanEmail = (s) => { const v = clip(s, 254).toLowerCase(); return EMAIL.test(v) ? v : null; };
const cleanPhone = (s) => { const v = clip(s, 40); return /^[+\d][\d\s().\-/x]{4,}$/i.test(v) ? v : null; };
const cleanAmount = (v) => { if (v === '' || v == null) return null; const n = Number(String(v).replace(/[^\d.\-]/g, '')); return Number.isFinite(n) && n >= 0 ? round(n) : undefined; };
const cleanCurrency = (v) => { const c = clip(v, 8).toUpperCase(); return /^[A-Z]{3}$/.test(c) ? c : undefined; };
// A date that starts YYYY-MM-DD keeps that calendar day ("2026-11-04 23:30" must not shift a day in another time zone).
const cleanDate = (v) => { if (v === '' || v == null) return null; const s = String(v).trim(); const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/); if (ymd) { const d = new Date(Date.UTC(+ymd[1], +ymd[2] - 1, +ymd[3])); return d.getUTCMonth() === +ymd[2] - 1 && d.getUTCDate() === +ymd[3] ? d.toISOString().slice(0, 10) : undefined; } if (!isoOk(s)) return undefined; return new Date(Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s)).toISOString().slice(0, 10); };
const cleanProbability = (v) => { if (v === '' || v == null) return null; const n = Number(String(v).replace('%', '')); if (!Number.isFinite(n) || n < 0 || n > 100) return undefined; return round(n > 1 ? n / 100 : n, 3); };
const sortObj = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
const emptyCrm = () => ({ contacts: {}, deals: [] });

// --- CSV -------------------------------------------------------------------------------------------
// RFC 4180: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF, BOM.
export function parseCsv(text) {
  const s = String(text ?? '').replace(/^﻿/, '');
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const [head = [], ...body] = rows.filter((r) => r.some((c) => c.trim() !== ''));
  const cols = head.map((c) => c.trim());
  // A leading apostrophe that guarded a formula on export is removed on the way back in.
  const unguard = (v) => (/^'[=+\-@\t]/.test(v) ? v.slice(1) : v);
  return body.map((r) => Object.fromEntries(cols.map((c, i) => [c, unguard((r[i] ?? '').trim())])));
}
// Cells that a spreadsheet would run as a formula get a leading apostrophe; phone numbers stay as is.
const cell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?[\d\s().-]+$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (headers, rows) => [headers.map(cell).join(','), ...rows.map((r) => headers.map((h) => cell(r[h])).join(','))].join('\r\n') + '\r\n';

// --- HubSpot / Pipedrive column maps --------------------------------------------------------------
const nk = (h) => String(h).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const COLS = {
  hubspot: {
    id: ['record id', 'contact id', 'deal id'], first_name: ['first name'], last_name: ['last name'], name: ['name', 'full name'],
    email: ['email', 'associated contact email', 'associated contact'], phone: ['phone number', 'mobile phone number', 'phone'],
    company: ['company name', 'associated company', 'company'], title: ['job title'], lifecycle: ['lifecycle stage'],
    contact_owner: ['contact owner', 'hubspot owner'], deal_title: ['deal name'], deal_stage: ['deal stage'], amount: ['amount'],
    currency: ['currency', 'deal currency code'], close_date: ['close date'], deal_owner: ['deal owner'], next_step: ['next step'], note: ['deal description', 'notes'],
  },
  pipedrive: {
    id: ['deal id'], person_id: ['person id'], name: ['person name', 'contact person', 'name'], email: ['person email', 'email'],
    phone: ['person phone', 'phone'], company: ['organization name', 'organization', 'person organization'], title: ['person job title', 'job title'],
    contact_owner: ['person owner'], deal_title: ['deal title', 'title'], deal_stage: ['deal stage', 'stage'], status: ['deal status', 'status'],
    amount: ['deal value', 'value'], currency: ['deal currency', 'currency'], close_date: ['deal expected close date', 'expected close date'],
    deal_owner: ['deal owner', 'owner'], next_step: ['deal next activity subject', 'next activity subject'], note: ['deal notes', 'notes'],
  },
};
export function detectFormat(headers) {
  const raw = (Array.isArray(headers) ? headers : []).map((x) => String(x));
  const h = raw.map(nk);
  // Pipedrive exports name columns "Deal - Title", "Person - Email", "Organization - Name".
  if (raw.some((x) => /^(deal|person|organization)\s*-\s/i.test(x.trim()))) return 'pipedrive';
  if (h.some((x) => ['record id', 'deal name', 'lifecycle stage', 'contact owner', 'deal owner', 'first name'].includes(x))) return 'hubspot';
  if (h.includes('title') && h.includes('value')) return 'pipedrive';
  return null;
}
const picker = (row, format) => {
  const keys = Object.keys(row).map((k) => [nk(k), k]);
  return (field) => {
    for (const alias of COLS[format][field] ?? []) {
      const hit = keys.find(([n]) => n === alias) ?? keys.find(([n]) => n.startsWith(`${alias} `));
      if (hit && String(row[hit[1]]).trim() !== '') return String(row[hit[1]]).trim();
    }
    return '';
  };
};
// One CSV row → {contact, deal, external ids, lifecycle}. Values are cleaned; bad ones are dropped.
export function normalizeRow(row, format) {
  const get = picker(row, format);
  const emailRaw = get('email');
  const email = cleanEmail(emailRaw) ?? cleanEmail((emailRaw.match(/[^\s<>(),;]+@[^\s<>(),;]+/) ?? [])[0]);
  const first = clip(get('first_name'), 80); const last = clip(get('last_name'), 80);
  const name = clip(get('name'), 160) || [first, last].filter(Boolean).join(' ');
  const contact = { name, first_name: first, last_name: last, email, phone: cleanPhone(get('phone')), company: clip(get('company'), 160), title: clip(get('title'), 120), owner: clip(get('contact_owner'), 80) };
  const title = clip(get('deal_title'), 200);
  const status = nk(get('status'));
  const stage = status === 'won' ? 'won' : status === 'lost' ? 'lost' : dealStage(get('deal_stage'));
  const hasDeal = Boolean(title || get('deal_stage') || get('amount'));
  const deal = hasDeal ? { title, stage, amount: cleanAmount(get('amount')) ?? null, currency: cleanCurrency(get('currency')) ?? null, close_date: cleanDate(get('close_date')) ?? null, owner: clip(get('deal_owner'), 80), next_step: clip(get('next_step'), 300), note: clip(get('note'), 1000) } : null;
  const id = get('id');
  return { contact, deal, lifecycle: get('lifecycle'), external_id: id ? clip(id, 64) : null, person_id: clip(get('person_id'), 64) || null };
}

// --- Contacts and deals ---------------------------------------------------------------------------
const newDeal = (id, lead_id, now, source) => ({ id, lead_id, title: '', amount: null, currency: null, stage: 'lead', probability: null, close_date: null, owner: '', next_step: '', notes: [], created_at: now, updated_at: now, won_at: null, lost_at: null, source, external: {}, history: [] });
const openDealOf = (crm, lead_id) => crm.deals.find((d) => d.lead_id === lead_id && OPEN_STAGES.includes(d.stage)) ?? null;
const setStage = (d, stage, at, by) => {
  if (!stage || d.stage === stage) return false;
  d.history.push({ from: d.stage, stage, at, by });
  d.stage = stage; d.updated_at = at;
  if (stage === 'won') { d.won_at ??= at; d.lost_at = null; }
  if (stage === 'lost') { d.lost_at ??= at; }
  if (OPEN_STAGES.includes(stage)) { d.won_at = null; d.lost_at = null; }
  return true;
};
const contactOf = (crm, lead_id, now, source) => (crm.contacts[lead_id] ??= { lead_id, email_hash: null, name: '', first_name: '', last_name: '', email: null, phone: null, company: '', title: '', owner: '', tags: [], channel: '', consent: 'unknown', funnel_stage: null, created_at: now, updated_at: now, sources: [source], external: {} });
const addSource = (c, s) => { if (s && !c.sources.includes(s)) c.sources.push(s); };

// Funnel ledger (+ raw contact details from leads.jsonl rows) → contacts and deals. Pure.
// pipeline: funnel/pipeline.json; leadLog: parsed leads.jsonl rows; returns {crm, stats}.
export function syncFromFunnel(crmIn, pipeline, { leadLog = [], now = new Date().toISOString(), currency = 'USD' } = {}) {
  const crm = structuredClone(crmIn ?? emptyCrm());
  crm.contacts ??= {}; crm.deals ??= [];
  const stats = { contacts_new: 0, contacts_updated: 0, deals_new: 0, deals_moved: 0 };
  const raw = new Map();
  for (const l of Array.isArray(leadLog) ? leadLog : []) if (l?.lead_id && l.contact && typeof l.contact === 'object') raw.set(String(l.lead_id), l.contact);
  const byHash = new Map(Object.values(crm.contacts).filter((c) => c.email_hash).map((c) => [c.email_hash, c]));
  for (const r of Array.isArray(pipeline?.leads) ? pipeline.leads : []) {
    const lead_id = String(r?.lead_id ?? r?.id ?? '').slice(0, 80);
    if (!lead_id) continue;
    // A person already imported from a CRM file (other id, same email) is the same contact.
    const known = crm.contacts[lead_id] ?? (r.email_hash && byHash.get(r.email_hash)) ?? (r.aliases ?? []).map((a) => crm.contacts[a]).find(Boolean);
    const isNew = !known;
    const c = known ?? contactOf(crm, lead_id, r.first_seen && isoOk(r.first_seen) ? new Date(r.first_seen).toISOString() : now, 'funnel');
    if (isNew) stats.contacts_new++;
    const before = JSON.stringify(c);
    addSource(c, 'funnel');
    if (c.lead_id !== lead_id) { (c.aliases ??= []); if (!c.aliases.includes(lead_id)) c.aliases.push(lead_id); }
    c.email_hash ??= r.email_hash ?? null;
    c.channel ||= String(r.channel ?? '');
    c.consent = r.consent ?? c.consent;
    c.funnel_stage = r.stage ?? c.funnel_stage;
    const rc = raw.get(lead_id) ?? (r.aliases ?? []).map((a) => raw.get(a)).find(Boolean);
    if (rc) {
      // Raw details fill gaps only; an owner edit is never overwritten by the site log.
      const email = cleanEmail(rc.email);
      if (!c.email && email) { c.email = email; c.email_hash ??= hash(email); }
      if (!c.name && rc.name) c.name = clip(rc.name, 160);
      if (!c.phone) c.phone = cleanPhone(rc.phone) ?? c.phone;
      if (!c.company && rc.company) c.company = clip(rc.company, 160);
    }
    if (c.email_hash) byHash.set(c.email_hash, c);
    if (JSON.stringify(c) !== before) { c.updated_at = now; if (!isNew) stats.contacts_updated++; }

    // Deals: a lead that reached "qualified" (or won) has one. Funnel moves are forward only.
    const target = FROM_FUNNEL[r.stage] ?? null;
    const reached = Number(r.max_rank ?? -1) >= 3 || r.stage === 'won';
    let d = crm.deals.filter((x) => x.lead_id === c.lead_id).sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1) ?? null;
    if (!d && reached) {
      d = newDeal(`D-${hash(c.lead_id)}`, c.lead_id, now, 'funnel');
      d.stage = target && RANK[target] >= RANK.qualified ? target : 'qualified';
      d.currency = currency; d.history.push({ from: null, stage: d.stage, at: now, by: 'funnel' });
      if (d.stage === 'won') d.won_at = r.won_at ?? now;
      if (d.stage === 'lost') d.lost_at = now;
      crm.deals.push(d); stats.deals_new++;
    } else if (d && target) {
      const forward = OPEN_STAGES.includes(d.stage) && (target === 'won' || target === 'lost' || RANK[target] > RANK[d.stage]);
      if (forward && setStage(d, target, now, 'funnel')) { if (target === 'won' && r.won_at) d.won_at = r.won_at; stats.deals_moved++; }
    }
    // Verified revenue from the funnel (payments) sets the amount of a won deal the owner left empty.
    if (d && d.stage === 'won' && Number(r.value) > 0 && d.amount == null) { d.amount = round(Number(r.value)); d.currency = r.currency ?? d.currency ?? currency; d.updated_at = now; }
  }
  return { crm: normalizeCrm(crm), stats };
}

// Owner edits → contacts and deals. Pure. Returns {crm, applied, rejected, funnel_updates}.
export function applyEdits(crmIn, edits, { now = new Date().toISOString(), currency = 'USD' } = {}) {
  const crm = structuredClone(crmIn ?? emptyCrm());
  crm.contacts ??= {}; crm.deals ??= [];
  const rejected = []; const funnel_updates = []; let applied = 0;
  const list = (Array.isArray(edits) ? edits : []).map((e, i) => ({ e, i })).sort((a, b) => String(a.e?.at ?? '').localeCompare(String(b.e?.at ?? '')) || a.i - b.i);
  for (const { e, i } of list) {
    const ref = `edit ${e?._file ? `${e._file}#` : ''}${e?._row ?? i}`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) { rejected.push({ ref, reason: 'not an object' }); continue; }
    const at = isoOk(e.at) ? new Date(e.at).toISOString() : now;
    const by = clip(e.by ?? 'owner', 60) || 'owner';
    // Fields: nested {contact, deal} or flat. "title" in a flat edit is the deal title only when deal fields are present.
    const cIn = { ...(e.contact && typeof e.contact === 'object' ? e.contact : {}) };
    const dIn = { ...(e.deal && typeof e.deal === 'object' ? e.deal : {}) };
    const unknown = [];
    for (const [k, v] of Object.entries(e)) {
      if (k.startsWith('_') || META_FIELDS.includes(k)) continue;
      if (k === 'title' && Object.keys(e).some((x) => DEAL_FIELDS.includes(x) && x !== 'owner')) dIn.title = v;
      else if (DEAL_FIELDS.includes(k) && !CONTACT_FIELDS.includes(k)) dIn[k === 'deal_title' ? 'title' : k] = v;
      else if (k === 'owner') { if (Object.keys(e).some((x) => DEAL_FIELDS.includes(x) && x !== 'owner')) dIn.owner = v; else cIn.owner = v; }
      else if (CONTACT_FIELDS.includes(k)) cIn[k] = v;
      else unknown.push(k);
    }
    if ('deal_title' in dIn) { dIn.title ??= dIn.deal_title; delete dIn.deal_title; }
    for (const k of Object.keys(cIn)) if (!CONTACT_FIELDS.includes(k)) unknown.push(`contact.${k}`);
    for (const k of Object.keys(dIn)) if (!['title', ...DEAL_FIELDS].includes(k)) unknown.push(`deal.${k}`);
    if (unknown.length) { rejected.push({ ref, reason: `unknown field(s): ${unknown.join(', ')}` }); continue; }

    const dealRef = typeof e.deal === 'string' ? e.deal : (e.deal_id ?? null);
    let deal = dealRef ? crm.deals.find((d) => d.id === String(dealRef)) : null;
    if (dealRef && !deal) { rejected.push({ ref, reason: `no deal ${clip(dealRef, 40)}` }); continue; }
    const leadRef = String(e.lead ?? e.lead_id ?? e.contact_id ?? deal?.lead_id ?? '').slice(0, 80);
    const contact = leadRef ? (crm.contacts[leadRef] ?? Object.values(crm.contacts).find((c) => (c.aliases ?? []).includes(leadRef))) : null;
    if (!contact) { rejected.push({ ref, reason: leadRef ? `no contact ${clip(leadRef, 40)}` : 'no lead or deal given' }); continue; }

    // Validate everything first, so an edit applies in full or not at all.
    const errs = []; const cSet = {}; const dSet = {};
    for (const [k, v] of Object.entries(cIn)) {
      if (k === 'email') { if (v === '' || v == null) cSet.email = null; else { const m = cleanEmail(v); if (m) cSet.email = m; else errs.push('email is not an address'); } }
      else if (k === 'phone') { if (v === '' || v == null) cSet.phone = null; else { const p = cleanPhone(v); if (p) cSet.phone = p; else errs.push('phone is not a number'); } }
      else if (k === 'tags') cSet.tags = [...new Set((Array.isArray(v) ? v : String(v).split(/[,;]/)).map((t) => clip(t, 40)).filter(Boolean))].sort().slice(0, 30);
      else cSet[k] = clip(v, 160);
    }
    for (const [k, v] of Object.entries(dIn)) {
      if (k === 'amount') { const a = cleanAmount(v); if (a === undefined) errs.push('amount must be a number ≥ 0'); else dSet.amount = a; }
      else if (k === 'currency') { const c = cleanCurrency(v); if (!c) errs.push('currency must be a 3-letter code'); else dSet.currency = c; }
      else if (k === 'close_date') { const dt = cleanDate(v); if (dt === undefined) errs.push('close_date is not a date'); else dSet.close_date = dt; }
      else if (k === 'probability') { const p = cleanProbability(v); if (p === undefined) errs.push('probability must be 0–1 or 0–100'); else dSet.probability = p; }
      else if (k === 'stage') { const s = dealStage(v); if (!s) errs.push(`unknown stage "${clip(v, 30)}"`); else dSet.stage = s; }
      else if (k === 'note' || k === 'notes') { const n = clip(v, 1000); if (n) dSet.note = n; }
      else dSet[k] = clip(v, k === 'next_step' ? 300 : 200);
    }
    if (errs.length) { rejected.push({ ref, reason: errs.join('; ') }); continue; }

    if (Object.keys(cSet).length) {
      Object.assign(contact, cSet);
      if ('email' in cSet) contact.email_hash = cSet.email ? hash(cSet.email) : contact.email_hash;
      if (cSet.first_name !== undefined || cSet.last_name !== undefined) contact.name ||= [contact.first_name, contact.last_name].filter(Boolean).join(' ');
      addSource(contact, 'owner'); contact.updated_at = at;
    }
    if (Object.keys(dSet).length) {
      if (!deal) deal = openDealOf(crm, contact.lead_id);
      if (!deal) {
        deal = newDeal(`D-${hash(`${contact.lead_id}:${at}:${crm.deals.length}`)}`, contact.lead_id, at, 'owner');
        deal.currency = currency; deal.history.push({ from: null, stage: 'lead', at, by });
        crm.deals.push(deal);
      }
      const prev = deal.stage;
      const { stage, note, ...fields } = dSet;
      Object.assign(deal, fields);
      if (note) deal.notes.push({ at, by, text: note });
      if (stage && setStage(deal, stage, at, by) && TO_FUNNEL[stage] && TO_FUNNEL[stage] !== TO_FUNNEL[prev]) {
        funnel_updates.push({ lead: deal.lead_id, stage: TO_FUNNEL[stage], at, source: 'crm', ...(stage === 'won' && deal.amount ? { value: deal.amount, currency: deal.currency ?? currency } : {}), note: `CRM: deal ${deal.id} → ${stage}` });
      }
      deal.updated_at = at;
    }
    applied++;
  }
  return { crm: normalizeCrm(crm), applied, rejected, funnel_updates };
}

// HubSpot / Pipedrive CSV rows → contacts and deals. Pure. Returns {crm, stats, leads, funnel_updates}:
// leads are imported people the funnel does not know yet (for leads/), funnel_updates their stage moves.
export function importRows(crmIn, rows, { format, now = new Date().toISOString(), currency = 'USD', file = 'import' } = {}) {
  if (!['hubspot', 'pipedrive'].includes(format)) throw new Error(`unknown format "${format}" (hubspot or pipedrive)`);
  const crm = structuredClone(crmIn ?? emptyCrm());
  crm.contacts ??= {}; crm.deals ??= [];
  const stats = { rows: 0, contacts_new: 0, contacts_updated: 0, deals_new: 0, deals_updated: 0, skipped: 0, kept_closed: 0 };
  const leads = []; const funnel_updates = []; const src = `crm-import:${format}`;
  // Indexed by the stored hash and by the hash of the stored address (they differ if an edit changed it).
  const byHash = new Map(Object.values(crm.contacts).flatMap((c) => [c.email_hash, c.email ? hash(c.email) : null].filter(Boolean).map((h) => [h, c])));
  const byExt = new Map(Object.values(crm.contacts).filter((c) => c.external?.[format]).map((c) => [c.external[format], c]));
  for (const row of Array.isArray(rows) ? rows : []) {
    stats.rows++;
    if (!row || typeof row !== 'object') { stats.skipped++; continue; }
    const n = normalizeRow(row, format);
    const personKey = n.deal ? n.person_id : (n.person_id ?? n.external_id);
    if (!n.contact.email && !n.contact.name && !personKey) { stats.skipped++; continue; }
    const email_hash = n.contact.email ? hash(n.contact.email) : null;
    let c = (email_hash && byHash.get(email_hash)) || (personKey && byExt.get(personKey)) || null;
    if (!c && !n.contact.email && n.contact.name) c = Object.values(crm.contacts).find((x) => !x.email && x.name && x.name.toLowerCase() === n.contact.name.toLowerCase() && (x.company || '') === n.contact.company) ?? null;
    if (!c) {
      const lead_id = `C-${hash(email_hash ?? `${format}:${personKey ?? ''}:${n.contact.name}:${n.contact.company}`)}`;
      c = contactOf(crm, lead_id, now, src); stats.contacts_new++;
      c.email_hash = email_hash;
      leads.push({ lead_id, email: n.contact.email ?? undefined, name: n.contact.name || undefined, channel: 'crm-import', source: src });
    } else stats.contacts_updated++;
    // Imported values fill or replace details (the owner's own CRM is the authority for its fields).
    for (const k of ['name', 'first_name', 'last_name', 'company', 'title', 'owner']) if (n.contact[k]) c[k] = n.contact[k];
    if (n.contact.email) { c.email = n.contact.email; c.email_hash = email_hash; byHash.set(email_hash, c); }
    if (n.contact.phone) c.phone = n.contact.phone;
    if (personKey) { c.external ??= {}; c.external[format] = personKey; byExt.set(personKey, c); }
    addSource(c, src); c.updated_at = now;
    const life = n.lifecycle ? canonicalStage(nk(n.lifecycle).replace(/ /g, '_')) ?? FUNNEL_LIFECYCLE[nk(n.lifecycle).replace(/ /g, '')] : null;
    if (life && life !== 'new' && life !== c.funnel_stage) funnel_updates.push({ lead: c.lead_id, stage: life, at: now, source: src });

    if (!n.deal) continue;
    const ext = n.deal ? n.external_id : null;
    // Match: the CRM's own id, then the same title for this person, then our own id in an exported title.
    const ownId = (n.deal.title.match(/^Deal (D-[0-9a-f]{16})$/) ?? [])[1];
    let d = (ext && crm.deals.find((x) => x.external?.[format] === ext)) || crm.deals.find((x) => x.lead_id === c.lead_id && n.deal.title && x.title === n.deal.title) || (ownId && crm.deals.find((x) => x.id === ownId)) || null;
    if (!d) {
      d = newDeal(`D-${hash(ext ? `${format}:${ext}` : `${c.lead_id}:${n.deal.title}`)}`, c.lead_id, now, src);
      d.currency = currency; d.history.push({ from: null, stage: 'lead', at: now, by: src });
      crm.deals.push(d); stats.deals_new++;
    } else stats.deals_updated++;
    if (ext) d.external[format] = ext;
    for (const k of ['title', 'owner', 'next_step']) if (n.deal[k] && !(k === 'title' && ownId)) d[k] = n.deal[k];
    for (const k of ['amount', 'currency', 'close_date']) if (n.deal[k] != null) d[k] = n.deal[k];
    if (n.deal.note && !d.notes.some((x) => x.text === n.deal.note)) d.notes.push({ at: now, by: src, text: n.deal.note });
    const prev = d.stage;
    // A won deal is never reopened by an older export.
    if (n.deal.stage && prev === 'won' && n.deal.stage !== 'won') stats.kept_closed++;
    else if (n.deal.stage && setStage(d, n.deal.stage, now, src) && TO_FUNNEL[n.deal.stage] && TO_FUNNEL[n.deal.stage] !== TO_FUNNEL[prev]) {
      funnel_updates.push({ lead: c.lead_id, stage: TO_FUNNEL[n.deal.stage], at: now, source: src, ...(n.deal.stage === 'won' && d.amount ? { value: d.amount, currency: d.currency ?? currency } : {}), note: `${file}: deal ${d.id}` });
    }
    d.updated_at = now;
  }
  // One stage move per lead per import: the furthest one.
  const best = new Map();
  const order = ['new', 'contacted', 'engaged', 'nurture', 'qualified', 'opportunity', 'lost', 'won'];
  for (const u of funnel_updates) { const b = best.get(u.lead); if (!b || order.indexOf(u.stage) > order.indexOf(b.stage)) best.set(u.lead, u); }
  return { crm: normalizeCrm(crm), stats, leads, funnel_updates: [...best.values()] };
}
const FUNNEL_LIFECYCLE = { subscriber: 'new', lead: 'new', marketingqualifiedlead: 'qualified', salesqualifiedlead: 'qualified', opportunity: 'opportunity', customer: 'won', evangelist: 'won' };

// Contacts and deals → HubSpot / Pipedrive CSV text (raw details: keep the file in the product folder).
const HS_LIFE = { new: 'lead', contacted: 'lead', engaged: 'lead', nurture: 'lead', qualified: 'salesqualifiedlead', opportunity: 'opportunity', won: 'customer', lost: 'other' };
const HS_STAGE = { lead: 'appointmentscheduled', qualified: 'qualifiedtobuy', proposal: 'presentationscheduled', negotiation: 'contractsent', won: 'closedwon', lost: 'closedlost' };
const PD_STAGE = { lead: 'Contact Made', qualified: 'Qualified', proposal: 'Proposal Made', negotiation: 'Negotiations Started', won: 'Negotiations Started', lost: 'Negotiations Started' };
export function exportCsv(crm, format, kind = 'deals') {
  // People with no name, email or phone cannot be matched by the other CRM, so they are left out.
  const contacts = Object.values(crm?.contacts ?? {}).filter((c) => c.name || c.email || c.phone).sort((a, b) => a.lead_id.localeCompare(b.lead_id));
  const deals = [...(crm?.deals ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  const who = (d) => crm.contacts[d.lead_id] ?? {};
  const split = (c) => { const parts = String(c.name ?? '').split(/\s+/).filter(Boolean); return { first: c.first_name || parts[0] || '', last: c.last_name || parts.slice(1).join(' ') }; };
  if (format === 'hubspot' && kind === 'contacts') {
    const h = ['Record ID', 'First Name', 'Last Name', 'Email', 'Phone Number', 'Company Name', 'Job Title', 'Lifecycle Stage', 'Contact owner'];
    return toCsv(h, contacts.map((c) => { const { first, last } = split(c); return { 'Record ID': c.external?.hubspot ?? '', 'First Name': first, 'Last Name': last, Email: c.email ?? '', 'Phone Number': c.phone ?? '', 'Company Name': c.company, 'Job Title': c.title, 'Lifecycle Stage': HS_LIFE[c.funnel_stage] ?? '', 'Contact owner': c.owner }; }));
  }
  if (format === 'hubspot' && kind === 'deals') {
    const h = ['Record ID', 'Deal Name', 'Pipeline', 'Deal Stage', 'Amount', 'Currency', 'Close Date', 'Deal owner', 'Next step', 'Associated Contact Email', 'First Name', 'Last Name', 'Company Name'];
    return toCsv(h, deals.map((d) => { const c = who(d); const { first, last } = split(c); return { 'Record ID': d.external?.hubspot ?? '', 'Deal Name': d.title || `Deal ${d.id}`, Pipeline: 'Sales Pipeline', 'Deal Stage': HS_STAGE[d.stage], Amount: d.amount ?? '', Currency: d.currency ?? '', 'Close Date': d.close_date ?? '', 'Deal owner': d.owner, 'Next step': d.next_step, 'Associated Contact Email': c.email ?? '', 'First Name': first, 'Last Name': last, 'Company Name': c.company ?? '' }; }));
  }
  if (format === 'pipedrive' && kind === 'contacts') {
    const h = ['Person - ID', 'Person - Name', 'Person - Email', 'Person - Phone', 'Organization - Name', 'Person - Job title', 'Person - Owner'];
    return toCsv(h, contacts.map((c) => ({ 'Person - ID': c.external?.pipedrive ?? '', 'Person - Name': c.name, 'Person - Email': c.email ?? '', 'Person - Phone': c.phone ?? '', 'Organization - Name': c.company, 'Person - Job title': c.title, 'Person - Owner': c.owner })));
  }
  if (format === 'pipedrive' && kind === 'deals') {
    const h = ['Deal - ID', 'Deal - Title', 'Deal - Value', 'Deal - Currency', 'Deal - Stage', 'Deal - Status', 'Deal - Expected close date', 'Deal - Owner', 'Deal - Next activity subject', 'Person - Name', 'Person - Email', 'Person - Phone', 'Organization - Name'];
    return toCsv(h, deals.map((d) => { const c = who(d); return { 'Deal - ID': d.external?.pipedrive ?? '', 'Deal - Title': d.title || `Deal ${d.id}`, 'Deal - Value': d.amount ?? '', 'Deal - Currency': d.currency ?? '', 'Deal - Stage': PD_STAGE[d.stage], 'Deal - Status': d.stage === 'won' ? 'won' : d.stage === 'lost' ? 'lost' : 'open', 'Deal - Expected close date': d.close_date ?? '', 'Deal - Owner': d.owner, 'Deal - Next activity subject': d.next_step, 'Person - Name': c.name ?? '', 'Person - Email': c.email ?? '', 'Person - Phone': c.phone ?? '', 'Organization - Name': c.company ?? '' }; }));
  }
  throw new Error(`unknown export "${format} ${kind}" (hubspot|pipedrive, contacts|deals)`);
}

// Sorted, de-duplicated, stable output.
function normalizeCrm(crm) {
  for (const c of Object.values(crm.contacts)) { c.sources = [...new Set(c.sources ?? [])].sort(); if (c.aliases) c.aliases = [...new Set(c.aliases)].sort(); }
  crm.deals.sort((a, b) => a.id.localeCompare(b.id));
  return { ...crm, contacts: sortObj(crm.contacts) };
}

// --- Pipeline view --------------------------------------------------------------------------------
export function stageProbabilities(overrides = {}) {
  const out = { ...DEFAULT_PROBABILITY };
  for (const [k, v] of Object.entries(overrides && typeof overrides === 'object' ? overrides : {})) {
    const s = DEAL_STAGES.includes(k) ? k : dealStage(k);
    const p = cleanProbability(v);
    if (s && p != null && p !== undefined && OPEN_STAGES.includes(s)) out[s] = p; // won stays 1, lost stays 0
  }
  return out;
}
// Deals → stage totals, weighted forecast, close-month forecast, slipping deals. Pure. Amounts in another
// currency than the product's are listed apart, never converted with an invented rate.
export function pipelineView(crm, { now = new Date().toISOString(), currency = 'USD', probabilities = {} } = {}) {
  const prob = stageProbabilities(probabilities);
  const today = now.slice(0, 10);
  const deals = [...(crm?.deals ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  const contactOfDeal = (d) => crm.contacts?.[d.lead_id] ?? {};
  const consentOf = (d) => contactOfDeal(d).consent ?? 'unknown';
  const stages = Object.fromEntries(DEAL_STAGES.map((s) => [s, { stage: s, count: 0, amount: 0, probability: prob[s], weighted: 0, no_amount: 0 }]));
  const months = {}; const other = {};
  const slipping = []; const noNext = []; const noClose = [];
  for (const d of deals) {
    if (!DEAL_STAGES.includes(d.stage)) continue;
    const p = d.probability ?? prob[d.stage];
    const amt = Number(d.amount) || 0;
    const cur = d.currency ?? currency;
    const row = stages[d.stage];
    row.count++;
    if (d.amount == null) row.no_amount++;
    if (cur !== currency) { const o = (other[cur] ??= { currency: cur, count: 0, amount: 0, weighted: 0 }); o.count++; o.amount = round(o.amount + amt); if (OPEN_STAGES.includes(d.stage)) o.weighted = round(o.weighted + amt * p); continue; }
    row.amount = round(row.amount + amt);
    if (OPEN_STAGES.includes(d.stage)) {
      row.weighted = round(row.weighted + amt * p);
      const m = d.close_date ? d.close_date.slice(0, 7) : 'no date';
      const mm = (months[m] ??= { month: m, count: 0, amount: 0, weighted: 0 }); mm.count++; mm.amount = round(mm.amount + amt); mm.weighted = round(mm.weighted + amt * p);
    }
  }
  for (const d of deals.filter((x) => OPEN_STAGES.includes(x.stage))) {
    const brief = { id: d.id, lead_id: d.lead_id, title: d.title, stage: d.stage, amount: d.amount, currency: d.currency ?? currency, close_date: d.close_date, owner: d.owner, next_step: d.next_step, consent: consentOf(d), email_hash: contactOfDeal(d).email_hash ?? (contactOfDeal(d).email ? hash(contactOfDeal(d).email) : null), aliases: contactOfDeal(d).aliases ?? [] };
    if (d.close_date && d.close_date < today) slipping.push({ ...brief, days_late: Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d.close_date}T00:00:00Z`)) / 86400000) });
    if (!d.next_step) noNext.push(d.id);
    if (!d.close_date) noClose.push(d.id);
  }
  slipping.sort((a, b) => b.days_late - a.days_late || (b.amount ?? 0) - (a.amount ?? 0) || a.id.localeCompare(b.id));
  const open = OPEN_STAGES.map((s) => stages[s]);
  const won = stages.won; const lost = stages.lost;
  const closed = won.count + lost.count;
  return {
    updated_at: now, currency,
    stages: DEAL_STAGES.map((s) => stages[s]),
    totals: {
      deals: deals.length, contacts: Object.keys(crm?.contacts ?? {}).length,
      open_count: open.reduce((s, x) => s + x.count, 0), open_amount: round(open.reduce((s, x) => s + x.amount, 0)),
      weighted_forecast: round(open.reduce((s, x) => s + x.weighted, 0)),
      won_count: won.count, won_amount: won.amount, lost_count: lost.count, lost_amount: lost.amount,
      win_rate_pct: closed ? round((100 * won.count) / closed, 1) : null,
      slipping: slipping.length, slipping_amount: round(slipping.filter((x) => x.currency === currency).reduce((s, x) => s + (Number(x.amount) || 0), 0)),
      no_next_step: noNext.length, no_close_date: noClose.length,
    },
    by_close_month: Object.values(months).sort((a, b) => a.month.localeCompare(b.month)),
    other_currencies: Object.values(other).sort((a, b) => a.currency.localeCompare(b.currency)),
    slipping, no_next_step: noNext, no_close_date: noClose,
  };
}

// Follow-up proposals for slipping deals, as pending approvals. Only consented contacts with an address that
// are not on suppression.json (tools/inbox.mjs: {entries: [{email_hash, lead}]} or a bare array); nothing is sent.
export function followUpProposals(view, { suppression = null } = {}) {
  const sup = Array.isArray(suppression) ? suppression : Array.isArray(suppression?.entries) ? suppression.entries : [];
  const supHash = new Set(sup.map((e) => e?.email_hash).filter(Boolean));
  const supLead = new Set(sup.map((e) => e?.lead ?? e?.lead_id).filter(Boolean).map(String));
  const blocked = (s) => supLead.has(String(s.lead_id)) || (s.aliases ?? []).some((a) => supLead.has(String(a))) || Boolean(s.email_hash && supHash.has(s.email_hash));
  return (view?.slipping ?? []).filter((s) => ['opted-in', 'inbound'].includes(s.consent) && s.email_hash && !blocked(s)).map((s) => ({
    id: `A-CRM-${s.id}-${s.close_date}`, type: 'crm-follow-up', channel: 'email', file: 'crm/CRM.md', deal: s.id, lead: s.lead_id,
    title: `Follow up on deal ${s.title ? `"${clip(s.title, 60)}"` : s.id}: ${s.days_late} day(s) past its close date (${s.stage})`,
    detail: s.next_step ? `Next step on file: ${clip(s.next_step, 160)}` : 'No next step on file: set one, move the close date, or mark the deal lost.',
  }));
}

// Dashboard row: counts and amounts only, no names, ids, owners or emails.
export function crmState(slug, view, name = slug) {
  return { product: slug, name, currency: view.currency, updated_at: view.updated_at, totals: view.totals, stages: view.stages.map(({ stage, count, amount, probability, weighted }) => ({ stage, count, amount, probability, weighted })), by_close_month: view.by_close_month.slice(0, 12), other_currencies: view.other_currencies };
}

export function crmMarkdown(name, view) {
  const c = view.currency; const t = view.totals;
  const lines = [
    `# CRM pipeline: ${name}`, '', `Updated ${view.updated_at}. Amounts in ${c}; weighted = amount × stage probability.`, '',
    `- **Open:** ${t.open_count} deal(s), ${t.open_amount} ${c}; **weighted forecast:** ${t.weighted_forecast} ${c}`,
    `- **Won:** ${t.won_count} (${t.won_amount} ${c}); **lost:** ${t.lost_count}; **win rate:** ${t.win_rate_pct ?? '–'}%`,
    `- **Slipping past close date:** ${t.slipping} (${t.slipping_amount} ${c}); **no next step:** ${t.no_next_step}; **no close date:** ${t.no_close_date}`,
    '', '## Stages', '', '| Stage | Deals | Amount | Probability | Weighted |', '|---|---|---|---|---|',
    ...view.stages.map((s) => `| ${s.stage} | ${s.count} | ${s.amount} | ${Math.round(s.probability * 100)}% | ${s.weighted} |`),
    '', '## Forecast by close month', '', '| Month | Deals | Amount | Weighted |', '|---|---|---|---|',
    ...(view.by_close_month.length ? view.by_close_month.map((m) => `| ${m.month} | ${m.count} | ${m.amount} | ${m.weighted} |`) : ['| – | 0 | 0 | 0 |']),
    '', '## Slipping deals', '',
    ...(view.slipping.length ? view.slipping.slice(0, 30).map((s) => `- ${s.id}${s.title ? ` "${s.title}"` : ''} (${s.stage}, ${s.amount ?? '–'} ${s.currency}, owner ${s.owner || '–'}): ${s.days_late} day(s) past ${s.close_date}. Next step: ${s.next_step || '**none**'}`) : ['- None.']),
  ];
  if (view.other_currencies.length) lines.push('', '## Other currencies (not in the totals)', '', ...view.other_currencies.map((o) => `- ${o.currency}: ${o.count} deal(s), ${o.amount}, weighted ${o.weighted}`));
  return lines.join('\n') + '\n';
}

// --- Files ----------------------------------------------------------------------------------------
const readRowsFile = (file) => {
  const text = fs.readFileSync(file, 'utf8');
  if (/\.jsonl$/i.test(file)) return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return { _bad: true }; } });
  // JSON.parse messages quote the text, which can hold an address: report the file only.
  let j; try { j = JSON.parse(text); } catch { throw new Error('not valid JSON'); }
  return Array.isArray(j) ? j : (j.edits ?? (j && typeof j === 'object' ? [j] : []));
};
const stampOf = (now) => now.replace(/[^0-9]/g, '').slice(0, 14);
const productDir = (slug) => {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(String(slug ?? ''))) throw new Error(`bad product slug "${slug}"`);
  const dir = path.join(root, 'products', slug);
  const product = readJson(path.join(dir, 'product.json'), null);
  if (!product) throw new Error(`no product ${slug}`);
  return { dir, product };
};
const loadCrm = (cdir) => ({ contacts: readJson(path.join(cdir, 'contacts.json'), {}).contacts ?? {}, deals: readJson(path.join(cdir, 'deals.json'), {}).deals ?? [] });
const saveCrm = (cdir, crm, now) => {
  writeJson(path.join(cdir, 'contacts.json'), { version: 1, updated_at: now, contacts: crm.contacts });
  writeJson(path.join(cdir, 'deals.json'), { version: 1, updated_at: now, deals: crm.deals });
};
// Hands stage moves to the funnel and new people to its lead folder (both inside the product folder).
const handOff = (dir, { funnel_updates = [], leads = [] }, now, tag) => {
  const out = {};
  // Never overwrite a hand-off the funnel has not read yet.
  const fresh = (d, base) => { fs.mkdirSync(d, { recursive: true }); let f = path.join(d, `${base}.json`); for (let i = 2; fs.existsSync(f); i++) f = path.join(d, `${base}-${i}.json`); return f; };
  if (funnel_updates.length) { out.updates = fresh(path.join(dir, 'funnel', 'updates'), `crm-${tag}-${stampOf(now)}`); writeJson(out.updates, funnel_updates); }
  if (leads.length) { out.leads = fresh(path.join(dir, 'leads'), `crm-import-${tag}-${stampOf(now)}`); writeJson(out.leads, leads.map((l) => ({ ...l, at: now }))); }
  return out;
};

export function importFile(slug, file, { format, now = new Date().toISOString() } = {}) {
  const { dir, product } = productDir(slug);
  const cdir = path.join(dir, 'crm'); fs.mkdirSync(cdir, { recursive: true });
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  const fmt = format ?? detectFormat(Object.keys(rows[0] ?? {}));
  if (!fmt) throw new Error(`${path.basename(file)}: not a HubSpot or Pipedrive export (pass --format)`);
  const res = importRows(loadCrm(cdir), rows, { format: fmt, now, currency: product.budget?.currency ?? 'USD', file: path.basename(file) });
  saveCrm(cdir, res.crm, now);
  const files = handOff(dir, res, now, fmt);
  return { slug, file: path.basename(file), format: fmt, ...res.stats, funnel_updates: res.funnel_updates.length, new_funnel_leads: res.leads.length, files: Object.values(files).map((f) => path.relative(root, f).replace(/\\/g, '/')) };
}

export function exportFile(slug, format, kind = 'deals', { now = new Date().toISOString() } = {}) {
  const { dir } = productDir(slug);
  const cdir = path.join(dir, 'crm');
  const csv = exportCsv(loadCrm(cdir), format, kind);
  const out = path.join(cdir, 'exports', `${format}-${kind}-${now.slice(0, 10)}.csv`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, csv);
  return { slug, format, kind, rows: csv.split('\r\n').length - 2, file: path.relative(root, out).replace(/\\/g, '/') };
}

// One product: funnel sync, edits, drop-in imports, view, optional follow-up proposals. Returns a summary.
export function runCrm(slug, { now = new Date().toISOString(), propose = false } = {}) {
  const { dir, product } = productDir(slug);
  const currency = product.budget?.currency ?? 'USD';
  const cdir = path.join(dir, 'crm');
  for (const d of ['edits/done', 'imports/done']) fs.mkdirSync(path.join(cdir, d), { recursive: true });
  const errors = [];
  let crm = loadCrm(cdir);

  const pipeline = readJson(path.join(dir, 'funnel', 'pipeline.json'), { leads: [] });
  const logFile = path.join(dir, 'leads.jsonl');
  const leadLog = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
  const synced = syncFromFunnel(crm, pipeline, { leadLog, now, currency });
  crm = synced.crm;

  const imports = [];
  const impDir = path.join(cdir, 'imports');
  for (const f of fs.readdirSync(impDir).filter((x) => /\.csv$/i.test(x)).sort()) {
    try {
      const rows = parseCsv(fs.readFileSync(path.join(impDir, f), 'utf8'));
      const fmt = detectFormat(Object.keys(rows[0] ?? {}));
      if (!fmt) throw new Error('not a HubSpot or Pipedrive export');
      const res = importRows(crm, rows, { format: fmt, now, currency, file: f });
      crm = res.crm; handOff(dir, res, now, `${fmt}-${imports.length}`);
      imports.push({ file: f, format: fmt, ...res.stats });
    } catch (e) { errors.push(`${f}: ${e.message}`); }
    fs.renameSync(path.join(impDir, f), path.join(impDir, 'done', `${stampOf(now)}-${f}`));
  }

  const edits = [];
  const edDir = path.join(cdir, 'edits');
  const edFiles = fs.readdirSync(edDir).filter((x) => /\.(json|jsonl)$/i.test(x)).sort();
  for (const f of edFiles) {
    try { readRowsFile(path.join(edDir, f)).forEach((e, i) => edits.push(e && typeof e === 'object' && !Array.isArray(e) ? { ...e, _file: f, _row: i } : e)); } catch (e) { errors.push(`${f}: ${e.message}`); }
  }
  const ed = applyEdits(crm, edits.filter((e) => !e?._bad), { now, currency });
  crm = ed.crm;
  const bad = edits.filter((e) => e?._bad).length;
  if (bad) ed.rejected.push({ ref: 'jsonl', reason: `${bad} line(s) are not JSON` });
  handOff(dir, { funnel_updates: ed.funnel_updates }, now, 'edits');
  for (const f of edFiles) fs.renameSync(path.join(edDir, f), path.join(edDir, 'done', `${stampOf(now)}-${f}`));

  saveCrm(cdir, crm, now);
  const view = pipelineView(crm, { now, currency, probabilities: product.crm?.stage_probability });
  writeJson(path.join(cdir, 'pipeline.json'), { ...view, slipping: view.slipping.map(({ lead_id, email_hash, aliases, ...s }) => s), edit_errors: ed.rejected, import_errors: errors });
  fs.writeFileSync(path.join(cdir, 'CRM.md'), crmMarkdown(product.name ?? slug, view));

  let proposals = [];
  if (propose && product.stage !== 'paused') {
    proposals = followUpProposals(view, { suppression: readJson(path.join(dir, 'suppression.json'), null) });
    if (proposals.length) {
      const task_id = `CRM-${now.slice(0, 10)}`;
      fs.mkdirSync(path.join(dir, 'runs'), { recursive: true });
      writeJson(path.join(dir, 'runs', `${task_id}.json`), { task_id, agent: 'om-funnel-manager', status: 'done', output: ['crm/CRM.md', 'crm/pipeline.json'], summary: `CRM: ${view.totals.slipping} deal(s) past their close date; ${proposals.length} follow-up(s) proposed for consented contacts. Nothing sent.`, approvals: proposals });
    }
  }
  return { slug, ...synced.stats, imports, edits_applied: ed.applied, edits_rejected: ed.rejected.length, funnel_updates: ed.funnel_updates.length, totals: view.totals, proposals: proposals.length, errors };
}

export function writeCrmState(slugs) {
  const products = [];
  for (const slug of slugs) {
    const view = readJson(path.join(root, 'products', slug, 'crm', 'pipeline.json'), null);
    if (!view?.stages) continue;
    const p = readJson(path.join(root, 'products', slug, 'product.json'), {});
    products.push(crmState(slug, view, p.name ?? slug));
  }
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  writeJson(path.join(stateDir, 'crm.json'), products);
  return products.length;
}

const activeSlugs = () => {
  const dir = path.join(root, 'products');
  return (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((s) => !s.startsWith('_') && /^[a-z0-9-]+$/i.test(s) && fs.existsSync(path.join(dir, s, 'product.json')));
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1] === '--format'));
  const usage = 'Usage: node tools/crm.mjs <slug> [--propose] | import <slug> <file.csv> [--format hubspot|pipedrive] | export <slug> <hubspot|pipedrive> [contacts|deals] | --all';
  try {
    if (pos[0] === 'import') {
      if (!pos[1] || !pos[2]) throw new Error(usage);
      console.log(JSON.stringify(importFile(pos[1], path.resolve(pos[2]), { format: flag('--format') })));
    } else if (pos[0] === 'export') {
      if (!pos[1] || !pos[2]) throw new Error(usage);
      console.log(JSON.stringify(exportFile(pos[1], pos[2], pos[3] ?? 'deals')));
    } else if (argv.includes('--all')) {
      const slugs = activeSlugs().filter((s) => readJson(path.join(root, 'products', s, 'product.json'), {}).stage !== 'paused');
      const out = slugs.map((s) => { try { return runCrm(s, { propose: argv.includes('--propose') }); } catch (e) { return { slug: s, error: e.message }; } });
      console.log(JSON.stringify({ products: out.length, state: writeCrmState(activeSlugs()), results: out }));
    } else if (pos[0]) {
      console.log(JSON.stringify(runCrm(pos[0], { propose: argv.includes('--propose') })));
    } else throw new Error(usage);
  } catch (e) { console.error(e.message); process.exit(2); }
}
