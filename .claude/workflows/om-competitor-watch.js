export const meta = {
  name: 'om-competitor-watch',
  description: 'Weekly competitor watch: diff of competitor sites, pricing, ads and reviews against the last snapshot, battlecard updates checked for fairness and sources, counter-moves and comparison-page updates with adversarial review',
  whenToUse: 'Weekly, or when a competitor launches or changes price. args: {slug, now, max?: 5 competitors to act on}',
  phases: [
    { title: 'Context', detail: 'product.json, budget mode and caps' },
    { title: 'Diff', detail: 'sites, pricing, ads and reviews compared with the last snapshot' },
    { title: 'Battlecards', detail: 'per changed competitor: battlecard update, sourced and fair' },
    { title: 'Counter-moves', detail: 'positioning response, new tasks, comparison pages' },
    { title: 'Review', detail: 'editor, compliance and red team over public-facing drafts' },
    { title: 'Report', detail: 'apply results, merge review verdicts, report' },
  ],
}

const NAME = 'om-competitor-watch'
const slug = args?.slug
if (!slug) throw new Error(`${NAME} needs args.slug`)
const now = args?.now ?? 'unknown-time'
const day = String(now).slice(0, 10)
const ws = `products/${slug}/`
const PFX = `CW-${day}`
const MAX = Math.max(1, Math.min(Number(args?.max ?? 5), 10))

// ── shared helpers (same in every Whalyom workflow) ─────────────────────────
const CTX = {
  type: 'object',
  properties: {
    name: { type: 'string' }, domain: { type: 'string' }, stage: { type: 'string' },
    mode: { type: 'string', enum: ['free', 'paid', 'hybrid'] },
    monthly_cap: { type: 'number' }, daily_cap: { type: 'number' }, spent_this_month: { type: 'number' },
    currency: { type: 'string' }, autonomy: { type: 'string' }, has_brief: { type: 'boolean' },
    channels: { type: 'array', items: { type: 'string' } }, paid_channels: { type: 'array', items: { type: 'string' } },
  },
  required: ['name', 'domain', 'stage', 'mode', 'monthly_cap', 'daily_cap', 'spent_this_month', 'currency', 'autonomy', 'has_brief', 'channels', 'paid_channels'],
}
const RESULT = {
  type: 'object',
  properties: { status: { type: 'string', enum: ['done', 'blocked'] }, summary: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } },
  required: ['status', 'summary', 'files'],
}
const VERDICT = {
  type: 'object',
  properties: { verdict: { type: 'string', enum: ['pass', 'fix', 'block'] }, issues: { type: 'array', items: { type: 'string' } } },
  required: ['verdict', 'issues'],
}

const omAgent = async (agentType, prompt, opts) => {
  try {
    return await agent(prompt, { ...opts, agentType })
  } catch (e) {
    log(`${agentType} unavailable; using general-purpose with .claude/agents/${agentType}.md`)
    return agent(`Act as the agent defined in .claude/agents/${agentType}.md: read that file first and follow it exactly.\n\n${prompt}`,
      { ...opts, agentType: 'general-purpose', label: `${opts?.label ?? agentType}*` })
  }
}

phase('Context')
const ctx = await agent(`Read ${ws}product.json and report: name, domain ("" when none), stage, budget.mode, budget.monthly_cap, budget.daily_cap, budget.spent_this_month, budget.currency, autonomy.level, channels.enabled, channels.paid, and whether ${ws}brief.md exists. Do not change any file.`,
  { label: 'context', phase: 'Context', schema: CTX, effort: 'low', model: 'haiku' })
if (ctx.stage === 'paused') { log(`${slug} is paused; ${NAME} does nothing while a product is paused`); return { slug, workflow: NAME, skipped: 'paused' } }

const RULES = `Read product.json, profile.md, claims.md and LEARNINGS.md first. Use only claims listed in claims.md: no invented numbers, testimonials, reviews or customer names. Nothing goes out in this run: write drafts to outbox/ and list every publish, send, spend or price action under "approvals" in your run file (spend items carry "amount" in ${ctx.currency}). Never edit tasks.json, approvals.json or experiments.json. Budget mode ${ctx.mode}: monthly cap ${ctx.monthly_cap} ${ctx.currency}, daily cap ${ctx.daily_cap}, spent this month ${ctx.spent_this_month}.${ctx.mode === 'free' ? ' Free mode: propose no paid spend at all.' : ' Never propose spend above the caps.'} Follow each platform's rules: no fake accounts, vote or upvote requests, or bulk unsolicited messages.`

