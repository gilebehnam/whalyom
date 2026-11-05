// Whalyom Hub service: the always-on process on the owner's computer.
//   - keeps the Command Center server (tools/server.mjs) running on http://localhost:4321, restarting it if it stops;
//   - every 5 minutes pulls every attached site's satellite (tools/sync-sites.mjs);
//   - every hour runs the deterministic cycle for active products (tools/daemon.mjs);
//   - with OM_EDGE_PORT set, runs the public edge (tools/cloud/edge.mjs) that one-line snippets talk to;
//   - every minute starts queued AI onboardings (state/queue/onboard-*.json, written when a new site
//     installs Whalyom) with a headless Claude Code run, one at a time, unless OM_AUTO_IGNITE=0, under a
//     watchdog (OM_IGNITE_TIMEOUT_MIN); jobs left .running by a hub that died are requeued at start;
// Started at login by the Startup entry that tools/install-hub.mjs creates. Logs to state/hub.log.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, root } from './lib/env.mjs';
import { pidAlive } from './lib/lock.mjs';
import { recoverQueue } from './lib/queue.mjs';
import { createRunner, createIgniter, hubPidStale, hubPidInfo, readHubPid } from './lib/hub.mjs';

loadEnv();
const envOr = (k, d) => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);

const logFile = path.join(root, 'state', 'hub.log');
fs.mkdirSync(path.dirname(logFile), { recursive: true });
const log = (msg) => { const line = `${new Date().toISOString()} ${msg}\n`; fs.appendFileSync(logFile, line); try { const s = fs.statSync(logFile); if (s.size > 2e6) fs.writeFileSync(logFile, fs.readFileSync(logFile, 'utf8').slice(-1e6)); } catch { /* ignore */ } };
const port = envOr('WHALYOM_PORT', '4321');

let server = null;
const startServer = () => {
  server = spawn(process.execPath, [path.join(root, 'tools', 'server.mjs'), '--port', port], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (d) => log(`server: ${String(d).trim()}`));
  server.stderr.on('data', (d) => log(`server error: ${String(d).trim()}`));
  const started = Date.now();
  server.on('exit', (code) => {
    // A server that dies at once (port taken, bad config) is retried more and more slowly, up to 5 minutes.
    serverDelay = Date.now() - started < 30000 ? Math.min(serverDelay * 2, 300000) : 5000;
    log(`server exited (${code}); restarting in ${serverDelay / 1000} s`);
    setTimeout(startServer, serverDelay);
  });
};
let serverDelay = 2500;
// One copy of each tool at a time; daemon.mjs gets a timeout under its hourly interval (lib/hub.mjs).
const runTool = createRunner({ root, log });

// One hub per checkout: a second copy (Startup entry plus a manual start) would fight over ports and queue files.
// The pid file carries a heartbeat, so a file left by a reboot (whose pid Windows may have given to another
// process) does not keep the hub from starting.
const pidFile = path.join(root, 'state', 'hub.pid');
const other = readHubPid(pidFile);
const otherPid = typeof other === 'number' ? other : other?.pid;
if (other && otherPid !== process.pid && !hubPidStale(other, Date.now(), pidAlive)) { console.error(`Whalyom hub already running (pid ${otherPid}).`); process.exit(0); }
const hubStarted = Date.now();
const ownsPidFile = () => readHubPid(pidFile)?.pid === process.pid;
const beat = () => { try { fs.writeFileSync(pidFile, JSON.stringify(hubPidInfo({ startedAt: hubStarted }))); } catch (e) { log(`hub: could not write hub.pid (${e.code ?? e.message})`); } };
beat();
process.on('exit', () => { try { if (ownsPidFile()) fs.rmSync(pidFile); } catch { /* ignore */ } });
process.on('uncaughtException', (e) => log(`hub error (kept running): ${e.stack ?? e}`));
process.on('unhandledRejection', (e) => log(`hub error (kept running): ${e?.stack ?? e}`));

