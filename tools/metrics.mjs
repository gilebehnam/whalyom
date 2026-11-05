// Metrics ingestion into products/<slug>/metrics/kpis.json (rows: {date, channel, metric, value, source}).
// Sources, all optional:
//   1. Files dropped in metrics/inbox/ (CSV with header date,channel,metric,value or a JSON array of rows):
//      owner exports from GA4/Search Console/ad platforms, or an n8n flow writing there.
//   2. Stripe revenue, when STRIPE_API_KEY (a restricted, read-only key) is set: daily revenue net of
//      refunds (disputed charges left out) and payment counts for the last 30 days, per currency. The
//      product's budget.currency is 'revenue'/'payments'; other currencies are 'revenue_<cur>'/'payments_<cur>'.
//   3. Ad-platform readers from connectors/readers.mjs (Google Ads, TikTok, LinkedIn, Microsoft Ads, Reddit Ads,
//      X Ads, Apple Search Ads) that are configured
//      in the env: daily spend / clicks / conversions per campaign, the rows the CPA kill-switch reads.
//      They are read-only and fail soft: a reader that errors is logged and the run continues.
//      Skip them with --no-readers or OM_METRICS_READERS=0; days with OM_METRICS_READER_DAYS (default 7).
// Rows are de-duplicated by source class+date+channel+campaign+metric (the newest value wins): browser-
// reported rows (client_* metrics, source satellite/edge) never overwrite server-side rows or the other
// way round. Never invents data.
// Usage: node tools/metrics.mjs <slug> [--no-readers]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, readJson, writeJson, root } from './lib/env.mjs';
import { googleAdsMetrics, tiktokAdsMetrics, linkedinAdsMetrics, microsoftAdsMetrics, redditAdsMetrics, xAdsMetrics, appleSearchAdsMetrics } from './connectors/readers.mjs';
import { amazonAdsMetrics } from './connectors/amazon-ads.mjs';
import { walmartConnectMetrics } from './connectors/walmart-connect.mjs';

// Ad readers whose rows carry a campaign id (stripe is pulled below, the site analytics readers stay in
// the MCP metrics_pull tool so their numbers are not counted twice).
// Retail media (Amazon Sponsored Products, Walmart Connect) rows use channel "amazon" / "walmart", so
// the kill switch and the budget see them like any other ad channel.
const ALL_READERS = [googleAdsMetrics, tiktokAdsMetrics, linkedinAdsMetrics, microsoftAdsMetrics, redditAdsMetrics, xAdsMetrics, appleSearchAdsMetrics, amazonAdsMetrics, walmartConnectMetrics];
export const AD_READERS = ALL_READERS.filter((r, i) => ALL_READERS.findIndex((x) => x.name === r.name) === i);

// Runs every configured ad reader. Returns {rows, results}; never throws (one failing reader does not
// stop the others). ctx: {env, fetch?, now?}; tests pass a mock fetch.
export async function pullAdRows(ctx, { days = 7, readers = AD_READERS, log = () => {} } = {}) {
  const rows = []; const results = [];
  for (const r of readers.filter((x) => x.configured(ctx.env ?? {}))) {
    let res;
    try { res = await r.read({ ...ctx, dryRun: false }, { days }); } catch (e) { res = { ok: false, rows: [], detail: String(e.message ?? e) }; }
    results.push({ source: r.name, ok: Boolean(res.ok), rows: res.rows?.length ?? 0, detail: res.detail });
    if (!res.ok) { log(`${r.name}: ${res.detail}`); continue; }
    for (const x of res.rows ?? []) if (x?.date && x.metric) rows.push({ ...x, source: r.name });
  }
  return { rows, results };
}

