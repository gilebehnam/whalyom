export const meta = {
  name: 'om-lifecycle',
  description: 'Lifecycle program: journey map and KPIs, then onboarding, activation, trial-to-paid, upgrade, churn-save, win-back, expansion and advocacy sequences, each with editor/compliance/red-team review, deliverability and consent checks, and send-time experiments',
  whenToUse: 'Build or refresh the lifecycle messaging for a product with users or trials. args: {slug, now, stages?: ["onboarding","activation","trial","upgrade","churn","winback","expansion","advocacy"]}',
  phases: [
    { title: 'Context', detail: 'product.json, budget mode and caps' },
    { title: 'Map', detail: 'journey map, cohort data, KPI formulas' },
    { title: 'Sequences', detail: 'per stage: sequence draft, adversarial review with one repair round' },
    { title: 'Deliverability', detail: 'SPF/DKIM/DMARC, volumes, consent for SMS and push' },
    { title: 'Experiments', detail: 'subject line, timing and offer tests' },
    { title: 'Report', detail: 'apply results, merge review verdicts, report' },
  ],
}

const NAME = 'om-lifecycle'
const slug = args?.slug
if (!slug) throw new Error(`${NAME} needs args.slug`)
const now = args?.now ?? 'unknown-time'
const day = String(now).slice(0, 10)
const ws = `products/${slug}/`
const PFX = `LC-${day}`

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

const STAGES = {
  onboarding: ['om-onboarding-optimizer', 'first-run flow, checklist and welcome emails that get a new user to the first win'],
  activation: ['om-activation-emails', 'behavior-triggered emails for users who signed up but did not activate, one per missing step'],
  trial: ['om-email-nurture', 'trial-to-paid sequence: value recap, objection answers, trial-end reminder with honest urgency'],
  upgrade: ['om-paywall-optimizer', 'in-product upgrade prompts and the trial-end or limit-reached flow'],
  churn: ['om-churn-preventer', 'cancel flow, save offers within sales/deal-desk.md, and at-risk alerts'],
  winback: ['om-winback', 'win-back campaign for churned and inactive users (only users who did not opt out)'],
  expansion: ['om-upsell', 'upsell and cross-sell moments and the prompt or email for each'],
  advocacy: ['om-advocacy', 'review, referral and case-study asks for happy customers, with consent wording'],
}
const asked = args?.stages ?? Object.keys(STAGES)
const stages = asked.filter((s) => STAGES[s])
if (asked.length !== stages.length) log(`Skipping unknown stages: ${asked.filter((s) => !STAGES[s]).join(', ')}`)

// ── Map ─────────────────────────────────────────────────────────────────────
phase('Map')
await parallel([
  () => task('M1', 'om-lifecycle-architect', 'Write research/lifecycle/journey.md: visitor, lead, trial, customer, champion and churned stages, the trigger into each, and the one message that moves a person to the next stage.', 'Map'),
  () => task('M2', 'om-cohort-analyst', 'Write research/lifecycle/cohorts.md: activation and retention by signup cohort and channel from metrics/ data; say plainly when there is no data yet.', 'Map'),
  () => task('M3', 'om-kpi-definer', 'Write research/lifecycle/kpis.md: activation, trial-to-paid, retention, churn and expansion formulas, so every lifecycle report uses the same numbers.', 'Map', { effort: 'low' }),
])

// ── Sequences ───────────────────────────────────────────────────────────────
phase('Sequences')
const seqs = await pipeline(
  stages,
  (s, _s, i) => task(`S${i + 1}`, STAGES[s][0], `Write outbox/lifecycle/${s}.md: ${STAGES[s][1]}. Follow research/lifecycle/journey.md; per message give trigger, delay, subject, body, CTA and the exit rule. Emails carry sender identity and unsubscribe. Add one approval of type "send" for the sequence.`, 'Sequences'),
  (res, s, i) => gated(`S${i + 1}`, STAGES[s][0], `outbox/lifecycle/${s}.md`, `${s} stage: trigger logic, consent and opt-out, CAN-SPAM/GDPR, claims, honest urgency, tone`, 'Sequences').then((rv) => ({ stage: s, ...rv })),
)

// ── Deliverability ──────────────────────────────────────────────────────────
phase('Deliverability')
const wantsSms = ctx.channels.some((c) => /sms|push/i.test(c))
await parallel([
  () => task('D1', 'om-deliverability', 'Write research/lifecycle/deliverability.md: SPF, DKIM and DMARC records to check, sending domain, warm-up and daily volume limits, list hygiene and suppression rules for these sequences.', 'Deliverability', { effort: 'low' }),
  wantsSms ? () => task('D2', 'om-sms-push', 'Write outbox/lifecycle/sms-push.md: SMS and push messages for the key moments of the journey, only for users who gave explicit consent for that channel, with quiet hours. Add one "send" approval.', 'Deliverability') : null,
].filter(Boolean))

// ── Experiments ─────────────────────────────────────────────────────────────
phase('Experiments')
await task('X1', 'om-experiment-manager', `For the sequences in outbox/lifecycle/ (${stages.join(', ')}), name one experiment each in your run file: subject line, send time or offer; hypothesis, one primary metric from research/lifecycle/kpis.md, minimum sample and stop date.`, 'Experiments', { effort: 'low' })

const done = seqs.filter(Boolean)
const out = await finish(`Sequences: ${done.map((s) => `${s.stage} ${s.verdict}`).join(', ')}.`)
return { slug, workflow: NAME, sequences: done.map((s) => ({ stage: s.stage, verdict: s.verdict })), report: out.report }
