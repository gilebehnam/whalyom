// Read-only metrics readers for Microsoft Ads, Reddit Ads, X Ads and Apple Search Ads. Every one runs
// against a mocked fetch (no real network): parsed rows, the missing-key path (no network at all), and
// the HTTP methods used (GET, plus POST only where the platform creates reports or exchanges a token).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { microsoftAdsMetrics, redditAdsMetrics, xAdsMetrics, appleSearchAdsMetrics, unzipFirst, parseCsv, metricReaders, stripe, pullMetrics, STRIPE_REVENUE_TYPES } from '../connectors/readers.mjs';
import { AD_READERS, pullAdRows } from '../metrics.mjs';

const fake = (name) => `test-${name}-${'x'.repeat(6)}`;
const now = '2026-11-04T12:00:00.000Z';

function mock(router) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method ?? 'GET', headers: Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])), body: init.body };
    try { call.json = typeof init.body === 'string' ? JSON.parse(init.body) : null; } catch { call.json = null; }
    calls.push(call);
    const [status, body, headers] = router(call, calls.length) ?? [200, {}];
    const payload = Buffer.isBuffer(body) ? body : (typeof body === 'string' ? body : JSON.stringify(body));
    return new Response(payload, { status, headers: headers ?? { 'content-type': 'application/json' } });
  };
  return { calls, fetch };
}
const noNetwork = async () => { throw new Error('no network expected'); };

// Minimal ZIP writer (one deflated entry) for the Microsoft report download.
function zipOf(name, text) {
  const data = zlib.deflateRawSync(Buffer.from(text)); const n = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(0, 18); local.writeUInt32LE(0, 22); local.writeUInt16LE(n.length, 26); // sizes 0: data-descriptor style
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(text.length, 24); cd.writeUInt16LE(n.length, 28); cd.writeUInt32LE(0, 42);
  const cdOff = 30 + n.length + data.length;
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(46 + n.length, 12); eocd.writeUInt32LE(cdOff, 16);
  return Buffer.concat([local, n, data, cd, n, eocd]);
}

test('the four readers are registered for the kill switch and for metrics_pull', () => {
  for (const r of [microsoftAdsMetrics, redditAdsMetrics, xAdsMetrics, appleSearchAdsMetrics]) {
    assert.ok(AD_READERS.includes(r), `${r.name} missing from AD_READERS`);
    assert.ok(metricReaders.includes(r), `${r.name} missing from metricReaders`);
    assert.equal(r.kind, 'metrics');
  }
});

test('missing keys: every reader is off and makes no request', async () => {
  for (const r of [microsoftAdsMetrics, redditAdsMetrics, xAdsMetrics, appleSearchAdsMetrics]) {
    assert.equal(r.configured({}), false);
    const res = await r.read({ env: {}, fetch: noNetwork, now }, { days: 3 });
    assert.equal(res.ok, false); assert.equal(res.dry_run, true); assert.deepEqual(res.rows, []);
    assert.match(res.detail, /missing /);
  }
  assert.deepEqual((await pullAdRows({ env: {}, fetch: noNetwork, now })).results, []);
});

test('helpers: unzip and CSV parsing', () => {
  assert.equal(unzipFirst(zipOf('r.csv', 'a,b\n1,2\n')).toString(), 'a,b\n1,2\n');
  assert.deepEqual(parseCsv('﻿"A","B, c"\r\n"1","say ""hi"""\r\n'), [['A', 'B, c'], ['1', 'say "hi"']]);
});

const msEnv = { MSADS_DEVELOPER_TOKEN: fake('msdev'), MSADS_ACCESS_TOKEN: fake('msat'), MSADS_CUSTOMER_ID: '111', MSADS_ACCOUNT_ID: '222' };

