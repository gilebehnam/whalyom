// Executor: carries out approvals that are "approved" (owner) or "auto-approved" (policy).
// For each one it picks a configured connector (tools/connectors), runs it, and records the
// outcome on the approval, in events.jsonl and, for spend, in ledger.jsonl.
// With no configured connector the item stays "approved" with waiting_for: 'connector key', so a
// later run that has the key executes it. It becomes "approved-manual" (exact steps written to
// outbox/manual/<id>.md for the owner) only when item.manual === true or after it has waited
// autonomy.manual_after_days (default 7) days.
// Usage: node tools/execute.mjs <slug> [--dry-run] [--now ISO]
// Kill switches: env OM_KILL=1, product stage "paused", or product.json autonomy.kill = true.
// The product-level switches and the scheduler lease are checked again before every item.
//
// Concurrency: one executor per product at a time (products/<slug>/.execute.lock, stale after 10 min).
// An item is saved as status 'executing' before its connector is called, and approvals.json is
// re-read before every write so only the items this run touched are replaced (other writers' changes
// survive). When started by the daemon (OM_SCHEDULER_HOLDER set) it runs only while that scheduler
// still holds the lease in state/scheduler.json.
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, readJson, writeJson, root } from './lib/env.mjs';
import { pick } from './connectors/index.mjs';
import { checkSpendCaps } from './budget.mjs';
import { redact } from './connectors/_http.mjs';
import { acquireLock, productLockFile, readLock, holdsLease, readLease } from './lib/lock.mjs';
import { suppressCheck, inQuietHours, DEFAULT_QUIET } from './sequences.mjs';
import { hashEmail } from './inbox.mjs';

loadEnv();
const args = process.argv.slice(2);
const slug = args[0];
if (!slug) { console.error('Usage: node tools/execute.mjs <slug> [--dry-run] [--now ISO]'); process.exit(2); }
const dryRun = args.includes('--dry-run');
const nowIdx = args.indexOf('--now');
const now = nowIdx > -1 ? args[nowIdx + 1] : new Date().toISOString();
const dir = path.join(root, 'products', slug);
const productFile = path.join(dir, 'product.json');
const product = readJson(productFile, null);
if (!product) { console.error(`products/${slug}/product.json not found`); process.exit(1); }

const killed = process.env.OM_KILL === '1' || product.stage === 'paused' || product.autonomy?.kill === true;
if (killed) { console.log(JSON.stringify({ slug, executed: 0, skipped: 'kill switch on (OM_KILL, paused stage or autonomy.kill)' })); process.exit(0); }

// Run via the daemon: only while its scheduler lease is still ours.
const holder = process.env.OM_SCHEDULER_HOLDER;
if (holder && !holdsLease(holder)) {
  const l = readLease();
  console.log(JSON.stringify({ slug, executed: 0, skipped: `scheduler lease not held by ${holder}${l?.holder ? ` (held by ${l.holder} until ${l.until})` : ''}` }));
  process.exit(0);
}

// One executor per product. A dry run writes nothing, so it needs no lock.
const lockFile = productLockFile(dir);
const release = dryRun ? () => {} : acquireLock(lockFile, { waitMs: Number(process.env.OM_EXECUTE_LOCK_WAIT_MS ?? 3000), owner: 'execute' });
if (!release) {
  const l = readLock(lockFile);
  console.log(JSON.stringify({ slug, executed: 0, skipped: `another executor holds ${path.relative(root, lockFile)}${l ? ` (pid ${l.pid} on ${l.host} since ${l.at})` : ''}` }));
  process.exit(0);
}

const approvalsFile = path.join(dir, 'approvals.json');
const readApprovals = () => { const a = readJson(approvalsFile, []); return Array.isArray(a) ? a : []; };
const approvals = readApprovals();
const events = [];
const ledgerFile = path.join(dir, 'ledger.jsonl');
const killedCampaigns = readJson(path.join(dir, 'killswitch.json'), []);
const out = { slug, dryRun, executed: 0, manual: 0, waiting: 0, failed: 0, items: [] };
const ctx = { slug, dir, env: process.env, now, dryRun };
const ELIGIBLE = ['approved', 'auto-approved'];
const manualAfterDays = Number(product.autonomy?.manual_after_days ?? 7);

