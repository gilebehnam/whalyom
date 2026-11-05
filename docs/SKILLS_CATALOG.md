# External skills catalog (`ext-*`)

Installed 2026-11-03: 56 skills in `.claude/skills/ext-*` and 10 agents in `.claude/agents/ext-wsh-*.md`. All are Markdown only (instructions and reference docs), MIT licensed, and listed with source and license in `THIRD_PARTY_NOTICES.md`. Each skill starts with a "Whalyom note" that applies the project rules (claims.md only, drafts to `outbox/`, nothing outbound without approval, budget caps, platform rules, code examples are reference only).

Prefixes: `ext-rae-` thatrebeccarae/claude-marketing, `ext-bw-` BrianRWagner/ai-marketing-claude-code-skills, `ext-wsh-` wshobson/agents, `ext-wd-` wondelai/skills (book-based frameworks), `ext-emb-` CosmoBlk/email-marketing-bible.

"Overlaps" names the closest skill that was already available, so the roster owner can pick one instead of loading both.

## Skills by marketing function

### Strategy, positioning and offer
- `ext-wd-obviously-awesome` — April Dunford positioning: competitive alternatives, unique attributes, best-fit customers, market category, scored 0-10. Overlaps: `positioning-mapper`.
- `ext-bw-positioning-basics` — quick / workshop / full messaging-system positioning with context gates.
- `ext-wd-crossing-the-chasm` — beachhead segment, whole product, mainstream go-to-market.
- `ext-wd-blue-ocean-strategy` — strategy canvas, ERRC grid, six paths, non-customers.
- `ext-wsh-competitive-landscape` — Porter's Five Forces, Blue Ocean and positioning maps for competitor analysis.
- `ext-wd-hundred-million-offers` — Hormozi grand-slam offer: value equation, bonuses, guarantees, naming.
- `ext-wd-monetizing-innovation` — willingness-to-pay conversations, packaging tiers, monetization models.
- `ext-wd-one-page-marketing` — one-page marketing plan (before / during / after) for small businesses.
- `ext-wd-cold-start-problem` — network-effect launches: atomic networks, hard side, tipping and moats.
- `ext-bw-marketing-principles` — first-principles advisor (Drucker, Ogilvy, Godin, Munger) with mandatory context intake.
- `ext-wd-grow-business` — guided nine-phase journey from lucky months to a repeatable growth engine (chains `ext-wd-*` skills).

### Market and customer research
- `ext-wd-mom-test` — customer interviews that avoid false positives; question patterns and commitment signals.
- `ext-wsh-market-sizing-analysis` — TAM/SAM/SOM top-down, bottom-up and value-theory, with data sources. Overlaps: `pm-market-research:market-sizing`.
- `ext-wsh-social-evidence-research` — read-only social-platform research where every claim cites inspected evidence.
- `ext-rae-research-digest` — research briefs from RSS and web sources with credibility scoring.
- `ext-rae-competitor-ads-analyst` — competitor ads from public ad libraries: angles, formats, pain points, swipe file.

### Brand, voice and messaging
- `ext-rae-brand-dna` — extracts voice, colors, typography and values from a site into `brand-profile.json` (WebFetch only).
- `ext-bw-voice-extractor` — builds a Voice Guide from writing samples (template included).
- `ext-wd-storybrand-messaging` — StoryBrand BrandScript, one-liners, website wireframe, email sequences.
- `ext-wd-made-to-stick` — SUCCESs principles for ideas that stick.
- `ext-wd-contagious` — STEPPS word-of-mouth and virality principles.

### Copywriting and editing
- `ext-rae-copywriting-frameworks` — AIDA, PAS, BAB, 4Ps, StoryBrand, QUEST, FAB with a framework picker.
- `ext-wd-influence-psychology` — Cialdini's principles applied to copy, with an ethics reference.
- `ext-wsh-avoid-ai-writing` — detect / rewrite / edit modes to remove AI tells without inventing specifics. Overlaps: `deslop`, `marketing-skills:content-humanizer`.
- `ext-bw-tweet-draft-reviewer` — scores X drafts on 8 voice rules and rewrites anything under 7.

