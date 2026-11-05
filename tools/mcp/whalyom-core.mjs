#!/usr/bin/env node
// whalyom-core: stdio MCP server exposing the Whalyom/OM engine scripts in tools/ as tools.
// Every tool runs the matching script with execFile (no shell) and returns its output as text.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { registerExtraTools } from './extra-tools.mjs';

const ENGINE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Workspace root. Default: this repo. When installed as a Claude Code plugin, the server runs from
// the plugin directory and WHALYOM_HOME (set to the project dir in the plugin's .mcp.json) points
// at the user's project, whose tools/ and products/ it then uses. In a packaged plugin an unset or
// unusable value falls back to the current directory if it is a Whalyom workspace.
function resolveRoot() {
  const isWorkspace = (d) => d && !d.includes('${') && fs.existsSync(path.join(d, 'tools', 'execute.mjs'));
  if (isWorkspace(process.env.WHALYOM_HOME)) return path.resolve(process.env.WHALYOM_HOME);
  const packaged = fs.existsSync(path.join(ENGINE_ROOT, '.whalyom-package')); // built by tools/plugin/package.mjs
  if (!packaged) return ENGINE_ROOT;
  return isWorkspace(process.cwd()) ? path.resolve(process.cwd()) : ENGINE_ROOT;
}
const ROOT = resolveRoot();
const TOOLS = path.join(ROOT, 'tools');
const MAX_EXCERPT = 20000;

// A slug must not start with a hyphen: the scripts read options by flag name, so a slug such as '--idle'
// or '--dry-run' would act as a flag.
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must match ^[a-z0-9][a-z0-9-]*$').describe('Product slug (a-z, 0-9, hyphen; not starting with a hyphen)');
// Free text passed as an argv value must not look like a flag (e.g. name '--budget' or note '--idle').
const notFlag = (s) => s.regex(/^(?!-)/, 'must not start with -');
const channel = z.string().regex(/^[A-Za-z0-9_.-]+$/, 'channel may contain letters, digits, _ . -').max(64);
const presets = ['saas', 'ecommerce', 'local_service', 'b2b_services', 'info_product', 'mobile_app', 'marketplace', 'creator_media'];

function run(script, args = []) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(TOOLS, script), ...args], { cwd: ROOT, timeout: 120000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => resolve({ ok: !err, code: err ? (err.code ?? 1) : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }));
  });
}
const text = (t) => ({ content: [{ type: 'text', text: t }] });
const err = (t) => ({ isError: true, content: [{ type: 'text', text: t }] });
const fail = (r) => err((r.stderr || r.stdout || `script exited with code ${r.code}`).trim());
const guard = (fn) => async (a) => { try { return await fn(a); } catch (e) { return err(String(e?.message ?? e)); } };
const script = (name, build) => guard(async (a) => { const r = await run(name, build(a ?? {})); return r.ok ? text(r.stdout.trim() || '{}') : fail(r); });
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const lastJsonLine = (s) => { try { return JSON.parse(s.trim().split('\n').pop()); } catch { return s.trim(); } };

const server = new McpServer({ name: 'whalyom-core', version: '0.1.0' });

server.registerTool('workspace_list', {
  description: 'List all product workspaces (products/*/product.json, excluding templates) with name, stage, budget mode, caps and currency.',
  inputSchema: {},
}, guard(async () => {
  const dir = path.join(ROOT, 'products');
  const out = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('_')) continue;
    const f = path.join(dir, d.name, 'product.json');
    if (!fs.existsSync(f)) continue;
    try {
      const p = readJson(f);
      out.push({
        slug: d.name, name: p.name ?? d.name, domain: p.domain ?? '', stage: p.stage ?? null, mode: p.budget?.mode ?? null,
        budget: { monthly_cap: p.budget?.monthly_cap ?? 0, daily_cap: p.budget?.daily_cap ?? 0, spent_this_month: p.budget?.spent_this_month ?? 0, currency: p.budget?.currency ?? null },
        autonomy: p.autonomy?.level ?? null,
      });
    } catch (e) { out.push({ slug: d.name, error: `invalid product.json: ${e.message}` }); }
  }
  return text(JSON.stringify({ products: out }, null, 2));
}));

server.registerTool('workspace_create', {
  description: 'Create a new product workspace from the template (new-product.mjs). Sets preset, autonomy level, monthly budget (switches to paid mode) and currency.',
  inputSchema: {
    slug,
    name: notFlag(z.string().min(1).max(120)).describe('Display name (must not start with -)'),
    preset: z.enum(presets).optional().describe('Channel/funnel preset (default saas)'),
    autonomy: z.enum(['manual', 'supervised', 'autopilot', 'full']).optional(),
    budget: z.number().nonnegative().optional().describe('Monthly budget cap; omit for free mode'),
    currency: z.enum(['USD', 'EUR', 'GBP']).optional(),
    domain: z.string().regex(/^[A-Za-z0-9.-]+$/).max(253).optional().describe('Product domain, e.g. example.com'),
  },
}, script('new-product.mjs', (a) => {
  const x = [a.slug, '--name', a.name];
  if (a.domain) x.push('--domain', a.domain);
  if (a.preset) x.push('--preset', a.preset);
  if (a.autonomy) x.push('--autonomy', a.autonomy);
  if (a.budget !== undefined) x.push('--budget', String(a.budget));
  if (a.currency) x.push('--currency', a.currency);
  return x;
}));

