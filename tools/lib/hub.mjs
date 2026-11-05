// The parts of the Whalyom hub (tools/hub-service.mjs) that decide things, kept here so they can be tested
// without starting the hub: the single-instance pid file, the tool runner with its in-flight guard, and the
// igniter that starts queued headless Claude Code runs one at a time under a watchdog.
import { execFile as nodeExecFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runClaude as defaultRunClaude, runCostFromLog } from './claude-run.mjs';
import { takeLease as defaultTakeLease, releaseLease as defaultReleaseLease } from './lock.mjs';
import { nextQueueJob, raiseSystemAlert } from './queue.mjs';
import { canSpend as defaultCanSpend, recordSpend as defaultRecordSpend, jobCost as defaultJobCost } from '../ai-modes.mjs';

const minutes = (v, d) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) && n > 0 ? n : d; };

// ── Single instance ──
// state/hub.pid holds {pid, host, started_at, heartbeat_at}; the hub rewrites heartbeat_at every minute.
// The file outlives a reboot (no exit handler runs when the OS ends the process) and Windows reuses pids,
// so a live pid alone proves nothing: the file is stale when the host differs, the pid is dead, or the
// heartbeat is older than HEARTBEAT_STALE_MS. The old bare-number format is stale when its pid is dead.
export const HEARTBEAT_STALE_MS = 3 * 60 * 1000;
export const readHubPid = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
export function hubPidStale(info, nowMs = Date.now(), alive = () => false, host = os.hostname()) {
  if (typeof info === 'number') return !alive(info);
  if (!info || typeof info !== 'object' || !Number.isInteger(info.pid) || info.pid <= 0) return true;
  if (info.host && info.host !== host) return true;
  if (!alive(info.pid)) return true;
  const beat = Date.parse(info.heartbeat_at ?? info.started_at ?? '');
  return !Number.isFinite(beat) || nowMs - beat > HEARTBEAT_STALE_MS;
}
export const hubPidInfo = ({ startedAt, nowMs = Date.now(), pid = process.pid, host = os.hostname() }) =>
  ({ pid, host, started_at: new Date(startedAt).toISOString(), heartbeat_at: new Date(nowMs).toISOString() });

// ── Tool runner ──
// One copy per script at a time (sync-sites runs every 5 minutes and may take longer), a 10-minute
// timeout, and for the hourly daemon.mjs a timeout tied to its own budget (OM_HUB_DAEMON_TIMEOUT_MIN,
// default 55, under the 60-minute interval).
export const TOOL_TIMEOUT_MS = 10 * 60 * 1000;
export const toolTimeoutMs = (script, env = process.env) => (script === 'daemon.mjs' ? minutes(env.OM_HUB_DAEMON_TIMEOUT_MIN, 55) * 60 * 1000 : TOOL_TIMEOUT_MS);
export function createRunner({ execFile = nodeExecFile, root, log = () => {}, env = process.env, node = process.execPath } = {}) {
  const inFlight = new Map();
  const runTool = (script, args = []) => {
    if (inFlight.has(script)) { log(`${script}: still running (pid ${inFlight.get(script)?.pid ?? '?'}); skipped this turn`); return null; }
    const timeout = toolTimeoutMs(script, env);
    const child = execFile(node, [path.join(root, 'tools', script), ...args], { cwd: root, timeout }, (err, out, errOut) => {
      inFlight.delete(script);
      if (err?.killed && err.signal) return log(`${script}: killed after ${Math.round(timeout / 60000)} min (timeout; its last step did not finish)`);
      log(`${script}: ${err ? `failed ${String(errOut || err.message).slice(0, 300)}` : String(out).trim().split(/\r?\n/).at(-1).slice(0, 300)}`);
    });
    inFlight.set(script, child);
    return child;
  };
  runTool.inFlight = inFlight;
  return runTool;
}

// Ends a process and its children. On Windows claude.cmd runs under cmd, so killing the direct child would
// leave claude itself running: taskkill /T takes the whole tree.
export function killTree(child, { platform = process.platform } = {}) {
  if (!child?.pid) return;
  if (platform === 'win32') { nodeExecFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => { /* already gone */ }); return; }
  try { child.kill('SIGTERM'); } catch { /* already gone */ }
}

