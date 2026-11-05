export const meta = {
  name: 'om-evolve',
  description: 'Self-improvement cycle: the evolution director picks the weakest agents from evaluator scores, failed tasks and new knowledge; the benchmark keeper scores each on its golden set; the prompt optimizer proposes a rule or skill change; the agent is re-scored with the change; the red team and the skill auditor try to block it; tools/evolve.mjs ships only measured gains inside config/evolution.json, the test suite must pass or every change is rolled back',
  whenToUse: 'Weekly, after om-knowledge-refresh, or when evaluator scores drop. args: {now, maxAgents?: 10, maxNew?: 3}',
  phases: [
    { title: 'Assess', detail: 'weakest agents by scores, failures and knowledge they lack' },
    { title: 'Bench', detail: 'golden set and baseline score per agent' },
    { title: 'Propose', detail: 'rule or skill change, re-scored with the change' },
    { title: 'Review', detail: 'red team and skill auditor try to block each proposal' },
    { title: 'Grow', detail: 'new agents and new skills for gaps no agent covers, each red-teamed' },
    { title: 'Ship', detail: 'evolve apply, rebuild agents, tests or rollback' },
    { title: 'Report', detail: 'evolution report, product notes, dashboard state' },
  ],
}

const NAME = 'om-evolve'
const now = args?.now ?? 'unknown-time'
const day = String(now).slice(0, 10)
const PFX = `EVO-${day}`
const MAX = Math.max(1, Math.min(Number(args?.maxAgents ?? 10), 20))
const MAX_NEW = Math.max(0, Math.min(Number(args?.maxNew ?? 3), 5))

const omAgent = async (agentType, prompt, opts) => {
  try {
    return await agent(prompt, { ...opts, agentType })
  } catch (e) {
    log(`${agentType} unavailable; using general-purpose with .claude/agents/${agentType}.md`)
    return agent(`Act as the agent defined in .claude/agents/${agentType}.md: read that file first and follow it exactly.\n\n${prompt}`,
      { ...opts, agentType: 'general-purpose', label: `${opts?.label ?? agentType}*` })
  }
}
const GUARDS = 'Never propose changes to approvals, budget caps, claims rules, CLAUDE.md, tools/policy.mjs, execute.mjs, budget.mjs, killswitch.mjs, apply-results.mjs, tools/connectors/ or config/evolution.json. Never edit tools/roster.mjs or config/agent-overrides.json yourself: tools/evolve.mjs applies proposals.'

// ── Assess ──────────────────────────────────────────────────────────────────
phase('Assess')
const TARGETS = { type: 'object', properties: { targets: { type: 'array', items: { type: 'object', properties: { agent: { type: 'string' }, reason: { type: 'string' }, evidence: { type: 'string' } }, required: ['agent', 'reason', 'evidence'] } } }, required: ['targets'] }
const assess = await omAgent('om-evolution-director', `Pick at most ${MAX} agents to improve this cycle. Evidence, in order: market results first: run \`node tools/outcomes.mjs\` and read state/agent-outcomes.json: agents whose work went out with "no_result_items" (14+ days on a channel, no lead) come before everything else, and the agents with the most leads, sales and revenue are the models whose methods the improvements should copy; then low "score" values the evaluator wrote on done tasks in products/*/tasks.json; tasks of that agent with status "blocked" or "failed" and their errors; knowledge facts in knowledge/base.json whose "affects" names the agent and were verified after its last learned rule (config/agent-overrides.json); held or rejected proposals in state/evolution/ you should not retry unchanged. Skip agents improved in the last 7 days (state/evolution/history.jsonl). Write state/evolution/${PFX}-targets.md with the ranking. ${GUARDS} Return the targets with one-line reasons and the evidence.`,
  { label: 'evolution director', phase: 'Assess', schema: TARGETS })
const targets = (assess?.targets ?? []).filter((t) => /^om-[a-z0-9-]+$/.test(t.agent)).slice(0, MAX)
log(`${targets.length} agent(s) to improve`)

