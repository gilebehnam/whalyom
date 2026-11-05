// CPA kill-switch: protects paid budgets by pausing ad variants that waste money.
// Reads campaign rows from metrics/kpis.json: {date, channel, campaign, metric: "spend"|"conversions", value}
// over the last 14 days. A campaign/variant is paused when:
//   - it spent at least budget.variant_kill_spend (default 5) with zero conversions, or
//   - its CPA is above goals.cpa_max after spending at least 3 × cpa_max.
// Pausing is protective (it only stops spend), so it runs at every autonomy level. Channels with a
// pause-capable connector are paused through the API; the rest raise a critical owner alert.
// Usage: node tools/killswitch.mjs <slug> [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, readJson, writeJson, root } from './lib/env.mjs';
import { pause as pauseMeta } from './connectors/meta-ads.mjs';
import { pauseGoogle } from './connectors/ads.mjs';
import { pause as pauseTiktok } from './connectors/tiktok-ads.mjs';
import { pause as pauseLinkedin } from './connectors/linkedin-ads.mjs';
import { pause as pauseReddit } from './connectors/reddit-ads.mjs';
import { pause as pauseXAds } from './connectors/x-ads.mjs';
import { pause as pauseApple } from './connectors/apple-search-ads.mjs';
import { pauseMicrosoft } from './connectors/budgets.mjs';
import { pause as pauseAmazon } from './connectors/amazon-ads.mjs';
import { pause as pauseWalmart } from './connectors/walmart-connect.mjs';

loadEnv();
const [slug, ...rest] = process.argv.slice(2);
if (!slug) { console.error('Usage: node tools/killswitch.mjs <slug> [--dry-run]'); process.exit(2); }
const dryRun = rest.includes('--dry-run');
const dir = path.join(root, 'products', slug);
const product = readJson(path.join(dir, 'product.json'), {});
const now = new Date();
const since = new Date(now - 14 * 86400 * 1000).toISOString().slice(0, 10);
const killSpend = Number(product.budget?.variant_kill_spend ?? 5);
const cpaMax = Number(product.goals?.cpa_max ?? 0);

const totals = {};
for (const r of readJson(path.join(dir, 'metrics', 'kpis.json'), [])) {
  if (!r.campaign || String(r.date) < since) continue;
  const k = `${r.channel}|${r.campaign}`;
  const t = (totals[k] ??= { channel: r.channel, campaign: r.campaign, spend: 0, conversions: 0 });
  if (r.metric === 'spend') t.spend += Number(r.value || 0);
  if (r.metric === 'conversions') t.conversions += Number(r.value || 0);
}

const stateFile = path.join(dir, 'killswitch.json');
const done = readJson(stateFile, []);
const pausers = {
  meta: (ref) => (process.env.META_ACCESS_TOKEN ? pauseMeta(ref, process.env, dryRun) : null),
  google: (ref) => (process.env.GOOGLE_ADS_DEVELOPER_TOKEN && process.env.GOOGLE_ADS_CUSTOMER_ID ? pauseGoogle(ref, process.env, dryRun) : null),
  tiktok: (ref) => (process.env.TIKTOK_ACCESS_TOKEN ? pauseTiktok(ref, process.env, dryRun) : null),
  linkedin: (ref) => (process.env.LINKEDIN_ACCESS_TOKEN && process.env.LINKEDIN_AD_ACCOUNT_ID ? pauseLinkedin(ref, process.env, dryRun) : null),
  reddit: (ref) => (process.env.REDDIT_ADS_ACCESS_TOKEN && process.env.REDDIT_ADS_ACCOUNT_ID ? pauseReddit(ref, process.env, dryRun) : null),
  x_ads: (ref) => (process.env.X_ADS_ACCESS_TOKEN && process.env.X_ADS_ACCOUNT_ID ? pauseXAds(ref, process.env, dryRun) : null),
  apple: (ref) => (process.env.APPLE_ADS_CLIENT_ID && process.env.APPLE_ADS_PRIVATE_KEY ? pauseApple(ref, process.env, dryRun) : null),
  microsoft: (ref) => (process.env.MSADS_ACCESS_TOKEN && process.env.MSADS_DEVELOPER_TOKEN && process.env.MSADS_CUSTOMER_ID && process.env.MSADS_ACCOUNT_ID ? pauseMicrosoft(ref, process.env, dryRun) : null),
  amazon: (ref) => (process.env.AMAZON_ADS_CLIENT_ID && process.env.AMAZON_ADS_CLIENT_SECRET && process.env.AMAZON_ADS_REFRESH_TOKEN && process.env.AMAZON_ADS_PROFILE_ID ? pauseAmazon(ref, process.env, dryRun) : null),
  walmart: (ref) => (process.env.WALMART_ADS_CONSUMER_ID && process.env.WALMART_ADS_PRIVATE_KEY && process.env.WALMART_ADS_AUTH_TOKEN && process.env.WALMART_ADS_ADVERTISER_ID ? pauseWalmart(ref, process.env, dryRun) : null),
};
const actions = [];
const alerts = readJson(path.join(dir, 'alerts.json'), []);
const events = [];
// Stable alert id: `node tools/needs-you-know.mjs resolve <key>` and the Command Center resolve by it.
const alertKey = (channel, campaign) => `killswitch:${channel}:${campaign}`;

