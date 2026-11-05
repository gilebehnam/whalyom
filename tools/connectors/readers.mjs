// Read-only data sources. They never write anything remote and are not approval executors.
// Metrics readers return rows {date, channel, metric, value} in the shape tools/metrics.mjs imports
// from metrics/inbox/*.json; link readers return booking links {name, url, minutes}.
//   stripe     net revenue per day and currency (balance transactions of type charge, payment, refund
//              and payment_refund), needs a RESTRICTED read-only key. Metric names follow tools/metrics.mjs:
//              'revenue' for the product's budget.currency, 'revenue_<cur>' for any other currency.
//   plausible  visitors / pageviews per day (Stats API v2)
//   umami      pageviews / sessions per day (Umami Cloud API key or self-hosted token)
//   ga4        sessions and key events per day and default channel group (GA4 Data API)
//   google-ads-metrics    spend / clicks / conversions per campaign and day (GAQL searchStream)
//   tiktok-ads-metrics    spend / clicks / conversions per campaign and day (report/integrated/get)
//   linkedin-ads-metrics  spend / clicks / conversions per campaign and day (adAnalytics)
//   microsoft-ads-metrics spend / clicks / conversions per campaign and day (Reporting v13 REST:
//                         submit, poll, download the zipped CSV; report creation is a POST)
//   reddit-ads-metrics    spend / clicks / conversions per campaign and day (Ads API v3 reports, POST)
//   x-ads-metrics         spend / clicks / conversions per campaign and day (Ads API stats, GET only)
//   apple-search-ads-metrics spend / taps / installs per campaign and day (Campaign Management v5
//                         reports/campaigns, POST; the OAuth token exchange is a POST too)
//   Ad-platform rows carry a campaign id (row.campaign) for the CPA kill-switch and attribution.
//   calcom    event types → booking links (Cal.com API v2)
//   calendly   event types → scheduling links (Calendly API v2)
// Note: tools/metrics.mjs already pulls Stripe revenue when STRIPE_API_KEY is set; pullMetrics()
// skips the stripe reader unless it is named explicitly, so revenue is never counted twice.
import fs from 'node:fs';
import path from 'node:path';
import { defineReader, request, fail, isoDay, daysAgo } from './_http.mjs';
import { googleMissing, googleToken, GOOGLE_ADS_API_VERSION } from './google-auth.mjs';
import { API as TIKTOK_API } from './tiktok-ads.mjs';
import { API as LINKEDIN_API, LINKEDIN_ADS_VERSION } from './linkedin-ads.mjs';
import zlib from 'node:zlib';
import { API as REDDIT_API } from './reddit-ads.mjs';
import { API as X_API, oauth1Sign } from './x-ads.mjs';
import { API as APPLE_API, TOKEN_URL as APPLE_TOKEN_URL, clientSecret as appleClientSecret } from './apple-search-ads.mjs';

const range = (ctx, opts) => { const days = Math.min(Math.max(Number(opts.days ?? 7), 1), 90); return { days, from: daysAgo(ctx.now, days), to: new Date(ctx.now ?? Date.now()) }; };

// Balance-transaction types that make up net revenue (refunds carry negative amounts), and the
// currencies Stripe counts in whole units. Kept in step with tools/metrics.mjs.
export const STRIPE_REVENUE_TYPES = ['charge', 'payment', 'refund', 'payment_refund'];
const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);
const baseCurrencyOf = (ctx, opts) => {
  let cur = opts?.baseCurrency ?? ctx.baseCurrency;
  if (!cur && ctx.dir) { try { cur = JSON.parse(fs.readFileSync(path.join(ctx.dir, 'product.json'), 'utf8'))?.budget?.currency; } catch { /* no product.json */ } }
  return String(cur || 'usd').toLowerCase();
};

export const stripe = defineReader({
  name: 'stripe', kind: 'metrics', handles: 'daily revenue from Stripe balance transactions (read-only)',
  needs: ['STRIPE_API_KEY'],
  preview: (o) => `GET Stripe balance transactions for the last ${o.days ?? 7} day(s)`,
  async read(ctx, opts) {
    const { from } = range(ctx, opts);
    const warn = /^sk_/.test(ctx.env.STRIPE_API_KEY) ? 'STRIPE_API_KEY is a secret key; use a restricted read-only key (rk_...)' : null;
    const base = baseCurrencyOf(ctx, opts);
    const byDay = new Map(); const seen = new Set();
    // The API filters on one type per query, so each revenue type is listed on its own; ids are
    // de-duplicated in case a transaction comes back twice.
    for (const type of STRIPE_REVENUE_TYPES) {
      let after = null;
      for (let page = 0; page < 10; page++) {
        const q = new URLSearchParams({ limit: '100', type, 'created[gte]': String(Math.floor(from.getTime() / 1000)) });
        if (after) q.set('starting_after', after);
        const r = await request(ctx, { url: `https://api.stripe.com/v1/balance_transactions?${q}`, method: 'GET', headers: { authorization: `Bearer ${ctx.env.STRIPE_API_KEY}` } });
        if (!r.ok) throw new Error(fail(r, ctx, 'Stripe'));
        for (const t of r.data?.data ?? []) {
          if (t?.id != null) { if (seen.has(t.id)) continue; seen.add(t.id); }
          if (!STRIPE_REVENUE_TYPES.includes(t.type ?? type)) continue;
          const cur = String(t.currency || base).toLowerCase();
          const amount = Number(t.amount ?? 0);
          const k = `${isoDay(t.created * 1000)}|${cur}`;
          byDay.set(k, (byDay.get(k) ?? 0) + (ZERO_DECIMAL.has(cur) ? amount : amount / 100));
        }
        if (!r.data?.has_more || !r.data.data?.length) break;
        after = r.data.data.at(-1).id;
      }
    }
    const rows = [...byDay].map(([k, v]) => { const [date, currency] = k.split('|'); return { date, channel: 'all', metric: currency === base ? 'revenue' : `revenue_${currency}`, value: Math.round(v * 100) / 100, currency }; });
    return { rows, detail: `${rows.length} day(s) of net revenue${warn ? `; ${warn}` : ''}` };
  },
});

