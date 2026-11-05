// Creator and influencer management: one roster per product that follows every creator from first look
// to paid, with briefs, contract terms, deliverables, payouts and the results their codes brought in.
//   products/<slug>/creators/roster.json      the roster (single writer: this tool). One row per creator:
//                                              handle, platform, audience fit score, rate, status, codes,
//                                              briefs, contract, deliverables, outreach, payouts, history.
//   products/<slug>/creators/updates/*.json|jsonl  change requests. Agents (om-influencer-scout,
//                                              om-creator-program-manager, om-ugc-briefer …) and the owner
//                                              write them, never the roster. Moved to updates/done/ once read.
//   products/<slug>/creators/rejected.json    updates a guard refused, with the reason (last 200)
//   products/<slug>/creators/report.json      pipeline counts, overdue deliverables, payouts, per-creator
//                                              results (leads, sales, revenue, cost, ROAS)
//   products/<slug>/creators/CREATORS.md      the same report for people
//   products/<slug>/runs/CREATORS-<date>.json outreach and payout proposals as pending approvals plus alerts,
//                                              merged by tools/apply-results.mjs (this tool never writes
//                                              approvals.json and never sends or pays anything)
//   state/creators.json                       every product, no contact details (dashboard)
//
// Status pipeline: prospect → contacted → negotiating → contracted → content_live → paid. Side states
// declined and dropped can be reached from anywhere; a creator leaves them back to prospect or contacted.
// Moves are forward-only and gated:
//   contacted     needs an approved outreach approval, an inbound first contact (source "inbound") or the
//                 owner saying so (source "owner"); never for a creator marked do_not_contact.
//   contracted    needs a signed contract with usage rights, disclosure wording (#ad, "Paid partnership" …)
//                 and, when whitelisting is allowed, its duration and spend cap.
//   content_live  needs a live deliverable with its URL.
//   paid          needs every payout paid and none still waiting.
// Update ops (one JSON object each; creator = id like "cr-instagram-janedoe" or "handle@platform"):
//   {op:"upsert", creator:{handle, platform, name?, niche?, followers?, audience_fit? | fit:{audience_match,
//      niche_match, engagement_rate, brand_safety}, rate?, currency?, codes?, contact?{email?, phone?, dm?},
//      do_not_contact?, source?}}
//   {op:"status", creator, status, at?, source?, note?, approval_id?}
//   {op:"brief", creator, brief:{id?, title, goal, key_messages[], claims[] (verified ids from claims.md),
//      dos[], donts[], cta, due, file?}}
//   {op:"contract", creator, contract:{fee, currency, signed_at?, usage_rights:{scope, duration_days,
//      channels[]}, whitelisting:{allowed, duration_days, spend_cap}, disclosure:{wording, placement},
//      exclusivity_days?, payment_terms_days?, file?}}
//   {op:"deliverable", creator, deliverable:{id?, type, platform?, due, status, url?, disclosure_confirmed?,
//      posted_at?}}   status: planned | draft | submitted | approved | live
//   {op:"outreach", creator, file, summary?}            → pending "send" approval (channel creator-outreach)
//   {op:"payout", creator, payout:{id?, amount, currency?, for?[], note?}}  → pending "payout" approval
//   {op:"payout_paid", creator, payout_id, at?, ref?}   accepted only once its approval is approved/executed
// Money: a payout must fit the signed fee and product.json budget caps (monthly_cap counts ad spend so far
// plus creator payouts proposed or paid this month; daily_cap counts payouts proposed today). Over a cap it
// is refused with an alert; it never becomes an approval. Bulk outreach is capped at 10 proposals a run.
// Results: each creator's codes (UTM campaign, discount or referral codes) are matched against
// funnel/pipeline.json (first-touch campaign = lead, later touch = assisted), falling back to the campaign
// rows of funnel/report.json. Contact details stay in roster.json; reports and state carry none.
// Usage: node tools/creators.mjs <slug> [--now ISO]
//        node tools/creators.mjs --all            every active product, then state/creators.json
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, root as repoRoot } from './lib/env.mjs';

export const STATUSES = ['prospect', 'contacted', 'negotiating', 'contracted', 'content_live', 'paid'];
export const SIDE = ['declined', 'dropped'];
const RANK = Object.fromEntries(STATUSES.map((s, i) => [s, i]));
export const DELIVERABLE_STATUSES = ['planned', 'draft', 'submitted', 'approved', 'live'];
export const PLATFORMS = ['instagram', 'tiktok', 'youtube', 'x', 'linkedin', 'twitch', 'pinterest', 'facebook', 'threads', 'snapchat', 'podcast', 'newsletter', 'blog', 'reddit', 'other'];
export const AGENT = 'om-creator-program-manager';
export const MAX_OUTREACH_PER_RUN = 10;
const APPROVED = ['approved', 'approved-manual', 'executed', 'done'];
const REJECTED = ['rejected', 'denied', 'declined', 'failed'];

