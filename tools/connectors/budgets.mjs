// Budget-update executors: change the daily budget of a campaign that already exists, after the owner
// approved a "spend" item of kind "budget_update" (tools/reallocate.mjs proposes them). One connector per
// platform: Meta (ad set or campaign daily_budget, minor units), Google Ads (campaignBudgets:mutate
// amountMicros), TikTok (campaign/update budget, or adgroup/budget/update), LinkedIn (adCampaigns
// dailyBudget) and Microsoft Ads (Campaigns DailyBudget, or Budgets Amount). pauseMicrosoft() is the
// Microsoft campaign pause the kill switch lacks.
// Guards, all re-checked right before the platform call (prepare, and again in send):
//   - the live caps: product.json budget.daily_cap and monthly_cap are read again from disk, the other live
//     campaigns' daily total (budget_update items replace the daily amount of the campaign they change, never
//     add to it) plus the new amount must fit daily_cap, and spend so far + that total x days left must fit
//     monthly_cap. A decrease always passes (it only ever lowers spend);
//   - free mode never increases;
//   - new_daily never above the approved amount, and an increase never above max_change (20%) over old_daily;
//   - a Google budget shared with other campaigns is refused (it would move their money too).
// Approval fields used: channel, kind "budget_update", campaign, ref (platform id: "<campaign>/<adset>" for
// Meta, campaign id or "adgroup:<id>" for TikTok, campaign id or URN elsewhere), level ("campaign" | "adset" |
// "adgroup"), old_daily, new_daily, amount (approved = new_daily), currency, budget_id (Microsoft) or
// budget_resource (Google), source_approval (the spend approval that created the campaign). Fields missing
// on the approval are read from its plan file entry (item.file, an object with "changes": [{approval_id, ...}]).
// Keys come from env only, like the creating connectors; every detail passes through redact().
// Tests inject ctx.fetch; nothing here touches the network on a dry run or with missing keys.
import fs from 'node:fs';
import path from 'node:path';
import { defineConnector, request, fail, missingKeys, redact, readProduct } from './_http.mjs';
import { apiBase as metaBase } from './meta-ads.mjs';
import { API as TIKTOK_API } from './tiktok-ads.mjs';
import { API as LINKEDIN_API, LINKEDIN_ADS_VERSION } from './linkedin-ads.mjs';
import { googleMissing, googleToken, GOOGLE_ADS_API_VERSION } from './google-auth.mjs';
import { readLedger, spentThisMonth, daysLeftInMonth, committedDaily } from '../budget.mjs';
import { readJson } from '../lib/env.mjs';

export const MAX_CHANGE = 0.2;
export const PLATFORM_CHANNELS = {
  meta: ['meta', 'facebook', 'instagram', 'meta_ads', 'meta-ads'],
  google: ['google', 'google_ads', 'google-ads', 'adwords'],
  tiktok: ['tiktok', 'tiktok_ads', 'tiktok-ads'],
  linkedin: ['linkedin', 'linkedin_ads', 'linkedin-ads'],
  microsoft: ['microsoft', 'microsoft_ads', 'microsoft-ads', 'bing', 'bing_ads'],
};
export const platformOf = (channel) => {
  const c = String(channel ?? '').trim().toLowerCase();
  return Object.keys(PLATFORM_CHANNELS).find((p) => PLATFORM_CHANNELS[p].includes(c)) ?? null;
};
export const isBudgetUpdate = (item) => item?.type === 'spend' && item?.kind === 'budget_update';

// Currencies without minor units (Meta's "offset 1"). verify against current API docs (Meta currency offsets).
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'CLP', 'COP', 'CRC', 'HUF', 'ISK', 'IDR', 'PYG', 'TWD', 'VND']);
export const minorUnits = (amount, currency = 'USD') => Math.round(Number(amount) * (ZERO_DECIMAL.has(String(currency).toUpperCase()) ? 1 : 100));
const round2 = (n) => Math.round(Number(n) * 100) / 100;
const campaignKey = (x) => `${platformOf(x.channel) ?? String(x.channel ?? '')}|${String(x.campaign ?? '')}`;

