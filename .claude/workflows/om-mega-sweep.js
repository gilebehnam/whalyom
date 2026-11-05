export const meta = {
  name: 'om-mega-sweep',
  description: 'Mega sweep: the department-head mega agents each run their whole department for one product in parallel (scorecard, top three items done, the rest delegated), the revenue mega agent names the one constraint across them, the red team attacks the combined plan and the compliance guard checks every outbox draft, then results merge',
  whenToUse: 'Monthly per active product, after onboarding, or when the owner asks for a full department review. args: {slug, now, depts?: ["seo","paid",...,"commerce","growth-free"] (default all 22 department heads)}',
  phases: [
    { title: 'Context', detail: 'product state and the knowledge briefs' },
    { title: 'Heads', detail: 'one mega agent per department, in parallel' },
    { title: 'Constraint', detail: 'revenue mega agent picks the one constraint' },
    { title: 'Review', detail: 'red team on the plan, compliance guard on drafts' },
    { title: 'Report', detail: 'apply results, sweep report' },
  ],
}

const NAME = 'om-mega-sweep'
const slug = args?.slug
if (!slug) throw new Error(`${NAME} needs args.slug`)
const now = args?.now ?? 'unknown-time'
const day = String(now).slice(0, 10)
const ws = `products/${slug}/`
const PFX = `MEGA-${day}`
// The 22 department heads: the original thirteen, the nine wave-9 departments (roster-wave9.mjs), including om-mega-commerce (wave 7), which spans paid, funnel, social, SEO and finance,
// and om-mega-growth-free (wave 8), which runs zero-budget growth across lead gen, social, SEO, funnel and lifecycle.
const ALL = ['sovereign', 'intel', 'strategy', 'funnel', 'creative', 'seo', 'social', 'paid', 'leadgen', 'closer', 'lifecycle', 'finops', 'evolve', 'trust', 'consulting', 'data', 'pr', 'partners', 'global', 'commerce', 'growth-free', 'ailab']
const depts = (Array.isArray(args?.depts) && args.depts.length ? args.depts : ALL).filter((d) => ALL.includes(d))

const omAgent = async (agentType, prompt, opts) => {
  try {
    return await agent(prompt, { ...opts, agentType })
  } catch (e) {
    log(`${agentType} unavailable; using general-purpose with .claude/agents/${agentType}.md`)
    return agent(`Act as the agent defined in .claude/agents/${agentType}.md: read that file first and follow it exactly.\n\n${prompt}`,
      { ...opts, agentType: 'general-purpose', label: `${opts?.label ?? agentType}*` })
  }
}

// ── Context ─────────────────────────────────────────────────────────────────
phase('Context')
const CTX = { type: 'object', properties: { stage: { type: 'string' }, paused: { type: 'boolean' }, mode: { type: 'string', enum: ['free', 'paid', 'hybrid'] }, briefs_ok: { type: 'boolean' } }, required: ['stage', 'paused', 'mode', 'briefs_ok'] }
const ctx = await agent(`Read ${ws}product.json: return stage, paused (true when stage is "paused" or autonomy is paused) and budget.mode. Then run \`node tools/knowledge.mjs check --now ${now}\` and return briefs_ok = (briefs_outdated is false). Do not change any file.`,
  { label: 'context', phase: 'Context', schema: CTX, effort: 'low', model: 'haiku' })
if (ctx.paused) return { workflow: NAME, slug, stopped: 'product is paused' }
if (!ctx.briefs_ok) await agent(`Run \`node tools/knowledge.mjs brief --now ${now}\` from the project root and return its output.`, { label: 'rebuild briefs', phase: 'Context', effort: 'low', model: 'haiku' })

// ── Heads ───────────────────────────────────────────────────────────────────
phase('Heads')
const HEAD = { type: 'object', properties: { score: { type: 'number' }, done: { type: 'array', items: { type: 'string' } }, delegated: { type: 'number' }, decision: { type: 'string' } }, required: ['score', 'done', 'delegated', 'decision'] }
const heads = await parallel(depts.map((d) => () => omAgent(`om-mega-${d}`, `Product workspace: ${ws} (budget mode ${ctx.mode}). Task id: ${PFX}-${d}. Run your department for this product as described in your instructions: scorecard, the three highest-leverage items done yourself, everything else as new_tasks for your department, reports/mega/${d}.md, and your result file runs/${PFX}-${d}.json. Return the overall department score (0–5 average), the items you did, the number of tasks you delegated and the one owner decision.`,
  { label: `mega ${d}`, phase: 'Heads', schema: HEAD }).then((r) => ({ dept: d, ...(r ?? { score: 0, done: [], delegated: 0, decision: 'no result' }) }))))

