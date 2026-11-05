// Small file locks and the scheduler lease. No dependencies, sync, safe to call from any tool.
//
// Product lock (products/<slug>/.execute.lock): {pid, host, at, owner}. Taken with an exclusive create,
// so only one process holds it. A lock is stale after LOCK_STALE_MS (10 min) or when its process on
// this host is gone. A live holder on this host keeps it up to 6 x LOCK_STALE_MS and refreshes `at`
// while it runs. A stale lock is renamed aside, checked, and taken over.
//
// Scheduler lease (state/scheduler.json, or OM_SCHEDULER_FILE): {holder, pid, host, until}. Every
// scheduler (hub hourly daemon, docker --loop, local task, GitHub Actions on the same clone) takes the
// lease before it runs execute or the daily cycle. A lease is free when it is missing, expired, held
// by the same holder, or held by a dead process on this host.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { root } from './env.mjs';

export const LOCK_STALE_MS = 10 * 60 * 1000;

export const pidAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};
const sleepSync = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* ignore */ } };
const readInfo = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

export const productLockFile = (dir) => path.join(dir, '.execute.lock');
export const readLock = readInfo;

// One attempt. Returns a release() function, or null when another live process holds the lock.
// release.refresh() rewrites `at` so a long run is not judged stale; a heartbeat also calls it every
// staleMs/3 while the event loop is free (unref'd, stopped on release). A holder that is alive on this
// host keeps its lock until hardMs (default 6 x staleMs), even if it never refreshes.
// Takeover renames the stale file aside and goes on only when the renamed file is the one judged
// stale, so a fresh lock that a racing process wrote in between is put back, not deleted.
export function tryLock(file, { staleMs = LOCK_STALE_MS, hardMs = staleMs * 6, owner = '', nowMs = Date.now(), fsImpl = fs } = {}) {
  const host = os.hostname();
  const make = (ms) => JSON.stringify({ pid: process.pid, host, at: new Date(ms).toISOString(), owner });
  let body = make(nowMs);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = fsImpl.openSync(file, 'wx');
      try { fsImpl.writeSync(fd, body); } finally { fsImpl.closeSync(fd); }
      let released = false;
      const mine = () => { try { return fsImpl.readFileSync(file, 'utf8') === body; } catch { return false; } };
      const refresh = () => {
        if (released || !mine()) return false;
        const next = make(Date.now());
        try { fsImpl.writeFileSync(file, next); body = next; return true; } catch { return false; }
      };
      const timer = setInterval(refresh, Math.max(1000, Math.floor(staleMs / 3)));
      timer.unref?.();
      const release = () => {
        if (released) return;
        clearInterval(timer); process.off('exit', release);
        try { if (mine()) fsImpl.unlinkSync(file); } catch { /* already gone */ }
        released = true;
      };
      release.refresh = refresh;
      process.once('exit', release);
      return release;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let mtime, raw;
      try { mtime = fsImpl.statSync(file).mtimeMs; raw = fsImpl.readFileSync(file, 'utf8'); } catch { continue; } // vanished between calls: retry
      let info = null;
      try { info = JSON.parse(raw); } catch { /* unreadable */ }
      const at = info?.at ? Date.parse(info.at) : NaN;
      const age = nowMs - (Number.isFinite(at) ? at : mtime);
      const other = !!info && info.host === host && info.pid !== process.pid;
      const dead = other && !pidAlive(info.pid);
      // A live holder on this host keeps its lock up to the hard ceiling, refreshed or not.
      const old = age > (other && !dead ? Math.max(staleMs, hardMs) : staleMs);
      // An unreadable lock may be mid-write; only treat it as stale after a few seconds.
      if (!(old || dead || (!info && nowMs - mtime > 5000))) return null;
      const aside = `${file}.stale-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
      try { fsImpl.renameSync(file, aside); } catch { continue; } // someone else moved it first: retry
      let got = null;
      try { got = fsImpl.readFileSync(aside, 'utf8'); } catch { /* ignore */ }
      if (got === raw) { try { fsImpl.unlinkSync(aside); } catch { /* ignore */ } continue; }
      // We moved a lock that a racing process had just taken: put it back while the path is free.
      try {
        if (got !== null) {
          const fd = fsImpl.openSync(file, 'wx');
          try { fsImpl.writeSync(fd, got); } finally { fsImpl.closeSync(fd); }
        }
      } catch { /* path taken again: that holder owns it now */ }
      try { fsImpl.unlinkSync(aside); } catch { /* ignore */ }
      return null;
    }
  }
  return null;
}

// Waits up to waitMs for the lock. Returns release() or null.
export function acquireLock(file, { waitMs = 0, pollMs = 200, ...opts } = {}) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const release = tryLock(file, opts);
    if (release || Date.now() >= deadline) return release;
    sleepSync(Math.min(pollMs, Math.max(1, deadline - Date.now())));
  }
}

// ── Scheduler lease ──
export const leaseFile = () => process.env.OM_SCHEDULER_FILE || path.join(root, 'state', 'scheduler.json');
export const schedulerId = () => process.env.OM_SCHEDULER_ID || `${os.hostname()}:${process.pid}`;
export const readLease = (file = leaseFile()) => readInfo(file);

function leaseFree(cur, holder, nowMs) {
  if (!cur || !cur.holder) return true;
  if (cur.holder === holder) return true;
  const until = Date.parse(cur.until ?? '');
  if (!(until > nowMs)) return true;
  return cur.host === os.hostname() && cur.pid !== process.pid && !pidAlive(cur.pid);
}

// Takes or renews the lease for ttlMs. Returns {ok:true, lease} or {ok:false, holder, until}.
export function takeLease({ holder = schedulerId(), ttlMs = 15 * 60 * 1000, file = leaseFile(), nowMs = Date.now() } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const release = acquireLock(`${file}.lock`, { waitMs: 3000, staleMs: 60 * 1000 });
  if (!release) return { ok: false, reason: 'lease file busy' };
  try {
    const cur = readInfo(file);
    if (!leaseFree(cur, holder, nowMs)) return { ok: false, holder: cur.holder, until: cur.until };
    const lease = { holder, pid: process.pid, host: os.hostname(), until: new Date(nowMs + ttlMs).toISOString(), taken_at: new Date(nowMs).toISOString() };
    fs.writeFileSync(file, JSON.stringify(lease, null, 2));
    return { ok: true, lease };
  } finally { release(); }
}

// Ends the lease now if this holder has it.
export function releaseLease({ holder = schedulerId(), file = leaseFile(), nowMs = Date.now() } = {}) {
  const release = acquireLock(`${file}.lock`, { waitMs: 3000, staleMs: 60 * 1000 });
  if (!release) return false;
  try {
    const cur = readInfo(file);
    if (!cur || cur.holder !== holder) return false;
    fs.writeFileSync(file, JSON.stringify({ ...cur, until: new Date(nowMs).toISOString(), released_at: new Date(nowMs).toISOString() }, null, 2));
    return true;
  } finally { release(); }
}

// True when `holder` has an unexpired lease.
export function holdsLease(holder, { file = leaseFile(), nowMs = Date.now() } = {}) {
  const cur = readInfo(file);
  return !!cur && cur.holder === holder && Date.parse(cur.until ?? '') > nowMs;
}
