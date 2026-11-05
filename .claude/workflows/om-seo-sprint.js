export const meta = {
  name: 'om-seo-sprint',
  description: 'SEO sprint for one topic cluster: keywords, SERPs and cannibalization check, cluster and briefs, articles with editor/compliance/red-team review and JSON-LD, internal links, indexing and rank tracking. Publishing stays an approval',
  whenToUse: 'Grow organic search with a batch of articles. args: {slug, now, articles?: 4 (max 10), cluster?: "topic to focus on"}',
  phases: [
    { title: 'Context', detail: 'product.json, budget mode and caps' },
    { title: 'Research', detail: 'keywords, live SERPs, existing pages that already target the queries' },
    { title: 'Cluster', detail: 'one cluster, up to N article briefs' },
    { title: 'Write', detail: 'per brief: writer, adversarial review with one repair round, JSON-LD' },
    { title: 'Links', detail: 'internal links across the new and existing pages, sitemap and IndexNow plan, rank tracking' },
    { title: 'Report', detail: 'apply results, merge review verdicts, report' },
  ],
}

const NAME = 'om-seo-sprint'
const slug = args?.slug
if (!slug) throw new Error(`${NAME} needs args.slug`)
const now = args?.now ?? 'unknown-time'
const day = String(now).slice(0, 10)
const ws = `products/${slug}/`
const PFX = `SEO-${day}`
const MAX = Math.max(1, Math.min(Number(args?.articles ?? 4), 10))
const focus = args?.cluster ? `Focus on the cluster "${args.cluster}".` : 'Pick the cluster with the best quick-win potential for this site.'

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

const safe = (s, i) => String(s || `article-${i + 1}`).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || `article-${i + 1}`

// ── Research ────────────────────────────────────────────────────────────────
phase('Research')
await parallel([
  () => task('K1', 'om-keyword-researcher', `Update research/keywords.md: clusters by intent and difficulty, with the quick wins this site can rank for marked. ${focus}`, 'Research'),
  () => task('K2', 'om-serp-analyst', 'Update research/serp.md for the 20 best quick-win queries: page types, intent, SERP features, and what it takes to outrank the top three.', 'Research'),
  () => task('K3', 'om-cannibalization-fixer', `List the pages in content/ ${ctx.domain ? `and on ${ctx.domain} ` : ''}that already target the candidate queries in research/seo/cannibalization.md, so the sprint does not create competing pages.`, 'Research'),
])

// ── Cluster ─────────────────────────────────────────────────────────────────
phase('Cluster')
const BRIEFS = {
  type: 'object',
  properties: {
    cluster: { type: 'string' },
    briefs: { type: 'array', items: { type: 'object', properties: {
      slug: { type: 'string' }, title: { type: 'string' }, keyword: { type: 'string' }, intent: { type: 'string' }, money_page: { type: 'string' },
    }, required: ['slug', 'title', 'keyword'] } },
  },
  required: ['cluster', 'briefs'],
}
const plan = await task('C1', 'om-content-strategist', `${focus} Write up to ${MAX} article briefs, one per file content/briefs/<slug>.md (target keyword, intent, outline, questions to answer, sources to cite, internal link targets, CTA to the money page). Skip queries that research/seo/cannibalization.md shows are already covered. Return the cluster and the briefs (slug = the file name without .md).`,
  'Cluster', { schema: BRIEFS })
const all = plan?.briefs ?? []
if (all.length > MAX) log(`Strategist proposed ${all.length} briefs; writing the first ${MAX}, the rest stay in content/briefs/ for the next sprint`)
const briefs = all.slice(0, MAX).map((b, i) => ({ ...b, slug: safe(b.slug, i), code: `W${i + 1}` }))
log(`Cluster "${plan?.cluster ?? '?'}": ${briefs.map((b) => b.slug).join(', ') || 'no briefs'}`)

// ── Write ───────────────────────────────────────────────────────────────────
phase('Write')
const articles = await pipeline(
  briefs,
  (b) => task(b.code, 'om-writer', `Write content/${b.slug}.md from content/briefs/${b.slug}.md: answer-first, every fact sourced, target keyword "${b.keyword}", and a CTA to ${b.money_page || 'the main money page'}. Do not add a publish approval yet; the Links step does that.`, 'Write'),
  (res, b) => gated(b.code, 'om-writer', `content/${b.slug}.md`, `facts and sources, search intent of "${b.keyword}", answer-first structure, thin or generic sections`, 'Write'),
  async (rv, b) => {
    if (rv.verdict !== 'block') await task(`${b.code}-LD`, 'om-schema-engineer', `Write content/${b.slug}.schema.json: Article JSON-LD, plus FAQPage only for questions the article really answers.`, 'Write', { effort: 'low' })
    return { slug: b.slug, keyword: b.keyword, verdict: rv.verdict }
  },
)
const written = articles.filter(Boolean)
const publishable = written.filter((a) => a.verdict !== 'block')

// ── Links ───────────────────────────────────────────────────────────────────
phase('Links')
// Barrier: internal links need the whole set of new articles at once.
if (publishable.length) {
  await task('L1', 'om-internal-linker', `Plan and add internal links between the new articles (${publishable.map((a) => `content/${a.slug}.md`).join(', ')}) and existing pages so authority flows to the money pages. Edit the new drafts in place; list links to add on existing live pages in research/seo/internal-links-${day}.md.`, 'Links')
  await parallel([
    () => task('L2', 'om-indexing-agent', `For each new article (${publishable.map((a) => a.slug).join(', ')}), add one approval of type "publish" with its file in content/, and write research/seo/indexing-${day}.md: sitemap entries and the IndexNow pings to send after the owner publishes.`, 'Links'),
    () => task('L3', 'om-rank-tracker', `Add the target keywords (${publishable.map((a) => a.keyword).join(', ')}) to the rank tracking list and name an experiment per article: hypothesis "reaches the top 20 within 30 days of publishing", metric = position.`, 'Links', { effort: 'low' }),
  ])
} else log('Every article was blocked in review; nothing to link or index')

const out = await finish(written.length - publishable.length ? `Blocked articles (not queued for publishing): ${written.filter((a) => a.verdict === 'block').map((a) => a.slug).join(', ')}.` : '')
return { slug, workflow: NAME, cluster: plan?.cluster ?? null, articles: written, report: out.report }
