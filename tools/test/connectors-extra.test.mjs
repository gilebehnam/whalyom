// Extended connectors: every one is exercised with a mocked fetch (no real network), checks auth
// and payload shape, dry-run behaviour without keys, secret redaction, and routing through pick().
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pick } from '../connectors/index.mjs';
import { indexnow, gscSitemap } from '../connectors/indexing.mjs';
import { bluesky, mastodon, telegram, discord, slack, linkedin, buffer, linkFacets, escapeLittleText } from '../connectors/social.mjs';
import x, { oauth1Header, splitThread } from '../connectors/x.mjs';
import { devto, hashnode, medium, wordpress, ghost, ghostToken } from '../connectors/blogs.mjs';
import { mailchimp, brevo, convertkit } from '../connectors/newsletters.mjs';
import { googleAds, microsoftAds, googleAdsCsv, microsoftAdsCsv, tiktokAdsCsv, redditAdsCsv } from '../connectors/ads.mjs';
import { stripe, plausible, umami, ga4, calcom, calendly, pullMetrics, pullLinks } from '../connectors/readers.mjs';
import { extraStatus } from '../connectors/extra.mjs';
import { redact } from '../connectors/_http.mjs';
import { GOOGLE_ADS_API_VERSION } from '../connectors/google-auth.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-conn-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const write = (f, s) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), typeof s === 'string' ? s : JSON.stringify(s)); };
write('product.json', { name: 'Demo', domain: 'demo.example', budget: { mode: 'paid', monthly_cap: 100, daily_cap: 10 } });
write('outbox/post.md', '---\ntitle: Launch\n---\nWe launched today: https://demo.example/launch is live.');
write('outbox/article.md', '---\ntitle: How we built it\ndescription: A short story\ntags: node, startups\ncanonical_url: https://demo.example/blog/how\n---\n# How we built it\n\nIt is **simple**.\n\n- one\n- two\n');
write('outbox/news.md', '---\nsubject: October update\npreview_text: What shipped\n---\n# October\n\nThree things shipped.');
write('outbox/thread.md', 'First tweet https://demo.example\n---\nSecond tweet\n---\nThird tweet');
write('outbox/urls.md', 'https://demo.example/a\nhttps://demo.example/b\n');
const spec = { name: 'Search core', daily_budget: 8, max_cpc: 1.5, final_url: 'https://demo.example/', keywords: [{ text: 'invoice app', match: 'exact' }, 'billing tool'], negatives: ['free'],
  ads: [{ headlines: ['Invoices in a minute', 'Get paid faster', 'Try it today'], descriptions: ['Send invoices that get paid.', 'No setup, cancel anytime.'], path1: 'invoices' }],
  audience: { locations: ['US'], subreddits: ['r/smallbusiness'] }, text: 'Get paid faster', cta: 'Learn more' };
write('outbox/spec.json', spec);

// Fake credentials, built at runtime (test values only).
const fake = (name) => `test-${name}-${'x'.repeat(6)}`;

// Mock fetch: records calls, answers from a router function.
function mock(router) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method ?? 'GET', headers: Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])), body: init.body };
    try { call.json = typeof init.body === 'string' ? JSON.parse(init.body) : null; } catch { call.json = null; }
    if (init.body instanceof URLSearchParams) call.form = init.body;
    calls.push(call);
    const [status, body, headers] = router(call, calls.length) ?? [200, {}];
    return new Response(status === 204 ? null : (typeof body === 'string' ? body : JSON.stringify(body)), { status, headers: headers ?? { 'content-type': 'application/json' } });
  };
  return { calls, fetch };
}
const ctxFor = (env, fetch, extra = {}) => ({ slug: 'demo', dir, env, now: '2026-11-03T10:00:00Z', dryRun: false, fetch, ...extra });
const noFetch = async () => { throw new Error('network must not be used'); };

test('missing keys: no network, ok:false dry-run preview; ctx.dryRun: preview only', async () => {
  const item = { id: 'A1', type: 'post', channel: 'bluesky', file: 'outbox/post.md' };
  const r = await bluesky.execute(item, ctxFor({}, noFetch));
  assert.equal(r.ok, false); assert.equal(r.dry_run, true); assert.match(r.detail, /missing BLUESKY_HANDLE/);
  const d = await bluesky.execute(item, ctxFor({ BLUESKY_HANDLE: 'a', BLUESKY_APP_PASSWORD: fake('bsky') }, noFetch, { dryRun: true }));
  assert.equal(d.ok, true); assert.equal(d.ref, 'dry-run');
  for (const c of [indexnow, mastodon, telegram, discord, slack, linkedin, buffer, x, devto, hashnode, medium, wordpress, ghost, mailchimp, brevo, convertkit, googleAds, microsoftAds, googleAdsCsv])
    assert.equal(c.configured({}), false, `${c.name} must be off without keys`);
});

