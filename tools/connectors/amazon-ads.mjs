// Amazon Ads (Sponsored Products) through the Amazon Ads API.
// Executor: an approved "spend" item with channel amazon/amazon_ads/amazon-ads either
//   - creates a Sponsored Products campaign, one ad group, product ads (ASINs or SKUs), keywords and
//     negative keywords (spec without "action"), everything PAUSED unless the item says activate: true;
//   - or changes the daily budget of an existing campaign (spec "action": "budget", "campaign_id").
// tools/execute.mjs has already enforced free mode, the daily and monthly caps and the approval; loadSpec()
// re-checks spec daily_budget <= the approved amount, and every keyword bid must fit inside the daily budget.
// pause(ref) pauses a campaign (CPA kill switch); pausing only ever reduces spend.
// Reader: amazonAdsMetrics (read-only) requests a Reporting v3 spCampaigns report, polls it, downloads the
// gzipped JSON and returns rows {date, channel: 'amazon', campaign, metric, value} for spend, clicks,
// conversions (purchases7d), sales (sales7d) and acos (cost / sales, percent; only when sales > 0).
//
// Keys (env only, never logged): AMAZON_ADS_CLIENT_ID, AMAZON_ADS_CLIENT_SECRET, AMAZON_ADS_REFRESH_TOKEN
// (Login with Amazon OAuth refresh token), AMAZON_ADS_PROFILE_ID (the advertiser profile, sent as
// Amazon-Advertising-API-Scope), optional AMAZON_ADS_REGION na | eu | fe (default na).
// The short-lived access token is fetched per call (refresh_token grant) and added to the redaction list.
//
// Spec (JSON, the approval's "file"):
//   { "name": "SP · core", "daily_budget": 20, "default_bid": 0.75, "ad_group": "Core",
//     "asins": ["B0XXXXXXX1"] | "skus": ["SKU-1"], "keywords": [{"text": "invoice book", "match": "exact", "bid": 1.1}],
//     "negatives": ["free"], "targeting": "manual" | "auto", "bidding": "LEGACY_FOR_SALES", "start_date": "2026-11-05" }
//   Budget change: { "action": "budget", "campaign_id": "1234567890", "daily_budget": 25 }
// Docs: https://advertising.amazon.com/API/docs/en-us/sponsored-products/3-0/openapi/prod (SP v3),
// https://advertising.amazon.com/API/docs/en-us/guides/reporting/v3/overview (Reporting v3),
// https://advertising.amazon.com/API/docs/en-us/guides/get-started/retrieve-access-token (LWA tokens).
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { defineConnector, defineReader, request, fail, missingKeys, redact, isoDay, daysAgo } from './_http.mjs';
import { loadSpec, partialResult } from './ads.mjs';
import { loadEnv } from '../lib/env.mjs';

export const CHANNELS = ['amazon', 'amazon_ads', 'amazon-ads'];
export const NEEDS = ['AMAZON_ADS_CLIENT_ID', 'AMAZON_ADS_CLIENT_SECRET', 'AMAZON_ADS_REFRESH_TOKEN', 'AMAZON_ADS_PROFILE_ID'];
export const REGIONS = {
  na: { api: 'https://advertising-api.amazon.com', token: 'https://api.amazon.com/auth/o2/token' },
  eu: { api: 'https://advertising-api-eu.amazon.com', token: 'https://api.amazon.co.uk/auth/o2/token' },
  fe: { api: 'https://advertising-api-fe.amazon.com', token: 'https://api.amazon.co.jp/auth/o2/token' },
};
export const region = (env = {}) => REGIONS[String(env.AMAZON_ADS_REGION ?? 'na').toLowerCase()] ?? REGIONS.na;

// SP v3 versioned media types (sent as both content-type and accept).
const MT = {
  campaigns: 'application/vnd.spCampaign.v3+json',
  adGroups: 'application/vnd.spAdGroup.v3+json',
  productAds: 'application/vnd.spProductAd.v3+json',
  keywords: 'application/vnd.spKeyword.v3+json',
  negativeKeywords: 'application/vnd.spNegativeKeyword.v3+json',
};
const MATCH = { exact: 'EXACT', phrase: 'PHRASE', broad: 'BROAD' };
const BIDDING = ['LEGACY_FOR_SALES', 'AUTO_FOR_SALES', 'MANUAL']; // SP v3 dynamicBidding.strategy
const ID = /^\d{1,20}$/;
const round2 = (n) => Math.round(Number(n) * 100) / 100;