export const plausible = defineReader({
  name: 'plausible', kind: 'metrics', handles: 'daily visitors and pageviews from Plausible (Stats API v2)',
  needs: ['PLAUSIBLE_API_KEY', 'PLAUSIBLE_SITE_ID'],
  preview: (o, env) => `query Plausible ${env.PLAUSIBLE_URL || 'https://plausible.io'} for ${env.PLAUSIBLE_SITE_ID || '(PLAUSIBLE_SITE_ID)'}, last ${o.days ?? 7} day(s)`,
  async read(ctx, opts) {
    const { from, to } = range(ctx, opts);
    const r = await request(ctx, { url: `${(ctx.env.PLAUSIBLE_URL || 'https://plausible.io').replace(/\/$/, '')}/api/v2/query`, headers: { authorization: `Bearer ${ctx.env.PLAUSIBLE_API_KEY}` },
      json: { site_id: ctx.env.PLAUSIBLE_SITE_ID, metrics: ['visitors', 'pageviews'], date_range: [isoDay(from), isoDay(to)], dimensions: ['time:day'] } });
    if (!r.ok) throw new Error(fail(r, ctx, 'Plausible'));
    const rows = [];
    for (const x of r.data?.results ?? []) {
      const date = String(x.dimensions?.[0] ?? '').slice(0, 10);
      rows.push({ date, channel: 'site', metric: 'visitors', value: Number(x.metrics?.[0] ?? 0) }, { date, channel: 'site', metric: 'pageviews', value: Number(x.metrics?.[1] ?? 0) });
    }
    return { rows, detail: `${rows.length} row(s) from Plausible` };
  },
});

export const umami = defineReader({
  name: 'umami', kind: 'metrics', handles: 'daily pageviews and sessions from Umami (Cloud or self-hosted)',
  needs: ['UMAMI_WEBSITE_ID', 'UMAMI_API_KEY (Cloud) or UMAMI_URL + UMAMI_TOKEN (self-hosted)'],
  required: (env) => [...(env.UMAMI_WEBSITE_ID ? [] : ['UMAMI_WEBSITE_ID']), ...(env.UMAMI_API_KEY || (env.UMAMI_URL && env.UMAMI_TOKEN) ? [] : ['UMAMI_API_KEY or UMAMI_URL + UMAMI_TOKEN'])],
  unverified: 'Response shape differs between Umami versions; both {x,y} series and plain numbers are handled.',
  preview: (o, env) => `GET Umami pageviews for website ${env.UMAMI_WEBSITE_ID || '(UMAMI_WEBSITE_ID)'}, last ${o.days ?? 7} day(s)`,
  async read(ctx, opts) {
    const { from, to } = range(ctx, opts);
    const cloud = Boolean(ctx.env.UMAMI_API_KEY);
    const base = cloud ? (ctx.env.UMAMI_URL || 'https://api.umami.is/v1').replace(/\/$/, '') : `${ctx.env.UMAMI_URL.replace(/\/$/, '')}/api`;
    const headers = cloud ? { 'x-umami-api-key': ctx.env.UMAMI_API_KEY } : { authorization: `Bearer ${ctx.env.UMAMI_TOKEN}` };
    const q = new URLSearchParams({ startAt: String(from.getTime()), endAt: String(to.getTime()), unit: 'day', timezone: 'UTC' });
    const r = await request(ctx, { url: `${base}/websites/${encodeURIComponent(ctx.env.UMAMI_WEBSITE_ID)}/pageviews?${q}`, method: 'GET', headers });
    if (!r.ok) throw new Error(fail(r, ctx, 'Umami'));
    const rows = [];
    for (const [series, metric] of [['pageviews', 'pageviews'], ['sessions', 'visitors']]) {
      for (const p of r.data?.[series] ?? []) rows.push({ date: String(p.x ?? p.t ?? '').slice(0, 10), channel: 'site', metric, value: Number(p.y ?? 0) });
    }
    return { rows, detail: `${rows.length} row(s) from Umami` };
  },
});