test('microsoft-ads-metrics: submit, poll until Success, download zipped CSV, parse rows', async () => {
  const csv = '"TimePeriod","CampaignId","Spend","Clicks","Conversions"\r\n"2026-11-02","9001","12.34","40","2"\r\n"11/3/2026","9001","1,005.50","7","0"\r\n"©2026 Microsoft Corporation. All rights reserved. "\r\n';
  let polls = 0;
  const m = mock((c) => {
    if (c.url.endsWith('/GenerateReport/Submit')) return [200, { ReportRequestId: 'rr-1' }];
    if (c.url.endsWith('/GenerateReport/Poll')) { polls++; return [200, { ReportRequestStatus: polls < 2 ? { Status: 'Pending', ReportDownloadUrl: null } : { Status: 'Success', ReportDownloadUrl: 'https://download.example/report.zip' } }]; }
    if (c.url === 'https://download.example/report.zip') return [200, zipOf('report.csv', csv), { 'content-type': 'application/zip' }];
    return [404, {}];
  });
  const res = await microsoftAdsMetrics.read({ env: msEnv, fetch: m.fetch, now, sleep: async () => {} }, { days: 3 });
  assert.equal(res.ok, true, res.detail);
  assert.deepEqual(res.rows.filter((r) => r.metric === 'spend').map((r) => [r.date, r.campaign, r.value]), [['2026-11-02', '9001', 12.34], ['2026-11-03', '9001', 1005.5]]);
  assert.deepEqual(res.rows.find((r) => r.metric === 'conversions'), { date: '2026-11-02', channel: 'microsoft', campaign: '9001', metric: 'conversions', value: 2 });
  const sub = m.calls[0];
  assert.equal(sub.method, 'POST');
  assert.equal(sub.headers.authorization, `Bearer ${msEnv.MSADS_ACCESS_TOKEN}`);
  assert.equal(sub.headers.developertoken, msEnv.MSADS_DEVELOPER_TOKEN);
  assert.equal(sub.headers.customeraccountid, '222');
  assert.equal(sub.json.ReportRequest.Type, 'CampaignPerformanceReportRequest');
  assert.equal(sub.json.ReportRequest.Aggregation, 'Daily');
  assert.deepEqual(sub.json.ReportRequest.Scope.AccountIds, [222]);
  assert.deepEqual(sub.json.ReportRequest.Time.CustomDateRangeEnd, { Day: 4, Month: 11, Year: 2026 });
  // Only report-creation/poll POSTs and the download GET; nothing else.
  for (const c of m.calls) {
    if (c.method === 'POST') assert.match(c.url, /\/GenerateReport\/(Submit|Poll)$/);
    else assert.equal(c.method, 'GET');
  }
  assert.equal(polls, 2);
});

test('microsoft-ads-metrics: empty report and failed report', async () => {
  const empty = mock((c) => (c.url.endsWith('/Submit') ? [200, { ReportRequestId: 'r' }] : [200, { ReportRequestStatus: { Status: 'Success', ReportDownloadUrl: null } }]));
  const r1 = await microsoftAdsMetrics.read({ env: msEnv, fetch: empty.fetch, now }, {});
  assert.equal(r1.ok, true); assert.deepEqual(r1.rows, []); assert.equal(empty.calls.length, 2);
  const bad = mock((c) => (c.url.endsWith('/Submit') ? [200, { ReportRequestId: 'r' }] : [200, { ReportRequestStatus: { Status: 'Error' } }]));
  const r2 = await microsoftAdsMetrics.read({ env: msEnv, fetch: bad.fetch, now }, {});
  assert.equal(r2.ok, false); assert.match(r2.detail, /status Error/);
  const denied = mock(() => [401, { message: `bad token ${msEnv.MSADS_ACCESS_TOKEN}` }]);
  const r3 = await microsoftAdsMetrics.read({ env: msEnv, fetch: denied.fetch, now }, {});
  assert.equal(r3.ok, false); assert.ok(!r3.detail.includes(msEnv.MSADS_ACCESS_TOKEN), 'token redacted');
});

