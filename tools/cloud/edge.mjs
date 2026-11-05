// Whalyom edge: the public endpoint any website talks to after installing the one-line snippet.
// It is what makes "install and go" work on sites where Whalyom cannot run its own satellite
// (Shopify, Wix, Webflow, Squarespace, static hosts, any CMS):
//   GET  /whalyom.js          the first-party, cookieless tracker (same code as the satellite)
//   GET  /whalyom-boost.js    the on-site booster runtime
//   GET  /boosters?site=&host= the boosters the owner approved for that site (public, cached)
//   POST /collect             tracker beacons; the site key must be this hub's install key
//   GET  /health              liveness
// Site-facing routes for known products on allowed domains (they never onboard a new domain):
//   POST /chat {site,session,message,consent,contact?,page?}  on-site assistant (tools/chat-agent.mjs):
//        answers from verified claims/profile/FAQ/help by retrieval (no LLM key needed); a lead is kept
//        only with explicit consent (true or {given:true}); contact details are never echoed back
//   GET  /bandit.js?site=&host=  (alias /whalyom-bandit.js) A/B bandit client (tools/bandit.mjs)
//   POST /bandit {site,kind,exp,arm,vid,value?}   exposure/conversion beacon from the client
//   POST /bandit/assign {site,exp,vid}  server-side arm for a visitor (records the exposure)
//   POST /bandit/convert {site,exp,vid,value?}  conversion beacon
//   POST /inbound/<slug>  reply webhook (OM_INBOUND_SECRET as Bearer / x-whalyom-secret, or an
//        x-whalyom-signature: sha256=<hmac of the body>); JSON or .eml lands in products/<slug>/inbox/
//        for tools/inbox.mjs (written as _<name> then renamed, so a half-written file is never read)
// Self-serve accounts for other companies (tools/cloud/tenants.mjs, tools/cloud/billing.mjs):
//   POST /signup {name,email,plan}          creates a tenant, returns its API key once (rate limited per IP)
//   GET  /tenant                 (Bearer)   plan, status, products
//   POST /tenant/products {name,domain} (Bearer)  creates a workspace, returns the install snippet (402 if unpaid)
//   POST /billing/checkout {plan}  (Bearer) Stripe Checkout URL for a paid plan
//   POST /billing/webhook        (Stripe-Signature)  subscription events → tenant status
// Real-time feed (tools/cloud/realtime.mjs; tenant key, client key or WHALYOM_OWNER_TOKEN; rate limited per IP):
//   GET  /live/stream[?docs=a,b]  (Bearer or ?token)  Server-Sent Events of the live documents, scoped per tenant
//   GET  /live/<doc>              the current document as JSON
// Agency and white-label mode (tools/cloud/agency.mjs; tenant key wyk_ or client key wyc_; rate limited per IP):
//   GET  /agency   GET|POST /agency/branding   GET /agency/branding/public?host=  (alias GET /branding?host=)
//   GET|POST /agency/clients   POST /agency/clients/<cid>/{products|disable|rotate-key|limits}
//   GET  /client   POST /client/decisions   (queued for the owner's executor; never applied here)
// Voice webhooks (tools/connectors/voice.mjs; X-Twilio-Signature checked against TWILIO_VOICE_WEBHOOK_BASE):
//   POST /voice/<slug>/{inbound|gather|status}   TwiML answers and call outcomes for a known product
// The first beacon from a new domain onboards it (tools/instant-onboard.mjs): workspace, instant audit,
// booster drafts and queued AI onboarding, within limits (allow-list, new sites per day). Events go to
// products/<slug>/edge/events.jsonl; consented lead details to products/<slug>/edge/leads.jsonl;
// tools/sync-sites.mjs turns them into metrics and leads like a satellite's.
//   node tools/cloud/edge.mjs [--port 8787] [--host 0.0.0.0]   (needs OM_INSTALL_KEY; see tools/install-snippet.mjs)
// Run it behind HTTPS (the Docker image, a reverse proxy or a tunnel). It never exposes the dashboard,
// the vault or any write API; it only accepts events, chat questions and signed reply webhooks, and
// serves approved boosters and live (approved) bandit tests.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRACKER_JS, BOOST_JS, liveBoosters, normalizeEvent, rateLimiter, seenCache } from '../satellite/whalyom-satellite.mjs';
import { productForHost, instantOnboard, publicHostName } from '../instant-onboard.mjs';
import { loadEnv, readJson, root as repoRoot } from '../lib/env.mjs';
import { createTenantStore, TenantError } from './tenants.mjs';
import { createCheckoutSession, handleWebhook } from './billing.mjs';
import { createRealtime } from './realtime.mjs';
import { createAgencyStore, handleAgencyRequest } from './agency.mjs';
import { handleVoiceWebhook, publicUrlFor } from '../connectors/voice.mjs';
import { snippet } from '../install-snippet.mjs';
import { chatTurn } from '../chat-agent.mjs';
import { normalizeBeacon, clientSnippet, chooseArm } from '../bandit.mjs';
import { MAX_FILE_BYTES as INBOX_MAX_BYTES } from '../inbox.mjs';

