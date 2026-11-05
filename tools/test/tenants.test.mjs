// Self-serve sign-up and billing: tenants, API keys, plan limits, Stripe Checkout and the signed
// webhook, and the edge routes. Temp folders and an injected fetch only: no network, no real Stripe.
// Run alone with: node --test tools/test/tenants.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTenantStore, PLANS, sha256, emailHash, effectiveStatus, TenantError } from '../cloud/tenants.mjs';
import { createCheckoutSession, handleWebhook, verifySignature, statusForSubscription } from '../cloud/billing.mjs';
import { createEdge } from '../cloud/edge.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-tenants-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let n = 0;
// A fake workspace maker: what tools/new-product.mjs leaves behind, minus the template files.
const fakeWorkspace = ({ slug, name, domain, productsDir }) => {
  fs.mkdirSync(path.join(productsDir, slug), { recursive: true });
  fs.writeFileSync(path.join(productsDir, slug, 'product.json'), JSON.stringify({ slug, name, domain, budget: { mode: 'paid', monthly_cap: 500, daily_cap: 20 } }));
};
const freshStore = (extra = {}) => { const d = path.join(tmp, `s${n++}`); return createTenantStore({ dir: path.join(d, 'tenants'), productsDir: path.join(d, 'products'), createWorkspace: fakeWorkspace, ...extra }); };
// Fixture values built at runtime (fake, not credentials).
const WH = ['whsec', 'unit', 'fixture'].join('_');
const FAKE_SK = ['sk', 'test', 'fixture123'].join('_');
const sign = (body, t = Math.floor(Date.now() / 1000), key = WH) => `t=${t},v1=${crypto.createHmac('sha256', key).update(`${t}.${body}`).digest('hex')}`;
const ENV = { STRIPE_SECRET_KEY: FAKE_SK, STRIPE_PRICE_GROWTH: 'price_growth1', STRIPE_PRICE_SCALE: 'price_scale1', STRIPE_PRICE_AGENCY: 'price_agency1', OM_EDGE_URL: 'https://edge.example.com' };
const allFiles = (dir) => fs.readdirSync(dir, { recursive: true }).map((f) => path.join(dir, String(f))).filter((f) => fs.statSync(f).isFile());

test('sign-up creates a tenant; the plain API key and the email are never stored in tenant.json', () => {
  const s = freshStore();
  const { tenant, apiKey } = s.createTenant({ name: 'Mug Studio', email: 'Owner@MugStudio.test', plan: 'growth' });
  assert.match(tenant.id, /^t[0-9a-f]{10}$/);
  assert.match(apiKey, new RegExp(`^wyk_${tenant.id}_[0-9a-f]{48}$`));
  assert.equal(tenant.status, 'trial');
  const days = (Date.parse(tenant.trial_ends_at) - Date.parse(tenant.created_at)) / 86400000;
  assert.equal(Math.round(days), 14);
  const raw = fs.readFileSync(path.join(s.dir, tenant.id, 'tenant.json'), 'utf8');
  const stored = JSON.parse(raw);
  assert.equal(stored.api_key_hash, sha256(apiKey));
  assert.equal(stored.email_hash, emailHash('owner@mugstudio.test'), 'email hash ignores case');
  assert.ok(!raw.toLowerCase().includes('owner@mugstudio.test'), 'no plain email in tenant.json');
  for (const f of allFiles(s.dir)) assert.ok(!fs.readFileSync(f, 'utf8').includes(apiKey), `plain key leaked into ${f}`);
  const contact = JSON.parse(fs.readFileSync(path.join(s.dir, tenant.id, 'contact.json'), 'utf8'));
  assert.equal(contact.email, 'Owner@MugStudio.test');
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(s.dir, tenant.id, 'contact.json')).mode & 0o777, 0o600);
  assert.equal(s.createTenant({ name: 'Free Co', email: 'a@free.test' }).tenant.status, 'active', 'free plan needs no trial');
  assert.throws(() => s.createTenant({ name: 'Again', email: 'owner@mugstudio.test' }), (e) => e instanceof TenantError && e.status === 409);
  assert.throws(() => s.createTenant({ name: 'X', email: 'not-an-email' }), /name|email/);
  assert.throws(() => s.createTenant({ name: 'Bad plan', email: 'b@x.test', plan: 'platinum' }), /unknown plan/);
});

