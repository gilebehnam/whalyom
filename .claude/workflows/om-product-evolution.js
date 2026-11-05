export const meta = {
  name: 'om-product-evolution',
  description: 'Whalyom improving itself as a product: measures the product scorecard and agent outcome credit, refreshes the competitor feature matrix, the product manager picks the highest-impact buildable items, engineering agents build each with a test, the red team checks no guard was loosened, the full suite must pass, and owner-only items become clear requests',
  whenToUse: 'Weekly (and after big changes) to keep Whalyom ahead of competitors and moving customers\' sales. args: {now, maxItems?: 3, compete?: true}',
  phases: [
    { title: 'Measure', detail: 'outcome credit and the measured product scorecard and backlog' },
    { title: 'Compete', detail: 'competitor feature matrix from competitors\' own pages' },
    { title: 'Prioritize', detail: 'product manager: specs for the top buildable items, owner requests' },
    { title: 'Build', detail: 'per item: engineer builds it with a test, red team checks the guards' },
    { title: 'Verify', detail: 'full test suite, re-measure' },
    { title: 'Report', detail: 'roadmap and what changed' },
  ],
}

const NAME = 'om-product-evolution'
const now = args?.now ?? 'unknown-time'
const day = String(now).slice(0, 10)
const PFX = `PM-${day}`
const MAX = Math.max(1, Math.min(Number(args?.maxItems ?? 3), 5))

const omAgent = async (agentType, prompt, opts) => {
  try {
    return await agent(prompt, { ...opts, agentType })
  } catch (e) {
    log(`${agentType} unavailable; using general-purpose with .claude/agents/${agentType}.md`)
    return agent(`Act as the agent defined in .claude/agents/${agentType}.md: read that file first and follow it exactly.\n\n${prompt}`,
      { ...opts, agentType: 'general-purpose', label: `${opts?.label ?? agentType}*` })
  }
}

const GUARDS = 'Safety rule: approvals, budget caps, compliance checks, the kill switch, platform rules and the earned-autonomy limits (tools/policy.mjs, execute.mjs, budget.mjs, killswitch.mjs, tools/lib/earned.mjs, tools/connectors/*) may be extended or repaired but never loosened; never mark approvals approved on the owner\'s behalf; never raise a cap or an autonomy level; never delete working parts (extend them); keep `npm test` green. Product changes go to the code and docs, never to a product\'s approvals.json.'

// ── Measure ─────────────────────────────────────────────────────────────────
phase('Measure')
const SCORE = {
  type: 'object',
  properties: { overall: { type: 'number' }, previous: { type: 'number' }, items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, owner: { type: 'string', enum: ['system', 'owner'] }, title: { type: 'string' }, priority: { type: 'number' } }, required: ['id', 'owner', 'title', 'priority'] } } },
  required: ['overall', 'previous', 'items'],
}
const before = await agent('From the project root run `node tools/outcomes.mjs` and then `node tools/product-review.mjs`. Read pm/scorecard.json and pm/backlog.json and return overall, previous_overall (0 when null) as previous, and every backlog item (id, owner, title, priority). Change no other file.',
  { label: 'measure', phase: 'Measure', schema: SCORE, effort: 'low', model: 'haiku' })

// ── Compete ─────────────────────────────────────────────────────────────────
phase('Compete')
if (args?.compete !== false) {
  await omAgent('om-competitive-product-analyst', `Cycle ${PFX}. Refresh pm/competitors.json and pm/COMPETITION.md as your instructions say: re-check every competitor's own pages (at most 12 competitors), add new entrants you find, and update Whalyom's column from the code in this repository (tools/, .claude/workflows/, docs/ARCHITECTURE_STATE.md). Then run \`node tools/product-review.mjs\` so the parity gaps enter the backlog. Return the five gaps that matter most to buyers.`,
    { label: 'competitor matrix', phase: 'Compete' })
}

// ── Prioritize ──────────────────────────────────────────────────────────────
phase('Prioritize')
const PLAN = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, spec: { type: 'string' }, files: { type: 'string' }, test: { type: 'string' } }, required: ['id', 'spec', 'files', 'test'] } }, owner_requests: { type: 'number' } },
  required: ['items', 'owner_requests'],
}
const plan = await omAgent('om-product-manager', `Cycle ${PFX}. Work as your instructions say from pm/backlog.json (re-read it: the competitor step may have changed it). Pick at most ${MAX} "system" items that can be built and tested inside this repository this cycle, highest priority first, each small enough for one engineer in one pass; write pm/specs/<id>.md for each. Write each "owner" item as one clear request in reports/owner-decisions.md (what, why with the evidence, the exact step for the owner). Update pm/ROADMAP.md. Return the chosen items (id, the spec path, the files likely to change, the test that will prove it) and how many owner requests you wrote. ${GUARDS}`,
  { label: 'product manager', phase: 'Prioritize', schema: PLAN })
const items = (plan.items ?? []).slice(0, MAX).map((it, i) => ({ ...it, code: `B${i + 1}` }))