// ── Bench → Propose → Review (per agent, no barrier) ────────────────────────
const SCORE = { type: 'object', properties: { score: { type: 'number' }, cases: { type: 'number' } }, required: ['score', 'cases'] }
const PROP = { type: 'object', properties: { id: { type: 'string' }, kind: { type: 'string', enum: ['agent-notes', 'skill-pack', 'none'] } }, required: ['id', 'kind'] }
const VERDICT = { type: 'object', properties: { verdict: { type: 'string', enum: ['pass', 'block'] }, issues: { type: 'array', items: { type: 'string' } } }, required: ['verdict', 'issues'] }
const benchPrompt = (t, extra) => `Benchmark ${t.agent}. Its golden set is state/evolution/bench/${t.agent}.json; if missing, create it first: 3 realistic briefs for this agent drawn from products/*/tasks.json or products/sample-quoteflow/, each with a rubric of 4–6 checkable qualities (follows its brief and guardrails, uses verified claims only, applies current knowledge from knowledge/briefs/, output complete and specific). Then, for each case, write the answer the agent defined in .claude/agents/${t.agent}.md would give${extra}, and score it against the rubric 0–1 (fraction of qualities met). Be strict and use the same rubric every time. Save the scores in state/evolution/bench/${t.agent}-${day}.json. Return the mean score and the number of cases.`
phase('Bench')
const evolved = await pipeline(
  targets,
  (t) => omAgent('om-agent-bench', benchPrompt(t, ''), { label: `bench ${t.agent}`, phase: 'Bench', schema: SCORE }).then((b) => ({ ...t, before: b?.score ?? null })),
  (t) => omAgent('om-prompt-optimizer', `Improve ${t.agent} (reason: ${t.reason}; evidence: ${t.evidence}). Read .claude/agents/${t.agent}.md, its benchmark state/evolution/bench/${t.agent}-${day}.json (baseline ${t.before}) and the cases it failed. Propose ONE change: either "agent-notes" (one short imperative rule, ≤ 400 characters, citing knowledge ids when it comes from a fact) or "skill-pack" (1–3 installed skills from \`node tools/check-skills.mjs --list\` that cover the gap). Write state/evolution/proposals/${PFX}-${t.agent}.json: {"id": "${PFX}-${t.agent}", "kind": "...", "target": "${t.agent}", "text": "..." or "skills": [...], "rationale": "...", "knowledge_ids": [...], "bench": {"before": ${t.before}}}. If no change would help, return kind "none" and write nothing. ${GUARDS}`,
    { label: `propose ${t.agent}`, phase: 'Propose', schema: PROP }).then((p) => ({ ...t, proposal: p?.kind && p.kind !== 'none' ? p.id : null, kind: p?.kind ?? 'none' })),
  (t) => (t.proposal ? omAgent('om-agent-bench', benchPrompt(t, ` WITH the change in state/evolution/proposals/${t.proposal}.json applied (treat its rule as part of the agent's instructions, or its skills as available)`), { label: `re-bench ${t.agent}`, phase: 'Propose', schema: SCORE })
    .then((b) => ({ ...t, after: b?.score ?? null })) : t),
  (t) => (t.proposal ? agent(`Set "bench": {"before": ${t.before}, "after": ${t.after}} in state/evolution/proposals/${t.proposal}.json, keeping every other field. Return "ok".`, { label: `record bench ${t.agent}`, phase: 'Propose', effort: 'low', model: 'haiku' }).then(() => t) : t),
  (t) => (t.proposal ? parallel([
    () => omAgent('om-red-team', `Attack state/evolution/proposals/${t.proposal}.json (benchmark ${t.before} → ${t.after}). Block it if the gain looks like rubric gaming, the rule would make ${t.agent} break a platform rule, a law or CLAUDE.md, weakens approvals, caps or claims, contradicts the knowledge facts it cites, or only restates what the agent already does. Do not edit any file.`, { label: `red-team ${t.agent}`, phase: 'Review', schema: VERDICT }),
    () => omAgent('om-skill-auditor', `Audit the proposal state/evolution/proposals/${t.proposal}.json for ${t.agent}: for "skill-pack", read each named skill's SKILL.md and block any that exfiltrates data, runs unknown code, calls unexpected URLs or overrides house rules; for "agent-notes", block instructions that do any of those. Do not edit any file.`, { label: `skill audit ${t.agent}`, phase: 'Review', schema: VERDICT }),
  ]).then((vs) => ({ ...t, reviews: vs.filter(Boolean), blocked: vs.some((v) => !v || v.verdict === 'block') })) : t),
)
const done = evolved.filter(Boolean)
phase('Propose')
log(`${done.filter((t) => t.proposal).length} proposal(s) written`)
phase('Review')
const blocked = done.filter((t) => t.proposal && t.blocked)

