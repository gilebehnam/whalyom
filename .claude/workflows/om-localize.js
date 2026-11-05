export const meta = {
  name: 'om-localize',
  description: 'Market entry and localization: pick the next markets (or use the given ones), URL and hreflang structure, then per market local keywords, translation, cultural adaptation and native-level review including local law, followed by local communities and campaign drafts inside the existing caps',
  whenToUse: 'Enter a new country or language. args: {slug, now, markets?: [{code:"de", language:"German", currency:"EUR"}] or ["de","fr"], max?: 2 (max 4)}',
  phases: [
    { title: 'Context', detail: 'product.json, budget mode and caps' },
    { title: 'Markets', detail: 'next markets by demand, competition and cost' },
    { title: 'Structure', detail: 'international URL structure and hreflang' },
    { title: 'Localize', detail: 'per market: keywords, translation, adaptation, editor/compliance/red-team review' },
    { title: 'Campaigns', detail: 'per market: local communities, campaign drafts, compliance check' },
    { title: 'Report', detail: 'apply results, merge review verdicts, report' },
  ],
}

const NAME = 'om-localize'
const slug = args?.slug
if (!slug) throw new Error(`${NAME} needs args.slug`)
const now = args?.now ?? 'unknown-time'
const day = String(now).slice(0, 10)
const ws = `products/${slug}/`
const PFX = `LOC-${day}`
const MAX = Math.max(1, Math.min(Number(args?.max ?? 2), 4))

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

const code = (s) => String(s || '').toLowerCase().replace(/[^a-z-]+/g, '').slice(0, 10)

// ── Markets ─────────────────────────────────────────────────────────────────
phase('Markets')
const MKT = {
  type: 'object',
  properties: { markets: { type: 'array', items: { type: 'object', properties: {
    code: { type: 'string' }, language: { type: 'string' }, currency: { type: 'string' }, reason: { type: 'string' },
  }, required: ['code', 'language', 'currency', 'reason'] } } },
  required: ['markets'],
}
let markets
if (Array.isArray(args?.markets) && args.markets.length) {
  markets = args.markets.map((m) => (typeof m === 'string' ? { code: m, language: '', currency: '', reason: 'chosen by the owner' } : m))
  await task('MK', 'om-market-entry', `The owner chose these markets: ${markets.map((m) => m.code).join(', ')}. Write research/localize/markets.md: per market the language, currency, demand, competition, cost to enter, legal notes (consent, consumer law, language requirements) and the risks.`, 'Markets')
} else {
  const picked = await task('MK', 'om-market-entry', `Pick up to ${MAX} next markets by demand, competition and cost to enter (product.json market lists where the product sells today). Write research/localize/markets.md with the evidence and legal notes per market. Return code (ISO language-region or country code), language, currency and reason.`, 'Markets', { schema: MKT })
  markets = picked?.markets ?? []
}
markets = markets.map((m) => ({ ...m, code: code(m.code) })).filter((m) => m.code).slice(0, MAX)
log(`Markets: ${markets.map((m) => m.code).join(', ') || 'none'}`)
if (!markets.length) {
  const out = await finish('No market was selected.')
  return { slug, workflow: NAME, markets: [], report: out.report }
}

// ── Structure ───────────────────────────────────────────────────────────────
phase('Structure')
await task('ST', 'om-hreflang', `Write research/localize/structure.md for ${markets.map((m) => m.code).join(', ')}: the URL structure (subfolders unless there is a reason not to), hreflang tags including x-default, canonical rules and the local sitemap entries.`, 'Structure', { effort: 'low' })

// ── Localize ────────────────────────────────────────────────────────────────
phase('Localize')
const localized = await pipeline(
  markets,
  (m, _m, i) => task(`K${i + 1}`, 'om-keyword-researcher', `Write research/localize/${m.code}/keywords.md: how buyers in ${m.code} search for this category in ${m.language || 'the local language'} (not a translation of the English keywords), with intent and difficulty.`, 'Localize', { effort: 'low' }),
  (res, m, i) => task(`TR${i + 1}`, 'om-translator', `Translate the key pages (home, pricing, the top landing page and the best article; see research/localize/structure.md) into ${m.language || m.code} under content/${m.code}/, keeping every fact and the voice, using the local keywords from research/localize/${m.code}/keywords.md.`, 'Localize'),
  (res, m, i) => task(`AD${i + 1}`, 'om-localizer', `Adapt content/${m.code}/ for ${m.code}: currency ${m.currency || 'local'}, examples, units, dates, tone, local proof, and legal text the market needs (consent, imprint, consumer rights). Add one "publish" approval per page.`, 'Localize'),
  (res, m, i) => gated(`LZ${i + 1}`, 'om-localizer', `content/${m.code}/`, `native-level ${m.language || m.code}: no literal translation, local law (GDPR or the local equivalent, consumer law, language rules), claims still exactly those in claims.md, would a local buyer trust it`, 'Localize')
    .then((rv) => ({ market: m.code, verdict: rv.verdict })),
)

// ── Campaigns ───────────────────────────────────────────────────────────────
phase('Campaigns')
const campaigns = await pipeline(
  markets,
  (m, _m, i) => task(`CO${i + 1}`, 'om-community-scout', `Write research/localize/${m.code}/communities.md: where buyers in ${m.code} talk (forums, groups, newsletters, local directories, podcasts) and each place's rules.`, 'Campaigns', { effort: 'low' }),
  (res, m, i) => task(`CA${i + 1}`, 'om-localizer', `Write outbox/localize/${m.code}/campaign.md: a 30-day entry campaign in ${m.language || m.code} for the communities in research/localize/${m.code}/communities.md plus local directories. ${ctx.mode === 'free' ? 'Free mode: organic only.' : `Any paid part is a "spend" approval taken from the existing caps (${ctx.monthly_cap} ${ctx.currency} a month in total); propose no new money.`} One approval per publish, send or spend item.`, 'Campaigns'),
  (res, m, i) => review(`CA${i + 1}`, `outbox/localize/${m.code}/campaign.md`, `community rules in ${m.code}, local consent law, spend inside the caps`, 'Campaigns', ['om-compliance-guard', 'om-red-team'])
    .then((rv) => ({ market: m.code, verdict: rv.verdict })),
)

const out = await finish(`Markets: ${markets.map((m) => m.code).join(', ')}. Pages: ${localized.filter(Boolean).map((l) => `${l.market} ${l.verdict}`).join(', ')}. Campaigns: ${campaigns.filter(Boolean).map((c) => `${c.market} ${c.verdict}`).join(', ')}.`)
return { slug, workflow: NAME, markets: markets.map((m) => m.code), pages: localized.filter(Boolean), campaigns: campaigns.filter(Boolean), report: out.report }