test('authTenant accepts only the exact key', () => {
  const s = freshStore();
  const { tenant, apiKey } = s.createTenant({ name: 'Key Co', email: 'k@key.test' });
  assert.equal(s.authTenant(apiKey)?.id, tenant.id);
  assert.equal(s.authTenant(`${apiKey.slice(0, -1)}${apiKey.endsWith('0') ? '1' : '0'}`), null, 'one changed character fails');
  assert.equal(s.authTenant(''), null);
  assert.equal(s.authTenant('wyk_t0000000000_' + '0'.repeat(48)), null, 'unknown tenant');
  assert.equal(s.authTenant('../../etc/passwd'), null);
});

test('plan limits: free allows one product in free mode; growth allows three', () => {
  assert.deepEqual([PLANS.free.max_products, PLANS.growth.max_products, PLANS.scale.max_products, PLANS.agency.max_products], [1, 3, 15, 50]);
  assert.equal(PLANS.agency.white_label, true);
  const s = freshStore();
  const free = s.createTenant({ name: 'Free Co', email: 'f@free.test' }).tenant;
  const r = s.addProduct(free.id, { name: 'Mug Studio', domain: 'https://www.mugstudio.test/shop' });
  assert.equal(r.slug, `${free.id}-mug-studio`);
  assert.equal(r.domain, 'mugstudio.test');
  const pj = JSON.parse(fs.readFileSync(path.join(s.productsDir, r.slug, 'product.json'), 'utf8'));
  assert.equal(pj.tenant, free.id);
  assert.equal(pj.budget.mode, 'free', 'free plan forces free mode');
  assert.equal(pj.budget.monthly_cap, 0);
  assert.throws(() => s.addProduct(free.id, { name: 'Second' }), (e) => e.status === 403 && e.code === 'plan_limit');
  const g = s.createTenant({ name: 'Growth Co', email: 'g@growth.test', plan: 'growth' }).tenant;
  for (const name of ['One', 'Two', 'Three']) s.addProduct(g.id, { name });
  assert.throws(() => s.addProduct(g.id, { name: 'Four' }), (e) => e.code === 'plan_limit');
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.productsDir, `${g.id}-one`, 'product.json'), 'utf8')).budget.mode, 'paid', 'paid plans keep paid mode');
  const other = s.createTenant({ name: 'Other', email: 'o@other.test', plan: 'scale' }).tenant;
  assert.throws(() => s.addProduct(other.id, { domain: 'localhost' }), /public website domain/);
  assert.throws(() => s.addProduct(other.id, { domain: 'mugstudio.test' }), (e) => e.status === 409, 'a domain belongs to one workspace');
  assert.equal(s.ownsDomain('www.mugstudio.test'), true);
});

test('addProduct runs the real tools/new-product.mjs as a child process', () => {
  const root = path.join(tmp, 'realroot');
  fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'tools', 'new-product.mjs'), path.join(root, 'tools', 'new-product.mjs'));
  fs.copyFileSync(path.join(REPO, 'tools', 'presets.json'), path.join(root, 'tools', 'presets.json'));
  fs.cpSync(path.join(REPO, 'products', '_template'), path.join(root, 'products', '_template'), { recursive: true });
  const s = createTenantStore({ root });
  const t = s.createTenant({ name: 'Real Co', email: 'r@real.test' }).tenant;
  const r = s.addProduct(t.id, { name: 'Real Shop', domain: 'realshop.test' });
  const pj = JSON.parse(fs.readFileSync(path.join(root, 'products', r.slug, 'product.json'), 'utf8'));
  assert.equal(pj.slug, r.slug);
  assert.equal(pj.domain, 'realshop.test');
  assert.equal(pj.tenant, t.id);
  assert.ok(fs.existsSync(path.join(root, 'products', r.slug, 'claims.md')), 'template copied');
  assert.deepEqual(s.getTenant(t.id).products, [r.slug]);
});