### Content and SEO / AEO
- `ext-bw-content-idea-generator` — content ideas rooted in positioning, up to a 30-day plan.
- `ext-bw-ai-discoverability-audit` — manual audit of how ChatGPT, Perplexity, Claude and Gemini describe the brand, with a query bank. Overlaps: `geo-brand-mentions`, `oc-ai-citations-report`.
- `ext-bw-case-study-builder` — client wins into proposal blurb, pull-quote and sales story (real results only).

### Social media
- `ext-bw-linkedin-authority-builder` — LinkedIn content pillars, formats and posting rhythm.
- `ext-bw-linkedin-profile-optimizer` — scored profile audit and rewrites, includes AI-visibility checklist.

### Email and lifecycle
- `ext-emb-email-marketing-bible` — full email operating manual: deliverability, flows, segmentation, compliance (GDPR, CAN-SPAM, CASL, PECR), benchmarks, ESP comparison, send-safety gates for agents.
- `ext-bw-newsletter-creation-curation` — B2B newsletter editions by industry, with playbook, templates and examples.
- `ext-wd-improve-retention` — Fogg behavior model and tiny habits applied to activation and retention.
- `ext-wd-hooked-ux` — Hook model (trigger, action, variable reward, investment) with ethical boundaries.

### Paid media
- `ext-rae-google-ads` — Google Ads audit and build guidance with a 74-check scored checklist (`CHECKS.md`).
- `ext-rae-facebook-ads` — Meta Ads audit and build guidance with a 46-check scored checklist.
- `ext-rae-microsoft-ads` — Microsoft Ads (Bing) guidance with a 30-check checklist; Google import differences.
- `ext-rae-cross-platform-audit` — budget-weighted health score across Google, Meta and Microsoft (uses the three CHECKS files and `scoring-system.md`).
- `ext-rae-account-structure-review` — campaign and ad-set structure against conversion-volume and budget thresholds.
- `ext-rae-wasted-spend-finder` — spend-without-conversion thresholds and themed negative/exclusion lists from exports.

### CRO, landing pages and funnels
- `ext-wd-cro-methodology` — research-first CRO: objections, persuasion, copy, funnel analysis, test method.
- `ext-wd-conversion-optimization` — guided CRO journey that chains `ext-wd-cro-methodology`, `ext-wd-scorecard-marketing` and others.
- `ext-wd-grow-website` — guided journey for growing a website's conversions phase by phase.
- `ext-rae-cro-auditor` — LIFT heuristic audit with ICE/PIE prioritisation and A/B hypotheses. Overlaps: `marketing-skills:page-cro`.
- `ext-bw-homepage-audit` — 5-second test, section scoring and rewrites for a homepage or landing page.
- `ext-wd-scorecard-marketing` — quiz / scorecard lead funnels (concept, questions, results, follow-up).

### Analytics, tracking and attribution
- `ext-rae-utm-attribution-strategy` — UTM taxonomy, naming rules and attribution models.
- `ext-rae-google-tag-manager` — GTM container audit, naming conventions, data layer, server-side tagging.
- `ext-wd-lean-analytics` — five stages and the one metric that matters per business model.
- `ext-wsh-startup-metrics-framework` — unit economics, SaaS and marketplace metrics by stage.
- `ext-wsh-kpi-dashboard-design` — KPI selection and dashboard layout patterns.
- `ext-wsh-data-storytelling` — turning numbers into narratives for owners and stakeholders.

### Sales and outbound
- `ext-wd-predictable-revenue` — outbound team model, lead types, pipeline math, cold calling 2.0.
- `ext-bw-cold-outreach-sequence` — research-led 4-touch LinkedIn and email sequences for single prospects (no bulk sends). Overlaps: `cold-outbound-sequencer`.
- `ext-wd-negotiation` — negotiation techniques for deals, partnerships and sponsorships.
- `ext-bw-testimonial-collector` — asking real clients for testimonials, scoring and formatting them (client approval required).

