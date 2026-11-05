// Autonomous multi-step sequences: email, SMS, WhatsApp and LinkedIn tasks, per lead, driven by the funnel.
// A sequence is a trigger (funnel stage, optional channel and segment), a list of steps (delay, channel,
// template in outbox/, quiet hours, max per day) and stop rules. This runner never sends anything: every
// step that is due becomes a pending "send" approval proposal, and policy (tools/policy.mjs) and earned
// autonomy (tools/lib/earned.mjs) decide what goes out without a click.
//   products/<slug>/sequences/*.json         definitions (owner or agents write them; one sequence per file)
//   products/<slug>/funnel/pipeline.json     the lead ledger (tools/funnel.mjs, read only here)
//   products/<slug>/approvals.json           read only: did the previous step go out, or was it rejected?
//   products/<slug>/funnel/sequence-state.json  enrolments, step history, stop reasons (single writer: this tool)
//   products/<slug>/runs/SEQ-<date>.json      the proposals, merged into approvals.json by apply-results.mjs
//   state/sequences.json                      counts per product and sequence (no personal data), --all only
//
// Sequence file shape (products/<slug>/sequences/<id>.json):
//   { id?, name?, enabled?: true, agent?, timezone?, quiet_hours?: {start: 21, end: 8}, max_per_day?,
//     consent?: ["opted-in", "inbound"], allow_reentry?: false, stale_hours?: 168,
//     enroll_within_hours?: 720, enroll_existing?: false,   (no back-fill of leads that reached the stage long ago)
//     trigger: { stage: "new" | [...], channel?: "organic" | [...], segment?: "trial" | [...] },
//     stop?: ["reply", "won", "lost", "unsubscribe", "no_consent"],
//     steps: [{ delay_hours, channel: "email"|"sms"|"whatsapp"|"linkedin", template: "sequences/x.md",
//               quiet_hours?, max_per_day?, title?, cost? }] }
// product.json "sequences" (all optional): { enabled, agent, timezone, quiet_hours, stale_hours,
//   caps: { per_day: 1, per_week: 3, min_gap_hours: 20 } }   frequency caps per lead across all sequences.
//
// Guards, in order: paused product or sequences.enabled=false → nothing; "unknown" consent never enters a
// sequence; SMS and WhatsApp need "opted-in" whatever the sequence says; a channel missing from
// product.json channels.enabled is skipped; unsubscribe, complaint and withdrawn consent stop every
// sequence for that lead; reply / won / lost stop the sequence (won and lost are ignored by sequences that
// trigger on them); a step waits until the previous one was executed, and a rejected step stops the
// sequence; quiet hours defer; per-step, per-sequence and per-lead caps defer; a step with a cost needs a
// paid budget and stays inside daily_cap and monthly_cap. Stopped or expired enrolments whose approval is
// still open raise an alert so the owner rejects it, and suppressCheck() lets the executor drop it.
// Personal data: only funnel lead ids are used; contact details stay in leads.jsonl.
// Usage: node tools/sequences.mjs <slug> [--now ISO] [--dry-run]
//        node tools/sequences.mjs --all [--now ISO]        every active product, then state/sequences.json
//        node tools/sequences.mjs validate <slug>          check the definitions and templates only
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, root as repoRoot } from './lib/env.mjs';
import { STAGES, SIDE, canonicalStage } from './funnel.mjs';

export const CHANNELS = ['email', 'sms', 'whatsapp', 'linkedin'];
export const STOP_RULES = ['reply', 'won', 'lost', 'unsubscribe', 'no_consent'];
// Rules the owner cannot switch off.
const ALWAYS_STOP = ['unsubscribe', 'no_consent'];
// Consent a lead needs per channel. SMS and WhatsApp need prior express opt-in (TCPA, WhatsApp policy).
const CHANNEL_CONSENT = { email: ['opted-in', 'inbound'], sms: ['opted-in'], whatsapp: ['opted-in'], linkedin: ['opted-in', 'inbound'] };
const HARD_OPT_IN = new Set(['sms', 'whatsapp']);
// product.json channels.enabled words that switch each sequence channel on.
const CHANNEL_SWITCH = { email: ['email', 'lifecycle', 'newsletter'], sms: ['sms'], whatsapp: ['whatsapp'], linkedin: ['linkedin', 'social'] };
export const DEFAULT_CAPS = { per_day: 1, per_week: 3, min_gap_hours: 20 };
export const DEFAULT_QUIET = { start: 21, end: 8 };
const DEFAULT_STALE_HOURS = 168;
const WITHDRAWN = new Set(['withdrawn', 'unsubscribed', 'opted-out', 'opt-out', 'revoked', 'none', 'no']);
const UNSUB_RE = /unsub|opt[\s_-]?out|\bstop\b|complain|spam|do[\s_-]?not[\s_-]?contact/i;
const REPLY_RE = /\brepl(y|ied|ies)\b/i;
const RANKS = Object.fromEntries(STAGES.map((s, i) => [s, i]));
const OPEN = new Set(['pending', 'auto-approved', 'approved', 'approved-manual']);
const DEAD = new Set(['rejected', 'failed', 'error', 'cancelled', 'canceled', 'withdrawn', 'blocked', 'skipped-free-mode', 'suppressed']);
// Statuses that mean the step went out: executed by a connector, or handed to the owner as a manual task
// (tools/execute.mjs sets "approved-manual" for LinkedIn and for items with no connector).
const DONE = new Set(['executed', 'approved-manual']);
// Funnel history the system wrote itself (the executor logs each send with its title): never a reply or
// an unsubscribe, even when a step title says "reply" or "stop".
const OWN_SOURCES = new Set(['om-executor']);
// Leads that entered the trigger stage longer ago than this are not back-filled (enroll_existing: true does).
const DEFAULT_ENROLL_WITHIN_HOURS = 720;