export const ga4 = defineReader({
  name: 'ga4', kind: 'metrics', handles: 'daily sessions and key events per default channel group (GA4 Data API runReport)',
  needs: ['GA4_PROPERTY_ID', 'GOOGLE_ACCESS_TOKEN or GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN'],
  required: (env) => [...(env.GA4_PROPERTY_ID ? [] : ['GA4_PROPERTY_ID']), ...googleMissing(env)],
  preview: (o, env) => `run a GA4 report for property ${env.GA4_PROPERTY_ID || '(GA4_PROPERTY_ID)'}, last ${o.days ?? 7} day(s)`,
  async read(ctx, opts) {
    const { days } = range(ctx, opts);
    const r = await request(ctx, { url: `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(ctx.env.GA4_PROPERTY_ID)}:runReport`, headers: { authorization: `Bearer ${await googleToken(ctx)}` },
      json: { dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }], dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }, { name: 'keyEvents' }], limit: 10000 } });
    if (!r.ok) throw new Error(fail(r, ctx, 'GA4'));
    const rows = [];
    for (const row of r.data?.rows ?? []) {
      const d = row.dimensionValues?.[0]?.value ?? '';
      const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
      const channel = String(row.dimensionValues?.[1]?.value ?? 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '_');
      rows.push({ date, channel, metric: 'sessions', value: Number(row.metricValues?.[0]?.value ?? 0) }, { date, channel, metric: 'conversions', value: Number(row.metricValues?.[1]?.value ?? 0) });
    }
    return { rows, detail: `${rows.length} row(s) from GA4 (key events reported as "conversions")` };
  },
});

// Rows for one campaign-day from an ad platform: spend, clicks, conversions.
const adRows = (date, channel, campaign, spend, clicks, conversions) => [
  { date, channel, campaign, metric: 'spend', value: Math.round(Number(spend ?? 0) * 100) / 100 },
  { date, channel, campaign, metric: 'clicks', value: Number(clicks ?? 0) },
  { date, channel, campaign, metric: 'conversions', value: Number(conversions ?? 0) },
];

export const googleAdsMetrics = defineReader({
  name: 'google-ads-metrics', kind: 'metrics', handles: 'daily cost, clicks and conversions per Google Ads campaign (GAQL searchStream, read-only)',
  needs: ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_ACCESS_TOKEN or GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN'],
  required: (env) => [...['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID'].filter((k) => !env[k]), ...googleMissing(env)],
  unverified: `API version defaults to ${GOOGLE_ADS_API_VERSION} (GOOGLE_ADS_API_VERSION). Cost is in the account currency.`,
  preview: (o, env) => `run a GAQL campaign report for Google Ads customer ${env.GOOGLE_ADS_CUSTOMER_ID || '(GOOGLE_ADS_CUSTOMER_ID)'}, last ${o.days ?? 7} day(s)`,
  async read(ctx, opts) {
    const { from, to } = range(ctx, opts);
    const cid = String(ctx.env.GOOGLE_ADS_CUSTOMER_ID).replace(/\D/g, '');
    const headers = { authorization: `Bearer ${await googleToken(ctx)}`, 'developer-token': ctx.env.GOOGLE_ADS_DEVELOPER_TOKEN };
    if (ctx.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) headers['login-customer-id'] = String(ctx.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID).replace(/\D/g, '');
    const query = `SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${isoDay(from)}' AND '${isoDay(to)}'`;
    const r = await request(ctx, { url: `https://googleads.googleapis.com/${ctx.env.GOOGLE_ADS_API_VERSION || GOOGLE_ADS_API_VERSION}/customers/${cid}/googleAds:searchStream`, headers, json: { query } });
    if (!r.ok) throw new Error(fail(r, ctx, 'Google Ads searchStream'));
    const rows = [];
    // searchStream answers with an array of batches, each {results: [...]}.
    for (const batch of Array.isArray(r.data) ? r.data : [r.data ?? {}]) {
      for (const x of batch.results ?? []) rows.push(...adRows(x.segments?.date, 'google', String(x.campaign?.id ?? ''), Number(x.metrics?.costMicros ?? 0) / 1e6, x.metrics?.clicks, x.metrics?.conversions));
    }
    return { rows, detail: `${rows.length / 3} campaign-day(s) from Google Ads` };
  },
});

export const tiktokAdsMetrics = defineReader({
  name: 'tiktok-ads-metrics', kind: 'metrics', handles: 'daily spend, clicks and conversions per TikTok campaign (report/integrated/get, read-only)',
  needs: ['TIKTOK_ACCESS_TOKEN', 'TIKTOK_ADVERTISER_ID'],
  unverified: 'BASIC report, data_level AUCTION_CAMPAIGN; metric "conversion" counts the optimization event. verify against current API docs.',
  preview: (o, env) => `GET a TikTok campaign report for advertiser ${env.TIKTOK_ADVERTISER_ID || '(TIKTOK_ADVERTISER_ID)'}, last ${o.days ?? 7} day(s)`,
  async read(ctx, opts) {
    const { from, to } = range(ctx, opts);
    const rows = [];
    for (let page = 1; page <= 20; page++) {
      const q = new URLSearchParams({ advertiser_id: String(ctx.env.TIKTOK_ADVERTISER_ID), report_type: 'BASIC', data_level: 'AUCTION_CAMPAIGN',
        dimensions: JSON.stringify(['campaign_id', 'stat_time_day']), metrics: JSON.stringify(['spend', 'clicks', 'conversion']),
        start_date: isoDay(from), end_date: isoDay(to), page: String(page), page_size: '1000' });
      const r = await request(ctx, { url: `${TIKTOK_API}/report/integrated/get/?${q}`, method: 'GET', headers: { 'Access-Token': ctx.env.TIKTOK_ACCESS_TOKEN } });
      if (!r.ok) throw new Error(fail(r, ctx, 'TikTok report'));
      if (r.data?.code !== 0) throw new Error(`TikTok report: code ${r.data?.code ?? '?'} ${String(r.data?.message ?? '').slice(0, 200)}`);
      for (const x of r.data.data?.list ?? []) rows.push(...adRows(String(x.dimensions?.stat_time_day ?? '').slice(0, 10), 'tiktok', String(x.dimensions?.campaign_id ?? ''), x.metrics?.spend, x.metrics?.clicks, x.metrics?.conversion));
      if (page >= Number(r.data.data?.page_info?.total_page ?? 1)) break;
    }
    return { rows, detail: `${rows.length / 3} campaign-day(s) from TikTok` };
  },
});

