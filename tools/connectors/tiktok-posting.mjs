// TikTok organic posting through the Content Posting API (open.tiktokapis.com/v2).
// An approved "post" item with channel tiktok/tiktok_organic posts a video (video_url) or a photo post
// (images, 1–35) pulled from a public https URL on a domain verified in the TikTok developer portal:
//   inbox draft (default)  POST /v2/post/publish/inbox/video/init/ {source_info: PULL_FROM_URL}
//                          photos: POST /v2/post/publish/content/init/ {post_mode: MEDIA_UPLOAD}
//                          The video lands in the creator's TikTok inbox; they finish and post it in the app.
//   direct post            POST /v2/post/publish/creator_info/query/ (privacy options, limits), then
//                          POST /v2/post/publish/video/init/ {post_info, source_info}
//                          photos: POST /v2/post/publish/content/init/ {post_mode: DIRECT_POST}
// Direct posting only when the owner set activate: true on the approval or the approved draft says
// mode: direct; otherwise it is an inbox draft (same idea as ad platforms starting paused).
// Disclosure: a sponsored draft must carry a label (kept in the caption) and turns on
// brand_content_toggle (paid partnership); brand_organic: true sets brand_organic_toggle;
// ai_generated / ai_label set is_aigc. A direct post needs privacy_level in the approved draft (TikTok
// allows no default) and it must be one of the creator's allowed options; branded content is never
// SELF_ONLY. An inbox video carries no caption through the API, so the result tells the owner to add
// the caption and labels in the app.
// Idempotent by approval id (products/<slug>/social/published.json keeps the publish_id).
// Needs TIKTOK_POSTING_ACCESS_TOKEN (a user token with video.publish and/or video.upload); this is not
// the Ads API token. Unaudited TikTok apps can only post privately (SELF_ONLY). Tests inject ctx.fetch.
import { defineConnector, request, fail, redact, loadDraft, missingKeys } from './_http.mjs';
import { labelsFor, withLabels, listOf, isHttpsUrl, truthy, storeGet, storePut, storeKey } from './_social-publish.mjs';

export const API = 'https://open.tiktokapis.com/v2';
export const CHANNELS = ['tiktok', 'tiktok_organic', 'tiktok-organic'];
const NEEDS = ['TIKTOK_POSTING_ACCESS_TOKEN'];
export const LIMITS = { title: 2200, photo_title: 90, photo_description: 4000, photos: 35 };
const PRIVACY_PREF = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'];

// TikTok answers {data, error: {code, message, log_id}}; code "ok" means success.
export async function tiktok(ctx, endpoint, json) {
  const r = await request(ctx, { url: `${API}/${endpoint}`, headers: { authorization: `Bearer ${ctx.env.TIKTOK_POSTING_ACCESS_TOKEN}`, 'content-type': 'application/json; charset=UTF-8' }, json });
  const code = r.data?.error?.code;
  if (!r.ok || (code && code !== 'ok')) throw new Error(r.ok ? `TikTok ${endpoint}: ${code} ${redact(r.data?.error?.message ?? '', ctx.env).slice(0, 200)}` : fail(r, ctx, `TikTok ${endpoint}`));
  return r.data?.data ?? {};
}

// The privacy level for a direct post. TikTok's Content Sharing Guidelines say the user picks it
// with no default, so it comes only from the approved draft (privacy_level) and must be one of the
// creator's allowed options; anything else is null and the post is refused.
export function pickPrivacy(options = [], wanted = '') {
  const opts = (Array.isArray(options) ? options : []).map(String);
  const w = String(wanted ?? '').trim().toUpperCase();
  return w && PRIVACY_PREF.includes(w) && opts.includes(w) ? w : null;
}

