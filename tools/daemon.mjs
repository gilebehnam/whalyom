// Always-on deterministic daemon (no LLM). One cycle, or `--loop <minutes>` to repeat.
// Per active product: metrics -> social-inbox (before funnel, so its leads and funnel updates count in the
// same pass) -> funnel -> lead-score -> inbox -> sequences -> reallocate (after metrics and funnel) ->
// apply-results (so their runs/SOCIAL-*, LEADSCORE-*, INBOX-*, SEQ-*, REALLOC-* files reach the ledgers as
// pending approvals before policy and execute) -> crm --propose -> creators -> free-engine -> budget ->
// [killswitch] -> policy -> autonomy-report -> execute -> attribution -> ai-visibility -> bandit ->
// competitor-watch (at most once a UTC day per product, see daemon-stamps.json) -> learn.
// reallocate and social-inbox only write drafts and runs/ files: every budget change or reply they propose
// still goes through approvals, policy and execute. autonomy-report only reads approvals and writes reports.
// Run files written after apply-results (crm, creators, bandit, competitor-watch) merge in the next cycle.
// Every step is its own child process: a failing step is logged and the next one still runs; a new
// step whose script is missing is left out.
// Then once: knowledge cycle (fetches feeds when due, merges verified facts, rebuilds briefs),
// integrations (catalog into state/integrations.json), outcomes, routing (advisory agent ranking from the
// outcomes reports into state/agent-routing.json), product-review, needs-you-know,
// build-state, live-snapshot --idle.
// Kill switch: OM_KILL=1 makes a cycle do nothing but log.
// One scheduler at a time: a cycle runs only when it holds or can take the lease in
// state/scheduler.json ({holder, pid, host, until}; OM_SCHEDULER_FILE overrides the path,
// OM_SCHEDULER_ID names the holder). A one-shot cycle releases the lease when it ends; --loop keeps
// renewing it. Child steps get OM_SCHEDULER_HOLDER so execute.mjs checks the lease too.
// OM_SKIP_EXECUTE=1 runs everything except execute (the GitHub Actions job sets it when the hub
// is the active scheduler, OM_HUB_ACTIVE=1).
// Log rotation: once per cycle (lease holder only) every products/<slug>/events.jsonl and state/*.log is
// rotated to <name>.1 past OM_LOG_MAX_BYTES (default 5 MB), keeping OM_LOG_KEEP old copies (default 3).
// OM_DAEMON_ONLY=<slug>[,<slug>] limits the per-product steps to those products (the tests use it).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { takeLease, releaseLease, schedulerId } from './lib/lock.mjs';
import { rotate, rotationDefaults, logsIn } from './lib/rotate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tools = path.join(root, 'tools');
const logFile = path.join(root, 'state', 'daemon-log.jsonl');
const STEP_TIMEOUT_MS = 5 * 60 * 1000;
const KEEP_LINES = 500;
const only = (process.env.OM_DAEMON_ONLY ?? '').split(',').filter(Boolean);

const holder = schedulerId();
const childEnv = { ...process.env, OM_SCHEDULER_HOLDER: holder };
const run = (script, args) => new Promise((resolve) => {
  const t0 = Date.now();
  execFile(process.execPath, [path.join(tools, script), ...args], { cwd: root, env: childEnv, timeout: STEP_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
    const out = { step: script.replace(/\.mjs$/, ''), ok: !err, ms: Date.now() - t0 };
    if (err) out.error = String(stderr || err.message).trim().split(/\r?\n/).slice(-3).join(' | ').slice(0, 400);
    resolve(out);
  });
});

function activeProducts() {
  const dir = path.join(root, 'products');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name)
    .filter((s) => !only.length || only.includes(s))
    .filter((slug) => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, slug, 'product.json'), 'utf8')).stage === 'active'; } catch { return false; }
    })
    .sort();
}

// Daemon-owned per-product stamps (products/<slug>/daemon-stamps.json: {"<step>": "YYYY-MM-DD"}), used
// to keep slow, network-bound steps such as competitor-watch to once a day. Holds dates only.
const stampFile = (slug) => path.join(root, 'products', slug, 'daemon-stamps.json');
function readStamps(slug) {
  try { const j = JSON.parse(fs.readFileSync(stampFile(slug), 'utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { return {}; }
}
function writeStamp(slug, step, day) {
  try {
    const f = stampFile(slug);
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ ...readStamps(slug), [step]: day }, null, 2) + '\n');
    fs.renameSync(tmp, f);
  } catch (e) { console.error(`daemon: could not write stamp for ${slug}: ${e.message}`); }
}

function appendLog(entry) {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
    const lines = fs.readFileSync(logFile, 'utf8').split(/\r?\n/).filter(Boolean);
    if (lines.length > KEEP_LINES) fs.writeFileSync(logFile, lines.slice(-KEEP_LINES).join('\n') + '\n');
  } catch (e) { console.error(`daemon: could not write log: ${e.message}`); }
}