const HOUR = 3600000;
const isoOk = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));
const list = (x) => (x == null || x === '' ? [] : (Array.isArray(x) ? x : [x])).map((v) => String(v).trim().toLowerCase()).filter(Boolean);
const num = (x, d) => (Number.isFinite(Number(x)) && x !== null && x !== '' ? Number(x) : d);
const safeId = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
const dayOf = (iso) => new Date(iso).toISOString().slice(0, 10);
const round2 = (n) => Math.round(n * 100) / 100;
const hash8 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 8);
// A lead id safe for titles and alerts: an id that looks like an email or a phone number is hashed.
export const leadRef = (id) => { const s = String(id ?? ''); return /^[A-Za-z0-9_-]{1,40}$/.test(s) && !/\d{7,}/.test(s) ? s : `lead#${hash8(s)}`; };
const ownEntry = (h) => OWN_SOURCES.has(String(h?.source ?? '').toLowerCase());

// The local hour of an instant in a time zone; an unknown zone falls back to UTC.
export function hourIn(iso, tz = 'UTC') {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(iso));
    return Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  } catch { return new Date(iso).getUTCHours(); }
}

// Quiet hours {start, end} in local hours (0-23). start > end wraps midnight; start == end means none.
export function inQuietHours(iso, quiet, tz) {
  if (!quiet || quiet === false) return false;
  const start = num(quiet.start, null); const end = num(quiet.end, null);
  if (start == null || end == null || start === end) return false;
  const h = hourIn(iso, quiet.tz ?? tz);
  return start > end ? h >= start || h < end : h >= start && h < end;
}

