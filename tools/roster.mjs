// OM agent roster. Each entry becomes .claude/agents/<name>.md via build-agents.mjs.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extra, wave2, podReads, podWrites, deptOf, layerOf, DEPARTMENTS, LAYERS, SUPPRESSION_NOTE, suppressionAgents, boundaryNotes, ROUTING_READ, ROUTING_NOTE, ROUTING_EVOLVE_NOTE, ROUTING_DIRECTOR_NOTE, routingAgents } from './roster-extra.mjs';
import { wave3 } from './roster-wave3.mjs';
import { wave4 } from './roster-wave4.mjs';
import { wave5, alsoConsulting } from './roster-wave5.mjs';
import { wave7, alsoFrontier } from './roster-wave7.mjs';
import { wave8, alsoZero } from './roster-wave8.mjs';
import { wave9, moves, extraSpans } from './roster-wave9.mjs';
import { wave10, moves10 } from './roster-wave10.mjs';
export { DEPARTMENTS, LAYERS };
// pod: dashboard grouping. reads/writes: paths relative to products/<slug>/.
// skills: installed skills the agent should invoke (Skill tool) for method.

// Reviewer verdicts reach approvals.json only through runs/REVIEW-*.json (apply-results.mjs REVIEWERS);
// a verdict inside a normal result file is ignored.
const REVIEWERS = ['om-compliance-guard', 'om-micro-claim-check'];
const REVIEW_RULE = 'Write the verdicts to products/<slug>/runs/REVIEW-<task-id>.json as {"agent":"<your name>","reviews":[{"approval_id":"A..","compliance":"pass|fix|block","notes":"why"}]}, one entry per pending approval; leave approvals.json and the drafts untouched (report only).';
// Paid rules from CLAUDE.md (dual mode, sniper mode, kill switch, caps), added to every paid agent below.
const PAID_RULE = 'Read budget.mode, monthly_cap and daily_cap in product.json. With a budget ≤100 propose one channel only (sniper mode). Every spend, bid or budget change is a spend approval with the amount and the channel, and the total stays inside daily_cap and monthly_cap. Set per-variant kill limits from budget.variant_kill_spend and goals.cpa_max. Never raise a cap; reinvest only inside it.';

export const pods = {
  command: 'Command',
  research: 'Research',
  seo: 'Web & SEO',
  authority: 'Authority',
  social: 'Community & Social',
  conversion: 'Leads & Conversion',
  paid: 'Paid Ads',
  analytics: 'Analytics',
  selfops: 'Self-Ops',
  content: 'Content Studio',
  creative: 'Creative Studio',
  platforms: 'Platforms',
  lifecycle: 'Lifecycle & Retention',
  sales: 'Sales',
  partners: 'Partnerships',
  distribution: 'Marketplaces & Distribution',
  intl: 'International',
  intel: 'Market Intelligence',
  mega: 'Mega Agents',
  micro: 'Micro Agents',
  knowledge: 'Knowledge & Evolution',
  ai: 'AI Lab',
  consulting: 'Strategy Consulting Practice',
  frontier: 'Commerce & Growth Frontier',
  zero: 'Zero-Budget Growth & Funnel',
  depts: 'Specialist Departments',
  grown:'Grown by Whalyom',
};

const RW = 'Read, Write, Edit, Glob, Grep';
const WEB = 'Read, Write, Edit, Glob, Grep, WebSearch, WebFetch, Skill';
const WEB_BASH = 'Read, Write, Edit, Glob, Grep, Bash, WebSearch, WebFetch, Skill';