// Fills the update fields from the approval, else from its plan file entry (never from anything else).
export function resolveUpdate(item, ctx = {}) {
  let entry = {};
  if (ctx.dir && item.file && (item.new_daily == null || item.ref == null || item.old_daily == null)) {
    const f = path.resolve(ctx.dir, item.file);
    if (f.startsWith(path.resolve(ctx.dir) + path.sep)) entry = (readJson(f, {})?.changes ?? []).find((c) => c.approval_id === item.id) ?? {};
  }
  const pick = (k) => item[k] ?? entry[k];
  return {
    channel: item.channel, platform: platformOf(item.channel), campaign: String(pick('campaign') ?? ''), ref: String(pick('ref') ?? pick('campaign') ?? ''),
    level: pick('level') ?? null, old_daily: Number(pick('old_daily')), new_daily: Number(pick('new_daily')), currency: pick('currency') ?? null,
    budget_id: pick('budget_id') ?? null, budget_resource: pick('budget_resource') ?? null, source_approval: pick('source_approval') ?? null,
  };
}

// Daily money live across every campaign, where an executed budget_update replaces the daily amount of the
// campaign it changed (latest one wins) instead of adding to it. excludeKey leaves one campaign out.
// Same campaign: equal refs, or one is the bare campaign id of the other ("111" vs "111/9001"). Two ad sets of
// one campaign ("111/1" vs "111/2") are different, so one update never hides another ad set's money.
const sameRef = (a, b) => { const x = String(a ?? ''), y = String(b ?? ''); return Boolean(x && y) && (x === y || x === y.split('/')[0] || y === x.split('/')[0]); };
// Budget updates that count as live: executed, plus ones in flight or done by hand (counted at the higher of
// old and new, since it is not known yet whether the change landed).
const UPDATE_LIVE = new Set(['executed', 'live', 'executing', 'approved-manual']);
const updateDaily = (u) => (['executed', 'live'].includes(u.status) ? Number(u.new_daily ?? u.committed_daily ?? 0) : Math.max(Number(u.new_daily) || 0, Number(u.old_daily) || 0));
export function liveCommittedDaily({ approvals = [], ledger = [], killed = [], excludeId, excludeKey, excludeApproval, excludeRef } = {}) {
  const updates = approvals.filter((a) => isBudgetUpdate(a) && UPDATE_LIVE.has(a.status) && a.id !== excludeId)
    .sort((a, b) => String(a.executed_at ?? a.created_at ?? '').localeCompare(String(b.executed_at ?? b.created_at ?? '')));
  const latest = new Map();
  for (const u of updates) latest.set(campaignKey(u), u);
  const superseded = new Set([...latest.values()].map((u) => u.source_approval).filter(Boolean));
  if (excludeApproval) superseded.add(excludeApproval);
  const killedKeys = new Set(killed.map((k) => `${platformOf(k.channel) ?? k.channel}|${k.campaign}`));
  const supersededRefs = [...latest.values()].map((u) => u.ref).filter(Boolean);
  if (excludeRef) supersededRefs.push(excludeRef);
  const creators = approvals.filter((a) => !isBudgetUpdate(a) && !superseded.has(a.id) && !supersededRefs.some((r) => sameRef(a.result_ref, r)) && !(excludeKey && a.campaign != null && campaignKey(a) === excludeKey));
  let sum = committedDaily({ approvals: creators, ledger, killed, excludeId });
  for (const [k, u] of latest) {
    if (k === excludeKey || killedKeys.has(k) || u.paused_at || ['paused', 'ended'].includes(u.campaign_status)) continue;
    sum += updateDaily(u);
  }
  return round2(sum);
}

// The campaign's live daily amount from approvals.json: its latest executed update, else the creating
// approval's committed_daily (0 when unknown).
export function currentDaily(approvals = [], u = {}, excludeId) {
  const key = `${u.platform ?? platformOf(u.channel)}|${u.campaign}`;
  const done = approvals.filter((a) => isBudgetUpdate(a) && ['executed', 'live'].includes(a.status) && a.id !== excludeId && campaignKey(a) === key)
    .sort((a, b) => String(a.executed_at ?? '').localeCompare(String(b.executed_at ?? '')));
  if (done.length) return Number(done[done.length - 1].new_daily) || 0;
  const src = approvals.find((a) => a?.type === 'spend' && !isBudgetUpdate(a) && ((u.source_approval && a.id === u.source_approval) || sameRef(a.result_ref, u.ref)));
  return Number(src?.committed_daily) || 0;
}

