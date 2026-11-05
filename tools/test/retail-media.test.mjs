// Retail media connectors (Amazon Ads Sponsored Products, Walmart Connect Sponsored Search) and their
// read-only metrics readers, against a mocked ctx.fetch (no real network): missing keys, dry run,
// budget guard, paused by default, Walmart never activated, partial results, budget change, pause(),
// secret redaction, the Walmart request signature, and report polling / download / row shape.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { amazonAds, pause as pauseAmazon, amazonAdsMetrics, amazonRows, planSpec as amazonPlan, spResult, region } from '../connectors/amazon-ads.mjs';
import { walmartConnect, pause as pauseWalmart, walmartConnectMetrics, walmartRows, parseReport, signHeaders, wmResult } from '../connectors/walmart-connect.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-retail-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const write = (f, s) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), JSON.stringify(s)); };
write('product.json', { name: 'Demo', budget: { mode: 'paid', monthly_cap: 600, daily_cap: 40 } });
write('outbox/amazon.json', { name: 'SP core', daily_budget: 20, default_bid: 0.75, ad_group: 'Core', asins: ['b0abcdefg1'], skus: ['SKU-1'],
  keywords: [{ text: 'invoice book', match: 'exact', bid: 1.1 }, 'receipt book'], negatives: ['free'] });
write('outbox/amazon-auto.json', { name: 'SP auto', daily_budget: 10, default_bid: 0.5, asins: ['B0ABCDEFG2'] });
write('outbox/amazon-bigbid.json', { name: 'SP big', daily_budget: 5, default_bid: 0.5, keywords: [{ text: 'x', bid: 9 }] });
write('outbox/amazon-budget.json', { action: 'budget', campaign_id: '123456789012', daily_budget: 25 });
write('outbox/walmart.json', { name: 'SS core', daily_budget: 30, total_budget: 600, start_date: '2026-11-06', ad_group: 'Core', default_bid: 0.5,
  items: [{ item_id: '555000111', bid: 0.6 }, '555000222'], keywords: [{ text: 'invoice book', match: 'exact', bid: 0.8 }, 'receipt book'] });
write('outbox/walmart-noitems.json', { name: 'SS none', daily_budget: 30, default_bid: 0.5, keywords: ['x'] });

const fake = (n) => `test-${n}-${'x'.repeat(10)}`;
const amzEnv = { AMAZON_ADS_CLIENT_ID: 'amzn1.application-oa2-client.demo', AMAZON_ADS_CLIENT_SECRET: fake('amzsecret'), AMAZON_ADS_REFRESH_TOKEN: fake('amzrefresh'), AMAZON_ADS_PROFILE_ID: '3200000000000001' };
const AMZ_ACCESS = fake('amzaccess');
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const derB64 = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
const wmEnv = { WALMART_ADS_CONSUMER_ID: 'c0ffee00-0000-4000-8000-000000000001', WALMART_ADS_PRIVATE_KEY: derB64, WALMART_ADS_AUTH_TOKEN: fake('wmauth'), WALMART_ADS_ADVERTISER_ID: '600001', WALMART_ADS_KEY_VERSION: '2' };

function mock(router) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method ?? 'GET', headers: Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])), body: init.body };
    try { call.json = typeof init.body === 'string' ? JSON.parse(init.body) : null; } catch { call.json = null; }
    if (init.body instanceof URLSearchParams) call.form = Object.fromEntries(init.body);
    calls.push(call);
    const [status, body, headers] = router(call, calls.length) ?? [200, {}];
    const payload = Buffer.isBuffer(body) ? body : (typeof body === 'string' ? body : JSON.stringify(body));
    return new Response(payload, { status, headers: headers ?? { 'content-type': 'application/json' } });
  };
  return { calls, fetch };
}
const ctxFor = (env, fetch, extra = {}) => ({ slug: 'demo', dir, env, now: '2026-11-03T10:00:00Z', dryRun: false, fetch, sleep: async () => {}, ...extra });
const noFetch = async () => { throw new Error('network must not be used'); };
const noSecrets = (r, env, extra = []) => {
  const s = JSON.stringify(r);
  for (const k of Object.keys(env).filter((n) => /TOKEN|SECRET|KEY/.test(n) && !/KEY_VERSION/.test(n))) assert.ok(!s.includes(env[k]), `${k} leaked into result`);
  for (const v of extra) assert.ok(!s.includes(v), 'runtime secret leaked into result');
};
const spend = (file, extra = {}) => ({ id: 'ap-1', type: 'spend', channel: 'amazon', amount: 20, file, ...extra });
const wspend = (file, extra = {}) => ({ id: 'ap-2', type: 'spend', channel: 'walmart', amount: 30, file, ...extra });

