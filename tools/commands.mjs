// The ready-made slash commands: one catalog, written into .claude/commands/<name>.md and COMMANDS.md.
//   node tools/commands.mjs            write the command files and docs/COMMANDS.md
//   node tools/commands.mjs --check    exit 1 when the files on disk differ from the catalog
// Every command is a thin, readable entry point into what already exists: an om skill command,
// a saved workflow in .claude/workflows/, or a deterministic tool. The rules in rules/ apply to all of them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SLUG = '<product-slug>';
const om = (cmd) => `Use the \`om\` skill and run its \`${cmd}\` command.`;
const flow = (wf, extra = '') => `Use the \`om\` skill and run \`flow ${wf} <slug>${extra}\` (the saved workflow \`.claude/workflows/${wf}.js\`).`;

export const GROUPS = [
  ['start', 'Start'],
  ['run', 'Plan and run'],
  ['grow', 'Grow'],
  ['sell', 'Sell'],
  ['measure', 'Measure'],
  ['guard', 'Guard'],
  ['brand', 'Brand and product'],
  ['content', 'Content and media'],
  ['reach', 'Partners, PR and community'],
  ['customers', 'Customers'],
  ['local', 'Local and commerce'],
  ['data', 'Data and AI'],
  ['system', 'System'],
];

// One job for one specialist: the command dispatches that agent with a brief, and the agent's own
// definition in .claude/agents/ says what it reads, what it writes and which rules hold.
const job = (agent, brief) => [
  `Dispatch the \`${agent}\` agent (\`.claude/agents/${agent}.md\`) on \`products/<slug>/\` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).`,
  `Brief: ${brief}`,
  'When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.',
];

