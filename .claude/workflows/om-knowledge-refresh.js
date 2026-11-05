export const meta = {
  name: 'om-knowledge-refresh',
  description: 'Keeps Whalyom current: fetch the official and research feeds, scouts extract dated facts from each new item and from agents\' knowledge tips, a fact verifier tries to reject each one against its source, verified facts merge into knowledge/base.json, stale facts are re-checked, briefs and the generated knowledge skills rebuild, the skill smith turns new facts into agent rules that the red team must pass before tools/evolve.mjs ships them, and owners get alerts for changes that hit their products',
  whenToUse: 'Daily or weekly (scheduled), or after a big platform change. args: {now, maxItems?: 60, maxProposals?: 10, maxGrow?: 4 topics to deepen per run}',
  phases: [
    { title: 'Fetch', detail: 'feeds into knowledge/inbox.jsonl, batches by topic, agent tips' },
    { title: 'Extract', detail: 'scouts and watchers turn items into candidate facts' },
    { title: 'Verify', detail: 'fact verifier tries to reject every candidate against its source' },
    { title: 'Merge', detail: 'apply, re-check stale facts' },
    { title: 'Grow', detail: 'research the thinnest topics until each reaches its target, verify, then briefs and knowledge skills' },
    { title: 'Teach', detail: 'agent rules from new facts, red-team review, evolve apply, rebuild agents' },
    { title: 'Impact', detail: 'alerts for products whose channels a new fact changes' },
    { title: 'Report', detail: 'knowledge report and dashboard state' },
  ],
}

const NAME = 'om-knowledge-refresh'
const now = args?.now ?? 'unknown-time'
const day = String(now).slice(0, 10)
const PFX = `KR-${day}`
const MAX_ITEMS = Math.max(6, Math.min(Number(args?.maxItems ?? 60), 200))
const MAX_PROPOSALS = Math.max(1, Math.min(Number(args?.maxProposals ?? 10), 30))
const MAX_GROW = Math.max(0, Math.min(Number(args?.maxGrow ?? 4), 12))

const omAgent = async (agentType, prompt, opts) => {
  try {
    return await agent(prompt, { ...opts, agentType })
  } catch (e) {
    log(`${agentType} unavailable; using general-purpose with .claude/agents/${agentType}.md`)
    return agent(`Act as the agent defined in .claude/agents/${agentType}.md: read that file first and follow it exactly.\n\n${prompt}`,
      { ...opts, agentType: 'general-purpose', label: `${opts?.label ?? agentType}*` })
  }
}
const RULES = 'Knowledge rules: a fact must be stated on the source page you opened (WebFetch), with its date; official or research sources only (industry press may lead you to the primary source but is never the source); never invent dates, numbers or names; topics come from tools/knowledge/topics.mjs. Do not edit knowledge/base.json, the briefs or the generated skills: tools/knowledge.mjs writes those.'
const RUN_FORMAT = '{"run_id": "<id>", "agent": "<your agent name>", "created_at": "' + now + '", "processed": ["<inbox ids you handled, kept or not>"], "facts": [{"topic": "...", "statement": "specific, dated, actionable", "source_url": "https://...", "source_title": "...", "source_tier": "official|primary|research", "published": "YYYY-MM-DD", "confidence": "high|medium", "review_days": 30|90|180, "affects": ["roster agent names"], "tags": ["..."], "supersedes": "<optional K-id>"}]}'

// ── Fetch ───────────────────────────────────────────────────────────────────
phase('Fetch')
const FETCH = { type: 'object', properties: { new_items: { type: 'number' }, failed: { type: 'number' }, inbox_new: { type: 'number' } }, required: ['new_items', 'failed', 'inbox_new'] }
const fetched = await agent(`Run \`node tools/knowledge.mjs refresh --now ${now}\` from the project root. Then count the lines of knowledge/inbox.jsonl whose "status" is "new". Return new_items from the refresh output, failed = the number of sources with "ok": false, and inbox_new.`,
  { label: 'fetch feeds', phase: 'Fetch', schema: FETCH, effort: 'low', model: 'haiku' })
