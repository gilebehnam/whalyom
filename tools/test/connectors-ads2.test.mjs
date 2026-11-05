// Reddit Ads, X Ads, Apple Search Ads and Meta Ads API connectors against a mocked ctx.fetch (no real
// network): missing keys, dry run, budget guard, paused by default, activate: true, secret
// redaction, pause(), routing, the OAuth 1.0a signature and the Apple ES256 client-secret JWT.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pick } from '../connectors/index.mjs';
import { redditAds, pause as pauseReddit } from '../connectors/reddit-ads.mjs';
import { xAds, pause as pauseXAds, oauth1Sign, pct } from '../connectors/x-ads.mjs';
import { appleSearchAds, pause as pauseApple, clientSecret, pemOf } from '../connectors/apple-search-ads.mjs';
import { extraStatus } from '../connectors/extra.mjs';
import { metaAds, pause as pauseMeta } from '../connectors/meta-ads.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-ads2-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const write = (f, s) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), JSON.stringify(s)); };
write('product.json', { name: 'Demo', domain: 'demo.example', budget: { mode: 'paid', monthly_cap: 300, daily_cap: 30 } });
write('outbox/reddit.json', { name: 'RD launch', daily_budget: 15, ad_group: 'Founders', final_url: 'https://demo.example/', max_cpc: 1.25,
  audience: { subreddits: ['r/smallbusiness', 'Entrepreneur'], locations: ['us', 'GB'] }, post_id: 't3_abc123' });
write('outbox/reddit-nopost.json', { name: 'RD bare', daily_budget: 15, audience: { locations: ['US'] } });
write('outbox/reddit-noloc.json', { name: 'RD noloc', daily_budget: 15, audience: { subreddits: ['r/smallbusiness'] } });
write('outbox/xads.json', { name: 'X launch', daily_budget: 12, ad_group: 'Core', objective: 'website_clicks',
  targeting: { locations: ['US'], location_keys: ['5d4f8b3a2c1e0f99'], keywords: ['invoicing'] }, tweet_ids: ['1790000000000000001'] });
write('outbox/xads-noloc.json', { name: 'X noloc', daily_budget: 12, targeting: { locations: ['DE'] } });
write('outbox/apple.json', { name: 'ASA brand', daily_budget: 20, adam_id: 123456789, currency: 'eur', countries: ['US', 'gb'], default_bid: 1.5,
  keywords: [{ text: 'invoice app', match: 'exact', bid: 2 }, 'billing app'] });
write('outbox/apple-nokw.json', { name: 'ASA none', daily_budget: 20, adam_id: 1, countries: ['US'], default_bid: 1 });

const fake = (name) => `test-${name}-${'x'.repeat(8)}`;
const rdEnv = { REDDIT_ADS_ACCESS_TOKEN: fake('reddit'), REDDIT_ADS_ACCOUNT_ID: 'a2_demo' };
const xEnv = { X_ADS_CONSUMER_KEY: fake('ckey'), X_ADS_CONSUMER_SECRET: fake('csecret'), X_ADS_ACCESS_TOKEN: fake('xtoken'), X_ADS_ACCESS_SECRET: fake('xsecret'), X_ADS_ACCOUNT_ID: '18ce54d4x5t', X_ADS_FUNDING_INSTRUMENT_ID: 'fi-1' };
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const apEnv = { APPLE_ADS_CLIENT_ID: 'SEARCHADS.client-1', APPLE_ADS_TEAM_ID: 'SEARCHADS.team-1', APPLE_ADS_KEY_ID: 'key-1', APPLE_ADS_PRIVATE_KEY: pem.replace(/\n/g, '\\n'), APPLE_ADS_ORG_ID: '40669820' };
const APPLE_TOKEN = fake('appleaccess');

