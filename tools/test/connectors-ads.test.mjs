// TikTok Ads and LinkedIn Ads API connectors plus the ad-platform metric readers, all against a
// mocked ctx.fetch (no real network): missing keys, dry run, budget guard, paused/disabled by
// default, activate: true, secret redaction, pause(), routing, and report parsing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pick } from '../connectors/index.mjs';
import { tiktokAds, pause as pauseTiktok } from '../connectors/tiktok-ads.mjs';
import { linkedinAds, pause as pauseLinkedin, LINKEDIN_ADS_VERSION } from '../connectors/linkedin-ads.mjs';
import { googleAdsMetrics, tiktokAdsMetrics, linkedinAdsMetrics, pullMetrics } from '../connectors/readers.mjs';
import { extraStatus } from '../connectors/extra.mjs';
import { googleAds, pauseGoogle } from '../connectors/ads.mjs';
import { GOOGLE_ADS_API_VERSION } from '../connectors/google-auth.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-ads-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const write = (f, s) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), JSON.stringify(s)); };
write('product.json', { name: 'Demo', domain: 'demo.example', budget: { mode: 'paid', monthly_cap: 300, daily_cap: 30 } });
write('outbox/tiktok.json', { name: 'TT launch', daily_budget: 20, objective: 'Traffic', ad_group: 'Core', final_url: 'https://demo.example/', text: 'Get paid faster', cta: 'Learn more',
  audience: { locations: ['US', 'GB'], age_groups: ['AGE_25_34'] }, identity_id: 'ident-1', video_id: 'v-1', image_ids: ['img-1'] });
write('outbox/tiktok-nocreative.json', { name: 'TT bare', daily_budget: 20, audience: { location_ids: [6252001] } });
write('outbox/tiktok-noloc.json', { name: 'TT noloc', daily_budget: 20 });
write('outbox/linkedin.json', { name: 'LI ABM', daily_budget: 25, currency: 'eur', max_cpc: 6,
  targeting: { locations: ['US', 'urn:li:geo:101165590'], job_functions: [4], seniorities: ['urn:li:seniority:5'], titles: [123] }, creative_reference: 'urn:li:share:777' });
write('outbox/linkedin-badtitle.json', { name: 'LI bad', daily_budget: 25, targeting: { locations: ['US'], titles: ['Head of Finance'] } });

const fake = (name) => `test-${name}-${'x'.repeat(8)}`;
const tkEnv = { TIKTOK_ACCESS_TOKEN: fake('tiktok'), TIKTOK_ADVERTISER_ID: '7000001' };
const liEnv = { LINKEDIN_ACCESS_TOKEN: fake('linkedin'), LINKEDIN_AD_ACCOUNT_ID: '508000' };

function mock(router) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method ?? 'GET', headers: Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])), body: init.body };
    try { call.json = typeof init.body === 'string' ? JSON.parse(init.body) : null; } catch { call.json = null; }
    calls.push(call);
    const [status, body, headers] = router(call, calls.length) ?? [200, {}];
    return new Response(status === 204 ? null : (typeof body === 'string' ? body : JSON.stringify(body)), { status, headers: headers ?? { 'content-type': 'application/json' } });
  };
  return { calls, fetch };
}
const ctxFor = (env, fetch, extra = {}) => ({ slug: 'demo', dir, env, now: '2026-11-03T10:00:00Z', dryRun: false, fetch, ...extra });
const noFetch = async () => { throw new Error('network must not be used'); };
const noSecrets = (r, env) => { for (const k of Object.keys(env).filter((n) => /TOKEN/.test(n))) assert.ok(!JSON.stringify(r).includes(env[k]), `${k} leaked into result`); };

