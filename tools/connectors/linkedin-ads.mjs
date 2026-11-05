// LinkedIn Ads through the LinkedIn Marketing REST API (versioned, https://api.linkedin.com/rest).
// An approved "spend" item with channel linkedin/linkedin_ads/linkedin-ads creates a campaign
// group (DRAFT) and one sponsored-content campaign (PAUSED) with the approved daily budget and the
// spec's targeting, plus a creative when the spec references an existing post. With
// activate: true the group and campaign are ACTIVE. tools/execute.mjs has already enforced free
// mode, the caps and the approval; loadSpec() re-checks spec daily_budget <= the approved amount.
// Needs LINKEDIN_ACCESS_TOKEN (scope rw_ads) and LINKEDIN_AD_ACCOUNT_ID (digits of the sponsored
// account). Organic posts stay with the "linkedin" post connector in social.mjs.
//
// Spec fields used (JSON, the approval's "file"), on top of the shared ads spec:
//   "currency": "USD", "objective": "WEBSITE_VISIT", "cost_type": "CPC", "max_cpc": 8,
//   "targeting": { "locations": ["US" | 103644278 | "urn:li:geo:103644278"],
//                  "job_functions": [4 | "urn:li:function:4"], "seniorities": [5], "titles": [123] },
//   "creative_reference": "urn:li:share:…" | "urn:li:ugcPost:…" (an existing post to sponsor; optional)
import { defineConnector, request, fail, missingKeys, redact } from './_http.mjs';
import { loadSpec, partialResult } from './ads.mjs';

export const API = 'https://api.linkedin.com/rest';
// Pinned LinkedIn-Version (YYYYMM). LinkedIn keeps each version for about a year; override with
// LINKEDIN_ADS_VERSION when it is retired. verify against current API docs.
export const LINKEDIN_ADS_VERSION = '202609';
const CHANNELS = ['linkedin', 'linkedin_ads', 'linkedin-ads'];
const NEEDS = ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_AD_ACCOUNT_ID'];

// ISO country → LinkedIn geo id, for common markets only; other markets give the geo id or URN.
// verify against current API docs (Geo typeahead / adTargetingEntities).
const GEO = { US: 103644278, GB: 101165590, UK: 101165590, CA: 101174742, DE: 101282230, FR: 105015875, AU: 101452733, NL: 102890719, ES: 105646813, IT: 103350119, IN: 102713980 };

const acctId = (env) => String(env.LINKEDIN_AD_ACCOUNT_ID ?? '').replace(/\D/g, '');
const headers = (env) => ({ authorization: `Bearer ${env.LINKEDIN_ACCESS_TOKEN}`, 'linkedin-version': env.LINKEDIN_ADS_VERSION || LINKEDIN_ADS_VERSION, 'x-restli-protocol-version': '2.0.0' });
const idFrom = (r) => String(r.headers?.get?.('x-restli-id') ?? r.data?.id ?? '');
const tail = (urnOrId) => String(urnOrId ?? '').split(':').pop().split('/').pop();

// Turns ids, URNs or (for locations) ISO codes into the facet URNs. Returns {urns} or {error}.
function urns(list, prefix, label, iso = null) {
  const out = []; const bad = [];
  for (const v of list ?? []) {
    const s = String(v).trim();
    if (s.startsWith('urn:li:')) out.push(s);
    else if (/^\d+$/.test(s)) out.push(`${prefix}${s}`);
    else if (iso && iso[s.toUpperCase()]) out.push(`${prefix}${iso[s.toUpperCase()]}`);
    else bad.push(s);
  }
  return bad.length ? { error: `LinkedIn ${label} must be ids or URNs (got ${bad.join(', ')})` } : { urns: out };
}

function targeting(s) {
  const t = s.targeting ?? s.audience ?? {};
  const loc = urns(t.locations, 'urn:li:geo:', 'locations', GEO);
  if (loc.error) return loc;
  if (!loc.urns.length) return { error: 'LinkedIn spec needs targeting.locations' };
  const facets = [['urn:li:adTargetingFacet:locations', loc.urns]];
  for (const [key, prefix, facet] of [['job_functions', 'urn:li:function:', 'jobFunctions'], ['seniorities', 'urn:li:seniority:', 'seniorities'], ['titles', 'urn:li:title:', 'titles']]) {
    const r = urns(t[key], prefix, key);
    if (r.error) return r;
    if (r.urns.length) facets.push([`urn:li:adTargetingFacet:${facet}`, r.urns]);
  }
  return { criteria: { include: { and: facets.map(([facet, values]) => ({ or: { [facet]: values } })) } }, facets: facets.length };
}

