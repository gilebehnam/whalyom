// Zero-budget lead engine: the plan for getting leads and sales with no ad spend.
// In free mode the real budget is the owner's time and the product itself, so this tool spends hours,
// not money. It scores every free channel for the business (preset, market, stage, domain, what the
// channel has already produced in the funnel), fills the week's hours with the best ones plus one
// exploration slot, and gives every channel a tracked link so tools/funnel.mjs can credit its leads
// and sales. The next run moves hours toward channels that produced sales (a simple bandit).
//   products/<slug>/funnel/free-plan.json   channels, weekly quota, hours, agents, tracked link, why
//   products/<slug>/funnel/FREE-PLAN.md     the same for people
// product.json "free": {hours_per_week: 6, exclude: [], include: []} tunes it (all optional).
// Every outbound item the agents make from this plan is still a draft plus an approval.
// Usage: node tools/free-engine.mjs <slug> [--hours <n>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, root } from './lib/env.mjs';

// Fit per preset: 3 core, 2 strong, 1 possible, 0 skip. Missing preset → 1.
// hours: owner/agent hours a week for one unit of the quota; days: typical days to the first lead.
// utm: the source name the tracked link carries (and the channel the funnel credits).
export const CHANNELS = [
  { id: 'lead-magnet', label: 'Lead magnet and capture page', utm: 'lead-magnet', medium: 'owned', quota: '1 magnet, then 1 improvement a week', hours: 2, days: 7, needs_domain: true, agents: ['om-lead-magnet', 'om-landing-builder', 'om-popup-designer'], fit: { saas: 3, ecommerce: 3, local_service: 2, b2b_services: 3, info_product: 3, mobile_app: 1, marketplace: 2, creator_media: 3 }, rule: 'Capture with explicit consent; the magnet delivers what the page promises.' },
  { id: 'onsite-cro', label: 'Convert the traffic you already have', utm: 'site', medium: 'owned', quota: '1 test or fix a week', hours: 1.5, days: 3, needs_domain: true, agents: ['om-cro', 'om-friction-finder', 'om-micro-trust-strip'], fit: { saas: 3, ecommerce: 3, local_service: 3, b2b_services: 2, info_product: 3, mobile_app: 2, marketplace: 3, creator_media: 2 }, rule: 'Fix broken steps first, then test one change at a time.' },
  { id: 'seo-quick-wins', label: 'Search pages that can rank soon', utm: 'organic', medium: 'seo', quota: '2 pages a week', hours: 2, days: 30, needs_domain: true, agents: ['om-keyword-researcher', 'om-writer', 'om-editor'], fit: { saas: 3, ecommerce: 3, local_service: 2, b2b_services: 2, info_product: 2, mobile_app: 1, marketplace: 3, creator_media: 2 }, rule: 'Low-difficulty buyer queries first; one real answer per page, no thin pages.' },
  { id: 'ai-answers', label: 'Be cited in AI answers (ChatGPT, Perplexity, Gemini)', utm: 'ai', medium: 'referral', quota: '1 citable page or listing a week', hours: 1, days: 21, needs_domain: true, agents: ['om-geo-optimizer', 'om-aeo-chatgpt', 'om-ai-answer-monitor'], fit: { saas: 3, ecommerce: 2, local_service: 2, b2b_services: 3, info_product: 2, mobile_app: 1, marketplace: 2, creator_media: 1 }, rule: 'Answer the buyer question in the first lines with facts from claims.md.' },
  { id: 'free-listings', label: 'Free shopping and map listings (Google, Bing, Pinterest, Apple Maps)', utm: 'free-listings', medium: 'listing', quota: 'set up once, fix errors weekly', hours: 1, days: 7, agents: ['om-free-listings-manager', 'om-merchant-feed'], fit: { saas: 0, ecommerce: 3, local_service: 3, b2b_services: 0, info_product: 1, mobile_app: 0, marketplace: 2, creator_media: 0 }, rule: 'Feed facts match the page exactly: price, stock, shipping, returns.' },
  { id: 'local-profile', label: 'Google Business Profile and local reviews', utm: 'gbp', medium: 'local', quota: '2 posts and every review answered a week', hours: 1, days: 7, agents: ['om-local-seo', 'om-review-responder'], fit: { saas: 0, ecommerce: 1, local_service: 3, b2b_services: 1, info_product: 0, mobile_app: 0, marketplace: 0, creator_media: 0 }, rule: 'Real address and hours only; ask every happy customer, never pay for reviews.' },
  { id: 'communities', label: 'Helpful answers where buyers already ask (Reddit, forums, groups, Quora)', utm: 'community', medium: 'social', quota: '5 answers a week', hours: 2, days: 3, agents: ['om-community-lead-hunter', 'om-etiquette-checker', 'om-micro-community-reply'], fit: { saas: 3, ecommerce: 2, local_service: 2, b2b_services: 2, info_product: 3, mobile_app: 2, marketplace: 2, creator_media: 2 }, rule: 'Help first; mention the product only where the community allows it, with disclosure.' },
  { id: 'short-video', label: 'Short video (TikTok, Reels, Shorts)', utm: 'short-video', medium: 'social', quota: '3 videos a week', hours: 3, days: 7, agents: ['om-video-scripter', 'om-tiktok', 'om-youtube-shorts'], fit: { saas: 1, ecommerce: 3, local_service: 2, b2b_services: 1, info_product: 3, mobile_app: 3, marketplace: 1, creator_media: 3 }, rule: 'Product in use in the first seconds; one idea per video; link in bio with tracking.' },
  { id: 'founder-social', label: 'Founder posts on LinkedIn or X', utm: 'founder-social', medium: 'social', quota: '3 posts a week', hours: 1.5, days: 7, agents: ['om-linkedin', 'om-x', 'om-founder-brand'], fit: { saas: 3, ecommerce: 1, local_service: 1, b2b_services: 3, info_product: 2, mobile_app: 1, marketplace: 2, creator_media: 3 }, rule: 'True stories and specific lessons; no engagement pods or bought followers.' },
  { id: 'warm-network', label: 'Warm network: people who already know you', utm: 'warm-network', medium: 'personal', quota: '10 personal messages a week, sent by the owner', hours: 1, days: 2, agents: ['om-warm-network-activator'], fit: { saas: 2, ecommerce: 2, local_service: 3, b2b_services: 3, info_product: 2, mobile_app: 1, marketplace: 2, creator_media: 1 }, rule: 'Personal, one at a time, sent by the owner; no bulk messages, stop at the first no.' },
  { id: 'customer-referrals', label: 'Referrals, reviews and UGC from existing customers', utm: 'referral', medium: 'referral', quota: 'ask every new customer; 1 loop improvement a month', hours: 1, days: 7, agents: ['om-ugc-review-engine', 'om-referral-affiliate', 'om-advocacy'], fit: { saas: 2, ecommerce: 3, local_service: 3, b2b_services: 2, info_product: 2, mobile_app: 3, marketplace: 3, creator_media: 2 }, rule: 'Rewards are disclosed; reviews are asked of all customers, never only happy ones, never paid.' },
  { id: 'partner-swaps', label: 'Zero-cost partner swaps (bundles, newsletter swaps, co-posts)', utm: 'partner', medium: 'partner', quota: '3 partner asks a week', hours: 1.5, days: 14, agents: ['om-barter-partnerships', 'om-partner-scout', 'om-co-marketing'], fit: { saas: 2, ecommerce: 3, local_service: 2, b2b_services: 3, info_product: 3, mobile_app: 2, marketplace: 2, creator_media: 3 }, rule: 'Complementary, not competing; written terms; each side discloses the partnership.' },
  { id: 'directories', label: 'Directories, launch sites and marketplaces', utm: 'directory', medium: 'listing', quota: '3 listings a week until done', hours: 1, days: 7, agents: ['om-directory-submitter', 'om-launch-platforms', 'om-marketplace-lister'], fit: { saas: 3, ecommerce: 1, local_service: 2, b2b_services: 2, info_product: 1, mobile_app: 2, marketplace: 2, creator_media: 1 }, rule: 'Relevant directories only; copy tailored per site.' },
  { id: 'pr-quotes', label: 'Free PR: journalist requests and podcasts', utm: 'pr', medium: 'pr', quota: '3 pitches a week', hours: 1.5, days: 21, agents: ['om-expert-quotes', 'om-podcast-guesting', 'om-pr-outreach'], fit: { saas: 2, ecommerce: 2, local_service: 1, b2b_services: 3, info_product: 2, mobile_app: 1, marketplace: 2, creator_media: 2 }, rule: 'Answer only what the owner can speak to; facts from claims.md.' },
  { id: 'giveaway', label: 'Giveaway or contest (prize is the product, not cash)', utm: 'giveaway', medium: 'social', quota: '1 a month at most', hours: 2, days: 7, agents: ['om-contest-designer', 'om-endorsement-compliance'], fit: { saas: 0, ecommerce: 3, local_service: 2, b2b_services: 0, info_product: 2, mobile_app: 2, marketplace: 1, creator_media: 3 }, rule: 'Official rules, no purchase needed, platform promotion rules; collect consent for marketing separately.' },
  { id: 'email-list', label: 'Email the list you already have (consented)', utm: 'email', medium: 'email', quota: '1 newsletter and the triggered flows', hours: 1.5, days: 1, agents: ['om-email-nurture', 'om-newsletter-editor', 'om-cart-recovery'], fit: { saas: 3, ecommerce: 3, local_service: 2, b2b_services: 2, info_product: 3, mobile_app: 1, marketplace: 2, creator_media: 3 }, rule: 'Consented contacts only, one-click unsubscribe, sender address (CAN-SPAM, GDPR).' },
  { id: 'free-tool', label: 'Free tool or template that earns links and leads', utm: 'free-tool', medium: 'owned', quota: '1 tool a quarter', hours: 3, days: 30, needs_domain: true, agents: ['om-free-tool-builder', 'om-template-maker'], fit: { saas: 3, ecommerce: 1, local_service: 1, b2b_services: 2, info_product: 2, mobile_app: 1, marketplace: 2, creator_media: 1 }, rule: 'Useful without signing up; the lead capture is optional and consented.' },
  { id: 'whatsapp-telegram', label: 'WhatsApp or Telegram catalog and channel', utm: 'messaging', medium: 'messaging', quota: '1 catalog, then 3 channel posts a week', hours: 1, days: 3, agents: ['om-whatsapp', 'om-telegram', 'om-messaging-compliance'], fit: { saas: 0, ecommerce: 2, local_service: 2, b2b_services: 0, info_product: 1, mobile_app: 0, marketplace: 1, creator_media: 1 }, markets: ['BR', 'IN', 'TR', 'IR', 'AE', 'SA', 'EG', 'ID', 'MX', 'ES', 'IT', 'DE'], rule: 'Opt-in only, approved templates, quiet hours.' },
];

