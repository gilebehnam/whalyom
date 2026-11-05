// TikTok Ads through the TikTok Marketing API (Business API v1.3).
// An approved "spend" item with channel tiktok/tiktok_ads/tiktok-ads creates a campaign, one ad
// group (daily budget, placements, location targeting from the spec) and, when the spec gives a
// creative, one ad. Everything is created with operation_status DISABLE unless the item says
// activate: true. tools/execute.mjs has already enforced free mode, the caps and the approval;
// loadSpec() re-checks spec daily_budget <= the approved amount.
// Needs TIKTOK_ACCESS_TOKEN (sent as the Access-Token header) and TIKTOK_ADVERTISER_ID.
// Without them the opt-in CSV setup sheet (tiktok-ads-csv in ads.mjs) is used instead.
//
// Spec fields used (JSON, the approval's "file"), on top of the shared ads spec:
//   "objective": "Traffic", "ad_group": "…", "final_url": "https://…", "text": "ad text", "cta": "Learn more",
//   "audience": { "location_ids": [6252001] or "locations": ["US"], "age_groups": ["AGE_25_34"], "gender": "GENDER_UNLIMITED" },
//   "placements": ["PLACEMENT_TIKTOK"],
//   creative (optional; no ad is created without it): "identity_id", "identity_type", "video_id", "image_ids", "display_name"
import { defineConnector, request, fail, missingKeys, redact } from './_http.mjs';
import { loadSpec, partialResult } from './ads.mjs';

export const API = 'https://business-api.tiktok.com/open_api/v1.3';
const CHANNELS = ['tiktok', 'tiktok_ads', 'tiktok-ads'];
const NEEDS = ['TIKTOK_ACCESS_TOKEN', 'TIKTOK_ADVERTISER_ID'];

// TikTok targets locations by GeoNames ids, not ISO codes. Small map for common markets; any other
// market must give audience.location_ids. verify against current API docs (/tool/region/).
const GEONAME = { US: 6252001, GB: 2635167, UK: 2635167, CA: 6251999, AU: 2077456, DE: 2921044, FR: 3017382, ES: 2510769, IT: 3175395, NL: 2750405, BR: 3469034, MX: 3996063, JP: 1861060, TR: 298795, AE: 290557, SA: 102358 };

const enumOf = (s, fallback) => (s ? String(s).trim().toUpperCase().replace(/[\s-]+/g, '_') : fallback);
// "YYYY-MM-DD HH:MM:SS" in UTC. verify against current API docs (timezone of schedule_start_time).
const tkTime = (d) => new Date(d).toISOString().slice(0, 19).replace('T', ' ');

// TikTok answers HTTP 200 with a non-zero "code" on errors.
async function call(ctx, endpoint, json) {
  const r = await request(ctx, { url: `${API}/${endpoint}`, headers: { 'Access-Token': ctx.env.TIKTOK_ACCESS_TOKEN }, json: { advertiser_id: String(ctx.env.TIKTOK_ADVERTISER_ID), ...json } });
  if (!r.ok) throw new Error(fail(r, ctx, `TikTok ${endpoint}`));
  if (r.data?.code !== 0) throw new Error(`TikTok ${endpoint}: code ${r.data?.code ?? '?'} ${String(r.data?.message ?? r.text).slice(0, 200)}`);
  return r.data.data ?? {};
}

function locationIds(s) {
  const ids = s.audience?.location_ids ?? s.location_ids;
  if (Array.isArray(ids) && ids.length) return { ids: ids.map(String) };
  const codes = s.audience?.locations ?? [];
  const unknown = codes.filter((c) => !GEONAME[String(c).toUpperCase()]);
  if (!codes.length) return { error: 'TikTok spec needs audience.location_ids (or audience.locations as ISO country codes)' };
  if (unknown.length) return { error: `no TikTok location id known for ${unknown.join(', ')}; give audience.location_ids` };
  return { ids: codes.map((c) => String(GEONAME[String(c).toUpperCase()])) };
}

// Pauses (DISABLE) a TikTok campaign by id (used by the CPA kill-switch). A ref "adgroup:<id>"
// pauses an ad group; a ref "<campaign>/<adgroup>/<ad>" pauses its campaign. Pausing only ever
// reduces spend. opts.fetch is for tests; production uses globalThis.fetch.
export async function pause(ref, env = {}, dryRun = false, opts = {}) {
  const raw = String(ref ?? '');
  const level = raw.startsWith('adgroup:') ? 'adgroup' : 'campaign';
  const id = raw.replace(/^(adgroup|campaign):/, '').split('/')[0];
  if (!id) return { ok: false, detail: 'no TikTok id to pause' };
  if (dryRun) return { ok: true, detail: `would pause TikTok ${level} ${id}` };
  const miss = missingKeys(env, NEEDS);
  if (miss.length) return { ok: false, detail: `missing ${miss.join(', ')}; cannot pause TikTok ${level} ${id}` };
  const ctx = { env, fetch: opts.fetch };
  try {
    await call(ctx, `${level}/status/update/`, { [`${level}_ids`]: [id], operation_status: 'DISABLE' });
    return { ok: true, detail: `paused TikTok ${level} ${id}` };
  } catch (e) { return { ok: false, detail: redact(e.message ?? e, env) }; }
}

