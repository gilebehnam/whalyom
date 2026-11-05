// Native social publishing (Instagram, Facebook Page, TikTok Content Posting) and the unified social
// inbox. No network: every call goes through an injected fetch; files live in a temp folder.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import instagram, { waitForContainer } from '../connectors/instagram.mjs';
import facebook, { scheduleOf } from '../connectors/facebook.mjs';
import tiktokPosting, { pickPrivacy, postStatus } from '../connectors/tiktok-posting.mjs';
import tiktokAds from '../connectors/tiktok-ads.mjs';
import { labelsFor, withLabels } from '../connectors/_social-publish.mjs';
import { classifyMessage, draftReply, processMessages, runSocialInbox, normalizeMessage } from '../social-inbox.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-social-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const productDir = () => { const d = path.join(tmp, `p${n++}`); fs.mkdirSync(d, { recursive: true }); return d; };
const draft = (dir, name, text) => { fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true }); fs.writeFileSync(path.join(dir, name), text); return name; };

const NOW = '2026-11-04T12:00:00.000Z';
const IG_ENV = { INSTAGRAM_ACCESS_TOKEN: 'igtok-secret-123456', INSTAGRAM_USER_ID: '1789' };
const FB_ENV = { FACEBOOK_PAGE_ID: '555', FACEBOOK_PAGE_ACCESS_TOKEN: 'fbtok-secret-123456' };
const TT_ENV = { TIKTOK_POSTING_ACCESS_TOKEN: 'tttok-secret-123456' };

// Mock fetch: routes(url, init) → body object (or {status, body}). Records every call.
function mockFetch(route) {
  const calls = [];
  const f = async (url, init = {}) => {
    const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : typeof init.body === 'string' ? JSON.parse(init.body) : null;
    const call = { url, method: init.method, headers: init.headers ?? {}, body };
    calls.push(call);
    const out = route(call, calls) ?? {};
    const status = out.__status ?? 200;
    const text = JSON.stringify(out.__status ? out.body ?? {} : out);
    return { ok: status < 400, status, text: async () => text, headers: { get: () => null } };
  };
  return { f, calls };
}
const ctxFor = (dir, env, fetch, extra = {}) => ({ slug: 'demo', dir, env, now: NOW, dryRun: false, fetch, sleep: async () => {}, ...extra });

test('disclosure: sponsored without a label is refused; labels are kept at the start of the caption', () => {
  assert.throws(() => labelsFor({}, { sponsored: 'true' }), /no disclosure label/);
  assert.throws(() => labelsFor({}, { disclosure: 'thanks to our friends' }), /not a clear ad label/);
  const l = labelsFor({}, { disclosure: '#ad', ai_label: 'Made with AI' });
  assert.equal(l.sponsored, true);
  assert.equal(withLabels('New drop today', l.labels), '#ad · Made with AI\nNew drop today');
  assert.equal(withLabels('New drop today #ad', ['#ad']), 'New drop today #ad');
  // A label inside another word does not count: "#adventure" is not "#ad", "add" is not "Ad".
  assert.equal(withLabels('Our #adventure starts', ['#ad']), '#ad\nOur #adventure starts');
  assert.equal(withLabels('add to cart', ['Ad']), 'Ad\nadd to cart');
});

test('instagram: image post makes a container, publishes it, keeps the token out of URLs, and is idempotent by approval id', async () => {
  const dir = productDir();
  const file = draft(dir, 'outbox/ig.md', '---\nimage_url: https://cdn.example.com/a.jpg\ndisclosure: #ad\n---\nOur new mug is here #coffee\n');
  const { f, calls } = mockFetch(({ url }) => (url.endsWith('/1789/media') ? { id: 'C1' } : url.endsWith('/media_publish') ? { id: 'M1' } : { error: { message: 'unexpected' } }));
  const item = { id: 'A1', type: 'post', channel: 'instagram', file };
  const r = await instagram.execute(item, ctxFor(dir, IG_ENV, f));
  assert.equal(r.ok, true, r.detail);
  assert.equal(r.ref, 'M1');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.image_url, 'https://cdn.example.com/a.jpg');
  assert.match(calls[0].body.caption, /^#ad\nOur new mug/);
  assert.equal(calls[1].body.creation_id, 'C1');
  for (const c of calls) { assert.ok(!c.url.includes('igtok'), 'token never in URL'); assert.equal(c.headers.authorization, 'Bearer igtok-secret-123456'); }
  // Retry of the same approval: no network, same ref.
  const again = await instagram.execute(item, ctxFor(dir, IG_ENV, f));
  assert.equal(again.ok, true);
  assert.equal(again.ref, 'M1');
  assert.equal(calls.length, 2);
  const store = JSON.parse(fs.readFileSync(path.join(dir, 'social', 'published.json'), 'utf8'));
  assert.equal(store['instagram:A1'].ref, 'M1');
});

