// Search and social ads: Google Ads and Microsoft Advertising through their APIs when keys are
// present; otherwise (opt-in with OM_ADS_CSV_EXPORT=1) bulk-import CSVs for Google Ads Editor,
// Microsoft Advertising Editor, and setup sheets for TikTok Ads and Reddit Ads.
// All accept approval type "spend" on their channel. tools/execute.mjs has already enforced free
// mode, the daily and monthly caps and the approval before any of these runs; each connector
// re-checks the spec budget against the approved amount (like meta-ads). Everything is created
// PAUSED unless the approval says activate: true. A CSV export spends nothing.
//
// Spec file (JSON, the approval's "file"):
//   { "name": "Search · core", "daily_budget": 10, "max_cpc": 1.2, "final_url": "https://…",
//     "keywords": [{"text": "invoice app", "match": "phrase"}], "negatives": ["free"],
//     "ad_group": "Core", "ads": [{"headlines": ["…" x3-15], "descriptions": ["…" x2-4], "path1": "", "path2": ""}],
//     "audience": {"locations": ["US"], "age": "25-54", "subreddits": ["r/smallbusiness"]}, "text": "social ad copy", "cta": "Learn more" }
import fs from 'node:fs';
import path from 'node:path';
import { defineConnector, request, fail, toCsv, redact } from './_http.mjs';
import { googleMissing, googleToken, GOOGLE_ADS_API_VERSION } from './google-auth.mjs';

const CHANNELS = { google: ['google', 'google_ads', 'google-ads'], microsoft: ['microsoft', 'microsoft_ads', 'microsoft-ads', 'bing'], tiktok: ['tiktok', 'tiktok_ads', 'tiktok-ads'], reddit: ['reddit', 'reddit_ads', 'reddit-ads'] };
const isSpend = (item, platform) => item.type === 'spend' && CHANNELS[platform].includes(item.channel);

export function loadSpec(item, ctx) {
  if (!item.file) throw new Error('spend item needs a JSON spec file');
  const spec = JSON.parse(fs.readFileSync(path.join(ctx.dir, item.file), 'utf8'));
  const daily = Number(spec.daily_budget);
  if (!(daily > 0) || daily > Number(item.amount)) throw new Error(`spec daily_budget ${daily} must be > 0 and <= approved amount ${item.amount}`);
  const ads = (spec.ads ?? []).map((a) => ({ headlines: (a.headlines ?? []).map(String), descriptions: (a.descriptions ?? []).map(String), path1: a.path1 ?? '', path2: a.path2 ?? '' }));
  return { ...spec, daily, name: spec.name || item.title || item.id, keywords: (spec.keywords ?? []).map((k) => (typeof k === 'string' ? { text: k, match: 'phrase' } : k)), negatives: spec.negatives ?? [], ads, ad_group: spec.ad_group || 'Ad group 1' };
}

// Responsive search ad limits shared by Google and Microsoft.
export function rsaErrors(ads) {
  const errs = [];
  ads.forEach((a, i) => {
    if (a.headlines.length < 3 || a.headlines.length > 15) errs.push(`ad ${i + 1}: needs 3-15 headlines`);
    if (a.descriptions.length < 2 || a.descriptions.length > 4) errs.push(`ad ${i + 1}: needs 2-4 descriptions`);
    a.headlines.forEach((h) => h.length > 30 && errs.push(`ad ${i + 1}: headline over 30 chars: "${h}"`));
    a.descriptions.forEach((d) => d.length > 90 && errs.push(`ad ${i + 1}: description over 90 chars`));
  });
  return errs;
}

const MATCH = { exact: 'EXACT', phrase: 'PHRASE', broad: 'BROAD' };

// Result of a multi-step create that failed after its first resource: ok:false and partial:true, so
// tools/execute.mjs marks the item failed at once (no retry), keeping ref for the owner to resume or clean up.
// ref defaults to the created ids joined by '/'; Google passes the campaign resource name (its success ref).
export const partialResult = (e, created, status, ref = created.join('/')) => ({ ok: false, partial: true, ref, detail: `${e?.message ?? e}; already created (${String(status).toLowerCase()}): ${created.join(', ')}` });

