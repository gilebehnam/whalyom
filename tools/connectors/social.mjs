// Social and community posting: Bluesky, Mastodon, Telegram channel, Discord webhook, Slack webhook,
// LinkedIn (Posts API) and Buffer. Each accepts approval type "post" on its own channel only.
// The post text is the draft body (front matter stripped) or item.text. Over-limit text is refused,
// never silently cut: the writer agents must fit the platform.
import { defineConnector, loadDraft, request, fail, graphemes } from './_http.mjs';

const postText = (item, ctx) => { const d = loadDraft(item, ctx); return { ...d, text: (d.body || d.title || '').trim() }; };
const isPost = (item, channels) => item.type === 'post' && channels.includes(item.channel);
const limitError = (name, n, max) => `post is ${n} characters; ${name} allows ${max}`;

// ── Bluesky (AT Protocol) ──
// App password from bsky.app → Settings → Privacy and security → App passwords. Never the main password.
export function linkFacets(text) {
  const enc = new TextEncoder();
  const facets = [];
  for (const m of text.matchAll(/https?:\/\/[^\s)]+/g)) {
    const byteStart = enc.encode(text.slice(0, m.index)).length;
    facets.push({ index: { byteStart, byteEnd: byteStart + enc.encode(m[0]).length }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: m[0] }] });
  }
  return facets;
}

export const bluesky = defineConnector({
  name: 'bluesky',
  handles: 'type "post" with channel "bluesky" (AT Protocol createRecord, links as facets)',
  needs: ['BLUESKY_HANDLE', 'BLUESKY_APP_PASSWORD'],
  accepts: (item) => isPost(item, ['bluesky', 'bsky']),
  prepare(item, ctx) {
    const { text } = postText(item, ctx);
    if (!text) return { error: 'empty post' };
    const n = graphemes(text);
    if (n > 300) return { error: limitError('Bluesky', n, 300) };
    return { text, preview: `post ${n} characters to Bluesky as ${ctx.env.BLUESKY_HANDLE || '(BLUESKY_HANDLE)'}` };
  },
  async send(p, item, ctx) {
    const pds = (ctx.env.BLUESKY_PDS || 'https://bsky.social').replace(/\/$/, '');
    const s = await request(ctx, { url: `${pds}/xrpc/com.atproto.server.createSession`, json: { identifier: ctx.env.BLUESKY_HANDLE, password: ctx.env.BLUESKY_APP_PASSWORD } });
    if (!s.ok || !s.data?.accessJwt) return { ok: false, detail: fail(s, ctx, 'Bluesky login') };
    const record = { $type: 'app.bsky.feed.post', text: p.text, createdAt: new Date(ctx.now ?? Date.now()).toISOString() };
    const facets = linkFacets(p.text);
    if (facets.length) record.facets = facets;
    const r = await request(ctx, { url: `${pds}/xrpc/com.atproto.repo.createRecord`, headers: { authorization: `Bearer ${s.data.accessJwt}` }, json: { repo: s.data.did, collection: 'app.bsky.feed.post', record } });
    return r.ok ? { ok: true, ref: r.data?.uri ?? '', detail: 'posted to Bluesky' } : { ok: false, detail: fail(r, ctx, 'Bluesky') };
  },
});

// ── Mastodon ──
export const mastodon = defineConnector({
  name: 'mastodon',
  handles: 'type "post" with channel "mastodon" (statuses API on your instance)',
  needs: ['MASTODON_URL', 'MASTODON_TOKEN'],
  accepts: (item) => isPost(item, ['mastodon']),
  prepare(item, ctx) {
    const { text, meta } = postText(item, ctx);
    const max = Number(ctx.env.MASTODON_MAX_CHARS || 500);
    if (!text) return { error: 'empty post' };
    if ([...text].length > max) return { error: limitError('this Mastodon instance', [...text].length, max) };
    const visibility = ['public', 'unlisted', 'private'].includes(meta.visibility) ? meta.visibility : 'public';
    return { text, visibility, preview: `post ${[...text].length} characters (${visibility}) to ${ctx.env.MASTODON_URL || '(MASTODON_URL)'}` };
  },
  async send(p, item, ctx) {
    const r = await request(ctx, {
      url: `${ctx.env.MASTODON_URL.replace(/\/$/, '')}/api/v1/statuses`,
      headers: { authorization: `Bearer ${ctx.env.MASTODON_TOKEN}`, 'idempotency-key': `whalyom-${ctx.slug}-${item.id}` },
      json: { status: p.text, visibility: p.visibility },
    });
    return r.ok ? { ok: true, ref: r.data?.url ?? r.data?.id ?? '', detail: 'posted to Mastodon' } : { ok: false, detail: fail(r, ctx, 'Mastodon') };
  },
});

