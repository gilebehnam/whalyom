// Unified social inbox: new comments and direct messages from Instagram and Facebook (and any platform
// through drop files) in one place, sorted, answered as drafts, and fed into the funnel.
//   Pulls (only when the keys are set; read-only GET calls, injectable fetch):
//     Instagram  GET /{ig-user-id}/media → GET /{media-id}/comments           INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_USER_ID
//                GET /{page-id}/conversations?platform=instagram (DMs)        + FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN
//     Facebook   GET /{page-id}/feed?fields=comments{...}                       FACEBOOK_PAGE_ID, FACEBOOK_PAGE_ACCESS_TOKEN
//                GET /{page-id}/conversations?platform=messenger (DMs)
//     TikTok and others have no comment/DM read API for ordinary apps: an n8n flow or export drops
//     JSON into products/<slug>/social-inbox/drop/ ({platform, kind, id, text, username, user_id,
//     at, parent_id}; one object, an array or {messages: [...]}); processed files move to drop/done/.
//   Files (all inside products/<slug>/; usernames never leave this folder):
//     social-inbox/messages.json     ledger (single writer: this tool), one row per message with its
//                                    class, username, user hash, text, lead and draft approval id
//     social-inbox/state.json        last pull time per platform
//     outbox/social-replies/<id>.md  reply drafts (front matter: channel, reply_to, reply_kind, recipient,
//                                    received_at) for the instagram/facebook connectors
//     runs/SOCIAL-<stamp>.json       for tools/apply-results.mjs: "reply" approvals and owner alerts.
//                                    Titles and alerts carry no usernames (they reach the dashboard).
//     leads/social-inbox.json        one lead row per person who showed a buying signal
//                                    (lead_id = hash, channel = platform; no username)
//     funnel/updates/social-<id>.json stage change for tools/funnel.mjs: engaged (interest) or
//                                    qualified (asks to buy, order, book or for the price)
//   Classes, first match wins: spam → complaint → lead → question → other. Spam gets no reply;
//   complaints also raise an owner alert; leads move the funnel. Drafts make no claims (they point to
//   the product's site or ask for a direct message) and nothing is sent: every reply waits for the
//   owner's approval and the executor. Paused product, autonomy.kill or OM_KILL=1 → nothing is pulled
//   or drafted. Messages older than social_inbox.max_age_days (default 7) are stored, not answered.
//   Our own comments and messages are skipped. At most social_inbox.max_drafts (default 25) a run.
//   Every person gets a contact id (SOC-<platform>-<hash>, the same id a lead gets); one listed in
//   products/<slug>/suppression.json gets no draft and no funnel move, and every reply approval carries
//   the id as `contact` so the connectors re-check suppression before sending. Ids from drop files that
//   are not plain [A-Za-z0-9_:.-] are refused (they go into draft front matter).
// Usage: node tools/social-inbox.mjs <slug> [--now ISO] [--dry-run] [--no-pull]
//        node tools/social-inbox.mjs --all
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadEnv, readJson, writeJson, root as repoRoot } from './lib/env.mjs';
import { request, redact as redactSecrets, missingKeys } from './connectors/_http.mjs';
import { apiBase } from './connectors/meta-ads.mjs';

export const CLASSES = ['spam', 'complaint', 'lead', 'question', 'other'];
export const MAX_LEDGER = 5000;
const str = (v, max = 4000) => (v == null ? '' : String(v)).slice(0, max);
const isoOk = (s) => typeof s === 'string' && s !== '' && !Number.isNaN(Date.parse(s));
const toIso = (s, fallback) => (isoOk(String(s ?? '')) ? new Date(Date.parse(String(s))).toISOString() : fallback);
export const hash = (s, n = 16) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, n);
const PLATFORM = { ig: 'instagram', instagram: 'instagram', fb: 'facebook', facebook: 'facebook', messenger: 'facebook', tiktok: 'tiktok', tt: 'tiktok', x: 'x', twitter: 'x', linkedin: 'linkedin', youtube: 'youtube', threads: 'threads' };
export const platformOf = (p) => PLATFORM[String(p ?? '').toLowerCase()] ?? (str(p, 30).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'other');
const SHORT = { instagram: 'ig', facebook: 'fb', tiktok: 'tt' };

