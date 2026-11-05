// Whalyom Cloud agency and white-label mode, on top of tools/cloud/tenants.mjs (which it only reads
// and calls; it never changes how a tenant, its key or its billing works).
//
// An agency tenant (plan "agency", limits.white_label true) creates client sub-accounts. Each client:
//   - owns some of the agency's products (made with tenants.addProduct, so the agency plan's product cap,
//     billing status and domain rules still apply), tagged in product.json with tenant + client;
//   - gets a scoped client login key wyc_<tenant-id>_<client-id>_<secret>, shown once, stored as SHA-256;
//   - can read a read-only dashboard of its own products and approve or reject pending approvals on its
//     own products only. A client decision is never applied here: it is queued and exported in the
//     apply-decisions format, so the existing executor carries it out under every guard. A client can
//     never set activate (go-live stays the owner's), never decide owner-only items (caps, limits,
//     plans, policy, autonomy), and cannot approve while the agency account is not trial/active.
// Per-client limits come from the agency plan: a client's max_products and budget_modes can only be the
// plan's or tighter, and a client without paid modes gets products forced to $0 mode with zero caps.
// Branding per agency (name, logo URL, primary colour, support email, custom domain) is validated and
// served as JSON for the Command Center.
//
// State lives next to the tenant (gitignored tenants/, never state/ or logs):
//   tenants/<tenant-id>/agency.json     branding, clients [{id, name, key_hash, limits, products, status}]
//   tenants/<tenant-id>/decisions.json  queued client decisions (no personal data) until exported
//
//   node tools/cloud/agency.mjs clients <tenant-id> | branding <tenant-id> | export-decisions [inbox-file]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicHostName } from '../instant-onboard.mjs';
import { readJson, root as repoRoot } from '../lib/env.mjs';
import { createTenantStore, PLANS, sha256, canUseProducts, effectiveStatus, TenantError } from './tenants.mjs';

// Agency-plan limits that tenants.mjs does not carry. Products stay capped by PLANS.agency.max_products
// across all clients together (tenants.addProduct enforces it).
export const AGENCY_LIMITS = { max_clients: 25, client_max_products: 5 };
export const CLIENT_STATUSES = ['active', 'disabled'];
// Approval types a client may never decide: these stay with the owner/agency.
export const OWNER_ONLY_TYPES = /(cap|limit|plan|owner|policy|autonomy|evolution|guard|kill|budget)/i;

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
// Whether a client may take this decision on this approval. Approving over a compliance block is an
// override (apply-decisions sets override_review), so only the owner may do it; rejecting stays open.
export function clientMayDecide(item, decision = 'approve') {
  if (!item || typeof item !== 'object') return { ok: false, why: 'unknown approval' };
  if (OWNER_ONLY_TYPES.test(String(item.type ?? '')) || item.owner_only === true) return { ok: false, why: 'this approval needs the agency owner' };
  if (decision === 'approve' && ['block', 'fail'].includes(String(item.compliance ?? '').toLowerCase())) return { ok: false, why: `compliance is ${item.compliance}: only the agency owner can approve over a review` };
  return { ok: true };
}
// Client notes reach state/inbox-decisions.json and the product ledger: emails and phone numbers are removed.
export const redactNote = (s) => clean(s, 500).replace(/[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,63}/gi, '[email]').replace(/\+?\d[\d\s().-]{6,}\d/g, '[number]');
const validEmail = (e) => /^[^\s@<>"]{1,64}@[^\s@<>"]{1,253}\.[a-z]{2,63}$/i.test(String(e ?? '').trim());
const cleanDomain = (d) => String(d ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^www\./, '');
const validClientId = (id) => /^c[0-9a-f]{8}$/.test(String(id ?? ''));
const slugOk = (s) => /^[a-z0-9-]+$/.test(String(s ?? ''));