const BATCHES = { type: 'object', properties: { batches: { type: 'array', items: { type: 'object', properties: { topic: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } } }, required: ['topic', 'ids'] } }, tips: { type: 'number' } }, required: ['batches', 'tips'] }
const plan = await agent(`Read knowledge/inbox.jsonl. Take the items with "status": "new", newest first, at most ${MAX_ITEMS}; prefer tier "official" and "research" over "industry", and drop obvious non-marketing items (hiring news, earnings, events recaps) by leaving them out. Group them by their first topic into batches of at most 12 ids (several batches per topic is fine). Also look in products/*/runs/applied/*.json for "knowledge_tips" written since ${day} minus 7 days; write them as items to knowledge/tips-${day}.jsonl ({"id": "TIP-<n>", "statement", "source_url", "from": "<product/agent>"}) and add one batch with topic "tips" and their ids. Do not change any other file. Return the batches and the number of tips.`,
  { label: 'plan batches', phase: 'Fetch', schema: BATCHES, effort: 'low', model: 'haiku' })
const batches = (plan?.batches ?? []).filter((b) => b.ids?.length)
log(`${fetched?.new_items ?? 0} new feed item(s), ${batches.length} batch(es), ${plan?.tips ?? 0} agent tip(s)`)

// Each topic goes to the watcher that knows its sources best.
const WATCHER = {
  search: 'om-algorithm-watcher', 'social-organic': 'om-algorithm-watcher', 'paid-search': 'om-policy-watcher', 'paid-social': 'om-policy-watcher',
  'privacy-law': 'om-regulation-watcher', 'ai-regulation': 'om-regulation-watcher', research: 'om-research-reader',
  'management-canon': 'om-management-research-reader', consulting: 'om-management-research-reader',
  'ai-marketing-tools': 'om-tool-scout',
}

// ── Extract → Verify (per batch, no barrier) ───────────────────────────────
phase('Extract')
const CAND = { type: 'object', properties: { run_id: { type: 'string' }, facts: { type: 'number' } }, required: ['run_id', 'facts'] }
const VER = { type: 'object', properties: { keep: { type: 'number' }, fix: { type: 'number' }, reject: { type: 'number' } }, required: ['keep', 'fix', 'reject'] }
// apply() counts a keep or fix only when its statement_hash matches the fact it reviewed, and a
// retire only with its own {"retire": id, "verdict": "keep"} from the verifier.
const HASH_RULE = (runId) => `Before writing, run \`node tools/knowledge.mjs hashes knowledge/runs/${runId}.json\` and copy each fact's "statement_hash" into its verdict unchanged (a keep or fix without the matching hash is rejected). For each id under "retire" in that run, open the fact's source again and add {"retire": "<fact id>", "verdict": "keep|reject", "reason": "..."}: keep only when the source is gone or contradicted; a retire with no keep verdict is not applied.`
const extracted = await pipeline(
  batches,
  (b, _item, i) => omAgent(WATCHER[b.topic] ?? 'om-knowledge-scout', `Knowledge batch ${i + 1} (${b.topic}). Items: ${b.ids.join(', ')} — read them in ${b.topic === 'tips' ? `knowledge/tips-${day}.jsonl` : 'knowledge/inbox.jsonl'}. For each item open the page and decide whether it changes how marketing should be done now (a new rule, threshold, feature, deadline, deprecation, or a robust research finding). Before writing, read knowledge/base.json so you do not repeat a fact; when an item updates an existing fact, set "supersedes". Write knowledge/runs/${PFX}-${i + 1}.json in this format: ${RUN_FORMAT}. Put every handled inbox id in "processed" even when you kept no fact. ${RULES} Return the run id and the number of facts.`,
    { label: `extract ${b.topic} ${i + 1}`, phase: 'Extract', schema: CAND }),
  (c, b, i) => (c?.facts ? omAgent('om-fact-verifier', `Verify knowledge/runs/${c.run_id}.json. For every fact (by its index in "facts", starting at 0) open source_url and try to reject it: is the statement really stated there, with the same date, number and scope? Is the source official or research, not a secondary write-up? Is it still current (no newer page contradicts it)? Default to reject when unsure. Write knowledge/runs/${PFX}-V${i + 1}.json: {"run_id": "${PFX}-V${i + 1}", "agent": "om-fact-verifier", "verifies": "${c.run_id}", "verdicts": [{"index": 0, "statement_hash": "<from hashes>", "verdict": "keep|fix|reject", "statement": "<corrected statement when fix>", "confidence": "high|medium", "reason": "..."}]}. ${HASH_RULE(c.run_id)} Do not edit the run you verify. Return the counts.`,
    { label: `verify ${b.topic} ${i + 1}`, phase: 'Verify', schema: VER }) : agent(`Write knowledge/runs/${PFX}-V${i + 1}.json as {"run_id": "${PFX}-V${i + 1}", "agent": "om-fact-verifier", "verifies": "${c?.run_id ?? `${PFX}-${i + 1}`}", "verdicts": []} so the processed inbox ids are recorded. Return keep 0, fix 0, reject 0.`,
    { label: `verify ${b.topic} ${i + 1} (empty)`, phase: 'Verify', schema: VER, effort: 'low', model: 'haiku' }))
    .then((v) => ({ topic: b.topic, run: c?.run_id ?? null, facts: c?.facts ?? 0, ...(v ?? { keep: 0, fix: 0, reject: 0 }) })),
)

