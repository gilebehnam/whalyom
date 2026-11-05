// Whalyom self-update: applies evolution proposals to the agents, inside config/evolution.json.
// Proposals are written by om-skill-smith, om-prompt-optimizer and om-evolution-director to
// state/evolution/proposals/<id>.json:
//   { "id": "EVO-...", "kind": "agent-notes" | "skill-pack" | "local-skill" | "new-agent" | "external-skill" | "connector",
//     "target": "om-google-ads", "text": "rule to add (agent-notes)", "skills": ["installed-skill"] (skill-pack),
//     "skill": { "slug": "short-name", "description": "...", "body": "markdown" } (local-skill),
//     "agent": { "slug", "title", "does", "dept", "model": "sonnet"|"haiku", "skills": [...], "notes" } (new-agent;
//       becomes om-grown-<slug> in config/learned-agents.json, needs "red_team": { "passed": true } and knowledge_ids),
//     "rationale": "why", "knowledge_ids": ["K-..."], "bench": { "before": 0.71, "after": 0.76 } }
// The loop never edits tools/roster.mjs: rules and skills go to config/agent-overrides.json, which the
// roster merges at build time, so every change is small, logged and reversible.
//   node tools/evolve.mjs validate <id|file>         check a proposal without applying it
//   node tools/evolve.mjs apply <id|all> [--owner]    apply (auto-safe mode, or --owner for anything allowed)
//   node tools/evolve.mjs rollback <id>               remove what a proposal added
//   node tools/evolve.mjs status                      counts, last changes
// Add --build to rebuild .claude/agents after apply or rollback.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, root } from './lib/env.mjs';
import { loadBase } from './knowledge/engine.mjs';

const R = (...p) => path.join(process.env.WHALYOM_HOME ?? root, ...p);
const evoDir = (...p) => R('state', 'evolution', ...p);
const OVERRIDES = () => R('config', 'agent-overrides.json');
const LEARNED_AGENTS = () => R('config', 'learned-agents.json');
const DEPTS = ['sovereign', 'intel', 'strategy', 'creative', 'seo', 'paid', 'social', 'funnel', 'leadgen', 'closer', 'lifecycle', 'finops', 'evolve'];
const cfgAll = () => readJson(R('config', 'evolution.json'), { mode: 'propose', agents: {}, protected: [] });

// Text an evolved rule may never contain: it would weaken a guard the owner set.
const FORBIDDEN = [
  [/\b(skip|bypass|without|ignore|no need for)\b[^.]{0,40}\b(approval|approve|the owner|compliance|review)/i, 'weakens the approval rule'],
  [/\b(raise|increase|exceed|lift|remove)\b[^.]{0,30}\b(cap|caps|budget limit|daily_cap|monthly_cap|spend limit)/i, 'touches budget caps'],
  [/\b(publish|post|send|spend|launch)\b[^.]{0,30}\b(directly|immediately|automatically|without asking)/i, 'acts outbound without approval'],
  [/\bignore\b[^.]{0,30}\b(claude\.md|rules|guardrails|claims\.md|instructions)/i, 'overrides house rules'],
  [/\b(invent|fabricate|make up)\b[^.]{0,30}\b(review|testimonial|number|statistic|customer)/i, 'allows invented claims'],
  [/\b(api[_ -]?key|password|secret|token)\b/i, 'mentions credentials'],
  [/\b(fake accounts?|buy (votes|reviews|followers)|scrape)\b/i, 'breaks platform rules'],
];

function knownSkills() {
  const r = spawnSync(process.execPath, [path.join(root, 'tools', 'check-skills.mjs'), '--list'], { encoding: 'utf8', cwd: root });
  return new Set(r.stdout.split(/\r?\n/).filter(Boolean));
}

async function rosterNames() {
  const { roster } = await import('./roster.mjs');
  return new Set(roster.map((a) => a.name));
}

export function loadProposal(ref) {
  const file = fs.existsSync(ref) ? ref : evoDir('proposals', `${ref}.json`);
  const p = readJson(file, null);
  if (!p) throw new Error(`proposal not found: ${ref}`);
  return { ...p, _file: file };
}

