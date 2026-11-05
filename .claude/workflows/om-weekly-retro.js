export const meta = {
  name: 'om-weekly-retro',
  description: 'Weekly retro: metrics, budget, learning scores and killswitch dry run; anomalies with root causes that must survive a red-team refutation; retro, cost and forecast; experiment verdicts and learnings; next week plan attacked by the red team and revised; Monday brief',
  whenToUse: 'Once a week per active product. args: {slug, now, maxAnomalies?: 5}',
  phases: [
    { title: 'Context', detail: 'product.json, budget mode and caps' },
    { title: 'Metrics', detail: 'metrics, budget, learn and killswitch scripts, weekly numbers' },
    { title: 'Anomalies', detail: 'detected changes, root cause per change, red team tries to refute' },
    { title: 'Retro', detail: 'what shipped, worked and should stop; cost; forecast' },
    { title: 'Learn', detail: 'experiment verdicts, then LEARNINGS.md and playbooks' },
    { title: 'Plan', detail: 'next week tasks, red-team attack, revision, Monday brief' },
    { title: 'Report', detail: 'apply results, merge review verdicts, report' },
  ],
}

const NAME = 'om-weekly-retro'
const slug = args?.slug
if (!slug) throw new Error(`${NAME} needs args.slug`)
const now = args?.now ?? 'unknown-time'
const day = String(now).slice(0, 10)
const ws = `products/${slug}/`
const PFX = `RET-${day}`
const MAXA = Math.max(1, Math.min(Number(args?.maxAnomalies ?? 5), 10))

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

// ── Metrics ─────────────────────────────────────────────────────────────────
phase('Metrics')
const scripts = await agent(`From the project root run, in order: \`node tools/metrics.mjs ${slug}\`, \`node tools/budget.mjs ${slug}\`, \`node tools/learn.mjs ${slug}\` and \`node tools/killswitch.mjs ${slug} --dry-run\`. Return each command's output under its name.`,
  { label: 'metrics scripts', phase: 'Metrics', effort: 'low', model: 'haiku' })
await task('M1', 'om-analyst', `Write reports/weekly-metrics-${day}.md: this week against last week for traffic, signups, activation, revenue and spend by channel (metrics/kpis.json, ledger, budget-plan.json), using the KPI formulas in research/lifecycle/kpis.md when present. Say plainly which numbers are missing.`, 'Metrics')

// ── Anomalies ───────────────────────────────────────────────────────────────
phase('Anomalies')
const ANOM = {
  type: 'object',
  properties: { anomalies: { type: 'array', items: { type: 'object', properties: {
    metric: { type: 'string' }, change: { type: 'string' }, severity: { type: 'string', enum: ['low', 'medium', 'high'] }, likely_cause: { type: 'string' },
  }, required: ['metric', 'change', 'severity', 'likely_cause'] } } },
  required: ['anomalies'],
}
const found = await task('A0', 'om-anomaly-detector', `Read reports/weekly-metrics-${day}.md and the metrics history. List sudden changes in traffic, signups, spend, rankings or conversion with severity and likely cause. Write reports/anomalies-${day}.md.`, 'Anomalies', { schema: ANOM })
const serious = (found?.anomalies ?? []).filter((a) => a.severity !== 'low')
if (serious.length > MAXA) log(`${serious.length} anomalies; investigating the first ${MAXA}`)
const REF = { type: 'object', properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } }, required: ['refuted', 'reason'] }
const causes = await pipeline(
  serious.slice(0, MAXA),
  (a, _a, i) => task(`A${i + 1}`, 'om-analyst', `Find the root cause of: ${a.metric} ${a.change} (first guess: ${a.likely_cause}). Check tracking breaks, seasonality, releases, spend changes and competitor moves. Append your finding with evidence to reports/anomalies-${day}.md under "${a.metric}".`, 'Anomalies'),
  (res, a, i) => omAgent('om-red-team', `Product workspace: ${ws}. Try to refute the root cause given for "${a.metric} ${a.change}" in reports/anomalies-${day}.md (analyst summary: ${res?.summary ?? 'none'}). Could tracking, sample size or a coincidence explain it instead? Default to refuted when the evidence is thin. Write reports/review-${PFX}-A${i + 1}-om-red-team.md.`,
    { label: `refute A${i + 1}`, phase: 'Anomalies', schema: REF, effort: 'low' })
    .then((v) => ({ metric: a.metric, change: a.change, severity: a.severity, confirmed: v ? !v.refuted : false, note: v?.reason ?? '' })),
)
const confirmed = causes.filter(Boolean).filter((c) => c.confirmed)

