// Integrations catalog: one list of everything Whalyom can talk to, whether its keys are present, and
// what is still missing. It never prints, stores or returns a secret value, only env variable NAMES.
// Sources (each optional; a broken source is reported under "errors", never fatal):
//   1. tools/connectors/*.mjs        every exported connector or reader object (name, configured(env),
//                                     missing(env), needs, handles, kind). Files starting with "_" are
//                                     helpers and are skipped; the same name exported twice is one row.
//   2. .mcp.json                      the MCP servers (name, stdio or http, env key names). For a local
//                                     stdio server (an arg that is a file inside the repo) its tools are
//                                     read statically from registerTool('name', { description }) calls
//                                     in that file and the files it imports; the server is never started.
//   3. config/integrations/*.json     third-party integration manifests (owner-written), one per file:
//        { "name": "hubspot",                  a-z 0-9 hyphen, unique
//          "category": "crm",                  a-z 0-9 hyphen (see CATEGORIES for the common ones)
//          "auth": "oauth2",                   one of AUTH_TYPES
//          "env": ["HUBSPOT_TOKEN"],           env key NAMES that must all be set (never values)
//          "env_any": ["A_KEY", "B_KEY"],      optional: at least one of these must be set
//          "capabilities": ["contacts.read", "deals.read", "email.send"],
//          "docs_url": "https://developers.hubspot.com/docs/api/overview",
//          "description": "...", "vendor": "...", "connector": "<connector name>" }   optional
//      A manifest that carries a secret-looking field (api_key, token, secret, password ...) is
//      rejected: manifests list key names, the values live in .env or the cloud environment.
// Outputs:
//   state/integrations.json   the catalog for the Command Center (names, status, missing key names;
//                             email addresses in any text are replaced with [email])
//   products/<slug>/outbox/integrations/INT-<name>.md   setup note for a proposal (key names only)
// Outbound: a capability that sends, posts, publishes or spends is flagged requires_approval; a capability
// whose verb is not a known read verb (read, list, get, search ...) is treated as outbound too. This tool
// never calls an integration. --propose writes a pending approval proposal (set up / enable an
// integration) to products/<slug>/runs/<task-id>.json; apply-results.mjs merges it into approvals.json.
// Usage: node tools/integrations.mjs                   list and write state/integrations.json
//        node tools/integrations.mjs --json            print the catalog as JSON
//        node tools/integrations.mjs --missing         list only integrations with missing keys
//        node tools/integrations.mjs --check           validate manifests only (exit 1 when one is invalid)
//        node tools/integrations.mjs --no-write        do not write state/integrations.json
//        node tools/integrations.mjs --propose <name> --slug <slug> --task <task-id>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnv, readJson, writeJson, root } from './lib/env.mjs';

export const AUTH_TYPES = ['none', 'api_key', 'token', 'oauth2', 'basic', 'webhook', 'service_account'];
export const CATEGORIES = ['ads', 'analytics', 'automation', 'commerce', 'content', 'crm', 'data', 'email', 'messaging', 'payments', 'scheduling', 'seo', 'site', 'social', 'support', 'ai', 'other'];
// Capability words that act on the outside world: such capabilities only ever run through an approval.
export const OUTBOUND_WORDS = ['send', 'post', 'publish', 'spend', 'charge', 'pay', 'payout', 'refund', 'sms', 'dm', 'call', 'launch', 'bid', 'budget', 'broadcast', 'tweet', 'upload', 'delete', 'write', 'create', 'update',
  'enroll', 'schedule', 'reply', 'comment', 'share', 'invite', 'notify', 'push', 'order', 'transfer', 'subscribe', 'unsubscribe', 'import', 'sync', 'merge', 'manage', 'activate', 'enable', 'pause', 'resume', 'start', 'stop', 'execute', 'run', 'trigger'];