// Amazon router: token, then SP v3 creates answering multi-status success arrays.
const amazonRouter = (failOn = null) => (c) => {
  if (c.url.includes('/auth/o2/token')) return [200, { access_token: AMZ_ACCESS, token_type: 'bearer', expires_in: 3600 }];
  const res = c.url.split('/sp/')[1];
  if (res === failOn) return [400, { message: `bad request for ${AMZ_ACCESS}` }];
  const key = res; const body = c.json?.[key] ?? [];
  const idKey = { campaigns: 'campaignId', adGroups: 'adGroupId', productAds: 'adId', keywords: 'keywordId', negativeKeywords: 'negativeKeywordId' }[key];
  return [207, { [key]: { success: body.map((_, index) => ({ index, [idKey]: `${900 + index}${key.length}` })), error: [] } }];
};

// ── Amazon Ads ──
test('amazon: accepts only its own spend channels', () => {
  assert.equal(amazonAds.accepts({ type: 'spend', channel: 'amazon' }), true);
  assert.equal(amazonAds.accepts({ type: 'spend', channel: 'amazon-ads' }), true);
  assert.equal(amazonAds.accepts({ type: 'post', channel: 'amazon' }), false);
  assert.equal(amazonAds.accepts({ type: 'spend', channel: 'google' }), false);
  assert.equal(region({ AMAZON_ADS_REGION: 'EU' }).api, 'https://advertising-api-eu.amazon.com');
  assert.equal(region({}).token, 'https://api.amazon.com/auth/o2/token');
});

test('amazon: missing keys and dry run never touch the network', async () => {
  const miss = await amazonAds.execute(spend('outbox/amazon.json'), ctxFor({}, noFetch));
  assert.equal(miss.ok, false); assert.equal(miss.dry_run, true); assert.match(miss.detail, /missing AMAZON_ADS_CLIENT_ID/);
  const dry = await amazonAds.execute(spend('outbox/amazon.json'), ctxFor(amzEnv, noFetch, { dryRun: true }));
  assert.equal(dry.ok, true); assert.match(dry.detail, /would create PAUSED Amazon Sponsored Products campaign/);
  assert.match(dry.detail, /2 product ad\(s\), 2 keyword\(s\) and 1 negative/);
});

test('amazon: budget guard and bid guard refuse before any call', async () => {
  const over = await amazonAds.execute(spend('outbox/amazon.json', { amount: 10 }), ctxFor(amzEnv, noFetch));
  assert.equal(over.ok, false); assert.match(over.detail, /must be > 0 and <= approved amount 10/);
  const big = await amazonAds.execute(spend('outbox/amazon-bigbid.json', { amount: 5 }), ctxFor(amzEnv, noFetch));
  assert.equal(big.ok, false); assert.match(big.detail, /keyword bids must be > 0 and <= daily_budget 5/);
  assert.match(amazonPlan({ name: 'a', daily: 5, keywords: [{ text: 'k' }], negatives: [], default_bid: 1, targeting: 'auto' }, { id: 'x' }).error, /auto-targeted/);
  const base = { name: 'a', daily: 5, keywords: [], negatives: [], default_bid: 1, asins: ['B0ABCDEFG1'] };
  assert.match(amazonPlan({ ...base, asins: [] }, { id: 'x' }).error, /needs asins or skus/);
  assert.match(amazonPlan({ ...base, bidding: 'SPEND_IT_ALL' }, { id: 'x' }).error, /bidding must be one of/);
  assert.deepEqual(amazonPlan({ ...base, negatives: ['free', { x: 1 }, ' '] }, { id: 'x' }).negatives, ['free']);
  assert.match(amazonPlan({ ...base, default_bid: 'abc' }, { id: 'x' }).error, /default_bid/);
});