// ── Igniter (queued onboardings, lead replies, the hosted daily cycle) ──
// Each headless run has a deadline: OM_IGNITE_TIMEOUT_MIN (default 120) for onboarding and lead replies,
// OM_DAILY_TIMEOUT_MIN (default 240) for the daily cycle. A run past it is killed, its job ends as .failed
// (or the daily lease is released) and the next job can start.
export const KILL_GRACE_MS = 2 * 60 * 1000;
export const DAILY_LEASE_MS = 4 * 3600 * 1000;
export const runLimitMs = (kind, env = process.env) => (kind === 'daily' ? minutes(env.OM_DAILY_TIMEOUT_MIN, 240) : minutes(env.OM_IGNITE_TIMEOUT_MIN, 120)) * 60 * 1000;
export const overdue = (run, nowMs = Date.now(), env = process.env) => !!run && nowMs - run.startedAt > runLimitMs(run.kind, env);

export const onboardPrompt = (slug) => `Use the whalyom skill. Site "${slug}" just installed Whalyom (see products/${slug}/reports/instant-audit.md and the booster approvals). Run onboarding in live mode (om-onboard workflow, or the onboarding wave by hand with heartbeats), then one wave of up to 6 ready tasks starting with the quick wins, with tools/apply-results.mjs after each agent. Respect claims.md and the autonomy policy; publish nothing without approval. Leave the plan and the first decisions for the owner in Needs You Know.`;
// A workflow the operating mode scheduled; args (with the mode's reviewers) come from the job file.
export const flowPrompt = (slug, flow, args = {}) => `Use the whalyom skill. Run the saved workflow ${flow} for product "${slug}" with the Workflow tool (args ${JSON.stringify({ ...args, slug, now: '<current ISO time>' })}), then \`node tools/apply-results.mjs ${slug}\`, \`node tools/policy.mjs ${slug}\` and \`node tools/execute.mjs ${slug}\`. Drafts and approvals only; respect claims.md, consent and the autonomy policy. Keep it lean: no extra agents beyond the workflow.`;
export const respondPrompt = (slug) => `Use the whalyom skill. Product "${slug}" has new leads waiting for a first reply (products/${slug}/funnel/next-actions.json). Run the om-lead-to-sale workflow for it (args {slug: "${slug}", now: "<current ISO time>"}), then \`node tools/policy.mjs ${slug}\`, \`node tools/execute.mjs ${slug}\` and \`node tools/funnel.mjs ${slug}\`. Every reply is a draft plus a send approval; the autonomy policy (and earned autonomy, if the owner turned it on) decides what goes out without a click. Respect claims.md and consent.`;
export const DAILY_PROMPT = 'Use the whalyom skill. Daily cycle: first import the owner\'s claude.ai dashboard decisions (whalyom decisions command) so approvals made there take effect; then run auto-all for every product with stage "active" (om-portfolio workflow), then the om-knowledge-refresh workflow and the om-evolve workflow (maxNew 2). Respect claims.md, the caps and the autonomy policy; publish, send or spend nothing without approval. Finish with node tools/build-agents.mjs and npm test; if tests fail, roll back today\'s evolution changes.';