// A template path inside outbox/, or null when it points anywhere else.
export function templateFile(t) {
  if (typeof t !== 'string' || !t.trim()) return null;
  const rel = path.posix.normalize(t.trim().replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/^outbox\//, ''));
  if (!rel || rel === '.' || rel.startsWith('..') || rel.startsWith('/') || rel.includes(':') || rel.split('/').includes('..')) return null;
  return `outbox/${rel}`;
}

// Checks and normalises one definition. templateExists(file) is injected (pure; tests pass a stub).
export function validateSequence(def, { fallbackId = 'sequence', templateExists = () => true } = {}) {
  const errors = [];
  if (!def || typeof def !== 'object' || Array.isArray(def)) return { ok: false, errors: ['definition is not an object'], sequence: null };
  const id = safeId(def.id ?? fallbackId) || safeId(fallbackId) || 'sequence';
  const stages = list(def.trigger?.stage).map((s) => canonicalStage(s) ?? (SIDE.includes(s) ? s : null));
  if (!def.trigger || typeof def.trigger !== 'object') errors.push('trigger is missing');
  else if (!stages.length) errors.push('trigger.stage is missing');
  else if (stages.some((s) => !s)) errors.push(`trigger.stage has an unknown stage (${list(def.trigger.stage).join(', ')})`);
  const steps = Array.isArray(def.steps) ? def.steps : [];
  if (!steps.length) errors.push('steps is empty');
  const outSteps = steps.map((s, i) => {
    const where = `step ${i + 1}`;
    if (!s || typeof s !== 'object') { errors.push(`${where} is not an object`); return null; }
    const channel = String(s.channel ?? '').trim().toLowerCase();
    if (!CHANNELS.includes(channel)) errors.push(`${where}: channel "${s.channel ?? ''}" is not one of ${CHANNELS.join(', ')}`);
    const delay = num(s.delay_hours, 0);
    if (delay < 0) errors.push(`${where}: delay_hours is negative`);
    const file = templateFile(s.template);
    if (!file) errors.push(`${where}: template must be a file inside outbox/`);
    else if (!templateExists(file)) errors.push(`${where}: template ${file} does not exist`);
    const cost = num(s.cost, 0);
    if (cost < 0) errors.push(`${where}: cost is negative`);
    const maxDay = s.max_per_day == null ? null : num(s.max_per_day, null);
    if (maxDay != null && maxDay < 0) errors.push(`${where}: max_per_day is negative`);
    return { index: i, channel, delay_hours: Math.max(0, delay), template: file ? file.slice('outbox/'.length) : null, file, quiet_hours: s.quiet_hours, max_per_day: maxDay, title: s.title ? String(s.title).slice(0, 80) : null, cost: Math.max(0, cost) };
  });
  const stop = new Set([...(def.stop == null ? STOP_RULES : list(def.stop)), ...ALWAYS_STOP]);
  for (const r of stop) if (!STOP_RULES.includes(r)) errors.push(`stop rule "${r}" is unknown`);
  const consent = def.consent == null ? null : list(def.consent).filter((c) => c !== 'unknown');
  const sequence = {
    id, name: String(def.name ?? id).slice(0, 80), enabled: def.enabled !== false, agent: def.agent ?? null,
    timezone: def.timezone ?? null, quiet_hours: def.quiet_hours, max_per_day: def.max_per_day == null ? null : num(def.max_per_day, null),
    consent, allow_reentry: def.allow_reentry === true, stale_hours: num(def.stale_hours, null),
    enroll_existing: def.enroll_existing === true, enroll_within_hours: num(def.enroll_within_hours, null),
    trigger: { stages: stages.filter(Boolean), channels: list(def.trigger?.channel), segments: list(def.trigger?.segment) },
    stop: [...stop].filter((r) => STOP_RULES.includes(r)).sort(), steps: outSteps,
  };
  return { ok: errors.length === 0, errors, sequence: errors.length ? null : sequence };
}

// Consent this lead has for one channel: lead.channel_consent[channel] wins over lead.consent.
const consentFor = (lead, channel) => String(lead.channel_consent?.[channel] ?? lead.consent ?? 'unknown').toLowerCase();
const consentOk = (lead, channel, seq) => {
  const c = consentFor(lead, channel);
  if (c === 'unknown' || WITHDRAWN.has(c)) return false;
  const allowed = HARD_OPT_IN.has(channel) ? ['opted-in'] : (seq.consent?.length ? seq.consent : CHANNEL_CONSENT[channel]);
  return allowed.includes(c);
};
const channelEnabled = (product, channel) => {
  const on = product?.channels?.enabled;
  if (!Array.isArray(on)) return true;
  const words = new Set(on.map((w) => String(w).toLowerCase()));
  return CHANNEL_SWITCH[channel].some((w) => words.has(w));
};

// Lead-wide stop: unsubscribed, complained, consent withdrawn or unknown. Applies to every sequence.
export function globalStop(lead) {
  const c = String(lead.consent ?? 'unknown').toLowerCase();
  if (lead.unsubscribed === true || WITHDRAWN.has(c)) return 'unsubscribe';
  if (lead.lost_reason && UNSUB_RE.test(lead.lost_reason)) return 'unsubscribe';
  if ((Array.isArray(lead.history) ? lead.history : []).some((h) => h && !ownEntry(h) && UNSUB_RE.test(`${h.reason ?? ''} ${h.note ?? ''} ${h.source ?? ''}`))) return 'unsubscribe';
  if (c === 'unknown') return 'no_consent';
  if (lead.suspected_bot) return 'suspected_bot';
  return null;
}

// Sequence stop for one enrolment: reply, won, lost (when the sequence's rules include them).
export function sequenceStop(lead, seq, enr) {
  const since = Date.parse(enr.enrolled_at);
  const startRank = RANKS[enr.stage_at_start] ?? -1;
  const after = (Array.isArray(lead.history) ? lead.history : []).filter((h) => h && isoOk(h.at) && Date.parse(h.at) > since && h.note !== 'kept: already further along');
  if (seq.stop.includes('won') && !seq.trigger.stages.includes('won') && lead.stage === 'won') return 'won';
  if (seq.stop.includes('lost') && !seq.trigger.stages.includes('lost') && lead.stage === 'lost') return 'lost';
  if (seq.stop.includes('reply')) {
    const replied = after.some((h) => (RANKS[h.stage] ?? -1) >= Math.max(startRank + 1, RANKS.engaged) || (!ownEntry(h) && REPLY_RE.test(`${h.reason ?? ''} ${h.note ?? ''} ${h.source ?? ''}`)))
      || [lead.replied_at, lead.last_reply_at].some((t) => isoOk(t) && Date.parse(t) > since);
    if (replied) return 'reply';
  }
  return null;
}

const matchesTrigger = (lead, seq) => {
  const t = seq.trigger;
  if (!t.stages.includes(String(lead.stage ?? '').toLowerCase())) return false;
  if (t.channels.length && !t.channels.some((c) => [lead.channel, lead.last_channel].map((x) => String(x ?? '').toLowerCase()).includes(c))) return false;
  if (t.segments.length) {
    const have = [lead.segment, ...(Array.isArray(lead.segments) ? lead.segments : []), lead.form, lead.campaign].map((x) => String(x ?? '').toLowerCase()).filter(Boolean);
    if (!t.segments.some((s) => have.includes(s))) return false;
  }
  return true;
};

// Every proposal ever made for a lead (all sequences), for the per-lead frequency caps.
const proposalsOf = (state, leadId) => Object.values(state.enrollments?.[leadId] ?? {}).flatMap((e) => e.history ?? []).filter((h) => isoOk(h.proposed_at));

// The pure planner. Returns the next state and the approvals to propose; reads nothing from disk.
//   pipeline  funnel/pipeline.json ({leads: []})     sequences  validated definitions (validateSequence)
//   state     funnel/sequence-state.json             approvals  approvals.json (statuses of earlier steps)
//   product   product.json                           now        ISO time (deterministic in tests)
export function planSequences({ pipeline, sequences = [], state = {}, approvals = [], product = {}, now = new Date().toISOString() } = {}) {
  if (!isoOk(now)) throw new Error('now must be an ISO date');
  const cfg = product?.sequences && typeof product.sequences === 'object' ? product.sequences : {};
  const caps = { ...DEFAULT_CAPS, ...(cfg.caps ?? {}) };
  const stats = { leads: 0, enrolled: 0, proposed: 0, stopped: 0, completed: 0, waiting_approval: 0, deferred_quiet: 0, deferred_cap: 0, skipped_consent: 0, skipped_channel: 0, skipped_budget: 0, expired: 0, not_due: 0 };
  const out = { state: { version: 1, updated_at: now, enrollments: {} }, approvals: [], alerts: [], skipped: [], stats, errors: [] };
  if (product?.stage === 'paused' || cfg.enabled === false) { out.state = { ...state, version: 1, updated_at: now, enrollments: state.enrollments ?? {} }; out.paused = true; return out; }

  const nowMs = Date.parse(now); const today = dayOf(now);
  const enrollments = structuredClone(state.enrollments ?? {});
  out.state.enrollments = enrollments;
  const byId = new Map((Array.isArray(approvals) ? approvals : []).filter((a) => a && a.id).map((a) => [a.id, a]));
  const seqs = [...sequences].filter((s) => s && s.enabled).sort((a, b) => a.id.localeCompare(b.id));
  const leads = [...(Array.isArray(pipeline?.leads) ? pipeline.leads : [])].filter((l) => l && l.id).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const budget = product?.budget ?? {};
  const currency = budget.currency ?? 'USD';
  const agentFor = (seq) => seq.agent ?? cfg.agent ?? 'om-email-nurture';
  const tzFor = (lead, seq) => lead.timezone ?? lead.tz ?? seq.timezone ?? cfg.timezone ?? product?.timezone ?? 'UTC';
  const staleFor = (seq) => num(seq.stale_hours, num(cfg.stale_hours, DEFAULT_STALE_HOURS));
  const skip = (lead, seq, reason) => { if (out.skipped.length < 500) out.skipped.push({ lead: lead.id, sequence: seq.id, reason }); };
  const openAlert = (enr, lead, seq, why) => {
    const ap = enr.pending ? byId.get(enr.pending.approval_id) : null;
    if (enr.pending && (!ap || OPEN.has(ap.status ?? 'pending'))) out.alerts.push({ level: 'warning', title: `Reject sequence step ${enr.pending.approval_id}`, detail: `Lead ${leadRef(lead.id)} in "${seq.name}" ${why}; the open send approval ${enr.pending.approval_id} must not go out.` });
  };
  const stopEnr = (enr, reason, lead, seq) => { openAlert(enr, lead, seq, `stopped (${reason})`); enr.status = 'stopped'; enr.stop_reason = reason; enr.stopped_at = now; enr.pending = null; stats.stopped++; };

  // 1. Settle what happened since the last run (previous step executed or rejected) and apply stop rules.
  const candidates = [];
  for (const lead of leads) {
    stats.leads++;
    const g = globalStop(lead);
    const mine = (enrollments[lead.id] ??= {});
    for (const seq of seqs) {
      let enr = mine[seq.id];
      // A hand-edited or truncated state file: drop what cannot be an enrolment, repair the rest.
      if (enr && (typeof enr !== 'object' || Array.isArray(enr))) { delete mine[seq.id]; enr = undefined; }
      if (enr) { if (!Array.isArray(enr.history)) enr.history = []; if (!Number.isInteger(enr.step) || enr.step < 0) enr.step = 0; if (!isoOk(enr.enrolled_at)) enr.enrolled_at = now; }
      if (enr?.pending && (typeof enr.pending !== 'object' || !enr.pending.approval_id)) enr.pending = null;
      if (enr && enr.status === 'active') {
        if (enr.pending) {
          const ap = byId.get(enr.pending.approval_id);
          const st = ap?.status ?? 'pending';
          const h = enr.history.find((x) => x.approval_id === enr.pending.approval_id);
          if (!isoOk(enr.pending.proposed_at)) enr.pending.proposed_at = now;
          if (DONE.has(st)) {
            const at = [ap.executed_at, ap.decided_at].find(isoOk) ?? now;
            if (h) { h.status = 'sent'; h.sent_at = at; }
            enr.last_sent_at = at; enr.step = enr.pending.step + 1; enr.pending = null;
          } else if (DEAD.has(st)) {
            if (h) h.status = st;
            enr.pending = null; enr.status = 'stopped'; enr.stop_reason = st === 'rejected' ? 'rejected_by_owner' : `approval_${st}`; enr.stopped_at = now; stats.stopped++;
            continue;
          } else if (nowMs - Date.parse(enr.pending.proposed_at) > staleFor(seq) * HOUR) {
            openAlert(enr, lead, seq, `waited more than ${staleFor(seq)} h for approval`);
            if (h) h.status = 'expired';
            enr.pending = null; enr.status = 'expired'; enr.stopped_at = now; stats.expired++;
            continue;
          }
        }
        const why = g ?? sequenceStop(lead, seq, enr);
        if (why) { stopEnr(enr, why, lead, seq); continue; }
        if (enr.pending) { stats.waiting_approval++; continue; }
        if (enr.step >= seq.steps.length) { enr.status = 'completed'; enr.completed_at = now; stats.completed++; continue; }
      } else {
        // 2. Enrolment: the lead matches the trigger now, has consent, and was not in this sequence before.
        if (g || !matchesTrigger(lead, seq)) { if (g && matchesTrigger(lead, seq) && !enr) skip(lead, seq, g); continue; }
        // No back-fill: a lead that entered the trigger stage long before this run is not enrolled now
        // (HubSpot / Klaviyo enrol on the trigger event), unless the sequence says enroll_existing.
        const within = num(seq.enroll_within_hours, num(cfg.enroll_within_hours, DEFAULT_ENROLL_WITHIN_HOURS));
        if (!enr && !seq.enroll_existing && isoOk(lead.stage_at) && nowMs - Date.parse(lead.stage_at) > within * HOUR) { skip(lead, seq, 'entered_stage_before_window'); continue; }
        if (enr && !(seq.allow_reentry && ['completed', 'stopped', 'expired'].includes(enr.status) && !['unsubscribe', 'no_consent', 'rejected_by_owner'].includes(enr.stop_reason))) continue;
        if (!seq.steps.some((s) => consentOk(lead, s.channel, seq))) { skip(lead, seq, 'no_consent'); stats.skipped_consent++; continue; }
        enr = mine[seq.id] = { sequence: seq.id, status: 'active', enrolled_at: now, stage_at_start: lead.stage, step: 0, last_sent_at: null, pending: null, history: [], runs: (enr?.runs ?? 0) + 1 };
        stats.enrolled++;
      }
      // Skip steps this lead cannot receive (consent per channel, channel switched off), then check timing.
      while (enr.step < seq.steps.length) {
        const s = seq.steps[enr.step];
        if (!consentOk(lead, s.channel, seq)) { enr.history.push({ step: enr.step, status: 'skipped_consent', at: now }); stats.skipped_consent++; enr.step++; continue; }
        if (!channelEnabled(product, s.channel)) { enr.history.push({ step: enr.step, status: 'skipped_channel', at: now }); stats.skipped_channel++; enr.step++; continue; }
        break;
      }
      if (enr.step >= seq.steps.length) { enr.status = 'completed'; enr.completed_at = now; stats.completed++; continue; }
      const step = seq.steps[enr.step];
      const from = enr.step === 0 || !enr.last_sent_at ? enr.enrolled_at : enr.last_sent_at;
      const due = Date.parse(from) + step.delay_hours * HOUR;
      if (due > nowMs) { stats.not_due++; continue; }
      candidates.push({ lead, seq, enr, step, due });
    }
    if (!Object.keys(mine).length) delete enrollments[lead.id];
  }

  // 3. Propose, oldest due first, inside quiet hours, volume caps, per-lead frequency caps and budget.
  candidates.sort((a, b) => a.due - b.due || String(a.lead.id).localeCompare(String(b.lead.id)) || a.seq.id.localeCompare(b.seq.id));
  const countToday = (pred) => Object.values(enrollments).flatMap((m) => Object.values(m)).reduce((n, e) => n + (e.history ?? []).filter((h) => isoOk(h.proposed_at) && dayOf(h.proposed_at) === today && pred(e, h)).length, 0);
  const allProposals = () => Object.values(enrollments).flatMap((m) => Object.values(m)).flatMap((e) => e.history ?? []).filter((h) => isoOk(h.proposed_at));
  for (const { lead, seq, enr, step } of candidates) {
    const tz = tzFor(lead, seq);
    const quiet = step.quiet_hours ?? seq.quiet_hours ?? cfg.quiet_hours ?? DEFAULT_QUIET;
    if (inQuietHours(now, quiet, tz)) { stats.deferred_quiet++; skip(lead, seq, 'quiet_hours'); continue; }
    if (step.max_per_day != null && countToday((e, h) => e.sequence === seq.id && h.step === step.index) >= step.max_per_day) { stats.deferred_cap++; skip(lead, seq, 'step_max_per_day'); continue; }
    if (seq.max_per_day != null && countToday((e) => e.sequence === seq.id) >= seq.max_per_day) { stats.deferred_cap++; skip(lead, seq, 'sequence_max_per_day'); continue; }
    const mineSent = proposalsOf({ enrollments }, lead.id).map((h) => Date.parse(h.proposed_at));
    if (mineSent.filter((t) => nowMs - t < 24 * HOUR).length >= caps.per_day
      || mineSent.filter((t) => nowMs - t < 7 * 24 * HOUR).length >= caps.per_week
      || mineSent.some((t) => nowMs - t < caps.min_gap_hours * HOUR)) { stats.deferred_cap++; skip(lead, seq, 'lead_frequency_cap'); continue; }
    if (step.cost > 0) {
      const daily = num(budget.daily_cap, 0); const monthly = num(budget.monthly_cap, 0);
      const spentToday = allProposals().filter((h) => dayOf(h.proposed_at) === today).reduce((s, h) => s + (h.cost ?? 0), 0);
      const spentMonth = num(budget.spent_this_month, 0) + allProposals().filter((h) => h.proposed_at.slice(0, 7) === today.slice(0, 7)).reduce((s, h) => s + (h.cost ?? 0), 0);
      if (budget.mode === 'free' || daily <= 0 || monthly <= 0 || spentToday + step.cost > daily || spentMonth + step.cost > monthly) { stats.skipped_budget++; skip(lead, seq, 'budget_cap'); continue; }
    }
    // The hash of the full lead id keeps ids unique when two long lead ids share a prefix or differ by case
    // (apply-results drops an approval whose id already exists).
    const id = `SEQ-${safeId(seq.id)}-${safeId(leadRef(lead.id)).slice(0, 20)}-${hash8(lead.id)}-${enr.runs ?? 1}-${step.index + 1}`;
    const expires = new Date(nowMs + staleFor(seq) * HOUR).toISOString();
    const ap = {
      id, type: 'send', channel: step.channel, title: `${seq.name} ${step.index + 1}/${seq.steps.length}: ${step.title ?? step.channel} to lead ${leadRef(lead.id).slice(0, 14)}`.slice(0, 140),
      file: step.file, target: lead.id, lead: lead.id, template: step.template, funnel_stage: lead.stage === 'new' ? 'contacted' : lead.stage, sequence: seq.id, step: step.index + 1, steps: seq.steps.length,
      agent: agentFor(seq), consent: consentFor(lead, step.channel), quiet_hours: quiet, timezone: tz, expires_at: expires,
      ...(step.channel === 'linkedin' ? { manual: true } : {}), ...(step.cost > 0 ? { amount: round2(step.cost), currency } : {}),
    };
    out.approvals.push(ap);
    enr.pending = { step: step.index, approval_id: id, proposed_at: now };
    enr.history.push({ step: step.index, approval_id: id, proposed_at: now, status: 'proposed', channel: step.channel, ...(step.cost > 0 ? { cost: step.cost } : {}) });
    stats.proposed++;
  }
  return out;
}

// For the executor: true when an approved "send" must not go out any more (lead stopped, unsubscribed,
// consent gone, or the enrolment no longer waits for this approval).
// apply-results.mjs keeps only id, type, channel, target, amount and currency of a proposal, so a merged
// approval is recognised by its SEQ- id (or task_id) and its enrolment is found in the state by approval id.
export function suppressCheck(approval, { pipeline, state } = {}) {
  if (!approval || approval.type !== 'send') return { suppress: false };
  const ours = Boolean(approval.sequence) || /^SEQ-/.test(String(approval.id ?? '')) || /^SEQ-/.test(String(approval.task_id ?? ''));
  if (!ours) return { suppress: false };
  let leadId = approval.lead ?? approval.target ?? null; let seqId = approval.sequence ?? null;
  for (const [lid, m] of Object.entries(state?.enrollments ?? {})) {
    for (const [sid, e] of Object.entries(m ?? {})) {
      if ((e?.history ?? []).some((h) => h?.approval_id === approval.id) || e?.pending?.approval_id === approval.id) { leadId ??= lid; seqId ??= sid; }
    }
  }
  if (!seqId) return { suppress: true, reason: 'not_enrolled' };
  const lead = (Array.isArray(pipeline?.leads) ? pipeline.leads : []).find((l) => l && l.id === leadId);
  if (!lead) return { suppress: true, reason: 'lead_not_found' };
  const g = globalStop(lead);
  if (g) return { suppress: true, reason: g };
  if (!CHANNELS.includes(approval.channel) || !consentOk(lead, approval.channel, { consent: null })) return { suppress: true, reason: 'no_consent' };
  const enr = state?.enrollments?.[lead.id]?.[seqId];
  if (!enr || enr.status !== 'active' || enr.pending?.approval_id !== approval.id) return { suppress: true, reason: enr ? `enrollment_${enr.status}${enr.stop_reason ? `_${enr.stop_reason}` : ''}` : 'not_enrolled' };
  return { suppress: false };
}

// Reads every products/<slug>/sequences/*.json; invalid files are reported, never run.
export function loadSequences(dir) {
  const sdir = path.join(dir, 'sequences');
  const files = fs.existsSync(sdir) ? fs.readdirSync(sdir).filter((f) => f.endsWith('.json')).sort() : [];
  const sequences = []; const errors = []; const seen = new Set();
  for (const f of files) {
    let def;
    try { def = JSON.parse(fs.readFileSync(path.join(sdir, f), 'utf8')); } catch (e) { errors.push(`${f}: ${e.message}`); continue; }
    const v = validateSequence(def, { fallbackId: f.replace(/\.json$/, ''), templateExists: (file) => fs.existsSync(path.join(dir, file)) });
    if (!v.ok) { errors.push(...v.errors.map((e) => `${f}: ${e}`)); continue; }
    if (seen.has(v.sequence.id)) { errors.push(`${f}: duplicate sequence id ${v.sequence.id}`); continue; }
    seen.add(v.sequence.id); sequences.push(v.sequence);
  }
  return { sequences, errors, files: files.length };
}

const productDir = (slug, rootDir) => {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(String(slug ?? ''))) throw new Error(`invalid product slug: ${slug}`);
  return path.join(rootDir, 'products', slug);
};

