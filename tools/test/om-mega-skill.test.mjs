import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const skill = readFileSync(join(root, '.claude/skills/om-mega/SKILL.md'), 'utf8');

test('om-mega autopilot step uses live `om auto`, batch only on request or schedule', () => {
  const step = skill.split('\n').find((l) => l.startsWith('3. **Autopilot'));
  assert.ok(step, 'autopilot step exists');
  assert.match(step, /`om auto <slug>`/);
  assert.match(step, /live mode/);
  assert.doesNotMatch(step, /^3\. \*\*Autopilot:\*\* run the `om-autopilot` workflow\.$/);
  assert.match(step, /--batch/);
  assert.match(step, /scheduled run/);
});

test('om-mega runs policy then execute after the autopilot', () => {
  const a = skill.indexOf('**Autopilot');
  const p = skill.indexOf('node tools/policy.mjs <slug>');
  const e = skill.indexOf('node tools/execute.mjs <slug>');
  assert.ok(a >= 0 && p > a && e > p, 'policy after autopilot, execute after policy');
  assert.match(skill, /OM_KILL=1/);
  assert.match(skill, /autonomy\.kill/);
});

test('onboarding approval remains the only owner stop and guards are kept', () => {
  assert.match(skill, /This is the only stop in the pipeline\./);
  assert.match(skill, /nothing is published, sent or paid for without the owner's approval/);
  assert.match(skill, /spend never goes over the caps/);
});
