// Instagram native publishing (Instagram Graph API content publishing) and replies.
// An approved "post" item with channel instagram/ig publishes one of:
//   image     POST /{ig-user-id}/media {image_url, caption}                       → container
//   carousel  POST /{ig-user-id}/media {image_url|video_url, is_carousel_item} ×2–10 → children,
//             POST /{ig-user-id}/media {media_type: CAROUSEL, children, caption}  → container
//   reel      POST /{ig-user-id}/media {media_type: REELS, video_url, caption, share_to_feed}
// then (videos: once GET /{container}?fields=status_code says FINISHED) POST /{ig-user-id}/media_publish
// {creation_id}. An approved "reply" item answers a comment (POST /{comment-id}/replies) or a direct
// message inside the 24-hour window (POST /{ig-user-id}/messages); tools/social-inbox.mjs drafts them.
// Draft (markdown front matter or JSON spec): format image|carousel|reel, image_url, images (list),
// video_url, media ([{type, url}] in JSON), cover_url, share_to_feed, disclosure, sponsored, ai_label;
// replies: reply_to (comment id), reply_kind comment|dm, recipient (DM user id), received_at.
// Guards: nothing runs without an approval (tools/execute.mjs); idempotent by approval id (the stored
// container or media id is reused, so a retry never posts twice); disclosure labels are kept and a
// sponsored draft without one is refused; caption limits (2200 characters, 30 hashtags, 20 mentions)
// are refused, never cut; the token is sent as a Bearer header, never in a URL, and every error text is
// redacted. Needs INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_USER_ID (the Instagram professional account id).
// INSTAGRAM_API_BASE may switch to https://graph.instagram.com (Instagram Login); META_API_VERSION
// picks the Graph version. Tests inject ctx.fetch and ctx.sleep.
import { defineConnector, request, fail, redact, loadDraft, missingKeys } from './_http.mjs';
import { apiBase } from './meta-ads.mjs';
import { labelsFor, withLabels, listOf, isHttpsUrl, truthy, countHashtags, countMentions, storeGet, storePut, storeKey, hoursSince, sleeper, suppressionError } from './_social-publish.mjs';

export const CHANNELS = ['instagram', 'ig'];
const NEEDS = ['INSTAGRAM_ACCESS_TOKEN', 'INSTAGRAM_USER_ID'];
// Carousels take up to 20 items (current IG User Media reference); Instagram DM text is limited to
// 1000 bytes (UTF-8), not characters, so Persian text is measured in bytes.
export const LIMITS = { caption: 2200, hashtags: 30, mentions: 20, carousel_min: 2, carousel_max: 20, dm_bytes: 1000 };
const bytes = (s) => Buffer.byteLength(String(s), 'utf8');

export const igBase = (env = {}) => {
  const host = String(env.INSTAGRAM_API_BASE ?? '').replace(/\/$/, '');
  const ver = apiBase(env).split('/').pop();
  return /^https:\/\/graph\.(facebook|instagram)\.com$/.test(host) ? `${host}/${ver}` : apiBase(env);
};

// Graph call with the token in the Authorization header. Errors come back as non-2xx or {error}.
export async function graph(ctx, method, pathPart, params = null, token = ctx.env.INSTAGRAM_ACCESS_TOKEN, base = igBase(ctx.env)) {
  const url = `${base}/${pathPart}`;
  const headers = { authorization: `Bearer ${token}` };
  const r = method === 'GET'
    ? await request(ctx, { url, method: 'GET', headers })
    : await request(ctx, { url, headers, form: Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)])) });
  if (!r.ok || r.data?.error) throw new Error(r.ok ? `Graph ${pathPart.split('?')[0]}: ${redact(r.data.error.message ?? r.text, ctx.env).slice(0, 200)}` : fail(r, ctx, `Graph ${pathPart.split('?')[0]}`));
  return r.data ?? {};
}