function mock(router) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method ?? 'GET', headers: Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])), body: init.body };
    try { call.json = typeof init.body === 'string' ? JSON.parse(init.body) : null; } catch { call.json = null; }
    if (init.body instanceof URLSearchParams) call.form = Object.fromEntries(init.body);
    calls.push(call);
    const [status, body, headers] = router(call, calls.length) ?? [200, {}];
    return new Response(status === 204 ? null : (typeof body === 'string' ? body : JSON.stringify(body)), { status, headers: headers ?? { 'content-type': 'application/json' } });
  };
  return { calls, fetch };
}
const ctxFor = (env, fetch, extra = {}) => ({ slug: 'demo', dir, env, now: '2026-11-03T10:00:00Z', dryRun: false, fetch, ...extra });
const noFetch = async () => { throw new Error('network must not be used'); };
const noSecrets = (r, env, extra = []) => {
  const s = JSON.stringify(r);
  for (const k of Object.keys(env).filter((n) => /TOKEN|SECRET|KEY/.test(n))) assert.ok(!s.includes(env[k]), `${k} leaked into result`);
  for (const v of extra) assert.ok(!s.includes(v), 'runtime token leaked into result');
};

// ── Reddit ──
const rdRouter = (c) => {
  if (c.method === 'PATCH') return [200, { data: { id: 'x', configured_status: 'PAUSED' } }];
  if (c.url.endsWith('/campaigns')) return [200, { data: { id: 'rc1' } }];
  if (c.url.endsWith('/ad_groups')) return [200, { data: { id: 'rg2' } }];
  if (c.url.endsWith('/ads')) return [200, { data: { id: 'ra3' } }];
  return [404, { error: 'unknown' }];
};
const rdItem = (extra = {}) => ({ id: 'RD1', type: 'spend', channel: 'reddit', amount: 20, file: 'outbox/reddit.json', ...extra });

test('reddit: missing keys refuses without network; dry run makes no call; budget and spec guards', async () => {
  const r = await redditAds.execute(rdItem(), ctxFor({}, noFetch));
  assert.equal(r.ok, false); assert.equal(r.dry_run, true); assert.match(r.detail, /missing REDDIT_ADS_ACCESS_TOKEN, REDDIT_ADS_ACCOUNT_ID/);
  const d = await redditAds.execute(rdItem(), ctxFor(rdEnv, noFetch, { dryRun: true }));
  assert.equal(d.ok, true); assert.equal(d.ref, 'dry-run'); assert.match(d.detail, /would create PAUSED Reddit campaign/);
  const over = await redditAds.execute(rdItem({ amount: 10 }), ctxFor(rdEnv, noFetch));
  assert.equal(over.ok, false); assert.match(over.detail, /approved amount/);
  const noloc = await redditAds.execute(rdItem({ file: 'outbox/reddit-noloc.json' }), ctxFor(rdEnv, noFetch));
  assert.equal(noloc.ok, false); assert.match(noloc.detail, /audience\.locations/);
});

test('reddit: campaign, ad group and ad created PAUSED by default with budget and targeting; no secrets', async () => {
  const m = mock(rdRouter);
  const r = await redditAds.execute(rdItem(), ctxFor(rdEnv, m.fetch));
  assert.ok(r.ok, r.detail); assert.equal(r.committed_daily, 0); assert.equal(r.ref, 'rc1/rg2/ra3');
  assert.deepEqual(m.calls.map((c) => c.url), ['campaigns', 'ad_groups', 'ads'].map((x) => `https://ads-api.reddit.com/api/v3/ad_accounts/a2_demo/${x}`));
  for (const c of m.calls) { assert.equal(c.headers.authorization, `Bearer ${rdEnv.REDDIT_ADS_ACCESS_TOKEN}`); assert.ok(c.headers['user-agent']); assert.equal(c.json.data.configured_status, 'PAUSED'); }
  const ag = m.calls[1].json.data;
  assert.equal(ag.campaign_id, 'rc1'); assert.equal(ag.goal_type, 'DAILY_SPEND'); assert.equal(ag.goal_value, 15_000_000); assert.equal(ag.bid_value, 1_250_000);
  assert.deepEqual(ag.targeting, { geolocations: ['US', 'GB'], communities: ['smallbusiness', 'Entrepreneur'] });
  assert.equal(m.calls[2].json.data.post_id, 't3_abc123'); assert.equal(m.calls[2].json.data.ad_group_id, 'rg2');
  noSecrets(r, rdEnv);
  const bare = mock(rdRouter);
  const b = await redditAds.execute(rdItem({ file: 'outbox/reddit-nopost.json' }), ctxFor(rdEnv, bare.fetch));
  assert.ok(b.ok, b.detail); assert.equal(bare.calls.length, 2, 'no post_id: no ad call');
});