// ── Telegram channel (bot must be an admin of the channel) ──
export const telegram = defineConnector({
  name: 'telegram',
  handles: 'type "post" with channel "telegram" (Bot API sendMessage to your channel)',
  needs: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'],
  accepts: (item) => isPost(item, ['telegram']),
  prepare(item, ctx) {
    const { text, meta } = postText(item, ctx);
    if (!text) return { error: 'empty post' };
    if ([...text].length > 4096) return { error: limitError('Telegram', [...text].length, 4096) };
    return { text, parse_mode: ['HTML', 'MarkdownV2'].includes(meta.parse_mode) ? meta.parse_mode : undefined, preview: `send ${[...text].length} characters to Telegram chat ${ctx.env.TELEGRAM_CHAT_ID || '(TELEGRAM_CHAT_ID)'}` };
  },
  async send(p, item, ctx) {
    // The token is part of the URL: it is never logged (redact() replaces it in any error text).
    const r = await request(ctx, { url: `https://api.telegram.org/bot${ctx.env.TELEGRAM_BOT_TOKEN}/sendMessage`, json: { chat_id: ctx.env.TELEGRAM_CHAT_ID, text: p.text, parse_mode: p.parse_mode, disable_web_page_preview: false } });
    return r.ok && r.data?.ok !== false ? { ok: true, ref: String(r.data?.result?.message_id ?? ''), detail: 'sent to Telegram' } : { ok: false, detail: fail(r, ctx, 'Telegram') };
  },
});

// ── Discord (channel webhook) ──
export const discord = defineConnector({
  name: 'discord',
  handles: 'type "post" with channel "discord" (channel webhook; mentions disabled)',
  needs: ['DISCORD_WEBHOOK_URL'],
  accepts: (item) => isPost(item, ['discord']),
  prepare(item, ctx) {
    const { text, meta } = postText(item, ctx);
    if (!text) return { error: 'empty post' };
    if ([...text].length > 2000) return { error: limitError('Discord', [...text].length, 2000) };
    return { text, username: meta.username, preview: `post ${[...text].length} characters to a Discord channel webhook` };
  },
  async send(p, item, ctx) {
    const u = new URL(ctx.env.DISCORD_WEBHOOK_URL);
    u.searchParams.set('wait', 'true');
    const r = await request(ctx, { url: u.toString(), json: { content: p.text, username: p.username, allowed_mentions: { parse: [] } } });
    return r.ok ? { ok: true, ref: r.data?.id ?? '', detail: 'posted to Discord' } : { ok: false, detail: fail(r, ctx, 'Discord') };
  },
});

// ── Slack (incoming webhook) ──
export const slack = defineConnector({
  name: 'slack',
  handles: 'type "post" with channel "slack" (incoming webhook)',
  needs: ['SLACK_WEBHOOK_URL'],
  accepts: (item) => isPost(item, ['slack']),
  prepare(item, ctx) {
    const { text } = postText(item, ctx);
    if (!text) return { error: 'empty post' };
    if (text.length > 40000) return { error: limitError('Slack', text.length, 40000) };
    return { text, preview: `post ${text.length} characters to a Slack webhook` };
  },
  async send(p, item, ctx) {
    const r = await request(ctx, { url: ctx.env.SLACK_WEBHOOK_URL, json: { text: p.text } });
    return r.ok ? { ok: true, ref: 'slack', detail: 'posted to Slack' } : { ok: false, detail: fail(r, ctx, 'Slack') };
  },
});