// ── Retro ───────────────────────────────────────────────────────────────────
phase('Retro')
await parallel([
  () => task('R1', 'om-retro', `Write reports/retro-${day}.md: what shipped this week (tasks done, approvals executed), what worked and what did not (evaluator scores, experiments), what to stop, and the confirmed anomalies (${confirmed.map((c) => `${c.metric} ${c.change}`).join('; ') || 'none'}). Unconfirmed anomalies are listed as open questions, not causes.`, 'Retro'),
  () => task('R2', 'om-cost-optimizer', `Write reports/cost-${day}.md: agent effort and ad spend per result this week, and where a cheaper model or fewer runs would keep quality.`, 'Retro', { effort: 'low' }),
  () => task('R3', 'om-forecaster', `Write reports/forecast-${day}.md: next month's leads and revenue from the trend and the planned work, with a low, base and high case and the assumptions.`, 'Retro', { effort: 'low' }),
])

// ── Learn ───────────────────────────────────────────────────────────────────
phase('Learn')
await task('L1', 'om-experiment-manager', 'Review experiments.json: give a verdict to every test that reached its minimum sample or stop date, and put the updates under "experiments" in your run file. Leave the rest running.', 'Learn', { effort: 'low' })
await agent(`Run \`node tools/apply-results.mjs ${slug} --now ${now}\` from the project root and return its stdout.`, { label: 'apply verdicts', phase: 'Learn', effort: 'low', model: 'haiku' })
await omAgent('om-learner', `Product workspace: ${ws}. Update LEARNINGS.md from experiments.json, reports/retro-${day}.md and the evaluator scores in tasks.json; promote rules that hold across products to playbooks/.`, { label: 'learner', phase: 'Learn' })

// ── Plan ────────────────────────────────────────────────────────────────────
phase('Plan')
// Draft first, attack, then commit: only the reviewed set reaches new_tasks.
await task('P1', 'om-cmo', `Read reports/retro-${day}.md, LEARNINGS.md and plan.md. Write reports/next-week-${day}.md with 5-15 proposed tasks for next week (one roster agent each, brief, depends_on, priority), doubling down on what worked and dropping what the retro says to stop. Do not put them in new_tasks yet.`, 'Plan')
const attack = await review('PLAN', `reports/next-week-${day}.md, plan.md`, 'tasks that repeat what failed, missing evidence, spend that a free-mode or capped product cannot afford, tasks with no metric', 'Plan', ['om-red-team'])
await task('P2', 'om-cmo', `Commit next week's tasks: put the tasks from reports/next-week-${day}.md in your run file's new_tasks${attack.verdict === 'pass' ? '' : `, corrected for the red team findings (reports/review-${PFX}-PLAN-om-red-team.md): ${attack.issues.join(' | ').slice(0, 1500)}`}. Update plan.md only where the retro changes it.`, 'Plan', { effort: 'low' })
await task('P3', 'om-chief-of-staff', `Write reports/monday-brief-${day}.md: the owner's week in under 15 lines: priorities, what waits for approval, decisions needed, deadlines.`, 'Plan', { effort: 'low' })

const out = await finish(`Confirmed anomalies: ${confirmed.length} of ${serious.length}. Plan review: ${attack.verdict}.`)
return { slug, workflow: NAME, scripts, anomalies: causes.filter(Boolean), planReview: attack.verdict, report: out.report }