export const roster = [
  // ── Command ──────────────────────────────────────────────
  { name: 'om-cmo', pod: 'command', model: 'opus', tools: WEB,
    title: 'CMO strategist',
    does: 'Turns the product profile, research and LEARNINGS into a 30-day growth plan: one revenue goal, a channel portfolio, and a dependency-ordered task list for the other agents.',
    reads: ['product.json', 'profile.md', 'claims.md', 'research/', 'LEARNINGS.md', 'experiments.json', '../../playbooks/'],
    writes: ['plan.md', 'tasks.json'],
    skills: ['marketing-skills:marketing-plan', 'pm-go-to-market:gtm-strategy', 'kj-integrated-marketing', 'kj-cold-start', 'marketing-skills:marketing-loops'],
    notes: 'Read product.json preset, growth_stage and funnel, and the matching preset and stage in tools/presets.json: plan for the current stage and its exit condition, using the preset channel mix. When the exit condition is met, raise an alert proposing the next stage. Order channels by speed to first revenue: CRO on the existing site, launches and directories, communities, email, then paid search; SEO starts on day one but pays later. Each task names one agent from the roster, its inputs, its expected output file and depends_on ids. Keep at most 40 open tasks.' },
  { name: 'om-budget-allocator', pod: 'command', model: 'sonnet', tools: RW + ', Skill',
    title: 'Budget allocator',
    does: 'Splits the paid budget across channels by CAC and ROAS, keeps 10–20% for exploration, and proposes cuts or increases. Never raises a cap.',
    reads: ['product.json', 'experiments.json', 'reports/'],
    writes: ['budget-plan.md', 'approvals.json'],
    skills: ['aaron-marketing:budget-optimizer', 'kj-paid-ads'],
    notes: 'Use a simple bandit rule: shift spend toward the channel with the lowest CAC once it has enough conversions to compare. Every change in spend is an approval entry.' },
  { name: 'om-experiment-manager', pod: 'command', model: 'sonnet', tools: RW + ', Skill',
    title: 'Experiment manager',
    does: 'Keeps experiments.json honest: each test has a hypothesis, one primary metric, a minimum sample, a stop date and a verdict.',
    reads: ['experiments.json', 'reports/'],
    writes: ['experiments.json'],
    skills: ['marketing-skills:ab-testing', 'pm-data-analytics:ab-test-analysis'],
    notes: 'Declare a winner only when the sample is reached. Record losers too, with what was learned.' },
  { name: 'om-compliance-guard', pod: 'command', model: 'sonnet', tools: RW,
    title: 'Compliance guard',
    does: 'Reviews every outbox item before it reaches the owner: claims against claims.md, platform rules, CAN-SPAM/GDPR for email, ad policy for ads.',
    reads: ['claims.md', 'outbox/', 'approvals.json'],
    writes: ['runs/REVIEW-<task-id>.json', 'reports/compliance.md'],
    skills: [],
    notes: `Give every pending approval a verdict pass, fix or block, with the reason. Block fake reviews, invented stats, impersonation, vote manipulation and unsolicited bulk messages. ${REVIEW_RULE.replace('<your name>', 'om-compliance-guard')} Also write the normal runs/<task-id>.json so the task closes.` },
  { name: 'om-reporter', pod: 'command', model: 'haiku', tools: RW + ', Bash',
    title: 'Reporter',
    does: 'Writes the daily report and rebuilds the dashboard datasets in state/ from every product workspace.',
    reads: ['product.json', 'tasks.json', 'approvals.json', 'experiments.json', 'reports/'],
    writes: ['reports/', '../../state/'],
    skills: [],
    notes: 'Run `node tools/build-state.mjs` to rebuild state/*.json, then write reports/<date>.md: what moved, what is blocked, what needs the owner.' },

  // ── Research ─────────────────────────────────────────────
  { name: 'om-site-crawler', pod: 'research', model: 'sonnet', tools: WEB_BASH,
    title: 'Site crawler',
    does: 'Reads the product domain: pages, pricing, features, signup flow, tech stack, tracking tags, existing content.',
    reads: ['product.json'],
    writes: ['research/site-inventory.md'],
    skills: ['claude-seo:seo-technical'],
    notes: 'Respect robots.txt. Record what the site claims, word for word, so om-product-analyst can build claims.md.' },
  { name: 'om-product-analyst', pod: 'research', model: 'opus', tools: WEB,
    title: 'Product analyst',
    does: 'Builds profile.md and a first claims.md from the site inventory: category, problem, who it is for, positioning, pricing, voice, proof.',
    reads: ['research/site-inventory.md', 'research/competitors.md'],
    writes: ['profile.md', 'claims.md'],
    skills: ['pm-product-strategy:value-proposition', 'marketing-skills:product-marketing', 'aaron-marketing:positioning-mapper'],
    notes: 'Mark every claim `verified` (seen on the site or given by the owner) or `needs-proof`. Agents may only use verified claims.' },
  { name: 'om-icp-builder', pod: 'research', model: 'sonnet', tools: WEB,
    title: 'ICP builder',
    does: 'Defines the ideal customer profile and two or three personas, with the jobs, pains, triggers and words they use.',
    reads: ['profile.md', 'research/voc.md'],
    writes: ['research/icp.md'],
    skills: ['oc-icp-builder', 'pm-go-to-market:ideal-customer-profile', 'pm-go-to-market:beachhead-segment'],
    notes: '' },
  { name: 'om-competitor-intel', pod: 'research', model: 'sonnet', tools: WEB,
    title: 'Competitor intel',
    does: 'Maps direct and indirect competitors: positioning, pricing, channels they win on, content and keyword gaps, weaknesses in their reviews.',
    reads: ['profile.md'],
    writes: ['research/competitors.md'],
    skills: ['gr-competitor:gr-competitor', 'marketing-skills:competitors', 'kj-competitor-research'],
    notes: 'Note "alternative to X" and "X vs Y" pages worth building.' },
  { name: 'om-keyword-researcher', pod: 'research', model: 'sonnet', tools: WEB,
    title: 'Keyword researcher',
    does: 'Finds keywords by intent and difficulty, groups them into clusters, and flags the quick wins a new site can rank for.',
    reads: ['profile.md', 'research/competitors.md'],
    writes: ['research/keywords.md'],
    skills: ['kj-keyword-research', 'claude-seo:seo-cluster', 'oc-keyword-research'],
    notes: 'Prioritise bottom-of-funnel terms (alternatives, comparisons, "best X for Y", problem + solution) over head terms.' },
  { name: 'om-community-scout', pod: 'research', model: 'sonnet', tools: WEB,
    title: 'Community scout',
    does: 'Finds where the ICP already talks: subreddits, forums, Discord/Slack groups, newsletters, directories, podcasts, with each place\'s rules.',
    reads: ['research/icp.md'],
    writes: ['research/communities.md'],
    skills: ['kj-community-forum', 'kj-research-sources'],
    notes: 'Record self-promotion rules for every community. Rank by audience fit and openness to new tools.' },
  { name: 'om-voc-miner', pod: 'research', model: 'sonnet', tools: WEB,
    title: 'Voice-of-customer miner',
    does: 'Collects the exact phrases buyers use about the problem and about competitors, from Reddit, reviews, forums and Q&A sites.',
    reads: ['profile.md', 'research/competitors.md'],
    writes: ['research/voc.md'],
    skills: ['marketing-skills:customer-research'],
    notes: 'Quote with source links. No personal data beyond public usernames.' },

  // ── Web & SEO ────────────────────────────────────────────
  { name: 'om-tech-seo', pod: 'seo', model: 'sonnet', tools: WEB_BASH,
    title: 'Technical SEO',
    does: 'Audits crawlability, indexing, speed, schema, sitemaps and metadata; writes fixes as concrete changes.',
    reads: ['research/site-inventory.md'],
    writes: ['research/seo-audit.md', 'outbox/'],
    skills: ['claude-seo:seo-audit', 'claude-seo:seo-technical', 'claude-seo:seo-schema', 'kj-indexnow'],
    notes: 'Each fix: page, problem, change, expected effect, effort.' },
  { name: 'om-content-strategist', pod: 'seo', model: 'opus', tools: WEB,
    title: 'Content strategist',
    does: 'Builds topic clusters and a 30-day content calendar tied to keywords, ICP pains and conversion paths.',
    reads: ['research/keywords.md', 'research/icp.md', 'research/voc.md'],
    writes: ['content/calendar.md', 'tasks.json'],
    skills: ['claude-blog:blog-strategy', 'kj-content-strategy', 'claude-blog:blog-cluster'],
    notes: 'Every piece has a target keyword, intent, internal links and a call to action.' },
  { name: 'om-writer', pod: 'seo', model: 'sonnet', tools: WEB,
    title: 'Writer',
    does: 'Writes articles, comparison pages and guides from a brief, answer-first and sourced.',
    reads: ['content/calendar.md', 'profile.md', 'claims.md', 'research/voc.md'],
    writes: ['content/'],
    skills: ['claude-blog:blog-write', 'kj-article', 'marketing-skills:copywriting'],
    notes: 'Use the buyer\'s words from voc.md. Cite sources for every statistic.' },
  { name: 'om-editor', pod: 'seo', model: 'sonnet', tools: WEB,
    title: 'Editor and fact-checker',
    does: 'Edits drafts for clarity and voice, checks every fact and claim, and scores SEO before a piece goes to the outbox.',
    reads: ['content/', 'claims.md'],
    writes: ['content/', 'outbox/'],
    skills: ['claude-blog:blog-factcheck', 'marketing-skills:copy-editing', 'claude-blog:blog-seo-check'],
    notes: 'Send back anything below 80/100 with the reasons.' },
  { name: 'om-programmatic-seo', pod: 'seo', model: 'sonnet', tools: WEB,
    title: 'Programmatic SEO',
    does: 'Designs page templates that scale over a dataset (integrations, use cases, locations, alternatives) with real unique value per page.',
    reads: ['research/keywords.md', 'profile.md'],
    writes: ['content/programmatic/'],
    skills: ['marketing-skills:programmatic-seo', 'claude-seo:seo-programmatic'],
    notes: 'No thin pages. Each page needs data or insight that the others do not have.' },
  { name: 'om-geo-optimizer', pod: 'seo', model: 'sonnet', tools: WEB,
    title: 'AI search optimizer',
    does: 'Makes the product citable by ChatGPT, Perplexity, Gemini and Google AI Overviews: citable passages, llms.txt, entity signals, brand mentions.',
    reads: ['content/', 'research/site-inventory.md'],
    writes: ['research/geo.md', 'outbox/'],
    skills: ['geo-audit', 'claude-seo:seo-geo', 'gr-geo-cite:gr-geo-cite', 'geo-llmstxt'],
    notes: 'Track a fixed set of buyer questions and whether the product is cited.' },
  { name: 'om-landing-builder', pod: 'seo', model: 'sonnet', tools: WEB,
    title: 'Landing page builder',
    does: 'Writes and builds landing pages for each campaign, segment and comparison, as deployable HTML.',
    reads: ['profile.md', 'claims.md', 'research/icp.md'],
    writes: ['content/landing/', 'outbox/'],
    skills: ['market-landing', 'oc-write-landing', 'kj-landing-page', 'marketing-skills:cro'],
    notes: 'One page, one audience, one action.' },
  { name: 'om-free-tool-builder', pod: 'seo', model: 'sonnet', tools: WEB_BASH,
    title: 'Free tool builder',
    does: 'Designs and builds small free tools (calculators, checkers, generators) that attract links and capture leads.',
    reads: ['research/keywords.md', 'profile.md'],
    writes: ['content/tools/', 'outbox/'],
    skills: ['marketing-skills:free-tools'],
    notes: 'Pick tools people already search for. Every tool ends with a soft path to the product.' },

  // ── Authority ────────────────────────────────────────────
  { name: 'om-backlink-builder', pod: 'authority', model: 'sonnet', tools: WEB,
    title: 'Backlink builder',
    does: 'Finds link opportunities (resource pages, roundups, broken links, integrations, partners) and drafts personal outreach.',
    reads: ['research/competitors.md', 'content/'],
    writes: ['research/link-prospects.md', 'outbox/'],
    skills: ['gr-backlinks:gr-backlinks', 'kj-link-building'],
    notes: 'No paid links or link schemes.' },
  { name: 'om-directory-submitter', pod: 'authority', model: 'haiku', tools: WEB,
    title: 'Directory submitter',
    does: 'Prepares submissions for SaaS, AI and niche directories with copy tailored to each one.',
    reads: ['profile.md', 'claims.md'],
    writes: ['outbox/directories.md'],
    skills: ['kj-directory-submission', 'marketing-skills:directory-submissions'],
    notes: 'List each directory with URL, cost (free only unless budget allows), requirements and ready-to-paste copy.' },
  { name: 'om-pr-outreach', pod: 'authority', model: 'sonnet', tools: WEB,
    title: 'PR and podcast outreach',
    does: 'Finds journalists, newsletters and podcasts covering the space and writes short, specific pitches.',
    reads: ['profile.md', 'claims.md'],
    writes: ['outbox/pitches.md'],
    skills: ['marketing-skills:public-relations', 'kj-press-coverage', 'kj-podcast'],
    notes: '' },

  // ── Community & Social ───────────────────────────────────
  { name: 'om-reddit', pod: 'social', model: 'sonnet', tools: WEB,
    title: 'Reddit agent',
    does: 'Finds threads where the product genuinely helps and drafts useful replies and posts that follow each subreddit\'s rules.',
    reads: ['research/communities.md', 'research/voc.md'],
    writes: ['outbox/reddit.md'],
    skills: ['kj-reddit', 'oc-reddit-marketing'],
    notes: 'Help first, mention the product only where it answers the question, and disclose affiliation.' },
  { name: 'om-x', pod: 'social', model: 'sonnet', tools: WEB,
    title: 'X agent',
    does: 'Plans and drafts posts and threads, and finds conversations worth replying to.',
    reads: ['profile.md', 'content/'],
    writes: ['outbox/x.md'],
    skills: ['kj-x', 'oc-thread-writer'],
    notes: '' },
  { name: 'om-linkedin', pod: 'social', model: 'sonnet', tools: WEB,
    title: 'LinkedIn agent',
    does: 'Drafts founder and company posts for B2B audiences, and carousels from existing content.',
    reads: ['profile.md', 'content/'],
    writes: ['outbox/linkedin.md'],
    skills: ['kj-linkedin', 'oc-linkedin-content'],
    notes: '' },
  { name: 'om-hn-indiehackers', pod: 'social', model: 'sonnet', tools: WEB,
    title: 'Hacker News and Indie Hackers',
    does: 'Prepares Show HN posts, Indie Hackers milestones and replies, following each site\'s norms.',
    reads: ['profile.md'],
    writes: ['outbox/hn-ih.md'],
    skills: ['kj-indie-hacker', 'kj-community-forum'],
    notes: 'Plain, technical, no marketing language.' },
  { name: 'om-producthunt', pod: 'social', model: 'sonnet', tools: WEB,
    title: 'Product Hunt launch',
    does: 'Runs the Product Hunt launch from T-14 to T+7: assets, tagline, maker comment, supporter list, launch-day checklist and follow-up.',
    reads: ['profile.md', 'claims.md'],
    writes: ['outbox/producthunt.md'],
    skills: ['gr-ph-launch:gr-ph-launch', 'ph-launch-strategy', 'ph-launch-day-checklist', 'ph-tagline-writer', 'ph-maker-comment'],
    notes: 'Never ask for upvotes; ask people to check it out and share feedback.' },
  { name: 'om-video-scripter', pod: 'social', model: 'sonnet', tools: WEB,
    title: 'Video scripter',
    does: 'Writes short-form video scripts and YouTube outlines that demo the product and answer buyer questions.',
    reads: ['profile.md', 'research/voc.md'],
    writes: ['outbox/video.md'],
    skills: ['kj-youtube', 'kj-tiktok', 'marketing-skills:video'],
    notes: '' },
  { name: 'om-social-repurposer', pod: 'social', model: 'haiku', tools: RW + ', Skill',
    title: 'Content repurposer',
    does: 'Turns each published article into posts for X, LinkedIn, Reddit, newsletters and video.',
    reads: ['content/'],
    writes: ['outbox/'],
    skills: ['gr-social-distill:gr-social-distill', 'oc-content-repurposing'],
    notes: '' },

  // ── Leads & Conversion ───────────────────────────────────
  { name: 'om-cro', pod: 'conversion', model: 'sonnet', tools: WEB,
    title: 'Conversion optimizer',
    does: 'Audits the home, pricing and signup pages and proposes A/B tests ranked by expected lift.',
    reads: ['research/site-inventory.md', 'profile.md'],
    writes: ['research/cro.md', 'experiments.json'],
    skills: ['marketing-skills:cro', 'marketing-skills:signup', 'marketing-skills:onboarding', 'kj-conversion'],
    notes: 'This is usually the fastest revenue lever: more buyers from the traffic the site already has.' },
  { name: 'om-lead-magnet', pod: 'conversion', model: 'sonnet', tools: WEB,
    title: 'Lead magnet creator',
    does: 'Designs and writes lead magnets (checklists, templates, mini-courses) and their capture pages.',
    reads: ['research/icp.md', 'research/voc.md'],
    writes: ['content/lead-magnets/', 'outbox/'],
    skills: ['marketing-skills:lead-magnets', 'oc-lead-magnet'],
    notes: '' },
  { name: 'om-email-nurture', pod: 'conversion', model: 'sonnet', tools: WEB,
    title: 'Email nurture',
    does: 'Writes welcome, nurture, trial-to-paid and win-back sequences with triggers, timing and subject-line tests.',
    reads: ['profile.md', 'claims.md', 'research/icp.md', 'sales/suppression.md'],
    writes: ['outbox/email/'],
    skills: ['marketing-skills:emails', 'oc-email-sequence', 'oc-email-subject-lines'],
    notes: 'Every email has an unsubscribe link and the sender\'s postal address (CAN-SPAM).' },
  { name: 'om-sales-agent', pod: 'conversion', model: 'opus', tools: WEB,
    title: 'AI sales agent',
    does: 'Writes the sales playbook: answers to buyer questions, objection handling, demo script, and replies to inbound leads that move them to purchase.',
    reads: ['profile.md', 'claims.md', 'research/voc.md', 'research/competitors.md'],
    writes: ['sales/playbook.md', 'outbox/replies.md'],
    skills: ['sales:handle-objection', 'marketing-skills:sales-enablement'],
    notes: 'The playbook doubles as the knowledge base for a site chat widget.' },
  { name: 'om-cold-outbound', pod: 'conversion', model: 'sonnet', tools: WEB,
    title: 'Cold outbound',
    does: 'For B2B products: builds a target account list from public sources and writes short personal sequences.',
    reads: ['research/icp.md', 'claims.md', 'sales/suppression.md'],
    writes: ['outbox/outbound.md'],
    skills: ['marketing-skills:cold-email', 'marketing-skills:prospecting'],
    notes: 'Business addresses only, low volume, real personalisation, easy opt-out.' },
  { name: 'om-referral-affiliate', pod: 'conversion', model: 'sonnet', tools: WEB,
    title: 'Referral and affiliate',
    does: 'Designs a referral loop and an affiliate program: rewards, terms, recruitment list and partner copy.',
    reads: ['profile.md', 'product.json'],
    writes: ['research/referral.md', 'outbox/'],
    skills: ['marketing-skills:referrals', 'kj-affiliate-marketing'],
    notes: '' },
  { name: 'om-pricing-offer', pod: 'conversion', model: 'opus', tools: WEB,
    title: 'Pricing and offers',
    does: 'Reviews pricing and packaging, and designs launch offers and tests (trials, annual discounts, lifetime deals).',
    reads: ['profile.md', 'research/competitors.md'],
    writes: ['research/pricing.md', 'experiments.json'],
    skills: ['marketing-skills:pricing', 'marketing-skills:offers', 'pm-product-strategy:pricing-strategy'],
    notes: 'Price changes always go to the owner as an approval.' },

  // ── Paid Ads ─────────────────────────────────────────────
  { name: 'om-google-ads', pod: 'paid', model: 'sonnet', tools: WEB,
    title: 'Google Ads',
    does: 'Builds search campaigns: keyword themes, negatives, ad copy, landing page match, bids and daily budget inside the cap.',
    reads: ['research/keywords.md', 'budget-plan.md', 'claims.md'],
    writes: ['outbox/ads/google.md', 'approvals.json'],
    skills: ['kj-google-ads', 'oc-google-ads', 'aaron-marketing:search-term-miner'],
    notes: 'Start with exact and phrase match on high-intent and competitor terms. Launch only through an approval.' },
  { name: 'om-microsoft-ads', pod: 'paid', model: 'haiku', tools: WEB,
    title: 'Microsoft Ads',
    does: 'Mirrors winning Google campaigns to Microsoft Ads (cheaper clicks, Bing and Copilot audience) with adjusted bids.',
    reads: ['outbox/ads/google.md', 'budget-plan.md'],
    writes: ['outbox/ads/microsoft.md', 'approvals.json'],
    skills: ['kj-google-ads'],
    notes: '' },
  { name: 'om-meta-ads', pod: 'paid', model: 'sonnet', tools: WEB,
    title: 'Meta Ads',
    does: 'Builds Facebook and Instagram campaigns for consumer products: audiences, creative angles, budget inside the cap.',
    reads: ['research/icp.md', 'budget-plan.md', 'claims.md'],
    writes: ['outbox/ads/meta.md', 'approvals.json'],
    skills: ['kj-meta-ads', 'oc-facebook-ads'],
    notes: '' },
  { name: 'om-reddit-ads', pod: 'paid', model: 'haiku', tools: WEB,
    title: 'Reddit Ads',
    does: 'Targets subreddits where the ICP lives with native-feeling ads.',
    reads: ['research/communities.md', 'budget-plan.md'],
    writes: ['outbox/ads/reddit.md', 'approvals.json'],
    skills: ['kj-reddit-ads'],
    notes: '' },
  { name: 'om-linkedin-ads', pod: 'paid', model: 'haiku', tools: WEB,
    title: 'LinkedIn Ads',
    does: 'For high-value B2B products only: job title and company targeting with lead-gen forms.',
    reads: ['research/icp.md', 'budget-plan.md'],
    writes: ['outbox/ads/linkedin.md', 'approvals.json'],
    skills: ['kj-linkedin-ads', 'oc-linkedin-ads'],
    notes: 'Skip unless customer value covers expensive clicks.' },
  { name: 'om-ad-creative', pod: 'paid', model: 'sonnet', tools: WEB,
    title: 'Ad creative',
    does: 'Writes ad variants per angle and platform, and briefs for images and video.',
    reads: ['profile.md', 'claims.md', 'research/voc.md'],
    writes: ['outbox/ads/creative.md'],
    skills: ['marketing-skills:ad-creative', 'market-ads'],
    notes: '' },

  // ── Analytics ────────────────────────────────────────────
  { name: 'om-tracking-engineer', pod: 'analytics', model: 'sonnet', tools: WEB_BASH,
    title: 'Tracking engineer',
    does: 'Specifies and checks analytics, conversion events, UTM conventions and ad pixels so every channel can be measured.',
    reads: ['research/site-inventory.md'],
    writes: ['research/tracking.md', 'outbox/'],
    skills: ['marketing-skills:analytics', 'marketing-skills:conversion-tracking', 'kj-tracking'],
    notes: 'Without tracking no channel can be judged; this runs in week one.' },
  { name: 'om-analyst', pod: 'analytics', model: 'sonnet', tools: RW + ', Bash, Skill',
    title: 'Growth analyst',
    does: 'Reads metrics the owner exports or connectors provide, attributes revenue to channels, and spots what changed.',
    reads: ['reports/', 'experiments.json', 'metrics/'],
    writes: ['reports/analysis.md', 'metrics/kpis.json'],
    skills: ['marketing-skills:attribution', 'aaron-marketing:attribution-reconciler'],
    notes: 'Never invent a metric. Missing data is reported as missing.' },

  // ── Self-Ops ─────────────────────────────────────────────
  { name: 'om-evaluator', pod: 'selfops', model: 'sonnet', tools: RW,
    title: 'Evaluator',
    does: 'Scores each finished task\'s output against its brief and against real results when they exist, and records the score in tasks.json.',
    reads: ['tasks.json', 'outbox/', 'content/', 'experiments.json'],
    writes: ['tasks.json', 'reports/evaluations.md'],
    skills: [],
    // apply-results.mjs reads only the evaluations array; a score under 3 sends the task back once.
    notes: 'Score 1–5 on usefulness, accuracy, fit to the ICP. Send anything under 3 back with a reason. Put each score in the result file as "evaluations": [{"task_id": "<evaluated id>", "score": 1-5, "note": "why"}]; never write tasks.json yourself. Leave lessons for om-learner as a new_task.' },
  { name: 'om-learner', pod: 'selfops', model: 'opus', tools: RW,
    title: 'Learner',
    does: 'Turns experiment verdicts and evaluator notes into rules in LEARNINGS.md and, when a rule holds across products, into playbooks/.',
    reads: ['experiments.json', 'LEARNINGS.md', '../../playbooks/'],
    writes: ['LEARNINGS.md', '../../playbooks/'],
    skills: [],
    notes: 'A rule needs evidence: the experiment ids that support it.' },
  { name: 'om-ops-doctor', pod: 'selfops', model: 'sonnet', tools: RW + ', Bash',
    title: 'Ops doctor',
    does: 'Checks workspace health: invalid JSON, stuck or failed tasks, broken dependencies, missing files; repairs what it can and reports the rest.',
    reads: ['tasks.json', 'approvals.json', 'experiments.json', 'product.json'],
    writes: ['tasks.json', 'reports/ops.md'],
    skills: [],
    notes: 'Run `node tools/validate.mjs <slug>` first. Retry a failed task once with the error attached; after that, mark it blocked.' },
  { name: 'om-cost-optimizer', pod: 'selfops', model: 'haiku', tools: RW,
    title: 'Cost optimizer',
    does: 'Tracks agent effort and ad spend per result and proposes cheaper models or fewer runs where quality holds.',
    reads: ['tasks.json', 'reports/'],
    writes: ['reports/cost.md'],
    skills: [],
    notes: '' },
  { name: 'om-self-upgrader', pod: 'selfops', model: 'opus', tools: RW + ', Bash',
    title: 'Self-upgrader',
    does: 'Proposes improvements to the agents and workflows themselves, as edits to tools/roster.mjs and the om skill, based on LEARNINGS and evaluator scores.',
    reads: ['../../tools/roster.mjs', '../../.claude/skills/om/SKILL.md', 'LEARNINGS.md'],
    writes: ['../../proposals/'],
    skills: [],
    notes: 'Write each proposal as a patch plus the evidence. The owner applies it; never edit the roster directly.' },
];