phase('Verify')
log(`Verifier: ${extracted.filter(Boolean).reduce((n, e) => n + e.keep + e.fix, 0)} kept or fixed, ${extracted.filter(Boolean).reduce((n, e) => n + e.reject, 0)} rejected`)

// ── Merge ───────────────────────────────────────────────────────────────────
phase('Merge')
const STATUS = { type: 'object', properties: { added: { type: 'number' }, rejected: { type: 'number' }, stale: { type: 'number' }, facts_active: { type: 'number' } }, required: ['added', 'rejected', 'stale', 'facts_active'] }
const merge = (label) => agent(`From the project root run \`node tools/knowledge.mjs apply --now ${now}\`, then \`node tools/knowledge.mjs check --mark --now ${now}\`. Return added and rejected (lengths of those lists in the apply output), stale (facts_stale) and facts_active from check.`,
  { label, phase: 'Merge', schema: STATUS, effort: 'low', model: 'haiku' })
// Each merge reports only what it added itself, so keep running totals: a later merge
// that adds nothing must not hide the facts verified earlier in this run from Teach and Impact.
const totals = { added: 0, rejected: 0 }
const remerge = async (label) => {
  const m = await merge(label)
  totals.added += m?.added ?? 0
  totals.rejected += m?.rejected ?? 0
  return { ...m, ...totals }
}
let merged = await remerge('apply + check')
if (merged.stale > 0) {
  const re = await omAgent('om-knowledge-curator', `${merged.stale} knowledge fact(s) are past their review date (node tools/knowledge.mjs check lists them). For each: open the source again. Still true → write a fresh copy of the fact (same statement unless it changed, "supersedes" the old id) into knowledge/runs/${PFX}-CUR.json; changed → the corrected fact with "supersedes"; gone or contradicted → list it under "retire": [{"id": "...", "reason": "..."}]. Use the run format ${RUN_FORMAT} plus "retire". Contradictions between two active facts go in your summary for the owner. ${RULES}`,
    { label: 'curate stale', phase: 'Merge', schema: CAND })
  if (re?.facts) await omAgent('om-fact-verifier', `Verify knowledge/runs/${PFX}-CUR.json the same way: open each source_url, default to reject when unsure, and write knowledge/runs/${PFX}-VCUR.json {"run_id": "${PFX}-VCUR", "agent": "om-fact-verifier", "verifies": "${PFX}-CUR", "verdicts": [{"index": 0, "statement_hash": "<from hashes>", "verdict": "keep|fix|reject", "reason": "..."}, {"retire": "<fact id>", "verdict": "keep|reject", "reason": "..."}]}. ${HASH_RULE(`${PFX}-CUR`)}`,
    { label: 'verify curation', phase: 'Merge', schema: VER })
  else await omAgent('om-fact-verifier', `If knowledge/runs/${PFX}-CUR.json exists and has only "retire" entries, verify each retirement: open the fact's source_url in knowledge/base.json and try to refute the retirement (default to reject when unsure). Write knowledge/runs/${PFX}-VCUR.json {"run_id": "${PFX}-VCUR", "agent": "om-fact-verifier", "verifies": "${PFX}-CUR", "verdicts": [{"retire": "<fact id>", "verdict": "keep|reject", "reason": "..."}]}. Otherwise do nothing.`, { label: 'verify retirements', phase: 'Merge', effort: 'low' })
  merged = await remerge('apply curation')
}
// ── Grow: the knowledge base deepens itself where it is thinnest ─────────────
phase('Grow')
const GAPS = { type: 'object', properties: { gaps: { type: 'array', items: { type: 'object', properties: { topic: { type: 'string' }, facts: { type: 'number' }, need: { type: 'number' } }, required: ['topic', 'facts', 'need'] } } }, required: ['gaps'] }
const gapList = MAX_GROW ? ((await agent(`Run \`node tools/knowledge.mjs check --now ${now}\` from the project root and return its "gaps" list (topics under their target fact count), thinnest first. Do not change any file.`, { label: 'find gaps', phase: 'Grow', schema: GAPS, effort: 'low', model: 'haiku' }))?.gaps ?? []).slice(0, MAX_GROW) : []
const DEEP = { 'ai-marketing-tools': 'om-tool-scout', 'management-canon': 'om-management-research-reader', consulting: 'om-management-research-reader', research: 'om-research-reader', pricing: 'om-research-reader', 'privacy-law': 'om-regulation-watcher', 'ai-regulation': 'om-regulation-watcher', search: 'om-algorithm-watcher', 'social-organic': 'om-algorithm-watcher', 'paid-search': 'om-policy-watcher', 'paid-social': 'om-policy-watcher', 'ai-tech': 'om-frontier-radar' }
const grown = await pipeline(
  gapList,
  (g, _item, i) => omAgent(DEEP[g.topic] ?? 'om-knowledge-scout', `Deepen the knowledge topic "${g.topic}" (${g.facts} verified facts, target ${g.facts + g.need}). Read the topic's facts in knowledge/base.json first and do not repeat them. Research what an expert digital-marketing consultant must know on this topic today: current rules and deadlines from official sources, robust research findings with effect sizes, dated benchmarks with segment and sample, and evergreen frameworks with their primary source (kind: rule | finding | benchmark | framework | case). Add up to ${Math.min(g.need, 12)} facts. Write knowledge/runs/${PFX}-G${i + 1}.json in this format: ${RUN_FORMAT} (add "kind" to each fact). ${RULES} Return the run id and the number of facts.`,
    { label: `grow ${g.topic}`, phase: 'Grow', schema: CAND }),
  (c, g, i) => (c?.facts ? omAgent('om-fact-verifier', `Verify knowledge/runs/${c.run_id}.json the same way as every knowledge run: open each source_url, check the statement, date, number and scope are really there and still current, default to reject when unsure. Write knowledge/runs/${PFX}-GV${i + 1}.json {"run_id": "${PFX}-GV${i + 1}", "agent": "om-fact-verifier", "verifies": "${c.run_id}", "verdicts": [{"index": 0, "statement_hash": "<from hashes>", "verdict": "keep|fix|reject", "statement": "<when fix>", "reason": "..."}]}. ${HASH_RULE(c.run_id)}`,
    { label: `verify grow ${g.topic}`, phase: 'Grow', schema: VER }) : null).then((v) => ({ topic: g.topic, facts: c?.facts ?? 0, ...(v ?? { keep: 0, fix: 0, reject: 0 }) })),
)
if (grown.filter(Boolean).some((x) => x.facts)) merged = await remerge('apply growth')
log(`Grow: ${grown.filter(Boolean).map((x) => `${x.topic} +${x.keep + x.fix}`).join(', ') || 'no gaps'}`)
await agent(`Run \`node tools/knowledge.mjs brief --now ${now}\` and \`node tools/check-skills.mjs\` from the project root. Return both outputs.`, { label: 'briefs + skills', phase: 'Grow', effort: 'low', model: 'haiku' })