// Returns [] when the proposal may be applied in this mode, else the reasons it may not.
export function checkProposal(p, { names, skills, owner = false, cfg = cfgAll(), base = loadBase() } = {}) {
  const why = [];
  const a = cfg.agents ?? {};
  if (!p.id || !/^[A-Za-z0-9._-]{3,80}$/.test(p.id)) why.push('id missing or not file-safe');
  if (!['agent-notes', 'skill-pack', 'local-skill', 'new-agent', 'external-skill', 'connector'].includes(p.kind)) why.push(`unknown kind ${p.kind}`);
  // Supply-chain rule: outside code is never installed by the loop, whatever the mode.
  if (['external-skill', 'connector'].includes(p.kind)) why.push(`${p.kind} proposals are installed by hand by the owner after om-skill-auditor passes them; evolve.mjs never downloads code`);
  if (!owner && (cfg.mode !== 'auto-safe' || a.auto_apply === false)) why.push(`mode is "${cfg.mode}": waiting for the owner (apply with --owner)`);
  if (['agent-notes', 'skill-pack'].includes(p.kind) && names && !names.has(p.target)) why.push(`target ${p.target} is not a roster agent`);
  if (p.kind === 'agent-notes') {
    const text = String(p.text ?? '').trim();
    if (text.length < 20) why.push('rule text too short');
    if (text.length > (a.max_rule_length ?? 400)) why.push('rule text too long');
    for (const [re, label] of FORBIDDEN) if (re.test(text)) why.push(`rule ${label}`);
    const ids = p.knowledge_ids ?? [];
    const facts = ids.map((id) => base.facts.find((f) => f.id === id));
    const knowledgeBacked = ids.length > 0 && facts.every((f) => f && f.status === 'active' && f.confidence === 'high');
    if (ids.length && facts.some((f) => !f || f.status !== 'active')) why.push('a cited knowledge fact is missing or not active');
    const needsBench = !(knowledgeBacked && a.knowledge_rules_need_bench === false);
    if (needsBench && !owner) {
      const before = Number(p.bench?.before), after = Number(p.bench?.after);
      if (!Number.isFinite(before) || !Number.isFinite(after)) why.push('needs a benchmark score before and after (om-agent-bench)');
      else if (after - before < (a.min_bench_gain ?? 0.02)) why.push(`benchmark gain ${(after - before).toFixed(3)} is below ${a.min_bench_gain ?? 0.02}`);
    }
  }
  if (p.kind === 'skill-pack') {
    const list = p.skills ?? [];
    if (!list.length) why.push('no skills listed');
    if (skills) for (const s of list) if (!skills.has(s)) why.push(`skill ${s} is not installed`);
  }
  if (p.kind === 'local-skill') {
    const s = p.skill ?? {};
    if (!/^[a-z0-9-]{3,40}$/.test(s.slug ?? '')) why.push('skill slug must be 3–40 lowercase letters, digits or hyphens');
    if (!s.description || !s.body) why.push('skill needs a description and a body');
    for (const [re, label] of FORBIDDEN) if (re.test(`${s.description} ${s.body}`)) why.push(`skill ${label}`);
    if (/<script|\bcurl\b|\bwget\b|Invoke-WebRequest|\bnpm (i|install)\b|\bpip install\b/i.test(s.body ?? '')) why.push('skill bodies may not fetch or install code');
  }
  if (p.kind === 'new-agent') {
    const g = p.agent ?? {};
    if (g.slug) g.slug = String(g.slug).replace(/^om-(grown-)?/, '');
    const na = a.new_agents ?? {};
    if (!owner && na.auto_apply === false) why.push('new agents wait for the owner (agents.new_agents.auto_apply is false)');
    if (!/^[a-z0-9-]{3,40}$/.test(g.slug ?? '')) why.push('agent slug must be 3–40 lowercase letters, digits or hyphens');
    if (names && names.has(`om-grown-${g.slug}`)) why.push(`agent om-grown-${g.slug} already exists`);
    if (!g.title || String(g.does ?? '').length < 40 || String(g.notes ?? '').length < 60) why.push('agent needs a title, a job description (40+ chars) and a precise brief (60+ chars)');
    if (!DEPTS.includes(g.dept)) why.push(`unknown department ${g.dept}`);
    if (!(na.models ?? ['sonnet', 'haiku']).includes(g.model ?? 'sonnet')) why.push(`model ${g.model} needs the owner`);
    if (!(g.skills ?? []).length) why.push('agent needs at least one installed skill');
    if (skills) for (const s of g.skills ?? []) if (!skills.has(s)) why.push(`skill ${s} is not installed`);
    for (const [re, label] of FORBIDDEN) if (re.test(`${g.title} ${g.does} ${g.notes}`)) why.push(`agent ${label}`);
    if (/\b(bash|shell|powershell|execute code|run commands?)\b/i.test(`${g.does} ${g.notes}`)) why.push('grown agents get web tools only; no shell access');
    if (na.needs_red_team !== false && !owner && p.red_team?.passed !== true) why.push('needs a passed red-team review (red_team.passed)');
    const ids = p.knowledge_ids ?? [];
    if (na.needs_knowledge !== false && !owner && !ids.some((id) => base.facts.some((f) => f.id === id && f.status === 'active'))) why.push('needs at least one active knowledge fact showing the gap it fills');
    const total = readJson(LEARNED_AGENTS(), { agents: [] }).agents.length;
    if (!owner && total >= (na.max_total ?? 80)) why.push(`grown-agent limit reached (${na.max_total ?? 80}); retire one first`);
  }
  for (const pth of [p.file, p.path].filter(Boolean)) if ((cfg.protected ?? []).some((x) => String(pth).replace(/\\/g, '/').startsWith(x))) why.push(`touches protected path ${pth}`);
  return why;
}

