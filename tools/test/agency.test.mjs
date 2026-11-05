// Agency and white-label mode: client sub-accounts, scoped client keys, per-client limits, client
// approve/reject queued for apply-decisions, branding validation and the framework-free routes.
// Temp folders and a fake workspace maker only: no network, no repo state touched.
// Run alone with: node --test tools/test/agency.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTenantStore } from '../cloud/tenants.mjs';
import { createAgencyStore, handleAgencyRequest, validateBranding, validColor, validHttpsUrl, clientLimits, AGENCY_LIMITS } from '../cloud/agency.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-agency-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const fakeWorkspace = ({ slug, name, domain, productsDir }) => {
  fs.mkdirSync(path.join(productsDir, slug), { recursive: true });
  fs.writeFileSync(path.join(productsDir, slug, 'product.json'), JSON.stringify({ slug, name, domain, budget: { mode: 'paid', monthly_cap: 500, daily_cap: 20 } }));
  fs.writeFileSync(path.join(productsDir, slug, 'approvals.json'), JSON.stringify([
    { id: 'a1', type: 'publish', title: 'Post <b>one</b>', status: 'pending' },
    { id: 'a2', type: 'cap-change', title: 'Raise daily cap', status: 'pending' },
    { id: 'a3', type: 'publish', title: 'Done', status: 'approved' },
  ]));
};
const fresh = (clock) => {
  const d = path.join(tmp, `s${n++}`);
  const tenants = createTenantStore({ dir: path.join(d, 'tenants'), productsDir: path.join(d, 'products'), createWorkspace: fakeWorkspace, ...(clock ? { now: clock } : {}) });
  return { d, s: createAgencyStore({ root: d, tenants, ...(clock ? { now: clock } : {}) }) };
};
const mkAgency = (s, email = 'boss@agency.test') => s.tenants.createTenant({ name: 'Blue Agency', email, plan: 'agency' });
const allText = (dir) => fs.readdirSync(dir, { recursive: true }).map((f) => path.join(dir, String(f))).filter((f) => fs.statSync(f).isFile()).map((f) => fs.readFileSync(f, 'utf8')).join('\n');

test('only agency-plan tenants get agency features', () => {
  const { s } = fresh();
  const { tenant } = s.tenants.createTenant({ name: 'Solo', email: 'solo@x.test', plan: 'growth' });
  assert.throws(() => s.createClient(tenant.id, { name: 'Acme' }), (e) => e.code === 'plan_limit' && e.status === 403);
  assert.throws(() => s.setBranding(tenant.id, { name: 'X Co' }), (e) => e.code === 'plan_limit');
});

test('client keys are shown once, stored only as hashes, and are scoped', () => {
  const { s } = fresh();
  const { tenant, apiKey } = mkAgency(s);
  const { client, clientKey } = s.createClient(tenant.id, { name: 'Acme Shoes', max_products: 2 });
  assert.match(clientKey, new RegExp(`^wyc_${tenant.id}_${client.id}_[0-9a-f]{48}$`));
  const stored = allText(s.dir);
  assert.ok(!stored.includes(clientKey) && !stored.includes(apiKey), 'no plain key on disk');
  const who = s.authClient(clientKey);
  assert.equal(who.client.id, client.id);
  assert.equal(s.authClient(clientKey.slice(0, -1) + (clientKey.endsWith('0') ? '1' : '0')), null);
  assert.equal(s.authClient(apiKey), null, 'a tenant key is not a client key');
  assert.equal(s.tenants.authTenant(clientKey), null, 'a client key is not a tenant key');
  // rotate invalidates the old key; disable revokes the new one
  const r = s.rotateClientKey(tenant.id, client.id);
  assert.equal(s.authClient(clientKey), null);
  assert.ok(s.authClient(r.clientKey));
  s.disableClient(tenant.id, client.id);
  assert.equal(s.authClient(r.clientKey), null);
});

