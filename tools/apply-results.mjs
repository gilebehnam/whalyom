// Merges agent result files (products/<slug>/runs/*.json) into the workspace ledgers.
// Agents never edit tasks.json, approvals.json or experiments.json directly, so parallel
// agents can't overwrite each other. This script is the single writer.
// Usage: node tools/apply-results.mjs <slug> [--now ISO]
//
// Result file shape (all fields optional except task_id):
// { task_id, agent, status: "done"|"blocked", output: [files], summary, error,
//   approvals: [{id?, type, title, file}], experiments: [{id, hypothesis, metric, status, result}],
//   new_tasks: [{id?, title, agent, brief, depends_on, priority}],
//   evaluations: [{task_id, score, note}], cost: {minutes?, notes?} }
//
// Reviewer verdicts (the compliance gate) come from runs/REVIEW-<anything>.json, never from edits
// to approvals.json: { agent: "om-compliance-guard" | "om-micro-claim-check",
//   reviews: [{ approval_id, compliance: "pass"|"fix"|"block", notes }] }. They are applied after
// every other run in the same pass, so a review can name an approval created in that pass.
//
// Crash safety: each run is applied inside try/catch against a snapshot of the ledgers; a run that
// throws is rolled back and moved to runs/failed/ with its error, and the rest still apply. Run
// files move to runs/applied/ only after the ledgers are saved.
//
// Ledger safety: the whole read-apply-save runs under the product lock (the same one execute.mjs and
// policy.mjs take); when it is held, nothing is written and the runs stay queued. A ledger that exists
// but does not parse as an array stops the pass with an error instead of being replaced. Every ledger
// is written to a temp file and renamed over the target, so a crash never leaves a truncated file.
// approvals.json is re-read before the save and only this pass's new approvals and compliance verdicts
// are merged in, so an approval another writer executed or decided meanwhile keeps its status.
// runs/applied/index.json remembers each applied run (file name + sha256), so a run whose move out of
// the queue failed is never applied twice.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { roster } from './roster.mjs';
import { acquireLock, productLockFile } from './lib/lock.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const slug = args[0];
if (!slug) { console.error('Usage: node tools/apply-results.mjs <slug> [--now ISO]'); process.exit(2); }
const nowIdx = args.indexOf('--now');
const now = nowIdx > -1 ? args[nowIdx + 1] : new Date().toISOString();

const dir = path.join(root, 'products', slug);
const runs = path.join(dir, 'runs');
const applied = path.join(runs, 'applied');
fs.mkdirSync(applied, { recursive: true });

const release = acquireLock(productLockFile(dir), { waitMs: Number(process.env.OM_EXECUTE_LOCK_WAIT_MS ?? 3000), owner: 'apply-results' });
if (!release) { console.log(JSON.stringify({ skipped: 'product lock held' })); process.exit(0); }

// A missing ledger starts empty; an unreadable or non-array one stops the pass with nothing written.
const unreadable = (f) => { console.log(JSON.stringify({ error: `${f} is unreadable` })); process.exit(1); };
const loadFile = (file, name) => {
  let v;
  try { v = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return []; unreadable(name); }
  if (!Array.isArray(v)) unreadable(name);
  return v;
};
const load = (f) => loadFile(path.join(dir, f), f);
const pause = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* ignore */ } };
// Atomic write: temp file, then rename over the target (retried briefly while Windows holds the file).
const writeAtomic = (file, text) => {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      if (i >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { fs.rmSync(tmp, { force: true }); throw e; }
      pause(50 * (i + 1));
    }
  }
};
const save = (f, v) => writeAtomic(path.join(dir, f), JSON.stringify(v, null, 2));
const tasks = load('tasks.json');
const approvals = load('approvals.json');
const experiments = load('experiments.json');
const knownApprovalIds = new Set(approvals.map((x) => x?.id));
const autoApprovalIds = new Set(); // ids this pass numbered itself; renumbered if a concurrent writer took them
const agents = new Set(roster.map((a) => a.name));

const nextId = (list, prefix) => {
  const n = list.reduce((m, x) => Math.max(m, Number(String(x.id).replace(/\D/g, '')) || 0), 0);
  return `${prefix}${n + 1}`;
};