// Capability words that only read. A capability with neither list's words (e.g. "sendemail", "sequences")
// counts as outbound: unknown verbs fail closed, behind an approval.
export const READ_WORDS = ['read', 'list', 'get', 'search', 'view', 'query', 'fetch', 'lookup', 'export', 'report', 'reports', 'stats', 'analytics', 'insights', 'metrics', 'audit', 'monitor', 'watch'];
const SECRET_FIELD = /^(api[_-]?key|apikey|key|token|access[_-]?token|refresh[_-]?token|secret|client[_-]?secret|password|passwd|pwd|bearer|private[_-]?key|credentials?)$/i;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ENV_RE = /^[A-Z][A-Z0-9_]{1,79}$/;
const CAP_RE = /^[a-z][a-z0-9_.:-]{0,63}$/;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_LIST = 64;
const SOURCE_ORDER = { connector: 0, reader: 1, manifest: 2, mcp: 3 };

const str = (v, max = 300) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '');
const isSet = (env, k) => typeof env?.[k] === 'string' ? env[k].trim() !== '' : env?.[k] != null && env?.[k] !== '';
const uniqSorted = (a) => [...new Set(a)].sort();
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const rel = (base, f) => path.relative(base, f).split(path.sep).join('/');

export const isOutbound = (cap) => {
  const words = String(cap ?? '').toLowerCase().split(/[._:-]+/).filter(Boolean);
  if (words.some((w) => OUTBOUND_WORDS.includes(w))) return true;
  return !words.some((w) => READ_WORDS.includes(w));
};
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

// --- connectors -------------------------------------------------------------------------------------

// Category for a built-in connector or reader, from its name and kind.
export function connectorCategory(name, kind) {
  const n = String(name ?? '');
  if (kind === 'links') return 'scheduling';
  if (n === 'stripe') return 'payments';
  if (kind === 'metrics') return /ads/.test(n) ? 'ads' : 'analytics';
  if (/ads/.test(n)) return 'ads';
  if (['resend', 'mailchimp', 'brevo', 'convertkit'].includes(n)) return 'email';
  if (['bluesky', 'mastodon', 'telegram', 'discord', 'slack', 'linkedin', 'buffer', 'x'].includes(n)) return 'social';
  if (['devto', 'hashnode', 'medium', 'wordpress', 'ghost'].includes(n)) return 'content';
  if (['indexnow', 'gsc-sitemap'].includes(n)) return 'seo';
  if (['site-git', 'satellite', 'local-site', 'boosters'].includes(n)) return 'site';
  if (n === 'webhook') return 'automation';
  if (n === 'twilio-messaging') return 'messaging';
  return 'other';
}

const looksLikeConnector = (v) => v && typeof v === 'object' && !Array.isArray(v) && typeof v.name === 'string' && NAME_RE.test(v.name)
  && (typeof v.configured === 'function' || typeof v.execute === 'function' || typeof v.read === 'function' || typeof v.kind === 'string');

// Collects connector-shaped objects from a module namespace (default and named exports, arrays flattened).
export function connectorObjects(mod) {
  const out = [];
  const visit = (v, depth = 0) => {
    if (depth > 2 || v == null) return;
    if (Array.isArray(v)) { for (const x of v) visit(x, depth + 1); return; }
    if (looksLikeConnector(v)) out.push(v);
  };
  for (const k of Object.keys(mod ?? {}).sort()) visit(mod[k]);
  return out;
}

// Pure: one catalog row for a connector object. env is read for presence only.
export function describeConnector(c, env = {}) {
  const kind = typeof c.kind === 'string' ? str(c.kind, 24) : typeof c.read === 'function' ? 'reader' : /-csv$/.test(c.name) ? 'exporter' : 'executor';
  const source = typeof c.read === 'function' || kind === 'metrics' || kind === 'links' || kind === 'reader' ? 'reader' : 'connector';
  const needs = Array.isArray(c.needs) ? c.needs.filter((n) => typeof n === 'string').map((n) => str(n, 200)).slice(0, MAX_LIST) : [];
  const errors = [];
  let configured = false;
  try { configured = typeof c.configured === 'function' ? c.configured(env) === true : needs.every((n) => !ENV_RE.test(n) || isSet(env, n)); } catch (e) { errors.push(`configured() threw: ${str(e?.message ?? e, 120)}`); }
  let missing = [];
  if (!configured) {
    try {
      const m = typeof c.missing === 'function' ? c.missing(env) : null;
      missing = Array.isArray(m) ? m : needs.filter((n) => !ENV_RE.test(n) || !isSet(env, n));
    } catch (e) { errors.push(`missing() threw: ${str(e?.message ?? e, 120)}`); missing = needs; }
  }
  missing = uniqSorted(missing.filter((n) => typeof n === 'string').map((n) => str(n, 200)).filter(Boolean)).slice(0, MAX_LIST);
  const noKeys = needs.length === 0;
  const row = {
    id: `${source}:${c.name}`, name: c.name, source, kind, category: connectorCategory(c.name, kind),
    auth: noKeys ? 'none' : 'api_key', configured, status: configured ? (noKeys ? 'no_keys_needed' : 'configured') : 'missing_keys',
    needs, missing, handles: str(c.handles), capabilities: [],
    // Executors and exporters only ever run approved items (tools/execute.mjs); readers are read-only.
    requires_approval: source === 'connector',
    docs_url: '', unverified: c.unverified ? str(String(c.unverified), 200) : null,
  };
  if (errors.length) row.errors = errors;
  return row;
}