test('per-client limits never exceed the agency plan', () => {
  assert.throws(() => clientLimits('agency', { max_products: AGENCY_LIMITS.client_max_products + 1 }));
  assert.throws(() => clientLimits('agency', { budget_modes: ['paid', 'crypto'] }));
  assert.deepEqual(clientLimits('agency', {}).budget_modes, ['free']);
  const { s } = fresh();
  const { tenant } = mkAgency(s);
  const { client } = s.createClient(tenant.id, { name: 'Free Client', max_products: 1 });
  const p = s.addClientProduct(tenant.id, client.id, { name: 'Shop', domain: 'shop-one.com' });
  const pj = JSON.parse(fs.readFileSync(path.join(s.productsDir, p.slug, 'product.json'), 'utf8'));
  assert.equal(pj.client, client.id);
  assert.equal(pj.tenant, tenant.id);
  assert.deepEqual(pj.budget, { mode: 'free', monthly_cap: 0, daily_cap: 0 }, 'a free-only client gets $0 mode and zero caps');
  assert.deepEqual(pj.plan_limits.budget_modes, ['free']);
  assert.throws(() => s.addClientProduct(tenant.id, client.id, { name: 'Two', domain: 'shop-two.com' }), (e) => e.code === 'plan_limit');
  // paid client keeps paid mode within the caps tenants.mjs set
  const { client: c2 } = s.createClient(tenant.id, { name: 'Paid Client', budget_modes: ['free', 'paid'] });
  const p2 = s.addClientProduct(tenant.id, c2.id, { name: 'Paid', domain: 'paid-shop.com' });
  const pj2 = JSON.parse(fs.readFileSync(path.join(s.productsDir, p2.slug, 'product.json'), 'utf8'));
  assert.equal(pj2.budget.mode, 'paid');
  assert.equal(pj2.budget.daily_cap, 20, 'caps are never raised');
  assert.throws(() => s.setClientLimits(tenant.id, c2.id, { max_products: 99 }));
});

test('agency client count is capped', () => {
  const { s } = fresh();
  const { tenant } = mkAgency(s);
  for (let i = 0; i < AGENCY_LIMITS.max_clients; i++) s.createClient(tenant.id, { name: `Client ${i}` });
  assert.throws(() => s.createClient(tenant.id, { name: 'One too many' }), (e) => e.code === 'plan_limit');
});

test('client dashboard is read-only and shows its own products only', () => {
  const { s } = fresh();
  const { tenant } = mkAgency(s);
  const a = s.createClient(tenant.id, { name: 'A Co' });
  const b = s.createClient(tenant.id, { name: 'B Co' });
  const pa = s.addClientProduct(tenant.id, a.client.id, { name: 'A shop', domain: 'a-shop.com' });
  s.addClientProduct(tenant.id, b.client.id, { name: 'B shop', domain: 'b-shop.com' });
  const dash = s.clientDashboard(s.authClient(a.clientKey));
  assert.equal(dash.read_only, true);
  assert.deepEqual(dash.products.map((p) => p.slug), [pa.slug]);
  assert.deepEqual(dash.products[0].approvals.map((x) => x.id), ['a1', 'a2']);
  assert.equal(dash.products[0].approvals[0].title, 'Post bone/b', 'markup characters stripped');
  assert.equal(dash.products[0].approvals[1].client_can_decide, false);
  assert.ok(!JSON.stringify(dash).includes('key_hash') && !JSON.stringify(dash).includes('boss@agency.test') && !JSON.stringify(dash).includes('email_hash'));
});

test('client approve/reject: own products only, pending only, owner-only types blocked, queued not applied', () => {
  const { d, s } = fresh();
  const { tenant } = mkAgency(s);
  const a = s.createClient(tenant.id, { name: 'A Co' });
  const b = s.createClient(tenant.id, { name: 'B Co' });
  const pa = s.addClientProduct(tenant.id, a.client.id, { name: 'A', domain: 'a-co.com' });
  const pb = s.addClientProduct(tenant.id, b.client.id, { name: 'B', domain: 'b-co.com' });
  const whoA = s.authClient(a.clientKey);
  assert.throws(() => s.clientDecision(whoA, { product: pb.slug, approval_id: 'a1', decision: 'approve' }), (e) => e.code === 'forbidden');
  assert.throws(() => s.clientDecision(whoA, { product: pa.slug, approval_id: 'a3', decision: 'approve' }), (e) => e.code === 'conflict');
  assert.throws(() => s.clientDecision(whoA, { product: pa.slug, approval_id: 'a2', decision: 'approve' }), (e) => e.code === 'owner_only');
  assert.throws(() => s.clientDecision(whoA, { product: pa.slug, approval_id: 'a1', decision: 'launch' }));
  const doc = s.clientDecision(whoA, { product: pa.slug, approval_id: 'a1', decision: 'approve', note: 'ok\u0000', activate: true });
  assert.equal(doc.activate, undefined, 'a client can never go live');
  assert.equal(doc.by, `client:${tenant.id}:${a.client.id}`);
  assert.throws(() => s.clientDecision(whoA, { product: pa.slug, approval_id: 'a1', decision: 'reject' }), (e) => e.code === 'conflict');
  // the ledger is untouched
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.productsDir, pa.slug, 'approvals.json'), 'utf8'))[0].status, 'pending');
  // export merges into the apply-decisions inbox once
  const inbox = path.join(d, 'state', 'inbox-decisions.json');
  fs.mkdirSync(path.dirname(inbox), { recursive: true });
  fs.writeFileSync(inbox, JSON.stringify({ decisions: [{ product: 'other', approval_id: 'x', decision: 'reject', at: '2026-01-01T00:00:00Z' }], requests: [] }));
  assert.equal(s.exportDecisions(inbox).added, 1);
  assert.equal(s.exportDecisions(inbox).added, 0);
  const out = JSON.parse(fs.readFileSync(inbox, 'utf8'));
  assert.equal(out.decisions.length, 2);
  assert.deepEqual(Object.keys(out.decisions[1]).sort(), ['approval_id', 'at', 'by', 'decision', 'note', 'product']);
});