// name, group, args, description, body lines. $ARGUMENTS is what the owner typed after the command.
export const COMMANDS = [
  ['whalyom-new', 'start', '<slug> [domain]', 'Add a product: a workspace from a domain or a short brief',
    [om('new $ARGUMENTS'), 'Without a domain, ask the owner for a five-line brief (what it is, who buys it, price, market, goal) and write `brief.md`.', 'Finish by suggesting `/whalyom-onboard <slug>`.']],
  ['whalyom-onboard', 'start', SLUG, 'Onboard a product: crawl, ICP, competitors, claims, profile and a 30-day plan',
    [om('onboard $ARGUMENTS'), 'Show the owner `profile.md`, `claims.md` and `plan.md` and ask for approval before the product goes active.']],
  ['site-audit', 'start', '<domain or slug>', 'Instant marketing audit of a site: SEO, AI search, speed, conversion and trust',
    ['If the argument is a domain without a workspace, run `node tools/instant-onboard.mjs $ARGUMENTS` for the instant audit.', 'If it is a slug, dispatch om-site-crawler, om-tech-seo, om-geo-optimizer and om-cro in one message, each writing to `products/<slug>/research/`.', 'Report the ten fixes with the biggest expected effect first, each with the file or page it touches.']],
  ['growth-plan', 'run', SLUG, 'Write or refresh the 30-day growth plan (om-cmo) from the budget, mode and learnings',
    [om('plan $ARGUMENTS')]],
  ['autopilot', 'run', SLUG, 'Run the mega-agent cycle: plan, parallel waves, review, learn, report',
    [om('auto $ARGUMENTS'), 'Live mode by default; add `--batch` to run the saved workflow `om-autopilot` instead.']],
  ['autopilot-all', 'run', '', 'Run the cycle for every active product',
    [om('auto-all')]],
  ['mega-sweep', 'run', SLUG, 'All department heads in parallel, then the revenue constraint and a red-team check',
    [flow('om-mega-sweep')]],
  ['next-wave', 'run', SLUG, 'Run one wave of ready tasks by hand',
    [om('run $ARGUMENTS')]],
  ['seo-sprint', 'grow', SLUG, 'Keyword cluster to briefs, articles, schema, internal links and indexing',
    [flow('om-seo-sprint')]],
  ['ai-search', 'grow', SLUG, 'Get cited by ChatGPT, Perplexity, Gemini and AI Overviews (AEO)',
    [flow('om-aeo'), 'Then run `node tools/ai-visibility.mjs <slug>` and show share of answer per engine.']],
  ['content-engine', 'grow', '<slug> [topic]', 'One pillar piece turned into about 20 reviewed, tracked, scheduled assets',
    [flow('om-content-engine', ' topic=<topic>')]],
  ['landing', 'grow', '<slug> [goal]', 'Brief, copy, build, QA and variants of a landing page',
    [flow('om-landing'), 'For static templates only: `node tools/landing-builder.mjs <slug> --template all`.']],
  ['free-growth', 'grow', '<slug> [hours]', 'Zero ad budget: free channels planned in hours, with tracked links',
    [flow('om-free-growth', ' hours=<hours>'), 'Then run `node tools/free-engine.mjs <slug>` and show where the hours go.']],
  ['paid-ads', 'grow', SLUG, 'Paid media inside the caps: sniper mode for small budgets, portfolio for larger ones',
    ['Read `budget.monthly_cap` and `budget.micro_threshold` in `products/<slug>/product.json`.', `At or under the threshold: ${flow('om-paid-sniper')}`, `Above it: ${flow('om-paid-portfolio')}`, 'No spend happens without an approval and the caps.']],
  ['launch', 'grow', '<slug> [date]', 'A launch from T-14 to T+7: Product Hunt, Hacker News, Reddit, newsletters',
    [flow('om-launch', ' launchDate=<date>')]],
  ['localize', 'grow', '<slug> [markets]', 'Enter new markets: hreflang, localized pages and campaigns',
    [flow('om-localize', ' markets=<markets>')]],
  ['competitors', 'grow', SLUG, 'Weekly competitor diff, battlecards and counter-moves',
    ['Run `node tools/competitor-watch.mjs <slug>` first.', flow('om-competitor-watch')]],
  ['leads', 'sell', SLUG, 'Every lead, its stage and the next action; hot leads first',
    ['Run `node tools/funnel.mjs <slug>` and `node tools/lead-score.mjs <slug>`.', 'Show hot leads, leads waiting past the SLA and `funnel/next-actions.json`, without personal data in the summary.']],
  ['lead-to-sale', 'sell', SLUG, 'Speed-to-lead, SDR reply, follow-ups and checkout for each inbound lead',
    [flow('om-lead-to-sale')]],
  ['crm', 'sell', '<slug> [--propose]', 'Contacts, deals, weighted forecast and slipping deals',
    [om('crm $ARGUMENTS')]],
  ['sequences', 'sell', '<slug> [--dry-run]', 'Turn due sequence steps into send approvals (consent and caps checked)',
    [om('sequences $ARGUMENTS')]],
  ['inbox', 'sell', SLUG, 'Classify replies (interested, not now, unsubscribe, bounce) and move the funnel',
    [om('inbox $ARGUMENTS')]],
  ['lifecycle', 'sell', SLUG, 'Onboarding, activation, upgrade, churn, win-back and advocacy sequences',
    [flow('om-lifecycle')]],
  ['cro', 'sell', SLUG, 'Find friction, test fixes with bandits, keep what wins',
    [flow('om-cro-loop')]],
  ['attribution', 'measure', SLUG, 'Revenue credited five ways, plus an MMM-lite when there is enough data',
    [om('attribution $ARGUMENTS')]],
  ['ab-test', 'measure', '<slug> [snippet]', 'Thompson-sampling tests; start and rollout only by approval',
    [om('ab $ARGUMENTS')]],
  ['weekly-retro', 'measure', SLUG, 'Metrics, anomalies, what worked, learnings and next week',
    [flow('om-weekly-retro')]],
  ['report', 'measure', '', 'Products, blocked tasks, pending approvals and the dashboard data',
    [om('status'), 'Then show the Needs You Know briefing from `node tools/needs-you-know.mjs`.']],
  ['approvals', 'guard', '<slug> [id] [yes|no|edit: ...]', 'See and decide what is waiting for you; nothing goes out without it',
    ['Without an id: list `products/<slug>/approvals.json` items with status `pending`, each with its compliance verdict.', `With an id and a decision from the owner: ${om('approve $ARGUMENTS')}`, 'Only the owner decides. Never approve on the owner\'s behalf.']],
  ['brand-check', 'guard', SLUG, 'Check every draft against the voice and the verified claims',
    [om('voice $ARGUMENTS --review')]],
  ['kill-switch', 'guard', SLUG, 'Pause ad variants that spend without converting',
    ['Run `node tools/killswitch.mjs $ARGUMENTS` and show what was paused and why.']],
  ['budget', 'guard', SLUG, 'Spend this month against the caps, per channel, and the proposed split',
    ['Run `node tools/budget.mjs $ARGUMENTS` and `node tools/reallocate.mjs $ARGUMENTS --dry-run`.', 'Show spend against `monthly_cap` and `daily_cap`. Only the owner can raise a cap.']],
  ['knowledge', 'system', '', 'Refresh the verified knowledge base from official and research sources',
    ['Run `node tools/knowledge.mjs cycle` for the deterministic steps.', `Then use the \`om\` skill and run \`flow om-knowledge-refresh\` for the extraction and verification steps.`]],
  ['evolve', 'system', '', 'Benchmark the weakest agents, improve them, ship only measured gains',
    [`Use the \`om\` skill and run \`flow om-evolve\`.`]],
  ['self-heal', 'system', '[slug]', 'Find and fix broken workspaces and tools, then run the tests',
    [`Use the \`om\` skill and run \`flow om-self-heal\` (with \`slug=$ARGUMENTS\` when given).`, 'Finish with `npm test`.']],
  ['command-center', 'system', '', 'Open the local Command Center (live agents, funnel, decisions)',
    ['Run `npm run command-center` in the background and give the owner http://localhost:4321.']],
  ['daemon', 'system', '[minutes]', 'Start the always-on cycle (no LLM): funnel, inbox, policy, execute, learn',
    ['Run `node tools/daemon.mjs` once, or `node tools/daemon.mjs --loop $ARGUMENTS` in the background to repeat it.']],
  ['workforce', 'system', '[department]', 'Browse the workforce: departments, heads, specialists and micro agents',
    ['Read `state/live-roster.json` (rebuild it with `node tools/live-snapshot.mjs` if it is missing) and show the departments with their head and agent count; with a department name, list its agents and what each does.']],
];

