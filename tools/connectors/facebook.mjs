// Facebook Page native publishing (Graph API) and replies.
// An approved "post" item with channel facebook/fb/facebook_page publishes:
//   text or link   POST /{page-id}/feed   {message, link?}
//   one photo      POST /{page-id}/photos {url, message}
//   2–10 photos    POST /{page-id}/photos {url, published: false} for each, then
//                  POST /{page-id}/feed {message, attached_media[i]: {media_fbid}}
// A draft with scheduled_at (10 minutes to 30 days ahead) is created unpublished with
// scheduled_publish_time, so Facebook publishes it then. An approved "reply" item answers a comment
// (POST /{comment-id}/comments) or a Messenger conversation inside the 24-hour window
// (POST /{page-id}/messages, messaging_type RESPONSE); tools/social-inbox.mjs drafts them.
// Draft fields: link, image_url, images, scheduled_at, disclosure, sponsored, ai_label; replies:
// reply_to, reply_kind comment|dm, recipient, received_at.
// Guards: approval only (tools/execute.mjs); idempotent by approval id (products/<slug>/social/
// published.json); disclosure labels kept, sponsored without a label refused; over-limit text refused;
// the Page token travels in the Authorization header and every error is redacted.
// Needs FACEBOOK_PAGE_ID and FACEBOOK_PAGE_ACCESS_TOKEN (a Page access token with pages_manage_posts;
// replies also need pages_manage_engagement / pages_messaging). Tests inject ctx.fetch.
import { defineConnector, loadDraft, missingKeys } from './_http.mjs';
import { apiBase } from './meta-ads.mjs';
import { graph, prepareReply } from './instagram.mjs';
import { labelsFor, withLabels, listOf, isHttpsUrl, storeGet, storePut, storeKey } from './_social-publish.mjs';

export const CHANNELS = ['facebook', 'fb', 'facebook_page', 'facebook-page'];
const NEEDS = ['FACEBOOK_PAGE_ID', 'FACEBOOK_PAGE_ACCESS_TOKEN'];
export const LIMITS = { text: 63206, photos: 10, dm: 2000 };

const fb = (ctx, method, pathPart, params) => graph(ctx, method, pathPart, params, ctx.env.FACEBOOK_PAGE_ACCESS_TOKEN, apiBase(ctx.env));

// Unix seconds for scheduled_publish_time, or an error when outside Facebook's window.
export function scheduleOf(at, now) {
  if (!at) return { at: null };
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return { error: `scheduled_at "${String(at).slice(0, 40)}" is not a date` };
  const ahead = (t - Date.parse(now ?? new Date().toISOString())) / 60000;
  if (ahead < 10 || ahead > 30 * 24 * 60) return { error: 'scheduled_at must be between 10 minutes and 30 days ahead' };
  return { at: Math.floor(t / 1000) };
}

function preparePost(item, ctx) {
  const d = loadDraft(item, ctx);
  const meta = d.spec ?? d.meta ?? {};
  const l = labelsFor(item, meta);
  const message = withLabels(d.body || item.text || '', l.labels);
  const images = [...listOf(meta.images), ...listOf(meta.image_url)];
  const link = meta.link ? String(meta.link) : '';
  if (!message && !images.length && !link) return { error: 'empty post' };
  if ([...message].length > LIMITS.text) return { error: `post is ${[...message].length} characters; Facebook allows ${LIMITS.text}` };
  const bad = [...images, ...(link ? [link] : [])].find((u) => !isHttpsUrl(u));
  if (bad) return { error: `URL must be public https: ${String(bad).slice(0, 80)}` };
  if (images.length > LIMITS.photos) return { error: `at most ${LIMITS.photos} photos per post, got ${images.length}` };
  const sch = scheduleOf(meta.scheduled_at, ctx.now);
  if (sch.error) return { error: sch.error };
  const kind = images.length > 1 ? 'album' : images.length === 1 ? 'photo' : link ? 'link' : 'text';
  return { kind, message, images, link, schedule: sch.at, labels: l, preview: `${sch.at ? 'schedule' : 'publish'} a Facebook Page ${kind} post (${[...message].length} characters${l.labels.length ? `, labelled ${l.labels.join(' + ')}` : ''})` };
}