// The cap check for one budget_update. Returns {ok, why, old_daily, new_daily, others, newTotal, projected}.
// The baseline is the lower of the approval's old_daily and the live daily now, so a stale approval cannot
// pass an increase off as a decrease after another change already lowered the budget. The approved amount
// must be on the approval itself (a plan file edited after approval never raises it).
export function checkBudgetUpdateCaps({ item, update = null, budget = {}, approvals = [], ledgerFile, now = new Date().toISOString(), killed = [], maxChange = MAX_CHANGE }) {
  const u = update ?? resolveUpdate(item);
  const newD = Number(u.new_daily), approved = Number(item?.amount);
  const live = currentDaily(approvals, u, item?.id);
  const oldD = live > 0 && Number(u.old_daily) > 0 ? Math.min(Number(u.old_daily), live) : Number(u.old_daily);
  const ledger = ledgerFile ? readLedger(ledgerFile) : [];
  const spent = ledgerFile ? spentThisMonth(ledgerFile, now) : 0;
  const key = `${u.platform ?? platformOf(u.channel ?? item?.channel)}|${u.campaign}`;
  const others = liveCommittedDaily({ approvals, ledger, killed, excludeId: item?.id, excludeKey: key, excludeApproval: u.source_approval, excludeRef: u.ref });
  const daysLeft = daysLeftInMonth(now);
  const daily = Number(budget.daily_cap ?? 0), monthly = Number(budget.monthly_cap ?? 0);
  const newTotal = round2(others + newD);
  const projected = round2(spent + newTotal * daysLeft);
  let why = '';
  if (!(approved > 0)) why = 'budget update has no approved amount on the approval itself';
  else if (!(newD > 0)) why = 'budget update has no new daily amount';
  else if (!(oldD > 0)) why = 'budget update has no old daily amount';
  else if (newD > approved + 1e-9) why = `new daily ${newD} is over the approved amount ${approved}`;
  else if (newD > oldD) {
    if ((budget.mode ?? 'free') === 'free') why = 'free mode: budgets never go up';
    else if (newD > round2(oldD * (1 + maxChange)) + 0.005) why = `increase ${oldD} -> ${newD} is over the ${Math.round(maxChange * 100)}% daily change limit`;
    else if (newTotal > daily) why = `daily total ${newTotal} (other live ${others} + this ${newD}) is over daily_cap ${daily}`;
    else if (projected > monthly) why = `spent ${spent} + ${newTotal}/day x ${daysLeft} day(s) left = ${projected} is over monthly_cap ${monthly}`;
  }
  return { ok: !why, why, old_daily: oldD, new_daily: newD, others, newTotal, spent, daysLeft, projected };
}

// Re-reads product.json, approvals.json, ledger.jsonl and killswitch.json from the product folder.
function liveCheck(item, u, ctx) {
  if (!ctx.dir) return { ok: false, why: 'no product folder to check the live caps against' };
  const product = readProduct(ctx);
  const approvals = readJson(path.join(ctx.dir, 'approvals.json'), []);
  return checkBudgetUpdateCaps({ item, update: u, budget: product.budget ?? {}, approvals: Array.isArray(approvals) ? approvals : [], ledgerFile: path.join(ctx.dir, 'ledger.jsonl'), now: ctx.now ?? new Date().toISOString(), killed: readJson(path.join(ctx.dir, 'killswitch.json'), []) });
}

function makeConnector({ platform, name, needs, required, unverified, describe, call }) {
  const c = defineConnector({
    name, needs, unverified, required,
    handles: `type "spend" kind "budget_update" with channel "${platform}": ${describe}`,
    accepts: (item) => isBudgetUpdate(item) && platformOf(item.channel) === platform,
    prepare(item, ctx) {
      const u = resolveUpdate(item, ctx);
      if (!u.ref) return { error: `${name}: no campaign id to update` };
      const chk = liveCheck(item, u, ctx);
      if (!chk.ok) return { error: `${name}: held, ${chk.why}` };
      const currency = u.currency ?? readProduct(ctx).budget?.currency ?? 'USD';
      return { u: { ...u, currency }, preview: `set ${platform} ${u.level ?? 'campaign'} ${u.ref} daily budget ${u.old_daily} -> ${u.new_daily} ${currency}` };
    },
    async send(p, item, ctx) {
      // Second look right before the call: another item may have gone live since prepare.
      const chk = liveCheck(item, p.u, ctx);
      if (!chk.ok) return { ok: false, detail: `${name}: held, ${chk.why}` };
      const r = await call(p.u, ctx);
      return { ok: true, ref: r.ref ?? p.u.ref, detail: r.detail, committed_daily: p.u.new_daily, budget_update: { campaign: p.u.campaign, old_daily: p.u.old_daily, new_daily: p.u.new_daily } };
    },
  });
  return c;
}

