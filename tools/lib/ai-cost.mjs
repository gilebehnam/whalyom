// AI cost tier: which Claude model each agent actually runs on. The roster keeps the model each agent was
// designed for (opus for department heads, sonnet for specialists, haiku for micro agents); the tier in
// config/ai-cost.json maps that to the model written into .claude/agents/*.md by tools/build-agents.mjs.
//   max       designed models (highest quality, highest cost)
//   standard  department heads on sonnet, the rest as designed
//   economy   one step down: opus → sonnet, sonnet → haiku (about 10–20x cheaper per task)
//   minimal   everything on haiku
// Agents in "keep" (the guards: compliance, red team, fact checking, code fixes) never drop below sonnet
// in any tier except minimal, so cheaper runs never mean weaker checks on what goes out.
import fs from 'node:fs';
import path from 'node:path';
import { root } from './env.mjs';

export const TIERS = {
  max: { opus: 'opus', sonnet: 'sonnet', haiku: 'haiku' },
  standard: { opus: 'sonnet', sonnet: 'sonnet', haiku: 'haiku' },
  economy: { opus: 'sonnet', sonnet: 'haiku', haiku: 'haiku' },
  minimal: { opus: 'haiku', sonnet: 'haiku', haiku: 'haiku' },
};
export const DEFAULT_KEEP = ['om-compliance-guard', 'om-red-team', 'om-fact-verifier', 'om-bug-hunter', 'om-editor', 'om-claim-substantiator'];
const RANK = { haiku: 0, sonnet: 1, opus: 2 };

export function loadCostConfig(file = path.join(root, 'config', 'ai-cost.json')) {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { c = {}; }
  const tier = TIERS[c.tier] ? c.tier : 'economy';
  return { tier, keep: Array.isArray(c.keep) ? c.keep : DEFAULT_KEEP, overrides: c.overrides && typeof c.overrides === 'object' ? c.overrides : {} };
}

// The model an agent runs on under the configured tier.
export function modelFor(agent, cfg = loadCostConfig()) {
  if (cfg.overrides[agent.name] && RANK[cfg.overrides[agent.name]] !== undefined) return cfg.overrides[agent.name];
  const designed = RANK[agent.model] !== undefined ? agent.model : 'sonnet';
  const mapped = TIERS[cfg.tier][designed];
  if (cfg.tier !== 'minimal' && cfg.keep.includes(agent.name) && RANK[mapped] < RANK.sonnet) return RANK[designed] >= RANK.sonnet ? 'sonnet' : designed;
  return mapped;
}
