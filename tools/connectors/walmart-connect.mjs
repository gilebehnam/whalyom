// Walmart Connect Sponsored Search (Sponsored Products) through the Walmart Advertising API.
// Executor: an approved "spend" item with channel walmart/walmart_connect/walmart-connect/walmart_ads
// creates a manual Sponsored Search campaign, one ad group, ad items and keywords. The campaign is
// created with status "paused" in the create call itself (status is a required create field) and never
// activated by this connector, even with activate: true (the owner launches it in Walmart Connect, or
// through a later approved item). Walmart accepts only rollover: true, so unspent daily budget can roll
// into later days once the owner launches it; the preview says so before approval.
// tools/execute.mjs has already enforced free mode, the caps and the approval; loadSpec() re-checks
// spec daily_budget <= the approved amount, and every bid must fit inside the daily budget.
// pause(ref) pauses a campaign (CPA kill switch); pausing only ever reduces spend.
// Reader: walmartConnectMetrics (read-only) requests a Snapshot v2 adGroup report (there is no campaign
// report type; v1 snapshots were retired 2026-02-09), polls it, downloads it (gzip CSV; JSON and JSON
// lines also parsed), sums ad groups per campaign-day and returns rows {date, channel: 'walmart', campaign,
// metric, value} for spend, clicks, conversions (attributed orders), sales (attributed sales) and acos.
//
// Keys (env only, never logged): WALMART_ADS_CONSUMER_ID, WALMART_ADS_PRIVATE_KEY (RSA private key, PEM
// or the bare base64 PKCS#8 body Walmart issues; "\n" escapes allowed), WALMART_ADS_AUTH_TOKEN (the
// advertiser's API auth token), WALMART_ADS_ADVERTISER_ID; optional WALMART_ADS_KEY_VERSION (default 1)
// and WALMART_ADS_BASE (default production host below; staging is
// https://developer.api.stg.walmart.com/api-proxy/service/WPA/Api/v1).
// Every call is signed with the real clock (never the run's --now):WM_SEC.AUTH_SIGNATURE = base64(RSA-SHA256("<consumerId>\n<timestamp ms>\n<keyVersion>\n")).
//
// Spec (JSON, the approval's "file"):
//   { "name": "SS · core", "daily_budget": 30, "total_budget": 600, "start_date": "2026-11-06", "end_date": "",
//     "ad_group": "Core", "items": [{"item_id": "123456789", "bid": 0.6}] | ["123456789"], "default_bid": 0.5,
//     "keywords": [{"text": "invoice book", "match": "exact", "bid": 0.8}] }
// Docs: https://developer.walmart.com/advertising-partners-search/docs (create-new-campaign,
// update-existing-campaigns, create-report-snapshot-updated, retrieve-snapshot-v2-reports-updated). Field names below are marked where not confirmed against a live account.
import crypto from 'node:crypto';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { defineConnector, defineReader, request, fail, missingKeys, redact, isoDay, daysAgo } from './_http.mjs';
import { loadSpec, partialResult } from './ads.mjs';
import { loadEnv } from '../lib/env.mjs';

export const CHANNELS = ['walmart', 'walmart_connect', 'walmart-connect', 'walmart_ads', 'walmart-ads'];
export const NEEDS = ['WALMART_ADS_CONSUMER_ID', 'WALMART_ADS_PRIVATE_KEY', 'WALMART_ADS_AUTH_TOKEN', 'WALMART_ADS_ADVERTISER_ID'];
export const API = 'https://developer.api.walmart.com/api-proxy/service/WPA/Api/v1'; // resources add api/v1/… or api/v2/…
export const apiBase = (env = {}) => (/^https:\/\/\S+$/.test(String(env.WALMART_ADS_BASE ?? '')) ? String(env.WALMART_ADS_BASE).replace(/\/$/, '') : API);
const MATCH = { exact: 'exact', phrase: 'phrase', broad: 'broad' };
const ID = /^\d{1,20}$/;
const round2 = (n) => Math.round(Number(n) * 100) / 100;

// Accepts a full PEM (with real or "\n"-escaped line breaks) or the bare base64 PKCS#8 body.
export function privateKeyOf(raw) {
  const s = String(raw ?? '').replace(/\\n/g, '\n').trim();
  if (s.startsWith('-----')) return crypto.createPrivateKey(s);
  return crypto.createPrivateKey({ key: Buffer.from(s.replace(/\s+/g, ''), 'base64'), format: 'der', type: 'pkcs8' });
}

