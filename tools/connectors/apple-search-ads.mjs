// Apple Search Ads through the Campaign Management API v5 (https://api.searchads.apple.com/api/v5).
// An approved "spend" item with channel apple/apple_search_ads/apple-search-ads creates a campaign
// (daily budget, countries or regions, the app's adamId), one ad group (default bid, Search Match
// off) and the spec's keywords with their match type. Everything is created PAUSED unless the item
// says activate: true. tools/execute.mjs has already enforced free mode, the caps and the approval;
// loadSpec() re-checks spec daily_budget <= the approved amount.
// Auth: OAuth 2 client credentials. The client secret is a JWT signed ES256 with the API private
// key (node:crypto, no dependencies), exchanged at appleid.apple.com for an access token.
// Needs APPLE_ADS_CLIENT_ID, APPLE_ADS_TEAM_ID, APPLE_ADS_KEY_ID, APPLE_ADS_PRIVATE_KEY (PEM; "\n"
// escapes allowed) and APPLE_ADS_ORG_ID.
//
// Spec fields used (JSON, the approval's "file"), on top of the shared ads spec:
//   "adam_id": 123456789, "currency": "USD", "countries": ["US"] (or audience.locations),
//   "default_bid": 1.5 (or "max_cpc"), "keywords": [{"text": "invoice app", "match": "exact", "bid": 2}]
import crypto from 'node:crypto';
import { defineConnector, request, fail, missingKeys, redact } from './_http.mjs';
import { loadSpec, partialResult } from './ads.mjs';

export const API = 'https://api.searchads.apple.com/api/v5';
export const TOKEN_URL = 'https://appleid.apple.com/auth/oauth2/token';
const CHANNELS = ['apple', 'apple_search_ads', 'apple-search-ads'];
const NEEDS = ['APPLE_ADS_CLIENT_ID', 'APPLE_ADS_TEAM_ID', 'APPLE_ADS_KEY_ID', 'APPLE_ADS_PRIVATE_KEY', 'APPLE_ADS_ORG_ID'];

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
export const pemOf = (s) => String(s ?? '').replace(/\\n/g, '\n').trim();

// The client secret: an ES256 JWT (header kid = key id; iss = team id; sub = client id).
// Apple allows up to 180 days of validity; a short one is enough because it is made per run.
export function clientSecret(env, { now = Date.now(), ttl = 3600 } = {}) {
  const iat = Math.floor(new Date(now).getTime() / 1000);
  const header = { alg: 'ES256', kid: env.APPLE_ADS_KEY_ID };
  const payload = { sub: env.APPLE_ADS_CLIENT_ID, aud: 'https://appleid.apple.com', iat, exp: iat + ttl, iss: env.APPLE_ADS_TEAM_ID };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = crypto.createSign('SHA256').update(data).sign({ key: pemOf(env.APPLE_ADS_PRIVATE_KEY), dsaEncoding: 'ieee-p1363' });
  return `${data}.${b64url(sig)}`;
}

// Exchanges the client secret for an access token. The token is added to the redaction list.
async function accessToken(ctx) {
  const r = await request(ctx, { url: TOKEN_URL, form: { grant_type: 'client_credentials', client_id: ctx.env.APPLE_ADS_CLIENT_ID, client_secret: clientSecret(ctx.env, { now: ctx.now ?? Date.now() }), scope: 'searchadsorg' } });
  if (!r.ok || !r.data?.access_token) throw new Error(fail(r, ctx, 'Apple token'));
  return r.data.access_token;
}

async function session(ctx) {
  const token = await accessToken(ctx);
  const env = { ...ctx.env, APPLE_ADS_ACCESS_TOKEN: token };
  const sctx = { ...ctx, env };
  const h = { authorization: `Bearer ${token}`, 'x-ap-context': `orgId=${ctx.env.APPLE_ADS_ORG_ID}` };
  const call = async (method, resource, json) => {
    const r = await request(sctx, { url: `${API}/${resource}`, method, headers: h, json });
    if (!r.ok) throw new Error(fail(r, sctx, `Apple ${resource}`));
    return r.data?.data ?? {};
  };
  return { call, env };
}

const MATCH = { exact: 'EXACT', broad: 'BROAD' }; // Apple has no phrase match; anything not exact becomes BROAD.

// Pauses an Apple Search Ads campaign by id (used by the CPA kill-switch). A ref
// "<campaign>/<ad group>" pauses its campaign. Pausing only ever reduces spend.
// opts.fetch is for tests; production uses globalThis.fetch.
export async function pause(ref, env = {}, dryRun = false, opts = {}) {
  const id = String(ref ?? '').replace(/^campaign:/, '').split('/')[0].trim();
  if (!id) return { ok: false, detail: 'no Apple Search Ads campaign id to pause' };
  if (dryRun) return { ok: true, detail: `would pause Apple Search Ads campaign ${id}` };
  const miss = missingKeys(env, NEEDS);
  if (miss.length) return { ok: false, detail: `missing ${miss.join(', ')}; cannot pause Apple Search Ads campaign ${id}` };
  let redactEnv = env;
  try {
    const s = await session({ env, fetch: opts.fetch, now: opts.now });
    redactEnv = s.env;
    await s.call('PUT', `campaigns/${encodeURIComponent(id)}`, { campaign: { status: 'PAUSED' } }); // verify against current API docs (v5 update body)
    return { ok: true, detail: `paused Apple Search Ads campaign ${id}` };
  } catch (e) { return { ok: false, detail: redact(e.message ?? e, redactEnv) }; }
}