// ── classification ──
const RULES = {
  spam: [
    /\b(follow\s*(for|4)\s*follow|f4f|l4l|like\s*for\s*like|check\s+(out\s+)?my\s+(page|profile|bio)|dm\s+me\s+to\s+(earn|collab)|promote\s+(it|your\s+page)|send\s+(pic|it)\s+to\s+@|crypto|bitcoin|forex|investment\s+plan|earn\s+\$?\d+|giveaway\s+winner|onlyfans|free\s+followers|cash\s*app|telegram\s*@)/i,
    /(فالو\s*=\s*فالو|فالوور\s*رایگان|کسب\s*درآمد\s*دلاری|سرمایه\s*گذاری\s*تضمینی)/,
  ],
  complaint: [
    /\b(refund|money\s+back|broken|damaged|doesn'?t\s+work|does\s+not\s+work|not\s+working|stopped\s+working|scam|fraud|worst|terrible|awful|horrible|disappointed|disappointing|never\s+(arrived|received|came)|still\s+(waiting|haven'?t)|no\s+one\s+(answers|replies|responds)|rude|complain|unacceptable|wrong\s+(item|size|order)|late\s+delivery|charged\s+twice|cancel\s+my)/i,
    /(مرجوع|پس\s*بدید|پول(م|مو)\s*(رو\s*)?(پس|برگردون)|خراب|کلاهبرداری|افتضاح|بدترین|ناراضی|هنوز\s*نرسیده|نرسید|جواب\s*نمی\s*دید|شکایت)/,
  ],
  leadStrong: [
    /\b(i\s+(want|'?d\s+like|would\s+like)\s+to\s+(buy|order|book|purchase|sign\s+up)|how\s+(do|can)\s+i\s+(buy|order|book|purchase|sign\s+up|get\s+one)|where\s+(can|do)\s+i\s+(buy|order|get)|how\s+much|what'?s\s+the\s+price|price\s*\??$|pricing|cost\s*\?|take\s+my\s+money|in\s+stock|available\s+in|ship(ping)?\s+to|do\s+you\s+deliver|can\s+i\s+(pre-?)?order|book\s+(a|an)\s+(call|demo|appointment)|quote)/i,
    /(قیمت|چند(ه|\s*هست|\s*تومن)|چطور\s*(بخرم|سفارش)|خرید|سفارش|موجود(ه|ی)|ارسال\s*به|نوبت|رزرو)/,
  ],
  leadWeak: [
    /\b(interested|i\s+need\s+(this|one|it)|want\s+(this|one)|love\s+(this|it).{0,20}(where|how)|link\s*\?|more\s+info|tell\s+me\s+more|dm(ed)?\s+(you|me)\s+(the\s+)?(price|details|info)|demo|trial)/i,
    /(علاقه\s*مند|اطلاعات\s*بیشتر|لینک|میخوام|می\s*خوام)/,
  ],
  question: [/\?|？|؟/, /^\s*(how|what|when|where|why|who|which|can|could|does|do|is|are|will|would)\b/i, /^\s*(چطور|چگونه|چرا|کجا|کی|چه|آیا)/],
};
const any = (list, t) => list.some((re) => re.test(t));

// {class, signal: 'strong'|'weak'|null}. Pure.
export function classifyMessage(text) {
  const t = str(text, 4000).trim();
  if (!t) return { class: 'other', signal: null };
  const links = (t.match(/https?:\/\/|www\./gi) ?? []).length;
  if (any(RULES.spam, t) || links >= 2) return { class: 'spam', signal: null };
  if (any(RULES.complaint, t)) return { class: 'complaint', signal: null };
  if (any(RULES.leadStrong, t)) return { class: 'lead', signal: 'strong' };
  if (any(RULES.leadWeak, t)) return { class: 'lead', signal: 'weak' };
  if (any(RULES.question, t)) return { class: 'question', signal: null };
  return { class: 'other', signal: null };
}

const isPersian = (t) => /[؀-ۿ]/.test(String(t ?? ''));
const siteOf = (product = {}) => { const d = str(product.domain ?? product.url ?? '', 200).trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''); return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d) ? d : ''; };

