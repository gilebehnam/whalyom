export const meta = {
  name: 'om-aeo',
  description: 'AI-answer visibility (AEO/GEO): baseline of how AI assistants answer buyer questions, citable passages, llms.txt and JSON-LD, entity work, adversarial review, and a re-check protocol against the baseline',
  whenToUse: 'Make the product citable by ChatGPT, Perplexity, Gemini and AI Overviews. args: {slug, now, questions?: 20, recheck?: true to compare against the last baseline}',
  phases: [
    { title: 'Context', detail: 'product.json, budget mode and caps' },
    { title: 'Audit', detail: 'buyer questions asked of AI assistants, share of voice, AI crawler access' },
    { title: 'Passages', detail: 'citable answer passages and snippet rewrites' },
    { title: 'Files', detail: 'llms.txt and JSON-LD for the site' },
    { title: 'Entity', detail: 'entity profiles, sameAs, lists and review sites AI answers cite' },
    { title: 'Review', detail: 'editor, compliance and red team over every AEO draft' },
    { title: 'Re-check', detail: 'same question set, compared to the baseline, as an experiment' },
    { title: 'Report', detail: 'apply results, merge review verdicts, report' },
  ],
}

const NAME = 'om-aeo'
const slug = args?.slug
if (!slug) throw new Error(`${NAME} needs args.slug`)
const now = args?.now ?? 'unknown-time'
const day = String(now).slice(0, 10)
const ws = `products/${slug}/`
const PFX = `AEO-${day}`
const Q = Math.max(5, Math.min(Number(args?.questions ?? 20), 50))

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

const AUDIT = {
  type: 'object',
  properties: {
    asked: { type: 'number' }, mentioned: { type: 'number' }, cited: { type: 'number' },
    competitors_cited: { type: 'array', items: { type: 'string' } }, gaps: { type: 'array', items: { type: 'string' } },
    baseline_file: { type: 'string' },
  },
  required: ['asked', 'mentioned', 'cited', 'competitors_cited', 'gaps', 'baseline_file'],
}

// ── Audit ───────────────────────────────────────────────────────────────────
phase('Audit')
const [baseline] = await parallel([
  () => task('A1', 'om-ai-answer-monitor', `Build the question set research/aeo/questions.md (${Q} real buyer questions from research/voc.md, research/keywords.md and research/icp.md; reuse the existing file when there is one so results stay comparable). Ask each question of the AI answer engines you can reach (web search answers, assistants with browsing) and record in research/aeo/baseline-${day}.md, per question: whether the product is mentioned, whether a product URL is cited, which competitors are named and which sources are cited. Return the counts, the competitors cited, the biggest gaps and the baseline file path.`, 'Audit', { schema: AUDIT }),
  () => task('A2', 'om-share-of-voice', 'Write research/aeo/share-of-voice.md: the brand against its competitors in AI answers, search and social for the same question set.', 'Audit'),
  ctx.domain ? () => task('A3', 'om-tech-seo', `Check ${ctx.domain} for AI crawler access (robots.txt rules for GPTBot, ClaudeBot, PerplexityBot, Google-Extended), server-side rendering of key content, and existing llms.txt and JSON-LD. Write research/aeo/technical.md with fixes as concrete changes.`, 'Audit') : null,
].filter(Boolean))
const base = baseline ?? { asked: 0, mentioned: 0, cited: 0, competitors_cited: [], gaps: [], baseline_file: '' }
log(`Baseline: mentioned in ${base.mentioned}/${base.asked} answers, cited in ${base.cited}`)

// ── Passages ────────────────────────────────────────────────────────────────
phase('Passages')
await parallel([
  () => task('P1', 'om-geo-optimizer', `For the gaps in ${base.baseline_file || 'research/aeo/'} (${base.gaps.slice(0, 8).join('; ')}), write outbox/aeo/passages.md: one citable passage per question (40-80 words, answer first, the product named, every number from claims.md with its source) and the page each passage belongs on. Add one "publish" approval for the page edits.`, 'Passages'),
  () => task('P2', 'om-snippet-hunter', 'Write outbox/aeo/snippets.md: rewrites of existing passages in content/ that can win featured snippets and People Also Ask boxes for the same question set.', 'Passages'),
])