export const appleSearchAds = { ...defineConnector({
  name: 'apple-search-ads',
  handles: 'type "spend" with channel "apple": campaign, ad group and keywords through the Apple Search Ads Campaign Management API v5 (paused by default)',
  needs: NEEDS,
  unverified: 'Campaign Management API v5 field names (dailyBudgetAmount, countriesOrRegions, supplySources, automatedKeywordsOptIn, targetingkeywords/bulk) follow the public reference but were not tested against a live org. The ES256 client-secret JWT is tested locally.',
  accepts: (item) => item.type === 'spend' && CHANNELS.includes(item.channel),
  prepare(item, ctx) {
    const s = loadSpec(item, ctx);
    const adamId = Number(s.adam_id ?? s.adamId);
    if (!(adamId > 0)) return { error: 'Apple Search Ads spec needs adam_id (the App Store app id)' };
    const countries = (s.countries ?? s.audience?.locations ?? []).map((c) => String(c).trim().toUpperCase()).filter(Boolean);
    if (!countries.length) return { error: 'Apple Search Ads spec needs countries (ISO codes)' };
    const bad = countries.filter((c) => !/^[A-Z]{2}$/.test(c));
    if (bad.length) return { error: `countries must be two-letter ISO codes (got ${bad.join(', ')})` };
    const bid = Number(s.default_bid ?? s.max_cpc);
    if (!(bid > 0)) return { error: 'Apple Search Ads spec needs default_bid (or max_cpc)' };
    if (bid > s.daily) return { error: `default_bid ${bid} must not exceed the daily budget ${s.daily}` };
    if (!s.keywords.length) return { error: 'Apple Search Ads spec needs keywords (Search Match is off)' };
    const currency = String(s.currency || 'USD').toUpperCase();
    const status = item.activate === true ? 'ENABLED' : 'PAUSED'; // verify against current API docs (campaign/ad group ENABLED|PAUSED, keyword ACTIVE|PAUSED)
    const kwStatus = item.activate === true ? 'ACTIVE' : 'PAUSED';
    return { s, adamId, countries, bid, currency, status, kwStatus, preview: `create ${status} Apple Search Ads campaign "${s.name}" at ${s.daily} ${currency}/day in ${countries.join(', ')} with 1 ad group (bid ${bid}, Search Match off) and ${s.keywords.length} keyword(s)` };
  },
  async send(p, item, ctx) {
    const { s, currency, status } = p;
    const { call } = await session(ctx);
    const money = (n) => ({ amount: String(Number(n).toFixed(2)), currency });
    const orgId = Number(ctx.env.APPLE_ADS_ORG_ID);
    const campaign = await call('POST', 'campaigns', {
      orgId, name: s.name, adamId: p.adamId, countriesOrRegions: p.countries,
      dailyBudgetAmount: money(s.daily),
      supplySources: ['APPSTORE_SEARCH_RESULTS'], adChannelType: 'SEARCH', billingEvent: 'TAPS', // verify against current API docs
      status,
    });
    const campaignId = String(campaign.id ?? '');
    if (!campaignId) throw new Error('Apple campaigns returned no id');
    // A failure after the first create returns a partial result (no retry, see partialResult in ads.mjs).
    const created = [campaignId];
    let adGroupId = '', keywords = [];
    try {
      const adGroup = await call('POST', `campaigns/${campaignId}/adgroups`, {
        name: s.ad_group, pricingModel: 'CPC', defaultBidAmount: money(p.bid),
        automatedKeywordsOptIn: false, // Search Match off
        startTime: new Date(ctx.now ?? Date.now()).toISOString().slice(0, 19) + '.000', // verify against current API docs (timestamp format)
        status,
      });
      adGroupId = String(adGroup.id ?? '');
      if (!adGroupId) throw new Error('Apple adgroups returned no id');
      created.push(adGroupId);
      keywords = p.s.keywords.map((k) => ({
        text: String(k.text), matchType: MATCH[String(k.match ?? '').toLowerCase()] ?? 'BROAD', status: p.kwStatus,
        ...(Number(k.bid) > 0 ? { bidAmount: money(Math.min(Number(k.bid), s.daily)) } : {}),
      }));
      await call('POST', `campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/bulk`, keywords); // verify against current API docs
    } catch (e) { return partialResult(e, created, status); }
    return { ok: true, ref: `${campaignId}/${adGroupId}`, detail: `${status} Apple Search Ads campaign ${campaignId}, ad group ${adGroupId}, ${keywords.length} keyword(s), ${s.daily} ${currency}/day`, committed_daily: status === 'ENABLED' ? s.daily : 0 };
  },
}), pause };

export default appleSearchAds;