// The reply text for a class, or null (spam, other). No claims: only a pointer to the site or a DM.
export function draftReply(msg, cls, product = {}) {
  const site = siteOf(product);
  const fa = isPersian(msg.text);
  const dm = msg.kind === 'dm';
  if (cls === 'question') return fa
    ? (site ? `ممنون از سؤالتان! جزئیات در ${site} هست و همین‌جا هم خوشحال می‌شویم کمک کنیم.` : 'ممنون از سؤالتان! همین‌جا خوشحال می‌شویم کمک کنیم؛ کمی بیشتر توضیح می‌دهید؟')
    : (site ? `Thanks for the question! You'll find the details at ${site}, and we're happy to help here too.` : "Thanks for the question! We're happy to help here. Could you tell us a little more?");
  if (cls === 'lead') return fa
    ? (site ? `ممنون از توجه‌تان! برای شروع، همه‌چیز در ${site} هست. اگر بخواهید اطلاعات بیشتری هم برایتان می‌فرستیم.` : 'ممنون از توجه‌تان! اگر بخواهید اطلاعات بیشتری برایتان می‌فرستیم.')
    : (site ? `Thanks for your interest! Everything you need to get started is at ${site}. Want us to send you more details?` : 'Thanks for your interest! Want us to send you more details?');
  if (cls === 'complaint') return fa
    ? (dm ? 'از این بابت متأسفیم. لطفاً جزئیات را همین‌جا بنویسید تا بررسی کنیم.' : 'از این بابت متأسفیم. لطفاً جزئیات را در پیام مستقیم برایمان بفرستید تا بررسی کنیم.')
    : (dm ? "We're sorry about this. Please share the details here so we can look into it." : "We're sorry about this. Please send us a direct message with the details so we can look into it.");
  return null;
}

// ── normalising ──
// One message: {id, platform, kind, native_id, parent_id, text, username, user_id, at}
export function normalizeMessage(x, { now = new Date().toISOString(), platform: p0 = null } = {}) {
  if (!x || typeof x !== 'object') return null;
  const platform = platformOf(x.platform ?? p0);
  const kind = ['dm', 'message', 'direct'].includes(String(x.kind ?? x.type ?? '').toLowerCase()) ? 'dm' : 'comment';
  // Ids go into reply-draft front matter, so anything but [A-Za-z0-9_:.-] is refused (a drop file must
  // not be able to inject reply_to / recipient lines or point a reply at someone else).
  const idOk = (v) => { const s = str(v ?? '', 120).trim(); return /^[\w:.-]*$/.test(s) ? s : null; };
  const native = idOk(x.native_id ?? x.id);
  const parent = idOk(x.parent_id ?? x.media_id ?? x.post_id);
  const userId = idOk(x.user_id ?? x.from?.id);
  const text = str(x.text ?? x.message ?? x.body ?? '', 4000).trim();
  if (!native || parent === null || userId === null || !text) return null;
  return {
    id: `${platform}:${kind}:${native}`, platform, kind, native_id: native, parent_id: parent,
    text, username: str(x.username ?? x.from?.username ?? x.from?.name ?? '', 100).replace(/[\r\n]+/g, ' '), user_id: userId,
    at: toIso(x.at ?? x.timestamp ?? x.created_time, now),
  };
}

// ── pulls (read-only) ──
const bearer = (token) => ({ authorization: `Bearer ${token}` });
async function getJson(ctx, url, token) {
  const r = await request(ctx, { url, method: 'GET', headers: bearer(token) });
  if (!r.ok || r.data?.error) throw new Error(`GET ${url.replace(/\?.*$/, '').split('/').slice(-2).join('/')}: ${redactSecrets(r.data?.error?.message ?? `HTTP ${r.status}`, ctx.env).slice(0, 160)}`);
  return r.data ?? {};
}
const igBase = (env) => { const h = String(env.INSTAGRAM_API_BASE ?? '').replace(/\/$/, ''); const ver = apiBase(env).split('/').pop(); return /^https:\/\/graph\.(facebook|instagram)\.com$/.test(h) ? `${h}/${ver}` : apiBase(env); };