const cleanHost = (h) => String(h ?? '').toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '');
const hostFrom = (req) => { for (const h of [req.headers.origin, req.headers.referer]) { try { if (h) return cleanHost(new URL(String(h)).hostname); } catch { /* try next */ } } return ''; };
// Domain names only: IP literals, localhost and internal names are refused (the onboarding fetches the host).
const validHost = (h) => publicHostName(h);

export function createEdge(options = {}) {
  const ROOT = options.root ?? repoRoot;
  const PRODUCTS = path.join(ROOT, 'products');
  const KEY = String(options.installKey ?? process.env.OM_INSTALL_KEY ?? '');
  if (KEY.length < 16) throw new Error('OM_INSTALL_KEY (16+ characters) is required: run node tools/install-snippet.mjs to create one.');
  const ALLOW = (options.allowDomains ?? String(process.env.OM_EDGE_DOMAINS ?? '').split(',')).map(cleanHost).filter(Boolean);
  const MAX_NEW = Number(options.maxNewSitesPerDay ?? process.env.OM_EDGE_MAX_NEW_SITES ?? 20);
  // The site host comes from the browser's Origin header, which a script can forge, and the install key
  // is public. So with no allow-list, a new domain gets only the free audit and booster drafts; its AI
  // onboarding waits for the owner's approval.
  const onboard = options.onboard ?? ((host) => instantOnboard(host, { edge: true, stack: 'snippet', needsOwner: !ALLOW.length }));
  const collectLimited = rateLimiter(Number(options.collectPerMinute ?? 240), 60000);
  const leadLimited = rateLimiter(Number(options.leadsPer10Min ?? 5), 10 * 60000);
  const dedupe = seenCache(24 * 3600 * 1000, 200000);
  const slugCache = new Map();
  const onboarding = new Map();
  let newToday = { day: '', n: 0 };
  // Tenants: created lazily so a hub that never sees a sign-up never makes tenants/.
  let tenantStore = options.tenants ?? null;
  const tenants = () => (tenantStore ??= createTenantStore({ root: ROOT, productsDir: PRODUCTS }));
  const hasTenants = () => Boolean(tenantStore) || fs.existsSync(path.join(ROOT, 'tenants'));
  const ENV = options.env ?? process.env;
  const signupLimited = rateLimiter(Number(options.signupsPerHour ?? ENV.OM_SIGNUPS_PER_HOUR ?? 5), 3600000);
  const tenantLimited = rateLimiter(Number(options.tenantCallsPerMinute ?? 60), 60000);
  const MAX_SIGNUPS = Number(options.maxSignupsPerDay ?? ENV.OM_MAX_SIGNUPS_PER_DAY ?? 50);
  const SIGNUP_ON = options.signup !== false && String(ENV.OM_SIGNUP_ENABLED ?? '1') !== '0';
  let signupsToday = { day: '', n: 0 };
  // Agency store: lazy like tenants, so a hub without agencies never touches tenants/.
  let agencyStore = options.agency ?? null;
  const agency = () => (agencyStore ??= createAgencyStore({ root: ROOT, tenants: tenants() }));
  // The live feed authenticates tenant keys (wyk_) and, for agencies, client keys (wyc_). A client is its
  // own principal (its own stream limit) and sees only its own products; a canceled agency's clients are
  // refused by agency.authClient.
  const liveAuth = {
    authTenant: (token) => {
      if (/^wyc_/.test(String(token ?? ''))) {
        const who = agency().authClient(token);
        return who ? { id: `${who.tenant.id}:${who.client.id}`, status: who.tenant.status, products: [...who.client.products] } : null;
      }
      return tenants().authTenant(token);
    },
  };
  const live = options.realtime ?? createRealtime({ root: ROOT, env: ENV, ownerToken: options.ownerToken, tenants: () => (hasTenants() ? liveAuth : null) });
  const liveLimited = rateLimiter(Number(options.livePerMinute ?? 120), 60000);
  const voiceLimited = rateLimiter(Number(options.voicePerMinute ?? 120), 60000);

  const slugFor = (host) => { if (slugCache.has(host)) return slugCache.get(host); const s = productForHost(host, PRODUCTS); if (s) slugCache.set(host, s); return s; };
  // A paying (or trial) tenant's domains are accepted even when the owner set an allow-list.
  const allowed = (host) => !ALLOW.length || ALLOW.some((d) => host === d || host.endsWith(`.${d}`)) || (hasTenants() && tenants().ownsDomain(host));
  const failedAt = new Map();
  const startOnboarding = (host) => {
    if (onboarding.has(host)) return onboarding.get(host);
    if (Date.now() - (failedAt.get(host) ?? 0) < 10 * 60000) return Promise.resolve({ error: 'onboarding failed recently; retrying in a few minutes' });
    const day = new Date().toISOString().slice(0, 10);
    if (newToday.day !== day) newToday = { day, n: 0 };
    if (newToday.n >= MAX_NEW) return null;
    newToday.n++;
    const job = Promise.resolve().then(() => onboard(host)).then((r) => { slugCache.delete(host); return r; })
      .catch((e) => { onboarding.delete(host); failedAt.set(host, Date.now()); return { error: String(e.message ?? e) }; });
    onboarding.set(host, job);
    return job;
  };
  const send = (res, code, obj, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers }); res.end(JSON.stringify(obj)); };
  const readBody = (req, limit) => new Promise((resolve, reject) => { const chunks = []; let size = 0; req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); return; } chunks.push(c); }); req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); req.on('error', reject); });
  const CORS = { 'access-control-allow-origin': '*' };
  const TCORS = { ...CORS, 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET, POST' };
  const ACORS = { ...TCORS, 'access-control-allow-methods': 'GET, POST, PUT' };
  const jsonBody = async (req, limit = 4000) => { const raw = await readBody(req, limit); try { const v = JSON.parse(raw || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { throw Object.assign(new Error('bad json'), { status: 400 }); } };
  const bearer = (req) => { const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? '')); return m ? tenants().authTenant(m[1]) : null; };
  const fail = (res, e, headers) => (e instanceof TenantError ? send(res, e.status, { error: e.message, code: e.code }, headers) : send(res, e.status ?? 500, { error: e.status ? e.message : 'server error' }, headers));
  const edgeBase = (req) => String(options.edgeUrl ?? ENV.OM_EDGE_URL ?? `https://${String(req.headers.host ?? 'edge').replace(/[^a-z0-9.:-]/gi, '')}`).replace(/\/$/, '');
  const ip = (req) => (options.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',').at(-1)?.trim() : '') || req.socket.remoteAddress || '';

  // ---- site-facing routes: chat, bandit, inbound replies ----
  // A site route resolves a product that already exists for an allowed domain; it never onboards one.
  const siteSlug = (req, key, host = hostFrom(req)) => {
    if (String(key ?? '') !== KEY) return { code: 403, error: 'unknown site key' };
    if (!validHost(host)) return { code: 400, error: 'no site origin' };
    if (!allowed(host)) return { code: 403, error: 'domain not allowed on this hub' };
    const slug = slugFor(host);
    return slug ? { slug, host } : { code: 404, error: 'unknown site' };
  };
  // Global Privacy Control or Do Not Track from the browser: nothing about the visitor is recorded.
  const optedOut = (req) => String(req.headers['sec-gpc'] ?? '') === '1' || String(req.headers.dnt ?? '') === '1';
  const SCORS = { ...CORS, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST' };
  const preflight = (res) => { res.writeHead(204, { ...SCORS, 'access-control-max-age': '86400' }); return res.end(); };
  const banditLimited = rateLimiter(Number(options.banditPerMinute ?? 240), 60000);
  const banditSeen = seenCache(24 * 3600 * 1000, 200000);
  const chatLimited = rateLimiter(Number(options.chatPerMinute ?? ENV.OM_CHAT_PER_MINUTE ?? 12), 60000);
  const chatSessionLimited = rateLimiter(Number(options.chatPerSessionHour ?? 40), 3600000);
  const chatGenerate = typeof options.chatGenerate === 'function' ? options.chatGenerate : null;
  const inboundLimited = rateLimiter(Number(options.inboundPerMinute ?? 60), 60000);
  const INBOUND_SECRET = String(options.inboundSecret ?? ENV.OM_INBOUND_SECRET ?? '');
  const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;
  const VID_RE = /^[A-Za-z0-9_-]{8,80}$/;
  const liveFor = (slug) => { const j = readJson(path.join(PRODUCTS, slug, 'experiments', 'bandit-live.json'), null); return j && Array.isArray(j.experiments) ? j : { experiments: [] }; };
  // Late conversions of a test that already stopped still count if the ledger knows the test.
  const ledgerKnows = (slug, id) => { const l = readJson(path.join(PRODUCTS, slug, 'experiments', 'bandits.json'), null); return (Array.isArray(l?.experiments) ? l.experiments : []).some((x) => x?.id === id && x.status && x.status !== 'draft'); };
  const sameSecret = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

  const server = http.createServer(async (req, res) => {
    let url; try { url = new URL(req.url, 'http://edge'); } catch { return send(res, 400, { error: 'bad url' }); }
    try {
      if (url.pathname === '/health') return send(res, 200, { ok: true, kind: 'whalyom-edge', sites: fs.existsSync(PRODUCTS) ? fs.readdirSync(PRODUCTS).filter((s) => !s.startsWith('_')).length : 0 });
      if (url.pathname.startsWith('/live/')) {
        if (req.method !== 'OPTIONS' && liveLimited(ip(req))) return send(res, 429, { error: 'slow down' }, { ...CORS, 'retry-after': '60' });
        if (live.handle(req, res, url)) return;
      }
      if (url.pathname === '/whalyom.js' || url.pathname === '/whalyom-boost.js') {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff', ...CORS });
        return res.end(url.pathname === '/whalyom.js' ? TRACKER_JS : BOOST_JS);
      }
      if (url.pathname === '/boosters') {
        if (url.searchParams.get('site') !== KEY) return send(res, 200, { items: [] }, CORS);
        const host = cleanHost(url.searchParams.get('host'));
        const slug = validHost(host) ? slugFor(host) : null;
        const items = slug ? liveBoosters(readJson(path.join(PRODUCTS, slug, 'boosters.json'), [])) : [];
        return send(res, 200, { items }, { ...CORS, 'cache-control': 'public, max-age=120' });
      }
      if (url.pathname === '/collect') {
        if (req.method === 'OPTIONS') { res.writeHead(204, { ...CORS, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' }); return res.end(); }
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' }, CORS);
        if (collectLimited(ip(req))) return send(res, 429, { error: 'slow down' }, { ...CORS, 'retry-after': '60' });
        const raw = await readBody(req, 8000);
        let ev; try { ev = JSON.parse(raw); } catch { return send(res, 400, { error: 'bad json' }, CORS); }
        if (String(ev?.site ?? '') !== KEY) return send(res, 403, { error: 'unknown site key' }, CORS);
        const host = hostFrom(req);
        if (!validHost(host)) return send(res, 400, { error: 'no site origin' }, CORS);
        if (!allowed(host)) return send(res, 403, { error: 'domain not allowed on this hub' }, CORS);
        const r = normalizeEvent(ev);
        if (r.error) return send(res, 400, { error: r.error }, CORS);
        if (r.drop) { res.writeHead(204, CORS); return res.end(); }
        const clean = r.event;
        delete clean.site;
        if (clean.eid && dedupe(clean.eid)) { res.writeHead(204, CORS); return res.end(); }
        if ((clean.type === 'lead' || clean.type === 'signup') && leadLimited(ip(req))) return send(res, 429, { error: 'too many leads' }, { ...CORS, 'retry-after': '600' });
        let slug = slugFor(host);
        if (!slug) {
          const job = startOnboarding(host);
          if (!job) return send(res, 429, { error: 'new-site limit reached for today' }, CORS);
          const done = await job;
          slug = done?.slug ?? slugFor(host);
          if (!slug) return send(res, 503, { error: 'onboarding failed', detail: done?.error }, CORS);
        }
        const dir = path.join(PRODUCTS, slug, 'edge');
        fs.mkdirSync(dir, { recursive: true });
        if (clean.contact) {
          const lead_id = clean.eid ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
          fs.appendFileSync(path.join(dir, 'leads.jsonl'), JSON.stringify({ at: clean.at, lead_id, type: clean.type, path: clean.path, form: clean.form ?? '', utm: clean.utm, consent: true, contact: clean.contact, ...(clean.bot_hint ? { bot_hint: clean.bot_hint } : {}) }) + '\n', { mode: 0o600 });
          delete clean.contact; delete clean.consent; clean.lead_id = lead_id; clean.has_contact = true;
        }
        fs.appendFileSync(path.join(dir, 'events.jsonl'), JSON.stringify(clean) + '\n');
        res.writeHead(204, CORS); return res.end();
      }
      if (url.pathname === '/bandit.js' || url.pathname === '/whalyom-bandit.js') {
        const qhost = cleanHost(url.searchParams.get('host'));
        const s = siteSlug(req, url.searchParams.get('site'), qhost || hostFrom(req));
        // Unknown key, site or domain: an inert client (no endpoint, no experiments), never an error page.
        const live = s.slug ? liveFor(s.slug) : { experiments: [] };
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': qhost ? 'public, max-age=120' : 'private, max-age=60', 'x-content-type-options': 'nosniff', ...CORS });
        return res.end(clientSnippet(live, { endpoint: s.slug ? edgeBase(req) : '', site: s.slug ? KEY : '' }));
      }
      if (url.pathname === '/bandit' || url.pathname === '/bandit/assign' || url.pathname === '/bandit/convert') {
        if (req.method === 'OPTIONS') return preflight(res);
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' }, SCORS);
        if (banditLimited(ip(req))) return send(res, 429, { error: 'slow down' }, { ...SCORS, 'retry-after': '60' });
        const b = await jsonBody(req, 4000);
        const s = siteSlug(req, b.site);
        if (s.error) return send(res, s.code, { error: s.error }, SCORS);
        const assign = url.pathname === '/bandit/assign';
        const kind = assign ? 'exposure' : url.pathname === '/bandit/convert' ? 'conversion' : b.kind;
        const live = liveFor(s.slug);
        const x = live.experiments.find((e) => e && e.id === String(b.exp ?? ''));
        let arm = b.arm;
        if (assign) {
          if (!x) return send(res, 404, { error: 'no live experiment with that id' }, SCORS);
          if (!VID_RE.test(String(b.vid ?? ''))) return send(res, 400, { error: 'bad visitor id' }, SCORS);
          // Opted-out visitors get the original page (the first arm) and nothing is recorded.
          arm = optedOut(req) ? x.arms?.[0]?.id : chooseArm(x, String(b.vid), x.weights ?? {});
        }
        const r = normalizeBeacon({ kind, exp: b.exp, arm, vid: b.vid, value: b.value });
        if (r.error) return send(res, 400, { error: r.error }, SCORS);
        const ev = r.event;
        if (ev.kind === 'exposure' && (!x || !(x.arms ?? []).some((a) => a?.id === ev.arm))) return send(res, 400, { error: 'unknown experiment or arm' }, SCORS);
        const known = ev.kind === 'exposure' || (ev.exp ? Boolean(x) || ledgerKnows(s.slug, ev.exp) : live.experiments.length > 0);
        // One line per visitor, experiment and kind a day (the tally counts unique visitors anyway).
        if (known && !optedOut(req) && !banditSeen([s.slug, ev.kind, ev.exp ?? '', ev.vid].join('|'))) {
          const dir = path.join(PRODUCTS, s.slug, 'experiments');
          fs.mkdirSync(dir, { recursive: true });
          fs.appendFileSync(path.join(dir, 'bandit-events.jsonl'), JSON.stringify(ev) + '\n');
        }
        if (assign) return send(res, 200, { exp: x.id, arm, variant: (x.arms ?? []).find((a) => a?.id === arm)?.variant ?? null }, SCORS);
        res.writeHead(204, SCORS); return res.end();
      }
      if (url.pathname === '/chat') {
        if (req.method === 'OPTIONS') return preflight(res);
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' }, SCORS);
        if (chatLimited(ip(req))) return send(res, 429, { error: 'slow down' }, { ...SCORS, 'retry-after': '60' });
        const b = await jsonBody(req, 8000);
        const s = siteSlug(req, b.site ?? url.searchParams.get('site'));
        if (s.error) return send(res, s.code, { error: s.error }, SCORS);
        const message = str(b.message, 4001).trim();
        if (!message) return send(res, 400, { error: 'message required' }, SCORS);
        if (message.length > 2000) return send(res, 400, { error: 'message too long (2000 characters at most)' }, SCORS);
        const session = /^[A-Za-z0-9_-]{8,80}$/.test(String(b.session ?? '')) ? String(b.session) : '';
        if (session && chatSessionLimited(s.slug + ':' + session)) return send(res, 429, { error: 'too many messages in this conversation' }, { ...SCORS, 'retry-after': '600' });
        // Consent is exactly true or {given:true} (the widget's checkbox); anything else is no consent.
        const consent = b.consent === true ? true : b.consent && typeof b.consent === 'object' && b.consent.given === true ? { given: true, ...(str(b.consent.text, 300) ? { text: str(b.consent.text, 300) } : {}) } : false;
        const c = b.contact && typeof b.contact === 'object' && !Array.isArray(b.contact) ? b.contact : null;
        const contact = c ? { ...(str(c.email, 200) ? { email: str(c.email, 200) } : {}), ...(str(c.phone, 40) ? { phone: str(c.phone, 40) } : {}), ...(str(c.name, 80) ? { name: str(c.name, 80) } : {}) } : null;
        const history = (Array.isArray(b.history) ? b.history : []).slice(-6).map((h) => ({ role: h?.role === 'assistant' ? 'assistant' : 'user', text: str(h?.text, 500) }));
        let r;
        try { r = await chatTurn(s.slug, { session: session || undefined, message, consent, contact, history, page: str(b.page, 300), generate: chatGenerate, baseDir: ROOT }); } catch { return send(res, 503, { error: 'chat is not available for this site' }, SCORS); }
        // Never echo the lead or its contact details; sources carry titles only.
        return send(res, 200, {
          session: r.session, answer: String(r.answer ?? ''), mode: r.mode,
          sources: (r.sources ?? []).map((x) => ({ n: x.n, title: x.title, source: x.source })),
          handoff: r.handoff ? { reason: r.handoff.reason, priority: r.handoff.priority, to: r.handoff.to } : null,
          consent_needed: Boolean(r.consent_needed), lead_saved: Boolean(r.lead),
        }, SCORS);
      }
      const inbound = /^\/inbound\/([^/]+)\/?$/.exec(url.pathname);
      if (inbound) {
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
        if (INBOUND_SECRET.length < 16) return send(res, 503, { error: 'inbound webhook is not configured (set OM_INBOUND_SECRET, 16+ characters)' });
        if (inboundLimited(ip(req))) return send(res, 429, { error: 'slow down' }, { 'retry-after': '60' });
        const slug = inbound[1];
        const pdir = path.join(PRODUCTS, slug);
        const product = SLUG_RE.test(slug) ? readJson(path.join(pdir, 'product.json'), null) : null;
        if (!product) return send(res, 404, { error: 'unknown product' });
        if (ALLOW.length) { const d = cleanHost(String(product.domain ?? '').replace(/^https?:\/\//, '').replace(/\/.*$/, '')); if (!validHost(d) || !allowed(d)) return send(res, 403, { error: 'domain not allowed on this hub' }); }
        const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ''));
        const token = m?.[1] ?? req.headers['x-whalyom-secret'];
        const tokenOk = typeof token === 'string' && sameSecret(token, INBOUND_SECRET);
        const sig = String(req.headers['x-whalyom-signature'] ?? '');
        if (!tokenOk && !/^sha256=[0-9a-f]{64}$/i.test(sig)) return send(res, 401, { error: 'missing or invalid inbound secret' });
        const raw = await readBody(req, INBOX_MAX_BYTES);
        if (!tokenOk && !sameSecret(sig.slice(7).toLowerCase(), crypto.createHmac('sha256', INBOUND_SECRET).update(raw).digest('hex'))) return send(res, 401, { error: 'bad signature' });
        if (!raw.trim()) return send(res, 400, { error: 'empty body' });
        const ctype = String(req.headers['content-type'] ?? '').toLowerCase();
        let ext;
        if (/json/.test(ctype)) { try { const j = JSON.parse(raw); if (!j || typeof j !== 'object') throw new Error('not an object'); } catch { return send(res, 400, { error: 'bad json' }); } ext = 'json'; }
        else if (/message\/rfc822|text\/plain/.test(ctype)) ext = 'eml';
        else return send(res, 415, { error: 'send application/json or message/rfc822' });
        const dir = path.join(pdir, 'inbox');
        fs.mkdirSync(dir, { recursive: true });
        // Raw replies hold addresses: they stay in the product's inbox/ (mode 0600), never in state/ or logs.
        const name = new Date().toISOString().replace(/[-:.]/g, '') + '-' + crypto.randomBytes(4).toString('hex') + '.' + ext;
        fs.writeFileSync(path.join(dir, '_' + name), raw, { mode: 0o600 });
        fs.renameSync(path.join(dir, '_' + name), path.join(dir, name));
        return send(res, 202, { ok: true, file: 'inbox/' + name });
      }
      if (url.pathname === '/signup' || url.pathname === '/tenant' || url.pathname === '/tenant/products' || url.pathname === '/billing/checkout') {
        if (req.method === 'OPTIONS') { res.writeHead(204, { ...TCORS, 'access-control-max-age': '86400' }); return res.end(); }
        try {
          if (url.pathname === '/signup') {
            if (req.method !== 'POST') return send(res, 405, { error: 'POST only' }, TCORS);
            if (!SIGNUP_ON) return send(res, 403, { error: 'sign-up is closed on this hub' }, TCORS);
            if (signupLimited(ip(req))) return send(res, 429, { error: 'too many sign-ups from this address' }, { ...TCORS, 'retry-after': '3600' });
            const day = new Date().toISOString().slice(0, 10);
            if (signupsToday.day !== day) signupsToday = { day, n: 0 };
            if (signupsToday.n >= MAX_SIGNUPS) return send(res, 429, { error: 'sign-up limit reached for today' }, TCORS);
            const b = await jsonBody(req);
            const { tenant, apiKey } = tenants().createTenant({ name: b.name, email: b.email, plan: b.plan ?? 'free' });
            signupsToday.n++;
            return send(res, 201, { tenant, api_key: apiKey, note: 'Store this key now: it is shown once and only its hash is kept.' }, TCORS);
          }
          if (tenantLimited(ip(req))) return send(res, 429, { error: 'slow down' }, { ...TCORS, 'retry-after': '60' });
          const t = bearer(req);
          if (!t) return send(res, 401, { error: 'missing or invalid API key' }, { ...TCORS, 'www-authenticate': 'Bearer' });
          if (url.pathname === '/tenant') {
            if (req.method !== 'GET') return send(res, 405, { error: 'GET only' }, TCORS);
            return send(res, 200, { tenant: tenants().publicView(t) }, TCORS);
          }
          if (req.method !== 'POST') return send(res, 405, { error: 'POST only' }, TCORS);
          const b = await jsonBody(req);
          if (url.pathname === '/tenant/products') {
            const r = tenants().addProduct(t.id, { name: b.name, domain: b.domain });
            return send(res, 201, { slug: r.slug, domain: r.domain, snippet: snippet(edgeBase(req), KEY), tenant: r.tenant }, TCORS);
          }
          const session = await createCheckoutSession(t, String(b.plan ?? ''), { fetch: options.fetch, env: ENV });
          return send(res, 200, { url: session.url, id: session.id }, TCORS);
        } catch (e) { return fail(res, e, TCORS); }
      }
      if (url.pathname === '/billing/webhook') {
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
        const secret = String(options.stripeWebhookSecret ?? ENV.STRIPE_WEBHOOK_SECRET ?? '');
        if (!secret) return send(res, 503, { error: 'billing webhook is not configured' });
        const raw = await readBody(req, 512 * 1024);
        try { return send(res, 200, handleWebhook(raw, req.headers['stripe-signature'], secret, { store: tenants(), env: ENV })); } catch (e) { return fail(res, e); }
      }
      const voiceRoute = /^\/voice\/([^/]+)\/(inbound|gather|status)\/?$/i.exec(url.pathname);
      if (voiceRoute) {
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
        const vbase = String(ENV.TWILIO_VOICE_WEBHOOK_BASE ?? '');
        if (!ENV.TWILIO_AUTH_TOKEN || !/^https:\/\//i.test(vbase)) return send(res, 503, { error: 'voice webhook is not configured (TWILIO_AUTH_TOKEN and an https TWILIO_VOICE_WEBHOOK_BASE)' });
        if (voiceLimited(ip(req))) return send(res, 429, { error: 'slow down' }, { 'retry-after': '60' });
        const slug = voiceRoute[1];
        const pdir = path.join(PRODUCTS, slug);
        const product = SLUG_RE.test(slug) ? readJson(path.join(pdir, 'product.json'), null) : null;
        if (!product) return send(res, 404, { error: 'unknown product' });
        if (ALLOW.length) { const d = cleanHost(String(product.domain ?? '').replace(/^https?:\/\//, '').replace(/\/.*$/, '')); if (!validHost(d) || !allowed(d)) return send(res, 403, { error: 'domain not allowed on this hub' }); }
        const raw = await readBody(req, 64 * 1024);
        // The signature covers the public URL Twilio called, rebuilt on the configured origin (never the Host header).
        const publicUrl = publicUrlFor(ENV, req.url);
        if (!publicUrl) return send(res, 503, { error: 'voice webhook is not configured' });
        const r = handleVoiceWebhook({ url: publicUrl, body: raw, headers: req.headers }, { dir: pdir, env: ENV, now: new Date().toISOString() });
        res.writeHead(r.status, { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...(r.headers ?? {}) });
        return res.end(r.body ?? '');
      }
      if (url.pathname === '/branding' || url.pathname.startsWith('/agency') || url.pathname.startsWith('/client')) {
        if (req.method === 'OPTIONS') { res.writeHead(204, { ...ACORS, 'access-control-max-age': '86400' }); return res.end(); }
        try {
          if (tenantLimited(ip(req))) return send(res, 429, { error: 'slow down' }, { ...ACORS, 'retry-after': '60' });
          const pathname = url.pathname === '/branding' ? '/agency/branding/public' : url.pathname;
          const body = req.method === 'POST' || req.method === 'PUT' ? await jsonBody(req, 8000) : undefined;
          const r = handleAgencyRequest({ method: req.method, pathname, searchParams: url.searchParams, headers: req.headers, body }, agency());
          if (r) return send(res, r.status, r.body, r.status === 401 ? { ...ACORS, 'www-authenticate': 'Bearer' } : ACORS);
        } catch (e) { return fail(res, e, ACORS); }
      }
      if (url.pathname === '/billing/done') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        return res.end(`<!doctype html><meta charset="utf-8"><title>Whalyom billing</title><p>${url.searchParams.get('status') === 'success' ? 'Thank you. Your plan is active as soon as Stripe confirms the payment.' : 'Checkout was not completed. You can start it again from your account.'}</p>`);
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) { return send(res, e.status ?? 500, { error: e.status ? e.message : 'server error' }, CORS); }
  });
  server.on('close', () => live.close());
  return { server, onboarding, live };
}

// Reads an edge site's events and leads the way tools/sync-sites.mjs reads a satellite.
export function edgeSource(productDir) {
  const lines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
  const after = (list, since) => { const xs = list.filter((x) => !since || x.at > since); return { items: xs, until: xs.length ? xs.at(-1).at : since }; };
  return {
    health: async () => ({ version: 'edge', kind: 'edge', writes: false, events: lines(path.join(productDir, 'edge', 'events.jsonl')).length }),
    events: async (since = '') => { const r = after(lines(path.join(productDir, 'edge', 'events.jsonl')), since); return { events: r.items, until: r.until }; },
    leads: async (since = '') => { const r = after(lines(path.join(productDir, 'edge', 'leads.jsonl')), since); return { leads: r.items, until: r.until }; },
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  loadEnv();
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i > -1 ? args[i + 1] : d; };
  const port = Number(opt('port', process.env.OM_EDGE_PORT ?? 8787));
  const host = opt('host', process.env.OM_EDGE_HOST ?? '0.0.0.0');
  const { server } = createEdge({ trustProxy: args.includes('--trust-proxy') || process.env.OM_EDGE_TRUST_PROXY === '1' });
  server.on('error', (e) => { console.error(`edge cannot listen on ${host}:${port}: ${e.code ?? e.message}`); process.exit(3); });
  process.on('uncaughtException', (e) => console.error(`edge error (kept running): ${e.stack ?? e}`));
  server.listen(port, host, () => console.log(`Whalyom edge on http://${host}:${port} (put HTTPS in front of it)`));
}