test('indexnow and Search Console sitemap', async () => {
  const key = fake('indexnow');
  const m = mock(() => [202, '']);
  const r = await indexnow.execute({ id: 'A2', type: 'index', file: 'outbox/urls.md' }, ctxFor({ INDEXNOW_KEY: key }, m.fetch));
  assert.ok(r.ok, r.detail);
  assert.equal(m.calls[0].url, 'https://api.indexnow.org/indexnow');
  assert.deepEqual(m.calls[0].json, { host: 'demo.example', key, urlList: ['https://demo.example/a', 'https://demo.example/b'] });
  const off = await indexnow.execute({ id: 'A3', type: 'index', urls: ['https://other.example/x'] }, ctxFor({ INDEXNOW_KEY: key }, noFetch));
  assert.equal(off.ok, false);

  const g = mock((c) => (c.url.includes('oauth2') ? [200, { access_token: 'ya29.tokenvalue', expires_in: 3600 }] : [204, '']));
  const env = { GSC_SITE_URL: 'sc-domain:demo.example', GOOGLE_CLIENT_ID: 'cid.apps', GOOGLE_CLIENT_SECRET: fake('gsecret'), GOOGLE_REFRESH_TOKEN: fake('grefresh') };
  const s = await gscSitemap.execute({ id: 'A4', type: 'index', channel: 'gsc' }, ctxFor(env, g.fetch));
  assert.ok(s.ok, s.detail);
  assert.equal(g.calls[0].form.get('grant_type'), 'refresh_token');
  assert.equal(g.calls[1].method, 'PUT');
  assert.equal(g.calls[1].url, 'https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Ademo.example/sitemaps/https%3A%2F%2Fdemo.example%2Fsitemap.xml');
  assert.equal(g.calls[1].headers.authorization, 'Bearer ya29.tokenvalue');
});

test('bluesky: session then createRecord with link facets', async () => {
  const env = { BLUESKY_HANDLE: 'demo.bsky.social', BLUESKY_APP_PASSWORD: fake('bsky') };
  const m = mock((c) => (c.url.endsWith('createSession') ? [200, { accessJwt: 'jwt-abc-123', did: 'did:plc:xyz' }] : [200, { uri: 'at://did:plc:xyz/app.bsky.feed.post/1', cid: 'c' }]));
  const r = await bluesky.execute({ id: 'B1', type: 'post', channel: 'bluesky', file: 'outbox/post.md' }, ctxFor(env, m.fetch));
  assert.ok(r.ok, r.detail);
  assert.equal(m.calls[0].json.identifier, 'demo.bsky.social');
  assert.equal(m.calls[0].json.password, env.BLUESKY_APP_PASSWORD);
  const rec = m.calls[1].json;
  assert.equal(rec.repo, 'did:plc:xyz'); assert.equal(rec.collection, 'app.bsky.feed.post');
  assert.equal(m.calls[1].headers.authorization, 'Bearer jwt-abc-123');
  assert.equal(rec.record.facets[0].features[0].uri, 'https://demo.example/launch');
  const f = linkFacets('é https://a.b');
  assert.equal(f[0].index.byteStart, 3); // é is 2 bytes in UTF-8
  const long = await bluesky.execute({ id: 'B2', type: 'post', channel: 'bluesky', text: 'x'.repeat(301) }, ctxFor(env, noFetch));
  assert.equal(long.ok, false); assert.match(long.detail, /300/);
});