// The media list the draft describes: [{type: 'image'|'video', url}].
export function mediaOf(d) {
  const spec = d.spec ?? d.meta ?? {};
  if (Array.isArray(spec.media)) return spec.media.map((m) => (typeof m === 'string' ? { type: /\.(mp4|mov)(\?|$)/i.test(m) ? 'video' : 'image', url: m } : { type: m.type === 'video' ? 'video' : 'image', url: m.url }));
  const imgs = [...listOf(spec.images), ...listOf(spec.image_url)];
  const vids = [...listOf(spec.video_url), ...listOf(spec.videos)];
  return [...imgs.map((url) => ({ type: 'image', url })), ...vids.map((url) => ({ type: 'video', url }))];
}

// dmLimit counts characters; dmBytes (Instagram) counts UTF-8 bytes.
export function prepareReply(item, ctx, { dmLimit = null, dmBytes = LIMITS.dm_bytes, name = 'Instagram' } = {}) {
  const d = loadDraft(item, ctx);
  const text = String(d.body || item.text || '').trim();
  const kind = String(d.meta.reply_kind ?? item.reply_kind ?? 'comment').toLowerCase() === 'dm' ? 'dm' : 'comment';
  const target = String(d.meta.reply_to ?? item.target ?? '').trim();
  const recipient = String(d.meta.recipient ?? '').trim();
  if (!text) return { error: 'empty reply' };
  // Suppression: a person on products/<slug>/suppression.json never gets a reply (fails closed).
  const sup = suppressionError(ctx, [item.lead, item.contact, d.meta.contact]);
  if (sup) return { error: sup };
  if (kind === 'comment' && !/^[\w:.-]{1,80}$/.test(target)) return { error: 'reply has no comment id (reply_to)' };
  if (kind === 'dm') {
    if (!/^[\w.-]{1,80}$/.test(recipient)) return { error: 'direct reply has no recipient id' };
    // Platform rule: a standard reply is only allowed within 24 hours of the person's last message.
    // An unknown or future received_at (beyond a few minutes of clock skew) is refused, never assumed fresh.
    const h = hoursSince(d.meta.received_at, ctx.now);
    if (!(h <= 24) || h < -0.1) return { error: `${name} direct replies are only allowed within 24 hours of the person's message (received ${String(d.meta.received_at || 'unknown').slice(0, 40)})` };
    if (dmLimit && [...text].length > dmLimit) return { error: `reply is ${[...text].length} characters; ${name} direct messages allow ${dmLimit}` };
    if (!dmLimit && dmBytes && bytes(text) > dmBytes) return { error: `reply is ${bytes(text)} bytes; ${name} direct messages allow ${dmBytes} bytes` };
  } else if ([...text].length > LIMITS.caption) return { error: `reply is ${[...text].length} characters; ${name} allows ${LIMITS.caption}` };
  return { reply: true, kind, target, recipient, text, preview: `reply (${kind}) with ${[...text].length} characters on ${name}` };
}