log(`hub starting (pid ${process.pid})`);
// Jobs a previous hub left .running (it died mid-run: reboot, logoff, kill) go back in the queue, at most 3 times.
const queueDir = path.join(root, 'state', 'queue');
recoverQueue(queueDir, { alertsFile: path.join(root, 'state', 'system-alerts.json'), log });
startServer();
let edge = null;
// Behind a reverse proxy (hosted mode, Caddy) the edge must read the visitor address from X-Forwarded-For,
// or every visitor shares one rate limit.
const behindProxy = () => !['', '127.0.0.1', 'localhost', '::1'].includes(envOr('OM_SERVER_HOST', '')) || process.env.OM_EDGE_TRUST_PROXY === '1';
// A key created later in the Command Center lands in .env: read it from there so the edge starts without a restart.
const envFileValue = (k) => { try { return fs.readFileSync(path.join(root, '.env'), 'utf8').match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim() ?? ''; } catch { return ''; } };
const startEdge = () => {
  if (edge) return;
  if (!process.env.OM_INSTALL_KEY) { const k = envFileValue('OM_INSTALL_KEY'); if (k) process.env.OM_INSTALL_KEY = k; }
  const edgePort = envOr('OM_EDGE_PORT', '');
  if (!edgePort || !process.env.OM_INSTALL_KEY) return;
  edge = spawn(process.execPath, [path.join(root, 'tools', 'cloud', 'edge.mjs'), '--port', edgePort, ...(behindProxy() ? ['--trust-proxy'] : [])], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  log(`edge starting on port ${edgePort}${behindProxy() ? ' (trusting the proxy for visitor addresses)' : ''}`);
  edge.stdout.on('data', (d) => log(`edge: ${String(d).trim()}`));
  edge.stderr.on('data', (d) => log(`edge error: ${String(d).trim()}`));
  edge.on('exit', (code) => { log(`edge exited (${code}); restarting in 5 s`); edge = null; setTimeout(startEdge, 5000); });
};
startEdge();
// The online app (landing page, sign in, customer and admin panels: tools/cloud/web.mjs) when OM_WEB_PORT is set.
let web = null;
const startWeb = () => {
  if (web) return;
  const webPort = envOr('OM_WEB_PORT', '');
  // The free edition ships without the online app; nothing to start then.
  if (!webPort || !fs.existsSync(path.join(root, 'tools', 'cloud', 'web.mjs'))) return;
  web = spawn(process.execPath, [path.join(root, 'tools', 'cloud', 'web.mjs'), '--port', webPort], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...(behindProxy() ? { OM_WEB_TRUST_PROXY: '1' } : {}) } });
  log(`web app starting on port ${webPort}`);
  web.stdout.on('data', (d) => log(`web: ${String(d).trim()}`));
  web.stderr.on('data', (d) => log(`web error: ${String(d).trim()}`));
  web.on('exit', (code) => { log(`web app exited (${code}); restarting in 5 s`); web = null; setTimeout(startWeb, 5000); });
};
startWeb();
// Every minute: restart the edge and the web app if needed and refresh the pid-file heartbeat (only while this hub owns it).
setInterval(() => { startEdge(); startWeb(); if (ownsPidFile()) beat(); }, 60 * 1000);

// Queued onboardings and lead replies: one headless Claude Code run at a time (same prompt as the Command
// Center's Ignite), each under a deadline; the onboarding gate and the queue order live in lib/queue.mjs.
// Hosted mode: with OM_DAILY_RUN_HOUR (0–23, UTC) the hub also runs the daily agent cycle, after onboardings.
const igniter = createIgniter({ root, queueDir, log });
setInterval(igniter.igniteNext, 60 * 1000);
setInterval(igniter.dailyTick, 5 * 60 * 1000);
runTool('sync-sites.mjs');
setInterval(() => runTool('sync-sites.mjs'), 5 * 60 * 1000);
setInterval(() => runTool('daemon.mjs'), 60 * 60 * 1000);
process.on('SIGTERM', () => { server?.kill(); edge?.kill(); igniter.stop(); process.exit(0); });