test('instagram: reel waits for FINISHED; a container still processing is resumed, not recreated', async () => {
  const dir = productDir();
  const file = draft(dir, 'outbox/reel.md', '---\nformat: reel\nvideo_url: https://cdn.example.com/v.mp4\nshare_to_feed: false\n---\nBehind the scenes\n');
  let state = 'IN_PROGRESS';
  const { f, calls } = mockFetch(({ url, method }) => {
    if (method === 'GET') return { status_code: state };
    if (url.endsWith('/1789/media')) return { id: 'R1' };
    if (url.endsWith('/media_publish')) return { id: 'MR1' };
    return {};
  });
  const item = { id: 'A2', type: 'post', channel: 'ig', file };
  const env = { ...IG_ENV, INSTAGRAM_POLL_ATTEMPTS: '2' };
  const first = await instagram.execute(item, ctxFor(dir, env, f));
  assert.equal(first.ok, false);
  assert.match(first.detail, /still processing container R1/);
  assert.equal(calls.filter((c) => c.url.endsWith('/1789/media')).length, 1);
  assert.equal(calls[0].body.media_type, 'REELS');
  assert.equal(calls[0].body.share_to_feed, 'false');
  state = 'FINISHED';
  const second = await instagram.execute(item, ctxFor(dir, env, f));
  assert.equal(second.ok, true, second.detail);
  assert.equal(second.ref, 'MR1');
  assert.equal(calls.filter((c) => c.url.endsWith('/1789/media')).length, 1, 'same container reused');
  assert.equal(calls.at(-1).body.creation_id, 'R1');
  // ERROR clears the stored container so the next try makes a new one.
  const s = await waitForContainer({ env, fetch: mockFetch(() => ({ status_code: 'ERROR' })).f, sleep: async () => {} }, 'X');
  assert.equal(s, 'failed');
});

test('instagram: carousel builds children then a CAROUSEL container; limits are refused, never cut', async () => {
  const dir = productDir();
  const file = draft(dir, 'outbox/car.json', JSON.stringify({ text: 'Three looks', media: [{ type: 'image', url: 'https://cdn.example.com/1.jpg' }, { type: 'image', url: 'https://cdn.example.com/2.jpg' }, { type: 'video', url: 'https://cdn.example.com/3.mp4' }] }));
  let k = 0;
  const { f, calls } = mockFetch(({ url, method, body }) => {
    if (method === 'GET') return { status_code: 'FINISHED' };
    if (url.endsWith('/media_publish')) return { id: 'MC' };
    if (body?.media_type === 'CAROUSEL') return { id: 'CAR' };
    return { id: `K${++k}` };
  });
  const r = await instagram.execute({ id: 'A3', type: 'post', channel: 'instagram', file }, ctxFor(dir, IG_ENV, f));
  assert.equal(r.ok, true, r.detail);
  const car = calls.find((c) => c.body?.media_type === 'CAROUSEL');
  assert.equal(car.body.children, 'K1,K2,K3');
  assert.equal(calls.filter((c) => c.body?.is_carousel_item === 'true').length, 3);
  assert.equal(calls.find((c) => c.body?.media_type === 'VIDEO').body.video_url, 'https://cdn.example.com/3.mp4');

  const many = draft(dir, 'outbox/tags.md', `---\nimage_url: https://cdn.example.com/a.jpg\n---\n${Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ')}\n`);
  const bad = await instagram.execute({ id: 'A4', type: 'post', channel: 'instagram', file: many }, ctxFor(dir, IG_ENV, f));
  assert.equal(bad.ok, false);
  assert.match(bad.detail, /31 hashtags/);
  const http = draft(dir, 'outbox/http.md', '---\nimage_url: http://cdn.example.com/a.jpg\n---\nhi\n');
  assert.match((await instagram.execute({ id: 'A5', type: 'post', channel: 'instagram', file: http }, ctxFor(dir, IG_ENV, f))).detail, /public https/);
  const spons = draft(dir, 'outbox/sp.md', '---\nimage_url: https://cdn.example.com/a.jpg\nsponsored: true\n---\nhi\n');
  assert.match((await instagram.execute({ id: 'A6', type: 'post', channel: 'instagram', file: spons }, ctxFor(dir, IG_ENV, f))).detail, /disclosure/);
  // format image with several media is refused, not cut to the first one.
  const two = draft(dir, 'outbox/two.md', '---\nformat: image\nimages: https://cdn.example.com/1.jpg, https://cdn.example.com/2.jpg\n---\nhi\n');
  assert.match((await instagram.execute({ id: 'A7', type: 'post', channel: 'instagram', file: two }, ctxFor(dir, IG_ENV, f))).detail, /exactly one image/);
  // A carousel video child that never finishes processing stops before the CAROUSEL container.
  const stuck = mockFetch(({ method, body }) => (method === 'GET' ? { status_code: 'IN_PROGRESS' } : body?.media_type === 'CAROUSEL' ? { id: 'NO' } : { id: 'KK' }));
  const r2 = await instagram.execute({ id: 'A8', type: 'post', channel: 'instagram', file }, ctxFor(dir, { ...IG_ENV, INSTAGRAM_POLL_ATTEMPTS: '1' }, stuck.f));
  assert.equal(r2.ok, false);
  assert.match(r2.detail, /still processing/);
  assert.ok(!stuck.calls.some((c) => c.body?.media_type === 'CAROUSEL' || c.url.endsWith('/media_publish')), 'nothing published');
});

