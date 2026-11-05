// Size-based log rotation (zero dependencies). rotate(file) renames file → file.1 once it passes
// maxBytes, shifting older copies (file.1 → file.2 …) and dropping the one past `keep`.
// Safe for append-only logs written with fs.appendFileSync(path): the rename is atomic, so a writer
// either appends to the old file (now file.1) or creates a fresh file; no line is lost or cut.
// A file whose last byte is not a newline (a write in progress) is left alone until the next call.
// Defaults: 5 MB, 3 old copies. OM_LOG_MAX_BYTES / OM_LOG_KEEP override them in rotationDefaults().
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_KEEP = 3;

export function rotationDefaults(env = process.env) {
  const max = Number(env.OM_LOG_MAX_BYTES); const keep = Number(env.OM_LOG_KEEP);
  return { maxBytes: max > 0 ? max : DEFAULT_MAX_BYTES, keep: Number.isInteger(keep) && keep >= 1 ? keep : DEFAULT_KEEP };
}

function endsWithNewline(file, size) {
  const fd = fs.openSync(file, 'r');
  try { const b = Buffer.alloc(1); fs.readSync(fd, b, 0, 1, size - 1); return b[0] === 0x0a; } finally { fs.closeSync(fd); }
}

// Returns {file, rotated, size, reason?}. Never throws (a locked file is reported, not fatal).
export function rotate(file, { maxBytes = DEFAULT_MAX_BYTES, keep = DEFAULT_KEEP } = {}) {
  const out = { file, rotated: false, size: 0 };
  try {
    if (!fs.existsSync(file)) return { ...out, reason: 'missing' };
    const { size } = fs.statSync(file);
    out.size = size;
    if (size < maxBytes) return { ...out, reason: 'under limit' };
    if (!endsWithNewline(file, size)) return { ...out, reason: 'partial last line; retry next cycle' };
    const n = Math.max(1, Math.floor(keep));
    fs.rmSync(`${file}.${n}`, { force: true });
    for (let i = n - 1; i >= 1; i--) if (fs.existsSync(`${file}.${i}`)) fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`);
    fs.renameSync(file, `${file}.1`);
    return { ...out, rotated: true };
  } catch (e) { return { ...out, reason: `error: ${e.message}` }; }
}

// Log files in a directory matching a filter (default: *.log).
export function logsIn(dir, test = (name) => name.endsWith('.log')) {
  try { return fs.readdirSync(dir).filter((n) => test(n) && fs.statSync(path.join(dir, n)).isFile()).map((n) => path.join(dir, n)); } catch { return []; }
}

// Last n lines of a rotated log: reads file, then file.1, file.2 … until n lines are found.
// For readers (dashboards) that want recent history right after a rotation.
export function tailLines(file, n, { keep = DEFAULT_KEEP } = {}) {
  let lines = [];
  for (let i = 0; i <= keep && lines.length < n; i++) {
    const f = i ? `${file}.${i}` : file;
    if (!fs.existsSync(f)) { if (i) break; continue; }
    lines = [...fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean), ...lines];
  }
  return lines.slice(-n);
}