test('reddit-ads-metrics: one report POST per page, microcurrency spend, campaign + date rows', async () => {
  const env = { REDDIT_ADS_ACCESS_TOKEN: fake('rdt'), REDDIT_ADS_ACCOUNT_ID: 't2_acct' };
  const m = mock((c, n) => (n === 1
    ? [200, { data: { metrics: [{ campaign_id: 'c1', date: '2026-11-02', spend: 4_500_000, clicks: 12, key_conversion_total_count: 1 }] }, pagination: { next_url: 'https://ads-api.reddit.com/api/v3/ad_accounts/t2_acct/reports?page.token=abc' } }]
    : [200, { data: { metrics: [{ campaign_id: 'c2', date: '2026-11-03', spend: 0, clicks: 0, key_conversion_total_count: 0 }] }, pagination: { next_url: 'https://evil.example/steal' } }]));
  const res = await redditAdsMetrics.read({ env, fetch: m.fetch, now }, { days: 2 });
  assert.equal(res.ok, true, res.detail);
  assert.deepEqual(res.rows.slice(0, 3).map((r) => [r.channel, r.campaign, r.metric, r.value]), [['reddit', 'c1', 'spend', 4.5], ['reddit', 'c1', 'clicks', 12], ['reddit', 'c1', 'conversions', 1]]);
  assert.equal(m.calls.length, 2, 'a next_url on another host is not followed');
  for (const c of m.calls) { assert.equal(c.method, 'POST'); assert.match(c.url, /^https:\/\/ads-api\.reddit\.com\/api\/v3\/ad_accounts\/t2_acct\/reports/); }
  const body = m.calls[0].json.data;
  assert.deepEqual(body.breakdowns, ['CAMPAIGN_ID', 'DATE']);
  assert.equal(body.starts_at, '2026-11-02T00:00:00Z'); assert.equal(body.ends_at, '2026-11-05T00:00:00Z');
  assert.equal(m.calls[0].headers.authorization, `Bearer ${env.REDDIT_ADS_ACCESS_TOKEN}`);
  assert.ok(m.calls[0].headers['user-agent']);
});

test('x-ads-metrics: signed GETs only, campaigns then daily stats in 7-day windows', async () => {
  const env = { X_ADS_CONSUMER_KEY: fake('ck'), X_ADS_CONSUMER_SECRET: fake('cs'), X_ADS_ACCESS_TOKEN: fake('at'), X_ADS_ACCESS_SECRET: fake('as'), X_ADS_ACCOUNT_ID: '18ce54d4x5t' };
  const m = mock((c) => {
    if (c.url.includes('/campaigns')) return [200, { data: [{ id: 'cA' }, { id: 'cB' }], next_cursor: null }];
    if (c.url.includes('/stats/accounts/')) {
      const u = new URL(c.url); const start = u.searchParams.get('start_time'); const end = u.searchParams.get('end_time');
      const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000);
      const arr = (v) => Array.from({ length: days }, (_, i) => (i === 0 ? v : null));
      return [200, { request: { params: { start_time: start, end_time: end } }, data: [
        { id: 'cA', id_data: [{ segment: null, metrics: { billed_charge_local_micro: arr(2_500_000), url_clicks: arr(9), conversion_purchases: { post_engagement: arr(1), post_view: arr(0) } } }] },
        { id: 'cB', id_data: [{ segment: null, metrics: { billed_charge_local_micro: null, url_clicks: null } }] },
      ] }];
    }
    return [404, {}];
  });
  const res = await xAdsMetrics.read({ env, fetch: m.fetch, now }, { days: 10 });
  assert.equal(res.ok, true, res.detail);
  const stats = m.calls.filter((c) => c.url.includes('/stats/'));
  assert.equal(stats.length, 2, '10 days → two windows of at most 7 days');
  for (const c of stats) {
    const u = new URL(c.url);
    assert.ok((Date.parse(u.searchParams.get('end_time')) - Date.parse(u.searchParams.get('start_time'))) <= 7 * 86400000);
    assert.equal(u.searchParams.get('entity'), 'CAMPAIGN'); assert.equal(u.searchParams.get('granularity'), 'DAY'); assert.equal(u.searchParams.get('entity_ids'), 'cA,cB');
  }
  assert.ok(m.calls.every((c) => c.method === 'GET'), 'X reader never sends anything but GET');
  assert.ok(m.calls.every((c) => /^OAuth .*oauth_signature=/.test(c.headers.authorization)));
  assert.deepEqual(res.rows.filter((r) => r.metric === 'spend').map((r) => [r.date, r.campaign, r.value]), [['2026-10-26', 'cA', 2.5], ['2026-11-02', 'cA', 2.5]]);
  assert.equal(res.rows.find((r) => r.metric === 'conversions').value, 1);
  assert.equal(res.rows[0].channel, 'x_ads');
});