// Items this run changed, by id. save() re-reads approvals.json and writes only the fields this run
// owns onto those records, so an owner's edit made meanwhile (amount, activate, owner_note) survives.
const touched = new Map();
const touch = (item) => touched.set(item.id, item);
const RUN_FIELDS = ['status', 'executing_at', 'executing_pid', 'executed_at', 'executed_by', 'result', 'result_ref', 'committed_daily', 'attempts', 'last_error',
  'waiting_for', 'waiting_since', 'waiting_checked_at', 'waiting_note', 'manual_steps', 'review_notes'];
const mergeRun = (fresh, item) => { const m = { ...fresh }; for (const k of RUN_FIELDS) { if (k in item) m[k] = item[k]; else delete m[k]; } return m; };
function save() {
  if (dryRun || !touched.size) return;
  const fresh = readApprovals();
  const seen = new Set();
  const merged = fresh.map((a) => { if (a && touched.has(a.id)) { seen.add(a.id); return mergeRun(a, touched.get(a.id)); } return a; });
  for (const [id, item] of touched) if (!seen.has(id)) merged.push(item);
  writeJson(approvalsFile, merged);
}
// Live view for the cap check: the file as it is now, with this run's changes on top.
const liveApprovals = () => {
  if (dryRun) return approvals;
  const fresh = readApprovals();
  const ids = new Set(fresh.map((a) => a?.id));
  return [...fresh.map((a) => (a && touched.has(a.id) ? mergeRun(a, touched.get(a.id)) : a)), ...[...touched.values()].filter((a) => !ids.has(a.id))];
};