// ── Teach ───────────────────────────────────────────────────────────────────
phase('Teach')
const PROPS = { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] }
const VERDICT = { type: 'object', properties: { verdict: { type: 'string', enum: ['pass', 'block'] }, issues: { type: 'array', items: { type: 'string' } } }, required: ['verdict', 'issues'] }
let shipped = { applied: 0, held: 0 }
let blocked = []
if (merged.added > 0) {
  const props = await omAgent('om-skill-smith', `New verified facts entered knowledge/base.json today (status "active", verified_at on ${day}). For the agents in each fact's "affects" (and the agents whose department the topic teaches, from tools/knowledge/topics.mjs), decide whether a fact changes what that agent must do beyond what its brief already tells it. Only then write a proposal per agent (at most ${MAX_PROPOSALS} in total) to state/evolution/proposals/EVO-${day}-<agent>.json: {"id": "EVO-${day}-<agent>", "kind": "agent-notes", "target": "<agent>", "text": "one short imperative rule that cites the date, e.g. 'Since 2026-03 …'", "rationale": "...", "knowledge_ids": ["K-..."]}. Rules repeat no existing learned rule (config/agent-overrides.json) and never touch approvals, budget caps, claims or the rules in CLAUDE.md. Return the proposal ids.`,
    { label: 'skill smith', phase: 'Teach', schema: PROPS })
  const ids = (props?.ids ?? []).slice(0, MAX_PROPOSALS)
  const reviews = await parallel(ids.map((id) => () => omAgent('om-red-team', `Attack the evolution proposal state/evolution/proposals/${id}.json. Read the knowledge facts it cites in knowledge/base.json and the target agent's file in .claude/agents/. Block it if the rule does not follow from the facts, overstates them, would make the agent break a platform rule or law, conflicts with CLAUDE.md, weakens approvals, caps or claims, or duplicates the agent's existing instructions. Do not edit any file.`,
    { label: `red-team ${id}`, phase: 'Teach', schema: VERDICT }).then((v) => ({ id, ...(v ?? { verdict: 'block', issues: ['no review'] }) }))))
  blocked = reviews.filter(Boolean).filter((r) => r.verdict === 'block')
  if (blocked.length) await agent(`Move these proposal files from state/evolution/proposals/ to state/evolution/rejected/ (create the folder) and add a "rejected_reasons" field to each with the issues given: ${JSON.stringify(blocked.map((b) => ({ id: b.id, issues: b.issues })))}.`, { label: 'park blocked', phase: 'Teach', effort: 'low', model: 'haiku' })
  // Ship only the ids this run red-teamed and passed. Never 'apply all': it would also ship
  // blocked proposals the park step failed to move and strays from an interrupted om-evolve run.
  // Ids go into a shell command, so only plain proposal ids ship (never 'all', flags or spaces).
  const passIds = ids.filter((id) => /^EVO-[A-Za-z0-9-]+$/.test(String(id)) && !blocked.some((b) => b.id === id))
  const SHIP = { type: 'object', properties: { applied: { type: 'number' }, held: { type: 'number' }, tests_passed: { type: 'boolean' } }, required: ['applied', 'held', 'tests_passed'] }
  if (passIds.length) shipped = await agent(`From the project root run ${passIds.map((id) => `\`node tools/evolve.mjs apply ${id} --now ${now}\``).join(', ')} (one at a time; each applies only what config/evolution.json allows and holds the rest with reasons), then \`node tools/build-agents.mjs\` once, then \`npm test\`. Apply no other proposal id. If the tests fail, run \`node tools/evolve.mjs rollback <id> --build\` for every id the apply step applied and run \`npm test\` again. Return applied, held and whether the final test run passed.`,
    { label: 'ship rules', phase: 'Teach', schema: SHIP, effort: 'low', model: 'haiku' })
  else log('No proposal passed the red team; nothing to ship')
} else log('No new facts; nothing to teach')

