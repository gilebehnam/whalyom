// Zero-key free mode: with no API keys at all, publishing goes to the local static site and
// spend is parked, never an error. Also checks the local Command Center server end to end.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testEnv } from './_env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const slug = `zz-zero-${process.pid}`;
const P = (f = '') => path.join(root, 'products', slug, f);
const noKeys = testEnv(Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(META_|RESEND_|OM_WEBHOOK_|OM_SITE_REPO|STRIPE_|OM_KILL)/.test(k))));
const run = (script, args = []) => {
  const r = spawnSync(process.execPath, [path.join(root, 'tools', script), ...args], { encoding: 'utf8', env: noKeys, cwd: root });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const last = r.stdout.trim().split(/\r?\n/).at(-1);
  try { return JSON.parse(last); } catch { return last; }
};

before(() => {
  run('new-product.mjs', [slug, '--name', 'Zero Key Demo', '--autonomy', 'autopilot']);
  fs.mkdirSync(P('outbox/site'), { recursive: true });
  fs.writeFileSync(P('outbox/site/launch.md'), '---\ntitle: Launch page\ndescription: A test page\n---\n# Launch page\n\nIt **works** with no keys.\n\n- one\n- two\n');
  fs.writeFileSync(P('approvals.json'), JSON.stringify([
    { id: 'A1', type: 'publish', channel: 'site', title: 'Launch page', file: 'outbox/site/launch.md', compliance: 'pass', status: 'approved' },
    { id: 'A2', type: 'spend', channel: 'meta', title: 'Ads', amount: 5, file: 'outbox/site/launch.md', compliance: 'pass', status: 'approved' },
  ]));
});
after(() => { fs.rmSync(P(), { recursive: true, force: true }); fs.rmSync(path.join(root, 'site', slug), { recursive: true, force: true }); });

test('no keys: publishing falls back to the local static site, spend is parked in free mode', () => {
  const r = run('execute.mjs', [slug]);
  assert.equal(r.executed, 1); assert.equal(r.failed, 0);
  const ap = Object.fromEntries(JSON.parse(fs.readFileSync(P('approvals.json'), 'utf8')).map((a) => [a.id, a]));
  assert.equal(ap.A1.status, 'executed'); assert.equal(ap.A1.executed_by, 'local-site');
  assert.equal(ap.A2.status, 'skipped-free-mode');
  const html = fs.readFileSync(path.join(root, 'site', slug, 'launch-page.html'), 'utf8');
  assert.match(html, /<strong>works<\/strong>/); assert.match(html, /<li>two<\/li>/);
  assert.match(fs.readFileSync(path.join(root, 'site', slug, 'sitemap.xml'), 'utf8'), /launch-page\.html/);
  assert.match(fs.readFileSync(path.join(root, 'site', slug, 'llms.txt'), 'utf8'), /Launch page/);
});

test('local Command Center serves the page, streams live docs, guards writes and serves the site', async () => {
  const port = 4900 + (process.pid % 90);
  const srv = spawn(process.execPath, [path.join(root, 'tools', 'server.mjs'), '--port', String(port)], { cwd: root, env: noKeys });
  try {
    await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('server did not start')), 20000); srv.stdout.on('data', (d) => { if (String(d).includes('localhost')) { clearTimeout(t); resolve(); } }); });
    const base = `http://127.0.0.1:${port}`;
    const html = await (await fetch(base + '/')).text();
    assert.match(html, /Whalyom Command Center/); assert.match(html, /__WHALYOM_LOCAL__/);
    const tok = html.match(/"token":"([a-f0-9]+)"/)[1];
    const ctrl = new AbortController();
    const res = await fetch(base + '/stream', { signal: ctrl.signal });
    const reader = res.body.getReader(); let got = '';
    while (!/live\/products/.test(got)) got += new TextDecoder().decode((await reader.read()).value);
    ctrl.abort();
    assert.match(got, /event: doc/);
    const bad = await fetch(base + '/api/vault', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'OM_KILL', value: '1' }) });
    assert.equal(bad.status, 403, 'writes without the page token are refused');
    const conn = await (await fetch(base + '/api/connectors')).json();
    assert.ok(conn.connectors.some((c) => c.name === 'local-site' && c.configured));
    assert.ok(conn.keys.every((k) => !('value' in k)), 'secrets are never returned');
    const set = await fetch(base + '/api/product', { method: 'POST', headers: { 'content-type': 'application/json', 'x-whalyom-token': tok }, body: JSON.stringify({ slug, mode: 'paid', monthly_cap: 50, currency: 'GBP' }) });
    const s = await set.json();
    assert.equal(s.budget.monthly_cap, 50); assert.equal(s.budget.currency, 'GBP'); assert.equal(s.budget.daily_cap, 2);
    const page = await fetch(`${base}/site/${slug}/launch-page.html`);
    assert.equal(page.status, 200);
    assert.equal((await fetch(`${base}/site/../package.json`)).status, 404, 'no path escape');
    assert.equal((await fetch(`${base}/site/..%2Fsites%2Fx%2F.env`)).status, 404, 'no encoded escape into sites/');
    assert.equal((await fetch(`${base}/site-evil/x`)).status, 404, 'sibling folder is not served');
    const { request } = await import('node:http');
    const status = (headers, method = 'GET') => new Promise((resolve, reject) => { const r = request({ host: '127.0.0.1', port, path: '/api/connectors', method, headers }, (res) => { res.resume(); resolve(res.statusCode); }); r.on('error', reject); r.end(); });
    assert.equal(await status({ host: `evil.example:${port}` }), 403, 'DNS-rebinding host refused');
    assert.equal(await status({ host: `127.0.0.1:${port}`, origin: 'https://evil.example', 'x-whalyom-token': tok }, 'POST'), 403, 'cross-site POST refused');
  } finally { srv.kill(); }
});