test('amazon: creates a PAUSED campaign, ad group, product ads, keywords and negatives', async () => {
  const m = mock(amazonRouter());
  const r = await amazonAds.execute(spend('outbox/amazon.json'), ctxFor(amzEnv, m.fetch));
  assert.equal(r.ok, true, r.detail); assert.equal(r.committed_daily, 0);
  const [tok, camp, ag, pa, kw, neg] = m.calls;
  assert.equal(tok.form.grant_type, 'refresh_token'); assert.equal(tok.form.refresh_token, amzEnv.AMAZON_ADS_REFRESH_TOKEN);
  assert.equal(camp.url, 'https://advertising-api.amazon.com/sp/campaigns'); assert.equal(camp.method, 'POST');
  assert.equal(camp.headers['amazon-advertising-api-scope'], amzEnv.AMAZON_ADS_PROFILE_ID);
  assert.equal(camp.headers['amazon-advertising-api-clientid'], amzEnv.AMAZON_ADS_CLIENT_ID);
  assert.equal(camp.headers['content-type'], 'application/vnd.spCampaign.v3+json');
  assert.equal(camp.headers.authorization, `Bearer ${AMZ_ACCESS}`);
  const c = camp.json.campaigns[0];
  assert.equal(c.state, 'PAUSED'); assert.equal(c.targetingType, 'MANUAL'); assert.deepEqual(c.budget, { budgetType: 'DAILY', budget: 20 });
  assert.equal(c.startDate, '2026-11-03'); assert.match(c.name, /SP core · ap-1/);
  assert.equal(ag.json.adGroups[0].defaultBid, 0.75); assert.equal(ag.json.adGroups[0].campaignId, '9009');
  assert.deepEqual(pa.json.productAds.map((x) => x.asin ?? x.sku), ['B0ABCDEFG1', 'SKU-1']);
  assert.deepEqual(kw.json.keywords.map((k) => [k.keywordText, k.matchType, k.bid]), [['invoice book', 'EXACT', 1.1], ['receipt book', 'PHRASE', undefined]]);
  assert.equal(neg.json.negativeKeywords[0].matchType, 'NEGATIVE_PHRASE');
  assert.equal(r.ref, '9009/9008');
  noSecrets(r, amzEnv, [AMZ_ACCESS]);
});

test('amazon: activate true creates ENABLED and commits the daily budget; auto campaign skips keywords', async () => {
  const m = mock(amazonRouter());
  const r = await amazonAds.execute(spend('outbox/amazon-auto.json', { activate: true, amount: 10 }), ctxFor(amzEnv, m.fetch));
  assert.equal(r.ok, true, r.detail); assert.equal(r.committed_daily, 10);
  assert.equal(m.calls[1].json.campaigns[0].state, 'ENABLED'); assert.equal(m.calls[1].json.campaigns[0].targetingType, 'AUTO');
  assert.equal(m.calls.filter((c) => c.url.endsWith('/sp/keywords')).length, 0);
});

test('amazon: a failure after the campaign exists is partial and redacts the access token', async () => {
  const m = mock(amazonRouter('keywords'));
  const r = await amazonAds.execute(spend('outbox/amazon.json'), ctxFor(amzEnv, m.fetch));
  assert.equal(r.ok, false); assert.equal(r.partial, true); assert.equal(r.ref, '9009/9008');
  assert.match(r.detail, /already created \(paused\)/);
  noSecrets(r, amzEnv, [AMZ_ACCESS]);
});

test('amazon: multi-status errors fail the step', async () => {
  const m = mock((c) => (c.url.includes('/auth/') ? [200, { access_token: AMZ_ACCESS }] : [207, { campaigns: { success: [], error: [{ index: 0, errors: [{ errorType: 'INVALID_ARGUMENT' }] }] } }]));
  const r = await amazonAds.execute(spend('outbox/amazon.json'), ctxFor(amzEnv, m.fetch));
  assert.equal(r.ok, false); assert.match(r.detail, /INVALID_ARGUMENT/); assert.notEqual(r.partial, true);
  assert.deepEqual(spResult({ adGroups: { success: [{ index: 1, adGroupId: 'b' }, { index: 0, adGroupId: 'a' }] } }, 'adGroups', 'adGroupId').ids, ['a', 'b']);
});

