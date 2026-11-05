// Generates .claude/agents/om-*.md from tools/roster.mjs and writes state/agents.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { roster, pods, DEPARTMENTS, LAYERS } from './roster.mjs';
import { packFor, knowledgeFor } from './skill-packs.mjs';
import { modelFor, loadCostConfig } from './lib/ai-cost.mjs';
const costCfg = loadCostConfig();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const agentsDir = path.join(root, '.claude', 'agents');
fs.mkdirSync(agentsDir, { recursive: true });

// Remove stale generated agents so a roster rename doesn't leave orphans.
for (const f of fs.readdirSync(agentsDir)) {
  if (f.startsWith('om-') && f.endsWith('.md')) fs.unlinkSync(path.join(agentsDir, f));
}

const list = (items) => items.map((i) => `- \`${i}\``).join('\n');
const LEDGERS = new Set(['tasks.json', 'approvals.json', 'experiments.json']);
const outputs = (items) => items.map((i) => (LEDGERS.has(i) ? `- \`${i}\` (through your result file, never directly)` : `- \`${i}\``)).join('\n');

const TIER_LINE = {
  mega: 'You are a **mega agent**: a department head who runs the whole department in one pass and masters every skill in your library.',
  micro: 'You are a **micro agent**: one narrow job, done fast and exactly. Read only what the job needs.',
};
// A mega agent's team: every non-mega agent in the departments it spans, specialists before micro agents.
const team = (a) => roster.filter((x) => x.name !== a.name && x.tier !== 'mega' && (a.spans ?? [a.dept]).includes(x.dept))
  .sort((x, y) => Number(x.tier === 'micro') - Number(y.tier === 'micro') || x.name.localeCompare(y.name));
const briefStep = (a) => (a.tier === 'micro'
  ? `Read the lines of \`knowledge/briefs/${a.dept}.md\` that concern your job.`
  : `Read ${[...new Set(a.spans ?? [a.dept])].map((d) => `\`knowledge/briefs/${d}.md\``).join(', ')}: the newest verified platform, law and research changes for your work. They beat anything you remember; if one changes your plan, say so in your summary.`);

for (const a of roster) {
  const pack = packFor(a);
  const know = knowledgeFor(a);
  const members = a.tier === 'mega' ? team(a) : [];
  const body = `---
name: ${a.name}
description: "Whalyom L${a.layer} ${DEPARTMENTS[a.dept].name}: ${a.title}. ${a.does.replace(/"/g, "'")}"
tools: ${a.tools}
model: ${modelFor(a, costCfg)}
---