// ── Meta: POST /{adset_id|campaign_id} daily_budget (minor units). The ref "<campaign>/<adset>" updates the
// ad set (meta-ads.mjs puts the budget there); level "campaign" or a bare id updates the campaign
// (campaign budget optimisation). https://developers.facebook.com/docs/marketing-api/reference/ad-campaign
async function metaCall(u, ctx) {
  const [camp, adset] = u.ref.split('/');
  const id = u.level === 'campaign' || !adset ? camp : adset;
  if (!/^\d+$/.test(String(id))) throw new Error(`no Meta id in "${u.ref}"`);
  const r = await request(ctx, { url: `${metaBase(ctx.env)}/${id}`, form: { daily_budget: String(minorUnits(u.new_daily, u.currency)), access_token: ctx.env.META_ACCESS_TOKEN } });
  if (!r.ok || r.data?.error) throw new Error(r.ok ? `Meta ${id}: ${redact(r.data.error.message ?? r.text, ctx.env).slice(0, 200)}` : fail(r, ctx, `Meta ${id}`));
  return { ref: u.ref, detail: `Meta ${id === camp ? 'campaign' : 'ad set'} ${id} daily budget ${u.old_daily} -> ${u.new_daily}` };
}

// ── Google Ads: the campaign's budget resource (googleAds:search), then campaignBudgets:mutate amountMicros.
// https://developers.google.com/google-ads/api/rest/reference/rest/latest/customers.campaignBudgets/mutate
async function googleCall(u, ctx) {
  const cid = String(ctx.env.GOOGLE_ADS_CUSTOMER_ID).replace(/\D/g, '');
  const base = `https://googleads.googleapis.com/${ctx.env.GOOGLE_ADS_API_VERSION || GOOGLE_ADS_API_VERSION}/customers/${cid}`;
  const headers = { authorization: `Bearer ${await googleToken(ctx)}`, 'developer-token': ctx.env.GOOGLE_ADS_DEVELOPER_TOKEN };
  if (ctx.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) headers['login-customer-id'] = String(ctx.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID).replace(/\D/g, '');
  const campaignId = String(u.ref).split('/').pop().replace(/\D/g, '');
  if (!campaignId) throw new Error(`no Google Ads campaign id in "${u.ref}"`);
  const q = await request(ctx, { url: `${base}/googleAds:search`, headers, json: { query: `SELECT campaign.id, campaign.campaign_budget, campaign_budget.explicitly_shared, campaign_budget.amount_micros FROM campaign WHERE campaign.id = ${campaignId}` } });
  if (!q.ok) throw new Error(fail(q, ctx, 'Google Ads search'));
  const row = q.data?.results?.[0];
  const resourceName = row?.campaign?.campaignBudget ?? u.budget_resource;
  if (!resourceName) throw new Error(`Google Ads campaign ${campaignId} has no budget`);
  if (row?.campaignBudget?.explicitlyShared === true) throw new Error(`Google Ads campaign ${campaignId} uses a shared budget; change it by hand (it moves other campaigns' money too)`);
  const r = await request(ctx, { url: `${base}/campaignBudgets:mutate`, headers, json: { operations: [{ update: { resourceName, amountMicros: String(Math.round(u.new_daily * 1e6)) }, updateMask: 'amountMicros' }] } });
  if (!r.ok) throw new Error(fail(r, ctx, 'Google Ads campaignBudgets:mutate'));
  return { ref: u.ref, detail: `Google Ads campaign ${campaignId} budget ${u.old_daily} -> ${u.new_daily}` };
}

