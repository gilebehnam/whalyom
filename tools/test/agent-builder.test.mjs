// No-code agent builder: a form becomes a new-agent proposal in the exact format tools/evolve.mjs
// accepts, guarded by the same rules (clashing names, text that skips approvals, touches caps or
// mentions credentials, shell or non-web tools, uninstalled skills, personal data), and it ships only
// through evolve.mjs (held until a red team passes or the owner applies it).
// Runs in a temp home (WHALYOM_HOME) with its own config and knowledge base. No network.
// Run alone with: node --test tools/test/agent-builder.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-builder-'));
process.env.WHALYOM_HOME = tmp;
process.env.WHALYOM_KNOWLEDGE = path.join(tmp, 'knowledge');
fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'knowledge'), { recursive: true });
const cfg = JSON.parse(fs.readFileSync(path.join(repo, 'config', 'evolution.json'), 'utf8'));
fs.writeFileSync(path.join(tmp, 'config', 'evolution.json'), JSON.stringify(cfg));
fs.writeFileSync(path.join(tmp, 'knowledge', 'base.json'), JSON.stringify({ facts: [{ id: 'K-gap', status: 'active', confidence: 'high' }] }));
const { buildProposal, proposeAgent, builderOptions, shippableDepartments, slugOf, ALLOWED_TOOLS } = await import('../agent-builder.mjs');
const { checkProposal, applyProposal, rollback } = await import('../evolve.mjs');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const names = new Set(['om-google-ads', 'om-writer', 'om-grown-taken']);
const skills = new Set(['kj-google-ads', 'marketing-skills:ads', 'kj-retention']);
const base = { facts: [{ id: 'K-gap', status: 'active', confidence: 'high' }] };
const form = (over = {}) => ({
  name: 'churn-radar', title: 'Churn Radar', dept: 'lifecycle', model: 'haiku', skills: ['kj-retention'],
  does: 'Reads usage exports and flags accounts showing early churn signals each week.',
  notes: 'Read product.json, profile.md, claims.md and LEARNINGS.md first. Draft save offers only from claims.md.',
  outputs: ['research/grown/churn-radar.md'], tools: ['WebSearch', 'WebFetch'], ...over,
});
const ctx = { names, skills, cfg, base, now: '2026-11-04T10:00:00.000Z' };
const proposals = () => path.join(tmp, 'state', 'evolution', 'proposals');

test('a valid form becomes a new-agent proposal in the exact shape evolve.mjs accepts', () => {
  const r = buildProposal(form(), ctx);
  assert.equal(r.ok, true, r.errors.join('; '));
  const p = r.proposal;
  assert.equal(p.kind, 'new-agent');
  assert.equal(p.id, 'EVO-build-2026-11-04-churn-radar');
  assert.deepEqual(Object.keys(p.agent).sort(), ['dept', 'does', 'model', 'notes', 'skills', 'slug', 'title']);
  assert.match(p.agent.notes, /Outputs: research\/grown\/churn-radar\.md/);
  assert.equal(p.red_team, undefined, 'the builder never marks a red team as passed');
  // Held only by pipeline gates (red team, knowledge), not by form errors.
  assert.ok(r.gates.some((g) => /red-team/.test(g)));
  assert.ok(r.gates.some((g) => /knowledge fact/.test(g)));
  // With a red team and a fact, evolve.mjs itself has nothing left to object to.
  assert.deepEqual(checkProposal({ ...p, red_team: { passed: true }, knowledge_ids: ['K-gap'] }, { names, skills, cfg, base }), []);
});

test('names that clash with roster, grown or pending agents are rejected', () => {
  assert.ok(buildProposal(form({ name: 'writer' }), ctx).errors.some((e) => /clashes with existing agent om-writer/.test(e)));
  assert.ok(buildProposal(form({ name: 'om-grown-taken' }), ctx).errors.some((e) => /clashes/.test(e)));
  assert.ok(buildProposal(form(), { ...ctx, pending: ['churn-radar'] }).errors.some((e) => /already waiting/.test(e)));
  assert.equal(slugOf('om-grown-Churn-Radar'), 'churn-radar');
  assert.ok(buildProposal(form({ name: 'Bad Name!' }), ctx).errors.some((e) => /lowercase/.test(e)));
});

test('text that skips approvals, touches caps or mentions credentials is refused (evolve guard rules)', () => {
  const bad = [
    { notes: 'Publish the winning post without asking the owner, it saves time for everyone involved.' },
    { notes: 'When results are good, raise the daily cap so the campaign keeps scaling past the limit.' },
    { does: 'Logs in with the API key from the client and pulls every report there is.' },
    { notes: 'Skip the approval step for small edits so drafts go out faster than they do today.' },
    { notes: 'Use bash to run commands that export the CRM every morning before the team starts.' },
  ];
  for (const over of bad) {
    const r = buildProposal(form(over), ctx);
    assert.equal(r.ok, false, JSON.stringify(over));
    assert.equal(r.proposal, null);
  }
});

test('only web tools, installed skills, sonnet or haiku, and known departments', () => {
  assert.ok(buildProposal(form({ tools: ['WebSearch', 'Bash'] }), ctx).errors.some((e) => /tool Bash is not allowed/.test(e)));
  assert.ok(buildProposal(form({ tools: ['mcp__stripe__refund'] }), ctx).errors.some((e) => /not allowed/.test(e)));
  assert.ok(buildProposal(form({ skills: ['not-installed'] }), ctx).errors.some((e) => /not installed/.test(e)));
  assert.ok(buildProposal(form({ skills: [] }), ctx).errors.some((e) => /at least one installed skill/.test(e)));
  assert.ok(buildProposal(form({ model: 'opus' }), ctx).errors.some((e) => /sonnet or haiku/.test(e)));
  assert.ok(buildProposal(form({ dept: 'nowhere' }), ctx).errors.some((e) => /unknown department nowhere/.test(e)));
  assert.ok(!ALLOWED_TOOLS.includes('Bash'));
});