async function sendReply(p, item, ctx) {
  const key = storeKey('facebook', item);
  const done = storeGet(ctx, key);
  if (done?.ref) return { ok: true, ref: done.ref, detail: `already replied on Facebook for approval ${item.id}` };
  const r = p.kind === 'dm'
    ? await fb(ctx, 'POST', `${ctx.env.FACEBOOK_PAGE_ID}/messages`, { recipient: { id: p.recipient }, messaging_type: 'RESPONSE', message: { text: p.text } })
    : await fb(ctx, 'POST', `${p.target}/comments`, { message: p.text });
  const ref = r.id ?? r.message_id ?? '';
  storePut(ctx, key, { ref, stage: 'replied' });
  return { ok: true, ref, detail: `replied to a Facebook ${p.kind === 'dm' ? 'Messenger conversation' : 'comment'}` };
}

export const facebook = defineConnector({
  name: 'facebook',
  handles: 'type "post" with channel "facebook" (Page feed, photo or multi-photo post, optional schedule) and type "reply" (comment or Messenger within 24 h)',
  needs: NEEDS,
  required: (env) => missingKeys(env, NEEDS),
  unverified: 'Page /photos takes the text as "message" and multi-photo posts use attached_media; verify against current Graph API docs.',
  accepts: (item) => ['post', 'reply'].includes(item.type) && CHANNELS.includes(String(item.channel ?? '').toLowerCase()),
  prepare(item, ctx) {
    return item.type === 'reply' ? prepareReply(item, ctx, { dmLimit: LIMITS.dm, dmBytes: null, name: 'Facebook' }) : preparePost(item, ctx);
  },
  async send(p, item, ctx) {
    if (p.reply) return sendReply(p, item, ctx);
    const key = storeKey('facebook', item);
    const prev = storeGet(ctx, key);
    if (prev?.ref) return { ok: true, ref: prev.ref, detail: `already published on Facebook for approval ${item.id}` };
    const page = ctx.env.FACEBOOK_PAGE_ID;
    // Scheduled posts: published=false + scheduled_publish_time (+ unpublished_content_type SCHEDULED,
    // as the Pages API documents for scheduled multi-photo posts).
    const when = p.schedule ? { published: false, scheduled_publish_time: p.schedule, unpublished_content_type: 'SCHEDULED' } : {};
    let r;
    if (p.kind === 'photo') {
      // The Page /photos edge takes the text as "caption" ("message" is deprecated there).
      r = await fb(ctx, 'POST', `${page}/photos`, { url: p.images[0], caption: p.message || undefined, ...(p.schedule ? { published: false, scheduled_publish_time: p.schedule } : {}) });
    } else if (p.kind === 'album') {
      // Unpublished photos are invisible until attached; a retry after a failure here only leaves
      // unattached uploads, never a duplicate post. Photos for a scheduled post are uploaded with
      // temporary=true (Page Photos reference), which keeps them for about 24 hours until attached.
      const ids = [];
      for (const url of p.images) {
        const ph = await fb(ctx, 'POST', `${page}/photos`, { url, published: false, ...(p.schedule ? { temporary: true } : {}) });
        if (!ph.id) throw new Error('Facebook photo upload returned no id');
        ids.push(ph.id);
      }
      const attached = Object.fromEntries(ids.map((id, i) => [`attached_media[${i}]`, { media_fbid: id }]));
      r = await fb(ctx, 'POST', `${page}/feed`, { message: p.message, ...attached, ...when });
    } else {
      r = await fb(ctx, 'POST', `${page}/feed`, { message: p.message, link: p.link || undefined, ...when });
    }
    const ref = r.post_id ?? r.id ?? '';
    if (!ref) throw new Error('Facebook returned no post id');
    storePut(ctx, key, { ref, stage: p.schedule ? 'scheduled' : 'published', kind: p.kind });
    return { ok: true, ref, detail: `${p.schedule ? 'scheduled' : 'published'} Facebook ${p.kind} post ${ref}` };
  },
});

export default facebook;
