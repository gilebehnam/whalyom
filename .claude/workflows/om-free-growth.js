export const meta = {
  name: 'om-free-growth',
  description: 'Zero-budget growth: measures the funnel, plans the free channels in hours (not money), fixes the biggest leak first (missing capture, unanswered leads), then produces this week\'s quota for each free channel with tracked links, each reviewed for claims and platform rules. Every outbound item is a draft plus an approval',
  whenToUse: 'Leads and sales with no ad budget: weekly in free mode, before a first budget, or when paid is paused. args: {slug, now, hours?: owner hours this week (default product.json free.hours_per_week or 6), max_channels?: 6}',
  phases: [
    { title: 'Context', detail: 'product.json, budget mode and caps' },
    { title: 'Measure', detail: 'tools/funnel.mjs and tools/free-engine.mjs: pipeline, leaks, this week\'s free plan' },
    { title: 'Plan', detail: 'zero-budget head: scorecard, the leak, the week\'s focus' },
    { title: 'Fix leaks', detail: 'capture, speed to lead and stuck leads before more attention' },
    { title: 'Attract', detail: 'per free channel: the week\'s quota as drafts with tracked links' },
    { title: 'Review', detail: 'editor, compliance and red team per channel' },
    { title: 'Report', detail: 'apply results, merge review verdicts, funnel again, report' },
  ],
}

const NAME = 'om-free-growth'
const slug = args?.slug
if (!slug) throw new Error(`${NAME} needs args.slug`)
const now = args?.now ?? 'unknown-time'
const day = String(now).slice(0, 10)
const ws = `products/${slug}/`
const PFX = `FREE-${day}`
const MAXC = Math.max(1, Math.min(Number(args?.max_channels ?? 6), 10))
const HOURS = Number(args?.hours) > 0 ? ` --hours ${Number(args.hours)}` : ''

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

const RULES = `Read product.json, profile.md, claims.md and LEARNINGS.md first. Use only claims listed in claims.md: no invented numbers, testimonials, reviews or customer names. Nothing goes out in this run: write drafts to outbox/ and list every publish, send, spend or price action under "approvals" in your run file (spend items carry "amount" in ${ctx.currency}). Never edit tasks.json, approvals.json or experiments.json. Zero-budget run: propose no paid spend at all; a step that needs money is a note for when the owner adds a budget. Follow each platform's rules: no fake accounts, vote or upvote requests, engagement pods, bought reviews, or bulk unsolicited messages. Approvals that send a message to a known lead carry "lead": "<lead id>" so the funnel records the contact once it is sent.`

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

// The agent that leads each free channel (tools/free-engine.mjs CHANNELS ids).
const LEAD = {
  'lead-magnet': 'om-lead-magnet', 'onsite-cro': 'om-cro', 'seo-quick-wins': 'om-writer', 'ai-answers': 'om-geo-optimizer',
  'free-listings': 'om-free-listings-manager', 'local-profile': 'om-local-seo', communities: 'om-community-lead-hunter',
  'short-video': 'om-video-scripter', 'founder-social': 'om-linkedin', 'warm-network': 'om-warm-network-activator',
  'customer-referrals': 'om-ugc-review-engine', 'partner-swaps': 'om-barter-partnerships', directories: 'om-directory-submitter',
  'pr-quotes': 'om-expert-quotes', giveaway: 'om-contest-designer', 'email-list': 'om-email-nurture',
  'free-tool': 'om-free-tool-builder', 'whatsapp-telegram': 'om-whatsapp',
}

// ── Measure ─────────────────────────────────────────────────────────────────
phase('Measure')
const MEASURE = {
  type: 'object',
  properties: {
    leads: { type: 'number' }, leads_30d: { type: 'number' }, won: { type: 'number' }, revenue: { type: 'number' },
    uncontacted_over_sla: { type: 'number' }, stuck: { type: 'number' }, leak_stage: { type: 'string' },
    has_capture: { type: 'boolean' },
    channels: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, label: { type: 'string' }, slot: { type: 'string' }, quota: { type: 'string' }, link: { type: 'string' }, rule: { type: 'string' },
    }, required: ['id', 'label', 'slot', 'quota', 'link', 'rule'] } },
  },
  required: ['leads', 'leads_30d', 'won', 'revenue', 'uncontacted_over_sla', 'stuck', 'leak_stage', 'has_capture', 'channels'],
}
const m = await agent(`From the project root run \`node tools/funnel.mjs ${slug}\` and then \`node tools/free-engine.mjs ${slug}${HOURS}\`. Read ${ws}funnel/report.json and ${ws}funnel/free-plan.json and return: totals.leads, totals.leads_30d, totals.won, totals.revenue, totals.uncontacted_over_sla, totals.stuck, biggest_leak.into ("" when none), whether the site has a consented lead capture (a lead magnet, offer or form: look in landing/, outbox/site/, content/, research/site-audit* and the edge or satellite booster notes; false when nothing shows one), and the plan's channels (id, label, slot, quota, link or "", rule). Change no other file.`,
  { label: 'measure', phase: 'Measure', schema: MEASURE, effort: 'low', model: 'haiku' })
