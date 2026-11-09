// Connector registry. Each connector says which approval items it can carry out, whether its
// secrets are present, and how to execute one item. Executors return {ok, ref, spent?, detail}.
// Add a connector: create a module exporting the same shape and list it below.
import webhook from './webhook.mjs';
import resend from './resend.mjs';
import siteGit from './site-git.mjs';
import metaAds from './meta-ads.mjs';
import localSite from './local-site.mjs';
import satelliteConn from './satellite.mjs';
import boosters from './boosters.mjs';
import { keyed as extraKeyed, exporters as extraExporters } from './extra.mjs';
import { budgetConnectors, pickBudget, isBudgetUpdate } from './budgets.mjs';
import instagram from './instagram.mjs';
import facebook from './facebook.mjs';
import tiktokPosting from './tiktok-posting.mjs';
import voice from './voice.mjs';
import amazonAds from './amazon-ads.mjs';
import walmartConnect from './walmart-connect.mjs';
import siteInstall from './site-install.mjs';
import twilioMessaging from './twilio-messaging.mjs';
import { creativeConnector } from '../creative-gen.mjs';

// Keyed connectors first (extra.mjs adds social, blogs, newsletters, indexing and ads APIs, each
// on its own channels only); the site repo, then the site's satellite, then local-site (zero-key
// fallback for publishing); webhook is the catch-all; opt-in ad CSV exporters come last.
// Budget-update connectors are listed first so status() shows them, but pick() routes a
// budget_update only to them (never to a creating connector). Organic social posting (Instagram,
// Facebook Page, TikTok Content Posting), the Twilio voice caller (type "call", one call per
// approval) and the retail-media APIs (Amazon Ads, Walmart Connect; created paused, Amazon only active when the approval says activate) each accept only
// their own channels and sit before the site publishers and the webhook catch-all. A module that
// extra.mjs also lists is kept once (first position wins). The Twilio messaging connector (one SMS or
// WhatsApp message per approved "send" on channel sms / whatsapp, opt-in required) and the AI creative
// generator (type "creative": generates from the approved brief, publishes nothing; the executor queues
// the publish approval draft through runs/) sit there too, before the webhook catch-all.
const own = [instagram, facebook, tiktokPosting, voice, twilioMessaging, amazonAds, walmartConnect, siteInstall, creativeConnector];
const ordered = [...budgetConnectors, boosters, metaAds, resend, ...extraKeyed, ...own, siteGit, satelliteConn, localSite, webhook, ...extraExporters];
export const connectors = ordered.filter((c, i) => ordered.findIndex((d) => d.name === c.name) === i);

// The first configured connector that accepts the item (and, for per-product connectors, is set up
// for this product) wins.
export function pick(item, env = process.env, ctx = null) {
  // A budget change on a live campaign goes only to a budget connector (or nowhere, so it is done by
  // hand): a creating connector, CSV exporter or webhook must never treat it as a new campaign.
  if (isBudgetUpdate(item)) return pickBudget(item, env);
  return connectors.find((c) => c.accepts(item, env) && c.configured(env) && (!c.usableFor || (ctx && c.usableFor({ ...ctx, env })))) ?? null;
}

export function status(env = process.env) {
  return connectors.map((c) => ({ name: c.name, configured: c.configured(env), needs: c.needs, handles: c.handles }));
}