test('amazon: budget change updates one campaign and counts the new budget', async () => {
  const m = mock(amazonRouter());
  const r = await amazonAds.execute(spend('outbox/amazon-budget.json', { amount: 25 }), ctxFor(amzEnv, m.fetch));
  assert.equal(r.ok, true, r.detail); assert.equal(r.committed_daily, 25); assert.equal(r.ref, '123456789012');
  const put = m.calls[1];
  assert.equal(put.method, 'PUT'); assert.deepEqual(put.json, { campaigns: [{ campaignId: '123456789012', budget: { budgetType: 'DAILY', budget: 25 } }] });
  const over = await amazonAds.execute(spend('outbox/amazon-budget.json', { amount: 20 }), ctxFor(amzEnv, noFetch));
  assert.equal(over.ok, false);
});

test('amazon: pause() sends state PAUSED, never throws, honours dry run', async () => {
  const m = mock(amazonRouter());
  const r = await pauseAmazon('123456789012/555', amzEnv, false, { fetch: m.fetch });
  assert.equal(r.ok, true); assert.deepEqual(m.calls[1].json, { campaigns: [{ campaignId: '123456789012', state: 'PAUSED' }] });
  assert.equal((await pauseAmazon('123', amzEnv, true, { fetch: noFetch })).detail, 'would pause Amazon campaign 123');
  assert.equal((await pauseAmazon('abc', amzEnv, false, { fetch: noFetch })).ok, false);
  assert.match((await pauseAmazon('123', {}, false, { fetch: noFetch })).detail, /missing AMAZON_ADS_CLIENT_ID/);
  const down = await pauseAmazon('123', amzEnv, false, { fetch: async () => { throw new Error(`socket closed ${amzEnv.AMAZON_ADS_CLIENT_SECRET}`); } });
  assert.equal(down.ok, false); noSecrets(down, amzEnv);
});

test('amazon metrics: duplicate report (425) is polled, gzip JSON becomes rows with ACOS', async () => {
  const reportId = '0f6b1e2a-1111-4222-8333-444455556666';
  const report = zlib.gzipSync(Buffer.from(JSON.stringify([
    { date: '2026-11-01', campaignId: 111, cost: 12.345, clicks: 30, impressions: 900, purchases7d: 3, sales7d: 61.7 },
    { date: '2026-11-02', campaignId: 111, cost: 4, clicks: 9, impressions: 300, purchases7d: 0, sales7d: 0 },
  ])));
  let polls = 0;
  const m = mock((c) => {
    if (c.url.includes('/auth/o2/token')) return [200, { access_token: AMZ_ACCESS }];
    if (c.url.endsWith('/reporting/reports') && c.method === 'POST') return [425, { code: '425', detail: `The Request is a duplicate of : ${reportId}` }];
    if (c.url.endsWith(`/reporting/reports/${reportId}`)) return (++polls < 2) ? [200, { reportId, status: 'PENDING' }] : [200, { reportId, status: 'COMPLETED', url: 'https://offline-report-storage.s3.amazonaws.com/r.json.gz?sig=1' }];
    if (c.url.startsWith('https://offline-report-storage')) { assert.equal(c.headers.authorization, undefined); return [200, report, { 'content-type': 'application/octet-stream' }]; }
    return [404, {}];
  });
  const r = await amazonAdsMetrics.read(ctxFor(amzEnv, m.fetch), { days: 45, polls: 3, pollMs: 1 });
  assert.equal(r.ok, true, r.detail);
  const sub = m.calls[1];
  assert.equal(sub.headers['content-type'], 'application/vnd.createasyncreportrequest.v3+json');
  assert.equal(sub.json.configuration.reportTypeId, 'spCampaigns'); assert.equal(sub.json.configuration.timeUnit, 'DAILY');
  assert.equal(sub.json.startDate, '2026-10-03'); // capped at 31 days
  const day1 = r.rows.filter((x) => x.date === '2026-11-01');
  assert.deepEqual(day1.map((x) => [x.metric, x.value]), [['spend', 12.35], ['clicks', 30], ['conversions', 3], ['sales', 61.7], ['acos', 20.02]]);
  assert.ok(r.rows.every((x) => x.channel === 'amazon' && x.campaign === '111'));
  assert.equal(r.rows.filter((x) => x.date === '2026-11-02' && x.metric === 'acos').length, 0);
  noSecrets(r, amzEnv, [AMZ_ACCESS]);
});