// Rotates every product's events.jsonl and the state/*.log files. Returns the rotated paths (relative).
export function rotateLogs({ base = root, opts = rotationDefaults() } = {}) {
  const files = [];
  const pdir = path.join(base, 'products');
  try { for (const d of fs.readdirSync(pdir, { withFileTypes: true })) if (d.isDirectory()) files.push(path.join(pdir, d.name, 'events.jsonl')); } catch { /* no products yet */ }
  files.push(...logsIn(path.join(base, 'state')));
  const rel = (f) => path.relative(base, f).split(path.sep).join('/');
  return files.map((f) => rotate(f, opts)).filter((r) => r.rotated || String(r.reason ?? '').startsWith('error'))
    .map((r) => (r.rotated ? rel(r.file) : `${rel(r.file)} (${r.reason})`));
}

// leaseMs: how long the lease is held; release: give it back when the cycle ends (one-shot mode).
export async function cycle({ leaseMs = 30 * 60 * 1000, release = true } = {}) {
  const started = new Date();
  const summary = { ts: started.toISOString(), killed: false, products: [], global: [], ok: true };
  if (process.env.OM_KILL === '1') {
    summary.killed = true;
    appendLog(summary);
    return summary;
  }
  const lease = takeLease({ holder, ttlMs: leaseMs });
  if (!lease.ok) {
    summary.skipped = lease.holder ? `scheduler lease held by ${lease.holder} until ${lease.until}` : `scheduler lease unavailable (${lease.reason})`;
    appendLog(summary);
    return summary;
  }
  summary.scheduler = holder;
  summary.rotated = rotateLogs();
  try {
    await runProducts(summary, leaseMs);
  } finally {
    if (release) releaseLease({ holder });
  }
  summary.ms = Date.now() - started.getTime();
  appendLog(summary);
  return summary;
}

async function runProducts(summary, leaseMs) {
  const hasKillswitch = fs.existsSync(path.join(tools, 'killswitch.mjs'));
  const opt = (s, args = []) => (fs.existsSync(path.join(tools, s)) ? [[s, args]] : []);
  const today = new Date().toISOString().slice(0, 10);
  const skipExecute = process.env.OM_SKIP_EXECUTE === '1';
  if (skipExecute) summary.execute = 'skipped (OM_SKIP_EXECUTE=1: another scheduler executes approvals)';
  for (const slug of activeProducts()) {
    // Renew before each product so a long cycle keeps its lease; stop if another scheduler took it.
    if (!takeLease({ holder, ttlMs: leaseMs }).ok) { summary.lease_lost = true; break; }
    const steps = [];
    try {
      const seq = [
        ['metrics.mjs'], ...opt('social-inbox.mjs'), ['funnel.mjs'],
        ...opt('lead-score.mjs'), ...opt('inbox.mjs'), ...opt('sequences.mjs'), ...opt('reallocate.mjs'),
        ['apply-results.mjs'],
        ...opt('crm.mjs', ['--propose']), ...opt('creators.mjs'),
        ['free-engine.mjs'], ['budget.mjs'], ...(hasKillswitch ? [['killswitch.mjs']] : []), ['policy.mjs'], ...opt('autonomy-report.mjs'), ...(skipExecute ? [] : [['execute.mjs']]),
        ...opt('attribution.mjs'), ...opt('ai-visibility.mjs'), ...opt('bandit.mjs'),
        ...opt('competitor-watch.mjs', ['--task', `CW-${today}`]),
        ['learn.mjs'],
      ];
      for (const [s, args = []] of seq) {
        if (s === 'competitor-watch.mjs' && readStamps(slug)['competitor-watch'] === today) {
          steps.push({ step: 'competitor-watch', ok: true, ms: 0, skipped: `already ran ${today}` });
          continue;
        }
        const r = await run(s, [slug, ...args]);
        if (s === 'competitor-watch.mjs' && r.ok) writeStamp(slug, 'competitor-watch', today);
        steps.push(r);
      }
    } catch (e) { steps.push({ step: 'daemon', ok: false, error: e.message }); }
    summary.products.push({ slug, ok: steps.every((s) => s.ok), steps });
  }
  for (const [s, a] of [['knowledge.mjs', ['cycle']], ...(fs.existsSync(path.join(tools, 'integrations.mjs')) ? [['integrations.mjs', []]] : []), ['outcomes.mjs', []], ['ai-modes.mjs', ['schedule']], ...opt('routing.mjs'), ['product-review.mjs', []], ['needs-you-know.mjs', []], ['build-state.mjs', []], ['live-snapshot.mjs', ['--idle']]]) summary.global.push(await run(s, a));
  summary.ok = summary.products.every((p) => p.ok) && summary.global.every((s) => s.ok);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const i = process.argv.indexOf('--loop');
  const minutes = i > -1 ? Number(process.argv[i + 1]) : 0;
  if (i > -1 && !(minutes > 0)) { console.error('Usage: node tools/daemon.mjs [--loop <minutes>]'); process.exit(2); }
  if (!minutes) {
    const s = await cycle();
    console.log(JSON.stringify(s));
    process.exit(0);
  }
  // Loop mode keeps the lease between cycles (interval + 10 min margin) and gives it back on exit.
  const giveBack = () => { try { releaseLease({ holder }); } catch { /* ignore */ } };
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { giveBack(); process.exit(0); });
  process.on('exit', giveBack);
  for (;;) {
    try { console.log(JSON.stringify(await cycle({ leaseMs: (minutes + 10) * 60 * 1000, release: false }))); } catch (e) { console.error(`daemon cycle crashed: ${e.message}`); }
    await new Promise((r) => setTimeout(r, minutes * 60 * 1000));
  }
}