// Pure: the signed headers for one call. now: ms timestamp (tests pin it).
export function signHeaders(env, now = Date.now()) {
  const ts = String(new Date(now).getTime());
  const version = String(env.WALMART_ADS_KEY_VERSION || '1');
  const toSign = `${env.WALMART_ADS_CONSUMER_ID}\n${ts}\n${version}\n`;
  const signature = crypto.createSign('RSA-SHA256').update(toSign).sign(privateKeyOf(env.WALMART_ADS_PRIVATE_KEY), 'base64');
  return { authorization: `Bearer ${env.WALMART_ADS_AUTH_TOKEN}`, 'WM_CONSUMER.ID': env.WALMART_ADS_CONSUMER_ID, 'WM_SEC.KEY_VERSION': version, 'WM_CONSUMER.intimestamp': ts, 'WM_SEC.AUTH_SIGNATURE': signature, accept: 'application/json' };
}

// The signature is a per-call secret too: it joins env under a SECRET name for redaction.
// ctx.clock (tests) or the real clock: a signature stamped with a pinned run time would be rejected as stale.
async function call(ctx, method, resource, json) {
  const headers = signHeaders(ctx.env, ctx.clock ? ctx.clock() : Date.now());
  const rctx = { ...ctx, env: { ...ctx.env, WALMART_ADS_SIGNATURE_SECRET: headers['WM_SEC.AUTH_SIGNATURE'] } };
  const r = await request(rctx, { url: `${apiBase(ctx.env)}/${resource}`, method, headers, json });
  return { ...r, ctx: rctx };
}

// Walmart answers create/update with an array of {code: 'success'|'failure', details, <idKey>}.
export function wmResult(data, idKey) {
  const list = Array.isArray(data) ? data : (data ? [data] : []);
  const ok = (x) => String(x?.code ?? '').toLowerCase() === 'success';
  const errors = list.filter((x) => !ok(x)).map((x) => String(x?.details ?? x?.message ?? JSON.stringify(x)).slice(0, 160));
  const ids = idKey ? list.filter(ok).map((x) => String(x?.[idKey] ?? '')).filter(Boolean) : [];
  return { ids, errors };
}

async function create(ctx, resource, items, idKey) {
  const r = await call(ctx, 'POST', `api/v1/${resource}`, items);
  if (!r.ok) throw new Error(fail(r, r.ctx, `Walmart ${resource}`));
  const out = wmResult(r.data, idKey);
  if (out.errors.length) throw new Error(redact(`Walmart ${resource}: ${out.errors.join(' | ')}`.slice(0, 300), r.ctx.env));
  if (idKey && out.ids.length < 1) throw new Error(`Walmart ${resource} returned no id`);
  return out.ids;
}

// Pure: validates and normalises a spec. Returns {error} or the plan.
export function planSpec(s, item, now = Date.now()) {
  const defaultBid = Number(s.default_bid ?? s.max_cpc ?? 0);
  const items = (s.items ?? []).map((x) => (typeof x === 'object' && x ? { id: String(x.item_id ?? x.itemId ?? '').trim(), bid: x.bid !== undefined ? Number(x.bid) : defaultBid } : { id: String(x).trim(), bid: defaultBid }));
  if (!items.length) return { error: 'Walmart spec needs items (Walmart item ids to advertise)' };
  const badId = items.filter((x) => !ID.test(x.id));
  if (badId.length) return { error: `Walmart item ids must be numeric (got ${badId.map((x) => x.id || '(empty)').join(', ')})` };
  const keywords = s.keywords.map((k) => ({ text: String(k.text ?? '').trim(), match: MATCH[String(k.match ?? 'exact').toLowerCase()] ?? 'exact', bid: k.bid !== undefined ? Number(k.bid) : defaultBid })).filter((k) => k.text);
  if (!keywords.length) return { error: 'Walmart manual campaign needs keywords' };
  const bad = [...items.map((x) => ({ n: x.id, b: x.bid })), ...keywords.map((k) => ({ n: k.text, b: k.bid }))].filter((x) => !(x.b > 0 && x.b <= s.daily));
  if (bad.length) return { error: `bids (default_bid or per item/keyword) must be > 0 and <= daily_budget ${s.daily} (${bad.map((x) => x.n).join(', ')})` };
  const start = String(s.start_date ?? isoDay(new Date(now).getTime() + 86400000));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return { error: 'start_date must be YYYY-MM-DD' };
  const end = s.end_date ? String(s.end_date) : '9999-12-30'; // Walmart: endDate required; 9999-12-30 runs indefinitely
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) return { error: 'end_date must be YYYY-MM-DD and not before start_date' };
  const total = s.total_budget !== undefined && s.total_budget !== null ? Number(s.total_budget) : null;
  if (total !== null && !(total >= s.daily)) return { error: 'total_budget must be >= daily_budget' };
  return { name: `${s.name} · ${item.id}`, daily: round2(s.daily), total: total === null ? null : round2(total), start, end, adGroup: s.ad_group, items, keywords };
}

