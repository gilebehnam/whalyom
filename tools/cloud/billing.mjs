// Whalyom Cloud billing: Stripe Checkout for tenant plans and the Stripe webhook that drives
// tenant status (tools/cloud/tenants.mjs). Plain REST calls, no SDK.
//
// Owner setup (once, in the Stripe dashboard): one recurring price per paid plan and a webhook
// endpoint pointing at https://<edge>/billing/webhook for checkout.session.completed,
// customer.subscription.updated, customer.subscription.deleted and invoice.payment_failed.
// Environment only (never in the repo, never logged):
//   STRIPE_SECRET_KEY        sk_live_… / sk_test_… (restricted key with Checkout write is enough)
//   STRIPE_WEBHOOK_SECRET    whsec_… from the webhook endpoint
//   STRIPE_PRICE_GROWTH / STRIPE_PRICE_SCALE / STRIPE_PRICE_AGENCY   price_… ids
//   OM_BILLING_SUCCESS_URL / OM_BILLING_CANCEL_URL   where Checkout returns (default: OM_EDGE_URL)
import crypto from 'node:crypto';
import { PLANS, TenantError } from './tenants.mjs';

export const WEBHOOK_TOLERANCE_SEC = 300;
const API = 'https://api.stripe.com/v1';

const form = (obj) => Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');

export function priceFor(plan, env = process.env) {
  const p = PLANS[plan];
  return p?.price_env ? String(env[p.price_env] ?? '').trim() : '';
}
export function planForPrice(priceId, env = process.env) {
  if (!priceId) return null;
  return Object.keys(PLANS).find((k) => PLANS[k].price_env && String(env[PLANS[k].price_env] ?? '').trim() === priceId) ?? null;
}

