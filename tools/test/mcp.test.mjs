import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXPECTED = ['workspace_list', 'workspace_create', 'tasks_ready', 'results_apply', 'workspace_validate', 'growth_policy', 'growth_execute',
  'ads_budget', 'ads_connectors_status', 'metrics_ingest', 'nyk_build', 'graph_snapshot'];

test('whalyom-core MCP server over stdio', async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: ['tools/mcp/whalyom-core.mjs'], cwd: ROOT });
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of EXPECTED) assert.ok(names.includes(n), `missing tool ${n}`);
    for (const t of tools) assert.ok(t.description?.length > 20, `${t.name} needs a description`);

    const ws = await client.callTool({ name: 'workspace_list', arguments: {} });
    assert.ok(!ws.isError, ws.content[0].text);
    assert.ok(Array.isArray(JSON.parse(ws.content[0].text).products));

    const cs = await client.callTool({ name: 'ads_connectors_status', arguments: {} });
    assert.ok(!cs.isError, cs.content[0].text);
    assert.ok(cs.content[0].text.length > 0);

    const bad = await client.callTool({ name: 'tasks_ready', arguments: { slug: '../x' } });
    assert.ok(bad.isError, 'invalid slug must be rejected');

    // Values that look like flags must be rejected before any script runs.
    const flagSlug = await client.callTool({ name: 'tasks_ready', arguments: { slug: '--x' } });
    assert.ok(flagSlug.isError, 'slug starting with - must be rejected');
    const flagName = await client.callTool({ name: 'workspace_create', arguments: { slug: 'zz-flag-name-test', name: '--budget', currency: 'USD' } });
    assert.ok(flagName.isError, 'name starting with - must be rejected');
    assert.ok(!fs.existsSync(path.join(ROOT, 'products', 'zz-flag-name-test')), 'rejected create must leave no workspace');
    assert.ok(!fs.existsSync(path.join(ROOT, 'products', '--budget')), 'flag-like name must not become a workspace');
    for (const k of ['note', 'run', 'phase']) {
      const g = await client.callTool({ name: 'graph_snapshot', arguments: { [k]: '--idle' } });
      assert.ok(g.isError, `graph_snapshot ${k} starting with - must be rejected`);
    }
    const gp = await client.callTool({ name: 'graph_snapshot', arguments: { product: '--idle' } });
    assert.ok(gp.isError, 'graph_snapshot product starting with - must be rejected');
    // budget.mjs reads --record/--ref by position; a flag-like channel or ref must not reach it.
    const bc = await client.callTool({ name: 'ads_budget', arguments: { slug: 'sample-quoteflow', record_amount: 1, record_channel: '--ref' } });
    assert.ok(bc.isError, 'ads_budget record_channel starting with - must be rejected');
    const br = await client.callTool({ name: 'ads_budget', arguments: { slug: 'sample-quoteflow', record_amount: 1, record_channel: 'meta', ref: '--record' } });
    assert.ok(br.isError, 'ads_budget ref starting with - must be rejected');
  } finally {
    await client.close();
  }
});

test('new-product.mjs refuses a flag-like value instead of shifting options', () => {
  const s = 'zz-flag-shift-test';
  const r = spawnSync(process.execPath, ['tools/new-product.mjs', s, '--name', '--budget', '--currency', 'USD'], { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(r.status, 0, 'flag-like --name value must fail');
  assert.ok(!fs.existsSync(path.join(ROOT, 'products', s)), 'no workspace may be created');
});
