// Roster invariants: names, departments, layers, pods, tools, palette colors, generated agent files
// and the micro-agent factory. Run alone with: node --test tools/test/roster.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { roster, pods, DEPARTMENTS, LAYERS } from '../roster.mjs';
import { wave2 } from '../roster-extra.mjs';
import { buildPalette, BASE_SIZE } from '../palette.mjs';
import { buildInstances, instanceFor, MARKETS } from '../agent-factory.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODELS = new Set(['haiku', 'sonnet', 'opus']);

test('every agent has a unique om-* name and the required fields', () => {
  const names = roster.map((a) => a.name);
  assert.equal(new Set(names).size, names.length, 'agent names are unique');
  for (const a of roster) {
    assert.match(a.name, /^om-[a-z0-9-]+$/, a.name);
    assert.ok(a.title && a.title.length > 2, `${a.name} title`);
    assert.ok(a.does && a.does.length > 30 && a.does.endsWith('.'), `${a.name} one-line description`);
    assert.ok(MODELS.has(a.model), `${a.name} model ${a.model}`);
    assert.ok(Array.isArray(a.skills), `${a.name} skills`);
    assert.ok(Array.isArray(a.reads) && a.reads.length, `${a.name} reads`);
    assert.ok(Array.isArray(a.writes) && a.writes.length, `${a.name} writes`);
    assert.ok(a.tools.startsWith('Read, Write, Edit, Glob, Grep'), `${a.name} tools`);
    if (a.skills.length) assert.match(a.tools, /\bSkill\b/, `${a.name} lists skills but cannot invoke the Skill tool`);
  }
});

test('every agent sits in a known pod, department and layer', () => {
  for (const a of roster) {
    assert.ok(pods[a.pod], `${a.name} pod ${a.pod}`);
    assert.ok(DEPARTMENTS[a.dept], `${a.name} dept ${a.dept}`);
    assert.ok(Number.isInteger(a.layer) && a.layer >= 1 && a.layer <= 6 && LAYERS[a.layer], `${a.name} layer ${a.layer}`);
  }
  assert.equal(Object.keys(DEPARTMENTS).length, 28, 'twenty-eight departments: the original thirteen, the nine of wave 9 and the six of wave 10');
  assert.equal(Object.keys(LAYERS).length, 6, 'six layers');
  for (const d of Object.keys(DEPARTMENTS)) assert.ok(roster.some((a) => a.dept === d), `department ${d} has agents`);
  for (const l of Object.keys(LAYERS)) assert.ok(roster.some((a) => a.layer === Number(l)), `layer ${l} has agents`);
});

test('wave 2 adds distinct agents with their own brief', () => {
  assert.ok(wave2.length >= 60 && wave2.length <= 100, `${wave2.length} wave-2 agents`);
  const tagged = roster.filter((a) => a.wave === 2);
  assert.equal(tagged.length, wave2.length);
  const titles = roster.map((a) => a.title.toLowerCase());
  assert.equal(new Set(titles).size, titles.length, 'titles are unique, so no renamed duplicates');
  for (const a of tagged) {
    assert.ok(a.notes && a.notes.length > 60, `${a.name} has a precise prompt body`);
    assert.ok(a.skills.length >= 1, `${a.name} names at least one method skill`);
  }
  for (const code of ['de', 'fr', 'es', 'ptbr', 'ja', 'ar', 'tr', 'it']) assert.ok(roster.some((a) => a.name === `om-l10n-${code}`), `localizer ${code}`);
  for (const e of ['chatgpt', 'perplexity', 'gemini', 'copilot']) assert.ok(roster.some((a) => a.name === `om-aeo-${e}`), `answer-engine optimizer ${e}`);
});

test('agents never write the ledgers except through their result file', () => {
  // The ledgers may appear in writes (build-agents marks them "through your result file"), but no
  // agent may be told to edit them directly in its brief.
  for (const a of roster) {
    assert.doesNotMatch(`${a.does} ${a.notes}`, /\bedit (tasks|approvals|experiments)\.json/i, a.name);
  }
});