// TikTok router: ok envelope {code:0, data} per endpoint.
const tkRouter = (c) => {
  if (c.url.includes('/campaign/create/')) return [200, { code: 0, message: 'OK', data: { campaign_id: '1800000001' } }];
  if (c.url.includes('/adgroup/create/')) return [200, { code: 0, message: 'OK', data: { adgroup_id: '1800000002' } }];
  if (c.url.includes('/ad/create/')) return [200, { code: 0, message: 'OK', data: { ad_ids: ['1800000003'] } }];
  if (c.url.includes('/status/update/')) return [200, { code: 0, message: 'OK', data: {} }];
  return [404, { code: 40000, message: 'unknown' }];
};
const tkItem = (extra = {}) => ({ id: 'TT1', type: 'spend', channel: 'tiktok', amount: 25, file: 'outbox/tiktok.json', ...extra });

test('tiktok: missing keys refuses without network; dry run makes no call', async () => {
  const r = await tiktokAds.execute(tkItem(), ctxFor({}, noFetch));
  assert.equal(r.ok, false); assert.equal(r.dry_run, true); assert.match(r.detail, /missing TIKTOK_ACCESS_TOKEN, TIKTOK_ADVERTISER_ID/);
  assert.equal(tiktokAds.configured({}), false);
  const d = await tiktokAds.execute(tkItem(), ctxFor(tkEnv, noFetch, { dryRun: true }));
  assert.equal(d.ok, true); assert.equal(d.ref, 'dry-run'); assert.match(d.detail, /would create DISABLE TikTok campaign/);
});

test('tiktok: budget above the approved amount and bad specs are refused before any call', async () => {
  const over = await tiktokAds.execute(tkItem({ amount: 10 }), ctxFor(tkEnv, noFetch));
  assert.equal(over.ok, false); assert.match(over.detail, /approved amount/);
  const noloc = await tiktokAds.execute(tkItem({ file: 'outbox/tiktok-noloc.json' }), ctxFor(tkEnv, noFetch));
  assert.equal(noloc.ok, false); assert.match(noloc.detail, /location_ids/);
});

test('tiktok: campaign, ad group and ad created DISABLE by default, Access-Token header, no secrets in details', async () => {
  const m = mock(tkRouter);
  const r = await tiktokAds.execute(tkItem(), ctxFor(tkEnv, m.fetch));
  assert.ok(r.ok, r.detail); assert.equal(r.committed_daily, 0);
  assert.equal(r.ref, '1800000001/1800000002/1800000003');
  assert.deepEqual(m.calls.map((c) => c.url.replace('https://business-api.tiktok.com/open_api/v1.3/', '')), ['campaign/create/', 'adgroup/create/', 'ad/create/']);
  for (const c of m.calls) { assert.equal(c.headers['access-token'], tkEnv.TIKTOK_ACCESS_TOKEN); assert.equal(c.json.advertiser_id, '7000001'); assert.equal(c.json.operation_status, 'DISABLE'); }
  assert.equal(m.calls[0].json.objective_type, 'TRAFFIC');
  const ag = m.calls[1].json;
  assert.equal(ag.campaign_id, '1800000001'); assert.equal(ag.budget_mode, 'BUDGET_MODE_DAY'); assert.equal(ag.budget, 20);
  assert.deepEqual(ag.location_ids, ['6252001', '2635167']); assert.deepEqual(ag.placements, ['PLACEMENT_TIKTOK']); assert.deepEqual(ag.age_groups, ['AGE_25_34']);
  const cr = m.calls[2].json.creatives[0];
  assert.equal(m.calls[2].json.adgroup_id, '1800000002'); assert.equal(cr.video_id, 'v-1'); assert.equal(cr.call_to_action, 'LEARN_MORE'); assert.equal(cr.landing_page_url, 'https://demo.example/');
  noSecrets(r, tkEnv);
  const bare = mock(tkRouter);
  const b = await tiktokAds.execute(tkItem({ file: 'outbox/tiktok-nocreative.json' }), ctxFor(tkEnv, bare.fetch));
  assert.ok(b.ok, b.detail); assert.equal(bare.calls.length, 2, 'no creative in spec: no ad call');
});

