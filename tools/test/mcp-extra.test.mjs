// Extra whalyom-core MCP tools, the offline license stub, and the plugin packaging.
// No real network: connectors are unconfigured (dry runs only) and fake secrets are checked for leaks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { issueLicense, verifyLicense } from '../plugin/license.mjs';
import { testEnv } from './_env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const slug = `zz-mcpx-${process.pid}`;
const P = (f = '') => path.join(ROOT, 'products', slug, f);
const OWNER = `owner-${crypto.randomBytes(12).toString('hex')}`;
const LEAK = `leakcheck${crypto.randomBytes(6).toString('hex')}`;
const NO_KEYS = /^(META_|RESEND_|OM_WEBHOOK_|OM_SITE_REPO|STRIPE_|OM_KILL|GOOGLE_|GA4_|PLAUSIBLE_|UMAMI_|CALCOM_|CALENDLY_|WHALYOM_)/;
const baseEnv = () => testEnv(Object.fromEntries(Object.entries(process.env).filter(([k]) => !NO_KEYS.test(k))));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-mcpx-'));
const distParent = path.join(ROOT, 'dist', `zz-test-${process.pid}`);

async function connect(script, env, cwd = ROOT) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [script], cwd, env }));
  return client;
}
const call = async (client, name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return { error: Boolean(r.isError), text: r.content[0].text, json: (() => { try { return JSON.parse(r.content[0].text); } catch { return null; } })() };
};

