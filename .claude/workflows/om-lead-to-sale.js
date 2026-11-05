export const meta = {
  name: 'om-lead-to-sale',
  description: 'Lead to sale: new inbound leads get enrichment from public business sources, a speed-to-lead reply, an SDR next step, a follow-up sequence and a checkout or booking link within deal-desk rules, each reviewed for consent and claims. With no leads it builds the playbook and templates. Every message is a draft plus a send approval',
  whenToUse: 'Turn inbound leads into revenue, or set up the sales motion before leads arrive. args: {slug, now, max?: 10 leads per run}',
  phases: [
    { title: 'Context', detail: 'product.json, budget mode and caps' },
    { title: 'Intake', detail: 'unanswered inbound leads from leads/, metrics/inbox and CRM exports' },
    { title: 'Rules', detail: 'deal desk, lead score, objections, sales playbook' },
    { title: 'Respond', detail: 'per lead: enrich, first reply, SDR next step, follow-ups' },
    { title: 'Close', detail: 'per lead: checkout or booking link within deal-desk rules; pipeline stages' },
    { title: 'Review', detail: 'editor, compliance (consent, CAN-SPAM/GDPR) and red team per lead' },
    { title: 'Report', detail: 'apply results, merge review verdicts, report' },
  ],
}

const NAME = 'om-lead-to-sale'
const slug = args?.slug
if (!slug) throw new Error(`${NAME} needs args.slug`)
const now = args?.now ?? 'unknown-time'
const day = String(now).slice(0, 10)
const ws = `products/${slug}/`
const PFX = `L2S-${day}`
const MAX = Math.max(1, Math.min(Number(args?.max ?? 10), 25))

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

const PRIVACY = 'Lead data stays in this workspace: use only what the lead gave and public business information (company, role, public posts); no personal data beyond business contact details, nothing in file names or URLs beyond the lead id.'

// ── Intake ──────────────────────────────────────────────────────────────────
phase('Intake')
const LEADS = {
  type: 'object',
  properties: { leads: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, source: { type: 'string' }, ask: { type: 'string' }, consent: { type: 'string', enum: ['inbound', 'opted-in', 'unknown'] },
  }, required: ['id', 'source', 'ask', 'consent'] } }, total: { type: 'number' } },
  required: ['leads', 'total'],
}
const intake = await agent(`In ${ws}, find inbound leads that have no reply yet: leads at stage "new" in funnel/next-actions.json (tools/funnel.mjs; ids only, contact details from leads.jsonl), files in leads/ (json, csv or md), CRM or form exports in metrics/inbox/, and sales/ notes. Skip leads that already have outbox/sales/<lead id>/reply.md. Return up to ${MAX} by recency with a short id (letters, digits, dashes), source, what they asked, and consent (inbound = they wrote to us; opted-in = they subscribed; unknown). Also return the total found. Do not change any file. ${PRIVACY}`,
  { label: 'lead intake', phase: 'Intake', schema: LEADS, effort: 'low', model: 'haiku' })
const leads = (intake.leads ?? []).slice(0, MAX).map((l, i) => ({ ...l, id: String(l.id || `lead-${i + 1}`).replace(/[^A-Za-z0-9-]+/g, '-').slice(0, 40), code: `LD${i + 1}` }))
if (intake.total > leads.length) log(`${intake.total} leads found; handling ${leads.length} this run, the rest wait for the next`)
const noConsent = leads.filter((l) => l.consent === 'unknown')
if (noConsent.length) log(`${noConsent.length} lead(s) with unknown consent get a reply to their own message only, no sequence`)

// ── Rules ───────────────────────────────────────────────────────────────────
phase('Rules')
// Barrier: every reply and checkout link depends on these rules.
await parallel([
  () => task('R1', 'om-deal-desk', 'Write or update sales/deal-desk.md: list prices, the discounts allowed without the owner (if any), approval levels, and what never gets discounted.', 'Rules', { effort: 'low' }),
  () => task('R2', 'om-lead-scorer', 'Write or update sales/lead-score.md: fit and behavior score, the hot threshold, and routing.', 'Rules', { effort: 'low' }),
  () => task('R3', 'om-objection-handler', 'Write or update sales/objections.md: the objections in research/voc.md and past replies, with the best honest answer and proof from claims.md.', 'Rules', { effort: 'low' }),
  () => task('R4', 'om-sales-agent', 'Write or update sales/playbook.md: answers to buyer questions, demo or trial path, and the reply style.', 'Rules'),
])

