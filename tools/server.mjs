// Whalyom local Command Center server.
//   node tools/server.mjs [--port 4321]   →  http://localhost:4321
// Serves the same 3D Command Center page as claude.ai, with a local runtime shim:
//   - live documents (state/live-*.json) stream to the page over SSE the moment they change;
//   - any change in products/ (agent heartbeats, results) rebuilds the live state within ~1 s;
//   - decisions and new-product requests from the page are applied immediately;
//   - Connections & Vault: secrets go to .env (local, gitignored), product mode/budget to product.json;
//   - "Ignite" starts a headless Claude Code run (`claude -p`) that onboards and runs the product live;
//   - the free local site publisher's output is served under /site/<slug>/;
//   - "New agent": POST /api/agents turns a form into an evolution proposal (tools/agent-builder.mjs). It never
//     ships an agent: the proposal waits in state/evolution/proposals/ for om-red-team or the owner (evolve.mjs);
//   - GET /branding serves the owner's validated white-label branding (config/branding.json) when it exists.
// Binds to 127.0.0.1 by default. Every write needs the per-start token embedded in the served page.
// Hosted mode (deploy/CLOUD.md): OM_SERVER_HOST=0.0.0.0 is only allowed together with
// OM_DASHBOARD_PASSWORD, and then every request needs that password (HTTP Basic, any user name).
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { runClaude } from './lib/claude-run.mjs';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { loadEnv, readJson, writeJson, root, envPath } from './lib/env.mjs';
import { status as connectorStatus } from './connectors/index.mjs';
import { PWA_ROUTES } from './pwa.mjs';

