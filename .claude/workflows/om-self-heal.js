export const meta = {
  name: 'om-self-heal',
  description: 'Self-healing: ops doctor repairs each workspace, self-debug finds what is broken in tools/, om-bug-hunter fixes the root cause with a test, the red team checks no guard was loosened, the full test suite confirms, and recurring causes become upgrade proposals',
  whenToUse: 'When self-debug, the daemon or a run reports failures, or weekly as maintenance. args: {now, slug?: one product (default every product), maxRounds?: 3}',
  phases: [
    { title: 'Doctor', detail: 'validate and repair each workspace, merge leftovers' },
    { title: 'Hunt', detail: 'self-debug, bug hunter fix (files backed up first), red-team check of the fix, restore on a block, repeat until clean' },
    { title: 'Tests', detail: 'full test suite; restore the rounds\' backups if it fails' },
    { title: 'Proposals', detail: 'recurring causes become proposals for the owner' },
    { title: 'Report', detail: 'system health report' },
  ],
}

const NAME = 'om-self-heal'
const now = args?.now ?? 'unknown-time'
const day = String(now).slice(0, 10)
const PFX = `HEAL-${day}`
const MAX_ROUNDS = Math.max(1, Math.min(Number(args?.maxRounds ?? 3), 5))

const omAgent = async (agentType, prompt, opts) => {
  try {
    return await agent(prompt, { ...opts, agentType })
  } catch (e) {
    log(`${agentType} unavailable; using general-purpose with .claude/agents/${agentType}.md`)
    return agent(`Act as the agent defined in .claude/agents/${agentType}.md: read that file first and follow it exactly.\n\n${prompt}`,
      { ...opts, agentType: 'general-purpose', label: `${opts?.label ?? agentType}*` })
  }
}
const GUARDS = 'Safety rule: the guards in tools/policy.mjs, execute.mjs, budget.mjs, killswitch.mjs and tools/connectors/* may be repaired but never loosened; never change approval rules or budget caps, never mark approvals approved, never delete working parts (extend them).'

// ── Doctor ──────────────────────────────────────────────────────────────────
phase('Doctor')
const LIST = { type: 'object', properties: { slugs: { type: 'array', items: { type: 'string' } } }, required: ['slugs'] }
const slugs = args?.slug ? [args.slug] : (await agent('List the folders in products/ whose names do not start with "_" and that contain a product.json. Return their names. Do not change any file.',
  { label: 'list products', phase: 'Doctor', schema: LIST, effort: 'low', model: 'haiku' })).slugs
const DOC = { type: 'object', properties: { ok: { type: 'boolean' }, repaired: { type: 'array', items: { type: 'string' } }, open: { type: 'array', items: { type: 'string' } } }, required: ['ok', 'repaired', 'open'] }
const doctor = await pipeline(
  slugs,
  (s) => omAgent('om-ops-doctor', `Product workspace: products/${s}/. Run \`node tools/validate.mjs ${s}\`. Repair what you safely can (invalid JSON, broken depends_on, tasks stuck in "running" back to "todo", orphan run files), run it again, and write products/${s}/reports/ops-${day}.md. Do not edit approvals.json beyond fixing invalid JSON. Write products/${s}/runs/${PFX}-${s}.json for anything the merge should record. Return ok, what you repaired and what is still open. ${GUARDS}`,
    { label: `ops-doctor ${s}`, phase: 'Doctor', schema: DOC }),
  (d, s) => agent(`Run \`node tools/apply-results.mjs ${s} --now ${now}\` from the project root and return its stdout.`, { label: `apply ${s}`, phase: 'Doctor', effort: 'low', model: 'haiku' })
    .then(() => ({ slug: s, ok: d?.ok ?? false, open: d?.open ?? [] })),
)

// ── Hunt ────────────────────────────────────────────────────────────────────
phase('Hunt')
const SD = { type: 'object', properties: { ok: { type: 'boolean' }, problems: { type: 'number' }, brief: { type: 'string' } }, required: ['ok', 'problems', 'brief'] }
const selfDebug = (label) => agent('Run `node tools/self-debug.mjs` from the project root. It prints one JSON line; return its ok, problems and bug_hunter_brief (empty string when there is none).',
  { label, phase: 'Hunt', schema: SD, effort: 'low', model: 'haiku' })
const VERDICT = { type: 'object', properties: { verdict: { type: 'string', enum: ['pass', 'fix', 'block'] }, issues: { type: 'array', items: { type: 'string' } } }, required: ['verdict', 'issues'] }
const FIX = { type: 'object', properties: { summary: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } }, required: ['summary', 'files'] }
const RESTORE = { type: 'object', properties: { restored: { type: 'array', items: { type: 'string' } }, passed: { type: 'boolean' }, summary: { type: 'string' } }, required: ['restored', 'passed', 'summary'] }
// Uncommitted work cannot be recovered from git, so every round keeps its own copies of the files it edits:
// a blocked fix, or a suite that is red at the end, is undone from them instead of being left applied.
const backupDir = (r) => `state/self-heal/backup/${PFX}-R${r}`
const restoreRounds = (rounds, why, phaseName) => omAgent('om-bug-hunter', `Restore round(s) ${rounds.join(', ')} of ${PFX}: ${why}. Work from the latest round to the earliest. For each round n, read the "Backups" list in state/self-heal/${PFX}-R<n>.md, copy every file under ${backupDir('<n>')}/ back to the same path relative to the project root, and delete only the files that list marks as new in that round. Change no other file and keep the backups. Then run \`npm test\` and append a "Restored" section to each R<n>.md: the files put back, the files removed and the suite result. Return the restored paths, whether every test passed and the summary line. ${GUARDS}`,
  { label: `restore R${rounds.join('+')}`, phase: phaseName, schema: RESTORE })