function preparePost(item, ctx) {
  const d = loadDraft(item, ctx);
  const meta = d.spec ?? d.meta ?? {};
  const l = labelsFor(item, meta);
  const caption = withLabels(d.body || item.text || '', l.labels);
  const n = [...caption].length;
  if (n > LIMITS.caption) return { error: `caption is ${n} characters; Instagram allows ${LIMITS.caption}` };
  if (countHashtags(caption) > LIMITS.hashtags) return { error: `caption has ${countHashtags(caption)} hashtags; Instagram allows ${LIMITS.hashtags}` };
  if (countMentions(caption) > LIMITS.mentions) return { error: `caption has ${countMentions(caption)} mentions; Instagram allows ${LIMITS.mentions}` };
  const media = mediaOf(d);
  if (!media.length) return { error: 'no media: Instagram posts need image_url, images, video_url or media' };
  const bad = media.find((m) => !isHttpsUrl(m.url));
  if (bad) return { error: `media URL must be public https: ${String(bad.url).slice(0, 80)}` };
  let format = String(meta.format ?? meta.media_type ?? '').toLowerCase();
  if (!format) format = media.length > 1 ? 'carousel' : media[0].type === 'video' ? 'reel' : 'image';
  if (format === 'reels' || format === 'video') format = 'reel';
  if (!['image', 'carousel', 'reel'].includes(format)) return { error: `unknown Instagram format "${format}" (image, carousel, reel)` };
  // Refused, never cut: an image or reel takes exactly one media item.
  if (format === 'image' && (media.length !== 1 || media[0].type !== 'image')) return { error: `format image needs exactly one image URL, got ${media.length} media` };
  if (format === 'reel' && (media.length !== 1 || media[0].type !== 'video')) return { error: `format reel needs exactly one video_url, got ${media.length} media` };
  if (format === 'carousel' && (media.length < LIMITS.carousel_min || media.length > LIMITS.carousel_max)) return { error: `a carousel takes ${LIMITS.carousel_min}–${LIMITS.carousel_max} items, got ${media.length}` };
  const cover = isHttpsUrl(meta.cover_url) ? meta.cover_url : undefined;
  return {
    format, media, caption, cover, share_to_feed: meta.share_to_feed === undefined ? true : truthy(meta.share_to_feed), labels: l,
    preview: `publish an Instagram ${format} (${media.length} media, ${n}-character caption${l.labels.length ? `, labelled ${l.labels.join(' + ')}` : ''})`,
  };
}