before(() => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'new-product.mjs'), slug, '--name', 'MCP Extra'], { encoding: 'utf8', cwd: ROOT, env: baseEnv() });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  fs.writeFileSync(P('approvals.json'), JSON.stringify([{ id: 'A1', type: 'post', channel: 'x', title: 'Thread', file: 'outbox/x.md', status: 'pending', compliance: 'pass' }]));
  fs.writeFileSync(P('experiments.json'), JSON.stringify([
    { id: 'E1', hypothesis: 'Shorter headline lifts signups', metric: 'signup_rate', status: 'running', stop_date: '2026-12-01' },
    { id: 'E2', hypothesis: 'Reddit beats X', metric: 'cpa', status: 'done', verdict: 'win', result: 'CPA 30% lower' },
  ]));
});
after(() => {
  fs.rmSync(P(), { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(distParent, { recursive: true, force: true });
  try { if (!fs.readdirSync(path.join(ROOT, 'dist')).length) fs.rmdirSync(path.join(ROOT, 'dist')); } catch { /* dist may hold a real build */ }
});

test('extra MCP tools over stdio', async () => {
  const env = { ...baseEnv(), WHALYOM_OWNER_TOKEN: OWNER, DISCORD_WEBHOOK_URL: `https://discord.com/api/webhooks/1/${LEAK}` };
  const client = await connect('tools/mcp/whalyom-core.mjs', env);
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of ['workspace_list', 'growth_execute', 'graph_snapshot', 'list_connectors', 'connector_status', 'metrics_pull', 'booking_links', 'build_landing', 'attach_site_status', 'run_doctor', 'queue_task', 'approve_item', 'experiments_summary', 'license_status'])
      assert.ok(names.includes(n), `missing tool ${n}`);

    const list = await call(client, 'list_connectors');
    assert.ok(!list.error, list.text);
    assert.ok(list.json.connectors.length > 30);
    assert.ok(list.json.configured.includes('discord') && list.json.configured.includes('local-site'));
    assert.ok(!list.text.includes(LEAK), 'list_connectors must never return secret values');
    const discord = await call(client, 'connector_status', { name: 'discord', slug });
    assert.equal(discord.json.configured, true); assert.equal(discord.json.usable_for_product, true); assert.ok(!discord.text.includes(LEAK));
    const ga4 = await call(client, 'connector_status', { name: 'ga4' });
    assert.equal(ga4.json.configured, false); assert.ok(ga4.json.missing.includes('GA4_PROPERTY_ID'));
    assert.ok((await call(client, 'connector_status', { name: 'nope' })).error);

    const pull = await call(client, 'metrics_pull', { slug });
    assert.ok(!pull.error, pull.text); assert.equal(pull.json.dry_run, true);
    assert.ok(pull.json.results.every((r) => r.dry_run && r.rows === 0));
    const links = await call(client, 'booking_links', { slug });
    assert.ok(!links.error, links.text);

    const denied = await call(client, 'approve_item', { slug, approval_id: 'A1', decision: 'approve', owner_token: 'x'.repeat(20) });
    assert.ok(denied.error); assert.match(denied.text, /does not match/);
    const ok = await call(client, 'approve_item', { slug, approval_id: 'A1', decision: 'approve', owner_token: OWNER, note: 'looks good' });
    assert.ok(!ok.error, ok.text); assert.equal(ok.json.status, 'approved');
    assert.equal(JSON.parse(fs.readFileSync(P('approvals.json'), 'utf8'))[0].status, 'approved');
    assert.ok((await call(client, 'approve_item', { slug, approval_id: 'NOPE', decision: 'reject', owner_token: OWNER })).error);

    assert.ok((await call(client, 'queue_task', { slug, title: 'Write a launch post', agent: 'om-nobody' })).error, 'unknown agent rejected');
    const q = await call(client, 'queue_task', { slug, title: 'Write a launch post', agent: 'om-writer', brief: 'One post for launch day', priority: 2, apply: true });
    assert.ok(!q.error, q.text);
    const tasks = JSON.parse(fs.readFileSync(P('tasks.json'), 'utf8'));
    assert.ok(tasks.some((t) => t.agent === 'om-writer' && t.title === 'Write a launch post' && t.status === 'todo' && t.priority === 2));

    const ex = await call(client, 'experiments_summary', { slug });
    assert.equal(ex.json.products[0].total, 2); assert.equal(ex.json.products[0].running[0].id, 'E1'); assert.equal(ex.json.products[0].decided[0].verdict, 'win');

    const att = await call(client, 'attach_site_status', { slug });
    assert.ok(!att.error, att.text); assert.equal(att.json.satellite.secret_present, false); assert.match(att.json.next, /attach\.mjs/);

    const doc = await call(client, 'run_doctor', { slug });
    assert.ok(!doc.error, doc.text); assert.equal(doc.json.products.length, 1);

    const land = await call(client, 'build_landing', { slug, list: true });
    if (fs.existsSync(path.join(ROOT, 'tools', 'landing-builder.mjs'))) assert.ok(!land.error, land.text); else assert.ok(land.error);

    const lic = await call(client, 'license_status');
    assert.equal(lic.json.edition, 'free');
    assert.ok((await call(client, 'queue_task', { slug: '../x', title: 'bad', agent: 'om-writer' })).error, 'invalid slug rejected');
  } finally { await client.close(); }

  const noToken = await connect('tools/mcp/whalyom-core.mjs', baseEnv());
  try {
    const r = await call(noToken, 'approve_item', { slug, approval_id: 'A1', decision: 'reject', owner_token: OWNER });
    assert.ok(r.error); assert.match(r.text, /disabled/);
  } finally { await noToken.close(); }
});

test('scrubString masks URL userinfo and secret query parameters, keeps the rest', async () => {
  const { scrub, scrubString } = await import('../mcp/extra-tools.mjs');
  assert.equal(scrubString('https://user:ghp_abc123@github.com/o/r.git'), 'https://***@github.com/o/r.git');
  assert.equal(scrubString('https://x-access-token:tok@github.com/o/r.git'), 'https://***@github.com/o/r.git');
  const sat = scrubString('https://s.example.com/hook?key=abc&page=2&sig=zz');
  assert.ok(!sat.includes('abc') && !sat.includes('zz') && sat.includes('page=2') && sat.startsWith('https://s.example.com/hook'));
  assert.equal(scrubString('../site-repo'), '../site-repo');
  assert.equal(scrubString('https://h/cb#access_token=zz&state=s1'), 'https://h/cb#access_token=***&state=s1');
  assert.equal(scrubString(null), null);
  const nested = scrub({ repo_source: 'https://u:p4ss@gitlab.com/a/b.git', api_key: 'x', list: ['https://h/?token=t1'] });
  assert.equal(nested.api_key, '***'); assert.ok(!JSON.stringify(nested).includes('p4ss') && !JSON.stringify(nested).includes('t1'));
});