// ── LinkedIn (Posts API, versioned REST) ──
// Token with w_member_social (personal) or w_organization_social (company page).
// LINKEDIN_AUTHOR_URN: urn:li:person:<id> or urn:li:organization:<id>.
// Commentary uses LinkedIn's "little text format": reserved characters must be escaped or the
// post is cut at the first one.
export const escapeLittleText = (s) => String(s).replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
export const linkedinVersion = (env, now) => {
  if (env.LINKEDIN_VERSION) return env.LINKEDIN_VERSION;
  const d = new Date(now ?? Date.now()); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 2); // versions live ~12 months; stay a little behind
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export const linkedin = defineConnector({
  name: 'linkedin',
  handles: 'type "post" with channel "linkedin" (Posts API, member or organization author)',
  needs: ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_AUTHOR_URN'],
  unverified: 'LinkedIn-Version header defaults to two months before now; set LINKEDIN_VERSION if LinkedIn rejects it.',
  accepts: (item) => isPost(item, ['linkedin']),
  prepare(item, ctx) {
    const { text } = postText(item, ctx);
    if (!text) return { error: 'empty post' };
    if ([...text].length > 3000) return { error: limitError('LinkedIn', [...text].length, 3000) };
    return { text, preview: `post ${[...text].length} characters to LinkedIn as ${ctx.env.LINKEDIN_AUTHOR_URN || '(LINKEDIN_AUTHOR_URN)'}` };
  },
  async send(p, item, ctx) {
    const r = await request(ctx, {
      url: 'https://api.linkedin.com/rest/posts',
      headers: { authorization: `Bearer ${ctx.env.LINKEDIN_ACCESS_TOKEN}`, 'linkedin-version': linkedinVersion(ctx.env, ctx.now), 'x-restli-protocol-version': '2.0.0' },
      json: { author: ctx.env.LINKEDIN_AUTHOR_URN, commentary: escapeLittleText(p.text), visibility: 'PUBLIC', distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false },
    });
    const id = r.headers?.get?.('x-restli-id') ?? r.data?.id ?? '';
    return r.ok ? { ok: true, ref: id, detail: 'posted to LinkedIn' } : { ok: false, detail: fail(r, ctx, 'LinkedIn') };
  },
});

// ── Buffer (queues the post on the given Buffer profiles) ──
export const buffer = defineConnector({
  name: 'buffer',
  handles: 'type "post" with channel "buffer" (adds to the Buffer queue of BUFFER_PROFILE_IDS)',
  needs: ['BUFFER_ACCESS_TOKEN', 'BUFFER_PROFILE_IDS'],
  unverified: 'Uses Buffer API v1 (updates/create). Buffer stopped issuing v1 credentials to new apps; works with existing tokens. Override with BUFFER_API_URL.',
  accepts: (item) => isPost(item, ['buffer']),
  prepare(item, ctx) {
    const { text } = postText(item, ctx);
    if (!text) return { error: 'empty post' };
    const ids = String(ctx.env.BUFFER_PROFILE_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return { text, ids, preview: `queue ${text.length} characters on ${ids.length || '(BUFFER_PROFILE_IDS)'} Buffer profile(s)` };
  },
  async send(p, item, ctx) {
    const form = new URLSearchParams({ text: p.text, shorten: 'false', now: 'false', access_token: ctx.env.BUFFER_ACCESS_TOKEN });
    for (const id of p.ids) form.append('profile_ids[]', id);
    const r = await request(ctx, { url: ctx.env.BUFFER_API_URL || 'https://api.bufferapp.com/1/updates/create.json', form });
    return r.ok && r.data?.success !== false ? { ok: true, ref: (r.data?.updates ?? []).map((u) => u.id).join(','), detail: `queued on ${p.ids.length} Buffer profile(s)` } : { ok: false, detail: fail(r, ctx, 'Buffer') };
  },
});

export default [bluesky, mastodon, telegram, discord, slack, linkedin, buffer];
