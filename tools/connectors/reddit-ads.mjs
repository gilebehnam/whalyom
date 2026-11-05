// Reddit Ads through the Reddit Ads API v3 (https://ads-api.reddit.com/api/v3).
// An approved "spend" item with channel reddit/reddit_ads/reddit-ads creates a campaign, one ad
// group (daily budget, community and location targeting from the spec) and, when the spec
// references an existing post, one ad. Everything is created PAUSED unless the item says
// activate: true. tools/execute.mjs has already enforced free mode, the caps and the approval;
// loadSpec() re-checks spec daily_budget <= the approved amount.
// Needs REDDIT_ADS_ACCESS_TOKEN (OAuth bearer token with the ads scopes) and REDDIT_ADS_ACCOUNT_ID.
// Without them the opt-in CSV setup sheet (reddit-ads-csv in ads.mjs) is used instead.
//
// Spec fields used (JSON, the approval's "file"), on top of the shared ads spec:
//   "objective": "CLICKS", "ad_group": "…", "final_url": "https://…", "max_cpc": 1.5,
//   "audience": { "subreddits": ["r/smallbusiness"], "locations": ["US"], "interests": [] },
//   "post_id": "t3_abc123" (an existing promoted post; optional, no ad is created without it)
import { defineConnector, request, fail, missingKeys, redact } from './_http.mjs';
import { loadSpec, partialResult } from './ads.mjs';

export const API = 'https://ads-api.reddit.com/api/v3';
const CHANNELS = ['reddit', 'reddit_ads', 'reddit-ads'];
const NEEDS = ['REDDIT_ADS_ACCESS_TOKEN', 'REDDIT_ADS_ACCOUNT_ID'];
// Reddit asks every API client for a descriptive User-Agent.
const UA = 'whalyom-marketing-os/1.0';

const micros = (n) => Math.round(Number(n) * 1_000_000); // verify against current API docs (budgets and bids in microcurrency)
const headers = (env) => ({ authorization: `Bearer ${env.REDDIT_ADS_ACCESS_TOKEN}`, 'user-agent': UA });
const acct = (env) => encodeURIComponent(String(env.REDDIT_ADS_ACCOUNT_ID ?? '').trim());
const idOf = (r) => String(r.data?.data?.id ?? r.data?.id ?? '');