// Specialist jobs: [name, group, args, description, agent, brief].
const JOBS = [
  // Brand and product
  ['positioning', 'brand', SLUG, 'Find the category, the alternatives and the unique value that make you the obvious choice', 'om-positioning-strategist', 'positioning against the real alternatives buyers consider, from research/ and reviews; one positioning statement and what changes on the site.'],
  ['message-house', 'brand', SLUG, 'One promise, three pillars, proof for each, lines for every channel', 'om-message-architect', 'the message house from profile.md and claims.md; every line has proof.'],
  ['offer', 'brand', SLUG, 'Design the offer stack: core offer, bonuses, guarantee and real urgency', 'om-offer-engineer', 'an offer stack inside claims.md; no fake scarcity or countdowns.'],
  ['pricing-review', 'brand', SLUG, 'Review pricing and packaging; prices stay the owner\'s decision', 'om-pricing-offer', 'packaging and price review with competitor prices from research/; any price change is an owner decision.'],
  ['naming', 'brand', '<slug> <what to name>', 'Names for a product, plan or campaign, screened for meaning, domains and conflicts', 'om-naming-strategist', 'candidates for what the owner named, screened in each target language, with domain and handle checks.'],
  ['icp', 'brand', SLUG, 'The ideal customer profile and two or three personas with their words', 'om-icp-builder', 'ICP and personas from research and real customer language.'],
  ['jobs-to-be-done', 'brand', SLUG, 'The jobs, triggers, anxieties and forces that make buyers switch', 'om-jtbd-analyst', 'jobs, triggers and switching forces with quotes and sources.'],
  ['product-messaging', 'brand', '<slug> <feature>', 'What a feature means to each buyer: problem, value, proof and words', 'om-product-marketer', 'messaging for the feature the owner named, per segment, proof from claims.md only.'],
  ['release', 'brand', '<slug> <change>', 'Tier a release and plan what each tier gets across channels', 'om-release-marketer', 'tier the change the owner described and draft what that tier gets; sends are approvals.'],
  ['enablement', 'brand', SLUG, 'The kit sellers use: one-pager, discovery questions, objections, proof', 'om-sales-enablement-lead', 'the sales kit in sales/enablement/, dated, from claims.md and battlecards.'],
  ['case-study', 'brand', '<slug> <customer>', 'A case study from a real result, with the customer\'s written approval', 'om-case-study-writer', 'a case study only from results the owner provides; the customer approves quotes and numbers before use.'],
  ['battlecard', 'brand', '<slug> <competitor>', 'Where you win, where you lose, landmines and proof, per competitor', 'om-battlecard', 'a battlecard for the competitor named, from their own pages and real reviews, fair and dated.'],
  // Content and media
  ['article', 'content', '<slug> <topic or keyword>', 'One answer-first, sourced article from a brief', 'om-writer', 'one article for the topic named, answer first, every fact sourced, then om-editor checks it.'],
  ['edit', 'content', '<slug> <file>', 'Edit and fact-check a draft before it goes anywhere', 'om-editor', 'edit the named draft for clarity and voice and check every fact and claim.'],
  ['humanize', 'content', '<slug> <file>', 'Rewrite a draft so it reads like an experienced person wrote it', 'om-humanizer', 'remove AI tells and filler from the named draft and keep every fact.'],
  ['newsletter', 'content', SLUG, 'This issue of the newsletter: one idea, one product story, one call to action', 'om-newsletter-editor', 'the next issue as a draft; sending is an approval.'],
  ['social-posts', 'content', '<slug> <source>', 'Turn one piece into posts for X, LinkedIn, Reddit and newsletters', 'om-social-repurposer', 'repurpose the source into channel-native posts with tracked links.'],
  ['linkedin', 'content', SLUG, 'Founder and company posts for B2B audiences', 'om-linkedin', 'a week of LinkedIn posts from real stories and claims.'],
  ['video-script', 'content', '<slug> <topic>', 'A short-form script or a YouTube outline that demos the product', 'om-video-scripter', 'a script with a hook in the first seconds, the demo and one call to action.'],
  ['video-cut', 'content', '<slug> <recording>', 'One long recording into clips, Shorts, quotes and an article outline', 'om-video-repurposer', 'cut list with times, hooks and captions; edits go to om-video-assembler.'],
  ['captions', 'content', '<slug> <video>', 'Accurate captions, subtitle files and a transcript for one video', 'om-caption-subtitler', 'edited captions with names and numbers checked against claims.md.'],
  ['podcast', 'content', '<slug> [topic]', 'Plan a podcast episode or guest appearances: topics, questions, notes, clips', 'om-podcast-producer', 'an episode plan with questions, show notes and clip list.'],
  ['webinar', 'content', '<slug> [topic]', 'A webinar or live demo: topic, outline, invites and follow-up', 'om-webinar-producer', 'the webinar plan and invite sequence; sends are approvals.'],
  ['lead-magnet', 'content', SLUG, 'A checklist, template or mini-course that earns an email', 'om-lead-magnet', 'one lead magnet and its capture page draft.'],
  ['free-tool', 'content', SLUG, 'A small free tool (calculator, checker) that earns links and leads', 'om-free-tool-builder', 'a free tool spec and build that answers a real buyer question.'],
  ['ads-copy', 'content', '<slug> <platform>', 'Ad variants per angle for one platform, with image and video briefs', 'om-ad-creative', 'ad variants inside the platform limits, every claim from claims.md.'],
  ['email-sequence', 'content', '<slug> <goal>', 'Welcome, nurture, trial-to-paid or win-back email sequence', 'om-email-nurture', 'the sequence for the goal named with triggers and timing; consent rules apply.'],
  // Partners, PR and community
  ['press', 'reach', SLUG, 'Journalists, newsletters and podcasts covering your space, with short pitches', 'om-pr-outreach', 'a target list and personal pitches; every pitch is an approval.'],
  ['press-kit', 'reach', SLUG, 'The press kit page: boilerplate, facts, bios, logos, screenshots, contact', 'om-press-kit', 'the press kit from claims.md and the brand assets.'],
  ['reviews', 'reach', SLUG, 'Grow and answer reviews honestly on the sites buyers check', 'om-reputation-manager', 'review audit and plan; ask every customer, never gated or paid; replies are approvals.'],
  ['crisis', 'reach', '<slug> <what happened>', 'Holding statement, FAQ, replies and what to pause when something goes wrong', 'om-crisis-responder', 'holding statement and FAQ for the incident described, and the list of scheduled posts and ads to pause.'],
  ['affiliates', 'reach', SLUG, 'An affiliate program: who to recruit, terms, fraud checks', 'om-affiliate-recruiter', 'affiliate candidates and the pitch; terms and payouts are owner decisions.'],
  ['creators', 'reach', SLUG, 'Creators whose audience matches yours, with outreach and deal terms', 'om-influencer-scout', 'creator shortlist with fit, rates if public and disclosure terms.'],
  ['partners', 'reach', SLUG, 'Complementary products and agencies for co-marketing and referrals', 'om-partner-scout', 'partner candidates and a proposed swap for each.'],
  ['community', 'reach', SLUG, 'Run the owned community: calendar, welcome flow, rituals, moderation', 'om-community-manager', 'the community calendar and this week\'s posts; never fake members or activity.'],
  ['ambassadors', 'reach', SLUG, 'An ambassador program with disclosed benefits and tracked referrals', 'om-ambassador-program', 'the program design and invitations as approvals.'],
  ['events', 'reach', SLUG, 'Conferences, meetups and calls for speakers where your buyers gather', 'om-events-scout', 'events in the target markets with dates, cost and the best way in.'],
  ['meetup', 'reach', '<slug> <city or topic>', 'An in-person meetup or workshop with run sheet and follow-up', 'om-meetup-organizer', 'the full run sheet, registration with consent and follow-up.'],
  ['summit', 'reach', '<slug> <theme>', 'An online summit with speakers, schedule, registration and replays', 'om-virtual-summit-producer', 'summit plan; speakers confirm in writing; sends and spend are approvals.'],
  ['reddit', 'reach', SLUG, 'Threads where the product genuinely helps, with replies that follow each subreddit\'s rules', 'om-reddit', 'helpful replies after reading each community\'s rules; posting is an approval.'],
  ['product-hunt', 'reach', '<slug> [date]', 'Product Hunt launch from T-14 to T+7', 'om-producthunt', 'assets, tagline, maker comment and the launch-day checklist; no vote requests.'],
  // Customers
  ['onboarding', 'customers', SLUG, 'The first 30 days of a new customer, to the first value moment', 'om-success-onboarding-manager', 'first value moment from usage data and the steps to reach it.'],
  ['support-faq', 'customers', SLUG, 'Cut repeat tickets with help articles, hints and verified chat answers', 'om-support-deflection', 'ticket topics by volume (no personal data) and fixes for the top ten.'],
  ['support-macros', 'customers', SLUG, 'Support reply templates in your voice, with steps and escalation', 'om-support-macro-writer', 'macros that never promise anything outside the policy.'],
  ['health-score', 'customers', SLUG, 'Customer health from usage, billing and support, and who needs attention', 'om-health-score-designer', 'a health score with stated weights and this week\'s at-risk accounts.'],
  ['churn', 'customers', SLUG, 'Cancel flows, save offers and at-risk alerts', 'om-churn-preventer', 'cancel flow and save offers inside the deal-desk rules.'],
  ['win-back', 'customers', SLUG, 'Win back churned and inactive customers', 'om-winback', 'a win-back campaign for consented contacts only.'],
  ['referrals', 'customers', SLUG, 'Turn happy customers into reviews, referrals and case studies', 'om-ugc-review-engine', 'review and referral asks at the right moment, disclosed and consented.'],
  ['survey', 'customers', SLUG, 'An NPS or feedback survey, and a summary of the answers', 'om-nps-survey', 'the survey and, when answers exist, the themes with quotes.'],
  ['customer-voice', 'customers', SLUG, 'Group customer feedback, send themes to product, tell customers what changed', 'om-voc-loop-manager', 'monthly voice-of-customer themes and the loop-closing drafts.'],
  // Local and commerce
  ['local-profile', 'local', SLUG, 'Google Business Profile, Apple Business Connect and Bing Places complete and active', 'om-gbp-manager', 'profile gaps and this week\'s posts; edits and replies are approvals.'],
  ['citations', 'local', SLUG, 'Consistent name, address and phone across directories and maps', 'om-local-citations', 'citation audit with the fix per listing.'],
  ['local-ads', 'local', SLUG, 'Local service and radius ads inside the caps, measured in calls and bookings', 'om-local-ads-planner', 'local campaigns with kill rules; spend only through approvals.'],
  ['promo', 'local', '<slug> <occasion>', 'An in-store, pop-up or event promotion with a code that proves what it brought', 'om-field-promo-planner', 'the promotion with its code, dates and material; printing and spend are approvals.'],
  ['marketplaces', 'local', SLUG, 'Rank listings on Amazon, Etsy, eBay and regional marketplaces', 'om-marketplace-seo', 'listing fixes: titles, bullets, attributes, images and Q&A.'],
  ['shopping-feed', 'local', SLUG, 'Fix the Google and Microsoft merchant feeds and free listings', 'om-merchant-feed', 'feed errors and fixes per product.'],
  ['unit-economics', 'local', SLUG, 'Profit per order and per customer by channel, and break-even ROAS', 'om-unit-economics-analyst', 'contribution margin per channel from real exports.'],
  // Data and AI
  ['tracking', 'data', SLUG, 'Analytics, conversion events, UTMs and pixels so every channel can be measured', 'om-tracking-engineer', 'the tracking plan and what is broken today.'],
  ['tags', 'data', SLUG, 'Clean the tag manager: consent-gated tags, naming, no personal data', 'om-tag-governance', 'tag audit and the container changes as an approval.'],
  ['stack-audit', 'data', SLUG, 'The marketing tools you pay for: overlap, unused seats, cost and data flows', 'om-martech-stack-auditor', 'stack table with keep, replace or cancel and the reason.'],
  ['site-change', 'data', '<slug> <change>', 'Ship an approved site change as a reviewed diff with a rollback', 'om-site-engineer', 'the change as files under outbox/martech/changes/ with test and rollback; nothing goes live without approval.'],
  ['speed', 'data', SLUG, 'Core Web Vitals problems and the code-level fixes', 'om-page-speed', 'field and lab numbers and the fixes in order of impact.'],
  ['segments', 'data', SLUG, 'Customer segments that are stable and worth a different message', 'om-segment-discoverer', 'segments from consented first-party data, named in buyers\' words.'],
  ['forecast', 'data', SLUG, 'Next month\'s leads and revenue from trends and planned work', 'om-forecaster', 'forecast with a range and the assumptions.'],
  ['ai-agent', 'data', '<slug> <use>', 'Design a customer-facing AI agent: tools, knowledge, guardrails, handoff, evals', 'om-ai-agent-architect', 'a reviewed blueprint for the use named; nothing goes live without approval.'],
  ['ai-readiness', 'data', SLUG, 'How well AI agents and assistants can read and use your site', 'om-agent-readiness-auditor', 'agent-readiness audit with the fixes.'],
  ['privacy', 'data', SLUG, 'The data map, consent setup and privacy notice check', 'om-privacy-officer', 'data map, lawful basis and gaps; legal text goes to the owner and a lawyer.'],
  ['compliance', 'data', '<slug> [file]', 'Check drafts against claims, platform rules and email law before approval', 'om-compliance-guard', 'review the named drafts (or every pending one) and write the verdicts.'],
];
for (const [name, group, args, description, agent, brief] of JOBS) COMMANDS.push([name, group, args, description, job(agent, brief)]);