test('attach_site_status masks secrets inside URL values; metrics_pull dry run selects what the real run would', async () => {
  const { metricReaders } = await import('../connectors/readers.mjs');
  fs.writeFileSync(P('connection.json'), JSON.stringify({ domain: 'example.com', repo_source: 'https://user:ghp_abc123@github.com/o/r.git', satellite: 'https://s.example.com/?key=abc' }));
  const fake = { GOOGLE_ADS_DEVELOPER_TOKEN: 'dev-test', GOOGLE_ADS_CUSTOMER_ID: '123-456-7890', GOOGLE_ACCESS_TOKEN: 'ya29.test', PLAUSIBLE_API_KEY: 'pk-test', PLAUSIBLE_SITE_ID: 'example.com' };
  const env = { ...baseEnv(), ...fake };
  const client = await connect('tools/mcp/whalyom-core.mjs', env);
  try {
    const att = await call(client, 'attach_site_status', { slug });
    assert.ok(!att.error, att.text);
    assert.ok(!att.text.includes('ghp_abc123'), 'git credential leaked');
    assert.ok(!att.text.includes('key=abc'), 'satellite key leaked');
    assert.ok(att.text.includes('github.com/o/r.git'));

    const expected = metricReaders.filter((r) => r.name !== 'stripe' && r.configured(env)).map((r) => r.name).sort();
    assert.ok(expected.includes('google-ads-metrics') && expected.includes('plausible'));
    const pull = await call(client, 'metrics_pull', { slug });
    assert.ok(!pull.error, pull.text); assert.equal(pull.json.dry_run, true);
    assert.deepEqual(pull.json.results.map((r) => r.source ?? r.name).sort(), expected);
    assert.ok(pull.json.results.every((r) => r.dry_run));

    const named = await call(client, 'metrics_pull', { slug, sources: ['google-ads-metrics'] });
    assert.ok(!named.error, named.text); assert.equal(named.json.results.length, 1);
    assert.ok((await call(client, 'metrics_pull', { slug, sources: ['nope'] })).error, 'unknown source rejected');
  } finally { await client.close(); fs.rmSync(P('connection.json'), { force: true }); }
});

test('license stub: offline Ed25519 keys, Free on anything invalid or expired', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  const priv = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const key = issueLicense(priv, { edition: 'agency', licensee: 'Test Agency', seats: 3, expires: '2099-01-01' });
  const v = verifyLicense(key, { publicKeyPem: pub });
  assert.equal(v.edition, 'agency'); assert.equal(v.verified, true); assert.equal(v.features.white_label, true);
  const [pre, body, sig] = key.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), seats: 999 })).toString('base64url');
  assert.equal(verifyLicense(`${pre}.${forged}.${sig}`, { publicKeyPem: pub }).edition, 'free');
  assert.equal(verifyLicense(issueLicense(priv, { edition: 'pro', licensee: 'Old', expires: '2020-01-01' }), { publicKeyPem: pub }).edition, 'free');
  assert.equal(verifyLicense(key, { publicKeyPem: null }).edition, 'free', 'dev build without a public key never unlocks');
  assert.equal(verifyLicense('', { publicKeyPem: pub }).edition, 'free');
  assert.throws(() => issueLicense(priv, { edition: 'free' }));
});

