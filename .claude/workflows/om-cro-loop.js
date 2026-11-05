export const meta = {
  name: 'om-cro-loop',
  description: 'CRO loop: friction finder, funnel and form analysis, ranked hypotheses that survive a three-judge refutation panel, bandit tests with built variants and QA, verdicts on running tests from real metrics only, and learnings',
  whenToUse: 'Improve conversion on the site or funnel; run weekly to close running tests. args: {slug, now, tests?: 3 (max 6)}',
  phases: [
    { title: 'Context', detail: 'product.json, budget mode and caps' },
    { title: 'Find', detail: 'live funnel walk, biggest drop-off, form friction' },
    { title: 'Hypotheses', detail: 'ranked hypotheses, each attacked by three judges; survivors only' },
    { title: 'Tests', detail: 'per survivor: bandit test definition, variant build, QA and review' },
    { title: 'Verdicts', detail: 'running tests judged from metrics, double-checked' },
    { title: 'Learn', detail: 'LEARNINGS.md from the verdicts' },
    { title: 'Report', detail: 'apply results, merge review verdicts, report' },
  ],
}

const NAME = 'om-cro-loop'
const slug = args?.slug
if (!slug) throw new Error(`${NAME} needs args.slug`)
const now = args?.now ?? 'unknown-time'
const day = String(now).slice(0, 10)
const ws = `products/${slug}/`
const PFX = `CRO-${day}`
const TESTS = Math.max(1, Math.min(Number(args?.tests ?? 3), 6))

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

// ── Find ────────────────────────────────────────────────────────────────────
phase('Find')
await parallel([
  () => task('F1', 'om-friction-finder', ctx.domain
    ? `Walk the live funnel on ${ctx.domain} (home, pricing, signup, checkout) and write research/cro/friction-${day}.md: broken steps, slow pages, confusing copy, with a screenshot path or exact quote per issue. Do not submit real forms or payments.`
    : 'There is no live site yet: walk the drafted pages in outbox/site/ and content/ and write research/cro/friction-' + day + '.md with the issues a visitor would hit.', 'Find'),
  () => task('F2', 'om-funnel-analyst', 'Write research/cro/funnel-' + day + '.md: the biggest drop-off in the funnel from metrics/ data (or the most likely one, marked as an assumption when there is no data) and what to test there.', 'Find'),
  () => task('F3', 'om-form-optimizer', 'Write research/cro/forms-' + day + '.md: fields, steps and errors to cut from the signup, demo and checkout forms.', 'Find', { effort: 'low' }),
])

// ── Hypotheses ──────────────────────────────────────────────────────────────
phase('Hypotheses')
const HYP = {
  type: 'object',
  properties: { hypotheses: { type: 'array', items: { type: 'object', properties: {
    code: { type: 'string' }, page: { type: 'string' }, change: { type: 'string' }, metric: { type: 'string' }, expected_lift: { type: 'number' }, evidence: { type: 'string' },
  }, required: ['code', 'page', 'change', 'metric', 'expected_lift', 'evidence'] } } },
  required: ['hypotheses'],
}
const hyp = await task('H1', 'om-cro', `From research/cro/*-${day}.md, write research/cro/hypotheses-${day}.md: up to ${TESTS * 2} test hypotheses ranked by expected lift x confidence / effort, each with page, change, one primary metric, expected lift and the evidence behind it. Skip anything already tested in experiments.json. Return them with short codes H1, H2, ...`, 'Hypotheses', { schema: HYP })
const candidates = (hyp?.hypotheses ?? []).slice(0, TESTS * 2).map((h, i) => ({ ...h, code: `H${i + 1}` }))
const REFUTE = { type: 'object', properties: { refuted: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } }, required: ['refuted', 'notes'] }
const list = candidates.map((h) => `${h.code}: on ${h.page}, ${h.change} (metric ${h.metric}; evidence: ${h.evidence})`).join('\n')
const judges = [
  ['om-red-team', 'Is the evidence real, or is this a guess dressed as data?'],
  ['om-experiment-manager', 'Can this be measured with the traffic the product has (minimum sample, test length)?'],
  ['om-funnel-analyst', 'Does it target a real drop-off, or a step few visitors reach?'],
]
const votes = (await parallel(judges.map(([a, lens]) => () => omAgent(a, `Product workspace: ${ws}. Try to refute each CRO hypothesis below. ${lens} Default to refuting when unsure. Write reports/review-${PFX}-HYP-${a}.md. Return the codes you refute.\n${list}`,
  { label: `${a} refute`, phase: 'Hypotheses', schema: REFUTE, effort: 'low' })))).filter(Boolean)
const survivors = candidates.filter((h) => votes.filter((v) => v.refuted.includes(h.code)).length < 2).slice(0, TESTS)
log(`${survivors.length} of ${candidates.length} hypotheses survived the panel: ${survivors.map((h) => h.code).join(', ') || 'none'}`)

