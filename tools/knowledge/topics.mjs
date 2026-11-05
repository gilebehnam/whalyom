// Knowledge topics and the departments each one teaches. A fact's topic decides which
// department briefs (knowledge/briefs/<dept>.md) and which generated knowledge skill
// (.claude/skills/om-knowledge-<topic>/SKILL.md) carry it. Pure data: imported by the roster,
// the skill packs and the knowledge tools.
export const TOPICS = {
  search: { title: 'Search engines and SEO rules', depts: ['seo', 'intel', 'global', 'growth-free', 'local', 'martech'] },
  'ai-search': { title: 'AI search and answer engines', depts: ['seo', 'intel', 'paid'] },
  'paid-search': { title: 'Paid search platforms', depts: ['paid', 'finops'] },
  'paid-social': { title: 'Paid social platforms', depts: ['paid', 'creative'] },
  'social-organic': { title: 'Organic social platforms and algorithms', depts: ['social', 'creative', 'partners', 'growth-free', 'studio', 'community'] },
  email: { title: 'Email, deliverability and messaging', depts: ['lifecycle', 'leadgen', 'growth-free', 'martech', 'success'] },
  'privacy-law': { title: 'Privacy, consent and data law', depts: ['sovereign', 'finops', 'lifecycle', 'leadgen', 'trust', 'data', 'martech', 'community'] },
  'ai-regulation': { title: 'AI and consumer-protection rules', depts: ['sovereign', 'creative', 'social', 'trust', 'ailab'] },
  'cro-ux': { title: 'Conversion, UX, speed and accessibility', depts: ['funnel', 'seo', 'commerce', 'growth-free', 'martech', 'pmm'] },
  'analytics-measurement': { title: 'Analytics, tracking and measurement', depts: ['finops', 'paid', 'data', 'martech', 'community'] },
  'app-stores': { title: 'App stores and extension stores', depts: ['social', 'paid'] },
  ecommerce: { title: 'Commerce feeds, shopping and checkout', depts: ['paid', 'funnel', 'commerce', 'global'] },
  'b2b-sales': { title: 'B2B outbound and sales', depts: ['leadgen', 'closer', 'pmm', 'success'] },
  content: { title: 'Content quality and editorial standards', depts: ['seo', 'creative', 'pr', 'studio', 'success'] },
  pricing: { title: 'Pricing and offers', depts: ['strategy', 'funnel', 'commerce', 'global', 'pmm', 'local'] },
  research: { title: 'Marketing science and research findings', depts: ['strategy', 'intel', 'finops', 'data'] },
  consulting: { title: 'Digital marketing strategy and management consulting', depts: ['sovereign', 'strategy', 'finops', 'closer', 'consulting'] },
  'ai-tech': { title: 'AI agents, models and agentic commerce', depts: ['evolve', 'sovereign', 'creative', 'closer', 'seo', 'ailab'] },
  'management-canon': { title: 'Strategy and management canon: McKinsey, BCG, Bain, the Big Four, HBR and HBS', depts: ['sovereign', 'strategy', 'finops', 'closer', 'intel', 'consulting'] },
  'canon-marketing': { title: 'Marketing and growth research from McKinsey, BCG, Bain, the Big Four, Accenture, HBR and HBS', depts: ['strategy', 'finops', 'paid', 'lifecycle', 'funnel', 'intel', 'sovereign', 'consulting'] },
  'canon-sales': { title: 'Sales, pricing and commercial excellence research from McKinsey, BCG, Bain, the Big Four, Accenture, HBR and HBS', depts: ['closer', 'leadgen', 'strategy', 'finops'] },
  'ai-marketing-tools': { title: 'AI marketing tools, platforms and their new capabilities', depts: ['evolve', 'intel', 'creative', 'paid', 'seo', 'lifecycle', 'closer', 'ailab'] },
  'canon-brand': { title: 'Branding, customer experience and loyalty research from McKinsey, BCG, Bain, the Big Four, Accenture, HBR and HBS', depts: ['strategy', 'creative', 'lifecycle', 'social', 'sovereign', 'pr'] },
  // Wave 7 (roster-wave7.mjs): commerce, video, brand science, product-led growth and partner ecosystems.
  'retail-media': { title: 'Retail media, marketplaces and social commerce', depts: ['paid', 'funnel', 'social', 'commerce'] },
  'video-ctv': { title: 'Video, connected TV and programmatic buying', depts: ['paid', 'creative', 'finops', 'studio'] },
  'brand-science': { title: 'Brand growth science: Ehrenberg-Bass, IPA effectiveness, mental and physical availability', depts: ['strategy', 'creative', 'finops', 'sovereign'] },
  plg: { title: 'Product-led growth, freemium, trials and in-product conversion', depts: ['funnel', 'lifecycle', 'strategy', 'success', 'pmm'] },
  partnerships: { title: 'Partner ecosystems, affiliates, creators and channel sales', depts: ['social', 'leadgen', 'closer', 'partners'] },
};

// What a fact is. rule: a platform, law or policy requirement with a date; framework: an evergreen
// method with its primary source (consulting canon); benchmark: a dated number with segment and
// sample; finding: a research result with its effect size and context; case: a documented outcome.
export const KINDS = ['rule', 'framework', 'benchmark', 'finding', 'case'];
// Minimum verified facts a topic should hold; thinner topics are "gaps" the knowledge loop grows.
export const TARGET_FACTS = 15;

export const TIERS = ['official', 'primary', 'research', 'industry'];
export const CONFIDENCE = ['high', 'medium'];
export const knowledgeSkill = (topic) => `om-knowledge-${topic}`;
export const topicsForDept = (dept) => Object.keys(TOPICS).filter((t) => TOPICS[t].depts.includes(dept));
