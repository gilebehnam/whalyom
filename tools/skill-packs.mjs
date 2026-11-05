// Department skill packs: the shared skill library each department's agents master on top of the
// few method skills in their own roster entry. build-agents.mjs lists an agent's own skills first
// ("Method"), then its department pack ("Skill library"), then the cross-department core pack.
// Mega agents get every pack their mandate spans; micro agents get only their own skills.
// Every non-micro agent also masters the generated knowledge skills of its departments' topics
// (.claude/skills/om-knowledge-<topic>/, rebuilt by tools/knowledge.mjs brief), so the newest
// verified facts reach every agent. node tools/check-skills.mjs checks every name here.
import { TOPICS, knowledgeSkill, topicsForDept } from './knowledge/topics.mjs';

export const CORE = [
  'ext-wsh-avoid-ai-writing', 'whalory', 'marketing-skills:marketing-psychology',
  'ext-bw-marketing-principles', 'aaron-marketing:offer-claims-registry', 'marketing-skills:copy-editing',
];

export const PACKS = {
  sovereign: [
    'c-level-skills:cmo-advisor', 'c-level-skills:ceo-advisor', 'c-level-skills:scenario-war-room', 'c-level-skills:decision-logger',
    'c-level-skills:strategic-alignment', 'pm-execution:pre-mortem', 'pm-execution:plan-okrs', 'pm-execution:strategy-red-team',
    'ra-qm-skills:gdpr-dsgvo-expert', 'ra-qm-skills:eu-ai-act-specialist', 'aaron-marketing:crisis-response-planner',
    'aaron-marketing:consent-registry', 'kj-disclosure', 'kj-privacy', 'marketing-skills:marketing-plan', 'kj-integrated-marketing',
  ],
  intel: [
    'ext-bb-competitor-branding', 'ext-bb-target-audience', 'ext-rs-competitor-experience-audit',
    'marketing-skills:competitor-profiling', 'marketing-skills:customer-research', 'aaron-marketing:competitor-tracker',
    'aaron-marketing:trend-spotter', 'aaron-marketing:audience-mapper', 'aaron-marketing:share-of-voice-tracker',
    'pm-market-research:market-sizing', 'pm-market-research:sentiment-analysis', 'pm-market-research:user-personas',
    'ext-wsh-competitive-landscape', 'ext-wsh-market-sizing-analysis', 'ext-wsh-social-evidence-research', 'ext-rae-competitor-ads-analyst',
    'ext-rae-research-digest', 'ext-wd-mom-test', 'jobs-to-be-done:jobs-to-be-done', 'kj-competitor-research', 'kj-research-sources',
    'oc-competitor-analysis', 'gr-competitor:gr-competitor',
  ],
  strategy: [
    'ext-bb-brand-architecture', 'ext-bb-brand-audit', 'ext-bb-brand-context', 'ext-bb-brand-guidelines', 'ext-bb-brand-identity', 'ext-bb-brand-manifesto', 'ext-bb-brand-messaging', 'ext-bb-brand-positioning', 'ext-bb-brand-story', 'ext-bb-brand-strategy', 'ext-bb-brand-voice', 'ext-bb-competitor-branding', 'ext-bb-rebranding', 'ext-bb-target-audience', 'ext-bb-brand-measurement', 'ext-bb-brand-partnerships', 'ext-bb-b2b-brand-marketing', 'ext-bb-personal-brand', 'ext-rs-brand-archetype-system',
    'ext-brand-naming', 'ext-wd-obviously-awesome', 'ext-wd-storybrand-messaging', 'ext-wd-hundred-million-offers', 'ext-wd-monetizing-innovation',
    'ext-wd-blue-ocean-strategy', 'ext-wd-crossing-the-chasm', 'ext-wd-made-to-stick', 'ext-bw-positioning-basics',
    'aaron-marketing:message-house-builder', 'aaron-marketing:positioning-mapper', 'aaron-marketing:strategic-narrative-designer',
    'aaron-marketing:pricing-packaging-planner', 'aaron-marketing:story-bank-builder', 'pm-product-strategy:pricing-strategy',
    'pm-marketing-growth:value-prop-statements', 'pm-marketing-growth:positioning-ideas', 'marketing-skills:offers', 'marketing-skills:pricing',
    'marketing-skills:product-marketing', 'kj-branding', 'kj-pricing-strategy',
  ],
  funnel: [
    'ext-rs-funnel-flow-architecture', 'ext-rs-calculator-design', 'ext-rs-comparison-tool-design', 'ext-rs-quiz-and-assessment-design', 'ext-rs-product-configurator-design', 'ext-rs-scheduler-and-booking-design', 'ext-rs-chatbot-flow-design', 'ext-rs-upgrade-flow-design', 'ext-rs-onboarding-wizard-design', 'ext-rs-multi-step-form-design', 'ext-rs-interactive-product-tour', 'ext-rs-journey-mapping', 'ext-rs-lead-magnet-design', 'ext-rs-experiment-design', 'ext-rs-information-architecture',
    'marketing-skills:cro', 'marketing-skills:ab-testing', 'marketing-skills:signup', 'marketing-skills:onboarding', 'marketing-skills:popups',
    'marketing-skills:paywalls', 'marketing-skills:lead-magnets', 'ext-rae-cro-auditor', 'ext-wd-cro-methodology', 'ext-wd-conversion-optimization',
    'ext-wd-influence-psychology', 'ext-wd-scorecard-marketing', 'ext-bw-homepage-audit', 'aaron-marketing:landing-optimizer',
    'aaron-marketing:landing-experience-checker', 'aaron-marketing:page-play-builder', 'om-landing', 'kj-landing-page', 'kj-conversion', 'kj-cta',
    'kj-testimonials', 'kj-trust-badges', 'accessibility', 'core-web-vitals',
  ],
  creative: [
    'ext-bb-brand-identity', 'ext-bb-brand-packaging', 'ext-bb-brand-guidelines', 'ext-bb-brand-voice', 'ext-bb-ugc-strategy', 'ext-rs-editorial-qa', 'ext-rs-long-form-content-frameworks',
    'ext-rae-copywriting-frameworks', 'ext-bw-voice-extractor', 'aaron-marketing:social-creative-builder', 'aaron-marketing:ad-creative-builder',
    'aaron-marketing:short-video-scripter', 'aaron-marketing:brand-language-codifier', 'marketing-skills:ad-creative', 'marketing-skills:video',
    'marketing-skills:image', 'marketing-skills:copywriting', 'kj-copywriting', 'kj-visual-content', 'kj-brand-visual', 'kj-carousel', 'kj-video',
    'brand-voice:brand-voice-enforcement', 'ext-wd-contagious',
  ],
  seo: [
    'ext-rs-pillar-content-architecture', 'ext-rs-content-refresh-system', 'ext-rs-evidence-based-reviews', 'ext-rs-seo-traffic-diagnosis', 'ext-rs-vertical-site-conventions', 'ext-rs-information-architecture', 'ext-rs-competitor-experience-audit',
    'claude-seo:seo', 'claude-seo:seo-audit', 'claude-seo:seo-technical', 'claude-seo:seo-geo', 'claude-seo:seo-schema', 'claude-seo:seo-content',
    'claude-seo:seo-programmatic', 'claude-seo:seo-cluster', 'claude-seo:seo-hreflang', 'claude-seo:seo-sitemap', 'claude-seo:seo-sxo',
    'claude-seo:seo-agentic', 'claude-blog:blog-write', 'claude-blog:blog-factcheck', 'claude-blog:blog-decay', 'claude-blog:blog-geo',
    'marketing-skills:ai-seo', 'marketing-skills:programmatic-seo', 'marketing-skills:schema', 'marketing-skills:link-building',
    'aaron-marketing:geo-content-optimizer', 'aaron-marketing:technical-seo-checker', 'aaron-marketing:serp-analysis',
    'aaron-marketing:keyword-research', 'ext-bw-ai-discoverability-audit', 'geo', 'geo-citability', 'geo-crawlers', 'geo-llmstxt',
    'kj-seo', 'kj-eeat-signals', 'kj-entity-seo', 'kj-indexnow', 'kj-featured-snippet',
  ],
  social: [
    'ext-bb-influencer-marketing', 'ext-bb-ugc-strategy', 'ext-bb-personal-brand', 'ext-bb-brand-launch',
    'marketing-skills:social', 'marketing-skills:community-marketing', 'marketing-skills:influencer-marketing', 'marketing-skills:co-marketing',
    'aaron-marketing:platform-norm-profiler', 'aaron-marketing:participation-warmup-planner', 'aaron-marketing:social-calendar-builder',
    'aaron-marketing:engagement-inbox-manager', 'aaron-marketing:social-pulse-monitor', 'aaron-marketing:community-launch-runner',
    'ext-bw-linkedin-authority-builder', 'ext-bw-content-idea-generator', 'ext-bw-tweet-draft-reviewer', 'ext-wd-cold-start-problem',
    'kj-reddit', 'kj-linkedin', 'kj-x', 'kj-tiktok', 'kj-youtube', 'kj-product-hunt-launch', 'kj-directory-submission', 'oc-reddit-marketing',
    'gr-ph-launch:gr-ph-launch',
  ],
  paid: [
    'ext-rae-google-ads', 'ext-rae-facebook-ads', 'ext-rae-microsoft-ads', 'ext-rae-account-structure-review', 'ext-rae-wasted-spend-finder',
    'ext-rae-cross-platform-audit', 'aaron-marketing:campaign-architect', 'aaron-marketing:bid-strategy-planner', 'aaron-marketing:search-term-miner',
    'aaron-marketing:ad-test-designer', 'aaron-marketing:placement-exclusion-manager', 'aaron-marketing:fatigue-frequency-manager',
    'aaron-marketing:budget-pacing-monitor', 'aaron-marketing:product-feed-optimizer', 'aaron-marketing:conversion-signal-qa',
    'marketing-skills:ads', 'kj-paid-ads', 'kj-google-ads', 'kj-meta-ads', 'kj-linkedin-ads', 'kj-tiktok-ads', 'kj-reddit-ads',
  ],
  leadgen: [
    'ext-ss-referral-intro', 'ext-ss-event-networking', 'ext-ss-buyer-persona',
    'ext-bw-cold-outreach-sequence', 'ext-wd-predictable-revenue', 'ext-emb-email-marketing-bible', 'aaron-marketing:cold-outbound-sequencer',
    'aaron-marketing:fit-scorer', 'aaron-marketing:social-selling-planner', 'aaron-marketing:deliverability-qa', 'marketing-skills:cold-email',
    'marketing-skills:prospecting', 'marketing-skills:revops', 'sales:account-research', 'sales:draft-outreach', 'sales:lead-triage',
    'ext-bw-linkedin-profile-optimizer',
  ],
  closer: [
    'ext-ss-buyer-persona', 'ext-ss-call-debrief', 'ext-ss-demo-script', 'ext-ss-discovery-call', 'ext-ss-negotiation', 'ext-ss-pipeline-review', 'ext-ss-forecast', 'ext-ss-win-loss-analysis', 'ext-ss-sales-context',
    'sales:call-prep', 'sales:handle-objection', 'sales:expansion-whitespace',
    'marketing-skills:sales-enablement', 'aaron-marketing:sales-enablement-kit',
    'ext-wd-negotiation', 'ext-bw-case-study-builder', 'ext-bw-testimonial-collector', 'pm-go-to-market:competitive-battlecard',
  ],
  lifecycle: [
    'ext-bb-whatsapp-marketing', 'ext-bb-d2c-marketing', 'ext-rs-onboarding-wizard-design', 'ext-rs-journey-mapping',
    'ext-emb-email-marketing-bible', 'marketing-skills:emails', 'marketing-skills:churn-prevention', 'marketing-skills:referrals',
    'marketing-skills:sms', 'aaron-marketing:email-sequence-designer', 'aaron-marketing:subject-line-lab', 'aaron-marketing:list-segment-builder',
    'aaron-marketing:list-hygiene-monitor', 'aaron-marketing:preference-frequency-manager', 'aaron-marketing:reactivation-specialist',
    'aaron-marketing:inbox-placement-monitor', 'aaron-marketing:email-quality-auditor', 'ext-wd-improve-retention', 'ext-wd-hooked-ux',
    'ext-bw-newsletter-creation-curation', 'kj-retention', 'kj-email-marketing',
  ],
  finops: [
    'ext-rae-utm-attribution-strategy', 'ext-rae-google-tag-manager', 'ext-wd-lean-analytics', 'ext-wsh-kpi-dashboard-design',
    'ext-wsh-startup-metrics-framework', 'ext-wsh-data-storytelling', 'marketing-skills:analytics', 'marketing-skills:attribution',
    'marketing-skills:conversion-tracking', 'aaron-marketing:attribution-reconciler', 'aaron-marketing:paid-measurement-loop',
    'aaron-marketing:roi-calculator', 'aaron-marketing:dark-social-attributor', 'aaron-marketing:conversion-value-mapper',
    'pm-data-analytics:ab-test-analysis', 'pm-data-analytics:cohort-analysis', 'data:statistical-analysis', 'kj-tracking',
  ],
  evolve: [
    'engineering-advanced-skills:self-eval', 'engineering-advanced-skills:skill-security-auditor', 'engineering-advanced-skills:skill-tester',
    'engineering-advanced-skills:agent-designer', 'engineering-advanced-skills:prompt-governance', 'engineering-advanced-skills:autoresearch-agent',
    'engineering-advanced-skills:zero-hallucination-coder', 'self-improving-agent:self-improving-agent', 'pro-workflow:learn-rule', 'pro-workflow:replay-learnings',
    'pro-workflow:llm-council', 'pro-workflow:thoroughness-scoring', 'ext-rae-research-digest',
    'pm-execution:retro', 'marketing-skills:marketing-council',
  ],
};

