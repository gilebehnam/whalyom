export const meta = {
  name: 'om-paid-portfolio',
  description: 'Paid portfolio for budgets above the micro threshold: account and tracking audit, score-weighted split with 10-20% exploration, per-channel campaigns with creatives and landing match, CPA kill rules, retargeting, adversarial review. Total spend is clamped to the caps and stays an approval',
  whenToUse: 'A product in paid or hybrid mode with more than about 100 a month. args: {slug, now, channels?: ["google","meta",...] to limit the split}',
  phases: [
    { title: 'Context', detail: 'product.json, budget mode and caps' },
    { title: 'Gate', detail: 'free mode and micro budgets stop here' },
    { title: 'Audit', detail: 'ad accounts, tracking readiness, attribution by channel' },
    { title: 'Allocate', detail: 'split across channels, verified against the remaining budget' },
    { title: 'Build', detail: 'per channel: campaign spec, creatives, ad-to-page match' },
    { title: 'Guard', detail: 'CPA kill rules, killswitch dry run, retargeting inside the same budget' },
    { title: 'Review', detail: 'editor, compliance and red team per channel' },
    { title: 'Report', detail: 'apply results, merge review verdicts, report' },
  ],
}

const NAME = 'om-paid-portfolio'
const slug = args?.slug
if (!slug) throw new Error(`${NAME} needs args.slug`)
const now = args?.now ?? 'unknown-time'
const day = String(now).slice(0, 10)
const ws = `products/${slug}/`
const PFX = `PPF-${day}`

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

const ADS = {
  google: 'om-google-ads', meta: 'om-meta-ads', microsoft: 'om-microsoft-ads', reddit: 'om-reddit-ads', tiktok: 'om-tiktok-ads',
  linkedin: 'om-linkedin-ads', x: 'om-x-ads', youtube: 'om-youtube-ads', apple: 'om-apple-search-ads',
}

// ── Gate ────────────────────────────────────────────────────────────────────
phase('Gate')
if (ctx.mode === 'free' || !(ctx.monthly_cap > 0)) {
  log(`${slug} is in ${ctx.mode} mode with monthly cap ${ctx.monthly_cap}: no paid spend`)
  return { slug, workflow: NAME, skipped: 'free mode or no cap' }
}
const BUD = {
  type: 'object',
  properties: { sniper: { type: 'boolean' }, remaining: { type: 'number' }, output: { type: 'string' } },
  required: ['sniper', 'remaining', 'output'],
}
const bud = await agent(`Run \`node tools/budget.mjs ${slug}\` from the project root. Return whether it chose sniper mode, the budget remaining this month, and its output (the proposed split is in ${ws}budget-plan.json).`,
  { label: 'budget.mjs', phase: 'Gate', schema: BUD, effort: 'low', model: 'haiku' })
if (bud.sniper) {
  log(`Monthly cap ${ctx.monthly_cap} ${ctx.currency} is a micro budget; run om-paid-sniper instead`)
  return { slug, workflow: NAME, skipped: 'micro budget', next: 'om-paid-sniper' }
}
const available = Math.max(0, Math.min(bud.remaining, ctx.monthly_cap - ctx.spent_this_month))
if (available <= 0) { log('Monthly cap reached'); return { slug, workflow: NAME, skipped: 'cap reached' } }

// ── Audit ───────────────────────────────────────────────────────────────────
phase('Audit')
const TRACK = { type: 'object', properties: { ready: { type: 'boolean' }, gaps: { type: 'array', items: { type: 'string' } } }, required: ['ready', 'gaps'] }
const [tracking] = await parallel([
  () => task('T1', 'om-tracking-engineer', `Verify that conversion tracking is ready for paid traffic (pixels or tags, conversion events, UTM convention, revenue event) from research/tracking.md and the live site when there is one. Write reports/tracking-${PFX}.md. If it is not ready, also write reports/review-${PFX}-TRACK-om-tracking-engineer.md with verdict "block" for every spend approval of this run, since spend without measurement cannot be judged. Return ready and the gaps.`, 'Audit', { schema: TRACK }),
  () => task('T2', 'om-ad-account-auditor', 'Audit the connected or exported ad accounts (metrics/, accounts in product.json) for wasted spend, broken tracking and policy risk. Write reports/ad-audit-' + day + '.md; say so plainly when no account data exists.', 'Audit'),
  () => task('T3', 'om-attribution', 'Write reports/attribution-' + day + '.md: revenue and conversions credited by channel from tracked journeys, and the ROI per channel where there is data.', 'Audit'),
])
const track = tracking ?? { ready: false, gaps: ['tracking check did not return'] }
if (!track.ready) log(`Tracking not ready (${track.gaps.slice(0, 3).join('; ')}): spend approvals will be blocked`)

