// Briefs that cross roster files: opt-outs reach every message drafter, the CPA kill switch can run,
// the deal desk owns a named file behind an owner approval, and overlapping sales agents know where
// their job stops. Run alone with: node --test tools/test/roster-briefs.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { roster } from '../roster.mjs';
import { buildPalette } from '../palette.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const agent = (name) => {
  const a = roster.find((x) => x.name === name);
  assert.ok(a, `${name} is in the roster`);
  return a;
};
// The generated file is checked once build-agents has run after the roster change; a stale file
// (its Inputs list differs from the roster) is reported, not failed, because build-agents owns it.
const generated = (t, a) => {
  const file = path.join(root, '.claude', 'agents', `${a.name}.md`);
  if (!fs.existsSync(file)) return null;
  const md = fs.readFileSync(file, 'utf8');
  const inputs = md.split('## Inputs (relative to the workspace)\n')[1]?.split('\n\n')[0] ?? '';
  if (inputs !== a.reads.map((r) => `- \`${r}\``).join('\n')) { t.diagnostic(`${a.name}.md is stale: run node tools/build-agents.mjs`); return null; }
  return md;
};

test('opt-outs in sales/suppression.md reach every agent that drafts messages to people', (t) => {
  for (const name of ['om-sdr', 'om-speed-to-lead', 'om-follow-up', 'om-cold-outbound', 'om-cart-recovery', 'om-winback', 'om-email-nurture', 'om-reply-handler']) {
    const a = agent(name);
    assert.ok(a.reads.includes('sales/suppression.md'), `${name} reads sales/suppression.md`);
    if (name !== 'om-reply-handler') assert.match(a.notes, /drop every address or domain listed in sales\/suppression\.md/, `${name} drops opt-outs`);
    const md = generated(t, a);
    if (md) assert.match(md, /sales\/suppression\.md/, `${name}.md mentions the suppression list`);
  }
});

test('om-cpa-guard can run the kill switch and keeps its wave-1 color', () => {
  const a = agent('om-cpa-guard');
  assert.match(a.tools, /\bBash\b/);
  assert.ok(a.reads.some((r) => r.startsWith('metrics/')), 'reads metrics/ (killswitch reads metrics/kpis.json)');
  assert.match(a.notes, /killswitch\.mjs/);
  assert.match(a.notes, /variant_kill_spend/);
  assert.match(a.notes, /never raise a budget or resume a variant/);
  // Object form inside `extra` keeps it a wave-1 agent, so roster.test.mjs's "wave-1 agents keep base
  // tones" still holds and its base tone (id 133, as before the move) does not change.
  assert.equal(a.wave, undefined, 'stays a wave-1 agent');
  assert.equal(a.colorId, 133, 'color unchanged');
  assert.equal(buildPalette()[133].hex, a.color);
});

test('om-deal-desk writes sales/deal-desk.md as a price approval, and every agent that applies it reads it', () => {
  const desk = agent('om-deal-desk');
  assert.ok(desk.writes.includes('sales/deal-desk.md'));
  assert.match(desk.notes, /"?price"? approval/);
  assert.match(desk.notes, /default none/);
  const users = roster.filter((a) => /deal-desk/.test(`${a.does} ${a.notes}`));
  assert.ok(users.length >= 4, `${users.length} agents name the deal desk`);
  for (const a of users) assert.ok(a.reads.includes('sales/deal-desk.md') || a.reads.includes('sales/'), `${a.name} reads the deal-desk rules`);
  for (const name of ['om-checkout-finisher', 'om-proposal-pricer', 'om-mega-closer']) assert.ok(agent(name).reads.includes('sales/deal-desk.md'), name);
});

test('overlapping sales agents name each other and where their job stops', () => {
  for (const [x, y] of [['om-sdr', 'om-speed-to-lead'], ['om-follow-up', 'om-cart-recovery'], ['om-lead-scorer', 'om-lead-router']]) {
    assert.ok(agent(x).notes.includes(y), `${x} notes name ${y}`);
    assert.ok(agent(y).notes.includes(x), `${y} notes name ${x}`);
  }
  const scorer = agent('om-lead-scorer');
  assert.ok(!scorer.writes.includes('research/cro/'), 'om-lead-scorer no longer keeps conversion-pod outputs');
  assert.deepEqual(scorer.writes, ['sales/lead-score.md']);
  for (const r of ['research/icp.md', 'funnel/', 'sales/']) assert.ok(scorer.reads.includes(r), `om-lead-scorer reads ${r}`);
  assert.equal(scorer.dept, 'leadgen');
});
