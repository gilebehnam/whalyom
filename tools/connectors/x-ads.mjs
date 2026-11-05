// X (Twitter) Ads through the X Ads API v12 (https://ads-api.x.com/12).
// An approved "spend" item with channel x_ads/x-ads/twitter_ads creates a campaign (daily budget,
// paid through the funding instrument in X_ADS_FUNDING_INSTRUMENT_ID), one line item (objective,
// placements) and its targeting criteria from the spec, plus promoted posts when the spec lists
// post ids. Everything is created with entity_status PAUSED unless the item says activate: true.
// Plain channel "x" is organic posting and stays with x.mjs.
// tools/execute.mjs has already enforced free mode, the caps and the approval; loadSpec() re-checks
// spec daily_budget <= the approved amount.
// Auth: OAuth 1.0a user context, signed here with HMAC-SHA1 (node:crypto, no dependencies):
//   X_ADS_CONSUMER_KEY, X_ADS_CONSUMER_SECRET, X_ADS_ACCESS_TOKEN, X_ADS_ACCESS_SECRET,
//   plus X_ADS_ACCOUNT_ID and X_ADS_FUNDING_INSTRUMENT_ID.
//
// Spec fields used (JSON, the approval's "file"), on top of the shared ads spec:
//   "objective": "WEBSITE_CLICKS", "placements": ["ALL_ON_TWITTER"], "max_cpc": 2,
//   "targeting": { "location_keys": ["96683cc9126741d1"] or "locations": ["US"], "keywords": ["invoicing"] },
//   "targeting_criteria": [{ "targeting_type": "INTEREST", "targeting_value": "…" }] (passed through),
//   "tweet_ids": ["1790000000000000000"] (existing posts to promote; optional)
import crypto from 'node:crypto';
import { defineConnector, request, fail, missingKeys, redact } from './_http.mjs';
import { loadSpec, partialResult } from './ads.mjs';

export const API = 'https://ads-api.x.com/12';
const CHANNELS = ['x_ads', 'x-ads', 'twitter_ads'];
const NEEDS = ['X_ADS_CONSUMER_KEY', 'X_ADS_CONSUMER_SECRET', 'X_ADS_ACCESS_TOKEN', 'X_ADS_ACCESS_SECRET', 'X_ADS_ACCOUNT_ID', 'X_ADS_FUNDING_INSTRUMENT_ID'];

// X location targeting uses location keys, not ISO codes. Only the US key is mapped here; every
// other market must give targeting.location_keys. verify against current API docs (GET targeting_criteria/locations).
const LOCATION_KEY = { US: '96683cc9126741d1' };

// RFC 3986 percent-encoding as OAuth 1.0a requires (encodeURIComponent leaves !'()* alone).
export const pct = (s) => encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// OAuth 1.0a signature (RFC 5849 §3.4). params: extra form-encoded body parameters, which are part
// of the signature base like the query string; a JSON body is not. Returns { signature, header, base }.
export function oauth1Sign(method, url, creds, { nonce = crypto.randomBytes(16).toString('hex'), timestamp = Math.floor(Date.now() / 1000), params = {} } = {}) {
  const u = new URL(url);
  const oauth = { oauth_consumer_key: creds.consumerKey, oauth_nonce: nonce, oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: String(timestamp), oauth_token: creds.token, oauth_version: '1.0' };
  const pairs = [...Object.entries(oauth), ...u.searchParams.entries(), ...Object.entries(params)]
    .map(([k, v]) => [pct(k), pct(v)])
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1));
  const base = [method.toUpperCase(), pct(`${u.protocol}//${u.host}`.toLowerCase() + u.pathname), pct(pairs.map(([k, v]) => `${k}=${v}`).join('&'))].join('&');
  const signature = crypto.createHmac('sha1', `${pct(creds.consumerSecret)}&${pct(creds.tokenSecret ?? '')}`).update(base).digest('base64');
  const header = 'OAuth ' + Object.entries({ ...oauth, oauth_signature: signature }).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(', ');
  return { signature, header, base };
}

const credsOf = (env) => ({ consumerKey: env.X_ADS_CONSUMER_KEY, consumerSecret: env.X_ADS_CONSUMER_SECRET, token: env.X_ADS_ACCESS_TOKEN, tokenSecret: env.X_ADS_ACCESS_SECRET });
const acct = (env) => encodeURIComponent(String(env.X_ADS_ACCOUNT_ID ?? '').trim());
const micros = (n) => String(Math.round(Number(n) * 1_000_000)); // *_local_micro: account currency × 1e6