export function createIgniter({
  root, queueDir = path.join(root, 'state', 'queue'), productsDir = path.join(root, 'products'), stateDir = path.join(root, 'state'),
  alertsFile = path.join(stateDir, 'system-alerts.json'), log = () => {}, env = process.env, now = () => Date.now(),
  runClaude = defaultRunClaude, takeLease = defaultTakeLease, releaseLease = defaultReleaseLease, kill = killTree,
  canSpend = defaultCanSpend, recordSpend = defaultRecordSpend, jobCost = defaultJobCost,
  open = (file) => fs.openSync(file, 'a'), close = (fd) => fs.closeSync(fd),
} = {}) {
  let run = null;
  let backoffUntil = 0;
  const move = (from, to) => { try { fs.renameSync(from, to); return true; } catch (e) { log(`queue: could not move ${path.basename(from)} (${e.code ?? e.message})`); return false; } };
  const label = (r) => (r.kind === 'daily' ? 'daily cycle' : `${r.kind === 'respond' ? 'lead reply' : r.kind === 'flow' ? r.flow : 'onboarding'} ${r.slug}`);

  // Starts a headless run whose output goes to logFile. The descriptor is closed once the child has its own
  // copy (or failed to start), so a hub that runs for months does not leak one per run.
  const start = (r, prompt, logFile, extra = {}) => {
    const out = open(logFile);
    let closed = false;
    const closeOut = () => { if (closed) return; closed = true; try { close(out); } catch { /* already closed */ } };
    let child;
    try { child = runClaude(prompt, { cwd: root, out, env, ...extra }); } catch (e) { closeOut(); throw e; }
    child.once('spawn', () => { r.spawned = true; closeOut(); });
    child.once('error', closeOut);
    child.once('exit', closeOut);
    r.child = child;
    r.logFile = logFile;
    r.startedAt = now();
    run = r;
    return child;
  };

  // Ends the current run once: frees the slot, moves the job file, releases the daily lease.
  const settle = (r, outcome, why) => {
    if (r.settled) return;
    r.settled = true;
    if (run === r) run = null;
    if (r.kind === 'daily') { releaseLease({ holder: 'hub-daily' }); log(`daily cycle finished (${why})`); return; }
    // The run used Platform tokens whether it succeeded or not: book its planned cost against the budget.
    if (outcome !== 'requeue' && (r.usd || r.logFile)) {
      const real = r.logFile ? runCostFromLog(r.logFile) : null;
      try { recordSpend({ kind: r.kind, slug: r.slug, flow: r.flow ?? null, usd: real ? real.usd : r.usd, outcome, real: Boolean(real), tokens: real ? { input: real.input_tokens, output: real.output_tokens, cache_read: real.cache_read_tokens } : null }, path.join(stateDir, 'ai-spend.jsonl')); } catch (e) { log(`spend ledger: ${e.message}`); }
    }
    log(`${label(r)} finished (${why})`);
    const running = path.join(queueDir, `${r.next}.running`);
    if (outcome === 'requeue') move(running, path.join(queueDir, r.next));
    else move(running, path.join(queueDir, `${r.next}.${outcome}`));
  };

  const watch = (r) => {
    r.child.on('error', (e) => {
      if (r.spawned) { log(`${label(r)}: process error (${e.message})`); return; } // a failed kill, not a failed start
      log(`${label(r)}: claude not available (${e.message}); it will run with the next daily routine`);
      if (r.kind !== 'daily') backoffUntil = now() + 30 * 60 * 1000;
      settle(r, 'requeue', 'did not start');
    });
    r.child.on('exit', (code, signal) => settle(r, r.timedOutAt || code !== 0 ? 'failed' : 'done', r.timedOutAt ? `killed after ${Math.round(runLimitMs(r.kind, env) / 60000)} min` : (code ?? signal)));
  };

  // The watchdog, on the 60-second tick: renews the daily lease, kills a run past its deadline, and frees the
  // slot if a killed run still has not exited after KILL_GRACE_MS.
  const watchdog = () => {
    const r = run;
    if (!r) return;
    const t = now();
    if (r.kind === 'daily' && !r.timedOutAt) { const l = takeLease({ holder: 'hub-daily', ttlMs: DAILY_LEASE_MS }); if (!l.ok) log(`daily cycle: could not renew the scheduler lease (${l.holder ?? l.reason})`); }
    if (!r.timedOutAt && overdue(r, t, env)) {
      r.timedOutAt = t;
      const mins = Math.round(runLimitMs(r.kind, env) / 60000);
      log(`${label(r)}: no result after ${mins} min; killing pid ${r.child.pid}`);
      raiseSystemAlert(alertsFile, { key: `hub-timeout-${r.kind}${r.slug ? `-${r.slug}` : ''}`, title: `Hub: ${label(r)} was stopped after ${mins} min`, detail: `The headless Claude Code run did not finish in time (state/${r.kind === 'daily' ? 'daily-run' : `ignite-${r.slug}`}.log has its output).${r.next ? ` Its job is in state/queue/${r.next}.failed.` : ''}`, at: new Date(t).toISOString() });
      kill(r.child);
    } else if (r.timedOutAt && t - r.timedOutAt > KILL_GRACE_MS) {
      log(`${label(r)}: pid ${r.child.pid} did not exit after the kill; freeing the slot`);
      try { r.child.kill('SIGKILL'); } catch { /* ignore */ }
      settle(r, 'failed', 'killed, did not exit');
    }
  };

  // Queued onboardings, then lead replies: one headless run at a time.
  const igniteNext = () => {
    watchdog();
    if (env.OM_AUTO_IGNITE === '0' || run || now() < backoffUntil) return null;
    const job = nextQueueJob({ queueDir, productsDir });
    if (!job) return null;
    // The monthly AI budget of the operating mode (config/ai-modes.json) is a hard stop.
    const spec = (() => { try { return JSON.parse(fs.readFileSync(path.join(queueDir, job.file), 'utf8')); } catch { return {}; } })();
    const usd = Number(jobCost({ kind: job.kind, flow: job.flow, args: spec.args, leads: spec.leads })) || 0;
    const budget = canSpend(usd, { file: path.join(stateDir, 'ai-spend.jsonl'), env });
    if (!budget.ok) {
      log(`${job.file}: waiting, AI budget ${budget.spent} of ${budget.budget} USD used this month`);
      raiseSystemAlert(alertsFile, { key: 'ai-budget', title: `AI budget reached: ${budget.spent} of ${budget.budget} USD this month`, detail: 'Queued AI runs wait until next month. Raise monthly_budget_usd in config/ai-modes.json or switch mode with node tools/ai-modes.mjs set <mode>.', level: 'warning' });
      backoffUntil = now() + 60 * 60 * 1000;
      return null;
    }
    if (!move(path.join(queueDir, job.file), path.join(queueDir, `${job.file}.running`))) return null;
    const r = { kind: job.kind ?? (job.respond ? 'respond' : 'onboard'), slug: job.slug, next: job.file, flow: job.flow ?? null, usd };
    const prompt = r.kind === 'flow' ? flowPrompt(job.slug, job.flow, spec.args) : r.kind === 'respond' ? respondPrompt(job.slug) : onboardPrompt(job.slug);
    try { start(r, prompt, path.join(stateDir, `ignite-${job.slug}.log`)); }
    catch (e) { log(`${label(r)}: could not start (${e.message})`); move(path.join(queueDir, `${job.file}.running`), path.join(queueDir, job.file)); backoffUntil = now() + 30 * 60 * 1000; return null; }
    watch(r);
    log(`${label(r)} started (pid ${r.child.pid})`);
    return r;
  };

  // Hosted mode: with OM_DAILY_RUN_HOUR (0–23, UTC) the hub runs the daily agent cycle itself, once a day,
  // after onboardings. Only one scheduler runs it (the cloud routine, the local task or GitHub Actions may
  // also be set up), so it takes the 'hub-daily' lease and renews it while the run is alive.
  let lastDaily = '';
  const dailyTick = () => {
    const hour = env.OM_DAILY_RUN_HOUR;
    if (hour === undefined || hour === '' || run) return null;
    const d = new Date(now());
    const day = d.toISOString().slice(0, 10);
    if (d.getUTCHours() !== Number(hour) || lastDaily === day) return null;
    const lease = takeLease({ holder: 'hub-daily', ttlMs: DAILY_LEASE_MS });
    if (!lease.ok) { log(`daily cycle skipped: scheduler lease held by ${lease.holder ?? lease.reason}`); lastDaily = day; return null; }
    lastDaily = day;
    const r = { kind: 'daily', slug: null, next: null };
    try { start(r, DAILY_PROMPT, path.join(stateDir, 'daily-run.log'), { extraAllowed: ['Bash(npm test)'] }); }
    catch (e) { log(`daily cycle: could not start (${e.message})`); releaseLease({ holder: 'hub-daily' }); return null; }
    watch(r);
    log(`daily cycle started (pid ${r.child.pid})`);
    return r;
  };

  return { igniteNext, dailyTick, watchdog, current: () => run, stop: () => { if (!run) return; kill(run.child); try { run.child.kill(); } catch { /* ignore */ } } };
}