test('tiktok: activate:true enables everything; API errors are redacted', async () => {
  const m = mock(tkRouter);
  const r = await tiktokAds.execute(tkItem({ activate: true }), ctxFor(tkEnv, m.fetch));
  assert.ok(r.ok); assert.equal(r.committed_daily, 20);
  assert.ok(m.calls.every((c) => c.json.operation_status === 'ENABLE'));
  const e = mock(() => [200, { code: 40100, message: `invalid token ${tkEnv.TIKTOK_ACCESS_TOKEN}` }]);
  const bad = await tiktokAds.execute(tkItem(), ctxFor(tkEnv, e.fetch));
  assert.equal(bad.ok, false); assert.match(bad.detail, /code 40100/); noSecrets(bad, tkEnv);
});

test('tiktok: pause() disables a campaign or an ad group; dry run and missing keys make no call', async () => {
  const m = mock(tkRouter);
  const r = await pauseTiktok('1800000001/1800000002/1800000003', tkEnv, false, { fetch: m.fetch });
  assert.ok(r.ok, r.detail); assert.match(m.calls[0].url, /\/campaign\/status\/update\/$/);
  assert.deepEqual(m.calls[0].json, { advertiser_id: '7000001', campaign_ids: ['1800000001'], operation_status: 'DISABLE' });
  const g = await pauseTiktok('adgroup:1800000002', tkEnv, false, { fetch: m.fetch });
  assert.ok(g.ok); assert.deepEqual(m.calls[1].json.adgroup_ids, ['1800000002']);
  assert.equal((await pauseTiktok('1', tkEnv, true, { fetch: noFetch })).ok, true);
  const miss = await pauseTiktok('1', {}, false, { fetch: noFetch });
  assert.equal(miss.ok, false); assert.match(miss.detail, /missing TIKTOK_ACCESS_TOKEN/);
  assert.equal(typeof tiktokAds.pause, 'function');
});

// LinkedIn router: 201 with x-restli-id for creates, 204 for the partial update.
const liRouter = (c) => {
  if (c.headers['x-restli-method'] === 'PARTIAL_UPDATE') return [204, null];
  if (c.url.endsWith('/adCampaignGroups')) return [201, '', { 'x-restli-id': '611' }];
  if (c.url.endsWith('/adCampaigns')) return [201, '', { 'x-restli-id': '722' }];
  if (c.url.endsWith('/creatives')) return [201, '', { 'x-restli-id': 'urn:li:sponsoredCreative:833' }];
  return [404, { message: 'unknown' }];
};
const liItem = (extra = {}) => ({ id: 'LI1', type: 'spend', channel: 'linkedin', amount: 30, file: 'outbox/linkedin.json', ...extra });

test('linkedin ads: missing keys refuses without network; dry run makes no call; budget guard', async () => {
  const r = await linkedinAds.execute(liItem(), ctxFor({}, noFetch));
  assert.equal(r.ok, false); assert.equal(r.dry_run, true); assert.match(r.detail, /missing LINKEDIN_ACCESS_TOKEN, LINKEDIN_AD_ACCOUNT_ID/);
  const d = await linkedinAds.execute(liItem(), ctxFor(liEnv, noFetch, { dryRun: true }));
  assert.equal(d.ok, true); assert.equal(d.ref, 'dry-run'); assert.match(d.detail, /DRAFT LinkedIn campaign group and PAUSED campaign/);
  const over = await linkedinAds.execute(liItem({ amount: 20 }), ctxFor(liEnv, noFetch));
  assert.equal(over.ok, false); assert.match(over.detail, /approved amount/);
  const bad = await linkedinAds.execute(liItem({ file: 'outbox/linkedin-badtitle.json' }), ctxFor(liEnv, noFetch));
  assert.equal(bad.ok, false); assert.match(bad.detail, /titles must be ids or URNs/);
});