// Imports every tools/connectors/*.mjs (or dir) and returns {rows, errors}. Import failures are recorded.
export async function loadConnectors({ dir = path.join(root, 'tools', 'connectors'), env = {}, importer = (f) => import(pathToFileURL(f).href) } = {}) {
  const errors = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs') && !f.startsWith('_')).sort(); } catch (e) { errors.push({ source: 'connectors', file: rel(root, dir), error: `cannot read directory: ${e.code ?? e.message}` }); }
  const seen = new Map();
  for (const f of files) {
    let mod;
    try { mod = await importer(path.join(dir, f)); } catch (e) { errors.push({ source: 'connectors', file: f, error: str(e?.message ?? e, 200) }); continue; }
    for (const c of connectorObjects(mod)) if (!seen.has(c.name)) seen.set(c.name, describeConnector(c, env));
  }
  return { rows: [...seen.values()].sort(byName), errors };
}

// --- manifests --------------------------------------------------------------------------------------

// Pure: validates one parsed manifest. Returns {ok, errors, warnings, manifest (normalized)}.
export function validateManifest(m) {
  const errors = [];
  const warnings = [];
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { ok: false, errors: ['manifest must be a JSON object'], warnings, manifest: null };
  for (const k of Object.keys(m)) if (SECRET_FIELD.test(k)) errors.push(`field "${k}" looks like a secret: manifests list env key names only, values belong in .env`);
  const name = typeof m.name === 'string' ? m.name.trim() : '';
  if (!NAME_RE.test(name)) errors.push('name must match ^[a-z0-9][a-z0-9-]{0,63}$');
  const category = typeof m.category === 'string' ? m.category.trim().toLowerCase() : '';
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(category)) errors.push('category must be a short slug (a-z, 0-9, hyphen)');
  else if (!CATEGORIES.includes(category)) warnings.push(`category "${category}" is not one of the common categories`);
  const auth = typeof m.auth === 'string' ? m.auth.trim().toLowerCase() : '';
  if (!AUTH_TYPES.includes(auth)) errors.push(`auth must be one of ${AUTH_TYPES.join(', ')}`);
  const keyList = (field) => {
    const v = m[field];
    if (v === undefined) return [];
    if (!Array.isArray(v)) { errors.push(`${field} must be an array of env key names`); return []; }
    if (v.length > MAX_LIST) errors.push(`${field} lists more than ${MAX_LIST} keys`);
    const bad = v.filter((k) => typeof k !== 'string' || !ENV_RE.test(k));
    if (bad.length) errors.push(`${field} entries must be env key NAMES (^[A-Z][A-Z0-9_]+$), ${bad.length} invalid`);
    return uniqSorted(v.filter((k) => typeof k === 'string' && ENV_RE.test(k))).slice(0, MAX_LIST);
  };
  const env = keyList('env');
  const envAny = keyList('env_any');
  if (auth && auth !== 'none' && AUTH_TYPES.includes(auth) && env.length === 0 && envAny.length === 0) errors.push(`auth "${auth}" needs at least one env key in env or env_any`);
  if (auth === 'none' && (env.length || envAny.length)) warnings.push('auth is "none" but env keys are listed');
  let capabilities = [];
  if (!Array.isArray(m.capabilities) || m.capabilities.length === 0) errors.push('capabilities must be a non-empty array');
  else {
    if (m.capabilities.length > MAX_LIST) errors.push(`capabilities lists more than ${MAX_LIST} entries`);
    const bad = m.capabilities.filter((c) => typeof c !== 'string' || !CAP_RE.test(c.trim().toLowerCase()));
    if (bad.length) errors.push(`capabilities must be short lowercase words like "contacts.read", ${bad.length} invalid`);
    capabilities = uniqSorted(m.capabilities.filter((c) => typeof c === 'string' && CAP_RE.test(c.trim().toLowerCase())).map((c) => c.trim().toLowerCase())).slice(0, MAX_LIST);
  }
  let docs = '';
  try {
    const u = new URL(String(m.docs_url ?? ''));
    if (u.protocol !== 'https:') errors.push('docs_url must be an https URL');
    else if (u.username || u.password) errors.push('docs_url must not carry credentials');
    else docs = u.href;
  } catch { errors.push('docs_url must be an https URL'); }
  for (const k of ['description', 'vendor', 'connector']) if (m[k] !== undefined && typeof m[k] !== 'string') errors.push(`${k} must be a string`);
  if (typeof m.connector === 'string' && m.connector && !NAME_RE.test(m.connector)) errors.push('connector must be a connector name (a-z, 0-9, hyphen)');
  const known = new Set(['name', 'category', 'auth', 'env', 'env_any', 'capabilities', 'docs_url', 'description', 'vendor', 'connector', 'unverified', '$schema']);
  const extra = Object.keys(m).filter((k) => !known.has(k) && !SECRET_FIELD.test(k)).sort();
  if (extra.length) warnings.push(`unknown fields ignored: ${extra.join(', ')}`);
  const ok = errors.length === 0;
  return {
    ok, errors, warnings,
    manifest: ok ? { name, category, auth, env, env_any: envAny, capabilities, docs_url: docs, description: str(m.description), vendor: str(m.vendor, 80), connector: str(m.connector, 64) || null, unverified: m.unverified ? str(String(m.unverified), 200) : null } : null,
  };
}