// Pauses a LinkedIn campaign by id or URN (used by the CPA kill-switch). Pausing only ever reduces
// spend. opts.fetch is for tests; production uses globalThis.fetch.
export async function pause(ref, env = {}, dryRun = false, opts = {}) {
  const id = tail(String(ref ?? '').split('/')[0]);
  if (!id) return { ok: false, detail: 'no LinkedIn campaign id to pause' };
  if (dryRun) return { ok: true, detail: `would pause LinkedIn campaign ${id}` };
  const miss = missingKeys(env, NEEDS);
  if (miss.length) return { ok: false, detail: `missing ${miss.join(', ')}; cannot pause LinkedIn campaign ${id}` };
  const ctx = { env, fetch: opts.fetch };
  try {
    const r = await request(ctx, { url: `${API}/adAccounts/${acctId(env)}/adCampaigns/${id}`, headers: { ...headers(env), 'x-restli-method': 'PARTIAL_UPDATE' }, json: { patch: { $set: { status: 'PAUSED' } } } });
    return r.ok ? { ok: true, detail: `paused LinkedIn campaign ${id}` } : { ok: false, detail: fail(r, ctx, 'LinkedIn pause') };
  } catch (e) { return { ok: false, detail: redact(e.message ?? e, env) }; }
}

export const linkedinAds = { ...defineConnector({
  name: 'linkedin-ads',
  handles: 'type "spend" with channel "linkedin": campaign group, campaign and sponsored-content creative through the LinkedIn Marketing API (draft/paused by default)',
  needs: NEEDS,
  unverified: `LinkedIn-Version pinned to ${LINKEDIN_ADS_VERSION} (override LINKEDIN_ADS_VERSION); adCampaignGroups/adCampaigns/creatives field names follow the versioned REST reference but were not tested against a live ad account.`,
  accepts: (item) => item.type === 'spend' && CHANNELS.includes(item.channel),
  prepare(item, ctx) {
    const s = loadSpec(item, ctx);
    const t = targeting(s);
    if (t.error) return { error: t.error };
    const active = item.activate === true;
    const groupStatus = active ? 'ACTIVE' : 'DRAFT';
    const status = active ? 'ACTIVE' : 'PAUSED'; // verify against current API docs (campaign status allowed inside a DRAFT group)
    const currency = String(s.currency || ctx.env.LINKEDIN_CURRENCY || 'USD').toUpperCase();
    const creative = s.creative_reference ? String(s.creative_reference) : '';
    if (creative && !/^urn:li:(share|ugcPost|post):/.test(creative)) return { error: 'creative_reference must be a urn:li:share, urn:li:ugcPost or urn:li:post URN' };
    return { s, t, groupStatus, status, currency, creative, preview: `create ${groupStatus} LinkedIn campaign group and ${status} campaign "${s.name}" at ${s.daily} ${currency}/day with ${t.facets} targeting facet(s)${creative ? ' and 1 creative' : ''}` };
  },
  async send(p, item, ctx) {
    const { s, status, currency } = p;
    const acct = acctId(ctx.env);
    const account = `urn:li:sponsoredAccount:${acct}`;
    const base = `${API}/adAccounts/${acct}`;
    const h = headers(ctx.env);
    const start = new Date(ctx.now ?? Date.now()).getTime();
    const post = async (resource, json) => {
      const r = await request(ctx, { url: `${base}/${resource}`, headers: h, json });
      if (!r.ok) throw new Error(fail(r, ctx, `LinkedIn ${resource}`));
      const id = idFrom(r);
      if (!id) throw new Error(`LinkedIn ${resource} returned no id`);
      return id;
    };
    const groupId = tail(await post('adCampaignGroups', { account, name: `${s.name} · group · ${item.id}`, status: p.groupStatus, runSchedule: { start } }));
    const money = (n) => ({ amount: Number(n).toFixed(2), currencyCode: currency });
    // A failure after the first create returns a partial result (no retry, see partialResult in ads.mjs).
    const created = [`urn:li:sponsoredCampaignGroup:${groupId}`];
    let campaignId = '', campaignUrn = '', creativeId = '';
    try {
      campaignId = tail(await post('adCampaigns', {
        account, campaignGroup: `urn:li:sponsoredCampaignGroup:${groupId}`, name: s.name, status,
        type: 'SPONSORED_UPDATES', objectiveType: s.objective ?? 'WEBSITE_VISIT',
        costType: s.cost_type ?? 'CPC', ...(s.max_cpc ? { unitCost: money(s.max_cpc) } : {}),
        dailyBudget: money(s.daily),
        locale: { country: s.locale_country ?? 'US', language: s.locale_language ?? 'en' },
        offsiteDeliveryEnabled: false, audienceExpansionEnabled: false,
        politicalIntent: 'NOT_POLITICAL', // verify against current API docs (field required in recent versions)
        runSchedule: { start }, targetingCriteria: p.t.criteria,
      }));
      campaignUrn = `urn:li:sponsoredCampaign:${campaignId}`;
      created.push(campaignUrn);
      if (p.creative) {
        creativeId = await post('creatives', { campaign: campaignUrn, content: { reference: p.creative }, intendedStatus: status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED' }); // verify against current API docs
      }
    } catch (e) { return partialResult(e, created, status, campaignUrn || created[0]); }
    return { ok: true, ref: campaignUrn, detail: `${status} LinkedIn campaign ${campaignId} in ${p.groupStatus} group ${groupId}${creativeId ? `, creative ${creativeId}` : ''}, ${s.daily} ${currency}/day`, committed_daily: status === 'ACTIVE' ? s.daily : 0 };
  },
}), pause };

export default linkedinAds;