function prepare(item, ctx) {
  const d = loadDraft(item, ctx);
  const meta = d.spec ?? d.meta ?? {};
  const l = labelsFor(item, meta);
  // No fallback to the approval id or file title: only the draft's own text becomes the caption.
  const caption = withLabels(d.body || item.text || meta.title || '', l.labels);
  const video = listOf(meta.video_url)[0] ?? null;
  const photos = listOf(meta.images ?? meta.photo_images);
  if (!video && !photos.length) return { error: 'no media: TikTok posts need video_url or images' };
  const bad = [video, ...photos].filter(Boolean).find((u) => !isHttpsUrl(u));
  if (bad) return { error: `media URL must be public https on a verified domain: ${String(bad).slice(0, 80)}` };
  if (photos.length > LIMITS.photos) return { error: `a photo post takes at most ${LIMITS.photos} images, got ${photos.length}` };
  const kind = video ? 'video' : 'photo';
  const n = [...caption].length;
  if (kind === 'video' && n > LIMITS.title) return { error: `caption is ${n} characters; TikTok allows ${LIMITS.title}` };
  if (kind === 'photo' && n > LIMITS.photo_description) return { error: `description is ${n} characters; TikTok allows ${LIMITS.photo_description}` };
  const direct = item.activate === true || ['direct', 'direct_post'].includes(String(meta.mode ?? '').toLowerCase());
  const title = String(meta.photo_title ?? meta.title ?? '').trim();
  if (kind === 'photo' && [...title].length > LIMITS.photo_title) return { error: `photo title is ${[...title].length} characters; TikTok allows ${LIMITS.photo_title}` };
  const privacy = String(meta.privacy_level ?? meta.privacy ?? '').trim().toUpperCase();
  if (direct) {
    if (!PRIVACY_PREF.includes(privacy)) return { error: `a TikTok direct post needs privacy_level in the approved draft (${PRIVACY_PREF.join(', ')}); TikTok allows no default` };
    // Branded content cannot be private (TikTok Content Sharing Guidelines).
    if (l.sponsored && privacy === 'SELF_ONLY') return { error: 'branded content cannot be posted with privacy SELF_ONLY; choose a public or friends level' };
  }
  return {
    kind, video, photos, caption, direct, labels: l,
    title,
    privacy,
    flags: { disable_comment: truthy(meta.disable_comment), disable_duet: truthy(meta.disable_duet), disable_stitch: truthy(meta.disable_stitch), brand_content_toggle: l.sponsored, brand_organic_toggle: truthy(meta.brand_organic), is_aigc: l.ai_generated },
    cover_ms: Number.isFinite(Number(meta.video_cover_timestamp_ms)) ? Number(meta.video_cover_timestamp_ms) : undefined,
    duration: Number(meta.duration_sec) || null,
    preview: `${direct ? `direct-post (${privacy})` : 'send to the TikTok inbox as a draft'} a ${kind} (${n}-character caption${l.labels.length ? `, labelled ${l.labels.join(' + ')}` : ''}${l.sponsored ? (direct || kind === 'photo' ? ', paid partnership on' : '; the creator must add the caption and turn on the paid-partnership toggle in the app') : ''})`,
  };
}

