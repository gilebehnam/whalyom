// One-command product setup: the install plan for WordPress, the cPanel and SSH installer (adds files only,
// never overwrites, never leaves the web root, secret filled in from .env), and .env writing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import site, { safeRel, checkAccess, accessFor, envKey } from '../connectors/site-install.mjs';
import { installPlan, muLoader, setEnvValues } from '../add-product.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-addp-'));

// A tiny fake cPanel: a file tree in memory, UAPI list/save and API 2 mkdir.
function fakeCpanel(tree = { public_html: ['index.php', 'wp-config.php', 'wp-content'], 'public_html/wp-content': ['plugins'], 'public_html/wp-content/plugins': [] }) {
  const saved = {};
  const f = async (url, init = {}) => {
    const u = new URL(url);
    assert.match(init.headers?.authorization ?? '', /^cpanel shop:tok$/);
    if (u.pathname.endsWith('/Fileman/list_files')) {
      const dir = u.searchParams.get('dir');
      if (!tree[dir]) return new Response(JSON.stringify({ status: 0, errors: ['no such dir'] }), { status: 200 });
      return new Response(JSON.stringify({ status: 1, data: tree[dir].map((file) => ({ file, type: 'file' })) }));
    }
    if (u.pathname.endsWith('/json-api/cpanel')) { const p = u.searchParams.get('path'); const n = u.searchParams.get('name'); (tree[p] ??= []).push(n); tree[`${p}/${n}`] = []; return new Response('{}'); }
    if (u.pathname.endsWith('/Fileman/save_file_content')) { const b = new URLSearchParams(init.body); saved[`${b.get('dir')}/${b.get('file')}`] = b.get('content'); (tree[b.get('dir')] ??= []).push(b.get('file')); return new Response(JSON.stringify({ status: 1 })); }
    return new Response('{}', { status: 404 });
  };
  return { f, saved, tree };
}

test('paths stay inside the web root', () => {
  assert.equal(safeRel('wp-content/plugins/whalyom/whalyom.php'), 'wp-content/plugins/whalyom/whalyom.php');
  for (const bad of ['../etc/passwd', 'a/../../x', 'C:/x', '']) assert.equal(safeRel(bad), null, bad);
});

test('WordPress plan: plugin files plus a must-use loader with the site id; the secret stays a placeholder', () => {
  const p = installPlan({ slug: 'whalory-com', domain: 'whalory.com', wordpress: true });
  assert.ok(p.files.some((x) => x.path === 'wp-content/mu-plugins/whalyom-loader.php'));
  assert.ok(p.files.some((x) => x.path === 'wp-content/plugins/whalyom/whalyom.php'));
  assert.match(muLoader('whalory-com'), /'whalory-com'/);
  assert.match(muLoader('x'), /__WHALYOM_SECRET__/);
  assert.equal(installPlan({ slug: 'x', domain: 'x.com', wordpress: false }).files.length, 0, 'never edits pages it did not write');
});

test('cPanel install adds the files, fills the secret from env, keeps existing files and checks access read-only', async () => {
  const slug = 'shop-com';
  const env = { [envKey('OM_CPANEL_URL', slug)]: 'https://host:2083', [envKey('OM_CPANEL_USER', slug)]: 'shop', [envKey('OM_CPANEL_TOKEN', slug)]: 'tok', OM_SAT_SECRET_SHOP_COM: 's3cret' };
  const a = accessFor(slug, env);
  assert.equal(a.method, 'cpanel');
  const cp = fakeCpanel();
  const c = await checkAccess(a, 'public_html', { fetch: cp.f });
  assert.equal(c.wordpress, true);
  const dir = path.join(tmp, slug); fs.mkdirSync(path.join(dir, 'outbox', 'site-install'), { recursive: true });
  const plan = installPlan({ slug, domain: 'shop.com', wordpress: true });
  plan.files.push({ path: 'index.php', content: 'must not overwrite' });
  fs.writeFileSync(path.join(dir, 'outbox', 'site-install', 'plan.json'), JSON.stringify(plan));
  const item = { id: 'A1', type: 'publish', channel: 'site-install', file: 'outbox/site-install/plan.json' };
  assert.ok(site.accepts(item));
  const r = await site.execute(item, { slug, dir, env, now: '2026-11-05T00:00:00Z', fetch: cp.f });
  assert.equal(r.ok, true, r.detail);
  assert.match(cp.saved['public_html/wp-content/mu-plugins/whalyom-loader.php'], /'s3cret'/);
  assert.ok(cp.saved['public_html/wp-content/plugins/whalyom/whalyom.php'].length > 1000);
  assert.equal(cp.saved['public_html/index.php'], undefined, 'an existing file is never overwritten');
  assert.ok(!JSON.stringify(fs.readFileSync(path.join(dir, 'outbox', 'site-install', 'plan.json'), 'utf8')).includes('s3cret'), 'the secret never lands in the workspace');
  plan.files = [{ path: '../escape.php', content: 'x' }];
  fs.writeFileSync(path.join(dir, 'outbox', 'site-install', 'plan.json'), JSON.stringify(plan));
  assert.equal((await site.execute(item, { slug, dir, env, fetch: cp.f })).ok, false, 'a path outside the web root is refused');
});

test('setEnvValues replaces or adds keys without touching the others', () => {
  const f = path.join(tmp, '.env');
  fs.writeFileSync(f, 'A=1\nWHALYOM_ANTHROPIC_API_KEY=keep\n');
  setEnvValues({ A: '2', B: '3', C: '' }, f);
  const text = fs.readFileSync(f, 'utf8');
  assert.match(text, /^A=2$/m); assert.match(text, /^B=3$/m); assert.match(text, /^WHALYOM_ANTHROPIC_API_KEY=keep$/m); assert.doesNotMatch(text, /^C=/m);
  fs.rmSync(tmp, { recursive: true, force: true });
});
