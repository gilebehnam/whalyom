// Command Center write guards (tools/server.mjs): the Vault never writes the owner token or network/security
// settings, /api/write reports apply-decisions errors instead of igniting, and one product gets one run at a time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { root } from '../lib/env.mjs';

const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const rmRetry = async (f) => { for (let i = 0; i < 40; i++) { try { fs.rmSync(f, { recursive: true, force: true }); return; } catch { await new Promise((r) => setTimeout(r, 250)); } } };

test('Command Center refuses unsafe Vault keys, rejected requests and double ignites', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-srv-'));
  // Stub for `claude -p`: stays alive ~3 s so a second ignite overlaps it, and does nothing else.
  const stub = process.platform === 'win32' ? path.join(tmp, 'claude-stub.cmd') : path.join(tmp, 'claude-stub.sh');
  if (process.platform === 'win32') fs.writeFileSync(stub, '@ping -n 4 127.0.0.1 >nul\r\n');
  else { fs.writeFileSync(stub, '#!/bin/sh\nsleep 3\n'); fs.chmodSync(stub, 0o755); }
  const envFile = path.join(root, '.env');
  const envBefore = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : null;
  const slug = `zz-ignite-${process.pid}`;
  const prodDir = path.join(root, 'products', slug);
  fs.mkdirSync(prodDir, { recursive: true });
  fs.copyFileSync(path.join(root, 'products', '_template', 'product.json'), path.join(prodDir, 'product.json'));
  const port = await freePort();
  const srv = spawn(process.execPath, [path.join(root, 'tools', 'server.mjs'), '--port', String(port)], { cwd: root, env: { ...process.env, OM_CLAUDE_BIN: stub, WHALYOM_ANTHROPIC_API_KEY: 'test-platform-key' } });
  try {
    await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('server did not start')), 30000); srv.stdout.on('data', (d) => { if (String(d).includes('Command Center')) { clearTimeout(t); resolve(); } }); });
    const base = `http://127.0.0.1:${port}`;
    const html = await (await fetch(base + '/')).text();
    const tok = html.match(/"token":"([a-f0-9]+)"/)[1];
    const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-whalyom-token': tok }, body: JSON.stringify(b) });

    // Finding 1: owner token and network settings are not Vault keys; non-string values are refused.
    const keys = (await (await fetch(base + '/api/connectors')).json()).keys.map((k) => k.key);
    for (const key of ['WHALYOM_OWNER_TOKEN', 'OM_EDGE_HOST', 'OM_EDGE_TRUST_PROXY', 'WHALYOM_ALLOWED_ORIGINS', 'OM_CLAUDE_BIN']) {
      assert.equal((await post('/api/vault', { key, value: 'x'.repeat(20) })).status, 400, `${key} refused`);
      assert.ok(!keys.includes(key), `${key} not listed as a Vault key`);
    }
    assert.ok(keys.includes('OM_KILL'), 'ordinary keys stay writable');
    assert.equal((await post('/api/vault', { key: 'OM_KILL', value: { a: 1 } })).status, 400, 'object value refused');
    assert.equal((await post('/api/vault', { key: 'OM_KILL', value: 'x'.repeat(4097) })).status, 400, 'oversized value refused');
    const envAfter = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : null;
    assert.equal(envAfter, envBefore, '.env untouched by refused writes');
    assert.ok(!/^(WHALYOM_OWNER_TOKEN|OM_EDGE_HOST)=x{20}$/m.test(envAfter ?? ''));

    // Finding 2: a request apply-decisions rejects is reported and never ignites.
    const rej = await post('/api/write', { path: `requests/r-srvtest-${Date.now()}`, data: { kind: 'new-product', name: 'Zz Test' } });
    assert.equal(rej.status, 422);
    const rb = await rej.json();
    assert.equal(rb.ok, false); assert.ok(rb.errors.some((e) => /name and a description/.test(e))); assert.ok(!('ignite_pid' in rb));
    assert.ok(!fs.existsSync(path.join(root, 'state', 'ignite-zz-test.log')), 'no headless run started');
    assert.equal((await post('/api/write', { path: 'decisions/d1' })).status, 400, 'missing data is a 400');
    assert.equal((await post('/api/write', { path: 'decisions/d1', data: [1] })).status, 400, 'array data is a 400');

    // Finding 2: one run per product at a time.
    const first = await post('/api/ignite', { slug });
    assert.equal(first.status, 200);
    const { pid } = await first.json();
    assert.ok(pid > 0);
    const second = await post('/api/ignite', { slug });
    assert.equal(second.status, 409);
    assert.deepEqual(await second.json(), { error: 'already running', pid });
  } finally {
    srv.kill();
    await rmRetry(prodDir);
    await rmRetry(path.join(root, 'state', `ignite-${slug}.log`));
    await rmRetry(tmp);
  }
});