// ── Files ───────────────────────────────────────────────────────────────────
phase('Files')
await parallel([
  () => task('F1', 'om-geo-optimizer', 'Write outbox/site/llms.txt (and llms-full.txt when the docs are large): what the product is, who it is for, key pages with one-line descriptions, pricing page, and only facts from claims.md. Add one "publish" approval.', 'Files'),
  () => task('F2', 'om-schema-engineer', 'Write outbox/site/schema/: Organization (with sameAs to real profiles only), Product or SoftwareApplication, and FAQPage JSON-LD for the pages that answer the question set. Add one "publish" approval.', 'Files'),
])

// ── Entity ──────────────────────────────────────────────────────────────────
phase('Entity')
await parallel([
  () => task('E1', 'om-entity-builder', 'Write outbox/aeo/entity.md: entity profiles to create or fix (Wikidata only when the notability rules are met, Crunchbase, LinkedIn, GitHub, directories) with consistent name, description and sameAs links. Each profile edit is an approval of type "publish". Never create a Wikipedia article about the product.', 'Entity'),
  () => task('E2', 'om-award-hunter', `Write outbox/aeo/lists.md: "best tools" lists, roundups and awards that AI answers cite for these questions (competitors cited: ${base.competitors_cited.slice(0, 8).join(', ') || 'see the baseline'}), with how to get included honestly.`, 'Entity'),
  () => task('E3', 'om-review-sites', 'Write outbox/aeo/review-sites.md: review-site profiles AI answers cite (G2, Capterra, Trustpilot or the category equivalent) and a consent-based plan for asking real customers for reviews. No incentivized or fake reviews.', 'Entity'),
])

// ── Review ──────────────────────────────────────────────────────────────────
phase('Review')
const reviews = await pipeline(
  [
    { code: 'RV1', producer: 'om-geo-optimizer', files: 'outbox/aeo/passages.md, outbox/aeo/snippets.md, outbox/site/llms.txt', focus: 'every fact traceable to claims.md, passages that a model would quote verbatim, no keyword stuffing' },
    { code: 'RV2', producer: 'om-schema-engineer', files: 'outbox/site/schema/', focus: 'valid JSON-LD, sameAs only to profiles that exist, no markup for content that is not on the page' },
    { code: 'RV3', producer: 'om-entity-builder', files: 'outbox/aeo/entity.md, outbox/aeo/lists.md, outbox/aeo/review-sites.md', focus: 'each site rules (notability, self-promotion, review policies), consent for review asks' },
  ],
  (r) => gated(r.code, r.producer, r.files, r.focus, 'Review'),
)

// ── Re-check ────────────────────────────────────────────────────────────────
phase('Re-check')
const DELTA = { type: 'object', properties: { previous: { type: 'string' }, mentioned_before: { type: 'number' }, mentioned_now: { type: 'number' }, summary: { type: 'string' } }, required: ['previous', 'mentioned_before', 'mentioned_now', 'summary'] }
let delta = null
if (args?.recheck) {
  delta = await omAgent('om-ai-answer-monitor', `Product workspace: ${ws}. Compare research/aeo/baseline-${day}.md with the most recent earlier research/aeo/baseline-*.md (same question set). Write research/aeo/delta-${day}.md: per question what changed, and which published changes plausibly caused it. Return the previous file, mentions before and now, and a one-line summary.`,
    { label: 'recheck delta', phase: 'Re-check', schema: DELTA })
  log(`Re-check: ${delta.mentioned_before} → ${delta.mentioned_now} mentions`)
}
await task('X1', 'om-experiment-manager', `Name the AEO experiment in your run file: hypothesis "publishing the approved passages, llms.txt, schema and entity fixes raises the AI mention rate from ${base.mentioned}/${base.asked}", metric = mentions out of ${base.asked} on research/aeo/questions.md, stop date 21 days after publishing. Write research/aeo/recheck-protocol.md: same questions, same engines, run again with this workflow and recheck: true.`, 'Re-check', { effort: 'low' })

const out = await finish(`AI mention baseline ${base.mentioned}/${base.asked}.${delta ? ` Re-check: ${delta.summary}` : ''}`)
return { slug, workflow: NAME, baseline: base, delta, reviews: reviews.filter(Boolean).map((r) => ({ code: r.code, verdict: r.verdict })), report: out.report }