const channels = (m.channels ?? []).filter((c) => LEAD[c.id]).slice(0, MAXC)
if ((m.channels ?? []).length > channels.length) log(`${(m.channels ?? []).length - channels.length} planned channel(s) not run this time (unknown id or over max_channels ${MAXC})`)
if (ctx.mode !== 'free') log(`budget mode is ${ctx.mode}: free channels still run; paid work stays with om-paid-portfolio`)

// ── Plan ────────────────────────────────────────────────────────────────────
phase('Plan')
await task('HEAD', 'om-mega-growth-free', `Read ${ws}funnel/FUNNEL.md and ${ws}funnel/FREE-PLAN.md. Write reports/mega/free-growth.md: the scorecard (capture, speed to lead, follow-up, closing path, referral loop, each planned channel, 0–5 with evidence), the biggest leak (${m.leak_stage || 'none found yet'}), leads ${m.leads} (${m.leads_30d} in 30 days), customers ${m.won}, and the one thing the owner must do this week. The channel work and leak fixes in this run are already dispatched; add new_tasks only for gaps they do not cover.`, 'Plan')

// ── Fix leaks ───────────────────────────────────────────────────────────────
phase('Fix leaks')
// Barrier on purpose: attention is wasted while capture is missing or leads wait unanswered.
const fixes = []
if (!m.has_capture) fixes.push(() => task('CAP', 'om-lead-magnet', 'There is no consented lead capture yet. Design one lead magnet or first-order offer that fits the ICP (checklist, template, quiz, sample, discount), write it to content/lead-magnet/ and its capture page or popup copy to outbox/site/lead-capture.md with an explicit consent line and the double opt-in email. One "publish" approval. Name the capture rate as the metric.', 'Fix leaks'))
if (m.uncontacted_over_sla > 0 || m.stuck > 0) fixes.push(() => task('STUCK', 'om-funnel-manager', `${m.uncontacted_over_sla} new lead(s) have no reply past the limit and ${m.stuck} lead(s) are stuck. Read funnel/next-actions.json and draft the next message for each overdue lead (at most 10) in outbox/sales/<lead id>/next.md, using sales/playbook.md and claims.md; leads with consent "unknown" get a reply to their own message only. One "send" approval per message carrying "lead": "<lead id>". Write reports/funnel/${day}.md.`, 'Fix leaks'))
fixes.push(() => task('ROUTE', 'om-lead-router', 'Route every lead at stage "new" in funnel/pipeline.json that has no sales/routes/<lead id>.md yet: intent, priority, consent path, owner agent and reply deadline. Spam and bots go to funnel/updates as lost with reason spam.', 'Fix leaks', { effort: 'low' }))
await parallel(fixes)
let leakReview = null
if (fixes.length > 1) leakReview = await gated('LEAK', 'om-funnel-manager', 'outbox/sales/ and outbox/site/lead-capture.md', 'consent, CAN-SPAM/GDPR (sender, opt-out), claims, a reply that answers the lead\'s own question', 'Review')

// ── Attract ─────────────────────────────────────────────────────────────────
phase('Attract')
const LEAN = Number(args?.reviewers) === 1
const results = await pipeline(
  channels,
  (c, _i, i) => task(`C${i + 1}`, LEAD[c.id], `Free channel "${c.label}" (${c.slot}). This week's quota: ${c.quota}. Produce it as drafts in outbox/free/${c.id}/ ready for the owner to post or send from their own accounts, each with the tracked link ${c.link || '(no domain yet: write the drafts and note the link to add)'} so the funnel credits its leads. Rule for this channel: ${c.rule} One approval per item (publish or send). Name the hypothesis and the metric (leads and sales from utm_source of this channel) under "experiments".`, 'Attract'),
  (res, c, i) => (LEAN ? { code: `C${i + 1}`, verdict: 'batched' } : gated(`C${i + 1}`, LEAD[c.id], `outbox/free/${c.id}/`, `${c.label}: platform and community rules, disclosure that the product is ours, consent for any message, claims, tracked link present, no spend`, 'Review')),
)
// Lean (economy mode): one compliance review over every channel's drafts instead of one per channel.
if (LEAN && channels.length) results.push(await gated('CH', 'om-mega-growth-free', channels.map((c) => `outbox/free/${c.id}/`).join(', '), 'each channel: platform and community rules, disclosure that the product is ours, consent for any message, claims, tracked link present, no spend', 'Review'))
phase('Review')
const verdicts = [...(leakReview ? [{ code: 'LEAK', verdict: leakReview.verdict }] : []), ...results.filter(Boolean).map((r) => ({ code: r.code, verdict: r.verdict }))]
const out = await finish(`Free channels this week: ${channels.map((c) => c.id).join(', ') || 'none'}. Funnel before the run: ${m.leads} leads, ${m.won} customers, ${m.uncontacted_over_sla} waiting for a reply. Ask the owner to approve the replies to waiting leads first, then post the channel drafts with their tracked links.`)
await agent(`Run \`node tools/funnel.mjs ${slug}\` from the project root and return its stdout.`, { label: 'funnel after', phase: 'Report', effort: 'low', model: 'haiku' })
return { slug, workflow: NAME, channels: channels.map((c) => c.id), leaks_fixed: fixes.length, verdicts, report: out.report }