const task = (code, agentType, job, phaseName, extra) => {
  const id = `${PFX}-${code}`
  return omAgent(agentType, `Product workspace: ${ws} (slug "${slug}"). Task id: ${id}.\n${job}\n\nRules: ${RULES}\nWrite ${ws}runs/${id}.json (task_id "${id}", agent "${agentType}"); name the hypothesis and metric under "experiments" when the work can be measured. Current time: ${now}.`,
    { label: `${agentType} ${code}`, phase: phaseName, schema: RESULT, ...(extra ?? {}) })
}

const LENS = {
  'om-editor': 'Edit for clarity and voice and check every fact against claims.md and its sources; you may fix wording in the drafts in place.',
  'om-compliance-guard': 'Check claims against claims.md, platform rules, CAN-SPAM/GDPR for email and ad policy for ads. Report only; do not edit the drafts.',
  'om-red-team': 'Attack the work as a skeptical buyer and as the platform moderator: what fails, what evidence is missing, what gets it removed or ignored. Report only; do not edit the drafts.',
}
const review = async (code, files, focus, phaseName, who) => {
  // args.reviewers (set by the operating mode, tools/ai-modes.mjs): 1 = compliance only, 2 = + editor, 3 = + red team.
  const panel = who ?? ({ 1: ['om-compliance-guard'], 2: ['om-editor', 'om-compliance-guard'] }[Number(args?.reviewers)] ?? ['om-editor', 'om-compliance-guard', 'om-red-team'])
  const votes = (await parallel(panel.map((r) => () => omAgent(r,
    `Product workspace: ${ws}. Adversarial review ${PFX}-${code}: assume there are problems and look for them. Files: ${files}. Focus: ${focus}. ${LENS[r] ?? 'Report only; do not edit the drafts.'} Verdict "block" for any claim not in claims.md, any platform-rule or consent breach, or spend above the caps; "fix" when you corrected something or small changes are needed; otherwise "pass". Write ${ws}reports/review-${PFX}-${code}-${r}.md. Do not edit approvals.json.`,
    { label: `${r} ${code}`, phase: phaseName, schema: VERDICT })))).filter(Boolean)
  const verdict = votes.some((v) => v.verdict === 'block') ? 'block' : votes.some((v) => v.verdict === 'fix') ? 'fix' : 'pass'
  return { verdict, issues: votes.flatMap((v) => v.issues ?? []) }
}
const gated = async (code, producer, files, focus, phaseName) => {
  let rv = await review(code, files, focus, phaseName)
  if (rv.verdict === 'block') {
    log(`${code}: blocked in review; one repair round`)
    await task(`${code}-FIX`, producer, `Repair ${files} for these review findings: ${rv.issues.join(' | ').slice(0, 1500)}. Remove anything claims.md cannot prove.`, phaseName)
    rv = await review(`${code}-R2`, files, focus, phaseName, ['om-compliance-guard', 'om-red-team'])
    if (rv.verdict === 'block') log(`${code}: still blocked after repair; its approvals will be marked block`)
  }
  return { code, ...rv }
}

const finish = async (extra) => {
  phase('Report')
  const applied = await agent(`Run \`node tools/apply-results.mjs ${slug} --now ${now}\` from the project root and return its stdout.`, { label: 'apply results', phase: 'Report', effort: 'low', model: 'haiku' })
  // Compliance verdicts reach approvals.json only through apply-results.mjs, from a reviewer run file.
  await omAgent('om-compliance-guard', `In ${ws}: read every reports/review-${PFX}-*.md. For each approval in approvals.json whose task_id starts with "${PFX}" and whose status is "pending", decide "block" if a review of its files blocked, else "fix" if one fixed, else "pass". Write ${ws}runs/REVIEW-${PFX}.json as {"agent": "om-compliance-guard", "reviews": [{"approval_id": "<id>", "compliance": "pass|fix|block", "notes": "<why, citing the review files>"}]}. Do not edit approvals.json: apply-results sets "compliance" from this file. Return how many approvals you reviewed.`,
    { label: 'merge reviews', phase: 'Report', effort: 'low' })
  await agent(`Run \`node tools/apply-results.mjs ${slug} --now ${now}\` from the project root and return its stdout.`, { label: 'apply reviews', phase: 'Report', effort: 'low', model: 'haiku' })
  await agent('Run `node tools/build-state.mjs` from the project root and return its stdout.', { label: 'build state', phase: 'Report', effort: 'low', model: 'haiku' })
  const report = await omAgent('om-reporter', `Product workspace: ${ws}. Write ${ws}reports/${NAME}-${day}.md in at most 25 lines: what the ${NAME} workflow produced (task ids start with ${PFX}), review verdicts, what waits for the owner in approvals.json, spend proposed against the caps, and the next step. ${extra ?? ''} Return the report text.`,
    { label: 'reporter', phase: 'Report' })
  return { applied, report }
}
// ── end shared helpers ──────────────────────────────────────────────────────

