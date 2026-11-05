// Integrations catalog: connectors, readers, MCP servers and third-party manifests in one list, with
// configured flags and missing env key NAMES only (never values), manifest validation guards, and
// setup proposals that go to the approval queue instead of being executed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateManifest, loadManifests, describeConnector, connectorObjects, loadConnectors, scanMcpTools, loadMcp,
  buildCatalog, collectIntegrations, writeCatalog, setupProposal, writeProposal, redactValues, isOutbound, formatCatalog,
} from '../integrations.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-integrations-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const mk = (...p) => { const d = path.join(tmp, ...p); fs.mkdirSync(d, { recursive: true }); return d; };
const put = (file, v) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof v === 'string' ? v : JSON.stringify(v)); };
const NOW = '2026-11-04T00:00:00.000Z';
const good = { name: 'hubspot', category: 'crm', auth: 'oauth2', env: ['HUBSPOT_TOKEN'], capabilities: ['contacts.read', 'email.send'], docs_url: 'https://developers.hubspot.com/docs/api/overview', description: 'CRM' };

test('a valid manifest is normalized; outbound capabilities are flagged', () => {
  const v = validateManifest({ ...good, capabilities: ['Contacts.Read', 'email.send', 'contacts.read'] });
  assert.equal(v.ok, true, v.errors.join('; '));
  assert.deepEqual(v.manifest.capabilities, ['contacts.read', 'email.send']);
  assert.equal(isOutbound('email.send'), true);
  assert.equal(isOutbound('ads.budget'), true);
  assert.equal(isOutbound('contacts.read'), false);
});

test('manifest guards: secrets, bad names, bad keys, http docs, missing env for auth', () => {
  assert.equal(validateManifest(null).ok, false);
  assert.equal(validateManifest([]).ok, false);
  const secret = validateManifest({ ...good, api_key: 'sk_live_abcdef' });
  assert.equal(secret.ok, false);
  assert.match(secret.errors.join(' '), /looks like a secret/);
  assert.equal(validateManifest({ ...good, name: 'Bad Name' }).ok, false);
  assert.equal(validateManifest({ ...good, env: ['lowercase'] }).ok, false);
  assert.equal(validateManifest({ ...good, env: 'HUBSPOT_TOKEN' }).ok, false);
  assert.equal(validateManifest({ ...good, docs_url: 'http://example.com' }).ok, false);
  assert.equal(validateManifest({ ...good, docs_url: 'https://user:pw@example.com' }).ok, false);
  assert.equal(validateManifest({ ...good, auth: 'magic' }).ok, false);
  assert.equal(validateManifest({ ...good, env: [] }).ok, false);
  assert.equal(validateManifest({ ...good, capabilities: [] }).ok, false);
  const none = validateManifest({ ...good, auth: 'none', env: [] });
  assert.equal(none.ok, true);
  const warn = validateManifest({ ...good, category: 'weird', extra: 1 });
  assert.equal(warn.ok, true);
  assert.equal(warn.warnings.length, 2);
});

test('manifests directory: valid, invalid JSON, duplicates, oversized, missing dir', () => {
  const dir = mk('manifests');
  put(path.join(dir, 'a-hubspot.json'), good);
  put(path.join(dir, 'b-dup.json'), { ...good, description: 'second' });
  put(path.join(dir, 'c-broken.json'), '{ not json');
  put(path.join(dir, 'd-big.json'), JSON.stringify({ ...good, name: 'big', description: 'x'.repeat(70000) }));
  put(path.join(dir, 'e-any.json'), { name: 'pipedrive', category: 'crm', auth: 'api_key', env_any: ['PIPEDRIVE_TOKEN', 'PIPEDRIVE_API_KEY'], capabilities: ['deals.read'], docs_url: 'https://developers.pipedrive.com/docs/api/v1' });
  put(path.join(dir, 'notes.txt'), 'ignored');
  const r = loadManifests({ dir, env: { PIPEDRIVE_API_KEY: 'x' } });
  assert.deepEqual(r.rows.map((x) => x.name), ['hubspot', 'pipedrive']);
  assert.deepEqual(r.invalid.map((x) => x.file), ['b-dup.json', 'c-broken.json', 'd-big.json']);
  const hub = r.rows.find((x) => x.name === 'hubspot');
  assert.equal(hub.configured, false);
  assert.deepEqual(hub.missing, ['HUBSPOT_TOKEN']);
  assert.equal(hub.requires_approval, true);
  assert.deepEqual(hub.outbound_capabilities, ['email.send']);
  assert.equal(r.rows.find((x) => x.name === 'pipedrive').status, 'configured');
  assert.deepEqual(loadManifests({ dir: path.join(tmp, 'nope') }), { rows: [], invalid: [], errors: [] });
});