// ── TikTok: campaign/update/ {campaign_id, budget} or adgroup/budget/update/ {budget: [{adgroup_id, budget}]}.
// verify against current API docs (Business API v1.3 field names; budget_mode must already be a daily mode).
async function tiktokCall(u, ctx) {
  const raw = String(u.ref);
  const adgroup = u.level === 'adgroup' || raw.startsWith('adgroup:');
  const id = raw.replace(/^(adgroup|campaign):/, '').split('/')[adgroup && !raw.startsWith('adgroup:') ? 1 : 0];
  if (!id) throw new Error(`no TikTok id in "${raw}"`);
  const endpoint = adgroup ? 'adgroup/budget/update/' : 'campaign/update/';
  const body = adgroup ? { budget: [{ adgroup_id: String(id), budget: u.new_daily }] } : { campaign_id: String(id), budget: u.new_daily };
  const r = await request(ctx, { url: `${TIKTOK_API}/${endpoint}`, headers: { 'Access-Token': ctx.env.TIKTOK_ACCESS_TOKEN }, json: { advertiser_id: String(ctx.env.TIKTOK_ADVERTISER_ID), ...body } });
  if (!r.ok) throw new Error(fail(r, ctx, `TikTok ${endpoint}`));
  if (r.data?.code !== 0) throw new Error(`TikTok ${endpoint}: code ${r.data?.code ?? '?'} ${redact(String(r.data?.message ?? r.text), ctx.env).slice(0, 200)}`);
  return { ref: raw, detail: `TikTok ${adgroup ? 'ad group' : 'campaign'} ${id} budget ${u.old_daily} -> ${u.new_daily}` };
}

// ── LinkedIn: PARTIAL_UPDATE adAccounts/{acct}/adCampaigns/{id} dailyBudget {amount, currencyCode}.
// https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/create-and-manage-campaigns
async function linkedinCall(u, ctx) {
  const id = String(u.ref).split('/')[0].split(':').pop();
  const acct = String(ctx.env.LINKEDIN_AD_ACCOUNT_ID ?? '').replace(/\D/g, '');
  if (!/^\d+$/.test(id)) throw new Error(`no LinkedIn campaign id in "${u.ref}"`);
  const headers = { authorization: `Bearer ${ctx.env.LINKEDIN_ACCESS_TOKEN}`, 'linkedin-version': ctx.env.LINKEDIN_ADS_VERSION || LINKEDIN_ADS_VERSION, 'x-restli-protocol-version': '2.0.0', 'x-restli-method': 'PARTIAL_UPDATE' };
  const r = await request(ctx, { url: `${LINKEDIN_API}/adAccounts/${acct}/adCampaigns/${id}`, headers, json: { patch: { $set: { dailyBudget: { amount: Number(u.new_daily).toFixed(2), currencyCode: String(u.currency).toUpperCase() } } } } });
  if (!r.ok) throw new Error(fail(r, ctx, 'LinkedIn adCampaigns'));
  return { ref: u.ref, detail: `LinkedIn campaign ${id} daily budget ${u.old_daily} -> ${u.new_daily}` };
}

// ── Microsoft Advertising, Campaign Management v13 REST. UpdateCampaigns is PUT {base}/Campaigns
// (learn.microsoft.com/advertising/campaign-management-service/updatecampaigns, REST pivot); UpdateBudgets is
// PUT {base}/Budgets with Budgets [{Id, Amount}] (verify against current API docs).
const MS_NEEDS = ['MSADS_DEVELOPER_TOKEN', 'MSADS_ACCESS_TOKEN', 'MSADS_CUSTOMER_ID', 'MSADS_ACCOUNT_ID'];
const msBase = (env) => (env.MSADS_REST_BASE || 'https://campaign.api.bingads.microsoft.com/CampaignManagement/v13').replace(/\/$/, '');
const msHeaders = (env) => ({ authorization: `Bearer ${env.MSADS_ACCESS_TOKEN}`, DeveloperToken: env.MSADS_DEVELOPER_TOKEN, CustomerId: String(env.MSADS_CUSTOMER_ID), CustomerAccountId: String(env.MSADS_ACCOUNT_ID) });
const msErrors = (r) => (r.data?.PartialErrors?.length ? `Microsoft Ads: ${JSON.stringify(r.data.PartialErrors).slice(0, 200)}` : '');
async function microsoftCall(u, ctx) {
  const env = ctx.env;
  if (u.budget_id) {
    const r = await request(ctx, { method: 'PUT', url: `${msBase(env)}/Budgets`, headers: msHeaders(env), json: { Budgets: [{ Id: String(u.budget_id), Amount: u.new_daily }] } });
    if (!r.ok || msErrors(r)) throw new Error(msErrors(r) || fail(r, ctx, 'Microsoft Ads Budgets'));
    return { ref: u.ref, detail: `Microsoft Ads budget ${u.budget_id} ${u.old_daily} -> ${u.new_daily}` };
  }
  const id = String(u.ref).split('/')[0].replace(/\D/g, '');
  if (!id) throw new Error(`no Microsoft Ads campaign id in "${u.ref}"`);
  const r = await request(ctx, { method: 'PUT', url: `${msBase(env)}/Campaigns`, headers: msHeaders(env), json: { AccountId: String(env.MSADS_ACCOUNT_ID), Campaigns: [{ Id: id, DailyBudget: u.new_daily }] } });
  if (!r.ok || msErrors(r)) throw new Error(msErrors(r) || fail(r, ctx, 'Microsoft Ads Campaigns'));
  return { ref: u.ref, detail: `Microsoft Ads campaign ${id} daily budget ${u.old_daily} -> ${u.new_daily}` };
}