test('instagram: dry run and missing keys make no network call; routing stays on its own channels', async () => {
  const dir = productDir();
  const file = draft(dir, 'outbox/ig.md', '---\nimage_url: https://cdn.example.com/a.jpg\n---\nhello\n');
  const { f, calls } = mockFetch(() => ({ id: 'x' }));
  const dry = await instagram.execute({ id: 'D1', type: 'post', channel: 'instagram', file }, ctxFor(dir, IG_ENV, f, { dryRun: true }));
  assert.equal(dry.ok, true);
  assert.match(dry.detail, /would publish an Instagram image/);
  const miss = await instagram.execute({ id: 'D2', type: 'post', channel: 'instagram', file }, ctxFor(dir, {}, f));
  assert.equal(miss.ok, false);
  assert.match(miss.detail, /missing INSTAGRAM_ACCESS_TOKEN/);
  assert.equal(calls.length, 0);
  assert.equal(instagram.accepts({ type: 'spend', channel: 'instagram' }), false);
  assert.equal(facebook.accepts({ type: 'spend', channel: 'meta' }), false);
  assert.equal(tiktokPosting.accepts({ type: 'spend', channel: 'tiktok' }), false);
  assert.equal(tiktokAds.accepts({ type: 'post', channel: 'tiktok' }), false);
  assert.equal(tiktokPosting.accepts({ type: 'post', channel: 'tiktok' }), true);
  assert.equal(instagram.accepts({ type: 'reply', channel: 'instagram' }), true);
  assert.equal(instagram.configured(IG_ENV), true);
  assert.equal(instagram.configured({}), false);
});