test('connector rows: configured flag and missing names, throwing connectors do not break the list', () => {
  const env = { A_KEY: 'value-123456789' };
  const ok = describeConnector({ name: 'alpha', needs: ['A_KEY'], configured: (e) => !!e.A_KEY, execute() {} }, env);
  assert.equal(ok.status, 'configured');
  assert.equal(ok.requires_approval, true);
  const miss = describeConnector({ name: 'beta', needs: ['B_KEY', 'A_KEY'], execute() {} }, env);
  assert.deepEqual(miss.missing, ['B_KEY']);
  const reader = describeConnector({ name: 'gamma', kind: 'metrics', needs: [], read() {}, configured: () => true }, env);
  assert.equal(reader.source, 'reader');
  assert.equal(reader.requires_approval, false);
  assert.equal(reader.status, 'no_keys_needed');
  const bad = describeConnector({ name: 'delta', needs: ['D_KEY'], configured: () => { throw new Error('boom'); }, execute() {} }, env);
  assert.equal(bad.configured, false);
  assert.match(bad.errors[0], /boom/);
  const objs = connectorObjects({ default: [{ name: 'one', configured: () => true }, 'x'], helper: () => 1, API: 'https://x', two: { name: 'two', kind: 'links' }, bad: { name: 'Bad Name', configured: () => true } });
  assert.deepEqual(objs.map((o) => o.name).sort(), ['one', 'two']);
});

test('loadConnectors reads a temp dir, skips helpers, dedupes, records import errors', async () => {
  const dir = mk('connectors');
  put(path.join(dir, '_http.mjs'), 'export default { name: "helper", configured: () => true };');
  put(path.join(dir, 'a.mjs'), 'export default { name: "zeta", needs: ["Z_KEY"], configured: (e) => !!e.Z_KEY, execute() {} };');
  put(path.join(dir, 'b.mjs'), 'import a from "./a.mjs"; export const all = [a, { name: "eta", kind: "metrics", needs: [], configured: () => true, read() {} }];');
  put(path.join(dir, 'c.mjs'), 'throw new Error("cannot load");');
  const r = await loadConnectors({ dir, env: {} });
  assert.deepEqual(r.rows.map((x) => x.name), ['eta', 'zeta']);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].file, 'c.mjs');
  const none = await loadConnectors({ dir: path.join(tmp, 'missing-dir') });
  assert.equal(none.rows.length, 0);
  assert.equal(none.errors.length, 1);
});