// Exchanges the refresh token for an access token (Login with Amazon, refresh_token grant).
export async function accessToken(ctx) {
  const r = await request(ctx, { url: region(ctx.env).token, form: { grant_type: 'refresh_token', refresh_token: ctx.env.AMAZON_ADS_REFRESH_TOKEN, client_id: ctx.env.AMAZON_ADS_CLIENT_ID, client_secret: ctx.env.AMAZON_ADS_CLIENT_SECRET } });
  if (!r.ok || !r.data?.access_token) throw new Error(fail(r, ctx, 'Amazon token'));
  return r.data.access_token;
}

// One authorised session: call(method, resource, body, mediaType) against the regional API host.
// The access token joins env under a TOKEN name, so redact() strips it from every error text.
export async function session(ctx) {
  const token = await accessToken(ctx);
  const sctx = { ...ctx, env: { ...ctx.env, AMAZON_ADS_ACCESS_TOKEN: token } };
  const base = { authorization: `Bearer ${token}`, 'Amazon-Advertising-API-ClientId': ctx.env.AMAZON_ADS_CLIENT_ID, 'Amazon-Advertising-API-Scope': String(ctx.env.AMAZON_ADS_PROFILE_ID).trim() };
  const call = async (method, resource, json, mediaType) => {
    const headers = { ...base, ...(mediaType ? { 'content-type': mediaType, accept: mediaType } : {}) };
    return request(sctx, { url: `${region(ctx.env).api}/${resource}`, method, headers, json });
  };
  return { call, ctx: sctx };
}