const safe = (s) => String(s || 'competitor').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'competitor'

// ── Diff ────────────────────────────────────────────────────────────────────
phase('Diff')
const DIFF = {
  type: 'object',
  properties: { changes: { type: 'array', items: { type: 'object', properties: {
    competitor: { type: 'string' }, change: { type: 'string' }, severity: { type: 'string', enum: ['low', 'medium', 'high'] }, source: { type: 'string' },
  }, required: ['competitor', 'change', 'severity', 'source'] } } },
  required: ['changes'],
}
const [diff] = await parallel([
  () => task('D1', 'om-competitor-monitor', `Compare each competitor in research/competitors.md (site, pricing page, launches, changelog, positioning) with research/intel/competitor-snapshot.md, write the differences to research/intel/competitor-diff-${day}.md with a source URL per change, then refresh the snapshot. Return every change with a severity (high = pricing, new product or positioning shift aimed at our ICP).`, 'Diff', { schema: DIFF }),
  () => task('D2', 'om-pricing-intel', 'Update research/pricing-intel.md: competitor plans, prices, limits and discounts, marking what changed since the last version.', 'Diff', { effort: 'low' }),
  () => task('D3', 'om-ad-spy', `Write research/intel/ads-${day}.md: new competitor ads in public ad libraries, their angles and offers.`, 'Diff', { effort: 'low' }),
  () => task('D4', 'om-review-miner', `Write research/intel/reviews-${day}.md: new competitor reviews since the last run, loved features and pain points.`, 'Diff', { effort: 'low' }),
])
const changes = (diff?.changes ?? []).filter((c) => c.severity !== 'low')
const byComp = {}
for (const c of changes) (byComp[safe(c.competitor)] ??= { name: c.competitor, changes: [] }).changes.push(`${c.change} (${c.source})`)
const comps = Object.entries(byComp).map(([key, v]) => ({ key, ...v }))
if (comps.length > MAX) log(`${comps.length} competitors changed; acting on ${MAX}, the rest are in research/intel/competitor-diff-${day}.md`)
const act = comps.slice(0, MAX)
if (!act.length) {
  log('No medium or high changes this week')
  const out = await finish('No material competitor changes this week.')
  return { slug, workflow: NAME, changes: diff?.changes?.length ?? 0, acted: [], report: out.report }
}

// ── Battlecards ─────────────────────────────────────────────────────────────
phase('Battlecards')
const cards = await pipeline(
  act,
  (c, _c, i) => task(`BC${i + 1}`, 'om-battlecard', `Update sales/battlecards/${c.key}.md for ${c.name} after these changes: ${c.changes.join('; ').slice(0, 1200)}. Where we win, where we lose, landmines, proof from claims.md. Every statement about ${c.name} cites a public source.`, 'Battlecards'),
  (res, c, i) => review(`BC${i + 1}`, `sales/battlecards/${c.key}.md`, `statements about ${c.name} are sourced, current and fair (nothing defamatory or misleading), our claims are in claims.md`, 'Battlecards', ['om-compliance-guard', 'om-red-team'])
    .then((rv) => ({ competitor: c.name, key: c.key, verdict: rv.verdict })),
)

// ── Counter-moves ───────────────────────────────────────────────────────────
phase('Counter-moves')
const summary = act.map((c) => `${c.name}: ${c.changes.join('; ')}`).join('\n').slice(0, 2500)
await task('CM1', 'om-positioning-strategist', `Write research/intel/counter-moves-${day}.md: for each change below, whether to respond, ignore or exploit it, and the response in one line.\n${summary}`, 'Counter-moves')
await parallel([
  () => task('CM2', 'om-cmo', `Read research/intel/counter-moves-${day}.md and add 2-8 new_tasks (one roster agent each, brief, priority) for the responses worth doing now. Do not rewrite plan.md.`, 'Counter-moves', { effort: 'low' }),
  () => task('CM3', 'om-comparison-pages', `Update or draft the comparison pages for ${act.map((c) => c.name).join(', ')} in outbox/site/compare-<competitor>.md with the new facts (fair, specific, sourced). Add one "publish" approval per page.`, 'Counter-moves'),
])

// ── Review ──────────────────────────────────────────────────────────────────
phase('Review')
const rv = await gated('PUB', 'om-comparison-pages', 'outbox/site/compare-*.md', 'comparative advertising rules, sourced and dated competitor facts, no disparagement, our claims in claims.md', 'Review')

const done = cards.filter(Boolean)
const out = await finish(`Changed competitors: ${act.map((c) => c.name).join(', ')}. Comparison pages review: ${rv.verdict}.`)
return { slug, workflow: NAME, changes: diff?.changes?.length ?? 0, battlecards: done, comparisonReview: rv.verdict, report: out.report }
