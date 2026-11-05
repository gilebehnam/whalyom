export const meta = {
  name: 'om-landing',
  description: 'Landing page: message and offer brief, headline lab and copy, build with tools/landing-builder.mjs when present (otherwise hand-written HTML), QA for links, speed, schema and trust, editor/compliance/red-team review, then per-source variants and a bandit test. Publishing stays an approval',
  whenToUse: 'A campaign, segment or comparison needs its own page. args: {slug, now, page?: "home" or a short page name, goal?: "signup|demo|purchase", audience?, variants?: 2 (max 4)}',
  phases: [
    { title: 'Context', detail: 'product.json, budget mode and caps' },
    { title: 'Brief', detail: 'message house, offer stack, conversion brief' },
    { title: 'Copy', detail: 'headline variants and section copy' },
    { title: 'Build', detail: 'landing builder tool or plain HTML' },
    { title: 'QA', detail: 'links, forms, UTMs, page weight, JSON-LD, trust signals; fixes applied' },
    { title: 'Review', detail: 'editor, compliance and red team, one repair round' },
    { title: 'Variants', detail: 'per-traffic-source variants and the bandit test' },
    { title: 'Report', detail: 'apply results, merge review verdicts, report' },
  ],
}

const NAME = 'om-landing'
const slug = args?.slug
if (!slug) throw new Error(`${NAME} needs args.slug`)
const now = args?.now ?? 'unknown-time'
const day = String(now).slice(0, 10)
const ws = `products/${slug}/`
const PFX = `LND-${day}`
const page = String(args?.page ?? 'home').toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40) || 'home'
const goal = args?.goal ?? 'the primary conversion in product.json goals'
const audience = args?.audience ?? 'the primary ICP in research/icp.md'
const V = Math.max(0, Math.min(Number(args?.variants ?? 2), 4))
const dir = `outbox/landing/${page}`

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

// ── Brief ───────────────────────────────────────────────────────────────────
phase('Brief')
await parallel([
  () => task('B1', 'om-message-architect', `Write ${dir}/message.md: the promise, three pillars with proof from claims.md, and the lines this page uses for ${audience}.`, 'Brief', { effort: 'low' }),
  () => task('B2', 'om-offer-engineer', `Write ${dir}/offer.md: the offer for this page (core offer, guarantee, real urgency only, bonuses) within claims.md and sales/deal-desk.md.`, 'Brief', { effort: 'low' }),
])
await task('B3', 'om-cro', `Write ${dir}/brief.md from ${dir}/message.md and ${dir}/offer.md: page goal (${goal}), audience (${audience}), section order, objections to answer (research/voc.md), proof to show, one CTA, and the tracking events from research/tracking.md.`, 'Brief')

// ── Copy ────────────────────────────────────────────────────────────────────
phase('Copy')
await task('C1', 'om-headline-lab', `Write ${dir}/headlines.md: 10 headline and subhead pairs for ${dir}/brief.md, scored, top 3 marked.`, 'Copy', { effort: 'low' })
await task('C2', 'om-landing-builder', `Write ${dir}/copy.md: section-by-section copy for ${dir}/brief.md using the top headline from ${dir}/headlines.md, answer-first, every claim from claims.md.`, 'Copy')
const copyReview = await review('COPY', `${dir}/copy.md`, 'claims, clarity, objections answered, one CTA', 'Copy', ['om-editor'])

// ── Build ───────────────────────────────────────────────────────────────────
phase('Build')
const TOOL = { type: 'object', properties: { exists: { type: 'boolean' }, usage: { type: 'string' } }, required: ['exists', 'usage'] }
const tool = await agent('Check whether tools/landing-builder.mjs exists in the project root. If it does, run `node tools/landing-builder.mjs --help` and return its usage text; do not build anything. If it does not exist, return exists false and an empty usage.',
  { label: 'landing builder?', phase: 'Build', schema: TOOL, effort: 'low', model: 'haiku' })