test('webhook signature: valid, wrong secret, tampered body, expired, malformed', () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'ping' });
  assert.equal(verifySignature(body, sign(body), WH).ok, true);
  assert.equal(verifySignature(body, `${sign(body)},v1=${'0'.repeat(64)}`, WH).ok, true, 'any v1 may match (secret rotation)');
  assert.match(verifySignature(body, sign(body, undefined, 'other_value'), WH).reason, /mismatch/);
  assert.match(verifySignature(body + ' ', sign(body), WH).reason, /mismatch/);
  const old = Math.floor(Date.now() / 1000) - 301;
  assert.match(verifySignature(body, sign(body, old), WH).reason, /tolerance/);
  assert.equal(verifySignature(body, sign(body, Math.floor(Date.now() / 1000) - 299), WH).ok, true);
  assert.match(verifySignature(body, 'garbage', WH).reason, /malformed/);
  assert.match(verifySignature(body, sign(body), '').reason, /no webhook secret/);
  assert.throws(() => handleWebhook(body, 't=1,v1=' + 'a'.repeat(64), WH, { store: freshStore() }), (e) => e.status === 400);
});

test('status transitions from Stripe events, idempotent, and trial expiry', () => {
  const s = freshStore();
  const t = s.createTenant({ name: 'Pay Co', email: 'p@pay.test', plan: 'growth' }).tenant;
  const deliver = (evt) => { const b = JSON.stringify(evt); return handleWebhook(b, sign(b), WH, { store: s, env: ENV }); };
  let r = deliver({ id: 'evt_a', type: 'checkout.session.completed', data: { object: { mode: 'subscription', payment_status: 'paid', status: 'complete', client_reference_id: t.id, customer: 'cus_1', subscription: 'sub_1', metadata: { tenant_id: t.id, plan: 'scale' } } } });
  assert.deepEqual([r.status, r.plan], ['active', 'scale']);
  let saved = s.getTenant(t.id);
  assert.equal(saved.limits.max_products, 15);
  assert.equal(saved.billing.stripe_subscription_id, 'sub_1');
  assert.equal(saved.trial_ends_at, null);
  assert.equal(deliver({ id: 'evt_a', type: 'checkout.session.completed', data: { object: {} } }).duplicate, true);
  r = deliver({ id: 'evt_b', type: 'invoice.payment_failed', data: { object: { customer: 'cus_1', subscription: 'sub_1' } } });
  assert.equal(r.status, 'past_due');
  r = deliver({ id: 'evt_c', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', items: { data: [{ price: { id: 'price_agency1' } }] } } } });
  assert.deepEqual([r.status, r.plan], ['active', 'agency']);
  r = deliver({ id: 'evt_d', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled', metadata: { tenant_id: t.id } } } });
  assert.equal(r.status, 'canceled');
  assert.equal(deliver({ id: 'evt_e', type: 'charge.refunded', data: { object: {} } }).ignored, true);
  assert.equal(deliver({ id: 'evt_f', type: 'invoice.payment_failed', data: { object: { customer: 'cus_unknown' } } }).ignored, true);
  saved = s.getTenant(t.id);
  assert.deepEqual(saved.events.filter((e) => e.what === 'status').map((e) => e.to), ['active', 'past_due', 'active', 'canceled']);
  assert.deepEqual([statusForSubscription('trialing'), statusForSubscription('unpaid'), statusForSubscription('incomplete_expired')], ['trial', 'past_due', 'canceled']);
  // A trial that ran out without paying blocks product actions.
  let clock = Date.now();
  const s2 = freshStore({ now: () => clock });
  const tr = s2.createTenant({ name: 'Trial Co', email: 't@trial.test', plan: 'growth' }).tenant;
  clock += 15 * 86400000;
  assert.equal(effectiveStatus(s2.getTenant(tr.id), clock), 'past_due');
  assert.throws(() => s2.addProduct(tr.id, { name: 'Late' }), (e) => e.status === 402);
  assert.throws(() => s2.setStatus(tr.id, 'deleted'), /status must be/);
});

test('402 for canceled and past_due tenants on product actions', () => {
  const s = freshStore();
  const t = s.createTenant({ name: 'Gone Co', email: 'g@gone.test', plan: 'scale' }).tenant;
  s.setStatus(t.id, 'canceled');
  assert.throws(() => s.addProduct(t.id, { name: 'Nope' }), (e) => e.status === 402 && e.code === 'payment_required');
  s.setStatus(t.id, 'past_due');
  assert.throws(() => s.addProduct(t.id, { name: 'Nope' }), (e) => e.status === 402);
  s.setStatus(t.id, 'active');
  assert.ok(s.addProduct(t.id, { name: 'Back' }).slug);
});

test('Checkout session: form-encoded subscription request, key only in the auth header', async () => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }) }; };
  const tenant = { id: 't0123456789', billing: { stripe_customer_id: 'cus_9' } };
  const r = await createCheckoutSession(tenant, 'growth', { fetch, env: ENV });
  assert.equal(r.url, 'https://checkout.stripe.com/c/pay/cs_test_1');
  assert.equal(calls[0].url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(calls[0].init.headers.authorization, `Bearer ${FAKE_SK}`);
  assert.equal(calls[0].init.headers['content-type'], 'application/x-www-form-urlencoded');
  const body = new URLSearchParams(calls[0].init.body);
  assert.equal(body.get('mode'), 'subscription');
  assert.equal(body.get('line_items[0][price]'), 'price_growth1');
  assert.equal(body.get('client_reference_id'), 't0123456789');
  assert.equal(body.get('customer'), 'cus_9');
  assert.equal(body.get('subscription_data[metadata][tenant_id]'), 't0123456789');
  assert.match(body.get('success_url'), /^https:\/\/edge\.example\.com\//);
  assert.ok(!calls[0].init.body.includes(FAKE_SK), 'key not in the body');
  await assert.rejects(createCheckoutSession(tenant, 'free', { fetch, env: ENV }), /paid plan/);
  await assert.rejects(createCheckoutSession(tenant, 'growth', { fetch, env: { ...ENV, STRIPE_SECRET_KEY: '' } }), (e) => e.status === 503 && !e.message.includes(FAKE_SK));
  await assert.rejects(createCheckoutSession(tenant, 'scale', { fetch, env: { ...ENV, STRIPE_PRICE_SCALE: '' } }), /STRIPE_PRICE_SCALE/);
  const bad = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'No such price' } }) });
  await assert.rejects(createCheckoutSession(tenant, 'growth', { fetch: bad, env: ENV }), (e) => e.status === 502 && /No such price/.test(e.message) && !e.message.includes(FAKE_SK));
});