// ── Build ───────────────────────────────────────────────────────────────────
phase('Build')
const VERDICT = { type: 'object', properties: { verdict: { type: 'string', enum: ['pass', 'fix', 'block'] }, issues: { type: 'array', items: { type: 'string' } } }, required: ['verdict', 'issues'] }
const RESULT = { type: 'object', properties: { status: { type: 'string', enum: ['done', 'blocked'] }, summary: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } }, required: ['status', 'summary', 'files'] }
// Items touch different parts of tools/; they still run one after another so two engineers never edit
// the same file at once and each one's tests run on a known state.
const built = []
for (const it of items) {
  const res = await omAgent('om-bug-hunter', `Build ${PFX}-${it.code} (${it.id}). Spec: ${it.spec} (read it first). Likely files: ${it.files}. Implement it in the style of the surrounding code, add the test (${it.test}) in tools/test/, update docs/ARCHITECTURE_STATE.md and any skill or command reference it changes, and run \`npm test\`. If the suite fails and you cannot fix it, revert only the files you changed for this item and report "blocked". If a product workspace changed, run \`node tools/apply-results.mjs <slug>\` for it and write its runs/ file. ${GUARDS} Write state/product-evolution/${PFX}-${it.code}.md: what changed, files, test, suite result. Return status, a summary and the files you changed.`,
    { label: `build ${it.code}`, phase: 'Build', schema: RESULT })
  let check = null
  if (res && res.status === 'done') {
    check = await omAgent('om-red-team', `Adversarial check of ${PFX}-${it.code}: files ${(res.files ?? []).join(', ')}. Assume a guard was weakened and look for it: approvals, caps, compliance, kill switch, platform rules, privacy (personal data in state/ or logs), earned-autonomy limits, invented results. Verdict "block" if any guard is weaker or a claim is untrue; "fix" for small problems; else "pass". Write state/product-evolution/${PFX}-${it.code}-redteam.md. Report only.`,
      { label: `red team ${it.code}`, phase: 'Build', schema: VERDICT })
    if (check?.verdict === 'block') {
      log(`${it.code}: blocked by the red team; reverting`)
      await omAgent('om-bug-hunter', `The red team blocked ${PFX}-${it.code}: ${(check.issues ?? []).join(' | ').slice(0, 1500)}. Revert exactly the files this item changed (${(res.files ?? []).join(', ')}) to their state before the item, run \`npm test\`, and note it in state/product-evolution/${PFX}-${it.code}.md. ${GUARDS}`,
        { label: `revert ${it.code}`, phase: 'Build', schema: RESULT })
    }
  }
  built.push({ id: it.id, code: it.code, status: res?.status ?? 'blocked', verdict: check?.verdict ?? null })
}

// ── Verify ──────────────────────────────────────────────────────────────────
phase('Verify')
const TESTS = { type: 'object', properties: { passed: { type: 'boolean' }, summary: { type: 'string' }, failing: { type: 'array', items: { type: 'string' } } }, required: ['passed', 'summary', 'failing'] }
const runTests = (label) => agent('Run `npm test` from the project root. Return whether every test passed, the pass/fail summary line, and the names of failing tests.', { label, phase: 'Verify', schema: TESTS, effort: 'low', model: 'haiku' })
let tests = await runTests('npm test')
if (!tests.passed) {
  log('suite failing after the build; one repair round by the bug hunter')
  await omAgent('om-bug-hunter', `npm test fails after ${PFX}: ${(tests.failing ?? []).join(', ')}. Fix the cause (or revert the item that caused it) so the suite passes. ${GUARDS}`, { label: 'repair', phase: 'Verify', schema: RESULT })
  // The report and the return value show the suite as it is after the repair, not before it.
  tests = await runTests('npm test after repair')
  if (!tests.passed) log(`suite still failing after the repair: ${(tests.failing ?? []).join(', ')}`)
}
const after = await agent('From the project root run `node tools/build-agents.mjs` if tools/roster*.mjs changed, then `node tools/outcomes.mjs` and `node tools/product-review.mjs`; return the overall score from its output as "overall", previous as the score before this run, and the backlog items.', { label: 're-measure', phase: 'Verify', schema: SCORE, effort: 'low', model: 'haiku' })

// ── Report ──────────────────────────────────────────────────────────────────
phase('Report')
const report = await omAgent('om-product-manager', `Write pm/reports/${day}.md in at most 30 lines: score before ${before.overall} and after ${after.overall}, what was built (${built.map((b) => `${b.code} ${b.id}: ${b.status}${b.verdict ? `/${b.verdict}` : ''}`).join('; ') || 'nothing'}), tests (${tests.passed ? 'pass' : 'fail: ' + tests.summary}), the competitor gaps still open, the owner requests written to reports/owner-decisions.md, and next cycle's top three. Update pm/ROADMAP.md. Claim only what the scorecard and tests show. Return the report text.`,
  { label: 'report', phase: 'Report' })
return { workflow: NAME, before: before.overall, after: after.overall, built, tests: tests.passed, owner_requests: plan.owner_requests ?? 0, report }
