export const meta = {
  name: 'om-paid-sniper',
  description: 'Micro-budget paid sniper (monthly cap at or under the micro threshold, about 100): one channel, tight targeting, a few creatives, ad-to-page match, per-variant kill rules and a reinvestment plan. Spend is clamped to the caps and stays an approval',
  whenToUse: 'A product in paid or hybrid mode with a small budget. args: {slug, now, channel?: "google|meta|reddit|microsoft|tiktok|linkedin|x|youtube|apple"}',
  phases: [
    { title: 'Context', detail: 'product.json, budget mode and caps' },
    { title: 'Gate', detail: 'free mode or a large budget stop here; budget.mjs decides sniper mode' },
    { title: 'Channel', detail: 'the single highest-intent channel, daily budget clamped to the caps' },
    { title: 'Creatives', detail: 'hooks and 3-5 ad variants, campaign spec with one spend approval' },
    { title: 'Landing', detail: 'ad-to-page promise match; a matching page variant when it fails' },
    { title: 'Kill rules', detail: 'per-variant spend-without-conversion kill and CPA limit, killswitch dry run' },
    { title: 'Review', detail: 'editor, compliance and red team over ads and page' },
    { title: 'Reallocation', detail: 'how results move money; caps never raised' },
    { title: 'Report', detail: 'apply results, merge review verdicts, report' },
  ],
}