// Reads the files, plans, writes sequence-state.json and runs/SEQ-<date>.json (merged with an unapplied one).
export function runSequences(slug, { now = new Date().toISOString(), rootDir = repoRoot, dryRun = false } = {}) {
  const dir = productDir(slug, rootDir);
  if (!fs.existsSync(path.join(dir, 'product.json'))) throw new Error(`no product.json for ${slug}`);
  const product = readJson(path.join(dir, 'product.json'), {});
  const { sequences, errors, files } = loadSequences(dir);
  const stateFile = path.join(dir, 'funnel', 'sequence-state.json');
  const state = readJson(stateFile, {});
  const plan = planSequences({ pipeline: readJson(path.join(dir, 'funnel', 'pipeline.json'), { leads: [] }), sequences, state: state && typeof state === 'object' ? state : {}, approvals: readJson(path.join(dir, 'approvals.json'), []), product, now });
  const date = dayOf(now);
  const runFile = path.join(dir, 'runs', `SEQ-${date}.json`);
  const summary = { slug, sequences: sequences.length, files, errors, paused: Boolean(plan.paused), ...plan.stats, approvals: plan.approvals.map((a) => a.id), alerts: plan.alerts.length, run_file: null, dry_run: dryRun };
  if (dryRun || plan.paused) return { ...summary, plan };
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  writeJson(stateFile, plan.state);
  const alerts = [...plan.alerts, ...errors.map((e) => ({ level: 'warning', title: 'Sequence definition skipped', detail: e.slice(0, 300) }))];
  if (plan.approvals.length || alerts.length) {
    const prev = readJson(runFile, null);
    const prevAp = Array.isArray(prev?.approvals) ? prev.approvals : [];
    const prevAl = Array.isArray(prev?.alerts) ? prev.alerts : [];
    const approvals = [...prevAp, ...plan.approvals.filter((a) => !prevAp.some((p) => p.id === a.id))];
    const allAlerts = [...prevAl, ...alerts.filter((a) => !prevAl.some((p) => p.title === a.title && p.detail === a.detail))];
    fs.mkdirSync(path.dirname(runFile), { recursive: true });
    writeJson(runFile, {
      task_id: `SEQ-${date}`, agent: plan.approvals[0]?.agent ?? prev?.agent ?? product.sequences?.agent ?? 'om-email-nurture', status: 'done',
      summary: `Sequences: ${approvals.length} send proposal(s) waiting for approval or policy, ${plan.stats.stopped} stopped, ${plan.stats.completed} completed`,
      output: ['funnel/sequence-state.json'], approvals, alerts: allAlerts,
    });
    summary.run_file = path.relative(rootDir, runFile).replace(/\\/g, '/');
  }
  return summary;
}