async function send(p, item, ctx) {
  const key = storeKey('tiktok-posting', item);
  const prev = storeGet(ctx, key);
  if (prev?.ref) return { ok: true, ref: prev.ref, detail: `already sent to TikTok for approval ${item.id}` };
  let data; let privacy = null;
  if (p.direct) {
    const info = await tiktok(ctx, 'post/publish/creator_info/query/', {});
    privacy = pickPrivacy(info.privacy_level_options, p.privacy);
    if (!privacy) throw new Error(`privacy ${p.privacy} is not allowed for this creator (allowed: ${(info.privacy_level_options ?? []).join(', ') || 'none'}); nothing posted`);
    if (p.kind === 'video' && p.duration && info.max_video_post_duration_sec && p.duration > info.max_video_post_duration_sec) throw new Error(`video is ${p.duration}s; this creator can post up to ${info.max_video_post_duration_sec}s`);
    const f = { ...p.flags, disable_comment: p.flags.disable_comment || info.comment_disabled === true, disable_duet: p.flags.disable_duet || info.duet_disabled === true, disable_stitch: p.flags.disable_stitch || info.stitch_disabled === true };
    if (p.kind === 'video') {
      data = await tiktok(ctx, 'post/publish/video/init/', {
        post_info: { title: p.caption, privacy_level: privacy, ...f, ...(p.cover_ms !== undefined ? { video_cover_timestamp_ms: p.cover_ms } : {}) },
        source_info: { source: 'PULL_FROM_URL', video_url: p.video },
      });
    } else {
      data = await tiktok(ctx, 'post/publish/content/init/', {
        post_info: { title: p.title, description: p.caption, privacy_level: privacy, disable_comment: f.disable_comment, brand_content_toggle: f.brand_content_toggle, brand_organic_toggle: f.brand_organic_toggle, auto_add_music: true },
        source_info: { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: p.photos },
        post_mode: 'DIRECT_POST', media_type: 'PHOTO',
      });
    }
  } else if (p.kind === 'video') {
    data = await tiktok(ctx, 'post/publish/inbox/video/init/', { source_info: { source: 'PULL_FROM_URL', video_url: p.video } });
  } else {
    data = await tiktok(ctx, 'post/publish/content/init/', {
      post_info: { title: p.title, description: p.caption, brand_content_toggle: p.flags.brand_content_toggle, brand_organic_toggle: p.flags.brand_organic_toggle },
      source_info: { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: p.photos },
      post_mode: 'MEDIA_UPLOAD', media_type: 'PHOTO',
    });
  }
  const ref = data.publish_id ?? '';
  if (!ref) throw new Error('TikTok returned no publish_id');
  storePut(ctx, key, { ref, stage: p.direct ? 'direct' : 'inbox', kind: p.kind, privacy });
  // An inbox video carries no caption or disclosure through the API: the detail says so, so the owner
  // adds the caption, labels and paid-partnership toggle when finishing the post in the app.
  const inboxNote = !p.direct && p.kind === 'video' ? `; add the caption${p.labels.labels.length ? ` with ${p.labels.labels.join(' + ')}` : ''}${p.labels.sponsored ? ' and turn on the paid-partnership toggle' : ''} in the app` : '';
  return { ok: true, ref, detail: p.direct ? `TikTok ${p.kind} direct post started (${privacy}), publish_id ${ref}` : `TikTok ${p.kind} sent to the creator's inbox as a draft, publish_id ${ref}; finish it in the TikTok app${inboxNote}` };
}

// Status of a publish_id (PROCESSING_UPLOAD, PROCESSING_DOWNLOAD, SEND_TO_USER_INBOX, PUBLISH_COMPLETE,
// FAILED). Read-only. Never throws.
export async function postStatus(publishId, env = {}, opts = {}) {
  if (!/^[\w.~-]{1,120}$/.test(String(publishId ?? ''))) return { ok: false, detail: 'no publish_id' };
  if (missingKeys(env, NEEDS).length) return { ok: false, detail: `missing ${NEEDS.join(', ')}` };
  try {
    const d = await tiktok({ env, fetch: opts.fetch }, 'post/publish/status/fetch/', { publish_id: publishId });
    return { ok: true, status: d.status ?? 'UNKNOWN', fail_reason: d.fail_reason ?? null, post_ids: d.publicaly_available_post_id ?? d.publicly_available_post_id ?? [] };
  } catch (e) { return { ok: false, detail: redact(e.message ?? e, env) }; }
}

export const tiktokPosting = defineConnector({
  name: 'tiktok-posting',
  handles: 'type "post" with channel "tiktok" (Content Posting API: inbox draft by default, direct post when activated; video or photos pulled from a verified https URL)',
  needs: NEEDS,
  required: (env) => missingKeys(env, NEEDS),
  unverified: 'PULL_FROM_URL needs the media domain verified in the TikTok developer portal; unaudited apps post SELF_ONLY. Verify field names against current Content Posting API docs.',
  accepts: (item) => item.type === 'post' && CHANNELS.includes(String(item.channel ?? '').toLowerCase()),
  prepare,
  send,
});

export default tiktokPosting;
