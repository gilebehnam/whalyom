// Loads secrets from .env (local, gitignored) without overriding real environment variables.
// In the cloud routine, set the same names as environment variables instead.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The secrets file: OM_ENV_FILE when set (tests point it at a temp file so they never touch the real .env).
export const envPath = () => process.env.OM_ENV_FILE || path.join(root, '.env');

// OM_NO_DOTENV=1 (tests, clean-room runs) loads no keys, so a child stripped of connector keys stays
// stripped. It can only tighten: the one value still read from the file is the stop switch OM_KILL=1.
export function loadEnv(file = envPath()) {
  const noDotenv = process.env.OM_NO_DOTENV === '1';
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^['"]|['"]$/g, '');
    if (noDotenv && !(m[1] === 'OM_KILL' && value === '1')) continue;
    // An empty value counts as unset (Docker env_file defines every listed key as ""), so a key saved
    // later in .env still takes effect.
    if (process.env[m[1]] === undefined || process.env[m[1]] === '') process.env[m[1]] = value;
  }
}

// Reads a markdown file with optional YAML-like front matter (key: value lines only).
export function readDraft(file) {
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const l of m[1].split(/\r?\n/)) {
    const kv = l.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^['"]|['"]$/g, '');
  }
  return { meta, body: m[2] };
}

export const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
export const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));