test('approvals pause when the agency is past due; rejects still work; canceled revokes client keys', () => {
  let t0 = Date.parse('2026-11-01T00:00:00Z');
  const { s } = fresh(() => t0);
  const { tenant } = mkAgency(s);
  const a = s.createClient(tenant.id, { name: 'A Co' });
  const pa = s.addClientProduct(tenant.id, a.client.id, { name: 'A', domain: 'late-co.com' });
  t0 += 30 * 86400000; // trial ran out
  const who = s.authClient(a.clientKey);
  assert.throws(() => s.clientDecision(who, { product: pa.slug, approval_id: 'a1', decision: 'approve' }), (e) => e.code === 'payment_required');
  assert.equal(s.clientDecision(who, { product: pa.slug, approval_id: 'a1', decision: 'reject' }).decision, 'reject');
  assert.throws(() => s.createClient(tenant.id, { name: 'New' }), (e) => e.code === 'payment_required');
  s.tenants.setStatus(tenant.id, 'canceled');
  assert.equal(s.authClient(a.clientKey), null);
});

test('branding validation: colours, https URLs, emails, domains', () => {
  assert.ok(validColor('#1A73e8') && validColor('#fff'));
  assert.ok(!validColor('red') && !validColor('#12345') && !validColor('#ggg') && !validColor('#fff;x'));
  assert.ok(validHttpsUrl('https://cdn.agency.com/logo.png'));
  for (const bad of ['http://cdn.agency.com/logo.png', 'javascript:alert(1)', 'https://user:pw@cdn.agency.com/x', 'https://localhost/x', 'https://10.0.0.1/x', 'https://cdn.agency.com/a"b', 'data:image/png;base64,AA']) assert.ok(!validHttpsUrl(bad), bad);
  const b = validateBranding({ name: ' Blue <Agency> ', logo_url: 'https://cdn.agency.com/l.svg', primary_color: '#AABBCC', support_email: 'help@agency.test', custom_domain: 'https://App.Agency.com/path', extra: 'x' });
  assert.deepEqual(b, { name: 'Blue Agency', logo_url: 'https://cdn.agency.com/l.svg', primary_color: '#aabbcc', support_email: 'help@agency.test', custom_domain: 'app.agency.com' });
  assert.throws(() => validateBranding({ primary_color: 'blue' }));
  assert.throws(() => validateBranding({ support_email: 'nope' }));
  assert.throws(() => validateBranding({ custom_domain: 'intranet.local' }));
  assert.throws(() => validateBranding({ name: 'x' }));
});

test('branding is stored per agency, served by custom domain, and a domain belongs to one agency', () => {
  const { s } = fresh();
  const { tenant } = mkAgency(s);
  s.setBranding(tenant.id, { name: 'Blue Agency', primary_color: '#123456', custom_domain: 'portal.blue-agency.com' });
  assert.equal(s.getBranding(tenant.id).primary_color, '#123456');
  assert.equal(s.brandingForHost('portal.blue-agency.com').name, 'Blue Agency');
  assert.equal(s.brandingForHost('unknown.example.com'), null);
  const other = mkAgency(s, 'other@agency.test');
  assert.throws(() => s.setBranding(other.tenant.id, { custom_domain: 'portal.blue-agency.com' }), (e) => e.code === 'exists');
});