// ── Impact ──────────────────────────────────────────────────────────────────
phase('Impact')
const LIST = { type: 'object', properties: { slugs: { type: 'array', items: { type: 'string' } } }, required: ['slugs'] }
const slugs = merged.added > 0 ? (await agent('List the folders in products/ whose names do not start with "_" and whose product.json has "stage": "active". Return their names. Do not change any file.', { label: 'active products', phase: 'Impact', schema: LIST, effort: 'low', model: 'haiku' })).slugs : []
await pipeline(
  slugs,
  (s) => agent(`Product products/${s}/. Read product.json (channels, paid channels, market) and plan.md. Read the facts in knowledge/base.json verified on ${day}. For each fact that changes how one of this product's channels, markets or planned tasks works, add an alert. Write products/${s}/runs/${PFX}-${s}.json: {"task_id": "${PFX}-${s}", "agent": "om-knowledge-curator", "status": "done", "summary": "...", "alerts": [{"level": "decision|warning|info", "title": "<what changed, in owner words>", "detail": "<what it means for this product and the action to take; cite the fact id>"}]}. Write it even with no alerts (empty list). Do not edit any other file.`,
    { label: `impact ${s}`, phase: 'Impact', effort: 'low', model: 'haiku' }),
  (_r, s) => agent(`Run \`node tools/apply-results.mjs ${s} --now ${now}\` from the project root and return its stdout.`, { label: `apply ${s}`, phase: 'Impact', effort: 'low', model: 'haiku' }),
)