test('linkedin ads: group DRAFT, campaign PAUSED by default with budget, targeting and a creative', async () => {
  const m = mock(liRouter);
  const r = await linkedinAds.execute(liItem(), ctxFor(liEnv, m.fetch));
  assert.ok(r.ok, r.detail); assert.equal(r.committed_daily, 0); assert.equal(r.ref, 'urn:li:sponsoredCampaign:722');
  assert.deepEqual(m.calls.map((c) => c.url), ['https://api.linkedin.com/rest/adAccounts/508000/adCampaignGroups', 'https://api.linkedin.com/rest/adAccounts/508000/adCampaigns', 'https://api.linkedin.com/rest/adAccounts/508000/creatives']);
  for (const c of m.calls) {
    assert.equal(c.headers.authorization, `Bearer ${liEnv.LINKEDIN_ACCESS_TOKEN}`);
    assert.equal(c.headers['linkedin-version'], LINKEDIN_ADS_VERSION); assert.equal(c.headers['x-restli-protocol-version'], '2.0.0');
  }
  const [group, camp, creative] = m.calls.map((c) => c.json);
  assert.equal(group.account, 'urn:li:sponsoredAccount:508000'); assert.equal(group.status, 'DRAFT');
  assert.equal(camp.status, 'PAUSED'); assert.equal(camp.campaignGroup, 'urn:li:sponsoredCampaignGroup:611');
  assert.deepEqual(camp.dailyBudget, { amount: '25.00', currencyCode: 'EUR' }); assert.deepEqual(camp.unitCost, { amount: '6.00', currencyCode: 'EUR' });
  assert.deepEqual(camp.targetingCriteria.include.and, [
    { or: { 'urn:li:adTargetingFacet:locations': ['urn:li:geo:103644278', 'urn:li:geo:101165590'] } },
    { or: { 'urn:li:adTargetingFacet:jobFunctions': ['urn:li:function:4'] } },
    { or: { 'urn:li:adTargetingFacet:seniorities': ['urn:li:seniority:5'] } },
    { or: { 'urn:li:adTargetingFacet:titles': ['urn:li:title:123'] } },
  ]);
  assert.deepEqual(creative, { campaign: 'urn:li:sponsoredCampaign:722', content: { reference: 'urn:li:share:777' }, intendedStatus: 'PAUSED' });
  noSecrets(r, liEnv);
});

test('linkedin ads: activate:true sets ACTIVE; errors are redacted; pause() patches status', async () => {
  const m = mock(liRouter);
  const r = await linkedinAds.execute(liItem({ activate: true }), ctxFor(liEnv, m.fetch));
  assert.ok(r.ok); assert.equal(r.committed_daily, 25);
  assert.equal(m.calls[0].json.status, 'ACTIVE'); assert.equal(m.calls[1].json.status, 'ACTIVE'); assert.equal(m.calls[2].json.intendedStatus, 'ACTIVE');
  const e = mock(() => [401, { message: `bad token ${liEnv.LINKEDIN_ACCESS_TOKEN}` }]);
  const bad = await linkedinAds.execute(liItem(), ctxFor(liEnv, e.fetch));
  assert.equal(bad.ok, false); assert.match(bad.detail, /HTTP 401/); noSecrets(bad, liEnv);

  const p = mock(liRouter);
  const res = await pauseLinkedin('urn:li:sponsoredCampaign:722', liEnv, false, { fetch: p.fetch });
  assert.ok(res.ok, res.detail);
  assert.equal(p.calls[0].url, 'https://api.linkedin.com/rest/adAccounts/508000/adCampaigns/722');
  assert.equal(p.calls[0].headers['x-restli-method'], 'PARTIAL_UPDATE'); assert.deepEqual(p.calls[0].json, { patch: { $set: { status: 'PAUSED' } } });
  assert.equal((await pauseLinkedin('722', liEnv, true, { fetch: noFetch })).ok, true);
  assert.equal((await pauseLinkedin('722', {}, false, { fetch: noFetch })).ok, false);
  assert.equal(typeof linkedinAds.pause, 'function');
});