loadEnv();
const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]) || Number(process.env.WHALYOM_PORT) || 4321;
const token = crypto.randomBytes(16).toString('hex');
const bindHost = process.env.OM_SERVER_HOST || '127.0.0.1';
const dashPass = process.env.OM_DASHBOARD_PASSWORD || '';
if (!['127.0.0.1', 'localhost', '::1'].includes(bindHost) && dashPass.length < 12) { console.error('Refusing to serve the Command Center on a public address without OM_DASHBOARD_PASSWORD (12+ characters).'); process.exit(2); }
const authorized = (req) => {
  if (!dashPass) return true;
  const m = /^Basic\s+(.+)$/i.exec(String(req.headers.authorization ?? ''));
  if (!m) return false;
  const pass = Buffer.from(m[1], 'base64').toString('utf8').split(':').slice(1).join(':');
  const a = crypto.createHash('sha256').update(pass).digest(), b = crypto.createHash('sha256').update(dashPass).digest();
  return crypto.timingSafeEqual(a, b);
};
const stateDir = path.join(root, 'state');
const LIVE = ['roster', 'agents', 'events', 'state', 'nyk', 'graph', 'transitions', 'products', 'sites', 'funnel', 'ai', 'sequences', 'leadscores', 'attribution', 'aivisibility', 'integrations', 'autonomy'];
// Growth docs: the modules write state/<file>; the server copies each into state/live-<name>.json through a
// whitelist (counts, rates, channel and product names only), so no lead id, email, phone, prompt or answer
// text, MCP argument or key value can reach the page, even if a module's output grows new fields.
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v, n = 80) => (typeof v === 'string' ? v.replace(/[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+/g, '[redacted]').replace(/\+\d[\d\s().-]{7,}\d/g, '[redacted]').slice(0, n) : null);
const ts = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}[T\d:.Z+-]{0,25}$/.test(v) ? v : null);
const arr = (v, n) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object').slice(0, n) : []);
const nums = (o, keys) => Object.fromEntries(keys.map((k) => [k, num(o?.[k])]));
const counts = (o) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([k, v]) => /^[a-z0-9_-]{1,40}$/i.test(k) && num(v) != null).slice(0, 20));
const rate = (o) => (o && typeof o === 'object' ? nums(o, ['p', 'lo', 'hi', 'n']) : { p: num(o), lo: null, hi: null, n: null });
const credit = (o) => nums(o, ['leads', 'sales', 'revenue']);
const GROWTH_DOCS = {
  sequences: { file: 'sequences.json', pick: (d) => ({ updated_at: ts(d.updated_at), sequences: arr(d.sequences, 200).map((r) => ({ product: str(r.product, 60), sequence: str(r.sequence), ...nums(r, ['active', 'waiting_approval', 'completed', 'stopped', 'expired', 'proposed', 'sent']), stop_reasons: counts(r.stop_reasons) })) }) },
  leadscores: { file: 'lead-scores.json', pick: (d) => ({ updated_at: ts(d.updated_at), products: arr(d.products, 100).map((p) => ({ product: str(p.product, 60), updated_at: ts(p.updated_at), totals: nums(p.totals, ['leads', 'hot', 'warm', 'cold', 'open_hot', 'open_warm', 'won', 'lost']), thresholds: counts(p.thresholds), calibration: { status: str(p.calibration?.status, 30), ...nums(p.calibration, ['outcomes', 'auc', 'suggested_hot_threshold']) } })) }) },
  attribution: { file: 'attribution.json', pick: (d) => ({ updated_at: ts(d.updated_at), products: arr(d.products, 100).map((p) => ({ product: str(p.product, 60), currency: str(p.currency, 8), totals: nums(p.totals, ['leads', 'sales', 'revenue', 'verified_revenue', 'touches']), top_channels: arr(p.top_channels, 8).map((c) => ({ channel: str(c.channel, 60), role: str(c.role, 20), linear: credit(c.linear), time_decay: credit(c.time_decay) })), mmm: { status: str(p.mmm?.status, 30), confidence: str(p.mmm?.confidence, 20), ...nums(p.mmm, ['weeks', 'r2']) }, pending_proposals: num(p.pending_proposals) })) }) },
  aivisibility: { file: 'ai-visibility.json', pick: (d) => ({ updated_at: ts(d.updated_at), window_days: num(d.window_days), products: arr(d.products, 100).map((p) => ({ product: str(p.product, 60), status: str(p.status, 30), ...nums(p, ['answers', 'prompts', 'share_of_voice', 'share_change_pp', 'missing_prompts', 'inaccurate']), share_of_answer: rate(p.share_of_answer), citation_rate: rate(p.citation_rate), by_engine: Object.fromEntries(Object.entries(p.by_engine && typeof p.by_engine === 'object' ? p.by_engine : {}).filter(([e]) => /^[a-z0-9_.-]{1,40}$/i.test(e)).slice(0, 20).map(([e, v]) => [e, nums(v, ['answers', 'share', 'citation_rate'])])) })), errors: arr(d.errors, 20).length }) },
  integrations: { file: 'integrations.json', pick: (d) => ({ updated_at: ts(d.generated_at ?? d.updated_at), totals: nums(d.totals, ['available', 'configured', 'missing_keys', 'no_keys_needed', 'connectors', 'readers', 'manifests', 'invalid_manifests', 'mcp_servers', 'mcp_tools', 'requires_approval']), categories: arr(d.categories, 40).map((c) => ({ category: str(c.category, 40), ...nums(c, ['available', 'configured', 'missing_keys']) })), integrations: arr(d.integrations, 300).map((r) => ({ name: str(r.name, 60), category: str(r.category, 40), source: str(r.source, 20), configured: r.configured === true, status: str(r.status, 30), missing: (Array.isArray(r.missing) ? r.missing : []).filter((k) => typeof k === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(k)).slice(0, 10), requires_approval: r.requires_approval === true })), mcp: arr(d.mcp?.servers, 40).map((m) => ({ name: str(m.name, 60), configured: m.configured === true, tools: Array.isArray(m.tools) ? m.tools.length : 0 })) }) },
};
// A missing source still gets a doc (source: "missing"), so the page says "not run yet" instead of waiting.
const writeGrowthDoc = (name) => {
  const g = GROWTH_DOCS[name];
  const src = readJson(path.join(stateDir, g.file), null);
  let doc;
  try { doc = { ...g.pick(src && typeof src === 'object' && !Array.isArray(src) ? src : {}), source: src ? 'ok' : 'missing' }; } catch { return; }
  const f = path.join(stateDir, `live-${name}.json`), text = JSON.stringify(doc);
  try { if (fs.existsSync(f) && fs.readFileSync(f, 'utf8') === text) return; fs.writeFileSync(f, text); } catch { /* the next change retries */ }
};
const GROWTH_BY_FILE = Object.fromEntries(Object.entries(GROWTH_DOCS).map(([n, g]) => [g.file, n]));
// Keys the page may never write: the owner secret (agents can read .env, and MCP approve_item refuses while it is
// there), the hosted-mode password, the binary headless runs start, and network/security settings.
const VAULT_DENY = ['OM_SERVER_HOST', 'OM_DASHBOARD_PASSWORD', 'OM_CLAUDE_BIN', 'WHALYOM_OWNER_TOKEN', 'OM_EDGE_HOST', 'OM_EDGE_TRUST_PROXY', 'OM_EDGE_PORT', 'WHALYOM_ALLOWED_ORIGINS', 'WHALYOM_PORT', 'OM_DASHBOARD_DOMAIN'];
const VAULT_KEYS = new Set(fs.readFileSync(path.join(root, '.env.example'), 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z0-9_]+)=/)?.[1]).filter(Boolean).filter((k) => !VAULT_DENY.includes(k)));
// "New agent" form: only these fields reach the builder, so a page can never smuggle in red_team, an id or a status.
const AGENT_FORM_KEYS = ['name', 'title', 'does', 'dept', 'model', 'skills', 'notes', 'outputs', 'tools', 'knowledge_ids', 'rationale'];
const agentForm = (b) => Object.fromEntries(AGENT_FORM_KEYS.filter((k) => Object.hasOwn(b, k)).map((k) => [k, b[k]]));
// White-label branding: config/branding.json (owner-written), validated with the agency rules. Only what the page
// shows (name, an https logo on a public host, a hex colour) is served, never the support e-mail or the domain.
const brandingDoc = async () => {
  const raw = readJson(path.join(root, 'config', 'branding.json'), null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { validateBranding } = await import('./cloud/agency.mjs');
  // Field by field, so one bad value (say a non-https logo) drops only that field.
  const b = {};
  for (const k of ['name', 'logo_url', 'primary_color']) {
    if (raw[k] == null || raw[k] === '') continue;
    try { b[k] = validateBranding({ [k]: raw[k] })[k] ?? null; } catch { /* invalid: not served */ }
  }
  return b.name || b.logo_url || b.primary_color ? { name: b.name ?? null, logo_url: b.logo_url ?? null, primary_color: b.primary_color ?? null } : null;
};
const node = (script, a = []) => new Promise((resolve) => execFile(process.execPath, [path.join(root, 'tools', script), ...a], { cwd: root, timeout: 120000 }, (err, out, errOut) => resolve({ ok: !err, out: String(out).trim().split(/\r?\n/).at(-1), err: errOut })));

// ── live state rebuild (debounced) and SSE fan-out ──
const clients = new Set();
const send = (res, name) => {
  const f = path.join(stateDir, `live-${name}.json`);
  if (!fs.existsSync(f)) return;
  try { res.write(`event: doc\ndata: ${JSON.stringify({ path: `live/${name}`, data: JSON.parse(fs.readFileSync(f, 'utf8')) })}\n\n`); } catch { /* file mid-write; next change resends */ }
};
let rebuilding = false, again = false, timer = null;
const rebuild = () => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (rebuilding) { again = true; return; }
    rebuilding = true;
    await node('needs-you-know.mjs');
    await node('live-snapshot.mjs');
    rebuilding = false;
    if (again) { again = false; rebuild(); }
  }, 800);
};
for (const n of Object.keys(GROWTH_DOCS)) writeGrowthDoc(n);
const growthTimers = {};
fs.watch(stateDir, (ev, file) => {
  const g = file && GROWTH_BY_FILE[String(file)];
  if (g) { clearTimeout(growthTimers[g]); growthTimers[g] = setTimeout(() => writeGrowthDoc(g), 300); return; }
  const m = file && String(file).match(/^live-(\w+)\.json$/); if (m && LIVE.includes(m[1])) for (const c of clients) send(c, m[1]);
});
// Files the rebuild itself writes are ignored, so a rebuild never triggers another one.
fs.watch(path.join(root, 'products'), { recursive: true }, (ev, file) => { if (file && !/[\\/]applied[\\/]|needs-you-know\.md$|budget-plan\.json$/.test(file)) rebuild(); });