// The packs an agent masters: its department, plus the departments named in `spans` (mega agents).
// The AI pack: every AI Lab agent masters it on top of its department pack (field `packs`).
PACKS.ai = [
  'claude-api', 'engineering-advanced-skills:agent-designer', 'engineering-advanced-skills:agent-workflow-designer', 'engineering-advanced-skills:agent-harness',
  'engineering-advanced-skills:rag-architect', 'engineering-advanced-skills:eval', 'engineering-advanced-skills:llm-cost-optimizer',
  'engineering-advanced-skills:prompt-governance', 'engineering-advanced-skills:mcp-server-builder', 'engineering-skills:ai-security',
  'engineering-skills:senior-prompt-engineer', 'engineering-skills:senior-ml-engineer', 'marketing-skills:prompt-engineer-toolkit',
  'fullstack-dev-skills:rag-architect', 'fullstack-dev-skills:fine-tuning-expert', 'c-level-skills:chief-ai-officer-advisor',
  'ra-qm-skills:eu-ai-act-specialist', 'ra-qm-skills:iso42001-specialist', 'n8n-mcp-skills:n8n-agents', 'context-engineering', 'llm-council', 'llm-gate',
  'om-ai-agent-blueprint', 'om-ai-evals', 'om-ai-guardrails', 'om-ai-cost-routing', 'om-agentic-commerce', 'om-ai-content-provenance',
  'om-llm-visibility-lab', 'om-ai-personalization',
];