export async function pullInstagram(ctx, { media = 10, dms = true } = {}) {
  const env = ctx.env; const out = []; const errors = [];
  const ig = env.INSTAGRAM_USER_ID; const tok = env.INSTAGRAM_ACCESS_TOKEN; const base = igBase(env);
  const list = await getJson(ctx, `${base}/${ig}/media?fields=id,timestamp&limit=${media}`, tok);
  for (const m of list.data ?? []) {
    try {
      const c = await getJson(ctx, `${base}/${m.id}/comments?fields=id,text,timestamp,username,from&limit=50`, tok);
      for (const x of c.data ?? []) {
        if (x.from?.id === ig || (env.INSTAGRAM_USERNAME && x.username === env.INSTAGRAM_USERNAME)) continue;
        out.push({ platform: 'instagram', kind: 'comment', id: x.id, text: x.text, username: x.username ?? x.from?.username, user_id: x.from?.id, at: x.timestamp, parent_id: m.id });
      }
    } catch (e) { errors.push(e.message); }
  }
  // Instagram DMs go through the linked Page (Facebook Login); needs instagram_manage_messages.
  if (dms && env.FACEBOOK_PAGE_ID && env.FACEBOOK_PAGE_ACCESS_TOKEN) {
    try { out.push(...(await conversations(ctx, 'instagram', ig))); } catch (e) { errors.push(e.message); }
  }
  return { messages: out, errors };
}

async function conversations(ctx, platform, ownId) {
  const env = ctx.env; const page = env.FACEBOOK_PAGE_ID;
  const d = await getJson(ctx, `${apiBase(env)}/${page}/conversations?platform=${platform}&fields=messages.limit(10){id,message,from,created_time}&limit=20`, env.FACEBOOK_PAGE_ACCESS_TOKEN);
  const out = [];
  for (const conv of d.data ?? []) {
    for (const m of conv.messages?.data ?? []) {
      if (!m.from?.id || m.from.id === page || m.from.id === ownId) continue;
      out.push({ platform: platform === 'messenger' ? 'facebook' : platform, kind: 'dm', id: m.id, text: m.message, username: m.from.username ?? m.from.name, user_id: m.from.id, at: m.created_time, parent_id: conv.id });
    }
  }
  return out;
}

export async function pullFacebook(ctx, { posts = 10, dms = true } = {}) {
  const env = ctx.env; const out = []; const errors = [];
  const page = env.FACEBOOK_PAGE_ID;
  const feed = await getJson(ctx, `${apiBase(env)}/${page}/feed?fields=id,created_time,comments.limit(50){id,message,from,created_time}&limit=${posts}`, env.FACEBOOK_PAGE_ACCESS_TOKEN);
  for (const p of feed.data ?? []) {
    for (const c of p.comments?.data ?? []) {
      if (c.from?.id === page) continue;
      out.push({ platform: 'facebook', kind: 'comment', id: c.id, text: c.message, username: c.from?.name, user_id: c.from?.id, at: c.created_time, parent_id: p.id });
    }
  }
  if (dms) { try { out.push(...(await conversations(ctx, 'messenger', page))); } catch (e) { errors.push(e.message); } }
  return { messages: out, errors };
}

// Every configured platform. Errors are redacted and never stop the other platforms.
export async function pullAll(ctx, opts = {}) {
  const messages = []; const errors = []; const pulled = [];
  const plats = [
    ['instagram', ['INSTAGRAM_ACCESS_TOKEN', 'INSTAGRAM_USER_ID'], pullInstagram],
    ['facebook', ['FACEBOOK_PAGE_ID', 'FACEBOOK_PAGE_ACCESS_TOKEN'], pullFacebook],
  ];
  for (const [name, needs, fn] of plats) {
    if (missingKeys(ctx.env, needs).length) continue;
    try { const r = await fn(ctx, opts); messages.push(...r.messages); errors.push(...r.errors.map((e) => `${name}: ${e}`)); pulled.push(name); } catch (e) { errors.push(`${name}: ${redactSecrets(e.message ?? e, ctx.env)}`); }
  }
  return { messages, errors: errors.map((e) => redactSecrets(e, ctx.env)), pulled };
}

