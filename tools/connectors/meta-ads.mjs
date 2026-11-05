// Meta (Facebook/Instagram) Ads through the Marketing API.
// An approved "spend" item with channel "meta" creates a campaign and one ad set with the
// approved daily budget. Everything is created PAUSED unless the item says activate: true,
// and the budget can never exceed the item's approved amount (already checked by policy/budget;
// loadSpec() re-checks spec daily_budget <= the approved amount).
// Needs META_ACCESS_TOKEN and META_AD_ACCOUNT_ID (digits, without "act_"). Creatives and ads
// (which need a Page) come from separate approved items, so META_PAGE_ID is not required here.
// The item's spec file (JSON) gives: objective, daily_budget, targeting, optimization_goal,
// billing_event, name. Built on defineConnector(): ctx.fetch, dry run, missing keys and
// redaction work like the other ad connectors.
import { defineConnector, request, fail, missingKeys, redact } from './_http.mjs';
import { loadSpec, partialResult } from './ads.mjs';

// Graph API version. Meta keeps each Marketing API version for a limited window (v24 ends
// 2026-10-06), so the default follows a current version; META_API_VERSION overrides it ("v26.0").
export const API_VERSION = 'v25.0';
export const API = `https://graph.facebook.com/${API_VERSION}`;
const NEEDS = ['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID'];
export const apiBase = (env = {}) => (/^v\d+\.\d+$/.test(String(env.META_API_VERSION ?? '')) ? `https://graph.facebook.com/${env.META_API_VERSION}` : API);

// Graph answers errors with a non-2xx status and an "error" object; both go through redact().
async function call(ctx, pathPart, params) {
  const form = { ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)])), access_token: ctx.env.META_ACCESS_TOKEN };
  const r = await request(ctx, { url: `${apiBase(ctx.env)}/${pathPart}`, form });
  if (!r.ok || r.data?.error) throw new Error(r.ok ? `Meta ${pathPart}: ${redact(r.data.error.message ?? r.text, ctx.env).slice(0, 200)}` : fail(r, ctx, `Meta ${pathPart}`));
  return r.data ?? {};
}

// Pauses a campaign by id (used by the CPA kill-switch). The connector's ref "<campaign>/<adset>"
// pauses its campaign. Pausing only ever reduces spend. Never throws: a network error comes back
// as ok:false so the kill-switch still handles the remaining campaigns and raises its alert.
// opts.fetch is for tests; production uses globalThis.fetch.
export async function pause(ref, env = {}, dryRun = false, opts = {}) {
  const id = String(ref ?? '').split('/')[0].trim();
  if (!/^\d+$/.test(id)) return { ok: false, detail: `no Meta campaign id to pause in "${redact(ref, env).slice(0, 80)}"` };
  if (dryRun) return { ok: true, detail: `would pause Meta campaign ${id}` };
  const miss = missingKeys(env, ['META_ACCESS_TOKEN']);
  if (miss.length) return { ok: false, detail: `missing ${miss.join(', ')}; cannot pause Meta campaign ${id}` };
  try {
    await call({ env, fetch: opts.fetch }, id, { status: 'PAUSED' });
    return { ok: true, detail: `paused Meta campaign ${id}` };
  } catch (e) { return { ok: false, detail: redact(e.message ?? e, env) }; }
}

export const metaAds = { ...defineConnector({
  name: 'meta-ads',
  handles: 'type "spend" with channel "meta" (campaign + ad set, paused by default)',
  needs: NEEDS,
  required: (env) => missingKeys(env, NEEDS),
  accepts: (item) => item.type === 'spend' && item.channel === 'meta',
  prepare(item, ctx) {
    const s = loadSpec(item, ctx);
    const status = item.activate === true ? 'ACTIVE' : 'PAUSED';
    return { s, status, preview: `create ${status} campaign "${s.name}" at ${s.daily}/day` };
  },
  async send(p, item, ctx) {
    const { s, status } = p;
    const act = `act_${ctx.env.META_AD_ACCOUNT_ID}`;
    const campaign = await call(ctx, `${act}/campaigns`, {
      name: s.name, objective: s.objective ?? 'OUTCOME_TRAFFIC', status, special_ad_categories: s.special_ad_categories ?? [],
      is_adset_budget_sharing_enabled: false, // required from v24 when the campaign has no campaign-level budget
    });
    if (!campaign.id) throw new Error(`Meta ${act}/campaigns returned no id`);
    // An ad set failure after the campaign exists returns a partial result (no retry, which would
    // duplicate the campaign; see partialResult in ads.mjs).
    let adset;
    try {
      adset = await call(ctx, `${act}/adsets`, {
        name: `${s.name} · ad set`, campaign_id: campaign.id, status,
        daily_budget: Math.round(s.daily * 100), // minor units
        billing_event: s.billing_event ?? 'IMPRESSIONS', optimization_goal: s.optimization_goal ?? 'LINK_CLICKS',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP', targeting: s.targeting ?? { geo_locations: { countries: ['US'] } },
      });
    } catch (e) { return partialResult(e, [campaign.id], status); }
    return { ok: true, ref: `${campaign.id}/${adset.id}`, detail: `${status} campaign ${campaign.id}, ad set ${adset.id}, ${s.daily}/day`, committed_daily: status === 'ACTIVE' ? s.daily : 0 };
  },
}), pause };

export default metaAds;