for (const t of Object.values(totals)) {
  if (done.some((d) => d.channel === t.channel && d.campaign === t.campaign)) continue;
  let why = '';
  if (t.spend >= killSpend && t.conversions === 0) why = `spent ${t.spend.toFixed(2)} with no conversions (limit ${killSpend})`;
  else if (cpaMax > 0 && t.conversions > 0 && t.spend >= 3 * cpaMax && t.spend / t.conversions > cpaMax) why = `CPA ${(t.spend / t.conversions).toFixed(2)} over max ${cpaMax}`;
  if (!why) continue;
  const call = pausers[t.channel]?.(t.campaign);
  const result = call ? await call : { ok: false, detail: 'no pause connector for this channel' };
  const action = { at: now.toISOString(), channel: t.channel, campaign: t.campaign, why, paused: result.ok, detail: result.detail };
  actions.push(action);
  if (dryRun) continue;
  if (result.ok) done.push(action);
  // One open alert per channel+campaign: a variant that stays unpaused does not raise a new alert every
  // cycle (that flood pushed approvals off the Command Center). Legacy alerts without a key match by title.
  const key = alertKey(t.channel, t.campaign);
  const open = alerts.filter((a) => !a.resolved && (a.key === key || (!a.key && a.agent === 'om-cpa-guard' && [`Pause ${t.channel} ${t.campaign} now`, `Paused ${t.channel} ${t.campaign}`].includes(a.title))));
  if (!result.ok && open.length) {
    for (const a of open) { a.key = key; a.last_seen = now.toISOString(); a.repeats = Number(a.repeats ?? 1) + 1; a.detail = `${why}. No connector could pause it: pause it in the ad platform.`; }
    action.deduped = true;
    continue;
  }
  // Paused now: the earlier "pause it now" alert is answered.
  if (result.ok) for (const a of open) { a.resolved = true; a.resolved_at = now.toISOString(); a.resolved_by = 'om-cpa-guard'; }
  alerts.push({ key, level: result.ok ? 'warning' : 'critical', title: result.ok ? `Paused ${t.channel} ${t.campaign}` : `Pause ${t.channel} ${t.campaign} now`, detail: `${why}. ${result.ok ? 'Paused automatically by the CPA kill-switch.' : 'No connector could pause it: pause it in the ad platform.'}`, agent: 'om-cpa-guard', at: now.toISOString(), resolved: false });
  events.push({ at: now.toISOString(), agent: 'om-cpa-guard', product: slug, kind: 'blocked', text: `Kill-switch: ${t.channel} ${t.campaign} — ${why}` });
}

if (!dryRun && actions.length) {
  writeJson(stateFile, done);
  writeJson(path.join(dir, 'alerts.json'), alerts);
  if (events.length) fs.appendFileSync(path.join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
}
console.log(JSON.stringify({ slug, checked: Object.keys(totals).length, triggered: actions.length, alerted: events.length, deduped: actions.filter((a) => a.deduped).length, actions }));