test('reddit: activate:true sets ACTIVE; errors are redacted; pause() patches the campaign', async () => {
  const m = mock(rdRouter);
  const r = await redditAds.execute(rdItem({ activate: true }), ctxFor(rdEnv, m.fetch));
  assert.ok(r.ok); assert.equal(r.committed_daily, 15);
  assert.ok(m.calls.every((c) => c.json.data.configured_status === 'ACTIVE'));
  const e = mock(() => [401, { error: `bad token ${rdEnv.REDDIT_ADS_ACCESS_TOKEN}` }]);
  const bad = await redditAds.execute(rdItem(), ctxFor(rdEnv, e.fetch));
  assert.equal(bad.ok, false); assert.match(bad.detail, /HTTP 401/); noSecrets(bad, rdEnv);
  const p = mock(rdRouter);
  const res = await pauseReddit('rc1/rg2/ra3', rdEnv, false, { fetch: p.fetch });
  assert.ok(res.ok, res.detail);
  assert.equal(p.calls[0].url, 'https://ads-api.reddit.com/api/v3/campaigns/rc1'); assert.equal(p.calls[0].method, 'PATCH');
  assert.deepEqual(p.calls[0].json, { data: { configured_status: 'PAUSED' } });
  const g = await pauseReddit('ad_group:rg2', rdEnv, false, { fetch: p.fetch });
  assert.ok(g.ok); assert.equal(p.calls[1].url, 'https://ads-api.reddit.com/api/v3/ad_groups/rg2');
  assert.equal((await pauseReddit('rc1', rdEnv, true, { fetch: noFetch })).ok, true);
  assert.equal((await pauseReddit('rc1', {}, false, { fetch: noFetch })).ok, false);
  assert.equal(typeof redditAds.pause, 'function');
});

// ── X Ads ──
// Public sample values from the "Creating a signature" page of the OAuth 1.0a docs (not real
// credentials); assembled from parts so secret scanners do not mistake them for live keys.
const DOC = {
  consumerKey: ['xvz1evFS4wEE', 'PTGEFPHBog'].join(''),
  consumerSecret: ['kAcSOqF21Fu85e7zjz7Z', 'N2U4ZRhfV3WpwPAoE3Z7kBw'].join(''),
  token: ['370773112', ['GmHxMAgYyLbNEtIKZeRN', 'FsMKPR9EyMZeS9weJAEb'].join('')].join('-'),
  tokenSecret: ['LswwdoUaIvS8ltyTt5jk', 'Rh4J50vUPVVHtR2YPi5kE'].join(''),
};