## Agents (`.claude/agents/ext-wsh-*.md`)

Advisory agents with `Read, Write, Edit, Glob, Grep, WebSearch, WebFetch` (no Bash). They return findings and drafts; they do not write the ledgers.

| Agent | What it does | Closest om-* agent |
|---|---|---|
| `ext-wsh-seo-content-auditor` | Scores content for quality, E-E-A-T and SEO | om-editor |
| `ext-wsh-seo-content-planner` | Outlines, topic clusters, calendar | om-content-strategist |
| `ext-wsh-seo-content-writer` | Writes SEO content from a brief | om-writer |
| `ext-wsh-seo-keyword-strategist` | Keyword usage, semantic variants, over-optimisation check | om-keyword-researcher |
| `ext-wsh-seo-meta-optimizer` | Titles, meta descriptions, URL slugs within limits | om-tech-seo |
| `ext-wsh-seo-snippet-hunter` | Featured-snippet and PAA formatting | om-snippet-hunter |
| `ext-wsh-seo-structure-architect` | Heading hierarchy, schema suggestions, internal links | om-site-architect |
| `ext-wsh-seo-authority-builder` | E-E-A-T gaps and trust elements | om-trust-builder |
| `ext-wsh-seo-cannibalization-detector` | Keyword overlap between pages and fixes | om-cannibalization-fixer |
| `ext-wsh-seo-content-refresher` | Outdated stats, dates and examples to update | om-content-refresher |

## Proposed om-* agent to skill mapping

For the roster owner to apply in `tools/roster.mjs` / `tools/roster-extra.mjs` (not applied here). Then run `node tools/check-skills.mjs` and `node tools/build-agents.mjs`.