function targeting(s) {
  const a = s.audience ?? {};
  const t = s.targeting ?? {};
  const communities = [...(a.subreddits ?? []), ...(t.communities ?? [])].map((c) => String(c).trim().replace(/^\/?r\//i, '')).filter(Boolean);
  const geos = [...(a.locations ?? []), ...(t.geolocations ?? [])].map((g) => String(g).trim().toUpperCase()).filter(Boolean);
  if (!geos.length) return { error: 'Reddit spec needs audience.locations (ISO country codes)' };
  const bad = communities.filter((c) => !/^[A-Za-z0-9_]{2,21}$/.test(c));
  if (bad.length) return { error: `Reddit communities must be subreddit names (got ${bad.join(', ')})` };
  const interests = [...(a.interests ?? []), ...(t.interests ?? [])].map(String).filter(Boolean);
  // verify against current API docs (targeting keys: communities, geolocations, interests)
  return { targeting: { geolocations: geos, ...(communities.length ? { communities } : {}), ...(interests.length ? { interests } : {}) }, communities: communities.length, geos: geos.length };
}

async function post(ctx, resource, data) {
  const r = await request(ctx, { url: `${API}/ad_accounts/${acct(ctx.env)}/${resource}`, headers: headers(ctx.env), json: { data } });
  if (!r.ok) throw new Error(fail(r, ctx, `Reddit ${resource}`));
  const id = idOf(r);
  if (!id) throw new Error(`Reddit ${resource} returned no id`);
  return id;
}

// Pauses a Reddit campaign by id (used by the CPA kill-switch). A ref "ad_group:<id>" pauses an ad
// group; a ref "<campaign>/<adgroup>/<ad>" pauses its campaign. Pausing only ever reduces spend.
// opts.fetch is for tests; production uses globalThis.fetch.
export async function pause(ref, env = {}, dryRun = false, opts = {}) {
  const raw = String(ref ?? '');
  const level = /^ad_?group:/.test(raw) ? 'ad_groups' : 'campaigns';
  const id = raw.replace(/^(ad_?group|campaign):/, '').split('/')[0].trim();
  const label = level === 'ad_groups' ? 'ad group' : 'campaign';
  if (!id) return { ok: false, detail: 'no Reddit id to pause' };
  if (dryRun) return { ok: true, detail: `would pause Reddit ${label} ${id}` };
  const miss = missingKeys(env, NEEDS);
  if (miss.length) return { ok: false, detail: `missing ${miss.join(', ')}; cannot pause Reddit ${label} ${id}` };
  const ctx = { env, fetch: opts.fetch };
  try {
    // verify against current API docs (PATCH /campaigns/{id} with data.configured_status)
    const r = await request(ctx, { url: `${API}/${level}/${encodeURIComponent(id)}`, method: 'PATCH', headers: headers(env), json: { data: { configured_status: 'PAUSED' } } });
    return r.ok ? { ok: true, detail: `paused Reddit ${label} ${id}` } : { ok: false, detail: fail(r, ctx, 'Reddit pause') };
  } catch (e) { return { ok: false, detail: redact(e.message ?? e, env) }; }
}

export const redditAds = { ...defineConnector({
  name: 'reddit-ads',
  handles: 'type "spend" with channel "reddit": campaign, ad group and ad through the Reddit Ads API v3 (paused by default)',
  needs: NEEDS,
  unverified: 'Reddit Ads API v3 field names (objective, configured_status, goal_type/goal_value in microcurrency, bid_strategy, targeting.communities/geolocations, ads.post_id) follow the public reference but were not tested against a live ad account.',
  accepts: (item) => item.type === 'spend' && CHANNELS.includes(item.channel),
  prepare(item, ctx) {
    const s = loadSpec(item, ctx);
    const t = targeting(s);
    if (t.error) return { error: t.error };
    const postId = s.post_id ? String(s.post_id).trim() : '';
    if (postId && !/^t3_[a-z0-9]+$/i.test(postId)) return { error: 'post_id must be a Reddit post id like t3_abc123' };
    if (postId && !s.final_url) return { error: 'Reddit ad needs final_url' };
    const status = item.activate === true ? 'ACTIVE' : 'PAUSED';
    return { s, t, status, postId, preview: `create ${status} Reddit campaign "${s.name}" with an ad group at ${s.daily}/day in ${t.geos} location(s) and ${t.communities} communit${t.communities === 1 ? 'y' : 'ies'}${postId ? ' and 1 ad' : ' (no post_id in spec, no ad)'}` };
  },
  async send(p, item, ctx) {
    const { s, status } = p;
    const start = new Date(ctx.now ?? Date.now()).toISOString();
    const campaignId = await post(ctx, 'campaigns', {
      name: s.name, objective: String(s.objective ?? 'CLICKS').toUpperCase(), configured_status: status, // verify against current API docs
    });
    // A failure after the first create returns a partial result (no retry, see partialResult in ads.mjs).
    const created = [campaignId];
    let adGroupId = '', adId = '';
    try {
      adGroupId = await post(ctx, 'ad_groups', {
        campaign_id: campaignId, name: s.ad_group, configured_status: status, start_time: start,
        goal_type: 'DAILY_SPEND', goal_value: micros(s.daily), // verify against current API docs
        bid_strategy: s.max_cpc ? 'MANUAL_BIDDING' : 'MAXIMIZE_VOLUME', bid_type: 'CPC', ...(s.max_cpc ? { bid_value: micros(s.max_cpc) } : {}), // verify against current API docs
        targeting: p.t.targeting,
      });
      created.push(adGroupId);
      if (p.postId) {
        adId = await post(ctx, 'ads', { ad_group_id: adGroupId, name: `${s.name} · ad 1`, configured_status: status, post_id: p.postId, click_url: s.final_url }); // verify against current API docs
      }
    } catch (e) { return partialResult(e, created, status); }
    const ref = [campaignId, adGroupId, adId].filter(Boolean).join('/');
    return { ok: true, ref, detail: `${status} Reddit campaign ${campaignId}, ad group ${adGroupId}${adId ? `, ad ${adId}` : ''}, ${s.daily}/day`, committed_daily: status === 'ACTIVE' ? s.daily : 0 };
  },
}), pause };

export default redditAds;