test('routing: API connector only when configured, else the existing TikTok CSV exporter; organic LinkedIn unchanged', () => {
  const ctx = { slug: 'demo', dir, now: '2026-11-03T00:00:00Z' };
  const csv = { OM_ADS_CSV_EXPORT: '1' };
  assert.equal(pick({ type: 'spend', channel: 'tiktok' }, csv, ctx)?.name, 'tiktok-ads-csv');
  assert.equal(pick({ type: 'spend', channel: 'tiktok' }, { ...csv, ...tkEnv }, ctx)?.name, 'tiktok-ads');
  assert.equal(pick({ type: 'spend', channel: 'tiktok_ads' }, tkEnv, ctx)?.name, 'tiktok-ads');
  assert.equal(pick({ type: 'spend', channel: 'linkedin' }, csv, ctx), null, 'no LinkedIn keys: manual');
  assert.equal(pick({ type: 'spend', channel: 'linkedin-ads' }, liEnv, ctx)?.name, 'linkedin-ads');
  assert.equal(pick({ type: 'post', channel: 'linkedin' }, { ...liEnv, LINKEDIN_AUTHOR_URN: 'urn:li:organization:5' }, ctx)?.name, 'linkedin', 'organic posts stay with the post connector');
  assert.equal(pick({ type: 'spend', channel: 'reddit' }, { ...csv, ...tkEnv, ...liEnv }, ctx)?.name, 'reddit-ads-csv');
  const st = extraStatus({ ...tkEnv, ...liEnv });
  for (const n of ['tiktok-ads', 'linkedin-ads', 'tiktok-ads-metrics', 'linkedin-ads-metrics']) assert.ok(st.find((s) => s.name === n)?.configured, `${n} configured`);
  assert.ok(!JSON.stringify(st).includes(tkEnv.TIKTOK_ACCESS_TOKEN) && !JSON.stringify(st).includes(liEnv.LINKEDIN_ACCESS_TOKEN), 'status never contains secrets');
});

