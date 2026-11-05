// The numbers Whalyom shows about itself, counted from the files, never typed by hand.
//   node tools/stats.mjs           print them and write docs/STATS.json
// Agents and departments come from the generated roster (state/live-roster.json, rebuilt by
// tools/build-state.mjs) with the agent files as fallback; skills, workflows, commands and rules
// from their folders; the knowledge numbers from knowledge/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel, d) => { try { return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); } catch { return d; } };
const list = (rel, test = () => true) => { try { return fs.readdirSync(path.join(root, rel), { withFileTypes: true }).filter(test).map((e) => e.name); } catch { return []; } };

export function stats() {
  const agentFiles = list('.claude/agents', (e) => e.isFile() && e.name.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
  const own = agentFiles.filter((a) => a.startsWith('om-'));
  const roster = read('state/live-roster.json', null);
  const depts = new Set(); const layers = new Set();
  for (const p of roster?.pods ?? []) for (const a of p.agents ?? []) { if (a.dept) depts.add(a.dept); if (a.layer) layers.add(a.layer); }
  const skills = list('.claude/skills', (e) => e.isDirectory());
  const base = read('knowledge/base.json', { facts: [] });
  const active = (base.facts ?? []).filter((f) => f.status !== 'retired');
  const prev = read('docs/STATS.json', {});
  return {
    agents: own.length,
    agents_total: agentFiles.length,
    mega_agents: own.filter((a) => a.startsWith('om-mega-')).length,
    micro_agents: own.filter((a) => a.startsWith('om-micro-')).length,
    departments: depts.size || prev.departments || 0,
    pods: roster?.pods?.length ?? prev.pods ?? 0,
    layers: layers.size || prev.layers || 6,
    skills: skills.length,
    own_skills: skills.filter((s) => /^(om|whalyom)(-|$)/.test(s)).length,
    workflows: list('.claude/workflows', (e) => e.name.endsWith('.js')).length,
    commands: list('.claude/commands', (e) => e.name.endsWith('.md')).length,
    rules: list('rules', (e) => /^\d\d-.*\.md$/.test(e.name)).length,
    knowledge_facts: active.length,
    knowledge_topics: new Set(active.map((f) => f.topic)).size,
    knowledge_sources: (read('knowledge/sources.json', { sources: [] }).sources ?? []).length,
    engine_tools: list('tools', (e) => e.name.endsWith('.mjs')).length,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = stats();
  fs.writeFileSync(path.join(root, 'docs', 'STATS.json'), JSON.stringify(s, null, 2) + '\n');
  console.log(JSON.stringify(s));
}
