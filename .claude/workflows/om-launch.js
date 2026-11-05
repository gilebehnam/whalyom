export const meta = {
  name: 'om-launch',
  description: 'Launch campaign from T-14 to T+7 across Product Hunt, Hacker News, Reddit, newsletters and launch sites: readiness, assets with adversarial review, launch-day runbook and follow-up. Drafts and approvals only',
  whenToUse: 'A product is about to launch or relaunch. args: {slug, now, launchDate?, platforms?: ["producthunt","hn","reddit","newsletters","launch-platforms","x","linkedin"]}',
  phases: [
    { title: 'Context', detail: 'product.json, budget mode and caps' },
    { title: 'Readiness', detail: 'T-14: timeline, communities and rules, risks, tracking, red-team readiness gate' },
    { title: 'Assets', detail: 'T-7: tagline, visuals, then one draft per platform, each reviewed by editor, compliance and red team' },
    { title: 'Launch day', detail: 'T0: hour-by-hour runbook, launch email to the consented list, scheduled approvals' },
    { title: 'Follow-up', detail: 'T+1 to T+7: thank-yous, results post, review asks, experiments' },
    { title: 'Report', detail: 'apply results, merge review verdicts, report' },
  ],
}

const NAME = 'om-launch'
const slug = args?.slug
if (!slug) throw new Error(`${NAME} needs args.slug`)
const now = args?.now ?? 'unknown-time'
const day = String(now).slice(0, 10)
const ws = `products/${slug}/`
const PFX = `LCH-${day}`
const launchDate = args?.launchDate ?? 'the date in plan.md, or 14 days after the current time if none is set'

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

const PLATFORM = {
  producthunt: ['om-producthunt', 'Product Hunt listing in outbox/launch/producthunt.md: tagline, description, gallery order, maker comment, first comment replies, and a note to people who already know the product (never ask for upvotes)'],
  hn: ['om-hn-indiehackers', 'Show HN post and an Indie Hackers milestone post in outbox/launch/hn.md, written to each site norms (plain, technical, no marketing voice)'],
  reddit: ['om-reddit', 'one post per subreddit that allows launches in outbox/launch/reddit.md, checked against each subreddit rule in research/launch/communities.md; skip subreddits that ban self-promotion'],
  newsletters: ['om-pr-outreach', 'short personal pitches to newsletters and journalists that cover the category, in outbox/launch/newsletters.md, one per outlet with why it fits that outlet'],
  'launch-platforms': ['om-launch-platforms', 'submissions for BetaList, Uneed, Peerlist, Microlaunch and similar sites in outbox/launch/launch-platforms.md'],
  x: ['om-x', 'launch thread and a reply plan in outbox/launch/x.md'],
  linkedin: ['om-linkedin', 'founder launch post and company post in outbox/launch/linkedin.md'],
}
const asked = args?.platforms ?? ['producthunt', 'hn', 'reddit', 'newsletters', 'launch-platforms']
const platforms = asked.filter((p) => PLATFORM[p])
const unknown = asked.filter((p) => !PLATFORM[p])
if (unknown.length) log(`Skipping unknown platforms: ${unknown.join(', ')} (known: ${Object.keys(PLATFORM).join(', ')})`)
log(`Launch on ${launchDate} across ${platforms.join(', ')}`)

// ── Readiness (T-14) ────────────────────────────────────────────────────────
phase('Readiness')
await parallel([
  () => task('R1', 'om-producthunt', `Write research/launch/plan.md: the day-by-day plan from T-14 to T+7 for a launch on ${launchDate} on ${platforms.join(', ')}, with the owner's actions per day and the launch goal (one primary metric).`, 'Readiness'),
  () => task('R2', 'om-community-scout', `Write research/launch/communities.md: for each of ${platforms.join(', ')} and the ICP's communities, the self-promotion rules, best posting time and what a good launch post looks like there.`, 'Readiness'),
  () => task('R3', 'om-risk-officer', 'Write research/launch/risks.md: launch risks (bans for self-promotion, vote-ring flags, site load, support volume, negative threads) with the guardrail for each.', 'Readiness'),
  () => task('R4', 'om-tracking-engineer', `Write research/launch/tracking.md: UTM per platform (${platforms.join(', ')}), signup and activation events to check before launch, and how to read launch results.`, 'Readiness'),
])
const READY = { type: 'object', properties: { ready: { type: 'boolean' }, gaps: { type: 'array', items: { type: 'string' } } }, required: ['ready', 'gaps'] }
const readiness = await omAgent('om-red-team', `Product workspace: ${ws}. Read research/launch/*.md, profile.md and claims.md. Is this product ready to launch on ${launchDate}? Try to prove it is NOT: missing proof, unclear promise, broken signup or tracking, no audience. Write reports/review-${PFX}-READY-om-red-team.md. Return ready and the gaps.`,
  { label: 'red-team readiness', phase: 'Readiness', schema: READY })