test('readers: Google Ads searchStream, TikTok report and LinkedIn adAnalytics parse into campaign rows', async () => {
  const gEnv = { GOOGLE_ADS_DEVELOPER_TOKEN: fake('gadev'), GOOGLE_ADS_CUSTOMER_ID: '123-456-7890', GOOGLE_ACCESS_TOKEN: 'ya29.access' };
  let m = mock(() => [200, [{ results: [{ campaign: { id: '111', name: 'Search' }, segments: { date: '2026-11-01' }, metrics: { costMicros: '4560000', clicks: '12', conversions: 2 } }] }, { results: [{ campaign: { id: '222' }, segments: { date: '2026-11-02' }, metrics: { costMicros: '1000000', clicks: '3' } }] }]]);
  let r = await googleAdsMetrics.read(ctxFor(gEnv, m.fetch), { days: 7 });
  assert.ok(r.ok, r.detail);
  assert.equal(m.calls[0].url, `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/1234567890/googleAds:searchStream`);
  assert.match(m.calls[0].json.query, /FROM campaign WHERE segments\.date BETWEEN '2026-10-27' AND '2026-11-03'/);
  assert.equal(m.calls[0].headers['developer-token'], gEnv.GOOGLE_ADS_DEVELOPER_TOKEN);
  assert.deepEqual(r.rows.slice(0, 3), [
    { date: '2026-11-01', channel: 'google', campaign: '111', metric: 'spend', value: 4.56 },
    { date: '2026-11-01', channel: 'google', campaign: '111', metric: 'clicks', value: 12 },
    { date: '2026-11-01', channel: 'google', campaign: '111', metric: 'conversions', value: 2 },
  ]);
  assert.equal(r.rows.length, 6); assert.equal(r.rows[5].value, 0);

  let page = 0;
  m = mock(() => [200, { code: 0, message: 'OK', data: { page_info: { page: ++page, total_page: 2 }, list: [{ dimensions: { campaign_id: `18${page}`, stat_time_day: '2026-11-01 00:00:00' }, metrics: { spend: '7.5', clicks: '30', conversion: '1' } }] } }]);
  r = await tiktokAdsMetrics.read(ctxFor(tkEnv, m.fetch), { days: 3 });
  assert.ok(r.ok, r.detail); assert.equal(m.calls.length, 2, 'follows page_info.total_page');
  assert.ok(m.calls.every((c) => c.method === 'GET' && c.headers['access-token'] === tkEnv.TIKTOK_ACCESS_TOKEN));
  const q = new URL(m.calls[0].url).searchParams;
  assert.equal(q.get('data_level'), 'AUCTION_CAMPAIGN'); assert.deepEqual(JSON.parse(q.get('dimensions')), ['campaign_id', 'stat_time_day']); assert.equal(q.get('start_date'), '2026-10-31');
  assert.deepEqual(r.rows[0], { date: '2026-11-01', channel: 'tiktok', campaign: '181', metric: 'spend', value: 7.5 });
  const tkErr = await tiktokAdsMetrics.read(ctxFor(tkEnv, mock(() => [200, { code: 40001, message: 'no permission' }]).fetch));
  assert.equal(tkErr.ok, false); assert.match(tkErr.detail, /40001/);

  m = mock(() => [200, { elements: [{ pivotValues: ['urn:li:sponsoredCampaign:722'], dateRange: { start: { year: 2026, month: 11, day: 2 }, end: { year: 2026, month: 11, day: 2 } }, costInLocalCurrency: '19.237', clicks: 41, externalWebsiteConversions: 3 }] }]);
  r = await linkedinAdsMetrics.read(ctxFor(liEnv, m.fetch), { days: 7 });
  assert.ok(r.ok, r.detail);
  assert.equal(m.calls[0].method, 'GET'); assert.equal(m.calls[0].headers['linkedin-version'], LINKEDIN_ADS_VERSION);
  assert.match(m.calls[0].url, /^https:\/\/api\.linkedin\.com\/rest\/adAnalytics\?q=analytics&pivot=CAMPAIGN&timeGranularity=DAILY&dateRange=\(start:\(year:2026,month:10,day:27\),end:\(year:2026,month:11,day:3\)\)&accounts=List\(urn%3Ali%3AsponsoredAccount%3A508000\)/);
  assert.deepEqual(r.rows, [
    { date: '2026-11-02', channel: 'linkedin', campaign: '722', metric: 'spend', value: 19.24 },
    { date: '2026-11-02', channel: 'linkedin', campaign: '722', metric: 'clicks', value: 41 },
    { date: '2026-11-02', channel: 'linkedin', campaign: '722', metric: 'conversions', value: 3 },
  ]);

  const dry = await linkedinAdsMetrics.read(ctxFor({}, noFetch));
  assert.equal(dry.dry_run, true); assert.match(dry.detail, /missing LINKEDIN_ACCESS_TOKEN/);

  m = mock(() => [200, { elements: [{ pivotValues: ['urn:li:sponsoredCampaign:9'], dateRange: { start: { year: 2026, month: 11, day: 1 } }, costInLocalCurrency: '2', clicks: 1, externalWebsiteConversions: 0 }] }]);
  const pulled = await pullMetrics(ctxFor(liEnv, m.fetch));
  assert.deepEqual(pulled.map((p) => p.source), ['linkedin-ads-metrics']);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, pulled[0].file), 'utf8'));
  assert.equal(saved[0].campaign, '9', 'campaign id is kept for the kill-switch');
});

// ── Google Ads API version and partial creates ──
const gEnv = { GOOGLE_ADS_DEVELOPER_TOKEN: fake('gadev'), GOOGLE_ADS_CUSTOMER_ID: '123-456-7890', GOOGLE_ACCESS_TOKEN: 'ya29.access' };
write('outbox/google.json', { name: 'Search core', daily_budget: 8, final_url: 'https://demo.example/', keywords: ['invoice app'], negatives: ['free'],
  ads: [{ headlines: ['Invoice app', 'Get paid', 'Fast billing'], descriptions: ['Send invoices in a minute.', 'Built for small teams.'] }] });