// ── processing (pure) ──
// messages: normalized; ledger: {messages: []}. Returns everything the run writes.
// suppressed: lead/contact ids from products/<slug>/suppression.json; those people get no draft and
// no funnel move (the connectors check the same file again before sending).
export function processMessages({ messages = [], ledger = null, product = {}, now = new Date().toISOString(), slug = '', suppressed = [] } = {}) {
  const sup = new Set([...suppressed].map(String));
  const led = { messages: Array.isArray(ledger?.messages) ? [...ledger.messages] : [] };
  const seen = new Set(led.messages.map((m) => m.id));
  const cfg = product.social_inbox ?? {};
  const maxAge = Number(cfg.max_age_days ?? 7);
  const maxDrafts = Number(cfg.max_drafts ?? 25);
  const approvals = []; const drafts = []; const leads = []; const updates = []; const alerts = [];
  const stats = { in: messages.length, new: 0, duplicates: 0, drafted: 0, leads: 0, by_class: {}, skipped_old: 0, capped: 0, suppressed: 0 };
  const leadSeen = new Set();
  for (const m of messages) {
    if (!m || seen.has(m.id)) { stats.duplicates++; continue; }
    seen.add(m.id);
    stats.new++;
    const c = classifyMessage(m.text);
    stats.by_class[c.class] = (stats.by_class[c.class] ?? 0) + 1;
    const userHash = hash(`${m.platform}:${m.user_id || m.username || m.id}`);
    const row = { id: m.id, platform: m.platform, kind: m.kind, native_id: m.native_id, parent_id: m.parent_id, username: m.username, user_id: m.user_id, user_hash: userHash, text: str(m.text, 1000), at: m.at, seen_at: now, class: c.class, signal: c.signal, lead: null, approval: null };
    const ageDays = (Date.parse(now) - Date.parse(m.at)) / 86400000;
    const fresh = ageDays <= maxAge;
    if (!fresh) stats.skipped_old++;
    const contact = `SOC-${SHORT[m.platform] ?? m.platform.slice(0, 4)}-${userHash.slice(0, 10)}`;
    const blocked = sup.has(contact);
    if (blocked) { stats.suppressed++; row.suppressed = true; }
    if (c.class === 'lead') {
      row.lead = contact;
      if (!blocked && !leadSeen.has(row.lead)) {
        leadSeen.add(row.lead);
        leads.push({ lead_id: row.lead, channel: m.platform, at: m.at, campaign: 'social-inbox', source: 'social-inbox' });
        updates.push({ file: `social-${hash(m.id, 12)}.json`, update: { lead: row.lead, stage: c.signal === 'strong' ? 'qualified' : 'engaged', at: m.at, source: 'social-inbox', reason: `buying signal in a ${m.platform} ${m.kind === 'dm' ? 'direct message' : 'comment'}`, note: `social-inbox ${m.platform} ${m.kind}` } });
        stats.leads++;
      }
    }
    const text = fresh && !blocked ? draftReply(m, c.class, product) : null;
    if (text && approvals.length >= maxDrafts) stats.capped++;
    else if (text) {
      const id = `SOC-${hash(m.id, 10)}`;
      const file = `outbox/social-replies/${id}.md`;
      const fm = ['---', `channel: ${m.platform}`, `platform: ${m.platform}`, `reply_kind: ${m.kind}`, `reply_to: ${m.native_id}`, ...(m.kind === 'dm' ? [`recipient: ${m.user_id}`] : []), `received_at: ${m.at}`, `class: ${c.class}`, `contact: ${contact}`, `source_message: ${m.id}`, '---', '', text, ''];
      drafts.push({ file, content: fm.join('\n') });
      const label = { question: 'question', lead: 'buying signal', complaint: 'complaint' }[c.class];
      approvals.push({ id, type: 'reply', channel: m.platform, title: `Reply to a ${m.platform} ${m.kind === 'dm' ? 'direct message' : 'comment'} (${label})`, file, target: m.native_id, contact, ...(row.lead ? { lead: row.lead, funnel_stage: 'contacted' } : {}), ...(m.kind === 'dm' ? { expires_at: new Date(Date.parse(m.at) + 24 * 3600000).toISOString() } : {}) });
      row.approval = id;
      stats.drafted++;
      if (c.class === 'complaint') alerts.push({ level: 'warning', title: `Complaint on ${m.platform}`, detail: `A ${m.kind === 'dm' ? 'direct message' : 'comment'} reads as a complaint. A reply is drafted as approval ${id}; see products/${slug || '<slug>'}/social-inbox/messages.json before approving.` });
    }
    led.messages.push(row);
  }
  if (stats.capped) alerts.push({ level: 'info', title: `${stats.capped} social message(s) not drafted this run`, detail: `The per-run draft limit (social_inbox.max_drafts = ${maxDrafts}) was reached; they stay in social-inbox/messages.json.` });
  if (led.messages.length > MAX_LEDGER) led.messages = led.messages.slice(-MAX_LEDGER);
  const run = approvals.length || alerts.length ? {
    agent: 'om-engagement-manager', status: 'done', output: ['social-inbox/messages.json', ...drafts.map((d) => d.file)],
    summary: `Social inbox: ${stats.new} new message(s) (${Object.entries(stats.by_class).sort().map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}); ${stats.drafted} reply draft(s), ${stats.leads} lead(s) moved in the funnel.`,
    approvals, alerts,
  } : null;
  return { ledger: led, approvals, drafts, leads, updates, alerts, run, stats };
}