test('apple-search-ads-metrics: token exchange, report POST, rows per campaign and day', async () => {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const env = { APPLE_ADS_CLIENT_ID: 'SEARCHADS.test', APPLE_ADS_TEAM_ID: 'SEARCHADS.test', APPLE_ADS_KEY_ID: 'kid-1', APPLE_ADS_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }), APPLE_ADS_ORG_ID: '4242' };
  const token = fake('appletoken');
  const m = mock((c) => {
    if (c.url === 'https://appleid.apple.com/auth/oauth2/token') return [200, { access_token: token, token_type: 'Bearer', expires_in: 3600 }];
    if (c.url.endsWith('/reports/campaigns')) return [200, { data: { reportingDataResponse: { row: [{ metadata: { campaignId: 777, campaignName: 'Brand' }, granularity: [
      { date: '2026-11-03', localSpend: { amount: '3.20', currency: 'USD' }, taps: 8, totalInstalls: 2 },
      { date: '2026-11-04', localSpend: { amount: '0', currency: 'USD' }, taps: 0, totalInstalls: 0 },
    ] }] } }, pagination: { totalResults: 1, startIndex: 0, itemsPerPage: 1 } }];
    return [404, {}];
  });
  const res = await appleSearchAdsMetrics.read({ env, fetch: m.fetch, now }, { days: 2 });
  assert.equal(res.ok, true, res.detail);
  assert.deepEqual(res.rows.slice(0, 3), [
    { date: '2026-11-03', channel: 'apple', campaign: '777', metric: 'spend', value: 3.2 },
    { date: '2026-11-03', channel: 'apple', campaign: '777', metric: 'clicks', value: 8 },
    { date: '2026-11-03', channel: 'apple', campaign: '777', metric: 'conversions', value: 2 },
  ]);
  assert.equal(m.calls.length, 2);
  const rep = m.calls[1];
  assert.equal(rep.method, 'POST'); assert.equal(rep.url, 'https://api.searchads.apple.com/api/v5/reports/campaigns');
  assert.equal(rep.headers.authorization, `Bearer ${token}`); assert.equal(rep.headers['x-ap-context'], 'orgId=4242');
  assert.equal(rep.json.granularity, 'DAILY'); assert.equal(rep.json.startTime, '2026-11-02'); assert.equal(rep.json.endTime, '2026-11-04');
  for (const c of m.calls) assert.ok(c.url.endsWith('/oauth2/token') || c.url.endsWith('/reports/campaigns'), `unexpected request ${c.method} ${c.url}`);
  // A failed report never echoes the access token.
  const bad = mock((c) => (c.url.includes('oauth2') ? [200, { access_token: token }] : [500, { error: `boom ${token}` }]));
  const r2 = await appleSearchAdsMetrics.read({ env, fetch: bad.fetch, now }, {});
  assert.equal(r2.ok, false); assert.ok(!r2.detail.includes(token));
});