test('routes: tenant key for /agency, client key for /client, keys never echoed', () => {
  const { s } = fresh();
  const { tenant, apiKey } = mkAgency(s);
  const call = (method, pathname, key, body, q = '') => handleAgencyRequest({ method, pathname, searchParams: new URLSearchParams(q), headers: key ? { authorization: `Bearer ${key}` } : {}, body }, s);
  assert.equal(handleAgencyRequest({ pathname: '/health' }, s), null);
  assert.equal(call('GET', '/agency', null).status, 401);
  const c = call('POST', '/agency/clients', apiKey, { name: 'Acme' });
  assert.equal(c.status, 201);
  const ck = c.body.client_key;
  assert.equal(call('GET', '/agency', ck).status, 401, 'client key cannot use agency routes');
  assert.equal(call('POST', '/agency/branding', apiKey, { primary_color: 'nope' }).status, 400);
  assert.equal(call('POST', '/agency/branding', apiKey, { name: 'Acme Agency', custom_domain: 'go.acme-agency.com' }).status, 200);
  assert.equal(call('GET', '/agency/branding/public', null, null, 'host=go.acme-agency.com').body.branding.name, 'Acme Agency');
  const p = call('POST', `/agency/clients/${c.body.client.id}/products`, apiKey, { name: 'Acme', domain: 'acme-shoes.com' });
  assert.equal(p.status, 201);
  assert.equal(call('GET', '/client', apiKey).status, 401, 'tenant key is not a client login');
  const dash = call('GET', '/client', ck);
  assert.equal(dash.status, 200);
  assert.equal(dash.body.products[0].slug, p.body.slug);
  assert.equal(call('POST', '/client/decisions', ck, { product: p.body.slug, approval_id: 'a1', decision: 'approve' }).status, 202);
  const listed = call('GET', '/agency', apiKey);
  assert.ok(!JSON.stringify(listed.body).includes(ck) && !JSON.stringify(listed.body).includes('key_hash'));
  assert.equal(call('POST', `/agency/clients/${c.body.client.id}/disable`, apiKey, {}).status, 200);
  assert.equal(call('GET', '/client', ck).status, 401);
});

test('review guards: a client cannot approve over a compliance block, budget items or owner_only items', () => {
  const { s } = fresh();
  const { tenant } = mkAgency(s);
  const a = s.createClient(tenant.id, { name: 'A Co' });
  const pa = s.addClientProduct(tenant.id, a.client.id, { name: 'A', domain: 'guard-co.com' });
  fs.writeFileSync(path.join(s.productsDir, pa.slug, 'approvals.json'), JSON.stringify([
    { id: 'b1', type: 'publish', title: 'Blocked post', status: 'pending', compliance: 'block' },
    { id: 'b2', type: 'budget_shift', title: 'Move budget', status: 'pending', compliance: 'pass' },
    { id: 'b3', type: 'publish', title: 'Flagged', status: 'pending', owner_only: true },
  ]));
  const who = s.authClient(a.clientKey);
  for (const id of ['b1', 'b2', 'b3']) assert.throws(() => s.clientDecision(who, { product: pa.slug, approval_id: id, decision: 'approve' }), (e) => e.code === 'owner_only', id);
  assert.equal(s.clientDecision(who, { product: pa.slug, approval_id: 'b1', decision: 'reject' }).decision, 'reject', 'rejecting a blocked item is allowed');
  assert.deepEqual(s.clientDashboard(who).products[0].approvals.map((x) => x.client_can_decide), [false, false, false]);
});

test('client notes lose emails and phone numbers before they reach the inbox', () => {
  const { s } = fresh();
  const { tenant } = mkAgency(s);
  const a = s.createClient(tenant.id, { name: 'A Co' });
  const pa = s.addClientProduct(tenant.id, a.client.id, { name: 'A', domain: 'note-co.com' });
  const doc = s.clientDecision(s.authClient(a.clientKey), { product: pa.slug, approval_id: 'a1', decision: 'approve', note: 'ok, call jane.doe@mail.com or +1 (555) 123-4567' });
  assert.ok(!doc.note.includes('jane.doe') && !doc.note.includes('555'), doc.note);
});