const how = tool.exists
  ? `Build it with the landing builder: \`node tools/landing-builder.mjs\` (usage below), writing the output to ${dir}/index.html.\n${tool.usage.slice(0, 1500)}`
  : `There is no landing builder tool: write ${dir}/index.html by hand as one self-contained, semantic, accessible, mobile-first HTML file with inline CSS, no external trackers beyond research/tracking.md, and real form actions left as clearly marked placeholders.`
log(tool.exists ? 'Using tools/landing-builder.mjs' : 'No landing builder tool; writing HTML directly')
await task('BL', 'om-landing-builder', `Build the ${page} page from ${dir}/copy.md and ${dir}/brief.md. ${how} Add one approval of type "publish" with ${dir}/index.html.`, 'Build')

// ── QA ──────────────────────────────────────────────────────────────────────
phase('QA')
const qa = (await parallel([
  ['om-qa-tester', 'broken links, form fields and labels, missing UTMs on outbound links, tracking events from the brief'],
  ['om-page-speed', 'page weight, render-blocking resources, image sizes, Core Web Vitals risks'],
  ['om-schema-engineer', 'JSON-LD for the page type, valid and matching visible content'],
  ['om-trust-builder', 'trust signals present and real (security, privacy, refund, about); flag any that are invented'],
].map(([a, focus]) => () => omAgent(a, `Product workspace: ${ws}. QA ${dir}/index.html for: ${focus}. Do not edit the page; write ${ws}reports/review-${PFX}-QA-${a}.md with each issue and the exact fix.`,
  { label: `${a} QA`, phase: 'QA', schema: VERDICT, effort: 'low' })))).filter(Boolean)
const qaIssues = qa.flatMap((v) => v.issues ?? [])
if (qa.some((v) => v.verdict !== 'pass')) {
  await task('QF', 'om-landing-builder', `Apply these QA fixes to ${dir}/index.html (reports/review-${PFX}-QA-*.md): ${qaIssues.join(' | ').slice(0, 1800)}`, 'QA')
}

// ── Review ──────────────────────────────────────────────────────────────────
phase('Review')
const rv = await gated('PAGE', 'om-landing-builder', `${dir}/index.html, ${dir}/copy.md`, `claims, offer honesty, consent on forms, ${goal} as the single CTA, brand voice`, 'Review')

// ── Variants ────────────────────────────────────────────────────────────────
phase('Variants')
let variantReview = null
if (V > 0 && rv.verdict !== 'block') {
  await task('V1', 'om-personalizer', `Write ${V} variants of ${dir}/index.html as ${dir}/variant-<source>.html for the traffic sources that matter most (research/tracking.md, paid channels ${ctx.paid_channels.join(', ') || 'none'}, top keywords): headline, proof and CTA matched to the source; everything else identical. Write ${dir}/variants.md with the rule for which visitor sees which. Add one "publish" approval.`, 'Variants')
  await task('V2', 'om-bandit-cro', `Define the bandit test over ${dir}/index.html and its variants: arms, primary metric (${goal}), minimum traffic per arm, stop rule. Put it under "experiments" in your run file.`, 'Variants', { effort: 'low' })
  variantReview = await review('VAR', `${dir}/variant-*.html`, 'variants make only claims in claims.md and match their traffic source', 'Variants', ['om-compliance-guard'])
} else if (rv.verdict === 'block') log('Page blocked in review; no variants built')

const out = await finish(`Page ${dir}/index.html (${tool.exists ? 'landing builder' : 'hand-written HTML'}): copy ${copyReview.verdict}, QA ${qa.map((v) => v.verdict).join('/')}, review ${rv.verdict}${variantReview ? `, variants ${variantReview.verdict}` : ''}.`)
return { slug, workflow: NAME, page, file: `${dir}/index.html`, builder: tool.exists ? 'tools/landing-builder.mjs' : 'html', review: rv.verdict, variants: variantReview?.verdict ?? null, report: out.report }