export const tiktokAds = { ...defineConnector({
  name: 'tiktok-ads',
  handles: 'type "spend" with channel "tiktok": campaign, ad group and ad through the TikTok Marketing API (disabled by default)',
  needs: NEEDS,
  unverified: 'Business API v1.3 field names (placements, promotion_type, schedule_start_time, ad creatives) follow the public reference but were not tested against a live advertiser. Test with a sandbox advertiser first.',
  accepts: (item) => item.type === 'spend' && CHANNELS.includes(item.channel),
  prepare(item, ctx) {
    const s = loadSpec(item, ctx);
    const loc = locationIds(s);
    if (loc.error) return { error: loc.error };
    const creative = Boolean(s.video_id || s.image_ids?.length);
    if (creative && !s.identity_id) return { error: 'TikTok creative needs identity_id (the ad identity)' };
    if (creative && !s.final_url) return { error: 'TikTok creative needs final_url' };
    if (creative && !s.text) return { error: 'TikTok creative needs text (the ad text)' };
    const status = item.activate === true ? 'ENABLE' : 'DISABLE';
    return { s, status, locations: loc.ids, creative, preview: `create ${status} TikTok campaign "${s.name}" with an ad group at ${s.daily}/day in ${loc.ids.length} location(s)${creative ? ' and 1 ad' : ' (no creative in spec, no ad)'}` };
  },
  async send(p, item, ctx) {
    const { s, status } = p;
    const campaign = await call(ctx, 'campaign/create/', {
      campaign_name: s.name, objective_type: enumOf(s.objective, 'TRAFFIC'), budget_mode: 'BUDGET_MODE_INFINITE', operation_status: status,
    });
    const campaignId = String(campaign.campaign_id ?? '');
    if (!campaignId) throw new Error('TikTok campaign/create/ returned no campaign_id');
    // A failure after the first create returns a partial result (no retry, see partialResult in ads.mjs).
    const created = [campaignId];
    let adgroupId = '', adId = '';
    try {
      const adgroup = await call(ctx, 'adgroup/create/', {
        campaign_id: campaignId, adgroup_name: s.ad_group, operation_status: status,
        promotion_type: 'WEBSITE', // verify against current API docs (required for website traffic)
        placement_type: 'PLACEMENT_TYPE_NORMAL', placements: s.placements ?? ['PLACEMENT_TIKTOK'],
        location_ids: p.locations,
        ...(Array.isArray(s.audience?.age_groups) && s.audience.age_groups.length ? { age_groups: s.audience.age_groups } : {}),
        ...(s.audience?.gender ? { gender: s.audience.gender } : {}),
        budget_mode: 'BUDGET_MODE_DAY', budget: s.daily, // account currency units; TikTok enforces a minimum daily ad group budget
        schedule_type: 'SCHEDULE_FROM_NOW', schedule_start_time: tkTime(ctx.now ?? Date.now()),
        optimization_goal: enumOf(s.optimization_goal, 'CLICK'), billing_event: 'CPC', bid_type: 'BID_TYPE_NO_BID', pacing: 'PACING_MODE_SMOOTH',
      });
      adgroupId = String(adgroup.adgroup_id ?? '');
      if (!adgroupId) throw new Error('TikTok adgroup/create/ returned no adgroup_id');
      created.push(adgroupId);
      if (p.creative) {
        const ad = await call(ctx, 'ad/create/', {
          adgroup_id: adgroupId,
          operation_status: status, // verify against current API docs (ad-level status on create)
          creatives: [{
            ad_name: `${s.name} · ad 1`, identity_id: String(s.identity_id), identity_type: s.identity_type ?? 'CUSTOMIZED_USER',
            ad_format: s.video_id ? 'SINGLE_VIDEO' : 'SINGLE_IMAGE', // verify against current API docs
            ...(s.video_id ? { video_id: String(s.video_id) } : {}), ...(s.image_ids?.length ? { image_ids: s.image_ids.map(String) } : {}),
            ...(s.display_name ? { display_name: s.display_name } : {}),
            ad_text: s.text, call_to_action: enumOf(s.cta, 'LEARN_MORE'), landing_page_url: s.final_url,
          }],
        });
        adId = String(ad.ad_ids?.[0] ?? '');
      }
    } catch (e) { return partialResult(e, created, status); }
    const ref = [campaignId, adgroupId, adId].filter(Boolean).join('/');
    return { ok: true, ref, detail: `${status} TikTok campaign ${campaignId}, ad group ${adgroupId}${adId ? `, ad ${adId}` : ''}, ${s.daily}/day`, committed_daily: status === 'ENABLE' ? s.daily : 0 };
  },
}), pause };

export default tiktokAds;