test('instagram replies: comment reply goes to /{comment}/replies; a DM outside 24 hours is refused', async () => {
  const dir = productDir();
  const c = draft(dir, 'outbox/r1.md', '---\nreply_kind: comment\nreply_to: 1801\n---\nThanks!\n');
  const { f, calls } = mockFetch(() => ({ id: 'RP1' }));
  const r = await instagram.execute({ id: 'R1', type: 'reply', channel: 'instagram', file: c }, ctxFor(dir, IG_ENV, f));
  assert.equal(r.ok, true, r.detail);
  assert.match(calls[0].url, /\/1801\/replies$/);
  assert.equal(calls[0].body.message, 'Thanks!');
  const old = draft(dir, 'outbox/r2.md', '---\nreply_kind: dm\nrecipient: 9911\nreceived_at: 2026-11-01T00:00:00.000Z\n---\nHi\n');
  const dm = await instagram.execute({ id: 'R2', type: 'reply', channel: 'instagram', file: old }, ctxFor(dir, IG_ENV, f));
  assert.equal(dm.ok, false);
  assert.match(dm.detail, /24 hours/);
  const fresh = draft(dir, 'outbox/r3.md', '---\nreply_kind: dm\nrecipient: 9911\nreceived_at: 2026-11-04T10:00:00.000Z\n---\nHi\n');
  const ok = await instagram.execute({ id: 'R3', type: 'reply', channel: 'instagram', file: fresh }, ctxFor(dir, IG_ENV, f));
  assert.equal(ok.ok, true, ok.detail);
  assert.match(calls.at(-1).url, /\/1789\/messages$/);
  assert.deepEqual(JSON.parse(calls.at(-1).body.recipient), { id: '9911' });
  // Facebook Login: the DM goes through the linked Page with the Page token.
  const viaPage = await instagram.execute({ id: 'R4', type: 'reply', channel: 'instagram', file: fresh }, ctxFor(dir, { ...IG_ENV, ...FB_ENV }, f));
  assert.equal(viaPage.ok, true, viaPage.detail);
  assert.match(calls.at(-1).url, /\/555\/messages$/);
  assert.equal(calls.at(-1).headers.authorization, 'Bearer fbtok-secret-123456');
  // Unknown or future received_at is refused; Instagram DMs are limited in bytes (Persian text).
  const future = draft(dir, 'outbox/r5.md', '---\nreply_kind: dm\nrecipient: 9911\nreceived_at: 2027-01-01T00:00:00.000Z\n---\nHi\n');
  assert.match((await instagram.execute({ id: 'R5', type: 'reply', channel: 'instagram', file: future }, ctxFor(dir, IG_ENV, f))).detail, /24 hours/);
  const nodate = draft(dir, 'outbox/r6.md', '---\nreply_kind: dm\nrecipient: 9911\n---\nHi\n');
  assert.match((await instagram.execute({ id: 'R6', type: 'reply', channel: 'instagram', file: nodate }, ctxFor(dir, IG_ENV, f))).detail, /24 hours/);
  const long = draft(dir, 'outbox/r7.md', `---\nreply_kind: dm\nrecipient: 9911\nreceived_at: 2026-11-04T10:00:00.000Z\n---\n${'س'.repeat(600)}\n`);
  assert.match((await instagram.execute({ id: 'R7', type: 'reply', channel: 'instagram', file: long }, ctxFor(dir, IG_ENV, f))).detail, /1200 bytes/);
  // Suppression: a listed contact gets no reply; an unreadable list refuses (fails closed).
  const sent = calls.length;
  fs.writeFileSync(path.join(dir, 'suppression.json'), JSON.stringify({ entries: [{ lead: 'SOC-ig-abc' }] }));
  const sup = await instagram.execute({ id: 'R8', type: 'reply', channel: 'instagram', file: c, contact: 'SOC-ig-abc' }, ctxFor(dir, IG_ENV, f));
  assert.equal(sup.ok, false);
  assert.match(sup.detail, /suppression/);
  fs.writeFileSync(path.join(dir, 'suppression.json'), '{broken');
  assert.match((await facebook.execute({ id: 'R9', type: 'reply', channel: 'facebook', file: c, lead: 'SOC-fb-x' }, ctxFor(dir, FB_ENV, f))).detail, /unreadable/);
  assert.equal(calls.length, sent, 'no network call for suppressed replies');
});

test('facebook: link post to /feed, single photo to /photos, album via attached_media, schedule window enforced', async () => {
  const dir = productDir();
  const link = draft(dir, 'outbox/fb1.md', '---\nlink: https://example.com/launch\ndisclosure: Paid partnership\n---\nWe launched.\n');
  const { f, calls } = mockFetch(({ url, body }) => (url.endsWith('/photos') ? { id: `PH${calls.length}`, post_id: body?.published === 'false' ? undefined : '555_PHOTO' } : { id: '555_1' }));
  const r1 = await facebook.execute({ id: 'F1', type: 'post', channel: 'facebook', file: link }, ctxFor(dir, FB_ENV, f));
  assert.equal(r1.ok, true, r1.detail);
  assert.match(calls[0].url, /\/555\/feed$/);
  assert.equal(calls[0].body.link, 'https://example.com/launch');
  assert.match(calls[0].body.message, /^Paid partnership\nWe launched\./);
  assert.equal(calls[0].headers.authorization, 'Bearer fbtok-secret-123456');

  const photo = draft(dir, 'outbox/fb2.md', '---\nimage_url: https://cdn.example.com/p.jpg\n---\nLook\n');
  const r2 = await facebook.execute({ id: 'F2', type: 'post', channel: 'fb', file: photo }, ctxFor(dir, FB_ENV, f));
  assert.equal(r2.ref, '555_PHOTO');

  const album = draft(dir, 'outbox/fb3.md', '---\nimages: https://cdn.example.com/1.jpg, https://cdn.example.com/2.jpg\nscheduled_at: 2026-11-05T12:00:00.000Z\n---\nTwo\n');
  const before = calls.length;
  const r3 = await facebook.execute({ id: 'F3', type: 'post', channel: 'facebook', file: album }, ctxFor(dir, FB_ENV, f));
  assert.equal(r3.ok, true, r3.detail);
  const mine = calls.slice(before);
  assert.equal(mine.filter((c) => c.url.endsWith('/photos') && c.body.published === 'false').length, 2);
  const feed = mine.at(-1);
  assert.match(feed.url, /\/feed$/);
  assert.ok(feed.body['attached_media[0]'] && feed.body['attached_media[1]']);
  assert.equal(feed.body.published, 'false');
  assert.equal(feed.body.unpublished_content_type, 'SCHEDULED');
  assert.ok(mine.filter((c) => c.url.endsWith('/photos')).every((c) => c.body.temporary === 'true'), 'scheduled album photos are temporary');
  assert.equal(Number(feed.body.scheduled_publish_time), Math.floor(Date.parse('2026-11-05T12:00:00.000Z') / 1000));
  assert.match(r3.detail, /scheduled/);
  assert.match(scheduleOf('2026-11-04T12:05:00.000Z', NOW).error, /10 minutes/);

  // Idempotent and reply path.
  const again = await facebook.execute({ id: 'F1', type: 'post', channel: 'facebook', file: link }, ctxFor(dir, FB_ENV, f));
  assert.match(again.detail, /already published/);
  const rep = draft(dir, 'outbox/fbr.md', '---\nreply_kind: comment\nreply_to: 555_1_77\n---\nThanks for asking!\n');
  const rr = await facebook.execute({ id: 'F4', type: 'reply', channel: 'facebook', file: rep }, ctxFor(dir, FB_ENV, f));
  assert.equal(rr.ok, true, rr.detail);
  assert.match(calls.at(-1).url, /\/555_1_77\/comments$/);
});