// Pauses a campaign by id. A ref "<campaign>/<ad group>" pauses its campaign. Never throws.
export async function pause(ref, env = {}, dryRun = false, opts = {}) {
  const id = String(ref ?? '').replace(/^campaign:/, '').split('/')[0].trim();
  if (!ID.test(id)) return { ok: false, detail: `no Walmart campaign id to pause in "${redact(ref, env).slice(0, 80)}"` };
  if (dryRun) return { ok: true, detail: `would pause Walmart campaign ${id}` };
  const miss = missingKeys(env, NEEDS);
  if (miss.length) return { ok: false, detail: `missing ${miss.join(', ')}; cannot pause Walmart campaign ${id}` };
  try {
    // verify against current API docs (PUT /campaigns with [{campaignId, advertiserId, status: 'paused'}])
    const r = await call({ env, fetch: opts.fetch, clock: opts.clock }, 'PUT', 'api/v1/campaigns', [{ campaignId: Number(id), advertiserId: Number(env.WALMART_ADS_ADVERTISER_ID), status: 'paused' }]);
    if (!r.ok) return { ok: false, detail: fail(r, r.ctx, 'Walmart pause') };
    const out = wmResult(r.data, 'campaignId');
    return out.errors.length ? { ok: false, detail: redact(`Walmart pause: ${out.errors.join(' | ')}`, r.ctx.env).slice(0, 300) } : { ok: true, detail: `paused Walmart campaign ${id}` };
  } catch (e) { return { ok: false, detail: redact(e.message ?? e, env) }; }
}

export const walmartConnect = { ...defineConnector({
  name: 'walmart-connect',
  handles: 'type "spend" with channel "walmart": Sponsored Search campaign, ad group, ad items and keywords through the Walmart Connect API (always created paused)',
  needs: NEEDS,
  unverified: 'Walmart Sponsored Search API host, signature headers (WM_CONSUMER.ID, WM_SEC.KEY_VERSION, WM_CONSUMER.intimestamp, WM_SEC.AUTH_SIGNATURE), campaign fields (campaignType sponsoredProducts, targetingType manual, budgetType daily|both, dailyBudget, totalBudget, status paused) and the array {code, details, id} answers follow the public partner docs; not tested against a live advertiser. Use the sandbox (WALMART_ADS_BASE) first.',
  accepts: (item) => item.type === 'spend' && CHANNELS.includes(item.channel),
  prepare(item, ctx) {
    const s = loadSpec(item, ctx);
    const p = planSpec(s, item, ctx.now ?? Date.now());
    if (p.error) return { error: p.error };
    const note = item.activate === true ? ' (activate ignored: launch it in Walmart Connect)' : '';
    return { p, preview: `create PAUSED Walmart Sponsored Search campaign "${p.name}" at ${p.daily}/day from ${p.start} with ${p.items.length} item(s) and ${p.keywords.length} keyword(s); Walmart rollover is always on, so unspent daily budget can carry over once launched${note}` };
  },
  async send(prep, item, ctx) {
    const { p } = prep;
    const rawAdv = String(ctx.env.WALMART_ADS_ADVERTISER_ID).trim();
    if (!ID.test(rawAdv)) return { ok: false, detail: 'WALMART_ADS_ADVERTISER_ID must be the numeric advertiser id' };
    const advertiserId = Number(rawAdv);
    // status is a required create field (enabled | paused | completed): the campaign is born paused, so
    // there is no window in which it could serve. rollover: Walmart accepts only true.
    const [campaignId] = await create(ctx, 'campaigns', [{
      name: p.name, campaignType: 'sponsoredProducts', targetingType: 'manual', status: 'paused', advertiserId, startDate: p.start, endDate: p.end,
      budgetType: p.total !== null ? 'both' : 'daily', dailyBudget: p.daily, ...(p.total !== null ? { totalBudget: p.total } : {}), rollover: true,
    }], 'campaignId');
    // A failure after the first create is partial (no retry, which would duplicate it).
    const created = [campaignId];
    let adGroupId = '';
    try {
      [adGroupId] = await create(ctx, 'adGroups', [{ name: p.adGroup, campaignId: Number(campaignId), advertiserId, status: 'enabled' }], 'adGroupId');
      created.push(adGroupId);
      await create(ctx, 'adItems', p.items.map((x) => ({ campaignId: Number(campaignId), adGroupId: Number(adGroupId), itemId: x.id, bid: round2(x.bid), advertiserId })), null);
      await create(ctx, 'keywords', p.keywords.map((k) => ({ campaignId: Number(campaignId), adGroupId: Number(adGroupId), keywordText: k.text, matchType: k.match, bid: round2(k.bid), advertiserId })), null);
    } catch (e) { return partialResult(e, created, 'paused'); }
    return { ok: true, ref: `${campaignId}/${adGroupId}`, detail: `PAUSED Walmart campaign ${campaignId}, ad group ${adGroupId}, ${p.daily}/day from ${p.start}`, committed_daily: 0 };
  },
}), pause };