// Creates the media container(s) and returns the container id to publish.
async function makeContainer(p, ctx) {
  const ig = ctx.env.INSTAGRAM_USER_ID;
  if (p.format === 'image') return (await graph(ctx, 'POST', `${ig}/media`, { image_url: p.media[0].url, caption: p.caption })).id;
  if (p.format === 'reel') {
    const v = p.media.find((m) => m.type === 'video');
    return (await graph(ctx, 'POST', `${ig}/media`, { media_type: 'REELS', video_url: v.url, caption: p.caption, share_to_feed: p.share_to_feed, cover_url: p.cover })).id;
  }
  const children = [];
  for (const m of p.media) {
    const c = await graph(ctx, 'POST', `${ig}/media`, m.type === 'video' ? { media_type: 'VIDEO', video_url: m.url, is_carousel_item: true } : { image_url: m.url, is_carousel_item: true });
    if (!c.id) throw new Error('Instagram carousel item returned no id');
    // A video child must finish processing before the carousel container can use it. Unused child
    // containers are never published and expire on their own, so a retry cannot double-post.
    if (m.type === 'video') {
      const s = await waitForContainer(ctx, c.id);
      if (s !== 'finished') throw new Error(`Instagram carousel video ${c.id} is ${s === 'failed' ? 'unusable (processing error)' : 'still processing'}; the next run tries again`);
    }
    children.push(c.id);
  }
  return (await graph(ctx, 'POST', `${ig}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption: p.caption })).id;
}

// Waits for a video container: FINISHED → ok, ERROR/EXPIRED → failed, still IN_PROGRESS after the
// attempts → pending (the next executor run resumes the same container).
export async function waitForContainer(ctx, id, { attempts = Number(ctx.env.INSTAGRAM_POLL_ATTEMPTS || 24), every = Number(ctx.env.INSTAGRAM_POLL_MS || 5000) } = {}) {
  const sleep = sleeper(ctx);
  for (let i = 0; i < attempts; i++) {
    const s = await graph(ctx, 'GET', `${id}?fields=status_code`);
    const code = String(s.status_code ?? '').toUpperCase();
    if (code === 'FINISHED' || code === 'PUBLISHED') return 'finished';
    if (code === 'ERROR' || code === 'EXPIRED') return 'failed';
    if (i < attempts - 1) await sleep(every);
  }
  return 'pending';
}

// Instagram DM: with Instagram Login (INSTAGRAM_API_BASE https://graph.instagram.com) it is
// POST /{ig-user-id}/messages with the Instagram token; with Facebook Login (the default host, and how
// tools/social-inbox.mjs reads DMs) it is POST /{page-id}/messages with the linked Page token.
async function sendDm(ctx, p) {
  const body = { recipient: { id: p.recipient }, message: { text: p.text } };
  const igLogin = /^https:\/\/graph\.instagram\.com\//.test(igBase(ctx.env));
  if (!igLogin && ctx.env.FACEBOOK_PAGE_ID && ctx.env.FACEBOOK_PAGE_ACCESS_TOKEN) {
    return graph(ctx, 'POST', `${ctx.env.FACEBOOK_PAGE_ID}/messages`, body, ctx.env.FACEBOOK_PAGE_ACCESS_TOKEN, apiBase(ctx.env));
  }
  return graph(ctx, 'POST', `${ctx.env.INSTAGRAM_USER_ID}/messages`, body);
}

async function sendReply(p, item, ctx) {
  const key = storeKey('instagram', item);
  const done = storeGet(ctx, key);
  if (done?.ref) return { ok: true, ref: done.ref, detail: `already replied on Instagram for approval ${item.id}` };
  const r = p.kind === 'dm' ? await sendDm(ctx, p) : await graph(ctx, 'POST', `${p.target}/replies`, { message: p.text });
  const ref = r.id ?? r.message_id ?? '';
  storePut(ctx, key, { ref, stage: 'replied' });
  return { ok: true, ref, detail: `replied to an Instagram ${p.kind === 'dm' ? 'direct message' : 'comment'}` };
}

export const instagram = defineConnector({
  name: 'instagram',
  handles: 'type "post" with channel "instagram" (image, carousel or reel: container, then publish) and type "reply" (comment reply or DM within 24 h)',
  needs: NEEDS,
  required: (env) => missingKeys(env, NEEDS),
  unverified: 'Graph API content publishing and Instagram messaging paths follow the documented v2x shape; verify against current Meta docs. DMs go to /{page-id}/messages (Facebook Login, needs FACEBOOK_PAGE_ID + FACEBOOK_PAGE_ACCESS_TOKEN) or /{ig-user-id}/messages (Instagram Login host).',
  accepts: (item) => ['post', 'reply'].includes(item.type) && CHANNELS.includes(String(item.channel ?? '').toLowerCase()),
  prepare(item, ctx) {
    return item.type === 'reply' ? prepareReply(item, ctx) : preparePost(item, ctx);
  },
  async send(p, item, ctx) {
    if (p.reply) return sendReply(p, item, ctx);
    const key = storeKey('instagram', item);
    const prev = storeGet(ctx, key);
    if (prev?.ref) return { ok: true, ref: prev.ref, detail: `already published on Instagram for approval ${item.id}` };
    let container = prev?.container;
    if (!container) {
      container = await makeContainer(p, ctx);
      if (!container) throw new Error('Instagram returned no container id');
      storePut(ctx, key, { container, stage: 'container', format: p.format });
    }
    if (p.media.some((m) => m.type === 'video')) {
      const s = await waitForContainer(ctx, container);
      if (s === 'failed') { storePut(ctx, key, null); return { ok: false, detail: `Instagram could not process the media (container ${container}); the next try makes a new container` }; }
      if (s === 'pending') return { ok: false, detail: `Instagram is still processing container ${container}; the next run publishes the same container` };
    }
    const pub = await graph(ctx, 'POST', `${ctx.env.INSTAGRAM_USER_ID}/media_publish`, { creation_id: container });
    if (!pub.id) throw new Error('Instagram media_publish returned no id');
    storePut(ctx, key, { ref: pub.id, container, stage: 'published', format: p.format });
    return { ok: true, ref: pub.id, detail: `published Instagram ${p.format} ${pub.id}` };
  },
});

export default instagram;