test('MCP: tools read statically from the entry and its imports; args and values never reported', () => {
  const base = mk('mcp-root');
  put(path.join(base, 'srv', 'main.mjs'), "import { more } from './more.mjs';\nserver.registerTool('alpha_tool', {\n  description: 'Does alpha, it\\'s safe',\n  inputSchema: {} }, f);\n");
  put(path.join(base, 'srv', 'more.mjs'), "export const more = 1; server.registerTool('beta_tool', { description: \"Beta\" }, g); server.tool('legacy_tool', 'Legacy one', h);");
  put(path.join(base, '.mcp.json'), { mcpServers: {
    local: { command: '/usr/bin/node', args: ['srv/main.mjs', '--token=supersecretvalue'], env: { LOCAL_KEY: '${LOCAL_KEY}' } },
    remote: { type: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer ${REMOTE_TOKEN}' } },
    broken: 'nope',
  } });
  const r = loadMcp({ file: path.join(base, '.mcp.json'), base, env: { LOCAL_KEY: 'k' } });
  assert.deepEqual(r.servers.map((s) => s.name), ['local', 'remote']);
  assert.equal(r.errors.length, 1);
  const local = r.servers[0];
  assert.deepEqual(local.tools.map((t) => t.name), ['alpha_tool', 'beta_tool', 'legacy_tool']);
  assert.equal(local.tools[0].description, "Does alpha, it's safe");
  assert.equal(local.command, 'node');
  assert.equal(local.configured, true);
  assert.equal(r.servers[1].host, 'mcp.example.com');
  assert.deepEqual(r.servers[1].missing, ['REMOTE_TOKEN']);
  assert.doesNotMatch(JSON.stringify(r), /supersecretvalue|Bearer/);
  assert.deepEqual(loadMcp({ file: path.join(base, 'none.json'), base }), { servers: [], errors: [] });
  put(path.join(base, 'bad.json'), '[]');
  assert.equal(loadMcp({ file: path.join(base, 'bad.json'), base }).errors.length, 1);
  assert.deepEqual(scanMcpTools(null), []);
});

test('catalog is deterministic, counts by category, links manifests to connectors, never leaks values', async () => {
  const dir = mk('cat', 'connectors');
  put(path.join(dir, 'x.mjs'), 'export default [{ name: "hubspot", needs: ["HUBSPOT_TOKEN"], handles: "crm sync", execute() {} }, { name: "leaky", needs: ["LEAK_TOKEN"], handles: "echo SECRETVALUE123456", configured: () => true, execute() {} }];');
  const mdir = mk('cat', 'manifests');
  put(path.join(mdir, 'hubspot.json'), good);
  const env = { HUBSPOT_TOKEN: 'pat-na1-zzzzzzzzzzzz', LEAK_TOKEN: 'SECRETVALUE123456' };
  const opts = { env, now: NOW, connectorsDir: dir, manifestsDir: mdir, mcpFile: path.join(tmp, 'cat', 'none.json'), base: path.join(tmp, 'cat') };
  const a = await collectIntegrations(opts);
  const b = await collectIntegrations(opts);
  assert.deepEqual(a, b);
  assert.equal(a.generated_at, NOW);
  assert.deepEqual(a.integrations.map((r) => r.id), ['connector:hubspot', 'connector:leaky', 'manifest:hubspot']);
  assert.equal(a.integrations[2].connector, 'hubspot');
  assert.equal(a.totals.configured, 3);
  assert.equal(a.totals.manifests, 1);
  const s = JSON.stringify(a);
  assert.doesNotMatch(s, /SECRETVALUE123456|pat-na1/);
  assert.match(s, /\[redacted\]/);
  const text = formatCatalog(a);
  assert.match(text, /3 available, 3 configured/);
  const file = writeCatalog(a, path.join(tmp, 'cat', 'state', 'integrations.json'));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), a);
  assert.deepEqual(buildCatalog({ now: NOW }).totals.available, 0);
  assert.deepEqual(redactValues({ x: ['ok'] }, {}), { x: ['ok'] });
});

test('real repo: every built-in connector loads, whalyom-core MCP tools are listed, no values', async () => {
  const fake = { RESEND_API_KEY: 're_fake_0123456789abcdef', OM_EMAIL_FROM: 'from@example.com' };
  const cat = await collectIntegrations({ env: fake, now: NOW, manifestsDir: path.join(tmp, 'no-manifests') });
  assert.deepEqual(cat.errors, []);
  const names = cat.integrations.map((r) => r.name);
  for (const n of ['resend', 'webhook', 'local-site', 'stripe', 'meta-ads']) assert.ok(names.includes(n), n);
  assert.equal(cat.integrations.find((r) => r.name === 'resend').configured, true);
  const core = cat.mcp.servers.find((s) => s.name === 'whalyom-core');
  assert.ok(core && core.tools.some((t) => t.name === 'list_connectors'));
  assert.doesNotMatch(JSON.stringify(cat), /re_fake_0123456789abcdef/);
});

test('setup proposals are pending approvals written to the run file, never executed', () => {
  const pdir = mk('products');
  put(path.join(pdir, 'demo', 'product.json'), { name: 'Demo' });
  const mp = mk('manifests-p'); put(path.join(mp, 'h.json'), good);
  const row = loadManifests({ dir: mp }).rows.find((r) => r.name === 'hubspot');
  const p = setupProposal(row, { slug: 'demo', taskId: 'INT-1', now: NOW });
  assert.equal(p.status, 'pending');
  assert.equal(p.type, 'integration_setup');
  assert.deepEqual(p.needs_env, ['HUBSPOT_TOKEN']);
  assert.deepEqual(p.outbound_capabilities, ['email.send']);
  const f = writeProposal(p, { slug: 'demo', taskId: 'INT-1', productsDir: pdir });
  writeProposal(p, { slug: 'demo', taskId: 'INT-1', productsDir: pdir });
  const run = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(run.task_id, 'INT-1');
  assert.equal(run.approvals.length, 1);
  assert.throws(() => writeProposal(p, { slug: 'demo', taskId: '../evil', productsDir: pdir }), /task id/);
  assert.throws(() => writeProposal(p, { slug: 'Bad', taskId: 'X', productsDir: pdir }), /slug/);
  assert.throws(() => writeProposal(p, { slug: 'ghost', taskId: 'X', productsDir: pdir }), /not found/);
  assert.throws(() => setupProposal(null, { slug: 'demo' }), /unknown/);
  assert.throws(() => setupProposal(row, { slug: '../x' }), /slug/);
});

