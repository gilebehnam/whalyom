// Whalyom Cloud tenants: other companies sign up, get an API key, add their sites and pay.
// Until this file Whalyom Cloud was one owner (or agency) running many sites; a tenant is one
// customer account on that hub, with a plan, a status driven by Stripe (tools/cloud/billing.mjs)
// and its own product workspaces (products/<tenant-id>-<name>/, made by tools/new-product.mjs).
//
// State lives in tenants/ (gitignored, never in state/ or the dashboard):
//   tenants/<id>/tenant.json   id, name, email_hash, plan, status, dates, products, api_key_hash, limits
//   tenants/<id>/contact.json  the plain email for billing contact only (mode 0600)
//   tenants/_events.json       processed Stripe event ids (webhook idempotency)
// The API key is shown once at sign-up; only its SHA-256 is stored. Emails are stored as a hash
// in tenant.json and never logged.
//   node tools/cloud/tenants.mjs list | show <id> | status <id> <trial|active|past_due|canceled>
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { publicHostName } from '../instant-onboard.mjs';
import { readJson, root as repoRoot } from '../lib/env.mjs';

export const TRIAL_DAYS = 14;
export const STATUSES = ['trial', 'active', 'past_due', 'canceled'];
// free: one site, $0 mode only, no card, no expiry. Paid plans start with a 14-day trial.
export const PLANS = {
  free: { label: 'Free', max_products: 1, budget_modes: ['free'], white_label: false, price_env: null, trial: false },
  growth: { label: 'Growth', max_products: 3, budget_modes: ['free', 'paid', 'hybrid'], white_label: false, price_env: 'STRIPE_PRICE_GROWTH', trial: true },
  scale: { label: 'Scale', max_products: 15, budget_modes: ['free', 'paid', 'hybrid'], white_label: false, price_env: 'STRIPE_PRICE_SCALE', trial: true },
  agency: { label: 'Agency', max_products: 50, budget_modes: ['free', 'paid', 'hybrid'], white_label: true, price_env: 'STRIPE_PRICE_AGENCY', trial: true },
};

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const emailHash = (email) => sha256(String(email ?? '').trim().toLowerCase());
const validEmail = (e) => /^[^\s@<>"]{1,64}@[^\s@<>"]{1,253}\.[a-z]{2,63}$/i.test(String(e ?? '').trim());
const cleanDomain = (d) => String(d ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^www\./, '');
const slugPart = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
const limitsFor = (plan) => ({ max_products: PLANS[plan].max_products, budget_modes: [...PLANS[plan].budget_modes], white_label: PLANS[plan].white_label });

export class TenantError extends Error {
  constructor(message, status = 400, code = 'bad_request') { super(message); this.status = status; this.code = code; }
}

// What a tenant may do right now. A paid-plan trial that ran out without a subscription counts as
// past_due; past_due and canceled tenants are blocked from product actions (402).
export function effectiveStatus(t, now = Date.now()) {
  if (t.status === 'trial' && t.trial_ends_at && Date.parse(t.trial_ends_at) < now) return 'past_due';
  return t.status;
}
export const canUseProducts = (t, now) => ['trial', 'active'].includes(effectiveStatus(t, now));

// Default workspace creation: the existing tools/new-product.mjs, as a child process.
function newProductWorkspace({ slug, name, domain, root }) {
  const args = [path.join(root, 'tools', 'new-product.mjs'), slug, '--name', name];
  if (domain) args.push('--domain', domain);
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) throw new TenantError(`workspace creation failed: ${String(r.stderr || r.stdout || r.error?.message || '').trim().slice(0, 200)}`, 500, 'workspace_failed');
}