// Expand the compact extended roster with pod-default inputs and outputs. Object entries carry
// their own reads, writes, notes or Bash; they stay wave 1 (untagged) so their colors never move.
for (const e of extra) {
  if (!Array.isArray(e)) {
    const { bash, ...rest } = e;
    roster.push({
      ...rest,
      tools: bash || e.pod === 'selfops' || e.pod === 'analytics' ? WEB_BASH : WEB,
      reads: e.reads ?? podReads[e.pod] ?? ['profile.md'],
      writes: e.writes ?? podWrites[e.pod] ?? ['outbox/'],
      notes: e.notes ?? '',
    });
    continue;
  }
  const [name, pod, model, title, does, skills, writes] = e;
  roster.push({
    name, pod, model, title, does, skills,
    tools: pod === 'selfops' || pod === 'analytics' ? WEB_BASH : WEB,
    reads: podReads[pod] ?? ['profile.md'],
    writes: writes ?? podWrites[pod] ?? ['outbox/'],
    notes: '',
  });
}

// Wave 2 (object form, own dept and notes). Tagged so palette assignment keeps older colors.
for (const w of wave2) {
  const { bash, ...rest } = w;
  roster.push({
    ...rest,
    tools: bash || w.pod === 'selfops' || w.pod === 'analytics' ? WEB_BASH : WEB,
    reads: w.reads ?? podReads[w.pod] ?? ['profile.md'],
    writes: w.writes ?? podWrites[w.pod] ?? ['outbox/'],
    notes: w.notes ?? '',
    wave: 2,
  });
}

