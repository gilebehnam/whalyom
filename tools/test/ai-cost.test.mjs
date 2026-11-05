// AI cost tiers: the model each agent runs on comes from config/ai-cost.json, the guards never drop below
// sonnet (except in minimal), and the built agent files follow the configured tier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { modelFor, loadCostConfig, DEFAULT_KEEP } from '../lib/ai-cost.mjs';
import { roster } from '../roster.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cfg = (tier, extra = {}) => ({ tier, keep: DEFAULT_KEEP, overrides: {}, ...extra });

test('tiers map designed models down, keep guards on sonnet, honour overrides', () => {
  const head = { name: 'om-mega-seo', model: 'opus' };
  const spec = { name: 'om-writer', model: 'sonnet' };
  const micro = { name: 'om-micro-slug', model: 'haiku' };
  const guard = { name: 'om-compliance-guard', model: 'sonnet' };
  assert.deepEqual([head, spec, micro, guard].map((a) => modelFor(a, cfg('max'))), ['opus', 'sonnet', 'haiku', 'sonnet']);
  assert.deepEqual([head, spec, micro, guard].map((a) => modelFor(a, cfg('economy'))), ['sonnet', 'haiku', 'haiku', 'sonnet']);
  assert.equal(modelFor(guard, cfg('minimal')), 'haiku');
  assert.equal(modelFor(spec, cfg('economy', { overrides: { 'om-writer': 'sonnet' } })), 'sonnet');
  assert.equal(modelFor({ name: 'om-red-team', model: 'opus' }, cfg('economy')), 'sonnet', 'a guard designed on opus stays at least sonnet');
});

test('the built agent files follow the configured tier', () => {
  const c = loadCostConfig();
  for (const name of ['om-mega-seo', 'om-writer', 'om-compliance-guard', 'om-micro-slug']) {
    const a = roster.find((x) => x.name === name);
    const file = fs.readFileSync(path.join(root, '.claude', 'agents', `${name}.md`), 'utf8');
    assert.match(file, new RegExp(`\\nmodel: ${modelFor(a, c)}\\n`), `${name} runs on ${modelFor(a, c)} under tier ${c.tier}`);
  }
});