// ── files ──
function readDrops(dropDir, now) {
  if (!fs.existsSync(dropDir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dropDir).filter((x) => /\.json$/i.test(x) && !/^[._]/.test(x))) {
    const file = path.join(dropDir, f);
    try {
      if (fs.statSync(file).size > 2 * 1024 * 1024) throw new Error('file over 2 MB');
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      const list = Array.isArray(j) ? j : Array.isArray(j?.messages) ? j.messages : [j];
      out.push({ file: f, messages: list.map((x) => normalizeMessage(x, { now })).filter(Boolean) });
    } catch (e) { out.push({ file: f, error: e.message, messages: [] }); }
  }
  return out;
}
const moveUnique = (from, dir) => {
  fs.mkdirSync(dir, { recursive: true });
  let name = path.basename(from); let n = 1;
  while (fs.existsSync(path.join(dir, name))) name = `${path.basename(from, '.json')}-${n++}.json`;
  fs.renameSync(from, path.join(dir, name));
  return name;
};
const strictJson = (f, dir) => {
  if (!fs.existsSync(f)) return null;
  const raw = fs.readFileSync(f, 'utf8');
  if (!raw.trim()) return null;
  try { const j = JSON.parse(raw); if (j && typeof j === 'object') return j; } catch { /* below */ }
  throw new Error(`${path.relative(dir, f).replace(/\\/g, '/')} is not valid JSON; fix or restore it before the social inbox runs`);
};

