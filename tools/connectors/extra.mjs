// Registry of the extended connectors, kept apart from index.mjs so the core registry stays small.
// index.mjs places `keyed` after meta-ads/resend and before the site publishers (each accepts only
// its own channels, so existing routing is unchanged) and `exporters` after the webhook catch-all
// (an automation-platform webhook always wins when one is configured).
import indexing from './indexing.mjs';
import social from './social.mjs';
import x from './x.mjs';
import blogs from './blogs.mjs';
import newsletters from './newsletters.mjs';
import { apiConnectors, csvExporters } from './ads.mjs';
import tiktokAds from './tiktok-ads.mjs';
import linkedinAds from './linkedin-ads.mjs';
import redditAds from './reddit-ads.mjs';
import xAds from './x-ads.mjs';
import appleSearchAds from './apple-search-ads.mjs';
import { readers } from './readers.mjs';

// Ad APIs sit in `keyed`: used only when their keys are configured; otherwise the item falls
// through to the webhook and then the opt-in CSV exporter (TikTok, Reddit) or manual (LinkedIn,
// X Ads, Apple Search Ads). X Ads takes x_ads/x-ads/twitter_ads only; plain "x" stays organic.
export const keyed = [...indexing, ...social, x, ...blogs, ...newsletters, ...apiConnectors, tiktokAds, linkedinAds, redditAds, xAds, appleSearchAds];
export const exporters = [...csvExporters];
export { readers };

// Status of every extended connector and reader: configured flag and the env NAMES still missing.
// Never includes a secret value.
export function extraStatus(env = process.env) {
  const row = (c, kind) => ({ name: c.name, kind, configured: c.configured(env), missing: c.missing(env), needs: c.needs, handles: c.handles, unverified: c.unverified ?? null });
  return [...keyed.map((c) => row(c, 'executor')), ...exporters.map((c) => row(c, 'exporter')), ...readers.map((r) => row(r, r.kind))];
}