// ── helpers ──
const body = (req) => new Promise((resolve, reject) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); }); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } }); });
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'].map((h) => `${h}:${port}`));
const localHostOk = (req) => {
  if (!LOCAL_HOSTS.has(String(req.headers.host ?? '').toLowerCase())) return false;
  const origin = req.headers.origin;
  if (req.method !== 'GET' && origin) { try { return LOCAL_HOSTS.has(new URL(origin).host.toLowerCase()); } catch { return false; } }
  return true;
};
const slugOk = (s) => /^[a-z0-9-]+$/.test(String(s ?? ''));
const setEnv = (key, value) => {
  const f = envPath();
  const lines = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split(/\r?\n/) : [];
  const i = lines.findIndex((l) => l.startsWith(`${key}=`));
  const line = `${key}=${String(value).replace(/[\r\n]/g, '')}`;
  if (i > -1) lines[i] = line; else lines.push(line);
  fs.writeFileSync(f, lines.filter((l, n) => l || n < lines.length - 1).join('\n') + '\n');
  process.env[key] = String(value);
};
// One headless run per product at a time (a double click must not start two paid runs): slug → pid.
const igniting = new Map();
const ignite = (slug) => {
  const log = fs.openSync(path.join(stateDir, `ignite-${slug}.log`), 'a');
  const prompt = `Use the whalyom skill. Product "${slug}" was just created from the Command Center. Run it in live mode: if its stage is "onboarding", run onboarding (om-onboard workflow, or the onboarding wave by hand with heartbeats), then run one live wave of up to 6 ready tasks with runs/<id>.start heartbeats and tools/apply-results.mjs after each agent. Respect claims.md and the autonomy policy; publish nothing outside the free local channels. Stop after one wave and leave the plan for the owner in Needs You Know.`;
  let child;
  try { child = runClaude(prompt, { cwd: root, out: log, detached: true }); } catch (e) { fs.appendFileSync(path.join(stateDir, `ignite-${slug}.log`), `not started: ${e.message}\n`); fs.closeSync(log); return null; }
  if (child.pid) { igniting.set(slug, child.pid); child.on('exit', () => igniting.delete(slug)); }
  child.on('error', (e) => { igniting.delete(slug); fs.appendFileSync(path.join(stateDir, `ignite-${slug}.log`), `claude could not start: ${e.message}
`); });
  child.unref();
  return child.pid;
};