// The commercial plugin packager is not part of the free open-source edition (tools/oss/build.mjs).
test('plugin package: layout, exclusions, namespaced workflows, project install, MCP in plugin mode', { skip: !fs.existsSync(fileURLToPath(new URL('../plugin/package.mjs', import.meta.url))) }, async () => {
  const out = path.join(distParent, 'whalyom-plugin');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'plugin', 'package.mjs'), '--out', out, '--no-deps', '--own-only'], { encoding: 'utf8', cwd: ROOT });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const manifest = JSON.parse(fs.readFileSync(path.join(out, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'whalyom'); assert.ok(manifest.version); assert.ok(manifest.userConfig.license_key.sensitive);
  const mcp = JSON.parse(fs.readFileSync(path.join(out, '.mcp.json'), 'utf8'));
  assert.deepEqual(mcp.mcpServers['whalyom-core'].args, ['${CLAUDE_PLUGIN_ROOT}/tools/mcp/whalyom-core.mjs']);
  assert.equal(mcp.mcpServers['whalyom-core'].env.WHALYOM_HOME, '${CLAUDE_PROJECT_DIR}');
  const agents = fs.readdirSync(path.join(out, 'agents'));
  assert.ok(agents.length > 100 && agents.every((a) => a.startsWith('om-') && a.endsWith('.md')));
  assert.ok(fs.existsSync(path.join(out, 'skills', 'om', 'SKILL.md')) && fs.existsSync(path.join(out, 'skills', 'whalyom-setup', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(out, 'tools', 'execute.mjs')) && fs.existsSync(path.join(out, 'products', '_template', 'product.json')));
  // Never shipped
  for (const bad of ['state', 'site', 'sites', '.env', 'tools/test', 'products/sample-quoteflow', `products/${slug}`]) assert.ok(!fs.existsSync(path.join(out, bad)), `${bad} must not be packaged`);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = walk(out).map((f) => path.relative(out, f).replace(/\\/g, '/'));
  assert.ok(!files.some((f) => /(^|\/)\.env$|\.pem$|credentials.*\.json$/.test(f)), 'no secret files');
  const report = JSON.parse(fs.readFileSync(path.join(out, 'PACKAGE_REPORT.json'), 'utf8'));
  assert.ok(Array.isArray(report.findings));
  // Workflows: om-* agent types carry the plugin namespace and still parse.
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  for (const f of fs.readdirSync(path.join(out, 'workflows'))) {
    const src = fs.readFileSync(path.join(out, 'workflows', f), 'utf8');
    assert.doesNotThrow(() => new AsyncFunction('agent', 'log', 'args', 'parallel', 'phase', src.replace(/^export /gm, '')), `${f} must parse`);
    assert.ok(!/agentType:\s*'om-/.test(src), `${f}: literal om-* agent types must be namespaced`);
  }
  // Refuses to clobber a directory it did not build.
  const foreign = path.join(tmp, 'foreign'); fs.mkdirSync(foreign); fs.writeFileSync(path.join(foreign, 'keep.txt'), 'x');
  const refuse = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'plugin', 'package.mjs'), '--out', foreign, '--no-deps', '--own-only'], { encoding: 'utf8' });
  assert.notEqual(refuse.status, 0); assert.ok(fs.existsSync(path.join(foreign, 'keep.txt')));

  // Install into a fresh project, twice (second run keeps everything).
  const project = path.join(tmp, 'project');
  fs.mkdirSync(project);
  for (let i = 0; i < 2; i++) {
    const ins = spawnSync(process.execPath, [path.join(out, 'tools', 'plugin', 'install-project.mjs'), '--to', project], { encoding: 'utf8' });
    assert.equal(ins.status, 0, ins.stderr);
    const res = JSON.parse(ins.stdout.trim());
    if (i === 1) assert.equal(res.copied, 0);
  }
  assert.ok(fs.existsSync(path.join(project, 'tools', 'execute.mjs')) && fs.existsSync(path.join(project, 'products', '_template', 'product.json')));
  assert.match(fs.readFileSync(path.join(project, '.gitignore'), 'utf8'), /^\.env$/m);

  // The packaged MCP server (resolving the SDK from the repo's node_modules) works on the project.
  const client = await connect(path.join(out, 'tools', 'mcp', 'whalyom-core.mjs'), { ...baseEnv(), WHALYOM_HOME: project }, tmp);
  try {
    const created = await call(client, 'workspace_create', { slug: 'acme', name: 'Acme' });
    assert.ok(!created.error, created.text);
    assert.ok(fs.existsSync(path.join(project, 'products', 'acme', 'product.json')), 'workspace created in the project, not the plugin');
    assert.ok(!fs.existsSync(path.join(out, 'products', 'acme')));
    const ws = await call(client, 'workspace_list');
    assert.deepEqual(ws.json.products.map((p) => p.slug), ['acme']);
  } finally { await client.close(); }
});