export function createTenantStore(options = {}) {
  const ROOT = options.root ?? repoRoot;
  const DIR = options.dir ?? path.join(ROOT, 'tenants');
  const PRODUCTS = options.productsDir ?? path.join(ROOT, 'products');
  const now = options.now ?? (() => Date.now());
  const createWorkspace = options.createWorkspace ?? ((o) => newProductWorkspace({ ...o, root: ROOT }));
  const fileOf = (id) => path.join(DIR, id, 'tenant.json');
  const validId = (id) => /^t[0-9a-f]{10}$/.test(String(id ?? ''));

  const write = (t) => {
    fs.mkdirSync(path.join(DIR, t.id), { recursive: true });
    const f = fileOf(t.id); const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(t, null, 2)); fs.renameSync(tmp, f);
    return t;
  };
  const getTenant = (id) => (validId(id) ? readJson(fileOf(id), null) : null);
  const listTenants = () => (fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(validId).map(getTenant).filter(Boolean) : []);
  const event = (t, what, extra = {}) => { t.events = [...(t.events ?? []), { at: new Date(now()).toISOString(), what, ...extra }].slice(-50); };

  function createTenant({ name, email, plan = 'free' } = {}) {
    const n = String(name ?? '').trim().replace(/[\u0000-\u001f]/g, '').slice(0, 120);
    if (n.length < 2) throw new TenantError('name is required (2+ characters)');
    if (!validEmail(email)) throw new TenantError('a valid email is required');
    if (!PLANS[plan]) throw new TenantError(`unknown plan; choose ${Object.keys(PLANS).join(', ')}`);
    const eh = emailHash(email);
    if (listTenants().some((t) => t.email_hash === eh && t.status !== 'canceled')) throw new TenantError('an account with this email already exists', 409, 'exists');
    let id; do { id = `t${crypto.randomBytes(5).toString('hex')}`; } while (fs.existsSync(path.join(DIR, id)));
    const apiKey = `wyk_${id}_${crypto.randomBytes(24).toString('hex')}`;
    const at = new Date(now()).toISOString();
    const t = {
      id, name: n, email_hash: eh, plan,
      status: PLANS[plan].trial ? 'trial' : 'active',
      created_at: at,
      trial_ends_at: PLANS[plan].trial ? new Date(now() + TRIAL_DAYS * 86400000).toISOString() : null,
      products: [], product_domains: {},
      api_key_hash: sha256(apiKey),
      limits: limitsFor(plan),
      billing: { stripe_customer_id: null, stripe_subscription_id: null },
    };
    event(t, 'created', { plan });
    write(t);
    const cf = path.join(DIR, id, 'contact.json');
    fs.writeFileSync(cf, JSON.stringify({ email: String(email).trim(), name: n, created_at: at }, null, 2), { mode: 0o600 });
    try { fs.chmodSync(cf, 0o600); } catch { /* not supported on this file system */ }
    return { tenant: publicView(t), apiKey };
  }

  // Key format wyk_<tenant-id>_<secret>: the id finds the file, the hash proves the key.
  function authTenant(apiKey) {
    const m = /^wyk_(t[0-9a-f]{10})_[0-9a-f]{48}$/.exec(String(apiKey ?? '').trim());
    if (!m) return null;
    const t = getTenant(m[1]);
    if (!t?.api_key_hash) return null;
    const a = Buffer.from(sha256(apiKey.trim()), 'hex'); const b = Buffer.from(t.api_key_hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? t : null;
  }

  function addProduct(tenantId, { name, domain } = {}) {
    const t = getTenant(tenantId);
    if (!t) throw new TenantError('unknown tenant', 404, 'not_found');
    if (!canUseProducts(t, now())) throw new TenantError(`account is ${effectiveStatus(t, now())}: update billing to add products`, 402, 'payment_required');
    const max = t.limits?.max_products ?? PLANS[t.plan].max_products;
    if (t.products.length >= max) throw new TenantError(`the ${PLANS[t.plan].label} plan allows ${max} product${max === 1 ? '' : 's'}; upgrade to add more`, 403, 'plan_limit');
    const d = domain ? cleanDomain(domain) : '';
    if (d && !publicHostName(d)) throw new TenantError('domain must be a public website domain, like example.com');
    if (d && Object.values(t.product_domains ?? {}).includes(d)) throw new TenantError('this domain is already one of your products', 409, 'exists');
    if (d && fs.existsSync(PRODUCTS) && fs.readdirSync(PRODUCTS).some((s) => !s.startsWith('_') && cleanDomain(readJson(path.join(PRODUCTS, s, 'product.json'), {})?.domain) === d)) throw new TenantError('this domain is already managed on this hub', 409, 'exists');
    const label = String(name ?? '').trim().slice(0, 120) || d;
    const base = slugPart(label) || 'site';
    let slug = `${t.id}-${base}`; let i = 2;
    while (fs.existsSync(path.join(PRODUCTS, slug))) slug = `${t.id}-${base}-${i++}`;
    createWorkspace({ slug, name: label || slug, domain: d, productsDir: PRODUCTS });
    const pj = path.join(PRODUCTS, slug, 'product.json');
    const p = readJson(pj, null);
    if (p) {
      p.tenant = t.id;
      if (!t.limits.budget_modes.includes(p.budget?.mode)) { p.budget = { ...(p.budget ?? {}), mode: 'free', monthly_cap: 0, daily_cap: 0 }; }
      p.plan_limits = { budget_modes: t.limits.budget_modes, white_label: t.limits.white_label };
      fs.writeFileSync(pj, JSON.stringify(p, null, 2));
    }
    const fresh = getTenant(t.id);
    fresh.products = [...fresh.products, slug];
    fresh.product_domains = { ...(fresh.product_domains ?? {}), ...(d ? { [slug]: d } : {}) };
    event(fresh, 'product_added', { slug });
    write(fresh);
    return { slug, domain: d, tenant: publicView(fresh) };
  }

  function setStatus(tenantId, status, extra = {}) {
    if (!STATUSES.includes(status)) throw new TenantError(`status must be one of ${STATUSES.join(', ')}`);
    const t = getTenant(tenantId);
    if (!t) throw new TenantError('unknown tenant', 404, 'not_found');
    const from = t.status;
    t.status = status;
    if (extra.plan && PLANS[extra.plan]) { t.plan = extra.plan; t.limits = limitsFor(extra.plan); }
    if (status === 'active') t.trial_ends_at = null;
    t.billing = { ...(t.billing ?? {}), ...(extra.customer ? { stripe_customer_id: extra.customer } : {}), ...(extra.subscription ? { stripe_subscription_id: extra.subscription } : {}) };
    event(t, 'status', { from, to: status, ...(extra.plan ? { plan: extra.plan } : {}), ...(extra.source ? { source: extra.source } : {}) });
    return write(t);
  }

  const findByBilling = ({ customer, subscription } = {}) => listTenants().find((t) => (subscription && t.billing?.stripe_subscription_id === subscription) || (customer && t.billing?.stripe_customer_id === customer)) ?? null;

  // Domains owned by active or trial tenants are accepted by the edge even when OM_EDGE_DOMAINS is set.
  let domainCache = { at: 0, set: new Set() };
  function ownsDomain(host) {
    if (now() - domainCache.at > 60000) domainCache = { at: now(), set: new Set(listTenants().filter((t) => canUseProducts(t, now())).flatMap((t) => Object.values(t.product_domains ?? {}))) };
    return domainCache.set.has(cleanDomain(host));
  }

  // Webhook idempotency: Stripe retries; an event id is applied once.
  function seenEvent(eventId, mark = true) {
    const f = path.join(DIR, '_events.json');
    const ids = readJson(f, []);
    if (ids.includes(eventId)) return true;
    if (!mark) return false;
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(f, JSON.stringify([...ids, eventId].slice(-1000)));
    return false;
  }

  function publicView(t) {
    return {
      id: t.id, name: t.name, plan: t.plan, status: t.status, effective_status: effectiveStatus(t, now()),
      created_at: t.created_at, trial_ends_at: t.trial_ends_at, products: t.products, limits: t.limits,
    };
  }

  return { dir: DIR, productsDir: PRODUCTS, createTenant, authTenant, addProduct, setStatus, listTenants, getTenant, findByBilling, ownsDomain, seenEvent, publicView, now };
}

let defaultStore;
const store = () => (defaultStore ??= createTenantStore());
export const createTenant = (o) => store().createTenant(o);
export const authTenant = (k) => store().authTenant(k);
export const addProduct = (id, o) => store().addProduct(id, o);
export const setStatus = (id, s, e) => store().setStatus(id, s, e);
export const listTenants = () => store().listTenants();

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, id, status] = process.argv.slice(2);
  const s = store();
  try {
    if (cmd === 'list') for (const t of s.listTenants()) console.log(`${t.id}  ${t.plan.padEnd(7)} ${effectiveStatus(t).padEnd(9)} ${t.products.length} product(s)  ${t.name}`);
    else if (cmd === 'show') console.log(JSON.stringify(s.publicView(s.getTenant(id) ?? (() => { throw new TenantError('unknown tenant'); })()), null, 2));
    else if (cmd === 'status') console.log(`${id} is now ${s.setStatus(id, status, { source: 'owner' }).status}`);
    else { console.log('Usage: node tools/cloud/tenants.mjs list | show <id> | status <id> <trial|active|past_due|canceled>'); process.exit(2); }
  } catch (e) { console.error(e.message); process.exit(1); }
}