// state/sequences.json: counts per product and sequence, no lead ids.
export function writeSequenceState(slugs, { rootDir = repoRoot, now = new Date().toISOString() } = {}) {
  const rows = [];
  for (const slug of slugs) {
    let dir; try { dir = productDir(slug, rootDir); } catch { continue; }
    const st = readJson(path.join(dir, 'funnel', 'sequence-state.json'), null);
    if (!st?.enrollments) continue;
    const per = {};
    for (const m of Object.values(st.enrollments)) for (const e of Object.values(m)) {
      const r = (per[e.sequence] ??= { product: slug, sequence: e.sequence, active: 0, waiting_approval: 0, completed: 0, stopped: 0, expired: 0, proposed: 0, sent: 0, stop_reasons: {} });
      if (e.status === 'active') { r.active++; if (e.pending) r.waiting_approval++; }
      else if (r[e.status] != null) r[e.status]++;
      if (e.stop_reason) r.stop_reasons[e.stop_reason] = (r.stop_reasons[e.stop_reason] ?? 0) + 1;
      for (const h of e.history ?? []) { if (h.proposed_at) r.proposed++; if (h.status === 'sent') r.sent++; }
    }
    rows.push(...Object.values(per).sort((a, b) => a.sequence.localeCompare(b.sequence)));
  }
  const sdir = path.join(rootDir, 'state');
  fs.mkdirSync(sdir, { recursive: true });
  writeJson(path.join(sdir, 'sequences.json'), { updated_at: now, sequences: rows });
  return rows.length;
}