// Pauses a Microsoft Ads campaign (kill switch signature: ref, env, dryRun, opts). Only ever lowers spend.
// Never throws: errors come back as ok:false so the kill switch still raises its alert.
export async function pauseMicrosoft(ref, env = {}, dryRun = false, opts = {}) {
  const id = String(ref ?? '').split('/')[0].replace(/\D/g, '');
  if (!id) return { ok: false, detail: `no Microsoft Ads campaign id to pause in "${redact(ref, env).slice(0, 80)}"` };
  if (dryRun) return { ok: true, detail: `would pause Microsoft Ads campaign ${id}` };
  const miss = missingKeys(env, MS_NEEDS);
  if (miss.length) return { ok: false, detail: `missing ${miss.join(', ')}; cannot pause Microsoft Ads campaign ${id}` };
  const ctx = { env, fetch: opts.fetch };
  try {
    const r = await request(ctx, { method: 'PUT', url: `${msBase(env)}/Campaigns`, headers: msHeaders(env), json: { AccountId: String(env.MSADS_ACCOUNT_ID), Campaigns: [{ Id: id, Status: 'Paused' }] } });
    if (!r.ok || msErrors(r)) return { ok: false, detail: redact(msErrors(r) || fail(r, ctx, 'Microsoft Ads pause'), env) };
    return { ok: true, detail: `paused Microsoft Ads campaign ${id}` };
  } catch (e) { return { ok: false, detail: redact(e.message ?? e, env) }; }
}

export const metaBudget = makeConnector({ platform: 'meta', name: 'meta-budget', needs: ['META_ACCESS_TOKEN'], describe: 'ad set or campaign daily_budget through the Marketing API', call: metaCall });
export const googleBudget = makeConnector({
  platform: 'google', name: 'google-ads-budget', describe: 'campaign budget amountMicros through campaignBudgets:mutate', call: googleCall,
  needs: ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_ACCESS_TOKEN or GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN'],
  required: (env) => [...['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID'].filter((k) => !env[k]), ...googleMissing(env)],
});
export const tiktokBudget = makeConnector({ platform: 'tiktok', name: 'tiktok-budget', needs: ['TIKTOK_ACCESS_TOKEN', 'TIKTOK_ADVERTISER_ID'], describe: 'campaign or ad group budget', call: tiktokCall, unverified: 'TikTok campaign/update and adgroup/budget/update field names: verify against current API docs.' });
export const linkedinBudget = makeConnector({ platform: 'linkedin', name: 'linkedin-budget', needs: ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_AD_ACCOUNT_ID'], describe: 'campaign dailyBudget (PARTIAL_UPDATE)', call: linkedinCall });
export const microsoftBudget = makeConnector({ platform: 'microsoft', name: 'microsoft-ads-budget', needs: MS_NEEDS, describe: 'campaign DailyBudget or Budget Amount (Campaign Management v13 REST)', call: microsoftCall, unverified: 'Microsoft Ads REST UpdateBudgets body: verify against current API docs.' });

export const budgetConnectors = [metaBudget, googleBudget, tiktokBudget, linkedinBudget, microsoftBudget];
// A budget_update goes only to these connectors, never to a creating connector (which would open a new campaign).
export const pickBudget = (item, env = process.env) => (isBudgetUpdate(item) ? budgetConnectors.find((c) => c.accepts(item) && c.configured(env)) ?? null : null);
export default budgetConnectors;
