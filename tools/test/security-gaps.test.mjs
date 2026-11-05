// Guards added after the 2026-11-04 gap audit (research/audit/gaps-2026-11-04.md): public-host checks
// before any onboarding fetch, the owner gate for domains not on the edge allow-list, and the
// permissions of headless Claude runs. No network: hosts that would need DNS are refused before it.
// Run alone with: node --test tools/test/security-gaps.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { publicHostName, privateAddress, instantOnboard } from '../instant-onboard.mjs';
import { claudeArgs, HEADLESS_ALLOWED, HEADLESS_DENIED } from '../lib/claude-run.mjs';
import { createEdge } from '../cloud/edge.mjs';

test('only public domain names can be onboarded', async () => {
  for (const h of ['example.com', 'shop.mugstudio.co.uk', 'mugstudio.test']) assert.equal(publicHostName(h), true, h);
  for (const h of ['169.254.169.254', '10.0.0.5', 'localhost', 'router.local', 'db.internal', 'x', '1.2.3.4', 'printer.lan']) assert.equal(publicHostName(h), false, h);
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '0.0.0.0']) assert.equal(privateAddress(ip), true, ip);
  for (const ip of ['93.184.216.34', '1.1.1.1', '2606:4700::1111']) assert.equal(privateAddress(ip), false, ip);
  await assert.rejects(instantOnboard('http://169.254.169.254/latest/meta-data', { queue: false }), /not a public website/);
  await assert.rejects(instantOnboard('localhost:4321', { queue: false }), /not a public website/);
});

test('edge refuses IP-literal origins and passes the owner gate when no allow-list is set', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-sec-'));
  fs.mkdirSync(path.join(root, 'products'), { recursive: true });
  const calls = [];
  const { server } = createEdge({ root, installKey: 'wy_testkey_123456789', onboard: async (host) => { calls.push(host); throw new Error('boom'); } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const post = (origin) => fetch(`${base}/collect`, { method: 'POST', headers: { origin, 'content-type': 'text/plain' }, body: JSON.stringify({ type: 'pageview', site: 'wy_testkey_123456789', path: '/', eid: `e${Math.random().toString(36).slice(2, 12)}` }) });
    assert.equal((await post('http://169.254.169.254')).status, 400, 'IP literal refused');
    assert.equal((await post('http://localhost:3000')).status, 400, 'localhost refused');
    assert.equal((await post('https://new-site.test')).status, 503, 'failed onboarding reported');
    assert.equal((await post('https://new-site.test')).status, 503, 'failed onboarding backs off');
    assert.deepEqual(calls, ['new-site.test'], 'a failed onboarding is not retried on every beacon, and does not stick forever');
  } finally { server.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('headless runs cannot approve, spend, change guards or read secrets', () => {
  const args = claudeArgs();
  assert.equal(args[0], '-p');
  assert.ok(!args.some((a) => a.includes(' --') && a.startsWith('Use ')), 'the prompt is not on the command line');
  assert.ok(!HEADLESS_ALLOWED.includes('Bash(node tools/*)'), 'no blanket node tools/* permission');
  assert.ok(HEADLESS_ALLOWED.includes('Bash(node tools/apply-results.mjs:*)'));
  assert.ok(!HEADLESS_ALLOWED.some((t) => /apply-decisions/.test(t)));
  for (const p of ['Edit(**/approvals.json)', 'Edit(**/product.json)', 'Edit(config/**)', 'Edit(tools/**)', 'Edit(**/.env)', 'Read(**/.env)', 'Bash(*--owner*)']) assert.ok(HEADLESS_DENIED.includes(p), p);
  const deny = args[args.indexOf('--disallowedTools') + 1];
  assert.match(deny, /Edit\(\*\*\/approvals\.json\)/);
  // Every allowed tools/ script exists, so a typo cannot hide a missing permission.
  const root = path.resolve(import.meta.dirname, '..', '..');
  for (const t of HEADLESS_ALLOWED.map((x) => x.match(/^Bash\(node (tools\/[a-z0-9-]+\.mjs):\*\)$/)?.[1]).filter(Boolean)) assert.ok(fs.existsSync(path.join(root, t)), t);
});