test('CLI --no-write --json prints the catalog and writes nothing', () => {
  const state = path.join(root, 'state', 'integrations.json');
  const before = fs.existsSync(state) ? fs.statSync(state).mtimeMs : null;
  const r = spawnSync(process.execPath, [path.join(root, 'tools', 'integrations.mjs'), '--no-write', '--json'], { encoding: 'utf8', cwd: root });
  assert.equal(r.status, 0, r.stderr);
  const cat = JSON.parse(r.stdout);
  assert.ok(cat.totals.available > 0);
  assert.equal(fs.existsSync(state) ? fs.statSync(state).mtimeMs : null, before);
});

test('outbound detection fails closed: unknown verbs and outreach verbs need approval', () => {
  for (const c of ['sequences.enroll', 'campaigns.schedule', 'sendemail', 'sequences', 'contacts.import', 'ads.pause', 'leads.sync'])
    assert.equal(isOutbound(c), true, c);
  for (const c of ['contacts.read', 'deals.list', 'reports.get', 'analytics', 'campaigns.search']) assert.equal(isOutbound(c), false, c);
  const d = mk('m-out');
  put(path.join(d, 'x.json'), { ...good, name: 'elevenx', capabilities: ['prospects.read', 'sequences.enroll'] });
  const row = loadManifests({ dir: d }).rows[0];
  assert.equal(row.requires_approval, true);
  assert.deepEqual(row.outbound_capabilities, ['sequences.enroll']);
});

test('personal data: email addresses in manifest text never reach the catalog', () => {
  const d = mk('m-pii');
  put(path.join(d, 'x.json'), { ...good, description: 'Owner jane.doe@example.com set this up' });
  const cat = buildCatalog({ manifests: loadManifests({ dir: d }).rows, now: NOW });
  assert.doesNotMatch(JSON.stringify(cat), /jane\.doe@example\.com/);
  assert.match(cat.integrations[0].handles, /\[email\]/);
});

test('writeProposal never clobbers a malformed run file and writes a names-only setup note', () => {
  const pdir = mk('products-2');
  put(path.join(pdir, 'demo', 'product.json'), { name: 'Demo' });
  put(path.join(pdir, 'demo', 'runs', 'T-BAD.json'), '{ broken');
  const mp = mk('manifests-q'); put(path.join(mp, 'h.json'), good);
  const row = loadManifests({ dir: mp }).rows[0];
  const p = setupProposal(row, { slug: 'demo', taskId: 'T-BAD', now: NOW });
  assert.throws(() => writeProposal(p, { slug: 'demo', taskId: 'T-BAD', productsDir: pdir }), /not overwritten/);
  assert.equal(fs.readFileSync(path.join(pdir, 'demo', 'runs', 'T-BAD.json'), 'utf8'), '{ broken');
  put(path.join(pdir, 'demo', 'runs', 'T-ARR.json'), { task_id: 'T-ARR', approvals: 'x' });
  assert.throws(() => writeProposal(p, { slug: 'demo', taskId: 'T-ARR', productsDir: pdir }), /not overwritten/);
  const f = writeProposal(p, { slug: 'demo', taskId: 'T-OK', productsDir: pdir });
  const ap = JSON.parse(fs.readFileSync(f, 'utf8')).approvals[0];
  assert.equal(ap.status, 'pending');
  assert.equal(ap.file, 'outbox/integrations/INT-hubspot.md');
  const note = fs.readFileSync(path.join(pdir, 'demo', ap.file), 'utf8');
  assert.match(note, /HUBSPOT_TOKEN/);
  assert.match(note, /email\.send/);
});

test('empty manifest file, BOM manifest and empty mcpServers are handled, not fatal', () => {
  const d = mk('m-empty');
  put(path.join(d, 'empty.json'), '');
  put(path.join(d, 'bom.json'), '﻿' + JSON.stringify({ ...good, name: 'bom' }));
  const r = loadManifests({ dir: d });
  assert.deepEqual(r.rows.map((x) => x.name), ['bom']);
  assert.equal(r.invalid[0].file, 'empty.json');
  const base = mk('mcp-empty');
  put(path.join(base, '.mcp.json'), { mcpServers: {} });
  assert.deepEqual(loadMcp({ file: path.join(base, '.mcp.json'), base }), { servers: [], errors: [] });
});