test('oauth1: matches the worked example in the OAuth 1.0a signing docs; encoding is RFC 3986', () => {
  const r = oauth1Sign('POST', 'https://api.twitter.com/1.1/statuses/update.json?include_entities=true', DOC,
    { nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg', timestamp: 1318622958, params: { status: 'Hello Ladies + Gentlemen, a signed OAuth request!' } });
  assert.equal(r.signature, 'hCtSmYh+iHYCEqBWrE7C7hYmtUk=');
  assert.match(r.base, /^POST&https%3A%2F%2Fapi\.twitter\.com%2F1\.1%2Fstatuses%2Fupdate\.json&include_entities%3Dtrue%26oauth_consumer_key/);
  assert.match(r.header, /^OAuth oauth_consumer_key="[^"]+", oauth_nonce=.*oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"/);
  assert.equal(pct("a b!*'()~"), 'a%20b%21%2A%27%28%29~');
  const opts = { nonce: 'n', timestamp: 1 };
  const creds = { consumerKey: 'k', consumerSecret: 's', token: 't', tokenSecret: 'ts' };
  assert.equal(oauth1Sign('GET', 'https://ads-api.x.com/12/accounts?b=2&a=1', creds, opts).signature, oauth1Sign('GET', 'https://ads-api.x.com/12/accounts?a=1&b=2', creds, opts).signature, 'parameter order does not matter');
  assert.notEqual(oauth1Sign('GET', 'https://ads-api.x.com/12/accounts?a=1', creds, opts).signature, oauth1Sign('GET', 'https://ads-api.x.com/12/accounts?a=2', creds, opts).signature);
});

const xRouter = (c) => {
  if (c.method === 'PUT') return [200, { data: { id: 'c1', entity_status: 'PAUSED' } }];
  if (c.url.includes('/campaigns?')) return [200, { data: { id: 'c1' } }];
  if (c.url.includes('/line_items?')) return [200, { data: { id: 'l2' } }];
  if (c.url.includes('/targeting_criteria?')) return [200, { data: { id: 't' } }];
  if (c.url.includes('/promoted_tweets?')) return [200, { data: [{ id: 'p' }] }];
  return [404, { errors: [{ code: 'NOT_FOUND' }] }];
};
const xItem = (extra = {}) => ({ id: 'XA1', type: 'spend', channel: 'x_ads', amount: 15, file: 'outbox/xads.json', ...extra });

test('x ads: missing keys refuses without network; dry run makes no call; budget and location guards', async () => {
  const r = await xAds.execute(xItem(), ctxFor({}, noFetch));
  assert.equal(r.ok, false); assert.equal(r.dry_run, true); assert.match(r.detail, /missing X_ADS_CONSUMER_KEY/); assert.match(r.detail, /X_ADS_FUNDING_INSTRUMENT_ID/);
  const d = await xAds.execute(xItem(), ctxFor(xEnv, noFetch, { dryRun: true }));
  assert.equal(d.ok, true); assert.match(d.detail, /would create PAUSED X Ads campaign/);
  const over = await xAds.execute(xItem({ amount: 5 }), ctxFor(xEnv, noFetch));
  assert.equal(over.ok, false); assert.match(over.detail, /approved amount/);
  const noloc = await xAds.execute(xItem({ file: 'outbox/xads-noloc.json' }), ctxFor(xEnv, noFetch));
  assert.equal(noloc.ok, false); assert.match(noloc.detail, /location key/);
});

test('x ads: campaign and line item PAUSED by default, signed OAuth 1.0a, targeting and promoted post', async () => {
  const m = mock(xRouter);
  const r = await xAds.execute(xItem(), ctxFor(xEnv, m.fetch));
  assert.ok(r.ok, r.detail); assert.equal(r.committed_daily, 0); assert.equal(r.ref, 'c1/l2');
  assert.deepEqual(m.calls.map((c) => new URL(c.url).pathname), ['campaigns', 'line_items', 'targeting_criteria', 'targeting_criteria', 'targeting_criteria', 'promoted_tweets'].map((x) => `/12/accounts/18ce54d4x5t/${x}`));
  for (const c of m.calls) {
    assert.equal(c.method, 'POST');
    assert.match(c.headers.authorization, /^OAuth oauth_consumer_key="[^"]+", oauth_nonce="[0-9a-f]{32}", oauth_signature="[^"]+", oauth_signature_method="HMAC-SHA1", oauth_timestamp="\d+", oauth_token="[^"]+", oauth_version="1\.0"$/);
    assert.ok(!c.headers.authorization.includes(xEnv.X_ADS_CONSUMER_SECRET) && !c.headers.authorization.includes(xEnv.X_ADS_ACCESS_SECRET), 'secrets never sent');
  }
  const q = (i) => new URL(m.calls[i].url).searchParams;
  assert.equal(q(0).get('entity_status'), 'PAUSED'); assert.equal(q(0).get('funding_instrument_id'), 'fi-1'); assert.equal(q(0).get('daily_budget_amount_local_micro'), '12000000');
  assert.equal(q(1).get('campaign_id'), 'c1'); assert.equal(q(1).get('entity_status'), 'PAUSED'); assert.equal(q(1).get('objective'), 'WEBSITE_CLICKS'); assert.equal(q(1).get('placements'), 'ALL_ON_TWITTER');
  assert.deepEqual([2, 3, 4].map((i) => [q(i).get('targeting_type'), q(i).get('targeting_value')]), [['LOCATION', '5d4f8b3a2c1e0f99'], ['LOCATION', '96683cc9126741d1'], ['BROAD_KEYWORD', 'invoicing']]);
  assert.equal(q(5).get('tweet_ids'), '1790000000000000001'); assert.equal(q(5).get('line_item_id'), 'l2');
  noSecrets(r, xEnv);
});

test('x ads: activate:true sets ACTIVE; errors are redacted; pause() PUTs PAUSED; organic x unchanged', async () => {
  const m = mock(xRouter);
  const r = await xAds.execute(xItem({ activate: true }), ctxFor(xEnv, m.fetch));
  assert.ok(r.ok); assert.equal(r.committed_daily, 12);
  assert.equal(new URL(m.calls[0].url).searchParams.get('entity_status'), 'ACTIVE'); assert.equal(new URL(m.calls[1].url).searchParams.get('entity_status'), 'ACTIVE');
  const e = mock(() => [401, { errors: [{ message: `bad ${xEnv.X_ADS_ACCESS_TOKEN} ${xEnv.X_ADS_CONSUMER_KEY}` }] }]);
  const bad = await xAds.execute(xItem(), ctxFor(xEnv, e.fetch));
  assert.equal(bad.ok, false); assert.match(bad.detail, /HTTP 401/); noSecrets(bad, xEnv);
  const p = mock(xRouter);
  const res = await pauseXAds('c1/l2', xEnv, false, { fetch: p.fetch });
  assert.ok(res.ok, res.detail); assert.equal(p.calls[0].method, 'PUT');
  assert.equal(p.calls[0].url, 'https://ads-api.x.com/12/accounts/18ce54d4x5t/campaigns/c1?entity_status=PAUSED');
  const li = await pauseXAds('line_item:l2', xEnv, false, { fetch: p.fetch });
  assert.ok(li.ok); assert.match(p.calls[1].url, /\/line_items\/l2\?entity_status=PAUSED$/);
  assert.equal((await pauseXAds('c1', xEnv, true, { fetch: noFetch })).ok, true);
  assert.equal((await pauseXAds('c1', {}, false, { fetch: noFetch })).ok, false);
  assert.equal(xAds.accepts({ type: 'spend', channel: 'x' }), false, 'plain x is organic');
  assert.equal(xAds.accepts({ type: 'post', channel: 'x_ads' }), false);
});

// ── Apple Search Ads ──
test('apple: client secret is an ES256 JWT that verifies with the matching public key', () => {
  const jwt = clientSecret(apEnv, { now: '2026-11-03T10:00:00Z' });
  const [h, p, s] = jwt.split('.');
  assert.ok(h && p && s && !/[=+/]/.test(jwt), 'base64url, three parts');
  const dec = (x) => JSON.parse(Buffer.from(x, 'base64url').toString('utf8'));
  assert.deepEqual(dec(h), { alg: 'ES256', kid: 'key-1' });
  const payload = dec(p);
  assert.equal(payload.sub, apEnv.APPLE_ADS_CLIENT_ID); assert.equal(payload.iss, apEnv.APPLE_ADS_TEAM_ID); assert.equal(payload.aud, 'https://appleid.apple.com');
  assert.equal(payload.iat, Date.parse('2026-11-03T10:00:00Z') / 1000); assert.equal(payload.exp - payload.iat, 3600);
  const sig = Buffer.from(s, 'base64url');
  assert.equal(sig.length, 64, 'raw r||s signature (ieee-p1363)');
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, sig));
  const other = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey;
  assert.equal(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: other, dsaEncoding: 'ieee-p1363' }, sig), false);
  assert.equal(pemOf(apEnv.APPLE_ADS_PRIVATE_KEY), pem.trim(), '\\n escapes become newlines');
});