const MIN_LEADS_TO_JUDGE = 5;

// Scores and allocates. pure: product, report (funnel/report.json or null), hours.
export function freePlan(product, report = null, { hours = null, now = new Date().toISOString() } = {}) {
  const preset = product.preset ?? 'saas';
  const cfg = product.free ?? {};
  const budgetHours = Number(hours ?? cfg.hours_per_week ?? 6) || 6;
  const markets = (product.market ?? []).map((m) => String(m).toUpperCase());
  const hasDomain = Boolean(product.domain);
  const byChannel = Object.fromEntries((report?.channels ?? []).map((c) => [c.channel, c]));
  const exclude = new Set(cfg.exclude ?? []); const include = new Set(cfg.include ?? []);

  const scored = CHANNELS.map((c) => {
    const why = [];
    let fit = c.fit[preset] ?? 1;
    if (include.has(c.id)) { fit = Math.max(fit, 2); why.push('owner asked for it'); }
    if (c.markets && !markets.some((m) => c.markets.includes(m))) { fit = Math.min(fit, 1); why.push('fits other markets better'); }
    let score = fit * 10;
    // Faster first lead scores higher: free mode lives on early wins.
    score += Math.max(0, 6 - Math.log2(c.days + 1));
    if (c.needs_domain && !hasDomain) { score *= 0.3; why.push('needs a site; add the domain first'); }
    // Learned: what this channel has produced so far (tools/funnel.mjs credits by utm source).
    const seen = byChannel[c.utm];
    let tested = false;
    if (seen && seen.leads >= MIN_LEADS_TO_JUDGE) {
      tested = true;
      const perHour = (seen.leads_30d ?? 0) / Math.max(1, c.hours * 4);
      score += Math.min(20, perHour * 4) + Math.min(25, (seen.won ?? 0) * 5);
      why.push(`${seen.leads} leads and ${seen.won} sales so far`);
      if ((seen.won ?? 0) === 0 && seen.leads >= 20) { score *= 0.6; why.push('many leads, no sales yet: fix the follow-up before adding more'); }
    } else if (seen) why.push(`${seen.leads} lead(s) so far, too few to judge`);
    if (fit === 0 && !include.has(c.id)) score = 0;
    if (exclude.has(c.id)) { score = 0; why.push('owner excluded it'); }
    return { ...c, fit, score: Math.round(score * 10) / 10, tested, why };
  }).sort((a, b) => b.score - a.score);

  // Fill the hours: best channels first, ~80% to proven or core channels, one exploration slot after.
  const plan = []; let left = budgetHours;
  const core = scored.filter((c) => c.score > 0);
  for (const c of core) {
    if (left - c.hours < budgetHours * 0.2 && plan.length >= 2) break;
    if (c.hours > left) continue;
    plan.push({ ...c, slot: c.tested ? 'proven' : 'core' }); left -= c.hours;
  }
  const explore = core.find((c) => !plan.some((p) => p.id === c.id) && !c.tested && c.hours <= Math.max(left, 1));
  if (explore) { plan.push({ ...explore, slot: 'explore' }); left -= explore.hours; }

  const week = (() => { const d = new Date(now); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10); })();
  const base = hasDomain ? `https://${String(product.domain).replace(/^https?:\/\//, '').replace(/\/+$/, '')}/` : null;
  const link = (c) => (base ? `${base}?utm_source=${c.utm}&utm_medium=${c.medium}&utm_campaign=free-${week}` : null);

  return {
    updated_at: now, week, preset, mode: product.budget?.mode ?? 'free', hours_per_week: budgetHours, hours_planned: Math.round((budgetHours - left) * 10) / 10,
    channels: plan.map((c) => ({ id: c.id, label: c.label, slot: c.slot, quota: c.quota, hours: c.hours, days_to_first_lead: c.days, agents: c.agents, utm_source: c.utm, utm_medium: c.medium, link: link(c), score: c.score, why: c.why, rule: c.rule })),
    skipped: scored.filter((c) => !plan.some((p) => p.id === c.id)).map((c) => ({ id: c.id, score: c.score, why: c.why })),
    // The loop that turns free attention into sales; every step is measured in the funnel.
    loop: ['attract (channels above, each with its tracked link)', 'capture (lead magnet or offer with consent, on the site or the edge snippet)', 'respond within the speed-to-lead limit (om-lead-to-sale)', 'nurture and qualify (om-email-nurture, om-sdr)', 'close (checkout or booking link, om-checkout-finisher; cart recovery for stores)', 'ask for referral, review or UGC (om-ugc-review-engine)', 'measure (tools/funnel.mjs) and move hours to what sells (this tool)'],
  };
}