test('mastodon, telegram, discord, slack', async () => {
  let m = mock(() => [200, { id: '1', url: 'https://m.example/@demo/1' }]);
  let r = await mastodon.execute({ id: 'M1', type: 'post', channel: 'mastodon', file: 'outbox/post.md' }, ctxFor({ MASTODON_URL: 'https://m.example/', MASTODON_TOKEN: fake('masto') }, m.fetch));
  assert.ok(r.ok); assert.equal(m.calls[0].url, 'https://m.example/api/v1/statuses'); assert.equal(m.calls[0].headers['idempotency-key'], 'whalyom-demo-M1'); assert.equal(m.calls[0].json.visibility, 'public');

  m = mock(() => [401, { ok: false, description: 'Unauthorized' }]);
  const tenv = { TELEGRAM_BOT_TOKEN: '123456:SECRET-TOKEN-VALUE', TELEGRAM_CHAT_ID: '@demo' };
  r = await telegram.execute({ id: 'T1', type: 'post', channel: 'telegram', file: 'outbox/post.md' }, ctxFor(tenv, m.fetch));
  assert.equal(r.ok, false);
  assert.ok(m.calls[0].url.includes('/bot123456:SECRET-TOKEN-VALUE/sendMessage'));
  assert.ok(!r.detail.includes('SECRET-TOKEN-VALUE'), 'token must never appear in details');
  m = mock(() => [200, { ok: true, result: { message_id: 42 } }]);
  r = await telegram.execute({ id: 'T2', type: 'post', channel: 'telegram', file: 'outbox/post.md' }, ctxFor(tenv, m.fetch));
  assert.ok(r.ok); assert.equal(r.ref, '42'); assert.equal(m.calls[0].json.chat_id, '@demo');

  m = mock(() => [200, { id: '99' }]);
  r = await discord.execute({ id: 'D1', type: 'post', channel: 'discord', file: 'outbox/post.md' }, ctxFor({ DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/hooksecret' }, m.fetch));
  assert.ok(r.ok); assert.match(m.calls[0].url, /wait=true/); assert.deepEqual(m.calls[0].json.allowed_mentions, { parse: [] });

  m = mock(() => [200, 'ok', { 'content-type': 'text/plain' }]);
  r = await slack.execute({ id: 'S1', type: 'post', channel: 'slack', file: 'outbox/post.md' }, ctxFor({ SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T/B/secretpart' }, m.fetch));
  assert.ok(r.ok); assert.match(m.calls[0].json.text, /launched/);
});

test('x: OAuth 1.0a signed thread with replies; OAuth 2 bearer', async () => {
  const env = { X_API_KEY: 'consumerkey1', X_API_SECRET: fake('xsecret'), X_ACCESS_TOKEN: 'accesstoken1', X_ACCESS_TOKEN_SECRET: fake('xtokensecret') };
  let n = 0;
  const m = mock(() => [201, { data: { id: String(++n) } }]);
  const r = await x.execute({ id: 'X1', type: 'post', channel: 'x', file: 'outbox/thread.md' }, ctxFor(env, m.fetch));
  assert.ok(r.ok, r.detail); assert.equal(r.ref, '1,2,3');
  assert.equal(m.calls.length, 3); assert.equal(m.calls[0].url, 'https://api.x.com/2/tweets');
  assert.match(m.calls[0].headers.authorization, /^OAuth oauth_consumer_key="consumerkey1", .*oauth_signature="[^"]+"/);
  assert.deepEqual(m.calls[2].json.reply, { in_reply_to_tweet_id: '2' });
  const h1 = oauth1Header('POST', 'https://api.x.com/2/tweets', env, { nonce: 'n', timestamp: 1 });
  assert.equal(h1, oauth1Header('POST', 'https://api.x.com/2/tweets', env, { nonce: 'n', timestamp: 1 }));
  assert.notEqual(h1, oauth1Header('POST', 'https://api.x.com/2/tweets', { ...env, X_API_SECRET: 'other' }, { nonce: 'n', timestamp: 1 }));
  assert.deepEqual(splitThread('a\n---\nb'), ['a', 'b']);
  const m2 = mock(() => [201, { data: { id: '7' } }]);
  const r2 = await x.execute({ id: 'X2', type: 'post', channel: 'x', text: 'hello' }, ctxFor({ X_USER_ACCESS_TOKEN: 'oauth2usertoken' }, m2.fetch));
  assert.ok(r2.ok); assert.equal(m2.calls[0].headers.authorization, 'Bearer oauth2usertoken');
});

test('linkedin and buffer', async () => {
  let m = mock(() => [201, '', { 'x-restli-id': 'urn:li:share:1' }]);
  let r = await linkedin.execute({ id: 'L1', type: 'post', channel: 'linkedin', text: 'Hello (world) #launch' }, ctxFor({ LINKEDIN_ACCESS_TOKEN: fake('li'), LINKEDIN_AUTHOR_URN: 'urn:li:organization:5' }, m.fetch));
  assert.ok(r.ok, r.detail); assert.equal(r.ref, 'urn:li:share:1');
  const c = m.calls[0];
  assert.equal(c.url, 'https://api.linkedin.com/rest/posts'); assert.equal(c.headers['linkedin-version'], '202609'); assert.equal(c.headers['x-restli-protocol-version'], '2.0.0');
  assert.equal(c.json.commentary, 'Hello \\(world\\) \\#launch'); assert.equal(c.json.lifecycleState, 'PUBLISHED');
  assert.equal(escapeLittleText('a_b'), 'a\\_b');
  m = mock(() => [200, { success: true, updates: [{ id: 'u1' }, { id: 'u2' }] }]);
  r = await buffer.execute({ id: 'BF', type: 'post', channel: 'buffer', text: 'Queued' }, ctxFor({ BUFFER_ACCESS_TOKEN: fake('buffer'), BUFFER_PROFILE_IDS: 'p1,p2' }, m.fetch));
  assert.ok(r.ok); assert.deepEqual(m.calls[0].form.getAll('profile_ids[]'), ['p1', 'p2']); assert.equal(m.calls[0].form.get('now'), 'false');
});

test('blog platforms create drafts by default and publish with activate: true', async () => {
  const item = (channel, extra = {}) => ({ id: `P-${channel}`, type: 'publish', channel, file: 'outbox/article.md', ...extra });
  const devKey = fake('devto');
  let m = mock(() => [201, { id: 1, url: 'https://dev.to/demo/how' }]);
  let r = await devto.execute(item('devto'), ctxFor({ DEVTO_API_KEY: devKey }, m.fetch));
  assert.ok(r.ok); assert.equal(m.calls[0].headers['api-key'], devKey);
  assert.equal(m.calls[0].json.article.published, false); assert.deepEqual(m.calls[0].json.article.tags, ['node', 'startups']);
  assert.equal(m.calls[0].json.article.canonical_url, 'https://demo.example/blog/how');
  assert.ok(!m.calls[0].json.article.body_markdown.startsWith('# How'), 'title heading is not repeated');
  r = await devto.execute(item('devto', { activate: true }), ctxFor({ DEVTO_API_KEY: devKey }, m.fetch));
  assert.equal(m.calls[1].json.article.published, true);

  const hn = { HASHNODE_TOKEN: fake('hn'), HASHNODE_PUBLICATION_ID: 'pub1' };
  m = mock(() => [200, { data: { createDraft: { draft: { id: 'd1' } } } }]);
  r = await hashnode.execute(item('hashnode'), ctxFor(hn, m.fetch));
  assert.ok(r.ok); assert.equal(r.ref, 'd1'); assert.match(m.calls[0].json.query, /createDraft/); assert.equal(m.calls[0].json.variables.input.publicationId, 'pub1');
  m = mock(() => [200, { errors: [{ message: 'bad input' }] }]);
  r = await hashnode.execute(item('hashnode'), ctxFor(hn, m.fetch));
  assert.equal(r.ok, false); assert.match(r.detail, /bad input/);

  m = mock((c) => (c.url.endsWith('/me') ? [200, { data: { id: 'u9' } }] : [201, { data: { url: 'https://medium.com/p/1' } }]));
  r = await medium.execute(item('medium'), ctxFor({ MEDIUM_TOKEN: fake('medium') }, m.fetch));
  assert.ok(r.ok); assert.equal(m.calls[1].url, 'https://api.medium.com/v1/users/u9/posts'); assert.equal(m.calls[1].json.publishStatus, 'draft');

  const wp = { WP_URL: 'https://blog.demo.example', WP_USER: 'editor', WP_APP_PASSWORD: 'abcd efgh ijkl' };
  m = mock(() => [201, { id: 5, link: 'https://blog.demo.example/?p=5' }]);
  r = await wordpress.execute(item('wordpress'), ctxFor(wp, m.fetch));
  assert.ok(r.ok); assert.equal(m.calls[0].url, 'https://blog.demo.example/wp-json/wp/v2/posts');
  assert.equal(m.calls[0].headers.authorization, `Basic ${Buffer.from('editor:abcdefghijkl').toString('base64')}`);
  assert.equal(m.calls[0].json.status, 'draft'); assert.match(m.calls[0].json.content, /<strong>simple<\/strong>/);

  const key = `abc123:${'0f'.repeat(32)}`;
  m = mock(() => [201, { posts: [{ id: 'g1', url: 'https://ghost.demo/how/' }] }]);
  r = await ghost.execute(item('ghost'), ctxFor({ GHOST_ADMIN_URL: 'https://ghost.demo', GHOST_ADMIN_API_KEY: key }, m.fetch));
  assert.ok(r.ok); assert.match(m.calls[0].url, /\/ghost\/api\/admin\/posts\/\?source=html$/);
  assert.match(m.calls[0].headers.authorization, /^Ghost [\w-]+\.[\w-]+\.[\w-]+$/); assert.equal(m.calls[0].json.posts[0].status, 'draft');
  const [h, b] = ghostToken(key, 1000).split('.');
  assert.equal(JSON.parse(Buffer.from(h, 'base64url')).kid, 'abc123');
  assert.deepEqual(JSON.parse(Buffer.from(b, 'base64url')), { iat: 1000, exp: 1300, aud: '/admin/' });
});

test('newsletters create drafts only, never send', async () => {
  const item = (channel) => ({ id: `N-${channel}`, type: 'send', channel, file: 'outbox/news.md' });
  let m = mock((c) => (c.method === 'POST' ? [200, { id: 'cmp1' }] : [200, {}]));
  let r = await mailchimp.execute(item('mailchimp'), ctxFor({ MAILCHIMP_API_KEY: `${fake('mc')}-us21`, MAILCHIMP_LIST_ID: 'L1', OM_EMAIL_FROM: 'news@demo.example' }, m.fetch));
  assert.ok(r.ok, r.detail); assert.equal(m.calls[0].url, 'https://us21.api.mailchimp.com/3.0/campaigns');
  assert.equal(m.calls[0].json.recipients.list_id, 'L1'); assert.equal(m.calls[0].json.settings.subject_line, 'October update');
  assert.equal(m.calls[1].method, 'PUT'); assert.match(m.calls[1].url, /campaigns\/cmp1\/content$/);
  assert.ok(m.calls.every((c) => !c.url.includes('/actions/send')), 'must never call send');

  m = mock(() => [201, { id: 77 }]);
  r = await brevo.execute(item('brevo'), ctxFor({ BREVO_API_KEY: fake('brevo'), BREVO_LIST_ID: '3', OM_EMAIL_FROM: 'news@demo.example' }, m.fetch));
  assert.ok(r.ok); assert.deepEqual(m.calls[0].json.recipients, { listIds: [3] }); assert.equal(m.calls[0].json.scheduledAt, undefined);

  const kitKey = fake('kit');
  m = mock(() => [201, { broadcast: { id: 8 } }]);
  r = await convertkit.execute(item('kit'), ctxFor({ KIT_API_KEY: kitKey }, m.fetch));
  assert.ok(r.ok); assert.equal(m.calls[0].headers['x-kit-api-key'], kitKey); assert.equal(m.calls[0].json.send_at, null);

  const missingSubject = await mailchimp.execute({ id: 'N0', type: 'send', channel: 'mailchimp', file: 'outbox/post.md' }, ctxFor({ MAILCHIMP_API_KEY: 'k-us1', MAILCHIMP_LIST_ID: 'L', OM_EMAIL_FROM: 'a@b.c' }, noFetch));
  assert.equal(missingSubject.ok, false); assert.match(missingSubject.detail, /subject/);
  m = mock(() => [200, { lists: [{ id: 'L1', name: 'Main', stats: { member_count: 12 } }] }]);
  assert.deepEqual(await mailchimp.lists(ctxFor({ MAILCHIMP_API_KEY: 'abc-us2' }, m.fetch)), [{ id: 'L1', name: 'Main', members: 12 }]);
});

test('ads: Google Ads API paused campaign, budget guard, Microsoft API, CSV exporters', async () => {
  const env = { GOOGLE_ADS_DEVELOPER_TOKEN: fake('gadev'), GOOGLE_ADS_CUSTOMER_ID: '123-456-7890', GOOGLE_ACCESS_TOKEN: 'ya29.access' };
  const m = mock((c) => [200, { results: [{ resourceName: `customers/1234567890/${c.url.split('/').pop().split(':')[0]}/1` }] }]);
  const item = { id: 'G1', type: 'spend', channel: 'google', amount: 10, file: 'outbox/spec.json' };
  const r = await googleAds.execute(item, ctxFor(env, m.fetch));
  assert.ok(r.ok, r.detail); assert.equal(r.committed_daily, 0);
  assert.deepEqual(m.calls.map((c) => c.url.split('/').pop()), ['campaignBudgets:mutate', 'campaigns:mutate', 'adGroups:mutate', 'adGroupCriteria:mutate', 'campaignCriteria:mutate', 'adGroupAds:mutate']);
  assert.ok(m.calls[0].url.startsWith(`https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/1234567890/`), m.calls[0].url);
  assert.equal(m.calls[1].json.operations[0].create.name, `${spec.name} · G1`, 'campaign name carries the item id (names are unique per account)'); assert.equal(m.calls[0].headers['developer-token'], env.GOOGLE_ADS_DEVELOPER_TOKEN);
  assert.equal(m.calls[0].json.operations[0].create.amountMicros, '8000000');
  assert.equal(m.calls[1].json.operations[0].create.status, 'PAUSED');
  assert.equal(m.calls[3].json.operations[0].create.keyword.matchType, 'EXACT');
  const over = await googleAds.execute({ ...item, amount: 5 }, ctxFor(env, noFetch));
  assert.equal(over.ok, false); assert.match(over.detail, /approved amount/);
  write('outbox/badspec.json', { ...spec, ads: [{ headlines: ['x'.repeat(31), 'b', 'c'], descriptions: ['d', 'e'] }] });
  const bad = await googleAds.execute({ ...item, file: 'outbox/badspec.json' }, ctxFor(env, noFetch));
  assert.equal(bad.ok, false); assert.match(bad.detail, /over 30/);

  const ms = mock(() => [200, { CampaignIds: [55], PartialErrors: [] }]);
  const mr = await microsoftAds.execute({ ...item, channel: 'microsoft' }, ctxFor({ MSADS_DEVELOPER_TOKEN: fake('msdev'), MSADS_ACCESS_TOKEN: fake('msaccess'), MSADS_CUSTOMER_ID: '1', MSADS_ACCOUNT_ID: '2' }, ms.fetch));
  assert.ok(mr.ok); assert.equal(ms.calls[0].json.Campaigns[0].Status, 'Paused'); assert.equal(ms.calls[0].json.Campaigns[0].DailyBudget, 8);

  const csvEnv = { OM_ADS_CSV_EXPORT: '1' };
  for (const [c, channel, needle] of [[googleAdsCsv, 'google', 'Headline 15'], [microsoftAdsCsv, 'microsoft', 'Format Version'], [tiktokAdsCsv, 'tiktok', 'Landing Page URL'], [redditAdsCsv, 'reddit', 'r/smallbusiness']]) {
    const e = await c.execute({ id: `C-${channel}`, type: 'spend', channel, amount: 10, file: 'outbox/spec.json' }, ctxFor(csvEnv, noFetch));
    assert.ok(e.ok, e.detail); assert.equal(e.committed_daily, 0);
    const csv = fs.readFileSync(path.join(dir, e.ref), 'utf8');
    assert.ok(csv.includes(needle), `${c.name} CSV should contain ${needle}`);
  }
  const g = fs.readFileSync(path.join(dir, 'outbox/exports/C-google-google.csv'), 'utf8');
  assert.match(g, /Search core,Search,Paused,8,Daily/); assert.match(g, /invoice app,Exact/);
});

test('readers: metrics rows and booking links, read-only GETs', async () => {
  let m = mock(() => [200, { data: [{ id: 't1', created: 1793700000, amount: 2500, currency: 'usd' }, { id: 't2', created: 1793700100, amount: 1500, currency: 'usd' }], has_more: false }]);
  let r = await stripe.read(ctxFor({ STRIPE_API_KEY: `rk_test_${fake('s')}` }, m.fetch), { days: 3 });
  assert.ok(r.ok); assert.equal(m.calls[0].method, 'GET'); assert.match(m.calls[0].url, /type=charge/);
  assert.deepEqual(r.rows.map((x) => [x.metric, x.value]), [['revenue', 40]]);

  const pl = { PLAUSIBLE_API_KEY: fake('plausible'), PLAUSIBLE_SITE_ID: 'demo.example' };
  m = mock(() => [200, { results: [{ dimensions: ['2026-11-01'], metrics: [10, 25] }] }]);
  r = await plausible.read(ctxFor(pl, m.fetch), { days: 2 });
  assert.deepEqual(r.rows, [{ date: '2026-11-01', channel: 'site', metric: 'visitors', value: 10 }, { date: '2026-11-01', channel: 'site', metric: 'pageviews', value: 25 }]);
  assert.equal(m.calls[0].url, 'https://plausible.io/api/v2/query'); assert.deepEqual(m.calls[0].json.dimensions, ['time:day']);

  const umKey = fake('umami');
  m = mock(() => [200, { pageviews: [{ x: '2026-11-01 00:00:00', y: 30 }], sessions: [{ x: '2026-11-01 00:00:00', y: 12 }] }]);
  r = await umami.read(ctxFor({ UMAMI_API_KEY: umKey, UMAMI_WEBSITE_ID: 'w1' }, m.fetch));
  assert.equal(m.calls[0].headers['x-umami-api-key'], umKey); assert.match(m.calls[0].url, /^https:\/\/api\.umami\.is\/v1\/websites\/w1\/pageviews\?/);
  assert.equal(r.rows.length, 2);

  m = mock(() => [200, { rows: [{ dimensionValues: [{ value: '20261101' }, { value: 'Organic Search' }], metricValues: [{ value: '40' }, { value: '3' }] }] }]);
  r = await ga4.read(ctxFor({ GA4_PROPERTY_ID: '999', GOOGLE_ACCESS_TOKEN: 'ya29.ga' }, m.fetch));
  assert.deepEqual(r.rows[1], { date: '2026-11-01', channel: 'organic_search', metric: 'conversions', value: 3 });
  assert.equal(m.calls[0].url, 'https://analyticsdata.googleapis.com/v1beta/properties/999:runReport');

  m = mock(() => [200, { status: 'success', data: [{ title: 'Intro call', slug: 'intro', lengthInMinutes: 30 }] }]);
  r = await calcom.read(ctxFor({ CALCOM_API_KEY: fake('cal'), CALCOM_USERNAME: 'demo' }, m.fetch));
  assert.deepEqual(r.links, [{ name: 'Intro call', url: 'https://cal.com/demo/intro', minutes: 30 }]);
  m = mock((c) => (c.url.endsWith('/users/me') ? [200, { resource: { uri: 'https://api.calendly.com/users/U1' } }] : [200, { collection: [{ name: 'Demo', scheduling_url: 'https://calendly.com/demo/30', duration: 30 }] }]));
  r = await calendly.read(ctxFor({ CALENDLY_TOKEN: fake('calendly') }, m.fetch));
  assert.equal(r.links[0].url, 'https://calendly.com/demo/30'); assert.ok(m.calls.every((c) => c.method === 'GET'));

  const dry = await ga4.read(ctxFor({}, noFetch));
  assert.equal(dry.dry_run, true); assert.match(dry.detail, /missing GA4_PROPERTY_ID/);

  m = mock(() => [200, { results: [{ dimensions: ['2026-11-02'], metrics: [1, 2] }] }]);
  const pulled = await pullMetrics(ctxFor({ ...pl, STRIPE_API_KEY: `rk_test_${fake('s')}` }, m.fetch));
  assert.deepEqual(pulled.map((p) => p.source), ['plausible'], 'stripe is skipped unless named (metrics.mjs already pulls it)');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, pulled[0].file), 'utf8')).length, 2);
  m = mock((c) => (c.url.endsWith('/users/me') ? [200, { resource: { uri: 'u' } }] : [200, { collection: [{ name: 'Demo', scheduling_url: 'https://calendly.com/d', duration: 15 }] }]));
  const links = await pullLinks(ctxFor({ CALENDLY_TOKEN: fake('calendly') }, m.fetch));
  assert.equal(links.links.length, 1); assert.ok(fs.existsSync(path.join(dir, 'research', 'booking-links.json')));
});

test('routing through pick(): own channels only, exporters after the webhook', () => {
  const ctx = { slug: 'demo', dir, now: '2026-11-03T00:00:00Z' };
  const env = { BLUESKY_HANDLE: 'a', BLUESKY_APP_PASSWORD: 'b', OM_ADS_CSV_EXPORT: '1' };
  assert.equal(pick({ type: 'post', channel: 'bluesky' }, env, ctx)?.name, 'bluesky');
  assert.equal(pick({ type: 'post', channel: 'linkedin' }, env, ctx), null, 'no keys, no webhook: manual');
  assert.equal(pick({ type: 'publish', channel: 'site' }, env, ctx)?.name, 'local-site', 'site publishing unchanged');
  assert.equal(pick({ type: 'spend', channel: 'google' }, env, ctx)?.name, 'google-ads-csv');
  assert.equal(pick({ type: 'spend', channel: 'google' }, { ...env, OM_WEBHOOK_DEFAULT: 'https://n8n.example/hook' }, ctx)?.name, 'webhook');
  const googleSpend = { type: 'spend', channel: 'google' };
  assert.equal(pick(googleSpend, { OM_WEBHOOK_SLACK: 'https://h.example/x', OM_ADS_CSV_EXPORT: '1' }, ctx)?.name, 'google-ads-csv', 'a webhook for another channel does not shadow the exporter');
  assert.equal(pick(googleSpend, { OM_WEBHOOK_GOOGLE: 'https://h.example/g', OM_ADS_CSV_EXPORT: '1' }, ctx)?.name, 'webhook', 'own-channel webhook keeps priority');
  assert.equal(pick({ type: 'post', channel: 'linkedin' }, { OM_WEBHOOK_SLACK: 'https://h.example/x' }, ctx), null, 'no URL for the channel: manual');
  assert.equal(pick({ type: 'spend', channel: 'google' }, { ...env, GOOGLE_ADS_DEVELOPER_TOKEN: 'd', GOOGLE_ADS_CUSTOMER_ID: '1', GOOGLE_ACCESS_TOKEN: 't' }, ctx)?.name, 'google-ads');
  const brevoEnv = { BREVO_API_KEY: 'k', BREVO_LIST_ID: '1', OM_EMAIL_FROM: 'a@b.c' };
  assert.equal(pick({ type: 'send', channel: 'newsletter' }, brevoEnv, ctx)?.name, 'brevo');
  assert.equal(pick({ type: 'send', channel: 'email' }, brevoEnv, ctx), null, 'email channel stays with resend');
  const st = extraStatus({ DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/verysecret' });
  assert.ok(st.find((s) => s.name === 'discord').configured);
  assert.ok(!JSON.stringify(st).includes('verysecret'), 'status never contains secrets');
  assert.equal(redact('token abcdefgh in text', { MY_TOKEN: 'abcdefgh' }), 'token *** in text');
});

test('executor end to end: paid spend on google becomes a CSV export, caps still hold, no keys means manual', () => {
  const slug = `zz-connx-${process.pid}`;
  const P = (f = '') => path.join(root, 'products', slug, f);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(META_|RESEND_|OM_WEBHOOK_|OM_SITE_REPO|STRIPE_|OM_KILL|GOOGLE_|MSADS_|MASTODON_)/.test(k)));
  env.OM_ADS_CSV_EXPORT = '1'; env.OM_NO_DOTENV = '1';
  const run = (script, args) => { const r = spawnSync(process.execPath, [path.join(root, 'tools', script), ...args], { encoding: 'utf8', env, cwd: root }); assert.equal(r.status, 0, r.stderr || r.stdout); return r.stdout; };
  try {
    run('new-product.mjs', [slug, '--name', 'Conn Test', '--budget', '100']);
    fs.mkdirSync(P('outbox'), { recursive: true });
    fs.writeFileSync(P('outbox/spec.json'), JSON.stringify(spec));
    const pj = JSON.parse(fs.readFileSync(P('product.json'), 'utf8'));
    pj.budget = { ...pj.budget, mode: 'paid', monthly_cap: 400, daily_cap: 10 };
    fs.writeFileSync(P('product.json'), JSON.stringify(pj));
    fs.writeFileSync(P('approvals.json'), JSON.stringify([
      { id: 'A1', type: 'spend', channel: 'google', title: 'Search', amount: 8, file: 'outbox/spec.json', compliance: 'pass', status: 'approved' },
      { id: 'A2', type: 'spend', channel: 'tiktok', title: 'Too big', amount: 50, file: 'outbox/spec.json', compliance: 'pass', status: 'approved' },
      { id: 'A3', type: 'post', channel: 'mastodon', title: 'No keys', file: 'outbox/spec.json', compliance: 'pass', status: 'approved' },
    ]));
    run('execute.mjs', [slug]);
    const ap = Object.fromEntries(JSON.parse(fs.readFileSync(P('approvals.json'), 'utf8')).map((a) => [a.id, a]));
    assert.equal(ap.A1.status, 'executed'); assert.equal(ap.A1.executed_by, 'google-ads-csv');
    assert.ok(fs.existsSync(P(ap.A1.result_ref)));
    assert.equal(ap.A2.status, 'pending', 'over the daily cap: held by the executor before any connector');
    assert.equal(ap.A3.status, 'approved', 'no keys: waits for a connector key instead of turning manual');
    assert.equal(ap.A3.waiting_for, 'connector key');
    const ledger = fs.existsSync(P('ledger.jsonl')) ? fs.readFileSync(P('ledger.jsonl'), 'utf8') : '';
    assert.ok(!ledger.includes('committed_daily'), 'a CSV export commits no spend');
  } finally { fs.rmSync(P(), { recursive: true, force: true }); }
});

test('executor end to end: a thrown connector error carrying a key is redacted in approvals.json and stdout', () => {
  const slug = `zz-connr-${process.pid}`;
  const P = (f = '') => path.join(root, 'products', slug, f);
  const key = ['re', 'fakekey', process.pid].join('_');
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(META_|RESEND_|OM_WEBHOOK_|OM_SITE_REPO|STRIPE_|OM_KILL|GOOGLE_|MSADS_|MASTODON_|OM_EMAIL_FROM|OM_SCHEDULER)/.test(k)));
  // Resend is not configured (no sender), so the webhook catch-all takes the item; its URL makes
  // fetch() throw an error whose message contains the key value.
  env.RESEND_API_KEY = key;
  env.OM_WEBHOOK_DEFAULT = `notaurl ${key}`;
  env.OM_EXECUTE_LOCK_WAIT_MS = '0';
  const run = (script, args) => { const r = spawnSync(process.execPath, [path.join(root, 'tools', script), ...args], { encoding: 'utf8', env, cwd: root }); assert.equal(r.status, 0, r.stderr || r.stdout); return r.stdout; };
  try {
    run('new-product.mjs', [slug, '--name', 'Redact Test']);
    fs.mkdirSync(P('outbox'), { recursive: true });
    fs.writeFileSync(P('outbox/post.md'), 'Hello');
    fs.writeFileSync(P('approvals.json'), JSON.stringify([{ id: 'R1', type: 'post', channel: 'x', title: 'Throws', file: 'outbox/post.md', compliance: 'pass', status: 'approved' }]));
    const stdout = run('execute.mjs', [slug]);
    assert.ok(!stdout.includes(key), stdout);
    assert.match(stdout, /\*\*\*/);
    const a = JSON.parse(fs.readFileSync(P('approvals.json'), 'utf8'))[0];
    assert.equal(a.status, 'approved'); assert.equal(a.attempts, 1);
    assert.ok(!a.last_error.includes(key)); assert.match(a.last_error, /\*\*\*/);
  } finally { fs.rmSync(P(), { recursive: true, force: true }); }
});