function history(entry) {
  fs.mkdirSync(evoDir(), { recursive: true });
  fs.appendFileSync(evoDir('history.jsonl'), JSON.stringify(entry) + '\n');
}

export async function applyProposal(ref, { owner = false, now = new Date().toISOString(), names, skills } = {}) {
  const p = loadProposal(ref);
  const cfg = cfgAll();
  names ??= await rosterNames();
  skills ??= ['skill-pack', 'new-agent'].includes(p.kind) ? knownSkills() : undefined;
  const why = checkProposal(p, { names, skills, owner, cfg });
  if (why.length) {
    writeJson(p._file, { ...strip(p), status: 'held', held_reasons: why, checked_at: now });
    history({ at: now, id: p.id, kind: p.kind, target: p.target ?? null, result: 'held', reasons: why });
    return { id: p.id, applied: false, reasons: why };
  }
  const o = readJson(OVERRIDES(), { agents: {} });
  o.agents ??= {};
  const max = cfg.agents?.max_rules_per_agent ?? 12;
  let dropped = null;
  if (p.kind === 'agent-notes') {
    const slot = (o.agents[p.target] ??= { rules: [], skills: [] });
    slot.rules = (slot.rules ?? []).filter((r) => r.id !== p.id);
    slot.rules.push({ id: p.id, text: String(p.text).trim(), knowledge_ids: p.knowledge_ids ?? [], at: now });
    if (slot.rules.length > max) dropped = slot.rules.shift();
  } else if (p.kind === 'skill-pack') {
    const slot = (o.agents[p.target] ??= { rules: [], skills: [] });
    slot.skills = (slot.skills ?? []).filter((s) => s.id !== p.id);
    for (const name of p.skills) slot.skills.push({ id: p.id, name, at: now });
  } else if (p.kind === 'local-skill') {
    const dir = R('.claude', 'skills', `om-learned-${p.skill.slug}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: om-learned-${p.skill.slug}\ndescription: "${String(p.skill.description).replace(/"/g, "'")}"\n---\n\n<!-- Written by tools/evolve.mjs from proposal ${p.id} on ${now.slice(0, 10)}. Roll back with: node tools/evolve.mjs rollback ${p.id} -->\n\n${p.skill.body.trim()}\n`);
    o.local_skills = (o.local_skills ?? []).filter((s) => s.id !== p.id).concat([{ id: p.id, slug: `om-learned-${p.skill.slug}`, at: now }]);
  } else if (p.kind === 'new-agent') {
    const la = readJson(LEARNED_AGENTS(), { agents: [] });
    const g = { ...p.agent, slug: String(p.agent.slug).replace(/^om-(grown-)?/, '') };
    la.agents = la.agents.filter((x) => x.id !== p.id).concat([{ id: p.id, name: `om-grown-${g.slug}`, title: g.title, does: g.does, dept: g.dept, model: g.model === 'haiku' ? 'haiku' : 'sonnet', skills: g.skills, packs: g.packs ?? [], notes: g.notes, knowledge_ids: p.knowledge_ids ?? [], at: now }]);
    writeJson(LEARNED_AGENTS(), la);
  }
  writeJson(OVERRIDES(), o);
  fs.mkdirSync(evoDir('applied'), { recursive: true });
  writeJson(evoDir('applied', `${p.id}.json`), { ...strip(p), status: 'applied', applied_at: now, applied_by: owner ? 'owner' : 'auto-safe' });
  if (fs.existsSync(p._file) && path.resolve(p._file) !== path.resolve(evoDir('applied', `${p.id}.json`))) fs.unlinkSync(p._file);
  history({ at: now, id: p.id, kind: p.kind, target: p.target ?? null, result: 'applied', by: owner ? 'owner' : 'auto-safe', dropped: dropped?.id ?? null });
  return { id: p.id, kind: p.kind, applied: true, dropped: dropped?.id ?? null };
}

const strip = ({ _file, ...rest }) => rest;