| om-* agent | Add skills |
|---|---|
| om-cmo | ext-wd-one-page-marketing, ext-wd-grow-business, ext-bw-marketing-principles, ext-wd-lean-analytics |
| om-red-team | ext-bw-marketing-principles, ext-wd-mom-test |
| om-positioning-strategist | ext-wd-obviously-awesome, ext-bw-positioning-basics, ext-wd-crossing-the-chasm, ext-wd-blue-ocean-strategy |
| om-message-architect | ext-wd-storybrand-messaging, ext-wd-made-to-stick |
| om-offer-engineer | ext-wd-hundred-million-offers, ext-wd-influence-psychology |
| om-pricing-offer | ext-wd-monetizing-innovation, ext-wd-hundred-million-offers |
| om-market-entry | ext-wd-crossing-the-chasm |
| om-market-sizer | ext-wsh-market-sizing-analysis |
| om-competitor-intel | ext-wsh-competitive-landscape, ext-wd-blue-ocean-strategy |
| om-ad-spy | ext-rae-competitor-ads-analyst |
| om-persona-interviewer | ext-wd-mom-test |
| om-icp-builder | ext-wd-obviously-awesome |
| om-voc-miner | ext-wsh-social-evidence-research |
| om-trend-watcher | ext-rae-research-digest |
| om-brand-guardian | ext-rae-brand-dna, ext-bw-voice-extractor |
| om-product-analyst | ext-rae-brand-dna |
| om-editor | ext-wsh-avoid-ai-writing, ext-rae-copywriting-frameworks |
| om-writer | ext-rae-copywriting-frameworks, ext-wd-made-to-stick |
| om-headline-lab, om-hook-writer | ext-rae-copywriting-frameworks, ext-wd-contagious |
| om-vsl-architect | ext-wd-storybrand-messaging, ext-wd-influence-psychology |
| om-content-strategist | ext-bw-content-idea-generator |
| om-thought-leader | ext-wd-made-to-stick, ext-bw-content-idea-generator |
| om-case-study-writer | ext-bw-case-study-builder |
| om-social-proof, om-advocacy | ext-bw-testimonial-collector |
| om-ai-answer-monitor, om-geo-optimizer | ext-bw-ai-discoverability-audit |
| om-linkedin | ext-bw-linkedin-authority-builder, ext-bw-linkedin-profile-optimizer |
| om-x | ext-bw-tweet-draft-reviewer |
| om-social-repurposer | ext-wd-contagious |
| om-newsletter-editor | ext-bw-newsletter-creation-curation, ext-emb-email-marketing-bible |
| om-email-nurture, om-activation-emails, om-winback, om-cart-recovery | ext-emb-email-marketing-bible |
| om-deliverability | ext-emb-email-marketing-bible |
| om-onboarding-optimizer, om-churn-preventer | ext-wd-improve-retention, ext-wd-hooked-ux |
| om-google-ads | ext-rae-google-ads, ext-rae-account-structure-review |
| om-meta-ads | ext-rae-facebook-ads, ext-rae-account-structure-review |
| om-microsoft-ads | ext-rae-microsoft-ads |
| om-ad-account-auditor | ext-rae-cross-platform-audit, ext-rae-account-structure-review, ext-rae-wasted-spend-finder |
| om-cpa-guard, om-budget-allocator | ext-rae-wasted-spend-finder |
| om-cro, om-bandit-cro | ext-wd-cro-methodology, ext-rae-cro-auditor, ext-wd-conversion-optimization |
| om-landing-builder | ext-bw-homepage-audit, ext-wd-storybrand-messaging |
| om-friction-finder | ext-bw-homepage-audit |
| om-quiz-builder | ext-wd-scorecard-marketing |
| om-tracking-engineer | ext-rae-google-tag-manager, ext-rae-utm-attribution-strategy |
| om-utm-manager | ext-rae-utm-attribution-strategy |
| om-attribution | ext-rae-utm-attribution-strategy |
| om-kpi-definer | ext-wsh-startup-metrics-framework, ext-wd-lean-analytics, ext-wsh-kpi-dashboard-design |
| om-analyst, om-reporter, om-nyk-curator | ext-wsh-data-storytelling, ext-wsh-kpi-dashboard-design |
| om-cold-outbound | ext-wd-predictable-revenue, ext-bw-cold-outreach-sequence, ext-emb-email-marketing-bible |
| om-revops | ext-wd-predictable-revenue |
| om-deal-desk, om-sponsorship-buyer, om-co-marketing | ext-wd-negotiation |
| om-launch-platforms, om-producthunt | ext-wd-cold-start-problem |

## Not installed, and why

- Duplicates of skills already available (same topic, no new method): rae ab-testing-framework, aeo-geo-optimizer, brand-voice-guidelines, cold-email-outreach, customer-journey-mapping, email-composer, icp-research, landing-page-optimizer, linkedin-ads, llms-txt, market-research, pricing-strategy, programmatic-seo, retention-churn-prevention, schema-markup-generator, seo-content-writer, social-media-strategy, technical-seo-audit, tiktok-ads, content-workflow; wondelai jobs-to-be-done; wshobson content-marketer, search-specialist, business-analyst, customer-support, startup-analyst; coreyhaines31/marketingskills and alirezarezvani/claude-skills (already installed as plugins).
- Need credentials, API clients or an MCP server: rae braze, klaviyo-analyst, klaviyo-developer, shopify, google-analytics, looker-studio; bw reddit-insights (third-party MCP plus API key); wshobson brand-landingpage (Stitch API key and SDK), hermes-tweet, social-publishing (publishes posts).
- Depend on agents that do not exist here: rae content-pipeline.
- Unclear provenance: bw de-ai-ify (authored by a third party inside the repo, claims to run regex code it does not ship).
- Not marketing: rae dep-audit, safe-push, repo-*, sync-repos, github-readme, frontend-design, remotion-video, tech-diagram; wshobson team-composition-analysis, startup-financial-modeling; wondelai coding, UX and management skills.
- No usable license found for other directory listings (skills.sh, claudskills.com entries such as press-release or FTC-disclosure skills); not installed.