// ── Grow: new agents and new skills for gaps no existing agent covers ──────
phase('Grow')
const NEW = { type: 'object', properties: { proposals: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, kind: { type: 'string', enum: ['new-agent', 'local-skill'] }, gap: { type: 'string' } }, required: ['id', 'kind', 'gap'] } } }, required: ['proposals'] }
const grow = MAX_NEW ? await omAgent('om-evolution-director', `Find at most ${MAX_NEW} gaps that no existing agent or skill covers well. Evidence: facts verified in the last 14 days in knowledge/base.json (especially topics ai-marketing-tools, ai-tech and the canon topics) that no agent's brief acts on; tasks in products/*/tasks.json that were blocked because no suitable agent existed; candidates in research/skill-scout/; recurring work the evaluator flagged. Check .claude/agents/ and \`node tools/check-skills.mjs --list\` first: a gap that an existing agent or skill already covers is not a gap. For each real gap write ONE proposal to state/evolution/proposals/${PFX}-grow-<slug>.json, either {"id": "${PFX}-grow-<slug>", "kind": "new-agent", "agent": {"slug": "<slug>", "title": "...", "does": "one sentence job", "dept": "<one of sovereign intel strategy creative seo paid social funnel leadgen closer lifecycle finops evolve>", "model": "sonnet" or "haiku", "skills": ["1–4 installed skills"], "notes": "precise brief: inputs, output files, what it must never do"}, "rationale": "...", "knowledge_ids": ["K-... facts that show the gap"]} or {"id": "${PFX}-grow-<slug>", "kind": "local-skill", "skill": {"slug": "<slug>", "description": "when to use it", "body": "the method in markdown, written from verified knowledge, no code downloads"}, "rationale": "...", "knowledge_ids": ["K-..."]}. The slug is the bare name with no prefix (tools/evolve.mjs adds the grown-agent prefix). New agents work like every other agent: drafts go to outbox/grown/ and research/grown/ with approvals, web tools only, no shell. Phrase guardrails positively (e.g. "use only verified claims", "public, permitted sources only"): the text guards reject words such as invent or scrape even when negated. Prefer a cheaper fix when it exists (re-pointing facts, a skill-pack proposal for an existing agent) and say so instead of growing an agent. Return the proposals. ${GUARDS}`,
  { label: 'grow: find gaps', phase: 'Grow', schema: NEW }) : { proposals: [] }
const grown = await pipeline(
  (grow?.proposals ?? []).filter((p) => /^[A-Za-z0-9._-]+$/.test(p.id)).slice(0, MAX_NEW),
  (p) => parallel([
    () => omAgent('om-red-team', `Attack the ${p.kind} proposal state/evolution/proposals/${p.id}.json (gap: ${p.gap}). Block it if an existing agent or skill already does this job (check .claude/agents/ and .claude/skills/), if it would act outbound, spend or publish without approval, needs credentials or a shell, breaks a platform rule, a law or CLAUDE.md, or rests on knowledge facts that do not say what it claims. Do not edit any file.`, { label: `red-team ${p.id}`, phase: 'Grow', schema: VERDICT }),
    () => omAgent('om-skill-auditor', `Audit state/evolution/proposals/${p.id}.json: read every skill it names (or its skill body) and block anything that exfiltrates data, runs or downloads code, calls unexpected URLs or overrides house rules. Do not edit any file.`, { label: `audit ${p.id}`, phase: 'Grow', schema: VERDICT }),
  ]).then((vs) => ({ ...p, reviews: vs.filter(Boolean), blocked: vs.some((v) => !v || v.verdict === 'block') })),
  (p) => (p.blocked ? p : agent(`Set "red_team": {"passed": true, "at": "${now}"} in state/evolution/proposals/${p.id}.json, keeping every other field. Return "ok".`, { label: `record review ${p.id}`, phase: 'Grow', effort: 'low', model: 'haiku' }).then(() => p)),
)
const grownOk = grown.filter(Boolean).filter((p) => !p.blocked)
for (const p of grown.filter(Boolean).filter((x) => x.blocked)) blocked.push({ agent: p.id, proposal: p.id, reviews: p.reviews, blocked: true })
log(`${grownOk.length} new agent/skill proposal(s) passed review`)