// ── Constraint ──────────────────────────────────────────────────────────────
phase('Constraint')
const CON = { type: 'object', properties: { constraint: { type: 'string', enum: ['traffic', 'conversion', 'close-rate', 'retention', 'price', 'other'] }, why: { type: 'string' } }, required: ['constraint', 'why'] }
const constraint = await omAgent('om-mega-revenue', `Product workspace: ${ws}. Task id: ${PFX}-revenue. Read every reports/mega/*.md written today and the metrics. Name the ONE constraint that limits revenue this month and re-prioritize the delegated tasks in your result file runs/${PFX}-revenue.json (new_tasks with priority 1 for the constraint, and alerts for the owner). Write reports/mega/revenue.md. Department scores: ${JSON.stringify(heads.filter(Boolean).map((h) => ({ d: h.dept, s: h.score })))}.`,
  { label: 'mega revenue', phase: 'Constraint', schema: CON })

// ── Review ──────────────────────────────────────────────────────────────────
phase('Review')
const VERDICT = { type: 'object', properties: { verdict: { type: 'string', enum: ['pass', 'fix', 'block'] }, issues: { type: 'array', items: { type: 'string' } } }, required: ['verdict', 'issues'] }
const reviews = await parallel([
  () => omAgent('om-red-team', `Attack the mega sweep for ${ws}: reports/mega/*.md and the new_tasks in runs/${PFX}-*.json. What would make the plan fail, which delegated tasks duplicate open tasks in tasks.json, which department claims evidence it does not show, and does the constraint (${constraint?.constraint}: ${constraint?.why}) follow from the numbers? Write reports/mega/red-team.md. Do not edit the run files.`, { label: 'red team', phase: 'Review', schema: VERDICT }),
  () => omAgent('om-compliance-guard', `Review every draft the mega agents put in ${ws}outbox/ today and the approvals listed in runs/${PFX}-*.json: claims against claims.md, platform rules, CAN-SPAM/GDPR for email, ad policy for ads. Write runs/${PFX}-compliance.json with your verdict per draft (alerts for anything blocked). Do not set any approval to approved.`, { label: 'compliance', phase: 'Review', schema: VERDICT }),
])

// ── Report ──────────────────────────────────────────────────────────────────
phase('Report')
await agent(`Run \`node tools/apply-results.mjs ${slug} --now ${now}\` from the project root and return its stdout.`, { label: 'apply results', phase: 'Report', effort: 'low', model: 'haiku' })
// Compliance verdicts reach approvals.json only through apply-results.mjs, from a reviewer run file.
await omAgent('om-compliance-guard', `In ${ws}: for each approval in approvals.json whose task_id starts with "${PFX}" and whose status is "pending", review its draft (claims against claims.md, platform rules, CAN-SPAM/GDPR for email, ad policy for ads; your earlier verdicts are in runs/applied/*${PFX}-compliance.json). Write ${ws}runs/REVIEW-${PFX}.json as {"agent": "om-compliance-guard", "reviews": [{"approval_id": "<id>", "compliance": "pass|fix|block", "notes": "<why>"}]}. Do not edit approvals.json and do not set any approval to approved. Return how many approvals you reviewed.`,
  { label: 'compliance verdicts', phase: 'Report', effort: 'low' })
await agent(`Run \`node tools/apply-results.mjs ${slug} --now ${now}\` from the project root and return its stdout.`, { label: 'apply reviews', phase: 'Report', effort: 'low', model: 'haiku' })
const report = await omAgent('om-reporter', `Write ${ws}reports/${NAME}-${day}.md in at most 25 lines: one line per department (score, what was done, tasks delegated, the owner decision) from ${JSON.stringify(heads.filter(Boolean).map((h) => ({ d: h.dept, s: h.score, done: h.done.length, del: h.delegated, decision: h.decision })))}, the revenue constraint (${constraint?.constraint}), the red-team and compliance verdicts (${JSON.stringify(reviews.filter(Boolean).map((r) => r.verdict))}) and what waits in approvals.json. Then run \`node tools/build-state.mjs\`. Return the report text.`,
  { label: 'reporter', phase: 'Report' })

return { workflow: NAME, slug, heads: heads.filter(Boolean), constraint, reviews: reviews.filter(Boolean), report }