test('pullAdRows runs a configured new reader and tags its source', async () => {
  const env = { REDDIT_ADS_ACCESS_TOKEN: fake('rdt'), REDDIT_ADS_ACCOUNT_ID: 'acct' };
  const m = mock(() => [200, { data: { metrics: [{ campaign_id: 'c9', date: '2026-11-04', spend: 1_000_000, clicks: 1, key_conversion_total_count: 0 }] } }]);
  const { rows, results } = await pullAdRows({ env, fetch: m.fetch, now });
  assert.deepEqual(results.map((r) => [r.source, r.ok]), [['reddit-ads-metrics', true]]);
  assert.deepEqual(rows[0], { date: '2026-11-04', channel: 'reddit', campaign: 'c9', metric: 'spend', value: 1, source: 'reddit-ads-metrics' });
});

// Stripe reader: net revenue (charges and payments minus refunds) per day and currency, metric names that
// match tools/metrics.mjs (base currency 'revenue', others 'revenue_<cur>'), currency kept in the inbox file.
test('stripe: net of refunds, one row per currency, currency kept by pullMetrics', async () => {
  const day = Math.floor(Date.parse('2026-11-03T09:00:00Z') / 1000);
  const tx = {
    charge: [{ id: 'txn_c1', type: 'charge', amount: 10000, currency: 'usd', created: day }, { id: 'txn_c2', type: 'charge', amount: 5000, currency: 'eur', created: day + 60 }],
    payment: [], payment_refund: [],
    refund: [{ id: 'txn_r1', type: 'refund', amount: -3000, currency: 'usd', created: day + 120 }],
  };
  const m = mock((c) => [200, { data: tx[new URL(c.url).searchParams.get('type')] ?? [], has_more: false }]);
  const env = { STRIPE_API_KEY: `rk_test_${'x'.repeat(8)}` };
  const res = await stripe.read({ env, fetch: m.fetch, now }, { days: 3 });
  assert.equal(res.ok, true, res.detail);
  assert.ok(m.calls.every((c) => c.method === 'GET'), 'read-only');
  assert.deepEqual(m.calls.map((c) => new URL(c.url).searchParams.get('type')), STRIPE_REVENUE_TYPES);
  assert.deepEqual(res.rows.map((r) => [r.date, r.metric, r.value, r.currency]).sort(), [['2026-11-03', 'revenue', 70, 'usd'], ['2026-11-03', 'revenue_eur', 50, 'eur']]);

  // Base currency from product.json: eur becomes the plain metric, usd gets the suffix; both rows keep currency.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-stripe-'));
  try {
    fs.writeFileSync(path.join(dir, 'product.json'), JSON.stringify({ budget: { currency: 'EUR' } }));
    const out = await pullMetrics({ dir, env, fetch: m.fetch, now, dryRun: false }, { names: ['stripe'], days: 3 });
    assert.equal(out[0].ok, true, out[0].detail);
    const rows = JSON.parse(fs.readFileSync(path.join(dir, out[0].file), 'utf8'));
    assert.deepEqual(rows.map((r) => [r.metric, r.value, r.currency]).sort(), [['revenue', 50, 'eur'], ['revenue_usd', 70, 'usd']]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  // Zero-decimal currencies are not divided by 100; a transaction seen twice counts once.
  const jp = [{ id: 'j1', type: 'charge', amount: 1200, currency: 'jpy', created: day }, { id: 'j1', type: 'charge', amount: 1200, currency: 'jpy', created: day }];
  const m2 = mock((c) => [200, { data: new URL(c.url).searchParams.get('type') === 'charge' ? jp : [], has_more: false }]);
  const r2 = await stripe.read({ env, fetch: m2.fetch, now, baseCurrency: 'jpy' }, { days: 3 });
  assert.deepEqual(r2.rows.map((r) => [r.metric, r.value]), [['revenue', 1200]]);
});