test('amazon metrics: still-pending report fails this cycle; missing keys is a dry run', async () => {
  const m = mock((c) => (c.url.includes('/auth/') ? [200, { access_token: AMZ_ACCESS }] : c.method === 'POST' ? [200, { reportId: 'r-1', status: 'PENDING' }] : [200, { reportId: 'r-1', status: 'PROCESSING' }]));
  const r = await amazonAdsMetrics.read(ctxFor(amzEnv, m.fetch), { polls: 2, pollMs: 1 });
  assert.equal(r.ok, false); assert.match(r.detail, /still processing after 2 poll/);
  const d = await amazonAdsMetrics.read(ctxFor({}, noFetch), {});
  assert.equal(d.dry_run, true); assert.deepEqual(d.rows, []);
  assert.equal(amazonRows({ date: '2026-11-01', campaignId: 1, cost: 0, sales7d: 0 }).length, 4);
});

// ── Walmart Connect ──
const walmartRouter = (failOn = null) => (c) => {
  const res = c.url.replace(/^https:\/\/developer\.api\.walmart\.com\/api-proxy\/service\/WPA\/Api\/v1\/api\/v1\//, '').split('?')[0];
  if (res === failOn) return [400, [{ code: 'failure', details: `bad ${wmEnv.WALMART_ADS_AUTH_TOKEN}` }]];
  if (res === 'campaigns' && c.method === 'POST') return [200, [{ code: 'success', details: '', campaignId: 700001 }]];
  if (res === 'campaigns' && c.method === 'PUT') return [200, [{ code: 'success', details: '', campaignId: 700001 }]];
  if (res === 'adGroups') return [200, [{ code: 'success', details: '', adGroupId: 800001 }]];
  return [200, (c.json ?? []).map(() => ({ code: 'success', details: '' }))];
};

test('walmart: accepts its channels; missing keys and dry run never touch the network', async () => {
  assert.equal(walmartConnect.accepts({ type: 'spend', channel: 'walmart_connect' }), true);
  assert.equal(walmartConnect.accepts({ type: 'spend', channel: 'amazon' }), false);
  const miss = await walmartConnect.execute(wspend('outbox/walmart.json'), ctxFor({}, noFetch));
  assert.equal(miss.ok, false); assert.match(miss.detail, /missing WALMART_ADS_CONSUMER_ID/);
  const dry = await walmartConnect.execute(wspend('outbox/walmart.json', { activate: true }), ctxFor(wmEnv, noFetch, { dryRun: true }));
  assert.match(dry.detail, /would create PAUSED Walmart Sponsored Search campaign .* 2 item\(s\) and 2 keyword\(s\); Walmart rollover is always on.* \(activate ignored/);
  const none = await walmartConnect.execute(wspend('outbox/walmart-noitems.json'), ctxFor(wmEnv, noFetch));
  assert.equal(none.ok, false); assert.match(none.detail, /needs items/);
  const over = await walmartConnect.execute(wspend('outbox/walmart.json', { amount: 10 }), ctxFor(wmEnv, noFetch));
  assert.equal(over.ok, false); assert.match(over.detail, /approved amount 10/);
});

test('walmart: signed headers verify with the public key', () => {
  const h = signHeaders(wmEnv, Date.parse('2026-11-03T10:00:00Z'));
  assert.equal(h['WM_CONSUMER.intimestamp'], String(Date.parse('2026-11-03T10:00:00Z')));
  assert.equal(h['WM_SEC.KEY_VERSION'], '2');
  const ok = crypto.createVerify('RSA-SHA256').update(`${wmEnv.WALMART_ADS_CONSUMER_ID}\n${h['WM_CONSUMER.intimestamp']}\n2\n`).verify(publicKey, h['WM_SEC.AUTH_SIGNATURE'], 'base64');
  assert.equal(ok, true);
  const pemEnv = { ...wmEnv, WALMART_ADS_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).replace(/\n/g, '\\n') };
  assert.equal(signHeaders(pemEnv, 1)['WM_SEC.AUTH_SIGNATURE'], signHeaders(wmEnv, 1)['WM_SEC.AUTH_SIGNATURE']);
});

test('walmart: creates the campaign already paused, then ad group, items and keywords; activate is ignored', async () => {
  const m = mock(walmartRouter());
  const r = await walmartConnect.execute(wspend('outbox/walmart.json', { activate: true }), ctxFor(wmEnv, m.fetch));
  assert.equal(r.ok, true, r.detail); assert.equal(r.committed_daily, 0); assert.equal(r.ref, '700001/800001');
  assert.ok(m.calls.every((c) => c.url.startsWith('https://developer.api.walmart.com/api-proxy/service/WPA/Api/v1/api/v1/')));
  assert.deepEqual(m.calls.map((c) => `${c.method} ${c.url.split('/api/v1/')[1]}`), ['POST campaigns', 'POST adGroups', 'POST adItems', 'POST keywords']);
  assert.equal(m.calls.filter((c) => c.method !== 'POST').length, 0); // nothing is ever set live
  const camp = m.calls[0];
  assert.equal(camp.headers['wm_consumer.id'], wmEnv.WALMART_ADS_CONSUMER_ID); assert.ok(camp.headers['wm_sec.auth_signature']);
  assert.equal(camp.headers.authorization, `Bearer ${wmEnv.WALMART_ADS_AUTH_TOKEN}`);
  // The signature uses the real clock, not the run's pinned ctx.now (a stale stamp is rejected).
  assert.ok(Math.abs(Number(camp.headers['wm_consumer.intimestamp']) - Date.now()) < 60000);
  assert.deepEqual({ ...camp.json[0], name: undefined }, { name: undefined, campaignType: 'sponsoredProducts', targetingType: 'manual', status: 'paused', advertiserId: 600001, startDate: '2026-11-06', endDate: '9999-12-30', budgetType: 'both', dailyBudget: 30, totalBudget: 600, rollover: true });
  assert.deepEqual(m.calls[2].json.map((x) => [x.itemId, x.bid]), [['555000111', 0.6], ['555000222', 0.5]]);
  assert.deepEqual(m.calls[3].json.map((x) => [x.keywordText, x.matchType, x.bid]), [['invoice book', 'exact', 0.8], ['receipt book', 'phrase', 0.5]]); // plain-string keywords default to phrase (loadSpec)
  noSecrets(r, wmEnv);
  const badAdv = await walmartConnect.execute(wspend('outbox/walmart.json'), ctxFor({ ...wmEnv, WALMART_ADS_ADVERTISER_ID: 'acme' }, noFetch));
  assert.equal(badAdv.ok, false); assert.match(badAdv.detail, /numeric advertiser id/);
});

test('walmart: a create answered with failure stops before anything else is created', async () => {
  const m = mock((c) => (c.url.endsWith('/campaigns') ? [200, [{ code: 'failure', details: 'dailyBudget below minimum' }]] : [500, {}]));
  const r = await walmartConnect.execute(wspend('outbox/walmart.json'), ctxFor(wmEnv, m.fetch));
  assert.equal(r.ok, false); assert.notEqual(r.partial, true); assert.match(r.detail, /below minimum/);
  assert.equal(m.calls.length, 1);
});

test('walmart: a failure after the campaign exists is partial and redacted', async () => {
  const m = mock(walmartRouter('adItems'));
  const r = await walmartConnect.execute(wspend('outbox/walmart.json'), ctxFor(wmEnv, m.fetch));
  assert.equal(r.ok, false); assert.equal(r.partial, true); assert.equal(r.ref, '700001/800001');
  noSecrets(r, wmEnv);
  assert.deepEqual(wmResult([{ code: 'failure', details: 'nope' }], 'campaignId'), { ids: [], errors: ['nope'] });
});

test('walmart: pause() sends status paused and never throws', async () => {
  const m = mock(walmartRouter());
  const r = await pauseWalmart('700001/800001', wmEnv, false, { fetch: m.fetch });
  assert.equal(r.ok, true); assert.equal(m.calls[0].method, 'PUT'); assert.deepEqual(m.calls[0].json, [{ campaignId: 700001, advertiserId: 600001, status: 'paused' }]);
  assert.equal((await pauseWalmart('700001', wmEnv, true, { fetch: noFetch })).ok, true);
  assert.equal((await pauseWalmart('', wmEnv, false, { fetch: noFetch })).ok, false);
  const bad = await pauseWalmart('700001', wmEnv, false, { fetch: mock(walmartRouter('campaigns')).fetch });
  assert.equal(bad.ok, false); noSecrets(bad, wmEnv);
});

test('walmart metrics: snapshot is polled, gzip CSV becomes rows with ACOS', async () => {
  // adGroup rows: two ad groups of campaign 700001 on 2026-11-01 are summed into one campaign-day.
  const csv = 'date,campaignId,adGroupId,adSpend,numAdsClicks,attributedOrders14days,attributedSales14days\r\n2026-11-01,700001,1,"1,000.50",390,10,"4,000.00"\r\n2026-11-01,700001,2,20,10,2,82\r\n11/02/2026,700001,1,10,5,0,0\r\nTotal,,,1030.5,405,12,4082\r\n';
  let polls = 0;
  const m = mock((c) => {
    if (c.url.endsWith('/snapshot/report')) return [200, { code: 'success', snapshotId: 'snap-9', jobStatus: 'pending' }];
    if (c.url.includes('/snapshot?')) return (++polls < 2) ? [200, [{ snapshotId: 'snap-9', jobStatus: 'processing' }]] : [200, [{ snapshotId: 'snap-9', jobStatus: 'done', details: 'https://reports.walmart.example/snap-9.csv.gz' }]];
    if (c.url.startsWith('https://reports.walmart.example')) { assert.equal(c.headers['wm_sec.auth_signature'], undefined); return [200, zlib.gzipSync(Buffer.from(csv)), { 'content-type': 'application/gzip' }]; }
    return [404, {}];
  });
  const r = await walmartConnectMetrics.read(ctxFor(wmEnv, m.fetch), { days: 7, polls: 3, pollMs: 1 });
  assert.equal(r.ok, true, r.detail);
  assert.match(m.calls[0].url, /\/WPA\/Api\/v1\/api\/v2\/snapshot\/report$/);
  // endDate is yesterday (today is not allowed); 7 days inclusive.
  assert.deepEqual(m.calls[0].json, { advertiserId: 600001, startDate: '2026-10-27', endDate: '2026-11-02', reportType: 'adGroup', reportMetrics: ['date', 'campaignId', 'adGroupId', 'adSpend', 'numAdsClicks', 'attributedOrders14days', 'attributedSales14days'] });
  assert.match(m.calls[1].url, /\/api\/v2\/snapshot\?advertiserId=600001&snapshotId=snap-9/);
  assert.deepEqual(r.rows.filter((x) => x.date === '2026-11-01').map((x) => [x.metric, x.value]), [['spend', 1020.5], ['clicks', 400], ['conversions', 12], ['sales', 4082], ['acos', 25]]);
  assert.equal(r.rows.filter((x) => x.date === '2026-11-02').length, 4);
  assert.ok(r.rows.every((x) => x.channel === 'walmart' && x.campaign === '700001'));
  assert.match(r.detail, /2 campaign-day/);
  noSecrets(r, wmEnv);
});

test('walmart metrics: failed or pending snapshot errors; JSON lines parse; missing keys is a dry run', async () => {
  const pend = mock((c) => (c.url.endsWith('/snapshot/report') ? [200, { snapshotId: 's' }] : [200, { jobStatus: 'pending' }]));
  assert.match((await walmartConnectMetrics.read(ctxFor(wmEnv, pend.fetch), { polls: 2, pollMs: 1 })).detail, /still pending after 2 poll/);
  const failed = mock((c) => (c.url.endsWith('/snapshot/report') ? [200, { snapshotId: 's' }] : [200, { jobStatus: 'failed' }]));
  assert.match((await walmartConnectMetrics.read(ctxFor(wmEnv, failed.fetch), { polls: 1 })).detail, /ended failed/);
  assert.deepEqual(parseReport('{"date":"2026-11-01","campaignId":1}\n{"date":"2026-11-02","campaignId":1}').map((x) => x.date), ['2026-11-01', '2026-11-02']);
  assert.equal(walmartRows({ date: '2026-11-01', campaignId: 1, adSpend: 3, attributedSales3days: 6 }).find((x) => x.metric === 'acos').value, 50);
  const d = await walmartConnectMetrics.read(ctxFor({}, noFetch), {});
  assert.equal(d.dry_run, true); assert.equal(d.ok, false);
});
