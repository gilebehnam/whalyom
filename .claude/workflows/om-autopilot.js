export const meta = {
  name: 'om-autopilot',
  description: 'OM mega-agent: health check, plan, parallel agent waves with per-task review, compliance, learning and report for one product',
  whenToUse: 'Run the full OM marketing cycle for one product workspace. args: {slug, now, maxWaves?, perWave?}',
  phases: [
    { title: 'Health', detail: 'validate the workspace and repair it' },
    { title: 'Plan', detail: 'om-cmo writes the next tasks when the queue is empty' },
    { title: 'Waves', detail: 'ready tasks run in parallel, each reviewed by om-evaluator as it finishes' },
    { title: 'Review', detail: 'compliance, QA and brand checks on new approvals' },
    { title: 'Learn', detail: 'experiments, learnings, cost' },
    { title: 'Report', detail: 'daily report and dashboard data' },
  ],
}

const slug = args?.slug
if (!slug) throw new Error('om-autopilot needs args.slug')
const now = args?.now ?? 'unknown-time'
const MAX_WAVES = args?.maxWaves ?? 5
const PER_WAVE = args?.perWave ?? 10

const READY = {
  type: 'object',
  properties: {
    ready: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, title: { type: 'string' }, agent: { type: 'string' }, brief: { type: 'string' },
    }, required: ['id', 'agent'] } },
    open: { type: 'number' }, done: { type: 'number' }, blocked: { type: 'number' }, total: { type: 'number' },
  },
  required: ['ready', 'open', 'done', 'blocked', 'total'],
}
const RESULT = {
  type: 'object',
  properties: { status: { type: 'string', enum: ['done', 'blocked'] }, summary: { type: 'string' } },
  required: ['status', 'summary'],
}

// Small mechanical steps run through scripts so only one writer touches the ledgers.
const readyTasks = (label) => agent(
  `Run \`node tools/ready.mjs ${slug} ${PER_WAVE}\` from the project root and return its JSON output exactly as printed.`,
  { label, phase: 'Waves', schema: READY, effort: 'low', model: 'haiku' })
const applyResults = (label) => agent(
  `Run \`node tools/apply-results.mjs ${slug} --now ${now}\` from the project root and return its stdout.`,
  { label, phase: 'Waves', effort: 'low', model: 'haiku' })

// Runs a roster agent; falls back to general-purpose + the agent's definition file
// when the type isn't registered in this session.
const omAgent = async (agentType, prompt, opts) => {
  try {
    return await agent(prompt, { ...opts, agentType })
  } catch (e) {
    log(`${agentType} unavailable; using general-purpose with .claude/agents/${agentType}.md`)
    return agent(`Act as the agent defined in .claude/agents/${agentType}.md: read that file first and follow it exactly.\n\n${prompt}`,
      { ...opts, agentType: 'general-purpose', label: `${opts?.label ?? agentType}*` })
  }
}

const taskPrompt = (t) => `Product workspace: products/${slug}/ (slug "${slug}"). Your task id: ${t.id}.
Task: ${t.title ?? ''}
Brief: ${t.brief ?? t.title ?? ''}
Do the task as your agent definition describes, then write products/${slug}/runs/${t.id}.json. Current time: ${now}.`

// ── Health ──────────────────────────────────────────────
phase('Health')
// Kill switch first: a paused or killed product spends nothing, writes no drafts and leaves tasks.json alone.
const HALT = {
  type: 'object',
  properties: { stage: { type: 'string' }, kill: { type: 'boolean' } },
  required: ['stage', 'kill'],
}
const halt = await agent(`Read products/${slug}/product.json and run \`node --input-type=module -e "const {loadEnv}=await import('./tools/lib/env.mjs'); loadEnv(); console.log(process.env.OM_KILL ?? '')"\` from the project root (it reads OM_KILL from the environment or .env the way the tools do, and prints only that value). Return stage (product.json "stage", "" when missing) and kill = true when product.json autonomy.kill is true or that command printed 1, else false. Do not change any file.`,
  { label: 'kill switch', phase: 'Health', schema: HALT, effort: 'low', model: 'haiku' })
if (halt?.stage === 'paused' || halt?.kill === true) {
  log(`${slug} is ${halt?.stage === 'paused' ? 'paused' : 'kill-switched (autonomy.kill or OM_KILL)'}; om-autopilot does nothing`)
  return { slug, skipped: 'paused' }
}
await agent(`Run \`node tools/validate.mjs ${slug}\`. If it reports problems, repair what you safely can in products/${slug}/ (invalid JSON, broken depends_on, tasks stuck in "running" → back to "todo"), run it again, and write products/${slug}/reports/ops.md. Return the final validate output.`,
  { agentType: 'om-ops-doctor', label: 'ops-doctor', phase: 'Health' })
await applyResults('apply leftovers')

// ── Plan ────────────────────────────────────────────────
phase('Plan')
let state = await readyTasks('queue')
if (state.open === 0) {
  log('Queue empty: om-cmo is planning the next cycle')
  await agent(`Product workspace: products/${slug}/. Task id: PLAN-${now.slice(0, 10)}. Write or update plan.md for the next 30 days and put 10–30 new tasks in new_tasks of your result file products/${slug}/runs/PLAN-${now.slice(0, 10)}.json, each naming one roster agent, a brief, depends_on and priority (1 high – 9 low). Current time: ${now}.`,
    { agentType: 'om-cmo', label: 'cmo plan', phase: 'Plan' })
  await applyResults('apply plan')
  state = await readyTasks('queue after plan')
}