// Pure: catalog row for a valid (normalized) manifest.
export function describeManifest(m, env = {}, file = '') {
  const missingAll = m.env.filter((k) => !isSet(env, k));
  const anyOk = m.env_any.length === 0 || m.env_any.some((k) => isSet(env, k));
  const missing = uniqSorted([...missingAll, ...(anyOk ? [] : [`one of ${m.env_any.join(' | ')}`])]);
  const noKeys = m.env.length === 0 && m.env_any.length === 0;
  const configured = missing.length === 0;
  const outbound = m.capabilities.filter(isOutbound);
  return {
    id: `manifest:${m.name}`, name: m.name, source: 'manifest', kind: 'third_party', category: m.category, auth: m.auth,
    configured, status: configured ? (noKeys ? 'no_keys_needed' : 'configured') : 'missing_keys',
    needs: uniqSorted([...m.env, ...(m.env_any.length ? [`one of ${m.env_any.join(' | ')}`] : [])]), missing,
    handles: m.description, capabilities: m.capabilities, outbound_capabilities: outbound,
    requires_approval: outbound.length > 0, docs_url: m.docs_url, vendor: m.vendor || null, connector: m.connector,
    unverified: m.unverified, file,
  };
}

// Reads config/integrations/*.json (or dir). Returns {rows, invalid, errors}. Never throws.
export function loadManifests({ dir = path.join(root, 'config', 'integrations'), env = {} } = {}) {
  const rows = [];
  const invalid = [];
  const errors = [];
  let files = [];
  if (!fs.existsSync(dir)) return { rows, invalid, errors };
  try { files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json')).sort(); } catch (e) { errors.push({ source: 'manifests', file: rel(root, dir), error: `cannot read directory: ${e.code ?? e.message}` }); }
  const seen = new Set();
  for (const f of files) {
    const full = path.join(dir, f);
    let raw;
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      if (st.size > MAX_MANIFEST_BYTES) { invalid.push({ file: f, errors: [`larger than ${MAX_MANIFEST_BYTES} bytes`] }); continue; }
      raw = fs.readFileSync(full, 'utf8').replace(/^﻿/, '');
    } catch (e) { invalid.push({ file: f, errors: [`cannot read: ${e.code ?? e.message}`] }); continue; }
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { invalid.push({ file: f, errors: [`invalid JSON: ${str(e.message, 120)}`] }); continue; }
    const v = validateManifest(parsed);
    if (!v.ok) { invalid.push({ file: f, name: typeof parsed?.name === 'string' ? str(parsed.name, 64) : null, errors: v.errors }); continue; }
    if (seen.has(v.manifest.name)) { invalid.push({ file: f, name: v.manifest.name, errors: [`duplicate name "${v.manifest.name}" (first file wins)`] }); continue; }
    seen.add(v.manifest.name);
    const row = describeManifest(v.manifest, env, f);
    if (v.warnings.length) row.warnings = v.warnings;
    rows.push(row);
  }
  return { rows: rows.sort(byName), invalid, errors };
}