test('export re-checks every decision: disabled client, decided approval, lapsed billing, tampered queue', () => {
  let t0 = Date.parse('2026-11-01T00:00:00Z');
  const { d, s } = fresh(() => t0);
  const { tenant } = mkAgency(s);
  const a = s.createClient(tenant.id, { name: 'A Co' });
  const b = s.createClient(tenant.id, { name: 'B Co' });
  const pa = s.addClientProduct(tenant.id, a.client.id, { name: 'A', domain: 'exp-a.com' });
  const pb = s.addClientProduct(tenant.id, b.client.id, { name: 'B', domain: 'exp-b.com' });
  s.clientDecision(s.authClient(a.clientKey), { product: pa.slug, approval_id: 'a1', decision: 'approve' });
  s.clientDecision(s.authClient(b.clientKey), { product: pb.slug, approval_id: 'a1', decision: 'approve' });
  s.disableClient(tenant.id, b.client.id);
  // the owner decided a1 on A meanwhile
  const af = path.join(s.productsDir, pa.slug, 'approvals.json');
  const list = JSON.parse(fs.readFileSync(af, 'utf8')); list[0].status = 'approved'; fs.writeFileSync(af, JSON.stringify(list));
  // a tampered queue entry that tries to go live, plus junk
  const qf = path.join(s.dir, tenant.id, 'decisions.json');
  const q = JSON.parse(fs.readFileSync(qf, 'utf8'));
  q.push({ product: pa.slug, approval_id: 'a1', decision: 'approve', at: 'x', by: `client:${tenant.id}:${a.client.id}`, activate: true }, null);
  fs.writeFileSync(qf, JSON.stringify(q));
  const inbox = path.join(d, 'state', 'inbox-decisions.json');
  const r = s.exportDecisions(inbox);
  assert.equal(r.added, 0);
  assert.equal(r.dropped, 3);
  assert.ok(JSON.parse(fs.readFileSync(qf, 'utf8')).filter(Boolean).every((x) => x.dropped_at && !x.exported_at));
  // lapsed billing drops approves at export time too
  const c = s.createClient(tenant.id, { name: 'C Co' });
  const pc = s.addClientProduct(tenant.id, c.client.id, { name: 'C', domain: 'exp-c.com' });
  s.clientDecision(s.authClient(c.clientKey), { product: pc.slug, approval_id: 'a1', decision: 'approve' });
  t0 += 30 * 86400000;
  assert.equal(s.exportDecisions(inbox).added, 0);
  assert.equal(JSON.parse(fs.readFileSync(inbox, 'utf8')).decisions.length, 0);
});

test('export never overwrites an unreadable inbox', () => {
  const { d, s } = fresh();
  const { tenant } = mkAgency(s);
  const a = s.createClient(tenant.id, { name: 'A Co' });
  const pa = s.addClientProduct(tenant.id, a.client.id, { name: 'A', domain: 'bad-inbox.com' });
  s.clientDecision(s.authClient(a.clientKey), { product: pa.slug, approval_id: 'a1', decision: 'reject' });
  const inbox = path.join(d, 'state', 'inbox-decisions.json');
  fs.mkdirSync(path.dirname(inbox), { recursive: true });
  fs.writeFileSync(inbox, '{ "decisions": [ broken');
  assert.throws(() => s.exportDecisions(inbox), (e) => e.code === 'conflict');
  assert.equal(fs.readFileSync(inbox, 'utf8'), '{ "decisions": [ broken');
});

test('tightening a client to free mode moves its existing products to $0 mode', () => {
  const { s } = fresh();
  const { tenant } = mkAgency(s);
  const { client } = s.createClient(tenant.id, { name: 'Paid Co', budget_modes: ['free', 'paid'] });
  const p = s.addClientProduct(tenant.id, client.id, { name: 'Paid', domain: 'tighten-co.com' });
  const pf = path.join(s.productsDir, p.slug, 'product.json');
  assert.equal(JSON.parse(fs.readFileSync(pf, 'utf8')).budget.mode, 'paid');
  s.setClientLimits(tenant.id, client.id, { budget_modes: ['free'] });
  const pj = JSON.parse(fs.readFileSync(pf, 'utf8'));
  assert.deepEqual(pj.budget, { mode: 'free', monthly_cap: 0, daily_cap: 0 });
  assert.deepEqual(pj.plan_limits.budget_modes, ['free']);
});