// Rest.li 2.0 query syntax: parentheses, colons and commas stay literal; URNs inside List() are encoded.
const liDate = (d) => `(year:${d.getUTCFullYear()},month:${d.getUTCMonth() + 1},day:${d.getUTCDate()})`;
export const linkedinAdsMetrics = defineReader({
  name: 'linkedin-ads-metrics', kind: 'metrics', handles: 'daily spend, clicks and conversions per LinkedIn campaign (adAnalytics, read-only)',
  needs: ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_AD_ACCOUNT_ID'],
  unverified: 'adAnalytics finder q=analytics, pivot CAMPAIGN; conversions are externalWebsiteConversions. verify against current API docs.',
  preview: (o, env) => `GET LinkedIn adAnalytics for ad account ${env.LINKEDIN_AD_ACCOUNT_ID || '(LINKEDIN_AD_ACCOUNT_ID)'}, last ${o.days ?? 7} day(s)`,
  async read(ctx, opts) {
    const { from, to } = range(ctx, opts);
    const acct = encodeURIComponent(`urn:li:sponsoredAccount:${String(ctx.env.LINKEDIN_AD_ACCOUNT_ID).replace(/\D/g, '')}`);
    const qs = `q=analytics&pivot=CAMPAIGN&timeGranularity=DAILY&dateRange=(start:${liDate(from)},end:${liDate(to)})&accounts=List(${acct})&fields=dateRange,pivotValues,costInLocalCurrency,clicks,externalWebsiteConversions`;
    const r = await request(ctx, { url: `${LINKEDIN_API}/adAnalytics?${qs}`, method: 'GET', headers: { authorization: `Bearer ${ctx.env.LINKEDIN_ACCESS_TOKEN}`, 'linkedin-version': ctx.env.LINKEDIN_ADS_VERSION || LINKEDIN_ADS_VERSION, 'x-restli-protocol-version': '2.0.0' } });
    if (!r.ok) throw new Error(fail(r, ctx, 'LinkedIn adAnalytics'));
    const rows = [];
    for (const x of r.data?.elements ?? []) {
      const d = x.dateRange?.start ?? {};
      const date = d.year ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : '';
      rows.push(...adRows(date, 'linkedin', String(x.pivotValues?.[0] ?? '').split(':').pop(), x.costInLocalCurrency, x.clicks, x.externalWebsiteConversions));
    }
    return { rows, detail: `${rows.length / 3} campaign-day(s) from LinkedIn` };
  },
});

// ── Helpers for the report-file readers ──
// First entry of a ZIP archive (stored or deflated), read through the central directory so archives
// written with data descriptors (sizes 0 in the local header) work too. Zero dependencies.
export function unzipFirst(buf) {
  const b = Buffer.from(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip archive (no end of central directory)');
  const cd = b.readUInt32LE(eocd + 16);
  if (b.readUInt32LE(cd) !== 0x02014b50) throw new Error('zip central directory not found');
  const method = b.readUInt16LE(cd + 10); const csize = b.readUInt32LE(cd + 20);
  const local = b.readUInt32LE(cd + 42);
  if (b.readUInt32LE(local) !== 0x04034b50) throw new Error('zip local header not found');
  const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
  const data = b.subarray(start, start + csize);
  if (method === 0) return data;
  if (method === 8) return zlib.inflateRawSync(data);
  throw new Error(`zip compression method ${method} not supported`);
}

// RFC 4180 CSV → array of rows (arrays of strings).
export function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x !== ''));
}

const num = (v) => { const n = Number(String(v ?? '').replace(/[,%\s]/g, '')); return Number.isFinite(n) ? n : 0; };
// "2026-11-03", "11/3/2026" → "2026-11-03".
const normDay = (v) => {
  const s = String(v ?? '').trim();
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return us ? `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}` : s.slice(0, 10);
};
const ymd = (d) => ({ Day: d.getUTCDate(), Month: d.getUTCMonth() + 1, Year: d.getUTCFullYear() });
const wait = (ctx, ms) => (ctx.sleep ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));

