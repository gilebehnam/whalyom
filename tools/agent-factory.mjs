// Micro-agent factory: parameterized instances of the core Whalyom employees.
// A micro-agent is a core agent (.claude/agents/om-*.md) plus a specialization (business
// vertical, channel, or both) that is appended to its brief at dispatch. This keeps one tested
// definition per role while hundreds of specialists can run in parallel.
//   node tools/agent-factory.mjs            → writes state/micro-agents.json and prints counts
//   node tools/agent-factory.mjs --for <slug> <agent> [channel] [market]   → prints the instance to use for that product
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { roster, DEPARTMENTS } from './roster.mjs';
import { readJson, root } from './lib/env.mjs';

const presets = readJson(path.join(root, 'tools', 'presets.json'), { presets: {} }).presets;
const VERTICALS = Object.keys(presets);
const CHANNEL_AGENTS = {
  'om-google-ads': ['search', 'pmax', 'youtube', 'display'],
  'om-meta-ads': ['prospecting', 'retargeting', 'advantage-plus', 'lead-forms'],
  'om-tiktok-ads': ['spark-ads', 'in-feed'],
  'om-linkedin-ads': ['sponsored-content', 'lead-gen-forms', 'conversation-ads'],
  'om-reddit-ads': ['subreddit', 'interest'],
  'om-x-ads': ['keyword', 'follower-lookalike'],
  'om-ad-creative': ['google', 'meta', 'tiktok', 'linkedin', 'reddit', 'x'],
  'om-hook-writer': ['tiktok', 'reels', 'shorts', 'x', 'linkedin'],
  'om-cold-outbound': ['email', 'linkedin'],
  'om-speed-to-lead': ['web-chat', 'email', 'dm'],
  'om-directory-submitter': ['saas', 'ai-tools', 'startup', 'niche'],
  'om-programmatic-seo': ['vs-pages', 'alternatives', 'use-cases', 'templates', 'integrations', 'locations'],
  'om-writer': ['how-to', 'comparison', 'listicle', 'guide', 'case-study'],
  // Wave 2
  'om-pseo-qa': ['vs-pages', 'alternatives', 'use-cases', 'templates', 'integrations', 'locations'],
  'om-creative-matrix': ['meta', 'tiktok', 'youtube', 'linkedin'],
  'om-trend-jacker': ['tiktok', 'reels', 'x', 'linkedin'],
  'om-thumbnail-tester': ['youtube', 'shorts'],
  'om-store-screenshots': ['app-store', 'google-play', 'chrome-web-store'],
  'om-review-responder': ['g2', 'capterra', 'trustpilot', 'app-store', 'google-play', 'google-business'],
  'om-etiquette-checker': ['reddit', 'hacker-news', 'indie-hackers', 'product-hunt'],
  'om-newsletter-growth': ['substack', 'beehiiv', 'kit'],
  'om-merchant-feed': ['google-merchant', 'microsoft-merchant'],
  'om-ai-ads': ['chatgpt', 'perplexity', 'copilot'],
  'om-placement-guard': ['display', 'youtube', 'audience-network', 'pmax'],
  'om-bid-strategist': ['google', 'microsoft', 'meta'],
  'om-abm-orchestrator': ['tier-1', 'tier-2', 'tier-3'],
  'om-reply-handler': ['email', 'linkedin'],
  'om-capi-planner': ['ga4-mp', 'meta-capi', 'tiktok-events', 'google-enhanced-conversions', 'linkedin-capi'],
  'om-revenue-reconciler': ['stripe', 'paddle', 'lemon-squeezy', 'shopify'],
};
// Roles whose work changes by business type get one instance per vertical.
const VERTICAL_DEPTS = new Set(['intel', 'strategy', 'funnel', 'creative', 'seo', 'social', 'paid', 'leadgen', 'closer', 'lifecycle', 'pr', 'partners', 'global', 'commerce', 'growth-free']);

// Roles whose work changes by target market get one instance per market. The om-l10n-* agents
// are already one agent per market, so they are not listed here.
export const MARKETS = ['de', 'fr', 'es', 'pt-br', 'ja', 'ar', 'tr', 'it'];
const MARKET_AGENTS = new Set(['om-ppp-pricing', 'om-checkout-localizer', 'om-store-screenshots', 'om-whatsapp', 'om-privacy-officer']);
// product.json "market" holds country codes; this maps them to the market instances above.
const COUNTRY_MARKET = {
  DE: 'de', AT: 'de', CH: 'de', FR: 'fr', BE: 'fr', LU: 'fr', ES: 'es', MX: 'es', AR: 'es', CO: 'es', CL: 'es', PE: 'es',
  BR: 'pt-br', JP: 'ja', SA: 'ar', AE: 'ar', EG: 'ar', QA: 'ar', KW: 'ar', BH: 'ar', OM: 'ar', JO: 'ar', MA: 'ar', TR: 'tr', IT: 'it',
};
export const marketsFor = (product) => [...new Set((product?.market ?? []).map((c) => COUNTRY_MARKET[String(c).toUpperCase()]).filter(Boolean))];

export function buildInstances() {
  const out = [];
  for (const a of roster) {
    const verticals = VERTICAL_DEPTS.has(a.dept) ? VERTICALS : [null];
    const channels = CHANNEL_AGENTS[a.name] ?? [null];
    const markets = MARKET_AGENTS.has(a.name) ? [null, ...MARKETS] : [null];
    for (const v of verticals) for (const c of channels) for (const m of markets) {
      const id = [a.name, v, c, m].filter(Boolean).join('::');
      const spec = [v && `business type: ${presets[v].label} (north star ${presets[v].north_star}; funnel ${presets[v].funnel.join(' → ')})`, c && `channel focus: ${c}`, m && `market focus: ${m}`].filter(Boolean).join('; ');
      out.push({ id, agent: a.name, title: a.title, dept: DEPARTMENTS[a.dept].name, layer: a.layer, vertical: v, channel: c, market: m, specialization: spec });
    }
  }
  return out;
}

// The instance a product should use for an agent: its preset vertical, first matching channel,
// and (for market-specific roles) the given market or the product's first mapped market.
export function instanceFor(product, agentName, channel, market) {
  const all = buildInstances().filter((i) => i.agent === agentName);
  const m = market ?? marketsFor(product)[0] ?? null;
  const okM = (i) => i.market === m || (!m && !i.market);
  return all.find((i) => i.vertical === product?.preset && (!channel || i.channel === channel) && okM(i))
    ?? all.find((i) => i.vertical === product?.preset && (!channel || i.channel === channel) && !i.market)
    ?? all.find((i) => i.vertical === product?.preset && !i.market)
    ?? all.find((i) => !i.vertical && okM(i))
    ?? all.find((i) => !i.vertical && !i.market) ?? all[0] ?? null;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  if (args[0] === '--for') {
    const product = readJson(path.join(root, 'products', args[1], 'product.json'), {});
    console.log(JSON.stringify(instanceFor(product, args[2], args[3], args[4])));
  } else {
    const all = buildInstances();
    fs.mkdirSync(path.join(root, 'state'), { recursive: true });
    fs.writeFileSync(path.join(root, 'state', 'micro-agents.json'), JSON.stringify(all));
    const byDept = all.reduce((m, i) => ({ ...m, [i.dept]: (m[i.dept] ?? 0) + 1 }), {});
    console.log(JSON.stringify({ core_agents: roster.length, micro_agents: all.length, by_department: byDept }));
  }
}