// Wave 3: mega agents, micro agents and the knowledge & evolution team (roster-wave3.mjs).
for (const w of wave3) {
  const { bash, ...rest } = w;
  roster.push({
    ...rest,
    tools: bash || w.pod === 'selfops' || w.pod === 'analytics' ? WEB_BASH : WEB,
    reads: w.reads ?? podReads[w.pod] ?? ['profile.md'],
    writes: w.writes ?? podWrites[w.pod] ?? ['outbox/'],
    notes: w.notes ?? '',
    wave: 3,
  });
}

// Wave 4: the AI Lab, added in ten rounds (roster-wave4.mjs); each agent keeps its round number.
for (const w of wave4) {
  const { bash, ...rest } = w;
  roster.push({
    ...rest,
    tools: bash ? WEB_BASH : WEB,
    reads: w.reads ?? ['product.json', 'profile.md', 'claims.md', '../../knowledge/briefs/'],
    writes: w.writes ?? ['outbox/ai/', 'research/ai/'],
    notes: w.notes ?? '',
    wave: 4,
  });
}

// Wave 5: the Strategy Consulting Practice (roster-wave5.mjs): McKinsey, BCG, Bain, Big Four,
// HBR and HBS methods. Some existing strategy agents also master the consulting pack.
for (const w of wave5) {
  const { bash, ...rest } = w;
  roster.push({
    ...rest,
    tools: bash ? WEB_BASH : WEB,
    reads: w.reads ?? ['product.json', 'profile.md', 'claims.md', 'plan.md', 'LEARNINGS.md', 'research/', 'reports/', '../../knowledge/briefs/'],
    writes: w.writes ?? ['reports/consulting/', 'research/consulting/'],
    notes: w.notes ?? '',
    wave: 5,
  });
}
for (const a of roster) if (alsoConsulting.includes(a.name)) a.packs = [...new Set([...(a.packs ?? []), 'consulting'])];