export async function runSocialInbox(slug, { now = new Date().toISOString(), dryRun = false, env = process.env, root = repoRoot, fetch: f, pull = true } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(String(slug ?? ''))) throw new Error(`invalid product slug: ${slug}`);
  const dir = path.join(root, 'products', slug);
  if (!fs.existsSync(path.join(dir, 'product.json'))) throw new Error(`no product.json for ${slug}`);
  const product = readJson(path.join(dir, 'product.json'), {});
  if (product.stage === 'paused' || product.autonomy?.kill === true || env.OM_KILL === '1') return { slug, paused: true, new: 0, drafted: 0 };
  const sdir = path.join(dir, 'social-inbox');
  const ledger = strictJson(path.join(sdir, 'messages.json'), dir);
  const state = strictJson(path.join(sdir, 'state.json'), dir) ?? {};
  const cfg = product.social_inbox ?? {};
  // Suppression list (tools/inbox.mjs): fails closed like the ledger, before anything moves.
  const supRaw = strictJson(path.join(dir, 'suppression.json'), dir);
  const supRows = Array.isArray(supRaw) ? supRaw : Array.isArray(supRaw?.entries) ? supRaw.entries : [];
  const suppressed = supRows.flatMap((e) => [e?.lead, e?.contact]).filter((x) => x != null && x !== '');

  const ctx = { env, fetch: f, now };
  const pulled = pull && cfg.pull !== false ? await pullAll(ctx, { media: Number(cfg.media ?? 10), posts: Number(cfg.posts ?? 10), dms: cfg.dms !== false }) : { messages: [], errors: [], pulled: [] };
  const fromApi = pulled.messages.map((x) => normalizeMessage(x, { now })).filter(Boolean);
  const drops = readDrops(path.join(sdir, 'drop'), now);
  const res = processMessages({ messages: [...fromApi, ...drops.flatMap((d) => d.messages)], ledger, product, now, slug, suppressed });

  let runFile = null;
  if (!dryRun) {
    fs.mkdirSync(sdir, { recursive: true });
    for (const d of drops) {
      const name = moveUnique(path.join(sdir, 'drop', d.file), path.join(sdir, 'drop', d.error ? 'failed' : 'done'));
      if (d.error) writeJson(path.join(sdir, 'drop', 'failed', `${name}.error.json`), { file: d.file, error: d.error, at: now });
    }
    writeJson(path.join(sdir, 'messages.json'), res.ledger);
    writeJson(path.join(sdir, 'state.json'), { ...state, ...Object.fromEntries(pulled.pulled.map((p) => [p, { last_pull_at: now }])), last_run_at: now, last_errors: pulled.errors.slice(0, 10) });
    for (const d of res.drafts) { const p = path.join(dir, d.file); fs.mkdirSync(path.dirname(p), { recursive: true }); if (!fs.existsSync(p)) fs.writeFileSync(p, d.content); }
    if (res.leads.length) {
      const lf = path.join(dir, 'leads', 'social-inbox.json');
      fs.mkdirSync(path.dirname(lf), { recursive: true });
      const prev = readJson(lf, []);
      const rows = Array.isArray(prev) ? prev : [];
      const have = new Set(rows.map((r) => r?.lead_id));
      writeJson(lf, [...rows, ...res.leads.filter((l) => !have.has(l.lead_id))]);
    }
    if (res.updates.length) {
      const ud = path.join(dir, 'funnel', 'updates');
      fs.mkdirSync(ud, { recursive: true });
      for (const u of res.updates) writeJson(path.join(ud, u.file), u.update);
    }
    if (res.run) {
      const runs = path.join(dir, 'runs');
      fs.mkdirSync(runs, { recursive: true });
      const stamp = now.slice(0, 16).replace(/[-:]/g, '');
      let id = `SOCIAL-${stamp}`; let n = 1;
      while (fs.existsSync(path.join(runs, `${id}.json`)) || fs.existsSync(path.join(runs, 'applied', `${id}.json`))) id = `SOCIAL-${stamp}-${n++}`;
      writeJson(path.join(runs, `${id}.json`), { task_id: id, ...res.run });
      runFile = `runs/${id}.json`;
    }
    if (res.stats.new) fs.appendFileSync(path.join(dir, 'events.jsonl'), JSON.stringify({ at: now, agent: 'om-engagement-manager', product: slug, kind: 'lead', text: `Social inbox: ${res.stats.new} new, ${res.stats.drafted} reply draft(s), ${res.stats.leads} lead(s)` }) + '\n');
  }
  // Counts only: no usernames or message text in the return value (it is printed and may be logged).
  return { slug, pulled: pulled.pulled, errors: pulled.errors, drop_files: drops.length, ...res.stats, run: runFile, dry_run: dryRun };
}

const activeSlugs = (root = repoRoot) => {
  const d = path.join(root, 'products');
  return (fs.existsSync(d) ? fs.readdirSync(d) : []).filter((s) => !s.startsWith('_') && /^[a-z0-9-]+$/i.test(s) && fs.existsSync(path.join(d, s, 'product.json')) && readJson(path.join(d, s, 'product.json'), {}).stage !== 'paused');
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  loadEnv();
  const argv = process.argv.slice(2);
  const val = (k) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : null; };
  const now = val('--now') ?? new Date().toISOString();
  if (!isoOk(now)) { console.error('--now must be an ISO date'); process.exit(2); }
  const flagVals = new Set([val('--now')].filter(Boolean));
  const slugs = argv.includes('--all') ? activeSlugs() : argv.filter((a) => !a.startsWith('--') && !flagVals.has(a)).slice(0, 1);
  if (!slugs.length) { console.error('Usage: node tools/social-inbox.mjs <slug> [--now ISO] [--dry-run] [--no-pull] | --all'); process.exit(2); }
  const out = [];
  for (const s of slugs) { try { out.push(await runSocialInbox(s, { now, dryRun: argv.includes('--dry-run'), pull: !argv.includes('--no-pull') })); } catch (e) { out.push({ slug: s, error: redactSecrets(e.message, process.env) }); } }
  console.log(JSON.stringify(slugs.length === 1 ? out[0] : out));
  if (slugs.length === 1 && out[0].error) process.exit(1);
}