test('palette: 300 unique colors, base 200 unchanged in shape', () => {
  const p = buildPalette();
  assert.equal(BASE_SIZE, 200);
  assert.ok(p.length >= roster.length, `palette ${p.length} covers ${roster.length} agents`);
  assert.equal(new Set(p.map((c) => c.hex)).size, p.length, 'every palette color is unique');
  p.forEach((c, i) => assert.equal(c.id, i));
  assert.ok(p.slice(0, BASE_SIZE).every((c) => !c.extension && Number.isInteger(c.tone)));
  assert.ok(p.slice(BASE_SIZE).every((c) => c.extension));
  for (const c of p) assert.match(c.hex, /^#[0-9a-f]{6}$/);
});

test('every agent has its own palette color; wave-1 agents keep base tones in department order', () => {
  const hex = roster.map((a) => a.color);
  assert.equal(new Set(hex).size, roster.length, 'agent colors are unique');
  const p = buildPalette();
  const deptOrder = Object.keys(DEPARTMENTS);
  // Agents that wave 9 moved keep the color of the department they were painted in (homeDept).
  const pd = (a) => a.homeDept ?? a.dept;
  const first = roster.filter((a) => !a.wave).sort((x, y) => deptOrder.indexOf(pd(x)) - deptOrder.indexOf(pd(y)) || x.name.localeCompare(y.name));
  first.forEach((a, i) => assert.equal(a.color, p[i].hex, `${a.name} keeps its original color`));
  for (const a of roster) assert.equal(p[a.colorId].hex, a.color);
});

test('config/agent-palette.json matches the palette', () => {
  const file = JSON.parse(fs.readFileSync(path.join(root, 'config', 'agent-palette.json'), 'utf8'));
  assert.deepEqual(file.colors.map((c) => c.hex), buildPalette().map((c) => c.hex));
});

test('generated agent files exist for exactly the roster', () => {
  const dir = path.join(root, '.claude', 'agents');
  const files = fs.readdirSync(dir).filter((f) => f.startsWith('om-') && f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
  assert.deepEqual(files, roster.map((a) => a.name).sort(), 'run node tools/build-agents.mjs after editing the roster');
  const sample = fs.readFileSync(path.join(dir, 'om-l10n-ja.md'), 'utf8');
  assert.match(sample, /^---\nname: om-l10n-ja\n/);
  assert.match(sample, /runs\/<task-id>\.json/);
  assert.match(sample, /Do not publish, post, send or spend anything/);
});

test('micro-agent factory covers wave 2 with channel and market instances', () => {
  const all = buildInstances();
  assert.equal(new Set(all.map((i) => i.id)).size, all.length, 'instance ids are unique');
  assert.ok(all.some((i) => i.id === 'om-capi-planner::meta-capi'));
  assert.ok(all.some((i) => i.id === 'om-ppp-pricing::saas::pt-br'));
  for (const a of roster) assert.ok(all.some((i) => i.agent === a.name), `${a.name} has an instance`);
  assert.equal(instanceFor({ preset: 'saas', market: ['BR', 'US'] }, 'om-ppp-pricing').market, 'pt-br');
  assert.equal(instanceFor({ preset: 'saas', market: ['US'] }, 'om-ppp-pricing').market, null);
  assert.equal(instanceFor({ preset: 'saas', market: ['DE'] }, 'om-google-ads', 'search').id, 'om-google-ads::saas::search');
  assert.ok(MARKETS.includes('ja'));
});

test('wave 3: mega agents head every department, micro agents are narrow, knowledge team exists', async () => {
  const { wave3 } = await import('../roster-wave3.mjs');
  const { packFor, knowledgeFor } = await import('../skill-packs.mjs');
  assert.equal(roster.filter((a) => a.wave === 3).length, wave3.length);
  const mega = roster.filter((a) => a.tier === 'mega');
  const micro = roster.filter((a) => a.tier === 'micro');
  for (const d of Object.keys(DEPARTMENTS)) assert.ok(mega.some((a) => a.name === `om-mega-${d}`), `mega head for ${d}`);
  for (const a of mega) {
    assert.equal(a.model, 'opus', a.name);
    assert.ok(a.spans.length >= 2 && a.spans.every((d) => DEPARTMENTS[d]), `${a.name} spans departments`);
    assert.ok(packFor(a).length >= 30, `${a.name} masters a large skill library (${packFor(a).length})`);
    assert.match(fs.readFileSync(path.join(root, '.claude', 'agents', `${a.name}.md`), 'utf8'), /## Your department\n/);
  }
  assert.ok(micro.length >= 40, `${micro.length} micro agents`);
  for (const a of micro) {
    assert.equal(a.model, 'haiku', a.name);
    assert.ok(a.skills.length >= 1 && a.skills.length <= 3, `${a.name} has 1–3 method skills`);
    assert.match(a.notes, /^Single job/, a.name);
  }
  for (const n of ['om-knowledge-scout', 'om-fact-verifier', 'om-knowledge-curator', 'om-skill-smith', 'om-evolution-director', 'om-regulation-watcher', 'om-research-reader']) assert.ok(roster.some((a) => a.name === n), n);
  const core = roster.filter((a) => a.tier === 'core');
  const avg = core.reduce((n, a) => n + packFor(a).length + knowledgeFor(a).length + a.skills.length, 0) / core.length;
  assert.ok(avg >= 20, `core agents average ${avg.toFixed(1)} skills`);
  const sample = fs.readFileSync(path.join(root, '.claude', 'agents', 'om-google-ads.md'), 'utf8');
  assert.match(sample, /knowledge\/briefs\/paid\.md/);
  assert.match(sample, /## Current knowledge\n[\s\S]*om-knowledge-paid-search/);
  assert.match(sample, /knowledge_tips/);
});

test('wave 4: the AI Lab was built in ten rounds, each with its gap, and masters the AI skill pack', async () => {
  const { wave4, rounds } = await import('../roster-wave4.mjs');
  const { packFor, knowledgeFor, PACKS } = await import('../skill-packs.mjs');
  assert.deepEqual(rounds.map((r) => r.round), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const r of rounds) {
    assert.ok(r.theme && r.gap && r.gap.length > 40, `round ${r.round} names the gap it fills`);
    assert.ok(wave4.filter((a) => a.round === r.round).length >= 5, `round ${r.round} adds at least 5 agents`);
  }
  const lab = roster.filter((a) => a.wave === 4);
  assert.equal(lab.length, wave4.length);
  for (const a of lab) {
    assert.equal(a.pod, 'ai', a.name);
    assert.ok(a.notes.length > 60, `${a.name} has a precise brief`);
    for (const s of PACKS.ai) assert.ok(packFor(a).includes(s) || a.skills.includes(s), `${a.name} masters ${s}`);
    assert.ok(knowledgeFor(a).includes('om-knowledge-ai-tech'), `${a.name} reads current AI knowledge`);
  }
  for (const n of ['om-prompt-injection-sentinel', 'om-agent-permission-warden', 'om-ai-output-auditor', 'om-propensity-modeler', 'om-first-party-data-architect', 'om-consulting-partner']) assert.ok(roster.some((a) => a.name === n), n);
  for (const s of ['om-ai-agent-blueprint', 'om-ai-evals', 'om-ai-guardrails', 'om-ai-cost-routing', 'om-agentic-commerce', 'om-ai-content-provenance', 'om-llm-visibility-lab', 'om-ai-personalization']) {
    assert.match(fs.readFileSync(path.join(root, '.claude', 'skills', s, 'SKILL.md'), 'utf8'), new RegExp(`^---\\nname: ${s}\\ndescription: "`), s);
  }
  for (const a of roster.filter((x) => x.wave === 3)) assert.ok(a.colorId < 380, `${a.name} keeps a wave-3 color`);
});

test('wave 5: the Strategy Consulting Practice masters the consulting canon', async () => {
  const { wave5, alsoConsulting } = await import('../roster-wave5.mjs');
  const { packFor, knowledgeFor, PACKS } = await import('../skill-packs.mjs');
  const practice = roster.filter((a) => a.wave === 5);
  assert.equal(practice.length, wave5.length);
  assert.ok(practice.length >= 15);
  for (const a of [...practice, ...roster.filter((x) => alsoConsulting.includes(x.name))]) {
    for (const s of PACKS.consulting) assert.ok(packFor(a).includes(s) || a.skills.includes(s), `${a.name} masters ${s}`);
    assert.ok(knowledgeFor(a).includes('om-knowledge-management-canon'), `${a.name} reads the management canon`);
  }
  for (const a of practice) assert.equal(a.pod, 'consulting', a.name);
  assert.equal(alsoConsulting.filter((n) => roster.some((a) => a.name === n)).length, alsoConsulting.length);
  for (const s of ['om-consulting-canon', 'om-problem-solving', 'om-exec-storyline']) {
    assert.match(fs.readFileSync(path.join(root, '.claude', 'skills', s, 'SKILL.md'), 'utf8'), new RegExp(`^---\\nname: ${s}\\ndescription: "`), s);
  }
  for (const a of roster.filter((x) => x.wave === 4)) assert.ok(a.colorId < 480, `${a.name} keeps a wave-4 color`);
});

test('wave 7: the Commerce & Growth Frontier fills named gaps and masters the frontier pack', async () => {
  const { wave7, alsoFrontier, groups } = await import('../roster-wave7.mjs');
  const { packFor, knowledgeFor, PACKS } = await import('../skill-packs.mjs');
  const { TOPICS } = await import('../knowledge/topics.mjs');
  const front = roster.filter((a) => a.wave === 7);
  assert.equal(front.length, wave7.length);
  assert.ok(front.length >= 15, `${front.length} frontier agents`);
  for (const g of groups) assert.ok(g.gap.length > 60, `group ${g.id} names its gap`);
  for (const t of ['retail-media', 'video-ctv', 'brand-science', 'plg', 'partnerships']) assert.ok(TOPICS[t], `topic ${t}`);
  for (const a of [...front, ...roster.filter((x) => alsoFrontier.includes(x.name))]) {
    for (const s of PACKS.frontier) assert.ok(packFor(a).includes(s) || a.skills.includes(s), `${a.name} masters ${s}`);
    if (a.tier !== 'micro') for (const k of ['om-knowledge-retail-media', 'om-knowledge-brand-science', 'om-knowledge-plg']) assert.ok(knowledgeFor(a).includes(k), `${a.name} reads ${k}`);
  }
  for (const a of front) {
    assert.ok(a.notes.length > 60, `${a.name} has a precise brief`);
    assert.ok(a.pod === 'frontier' || a.tier === 'mega', a.name);
  }
  assert.equal(alsoFrontier.filter((n) => roster.some((a) => a.name === n)).length, alsoFrontier.length);
  const head = roster.find((a) => a.name === 'om-mega-commerce');
  assert.equal(head.tier, 'mega'); assert.equal(head.model, 'opus');
  for (const s of ['om-retail-media', 'om-social-commerce', 'om-ctv-programmatic', 'om-brand-growth-science', 'om-plg-playbook', 'om-partner-ecosystems', 'om-green-claims']) {
    assert.match(fs.readFileSync(path.join(root, '.claude', 'skills', s, 'SKILL.md'), 'utf8'), new RegExp(`^---\\nname: ${s}\\ndescription: "`), s);
  }
  for (const a of roster.filter((x) => x.wave === 5)) assert.ok(a.colorId < 480, `${a.name} keeps a wave-5 color`);
  for (const a of front) assert.ok(a.colorId < 580, `${a.name} takes a color that existed when wave 7 arrived`);
});

test('wave 2 colors did not move when wave 3 arrived', () => {
  for (const a of roster.filter((x) => x.wave === 2)) assert.ok(a.colorId < 300, `${a.name} stays in the first 300 colors`);
  for (const a of roster.filter((x) => x.wave === 3)) assert.ok(!roster.some((b) => b !== a && b.colorId === a.colorId), a.name);
});

test('wave 9: nine specialist departments, each with a head, specialists and briefs', async () => {
  const { NEW_DEPARTMENTS, groups, moves, wave9 } = await import('../roster-wave9.mjs');
  const { packFor, knowledgeFor } = await import('../skill-packs.mjs');
  assert.equal(Object.keys(NEW_DEPARTMENTS).length, 9);
  assert.deepEqual(groups.map((g) => g.id).sort(), Object.keys(NEW_DEPARTMENTS).sort(), 'every new department names its gap');
  assert.equal(roster.filter((a) => a.wave === 9).length, wave9.length);
  for (const d of Object.keys(NEW_DEPARTMENTS)) {
    const members = roster.filter((a) => a.dept === d);
    assert.ok(members.length >= 10, `${d} has ${members.length} agents`);
    assert.ok(members.some((a) => a.name === `om-mega-${d}` && a.spans.includes(d)), `${d} has its head`);
    assert.ok(members.filter((a) => a.tier === 'core').every((a) => packFor(a).length >= 15 && knowledgeFor(a).length >= 1), `${d} specialists master a pack and current knowledge`);
    assert.ok(fs.existsSync(path.join(root, 'knowledge', 'briefs', `${d}.md`)), `knowledge/briefs/${d}.md`);
  }
  for (const [name, d] of Object.entries(moves)) {
    const a = roster.find((x) => x.name === name);
    assert.ok(a, `${name} exists`); assert.equal(a.dept, d, name);
    assert.ok(!a.homeDept || a.packs.includes(a.homeDept), `${name} keeps its old department's pack`);
  }
  assert.equal(new Set(roster.map((a) => a.colorId)).size, roster.length, 'every agent keeps its own color');
  for (const a of roster.filter((x) => x.wave === 9)) assert.ok(a.colorId < 580, `${a.name} color ${a.colorId}`);
});

test('reviewers write their verdicts to a REVIEW file, never to the ledger or the drafts', () => {
  // apply-results.mjs takes compliance verdicts only from runs/REVIEW-*.json written by these agents.
  for (const name of ['om-compliance-guard', 'om-micro-claim-check']) {
    const a = roster.find((x) => x.name === name);
    assert.ok(a, name);
    assert.match(a.notes, /runs\/REVIEW-/, `${name} names the REVIEW file`);
    assert.ok(!a.writes.includes('outbox/') && !a.writes.includes('approvals.json'), `${name} writes ${a.writes}`);
  }
  assert.match(fs.readFileSync(path.join(root, '.claude', 'agents', 'om-compliance-guard.md'), 'utf8'), /REVIEW-/);
});

test('paid agents and the sponsorship buyer read the caps and route spend through approvals', () => {
  const spenders = roster.filter((a) => (a.dept === 'paid' && a.tier !== 'micro') || a.name === 'om-sponsorship-buyer');
  assert.ok(spenders.some((a) => a.name === 'om-sponsorship-buyer') && spenders.length > 10, `${spenders.length} spenders`);
  for (const a of spenders) {
    assert.ok(a.reads.includes('product.json'), `${a.name} reads product.json`);
    assert.match(a.notes, /monthly_cap|daily_cap/, `${a.name} names the caps`);
    assert.match(a.notes, /approval/, `${a.name} routes spend through an approval`);
  }
});

test('the evaluator scores through the evaluations array, not by editing tasks or learnings', () => {
  const a = roster.find((x) => x.name === 'om-evaluator');
  assert.match(a.notes, /"?evaluations"?/);
  assert.ok(!a.writes.includes('LEARNINGS.md'), 'om-learner owns LEARNINGS.md');
  assert.match(fs.readFileSync(path.join(root, '.claude', 'agents', 'om-evaluator.md'), 'utf8'), /evaluations/);
});

test('delegating agents use outcome routing from state/agent-routing.json', () => {
  const megas = roster.filter((a) => a.tier === 'mega');
  assert.ok(megas.length >= 16, `${megas.length} mega heads`);
  for (const a of [roster.find((x) => x.name === 'om-cmo'), roster.find((x) => x.name === 'om-evolution-director'), ...megas]) {
    assert.ok(a, 'agent exists');
    assert.ok(a.reads.includes('../../state/agent-routing.json'), `${a.name} reads the routing file`);
    assert.match(a.notes, /agent-routing\.json/, `${a.name} names the routing file`);
    assert.match(a.notes, /proven results/, `${a.name} prefers proven agents`);
    assert.match(a.notes, /improve_or_retire/, `${a.name} treats improve-or-retire as evolution targets`);
    assert.match(a.notes, /advisory/, `${a.name} keeps routing advisory`);
  }
  assert.match(roster.find((x) => x.name === 'om-evolution-director').notes, /node tools\/evolve\.mjs apply/);
  const plain = roster.filter((x) => x.tier !== 'mega' && x.name !== 'om-cmo' && x.name !== 'om-evolution-director');
  for (const a of plain) assert.doesNotMatch(a.notes, /Outcome routing:/, `${a.name} is not a delegator`);
  assert.match(fs.readFileSync(path.join(root, '.claude', 'agents', 'om-cmo.md'), 'utf8'), /agent-routing\.json/);
});