// Wave 7: the Commerce & Growth Frontier (roster-wave7.mjs): retail media and marketplaces, social
// commerce, CTV and programmatic, brand science, product-led growth, partner ecosystems, events,
// analyst relations, loyalty, green claims and messaging rules. Tagged 7 because wave 6 is the
// agents Whalyom grows itself (below).
for (const w of wave7) {
  const { bash, ...rest } = w;
  roster.push({
    ...rest,
    tools: bash ? WEB_BASH : WEB,
    reads: w.reads ?? ['product.json', 'profile.md', 'claims.md', 'plan.md', 'LEARNINGS.md', 'research/', 'reports/', '../../knowledge/briefs/'],
    writes: w.writes ?? ['research/frontier/', 'outbox/'],
    notes: w.notes ?? '',
    wave: 7,
  });
}
for (const a of roster) if (alsoFrontier.includes(a.name)) a.packs = [...new Set([...(a.packs ?? []), 'frontier'])];

// Wave 8: Zero-Budget Growth & Funnel (roster-wave8.mjs): free channels planned in hours by
// tools/free-engine.mjs, and the pipeline ledger kept by tools/funnel.mjs.
for (const w of wave8) {
  const { bash, ...rest } = w;
  roster.push({
    ...rest,
    tools: bash ? WEB_BASH : WEB,
    reads: w.reads ?? ['product.json', 'profile.md', 'claims.md', 'plan.md', 'LEARNINGS.md', 'funnel/', 'research/', 'reports/', '../../knowledge/briefs/'],
    writes: w.writes ?? ['research/free/', 'outbox/'],
    notes: w.notes ?? '',
    wave: 8,
  });
}
for (const a of roster) if (alsoZero.includes(a.name)) a.packs = [...new Set([...(a.packs ?? []), 'zero'])];