// ── Microsoft Advertising: Reporting service v13 (REST/JSON) ──
// Docs: https://learn.microsoft.com/en-us/advertising/guides/request-download-report
//       https://learn.microsoft.com/en-us/advertising/reporting-service/submitgeneratereport (REST pivot)
//       https://learn.microsoft.com/en-us/advertising/reporting-service/pollgeneratereport
// Reporting is asynchronous: POST GenerateReport/Submit, POST GenerateReport/Poll until Success,
// then GET the ReportDownloadUrl (a zipped CSV, valid for five minutes). Submit and Poll are POSTs
// by the API's design; neither changes anything in the account.
export const microsoftAdsMetrics = defineReader({
  name: 'microsoft-ads-metrics', kind: 'metrics', handles: 'daily spend, clicks and conversions per Microsoft Ads campaign (Reporting v13 CampaignPerformanceReport, read-only)',
  needs: ['MSADS_DEVELOPER_TOKEN', 'MSADS_ACCESS_TOKEN', 'MSADS_CUSTOMER_ID', 'MSADS_ACCOUNT_ID'],
  unverified: 'CampaignPerformanceReportRequest column names (TimePeriod, CampaignId, Spend, Clicks, Conversions) and the CSV date format follow the v13 reference but were not tested against a live account. MSADS_REPORTING_BASE overrides the endpoint (sandbox: https://reporting.api.sandbox.bingads.microsoft.com/Reporting/v13).',
  preview: (o, env) => `submit a Microsoft Ads campaign performance report for account ${env.MSADS_ACCOUNT_ID || '(MSADS_ACCOUNT_ID)'}, last ${o.days ?? 7} day(s), poll it and download the CSV`,
  async read(ctx, opts) {
    const { from, to } = range(ctx, opts);
    const base = (ctx.env.MSADS_REPORTING_BASE || 'https://reporting.api.bingads.microsoft.com/Reporting/v13').replace(/\/$/, '');
    const headers = { authorization: `Bearer ${ctx.env.MSADS_ACCESS_TOKEN}`, DeveloperToken: ctx.env.MSADS_DEVELOPER_TOKEN, CustomerId: String(ctx.env.MSADS_CUSTOMER_ID), CustomerAccountId: String(ctx.env.MSADS_ACCOUNT_ID) };
    const sub = await request(ctx, { url: `${base}/GenerateReport/Submit`, headers, json: { ReportRequest: {
      Type: 'CampaignPerformanceReportRequest', ReportName: 'whalyom campaign metrics', Format: 'Csv', FormatVersion: '2.0',
      ExcludeReportHeader: true, ExcludeReportFooter: true, ExcludeColumnHeaders: false, ReturnOnlyCompleteData: false,
      Aggregation: 'Daily', Columns: ['TimePeriod', 'CampaignId', 'Spend', 'Clicks', 'Conversions'],
      Scope: { AccountIds: [Number(String(ctx.env.MSADS_ACCOUNT_ID).replace(/\D/g, ''))] },
      Time: { CustomDateRangeStart: ymd(from), CustomDateRangeEnd: ymd(to), ReportTimeZone: ctx.env.MSADS_TIMEZONE || 'GreenwichMeanTimeDublinEdinburghLisbonLondon' },
    } } });
    if (!sub.ok || !sub.data?.ReportRequestId) throw new Error(fail(sub, ctx, 'Microsoft Ads report submit'));
    const polls = Number(opts.polls ?? ctx.env.MSADS_REPORT_POLLS ?? 12); const every = Number(opts.pollMs ?? ctx.pollMs ?? 5000);
    let status = null;
    for (let i = 0; i < polls; i++) {
      if (i) await wait(ctx, every);
      const p = await request(ctx, { url: `${base}/GenerateReport/Poll`, headers, json: { ReportRequestId: sub.data.ReportRequestId } });
      if (!p.ok) throw new Error(fail(p, ctx, 'Microsoft Ads report poll'));
      status = p.data?.ReportRequestStatus ?? {};
      if (status.Status !== 'Pending') break;
    }
    if (status?.Status === 'Pending') throw new Error(`Microsoft Ads report ${sub.data.ReportRequestId} still pending after ${polls} poll(s); next cycle will retry`);
    if (status?.Status !== 'Success') throw new Error(`Microsoft Ads report failed: status ${status?.Status ?? 'unknown'}`);
    // Success without a URL means the report has no rows.
    if (!status.ReportDownloadUrl) return { rows: [], detail: '0 campaign-day(s) from Microsoft Ads (empty report)' };
    const f = ctx.fetch ?? globalThis.fetch;
    const res = await f(status.ReportDownloadUrl, { method: 'GET' });
    if (!res.ok) throw new Error(`Microsoft Ads report download: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const csv = (buf[0] === 0x50 && buf[1] === 0x4b ? unzipFirst(buf) : buf).toString('utf8');
    const table = parseCsv(csv);
    const hi = table.findIndex((r) => r.includes('TimePeriod') && r.includes('CampaignId'));
    if (hi < 0) return { rows: [], detail: '0 campaign-day(s) from Microsoft Ads (no column header found)' };
    const col = Object.fromEntries(table[hi].map((h, i) => [h.trim(), i]));
    const rows = [];
    for (const r of table.slice(hi + 1)) {
      if (!/^\d/.test(String(r[col.TimePeriod] ?? '').trim())) continue; // skips footer / total lines
      rows.push(...adRows(normDay(r[col.TimePeriod]), 'microsoft', String(r[col.CampaignId] ?? '').trim(), num(r[col.Spend]), num(r[col.Clicks]), num(r[col.Conversions])));
    }
    return { rows, detail: `${rows.length / 3} campaign-day(s) from Microsoft Ads` };
  },
});

// ── Reddit Ads API v3 reports ──
// Docs: https://ads-api.reddit.com/docs/v3/ ("Get a Report": POST /ad_accounts/{id}/reports).
// The report endpoint is a POST that only reads. Breakdowns CAMPAIGN_ID + DATE (max two), daily only.
export const redditAdsMetrics = defineReader({
  name: 'reddit-ads-metrics', kind: 'metrics', handles: 'daily spend, clicks and conversions per Reddit Ads campaign (Ads API v3 reports, read-only)',
  needs: ['REDDIT_ADS_ACCESS_TOKEN', 'REDDIT_ADS_ACCOUNT_ID'],
  unverified: 'Report body (data.starts_at/ends_at hour-aligned UTC, breakdowns CAMPAIGN_ID+DATE, fields SPEND/CLICKS/KEY_CONVERSION_TOTAL_COUNT), the lower-case keys in data.metrics and spend in microcurrency follow the public v3 reference and third-party connectors; not tested against a live ad account.',
  preview: (o, env) => `POST a Reddit Ads report request for ad account ${env.REDDIT_ADS_ACCOUNT_ID || '(REDDIT_ADS_ACCOUNT_ID)'}, last ${o.days ?? 7} day(s)`,
  async read(ctx, opts) {
    const { from, to } = range(ctx, opts);
    const end = new Date(Date.parse(`${isoDay(to)}T00:00:00Z`) + 86400000);
    const body = { data: { starts_at: `${isoDay(from)}T00:00:00Z`, ends_at: `${isoDay(end)}T00:00:00Z`, breakdowns: ['CAMPAIGN_ID', 'DATE'], fields: ['SPEND', 'CLICKS', 'KEY_CONVERSION_TOTAL_COUNT'], time_zone_id: ctx.env.REDDIT_ADS_TIME_ZONE || 'GMT' } };
    const headers = { authorization: `Bearer ${ctx.env.REDDIT_ADS_ACCESS_TOKEN}`, 'user-agent': 'whalyom-marketing-os/1.0' };
    let url = `${REDDIT_API}/ad_accounts/${encodeURIComponent(String(ctx.env.REDDIT_ADS_ACCOUNT_ID).trim())}/reports`;
    const rows = [];
    for (let page = 0; page < 20 && url; page++) {
      const r = await request(ctx, { url, headers, json: body });
      if (!r.ok) throw new Error(fail(r, ctx, 'Reddit Ads report'));
      for (const x of r.data?.data?.metrics ?? []) {
        const v = (k) => x[k] ?? x[k.toUpperCase()];
        rows.push(...adRows(String(v('date') ?? '').slice(0, 10), 'reddit', String(v('campaign_id') ?? ''), num(v('spend')) / 1e6, v('clicks'), num(v('key_conversion_total_count'))));
      }
      const next = r.data?.pagination?.next_url;
      url = next && next.startsWith(REDDIT_API.replace(/\/api\/v3$/, '')) ? next : null; // only follow pages on the Reddit Ads host
    }
    return { rows, detail: `${rows.length / 3} campaign-day(s) from Reddit Ads` };
  },
});

// ── X Ads API synchronous stats ──
// Docs: https://docs.x.com/x-ads-api/analytics (GET stats/accounts/:account_id: entity CAMPAIGN, up to
// 20 entity_ids, at most 7 days per call, granularity DAY). Campaign ids come from GET accounts/:id/campaigns.
// Every call is a signed GET (OAuth 1.0a, same keys as the write connector).
export const xAdsMetrics = defineReader({
  name: 'x-ads-metrics', kind: 'metrics', handles: 'daily spend, clicks and conversions per X Ads campaign (stats endpoint, read-only GET)',
  needs: ['X_ADS_CONSUMER_KEY', 'X_ADS_CONSUMER_SECRET', 'X_ADS_ACCESS_TOKEN', 'X_ADS_ACCESS_SECRET', 'X_ADS_ACCOUNT_ID'],
  unverified: 'Metric names (billed_charge_local_micro, url_clicks/clicks, conversion_purchases and conversion_sign_ups with post_engagement/post_view arrays) follow the Ads API metrics reference; billed_charge_local_micro is an estimate for up to 3 days. Day boundaries are UTC, not the account time zone. Not tested against a live account.',
  preview: (o, env) => `GET X Ads campaigns and daily stats for account ${env.X_ADS_ACCOUNT_ID || '(X_ADS_ACCOUNT_ID)'}, last ${o.days ?? 7} day(s)`,
  async read(ctx, opts) {
    const { days, to } = range(ctx, opts);
    const creds = { consumerKey: ctx.env.X_ADS_CONSUMER_KEY, consumerSecret: ctx.env.X_ADS_CONSUMER_SECRET, token: ctx.env.X_ADS_ACCESS_TOKEN, tokenSecret: ctx.env.X_ADS_ACCESS_SECRET };
    const acct = encodeURIComponent(String(ctx.env.X_ADS_ACCOUNT_ID).trim());
    const get = async (pathname, params, what) => {
      const u = new URL(`${X_API}/${pathname}`);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
      const { header } = oauth1Sign('GET', u.toString(), creds, ctx.oauth ?? {});
      const r = await request(ctx, { url: u.toString(), method: 'GET', headers: { authorization: header } });
      if (!r.ok) throw new Error(fail(r, ctx, what));
      return r.data ?? {};
    };
    const ids = []; let cursor = null;
    for (let page = 0; page < 5; page++) {
      const d = await get(`accounts/${acct}/campaigns`, { count: 1000, with_deleted: 'false', ...(cursor ? { cursor } : {}) }, 'X Ads campaigns');
      ids.push(...(d.data ?? []).map((c) => String(c.id)).filter(Boolean));
      cursor = d.next_cursor; if (!cursor) break;
    }
    const sum = (v) => (Array.isArray(v) ? v : []);
    const at = (v, i) => num(sum(v)[i]);
    const conv = (m, i) => ['conversion_purchases', 'conversion_sign_ups'].reduce((s, k) => { const c = m?.[k]; if (!c) return s; return s + (Array.isArray(c) ? at(c, i) : at(c.post_engagement, i) + at(c.post_view, i)); }, 0);
    const rows = [];
    const dayStart = Date.parse(`${isoDay(to)}T00:00:00Z`) - (days - 1) * 86400000;
    for (let w = dayStart; w <= Date.parse(`${isoDay(to)}T00:00:00Z`); w += 7 * 86400000) {
      const wEnd = Math.min(w + 7 * 86400000, Date.parse(`${isoDay(to)}T00:00:00Z`) + 86400000);
      for (let i = 0; i < ids.length; i += 20) {
        const d = await get(`stats/accounts/${acct}`, { entity: 'CAMPAIGN', entity_ids: ids.slice(i, i + 20).join(','), start_time: new Date(w).toISOString().replace('.000Z', 'Z'), end_time: new Date(wEnd).toISOString().replace('.000Z', 'Z'),
          granularity: 'DAY', metric_groups: 'BILLING,ENGAGEMENT,WEB_CONVERSION', placement: 'ALL_ON_TWITTER' }, 'X Ads stats');
        for (const e of d.data ?? []) {
          for (const seg of e.id_data ?? []) {
            const m = seg.metrics ?? {};
            const n = Math.round((wEnd - w) / 86400000);
            for (let k = 0; k < n; k++) {
              const spend = at(m.billed_charge_local_micro, k) / 1e6; const clicks = at(m.url_clicks ?? m.clicks, k); const cv = conv(m, k);
              if (!spend && !clicks && !cv) continue; // no delivery that day
              rows.push(...adRows(isoDay(w + k * 86400000), 'x_ads', String(e.id), spend, clicks, cv));
            }
          }
        }
      }
    }
    return { rows, detail: `${rows.length / 3} campaign-day(s) from X Ads (${ids.length} campaign(s))` };
  },
});

// ── Apple Search Ads Campaign Management API v5 reports ──
// Docs: https://developer.apple.com/documentation/apple_ads/reports and
//       https://developer.apple.com/documentation/apple_ads/get-campaign-level-reports (POST /api/v5/reports/campaigns).
// Report requests are POSTs by the API's design; the OAuth client-credentials exchange is a POST too.
export const appleSearchAdsMetrics = defineReader({
  name: 'apple-search-ads-metrics', kind: 'metrics', handles: 'daily spend, taps and installs per Apple Search Ads campaign (v5 campaign reports, read-only)',
  needs: ['APPLE_ADS_CLIENT_ID', 'APPLE_ADS_TEAM_ID', 'APPLE_ADS_KEY_ID', 'APPLE_ADS_PRIVATE_KEY', 'APPLE_ADS_ORG_ID'],
  unverified: 'ReportingRequest body (startTime/endTime YYYY-MM-DD, granularity DAILY, selector.pagination) and response (data.reportingDataResponse.row[].metadata.campaignId, granularity[].date/localSpend.amount/taps/totalInstalls) follow the v5 reference; installs are reported as "conversions". Not tested against a live org.',
  preview: (o, env) => `POST an Apple Search Ads campaign report for org ${env.APPLE_ADS_ORG_ID || '(APPLE_ADS_ORG_ID)'}, last ${o.days ?? 7} day(s)`,
  async read(ctx, opts) {
    const { from, to } = range(ctx, opts);
    const t = await request(ctx, { url: APPLE_TOKEN_URL, form: { grant_type: 'client_credentials', client_id: ctx.env.APPLE_ADS_CLIENT_ID, client_secret: appleClientSecret(ctx.env, { now: ctx.now ?? Date.now() }), scope: 'searchadsorg' } });
    if (!t.ok || !t.data?.access_token) throw new Error(fail(t, ctx, 'Apple token'));
    const sctx = { ...ctx, env: { ...ctx.env, APPLE_ADS_ACCESS_TOKEN: t.data.access_token } };
    const headers = { authorization: `Bearer ${t.data.access_token}`, 'x-ap-context': `orgId=${ctx.env.APPLE_ADS_ORG_ID}` };
    const rows = []; const limit = 1000;
    for (let offset = 0, page = 0; page < 20; page++, offset += limit) {
      const r = await request(sctx, { url: `${APPLE_API}/reports/campaigns`, headers, json: {
        startTime: isoDay(from), endTime: isoDay(to), granularity: 'DAILY', timeZone: 'UTC',
        returnRecordsWithNoMetrics: false, returnRowTotals: false, returnGrandTotals: false,
        selector: { orderBy: [{ field: 'campaignId', sortOrder: 'ASCENDING' }], pagination: { offset, limit } },
      } });
      if (!r.ok) throw new Error(fail(r, sctx, 'Apple Search Ads report'));
      const list = r.data?.data?.reportingDataResponse?.row ?? [];
      for (const row of list) {
        const id = String(row.metadata?.campaignId ?? '');
        for (const g of row.granularity ?? []) rows.push(...adRows(String(g.date ?? '').slice(0, 10), 'apple', id, num(g.localSpend?.amount), g.taps, num(g.totalInstalls ?? g.installs ?? g.tapInstalls)));
      }
      const total = Number(r.data?.pagination?.totalResults ?? list.length);
      if (!list.length || offset + list.length >= total) break;
    }
    return { rows, detail: `${rows.length / 3} campaign-day(s) from Apple Search Ads (installs as conversions)` };
  },
});

export const calcom = defineReader({
  name: 'calcom', kind: 'links', handles: 'booking links from Cal.com event types (API v2)',
  needs: ['CALCOM_API_KEY', 'CALCOM_USERNAME'],
  unverified: 'Cal.com v2 event-types response shape (data as array or data.eventTypeGroups) and cal-api-version header value.',
  preview: () => 'GET Cal.com event types',
  async read(ctx) {
    const r = await request(ctx, { url: 'https://api.cal.com/v2/event-types', method: 'GET', headers: { authorization: `Bearer ${ctx.env.CALCOM_API_KEY}`, 'cal-api-version': ctx.env.CALCOM_API_VERSION || '2024-06-14' } });
    if (!r.ok) throw new Error(fail(r, ctx, 'Cal.com'));
    const raw = Array.isArray(r.data?.data) ? r.data.data : (r.data?.data?.eventTypeGroups ?? []).flatMap((g) => g.eventTypes ?? []);
    const base = (ctx.env.CALCOM_BOOKING_BASE || 'https://cal.com').replace(/\/$/, '');
    const links = raw.filter((e) => !e.hidden).map((e) => ({ name: e.title, url: `${base}/${ctx.env.CALCOM_USERNAME}/${e.slug}`, minutes: e.lengthInMinutes ?? e.length ?? null }));
    return { links, detail: `${links.length} Cal.com booking link(s)` };
  },
});

export const calendly = defineReader({
  name: 'calendly', kind: 'links', handles: 'scheduling links from Calendly event types (API v2)',
  needs: ['CALENDLY_TOKEN'],
  preview: () => 'GET Calendly /users/me and active event types',
  async read(ctx) {
    const headers = { authorization: `Bearer ${ctx.env.CALENDLY_TOKEN}` };
    const me = await request(ctx, { url: 'https://api.calendly.com/users/me', method: 'GET', headers });
    if (!me.ok || !me.data?.resource?.uri) throw new Error(fail(me, ctx, 'Calendly /users/me'));
    const r = await request(ctx, { url: `https://api.calendly.com/event_types?${new URLSearchParams({ user: me.data.resource.uri, active: 'true', count: '100' })}`, method: 'GET', headers });
    if (!r.ok) throw new Error(fail(r, ctx, 'Calendly event types'));
    const links = (r.data?.collection ?? []).map((e) => ({ name: e.name, url: e.scheduling_url, minutes: e.duration ?? null }));
    return { links, detail: `${links.length} Calendly link(s)` };
  },
});

export const metricReaders = [stripe, plausible, umami, ga4, googleAdsMetrics, tiktokAdsMetrics, linkedinAdsMetrics, microsoftAdsMetrics, redditAdsMetrics, xAdsMetrics, appleSearchAdsMetrics];
export const linkReaders = [calcom, calendly];
export const readers = [...metricReaders, ...linkReaders];

// Runs the configured metrics readers and drops their rows in products/<slug>/metrics/inbox/ for
// tools/metrics.mjs. names: optional list; without it every configured reader except stripe runs.
export async function pullMetrics(ctx, { names, days = 7 } = {}) {
  const chosen = metricReaders.filter((r) => (names?.length ? names.includes(r.name) : r.name !== 'stripe' && r.configured(ctx.env)));
  const out = [];
  for (const r of chosen) {
    const res = await r.read(ctx, { days });
    const entry = { source: r.name, ok: res.ok, dry_run: Boolean(res.dry_run), rows: res.rows?.length ?? 0, detail: res.detail };
    if (res.ok && !res.dry_run && res.rows?.length) {
      const dir = path.join(ctx.dir, 'metrics', 'inbox');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${r.name}-${isoDay(ctx.now ?? Date.now())}.json`);
      fs.writeFileSync(file, JSON.stringify(res.rows.map(({ date, channel, campaign, metric, value, currency }) => ({ date, channel, ...(campaign ? { campaign } : {}), metric, value, ...(currency ? { currency } : {}) })), null, 2));
      entry.file = path.relative(ctx.dir, file).replace(/\\/g, '/');
    }
    out.push(entry);
  }
  return out;
}

// Reads booking links and stores them in products/<slug>/research/booking-links.json.
export async function pullLinks(ctx) {
  const out = []; const links = [];
  for (const r of linkReaders.filter((x) => x.configured(ctx.env) || ctx.dryRun)) {
    const res = await r.read(ctx);
    out.push({ source: r.name, ok: res.ok, dry_run: Boolean(res.dry_run), links: res.links?.length ?? 0, detail: res.detail });
    if (res.ok && !res.dry_run) links.push(...res.links.map((l) => ({ ...l, source: r.name })));
  }
  if (links.length) {
    fs.mkdirSync(path.join(ctx.dir, 'research'), { recursive: true });
    fs.writeFileSync(path.join(ctx.dir, 'research', 'booking-links.json'), JSON.stringify({ updated_at: ctx.now ?? new Date().toISOString(), links }, null, 2));
  }
  return { sources: out, links };
}