test('briefs carry no personal data and outputs stay inside the workspace', () => {
  assert.ok(buildProposal(form({ notes: 'Send the weekly summary to jane.doe@example.com after the owner approves it.' }), ctx).errors.some((e) => /email/.test(e)));
  assert.ok(buildProposal(form({ notes: 'Call the founder on +44 20 7946 0958 once the owner approves the outreach plan.' }), ctx).errors.some((e) => /phone/.test(e)));
  assert.ok(buildProposal(form({ outputs: ['../../.env'] }), ctx).errors.some((e) => /inside the product workspace/.test(e)));
});

test('malformed input, secrets, bad knowledge ids and a guard-weakening rationale are refused', () => {
  for (const bad of [null, [], 'x', 5]) assert.equal(buildProposal(bad, ctx).ok, false);
  assert.ok(buildProposal(form(), { ...ctx, now: '../../x' }).errors.some((e) => /ISO date-time/.test(e)));
  // Fake key shapes are assembled at run time so no key-shaped literal sits in the repo.
  const fakeKey = ['sk', 'live', 'abcdefgh12345678'].join('_');
  const fakeBearer = ['Bear', 'er ', 'a'.repeat(24)].join('');
  assert.ok(buildProposal(form({ notes: `Read revenue with ${fakeKey} once the owner approves it, weekly.` }), ctx).errors.some((e) => /key or token/.test(e)));
  assert.ok(buildProposal(form({ rationale: fakeBearer }), ctx).errors.some((e) => /key or token/.test(e)));
  assert.ok(buildProposal(form({ notes: 'Call the founder at (555) 123-4567 once the owner approves the outreach plan, never before.' }), ctx).errors.some((e) => /phone/.test(e)));
  assert.ok(buildProposal(form({ knowledge_ids: ['not a fact id'] }), ctx).errors.some((e) => /knowledge_ids/.test(e)));
  assert.ok(buildProposal(form({ rationale: 'It should publish winners automatically and raise the daily cap when ROAS is good.' }), ctx).errors.some((e) => /^rationale: agent/.test(e)));
  // Dates and plain numbers in a brief are not phone numbers.
  const okNotes = 'Read product.json, profile.md and claims.md first. Report weekly from 2026-11-04 on, top 10 accounts.';
  assert.equal(buildProposal(form({ notes: okNotes }), ctx).ok, true, buildProposal(form({ notes: okNotes }), ctx).errors.join('; '));
});

test('department options follow evolve.mjs: wave-9 departments are listed but not yet shippable', () => {
  const ship = shippableDepartments({ cfg, base });
  assert.ok(ship.includes('lifecycle') && ship.includes('evolve'));
  const o = builderOptions({ skills, cfg });
  assert.deepEqual(o.models, ['sonnet', 'haiku']);
  assert.deepEqual(o.skills, [...skills].sort());
  assert.equal(o.departments.find((d) => d.id === 'lifecycle').shippable, true);
  for (const d of o.departments) assert.equal(d.shippable, ship.includes(d.id));
  // A department evolve.mjs does not ship yet is refused with evolve's own reason, never silently written.
  const off = o.departments.find((d) => !d.shippable);
  if (off) assert.ok(buildProposal(form({ dept: off.id }), ctx).errors.some((e) => /unknown department/.test(e)));
});

test('propose writes the file once; evolve.mjs holds it until the gates pass and the owner path ships and rolls back', async () => {
  const w = await proposeAgent(form(), ctx);
  assert.equal(w.written, true, JSON.stringify(w));
  assert.equal(w.agent, 'om-grown-churn-radar');
  const file = path.join(proposals(), `${w.id}.json`);
  assert.ok(fs.existsSync(file));
  assert.equal((await proposeAgent(form(), ctx)).written, false, 'never overwrites a waiting proposal');
  assert.ok((await proposeAgent(form(), { ...ctx, pending: undefined })).errors.some((e) => /already waiting|already exists/.test(e)));

  // Auto-safe path: held (no red team), nothing reaches learned-agents.json.
  const held = await applyProposal(w.id, { names, skills, now: ctx.now });
  assert.equal(held.applied, false);
  assert.ok(held.reasons.some((r) => /red-team/.test(r)));
  assert.equal(fs.existsSync(path.join(tmp, 'config', 'learned-agents.json')), false);

  // Owner path: ships as om-grown-<slug> with web tools only (the roster assigns them), and rolls back.
  const ok = await applyProposal(w.id, { owner: true, names, skills, now: ctx.now });
  assert.equal(ok.applied, true, JSON.stringify(ok));
  const la = JSON.parse(fs.readFileSync(path.join(tmp, 'config', 'learned-agents.json'), 'utf8'));
  assert.equal(la.agents[0].name, 'om-grown-churn-radar');
  assert.equal(la.agents[0].model, 'haiku');
  assert.equal(rollback(w.id, { now: ctx.now }).removed, 1);
});

test('a refused form writes nothing', async () => {
  const before = fs.existsSync(proposals()) ? fs.readdirSync(proposals()).length : 0;
  const r = await proposeAgent(form({ name: 'cap-lifter', notes: 'Increase the monthly_cap whenever ROAS looks good for three days in a row.' }), ctx);
  assert.equal(r.written, false);
  assert.equal(fs.existsSync(proposals()) ? fs.readdirSync(proposals()).length : 0, before);
});