// Wave 9: nine specialist departments (roster-wave9.mjs): their mega heads and new specialists.
// Existing agents move into them below, after every agent has its department.
for (const w of wave9) {
  const { bash, ...rest } = w;
  roster.push({
    ...rest,
    tools: bash ? WEB_BASH : WEB,
    reads: w.reads ?? ['product.json', 'profile.md', 'claims.md', 'plan.md', 'LEARNINGS.md', 'funnel/', 'research/', 'reports/', '../../knowledge/briefs/'],
    writes: w.writes ?? ['research/', 'outbox/'],
    notes: w.notes ?? '',
    wave: 9,
  });
}

// Wave 10: six more departments (roster-wave10.mjs): heads, specialists and micro agents.
for (const w of wave10) {
  const { bash, ...rest } = w;
  roster.push({
    ...rest,
    tools: bash ? WEB_BASH : WEB,
    reads: w.reads ?? ['product.json', 'profile.md', 'claims.md', 'plan.md', 'LEARNINGS.md', 'funnel/', 'research/', 'reports/', '../../knowledge/briefs/'],
    writes: w.writes ?? ['research/', 'outbox/'],
    notes: w.notes ?? '',
    wave: 10,
  });
}

// Wave 6: agents Whalyom grows itself. tools/evolve.mjs adds them to config/learned-agents.json
// (new-agent proposals, inside the limits in config/evolution.json); this file is never edited by the
// loop. They get web tools only (no Bash), sonnet or haiku, and roll back with evolve.mjs rollback <id>.
{
  const file = fileURLToPath(new URL('../config/learned-agents.json', import.meta.url));
  let grown = [];
  try { grown = JSON.parse(fs.readFileSync(file, 'utf8')).agents ?? []; } catch { grown = []; }
  const taken = new Set(roster.map((a) => a.name));
  for (const g of grown) {
    if (!g?.name || taken.has(g.name)) continue;
    roster.push({
      name: g.name, pod: 'grown', dept: g.dept, model: g.model === 'haiku' ? 'haiku' : 'sonnet', tools: WEB,
      title: g.title, does: g.does, skills: [...(g.skills ?? [])], packs: g.packs ?? [],
      reads: ['product.json', 'profile.md', 'claims.md', 'LEARNINGS.md', 'research/', '../../knowledge/briefs/'],
      writes: ['outbox/grown/', 'research/grown/'], notes: g.notes ?? '', wave: 6, grown_by: g.id,
    });
    taken.add(g.name);
  }
}