// One signed call. Parameters go in the query string (part of the signature), as the Ads API
// accepts for create/update endpoints. verify against current API docs (some v12 endpoints take JSON bodies).
async function call(ctx, method, resource, params = {}) {
  const u = new URL(`${API}/accounts/${acct(ctx.env)}/${resource}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
  const { header } = oauth1Sign(method, u.toString(), credsOf(ctx.env), ctx.oauth ?? {});
  const r = await request(ctx, { url: u.toString(), method, headers: { authorization: header } });
  if (!r.ok) throw new Error(fail(r, ctx, `X Ads ${resource}`));
  return r.data?.data ?? {};
}

function criteria(s) {
  const t = s.targeting ?? s.audience ?? {};
  const out = [];
  const keys = [...(t.location_keys ?? [])].map(String);
  const unknown = [];
  for (const c of t.locations ?? []) {
    const k = LOCATION_KEY[String(c).toUpperCase()];
    if (k) keys.push(k); else if (/^[0-9a-f]{16}$/i.test(String(c))) keys.push(String(c)); else unknown.push(c);
  }
  if (unknown.length) return { error: `no X location key known for ${unknown.join(', ')}; give targeting.location_keys` };
  for (const k of keys) out.push({ targeting_type: 'LOCATION', targeting_value: k });
  for (const kw of t.keywords ?? []) out.push({ targeting_type: 'BROAD_KEYWORD', targeting_value: String(kw) }); // verify against current API docs
  for (const c of s.targeting_criteria ?? []) {
    if (!c?.targeting_type || c.targeting_value === undefined) return { error: 'targeting_criteria entries need targeting_type and targeting_value' };
    out.push({ targeting_type: String(c.targeting_type).toUpperCase(), targeting_value: String(c.targeting_value) });
  }
  if (!out.some((c) => c.targeting_type === 'LOCATION')) return { error: 'X Ads spec needs a location (targeting.location_keys or targeting.locations)' };
  return { list: out };
}

// Pauses an X Ads campaign by id (used by the CPA kill-switch). A ref "line_item:<id>" pauses a
// line item; a ref "<campaign>/<line item>" pauses its campaign. Pausing only ever reduces spend.
// opts.fetch is for tests; production uses globalThis.fetch.
export async function pause(ref, env = {}, dryRun = false, opts = {}) {
  const raw = String(ref ?? '');
  const lineItem = raw.startsWith('line_item:');
  const id = raw.replace(/^(line_item|campaign):/, '').split('/')[0].trim();
  const label = lineItem ? 'line item' : 'campaign';
  if (!id) return { ok: false, detail: 'no X Ads id to pause' };
  if (dryRun) return { ok: true, detail: `would pause X Ads ${label} ${id}` };
  const miss = missingKeys(env, NEEDS.filter((k) => k !== 'X_ADS_FUNDING_INSTRUMENT_ID'));
  if (miss.length) return { ok: false, detail: `missing ${miss.join(', ')}; cannot pause X Ads ${label} ${id}` };
  const ctx = { env, fetch: opts.fetch, oauth: opts.oauth };
  try {
    await call(ctx, 'PUT', `${lineItem ? 'line_items' : 'campaigns'}/${encodeURIComponent(id)}`, { entity_status: 'PAUSED' });
    return { ok: true, detail: `paused X Ads ${label} ${id}` };
  } catch (e) { return { ok: false, detail: redact(e.message ?? e, env) }; }
}

export const xAds = { ...defineConnector({
  name: 'x-ads',
  handles: 'type "spend" with channel "x_ads": campaign, line item, targeting and promoted posts through the X Ads API v12 (paused by default; channel "x" stays organic)',
  needs: NEEDS,
  unverified: 'X Ads API v12 parameter names (daily_budget_amount_local_micro, objective, placements, product_type, bid_strategy, targeting types) follow the public reference but were not tested against a live ads account. OAuth 1.0a signing is tested against the published worked example.',
  accepts: (item) => item.type === 'spend' && CHANNELS.includes(item.channel),
  prepare(item, ctx) {
    const s = loadSpec(item, ctx);
    const c = criteria(s);
    if (c.error) return { error: c.error };
    const tweets = (s.tweet_ids ?? []).map(String);
    const bad = tweets.filter((t) => !/^\d+$/.test(t));
    if (bad.length) return { error: `tweet_ids must be numeric post ids (got ${bad.join(', ')})` };
    const status = item.activate === true ? 'ACTIVE' : 'PAUSED';
    return { s, criteria: c.list, tweets, status, preview: `create ${status} X Ads campaign "${s.name}" at ${s.daily}/day with 1 line item, ${c.list.length} targeting criteri${c.list.length === 1 ? 'on' : 'a'}${tweets.length ? ` and ${tweets.length} promoted post(s)` : ''}` };
  },
  async send(p, item, ctx) {
    const { s, status } = p;
    const start = new Date(ctx.now ?? Date.now()).toISOString();
    const campaign = await call(ctx, 'POST', 'campaigns', {
      name: s.name, funding_instrument_id: ctx.env.X_ADS_FUNDING_INSTRUMENT_ID, entity_status: status,
      daily_budget_amount_local_micro: micros(s.daily), // verify against current API docs
    });
    const campaignId = String(campaign.id ?? '');
    if (!campaignId) throw new Error('X Ads campaigns returned no id');
    // A failure after the first create returns a partial result (no retry, see partialResult in ads.mjs).
    const created = [campaignId];
    let lineId = '';
    try {
      const line = await call(ctx, 'POST', 'line_items', {
        campaign_id: campaignId, name: s.ad_group, entity_status: status, start_time: start,
        objective: String(s.objective ?? 'WEBSITE_CLICKS').toUpperCase(), product_type: 'PROMOTED_TWEETS',
        placements: s.placements ?? ['ALL_ON_TWITTER'],
        bid_strategy: s.max_cpc ? 'MAX' : 'AUTO', ...(s.max_cpc ? { bid_amount_local_micro: micros(s.max_cpc) } : {}), // verify against current API docs
      });
      lineId = String(line.id ?? '');
      if (!lineId) throw new Error('X Ads line_items returned no id');
      created.push(lineId);
      for (const c of p.criteria) await call(ctx, 'POST', 'targeting_criteria', { line_item_id: lineId, ...c });
      if (p.tweets.length) await call(ctx, 'POST', 'promoted_tweets', { line_item_id: lineId, tweet_ids: p.tweets });
    } catch (e) { return partialResult(e, created, status); }
    return { ok: true, ref: `${campaignId}/${lineId}`, detail: `${status} X Ads campaign ${campaignId}, line item ${lineId}, ${p.criteria.length} targeting criteria${p.tweets.length ? `, ${p.tweets.length} promoted post(s)` : ''}, ${s.daily}/day`, committed_daily: status === 'ACTIVE' ? s.daily : 0 };
  },
}), pause };

export default xAds;