// SP v3 multi-status answer: { <key>: { success: [{index, <idKey>}], error: [{index, errors: [...]}] } }.
export function spResult(data, key, idKey) {
  const block = data?.[key] ?? {};
  const ids = (block.success ?? []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((x) => String(x[idKey] ?? x[key.replace(/s$/, '')]?.[idKey] ?? ''));
  const errors = (block.error ?? []).map((e) => `#${e.index ?? '?'} ${(e.errors ?? []).map((x) => x.errorValue ? JSON.stringify(x.errorValue).slice(0, 160) : (x.message ?? x.errorType ?? '')).join('; ')}`.trim());
  return { ids: ids.filter(Boolean), errors };
}

async function spCreate(s, ctx, resource, items, idKey) {
  const r = await s.call('POST', `sp/${resource}`, { [resource]: items }, MT[resource]);
  if (!r.ok) throw new Error(fail(r, s.ctx, `Amazon sp/${resource}`));
  const out = spResult(r.data, resource, idKey);
  if (out.errors.length) throw new Error(redact(`Amazon sp/${resource}: ${out.errors.join(' | ')}`.slice(0, 300), s.ctx.env));
  if (out.ids.length !== items.length) throw new Error(`Amazon sp/${resource} returned ${out.ids.length} id(s) for ${items.length} item(s)`);
  return out.ids;
}

// Pure: validates and normalises a create or budget spec. Returns {error} or the plan.
export function planSpec(s, item, now = Date.now()) {
  if (s.action === 'budget') {
    const id = String(s.campaign_id ?? '').trim();
    if (!ID.test(id)) return { error: 'budget change needs campaign_id (numeric Amazon campaign id)' };
    return { kind: 'budget', campaignId: id, daily: round2(s.daily) };
  }
  if (s.action && s.action !== 'create') return { error: `unknown Amazon spec action "${s.action}" (create or budget)` };
  const defaultBid = Number(s.default_bid ?? s.max_cpc);
  if (!(defaultBid > 0)) return { error: 'Amazon spec needs default_bid (or max_cpc) > 0' };
  if (defaultBid > s.daily) return { error: `default_bid ${defaultBid} must not exceed daily_budget ${s.daily}` };
  const asins = (s.asins ?? []).map((a) => String(a).trim().toUpperCase()).filter(Boolean);
  const skus = (s.skus ?? []).map((a) => String(a).trim()).filter(Boolean);
  const badAsin = asins.filter((a) => !/^[A-Z0-9]{10}$/.test(a));
  if (badAsin.length) return { error: `ASINs must be 10 letters/digits (got ${badAsin.join(', ')})` };
  const keywords = s.keywords.map((k) => ({ text: String(k.text ?? '').trim(), match: MATCH[String(k.match ?? 'phrase').toLowerCase()] ?? 'PHRASE', bid: k.bid !== undefined ? Number(k.bid) : null })).filter((k) => k.text);
  const badBid = keywords.filter((k) => k.bid !== null && !(k.bid > 0 && k.bid <= s.daily));
  if (badBid.length) return { error: `keyword bids must be > 0 and <= daily_budget ${s.daily} (${badBid.map((k) => k.text).join(', ')})` };
  const targeting = String(s.targeting ?? (keywords.length ? 'manual' : 'auto')).toUpperCase();
  if (!['MANUAL', 'AUTO'].includes(targeting)) return { error: 'targeting must be "manual" or "auto"' };
  if (targeting === 'AUTO' && keywords.length) return { error: 'auto-targeted campaigns take no keywords; set targeting "manual"' };
  const start = String(s.start_date ?? isoDay(now));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return { error: 'start_date must be YYYY-MM-DD' };
  if (!asins.length && !skus.length) return { error: 'Amazon spec needs asins or skus (a campaign without product ads cannot serve)' };
  // Only the documented strategies; AUTO_FOR_SALES may raise bids, but the daily budget still caps spend.
  const bidding = String(s.bidding ?? 'LEGACY_FOR_SALES').toUpperCase();
  if (!BIDDING.includes(bidding)) return { error: `bidding must be one of ${BIDDING.join(', ')}` };
  const negatives = (Array.isArray(s.negatives) ? s.negatives : []).filter((n) => typeof n === 'string').map((n) => n.trim()).filter(Boolean);
  return { kind: 'create', name: `${s.name} · ${item.id}`, daily: round2(s.daily), defaultBid: round2(defaultBid), adGroup: s.ad_group, asins, skus, keywords, negatives, targeting, start, bidding };
}

// Pauses a Sponsored Products campaign by id. A ref "<campaign>/<ad group>/…" pauses its campaign.
// Never throws: a failure comes back as ok:false so the kill switch raises its owner alert.
export async function pause(ref, env = {}, dryRun = false, opts = {}) {
  const id = String(ref ?? '').replace(/^campaign:/, '').split('/')[0].trim();
  if (!ID.test(id)) return { ok: false, detail: `no Amazon campaign id to pause in "${redact(ref, env).slice(0, 80)}"` };
  if (dryRun) return { ok: true, detail: `would pause Amazon campaign ${id}` };
  const miss = missingKeys(env, NEEDS);
  if (miss.length) return { ok: false, detail: `missing ${miss.join(', ')}; cannot pause Amazon campaign ${id}` };
  let renv = env;
  try {
    const s = await session({ env, fetch: opts.fetch });
    renv = s.ctx.env;
    const r = await s.call('PUT', 'sp/campaigns', { campaigns: [{ campaignId: id, state: 'PAUSED' }] }, MT.campaigns);
    if (!r.ok) return { ok: false, detail: fail(r, s.ctx, 'Amazon pause') };
    const out = spResult(r.data, 'campaigns', 'campaignId');
    return out.errors.length ? { ok: false, detail: redact(`Amazon pause: ${out.errors.join(' | ')}`, renv).slice(0, 300) } : { ok: true, detail: `paused Amazon campaign ${id}` };
  } catch (e) { return { ok: false, detail: redact(e.message ?? e, renv) }; }
}

export const amazonAds = { ...defineConnector({
  name: 'amazon-ads',
  handles: 'type "spend" with channel "amazon": Sponsored Products campaign, ad group, product ads and keywords (paused by default), or a daily budget change',
  needs: NEEDS,
  unverified: 'SP v3 bodies (campaigns.budget {budgetType DAILY, budget}, dynamicBidding.strategy, state ENABLED/PAUSED, adGroups.defaultBid, productAds asin|sku, keywords matchType/bid, multi-status success/error arrays) follow the public SP v3 reference; not tested against a live profile. Test with a sandbox profile first.',
  accepts: (item) => item.type === 'spend' && CHANNELS.includes(item.channel),
  prepare(item, ctx) {
    const s = loadSpec(item, ctx);
    const p = planSpec(s, item, ctx.now ?? Date.now());
    if (p.error) return { error: p.error };
    if (p.kind === 'budget') return { p, preview: `set the daily budget of Amazon campaign ${p.campaignId} to ${p.daily}` };
    const state = item.activate === true ? 'ENABLED' : 'PAUSED';
    const products = p.asins.length + p.skus.length;
    return { p, state, preview: `create ${state} Amazon Sponsored Products campaign "${p.name}" (${p.targeting.toLowerCase()}) at ${p.daily}/day with ${products} product ad(s), ${p.keywords.length} keyword(s) and ${p.negatives.length} negative(s)` };
  },
  async send(prep, item, ctx) {
    const { p } = prep;
    const s = await session(ctx);
    if (p.kind === 'budget') {
      const r = await s.call('PUT', 'sp/campaigns', { campaigns: [{ campaignId: p.campaignId, budget: { budgetType: 'DAILY', budget: p.daily } }] }, MT.campaigns);
      if (!r.ok) return { ok: false, detail: fail(r, s.ctx, 'Amazon budget') };
      const out = spResult(r.data, 'campaigns', 'campaignId');
      if (out.errors.length) return { ok: false, detail: redact(`Amazon budget: ${out.errors.join(' | ')}`, s.ctx.env).slice(0, 300) };
      // The campaign may be live, so the new budget counts in full against the caps (never under-counted).
      return { ok: true, ref: p.campaignId, detail: `Amazon campaign ${p.campaignId} daily budget set to ${p.daily}`, committed_daily: p.daily };
    }
    const { state } = prep;
    const [campaignId] = await spCreate(s, ctx, 'campaigns', [{
      name: p.name, targetingType: p.targeting, state, startDate: p.start,
      budget: { budgetType: 'DAILY', budget: p.daily },
      dynamicBidding: { strategy: p.bidding }, // verify against current API docs (LEGACY_FOR_SALES | AUTO_FOR_SALES | MANUAL)
    }], 'campaignId');
    // Each create is its own call: a later failure leaves the earlier resources, so the result is partial
    // (no retry, which would duplicate them). Nothing serves meanwhile: the campaign state is as approved.
    const created = [campaignId];
    let adGroupId = '';
    try {
      [adGroupId] = await spCreate(s, ctx, 'adGroups', [{ campaignId, name: p.adGroup, state: 'ENABLED', defaultBid: p.defaultBid }], 'adGroupId');
      created.push(adGroupId);
      const products = [...p.asins.map((asin) => ({ campaignId, adGroupId, state: 'ENABLED', asin })), ...p.skus.map((sku) => ({ campaignId, adGroupId, state: 'ENABLED', sku }))];
      if (products.length) await spCreate(s, ctx, 'productAds', products, 'adId');
      if (p.keywords.length) await spCreate(s, ctx, 'keywords', p.keywords.map((k) => ({ campaignId, adGroupId, keywordText: k.text, matchType: k.match, state: 'ENABLED', ...(k.bid !== null ? { bid: round2(k.bid) } : {}) })), 'keywordId');
      if (p.negatives.length) await spCreate(s, ctx, 'negativeKeywords', p.negatives.map((n) => ({ campaignId, adGroupId, keywordText: n, matchType: 'NEGATIVE_PHRASE', state: 'ENABLED' })), 'negativeKeywordId');
    } catch (e) { return partialResult(e, created, state); }
    return { ok: true, ref: `${campaignId}/${adGroupId}`, detail: `${state} Amazon campaign ${campaignId}, ad group ${adGroupId}, ${p.daily}/day`, committed_daily: state === 'ENABLED' ? p.daily : 0 };
  },
}), pause };

// ── Read-only metrics (Reporting v3) ──
const num = (v) => { const n = Number(String(v ?? '').replace(/[,%\s]/g, '')); return Number.isFinite(n) ? n : 0; };
const wait = (ctx, ms) => (ctx.sleep ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));
export const REPORT_MT = 'application/vnd.createasyncreportrequest.v3+json';
export const REPORT_COLUMNS = ['date', 'campaignId', 'cost', 'clicks', 'impressions', 'purchases7d', 'sales7d'];