const apRouter = (c) => {
  if (c.url === 'https://appleid.apple.com/auth/oauth2/token') return [200, { access_token: APPLE_TOKEN, token_type: 'Bearer', expires_in: 3600 }];
  if (c.method === 'PUT') return [200, { data: { id: 901, status: 'PAUSED' } }];
  if (c.url.endsWith('/campaigns')) return [200, { data: { id: 901 } }];
  if (c.url.endsWith('/adgroups')) return [200, { data: { id: 902 } }];
  if (c.url.endsWith('/targetingkeywords/bulk')) return [200, { data: [{ id: 1 }, { id: 2 }] }];
  return [404, { error: { errors: [{ message: 'unknown' }] } }];
};
const apItem = (extra = {}) => ({ id: 'AP1', type: 'spend', channel: 'apple', amount: 25, file: 'outbox/apple.json', ...extra });

test('apple: missing keys refuses without network; dry run makes no call; budget and spec guards', async () => {
  const r = await appleSearchAds.execute(apItem(), ctxFor({}, noFetch));
  assert.equal(r.ok, false); assert.equal(r.dry_run, true); assert.match(r.detail, /missing APPLE_ADS_CLIENT_ID, APPLE_ADS_TEAM_ID, APPLE_ADS_KEY_ID, APPLE_ADS_PRIVATE_KEY, APPLE_ADS_ORG_ID/);
  const d = await appleSearchAds.execute(apItem(), ctxFor(apEnv, noFetch, { dryRun: true }));
  assert.equal(d.ok, true); assert.match(d.detail, /would create PAUSED Apple Search Ads campaign .* 20 EUR\/day in US, GB/);
  const over = await appleSearchAds.execute(apItem({ amount: 10 }), ctxFor(apEnv, noFetch));
  assert.equal(over.ok, false); assert.match(over.detail, /approved amount/);
  const nokw = await appleSearchAds.execute(apItem({ file: 'outbox/apple-nokw.json' }), ctxFor(apEnv, noFetch));
  assert.equal(nokw.ok, false); assert.match(nokw.detail, /needs keywords/);
});