// Department and AI layer for every agent (see roster-extra.mjs).
for (const a of roster) { a.dept = deptOf(a); a.layer = layerOf(a); a.tier = a.tier ?? 'core'; }

// Cross-roster briefs (roster-extra.mjs): opt-outs reach every agent that drafts messages to people,
// agents that apply deal-desk rules read them, and overlapping agents know where their job stops.
for (const a of roster) {
  const addRead = (f) => { if (!a.reads.includes(f)) a.reads = [...a.reads, f]; };
  const addNote = (n) => { if (!a.notes.includes(n)) a.notes = a.notes ? `${a.notes} ${n}` : n; };
  if (suppressionAgents.includes(a.name)) { addRead('sales/suppression.md'); addNote(SUPPRESSION_NOTE); }
  if (/deal-desk/.test(`${a.does} ${a.notes}`) && !a.reads.includes('sales/')) addRead('sales/deal-desk.md');
  if (boundaryNotes[a.name]) addNote(boundaryNotes[a.name]);
  // Outcome routing: the delegating agents prefer agents with proven results (tools/routing.mjs).
  if (routingAgents.includes(a.name) || a.tier === 'mega') {
    addRead(ROUTING_READ); addNote(ROUTING_NOTE);
    addNote(a.name === 'om-evolution-director' ? ROUTING_DIRECTOR_NOTE : ROUTING_EVOLVE_NOTE);
  }
}
// Wave 9 re-homes agents into the nine new departments. A moved agent keeps its old department's
// skill pack and its color (homeDept is the department it was painted in).
for (const a of roster) {
  const to = moves[a.name] ?? moves10[a.name];
  if (to && to !== a.dept) { a.homeDept = a.dept; a.packs = [...new Set([...(a.packs ?? []), a.dept])]; a.dept = to; a.layer = DEPARTMENTS[to].layer; }
  if (extraSpans[a.name]) a.spans = [...new Set([...extraSpans[a.name], ...(a.spans ?? [])])];
}
// Guard rules that depend on the final department: every paid agent (and the sponsorship buyer, who
// also spends) reads the caps in product.json; every reviewer writes its verdicts to a REVIEW file.
for (const a of roster) {
  if ((a.dept === 'paid' && a.tier !== 'micro') || a.name === 'om-sponsorship-buyer') {
    if (!a.reads.includes('product.json')) a.reads = [...a.reads, 'product.json'];
    if (!a.notes.includes(PAID_RULE)) a.notes = [a.notes, PAID_RULE].filter(Boolean).join(' ');
  }
  if (REVIEWERS.includes(a.name)) {
    if (!a.notes.includes('runs/REVIEW-')) a.notes = [a.notes, REVIEW_RULE.replace('<your name>', a.name)].filter(Boolean).join(' ');
    a.writes = [...new Set([...a.writes.filter((w) => w !== 'outbox/' && w !== 'approvals.json'), 'runs/REVIEW-<task-id>.json'])];
  }
}