const NAME = 'om-paid-sniper'
const slug = args?.slug
if (!slug) throw new Error(`${NAME} needs args.slug`)
const now = args?.now ?? 'unknown-time'
const day = String(now).slice(0, 10)
const ws = `products/${slug}/`
const PFX = `SNP-${day}`

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
// Every review round, in order; finish() hands the final verdict per code to the approval merge.
const REVIEWS = []
const review = async (code, files, focus, phaseName, who) => {
  // args.reviewers (set by the operating mode, tools/ai-modes.mjs): 1 = compliance only, 2 = + editor, 3 = + red team.
  const panel = who ?? ({ 1: ['om-compliance-guard'], 2: ['om-editor', 'om-compliance-guard'] }[Number(args?.reviewers)] ?? ['om-editor', 'om-compliance-guard', 'om-red-team'])
  const raw = await parallel(panel.map((r) => () => omAgent(r,
    `Product workspace: ${ws}. Adversarial review ${PFX}-${code}: assume there are problems and look for them. Files: ${files}. Focus: ${focus}. ${LENS[r] ?? 'Report only; do not edit the drafts.'} Verdict "block" for any claim not in claims.md, any platform-rule or consent breach, or spend above the caps; "fix" when you corrected something or small changes are needed; otherwise "pass". Write ${ws}reports/review-${PFX}-${code}-${r}.md. Do not edit approvals.json.`,
    { label: `${r} ${code}`, phase: phaseName, schema: VERDICT })))
  // Fail closed: a reviewer that died or was skipped returns null, and no verdict is a block, never a pass.
  const missing = panel.filter((r, i) => !raw[i])
  const votes = raw.filter(Boolean)
  const verdict = missing.length > 0 || votes.length === 0 ? 'block'
    : votes.some((v) => v.verdict === 'block') ? 'block' : votes.some((v) => v.verdict === 'fix') ? 'fix' : 'pass'
  const issues = [...missing.map((r) => `${r} returned no verdict`), ...votes.flatMap((v) => v.issues ?? [])]
  const m = /^(.*)-R(\d+)$/.exec(code)
  REVIEWS.push({ code: m ? m[1] : code, round: m ? Number(m[2]) : 1, files, verdict, issues })
  return { verdict, issues }
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

// forceBlock: in-script blocking decisions (text naming the approvals) that the merge must apply on top of the verdicts.
const finish = async (extra, forceBlock) => {
  phase('Report')
  const applied = await agent(`Run \`node tools/apply-results.mjs ${slug} --now ${now}\` from the project root and return its stdout.`, { label: 'apply results', phase: 'Report', effort: 'low', model: 'haiku' })
  // The last round per code wins (a passing -R2 supersedes the blocked round 1).
  const last = new Map()
  for (const r of REVIEWS) if (!last.has(r.code) || r.round >= last.get(r.code).round) last.set(r.code, r)
  const final = [...last.values()].map((r) => ({ ...r, issues: r.issues.slice(0, 8).map((i) => String(i).slice(0, 240)) }))
  // Compliance verdicts reach approvals.json only through apply-results.mjs, from a reviewer run file.
  await omAgent('om-compliance-guard', `In ${ws}: for each approval in approvals.json whose task_id starts with "${PFX}" and whose status is "pending", set its compliance from the final review verdicts this run computed. Use ONLY these final verdicts, not the reports/review-${PFX}-*.md files (a later round such as -R2 supersedes the earlier one, and the list already holds the final round per code): match the approval's file against each code's files; an approval whose file matches no listed code is "block".${forceBlock ? ` Forced block, whatever the verdicts say: ${forceBlock}.` : ''}
Final verdicts (JSON): ${JSON.stringify(final)}
Write ${ws}runs/REVIEW-${PFX}.json as {"agent": "om-compliance-guard", "reviews": [{"approval_id": "<id>", "compliance": "pass|fix|block", "notes": "<why, citing the code and round>"}]}. Do not edit approvals.json: apply-results sets "compliance" from this file. Return how many approvals you reviewed.`,
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
  log(`${slug} is in ${ctx.mode} mode with monthly cap ${ctx.monthly_cap}: no paid spend. Use /whalyom inject-budget first (owner only).`)
  return { slug, workflow: NAME, skipped: 'free mode or no cap' }
}
const BUD = {
  type: 'object',
  properties: { sniper: { type: 'boolean' }, channel: { type: 'string' }, remaining: { type: 'number' }, output: { type: 'string' } },
  required: ['sniper', 'channel', 'remaining', 'output'],
}
const bud = await agent(`Run \`node tools/budget.mjs ${slug}\` from the project root. Return whether it chose sniper mode (whole budget on one channel), the channel it chose ("" if none), the budget remaining this month, and its output.`,
  { label: 'budget.mjs', phase: 'Gate', schema: BUD, effort: 'low', model: 'haiku' })
if (!bud.sniper) {
  log(`Monthly cap ${ctx.monthly_cap} ${ctx.currency} is above the micro threshold; run om-paid-portfolio instead`)
  return { slug, workflow: NAME, skipped: 'not a micro budget', next: 'om-paid-portfolio' }
}
const remaining = Math.max(0, Math.min(bud.remaining, ctx.monthly_cap - ctx.spent_this_month))
if (remaining <= 0) {
  log(`No budget left this month (${ctx.spent_this_month}/${ctx.monthly_cap} ${ctx.currency})`)
  return { slug, workflow: NAME, skipped: 'cap reached' }
}

// ── Channel ─────────────────────────────────────────────────────────────────
phase('Channel')
const PICK = {
  type: 'object',
  properties: {
    channel: { type: 'string', enum: Object.keys(ADS) }, reason: { type: 'string' }, targeting: { type: 'string' },
    daily_budget: { type: 'number' }, kill_spend: { type: 'number' }, cpa_max: { type: 'number' },
  },
  required: ['channel', 'reason', 'targeting', 'daily_budget', 'kill_spend', 'cpa_max'],
}
const forced = args?.channel && ADS[args.channel] ? args.channel : null
const pick = await task('CH', 'om-microbudget-sniper', `Budget left this month: ${remaining} ${ctx.currency}; daily cap ${ctx.daily_cap}. ${forced ? `The owner chose ${forced}.` : `budget.mjs suggests "${bud.channel}"; pick the single highest-intent channel among ${Object.keys(ADS).join(', ')} that is enabled or plausible for this product.`} Never spread the budget. Write reports/sniper-${day}.md: channel, tightest targeting, daily budget, per-variant kill spend, CPA limit, and how profit gets reinvested. Return the pick.`,
  'Channel', { schema: PICK })
const channel = forced ?? pick.channel
const daily = Math.max(0, Math.min(pick.daily_budget, ctx.daily_cap > 0 ? ctx.daily_cap : pick.daily_budget, remaining))
if (daily < pick.daily_budget) log(`Daily budget clamped from ${pick.daily_budget} to ${daily} ${ctx.currency} (caps)`)
const monthSpend = Math.min(remaining, daily * 30)
const adsAgent = ADS[channel]
log(`Sniper: ${channel} at ${daily}/day, at most ${monthSpend} ${ctx.currency} this month, kill at ${pick.kill_spend} without conversion`)

// ── Creatives ───────────────────────────────────────────────────────────────
phase('Creatives')
await task('CR1', 'om-hook-writer', `Write outbox/ads/${channel}-sniper-hooks.md: 10 hooks for ${channel} aimed at "${pick.targeting}", scored, top 5 marked.`, 'Creatives', { effort: 'low' })
await task('CR2', 'om-ad-creative', `Write outbox/ads/${channel}-sniper-variants.md: 3-5 ${channel} ad variants from the top hooks, one angle each, within ${channel} specs and ad policy, plus image or video briefs.`, 'Creatives')
await task('CR3', adsAgent, `Write outbox/ads/${channel}-sniper.md: the campaign spec for ${channel} using the variants in outbox/ads/${channel}-sniper-variants.md, targeting "${pick.targeting}", daily budget ${daily} ${ctx.currency}, one ad set, conversion tracking per research/tracking.md. Add exactly one approval of type "spend" with "amount": ${monthSpend} and the file. Do not launch anything.`, 'Creatives')

// ── Landing ─────────────────────────────────────────────────────────────────
phase('Landing')
const MATCH = { type: 'object', properties: { match: { type: 'boolean' }, page: { type: 'string' }, mismatches: { type: 'array', items: { type: 'string' } } }, required: ['match', 'page', 'mismatches'] }
const match = await task('LM', 'om-landing-matcher', `Check every variant in outbox/ads/${channel}-sniper-variants.md against the landing page it sends to: same promise, keyword, offer and CTA. Write reports/landing-match-${PFX}.md and return whether all match.`, 'Landing', { schema: MATCH })
if (!match.match) {
  await task('LB', 'om-landing-builder', `The ads and the landing page do not match: ${match.mismatches.join('; ').slice(0, 800)}. Write outbox/site/landing-${channel}-sniper.html: a page variant whose headline and offer match the ads exactly, with the tracking from research/tracking.md. Add one "publish" approval.`, 'Landing')
}

// ── Kill rules ──────────────────────────────────────────────────────────────
phase('Kill rules')
await task('KR', 'om-cpa-guard', `Write reports/kill-rules-${PFX}.md for the ${channel} sniper campaign: pause any variant that spends ${pick.kill_spend} ${ctx.currency} without a conversion, pause the campaign when CPA passes ${pick.cpa_max} after 3x that spend, and the replacement-creative trigger. Name the experiment per variant (hypothesis, metric = CPA, minimum spend, stop date).`, 'Kill rules', { effort: 'low' })
const kill = await agent(`Run \`node tools/killswitch.mjs ${slug} --dry-run\` from the project root and return its output.`, { label: 'killswitch dry run', phase: 'Kill rules', effort: 'low', model: 'haiku' })

// ── Review ──────────────────────────────────────────────────────────────────
phase('Review')
const rv = await gated('ADS', 'om-ad-creative', `outbox/ads/${channel}-sniper*.md${match.match ? '' : `, outbox/site/landing-${channel}-sniper.html`}`, `${channel} ad policy, claims, ad-to-page match, spend within ${monthSpend} ${ctx.currency}`, 'Review')

// ── Reallocation ────────────────────────────────────────────────────────────
phase('Reallocation')
await task('RA', 'om-budget-allocator', `Write reports/sniper-reallocation-${day}.md: after the first ${pick.kill_spend * 3} ${ctx.currency} of spend, how money moves (kill losers, double down on the winning variant inside the same cap, reinvest profit next month). Propose; never raise monthly_cap (${ctx.monthly_cap}) or daily_cap (${ctx.daily_cap}).`, 'Reallocation', { effort: 'low' })

const out = await finish(`Sniper channel ${channel}, ${daily}/day, proposed spend ${monthSpend} ${ctx.currency} of ${remaining} left. Review: ${rv.verdict}.`)
return { slug, workflow: NAME, channel, daily, monthSpend, landingMatch: match.match, review: rv.verdict, killswitch: kill, report: out.report }