test('apple: token exchange, then campaign, ad group (Search Match off) and keywords PAUSED by default', async () => {
  const m = mock(apRouter);
  const r = await appleSearchAds.execute(apItem(), ctxFor(apEnv, m.fetch));
  assert.ok(r.ok, r.detail); assert.equal(r.committed_daily, 0); assert.equal(r.ref, '901/902');
  assert.deepEqual(m.calls.map((c) => c.url), ['https://appleid.apple.com/auth/oauth2/token', 'https://api.searchads.apple.com/api/v5/campaigns', 'https://api.searchads.apple.com/api/v5/campaigns/901/adgroups', 'https://api.searchads.apple.com/api/v5/campaigns/901/adgroups/902/targetingkeywords/bulk']);
  const form = m.calls[0].form;
  assert.equal(form.grant_type, 'client_credentials'); assert.equal(form.client_id, apEnv.APPLE_ADS_CLIENT_ID); assert.equal(form.scope, 'searchadsorg');
  const [h, p, s] = form.client_secret.split('.');
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')), 'client secret verifies');
  for (const c of m.calls.slice(1)) { assert.equal(c.headers.authorization, `Bearer ${APPLE_TOKEN}`); assert.equal(c.headers['x-ap-context'], 'orgId=40669820'); }
  const [camp, ag, kws] = m.calls.slice(1).map((c) => c.json);
  assert.equal(camp.status, 'PAUSED'); assert.equal(camp.adamId, 123456789); assert.deepEqual(camp.countriesOrRegions, ['US', 'GB']);
  assert.deepEqual(camp.dailyBudgetAmount, { amount: '20.00', currency: 'EUR' }); assert.equal(camp.orgId, 40669820);
  assert.equal(ag.status, 'PAUSED'); assert.equal(ag.automatedKeywordsOptIn, false); assert.deepEqual(ag.defaultBidAmount, { amount: '1.50', currency: 'EUR' });
  assert.deepEqual(kws, [
    { text: 'invoice app', matchType: 'EXACT', status: 'PAUSED', bidAmount: { amount: '2.00', currency: 'EUR' } },
    { text: 'billing app', matchType: 'BROAD', status: 'PAUSED' },
  ]);
  noSecrets(r, apEnv, [APPLE_TOKEN]);
  assert.ok(!JSON.stringify(r).includes(form.client_secret));
});

test('apple: activate:true enables; errors and the access token are redacted; pause() works', async () => {
  const m = mock(apRouter);
  const r = await appleSearchAds.execute(apItem({ activate: true }), ctxFor(apEnv, m.fetch));
  assert.ok(r.ok); assert.equal(r.committed_daily, 20);
  assert.equal(m.calls[1].json.status, 'ENABLED'); assert.equal(m.calls[2].json.status, 'ENABLED'); assert.ok(m.calls[3].json.every((k) => k.status === 'ACTIVE'));
  const e = mock((c) => (c.url.includes('appleid') ? apRouter(c) : [403, { error: `token ${APPLE_TOKEN} not allowed` }]));
  const bad = await appleSearchAds.execute(apItem(), ctxFor(apEnv, e.fetch));
  assert.equal(bad.ok, false); assert.match(bad.detail, /HTTP 403/); noSecrets(bad, apEnv, [APPLE_TOKEN]);
  const tokFail = await appleSearchAds.execute(apItem(), ctxFor(apEnv, mock(() => [400, { error: 'invalid_client' }]).fetch));
  assert.equal(tokFail.ok, false); assert.match(tokFail.detail, /Apple token: HTTP 400/);
  const p = mock(apRouter);
  const res = await pauseApple('901/902', apEnv, false, { fetch: p.fetch });
  assert.ok(res.ok, res.detail);
  assert.equal(p.calls[1].method, 'PUT'); assert.equal(p.calls[1].url, 'https://api.searchads.apple.com/api/v5/campaigns/901');
  assert.deepEqual(p.calls[1].json, { campaign: { status: 'PAUSED' } });
  assert.equal((await pauseApple('901', apEnv, true, { fetch: noFetch })).ok, true);
  assert.equal((await pauseApple('901', {}, false, { fetch: noFetch })).ok, false);
  assert.equal(typeof appleSearchAds.pause, 'function');
});