// ── Waves ───────────────────────────────────────────────
phase('Waves')
let wave = 0
let ran = 0
while (wave < MAX_WAVES && state.ready.length > 0) {
  wave++
  log(`Wave ${wave}: ${state.ready.length} task(s) — ${state.ready.map((t) => t.agent).join(', ')}`)
  await pipeline(
    state.ready,
    (t) => omAgent(t.agent, taskPrompt(t), { label: `${t.agent} ${t.id}`, phase: 'Waves', schema: RESULT }),
    (res, t) => agent(`Evaluate task ${t.id} (${t.agent}) in products/${slug}/: read the task brief in tasks.json, its result file runs/${t.id}.json and the files it lists. Score 1–5 for usefulness, accuracy and fit to the ICP. Write products/${slug}/runs/EV-${t.id}.json as {"task_id":"EV-${t.id}","agent":"om-evaluator","status":"done","evaluations":[{"task_id":"${t.id}","score":<n>,"note":"..."}]}. Agent's own status: ${res?.status ?? 'no result'}.`,
      { agentType: 'om-evaluator', label: `eval ${t.id}`, phase: 'Waves', effort: 'low', model: 'haiku' }),
  )
  ran += state.ready.length
  await applyResults(`apply wave ${wave}`)
  state = await readyTasks(`queue after wave ${wave}`)
}
if (state.ready.length > 0) log(`Stopped after ${MAX_WAVES} waves; ${state.ready.length} ready task(s) left for the next run`)

// ── Review ──────────────────────────────────────────────
phase('Review')
const reviewers = [
  ['om-compliance-guard', 'Check every pending approval in approvals.json against claims.md, platform rules, CAN-SPAM/GDPR and ad policy.'],
  ['om-qa-tester', 'Check every pending outbox item for broken links, missing UTMs, formatting and platform limits.'],
  ['om-brand-guardian', 'Check every pending outbox item for voice and terminology.'],
]
await parallel(reviewers.map(([a, job]) => () => agent(
  `Product workspace: products/${slug}/. ${job} Edit the outbox files to fix small problems. Write your verdicts to products/${slug}/reports/review-${a}.md, one line per approval id: pass, fix (what you changed) or block (why). Do not edit approvals.json.`,
  { agentType: a, label: a, phase: 'Review' })))
// Compliance verdicts reach approvals.json only through apply-results.mjs, from a reviewer run file.
await agent(`In products/${slug}/, read reports/review-om-compliance-guard.md, review-om-qa-tester.md and review-om-brand-guardian.md. For each pending approval in approvals.json decide "block" if any reviewer blocked it, else "fix" if any fixed it, else "pass". Write products/${slug}/runs/REVIEW-AP-${now.slice(0, 10)}.json as {"agent": "om-compliance-guard", "reviews": [{"approval_id": "<id>", "compliance": "pass|fix|block", "notes": "<why, citing the review files>"}]}. Do not edit approvals.json: apply-results sets "compliance" from this file.`,
  { agentType: 'om-compliance-guard', label: 'merge reviews', phase: 'Review', effort: 'low' })
await applyResults('apply reviews')

// Autonomy policy: approvals that passed review and that product.json allows run on their own.
await agent(`Run \`node tools/policy.mjs ${slug} --now ${now}\` then \`node tools/execute.mjs ${slug} --now ${now}\` from the project root and return both outputs. The executor carries out approved and auto-approved items through configured connectors and writes manual steps for the rest.`, { label: 'policy + execute', phase: 'Review', effort: 'low', model: 'haiku' })

// ── Learn ───────────────────────────────────────────────
phase('Learn')
await agent(`Run \`node tools/metrics.mjs ${slug}\` and \`node tools/budget.mjs ${slug}\` from the project root and return both outputs.`, { label: 'metrics + budget', phase: 'Learn', effort: 'low', model: 'haiku' })
await agent(`Product workspace: products/${slug}/. Task id: EXP-${now.slice(0, 10)}. Review experiments.json and report results; put verdict updates in experiments of runs/EXP-${now.slice(0, 10)}.json.`,
  { agentType: 'om-experiment-manager', label: 'experiments', phase: 'Learn' })
await applyResults('apply experiments')
await parallel([
  () => agent(`Product workspace: products/${slug}/. Update LEARNINGS.md from experiments.json and the evaluator scores in tasks.json. Promote rules that also hold in other products to playbooks/.`, { agentType: 'om-learner', label: 'learner', phase: 'Learn' }),
  () => agent(`Product workspace: products/${slug}/. Write reports/cost.md: effort and spend per result this run, and where a cheaper model or fewer runs would keep quality.`, { agentType: 'om-cost-optimizer', label: 'cost', phase: 'Learn', effort: 'low', model: 'haiku' }),
])

// ── Report ──────────────────────────────────────────────
phase('Report')
const report = await agent(`Run \`node tools/build-state.mjs\` and \`node tools/needs-you-know.mjs\`, then write products/${slug}/reports/${now.slice(0, 10)}.md: what was done this run, what is blocked, and what is waiting for the owner. Return that report's text.`,
  { agentType: 'om-reporter', label: 'reporter', phase: 'Report' })

return { slug, waves: wave, tasksRun: ran, remainingReady: state.ready.length, open: state.open, blocked: state.blocked, report }