const STATUS_ALIASES = {
  prospect: ['prospect', 'new', 'shortlist', 'shortlisted', 'lead', 'found'],
  contacted: ['contacted', 'reached', 'reached_out', 'pitched', 'outreach_sent', 'dm_sent', 'emailed'],
  negotiating: ['negotiating', 'negotiation', 'replied', 'interested', 'talking', 'terms'],
  contracted: ['contracted', 'signed', 'agreed', 'booked'],
  content_live: ['content_live', 'live', 'posted', 'published', 'content'],
  paid: ['paid', 'settled', 'complete', 'completed'],
  declined: ['declined', 'no', 'rejected', 'not_interested', 'passed'],
  dropped: ['dropped', 'cancelled', 'canceled', 'removed', 'off'],
};
const STATUS_ALIAS = Object.fromEntries(Object.entries(STATUS_ALIASES).flatMap(([s, l]) => l.map((w) => [w, s])));
export const canonicalStatus = (s) => STATUS_ALIAS[String(s ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')] ?? null;

const PLATFORM_ALIASES = { ig: 'instagram', insta: 'instagram', tt: 'tiktok', yt: 'youtube', twitter: 'x', li: 'linkedin', fb: 'facebook', pod: 'podcast' };
export const canonicalPlatform = (p) => {
  const v = String(p ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
  const c = PLATFORM_ALIASES[v] ?? v;
  return PLATFORMS.includes(c) ? c : (c ? 'other' : null);
};
export const normalizeHandle = (h) => String(h ?? '').trim().replace(/^@+/, '').replace(/^https?:\/\/[^/]+\/@?/i, '').replace(/[/?#].*$/, '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 60);
export const creatorId = (platform, handle) => {
  const p = canonicalPlatform(platform); const h = normalizeHandle(handle);
  return p && h ? `cr-${p}-${h}` : null;
};

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 10);
const isoOk = (s) => typeof s === 'string' && s.length >= 10 && !Number.isNaN(Date.parse(s));
const iso = (s, d) => (isoOk(s) ? new Date(s).toISOString() : d);
const round = (n, d = 2) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
const clamp01 = (x) => { const n = num(x); return n == null ? null : Math.min(1, Math.max(0, n)); };
const str = (x, max = 200) => (x == null ? '' : String(x).trim().slice(0, max));
const strList = (x, max = 20, len = 200) => (Array.isArray(x) ? x : x == null || x === '' ? [] : [x]).map((v) => str(v, len)).filter(Boolean).slice(0, max);
const cur = (x, d) => (/^[A-Za-z]{3}$/.test(String(x ?? '')) ? String(x).toUpperCase() : d);
const codeOf = (c) => String(c ?? '').trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').slice(0, 60);
const safeRel = (f) => { const v = str(f, 300).replace(/\\/g, '/'); return v && !v.startsWith('/') && !/^[a-z]:/i.test(v) && !v.split('/').includes('..') ? v : null; };

// Verified claim ids from claims.md (the "| C1 | text | verified | source |" table).
export function verifiedClaims(md) {
  const ids = new Set();
  for (const line of String(md ?? '').split(/\r?\n/)) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length >= 5 && /^C\d+$/i.test(cells[1]) && cells[3].toLowerCase() === 'verified') ids.add(cells[1].toUpperCase());
  }
  return ids;
}

// Audience fit 0-100. A given audience_fit wins; otherwise weighted from the fit parts (each 0-1;
// engagement_rate is a share, 6 % or more counts as full marks). Returns null when nothing is known.
export function fitScore(c = {}) {
  const given = num(c.audience_fit);
  if (given != null) return Math.round(Math.min(100, Math.max(0, given)));
  const f = c.fit ?? {};
  const parts = [[clamp01(f.audience_match), 40], [clamp01(f.niche_match), 25], [f.engagement_rate == null ? null : Math.min(1, Math.max(0, Number(f.engagement_rate) / 0.06)), 20], [clamp01(f.brand_safety), 15]].filter(([v]) => v != null && Number.isFinite(v));
  if (!parts.length) return null;
  const w = parts.reduce((s, [, x]) => s + x, 0);
  return Math.round((100 * parts.reduce((s, [v, x]) => s + v * x, 0)) / w);
}

// FTC (16 CFR 255) and ASA/CAP: the label must say plainly it is an ad. Vague tags alone do not count.
const DISCLOSURE_OK = /(#ad\b|(^|\s)ad(\s|$)|#advert|advertisement|sponsored|paid partnership|#gifted|\bgifted\b|in partnership with|#partner\b)/i;
export function validateContract(k, budget = {}) {
  const problems = []; const warnings = [];
  if (!k || typeof k !== 'object') return { ok: false, problems: ['no contract'], warnings };
  const fee = num(k.fee);
  if (fee == null || fee < 0) problems.push('fee must be a number of 0 or more');
  const u = k.usage_rights;
  if (!u || typeof u !== 'object') problems.push('usage_rights missing');
  else {
    if (!['organic', 'paid', 'both'].includes(String(u.scope ?? '').toLowerCase())) problems.push('usage_rights.scope must be organic, paid or both');
    if (u.duration_days === 'perpetual') warnings.push('usage rights are perpetual; check the fee covers it');
    else if (!(num(u.duration_days) > 0)) problems.push('usage_rights.duration_days must be more than 0 (or "perpetual")');
  }
  const d = k.disclosure;
  if (!d || !str(d.wording)) problems.push('disclosure wording missing');
  else if (!DISCLOSURE_OK.test(String(d.wording))) problems.push(`disclosure wording "${str(d.wording, 60)}" is not a clear ad label (use #ad, "Ad", "Sponsored" or "Paid partnership")`);
  const w = k.whitelisting;
  if (w?.allowed === true) {
    if (!(num(w.duration_days) > 0)) problems.push('whitelisting.duration_days must be more than 0 when whitelisting is allowed');
    if (num(w.spend_cap) == null || num(w.spend_cap) < 0) problems.push('whitelisting.spend_cap must be set when whitelisting is allowed');
    else if (num(budget.monthly_cap) != null && num(w.spend_cap) > num(budget.monthly_cap)) warnings.push(`whitelisting spend_cap ${w.spend_cap} is over monthly_cap ${budget.monthly_cap}; ad spend stays capped by product.json`);
  }
  return { ok: problems.length === 0, problems, warnings };
}

const cleanContract = (k, currency) => ({
  fee: round(num(k.fee) ?? 0), currency: cur(k.currency, currency), signed_at: iso(k.signed_at, null),
  usage_rights: { scope: String(k.usage_rights?.scope ?? '').toLowerCase(), duration_days: k.usage_rights?.duration_days === 'perpetual' ? 'perpetual' : num(k.usage_rights?.duration_days), channels: strList(k.usage_rights?.channels, 12, 40) },
  whitelisting: { allowed: k.whitelisting?.allowed === true, duration_days: num(k.whitelisting?.duration_days), spend_cap: num(k.whitelisting?.spend_cap) },
  disclosure: { wording: str(k.disclosure?.wording, 120), placement: str(k.disclosure?.placement, 120) || 'start of caption and on screen' },
  exclusivity_days: num(k.exclusivity_days) ?? 0, payment_terms_days: num(k.payment_terms_days) ?? 30, file: safeRel(k.file),
});

const cleanContact = (c) => {
  if (!c || typeof c !== 'object') return {};
  const out = {};
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(c.email ?? '').trim())) out.email = String(c.email).trim();
  if (/^[+()\d\s.-]{6,24}$/.test(String(c.phone ?? '').trim())) out.phone = String(c.phone).trim();
  if (c.dm === true || c.dm === 'true') out.dm = true;
  if (str(c.agent)) out.agent = str(c.agent, 120);
  return out;
};

const monthOf = (s) => String(s ?? '').slice(0, 7);
const dayOf = (s) => String(s ?? '').slice(0, 10);

// Creator payouts that count against this month's and today's cap: proposed, approved or paid.
export function committedPayouts(creators, now) {
  let month = 0; let day = 0;
  for (const c of creators) for (const p of c.payouts ?? []) {
    if (!['proposed', 'approved', 'paid'].includes(p.status)) continue;
    const at = p.paid_at ?? p.proposed_at;
    if (monthOf(at) === monthOf(now)) month += Number(p.amount) || 0;
    // Daily cap counts every payout proposed today, also one already paid (no propose-pay-propose loop).
    if (dayOf(p.proposed_at) === dayOf(now) || (p.status === 'paid' && dayOf(p.paid_at) === dayOf(now))) day += Number(p.amount) || 0;
  }
  return { month: round(month), day: round(day) };
}

// Merges updates into the roster. Pure: the caller reads and writes files.
// ctx: {now, claims: Set of verified claim ids, approvals: approvals.json rows, budget: product.json budget,
//       currency}. Returns {roster, stats, rejected, approvals (proposals), alerts}.
export function mergeCreators(roster = {}, updates = [], ctx = {}) {
  const now = iso(ctx.now, new Date().toISOString());
  const budget = ctx.budget ?? {};
  const currency = cur(ctx.currency ?? budget.currency, 'USD');
  const claims = ctx.claims instanceof Set ? ctx.claims : new Set(ctx.claims ?? []);
  const approvalsById = new Map((Array.isArray(ctx.approvals) ? ctx.approvals : []).filter((a) => a && a.id).map((a) => [a.id, a]));
  const creators = (Array.isArray(roster.creators) ? roster.creators : []).map((c) => structuredClone(c));
  const byId = new Map(creators.map((c) => [c.id, c]));
  const stats = { updates_in: 0, applied: 0, rejected: 0, new_creators: 0, proposals: 0 };
  const rejected = []; const proposals = []; const alerts = [];
  let outreachThisRun = 0;
  const refuse = (u, why) => { stats.rejected++; rejected.push({ at: now, op: u?.op ?? null, creator: typeof u?.creator === 'string' ? u.creator : (u?.creator?.handle ?? null), reason: why }); };
  const find = (ref) => {
    if (!ref) return null;
    if (typeof ref === 'string') {
      if (byId.has(ref)) return byId.get(ref);
      const m = ref.match(/^@?([^@\s]+)@([a-z]+)$/i);
      return m ? byId.get(creatorId(m[2], m[1])) ?? null : null;
    }
    if (typeof ref === 'object') return byId.get(ref.id) ?? byId.get(creatorId(ref.platform, ref.handle)) ?? null;
    return null;
  };
  const log = (c, entry) => { (c.history ??= []).push({ at: now, ...entry }); c.updated_at = now; };
  const approvalState = (id) => { const a = id && approvalsById.get(id); return !a ? 'missing' : APPROVED.includes(a.status) ? 'approved' : REJECTED.includes(a.status) ? 'rejected' : 'pending'; };

  // Apply approval decisions to what this tool proposed earlier: outreach and payouts follow their approval.
  for (const c of creators) {
    for (const o of c.outreach ?? []) { const s = approvalState(o.approval_id); if (o.status === 'proposed' && s !== 'pending' && s !== 'missing') o.status = s; }
    for (const p of c.payouts ?? []) { const s = approvalState(p.approval_id); if (p.status === 'proposed' && s === 'approved') p.status = 'approved'; if (['proposed', 'approved'].includes(p.status) && s === 'rejected') p.status = 'rejected'; }
  }

  const withdrawOutreach = (c, why) => {
    for (const o of c.outreach ?? []) {
      if (o.status !== 'proposed') continue;
      o.status = 'withdrawn'; o.withdrawn_at = now;
      alerts.push({ level: 'decision', title: `Reject creator outreach ${o.approval_id}: ${c.handle} (${c.platform})`, detail: `Outreach ${o.approval_id} is still waiting for approval but ${why}. Reject it in approvals.json; do not send it.` });
    }
  };
  for (const c of creators) if (c.do_not_contact) withdrawOutreach(c, 'creator is marked do_not_contact');
  for (const c of creators) if (SIDE.includes(c.status)) withdrawOutreach(c, `the creator is ${c.status}`);

  const gate = (c, target, u) => {
    const rank = RANK[target];
    if ((rank >= RANK.contacted && c.status === 'prospect') || (SIDE.includes(c.status) && target === 'contacted')) {
      if (c.do_not_contact) return 'creator is marked do_not_contact';
      const src = String(u.source ?? '').toLowerCase();
      const viaApproval = u.approval_id ? approvalState(u.approval_id) === 'approved' : (c.outreach ?? []).some((o) => o.status === 'approved');
      if (!viaApproval && !['owner', 'inbound'].includes(src)) return 'first contact needs an approved outreach approval, source "inbound" or source "owner"';
    }
    if (rank >= RANK.contracted) {
      if (!c.contract) return 'no contract on file';
      const v = validateContract(c.contract, budget);
      if (!v.ok) return `contract incomplete: ${v.problems.join('; ')}`;
      if (!c.contract.signed_at) return 'contract is not signed (signed_at missing)';
    }
    if (rank >= RANK.content_live && !(c.deliverables ?? []).some((d) => d.status === 'live' && d.url)) return 'no live deliverable with a URL';
    if (rank >= RANK.paid) {
      const ps = (c.payouts ?? []).filter((p) => p.status !== 'rejected');
      if (!ps.some((p) => p.status === 'paid')) return 'no payout recorded as paid';
      if (ps.some((p) => p.status !== 'paid')) return 'payouts still waiting for approval or payment';
    }
    return null;
  };

  const sorted = (Array.isArray(updates) ? updates : []).map((u, i) => ({ u, i })).sort((a, b) => String(a.u?.at ?? '').localeCompare(String(b.u?.at ?? '')) || a.i - b.i).map((x) => x.u);
  for (const u of sorted) {
    stats.updates_in++;
    if (!u || typeof u !== 'object' || Array.isArray(u)) { refuse(u, 'update is not an object'); continue; }
    const op = String(u.op ?? '').toLowerCase();
    try {
      if (op === 'upsert') {
        const x = u.creator;
        if (!x || typeof x !== 'object') { refuse(u, 'upsert needs a creator object'); continue; }
        const id = creatorId(x.platform, x.handle);
        if (!id) { refuse(u, 'creator needs a handle and a platform'); continue; }
        let c = byId.get(id);
        if (!c) {
          c = { id, handle: normalizeHandle(x.handle), platform: canonicalPlatform(x.platform), status: 'prospect', status_at: now, added_at: now, source: str(x.source, 80) || 'update', codes: [], briefs: [], deliverables: [], outreach: [], payouts: [], history: [{ at: now, status: 'prospect', source: str(x.source, 80) || 'update' }] };
          creators.push(c); byId.set(id, c); stats.new_creators++;
        }
        if (x.name != null) c.name = str(x.name, 80);
        if (x.niche != null) c.niche = str(x.niche, 80);
        if (num(x.followers) != null && num(x.followers) >= 0) c.followers = Math.round(num(x.followers));
        if (x.fit && typeof x.fit === 'object') c.fit = { audience_match: clamp01(x.fit.audience_match), niche_match: clamp01(x.fit.niche_match), engagement_rate: num(x.fit.engagement_rate), brand_safety: clamp01(x.fit.brand_safety) };
        if (num(x.audience_fit) != null) c.audience_fit = Math.round(Math.min(100, Math.max(0, num(x.audience_fit))));
        c.fit_score = fitScore(c);
        if (num(x.rate) != null && num(x.rate) >= 0) { c.rate = round(num(x.rate)); c.rate_currency = cur(x.currency, c.rate_currency ?? currency); }
        if (x.codes != null) c.codes = [...new Set([...(c.codes ?? []), ...strList(x.codes, 20, 60).map(codeOf).filter(Boolean)])].sort();
        if (x.do_not_contact != null) c.do_not_contact = x.do_not_contact === true || x.do_not_contact === 'true';
        if (c.do_not_contact) {
          // Opt-out: contact details are erased (only a suppression stamp is kept) and outreach still
          // waiting for approval is withdrawn; the owner must reject the open approval.
          if (c.contact && Object.keys(c.contact).length) { c.contact = {}; c.contact_erased_at = now; }
          withdrawOutreach(c, 'creator is marked do_not_contact');
        } else if (x.contact) c.contact = { ...(c.contact ?? {}), ...cleanContact(x.contact) };
        c.updated_at = now;
        stats.applied++; continue;
      }
      const c = find(u.creator);
      if (!c) { refuse(u, 'unknown creator (add it with op "upsert" first)'); continue; }

      if (op === 'status') {
        const target = canonicalStatus(u.status);
        if (!target) { refuse(u, `unknown status "${str(u.status, 30)}"`); continue; }
        if (target === c.status) continue;
        if (SIDE.includes(target)) { c.status = target; c.status_at = iso(u.at, now); withdrawOutreach(c, `the creator is now ${target}`); log(c, { status: target, source: str(u.source, 40) || 'update', note: str(u.note) || undefined }); stats.applied++; continue; }
        const from = SIDE.includes(c.status) ? -1 : RANK[c.status];
        if (SIDE.includes(c.status) && RANK[target] > RANK.contacted) { refuse(u, `a ${c.status} creator goes back to prospect or contacted first`); continue; }
        if (!SIDE.includes(c.status) && RANK[target] <= from) { refuse(u, `already ${c.status}; statuses only move forward`); continue; }
        const why = gate(c, target, u);
        if (why) { refuse(u, why); continue; }
        c.status = target; c.status_at = iso(u.at, now);
        log(c, { status: target, source: str(u.source, 40) || 'update', note: str(u.note) || undefined, approval_id: str(u.approval_id, 40) || undefined });
        stats.applied++; continue;
      }

      if (op === 'brief') {
        const b = u.brief;
        if (!b || typeof b !== 'object' || !str(b.title) || !str(b.goal)) { refuse(u, 'brief needs a title and a goal'); continue; }
        const used = strList(b.claims, 20, 10).map((x) => x.toUpperCase());
        const bad = used.filter((x) => !claims.has(x));
        if (bad.length) { refuse(u, `brief uses claims not verified in claims.md: ${bad.join(', ')}`); continue; }
        const id = str(b.id, 40) || `BR-${hash(`${c.id}|${b.title}`)}`;
        const brief = { id, title: str(b.title, 120), goal: str(b.goal, 300), key_messages: strList(b.key_messages, 8, 200), claims: used, dos: strList(b.dos, 10), donts: strList(b.donts, 10), cta: str(b.cta, 160), due: iso(b.due, null), file: safeRel(b.file), updated_at: now };
        c.briefs = [...(c.briefs ?? []).filter((x) => x.id !== id), brief].sort((a, z) => a.id.localeCompare(z.id));
        log(c, { op: 'brief', brief: id }); stats.applied++; continue;
      }

      if (op === 'contract') {
        const k = u.contract;
        const v = validateContract(k, budget);
        if (!v.ok) { refuse(u, `contract refused: ${v.problems.join('; ')}`); continue; }
        if (c.contract?.signed_at && (c.payouts ?? []).some((p) => ['approved', 'paid'].includes(p.status)) && num(k.fee) < (c.contract.fee ?? 0)) { refuse(u, 'fee cannot drop below a signed fee with payouts already approved or paid'); continue; }
        const open = (c.payouts ?? []).filter((p) => p.status !== 'rejected');
        if (open.length && cur(k.currency, c.contract?.currency ?? currency) !== (c.contract?.currency ?? currency)) { refuse(u, 'contract currency cannot change while payouts exist'); continue; }
        if (open.length && round(open.reduce((s, p) => s + (Number(p.amount) || 0), 0)) > round(num(k.fee))) { refuse(u, 'new fee is below the payouts already proposed or paid'); continue; }
        if (c.contract?.signed_at && !isoOk(k.signed_at) && RANK[c.status] >= RANK.contracted) { refuse(u, `an unsigned contract cannot replace the signed one of a ${c.status} creator`); continue; }
        c.contract = cleanContract(k, c.contract?.currency ?? currency);
        for (const w of v.warnings) alerts.push({ level: 'warning', title: `Creator contract: ${c.handle} (${c.platform})`, detail: w });
        log(c, { op: 'contract', fee: c.contract.fee, signed: Boolean(c.contract.signed_at) }); stats.applied++; continue;
      }

      if (op === 'deliverable') {
        const d = u.deliverable;
        if (!d || typeof d !== 'object' || !str(d.type)) { refuse(u, 'deliverable needs a type'); continue; }
        const status = String(d.status ?? 'planned').toLowerCase();
        if (!DELIVERABLE_STATUSES.includes(status)) { refuse(u, `deliverable status must be one of ${DELIVERABLE_STATUSES.join(', ')}`); continue; }
        if (status === 'live' && !/^https?:\/\//i.test(String(d.url ?? ''))) { refuse(u, 'a live deliverable needs its URL'); continue; }
        if (['approved', 'live'].includes(status) && !c.contract?.signed_at) { refuse(u, 'content goes approved or live only under a signed contract'); continue; }
        const id = str(d.id, 40) || `DL-${hash(`${c.id}|${d.type}|${d.due ?? ''}|${(c.deliverables ?? []).length}`)}`;
        const prev = (c.deliverables ?? []).find((x) => x.id === id);
        const item = { ...(prev ?? {}), id, type: str(d.type, 60), platform: canonicalPlatform(d.platform ?? c.platform), due: iso(d.due, prev?.due ?? null), status, url: /^https?:\/\//i.test(String(d.url ?? '')) ? str(d.url, 300) : (prev?.url ?? null), disclosure_confirmed: d.disclosure_confirmed === true || (prev?.disclosure_confirmed === true && d.disclosure_confirmed !== false), posted_at: status === 'live' ? iso(d.posted_at, prev?.posted_at ?? now) : null, updated_at: now };
        c.deliverables = [...(c.deliverables ?? []).filter((x) => x.id !== id), item].sort((a, z) => String(a.due ?? '').localeCompare(String(z.due ?? '')) || a.id.localeCompare(z.id));
        if (status === 'live' && !item.disclosure_confirmed) alerts.push({ level: 'warning', title: `Disclosure not confirmed: ${c.handle} (${c.platform})`, detail: `Deliverable ${id} is live at ${item.url} but nobody confirmed the ad label "${c.contract?.disclosure?.wording ?? ''}" is visible. Check it and record disclosure_confirmed.` });
        log(c, { op: 'deliverable', deliverable: id, status }); stats.applied++; continue;
      }

      if (op === 'outreach') {
        const file = safeRel(u.file);
        if (c.do_not_contact) { refuse(u, 'creator is marked do_not_contact'); continue; }
        if (!file) { refuse(u, 'outreach needs the draft file (relative path inside the product folder)'); continue; }
        if (!['prospect', 'contacted', 'negotiating'].includes(c.status)) { refuse(u, `no cold outreach to a ${c.status} creator`); continue; }
        if (!c.contact?.email && !c.contact?.dm && !c.contact?.agent) { refuse(u, 'no business contact on file (public business email, open DMs or an agent)'); continue; }
        const open = (c.outreach ?? []).filter((o) => o.status === 'proposed').length;
        if (open) { refuse(u, 'an outreach message is already waiting for approval'); continue; }
        if ((c.outreach ?? []).filter((o) => o.status !== 'rejected').length >= 3) { refuse(u, 'three messages already; no more follow-ups without a reply'); continue; }
        if (outreachThisRun >= MAX_OUTREACH_PER_RUN) { refuse(u, `more than ${MAX_OUTREACH_PER_RUN} outreach messages in one run (no bulk DMs)`); continue; }
        const id = `CRO-${hash(`${c.id}|${file}`)}`;
        if ((c.outreach ?? []).some((o) => o.approval_id === id)) { refuse(u, 'this draft was already proposed'); continue; }
        (c.outreach ??= []).push({ approval_id: id, file, summary: str(u.summary, 200), proposed_at: now, status: 'proposed' });
        proposals.push({ id, type: 'send', channel: 'creator-outreach', title: `Creator outreach: ${c.handle} (${c.platform})`, file, target: `${c.handle}@${c.platform}` });
        outreachThisRun++; stats.proposals++;
        log(c, { op: 'outreach', approval_id: id }); stats.applied++; continue;
      }

      if (op === 'payout') {
        const p = u.payout ?? {};
        const amount = round(num(p.amount));
        const k = c.contract;
        if (!(amount > 0)) { refuse(u, 'payout amount must be more than 0'); continue; }
        if (!k?.signed_at) { refuse(u, 'no payout without a signed contract'); continue; }
        if (RANK[c.status] == null || RANK[c.status] < RANK.contracted) { refuse(u, `no payout while the creator is ${c.status}`); continue; }
        const pc = cur(p.currency, k.currency);
        if (pc !== k.currency) { refuse(u, `payout currency ${pc} differs from the contract currency ${k.currency}`); continue; }
        const committed = (c.payouts ?? []).filter((x) => x.status !== 'rejected').reduce((s, x) => s + (Number(x.amount) || 0), 0);
        if (round(committed + amount) > k.fee) { refuse(u, `payout ${amount} plus ${round(committed)} already committed is over the contract fee ${k.fee}`); continue; }
        if (pc !== cur(budget.currency, currency)) { refuse(u, `payout currency ${pc} differs from the budget currency ${cur(budget.currency, currency)}; caps cannot be checked`); continue; }
        const monthly = num(budget.monthly_cap) ?? 0; const daily = num(budget.daily_cap) ?? 0;
        const spent = num(budget.spent_this_month) ?? 0;
        const used = committedPayouts(creators, now);
        const why = spent + used.month + amount > monthly ? `spent ${round(spent)} + creator payouts ${used.month} + ${amount} is over monthly_cap ${monthly}`
          : daily > 0 && used.day + amount > daily ? `creator payouts today ${used.day} + ${amount} is over daily_cap ${daily}` : null;
        if (why) {
          refuse(u, `over budget: ${why}`);
          alerts.push({ level: 'decision', title: `Creator payout held: ${c.handle} (${c.platform})`, detail: `A payout of ${amount} ${pc} was not proposed: ${why}. Only the owner can raise a cap in product.json.` });
          continue;
        }
        const id = str(p.id, 40) || `PO-${hash(`${c.id}|${amount}|${(c.payouts ?? []).length}`)}`;
        if ((c.payouts ?? []).some((x) => x.id === id)) { refuse(u, `payout ${id} exists already`); continue; }
        const approval_id = `CRP-${hash(`${c.id}|${id}`)}`;
        (c.payouts ??= []).push({ id, amount, currency: pc, for: strList(p.for, 10, 40), note: str(p.note), proposed_at: now, status: 'proposed', approval_id });
        proposals.push({ id: approval_id, type: 'payout', channel: 'creator-payout', amount, currency: pc, title: `Pay creator ${c.handle} (${c.platform}): ${amount} ${pc}`, file: `creators/roster.json#${c.id}/${id}`, target: `${c.handle}@${c.platform}` });
        stats.proposals++;
        log(c, { op: 'payout', payout: id, amount, approval_id }); stats.applied++; continue;
      }

      if (op === 'payout_paid') {
        const p = (c.payouts ?? []).find((x) => x.id === u.payout_id);
        if (!p) { refuse(u, `unknown payout "${str(u.payout_id, 40)}"`); continue; }
        if (p.status === 'paid') continue;
        const s = approvalState(p.approval_id);
        if (s !== 'approved') { refuse(u, `payout ${p.id} is not approved (approval ${p.approval_id} is ${s})`); continue; }
        p.status = 'paid'; p.paid_at = iso(u.at, now); if (str(u.ref)) p.ref = str(u.ref, 80);
        log(c, { op: 'payout_paid', payout: p.id }); stats.applied++; continue;
      }

      refuse(u, `unknown op "${str(op, 30)}"`);
    } catch (e) { refuse(u, `error: ${e.message}`); }
  }

  creators.sort((a, b) => a.id.localeCompare(b.id));
  return { roster: { ...roster, updated_at: now, creators }, stats, rejected, approvals: proposals, alerts };
}

// Per-creator results from the funnel. A lead belongs to the creator whose code matches its first-touch
// campaign; a code on a later touch counts as assisted. A code claimed by two creators goes to the first id.
export function creatorResults(creators = [], { pipeline = null, report = null } = {}) {
  const owner = new Map(); const conflicts = [];
  for (const c of [...creators].sort((a, b) => a.id.localeCompare(b.id))) for (const code of c.codes ?? []) {
    if (owner.has(code) && owner.get(code) !== c.id) conflicts.push({ code, kept: owner.get(code), also: c.id });
    else owner.set(code, c.id);
  }
  const res = Object.fromEntries(creators.map((c) => [c.id, { leads: 0, assisted: 0, won: 0, revenue: 0, source: null }]));
  const rows = Array.isArray(pipeline?.leads) ? pipeline.leads : null;
  if (rows) {
    for (const r of rows) {
      if (r?.suspected_bot) continue;
      const first = codeOf(r.campaign ?? r.touches?.[0]?.campaign);
      const wonRow = (r.history ?? []).some((h) => h.stage === 'won');
      const fid = first && owner.get(first);
      if (fid && res[fid]) { const x = res[fid]; x.leads++; x.source = 'pipeline'; if (wonRow) { x.won++; x.revenue = round(x.revenue + (Number(r.value) || 0)); } continue; }
      const later = new Set((r.touches ?? []).slice(1).map((t) => owner.get(codeOf(t.campaign))).filter(Boolean));
      for (const id of later) if (res[id]) { res[id].assisted++; res[id].source = 'pipeline'; }
    }
  } else if (Array.isArray(report?.campaigns)) {
    for (const row of report.campaigns) {
      const id = owner.get(codeOf(row.campaign));
      if (!id || !res[id]) continue;
      const x = res[id]; x.leads += Number(row.leads) || 0; x.won += Number(row.won) || 0; x.revenue = round(x.revenue + (Number(row.revenue) || 0)); x.source = 'report';
    }
  }
  for (const c of creators) {
    const x = res[c.id];
    x.cost = round((c.payouts ?? []).filter((p) => p.status === 'paid').reduce((s, p) => s + (Number(p.amount) || 0), 0));
    x.cost_per_lead = x.leads && x.cost ? round(x.cost / x.leads) : null;
    x.roas = x.cost ? round(x.revenue / x.cost) : null;
  }
  return { results: res, conflicts };
}

// The report: no contact details, deterministic order.
export function creatorsReport(roster = {}, { now = new Date().toISOString(), pipeline = null, funnelReport = null, currency = 'USD' } = {}) {
  const creators = Array.isArray(roster.creators) ? roster.creators : [];
  const { results, conflicts } = creatorResults(creators, { pipeline, report: funnelReport });
  const counts = Object.fromEntries([...STATUSES, ...SIDE].map((s) => [s, 0]));
  for (const c of creators) if (counts[c.status] != null) counts[c.status]++;
  const overdue = []; const undisclosed = [];
  const payouts = { proposed: 0, approved: 0, paid: 0, rejected: 0, paid_this_month: 0 };
  for (const c of creators) {
    for (const d of c.deliverables ?? []) {
      if (d.status !== 'live' && d.due && Date.parse(d.due) < Date.parse(now) && !SIDE.includes(c.status)) overdue.push({ creator: c.id, deliverable: d.id, type: d.type, due: d.due, status: d.status, days_late: Math.floor((Date.parse(now) - Date.parse(d.due)) / 86400000) });
      if (d.status === 'live' && !d.disclosure_confirmed) undisclosed.push({ creator: c.id, deliverable: d.id, url: d.url });
    }
    for (const p of c.payouts ?? []) {
      if (payouts[p.status] != null) payouts[p.status] = round(payouts[p.status] + (Number(p.amount) || 0));
      if (p.status === 'paid' && monthOf(p.paid_at) === monthOf(now)) payouts.paid_this_month = round(payouts.paid_this_month + (Number(p.amount) || 0));
    }
  }
  overdue.sort((a, b) => a.due.localeCompare(b.due) || a.creator.localeCompare(b.creator));
  const rows = creators.map((c) => ({
    id: c.id, handle: c.handle, platform: c.platform, name: c.name ?? '', niche: c.niche ?? '', followers: c.followers ?? null,
    fit_score: c.fit_score ?? fitScore(c), rate: c.rate ?? null, status: c.status, status_at: c.status_at, do_not_contact: Boolean(c.do_not_contact),
    codes: c.codes ?? [], briefs: (c.briefs ?? []).length, contract: c.contract ? { fee: c.contract.fee, currency: c.contract.currency, signed: Boolean(c.contract.signed_at), usage: c.contract.usage_rights?.scope, whitelisting: c.contract.whitelisting?.allowed === true, disclosure: c.contract.disclosure?.wording } : null,
    deliverables: { total: (c.deliverables ?? []).length, live: (c.deliverables ?? []).filter((d) => d.status === 'live').length },
    waiting_approval: (c.outreach ?? []).filter((o) => o.status === 'proposed').length + (c.payouts ?? []).filter((p) => p.status === 'proposed').length,
    results: results[c.id],
  })).sort((a, b) => (b.results.revenue - a.results.revenue) || (b.results.leads - a.results.leads) || ((b.fit_score ?? -1) - (a.fit_score ?? -1)) || a.id.localeCompare(b.id));
  const sum = (k) => round(rows.reduce((s, r) => s + (Number(r.results[k]) || 0), 0));
  const totals = { creators: creators.length, active: creators.filter((c) => !SIDE.includes(c.status)).length, live: counts.content_live + counts.paid, leads: sum('leads'), won: sum('won'), revenue: sum('revenue'), cost: sum('cost') };
  totals.roas = totals.cost ? round(totals.revenue / totals.cost) : null;
  return { updated_at: now, currency, totals, pipeline: STATUSES.map((s) => ({ status: s, count: counts[s] })), side: SIDE.map((s) => ({ status: s, count: counts[s] })), payouts, overdue, undisclosed, code_conflicts: conflicts, creators: rows };
}

export function renderMarkdown(rep, name = '') {
  const t = rep.totals;
  return [
    `# Creators${name ? `: ${name}` : ''}`, '', `Updated ${rep.updated_at}. ${t.creators} creator(s), ${t.active} active, ${t.live} with content live. Leads ${t.leads}, sales ${t.won}, revenue ${t.revenue} ${rep.currency}, paid out ${t.cost} ${rep.currency}${t.roas != null ? `, ROAS ${t.roas}` : ''}.`, '',
    '## Pipeline', '', rep.pipeline.map((p) => `${p.status} ${p.count}`).join(' → ') + `  (declined ${rep.side[0].count}, dropped ${rep.side[1].count})`, '',
    '## Creators', '', '| creator | platform | fit | status | fee | live | leads | sales | revenue | cost | ROAS |', '|---|---|---|---|---|---|---|---|---|---|---|',
    ...(rep.creators.length ? rep.creators.map((c) => `| ${c.handle} | ${c.platform} | ${c.fit_score ?? '–'} | ${c.status}${c.do_not_contact ? ' (do not contact)' : ''} | ${c.contract ? `${c.contract.fee} ${c.contract.currency}${c.contract.signed ? '' : ' unsigned'}` : '–'} | ${c.deliverables.live}/${c.deliverables.total} | ${c.results.leads} | ${c.results.won} | ${c.results.revenue} | ${c.results.cost} | ${c.results.roas ?? '–'} |`) : ['| – | | | | | | | | | | |']),
    '', '## Payouts', '', `Proposed ${rep.payouts.proposed}, approved ${rep.payouts.approved}, paid ${rep.payouts.paid} (this month ${rep.payouts.paid_this_month}), rejected ${rep.payouts.rejected}. Payouts are approvals; nothing is paid by this tool.`,
    '', '## Overdue deliverables', '', ...(rep.overdue.length ? rep.overdue.map((d) => `- ${d.creator}: ${d.type} (${d.deliverable}) due ${d.due.slice(0, 10)}, ${d.days_late} day(s) late, ${d.status}`) : ['- None.']),
    '', '## Live without a confirmed ad label', '', ...(rep.undisclosed.length ? rep.undisclosed.map((d) => `- ${d.creator}: ${d.url}`) : ['- None.']),
    ...(rep.code_conflicts.length ? ['', '## Code conflicts', '', ...rep.code_conflicts.map((x) => `- ${x.code}: credited to ${x.kept}, also on ${x.also}`)] : []), '',
  ].join('\n');
}

const readUpdates = (dir) => {
  if (!fs.existsSync(dir)) return { updates: [], files: [], errors: [], bad: [] };
  const files = fs.readdirSync(dir).filter((f) => /\.(json|jsonl)$/i.test(f) && fs.statSync(path.join(dir, f)).isFile()).sort();
  const updates = []; const errors = []; const bad = [];
  for (const f of files) {
    try {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      if (/\.jsonl$/i.test(f)) { for (const l of text.split(/\r?\n/)) if (l.trim()) { try { updates.push(JSON.parse(l)); } catch { errors.push(`${f}: bad line`); } } } else { const j = JSON.parse(text); updates.push(...(Array.isArray(j) ? j : (j.updates ?? [j]))); }
    } catch { errors.push(`${f}: not valid JSON`); bad.push(f); }
  }
  return { updates, files, errors, bad };
};

// One product: read, merge, report, propose. opts: {now, root} (root lets tests use a temp folder).
export function runCreators(slug, opts = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(String(slug ?? ''))) throw new Error(`bad product slug "${slug}"`);
  const base = opts.root ?? repoRoot;
  const now = iso(opts.now, new Date().toISOString());
  const dir = path.join(base, 'products', slug);
  const product = readJson(path.join(dir, 'product.json'), null);
  if (!product) throw new Error(`no products/${slug}/product.json`);
  const cdir = path.join(dir, 'creators');
  fs.mkdirSync(cdir, { recursive: true });
  const rosterFile = path.join(cdir, 'roster.json');
  // A roster that exists but does not parse is never overwritten (that would drop every creator).
  let roster = { creators: [] };
  if (fs.existsSync(rosterFile)) {
    const text = fs.readFileSync(rosterFile, 'utf8');
    if (text.trim()) {
      try { roster = JSON.parse(text); } catch (e) { throw new Error(`creators/roster.json does not parse (${e.message}); fix it, nothing was changed`); }
      if (!roster || typeof roster !== 'object' || Array.isArray(roster) || (roster.creators != null && !Array.isArray(roster.creators))) throw new Error('creators/roster.json has no creators list; fix it, nothing was changed');
    }
  }
  const { updates, files, errors, bad } = readUpdates(path.join(cdir, 'updates'));
  const claims = verifiedClaims(fs.existsSync(path.join(dir, 'claims.md')) ? fs.readFileSync(path.join(dir, 'claims.md'), 'utf8') : '');
  const approvals = readJson(path.join(dir, 'approvals.json'), []);
  const budget = product.budget ?? {};
  const merged = mergeCreators(roster, updates, { now, claims, approvals, budget, currency: budget.currency });
  writeJson(rosterFile, merged.roster);
  if (files.length) {
    // Read files go to done/, files that did not parse at all to failed/ (kept for the owner to fix).
    const stamp = now.replace(/[:.]/g, '-');
    for (const f of files) {
      const to = path.join(cdir, 'updates', bad.includes(f) ? 'failed' : 'done');
      fs.mkdirSync(to, { recursive: true });
      fs.renameSync(path.join(cdir, 'updates', f), path.join(to, `${stamp}-${f}`));
    }
  }
  if (merged.rejected.length) {
    const rf = path.join(cdir, 'rejected.json');
    const prev = readJson(rf, []);
    writeJson(rf, [...(Array.isArray(prev) ? prev : []), ...merged.rejected].slice(-200));
  }
  const report = creatorsReport(merged.roster, { now, pipeline: readJson(path.join(dir, 'funnel', 'pipeline.json'), null), funnelReport: readJson(path.join(dir, 'funnel', 'report.json'), null), currency: cur(budget.currency, 'USD') });
  writeJson(path.join(cdir, 'report.json'), report);
  fs.writeFileSync(path.join(cdir, 'CREATORS.md'), renderMarkdown(report, product.name ?? slug));
  const alerts = [...merged.alerts];
  if (errors.length) alerts.push({ level: 'warning', title: `${errors.length} creator update(s) could not be read`, detail: `${errors.slice(0, 5).join('; ').slice(0, 400)}. Unreadable files are in creators/updates/failed/.` });
  if (report.overdue.length) alerts.push({ level: 'warning', title: `${report.overdue.length} creator deliverable(s) overdue`, detail: report.overdue.slice(0, 5).map((d) => `${d.creator} ${d.type} due ${d.due.slice(0, 10)}`).join('; ') });
  if (report.code_conflicts.length) alerts.push({ level: 'warning', title: 'Creator tracking code used twice', detail: report.code_conflicts.map((x) => `${x.code}: ${x.kept} and ${x.also}`).join('; ') });
  let runFile = null;
  if (merged.approvals.length || alerts.length) {
    const task_id = `CREATORS-${now.slice(0, 10)}`;
    runFile = path.join(dir, 'runs', `${task_id}.json`);
    fs.mkdirSync(path.dirname(runFile), { recursive: true });
    const prev = readJson(runFile, null);
    const seen = new Set((prev?.approvals ?? []).map((a) => a.id));
    const seenAlerts = new Set((prev?.alerts ?? []).map((a) => `${a.title}|${a.detail}`));
    writeJson(runFile, {
      task_id, agent: AGENT, status: 'done', output: ['creators/roster.json', 'creators/report.json', 'creators/CREATORS.md'],
      summary: `Creators: ${report.totals.creators} on the roster, ${merged.stats.applied} update(s) applied, ${merged.stats.rejected} refused, ${merged.approvals.length} proposal(s) waiting for approval.`,
      approvals: [...(prev?.approvals ?? []), ...merged.approvals.filter((a) => !seen.has(a.id))],
      alerts: [...(prev?.alerts ?? []), ...alerts.filter((a) => !seenAlerts.has(`${a.title}|${a.detail}`))],
    });
  }
  return { slug, ...merged.stats, read_errors: errors, totals: report.totals, overdue: report.overdue.length, run_file: runFile ? path.relative(base, runFile).replace(/\\/g, '/') : null };
}

// Every product's report for the dashboard: handles and numbers only, never contact details.
export function writeCreatorsState(slugs, opts = {}) {
  const base = opts.root ?? repoRoot;
  const products = [];
  for (const slug of slugs) {
    const rep = readJson(path.join(base, 'products', slug, 'creators', 'report.json'), null);
    if (!rep) continue;
    const p = readJson(path.join(base, 'products', slug, 'product.json'), {});
    products.push({ product: slug, name: p.name ?? slug, currency: rep.currency, updated_at: rep.updated_at, totals: rep.totals, pipeline: rep.pipeline, payouts: rep.payouts, overdue: rep.overdue.length, undisclosed: rep.undisclosed.length,
      creators: rep.creators.slice(0, 25).map((c) => ({ id: c.id, handle: c.handle, platform: c.platform, fit_score: c.fit_score, status: c.status, results: c.results })) });
  }
  fs.mkdirSync(path.join(base, 'state'), { recursive: true });
  writeJson(path.join(base, 'state', 'creators.json'), { updated_at: iso(opts.now, new Date().toISOString()), products });
  return products.length;
}

const activeSlugs = (base) => {
  const dir = path.join(base, 'products');
  return (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((s) => !s.startsWith('_') && /^[a-z0-9-]+$/i.test(s) && fs.existsSync(path.join(dir, s, 'product.json')) && readJson(path.join(dir, s, 'product.json'), {}).stage !== 'paused');
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const ni = argv.indexOf('--now');
  const now = ni > -1 ? argv[ni + 1] : undefined;
  const all = argv.includes('--all');
  const slugs = all ? activeSlugs(repoRoot) : argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--now').slice(0, 1);
  if (!slugs.length) { console.error('Usage: node tools/creators.mjs <slug> [--now ISO] | --all'); process.exit(2); }
  const out = [];
  for (const s of slugs) { try { out.push(runCreators(s, { now })); } catch (e) { out.push({ slug: s, error: e.message }); } }
  if (all) writeCreatorsState(slugs, { now });
  console.log(JSON.stringify(all ? { products: out.length, results: out } : out[0]));
  if (!all && out[0]?.error) process.exit(1);
}