if (!readiness.ready) log(`Readiness gaps: ${readiness.gaps.join('; ').slice(0, 400)}`)

// ── Assets (T-7) ────────────────────────────────────────────────────────────
phase('Assets')
// Barrier: every platform draft reuses the tagline and visual briefs.
await parallel([
  () => task('A1', 'om-headline-lab', 'Write outbox/launch/taglines.md: 10 tagline variants under 60 characters, scored, with the top 3 marked.', 'Assets'),
  () => task('A2', 'om-image-briefer', 'Write outbox/launch/visual-briefs.md: gallery images, thumbnail and OG image briefs for the launch.', 'Assets'),
  () => task('A3', 'om-video-producer', 'Write outbox/launch/demo-storyboard.md: a 60-second demo video storyboard with shot list and voiceover.', 'Assets'),
])
const assetReviews = await pipeline(
  platforms,
  (p, _item, i) => task(`P${i + 1}`, PLATFORM[p][0], `Draft the ${p} launch assets: ${PLATFORM[p][1]}. Use the top tagline from outbox/launch/taglines.md and the rules in research/launch/communities.md. Add one approval per post or pitch (type "publish" or "send") with its file.`, 'Assets'),
  (res, p, i) => gated(`P${i + 1}`, PLATFORM[p][0], `outbox/launch/${p}.md`, `${p} launch copy: platform norms, claims, tone`, 'Assets'),
)

// ── Launch day (T0) ─────────────────────────────────────────────────────────
phase('Launch day')
await parallel([
  () => task('L1', 'om-scheduler', `Write outbox/launch/runbook.md: an hour-by-hour launch-day runbook for ${launchDate} (time zone of the main market) covering ${platforms.join(', ')}: what goes out when, who replies to comments, and when to check metrics. Each post stays an approval; schedule nothing yourself.`, 'Launch day'),
  () => task('L2', 'om-email-nurture', 'Write outbox/launch/email.md: one launch email to the existing consented list only (no bought or scraped addresses), with unsubscribe and sender address, and an approval of type "send".', 'Launch day'),
])
const emailReview = await gated('L2', 'om-email-nurture', 'outbox/launch/email.md', 'CAN-SPAM/GDPR consent, claims, subject line', 'Launch day')

// ── Follow-up (T+1..T+7) ────────────────────────────────────────────────────
phase('Follow-up')
await parallel([
  () => task('F1', 'om-producthunt', 'Write outbox/launch/follow-up.md: T+1 thank-you posts, a T+7 results post template (filled in only with real numbers later) and replies for common launch questions.', 'Follow-up'),
  () => task('F2', 'om-advocacy', 'Write outbox/launch/review-asks.md: how to ask real users who engaged during the launch for a review or testimonial, with consent wording. No incentives that break review-site rules.', 'Follow-up'),
  () => task('F3', 'om-experiment-manager', `Define the launch experiments in your run file: per platform (${platforms.join(', ')}) one hypothesis, one primary metric (signups from that UTM), a minimum sample and a stop date of T+7.`, 'Follow-up'),
])

const out = await finish(readiness.ready ? '' : `Readiness gaps the owner should close before launch: ${readiness.gaps.join('; ')}.`)
return { slug, workflow: NAME, launchDate, platforms, ready: readiness.ready, gaps: readiness.gaps, reviews: [...assetReviews.filter(Boolean), emailReview].map((r) => ({ code: r.code, verdict: r.verdict })), report: out.report }