// The consulting pack: the Strategy Consulting Practice (wave 5) and the strategy agents that lead
// engagements master the methods of McKinsey, BCG, Bain, the Big Four, HBR and HBS.
PACKS.consulting = [
  'om-consulting-canon', 'om-problem-solving', 'om-exec-storyline', 'ext-issue-tree-builder', 'ext-consulting', 'ext-eai-hypothesis-tree', 'ext-eai-scpr-framework', 'ext-eai-storyline-builder', 'ext-eai-decision-memo-builder', 'ext-eai-workshop-designer', 'ext-eai-stakeholder-map', 'ext-eai-mckinsey-critic', 'ext-eai-top-down-memo', 'ext-eai-synthesis', 'ext-eai-ai-use-case-scorer', 'ext-eai-meeting-prep-kit',
  'c-level-skills:ceo-advisor', 'c-level-skills:cmo-advisor', 'c-level-skills:cfo-advisor', 'c-level-skills:strategic-alignment',
  'c-level-skills:scenario-war-room', 'c-level-skills:change-management', 'c-level-skills:board-deck-builder', 'c-level-skills:decide',
  'c-level-skills:org-health-diagnostic', 'c-level-skills:ma-playbook', 'c-level-skills:intl-expansion',
  'pm-product-strategy:porters-five-forces', 'pm-product-strategy:ansoff-matrix', 'pm-product-strategy:swot-analysis',
  'pm-product-strategy:pestle-analysis', 'pm-product-strategy:business-model', 'pm-product-strategy:product-strategy',
  'pm-execution:pre-mortem', 'pm-execution:strategy-red-team', 'pm-execution:prioritization-frameworks', 'pm-execution:outcome-roadmap',
  'pm-go-to-market:gtm-strategy', 'pm-go-to-market:growth-strategy', 'pm-market-research:market-sizing', 'pm-marketing-growth:north-star-metric',
  'jobs-to-be-done:jobs-to-be-done', 'product-strategy-session:product-strategy-session', 'ext-wd-blue-ocean-strategy',
  'ext-wd-crossing-the-chasm', 'ext-wd-monetizing-innovation', 'ext-wsh-market-sizing-analysis', 'ext-wsh-competitive-landscape',
  'ext-wsh-data-storytelling', 'ext-wsh-kpi-dashboard-design', 'financial-analysis:dcf-model', 'financial-analysis:comps-analysis',
  'finance-skills:financial-analyst',
];
// The frontier pack: the Commerce & Growth Frontier (wave 7) and the existing agents whose work
// touches marketplaces, video, brand science, product-led growth or partners.
PACKS.frontier = [
  'om-retail-media', 'om-social-commerce', 'om-ctv-programmatic', 'om-brand-growth-science', 'om-plg-playbook', 'om-partner-ecosystems', 'om-green-claims',
  'om-agentic-commerce', 'aaron-marketing:search-term-miner', 'aaron-marketing:product-feed-optimizer', 'kj-ctv-ads', 'kj-display-ads', 'kj-native-ads',
  'kj-affiliate-program', 'kj-affiliate-marketing', 'kj-creator-program', 'kj-referral-program', 'kj-education-program', 'ext-bb-brand-measurement',
  'ext-bb-brand-partnerships', 'ext-bb-d2c-marketing', 'marketing-skills:referrals', 'marketing-skills:events', 'marketing-skills:co-marketing',
  'marketing-skills:paywalls', 'marketing-skills:onboarding', 'product-skills:product-analytics', 'finance-skills:saas-metrics-coach',
  'pm-go-to-market:growth-loops', 'ext-wd-cold-start-problem', 'aaron-marketing:advocacy-program-designer', 'aaron-marketing:category-narrative-mapper',
];
// The zero pack: Zero-Budget Growth & Funnel (wave 8) and the existing agents that find, answer and
// close leads without ad spend.
PACKS.zero = [
  'om-zero-budget-growth', 'om-funnel-management', 'ext-wd-cold-start-problem', 'kj-cold-start', 'kj-distribution-channels', 'kj-referral-program',
  'kj-community-forum', 'kj-reddit', 'kj-directory-submission', 'kj-local', 'kj-contest', 'kj-disclosure', 'marketing-skills:community-marketing',
  'marketing-skills:referrals', 'marketing-skills:co-marketing', 'marketing-skills:lead-magnets', 'marketing-skills:free-tools', 'marketing-skills:marketing-loops',
  'aaron-marketing:participation-warmup-planner', 'aaron-marketing:platform-norm-profiler', 'aaron-marketing:advocacy-program-designer',
  'aaron-marketing:list-growth-designer', 'aaron-marketing:dark-social-attributor', 'ext-ss-referral-intro', 'ext-wd-one-page-marketing', 'pm-go-to-market:growth-loops',
];
// Wave 9 department packs. consulting is already a pack (above); ailab masters the AI pack and
// growth-free the zero pack.
PACKS.ailab = [...PACKS.ai];
PACKS['growth-free'] = [...PACKS.zero];
PACKS.trust = [
  'ra-qm-skills:gdpr-dsgvo-expert', 'ra-qm-skills:eu-ai-act-specialist',
  'ra-qm-skills:soc2-compliance', 'kj-privacy', 'kj-cookie-policy', 'kj-disclosure', 'kj-legal', 'kj-terms', 'pm-toolkit:privacy-policy',
  'aaron-marketing:consent-registry', 'aaron-marketing:offer-claims-registry', 'aaron-marketing:proof-point-packager', 'operations:compliance-tracking',
  'om-green-claims', 'om-ai-content-provenance', 'om-ai-guardrails', 'web-quality-skills:accessibility',
];
PACKS.pr = [
  'aaron-marketing:press-media-relations', 'marketing-skills:public-relations', 'kj-public-relations', 'kj-press-coverage', 'kj-media-kit',
  'aaron-marketing:crisis-response-planner', 'kj-brand-monitoring', 'oc-brand-monitor', 'geo-brand-mentions', 'aaron-marketing:share-of-voice-tracker',
  'aaron-marketing:proof-point-packager', 'aaron-marketing:pitch-narrative-builder', 'kj-podcast', 'kj-customer-stories', 'ext-bw-case-study-builder',
  'ext-wd-made-to-stick', 'ext-wd-contagious', 'kj-testimonials', 'small-business:review-reputation', 'oc-google-reviews',
];
PACKS.partners = [
  'om-partner-ecosystems', 'kj-affiliate-program', 'kj-affiliate-marketing', 'kj-creator-program', 'kj-influencer-marketing', 'marketing-skills:influencer-marketing',
  'aaron-marketing:influencer-discovery', 'aaron-marketing:fit-scorer', 'aaron-marketing:outreach-manager', 'aaron-marketing:contract-helper',
  'aaron-marketing:creator-content-auditor', 'aaron-marketing:roi-calculator', 'aaron-marketing:creator-registry', 'ext-bb-brand-partnerships',
  'ext-bb-influencer-marketing', 'ext-bb-ugc-strategy', 'marketing-skills:co-marketing', 'marketing-skills:referrals', 'oc-affiliate-marketing', 'kj-integrations', 'kj-disclosure',
];
PACKS.global = [
  'kj-localization', 'kj-translation', 'claude-blog:blog-localize', 'claude-blog:blog-locale-audit', 'claude-blog:blog-translate', 'claude-blog:blog-multilingual',
  'claude-seo:seo-hreflang', 'oc-i18n', 'c-level-skills:intl-expansion', 'pm-market-research:market-sizing',
  'ext-wsh-market-sizing-analysis', 'pm-product-strategy:pestle-analysis', 'kj-pricing-strategy', 'kj-shipping', 'kj-refund', 'ext-bb-brand-voice',
];
PACKS.data = [
  'data:analyze', 'data:statistical-analysis', 'data:explore-data', 'data:validate-data', 'data:sql-queries', 'data:data-visualization',
  'pm-data-analytics:cohort-analysis', 'pm-data-analytics:ab-test-analysis', 'product-skills:product-analytics', 'om-ai-personalization', 'ext-wd-lean-analytics',
  'ext-wsh-kpi-dashboard-design',
  'marketing-skills:analytics-tracking', 'marketing-skills:campaign-analytics', 'pm-market-research:user-segmentation', 'pm-market-research:market-segments',
  'aaron-marketing:audience-segment-builder',
];
PACKS.commerce = [
  'om-retail-media', 'om-social-commerce', 'om-agentic-commerce', 'aaron-marketing:product-feed-optimizer', 'aaron-marketing:search-term-miner', 'ext-bb-d2c-marketing',
  'claude-seo:seo-ecommerce', 'kj-products', 'kj-category-pages', 'kj-shipping', 'kj-refund', 'kj-discount-marketing',
  'kj-pricing-strategy', 'marketing-skills:offers', 'aaron-marketing:roi-calculator',
];
// Wave 10 department packs (roster-wave10.mjs): each starts with the department's own method skill.
PACKS.pmm = ['om-product-marketing', 'marketing-skills:product-marketing', 'oc-product-marketing', 'marketing-skills:sales-enablement', 'aaron-marketing:sales-enablement-kit', 'aaron-marketing:launch-tier-planner', 'aaron-marketing:message-house-builder', 'aaron-marketing:positioning-mapper', 'ext-wd-obviously-awesome', 'pm-go-to-market:competitive-battlecard', 'marketing-skills:competitor-profiling', 'ext-bw-case-study-builder', 'kj-customer-stories', 'kj-pricing', 'pm-execution:release-notes', 'kj-changelog', 'product-skills:competitive-teardown', 'marketing-skills:launch', 'pm-go-to-market:gtm-strategy', 'pm-market-research:user-personas'];
PACKS.studio = ['om-video-studio', 'marketing-skills:video', 'marketing-skills:youtube-full', 'aaron-marketing:short-video-scripter', 'kj-video', 'kj-video-optimization', 'kj-youtube', 'kj-youtube-ads', 'kj-podcast', 'oc-podcast-edit', 'oc-podcast-marketing', 'oc-youtube-analytics', 'oc-video-ad-analysis', 'marketing-skills:webinar-marketing', 'kj-visual-content', 'oc-content-repurposing', 'om-ai-content-provenance'];
PACKS.success = ['om-customer-success', 'kj-docs', 'kj-faq', 'ext-bb-brand-voice', 'ext-ss-sales-context', 'ext-wd-mom-test', 'business-growth-skills:customer-success-manager', 'marketing-skills:churn-prevention', 'ext-wd-improve-retention', 'om-funnel-management', 'kj-education-program', 'pm-market-research:sentiment-analysis', 'pm-product-discovery:analyze-feature-requests', 'kj-feedback', 'marketing-skills:onboarding'];
PACKS.martech = ['om-martech-ops', 'kj-gtm', 'kj-tracking', 'ext-rae-google-tag-manager', 'marketing-skills:conversion-tracking', 'marketing-skills:analytics-tracking', 'web-quality-skills:core-web-vitals', 'web-quality-skills:performance', 'kj-core-web-vitals', 'kj-rendering-strategies', 'kj-migration', 'aaron-marketing:email-render-builder', 'engineering-skills:email-template-builder', 'kj-schema', 'marketing-skills:schema', 'aaron-marketing:conversion-signal-qa', 'engineering-skills:senior-frontend', 'marketing-skills:marketing-ops'];
PACKS.local = ['om-local-marketing', 'kj-local', 'marketing-skills:local-seo-manager', 'claude-seo:seo-local', 'claude-seo:seo-maps', 'oc-google-reviews', 'small-business:review-reputation', 'geo-platform-optimizer', 'kj-directory-listing-ads', 'kj-directory-submission', 'kj-schema', 'marketing-skills:events', 'kj-discount-marketing', 'marketing-skills:co-marketing', 'om-zero-budget-growth'];
PACKS.community = ['om-community-events', 'marketing-skills:community-marketing', 'kj-community-forum', 'marketing-skills:events', 'aaron-marketing:advocacy-program-designer', 'aaron-marketing:community-launch-runner', 'aaron-marketing:participation-warmup-planner', 'aaron-marketing:platform-norm-profiler', 'oc-discord-bot', 'kj-education-program', 'ext-ss-event-networking', 'marketing-skills:webinar-marketing', 'oc-slack-bot', 'kj-referral-program', 'ext-bb-ugc-strategy'];
// Extra knowledge topics a pack brings with it.
const PACK_TOPICS = { ai: ['ai-tech', 'ai-marketing-tools'], consulting: ['management-canon', 'canon-marketing', 'canon-sales', 'canon-brand', 'consulting'], frontier: ['retail-media', 'video-ctv', 'brand-science', 'plg', 'partnerships', 'ecommerce'], zero: ['social-organic', 'search', 'email', 'cro-ux'] };

export const knowledgeFor = (a) => (a.tier === 'micro' ? [] : [...new Set([...(a.spans ?? [a.dept]).flatMap(topicsForDept), ...(a.packs ?? []).flatMap((p) => PACK_TOPICS[p] ?? [])])].map(knowledgeSkill));
export const packFor = (a) => [...new Set([...(a.spans ?? [a.dept]).flatMap((d) => PACKS[d] ?? []), ...(a.packs ?? []).flatMap((p) => PACKS[p] ?? []), ...(a.tier === 'micro' ? [] : CORE)])].filter((s) => !a.skills?.includes(s));
export const allPackSkills = () => [...new Set([...CORE, ...Object.values(PACKS).flat(), ...Object.keys(TOPICS).map(knowledgeSkill)])];