// ── Allocate ────────────────────────────────────────────────────────────────
phase('Allocate')
const ALLOC = {
  type: 'object',
  properties: { channels: { type: 'array', items: { type: 'object', properties: {
    channel: { type: 'string', enum: Object.keys(ADS) }, monthly: { type: 'number' }, role: { type: 'string', enum: ['core', 'explore'] }, reason: { type: 'string' },
  }, required: ['channel', 'monthly', 'role', 'reason'] } } },
  required: ['channels'],
}
const limitTo = (args?.channels ?? []).filter((c) => ADS[c])
const alloc = await task('AL', 'om-budget-allocator', `Split ${available} ${ctx.currency} (remaining this month; daily cap ${ctx.daily_cap}) across at most 4 channels${limitTo.length ? ` among ${limitTo.join(', ')}` : ''}, using budget-plan.json, reports/attribution-${day}.md and LEARNINGS.md: core channels by CAC and ROAS, 10-20% for exploration. Write reports/allocation-${day}.md. Never exceed the remaining budget and never raise a cap.`, 'Allocate', { schema: ALLOC })
let split = (alloc?.channels ?? []).filter((c) => ADS[c.channel] && c.monthly > 0 && (!limitTo.length || limitTo.includes(c.channel)))
const seen = new Set()
split = split.filter((c) => !seen.has(c.channel) && seen.add(c.channel)).slice(0, 4)
const total = split.reduce((s, c) => s + c.monthly, 0)
if (total > available) {
  const k = available / total
  log(`Allocation ${total} is over the ${available} ${ctx.currency} available; scaling every channel by ${k.toFixed(2)}`)
  split = split.map((c) => ({ ...c, monthly: Math.floor(c.monthly * k * 100) / 100 }))
}
const dailyCap = ctx.daily_cap > 0 ? ctx.daily_cap : available / 30
const dailyTotal = split.reduce((s, c) => s + c.monthly / 30, 0)
const dailyScale = dailyTotal > dailyCap ? dailyCap / dailyTotal : 1
if (dailyScale < 1) log(`Daily total ${dailyTotal.toFixed(2)} is over the daily cap ${dailyCap}; scaling daily budgets by ${dailyScale.toFixed(2)}`)
const exploreShare = total > 0 ? split.filter((c) => c.role === 'explore').reduce((s, c) => s + c.monthly, 0) / Math.max(1, Math.min(total, available)) : 0
if (exploreShare < 0.1 || exploreShare > 0.2) log(`Exploration share is ${(exploreShare * 100).toFixed(0)}% (target 10-20%)`)
log(`Split: ${split.map((c) => `${c.channel} ${c.monthly}`).join(', ') || 'none'}`)

// ── Build ───────────────────────────────────────────────────────────────────
phase('Build')
const MATCH = { type: 'object', properties: { match: { type: 'boolean' }, mismatches: { type: 'array', items: { type: 'string' } } }, required: ['match', 'mismatches'] }
const built = await pipeline(
  split,
  (c, _c, i) => task(`B${i + 1}`, 'om-ad-creative', `Write outbox/ads/${c.channel}-${day}-variants.md: 3-6 ${c.channel} ad variants (one angle each, within ${c.channel} specs and ad policy) for the ${c.role} budget of ${c.monthly} ${ctx.currency}, plus image or video briefs.`, 'Build'),
  (res, c, i) => task(`B${i + 1}-C`, ADS[c.channel], `Write outbox/ads/${c.channel}-${day}.md: the ${c.channel} campaign spec using outbox/ads/${c.channel}-${day}-variants.md, monthly ${c.monthly} ${ctx.currency}, daily ${(Math.floor((c.monthly / 30) * dailyScale * 100) / 100)} ${ctx.currency}, targeting and negatives, conversion tracking per research/tracking.md. Add exactly one approval of type "spend" with "amount": ${c.monthly} and the file. Do not launch anything.`, 'Build'),
  (res, c, i) => task(`B${i + 1}-M`, 'om-landing-matcher', `Check each variant in outbox/ads/${c.channel}-${day}-variants.md against its landing page (promise, keyword, offer, CTA). Write reports/landing-match-${PFX}-${c.channel}.md. If they do not match, list the page changes for om-landing-builder as new_tasks.`, 'Build', { schema: MATCH, effort: 'low' }),
  (m, c, i) => gated(`B${i + 1}`, 'om-ad-creative', `outbox/ads/${c.channel}-${day}*.md`, `${c.channel} ad policy, claims, ad-to-page match${m && !m.match ? ` (mismatches: ${m.mismatches.join('; ').slice(0, 300)})` : ''}, spend ${c.monthly} within the cap`, 'Review')
    .then((rv) => ({ channel: c.channel, monthly: c.monthly, match: m?.match ?? false, verdict: rv.verdict })),
)

// ── Guard ───────────────────────────────────────────────────────────────────
phase('Guard')
await parallel([
  () => task('G1', 'om-cpa-guard', `Write reports/kill-rules-${PFX}.md for ${split.map((c) => c.channel).join(', ')}: per-variant kill after budget.variant_kill_spend without a conversion, campaign pause when CPA passes goals.cpa_max after 3x that spend, and the replacement-creative trigger. Name one experiment per channel (hypothesis, metric CPA or ROAS, minimum spend, stop date).`, 'Guard', { effort: 'low' }),
  () => task('G2', 'om-retargeting', `Write outbox/ads/retargeting-${day}.md: retargeting audiences and a frequency-capped sequence on the channels in this split, paid out of their existing allocations (no extra spend approval).`, 'Guard', { effort: 'low' }),
])
const kill = await agent(`Run \`node tools/killswitch.mjs ${slug} --dry-run\` from the project root and return its output.`, { label: 'killswitch dry run', phase: 'Guard', effort: 'low', model: 'haiku' })

// Reviews ran per channel inside the Build pipeline (phase Review).
phase('Review')
const reviewed = built.filter(Boolean)
const blocked = reviewed.filter((b) => b.verdict === 'block').map((b) => b.channel)
if (blocked.length) log(`Blocked channels: ${blocked.join(', ')}`)

const out = await finish(`Split of ${available} ${ctx.currency}: ${reviewed.map((b) => `${b.channel} ${b.monthly} (${b.verdict})`).join(', ')}.${track.ready ? '' : ` Tracking is not ready, so spend approvals are blocked: ${track.gaps.join('; ')}.`}`)
return { slug, workflow: NAME, available, split: reviewed, trackingReady: track.ready, killswitch: kill, report: out.report }