// Returns { id, url } of a Stripe Checkout Session in subscription mode for this tenant.
export async function createCheckoutSession(tenant, plan, { fetch: doFetch = globalThis.fetch, env = process.env, successUrl, cancelUrl } = {}) {
  if (!PLANS[plan]?.price_env) throw new TenantError('choose a paid plan: growth, scale or agency');
  const key = String(env.STRIPE_SECRET_KEY ?? '').trim();
  if (!/^(sk|rk)_(test|live)_/.test(key)) throw new TenantError('billing is not configured on this hub (STRIPE_SECRET_KEY)', 503, 'billing_off');
  const price = priceFor(plan, env);
  if (!/^price_/.test(price)) throw new TenantError(`billing is not configured for the ${plan} plan (${PLANS[plan].price_env})`, 503, 'billing_off');
  const base = String(env.OM_EDGE_URL ?? '').replace(/\/$/, '');
  const ok = successUrl ?? env.OM_BILLING_SUCCESS_URL ?? (base ? `${base}/billing/done?status=success` : '');
  const back = cancelUrl ?? env.OM_BILLING_CANCEL_URL ?? (base ? `${base}/billing/done?status=cancel` : ok);
  if (!/^https?:\/\//.test(ok)) throw new TenantError('set OM_BILLING_SUCCESS_URL or OM_EDGE_URL for the Checkout return page', 503, 'billing_off');
  const body = form({
    mode: 'subscription',
    'line_items[0][price]': price,
    'line_items[0][quantity]': 1,
    client_reference_id: tenant.id,
    customer: tenant.billing?.stripe_customer_id || undefined,
    success_url: ok,
    cancel_url: back,
    'metadata[tenant_id]': tenant.id,
    'metadata[plan]': plan,
    'subscription_data[metadata][tenant_id]': tenant.id,
    'subscription_data[metadata][plan]': plan,
    allow_promotion_codes: 'true',
  });
  let res;
  try {
    res = await doFetch(`${API}/checkout/sessions`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded', 'stripe-version': '2024-06-20' }, body });
  } catch { throw new TenantError('could not reach Stripe', 502, 'stripe_unreachable'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.url) throw new TenantError(`Stripe refused the checkout: ${String(data?.error?.message ?? res.status).slice(0, 200)}`, 502, 'stripe_error');
  return { id: data.id, url: data.url };
}

// Stripe-Signature: t=<unix>,v1=<hex hmac>[,v1=…]. HMAC-SHA256 over `${t}.${rawBody}` with the
// endpoint secret, compared in constant time, within a 5-minute tolerance.
export function verifySignature(rawBody, header, secret, { now = Date.now(), tolerance = WEBHOOK_TOLERANCE_SEC } = {}) {
  if (!secret) return { ok: false, reason: 'no webhook secret' };
  const parts = String(header ?? '').split(',').map((s) => s.trim().split('='));
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v).filter((v) => /^[0-9a-f]{64}$/.test(v ?? ''));
  if (!Number.isFinite(t) || !sigs.length) return { ok: false, reason: 'malformed signature header' };
  if (Math.abs(now / 1000 - t) > tolerance) return { ok: false, reason: 'timestamp outside tolerance' };
  const want = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  const match = sigs.some((s) => { const got = Buffer.from(s, 'hex'); return got.length === want.length && crypto.timingSafeEqual(got, want); });
  return match ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}

// Stripe subscription status → tenant status.
export function statusForSubscription(s) {
  if (s === 'active') return 'active';
  if (s === 'trialing') return 'trial';
  if (s === 'past_due' || s === 'unpaid' || s === 'incomplete' || s === 'paused') return 'past_due';
  if (s === 'canceled' || s === 'incomplete_expired') return 'canceled';
  return null;
}

// Verifies and applies one webhook delivery. Returns { ok, type, tenant_id?, status?, ignored? };
// throws TenantError(400) when the signature is missing, wrong or expired.
export function handleWebhook(rawBody, signatureHeader, secret, { store, env = process.env, now = Date.now() } = {}) {
  const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody ?? '');
  const v = verifySignature(raw, signatureHeader, secret, { now });
  if (!v.ok) throw new TenantError(`invalid webhook: ${v.reason}`, 400, 'bad_signature');
  let evt; try { evt = JSON.parse(raw); } catch { throw new TenantError('invalid webhook: bad json', 400, 'bad_json'); }
  const type = String(evt?.type ?? ''); const obj = evt?.data?.object ?? {};
  if (!store) throw new TenantError('no tenant store', 500, 'server');
  if (evt.id && store.seenEvent(evt.id, false)) return { ok: true, type, duplicate: true };
  const done = (r) => { if (evt.id) store.seenEvent(evt.id, true); return r; };
  const byMeta = (o) => store.getTenant(o?.metadata?.tenant_id ?? o?.client_reference_id ?? '');
  const sub = typeof obj.subscription === 'string' ? obj.subscription : obj.subscription?.id;
  const cust = typeof obj.customer === 'string' ? obj.customer : obj.customer?.id;
  let tenant = null; let status = null; const extra = { source: `stripe:${type}` };

  if (type === 'checkout.session.completed') {
    tenant = store.getTenant(obj.client_reference_id ?? '') ?? byMeta(obj);
    if (obj.mode === 'subscription' && (obj.payment_status === 'paid' || obj.payment_status === 'no_payment_required' || obj.status === 'complete')) status = 'active';
    extra.plan = PLANS[obj.metadata?.plan] ? obj.metadata.plan : undefined;
    extra.customer = cust; extra.subscription = sub;
  } else if (type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') {
    tenant = byMeta(obj) ?? store.findByBilling({ subscription: obj.id, customer: cust });
    status = type === 'customer.subscription.deleted' ? 'canceled' : statusForSubscription(obj.status);
    const plan = planForPrice(obj.items?.data?.[0]?.price?.id, env) ?? (PLANS[obj.metadata?.plan] ? obj.metadata.plan : null);
    if (plan && type === 'customer.subscription.updated') extra.plan = plan;
    extra.customer = cust; extra.subscription = obj.id;
  } else if (type === 'invoice.payment_failed') {
    tenant = store.findByBilling({ subscription: sub, customer: cust }) ?? byMeta(obj.subscription_details ?? obj.parent?.subscription_details ?? {});
    status = 'past_due';
  } else return done({ ok: true, type, ignored: true });

  if (!tenant || !status) return done({ ok: true, type, ignored: true, reason: tenant ? 'no status change' : 'unknown tenant' });
  const t = store.setStatus(tenant.id, status, extra);
  return done({ ok: true, type, tenant_id: t.id, status: t.status, plan: t.plan });
}