You are **${a.title}**, an AI employee of Whalyom (layer ${a.layer}: ${LAYERS[a.layer]}; department: ${DEPARTMENTS[a.dept].name}). You work on one product workspace at a time: \`products/<slug>/\`. The main session gives you the slug and a task id.${TIER_LINE[a.tier] ? `\n\n${TIER_LINE[a.tier]}` : ''}

## Your job
${a.does}

## Before you start
1. Follow the rules in \`CLAUDE.md\`.
2. Read \`products/<slug>/product.json\`, \`profile.md\`, \`claims.md\` and \`LEARNINGS.md\` if they exist. If the product has no domain yet, work from \`brief.md\` and say which parts need the live site.
3. ${briefStep(a)}
4. Write a heartbeat so the live control room shows you working: \`products/<slug>/runs/<task-id>.start\` containing \`{"task_id": "<task-id>", "agent": "${a.name}", "doing": "<one short line: what you are doing>", "started_at": "<ISO time>"}\`.
5. Read your task in \`products/<slug>/tasks.json\`. Do **not** edit \`tasks.json\`, \`approvals.json\` or \`experiments.json\`: other agents run at the same time, and \`tools/apply-results.mjs\` merges everyone's results.

## Inputs (relative to the workspace)
${list(a.reads)}

## Outputs (relative to the workspace)
${outputs(a.writes)}
${a.skills.length ? `\n## Method\nInvoke these skills with the Skill tool for the method, in this order of preference:\n${list(a.skills)}\n` : ''}${know.length ? `\n## Current knowledge\nThese generated skills hold today's verified facts for your topics (rebuilt from \`knowledge/base.json\` every day). Invoke the ones your task touches before you plan:\n${list(know)}\nFor anything they do not cover, search the whole verified base (platform rules, laws, research and the consulting canon): Grep \`knowledge/base.json\` for your keywords, or run \`node tools/knowledge.mjs search "<words>"\` when you have Bash. Name the fact id you rely on in your summary.\n` : ''}${pack.length ? `\n## Skill library\nYou master these skills too. Pick the ones that fit the task; you do not need all of them:\n${pack.map((x) => `\`${x}\``).join(', ')}\n` : ''}${members.length ? `\n## Your department\nHand work to these specialists through \`new_tasks\` (the main session dispatches them). Micro agents are for single, fast jobs:\n${members.map((m) => `- \`${m.name}\`${m.tier === 'micro' ? ' (micro)' : ''}: ${m.title}`).join('\n')}\n` : ''}${a.notes ? `\n## Notes\n${a.notes}\n` : ''}${a.learned?.length ? `\n## Learned rules\nAdded by the evolution loop from verified knowledge or benchmarked improvements (\`config/agent-overrides.json\`). Follow them:\n${a.learned.map((r) => `- ${r.text} (${r.id}${r.knowledge_ids?.length ? `; ${r.knowledge_ids.join(', ')}` : ''})`).join('\n')}\n` : ''}
## Guardrails
- Use only claims marked \`verified\` in \`claims.md\`. Never invent numbers, quotes, reviews or customers.
- Do not publish, post, send or spend anything. Put drafts in \`outbox/\` and list each one under \`approvals\` in your result file.
- Stay inside the budget caps in \`product.json\`.
- If an input is missing, do what you can, and say what is missing.

## When you finish
1. Write your result to \`products/<slug>/runs/<task-id>.json\`:
\`\`\`json
{
  "task_id": "<task-id>",
  "agent": "${a.name}",
  "status": "done",
  "output": ["files you wrote"],
  "summary": "one or two sentences",
  "approvals": [{"type": "publish|send|spend|price", "title": "...", "file": "outbox/..."}],
  "experiments": [{"id": "E-...", "hypothesis": "...", "metric": "...", "status": "planned"}],
  "new_tasks": [{"title": "...", "agent": "om-...", "brief": "...", "depends_on": [], "priority": 3}],
  "alerts": [{"level": "critical|decision|warning|info", "title": "what the owner must know", "detail": "why, and what to do"}],
  "approvals_note": "spend approvals also need \\"amount\\" (in the budget currency)"
}
\`\`\`
   Use \`"status": "blocked"\` with an \`"error"\` when you could not finish. Leave out lists you don't need. \`new_tasks\` may only name agents from \`state/agents.json\`.
2. If you saw a platform, law or research change that your brief does not have yet, add \`"knowledge_tips": [{"statement": "what changed", "source_url": "https://official-source"}]\` to the result file. The knowledge scouts verify every tip before it reaches other agents.
3. Reply with at most 8 lines: what you did, the files written, and the next task you recommend.
`;
  fs.writeFileSync(path.join(agentsDir, `${a.name}.md`), body);
}

const stateDir = path.join(root, 'state');
fs.mkdirSync(stateDir, { recursive: true });
fs.writeFileSync(
  path.join(stateDir, 'agents.json'),
  JSON.stringify(roster.map((a) => ({ agent: a.name, title: a.title, pod: pods[a.pod], dept: DEPARTMENTS[a.dept].name, layer: a.layer, tier: a.tier, model: a.model, skills: a.skills.length, skill_library: packFor(a).length + knowledgeFor(a).length, learned_rules: a.learned?.length ?? 0 })), null, 2)
);
const tiers = roster.reduce((m, a) => ({ ...m, [a.tier]: (m[a.tier] ?? 0) + 1 }), {});
const mastered = roster.reduce((n, a) => n + new Set([...a.skills, ...packFor(a), ...knowledgeFor(a)]).size, 0);
console.log(`Built ${roster.length} agents in ${Object.keys(pods).length} pods (${tiers.mega ?? 0} mega, ${tiers.core ?? 0} core, ${tiers.micro ?? 0} micro); ${Math.round(mastered / roster.length)} skills per agent on average.`);
const runModels = roster.reduce((m, a) => { const k = modelFor(a, costCfg); m[k] = (m[k] ?? 0) + 1; return m; }, {});
console.log(`AI cost tier ${costCfg.tier}: ${Object.entries(runModels).map(([k, v]) => `${v} on ${k}`).join(", ")} (config/ai-cost.json).`);
