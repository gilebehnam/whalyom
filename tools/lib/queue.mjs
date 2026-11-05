// The hub's job queue (state/queue): onboard-<slug>.json (written by tools/instant-onboard.mjs when a site
// installs Whalyom) and respond-<slug>.json (written by tools/funnel.mjs and tools/inbox.mjs when new leads
// wait). A job runs as <name>.json.running and ends as .done or .failed. Pure helpers, no timers, so the
// hub's selection and crash recovery can be tested without starting tools/hub-service.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from './env.mjs';

export const ONBOARD_RE = /^onboard-[a-z0-9-]+\.json$/;
export const RESPOND_RE = /^respond-[a-z0-9-]+\.json$/;
// flow-<slug>--<workflow>.json: a workflow the operating mode scheduled (tools/ai-modes.mjs schedule).
export const FLOW_RE = /^flow-[a-z0-9-]+--om-[a-z0-9-]+\.json$/;
export const MAX_ATTEMPTS = 3;
const APPROVED = /^(approved|auto-approved|approved-manual|executed)$/;

// A site that reached the hub through the public snippet without being on OM_EDGE_DOMAINS (needs_owner)
// gets its AI onboarding only after the owner approves it (approval channel "ai-onboarding"). The slug is
// always the one in the file name, never a field inside the job, so a job cannot point the gate at
// another product's approval.
export function jobReady({ queueDir, productsDir, file }) {
  const job = readJson(path.join(queueDir, file), null);
  if (!job || typeof job !== 'object') return false; // unreadable: wait (it may be mid-write)
  if (!job.needs_owner) return true;
  const slug = slugOf(file);
  return readJson(path.join(productsDir, slug, 'approvals.json'), []).some((a) => a?.channel === 'ai-onboarding' && APPROVED.test(a.status ?? ''));
}

export const slugOf = (file) => file.replace(/^(onboard|respond|flow)-/, '').replace(/--om-[a-z0-9-]+\.json$/, '').replace(/\.json$/, '');

// The next job to start: onboardings first (only ready ones), then lead replies. Returns {file, slug, respond} or null.
export function nextQueueJob({ queueDir, productsDir }) {
  const files = fs.existsSync(queueDir) ? fs.readdirSync(queueDir) : [];
  const onboard = files.filter((f) => ONBOARD_RE.test(f)).sort().find((file) => jobReady({ queueDir, productsDir, file }));
  const file = onboard ?? files.filter((f) => RESPOND_RE.test(f)).sort()[0] ?? files.filter((f) => FLOW_RE.test(f)).sort()[0] ?? null;
  if (!file) return null;
  const flow = file.startsWith('flow-') ? file.match(/--(om-[a-z0-9-]+)\.json$/)[1] : null;
  return flow ? { file, slug: slugOf(file), respond: false, flow, kind: 'flow' } : { file, slug: slugOf(file), respond: file.startsWith('respond-') };
}

// Raises (or refreshes) one unresolved alert in state/system-alerts.json for Needs You Know.
export function raiseSystemAlert(alertsFile, { key, title, detail, level = 'warning', at = new Date().toISOString() }) {
  try {
    fs.mkdirSync(path.dirname(alertsFile), { recursive: true });
    const alerts = readJson(alertsFile, []).filter((a) => !(a.source === 'hub' && a.key === key && !a.resolved));
    alerts.push({ level, key, title, detail, source: 'hub', at, resolved: false });
    writeJson(alertsFile, alerts);
  } catch { /* alerts are best effort; the hub log has the same line */ }
}

// Crash recovery, run once at hub start (after the one-hub-per-checkout check): a <name>.json.running left
// by a hub that died (reboot, logoff, kill) goes back to <name>.json with attempts + 1. A job that was
// already interrupted MAX_ATTEMPTS times goes to .failed with a system alert, so a poison job cannot loop.
// Returns {requeued: [names], failed: [names]}.
export function recoverQueue(queueDir, { maxAttempts = MAX_ATTEMPTS, alertsFile = null, log = () => {}, now = new Date().toISOString() } = {}) {
  const res = { requeued: [], failed: [] };
  if (!fs.existsSync(queueDir)) return res;
  for (const f of fs.readdirSync(queueDir).sort()) {
    const name = f.slice(0, -'.running'.length);
    if (!f.endsWith('.running') || !(ONBOARD_RE.test(name) || RESPOND_RE.test(name))) continue;
    const running = path.join(queueDir, f);
    const job = readJson(running, null);
    const attempts = Number.isInteger(job?.attempts) && job.attempts > 0 ? job.attempts : 0;
    const fail = (why) => {
      try { fs.renameSync(running, path.join(queueDir, `${name}.failed`)); } catch (e) { log(`queue: could not move ${f} (${e.code ?? e.message})`); return; }
      res.failed.push(name);
      log(`queue: ${name} failed (${why})`);
      if (alertsFile) raiseSystemAlert(alertsFile, { key: `hub-queue-${name}`, title: `Hub: queued job ${name} gave up`, detail: `${why}. Fix the cause, then rename state/queue/${name}.failed to ${name} (remove "attempts") to run it again.`, at: now });
    };
    if (!job || typeof job !== 'object') { fail('the job file is unreadable'); continue; }
    if (attempts >= maxAttempts) { fail(`interrupted ${attempts} times by a hub restart`); continue; }
    try {
      writeJson(running, { ...job, attempts: attempts + 1, requeued_at: now });
      fs.renameSync(running, path.join(queueDir, name));
    } catch (e) { log(`queue: could not requeue ${f} (${e.code ?? e.message})`); continue; }
    res.requeued.push(name);
    log(`requeued ${name} after hub restart (attempt ${attempts + 1} of ${maxAttempts})`);
  }
  return res;
}