test('edge routes: sign-up, Bearer auth, products with snippet, checkout, webhook, 402 and rate limit', async () => {
  const store = freshStore();
  const fetch = async () => ({ ok: true, status: 200, json: async () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }) });
  const { server } = createEdge({ root: tmp, installKey: 'wy_install_key_0123456789', tenants: store, env: ENV, fetch, stripeWebhookSecret: WH, signupsPerHour: 3, onboard: () => ({}) });
  const base = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`)));
  try {
    const call = (p, { method = 'GET', body, key, headers = {} } = {}) => globalThis.fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}), ...headers }, body: typeof body === 'string' ? body : body ? JSON.stringify(body) : undefined });
    let res = await call('/signup', { method: 'POST', body: { name: 'Route Co', email: 'route@co.test' } });
    assert.equal(res.status, 201);
    const { api_key: key, tenant } = await res.json();
    assert.equal(tenant.plan, 'free');
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal((await call('/signup', { method: 'POST', body: { name: 'Route Co', email: 'route@co.test' } })).status, 409);
    assert.equal((await call('/signup', { method: 'POST', body: '{nope' })).status, 400);
    assert.equal((await call('/signup', { method: 'POST', body: { name: 'Too many', email: 'x@co.test' } })).status, 429, 'per-IP sign-up limit');
    assert.equal((await call('/tenant')).status, 401);
    assert.equal((await call('/tenant', { key: 'wyk_bad' })).status, 401);
    res = await call('/tenant', { key });
    assert.equal(res.status, 200);
    const view = (await res.json()).tenant;
    assert.equal(view.id, tenant.id);
    assert.ok(!('api_key_hash' in view) && !('email_hash' in view), 'no secrets or hashes in the API');
    res = await call('/tenant/products', { method: 'POST', key, body: { name: 'Route Shop', domain: 'routeshop.test' } });
    assert.equal(res.status, 201);
    const prod = await res.json();
    assert.equal(prod.slug, `${tenant.id}-route-shop`);
    assert.match(prod.snippet, /^<script src="https:\/\/edge\.example\.com\/whalyom\.js" data-site="wy_install_key_0123456789"/);
    assert.equal((await call('/tenant/products', { method: 'POST', key, body: { name: 'Second' } })).status, 403, 'free plan limit');
    assert.equal((await call('/tenant/products', { method: 'POST', body: { name: 'Anon' } })).status, 401);
    res = await call('/billing/checkout', { method: 'POST', key, body: { plan: 'growth' } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).url, 'https://checkout.stripe.com/c/pay/cs_1');
    assert.equal((await call('/billing/checkout', { method: 'POST', body: { plan: 'growth' } })).status, 401);
    const evt = JSON.stringify({ id: 'evt_route_1', type: 'customer.subscription.deleted', data: { object: { id: 'sub_r', metadata: { tenant_id: tenant.id }, status: 'canceled' } } });
    assert.equal((await call('/billing/webhook', { method: 'POST', body: evt, headers: { 'stripe-signature': sign(evt, undefined, 'other_value') } })).status, 400);
    assert.equal((await call('/billing/webhook', { method: 'POST', body: evt, headers: { 'stripe-signature': sign(evt, Math.floor(Date.now() / 1000) - 600) } })).status, 400, 'expired');
    res = await call('/billing/webhook', { method: 'POST', body: evt, headers: { 'stripe-signature': sign(evt) } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'canceled');
    assert.equal((await call('/tenant', { key })).status, 200, 'a canceled tenant can still see its account');
    res = await call('/tenant/products', { method: 'POST', key, body: { name: 'After cancel' } });
    assert.equal(res.status, 402);
    assert.equal((await res.json()).code, 'payment_required');
    assert.equal((await call('/billing/checkout', { method: 'POST', key, body: { plan: 'growth' } })).status, 200, 'canceled tenants can pay again');
    const opt = await call('/tenant/products', { method: 'OPTIONS' });
    assert.equal(opt.status, 204);
    assert.match(opt.headers.get('access-control-allow-headers'), /authorization/);
    for (const f of allFiles(store.dir)) if (!f.endsWith('contact.json')) assert.ok(!fs.readFileSync(f, 'utf8').includes('route@co.test'), 'email only in contact.json');
  } finally { server.close(); }
});

test('edge with no webhook secret refuses webhooks; sign-up can be closed', async () => {
  const { server } = createEdge({ root: tmp, installKey: 'wy_install_key_0123456789', tenants: freshStore(), env: {}, signup: false, onboard: () => ({}) });
  const base = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`)));
  try {
    assert.equal((await globalThis.fetch(`${base}/billing/webhook`, { method: 'POST', body: '{}' })).status, 503);
    assert.equal((await globalThis.fetch(`${base}/signup`, { method: 'POST', body: '{}' })).status, 403);
  } finally { server.close(); }
});