export function rollback(id, { now = new Date().toISOString() } = {}) {
  const o = readJson(OVERRIDES(), { agents: {} });
  let removed = 0;
  for (const slot of Object.values(o.agents ?? {})) {
    const r = (slot.rules ?? []).length + (slot.skills ?? []).length;
    slot.rules = (slot.rules ?? []).filter((x) => x.id !== id);
    slot.skills = (slot.skills ?? []).filter((x) => x.id !== id);
    removed += r - slot.rules.length - slot.skills.length;
  }
  for (const s of (o.local_skills ?? []).filter((x) => x.id === id)) {
    fs.rmSync(R('.claude', 'skills', s.slug), { recursive: true, force: true });
    removed++;
  }
  o.local_skills = (o.local_skills ?? []).filter((x) => x.id !== id);
  const la = readJson(LEARNED_AGENTS(), { agents: [] });
  const keep = la.agents.filter((x) => x.id !== id);
  if (keep.length !== la.agents.length) { removed += la.agents.length - keep.length; writeJson(LEARNED_AGENTS(), { ...la, agents: keep }); }
  for (const [k, v] of Object.entries(o.agents ?? {})) if (!v.rules?.length && !v.skills?.length) delete o.agents[k];
  writeJson(OVERRIDES(), o);
  history({ at: now, id, result: 'rolled-back', removed });
  return { id, removed };
}

export function status() {
  const o = readJson(OVERRIDES(), { agents: {} });
  const pending = fs.existsSync(evoDir('proposals')) ? fs.readdirSync(evoDir('proposals')).filter((f) => f.endsWith('.json')) : [];
  let hist = [];
  try { hist = fs.readFileSync(evoDir('history.jsonl'), 'utf8').trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)); } catch { hist = []; }
  return {
    mode: cfgAll().mode,
    agents_with_learned_rules: Object.keys(o.agents ?? {}).length,
    learned_rules: Object.values(o.agents ?? {}).reduce((n, s) => n + (s.rules?.length ?? 0), 0),
    learned_skills: Object.values(o.agents ?? {}).reduce((n, s) => n + (s.skills?.length ?? 0), 0) + (o.local_skills?.length ?? 0),
    grown_agents: readJson(LEARNED_AGENTS(), { agents: [] }).agents.length,
    proposals_pending: pending.length,
    last: hist.slice(-5),
  };
}

const build = () => spawnSync(process.execPath, [path.join(root, 'tools', 'build-agents.mjs')], { encoding: 'utf8', cwd: root }).stdout.trim();

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, ref] = process.argv.slice(2);
  const owner = process.argv.includes('--owner');
  const i = process.argv.indexOf('--now');
  const now = i > -1 ? process.argv[i + 1] : new Date().toISOString();
  let out;
  if (cmd === 'validate') { const p = loadProposal(ref); out = { id: p.id, reasons: checkProposal(p, { names: await rosterNames(), skills: ['skill-pack', 'new-agent'].includes(p.kind) ? knownSkills() : undefined, owner }) }; }
  else if (cmd === 'apply') {
    const ids = ref === 'all' ? (fs.existsSync(evoDir('proposals')) ? fs.readdirSync(evoDir('proposals')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : []) : [ref];
    const limit = owner ? Infinity : cfgAll().agents?.max_changes_per_cycle ?? 10;
    const names = await rosterNames(); const skills = knownSkills();
    const results = [];
    const agentLimit = owner ? Infinity : cfgAll().agents?.new_agents?.max_per_cycle ?? 3;
    for (const id of ids) {
      if (!owner && readJson(evoDir('proposals', `${id}.json`), {}).kind === 'new-agent' && results.filter((r) => r.applied && r.kind === 'new-agent').length >= agentLimit) { results.push({ id, applied: false, reasons: ['new-agent limit for this cycle reached; next cycle'] }); continue; }
      if (results.filter((r) => r.applied).length >= limit) { results.push({ id, applied: false, reasons: ['cycle limit reached; next cycle'] }); continue; }
      results.push(await applyProposal(id, { owner, now, names, skills }));
    }
    out = { applied: results.filter((r) => r.applied).length, held: results.filter((r) => !r.applied).length, results };
  } else if (cmd === 'rollback') out = rollback(ref, { now });
  else if (cmd === 'status') out = status();
  else { console.error('Usage: node tools/evolve.mjs validate|apply|rollback|status [<id>|all] [--owner] [--build] [--now ISO]'); process.exit(2); }
  if (process.argv.includes('--build') && ['apply', 'rollback'].includes(cmd)) out.build = build();
  console.log(JSON.stringify(out));
}