// --- MCP servers ------------------------------------------------------------------------------------

// Pure: tool names and descriptions from source text (registerTool('x', { description: '...' }) and
// server.tool('x', 'description', ...)).
export function scanMcpTools(source) {
  const tools = new Map();
  const text = String(source ?? '');
  const reg = /\.registerTool\(\s*(['"`])([A-Za-z0-9_.-]{1,64})\1\s*,/g;
  let m;
  while ((m = reg.exec(text))) {
    const win = text.slice(m.index, m.index + 1500);
    const d = win.match(/description\s*:\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/);
    if (!tools.has(m[2])) tools.set(m[2], d ? str(d[2].replace(/\\(['"`\\])/g, '$1'), 240) : '');
  }
  const legacy = /\.tool\(\s*(['"`])([A-Za-z0-9_.-]{1,64})\1\s*,\s*(['"`])((?:\\.|(?!\3)[^\\])*)\3/g;
  while ((m = legacy.exec(text))) if (!tools.has(m[2])) tools.set(m[2], str(m[4], 240));
  return [...tools.entries()].map(([name, description]) => ({ name, description })).sort(byName);
}

// Collects tools from a local entry file and its relative imports (inside base, a few levels deep).
function toolsFromEntry(entry, base, depth = 0, seen = new Set()) {
  if (depth > 3 || seen.has(entry)) return [];
  seen.add(entry);
  let src;
  try { src = fs.readFileSync(entry, 'utf8'); } catch { return []; }
  const out = scanMcpTools(src);
  for (const im of src.matchAll(/(?:from|import\()\s*['"](\.{1,2}\/[^'"]+\.m?js)['"]/g)) {
    const f = path.resolve(path.dirname(entry), im[1]);
    if (!f.startsWith(path.resolve(base) + path.sep)) continue;
    out.push(...toolsFromEntry(f, base, depth + 1, seen));
  }
  return out;
}

// Reads .mcp.json (or file). Returns {servers, errors}. Reports env key NAMES and which ones that are
// referenced as ${VAR} are unset; never args or values (args can carry tokens).
export function loadMcp({ file = path.join(root, '.mcp.json'), base = root, env = {} } = {}) {
  const errors = [];
  if (!fs.existsSync(file)) return { servers: [], errors };
  const cfg = readJson(file, null);
  if (!cfg || typeof cfg !== 'object' || typeof cfg.mcpServers !== 'object' || cfg.mcpServers === null) {
    errors.push({ source: 'mcp', file: rel(base, file), error: 'not valid JSON with an mcpServers object' });
    return { servers: [], errors };
  }
  const servers = [];
  for (const name of Object.keys(cfg.mcpServers).sort()) {
    const s = cfg.mcpServers[name];
    if (!s || typeof s !== 'object') { errors.push({ source: 'mcp', file: rel(base, file), error: `server "${str(name, 64)}" is not an object` }); continue; }
    const transport = typeof s.url === 'string' ? (s.type === 'sse' ? 'sse' : 'http') : 'stdio';
    const envObj = s.env && typeof s.env === 'object' ? s.env : {};
    const envKeys = Object.keys(envObj).filter((k) => ENV_RE.test(k)).sort();
    const refs = [];
    for (const v of [...Object.values(envObj), ...(s.headers && typeof s.headers === 'object' ? Object.values(s.headers) : []), s.url, ...(Array.isArray(s.args) ? s.args : [])]) {
      for (const r of String(v ?? '').matchAll(/\$\{([A-Z][A-Z0-9_]*)(?::-[^}]*)?\}/g)) refs.push(r[1]);
    }
    const missing = uniqSorted(refs.filter((k) => !isSet(env, k)));
    let entry = null;
    let tools = [];
    if (transport === 'stdio' && Array.isArray(s.args)) {
      for (const a of s.args) {
        if (typeof a !== 'string' || !/\.(m?js|cjs)$/.test(a) || a.includes('${')) continue;
        const f = path.resolve(base, a);
        if (f.startsWith(path.resolve(base) + path.sep) && fs.existsSync(f)) { entry = rel(base, f); tools = toolsFromEntry(f, base); break; }
      }
    }
    const dedup = new Map(tools.map((t) => [t.name, t]));
    servers.push({
      id: `mcp:${name}`, name: str(name, 64), source: 'mcp', transport,
      command: transport === 'stdio' ? str(path.basename(String(s.command ?? '')), 40) : '',
      host: transport !== 'stdio' ? (() => { try { return new URL(s.url).host; } catch { return ''; } })() : '',
      local_entry: entry, env_keys: envKeys, missing, configured: missing.length === 0,
      tools: [...dedup.values()].sort(byName), tools_known: entry !== null,
    });
  }
  return { servers, errors };
}

// --- catalog ----------------------------------------------------------------------------------------

// Replaces any secret-looking env value that leaked into a string with "[redacted]" (defence in depth:
// rows are built from names only, but a connector's handles text could echo a value).
export function redactValues(obj, env = {}) {
  const vals = Object.entries(env ?? {}).filter(([k, v]) => typeof v === 'string' && v.length >= 8 && /KEY|TOKEN|SECRET|PASS|PRIVATE|AUTH|CREDENTIAL|WEBHOOK|DSN|SID/i.test(k)).map(([, v]) => v).sort((a, b) => b.length - a.length);
  // Personal data stays out of state/: email addresses in any text (a manifest description, a
  // connector's handles) are replaced too.
  const fix = (v) => {
    if (typeof v === 'string') { let s = v; for (const x of vals) if (s.includes(x)) s = s.split(x).join('[redacted]'); return s.replace(EMAIL_RE, '[email]'); }
    if (Array.isArray(v)) return v.map(fix);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fix(x)]));
    return v;
  };
  return fix(obj);
}

// Pure: combines rows into the Command Center catalog. Deterministic for the same inputs and now.
export function buildCatalog({ connectors = [], manifests = [], invalid = [], mcp = [], errors = [], now = new Date().toISOString(), env = {} } = {}) {
  const integrations = [...connectors, ...manifests].sort((a, b) => (SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source]) || byName(a, b));
  // Link manifests to built-in connectors with the same name (or the one named in "connector").
  const builtin = new Set(connectors.map((c) => c.name));
  for (const r of integrations) if (r.source === 'manifest') r.connector = r.connector ?? (builtin.has(r.name) ? r.name : null);
  const count = (f) => integrations.filter(f).length;
  const byCategory = {};
  for (const r of integrations) {
    const c = (byCategory[r.category] ??= { category: r.category, available: 0, configured: 0, missing_keys: 0 });
    c.available++;
    if (r.configured) c.configured++; else c.missing_keys++;
  }
  const missingKeys = uniqSorted(integrations.flatMap((r) => r.missing).filter((k) => ENV_RE.test(k)));
  const catalog = {
    generated_at: now,
    totals: {
      available: integrations.length, configured: count((r) => r.configured), missing_keys: count((r) => !r.configured),
      no_keys_needed: count((r) => r.status === 'no_keys_needed'), connectors: count((r) => r.source === 'connector'),
      readers: count((r) => r.source === 'reader'), manifests: count((r) => r.source === 'manifest'), invalid_manifests: invalid.length,
      mcp_servers: mcp.length, mcp_tools: mcp.reduce((n, s) => n + s.tools.length, 0), requires_approval: count((r) => r.requires_approval),
    },
    categories: Object.values(byCategory).sort((a, b) => (a.category < b.category ? -1 : 1)),
    missing_env_keys: missingKeys,
    integrations,
    mcp: { servers: mcp },
    invalid_manifests: invalid,
    errors,
  };
  return redactValues(catalog, env);
}

// Loads every source and builds the catalog. Paths and env are injectable for tests.
export async function collectIntegrations({ env = process.env, now = new Date().toISOString(), connectorsDir, manifestsDir, mcpFile, base = root, importer } = {}) {
  const c = await loadConnectors({ dir: connectorsDir, env, importer });
  const m = loadManifests({ dir: manifestsDir, env });
  const s = loadMcp({ file: mcpFile ?? path.join(base, '.mcp.json'), base, env });
  return buildCatalog({ connectors: c.rows, manifests: m.rows, invalid: m.invalid, mcp: s.servers, errors: [...c.errors, ...m.errors, ...s.errors], now, env });
}

// Writes state/integrations.json (or file). Returns the path.
export function writeCatalog(catalog, file = path.join(root, 'state', 'integrations.json')) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeJson(file, catalog);
  return file;
}

// Pure: a pending approval proposal to set up or enable one integration. Nothing is executed: the owner
// adds the keys and approves; outbound capabilities stay behind per-item approvals afterwards too.
export function setupProposal(row, { slug, taskId, now = new Date().toISOString() } = {}) {
  if (!row || typeof row !== 'object' || !NAME_RE.test(String(row.name ?? ''))) throw new Error('unknown integration');
  if (!NAME_RE.test(String(slug ?? ''))) throw new Error('slug must match ^[a-z0-9][a-z0-9-]*$');
  return {
    id: `INT-${row.name}`.slice(0, 64),
    type: 'integration_setup',
    title: `Set up ${row.name}${row.missing?.length ? ` (add ${row.missing.join(', ')})` : ''}`.slice(0, 200),
    file: '',
    integration: row.name,
    source: row.source,
    category: row.category,
    needs_env: (row.missing ?? []).slice(0, MAX_LIST),
    capabilities: (row.capabilities ?? []).slice(0, MAX_LIST),
    outbound_capabilities: (row.outbound_capabilities ?? row.capabilities?.filter(isOutbound) ?? []).slice(0, MAX_LIST),
    docs_url: row.docs_url ?? '',
    note: 'Owner adds the keys to .env or the cloud environment (never in chat or files). Approving enables the integration only; every send, post, publish or spend still needs its own approval and stays inside product.json budget caps and consent.',
    product: slug,
    task_id: taskId ?? null,
    proposed_at: now,
    status: 'pending',
  };
}

// Appends a proposal to products/<slug>/runs/<task-id>.json "approvals" (creating the run file).
export function writeProposal(proposal, { slug, taskId, agent = 'om-integrations', productsDir = path.join(root, 'products') } = {}) {
  if (!NAME_RE.test(String(slug ?? ''))) throw new Error('slug must match ^[a-z0-9][a-z0-9-]*$');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(String(taskId ?? '')) || String(taskId).includes('..')) throw new Error('task id must be letters, digits, _ . - (no path)');
  const dir = path.join(productsDir, slug);
  if (!fs.existsSync(path.join(dir, 'product.json'))) throw new Error(`products/${slug}/product.json not found`);
  const file = path.join(dir, 'runs', `${taskId}.json`);
  const exists = fs.existsSync(file);
  const run = exists ? readJson(file, null) : { task_id: taskId, agent, status: 'done', summary: '' };
  // Never overwrite another agent's run file that does not parse: that would lose its results.
  if (!run || typeof run !== 'object' || Array.isArray(run)) throw new Error(`products/${slug}/runs/${taskId}.json exists but is not a JSON object; not overwritten`);
  if (run.approvals != null && !Array.isArray(run.approvals)) throw new Error(`products/${slug}/runs/${taskId}.json has a non-array "approvals"; not overwritten`);
  if (!Array.isArray(run.approvals)) run.approvals = [];
  // apply-results.mjs keeps only id/type/title/file of an approval, so the details go in a note the
  // dashboard and the manual-steps file can point at (key NAMES only, inside products/<slug>/).
  if (!proposal.file) {
    const relFile = `outbox/integrations/${proposal.id}.md`;
    const note = path.join(dir, relFile);
    fs.mkdirSync(path.dirname(note), { recursive: true });
    fs.writeFileSync(note, setupNote(proposal));
    proposal = { ...proposal, file: relFile };
  }
  if (!run.approvals.some((a) => a?.id === proposal.id)) run.approvals.push(proposal);
  run.summary = run.summary || `Proposed integration setup: ${proposal.integration}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeJson(file, run);
  return file;
}

// Pure: the markdown setup note for a proposal (names only, never values).
export function setupNote(p) {
  const list = (a) => (a?.length ? a.map((x) => `- ${x}`).join('\n') : '- (none)');
  return [`# Set up ${p.integration}`, '', `Approval ${p.id}, ${p.category ?? ''} integration from ${p.source ?? ''}.`, '',
    '## Keys to add (names only; put the values in .env or the cloud environment)', list(p.needs_env), '',
    '## Capabilities', list(p.capabilities), '', '## Outbound capabilities (each use needs its own approval)', list(p.outbound_capabilities), '',
    p.docs_url ? `Docs: ${p.docs_url}` : '', '', p.note ?? '', ''].join('\n');
}

// Text listing for people. Shows names and missing key NAMES only.
export function formatCatalog(cat, { onlyMissing = false } = {}) {
  const t = cat.totals;
  const lines = [`Integrations: ${t.available} available, ${t.configured} configured, ${t.missing_keys} missing keys; ${t.mcp_servers} MCP servers, ${t.mcp_tools} MCP tools`];
  for (const r of cat.integrations) {
    if (onlyMissing && r.configured) continue;
    const flag = r.configured ? (r.status === 'no_keys_needed' ? 'ready     ' : 'configured') : 'missing   ';
    lines.push(`  ${flag}  ${r.source.padEnd(9)} ${r.name.padEnd(24)} ${r.category.padEnd(11)}${r.missing.length ? ` needs ${r.missing.join(', ')}` : ''}${r.requires_approval ? ' [approval]' : ''}`);
  }
  if (!onlyMissing) for (const s of cat.mcp.servers) lines.push(`  ${s.configured ? 'configured' : 'missing   '}  mcp       ${s.name.padEnd(24)} ${s.transport.padEnd(11)}${s.tools.length ? ` ${s.tools.length} tools` : ''}${s.missing.length ? ` needs ${s.missing.join(', ')}` : ''}`);
  for (const i of cat.invalid_manifests) lines.push(`  invalid     manifest  ${i.file}: ${i.errors.join('; ')}`);
  for (const e of cat.errors) lines.push(`  error       ${e.source} ${e.file ?? ''}: ${e.error}`);
  return lines.join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  loadEnv();
  try {
    if (args.includes('--check')) {
      const m = loadManifests({ env: process.env });
      console.log(JSON.stringify({ valid: m.rows.map((r) => r.name), invalid: m.invalid, errors: m.errors }));
      process.exit(m.invalid.length || m.errors.length ? 1 : 0);
    }
    const cat = await collectIntegrations({ env: process.env });
    if (args.includes('--propose')) {
      const name = opt('--propose');
      const slug = opt('--slug');
      const taskId = opt('--task') ?? `INT-${name}-${new Date().toISOString().slice(0, 10)}`;
      const row = cat.integrations.find((r) => r.name === name && r.source === 'manifest') ?? cat.integrations.find((r) => r.name === name);
      if (!row) throw new Error(`unknown integration: ${str(name, 64)}`);
      const file = writeProposal(setupProposal(row, { slug, taskId }), { slug, taskId });
      console.log(JSON.stringify({ ok: true, proposed: row.name, run_file: rel(root, file), next: `node tools/apply-results.mjs ${slug}` }));
    } else {
      if (!args.includes('--no-write')) writeCatalog(cat);
      if (args.includes('--json')) console.log(JSON.stringify(cat, null, 2));
      else console.log(formatCatalog(cat, { onlyMissing: args.includes('--missing') }));
    }
  } catch (e) {
    console.error(`integrations: ${e.message}`);
    process.exit(1);
  }
}