const activeSlugs = (rootDir = repoRoot) => {
  const dir = path.join(rootDir, 'products');
  return (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((s) => !s.startsWith('_') && /^[a-z0-9-]+$/i.test(s) && fs.existsSync(path.join(dir, s, 'product.json'))).sort();
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const nowIdx = argv.indexOf('--now');
  const now = nowIdx > -1 ? argv[nowIdx + 1] : new Date().toISOString();
  const pos = argv.filter((a, i) => !a.startsWith('--') && !(nowIdx > -1 && i === nowIdx + 1));
  const usage = 'Usage: node tools/sequences.mjs <slug> [--now ISO] [--dry-run] | --all | validate <slug>';
  if (!isoOk(now)) { console.error('--now must be an ISO date'); process.exit(2); }
  if (pos[0] === 'validate') {
    if (!pos[1]) { console.error(usage); process.exit(2); }
    try {
      const r = loadSequences(productDir(pos[1], repoRoot));
      console.log(JSON.stringify({ slug: pos[1], files: r.files, valid: r.sequences.map((s) => s.id), errors: r.errors }));
      process.exit(r.errors.length ? 1 : 0);
    } catch (e) { console.error(e.message); process.exit(2); }
  }
  const slugs = argv.includes('--all') ? activeSlugs().filter((s) => readJson(path.join(repoRoot, 'products', s, 'product.json'), {}).stage !== 'paused') : pos.slice(0, 1);
  if (!slugs.length) { console.error(usage); process.exit(2); }
  const out = [];
  for (const s of slugs) { try { const { plan, ...r } = runSequences(s, { now, dryRun: argv.includes('--dry-run') }); out.push(argv.includes('--dry-run') && plan ? { ...r, proposals: plan.approvals, skipped: plan.skipped.slice(0, 50) } : r); } catch (e) { out.push({ slug: s, error: e.message }); } }
  if (argv.includes('--all')) writeSequenceState(activeSlugs(), { now });
  console.log(JSON.stringify(slugs.length === 1 ? out[0] : { products: out }));
  if (out.some((o) => o.error)) process.exit(1);
}
