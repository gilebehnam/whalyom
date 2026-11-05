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
  ['system', 'System'],
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
  ['mega-sweep', 'run', SLUG, 'All 22 department heads in parallel, then the revenue constraint and a red-team check',
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
    ['Read `state/live-roster.json` (rebuild it with `node tools/build-state.mjs` if it is missing) and show the departments with their head and agent count; with a department name, list its agents and what each does.']],
];

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