test('resend: idempotency key per approval, redacted errors, no draft file means no network', async () => {
  const { default: resend, idempotencyKey } = await import('../connectors/resend.mjs');
  write('outbox/email.md', '---\nto: a@demo.example, b@demo.example\nsubject: Hello\n---\nHi there.');
  const env = { RESEND_API_KEY: fake('resend'), OM_EMAIL_FROM: 'team@demo.example' };
  const item = { id: 'E1', type: 'send', channel: 'email', file: 'outbox/email.md' };
  const m = mock(() => [200, { id: 'msg_1' }]);
  const r1 = await resend.execute(item, ctxFor(env, m.fetch));
  const r2 = await resend.execute(item, ctxFor(env, m.fetch));
  assert.equal(r1.ok, true); assert.equal(r1.ref, 'msg_1'); assert.equal(r2.ok, true);
  assert.equal(m.calls.length, 2);
  assert.equal(m.calls[0].url, 'https://api.resend.com/emails');
  assert.equal(m.calls[0].headers['idempotency-key'], 'whalyom-demo-E1');
  assert.equal(m.calls[1].headers['idempotency-key'], m.calls[0].headers['idempotency-key'], 'a retry reuses the same key');
  assert.equal(m.calls[0].headers.authorization, `Bearer ${env.RESEND_API_KEY}`);
  assert.deepEqual(m.calls[0].json.to, ['a@demo.example', 'b@demo.example']);
  assert.equal(m.calls[0].json.from, 'team@demo.example'); assert.equal(m.calls[0].json.subject, 'Hello');
  assert.ok(idempotencyKey({ slug: 's' }, { id: 'x'.repeat(400) }).length <= 256);
  // an error body echoing the key is redacted
  const bad = mock(() => [401, { message: `invalid key ${env.RESEND_API_KEY}` }]);
  const e = await resend.execute(item, ctxFor(env, bad.fetch));
  assert.equal(e.ok, false); assert.ok(!e.detail.includes(env.RESEND_API_KEY)); assert.match(e.detail, /\*\*\*/);
  // no draft file: ok:false, no network
  const nf = await resend.execute({ id: 'E2', type: 'send', channel: 'email' }, ctxFor(env, noFetch));
  assert.equal(nf.ok, false); assert.match(nf.detail, /no draft file/);
  // missing keys: no network, dry-run preview; ctx.dryRun: preview only
  const mk = await resend.execute(item, ctxFor({}, noFetch));
  assert.equal(mk.ok, false); assert.equal(mk.dry_run, true); assert.match(mk.detail, /missing RESEND_API_KEY/);
  const dr = await resend.execute(item, ctxFor(env, noFetch, { dryRun: true }));
  assert.equal(dr.ok, true); assert.match(dr.detail, /would email 2 recipient\(s\): Hello/);
  // more than 50 recipients is still refused
  write('outbox/many.md', `---\nto: ${Array.from({ length: 51 }, (_, i) => `u${i}@demo.example`).join(', ')}\nsubject: Bulk\n---\nx`);
  const many = await resend.execute({ ...item, id: 'E3', file: 'outbox/many.md' }, ctxFor(env, noFetch));
  assert.equal(many.ok, false); assert.match(many.detail, /more than 50 recipients/);
  assert.equal(resend.configured(env), true); assert.equal(resend.configured({ RESEND_API_KEY: 'k' }), false);
});