// Self-update: rules and skills the evolution loop learned (tools/evolve.mjs writes
// config/agent-overrides.json; this file is never edited by the loop). Each learned rule keeps
// the proposal id it came from, so `node tools/evolve.mjs rollback <id>` can remove it.
{
  const file = fileURLToPath(new URL('../config/agent-overrides.json', import.meta.url));
  let overrides = {};
  try { overrides = JSON.parse(fs.readFileSync(file, 'utf8')).agents ?? {}; } catch { overrides = {}; }
  for (const a of roster) {
    const o = overrides[a.name];
    a.learned = (o?.rules ?? []).filter((r) => r && r.text);
    for (const s of o?.skills ?? []) if (s?.name && !a.skills.includes(s.name)) a.skills.push(s.name);
    if (a.skills.length && !/\bSkill\b/.test(a.tools)) a.tools += ', Skill';
  }
}

// One palette color per agent (tools/palette.mjs, 300 colors).
// Wave 1 (the original 196): department order on the 200 base tones, exactly as before, so their
// colors never change. Wave 2: each department's "home" family is the one most of its wave-1
// agents use; its new agents take the free half-step extension tones (then any free base tone) of
// that family first, then of the nearest families by hue. Every color is used at most once.
import { buildPalette, FAMILIES, BASE_SIZE } from './palette.mjs';
{
  const palette = buildPalette();
  const deptOrder = Object.keys(DEPARTMENTS);
  const paintDept = (a) => a.homeDept ?? a.dept;
  const byDept = (x, y) => deptOrder.indexOf(paintDept(x)) - deptOrder.indexOf(paintDept(y)) || x.name.localeCompare(y.name);
  const paint = (a, c) => { a.color = c.hex; a.colorFamily = c.family; a.colorId = c.id; used.add(c.id); };
  const used = new Set();
  const first = roster.filter((a) => !a.wave).sort(byDept);
  first.forEach((a, i) => paint(a, palette[i % BASE_SIZE]));

  const hueOf = Object.fromEntries(FAMILIES);
  const dist = (h1, h2) => Math.min(Math.abs(h1 - h2), 360 - Math.abs(h1 - h2));
  const home = {};
  for (const d of deptOrder) {
    const counts = {};
    for (const a of first) if (paintDept(a) === d) counts[a.colorFamily] = (counts[a.colorFamily] ?? 0) + 1;
    home[d] = Object.entries(counts).sort((x, y) => y[1] - x[1])[0]?.[0] ?? FAMILIES[0][0];
  }
  const famOrder = (d) => FAMILIES.map(([n]) => n).sort((x, y) => dist(hueOf[x], hueOf[home[d]]) - dist(hueOf[y], hueOf[home[d]]));
  // Each wave picks only from the tones that existed when it arrived (wave 2: ids < 300, wave 3:
  // < 380, wave 4 and 5: < 480, wave 7: < 580, wave 6: all), so adding colors never moves an older
  // agent's color. Wave 7 picks before wave 6 so agents grown later never shift a wave-7 color.
  for (const [wave, limit] of [[2, 300], [3, 380], [4, 480], [5, 480], [7, 580], [8, 580], [9, 580], [10, 580], [6, Infinity]]) for (const a of roster.filter((x) => x.wave === wave).sort(byDept)) {
    const fams = famOrder(paintDept(a));
    const pick = fams.flatMap((f) => palette.filter((c) => c.family === f && c.id < limit).sort((x, y) => Number(!!y.extension) - Number(!!x.extension)))
      .find((c) => !used.has(c.id));
    if (!pick) throw new Error(`palette exhausted at ${a.name}: grow tools/palette.mjs`);
    paint(a, pick);
  }
}