server.registerTool('tasks_ready', {
  description: 'List tasks that can run now for a product (status todo, all dependencies done), as JSON (ready.mjs).',
  inputSchema: { slug, limit: z.number().int().min(1).max(100).optional().describe('Maximum tasks to return') },
}, script('ready.mjs', (a) => [a.slug, ...(a.limit ? [String(a.limit)] : [])]));

server.registerTool('results_apply', {
  description: 'Merge agent result files (products/<slug>/runs/*.json) into tasks.json, approvals.json and experiments.json (apply-results.mjs). Writes workspace ledgers.',
  inputSchema: { slug },
}, script('apply-results.mjs', (a) => [a.slug]));

server.registerTool('workspace_validate', {
  description: 'Check a product workspace for broken JSON, unknown agents, bad dependencies and stuck tasks (validate.mjs).',
  inputSchema: { slug },
}, script('validate.mjs', (a) => [a.slug]));

server.registerTool('growth_policy', {
  description: 'Apply the product autonomy policy: turns eligible pending approvals into auto-approved (policy.mjs). Writes approvals.json.',
  inputSchema: { slug },
}, script('policy.mjs', (a) => [a.slug]));

server.registerTool('growth_execute', {
  description: 'Execute approved/auto-approved actions through configured connectors, or write manual steps (execute.mjs). dry_run defaults to true (preview only); set false to really execute. Respects kill switches and budget caps.',
  inputSchema: { slug, dry_run: z.boolean().default(true).describe('Preview only (default true). Set false to really execute.') },
}, script('execute.mjs', (a) => [a.slug, ...(a.dry_run !== false ? ['--dry-run'] : [])]));

server.registerTool('ads_budget', {
  description: 'Show budget status for a product: spend this month, caps, per-channel results and proposed split (budget.mjs). With record_amount and record_channel, also records actual spend in the ledger.',
  inputSchema: {
    slug,
    record_amount: z.number().positive().optional().describe('Actual spend to record in the ledger'),
    record_channel: notFlag(channel).optional().describe('Channel the spend belongs to (required with record_amount; must not start with -)'),
    ref: notFlag(z.string().regex(/^[A-Za-z0-9_.-]+$/).max(64)).optional().describe('Optional approval/reference id (must not start with -)'),
  },
}, guard(async (a) => {
  if ((a.record_amount === undefined) !== (a.record_channel === undefined)) return err('record_amount and record_channel must be given together');
  const x = [a.slug];
  if (a.record_amount !== undefined) { x.push('--record', String(a.record_amount), a.record_channel); if (a.ref) x.push('--ref', a.ref); }
  const r = await run('budget.mjs', x);
  return r.ok ? text(r.stdout.trim() || '{}') : fail(r);
}));

server.registerTool('ads_connectors_status', {
  description: 'Show which outbound connectors (ads, email, publishing, webhooks) are configured. Never prints secrets (connectors-status.mjs).',
  inputSchema: {},
}, script('connectors-status.mjs', () => []));

server.registerTool('metrics_ingest', {
  description: 'Ingest metrics for a product from metrics/inbox files and Stripe (if configured) into metrics/kpis.json (metrics.mjs).',
  inputSchema: { slug },
}, script('metrics.mjs', (a) => [a.slug]));

server.registerTool('nyk_build', {
  description: 'Build the Needs-You-Know feed (ranked owner decisions, approvals, blocked work, alerts) via needs-you-know.mjs and return its summary plus items.',
  inputSchema: {},
}, guard(async () => {
  const r = await run('needs-you-know.mjs');
  if (!r.ok) return fail(r);
  const f = path.join(ROOT, 'state', 'live-nyk.json');
  const items = fs.existsSync(f) ? (readJson(f).items ?? []) : [];
  return text(JSON.stringify({ summary: lastJsonLine(r.stdout), items }, null, 2));
}));

server.registerTool('graph_snapshot', {
  description: 'Rebuild the live control-room snapshot (live-snapshot.mjs) and return its counts plus a size-capped excerpt of state/live-graph.json.',
  inputSchema: {
    run: notFlag(z.string().max(120)).optional(), phase: notFlag(z.string().max(120)).optional(), product: slug.optional(),
    note: notFlag(z.string().max(500)).optional(), idle: z.boolean().optional(),
  },
}, guard(async (a) => {
  const x = [];
  for (const k of ['run', 'phase', 'product', 'note']) if (a[k]) x.push(`--${k}`, a[k]);
  if (a.idle) x.push('--idle');
  const r = await run('live-snapshot.mjs', x);
  if (!r.ok) return fail(r);
  const f = path.join(ROOT, 'state', 'live-graph.json');
  let graph = null;
  if (fs.existsSync(f)) {
    const g = readJson(f);
    const nodes = Array.isArray(g.nodes) ? g.nodes : [];
    const edges = Array.isArray(g.edges) ? g.edges : Array.isArray(g.links) ? g.links : [];
    const ex = { updated_at: g.updated_at, node_count: nodes.length, edge_count: edges.length, nodes: [], edges: [] };
    let size = JSON.stringify(ex).length;
    for (const n of nodes) { const s = JSON.stringify(n).length + 1; if (size + s > MAX_EXCERPT / 2) break; ex.nodes.push(n); size += s; }
    for (const e of edges) { const s = JSON.stringify(e).length + 1; if (size + s > MAX_EXCERPT) break; ex.edges.push(e); size += s; }
    ex.truncated = ex.nodes.length < nodes.length || ex.edges.length < edges.length;
    graph = ex;
  }
  return text(JSON.stringify({ counts: lastJsonLine(r.stdout), graph }, null, 2));
}));

registerExtraTools(server, { ROOT, run, text, err, guard, fail, slug });

await server.connect(new StdioServerTransport());