test('routing: API connectors only when configured; Reddit falls back to the CSV sheet; organic x unchanged', () => {
  const ctx = { slug: 'demo', dir, now: '2026-11-03T00:00:00Z' };
  const csv = { OM_ADS_CSV_EXPORT: '1' };
  assert.equal(pick({ type: 'spend', channel: 'reddit' }, csv, ctx)?.name, 'reddit-ads-csv');
  assert.equal(pick({ type: 'spend', channel: 'reddit' }, { ...csv, ...rdEnv }, ctx)?.name, 'reddit-ads');
  assert.equal(pick({ type: 'spend', channel: 'reddit-ads' }, rdEnv, ctx)?.name, 'reddit-ads');
  assert.equal(pick({ type: 'spend', channel: 'x_ads' }, csv, ctx), null, 'no X Ads keys: manual');
  assert.equal(pick({ type: 'spend', channel: 'twitter_ads' }, xEnv, ctx)?.name, 'x-ads');
  assert.equal(pick({ type: 'post', channel: 'x' }, { ...xEnv, X_USER_ACCESS_TOKEN: fake('xuser') }, ctx)?.name, 'x', 'organic posts stay with x.mjs');
  assert.equal(pick({ type: 'spend', channel: 'apple' }, csv, ctx), null, 'no Apple keys: manual');
  assert.equal(pick({ type: 'spend', channel: 'apple_search_ads' }, apEnv, ctx)?.name, 'apple-search-ads');
  const st = extraStatus({ ...rdEnv, ...xEnv, ...apEnv });
  for (const n of ['reddit-ads', 'x-ads', 'apple-search-ads']) assert.ok(st.find((s) => s.name === n)?.configured, `${n} configured`);
  const json = JSON.stringify(st);
  for (const v of [rdEnv.REDDIT_ADS_ACCESS_TOKEN, xEnv.X_ADS_ACCESS_SECRET, xEnv.X_ADS_CONSUMER_SECRET, pem.slice(40, 80)]) assert.ok(!json.includes(v), 'status never contains secrets');
});

// ── Meta ──
const metaEnv = { META_ACCESS_TOKEN: fake('meta'), META_AD_ACCOUNT_ID: '1234567' };
write('outbox/meta.json', { name: 'Meta launch', daily_budget: 12.5, objective: 'OUTCOME_TRAFFIC', targeting: { geo_locations: { countries: ['GB'] } } });
const metaItem = (extra = {}) => ({ id: 'MT1', type: 'spend', channel: 'meta', amount: 20, file: 'outbox/meta.json', ...extra });
const metaRouter = (c) => {
  if (c.url.endsWith('/campaigns')) return [200, { id: '111' }];
  if (c.url.endsWith('/adsets')) return [200, { id: '222' }];
  return [200, { success: true }];
};