// ── Ship ────────────────────────────────────────────────────────────────────
phase('Ship')
if (blocked.length) await agent(`Move these proposal files from state/evolution/proposals/ to state/evolution/rejected/ (create the folder) and add "rejected_reasons" from the review issues: ${JSON.stringify(blocked.map((t) => ({ id: t.proposal, issues: (t.reviews ?? []).flatMap((r) => r.issues ?? []) })))}.`, { label: 'park blocked', phase: 'Ship', effort: 'low', model: 'haiku' })
const SHIP = { type: 'object', properties: { applied: { type: 'number' }, held: { type: 'number' }, tests_passed: { type: 'boolean' }, rolled_back: { type: 'number' } }, required: ['applied', 'held', 'tests_passed', 'rolled_back'] }
const ready = [...done.filter((t) => t.proposal && !t.blocked), ...grownOk.map((p) => ({ proposal: p.id }))]
const shipped = ready.length ? await agent(`From the project root: for each of ${ready.map((t) => t.proposal).join(', ')} run \`node tools/evolve.mjs apply <id> --now ${now}\` (it checks the benchmark gain, the text guards and the mode in config/evolution.json, and holds what it may not ship). Then run \`node tools/build-agents.mjs\` and \`npm test\`. If the tests fail, run \`node tools/evolve.mjs rollback <id>\` for every id that was applied, then \`node tools/build-agents.mjs\` and \`npm test\` again. Return applied, held, whether the final tests passed and how many were rolled back.`,
  { label: 'ship', phase: 'Ship', schema: SHIP, effort: 'low', model: 'haiku' }) : { applied: 0, held: 0, tests_passed: true, rolled_back: 0 }

// ── Report ──────────────────────────────────────────────────────────────────
phase('Report')
const LIST = { type: 'object', properties: { slugs: { type: 'array', items: { type: 'string' } } }, required: ['slugs'] }
const slugs = shipped.applied > 0 ? (await agent('List the folders in products/ whose names do not start with "_" and whose product.json has "stage": "active". Return their names. Do not change any file.', { label: 'active products', phase: 'Report', schema: LIST, effort: 'low', model: 'haiku' })).slugs : []
await pipeline(
  slugs,
  (s) => agent(`Write products/${s}/runs/${PFX}-${s}.json: {"task_id": "${PFX}-${s}", "agent": "om-evolution-director", "status": "done", "summary": "Self-evolution: ${shipped.applied} agent improvement(s) shipped", "alerts": [{"level": "info", "title": "Whalyom improved ${shipped.applied} agent(s)", "detail": "See state/evolution/${PFX}.md for what changed and the benchmark gains. Roll back any change with node tools/evolve.mjs rollback <id> --build."}]}. Do not edit any other file.`, { label: `note ${s}`, phase: 'Report', effort: 'low', model: 'haiku' }),
  (_r, s) => agent(`Run \`node tools/apply-results.mjs ${s} --now ${now}\` from the project root and return its stdout.`, { label: `apply ${s}`, phase: 'Report', effort: 'low', model: 'haiku' }),
)
const report = await omAgent('om-reporter', `Write state/evolution/${PFX}.md in at most 20 lines: agents assessed (${targets.map((t) => t.agent).join(', ') || 'none'}), per agent the benchmark before → after and the proposal (${JSON.stringify(done.map((t) => ({ a: t.agent, before: t.before, after: t.after ?? null, p: t.proposal, blocked: !!t.blocked })))}), what the red team or skill auditor blocked, what shipped (${shipped.applied}), was held (${shipped.held}) or rolled back (${shipped.rolled_back}), and the final test result (${shipped.tests_passed ? 'pass' : 'FAIL'}). Then run \`node tools/build-state.mjs\`. Return the report text.`,
  { label: 'reporter', phase: 'Report' })

return { workflow: NAME, targets: done.map((t) => ({ agent: t.agent, before: t.before, after: t.after ?? null, proposal: t.proposal, blocked: !!t.blocked })), shipped, report }