// Send guards (sequences and replies). Every send to a lead is checked just before its connector runs:
// - a lead on products/<slug>/suppression.json (hashed, written by tools/inbox.mjs) is never sent to;
// - a sequence send (field sequence, or an SEQ- id) goes through suppressCheck() from tools/sequences.mjs
//   with funnel/pipeline.json and funnel/sequence-state.json (reply, unsubscribe, lost consent, stopped
//   or expired enrolment);
// - an item whose expires_at has passed is not sent;
// - an item inside its quiet hours (lead's time zone) is deferred to a later run, unchanged.
// A file that is missing or unreadable holds the item (no status change): the guard fails closed.
const SEND_TYPES = ['send', 'email', 'message', 'reply'];
const isSequenceItem = (item) => Boolean(item.sequence) || /^SEQ-/.test(String(item.id ?? '')) || /^SEQ-/.test(String(item.task_id ?? ''));
// A raw address on the item (to / email) also counts, so a send without a lead id cannot skip the suppression list.
const hasRawAddress = (item) => [item.to, item.email].some((x) => typeof x === 'string' && x.includes('@'));
const isLeadSend = (item) => SEND_TYPES.includes(item.type) && (Boolean(item.lead) || Boolean(item.email_hash) || hasRawAddress(item) || isSequenceItem(item));
// Strict read: {ok:false} when the file exists but is not valid JSON, {missing:true} when it is absent.
function readStrict(file) {
  if (!fs.existsSync(file)) return { ok: true, missing: true, value: null };
  try { return { ok: true, missing: false, value: JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { return { ok: false }; }
}
function sendGuard(item) {
  if (!isLeadSend(item)) return null;
  const seq = isSequenceItem(item);
  const exp = Date.parse(item.expires_at ?? '');
  if (item.expires_at != null && Number.isFinite(exp) && exp <= Date.parse(now)) return { verdict: 'expired', why: `expired at ${item.expires_at}` };
  const pipeR = readStrict(path.join(dir, 'funnel', 'pipeline.json'));
  const leads = Array.isArray(pipeR.value?.leads) ? pipeR.value.leads : [];
  const leadId = item.lead ?? (seq ? item.target : null) ?? null;
  const lead = leadId == null ? null : leads.find((l) => l && (l.id === leadId || (Array.isArray(l.aliases) && l.aliases.includes(leadId)))) ?? null;
  // Suppression list: lead id or email hash (from the item, its pipeline lead, or a raw address on the item).
  const supR = readStrict(path.join(dir, 'suppression.json'));
  if (!supR.ok) return { verdict: 'hold', why: 'suppression.json is unreadable; no send to a lead until it is fixed' };
  const rows = Array.isArray(supR.value) ? supR.value : Array.isArray(supR.value?.entries) ? supR.value.entries : [];
  const supHash = new Set(rows.map((e) => e?.email_hash).filter(Boolean));
  const supLead = new Set(rows.map((e) => e?.lead).filter((x) => x != null && x !== ''));
  const hashes = [item.email_hash, lead?.email_hash, ...[item.to, item.email].filter((x) => typeof x === 'string' && x.includes('@')).map((x) => hashEmail(x))].filter(Boolean);
  if ((leadId != null && supLead.has(leadId)) || (lead && supLead.has(lead.id)) || hashes.some((h) => supHash.has(h))) return { verdict: 'suppressed', why: 'lead is on suppression.json' };
  if (seq) {
    if (!pipeR.ok || pipeR.missing) return { verdict: 'hold', why: `funnel/pipeline.json is ${pipeR.ok ? 'missing' : 'unreadable'}; sequence send held` };
    const stR = readStrict(path.join(dir, 'funnel', 'sequence-state.json'));
    if (!stR.ok || stR.missing) return { verdict: 'hold', why: `funnel/sequence-state.json is ${stR.ok ? 'missing' : 'unreadable'}; sequence send held` };
    let c;
    try { c = suppressCheck(item, { pipeline: pipeR.value, state: stR.value }); } catch (e) { return { verdict: 'hold', why: `suppress check failed: ${String(e?.message ?? e).slice(0, 80)}` }; }
    if (c?.suppress) return { verdict: 'suppressed', why: `sequence stop: ${c.reason ?? 'suppressed'}` };
  }
  const quiet = item.quiet_hours !== undefined ? item.quiet_hours : seq ? (product.sequences?.quiet_hours ?? DEFAULT_QUIET) : null;
  const tz = item.timezone ?? lead?.timezone ?? lead?.tz ?? product.sequences?.timezone ?? product.timezone ?? 'UTC';
  if (quiet && inQuietHours(now, quiet, tz)) return { verdict: 'defer', why: `quiet hours ${quiet.start}-${quiet.end} in ${quiet.tz ?? tz}` };
  return null;
}

function writeManualSteps(item) {
  const manualDir = path.join(dir, 'outbox', 'manual');
  fs.mkdirSync(manualDir, { recursive: true });
  const steps = [`# Do this by hand: ${item.title}`, '', `Approval ${item.id} (${item.type}${item.channel ? ', ' + item.channel : ''}) was approved but no connector is set up for it.`, '',
    `1. Open the draft: \`products/${slug}/${item.file ?? '(no file)'}\`.`, `2. ${item.type === 'spend' ? `Create the campaign it describes, with a budget of no more than ${item.amount} ${product.budget?.currency ?? ''}.` : 'Publish or send it on its channel exactly as written.'}`,
    `3. Tell OM it is done: \`/om approve ${slug} ${item.id} done\`${item.type === 'spend' ? ` and record the spend: \`node tools/budget.mjs ${slug} --record ${item.amount} ${item.channel ?? ''}\`` : ''}.`, '',
    'To automate this next time, configure a connector (see docs/CONNECTORS.md).'];
  fs.writeFileSync(path.join(manualDir, `${item.id}.md`), steps.join('\n') + '\n');
}

try {
  for (const item of approvals) {
    if (!item || !ELIGIBLE.includes(item.status) || item.executed_at) continue;
    if (!item.id) { out.items.push({ result: 'skipped (approval has no id)', title: item.title }); continue; }

    // The owner can pull the switch (or another scheduler take the lease) while this run is going:
    // stop before the next connector call and leave the remaining items as they are.
    const cur = readJson(productFile, product) ?? product;
    if (cur.stage === 'paused' || cur.autonomy?.kill === true) { out.stopped = 'kill switch on (paused stage or autonomy.kill) during the run'; break; }
    if (holder && !holdsLease(holder)) { out.stopped = `lease lost: scheduler lease no longer held by ${holder}`; break; }

    // Another writer may have changed this item since we read it (decided, rejected, executed).
    // The fresh record is what this run works from, so a lowered amount or a dropped activate counts.
    if (!dryRun) {
      const f = readApprovals().find((a) => a?.id === item.id);
      if (!f || !ELIGIBLE.includes(f.status) || f.executed_at) { out.items.push({ id: item.id, result: `skipped (now ${f ? f.status : 'gone'})` }); continue; }
      for (const k of Object.keys(item)) if (!(k in f)) delete item[k];
      Object.assign(item, f);
    }

    // Send guards: suppression list, sequence stops, expiry (terminal) and quiet hours / unreadable files (deferred).
    const g = sendGuard(item);
    if (g) {
      if (g.verdict === 'suppressed' || g.verdict === 'expired') {
        if (!dryRun) {
          item.status = g.verdict === 'expired' ? 'expired' : 'skipped-suppressed'; item.review_notes = `not sent by executor: ${g.why}`;
          delete item.waiting_for; delete item.waiting_since; delete item.waiting_checked_at; delete item.waiting_note;
          touch(item);
          events.push({ at: now, agent: 'om-executor', product: slug, task_id: item.task_id, kind: 'blocked', text: `Not sent (${g.verdict}): ${item.id}`.slice(0, 160) });
        }
        out.items.push({ id: item.id, result: `skipped (${g.verdict})`, why: g.why });
      } else {
        out.items.push({ id: item.id, result: g.verdict === 'defer' ? 'deferred (quiet hours)' : 'held', why: g.why });
      }
      continue;
    }

    // Free mode: spend is never attempted and never an error; the item is parked until a budget exists.
    if (item.type === 'spend' && (product.budget?.mode ?? 'free') === 'free') {
      if (!dryRun) { item.status = 'skipped-free-mode'; item.review_notes = 'Free mode: no ad spend. Add a budget in Connections & Vault to run it.'; touch(item); }
      out.items.push({ id: item.id, result: 'skipped (free mode)' });
      continue;
    }
    // Last line of defence for money: the new daily total across every live campaign must fit
    // daily_cap, and spend so far + that daily total for the rest of the month must fit monthly_cap.
    if (item.type === 'spend') {
      const c = checkSpendCaps({ item, budget: product.budget ?? {}, approvals: liveApprovals(), ledgerFile, now, killed: killedCampaigns });
      if (!c.ok) {
        const note = `held by executor: ${c.why} (amount ${c.amount}, live ${c.committed}/day, spent ${c.spent}, caps ${product.budget?.daily_cap}/day ${product.budget?.monthly_cap}/month)`;
        if (!dryRun) { item.status = 'pending'; item.review_notes = note; touch(item); }
        out.items.push({ id: item.id, result: 'held', why: note });
        continue;
      }
    }

    const connector = pick(item, process.env, ctx);
    if (!connector) {
      const since = item.waiting_since ?? now;
      const waitedDays = (Date.parse(now) - Date.parse(since)) / 86400000;
      const goManual = item.manual === true || waitedDays >= manualAfterDays;
      if (dryRun) { out.items.push({ id: item.id, result: goManual ? 'would be manual' : 'would wait for a connector key' }); continue; }
      if (goManual) {
        writeManualSteps(item);
        item.status = 'approved-manual'; item.manual_steps = `outbox/manual/${item.id}.md`;
        delete item.waiting_for;
        events.push({ at: now, agent: 'om-executor', product: slug, task_id: item.task_id, kind: 'approval', text: `Needs you by hand: ${item.title}` });
        out.manual++; out.items.push({ id: item.id, result: 'manual' });
      } else {
        const first = !item.waiting_since;
        item.waiting_for = 'connector key'; item.waiting_since = since; item.waiting_checked_at = now;
        item.waiting_note = `No connector is configured for ${item.type}${item.channel ? ` on ${item.channel}` : ''}. Add its key and the next run executes it; after ${manualAfterDays} day(s) it becomes a manual task.`;
        if (first) events.push({ at: now, agent: 'om-executor', product: slug, task_id: item.task_id, kind: 'blocked', text: `Waiting for a connector key: ${item.title}`.slice(0, 160) });
        out.waiting++; out.items.push({ id: item.id, result: 'waiting for connector key', since });
      }
      touch(item);
      continue;
    }

    const prevStatus = item.status;
    if (!dryRun) {
      // Claim the item on disk before any network call, so a crash or a second runner cannot repeat it.
      item.status = 'executing'; item.executing_at = now; item.executing_pid = process.pid;
      touch(item); save();
    }
    const settle = () => { delete item.executing_at; delete item.executing_pid; delete item.waiting_for; delete item.waiting_since; delete item.waiting_checked_at; delete item.waiting_note; };
    try {
      const r = await connector.execute(item, ctx);
      // Secrets never reach approvals.json, events or stdout, even from connectors that echo raw text.
      if (r && r.detail !== undefined) r.detail = redact(String(r.detail), process.env);
      out.items.push({ id: item.id, connector: connector.name, ...r });
      if (dryRun) continue;
      settle();
      if (r.ok) {
        item.status = 'executed'; item.executed_at = now; item.executed_by = connector.name; item.result_ref = r.ref ?? ''; item.result = r.detail ?? '';
        if (item.type === 'spend') {
          // A connector that does not report it counts the approved amount; an explicit numeric 0
          // means it created the campaign paused.
          item.committed_daily = typeof r.committed_daily !== 'number' ? Number(item.amount) || 0 : Math.max(0, r.committed_daily);
          if (item.committed_daily > 0) fs.appendFileSync(ledgerFile, JSON.stringify({ at: now, channel: item.channel, amount: item.committed_daily, kind: 'committed_daily', ref: r.ref, approval: item.id }) + '\n');
        }
        events.push({ at: now, agent: 'om-executor', product: slug, task_id: item.task_id, kind: 'done', text: `${connector.name}: ${item.title} — ${r.detail ?? ''}`.slice(0, 160) });
        // A sent message to a lead moves it to "contacted" in the funnel (tools/funnel.mjs merges it).
        if (item.lead && ['send', 'email', 'message', 'reply'].includes(item.type)) {
          const upd = path.join(dir, 'funnel', 'updates');
          fs.mkdirSync(upd, { recursive: true });
          fs.writeFileSync(path.join(upd, `exec-${String(item.id).replace(/[^A-Za-z0-9-]+/g, '-')}.json`), JSON.stringify([{ lead: item.lead, stage: item.funnel_stage ?? 'contacted', at: now, source: 'om-executor', note: String(item.title ?? '').slice(0, 120) }]));
        }
        out.executed++;
      } else if (r.partial) {
        // A multi-step create stopped midway: some resources exist on the platform. A retry would
        // duplicate them, so the item fails now and result_ref keeps what exists for the owner.
        item.status = 'failed'; item.executed_by = connector.name; item.result_ref = r.ref ?? '';
        item.last_error = r.detail; item.attempts = (item.attempts ?? 0) + 1;
        events.push({ at: now, agent: 'om-executor', product: slug, task_id: item.task_id, kind: 'blocked', text: `${connector.name} stopped midway, check before retrying: ${r.detail}`.slice(0, 160) });
        out.failed++;
      } else {
        item.status = prevStatus;
        item.last_error = r.detail; item.attempts = (item.attempts ?? 0) + 1;
        if (item.attempts >= 3) item.status = 'failed';
        events.push({ at: now, agent: 'om-executor', product: slug, task_id: item.task_id, kind: 'blocked', text: `${connector.name} failed: ${r.detail}`.slice(0, 160) });
        out.failed++;
      }
    } catch (e) {
      if (!dryRun) { settle(); item.status = prevStatus; }
      item.last_error = redact(String(e?.message ?? e), process.env); item.attempts = (item.attempts ?? 0) + 1;
      if (item.attempts >= 3) item.status = 'failed';
      out.failed++; out.items.push({ id: item.id, connector: connector.name, ok: false, detail: item.last_error });
    }
    if (!dryRun) { touch(item); save(); }
  }

  // Items left in 'executing' by a run that died: the connector may or may not have acted, so they
  // are never retried automatically. After the lock's stale window they are marked failed for the owner.
  if (!dryRun) {
    for (const a of readApprovals()) {
      if (a?.status !== 'executing' || touched.has(a.id)) continue;
      const started = Date.parse(a.executing_at ?? '');
      if (Number.isFinite(started) && Date.parse(now) - started < 10 * 60 * 1000) continue;
      a.status = 'failed'; a.last_error = `interrupted while executing (started ${a.executing_at}); check ${a.channel ?? 'the channel'} for a duplicate before approving again`;
      delete a.executing_pid;
      touch(a);
      events.push({ at: now, agent: 'om-executor', product: slug, task_id: a.task_id, kind: 'blocked', text: `Interrupted, check before retrying: ${a.title}`.slice(0, 160) });
      out.items.push({ id: a.id, result: 'interrupted, marked failed' });
    }
  }

  if (!dryRun) {
    save();
    if (events.length) fs.appendFileSync(path.join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }
} finally {
  release();
}
console.log(JSON.stringify(out));