let results = []
if (!leads.length) {
  log('No unanswered leads; building templates instead')
  phase('Respond')
  await parallel([
    () => task('T1', 'om-speed-to-lead', 'Write sales/templates/first-reply.md: first-reply templates per inbound source (demo request, pricing question, trial signup, contact form) that answer and offer one next step.', 'Respond'),
    () => task('T2', 'om-follow-up', 'Write sales/templates/follow-ups.md: a 3-step follow-up sequence for quiet leads, each with a new reason to reply, and the stop rule.', 'Respond'),
    () => task('T3', 'om-revops', 'Write sales/pipeline.md: pipeline stages, entry and exit criteria, routing and the metrics that connect marketing to revenue.', 'Respond'),
  ])
  phase('Close')
  await task('T4', 'om-checkout-finisher', 'Write sales/templates/close.md: how to send the right checkout or booking link per plan and lead type, within sales/deal-desk.md.', 'Close')
  phase('Review')
  const rv = await gated('TPL', 'om-sales-agent', 'sales/templates/', 'claims, consent, CAN-SPAM/GDPR, honest urgency only', 'Review')
  results = [{ code: 'TPL', verdict: rv.verdict }]
} else {
  phase('Respond')
  const LEAN = Number(args?.reviewers) === 1
  if (LEAN) {
    // Lean (economy mode): the reply and the follow-ups only, then one compliance review over every draft.
    await pipeline(leads,
      (l) => task(`${l.code}-R`, 'om-speed-to-lead', `Draft the first reply to lead ${l.id} in outbox/sales/${l.id}/reply.md: answer "${l.ask}" directly from sales/playbook.md and claims.md, offer one next step with the checkout or booking link from sales/deal-desk.md (no discount beyond it). Add one approval of type "send" with "lead": "${l.id}". ${PRIVACY}`, 'Respond', { effort: 'low' }),
      (res, l) => (l.consent === 'unknown' ? Promise.resolve(null) : task(`${l.code}-F`, 'om-follow-up', `Draft a 2-step follow-up for lead ${l.id} in outbox/sales/${l.id}/follow-ups.md (days 3 and 8, stop on any reply or opt-out). One "send" approval per step with "lead": "${l.id}". ${PRIVACY}`, 'Respond', { effort: 'low' })),
    )
    results = [await gated('LEADS', 'om-speed-to-lead', leads.map((l) => `outbox/sales/${l.id}/`).join(', '), 'every lead: consent, CAN-SPAM/GDPR (sender, opt-out), claims, discounts within the deal desk, tone', 'Review')]
  } else results = await pipeline(
    leads,
    (l) => task(`${l.code}-E`, 'om-lead-enricher', `Lead ${l.id} (${l.source}): "${l.ask}". Add firmographics, role and a personal opener from public business sources to sales/leads/${l.id}.md. ${PRIVACY}`, 'Respond', { effort: 'low' }),
    (res, l) => task(`${l.code}-R`, 'om-speed-to-lead', `Draft the first reply to lead ${l.id} in outbox/sales/${l.id}/reply.md: answer "${l.ask}" directly, use sales/playbook.md and sales/objections.md, offer one next step. Add one approval of type "send" with "lead": "${l.id}" so the funnel marks the lead contacted once it is sent. ${PRIVACY}`, 'Respond'),
    (res, l) => task(`${l.code}-S`, 'om-sdr', `Score lead ${l.id} with sales/lead-score.md and draft the next step in outbox/sales/${l.id}/next-step.md (call booking or trial help) for after the first reply. ${PRIVACY}`, 'Respond', { effort: 'low' }),
    (res, l) => (l.consent === 'unknown' ? Promise.resolve(null) : task(`${l.code}-F`, 'om-follow-up', `Draft a 3-step follow-up for lead ${l.id} in outbox/sales/${l.id}/follow-ups.md (days 2, 5 and 10, each with a new reason to reply, stop on any reply or opt-out). One "send" approval per step. ${PRIVACY}`, 'Respond', { effort: 'low' })),
    (res, l) => task(`${l.code}-C`, 'om-checkout-finisher', `Prepare the checkout or booking link for lead ${l.id} in outbox/sales/${l.id}/close.md: the plan that fits, any discount only within sales/deal-desk.md (anything beyond is a "price" approval), and the message that sends it. ${PRIVACY}`, 'Close', { effort: 'low' }),
    (res, l) => gated(l.code, 'om-speed-to-lead', `outbox/sales/${l.id}/`, `consent (${l.consent}), CAN-SPAM/GDPR (sender, opt-out), claims, discounts within the deal desk, tone`, 'Review'),
  )
  phase('Close')
  await task('PIPE', 'om-revops', `Update sales/pipeline.md with the ${leads.length} leads of this run (ids only, stage, next step) and the stage metrics.`, 'Close', { effort: 'low' })
  phase('Review')
}
const verdicts = results.filter(Boolean).map((r) => ({ code: r.code, verdict: r.verdict }))
const out = await finish(`Leads handled: ${leads.length} (${verdicts.filter((v) => v.verdict === 'block').length} blocked in review). Replies go out only after the owner approves them; speed matters, so approve the "send" items first.`)
return { slug, workflow: NAME, leads: leads.map((l) => l.id), verdicts, report: out.report }