const page = () => {
  const html = fs.readFileSync(path.join(root, 'live', 'index.html'), 'utf8');
  const shim = `<script>window.__WHALYOM_LOCAL__=${JSON.stringify({ token, port })};</script><script src="/local-shim.js"></script>`;
  // The page is a body fragment; the PWA tags (manifest, theme colour, Apple app tags) move into <head>.
  const HEAD_TAG = /<link\s+rel="(?:manifest|apple-touch-icon)"[^>]*>|<meta\s+name="(?:theme-color|mobile-web-app-capable|apple-mobile-web-app-[a-z-]+)"[^>]*>/gi;
  const headTags = (html.match(HEAD_TAG) ?? []).join('');
  const injected = html.replace(HEAD_TAG, '').replace(/<script\b/i, `${shim}<script`);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">${headTags}<style>html,body{margin:0}</style></head><body>${injected}</body></html>`;
};

// Speed: static responses are built once per file change and sent compressed (brotli, else gzip).
const cache = new Map();
const compressed = (key, mtimeMs, build) => {
  const hit = cache.get(key);
  if (hit && hit.mtimeMs === mtimeMs) return hit;
  const raw = Buffer.from(build());
  const entry = { mtimeMs, raw, br: zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }), gzip: zlib.gzipSync(raw, { level: 6 }) };
  cache.set(key, entry);
  return entry;
};
const sendStatic = (req, res, headers, entry) => {
  const accept = String(req.headers['accept-encoding'] ?? '');
  const enc = /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null;
  const buf = enc ? entry[enc] : entry.raw;
  res.writeHead(200, { ...headers, vary: 'accept-encoding', 'content-length': buf.length, ...(enc ? { 'content-encoding': enc } : {}) });
  res.end(buf);
};
const mtime = (f) => fs.statSync(f).mtimeMs;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  // Local mode: only this computer's own page may talk to the server (blocks DNS rebinding and other sites).
  if (!dashPass && !localHostOk(req)) { res.writeHead(403, { 'content-type': 'text/plain' }); return res.end('Forbidden host'); }
  if (!authorized(req)) { res.writeHead(401, { 'www-authenticate': 'Basic realm="Whalyom"', 'content-type': 'text/plain' }); return res.end('Password required'); }
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const f = path.join(root, 'live', 'index.html');
      return sendStatic(req, res, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }, compressed('page', mtime(f), page));
    }
    if (req.method === 'GET' && url.pathname === '/local-shim.js') {
      const f = path.join(root, 'tools', 'server', 'local-shim.js');
      return sendStatic(req, res, { 'content-type': 'text/javascript', 'cache-control': 'no-cache' }, compressed('shim', mtime(f), () => fs.readFileSync(f)));
    }
    // Installable app (PWA): manifest, icons and the service worker (built by tools/pwa.mjs).
    const pwa = req.method === 'GET' && Object.hasOwn(PWA_ROUTES, url.pathname) && PWA_ROUTES[url.pathname];
    if (pwa) {
      const f = path.join(root, pwa.file);
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end('Not found'); }
      const extra = url.pathname === '/sw.js' ? { 'service-worker-allowed': '/' } : {};
      return sendStatic(req, res, { 'content-type': pwa.type, 'cache-control': pwa.cache, ...extra }, compressed(url.pathname, mtime(f), () => fs.readFileSync(f)));
    }
    if (req.method === 'GET' && url.pathname === '/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      clients.add(res); for (const n of LIVE) send(res, n);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/connectors') {
      const products = fs.readdirSync(path.join(root, 'products')).filter((s) => !s.startsWith('_')).map((s) => ({ slug: s, ...((p) => ({ name: p.name, mode: p.budget?.mode, monthly_cap: p.budget?.monthly_cap, currency: p.budget?.currency, autonomy: p.autonomy?.level, stage: p.stage }))(readJson(path.join(root, 'products', s, 'product.json'), {})) }));
      return json(res, 200, { connectors: connectorStatus(process.env), keys: [...VAULT_KEYS].map((k) => ({ key: k, set: Boolean(process.env[k]) })), products, free_mode_fallback: true });
    }
    if (req.method === 'GET' && url.pathname === '/branding') {
      const b = await brandingDoc();
      res.writeHead(b ? 200 : 404, { 'content-type': 'application/json', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
      return res.end(JSON.stringify(b ? { branding: b } : { error: 'no branding' }));
    }
    if (req.method === 'GET' && url.pathname === '/api/agents/options') {
      const { builderOptions } = await import('./agent-builder.mjs');
      return json(res, 200, builderOptions());
    }
    if (req.method === 'GET' && url.pathname === '/api/install') {
      const { snippet } = await import('./install-snippet.mjs');
      const key = process.env.OM_INSTALL_KEY ?? '';
      const edge = process.env.OM_EDGE_URL ?? '';
      const live = readJson(path.join(stateDir, 'live-sites.json'), { sites: [] }).sites ?? [];
      const sites = live.map((st) => {
        const dir = path.join(root, 'products', st.product);
        const audit = readJson(path.join(dir, 'research', 'crawl', 'instant.json'), null);
        const boosters = readJson(path.join(dir, 'boosters.json'), []);
        const waiting = readJson(path.join(dir, 'approvals.json'), []).filter((a) => a.channel === 'onsite-booster' && a.status === 'pending').length;
        return { product: st.product, domain: st.domain, state: st.state, events_total: st.events_total ?? null, score: audit?.scores?.overall ?? null, boosters_live: boosters.filter((x) => x.approved).length, boosters_waiting: waiting };
      });
      return json(res, 200, { key_set: key.length >= 16, edge_url: edge || null, snippet: key.length >= 16 && edge ? snippet(edge, key) : null, sites });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/site/')) {
      const f = path.resolve(root, 'site', decodeURIComponent(url.pathname.slice(6)) || 'index.html');
      const file = fs.existsSync(f) && fs.statSync(f).isDirectory() ? path.join(f, 'index.html') : f;
      if (!file.startsWith(path.join(root, 'site') + path.sep) || !fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
      const type = { '.html': 'text/html; charset=utf-8', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json' }[path.extname(file)] ?? 'application/octet-stream';
      if (/^(text|application\/(json|xml))/.test(type)) return sendStatic(req, res, { 'content-type': type, 'cache-control': 'no-cache' }, compressed(`site:${file}`, mtime(file), () => fs.readFileSync(file)));
      res.writeHead(200, { 'content-type': type }); return res.end(fs.readFileSync(file));
    }

    if (req.method === 'POST') {
      if (req.headers['x-whalyom-token'] !== token) return json(res, 403, { error: 'Only the owner (this local page) can do that' });
      const b = await body(req);
      if (!b || typeof b !== 'object' || Array.isArray(b)) return json(res, 400, { error: 'bad request' });
      if (url.pathname === '/api/resolve-alert') {
        const key = String(b.key ?? '').slice(0, 300).trim();
        if (!key || (b.product != null && !slugOk(b.product))) return json(res, 400, { error: 'bad request' });
        const r = await node('needs-you-know.mjs', ['resolve', key, ...(b.product ? ['--product', b.product] : ['--system'])]);
        rebuild();
        return json(res, r.ok ? 200 : 500, { ok: r.ok, out: r.out, error: r.ok ? undefined : String(r.err).slice(0, 300) });
      }
      if (url.pathname === '/api/owner-decision') {
        if (!slugOk(b.product) || !/^dec-[a-f0-9]{10}$/.test(String(b.id ?? ''))) return json(res, 400, { error: 'bad request' });
        const r = await node('needs-you-know.mjs', ['answer', b.product, b.id, String(b.answer ?? 'done').slice(0, 200)]);
        rebuild();
        return json(res, r.ok ? 200 : 404, { ok: r.ok, out: r.out, error: r.ok ? undefined : String(r.err).slice(0, 300) });
      }
      if (url.pathname === '/api/write') {
        const [col, id] = String(b.path ?? '').split('/');
        if (!['decisions', 'requests'].includes(col) || !id) return json(res, 400, { error: 'unsupported path' });
        if (!b.data || typeof b.data !== 'object' || Array.isArray(b.data)) return json(res, 400, { error: 'data must be an object' });
        const inbox = { decisions: [], requests: [] };
        if (col === 'decisions') inbox.decisions.push(b.data); else inbox.requests.push({ id, ...b.data, budget: b.data.monthly_budget ?? b.data.budget, market: b.data.target_market ?? b.data.market, price: b.data.price_point ?? b.data.price });
        const f = path.join(stateDir, `inbox-local-${Date.now()}.json`);
        writeJson(f, inbox);
        const r = await node('apply-decisions.mjs', [f]);
        fs.rmSync(f, { force: true });
        // apply-decisions exits 0 even when it rejects an entry, so its summary line decides the answer.
        let applied = null;
        try { applied = JSON.parse(r.out); } catch { /* no summary line */ }
        const errors = [...(Array.isArray(applied?.errors) ? applied.errors : []), ...(r.ok ? [] : [String(r.err || 'apply-decisions failed').slice(0, 300)])];
        if (!applied && !errors.length) errors.push('apply-decisions printed no result');
        if (errors.length) { rebuild(); return json(res, 422, { ok: false, error: errors.join('; ').slice(0, 500), errors }); }
        let pid = null;
        if (col === 'decisions' && b.data.product && slugOk(b.data.product)) await node('execute.mjs', [b.data.product]);
        if (col === 'requests' && b.data.kind === 'new-product') {
          const slug = String(b.data.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
          if (slugOk(slug) && b.data.ignite !== false) {
            // Only a product that really exists gets a (paid) headless run, and only one run at a time.
            if (!fs.existsSync(path.join(root, 'products', slug, 'product.json'))) { rebuild(); return json(res, 422, { ok: false, error: `product ${slug} was not created`, errors: [`product ${slug} was not created`] }); }
            if (igniting.has(slug)) { rebuild(); return json(res, 409, { error: 'already running', pid: igniting.get(slug), applied: r.out }); }
            pid = ignite(slug);
          }
        }
        rebuild();
        return json(res, 200, { ok: true, applied: r.out, ignite_pid: pid });
      }
      if (url.pathname === '/api/vault') {
        if (!VAULT_KEYS.has(b.key)) return json(res, 400, { error: `unknown key ${String(b.key).slice(0, 80)}` });
        if (!(b.value == null || (typeof b.value === 'string' && b.value.length <= 4096))) return json(res, 400, { error: 'value must be a string of at most 4096 characters' });
        setEnv(b.key, b.value ?? '');
        return json(res, 200, { ok: true, key: b.key, set: Boolean(b.value) });
      }
      if (url.pathname === '/api/product') {
        if (!slugOk(b.slug)) return json(res, 400, { error: 'bad slug' });
        const f = path.join(root, 'products', b.slug, 'product.json');
        const p = readJson(f, null);
        if (!p) return json(res, 404, { error: 'no such product' });
        if (['free', 'paid', 'hybrid'].includes(b.mode)) p.budget.mode = b.mode;
        if (b.mode === 'free') { p.budget.monthly_cap = 0; p.budget.daily_cap = 0; }
        if (b.monthly_cap != null && b.mode !== 'free') { const cap = Math.max(0, Number(b.monthly_cap) || 0); p.budget.monthly_cap = cap; p.budget.daily_cap = Math.max(cap ? 1 : 0, Math.ceil(cap / 30)); }
        if (['USD', 'EUR', 'GBP'].includes(b.currency)) p.budget.currency = b.currency;
        if (['manual', 'supervised', 'autopilot', 'full'].includes(b.autonomy)) p.autonomy.level = b.autonomy;
        if (['active', 'paused'].includes(b.stage)) p.stage = b.stage;
        writeJson(f, p);
        await node('budget.mjs', [b.slug]);
        rebuild();
        return json(res, 200, { ok: true, budget: p.budget, autonomy: p.autonomy.level, stage: p.stage });
      }
      if (url.pathname === '/api/agents') {
        // Proposal only: agent-builder writes state/evolution/proposals/<id>.json and nothing else. Shipping stays
        // with tools/evolve.mjs (a passed red team and a knowledge fact, or the owner's --owner apply).
        const { proposeAgent } = await import('./agent-builder.mjs');
        const r = await proposeAgent(agentForm(b));
        if (!r.written) return json(res, 400, { ok: false, errors: (r.errors ?? []).slice(0, 30), gates: r.gates ?? [] });
        return json(res, 200, { ok: true, id: r.id, agent: r.agent, file: r.file, gates: r.gates, next: r.next, shipped: false });
      }
      if (url.pathname === '/api/install/key') {
        const { ensureInstallKey } = await import('./install-snippet.mjs');
        ensureInstallKey();
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/install/site') {
        const domain = String(b.domain ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        if (!/^(?=.{3,253}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return json(res, 400, { error: 'Enter a domain such as example.com' });
        const r = await new Promise((resolve) => execFile(process.execPath, [path.join(root, 'tools', 'instant-onboard.mjs'), domain, '--edge'], { cwd: root, timeout: 90000, env: process.env }, (err, out, errOut) => {
          if (err) return resolve({ error: String(errOut || err.message).slice(0, 300) });
          try { resolve(JSON.parse(String(out).trim().split(/\r?\n/).at(-1))); } catch { resolve({ error: 'instant onboarding printed no result' }); }
        }));
        if (r.error) return json(res, 500, { error: r.error });
        await node('sync-sites.mjs', ['--only', r.slug]);
        rebuild();
        return json(res, 200, r);
      }
      if (url.pathname === '/api/ignite') {
        if (!slugOk(b.slug) || !fs.existsSync(path.join(root, 'products', b.slug))) return json(res, 400, { error: 'bad slug' });
        if (igniting.has(b.slug)) return json(res, 409, { error: 'already running', pid: igniting.get(b.slug) });
        return json(res, 200, { ok: true, pid: ignite(b.slug) });
      }
    }
    res.writeHead(404); res.end('Not found');
  } catch (e) { json(res, 500, { error: String(e.message ?? e) }); }
});

await node('needs-you-know.mjs');
await node('live-snapshot.mjs', ['--idle']);
server.on('error', (e) => { console.error(`Command Center cannot listen on ${bindHost}:${port}: ${e.code ?? e.message}`); process.exit(3); });
process.on('uncaughtException', (e) => console.error(`server error (kept running): ${e.stack ?? e}`));
server.listen(port, bindHost, () => console.log(`Whalyom Command Center: http://${bindHost === '127.0.0.1' ? 'localhost' : bindHost}:${port}${dashPass ? ' (password protected)' : ''}`));