test('meta: campaign PAUSED with is_adset_budget_sharing_enabled=false, then ad set in minor units on a current Graph version', async () => {
  const m = mock(metaRouter);
  const r = await metaAds.execute(metaItem(), ctxFor(metaEnv, m.fetch));
  assert.ok(r.ok, r.detail); assert.equal(r.ref, '111/222'); assert.equal(r.committed_daily, 0);
  assert.match(m.calls[0].url, /\/v2[56]\.0\/act_1234567\/campaigns$/);
  assert.equal(m.calls[0].form.status, 'PAUSED'); assert.equal(m.calls[0].form.is_adset_budget_sharing_enabled, 'false');
  assert.match(m.calls[1].url, /\/v2[56]\.0\/act_1234567\/adsets$/);
  assert.equal(m.calls[1].form.daily_budget, '1250'); assert.equal(m.calls[1].form.campaign_id, '111'); assert.equal(m.calls[1].form.status, 'PAUSED');
  noSecrets(r, metaEnv);
  const v = mock(metaRouter);
  await metaAds.execute(metaItem(), ctxFor({ ...metaEnv, META_API_VERSION: 'v26.0' }, v.fetch));
  assert.match(v.calls[0].url, /\/v26\.0\//);
  assert.deepEqual(metaAds.needs, ['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID']);
  assert.equal(metaAds.configured(metaEnv), true); assert.equal(metaAds.configured({ META_ACCESS_TOKEN: 'x' }), false);
});

test('meta: missing keys and no file refuse without network; dry run; budget guard', async () => {
  const miss = await metaAds.execute(metaItem(), ctxFor({}, noFetch));
  assert.equal(miss.ok, false); assert.equal(miss.dry_run, true); assert.match(miss.detail, /missing META_ACCESS_TOKEN, META_AD_ACCOUNT_ID/);
  const nofile = await metaAds.execute(metaItem({ file: undefined }), ctxFor(metaEnv, noFetch));
  assert.equal(nofile.ok, false); assert.match(nofile.detail, /spec file/);
  const d = await metaAds.execute(metaItem(), ctxFor(metaEnv, noFetch, { dryRun: true }));
  assert.equal(d.ok, true); assert.match(d.detail, /would create PAUSED campaign/);
  const over = await metaAds.execute(metaItem({ amount: 10 }), ctxFor(metaEnv, noFetch));
  assert.equal(over.ok, false); assert.match(over.detail, /approved amount/);
});

test('meta: a Graph error that echoes the token comes back ok:false with the token redacted', async () => {
  const m = mock(() => [400, { error: { message: `Invalid OAuth access token ${metaEnv.META_ACCESS_TOKEN}`, code: 190 } }]);
  const r = await metaAds.execute(metaItem(), ctxFor(metaEnv, m.fetch));
  assert.equal(r.ok, false); assert.match(r.detail, /HTTP 400/); assert.match(r.detail, /\*\*\*/); noSecrets(r, metaEnv);
  const ok200 = mock(() => [200, { error: { message: `bad ${metaEnv.META_ACCESS_TOKEN}` } }]);
  const r2 = await metaAds.execute(metaItem(), ctxFor(metaEnv, ok200.fetch));
  assert.equal(r2.ok, false); noSecrets(r2, metaEnv);
});

test('meta pause: posts to the campaign node only; never throws; refuses without a token', async () => {
  const p = mock(metaRouter);
  const res = await pauseMeta('123/456', metaEnv, false, { fetch: p.fetch });
  assert.ok(res.ok, res.detail); assert.equal(p.calls.length, 1);
  assert.match(p.calls[0].url, /\/v2[56]\.0\/123$/); assert.equal(p.calls[0].form.status, 'PAUSED');
  const down = await pauseMeta('123/456', metaEnv, false, { fetch: async () => { throw new Error(`network down ${metaEnv.META_ACCESS_TOKEN}`); } });
  assert.equal(down.ok, false); noSecrets(down, metaEnv);
  const n = mock(metaRouter);
  const none = await pauseMeta('123/456', {}, false, { fetch: n.fetch });
  assert.equal(none.ok, false); assert.match(none.detail, /missing META_ACCESS_TOKEN/); assert.equal(n.calls.length, 0);
  assert.equal((await pauseMeta('123', metaEnv, true, { fetch: noFetch })).ok, true);
  assert.equal((await pauseMeta('dry-run', metaEnv, false, { fetch: noFetch })).ok, false);
  assert.equal(typeof metaAds.pause, 'function');
});

test('meta: an ad set failure after the campaign exists is partial (no retry), token redacted', async () => {
  const m = mock((c) => (c.url.endsWith('/campaigns') ? [200, { id: '111' }] : [400, { error: { message: `adset bad ${metaEnv.META_ACCESS_TOKEN}` } }]));
  const r = await metaAds.execute(metaItem(), ctxFor(metaEnv, m.fetch));
  assert.equal(r.ok, false); assert.equal(r.partial, true); assert.equal(r.ref, '111'); assert.match(r.detail, /already created \(paused\): 111/);
  noSecrets(r, metaEnv);
});