test('tiktok: inbox draft by default; direct post only when activated, privacy from the creator options, paid partnership on', async () => {
  const dir = productDir();
  const file = draft(dir, 'outbox/tt.md', '---\nvideo_url: https://media.example.com/v.mp4\ndisclosure: #ad\nai_generated: true\n---\nHow we pack orders\n');
  const { f, calls } = mockFetch(({ url }) => {
    if (url.endsWith('creator_info/query/')) return { data: { privacy_level_options: ['FOLLOWER_OF_CREATOR', 'SELF_ONLY'], comment_disabled: true, max_video_post_duration_sec: 600 }, error: { code: 'ok' } };
    return { data: { publish_id: `v_pub_${calls.length}` }, error: { code: 'ok', message: '' } };
  });
  const inbox = await tiktokPosting.execute({ id: 'T1', type: 'post', channel: 'tiktok', file }, ctxFor(dir, TT_ENV, f));
  assert.equal(inbox.ok, true, inbox.detail);
  assert.match(calls[0].url, /\/post\/publish\/inbox\/video\/init\/$/);
  assert.deepEqual(calls[0].body.source_info, { source: 'PULL_FROM_URL', video_url: 'https://media.example.com/v.mp4' });
  assert.match(inbox.detail, /inbox as a draft/);

  assert.match(inbox.detail, /add the caption with #ad/);
  assert.match(inbox.detail, /paid-partnership toggle/);

  // Direct post without a privacy_level in the draft is refused (TikTok allows no default); no network.
  const before = calls.length;
  const noPriv = await tiktokPosting.execute({ id: 'T0', type: 'post', channel: 'tiktok', file, activate: true }, ctxFor(dir, TT_ENV, f));
  assert.equal(noPriv.ok, false);
  assert.match(noPriv.detail, /privacy_level/);
  // Branded content cannot be private.
  const priv = draft(dir, 'outbox/ttself.md', '---\nvideo_url: https://media.example.com/v.mp4\ndisclosure: #ad\nprivacy_level: SELF_ONLY\n---\nHi\n');
  assert.match((await tiktokPosting.execute({ id: 'T0b', type: 'post', channel: 'tiktok', file: priv, activate: true }, ctxFor(dir, TT_ENV, f))).detail, /SELF_ONLY/);
  // A privacy level the creator does not allow is refused after creator_info, before any init.
  const pub = draft(dir, 'outbox/ttpub.md', '---\nvideo_url: https://media.example.com/v.mp4\nprivacy_level: PUBLIC_TO_EVERYONE\n---\nHi\n');
  const notAllowed = await tiktokPosting.execute({ id: 'T0c', type: 'post', channel: 'tiktok', file: pub, activate: true }, ctxFor(dir, TT_ENV, f));
  assert.equal(notAllowed.ok, false);
  assert.match(notAllowed.detail, /not allowed/);
  assert.deepEqual(calls.slice(before).map((c) => c.url.split('/v2/')[1]), ['post/publish/creator_info/query/']);

  const file2 = draft(dir, 'outbox/tt2.md', '---\nvideo_url: https://media.example.com/v.mp4\ndisclosure: #ad\nai_generated: true\nprivacy_level: FOLLOWER_OF_CREATOR\n---\nHow we pack orders\n');
  const direct = await tiktokPosting.execute({ id: 'T2', type: 'post', channel: 'tiktok', file: file2, activate: true }, ctxFor(dir, TT_ENV, f));
  assert.equal(direct.ok, true, direct.detail);
  const init = calls.at(-1);
  assert.match(init.url, /\/post\/publish\/video\/init\/$/);
  assert.equal(init.body.post_info.privacy_level, 'FOLLOWER_OF_CREATOR');
  assert.equal(init.body.post_info.brand_content_toggle, true);
  assert.equal(init.body.post_info.is_aigc, true);
  assert.equal(init.body.post_info.disable_comment, true);
  assert.match(init.body.post_info.title, /^#ad\nHow we pack/);
  assert.equal(init.headers.authorization, 'Bearer tttok-secret-123456');
  const count = calls.length;
  assert.equal((await tiktokPosting.execute({ id: 'T2', type: 'post', channel: 'tiktok', file: file2, activate: true }, ctxFor(dir, TT_ENV, f))).ok, true);
  assert.equal(calls.length, count, 'idempotent');

  const photos = draft(dir, 'outbox/ttp.md', '---\nimages: https://media.example.com/1.jpg, https://media.example.com/2.jpg\n---\nTwo looks\n');
  const p = await tiktokPosting.execute({ id: 'T3', type: 'post', channel: 'tiktok', file: photos }, ctxFor(dir, TT_ENV, f));
  assert.equal(p.ok, true, p.detail);
  assert.equal(calls.at(-1).body.post_mode, 'MEDIA_UPLOAD');
  assert.equal(calls.at(-1).body.media_type, 'PHOTO');
  assert.equal(calls.at(-1).body.post_info.title, '', 'the approval id never becomes a public title');

  assert.equal(pickPrivacy(['SELF_ONLY', 'PUBLIC_TO_EVERYONE'], 'self_only'), 'SELF_ONLY');
  assert.equal(pickPrivacy(['SELF_ONLY', 'PUBLIC_TO_EVERYONE']), null, 'no default privacy');
  assert.equal(pickPrivacy(['SELF_ONLY'], 'PUBLIC_TO_EVERYONE'), null);
  assert.equal(pickPrivacy([]), null);
});

test('tiktok: API errors are reported with the token redacted; status is read-only', async () => {
  const dir = productDir();
  const file = draft(dir, 'outbox/tt.md', '---\nvideo_url: https://media.example.com/v.mp4\n---\nHi\n');
  const { f } = mockFetch(() => ({ data: {}, error: { code: 'access_token_invalid', message: 'token tttok-secret-123456 is bad' } }));
  const r = await tiktokPosting.execute({ id: 'T9', type: 'post', channel: 'tiktok', file }, ctxFor(dir, TT_ENV, f));
  assert.equal(r.ok, false);
  assert.match(r.detail, /access_token_invalid/);
  assert.ok(!r.detail.includes('tttok-secret'), 'secret redacted');
  assert.ok(!fs.existsSync(path.join(dir, 'social', 'published.json')), 'nothing stored on failure');
  const s = await postStatus('v_pub_1', TT_ENV, { fetch: mockFetch(() => ({ data: { status: 'PUBLISH_COMPLETE' }, error: { code: 'ok' } })).f });
  assert.equal(s.status, 'PUBLISH_COMPLETE');
  assert.equal((await postStatus('v_pub_1', {})).ok, false);
  const noMedia = draft(dir, 'outbox/none.md', 'just text\n');
  assert.match((await tiktokPosting.execute({ id: 'T10', type: 'post', channel: 'tiktok', file: noMedia }, ctxFor(dir, TT_ENV, f))).detail, /no media/);
});

test('social inbox: classification in English and Persian; drafts make no claims and skip spam', () => {
  assert.equal(classifyMessage('Follow for follow! check my page').class, 'spam');
  assert.equal(classifyMessage('Mine arrived broken, I want a refund').class, 'complaint');
  assert.deepEqual(classifyMessage('How much is the large one?'), { class: 'lead', signal: 'strong' });
  assert.deepEqual(classifyMessage('Interested, tell me more'), { class: 'lead', signal: 'weak' });
  assert.equal(classifyMessage('Does it work with oat milk?').class, 'question');
  assert.equal(classifyMessage('Love the colors').class, 'other');
  assert.deepEqual(classifyMessage('قیمتش چنده؟'), { class: 'lead', signal: 'strong' });
  assert.equal(classifyMessage('سفارشم خراب رسید').class, 'complaint');
  assert.equal(classifyMessage('این با شیر گیاهی کار می‌کند؟').class, 'question');
  const m = { kind: 'comment', text: 'How much?' };
  assert.match(draftReply(m, 'lead', { domain: 'https://shop.example.com/' }), /shop\.example\.com/);
  assert.match(draftReply({ kind: 'comment', text: 'قیمت؟' }, 'lead', {}), /ممنون/);
  assert.equal(draftReply(m, 'spam', {}), null);
  assert.equal(draftReply(m, 'other', {}), null);
  assert.equal(normalizeMessage({ id: '', text: 'x' }), null);
  // Ids that could inject front-matter lines into a reply draft are refused.
  assert.equal(normalizeMessage({ platform: 'tiktok', id: 'a\nrecipient: 999', text: 'price?' }), null);
  assert.equal(normalizeMessage({ platform: 'tiktok', id: 'a', user_id: 'u\nreply_kind: dm', text: 'price?' }), null);
});

test('social inbox: a person on suppression.json gets no draft and no funnel move; approvals carry the contact id', () => {
  const msgs = [normalizeMessage({ platform: 'instagram', id: 's1', text: 'How much is it?', user_id: 'u1', at: NOW }), normalizeMessage({ platform: 'instagram', id: 's2', text: 'How much is it?', user_id: 'u2', at: NOW })];
  const first = processMessages({ messages: msgs, now: NOW });
  const blocked = first.approvals[0].contact;
  assert.match(blocked, /^SOC-ig-/);
  assert.ok(first.drafts[0].content.includes(`contact: ${blocked}`));
  const res = processMessages({ messages: msgs, now: NOW, suppressed: [blocked] });
  assert.equal(res.approvals.length, 1);
  assert.notEqual(res.approvals[0].contact, blocked);
  assert.equal(res.leads.length, 1);
  assert.equal(res.stats.suppressed, 1);
});

test('social inbox: pulls Instagram and Facebook, reads drop files, drafts reply approvals, moves leads; usernames stay in the product folder', async () => {
  const root = path.join(tmp, 'root');
  const slug = 'demo';
  const dir = path.join(root, 'products', slug);
  fs.mkdirSync(path.join(dir, 'social-inbox', 'drop'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'product.json'), JSON.stringify({ name: 'Demo', domain: 'demo.example.com', stage: 'live' }));
  fs.writeFileSync(path.join(dir, 'social-inbox', 'drop', 'tt.json'), JSON.stringify({ messages: [{ platform: 'tiktok', kind: 'comment', id: 'tt1', text: 'Where can I buy this?', username: 'tt_jane', user_id: 'u77', at: '2026-11-04T09:00:00Z' }] }));
  const env = { ...IG_ENV, ...FB_ENV };
  const { f, calls } = mockFetch(({ url }) => {
    if (url.includes('/1789/media?')) return { data: [{ id: 'm1' }] };
    if (url.includes('/m1/comments?')) return { data: [
      { id: 'c1', text: 'How much is it?', username: 'ig_alice', from: { id: 'a1', username: 'ig_alice' }, timestamp: '2026-11-04T08:00:00+0000' },
      { id: 'c2', text: 'Follow for follow, check my profile', username: 'spammy', from: { id: 's1' }, timestamp: '2026-11-04T08:00:00+0000' },
      { id: 'c3', text: 'Thanks all!', username: 'us', from: { id: '1789' }, timestamp: '2026-11-04T08:00:00+0000' },
    ] };
    if (url.includes('platform=instagram')) return { data: [{ id: 't1', messages: { data: [{ id: 'dm1', message: 'My order never arrived', from: { id: 'b2', username: 'ig_bob' }, created_time: '2026-11-04T07:00:00+0000' }] } }] };
    if (url.includes('/555/feed?')) return { data: [{ id: '555_1', comments: { data: [{ id: '555_1_9', message: 'Does it ship to Canada?', from: { id: 'c3', name: 'Carol Example' }, created_time: '2026-10-01T00:00:00+0000' }] } }] };
    if (url.includes('platform=messenger')) return { data: [] };
    return { error: { message: 'unexpected' } };
  });
  const res = await runSocialInbox(slug, { now: NOW, env, root, fetch: f });
  assert.deepEqual(res.pulled.sort(), ['facebook', 'instagram']);
  assert.ok(calls.every((c) => c.method === 'GET'), 'pulls are read-only');
  assert.ok(calls.every((c) => !/tok-secret/.test(c.url)), 'tokens never in URLs');
  assert.equal(res.new, 5);
  assert.equal(res.by_class.spam, 1);
  assert.equal(res.by_class.lead, 3);
  assert.equal(res.by_class.complaint, 1);
  assert.equal(res.skipped_old, 1, 'the October Facebook comment is stored, not answered');
  assert.equal(res.drafted, 3, 'IG lead, IG DM complaint, TikTok lead');
  assert.ok(!JSON.stringify(res).match(/ig_alice|ig_bob|tt_jane|Carol/), 'no usernames in the printed result');

  const ledger = JSON.parse(fs.readFileSync(path.join(dir, 'social-inbox', 'messages.json'), 'utf8'));
  assert.ok(ledger.messages.some((m) => m.username === 'ig_alice'), 'usernames kept in products/<slug>/social-inbox');
  const run = JSON.parse(fs.readFileSync(path.join(dir, res.run), 'utf8'));
  assert.equal(run.approvals.length, 3);
  assert.ok(run.approvals.every((a) => a.type === 'reply' && /^SOC-/.test(a.id)));
  assert.ok(!JSON.stringify(run).match(/ig_alice|ig_bob|tt_jane|Carol/), 'approvals and alerts carry no usernames');
  assert.ok(run.alerts.some((a) => /Complaint on instagram/.test(a.title)));
  const dm = run.approvals.find((a) => a.channel === 'instagram' && a.expires_at);
  assert.ok(dm, 'a DM reply expires with the 24-hour window');
  const dmDraft = fs.readFileSync(path.join(dir, dm.file), 'utf8');
  assert.match(dmDraft, /reply_kind: dm/);
  assert.match(dmDraft, /recipient: b2/);

  const leads = JSON.parse(fs.readFileSync(path.join(dir, 'leads', 'social-inbox.json'), 'utf8'));
  assert.equal(leads.length, 3);
  assert.ok(leads.every((l) => /^SOC-/.test(l.lead_id) && !('username' in l)));
  const upd = fs.readdirSync(path.join(dir, 'funnel', 'updates')).map((x) => JSON.parse(fs.readFileSync(path.join(dir, 'funnel', 'updates', x), 'utf8')));
  assert.ok(upd.some((u) => u.stage === 'qualified' && u.source === 'social-inbox'));
  assert.ok(fs.existsSync(path.join(dir, 'social-inbox', 'drop', 'done', 'tt.json')));
  assert.ok(!fs.existsSync(path.join(root, 'state')), 'nothing written to state/');

  // The drafted comment reply is executable by the Instagram connector as is.
  const igLead = run.approvals.find((a) => a.channel === 'instagram' && !a.expires_at);
  const sent = mockFetch(() => ({ id: 'RPL' }));
  const r = await instagram.execute({ ...igLead, status: 'approved' }, { slug, dir, env, now: NOW, fetch: sent.f });
  assert.equal(r.ok, true, r.detail);
  assert.match(sent.calls[0].url, /\/c1\/replies$/);
  assert.match(sent.calls[0].body.message, /demo\.example\.com/);

  // Second run: same messages, nothing new.
  const again = await runSocialInbox(slug, { now: NOW, env, root, fetch: f });
  assert.equal(again.new, 0);
  assert.equal(again.drafted, 0);
  assert.equal(again.run, null);

  // Paused product: no pull, no drafts.
  fs.writeFileSync(path.join(dir, 'product.json'), JSON.stringify({ name: 'Demo', stage: 'paused' }));
  const before = calls.length;
  const paused = await runSocialInbox(slug, { now: NOW, env, root, fetch: f });
  assert.equal(paused.paused, true);
  assert.equal(calls.length, before);
});

test('social inbox: a corrupt ledger stops the run before anything moves; the draft cap holds', async () => {
  const root = path.join(tmp, 'root2');
  const dir = path.join(root, 'products', 'demo');
  fs.mkdirSync(path.join(dir, 'social-inbox', 'drop'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'product.json'), JSON.stringify({ stage: 'live' }));
  fs.writeFileSync(path.join(dir, 'social-inbox', 'messages.json'), '{broken');
  fs.writeFileSync(path.join(dir, 'social-inbox', 'drop', 'x.json'), JSON.stringify([{ platform: 'tiktok', id: 'a', text: 'price?' }]));
  await assert.rejects(runSocialInbox('demo', { now: NOW, env: {}, root, pull: false }), /not valid JSON/);
  assert.ok(fs.existsSync(path.join(dir, 'social-inbox', 'drop', 'x.json')));
  const msgs = Array.from({ length: 5 }, (_, i) => normalizeMessage({ platform: 'instagram', id: `q${i}`, text: 'How does it work?', user_id: `u${i}`, at: NOW }));
  const res = processMessages({ messages: msgs, product: { social_inbox: { max_drafts: 2 } }, now: NOW });
  assert.equal(res.approvals.length, 2);
  assert.equal(res.stats.capped, 3);
  assert.ok(res.alerts.some((a) => /not drafted/.test(a.title)));
});