const RULE = 'Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner\'s approval, spend inside the caps, platform and privacy rules).';

export function commandFile([name, , args, description, body]) {
  return `---\ndescription: ${JSON.stringify(description)}\n${args ? `argument-hint: ${JSON.stringify(args)}\n` : ''}---\n\n${body.join('\n\n')}\n\n${RULE}\n`;
}

export function commandsDoc() {
  const rows = GROUPS.map(([g, title]) => `## ${title}\n\n| Command | What it does |\n|---|---|\n${COMMANDS.filter((c) => c[1] === g).map(([n, , a, d]) => `| \`/${n}${a ? ` ${a}` : ''}\` | ${d} |`).join('\n')}\n`).join('\n');
  return `# Commands\n\n${COMMANDS.length} ready-made slash commands. In Claude Code type \`/\` and the name; as a plugin they are \`/whalyom:<name>\`. Generated by \`node tools/commands.mjs\`; edit the catalog there, not these files.\n\n${rows}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const dir = path.join(root, '.claude', 'commands');
  const want = new Map(COMMANDS.map((c) => [path.join(dir, `${c[0]}.md`), commandFile(c)]));
  want.set(path.join(root, 'docs', 'COMMANDS.md'), commandsDoc());
  const diff = [...want].filter(([f, s]) => !fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== s).map(([f]) => path.relative(root, f));
  if (check) { if (diff.length) { console.error(`out of date: ${diff.join(', ')}`); process.exit(1); } console.log(JSON.stringify({ commands: COMMANDS.length, ok: true })); }
  else {
    fs.mkdirSync(dir, { recursive: true });
    for (const [f, s] of want) fs.writeFileSync(f, s);
    console.log(JSON.stringify({ commands: COMMANDS.length, written: diff.length }));
  }
}