const gItem = (extra = {}) => ({ id: 'G7', type: 'spend', channel: 'google', amount: 10, file: 'outbox/google.json', ...extra });
const gRes = (c) => `customers/1234567890/${c.url.split('/').pop().split(':')[0]}/9`;

test('google ads: default API version is one Google still serves, used by create, pause and the metrics reader', async () => {
  assert.doesNotMatch(GOOGLE_ADS_API_VERSION, /^v(1\d|2[0-2])$/, 'v10-v22 are sunset (sunset-dates page, 2026-11-04)');
  assert.match(GOOGLE_ADS_API_VERSION, /^v\d+$/);
  const prefix = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/1234567890/`;
  assert.equal(gEnv.GOOGLE_ADS_API_VERSION, undefined);
  const m = mock((c) => [200, c.url.endsWith(':searchStream') ? [] : { results: [{ resourceName: gRes(c) }] }]);
  const r = await googleAds.execute(gItem(), ctxFor(gEnv, m.fetch));
  assert.ok(r.ok, r.detail);
  const p = await pauseGoogle('customers/1234567890/campaigns/9', gEnv, false, { fetch: m.fetch });
  assert.ok(p.ok, p.detail);
  const rd = await googleAdsMetrics.read(ctxFor(gEnv, m.fetch), { days: 1 });
  assert.ok(rd.ok, rd.detail);
  assert.ok(m.calls.length >= 8);
  for (const c of m.calls) assert.ok(c.url.startsWith(prefix), c.url);
  assert.equal(m.calls.at(-2).url, `${prefix}campaigns:mutate`); assert.equal(m.calls.at(-1).url, `${prefix}googleAds:searchStream`);
  assert.match(googleAds.unverified, new RegExp(`defaults to ${GOOGLE_ADS_API_VERSION}`));
  // GOOGLE_ADS_API_VERSION still overrides the default.
  const o = mock((c) => [200, { results: [{ resourceName: gRes(c) }] }]);
  assert.ok((await pauseGoogle('9', { ...gEnv, GOOGLE_ADS_API_VERSION: 'v99' }, false, { fetch: o.fetch })).ok);
  assert.match(o.calls[0].url, /\/v99\/customers\/1234567890\/campaigns:mutate$/);
});

test('google ads: a failure after the first create is partial, names what exists and carries the item id in the campaign name', async () => {
  const m = mock((c) => (c.url.endsWith('/adGroupAds:mutate') ? [400, { error: { message: 'POLICY_FINDING' } }] : [200, { results: [{ resourceName: gRes(c) }] }]));
  const r = await googleAds.execute(gItem(), ctxFor(gEnv, m.fetch));
  assert.equal(r.ok, false); assert.equal(r.partial, true);
  assert.match(r.ref, /customers\/1234567890\/campaigns\/9/);
  assert.match(r.detail, /HTTP 400/); assert.match(r.detail, /already created \(paused\): customers\/1234567890\/campaignBudgets\/9, customers\/1234567890\/campaigns\/9, customers\/1234567890\/adGroups\/9/);
  assert.equal(m.calls.find((c) => c.url.endsWith('/campaigns:mutate')).json.operations[0].create.name, 'Search core · G7');
  noSecrets(r, gEnv);
  // A failure on the very first create is an ordinary (retryable) failure: nothing exists yet.
  const first = await googleAds.execute(gItem(), ctxFor(gEnv, mock(() => [500, { error: { message: 'backend' } }]).fetch));
  assert.equal(first.ok, false); assert.equal(first.partial, undefined);
});

test('tiktok ads: an ad group failure after the campaign exists is partial with the campaign id as ref', async () => {
  const m = mock((c) => (c.url.includes('/adgroup/create/') ? [200, { code: 40002, message: 'budget too low' }] : tkRouter(c)));
  const r = await tiktokAds.execute(tkItem(), ctxFor(tkEnv, m.fetch));
  assert.equal(r.ok, false); assert.equal(r.partial, true); assert.equal(r.ref, '1800000001');
  assert.match(r.detail, /40002/); assert.match(r.detail, /already created \(disable\): 1800000001$/);
  assert.equal(m.calls.length, 2, 'stops at the failure');
});

test('executor: a partial create is marked failed with result_ref at once and is not retried', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const slug = `zz-adspartial-${process.pid}`;
  const pdir = path.join(root, 'products', slug);
  const log = path.join(dir, 'fetch-log.jsonl');
  // Preloaded into the executor: answers Google Ads calls (HTTP 400 on adGroupAds) and refuses any other host.
  const preload = path.join(dir, 'mock-fetch.mjs');
  fs.writeFileSync(preload, `import fs from 'node:fs';
globalThis.fetch = async (url, init = {}) => {
  url = String(url); fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ url }) + '\\n');
  if (!url.startsWith('https://googleads.googleapis.com/')) throw new Error('unexpected host ' + url);
  const res = url.split('/').pop().split(':')[0];
  if (res === 'adGroupAds') return new Response(JSON.stringify({ error: { message: 'POLICY_FINDING' } }), { status: 400, headers: { 'content-type': 'application/json' } });
  return new Response(JSON.stringify({ results: [{ resourceName: 'customers/1234567890/' + res + '/5' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
};
`);
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(META_|RESEND_|OM_WEBHOOK_|OM_SITE_REPO|STRIPE_|OM_KILL|GOOGLE_|MSADS_|MASTODON_|TIKTOK_|LINKEDIN_|REDDIT_|X_|APPLE_|OM_ADS_CSV|OM_SCHEDULER)/.test(k))),
    ...gEnv, OM_SCHEDULER_FILE: path.join(dir, 'scheduler.json'), OM_EXECUTE_LOCK_WAIT_MS: '0', OM_KNOWLEDGE_OFFLINE: '1',
  };
  const run = (script, args, nodeArgs = []) => {
    const r = spawnSync(process.execPath, [...nodeArgs, path.join(root, 'tools', script), ...args], { encoding: 'utf8', env, cwd: root });
    assert.equal(r.status, 0, `${script}: ${r.stderr || r.stdout}`);
    return r;
  };
  try {
    run('new-product.mjs', [slug, '--name', 'Partial Test', '--budget', '1000', '--domain', 'partial.example']);
    const pj = JSON.parse(fs.readFileSync(path.join(pdir, 'product.json'), 'utf8'));
    pj.budget = { ...pj.budget, mode: 'paid', monthly_cap: 1000, daily_cap: 30 };
    fs.writeFileSync(path.join(pdir, 'product.json'), JSON.stringify(pj, null, 2));
    fs.mkdirSync(path.join(pdir, 'outbox'), { recursive: true });
    fs.copyFileSync(path.join(dir, 'outbox', 'google.json'), path.join(pdir, 'outbox', 'google.json'));
    fs.writeFileSync(path.join(pdir, 'approvals.json'), JSON.stringify([{ id: 'GP1', type: 'spend', channel: 'google', title: 'Search core', amount: 10, file: 'outbox/google.json', compliance: 'pass', status: 'approved' }]));
    const exec = () => run('execute.mjs', [slug, '--now', '2026-11-04T12:00:00.000Z'], ['--import', pathToFileURL(preload).href]);
    const mutates = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter((l) => l.includes('/campaigns:mutate')).length : 0);
    exec();
    const a = JSON.parse(fs.readFileSync(path.join(pdir, 'approvals.json'), 'utf8')).find((x) => x.id === 'GP1');
    assert.equal(a.status, 'failed');
    assert.equal(a.result_ref, 'customers/1234567890/campaigns/5');
    assert.match(a.last_error, /already created/);
    assert.equal(mutates(), 1);
    exec();
    assert.equal(mutates(), 1, 'second run makes no further campaigns:mutate call');
    assert.equal(JSON.parse(fs.readFileSync(path.join(pdir, 'approvals.json'), 'utf8')).find((x) => x.id === 'GP1').status, 'failed');
  } finally { fs.rmSync(pdir, { recursive: true, force: true }); }
});