// ── Read-only metrics (snapshot reports) ──
const num = (v) => { const n = Number(String(v ?? '').replace(/[,%$\s]/g, '')); return Number.isFinite(n) ? n : 0; };
const wait = (ctx, ms) => (ctx.sleep ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));
export const REPORT_METRICS = ['date', 'campaignId', 'adGroupId', 'adSpend', 'numAdsClicks', 'attributedOrders14days', 'attributedSales14days']; // verify names against "Parameters Generated by Snapshot Reports v2"
const PENDING = ['pending', 'processing', 'queued'];

// Minimal RFC 4180 CSV parser → array of row arrays.
export function parseCsv(text) {
  const out = []; let row = []; let cell = ''; let q = false;
  const s = String(text ?? '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); out.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out.filter((r) => r.some((x) => x !== ''));
}

// Pure: report text (JSON array, JSON lines or CSV with a header) → list of records.
export function parseReport(text) {
  const t = String(text ?? '').trim();
  if (!t) return [];
  if (t.startsWith('[')) return JSON.parse(t);
  if (t.startsWith('{')) return t.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
  const [head, ...body] = parseCsv(t);
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i]])));
}

const normDay = (v) => {
  const s = String(v ?? '').trim();
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return us ? `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}` : s.slice(0, 10);
};

// Pure: sums adGroup records into one record per date + campaign (the v2 report has no campaign type).
export function byCampaignDay(records) {
  const acc = new Map();
  for (const x of records) {
    const date = normDay(x.date ?? x.Date);
    const campaign = String(x.campaignId ?? x['Campaign Id'] ?? '').trim();
    const k = `${date}|${campaign}`;
    const a = acc.get(k) ?? { date, campaignId: campaign, adSpend: 0, numAdsClicks: 0, attributedOrders14days: 0, attributedSales14days: 0 };
    a.adSpend += num(x.adSpend ?? x.spend);
    a.numAdsClicks += num(x.numAdsClicks ?? x.clicks);
    a.attributedOrders14days += num(x.attributedOrders14days ?? x.attributedOrders3days ?? x.orders);
    a.attributedSales14days += num(x.attributedSales14days ?? x.attributedSales3days ?? x.sales);
    acc.set(k, a);
  }
  return [...acc.values()];
}

// Pure: rows for one campaign-day record. Accepts the 14-day or 3-day attribution columns.
export function walmartRows(x) {
  const date = normDay(x.date ?? x.Date);
  const campaign = String(x.campaignId ?? x['Campaign Id'] ?? '').trim();
  const spend = round2(num(x.adSpend ?? x.spend));
  const sales = round2(num(x.attributedSales14days ?? x.attributedSales3days ?? x.sales));
  const rows = [
    { date, channel: 'walmart', campaign, metric: 'spend', value: spend },
    { date, channel: 'walmart', campaign, metric: 'clicks', value: num(x.numAdsClicks ?? x.clicks) },
    { date, channel: 'walmart', campaign, metric: 'conversions', value: num(x.attributedOrders14days ?? x.attributedOrders3days ?? x.orders) },
    { date, channel: 'walmart', campaign, metric: 'sales', value: sales },
  ];
  if (sales > 0) rows.push({ date, channel: 'walmart', campaign, metric: 'acos', value: round2((spend / sales) * 100) });
  return rows;
}