// ---- branding validation (pure) ----
export function validColor(c) { return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(c ?? '')); }
export function validHttpsUrl(u) {
  const s = String(u ?? '').trim();
  if (!s || s.length > 500 || /[\s"'<>`]/.test(s)) return false;
  let url; try { url = new URL(s); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  return Boolean(publicHostName(url.hostname));
}
// Returns the cleaned branding or throws TenantError naming the first bad field. Unknown keys are dropped.
export function validateBranding(input = {}, current = {}) {
  const b = { ...current };
  if (input == null || typeof input !== 'object' || Array.isArray(input)) throw new TenantError('branding must be an object');
  if ('name' in input) { const n = clean(input.name, 80); if (n.length < 2) throw new TenantError('branding.name needs 2+ characters'); b.name = n; }
  if ('logo_url' in input) { if (input.logo_url === null || input.logo_url === '') b.logo_url = null; else if (!validHttpsUrl(input.logo_url)) throw new TenantError('branding.logo_url must be a public https URL'); else b.logo_url = String(input.logo_url).trim(); }
  if ('primary_color' in input) { if (!validColor(input.primary_color)) throw new TenantError('branding.primary_color must be a hex colour like #1a73e8'); b.primary_color = String(input.primary_color).toLowerCase(); }
  if ('support_email' in input) { if (input.support_email === null || input.support_email === '') b.support_email = null; else if (!validEmail(input.support_email)) throw new TenantError('branding.support_email must be a valid email'); else b.support_email = String(input.support_email).trim(); }
  if ('custom_domain' in input) {
    if (input.custom_domain === null || input.custom_domain === '') b.custom_domain = null;
    else { const d = cleanDomain(input.custom_domain); if (!publicHostName(d)) throw new TenantError('branding.custom_domain must be a public domain, like app.agency.com'); b.custom_domain = d; }
  }
  return b;
}

// Client limits: the request, never looser than the agency plan.
export function clientLimits(plan, req = {}) {
  const p = PLANS[plan] ?? PLANS.agency;
  const cap = Math.min(AGENCY_LIMITS.client_max_products, p.max_products);
  const n = req.max_products == null ? cap : Number(req.max_products);
  if (!Number.isInteger(n) || n < 1 || n > cap) throw new TenantError(`max_products must be 1..${cap} on the ${p.label} plan`);
  const modes = req.budget_modes == null ? ['free'] : req.budget_modes;
  if (!Array.isArray(modes) || !modes.length || modes.some((m) => !p.budget_modes.includes(m))) throw new TenantError(`budget_modes must be a subset of ${p.budget_modes.join(', ')}`);
  return { max_products: n, budget_modes: [...new Set(modes)] };
}

export function createAgencyStore(options = {}) {
  const ROOT = options.root ?? repoRoot;
  const tenants = options.tenants ?? createTenantStore({ root: ROOT, ...(options.tenantOptions ?? {}) });
  const DIR = tenants.dir;
  const PRODUCTS = tenants.productsDir;
  const now = options.now ?? tenants.now ?? (() => Date.now());
  const iso = () => new Date(now()).toISOString();
  const agencyFile = (id) => path.join(DIR, id, 'agency.json');
  const decisionsFile = (id) => path.join(DIR, id, 'decisions.json');
  const atomic = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = `${f}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v, null, 2), { mode: 0o600 }); fs.renameSync(tmp, f); return v; };

  const requireAgency = (tenantOrId, { forWrite = false } = {}) => {
    const t = typeof tenantOrId === 'string' ? tenants.getTenant(tenantOrId) : tenantOrId;
    if (!t) throw new TenantError('unknown tenant', 404, 'not_found');
    if (t.plan !== 'agency' || !t.limits?.white_label) throw new TenantError('agency features need the Agency plan', 403, 'plan_limit');
    if (forWrite && !canUseProducts(t, now())) throw new TenantError(`account is ${effectiveStatus(t, now())}: update billing first`, 402, 'payment_required');
    return t;
  };
  const load = (id) => readJson(agencyFile(id), null) ?? { tenant: id, branding: {}, clients: [], created_at: iso() };
  const save = (a) => atomic(agencyFile(a.tenant), { ...a, updated_at: iso() });
  const maxClients = (t) => t.limits?.max_clients ?? AGENCY_LIMITS.max_clients;

  const clientPublic = (c) => ({ id: c.id, name: c.name, status: c.status, limits: c.limits, products: c.products, created_at: c.created_at });

  function createClient(tenantId, { name, max_products, budget_modes } = {}) {
    const t = requireAgency(tenantId, { forWrite: true });
    const n = clean(name, 120);
    if (n.length < 2) throw new TenantError('client name is required (2+ characters)');
    const a = load(t.id);
    if (a.clients.filter((c) => c.status === 'active').length >= maxClients(t)) throw new TenantError(`the Agency plan allows ${maxClients(t)} active clients`, 403, 'plan_limit');
    const limits = clientLimits(t.plan, { max_products, budget_modes });
    let id; do { id = `c${crypto.randomBytes(4).toString('hex')}`; } while (a.clients.some((c) => c.id === id));
    const key = `wyc_${t.id}_${id}_${crypto.randomBytes(24).toString('hex')}`;
    const c = { id, name: n, status: 'active', key_hash: sha256(key), limits, products: [], created_at: iso() };
    a.clients.push(c);
    save(a);
    return { client: clientPublic(c), clientKey: key };
  }

  function listClients(tenantId) { const t = requireAgency(tenantId); return load(t.id).clients.map(clientPublic); }

  function updateClient(tenantId, clientId, fn) {
    const t = requireAgency(tenantId);
    const a = load(t.id);
    const c = a.clients.find((x) => x.id === clientId);
    if (!c) throw new TenantError('unknown client', 404, 'not_found');
    const r = fn(c, t);
    save(a);
    return r ?? clientPublic(c);
  }
  // Disabling revokes the key at once (status checked on every auth); re-enabling needs a new key.
  const disableClient = (tenantId, clientId) => updateClient(tenantId, clientId, (c) => { c.status = 'disabled'; c.key_hash = null; c.disabled_at = iso(); });
  const rotateClientKey = (tenantId, clientId) => updateClient(tenantId, clientId, (c, t) => {
    const key = `wyc_${t.id}_${c.id}_${crypto.randomBytes(24).toString('hex')}`;
    c.key_hash = sha256(key); c.status = 'active'; delete c.disabled_at;
    return { client: clientPublic(c), clientKey: key };
  });
  // Only tightens or stays within the plan (clientLimits checks the plan ceiling).
  const setClientLimits = (tenantId, clientId, req) => updateClient(tenantId, clientId, (c, t) => {
    const l = clientLimits(t.plan, { max_products: req?.max_products ?? c.limits.max_products, budget_modes: req?.budget_modes ?? c.limits.budget_modes });
    if (l.max_products < c.products.length) throw new TenantError(`client already has ${c.products.length} products`, 409, 'conflict');
    c.limits = l;
    // Tightened budget modes apply to the client's existing products at once (never loosened here).
    for (const slug of c.products) holdToModes(slug, c, l.budget_modes);
  });
  // A product of a client is held to the client's budget modes: a mode outside them becomes $0 mode with
  // zero caps, and plan_limits.budget_modes only ever narrows.
  function holdToModes(slug, c, modes) {
    if (!slugOk(slug)) return;
    const pj = path.join(PRODUCTS, slug, 'product.json');
    const p = readJson(pj, null);
    if (!p || typeof p !== 'object') return;
    p.client = c.id;
    if (!modes.includes(p.budget?.mode)) p.budget = { ...(p.budget ?? {}), mode: 'free', monthly_cap: 0, daily_cap: 0 };
    const had = Array.isArray(p.plan_limits?.budget_modes) ? p.plan_limits.budget_modes : modes;
    p.plan_limits = { ...(p.plan_limits ?? {}), budget_modes: had.filter((m) => modes.includes(m)) };
    fs.writeFileSync(pj, JSON.stringify(p, null, 2));
  }

  // A client product is an agency product (tenants.addProduct: plan cap, billing, domain checks), tagged
  // with the client and held to the client's budget modes (never looser than what tenants.mjs set).
  function addClientProduct(tenantId, clientId, { name, domain } = {}) {
    const t = requireAgency(tenantId, { forWrite: true });
    const a = load(t.id);
    const c = a.clients.find((x) => x.id === clientId);
    if (!c || c.status !== 'active') throw new TenantError('unknown or disabled client', 404, 'not_found');
    if (c.products.length >= c.limits.max_products) throw new TenantError(`this client is limited to ${c.limits.max_products} products`, 403, 'plan_limit');
    const r = tenants.addProduct(t.id, { name, domain });
    holdToModes(r.slug, c, c.limits.budget_modes);
    const fresh = load(t.id);
    const fc = fresh.clients.find((x) => x.id === clientId);
    fc.products = [...fc.products, r.slug];
    save(fresh);
    return { slug: r.slug, domain: r.domain, client: clientPublic(fc) };
  }

  // Key format wyc_<tenant-id>_<client-id>_<secret>: ids find the record, the hash proves the key.
  function authClient(key) {
    const m = /^wyc_(t[0-9a-f]{10})_(c[0-9a-f]{8})_[0-9a-f]{48}$/.exec(String(key ?? '').trim());
    if (!m) return null;
    const t = tenants.getTenant(m[1]);
    if (!t || t.plan !== 'agency' || effectiveStatus(t, now()) === 'canceled') return null;
    const c = (readJson(agencyFile(t.id), null)?.clients ?? []).find((x) => x.id === m[2]);
    if (!c || c.status !== 'active' || !c.key_hash) return null;
    const x = Buffer.from(sha256(key.trim()), 'hex'); const y = Buffer.from(c.key_hash, 'hex');
    return x.length === y.length && crypto.timingSafeEqual(x, y) ? { tenant: t, client: c } : null;
  }

  const ownsProduct = (c, slug) => slugOk(slug) && c.products.includes(slug);

  // Read-only dashboard for one client: its products only, no contacts, no secrets, no other clients.
  function clientDashboard({ tenant, client }) {
    const a = load(tenant.id);
    const products = client.products.map((slug) => {
      const dir = path.join(PRODUCTS, slug);
      const p = readJson(path.join(dir, 'product.json'), {}) ?? {};
      const approvals = readJson(path.join(dir, 'approvals.json'), []) ?? [];
      const tasks = readJson(path.join(dir, 'tasks.json'), []) ?? [];
      const byStatus = {}; for (const x of Array.isArray(tasks) ? tasks : []) byStatus[x.status ?? 'unknown'] = (byStatus[x.status ?? 'unknown'] ?? 0) + 1;
      return {
        slug, name: p.name ?? slug, domain: p.domain ?? null, stage: p.stage ?? null,
        budget: p.budget ? { mode: p.budget.mode, monthly_cap: p.budget.monthly_cap, daily_cap: p.budget.daily_cap } : null,
        tasks: byStatus,
        approvals: (Array.isArray(approvals) ? approvals : []).filter((x) => x.status === 'pending').map((x) => ({ id: x.id, type: x.type ?? null, title: clean(x.title, 200), created_at: x.created_at ?? null, client_can_decide: clientMayDecide(x, 'approve').ok })),
      };
    });
    return { client: { id: client.id, name: client.name, limits: client.limits }, agency: { status: effectiveStatus(tenant, now()) }, branding: brandingView(a), products, read_only: true };
  }

  // A client approve/reject on its own product. Nothing is applied here: the decision is queued and
  // exported to the apply-decisions inbox, so the existing executor applies it with every guard.
  function clientDecision({ tenant, client }, { product, approval_id, decision, note } = {}) {
    if (!['approve', 'reject'].includes(decision)) throw new TenantError('decision must be approve or reject');
    if (!ownsProduct(client, product)) throw new TenantError('not one of your products', 403, 'forbidden');
    if (decision === 'approve' && !canUseProducts(tenant, now())) throw new TenantError(`the agency account is ${effectiveStatus(tenant, now())}; approvals are paused`, 402, 'payment_required');
    const aid = String(approval_id ?? '');
    if (!/^[A-Za-z0-9._:-]{1,80}$/.test(aid)) throw new TenantError('approval_id is invalid');
    const approvals = readJson(path.join(PRODUCTS, product, 'approvals.json'), []) ?? [];
    const item = (Array.isArray(approvals) ? approvals : []).find((x) => String(x.id) === aid);
    if (!item) throw new TenantError('unknown approval', 404, 'not_found');
    if (item.status !== 'pending') throw new TenantError(`approval is ${item.status}, not pending`, 409, 'conflict');
    const may = clientMayDecide(item, decision);
    if (!may.ok) throw new TenantError(may.why, 403, 'owner_only');
    const raw = readJson(decisionsFile(tenant.id), []);
    const queued = (Array.isArray(raw) ? raw : []).filter((x) => x && typeof x === 'object');
    if (queued.some((d) => d.product === product && d.approval_id === aid && !d.exported_at && !d.dropped_at)) throw new TenantError('a decision for this approval is already queued', 409, 'conflict');
    // No activate: go-live stays with the owner. by names the client id only (no personal data).
    const doc = { product, approval_id: aid, decision, note: redactNote(note), at: iso(), by: `client:${tenant.id}:${client.id}` };
    atomic(decisionsFile(tenant.id), [...queued, doc].slice(-2000));
    return doc;
  }

  // Merges every queued, not yet exported client decision into the apply-decisions inbox file and
  // marks them exported. Returns how many were added.
  // Every decision is checked again at export: the client must still be active and own the product,
  // the approval must still be pending and client-decidable, and an approve needs the agency in good
  // standing. Anything that fails is marked dropped and never reaches the executor.
  function stillValid(tenantId, d) {
    const t = tenants.getTenant(tenantId);
    if (!t || t.plan !== 'agency') return 'agency is gone or no longer on the Agency plan';
    if (!['approve', 'reject'].includes(d.decision) || !slugOk(d.product) || 'activate' in d) return 'malformed decision';
    if (d.decision === 'approve' && !canUseProducts(t, now())) return `agency account is ${effectiveStatus(t, now())}`;
    const cid = /^client:(t[0-9a-f]{10}):(c[0-9a-f]{8})$/.exec(String(d.by ?? '')); if (!cid || cid[1] !== tenantId) return 'decision is not from a client of this agency';
    const c = (readJson(agencyFile(tenantId), null)?.clients ?? []).find((x) => x.id === cid[2]);
    if (!c || c.status !== 'active') return 'client is disabled or unknown';
    if (!ownsProduct(c, d.product)) return 'client no longer owns the product';
    const list = readJson(path.join(PRODUCTS, d.product, 'approvals.json'), []);
    const item = (Array.isArray(list) ? list : []).find((x) => String(x?.id) === String(d.approval_id));
    if (!item) return 'approval not found';
    if (item.status !== 'pending') return `approval is ${item.status}`;
    const may = clientMayDecide(item, d.decision);
    return may.ok ? null : may.why;
  }

  function exportDecisions(inboxFile = path.join(ROOT, 'state', 'inbox-decisions.json')) {
    // Never overwrite an inbox that exists but cannot be read: it may hold the owner's own decisions.
    if (fs.existsSync(inboxFile) && readJson(inboxFile, undefined) === undefined) throw new TenantError(`${path.basename(inboxFile)} is not valid JSON; fix it before exporting`, 409, 'conflict');
    const inbox = readJson(inboxFile, null) ?? { decisions: [], requests: [] };
    if (typeof inbox !== 'object' || Array.isArray(inbox)) throw new TenantError('inbox file must be an object', 409, 'conflict');
    inbox.decisions = Array.isArray(inbox.decisions) ? inbox.decisions : [];
    inbox.requests = Array.isArray(inbox.requests) ? inbox.requests : [];
    const seen = new Set(inbox.decisions.map((d) => `${d.product}:${d.approval_id}:${d.at}`));
    let added = 0; let dropped = 0;
    const ids = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((d) => /^t[0-9a-f]{10}$/.test(d) && fs.existsSync(decisionsFile(d))) : [];
    const marks = [];
    for (const id of ids) {
      const q = readJson(decisionsFile(id), []) ?? [];
      let changed = false;
      for (const d of Array.isArray(q) ? q : []) {
        if (!d || typeof d !== 'object' || d.exported_at || d.dropped_at) continue;
        const bad = stillValid(id, d);
        if (bad) { d.dropped_at = iso(); d.dropped_reason = bad; changed = true; dropped++; continue; }
        const k = `${d.product}:${d.approval_id}:${d.at}`;
        // Only the known fields leave the queue (never activate, never anything else a tampered file holds).
        if (!seen.has(k)) { inbox.decisions.push({ product: d.product, approval_id: String(d.approval_id), decision: d.decision, note: redactNote(d.note), at: d.at, by: d.by }); seen.add(k); added++; }
        d.exported_at = iso(); changed = true;
      }
      if (changed) marks.push([id, q]);
    }
    if (added || !fs.existsSync(inboxFile)) atomic(inboxFile, inbox);
    for (const [id, q] of marks) atomic(decisionsFile(id), q);
    return { added, dropped, file: inboxFile };
  }

  // ---- branding ----
  const DEFAULT_BRANDING = { name: null, logo_url: null, primary_color: null, support_email: null, custom_domain: null };
  function brandingView(a) { return { ...DEFAULT_BRANDING, ...(a?.branding ?? {}), white_label: true }; }
  function setBranding(tenantId, input) {
    const t = requireAgency(tenantId, { forWrite: true });
    const a = load(t.id);
    const b = validateBranding(input, a.branding);
    if (b.custom_domain) {
      const taken = fs.existsSync(DIR) && fs.readdirSync(DIR).some((d) => d !== t.id && /^t[0-9a-f]{10}$/.test(d) && readJson(agencyFile(d), null)?.branding?.custom_domain === b.custom_domain);
      if (taken) throw new TenantError('this custom domain is used by another agency', 409, 'exists');
    }
    a.branding = b;
    save(a);
    return brandingView(a);
  }
  function getBranding(tenantId) { const t = requireAgency(tenantId); return brandingView(load(t.id)); }
  // Public lookup for the Command Center on a custom domain: only agencies that may use products.
  function brandingForHost(host) {
    const h = cleanDomain(host);
    if (!h || !fs.existsSync(DIR)) return null;
    for (const d of fs.readdirSync(DIR).filter((x) => /^t[0-9a-f]{10}$/.test(x))) {
      const a = readJson(agencyFile(d), null);
      if (a?.branding?.custom_domain !== h) continue;
      const t = tenants.getTenant(d);
      if (!t || t.plan !== 'agency' || !canUseProducts(t, now())) return null;
      return brandingView(a);
    }
    return null;
  }

  return { dir: DIR, productsDir: PRODUCTS, tenants, createClient, listClients, disableClient, rotateClientKey, setClientLimits, addClientProduct, authClient, clientDashboard, clientDecision, exportDecisions, setBranding, getBranding, brandingForHost, requireAgency };
}

// HTTP routes, framework-free so the edge (or tools/server.mjs) can mount them:
//   handleAgencyRequest({ method, pathname, searchParams, headers, body }, store) -> { status, body } | null
// null means "not an agency route". Agency routes take the tenant API key (Bearer wyk_...), client
// routes the client key (Bearer wyc_...). Keys are never echoed except the one-time new client key.
export function handleAgencyRequest(req, store) {
  const { method = 'GET', pathname = '', headers = {} } = req;
  const sp = req.searchParams ?? new URLSearchParams();
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  if (!pathname.startsWith('/agency') && !pathname.startsWith('/client')) return null;
  const token = (/^Bearer\s+(\S+)$/i.exec(String(headers.authorization ?? '')) ?? [])[1] ?? '';
  const ok = (status, b) => ({ status, body: b });
  try {
    if (pathname === '/agency/branding/public') {
      if (method !== 'GET') return ok(405, { error: 'GET only' });
      const b = store.brandingForHost(sp.get('host') ?? headers.host ?? '');
      return b ? ok(200, { branding: b }) : ok(404, { error: 'no branding for this host' });
    }
    if (pathname.startsWith('/client')) {
      const who = store.authClient(token);
      if (!who) return ok(401, { error: 'missing or invalid client key' });
      if (pathname === '/client' && method === 'GET') return ok(200, store.clientDashboard(who));
      if (pathname === '/client/decisions' && method === 'POST') return ok(202, { queued: store.clientDecision(who, body) });
      return ok(404, { error: 'not found' });
    }
    const t = store.tenants.authTenant(token);
    if (!t) return ok(401, { error: 'missing or invalid API key' });
    if (pathname === '/agency' && method === 'GET') { store.requireAgency(t); return ok(200, { branding: store.getBranding(t.id), clients: store.listClients(t.id) }); }
    if (pathname === '/agency/branding') {
      if (method === 'GET') return ok(200, { branding: store.getBranding(t.id) });
      if (method === 'POST' || method === 'PUT') return ok(200, { branding: store.setBranding(t.id, body) });
      return ok(405, { error: 'GET or POST' });
    }
    if (pathname === '/agency/clients') {
      if (method === 'GET') return ok(200, { clients: store.listClients(t.id) });
      if (method !== 'POST') return ok(405, { error: 'GET or POST' });
      const r = store.createClient(t.id, body);
      return ok(201, { client: r.client, client_key: r.clientKey, note: 'Store this key now: it is shown once and only its hash is kept.' });
    }
    const m = /^\/agency\/clients\/(c[0-9a-f]{8})\/(products|disable|rotate-key|limits)$/.exec(pathname);
    if (m && method === 'POST') {
      if (m[2] === 'products') return ok(201, store.addClientProduct(t.id, m[1], body));
      if (m[2] === 'disable') return ok(200, { client: store.disableClient(t.id, m[1]) });
      if (m[2] === 'limits') return ok(200, { client: store.setClientLimits(t.id, m[1], body) });
      const r = store.rotateClientKey(t.id, m[1]);
      return ok(200, { client: r.client, client_key: r.clientKey });
    }
    return ok(404, { error: 'not found' });
  } catch (e) {
    return e instanceof TenantError ? ok(e.status, { error: e.message, code: e.code }) : ok(500, { error: 'server error' });
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, arg] = process.argv.slice(2);
  const s = createAgencyStore();
  try {
    if (cmd === 'clients') for (const c of s.listClients(arg)) console.log(`${c.id}  ${c.status.padEnd(8)} ${c.products.length}/${c.limits.max_products} product(s)  ${c.limits.budget_modes.join('/')}  ${c.name}`);
    else if (cmd === 'branding') console.log(JSON.stringify(s.getBranding(arg), null, 2));
    else if (cmd === 'export-decisions') { const r = s.exportDecisions(arg ? path.resolve(arg) : undefined); console.log(`${r.added} client decision(s) added, ${r.dropped} dropped, to ${path.relative(repoRoot, r.file)}`); }
    else { console.log('Usage: node tools/cloud/agency.mjs clients <tenant-id> | branding <tenant-id> | export-decisions [inbox-file]'); process.exit(2); }
  } catch (e) { console.error(e.message); process.exit(1); }
}