// ── Tests ───────────────────────────────────────────────────────────────────
phase('Tests')
const tests = await pipeline(
  survivors,
  (h) => task(`T-${h.code}`, 'om-bandit-cro', `Define a bandit test for ${h.code}: on ${h.page}, ${h.change}. Arms (control plus 1-3 variants), primary metric ${h.metric}, minimum traffic per arm, stop rule and how traffic shifts to the winner. Put it under "experiments" in your run file with status "planned".`, 'Tests', { effort: 'low' }),
  (res, h) => task(`B-${h.code}`, 'om-landing-builder', `Build the variant files for ${h.code} in outbox/cro/${h.code}-${day}/ (the change: ${h.change}; page ${h.page}), keeping tracking intact. Add one approval of type "publish" to start the test.`, 'Tests'),
  (res, h) => gated(`T-${h.code}`, 'om-landing-builder', `outbox/cro/${h.code}-${day}/`, `the variant really tests "${h.change}" and nothing else, claims, broken links or forms, tracking kept`, 'Tests', ).then((rv) => ({ code: h.code, change: h.change, verdict: rv.verdict })),
)

// ── Verdicts ────────────────────────────────────────────────────────────────
phase('Verdicts')
const VERD = { type: 'object', properties: { judged: { type: 'array', items: { type: 'string' } }, waiting: { type: 'array', items: { type: 'string' } } }, required: ['judged', 'waiting'] }
const verdicts = await task('V1', 'om-bandit-cro', 'For each running test in experiments.json, read metrics/ (kpis.json and the inbox) and decide: winner, loser, or keep running. Declare a result only when every arm reached its minimum sample; otherwise keep it running. Put the result updates under "experiments" in your run file (id, status, result). Return the ids judged and the ids still waiting.', 'Verdicts', { schema: VERD })
// A verdict the review challenges must not reach experiments.json (and from there LEARNINGS.md and playbooks/):
// one repair round sends challenged tests back to "running"; a verdict still blocked is held out of apply-results.
const VERD_FOCUS = 'verdicts declared without the minimum sample, peeking, or a metric that does not match the hypothesis'
const VERD_PANEL = ['om-experiment-manager', 'om-red-team']
let verdReview = null
let verdictsHeld = false
if (verdicts.judged.length) {
  verdReview = await review('VERD', `runs/${PFX}-V1.json`, VERD_FOCUS, 'Verdicts', VERD_PANEL)
  if (verdReview.verdict !== 'pass') {
    log(`VERD: review returned "${verdReview.verdict}"; one repair round before any verdict is applied`)
    await task('V1-FIX', 'om-bandit-cro', `The review of ${ws}runs/${PFX}-V1.json returned "${verdReview.verdict}" with these findings: ${verdReview.issues.join(' | ').slice(0, 1500)}. Read ${ws}reports/review-${PFX}-VERD-*.md. Rewrite ${ws}runs/${PFX}-V1.json in place: every experiment whose verdict was challenged (no minimum sample per arm, peeking, or a metric that does not match the hypothesis) goes back to status "running" with no result and the review issues as a note; keep only verdicts that meet the minimum sample on the hypothesis metric. Your own run file lists the file you changed and carries no "experiments".`, 'Verdicts')
    verdReview = await review('VERD-R2', `runs/${PFX}-V1.json`, VERD_FOCUS, 'Verdicts', VERD_PANEL)
    if (verdReview.verdict === 'block') {
      verdictsHeld = true
      log(`VERD: still blocked after repair; ${ws}runs/${PFX}-V1.json is held in runs/held/ and not applied`)
      await agent(`Move ${ws}runs/${PFX}-V1.json to ${ws}runs/held/${PFX}-V1.json (create runs/held/ if needed) so apply-results.mjs does not merge it; if ${ws}runs/${PFX}-V1.start exists, move it to ${ws}runs/held/${PFX}-V1.start too so the control room does not show V1 as still working. Change nothing else. Return the new path.`, { label: 'hold verdicts', phase: 'Verdicts', effort: 'low', model: 'haiku' })
    }
  }
}
await agent(`Run \`node tools/apply-results.mjs ${slug} --now ${now}\` from the project root and return its stdout.`, { label: 'apply verdicts', phase: 'Verdicts', effort: 'low', model: 'haiku' })

// ── Learn ───────────────────────────────────────────────────────────────────
phase('Learn')
await omAgent('om-learner', `Product workspace: ${ws}. Update LEARNINGS.md from the CRO verdicts now in experiments.json and the refuted hypotheses in reports/review-${PFX}-HYP-*.md (what not to test again and why). Promote rules that hold across products to playbooks/.`, { label: 'learner', phase: 'Learn' })

const live = tests.filter(Boolean)
const out = await finish(`Hypotheses: ${candidates.length} proposed, ${survivors.length} survived. Tests ready to start: ${live.filter((t) => t.verdict !== 'block').map((t) => t.code).join(', ') || 'none'}. Verdicts this run: ${verdicts.judged.length}${verdictsHeld ? ` (held in runs/held/ after a blocked review, not applied)` : ''}; still running: ${verdicts.waiting.length}.`)
return { slug, workflow: NAME, hypotheses: candidates.length, survivors: survivors.map((h) => h.code), tests: live, verdicts, verdict_review: verdReview?.verdict ?? null, verdicts_held: verdictsHeld, report: out.report }