export const walmartConnectMetrics = defineReader({
  name: 'walmart-connect-metrics', kind: 'metrics', handles: 'daily spend, clicks, orders, sales and ACOS per Walmart Sponsored Search campaign (snapshot report, read-only)',
  needs: NEEDS,
  unverified: 'Snapshot v2 flow (POST api/v2/snapshot/report with reportType adGroup and reportMetrics, GET api/v2/snapshot?advertiserId&snapshotId → jobStatus/details URL, pre-signed download fetched without API headers) and metric names (adSpend, numAdsClicks, attributedOrders14days, attributedSales14days) follow the public partner docs; the download is parsed as gzip or plain JSON, JSON lines or CSV. Not tested against a live advertiser.',
  preview: (o, env) => `request a Walmart Sponsored Search campaign snapshot for advertiser ${env.WALMART_ADS_ADVERTISER_ID || '(WALMART_ADS_ADVERTISER_ID)'}, last ${o.days ?? 7} day(s), poll it and download it`,
  async read(ctx, opts) {
    const days = Math.min(Math.max(Number(opts.days ?? 7), 1), 90);
    const to = daysAgo(ctx.now ?? Date.now(), 1); // endDate cannot be today: data runs through yesterday
    const from = daysAgo(to, days - 1);
    const rawAdv = String(ctx.env.WALMART_ADS_ADVERTISER_ID).trim();
    if (!ID.test(rawAdv)) throw new Error('WALMART_ADS_ADVERTISER_ID must be the numeric advertiser id');
    const advertiserId = Number(rawAdv);
    const sub = await call(ctx, 'POST', 'api/v2/snapshot/report', { advertiserId, startDate: isoDay(from), endDate: isoDay(to), reportType: 'adGroup', reportMetrics: REPORT_METRICS });
    const snapshotId = sub.data?.snapshotId ?? (Array.isArray(sub.data) ? sub.data[0]?.snapshotId : undefined);
    if (!sub.ok || !snapshotId) throw new Error(fail(sub, sub.ctx, 'Walmart snapshot request'));
    const polls = Number(opts.polls ?? ctx.env.WALMART_ADS_REPORT_POLLS ?? 12); const every = Number(opts.pollMs ?? ctx.pollMs ?? 10000);
    let st = {};
    for (let i = 0; i < polls; i++) {
      if (i) await wait(ctx, every);
      const r = await call(ctx, 'GET', `api/v2/snapshot?${new URLSearchParams({ advertiserId: String(advertiserId), snapshotId: String(snapshotId) })}`);
      if (!r.ok) throw new Error(fail(r, r.ctx, 'Walmart snapshot status'));
      st = (Array.isArray(r.data) ? r.data[0] : r.data) ?? {};
      if (!PENDING.includes(String(st.jobStatus ?? '').toLowerCase())) break;
    }
    const status = String(st.jobStatus ?? 'unknown').toLowerCase();
    if (PENDING.includes(status)) throw new Error(`Walmart snapshot ${snapshotId} still ${status} after ${polls} poll(s); next cycle will retry`);
    const url = String(st.details ?? '');
    if (status !== 'done' || !/^https:\/\//.test(url)) throw new Error(`Walmart snapshot ${snapshotId} ended ${status}`);
    // The download URL is pre-signed: fetched without the signed API headers.
    const f = ctx.fetch ?? globalThis.fetch;
    const res = await f(url, { method: 'GET' });
    if (!res.ok) throw new Error(`Walmart snapshot download: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf[0] === 0x50 && buf[1] === 0x4b) throw new Error('Walmart snapshot is a zip archive; expected gzip, JSON or CSV');
    const records = parseReport((buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf).toString('utf8'));
    const rows = byCampaignDay(records.filter((x) => /^\d/.test(String(x.date ?? x.Date ?? '')))).flatMap(walmartRows);
    return { rows, detail: `${rows.filter((r) => r.metric === 'spend').length} campaign-day(s) from Walmart Connect` };
  },
});

export const readers = [walmartConnectMetrics];
export default walmartConnect;

// CLI: node tools/connectors/walmart-connect.mjs status | metrics [--days N] [--dry-run]
// Prints key NAMES that are missing and row counts / rows, never a secret value.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  loadEnv();
  const [cmd = 'status', ...rest] = process.argv.slice(2);
  const env = process.env;
  if (cmd === 'status') {
    console.log(JSON.stringify({ connector: walmartConnect.name, configured: walmartConnect.configured(env), missing: walmartConnect.missing(env), reader: walmartConnectMetrics.name, unverified: walmartConnect.unverified }, null, 2));
  } else if (cmd === 'metrics') {
    const di = rest.indexOf('--days');
    const r = await walmartConnectMetrics.read({ env, dryRun: rest.includes('--dry-run') }, { days: di > -1 ? Number(rest[di + 1]) : 7 });
    console.log(JSON.stringify({ ok: r.ok, dry_run: Boolean(r.dry_run), detail: redact(r.detail ?? '', env), rows: r.rows ?? [] }, null, 2));
    if (!r.ok) process.exit(1);
  } else { console.error('Usage: node tools/connectors/walmart-connect.mjs status | metrics [--days N] [--dry-run]'); process.exit(2); }
}