export function freePlanMarkdown(name, plan) {
  return [
    `# Zero-budget plan: ${name}`, '', `Week of ${plan.week}. ${plan.hours_planned} of ${plan.hours_per_week} hours a week planned. No ad spend: every channel below costs time, not money, and each item is a draft plus an approval before anything goes out.`, '',
    '| Channel | Slot | Quota | Hours/wk | First lead in | Agents | Tracked link |', '|---|---|---|---|---|---|---|',
    ...plan.channels.map((c) => `| ${c.label} | ${c.slot} | ${c.quota} | ${c.hours} | ~${c.days_to_first_lead} days | ${c.agents.join(', ')} | ${c.link ?? '(add a domain)'} |`),
    '', '## Why these', '', ...plan.channels.map((c) => `- **${c.label}** (score ${c.score}): ${c.why.length ? c.why.join('; ') : 'strong fit for this kind of business'}. Rule: ${c.rule}`),
    '', '## The loop', '', ...plan.loop.map((s, i) => `${i + 1}. ${s}`),
    '', `Not this week: ${plan.skipped.filter((s) => s.score > 0).slice(0, 8).map((s) => s.id).join(', ') || 'none'}.`, '',
  ].join('\n');
}

export function runFreeEngine(slug, { hours = null, now = new Date().toISOString() } = {}) {
  const dir = path.join(root, 'products', slug);
  const product = readJson(path.join(dir, 'product.json'), null);
  if (!product) throw new Error(`no product ${slug}`);
  const report = readJson(path.join(dir, 'funnel', 'report.json'), null);
  const plan = freePlan(product, report, { hours, now });
  fs.mkdirSync(path.join(dir, 'funnel'), { recursive: true });
  writeJson(path.join(dir, 'funnel', 'free-plan.json'), plan);
  fs.writeFileSync(path.join(dir, 'funnel', 'FREE-PLAN.md'), freePlanMarkdown(product.name ?? slug, plan));
  return { slug, week: plan.week, hours: plan.hours_planned, channels: plan.channels.map((c) => `${c.id}:${c.slot}`) };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const slug = argv.find((a) => !a.startsWith('--'));
  if (!slug) { console.error('Usage: node tools/free-engine.mjs <slug> [--hours <n>]'); process.exit(2); }
  const i = argv.indexOf('--hours');
  console.log(JSON.stringify(runFreeEngine(slug, { hours: i > -1 ? Number(argv[i + 1]) : null })));
}