// Browser-reported rows can be forged by any visitor; the same rule as needs-you-know and learn.
export const clientSide = (r) => String(r.metric ?? '').startsWith('client_') || ['satellite', 'edge'].includes(r.source);
// Rows may carry a campaign (or ad variant) id, used by the CPA kill-switch and attribution.
export const keyOf = (r) => `${clientSide(r) ? 'client' : 'server'}|${r.date}|${r.channel ?? 'all'}|${r.campaign ?? ''}|${r.metric}`;

// Stripe amounts are in the smallest unit; these currencies have none below the main unit.
const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);
const STRIPE_METRIC = /^(revenue|payments)(_[a-z]{3})?$/;
const dayOf = (c) => new Date(c.created * 1000).toISOString().slice(0, 10);

// Pure: Stripe charges -> daily kpi rows, net of refunds, disputed charges skipped, one row set per
// day and currency. The base currency keeps the plain metric names the dashboard reads.
export function stripeChargeRows(charges, { baseCurrency = 'usd' } = {}) {
  const base = String(baseCurrency || 'usd').toLowerCase();
  const byDay = {};
  for (const c of charges ?? []) {
    if (c?.status !== 'succeeded' || c.refunded || c.disputed) continue;
    const net = Number(c.amount ?? 0) - Number(c.amount_refunded ?? 0);
    if (!(net > 0)) continue;
    const cur = String(c.currency || base).toLowerCase();
    const b = (byDay[`${dayOf(c)}|${cur}`] ??= { revenue: 0, payments: 0 });
    b.revenue += ZERO_DECIMAL.has(cur) ? net : net / 100;
    b.payments++;
  }
  const rows = [];
  for (const [k, v] of Object.entries(byDay)) {
    const [date, currency] = k.split('|'); const sfx = currency === base ? '' : `_${currency}`;
    rows.push({ date, channel: 'all', metric: `revenue${sfx}`, value: Math.round(v.revenue * 100) / 100, source: 'stripe', currency });
    rows.push({ date, channel: 'all', metric: `payments${sfx}`, value: v.payments, source: 'stripe', currency });
  }
  return rows;
}

// Pure: replaces the stripe rows of the fully covered days with fresh ones, so a day whose charges were
// all refunded later loses its old row. Covered: fromDay onward, or, when the pull was truncated, only
// the days after the oldest fetched one (that day and older keep their earlier, complete values).
export function mergeStripeRows(existing, charges, { fromDay, truncated = false, baseCurrency } = {}) {
  let start = fromDay; let inclusive = true;
  if (truncated) {
    const oldest = (charges ?? []).map(dayOf).sort()[0];
    if (!oldest) return { rows: [...existing], days: 0 };
    if (!start || oldest >= start) { start = oldest; inclusive = false; }
  }
  const covered = (d) => !start || (inclusive ? String(d) >= start : String(d) > start);
  const kept = existing.filter((r) => !(r.source === 'stripe' && STRIPE_METRIC.test(String(r.metric)) && covered(r.date)));
  const fresh = stripeChargeRows((charges ?? []).filter((c) => covered(dayOf(c))), { baseCurrency });
  return { rows: [...kept, ...fresh], days: new Set(fresh.map((r) => r.date)).size };
}