// ── Report ──────────────────────────────────────────────────────────────────
phase('Report')
const report = await omAgent('om-reporter', `Write knowledge/reports/${day}.md in at most 20 lines: feeds fetched (${fetched?.new_items ?? 0} new items, ${fetched?.failed ?? 0} failed sources), batches extracted and verifier verdicts (${JSON.stringify(extracted.filter(Boolean).map((e) => ({ t: e.topic, keep: e.keep, fix: e.fix, reject: e.reject })))}), facts added (${merged.added}), rejected (${merged.rejected}), active (${merged.facts_active}) and still stale (${merged.stale}), agent rules shipped (${shipped.applied}) or held (${shipped.held}) and blocked by the red team (${blocked.length}), topics grown (${JSON.stringify(grown.filter(Boolean).map((x) => ({ t: x.topic, kept: x.keep + x.fix, rejected: x.reject })))}), and products alerted (${slugs.join(', ') || 'none'}). Read knowledge/CHANGELOG.md for the newest lines. Then run \`node tools/build-state.mjs\`. Return the report text.`,
  { label: 'reporter', phase: 'Report' })

return { workflow: NAME, fetched, batches: extracted.filter(Boolean), grown: grown.filter(Boolean), merged, shipped, blocked: blocked.map((b) => b.id), products: slugs, report }