// --backfill: record workflow-run results that were applied before they became tasks.
if (args.includes('--backfill')) {
  let added = 0;
  for (const f of fs.readdirSync(applied).filter((x) => x.endsWith('.json'))) {
    let r;
    try { r = JSON.parse(fs.readFileSync(path.join(applied, f), 'utf8')); } catch { continue; }
    if (!r.task_id || String(r.task_id).startsWith('EV-') || tasks.some((x) => x.id === r.task_id)) continue;
    tasks.push({ id: r.task_id, title: (r.summary ?? r.task_id).slice(0, 90), agent: r.agent ?? '', brief: '', depends_on: [], status: r.status === 'blocked' ? 'blocked' : 'done', output: r.output ?? [], summary: r.summary ?? '', created_at: now, finished_at: now, created_by: 'workflow' });
    added++;
  }
  save('tasks.json', tasks);
  release();
  console.log(JSON.stringify({ backfilled: added }));
  process.exit(0);
}

const files = fs.readdirSync(runs).filter((f) => f.endsWith('.json')).sort();
const events = [];

// ── AI Transition engine ──
// Every handoff (an agent's result creating work for another agent) is a transition object:
// fired → completed (downstream task done and passed the gate) | failed (blocked) → healing → healed.
const transitionsFile = path.join(dir, 'transitions.json');
const transitions = loadFile(transitionsFile, 'transitions.json');
const layerOfAgent = Object.fromEntries(roster.map((a) => [a.name, a.layer]));
// Transition ids are monotonic: the highest numeric id ever kept + 1 (the newest transitions are the
// ones kept by slice(-2000) below, so the maximum survives trimming; transitions.length+1 did not).
let transitionSeq = transitions.reduce((m, x) => Math.max(m, Number(String(x?.id ?? '').replace(/^X/, '')) || 0), 0);
const fire = (fromAgent, sourceTask, toTask) => transitions.push({
  id: `X${++transitionSeq}`, at: now, product: slug, from_agent: fromAgent, to_agent: toTask.agent,
  from_layer: layerOfAgent[fromAgent] ?? null, to_layer: layerOfAgent[toTask.agent] ?? null,
  source_task: sourceTask, task_id: toTask.id, status: 'fired', payload: { brief: (toTask.brief ?? '').slice(0, 300), outputs: [] },
});
const settle = (taskId, status, extra = {}) => { for (const x of transitions) if (x.task_id === taskId && x.status !== 'completed') Object.assign(x, { status, updated_at: now, ...extra }); };
const stats = { files: 0, tasks: 0, approvals: 0, experiments: 0, new_tasks: 0, evaluations: 0, reviews: 0, duplicates: 0, rejected: [], failed: [] };
const alertsOut = [];     // alerts raised in this pass, written with the ledgers
const moves = [];         // [from, to] run files to move once the ledgers are saved
const heartbeats = [];    // runs/<task>.start files to drop once the ledgers are saved
const failed = [];        // [file, error] runs that threw; moved to runs/failed/
const stamp = now.replace(/[:.]/g, '-');
// Applied-run index: "<file>:<sha256>" -> pass stamp. Written with the ledgers, trimmed to 5000 entries.
const indexFile = path.join(applied, 'index.json');
const appliedIndex = (() => {
  try { const v = JSON.parse(fs.readFileSync(indexFile, 'utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
})();
const indexAdds = []; // keys of the runs applied in this pass
const ledgers = { tasks, approvals, experiments, transitions, alertsOut };
const snapshot = () => ({ json: JSON.stringify(ledgers), seq: transitionSeq, stats: JSON.stringify(stats), events: events.length, reviewed: JSON.stringify([...reviewed]) });
const restore = (snap) => {
  const saved = JSON.parse(snap.json);
  for (const k of Object.keys(ledgers)) { ledgers[k].length = 0; for (const x of saved[k]) ledgers[k].push(x); }
  transitionSeq = snap.seq;
  const st = JSON.parse(snap.stats);
  for (const k of Object.keys(stats)) delete stats[k];
  Object.assign(stats, st);
  events.length = snap.events;
  reviewed.clear();
  for (const [k, v] of JSON.parse(snap.reviewed)) reviewed.set(k, v);
};

// Extra approval fields kept from a run file. Never add status, compliance or activate here.
const APPROVAL_EXTRA_KEYS = ['channel', 'amount', 'currency', 'target', 'lead', 'template', 'funnel_stage', 'sequence', 'step', 'manual', 'expires_at', 'quiet_hours', 'timezone', 'utm_source', 'from_channel'];
// A hint is data only: strings are cut to 500 characters, numbers must be finite, and an object or
// array (quiet_hours, for example) is kept only when it is small (2 KB of JSON at most). Anything else is dropped.
const approvalHint = (v) => {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'string') return v.slice(0, 500);
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'object') { try { const j = JSON.stringify(v); return j.length <= 2000 ? JSON.parse(j) : undefined; } catch { return undefined; } }
  return undefined;
};

// Only these reviewers may set an approval's compliance verdict.
const REVIEWERS = new Set(['om-compliance-guard', 'om-micro-claim-check']);
const VERDICTS = ['pass', 'fix', 'block'];
const isReviewFile = (f) => /^REVIEW-.+\.json$/.test(f);
const reviewed = new Map(); // approval id -> {compliance, notes, by}: the strictest verdict in this pass wins

function applyReview(f, r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error('review file is not an object');
  if (!REVIEWERS.has(r.agent)) { stats.rejected.push(`${f}: reviews from ${r.agent ?? 'unknown agent'} ignored (only ${[...REVIEWERS].join(', ')})`); return; }
  if (!Array.isArray(r.reviews)) throw new Error('"reviews" must be an array');
  for (const rv of r.reviews) {
    const ap = approvals.find((x) => x.id === rv?.approval_id);
    if (!ap) { stats.rejected.push(`${f}: review for unknown approval ${rv?.approval_id}`); continue; }
    if (!VERDICTS.includes(rv.compliance)) { stats.rejected.push(`${f}: review for ${ap.id} has invalid compliance ${rv.compliance}`); continue; }
    if (ap.status !== 'pending') { stats.rejected.push(`${f}: ${ap.id} is ${ap.status}, not pending; review ignored`); continue; }
    const notes = String(rv.notes ?? '').slice(0, 500);
    const prev = reviewed.get(ap.id);
    const strictest = !prev || VERDICTS.indexOf(rv.compliance) >= VERDICTS.indexOf(prev.compliance) ? rv.compliance : prev.compliance;
    const cur = { compliance: strictest, notes: [prev?.notes, notes].filter(Boolean).join(' | ').slice(0, 1000), by: strictest === rv.compliance ? r.agent : prev.by };
    reviewed.set(ap.id, cur);
    Object.assign(ap, { compliance: cur.compliance, review_notes: cur.notes, compliance_by: cur.by, compliance_at: now });
    stats.reviews++;
  }
  events.push({ at: now, agent: r.agent, product: slug, task_id: f.replace(/\.json$/, ''), kind: 'review', text: `Compliance verdicts for ${r.reviews.length} approval(s)` });
}

function applyRun(f, r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error('run file is not an object');
  for (const k of ['approvals', 'experiments', 'new_tasks', 'evaluations', 'alerts']) if (r[k] != null && !Array.isArray(r[k])) throw new Error(`"${k}" must be an array`);
  stats.files++;

  let t = tasks.find((x) => x.id === r.task_id);
  // Work a workflow ran directly (onboarding, planning) has no queued task: record it
  // as one, so its id can be a dependency and it shows on the dashboard. Evaluations are not tasks.
  if (!t && r.task_id && !String(r.task_id).startsWith('EV-')) {
    t = { id: r.task_id, title: (r.summary ?? r.task_id).slice(0, 90), agent: r.agent ?? '', brief: '', depends_on: [], status: 'todo', created_at: now, created_by: 'workflow' };
    tasks.push(t);
  }
  if (t) {
    t.status = r.status === 'blocked' ? 'blocked' : 'done';
    t.finished_at = now;
    if (r.output) t.output = r.output;
    if (r.summary) t.summary = r.summary;
    if (r.error) t.error = r.error;
    t.attempts = (t.attempts ?? 0) + 1;
    stats.tasks++;
    const wasHealing = transitions.some((x) => x.task_id === t.id && x.status === 'healing');
    if (t.status === 'done') settle(t.id, wasHealing ? 'healed' : 'completed', { outputs: r.output ?? [] });
    else {
      settle(t.id, 'failed', { error: (r.error ?? '').slice(0, 200) });
      // Self-healing: queue a diagnosis by the ops doctor; when it finishes, the task is replayed.
      if (!t.id.startsWith('HEAL-') && !tasks.some((x) => x.id === `HEAL-${t.id}`)) {
        tasks.push({ id: `HEAL-${t.id}`, title: `Diagnose and unblock ${t.id}: ${t.title ?? ''}`.slice(0, 90), agent: 'om-ops-doctor', brief: `Task ${t.id} (${t.agent}) is blocked: ${r.error ?? 'no error given'}. Find the cause, fix inputs or the brief, and say in your summary what changed. Then the task is replayed.`, depends_on: [], priority: 1, status: 'todo', created_at: now, created_by: 'transition-engine', heals: t.id });
        settle(t.id, 'healing');
        stats.heals = (stats.heals ?? 0) + 1;
      }
    }
    // A finished heal task replays the task it was healing.
    if (t.heals && t.status === 'done') {
      const healed = tasks.find((x) => x.id === t.heals);
      if (healed && healed.status === 'blocked') { healed.status = 'todo'; healed.error = undefined; healed.replayed_at = now; }
    }
  }

  for (const a of r.approvals ?? []) {
    if (a.id && approvals.some((x) => x.id === a.id)) continue;
    // channel/amount/currency route the item to its connector and cap its spend. Dropping them would
    // leave approved items with no connector. activate (start live, not paused/draft) is the owner's
    // flag and only apply-decisions sets it; an agent's wish is kept as activate_requested.
    // The rest are routing and timing hints the newer modules need at execute time: sequences.mjs (lead,
    // template, funnel_stage, sequence, step, expires_at, quiet_hours, timezone), manual hand-offs and
    // utm_source for outcome credit, from_channel for attribution budget shifts. They are copied as data only; status, compliance and activate are
    // never taken from an agent (status is always pending, compliance unchecked until a reviewer runs).
    const extra = Object.fromEntries(APPROVAL_EXTRA_KEYS.map((k) => [k, approvalHint(a[k])]).filter(([, v]) => v !== undefined));
    if (a.activate === true || a.activate_requested === true) extra.activate_requested = true;
    const id = a.id ?? nextId(approvals, 'A');
    if (!a.id) autoApprovalIds.add(id);
    approvals.push({ id, type: a.type ?? 'publish', title: a.title ?? '', file: a.file ?? '', ...extra, agent: r.agent ?? t?.agent ?? '', task_id: r.task_id, status: 'pending', compliance: 'unchecked', created_at: now });
    stats.approvals++;
  }

  for (const e of r.experiments ?? []) {
    const i = experiments.findIndex((x) => x.id === e.id);
    if (i > -1) experiments[i] = { ...experiments[i], ...e, updated_at: now };
    else experiments.push({ id: e.id ?? nextId(experiments, 'E'), status: 'planned', ...e, created_at: now });
    stats.experiments++;
  }

  for (const n of r.new_tasks ?? []) {
    if (!agents.has(n.agent)) { stats.rejected.push(`${f}: new task for unknown agent ${n.agent}`); continue; }
    const id = n.id && !tasks.some((x) => x.id === n.id) ? n.id : nextId(tasks, 'T');
    const nt = { id, title: n.title, agent: n.agent, brief: n.brief ?? n.title, depends_on: n.depends_on ?? [], priority: n.priority ?? 5, status: 'todo', created_at: now, created_by: r.agent ?? '' };
    if (n.channel) nt.channel = n.channel;
    tasks.push(nt);
    if (r.agent && agents.has(r.agent)) fire(r.agent, r.task_id, nt);
    stats.new_tasks++;
  }

  // Alerts an agent raises for the owner's Needs-You-Know feed (written with the ledgers).
  for (const al of r.alerts ?? []) alertsOut.push({ level: al.level ?? 'warning', title: al.title ?? '', detail: al.detail ?? '', agent: r.agent ?? '', task_id: r.task_id, at: now, resolved: false });

  for (const ev of r.evaluations ?? []) {
    const target = tasks.find((x) => x.id === ev.task_id);
    if (!target) continue;
    target.score = ev.score;
    target.review = ev.note ?? '';
    for (const x of transitions) if (x.task_id === ev.task_id) x.score = ev.score;
    if (ev.score < 3 && (target.attempts ?? 0) < 2) target.status = 'todo'; // send back once for a redo
    stats.evaluations++;
  }

  // The agent finished: its heartbeat is dropped after the save; log the event for the live control room.
  if (r.task_id) heartbeats.push(path.join(runs, `${r.task_id}.start`));
  events.push({ at: now, agent: r.agent ?? t?.agent ?? '', product: slug, task_id: r.task_id, kind: String(r.task_id).startsWith('EV-') ? 'review' : (r.status === 'blocked' ? 'blocked' : 'done'), text: (r.summary ?? '').slice(0, 160) });
  for (const a of r.approvals ?? []) events.push({ at: now, agent: r.agent ?? '', product: slug, task_id: r.task_id, kind: 'approval', text: `Waiting for approval: ${a.title ?? ''}`.slice(0, 160) });
}

// Regular runs first, then reviewer files, so a review can name an approval created in this pass.
for (const f of [...files.filter((x) => !isReviewFile(x)), ...files.filter(isReviewFile)]) {
  let r, raw;
  try { raw = fs.readFileSync(path.join(runs, f), 'utf8'); r = JSON.parse(raw); } catch (e) { stats.rejected.push(`${f}: ${e.message}`); continue; }
  const key = `${f}:${crypto.createHash('sha256').update(raw).digest('hex')}`;
  // Applied in an earlier pass (its move failed, or the process died before it): only retry the move.
  if (appliedIndex[key]) { stats.duplicates++; moves.push([path.join(runs, f), path.join(applied, `${appliedIndex[key]}-${f}`)]); continue; }
  const snap = snapshot();
  try {
    if (isReviewFile(f)) applyReview(f, r); else applyRun(f, r);
    moves.push([path.join(runs, f), path.join(applied, `${stamp}-${f}`)]);
    indexAdds.push(key);
  } catch (e) {
    restore(snap);
    failed.push([f, e?.message ?? String(e)]);
    stats.failed.push(`${f}: ${e?.message ?? e}`);
  }
}

// Test seam: stands in for a writer that does not take the product lock (it changes approvals.json
// between this pass's read and its save). Unset in normal runs.
if (process.env.OM_TEST_APPROVALS_BEFORE_SAVE) fs.copyFileSync(process.env.OM_TEST_APPROVALS_BEFORE_SAVE, path.join(dir, 'approvals.json'));

// Read every ledger that gets merged before writing any, so an unreadable one stops the whole pass.
const alertsFile = path.join(dir, 'alerts.json');
const alerts = alertsOut.length ? loadFile(alertsFile, 'alerts.json') : null;
// approvals.json: the current file plus this pass's new approvals and its verdicts on items still pending.
const fresh = load('approvals.json');
const mine = new Map(approvals.map((x) => [x?.id, x]));
const mergedApprovals = fresh.map((x) => {
  // Only for an item this pass read from disk: a verdict on a new approval whose id a concurrent writer
  // took meanwhile belongs to that new approval (renumbered below), never to the other writer's item.
  const ap = x && reviewed.has(x.id) && knownApprovalIds.has(x.id) ? mine.get(x.id) : null;
  return ap && x.status === 'pending' ? { ...x, compliance: ap.compliance, review_notes: ap.review_notes, compliance_by: ap.compliance_by, compliance_at: ap.compliance_at } : x;
});
const taken = new Set(mergedApprovals.map((x) => x?.id));
for (const ap of approvals) {
  if (knownApprovalIds.has(ap?.id)) continue;
  if (taken.has(ap.id)) {
    if (!autoApprovalIds.has(ap.id)) continue; // an agent-named id that now exists: the existing item stays
    ap.id = nextId(mergedApprovals, 'A');
  }
  mergedApprovals.push(ap);
  taken.add(ap.id);
}

save('tasks.json', tasks);
save('approvals.json', mergedApprovals);
save('experiments.json', experiments);
save('transitions.json', transitions.slice(-2000));
if (alerts) writeAtomic(alertsFile, JSON.stringify(alerts.concat(alertsOut), null, 2));
if (indexAdds.length) {
  for (const k of indexAdds) appliedIndex[k] = stamp;
  writeAtomic(indexFile, JSON.stringify(Object.fromEntries(Object.entries(appliedIndex).slice(-5000)), null, 2));
}
if (events.length) fs.appendFileSync(path.join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');

// Only now, with the ledgers on disk, move the run files out of the queue.
const moveSafe = (from, to) => { try { fs.renameSync(from, to); } catch (e) { if (e.code !== 'ENOENT') stats.rejected.push(`${path.basename(from)}: could not move (${e.message})`); } };
for (const [from, to] of moves) moveSafe(from, to);
for (const hb of heartbeats) fs.rmSync(hb, { force: true });
if (failed.length) {
  const failedDir = path.join(runs, 'failed');
  fs.mkdirSync(failedDir, { recursive: true });
  for (const [f, error] of failed) {
    moveSafe(path.join(runs, f), path.join(failedDir, `${stamp}-${f}`));
    fs.writeFileSync(path.join(failedDir, `${stamp}-${f.replace(/\.json$/, '')}.error.txt`), `${now}\n${f}\n${error}\n`);
  }
}
release();
console.log(JSON.stringify(stats));