// ── Google Ads API (REST) ──
export const googleAds = defineConnector({
  name: 'google-ads',
  handles: 'type "spend" with channel "google": budget, campaign, ad group, keywords and RSAs through the Google Ads API (paused by default)',
  needs: ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_ACCESS_TOKEN or GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN'],
  required: (env) => [...['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID'].filter((k) => !env[k]), ...googleMissing(env)],
  unverified: `API version defaults to ${GOOGLE_ADS_API_VERSION} (set GOOGLE_ADS_API_VERSION); field names follow the REST reference. Test against a test account first.`,
  accepts: (item) => isSpend(item, 'google'),
  prepare(item, ctx) {
    const s = loadSpec(item, ctx);
    const errs = rsaErrors(s.ads);
    if (!s.final_url && s.ads.length) errs.push('spec needs final_url for its ads');
    if (errs.length) return { error: errs.join('; ') };
    const status = item.activate === true ? 'ENABLED' : 'PAUSED';
    return { s, status, preview: `create ${status} Google Ads campaign "${s.name}" at ${s.daily}/day with ${s.keywords.length} keyword(s) and ${s.ads.length} ad(s)` };
  },
  async send(p, item, ctx) {
    const { s, status } = p;
    const cid = String(ctx.env.GOOGLE_ADS_CUSTOMER_ID).replace(/\D/g, '');
    const base = `https://googleads.googleapis.com/${ctx.env.GOOGLE_ADS_API_VERSION || GOOGLE_ADS_API_VERSION}/customers/${cid}`;
    const headers = { authorization: `Bearer ${await googleToken(ctx)}`, 'developer-token': ctx.env.GOOGLE_ADS_DEVELOPER_TOKEN };
    if (ctx.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) headers['login-customer-id'] = String(ctx.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID).replace(/\D/g, '');
    const mutate = async (resource, operations) => {
      const r = await request(ctx, { url: `${base}/${resource}:mutate`, headers, json: { operations } });
      if (!r.ok) throw new Error(fail(r, ctx, `Google Ads ${resource}`));
      return (r.data?.results ?? []).map((x) => x.resourceName);
    };
    // Each mutate is its own call, so a later failure leaves the earlier resources in the account.
    // Then the result is partial (no retry: a retry would duplicate them) and lists what exists.
    // Nothing can serve yet at that point, since ads are created last.
    const created = [];
    const [budget] = await mutate('campaignBudgets', [{ create: { name: `${s.name} · budget · ${item.id}`, amountMicros: String(Math.round(s.daily * 1e6)), deliveryMethod: 'STANDARD', explicitlyShared: false } }]);
    created.push(budget);
    let campaign;
    try {
      // Campaign names must be unique in the account; the item id keeps two specs with one name apart.
      [campaign] = await mutate('campaigns', [{ create: { name: `${s.name} · ${item.id}`, status, advertisingChannelType: 'SEARCH', campaignBudget: budget, manualCpc: {},
        networkSettings: { targetGoogleSearch: true, targetSearchNetwork: true, targetContentNetwork: false, targetPartnerSearchNetwork: false },
        containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING' } }]);
      created.push(campaign);
      const [adGroup] = await mutate('adGroups', [{ create: { name: s.ad_group, campaign, status: 'ENABLED', type: 'SEARCH_STANDARD', ...(s.max_cpc ? { cpcBidMicros: String(Math.round(Number(s.max_cpc) * 1e6)) } : {}) } }]);
      created.push(adGroup);
      if (s.keywords.length) await mutate('adGroupCriteria', s.keywords.map((k) => ({ create: { adGroup, status: 'ENABLED', keyword: { text: k.text, matchType: MATCH[k.match] ?? 'PHRASE' } } })));
      if (s.negatives.length) await mutate('campaignCriteria', s.negatives.map((n) => ({ create: { campaign, negative: true, keyword: { text: n, matchType: 'PHRASE' } } })));
      if (s.ads.length) await mutate('adGroupAds', s.ads.map((a) => ({ create: { adGroup, status: 'ENABLED', ad: { finalUrls: [s.final_url], responsiveSearchAd: { headlines: a.headlines.map((text) => ({ text })), descriptions: a.descriptions.map((text) => ({ text })), ...(a.path1 ? { path1: a.path1 } : {}), ...(a.path2 ? { path2: a.path2 } : {}) } } } })));
    } catch (e) { return partialResult(e, created, status, campaign ?? budget); }
    return { ok: true, ref: campaign, detail: `${status} Google Ads campaign ${campaign} at ${s.daily}/day`, committed_daily: status === 'ENABLED' ? s.daily : 0 };
  },
});

// Pauses a Google Ads campaign (used by the CPA kill-switch). ref is the campaign resource name
// ("customers/123/campaigns/456") or its numeric id. Pausing only ever reduces spend.
export async function pauseGoogle(ref, env = {}, dryRun = false, opts = {}) {
  const ctx = { env, fetch: opts.fetch };
  const missing = [...['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID'].filter((k) => !env[k]), ...googleMissing(env)];
  const cid = String(env.GOOGLE_ADS_CUSTOMER_ID ?? '').replace(/\D/g, '');
  const resourceName = /^customers\//.test(String(ref)) ? String(ref) : `customers/${cid}/campaigns/${String(ref).replace(/\D/g, '')}`;
  if (dryRun) return { ok: true, detail: `would pause ${resourceName}` };
  if (missing.length) return { ok: false, detail: `Google Ads keys missing: ${missing.join(', ')}` };
  try {
    const headers = { authorization: `Bearer ${await googleToken(ctx)}`, 'developer-token': env.GOOGLE_ADS_DEVELOPER_TOKEN };
    if (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) headers['login-customer-id'] = String(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID).replace(/\D/g, '');
    const r = await request(ctx, { url: `https://googleads.googleapis.com/${env.GOOGLE_ADS_API_VERSION || GOOGLE_ADS_API_VERSION}/customers/${cid}/campaigns:mutate`, headers, json: { operations: [{ update: { resourceName, status: 'PAUSED' }, updateMask: 'status' }] } });
    return r.ok ? { ok: true, detail: `paused ${resourceName}` } : { ok: false, detail: fail(r, ctx, 'Google Ads pause') };
  } catch (e) { return { ok: false, detail: redact(String(e.message ?? e), env) }; }
}
googleAds.pause = pauseGoogle;

// ── Microsoft Advertising (Campaign Management v13, JSON) ──
export const microsoftAds = defineConnector({
  name: 'microsoft-ads',
  handles: 'type "spend" with channel "microsoft": a paused search campaign through the Microsoft Advertising API',
  needs: ['MSADS_DEVELOPER_TOKEN', 'MSADS_ACCESS_TOKEN', 'MSADS_CUSTOMER_ID', 'MSADS_ACCOUNT_ID'],
  unverified: 'UNVERIFIED: the JSON endpoint path for Campaign Management v13 (MSADS_REST_BASE) was not checked against a live account. Prefer the CSV export (OM_ADS_CSV_EXPORT=1) until tested.',
  accepts: (item) => isSpend(item, 'microsoft'),
  prepare(item, ctx) {
    const s = loadSpec(item, ctx);
    const status = item.activate === true ? 'Active' : 'Paused';
    return { s, status, preview: `create ${status} Microsoft Ads campaign "${s.name}" at ${s.daily}/day` };
  },
  async send(p, item, ctx) {
    const base = (ctx.env.MSADS_REST_BASE || 'https://campaign.api.bingads.microsoft.com/CampaignManagement/v13').replace(/\/$/, '');
    const r = await request(ctx, { url: `${base}/Campaigns`, headers: { authorization: `Bearer ${ctx.env.MSADS_ACCESS_TOKEN}`, DeveloperToken: ctx.env.MSADS_DEVELOPER_TOKEN, CustomerId: String(ctx.env.MSADS_CUSTOMER_ID), CustomerAccountId: String(ctx.env.MSADS_ACCOUNT_ID) },
      json: { AccountId: Number(ctx.env.MSADS_ACCOUNT_ID), Campaigns: [{ Name: p.s.name, BudgetType: 'DailyBudgetStandard', DailyBudget: p.s.daily, Status: p.status, CampaignType: 'Search', TimeZone: ctx.env.MSADS_TIMEZONE || 'GreenwichMeanTimeDublinEdinburghLisbonLondon' }] } });
    if (!r.ok || r.data?.PartialErrors?.length) return { ok: false, detail: r.data?.PartialErrors?.length ? `Microsoft Ads: ${JSON.stringify(r.data.PartialErrors).slice(0, 200)}` : fail(r, ctx, 'Microsoft Ads') };
    const id = r.data?.CampaignIds?.[0] ?? '';
    return { ok: true, ref: String(id), detail: `${p.status} Microsoft Ads campaign ${id} at ${p.s.daily}/day`, committed_daily: p.status === 'Active' ? p.s.daily : 0 };
  },
});

// ── CSV exporters (opt-in: OM_ADS_CSV_EXPORT=1). Registered after the webhook connector, so an
// automation-platform webhook (the existing route) always wins when one is configured. ──
const csvOn = (env) => ['1', 'true', 'on', 'yes'].includes(String(env.OM_ADS_CSV_EXPORT ?? '').toLowerCase());

function exporter({ name, platform, label, header, rows, note, unverified }) {
  return defineConnector({
    name, unverified,
    handles: `type "spend" with channel "${platform}": writes ${label} to outbox/exports/ (spends nothing)`,
    needs: ['OM_ADS_CSV_EXPORT=1'],
    required: (env) => (csvOn(env) ? [] : ['OM_ADS_CSV_EXPORT=1']),
    accepts: (item) => isSpend(item, platform),
    prepare(item, ctx) {
      const s = loadSpec(item, ctx);
      const status = item.activate === true ? 'active' : 'paused';
      const rel = path.posix.join('outbox', 'exports', `${item.id}-${platform}.csv`);
      return { s, rel, csv: toCsv(header, rows(s, status)), preview: `export ${label} for "${s.name}" (${s.daily}/day) to ${rel}` };
    },
    async send(p, item, ctx) {
      const file = path.join(ctx.dir, p.rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, p.csv);
      return { ok: true, ref: p.rel, detail: `${label} written to ${p.rel}. ${note} Whalyom spent nothing; record real spend with tools/budget.mjs --record.`, committed_daily: 0 };
    },
  });
}

const H = (n, prefix) => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`);
const MATCH_LABEL = { exact: 'Exact', phrase: 'Phrase', broad: 'Broad' };

export const googleAdsCsv = exporter({
  name: 'google-ads-csv', platform: 'google', label: 'a Google Ads Editor import CSV',
  note: 'Import it in Google Ads Editor (Account > Import > From file), review, then post.',
  unverified: 'Column names follow Google Ads Editor import conventions; Editor maps unknown columns interactively.',
  header: ['Campaign', 'Campaign Type', 'Campaign Status', 'Budget', 'Budget type', 'Networks', 'Ad Group', 'Ad Group Status', 'Max CPC', 'Keyword', 'Criterion Type', ...H(15, 'Headline'), ...H(4, 'Description'), 'Final URL', 'Path 1', 'Path 2', 'Status'],
  rows: (s, st) => {
    const status = st === 'active' ? 'Enabled' : 'Paused';
    const out = [{ Campaign: s.name, 'Campaign Type': 'Search', 'Campaign Status': status, Budget: s.daily, 'Budget type': 'Daily', Networks: 'Google search;Search Partners' }];
    out.push({ Campaign: s.name, 'Ad Group': s.ad_group, 'Ad Group Status': 'Enabled', 'Max CPC': s.max_cpc ?? '' });
    for (const k of s.keywords) out.push({ Campaign: s.name, 'Ad Group': s.ad_group, Keyword: k.text, 'Criterion Type': MATCH_LABEL[k.match] ?? 'Phrase', Status: 'Enabled' });
    for (const n of s.negatives) out.push({ Campaign: s.name, Keyword: n, 'Criterion Type': 'Campaign Negative Phrase', Status: 'Enabled' });
    for (const a of s.ads) {
      const r = { Campaign: s.name, 'Ad Group': s.ad_group, 'Final URL': s.final_url ?? '', 'Path 1': a.path1, 'Path 2': a.path2, Status: 'Enabled' };
      a.headlines.slice(0, 15).forEach((h, i) => { r[`Headline ${i + 1}`] = h; });
      a.descriptions.slice(0, 4).forEach((d, i) => { r[`Description ${i + 1}`] = d; });
      out.push(r);
    }
    return out;
  },
});

export const microsoftAdsCsv = exporter({
  name: 'microsoft-ads-csv', platform: 'microsoft', label: 'a Microsoft Advertising bulk CSV',
  note: 'Import it in Microsoft Advertising Editor (Import > Import from file) or Bulk upload, review, then post.',
  unverified: 'UNVERIFIED: bulk file columns (Format Version 6.0) from public docs; Microsoft Editor can also import the Google Ads Editor CSV.',
  header: ['Type', 'Status', 'Id', 'Parent Id', 'Campaign', 'Ad Group', 'Name', 'Budget', 'Budget Type', 'Campaign Type', 'Keyword', 'Match Type', 'Bid', 'Final Url', 'Headlines', 'Descriptions', 'Path 1', 'Path 2'],
  rows: (s, st) => {
    const status = st === 'active' ? 'Active' : 'Paused';
    const out = [{ Type: 'Format Version', Name: '6.0' }, { Type: 'Campaign', Status: status, Id: -1, Campaign: s.name, Budget: s.daily, 'Budget Type': 'DailyBudgetStandard', 'Campaign Type': 'Search' },
      { Type: 'Ad Group', Status: 'Active', Id: -2, 'Parent Id': -1, Campaign: s.name, 'Ad Group': s.ad_group, Bid: s.max_cpc ?? '' }];
    for (const k of s.keywords) out.push({ Type: 'Keyword', Status: 'Active', 'Parent Id': -2, Campaign: s.name, 'Ad Group': s.ad_group, Keyword: k.text, 'Match Type': MATCH_LABEL[k.match] ?? 'Phrase', Bid: s.max_cpc ?? '' });
    for (const n of s.negatives) out.push({ Type: 'Campaign Negative Keyword', Status: 'Active', 'Parent Id': -1, Campaign: s.name, Keyword: n, 'Match Type': 'Phrase' });
    for (const a of s.ads) out.push({ Type: 'Responsive Search Ad', Status: 'Active', 'Parent Id': -2, Campaign: s.name, 'Ad Group': s.ad_group, 'Final Url': s.final_url ?? '', Headlines: JSON.stringify(a.headlines.map((text) => ({ text }))), Descriptions: JSON.stringify(a.descriptions.map((text) => ({ text }))), 'Path 1': a.path1, 'Path 2': a.path2 });
    return out;
  },
});

export const tiktokAdsCsv = exporter({
  name: 'tiktok-ads-csv', platform: 'tiktok', label: 'a TikTok Ads setup sheet (CSV)',
  note: 'Copy it into TikTok Ads Manager (or its bulk-import template), attach the creative files, review, then publish.',
  unverified: 'UNVERIFIED: TikTok\'s bulk template changes often; this sheet uses its field names but may need column mapping.',
  header: ['Campaign Name', 'Objective', 'Campaign Status', 'Ad Group Name', 'Placement', 'Location', 'Age', 'Budget Mode', 'Budget', 'Optimization Goal', 'Bid Strategy', 'Ad Name', 'Ad Text', 'Call to Action', 'Landing Page URL', 'Creative File'],
  rows: (s, st) => [{ 'Campaign Name': s.name, Objective: s.objective ?? 'Traffic', 'Campaign Status': st === 'active' ? 'Enable' : 'Disable', 'Ad Group Name': s.ad_group, Placement: 'TikTok', Location: (s.audience?.locations ?? []).join(';'), Age: s.audience?.age ?? '', 'Budget Mode': 'Daily', Budget: s.daily, 'Optimization Goal': s.optimization_goal ?? 'Click', 'Bid Strategy': 'Lowest cost', 'Ad Name': `${s.name} · ad 1`, 'Ad Text': s.text ?? '', 'Call to Action': s.cta ?? 'Learn more', 'Landing Page URL': s.final_url ?? '', 'Creative File': s.creative ?? '' }],
});

export const redditAdsCsv = exporter({
  name: 'reddit-ads-csv', platform: 'reddit', label: 'a Reddit Ads setup sheet (CSV)',
  note: 'Reddit Ads has no general CSV import: use the sheet to build the campaign in ads.reddit.com, review, then launch.',
  unverified: 'Reddit Ads offers no documented bulk CSV import; this is a setup sheet for manual entry.',
  header: ['Campaign Name', 'Objective', 'Status', 'Ad Group Name', 'Daily Budget', 'Communities', 'Interests', 'Locations', 'Bid Strategy', 'Ad Name', 'Headline', 'Destination URL', 'Call To Action'],
  rows: (s, st) => [{ 'Campaign Name': s.name, Objective: s.objective ?? 'Traffic', Status: st === 'active' ? 'Active' : 'Paused', 'Ad Group Name': s.ad_group, 'Daily Budget': s.daily, Communities: (s.audience?.subreddits ?? []).join(';'), Interests: (s.audience?.interests ?? []).join(';'), Locations: (s.audience?.locations ?? []).join(';'), 'Bid Strategy': 'Lowest cost', 'Ad Name': `${s.name} · ad 1`, Headline: s.text ?? s.ads?.[0]?.headlines?.[0] ?? '', 'Destination URL': s.final_url ?? '', 'Call To Action': s.cta ?? 'Learn More' }],
});

export const apiConnectors = [googleAds, microsoftAds];
export const csvExporters = [googleAdsCsv, microsoftAdsCsv, tiktokAdsCsv, redditAdsCsv];
export default [...apiConnectors, ...csvExporters];
