// Extra whalyom-core MCP tools: connectors, metrics pulls, landing builds, site attachment status,
// doctor, task queueing, owner approvals and experiment summaries. Registered by whalyom-core.mjs.
// Rules kept here: the single-writer rule (tasks go in as runs/<id>.json for apply-results.mjs;
// owner decisions go through apply-decisions.mjs), nothing outbound without approval (no tool here
// publishes, sends or spends), and no secret value is ever returned.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { loadEnv } from '../lib/env.mjs';
import { status as coreStatus, connectors } from '../connectors/index.mjs';
import { extraStatus, readers } from '../connectors/extra.mjs';
import { pullMetrics, pullLinks, metricReaders } from '../connectors/readers.mjs';
import { checkLicense } from '../plugin/license.mjs';

const SECRET_FIELD = /(secret|token|password|api_?key|private)/i;

// Owner token for approve_item. Choice (audit item 15): the token is read ONLY from the process
// environment as it was when this module loaded, i.e. before registerExtraTools() calls loadEnv()
// on the repo .env, so a value written to .env can never enable approvals. And if the repo .env
// defines WHALYOM_OWNER_TOKEN at all, approve_item refuses: every agent with Read can open that
// file, so a token stored there is not an owner secret. Set it in the shell, the OS keychain
// wrapper or the MCP client's env block that starts the server, never in the repo.
const OWNER_TOKEN_AT_START = process.env.WHALYOM_OWNER_TOKEN;
export function ownerTokenStatus({ startToken = OWNER_TOKEN_AT_START, envFile } = {}) {
  let inRepoEnv = false;
  try {
    if (envFile && fs.existsSync(envFile)) inRepoEnv = fs.readFileSync(envFile, 'utf8').split(/\r?\n/).some((l) => /^\s*(export\s+)?WHALYOM_OWNER_TOKEN\s*=\s*\S/.test(l) && !l.trim().startsWith('#'));
  } catch { /* unreadable .env: treat as not present */ }
  if (inRepoEnv) return { ok: false, reason: 'approve_item refuses: WHALYOM_OWNER_TOKEN is stored in the repo .env, which agents can read. Remove it from .env and pass it in the environment that starts the MCP server.' };
  if (!startToken || String(startToken).length < 16) return { ok: false, reason: 'approve_item is disabled: start the MCP server with WHALYOM_OWNER_TOKEN (16+ characters) in its process environment (not in the repo .env)' };
  return { ok: true, token: String(startToken) };
}
// Secrets also hide inside string values (e.g. connection.repo_source or satellite URLs written by
// tools/attach.mjs): mask URL userinfo (https://user:token@host -> https://***@host) and
// secret-looking query parameters (?key=, ?sig=, ?token=, ...).
const SECRET_PARAM = /^(key|sig|signature|auth|access_?token|code)$/i;
const secretParam = (k) => SECRET_FIELD.test(k) || SECRET_PARAM.test(k);
export function scrubString(v) {
  if (typeof v !== 'string') return v;
  let s = v.replace(/(\/\/)[^/\s@?#]+@/g, '$1***@');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && s.includes('?')) {
    try {
      const u = new URL(s);
      let hit = false;
      for (const k of [...u.searchParams.keys()]) if (secretParam(k)) { u.searchParams.set(k, '***'); hit = true; }
      if (hit) s = u.toString().replace(/%2A/gi, '*');
    } catch { s = s.replace(/([?&])([^=&#]+)=[^&#]*/g, (m, p, k) => (secretParam(k) ? `${p}${k}=***` : m)); }
  }
  // Fragment parameters (#access_token=... from OAuth implicit flows) are masked the same way.
  const hash = s.indexOf('#');
  if (hash >= 0 && /^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    s = s.slice(0, hash) + s.slice(hash).replace(/([#&])([^=&#]+)=[^&#]*/g, (m, p, k) => (secretParam(k) ? `${p}${k}=***` : m));
  }
  return s;
}
export const scrub = (v) => (Array.isArray(v) ? v.map(scrub) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_FIELD.test(k) ? '***' : scrub(x)])) : scrubString(v));
const METRIC_SOURCES = metricReaders.map((r) => r.name);

export function registerExtraTools(server, { ROOT, run, text, err, guard, fail, slug }) {
  loadEnv(path.join(ROOT, '.env'));
  const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
  const productDir = (s) => path.join(ROOT, 'products', s);
  const needProduct = (s) => { if (!fs.existsSync(path.join(productDir(s), 'product.json'))) throw new Error(`products/${s}/product.json not found`); return productDir(s); };
  const json = (v) => text(JSON.stringify(v, null, 2));
  const allStatus = () => {
    const extra = new Map(extraStatus(process.env).map((s) => [s.name, s]));
    const exec = coreStatus(process.env).map((c) => ({ kind: extra.get(c.name)?.kind ?? 'executor', ...c, missing: extra.get(c.name)?.missing ?? (c.configured ? [] : c.needs), unverified: extra.get(c.name)?.unverified ?? null }));
    const rd = readers.map((r) => ({ kind: r.kind, name: r.name, configured: r.configured(process.env), needs: r.needs, missing: r.missing(process.env), handles: r.handles, unverified: r.unverified ?? null }));
    return [...exec, ...rd];
  };

  server.registerTool('list_connectors', {
    description: 'List every connector (executors in routing order, opt-in ad CSV exporters, read-only metrics and booking-link readers) with configured flag, missing env names and notes. Never returns secret values.',
    inputSchema: { only_configured: z.boolean().optional().describe('Return only configured connectors') },
  }, guard(async (a) => {
    const list = allStatus().filter((c) => !a?.only_configured || c.configured);
    return json({ count: list.length, configured: list.filter((c) => c.configured).map((c) => c.name), connectors: list });
  }));

  server.registerTool('connector_status', {
    description: 'Status of one connector by name: configured, which env variable NAMES are missing, what it handles, and (with slug) whether it is usable for that product. Never returns secret values.',
    inputSchema: { name: z.string().regex(/^[a-z0-9-]+$/).max(40), slug: slug.optional() },
  }, guard(async (a) => {
    const c = allStatus().find((x) => x.name === a.name);
    if (!c) return err(`unknown connector ${a.name}; see list_connectors`);
    const out = { ...c };
    if (a.slug) {
      const conn = connectors.find((x) => x.name === a.name);
      const dir = needProduct(a.slug);
      out.usable_for_product = conn ? Boolean(conn.configured(process.env) && (!conn.usableFor || conn.usableFor({ slug: a.slug, dir, env: process.env }))) : c.configured;
    }
    return json(out);
  }));

  server.registerTool('metrics_pull', {
    description: `Pull read-only metrics into products/<slug>/metrics/inbox/ for metrics_ingest. Sources: ${METRIC_SOURCES.join(', ')}. Without sources every configured reader except stripe runs (stripe only when named), and the dry run previews exactly that same selection. dry_run defaults to true (no network, shows what would be read).`,
    inputSchema: { slug, sources: z.array(z.enum(METRIC_SOURCES)).max(METRIC_SOURCES.length).optional(), days: z.number().int().min(1).max(90).optional(), dry_run: z.boolean().default(true) },
  }, guard(async (a) => {
    const dir = needProduct(a.slug);
    const ctx = { slug: a.slug, dir, env: process.env, now: new Date().toISOString(), dryRun: a.dry_run !== false };
    const names = a.sources?.length ? a.sources : undefined; // same reader selection in dry and real runs
    return json({ dry_run: ctx.dryRun, results: await pullMetrics(ctx, { names, days: a.days ?? 7 }), next: ctx.dryRun ? 'set dry_run false to read' : 'run metrics_ingest to import the inbox' });
  }));

  server.registerTool('booking_links', {
    description: 'Read booking links from Cal.com and Calendly event types into products/<slug>/research/booking-links.json (read-only on the platforms). dry_run defaults to true.',
    inputSchema: { slug, dry_run: z.boolean().default(true) },
  }, guard(async (a) => {
    const dir = needProduct(a.slug);
    return json(await pullLinks({ slug: a.slug, dir, env: process.env, now: new Date().toISOString(), dryRun: a.dry_run !== false }));
  }));

  server.registerTool('build_landing', {
    description: 'Build landing pages for a product with tools/landing-builder.mjs into products/<slug>/landing/dist/ (claims-guarded). Does not publish: publishing goes through an approval. Use list=true to see templates.',
    inputSchema: {
      slug,
      template: z.string().regex(/^[a-z0-9,-]+$/).max(200).optional().describe('Template name, comma list, or all'),
      variant: z.string().regex(/^[A-Za-z0-9,_-]+$/).max(100).optional().describe('Variant id or all'),
      clean: z.boolean().optional(), strict: z.boolean().optional(), list: z.boolean().optional(),
      task: z.string().regex(/^[A-Za-z0-9_.-]+$/).max(64).optional().describe('Also write runs/<task>.json for apply-results'),
    },
  }, guard(async (a) => {
    if (!fs.existsSync(path.join(ROOT, 'tools', 'landing-builder.mjs'))) return err('tools/landing-builder.mjs is not installed in this workspace');
    const x = [a.slug];
    if (a.list) x.push('--list');
    if (a.template) x.push('--template', a.template);
    if (a.variant) x.push('--variant', a.variant);
    if (a.clean) x.push('--clean');
    if (a.strict) x.push('--strict');
    if (a.task) x.push('--task', a.task);
    const r = await run('landing-builder.mjs', x);
    return r.ok ? text(r.stdout.trim() || '{}') : fail(r);
  }));

  server.registerTool('attach_site_status', {
    description: 'Show how a product is attached to its website: connection.json (secrets masked), whether the satellite secret and site repo are present (yes/no only), local static site pages, and the next attach step.',
    inputSchema: { slug },
  }, guard(async (a) => {
    const dir = needProduct(a.slug);
    const conn = readJson(path.join(dir, 'connection.json'), null);
    const key = a.slug.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    const siteDir = path.join(ROOT, 'site', a.slug);
    const pages = fs.existsSync(siteDir) ? fs.readdirSync(siteDir).filter((f) => f.endsWith('.html')).length : 0;
    const product = readJson(path.join(dir, 'product.json'), {});
    const out = {
      slug: a.slug, domain: product.domain ?? conn?.domain ?? null, connection: conn ? scrub(conn) : null,
      satellite: { url: scrubString(conn?.satellite ?? null), secret_present: Boolean(process.env[`OM_SAT_SECRET_${key}`]) },
      site_repo: { env_present: Boolean(process.env[`OM_SITE_REPO_${key}`] || process.env.OM_SITE_REPO), path_recorded: Boolean(conn?.repo) },
      local_site: { pages, path: pages ? `site/${a.slug}/` : null },
    };
    out.next = !conn ? `node tools/attach.mjs ${out.domain ?? '<domain>'} [--repo <path or git url>] [--satellite <url>]`
      : !out.satellite.url && !out.site_repo.env_present ? 'attach a repo (--repo) or a satellite (--satellite) so approved changes can reach the site'
        : out.satellite.url && !out.satellite.secret_present ? `satellite secret OM_SAT_SECRET_${key} missing from .env: re-run tools/attach.mjs with --satellite` : 'attached';
    return json(out);
  }));

  server.registerTool('run_doctor', {
    description: 'Health check: validate.mjs for one product or every product; with self_debug=true also runs self-debug.mjs --no-tests (writes state/self-debug.json and raises system alerts).',
    inputSchema: { slug: slug.optional(), self_debug: z.boolean().optional() },
  }, guard(async (a) => {
    const slugs = a.slug ? [a.slug] : fs.readdirSync(path.join(ROOT, 'products'), { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_') && fs.existsSync(path.join(ROOT, 'products', d.name, 'product.json'))).map((d) => d.name);
    const results = [];
    for (const s of slugs) { const r = await run('validate.mjs', [s]); results.push({ slug: s, ok: r.ok, output: (r.stdout || r.stderr).trim().slice(0, 4000) }); }
    let selfDebug = null;
    if (a.self_debug) { const r = await run('self-debug.mjs', ['--no-tests']); selfDebug = { ok: r.ok, output: (r.stdout || r.stderr).trim().slice(-4000) }; }
    return json({ healthy: results.every((r) => r.ok), products: results, self_debug: selfDebug });
  }));

  server.registerTool('queue_task', {
    description: 'Queue a task for an om-* agent. Respects the single-writer rule: writes products/<slug>/runs/Q-<stamp>.json (an owner request with new_tasks) and, with apply=true, runs apply-results.mjs to merge it into tasks.json.',
    inputSchema: {
      slug,
      title: z.string().min(3).max(140),
      agent: z.string().regex(/^om-[a-z0-9-]+$/).max(60).describe('Agent name, e.g. om-writer'),
      brief: z.string().max(4000).optional(),
      depends_on: z.array(z.string().regex(/^[A-Za-z0-9_.-]+$/).max(40)).max(20).optional(),
      priority: z.number().int().min(1).max(9).optional(),
      channel: z.string().regex(/^[A-Za-z0-9_.-]+$/).max(40).optional(),
      apply: z.boolean().optional(),
    },
  }, guard(async (a) => {
    const dir = needProduct(a.slug);
    const { roster } = await import(pathToFileURL(path.join(ROOT, 'tools', 'roster.mjs')).href);
    if (!roster.some((r) => r.name === a.agent)) return err(`unknown agent ${a.agent} (not in tools/roster.mjs)`);
    const id = `Q-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${crypto.randomBytes(2).toString('hex')}`;
    const runFile = { task_id: id, agent: 'owner', status: 'done', summary: `Owner queued: ${a.title}`.slice(0, 160),
      new_tasks: [{ title: a.title, agent: a.agent, brief: a.brief ?? a.title, depends_on: a.depends_on ?? [], priority: a.priority ?? 5, ...(a.channel ? { channel: a.channel } : {}) }] };
    fs.mkdirSync(path.join(dir, 'runs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'runs', `${id}.json`), JSON.stringify(runFile, null, 2));
    let applied = null;
    if (a.apply) { const r = await run('apply-results.mjs', [a.slug]); applied = r.ok ? r.stdout.trim().split('\n').pop() : (r.stderr || r.stdout).trim(); }
    return json({ queued: `runs/${id}.json`, applied: applied ?? 'not yet: run results_apply (or set apply=true)' });
  }));

  server.registerTool('approve_item', {
    description: 'Owner decision on one approval (approve or reject), applied through apply-decisions.mjs. Requires owner_token to match WHALYOM_OWNER_TOKEN from the environment that started the server (never the repo .env, which disables this tool); disabled when that is not set. Does not execute anything: growth_execute does that.',
    inputSchema: {
      slug,
      approval_id: z.string().regex(/^[A-Za-z0-9_.-]+$/).max(40),
      decision: z.enum(['approve', 'reject']),
      owner_token: z.string().min(16).max(256),
      note: z.string().max(500).optional(),
    },
  }, guard(async (a) => {
    const owner = ownerTokenStatus({ envFile: path.join(ROOT, '.env') });
    if (!owner.ok) return err(owner.reason);
    const expected = owner.token;
    const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
    if (!crypto.timingSafeEqual(h(a.owner_token), h(expected))) return err('owner token does not match');
    const dir = needProduct(a.slug);
    const ap = readJson(path.join(dir, 'approvals.json'), []).find((x) => x.id === a.approval_id);
    if (!ap) return err(`approval ${a.approval_id} not found in ${a.slug}`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-decision-'));
    const file = path.join(tmp, 'decision.json');
    try {
      fs.writeFileSync(file, JSON.stringify({ decisions: [{ product: a.slug, approval_id: a.approval_id, decision: a.decision, note: a.note ?? 'via MCP approve_item', at: new Date().toISOString(), by: 'owner (mcp)' }], requests: [] }));
      const r = await run('apply-decisions.mjs', [file]);
      if (!r.ok) return fail(r);
      const after = readJson(path.join(dir, 'approvals.json'), []).find((x) => x.id === a.approval_id);
      return json({ approval: a.approval_id, status: after?.status ?? null, result: r.stdout.trim().split('\n').pop() });
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }));

  server.registerTool('experiments_summary', {
    description: 'Summarise experiments.json for one product or all: counts by status and verdict, running tests with metric and stop date, and recent verdicts.',
    inputSchema: { slug: slug.optional() },
  }, guard(async (a) => {
    const slugs = a.slug ? [needProduct(a.slug) && a.slug] : fs.readdirSync(path.join(ROOT, 'products'), { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_')).map((d) => d.name);
    const out = [];
    for (const s of slugs) {
      const list = readJson(path.join(productDir(s), 'experiments.json'), null);
      if (!Array.isArray(list)) continue;
      const count = (k) => list.reduce((m, e) => { const v = String(e[k] ?? 'none'); m[v] = (m[v] ?? 0) + 1; return m; }, {});
      out.push({ slug: s, total: list.length, by_status: count('status'), by_verdict: count('verdict'),
        running: list.filter((e) => ['running', 'live', 'active'].includes(e.status)).slice(0, 20).map((e) => ({ id: e.id, hypothesis: String(e.hypothesis ?? '').slice(0, 160), metric: e.metric ?? null, stop: e.stop_date ?? e.stop ?? null })),
        decided: list.filter((e) => e.verdict).slice(-10).map((e) => ({ id: e.id, verdict: e.verdict, result: String(e.result ?? '').slice(0, 160) })) });
    }
    return json({ products: out });
  }));

  server.registerTool('license_status', {
    description: 'Show the Whalyom edition from the local license key (offline check; never blocks the free features, never phones home).',
    inputSchema: {},
  }, guard(async () => json(checkLicense({ env: process.env, home: ROOT }))));
}