const restores = []
let sd = await selfDebug('self-debug')
const history = []
let round = 0
let halted = null
while (!sd.ok && round < MAX_ROUNDS) {
  round++
  log(`Round ${round}: ${sd.problems} problem(s)`)
  const fix = await omAgent('om-bug-hunter', `Fix round ${round} (${PFX}). Brief from tools/self-debug.mjs:\n${sd.brief.slice(0, 4000)}\n\nFind the root cause in tools/ (or the workspace data), write the fix and a test for it in tools/test/, and run \`npm test\` before handing back. Before you edit any existing file, copy it to ${backupDir(round)}/<same path> (for example tools/x.mjs to ${backupDir(round)}/tools/x.mjs); a file you add needs no copy. ${GUARDS} Write state/self-heal/${PFX}-R${round}.md: cause, files changed, test added, suite result, and a "Backups" section listing every file you copied and every file you added (marked new). Return a short summary and every file you changed or added.`,
    { label: `bug-hunter R${round}`, phase: 'Hunt', schema: FIX })
  const check = await omAgent('om-red-team', `Review the fix described in state/self-heal/${PFX}-R${round}.md (summary: ${String(fix?.summary ?? '').slice(0, 800)}; files: ${(fix?.files ?? []).join(', ').slice(0, 400)}). Try to show it is wrong: does it loosen a guard in policy, execute, budget, killswitch or connectors; hide the failure instead of fixing it; skip or weaken a test; or delete a working part? Read the changed files. Verdict "block" if any of these hold. Do not edit any file.`,
    { label: `red-team R${round}`, phase: 'Hunt', schema: VERDICT })
  history.push({ round, problems: sd.problems, review: check?.verdict ?? 'none', issues: check?.issues ?? [], files: fix?.files ?? [], restored: false })
  if (check?.verdict === 'block') {
    halted = `round ${round} fix blocked by the red team: ${check.issues.join('; ').slice(0, 400)}`
    log(`Stopping: ${halted}. Restoring the round's backups; the owner should review state/self-heal/${PFX}-R${round}.md before any further change.`)
    const r = await restoreRounds([round], `the red team blocked the fix (${check.issues.join('; ').slice(0, 600)})`, 'Hunt')
    history.at(-1).restored = true
    restores.push({ rounds: [round], why: 'red-team block', restored: r?.restored ?? [], passed: r?.passed ?? false })
    break
  }
  sd = await selfDebug(`self-debug R${round}`)
}
if (!sd.ok && !halted) log(`Still ${sd.problems} problem(s) after ${round} round(s)`)

// ── Tests ───────────────────────────────────────────────────────────────────
phase('Tests')
const TESTS = { type: 'object', properties: { passed: { type: 'boolean' }, summary: { type: 'string' }, failing: { type: 'array', items: { type: 'string' } } }, required: ['passed', 'summary', 'failing'] }
const runTests = (label) => agent('Run `npm test` from the project root. Return whether every test passed, the pass/fail summary line, and the names of failing tests.',
  { label, phase: 'Tests', schema: TESTS, effort: 'low', model: 'haiku' })
let tests = await runTests('npm test')
// A red suite after rounds that changed files: put those files back, then measure again.
const changedRounds = history.filter((h) => h.files.length && !h.restored).map((h) => h.round)
if (!tests.passed && changedRounds.length) {
  log(`Suite failing after round(s) ${changedRounds.join(', ')}; restoring their backups`)
  const r = await restoreRounds(changedRounds, `npm test fails after the hunt (${tests.failing.join(', ').slice(0, 600) || tests.summary})`, 'Tests')
  for (const h of history) if (changedRounds.includes(h.round)) h.restored = true
  restores.push({ rounds: changedRounds, why: 'suite failing', restored: r?.restored ?? [], passed: r?.passed ?? false })
  tests = await runTests('npm test after restore')
}

// ── Proposals ───────────────────────────────────────────────────────────────
phase('Proposals')
if (history.length > 1 || !tests.passed || halted) {
  await omAgent('om-self-upgrader', `Read state/self-heal/${PFX}-R*.md, state/self-debug.json and the failing tests (${tests.failing.join(', ') || 'none'}). When a cause recurs or a fix was blocked, write a proposal to proposals/${PFX}.md: the structural change to tools/, the roster or a workflow that would prevent it, and its test. Proposals only; the owner applies them with /om upgrade. ${GUARDS}`,
    { label: 'self-upgrader', phase: 'Proposals' })
} else log('No recurring causes; no proposal needed')

// ── Report ──────────────────────────────────────────────────────────────────
phase('Report')
const report = await omAgent('om-reporter', `Write state/self-heal/${PFX}.md in at most 20 lines: workspaces checked (${slugs.join(', ')}) and what the ops doctor repaired or left open, self-debug rounds and their review verdicts, the final test result (${tests.summary}), any halt (${halted ?? 'none'}), any restore from the backups (${restores.map((x) => `R${x.rounds.join('+')} ${x.why}: suite ${x.passed ? 'pass' : 'fail'}`).join('; ') || 'none'}), and any proposal waiting in proposals/. Then run \`node tools/build-state.mjs\`. Return the report text.`,
  { label: 'reporter', phase: 'Report' })

return { workflow: NAME, workspaces: doctor.filter(Boolean), rounds: history, selfDebugOk: sd.ok, halted, restores, tests, report }