// Pure: rows for one campaign-day of an spCampaigns report.
export function amazonRows(x) {
  const date = String(x.date ?? '').slice(0, 10);
  const campaign = String(x.campaignId ?? '');
  const spend = round2(num(x.cost));
  const sales = round2(num(x.sales7d));
  const rows = [
    { date, channel: 'amazon', campaign, metric: 'spend', value: spend },
    { date, channel: 'amazon', campaign, metric: 'clicks', value: num(x.clicks) },
    { date, channel: 'amazon', campaign, metric: 'conversions', value: num(x.purchases7d) },
    { date, channel: 'amazon', campaign, metric: 'sales', value: sales },
  ];
  if (sales > 0) rows.push({ date, channel: 'amazon', campaign, metric: 'acos', value: round2((spend / sales) * 100) });
  return rows;
}

export const amazonAdsMetrics = defineReader({
  name: 'amazon-ads-metrics', kind: 'metrics', handles: 'daily spend, clicks, orders, sales and ACOS per Amazon Sponsored Products campaign (Reporting v3, read-only)',
  needs: NEEDS,
  unverified: 'Reporting v3 body (reportTypeId spCampaigns, groupBy campaign, timeUnit DAILY, GZIP_JSON) and column names (cost, purchases7d, sales7d) follow the public v3 reference; the 425 duplicate-report answer is parsed for the existing report id. Reports can take minutes to hours: a still-pending report fails this cycle and the next cycle picks up the duplicate. Not tested against a live profile.',
  preview: (o, env) => `request an Amazon Sponsored Products campaign report for profile ${env.AMAZON_ADS_PROFILE_ID || '(AMAZON_ADS_PROFILE_ID)'}, last ${o.days ?? 7} day(s), poll it and download it`,
  async read(ctx, opts) {
    const days = Math.min(Math.max(Number(opts.days ?? 7), 1), 31); // spCampaigns: at most 31 days per report
    const to = new Date(ctx.now ?? Date.now());
    const from = daysAgo(to, days);
    const s = await session(ctx);
    const body = { name: `whalyom sp campaigns ${isoDay(from)}..${isoDay(to)}`, startDate: isoDay(from), endDate: isoDay(to),
      configuration: { adProduct: 'SPONSORED_PRODUCTS', groupBy: ['campaign'], columns: REPORT_COLUMNS, reportTypeId: 'spCampaigns', timeUnit: 'DAILY', format: 'GZIP_JSON' } };
    const sub = await s.call('POST', 'reporting/reports', body, REPORT_MT);
    let reportId = sub.data?.reportId;
    // 425: an identical request is already queued; the detail names its id.
    if (!sub.ok && sub.status === 425) reportId = (String(sub.data?.detail ?? sub.text).match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i) ?? [])[0];
    if (!reportId) throw new Error(fail(sub, s.ctx, 'Amazon report request'));
    const polls = Number(opts.polls ?? ctx.env.AMAZON_ADS_REPORT_POLLS ?? 12); const every = Number(opts.pollMs ?? ctx.pollMs ?? 10000);
    let st = {};
    for (let i = 0; i < polls; i++) {
      if (i) await wait(ctx, every);
      const r = await s.call('GET', `reporting/reports/${encodeURIComponent(reportId)}`);
      if (!r.ok) throw new Error(fail(r, s.ctx, 'Amazon report status'));
      st = r.data ?? {};
      if (!['PENDING', 'PROCESSING'].includes(st.status)) break;
    }
    if (['PENDING', 'PROCESSING'].includes(st.status)) throw new Error(`Amazon report ${reportId} still ${st.status.toLowerCase()} after ${polls} poll(s); next cycle will retry`);
    if (st.status !== 'COMPLETED' || !st.url) throw new Error(`Amazon report ${reportId} ended ${st.status ?? 'unknown'}${st.failureReason ? `: ${redact(st.failureReason, s.ctx.env).slice(0, 120)}` : ''}`);
    // Pre-signed download URL: fetched without the API headers.
    const f = ctx.fetch ?? globalThis.fetch;
    const res = await f(st.url, { method: 'GET' });
    if (!res.ok) throw new Error(`Amazon report download: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const text = (buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf).toString('utf8');
    const data = text.trim() ? JSON.parse(text) : [];
    const rows = (Array.isArray(data) ? data : []).flatMap(amazonRows);
    return { rows, detail: `${(Array.isArray(data) ? data : []).length} campaign-day(s) from Amazon Ads` };
  },
});

export const readers = [amazonAdsMetrics];
export default amazonAds;

// CLI: node tools/connectors/amazon-ads.mjs status | metrics [--days N] [--dry-run]
// Prints key NAMES that are missing and row counts / rows, never a secret value.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  loadEnv();
  const [cmd = 'status', ...rest] = process.argv.slice(2);
  const env = process.env;
  if (cmd === 'status') {
    console.log(JSON.stringify({ connector: amazonAds.name, configured: amazonAds.configured(env), missing: amazonAds.missing(env), reader: amazonAdsMetrics.name, unverified: amazonAds.unverified }, null, 2));
  } else if (cmd === 'metrics') {
    const di = rest.indexOf('--days');
    const r = await amazonAdsMetrics.read({ env, dryRun: rest.includes('--dry-run') }, { days: di > -1 ? Number(rest[di + 1]) : 7 });
    console.log(JSON.stringify({ ok: r.ok, dry_run: Boolean(r.dry_run), detail: redact(r.detail ?? '', env), rows: r.rows ?? [] }, null, 2));
    if (!r.ok) process.exit(1);
  } else { console.error('Usage: node tools/connectors/amazon-ads.mjs status | metrics [--days N] [--dry-run]'); process.exit(2); }
}