// Pulls the charges since a unix time (newest first, up to maxPages pages of 100) and merges them into
// existing rows. Never throws; an error leaves the rows untouched. Tests pass a mock fetch.
export async function stripeSync(existing, { key, since, fetch: f = fetch, baseCurrency, maxPages = 10 } = {}) {
  const errors = []; const charges = [];
  try {
    const first = `https://api.stripe.com/v1/charges?limit=100&created[gte]=${since}`;
    let url = first; let hasMore = false;
    for (let page = 0; page < maxPages && url; page++) {
      const res = await f(url, { headers: { authorization: `Bearer ${key}` } });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      charges.push(...(json.data ?? []));
      hasMore = Boolean(json.has_more) && (json.data ?? []).length > 0;
      url = hasMore ? `${first}&starting_after=${json.data.at(-1).id}` : null;
    }
    if (hasMore) errors.push(`stripe: truncated after ${maxPages} pages (${charges.length} charges); the oldest fetched day and older keep their earlier values`);
    const fromDay = new Date(since * 1000).toISOString().slice(0, 10);
    const { rows, days } = mergeStripeRows(existing, charges, { fromDay, truncated: hasMore, baseCurrency });
    return { rows, days, errors };
  } catch (e) { return { rows: [...existing], days: 0, errors: [...errors, `stripe: ${e.message}`] }; }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  loadEnv();
  const slug = process.argv[2];
  if (!slug) { console.error('Usage: node tools/metrics.mjs <slug>'); process.exit(2); }
  const dir = path.join(root, 'products', slug, 'metrics');
  const inbox = path.join(dir, 'inbox');
  fs.mkdirSync(path.join(inbox, 'done'), { recursive: true });
  const kpiFile = path.join(dir, 'kpis.json');
  // Keys are rebuilt on load, so rows written before the source class was part of the key migrate.
  const rows = new Map(readJson(kpiFile, []).map((r) => [keyOf(r), r]));
  const put = (r) => {
    if (!r.date || !r.metric || !Number.isFinite(Number(r.value))) return;
    const row = { date: r.date, channel: r.channel || 'all', metric: r.metric, value: Number(r.value), source: r.source ?? 'import' };
    if (r.campaign) row.campaign = r.campaign;
    if (r.currency) row.currency = r.currency;
    rows.set(keyOf(row), row);
  };
  const stats = { files: 0, rows_in: 0, stripe_days: 0, reader_rows: 0, readers: [], errors: [] };

  const parseCsv = (text) => {
    const [head, ...lines] = text.trim().split(/\r?\n/);
    const cols = head.split(',').map((c) => c.trim().toLowerCase());
    return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v.trim()])));
  };
  for (const f of fs.readdirSync(inbox).filter((x) => /\.(csv|json)$/i.test(x))) {
    try {
      const text = fs.readFileSync(path.join(inbox, f), 'utf8');
      const list = f.toLowerCase().endsWith('.csv') ? parseCsv(text) : (Array.isArray(JSON.parse(text)) ? JSON.parse(text) : JSON.parse(text).rows ?? []);
      for (const r of list) { put({ ...r, source: r.source ?? f }); stats.rows_in++; }
      fs.renameSync(path.join(inbox, f), path.join(inbox, 'done', `${Date.now()}-${f}`));
      stats.files++;
    } catch (e) { stats.errors.push(`${f}: ${e.message}`); }
  }

  if (process.env.STRIPE_API_KEY) {
    // From the start of the UTC day 30 days ago, so every day in the window is fully covered.
    const since = Math.floor(Date.parse(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)) / 1000);
    const baseCurrency = readJson(path.join(root, 'products', slug, 'product.json'), {})?.budget?.currency ?? 'usd';
    const res = await stripeSync([...rows.values()], { key: process.env.STRIPE_API_KEY, since, baseCurrency });
    rows.clear(); for (const r of res.rows) rows.set(keyOf(r), r);
    stats.stripe_days = res.days; stats.errors.push(...res.errors);
  }

  if (!process.argv.includes('--no-readers') && process.env.OM_METRICS_READERS !== '0') {
    const days = Math.min(Math.max(Number(process.env.OM_METRICS_READER_DAYS ?? 7) || 7, 1), 90);
    const { rows: adRows, results } = await pullAdRows({ env: process.env, now: new Date().toISOString() }, { days, log: (m) => { console.error(`metrics: ${m}`); stats.errors.push(m); } });
    for (const r of adRows) put(r);
    stats.reader_rows = adRows.length;
    stats.readers = results.map(({ source, ok, rows: n }) => ({ source, ok, rows: n }));
  }

  const out = [...rows.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  writeJson(kpiFile, out);
  console.log(JSON.stringify({ slug, kpi_rows: out.length, ...stats }));
}
