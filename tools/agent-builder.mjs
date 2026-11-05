// No-code custom agent builder: turns a simple form (name, title, what it does, department, model,
// skills, notes, outputs) into a "new-agent" evolution proposal in state/evolution/proposals/<id>.json,
// the exact format tools/evolve.mjs already accepts for grown agents. The builder never writes
// config/learned-agents.json or .claude/agents itself: the agent ships only through evolve.mjs, with
// every guard it applies (installed skills only, sonnet or haiku, web tools only, no text that skips
// approvals, touches caps or mentions credentials, a passed red team and a knowledge fact, or the owner).
// The builder never marks a red team as passed; that stays with om-red-team or the owner (--owner).
//   node tools/agent-builder.mjs options                    departments, models, skills and tools the form offers
//   node tools/agent-builder.mjs validate <form.json>       check a form without writing anything
//   node tools/agent-builder.mjs propose <form.json> [--now ISO]   write the proposal (held until its gates pass)
// Form: { "name": "churn-radar", "title": "Churn Radar", "does": "...", "dept": "lifecycle", "model": "sonnet",
//   "skills": ["installed-skill"], "notes": "precise brief", "outputs": ["research/grown/churn.md"],
//   "tools": ["WebSearch", "WebFetch"], "knowledge_ids": ["K-..."], "rationale": "why" }
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, root } from './lib/env.mjs';
import { DEPARTMENTS } from './roster-extra.mjs';
import { checkProposal } from './evolve.mjs';

const R = (...p) => path.join(process.env.WHALYOM_HOME ?? root, ...p);
const PROPOSALS = (...p) => R('state', 'evolution', 'proposals', ...p);

// Grown agents get the roster's WEB tool set (tools/roster.mjs); a form may ask for these and nothing else.
export const ALLOWED_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Skill'];
export const MODELS = ['sonnet', 'haiku'];
const LIMITS = { title: 80, does: 600, notes: 2000, output: 160, outputs: 10, skills: 20 };

// Reasons from evolve.checkProposal that are pipeline gates, not form mistakes: the proposal is still
// written and waits (held) until om-red-team passes it, a knowledge fact backs it, or the owner applies it.
const GATES = [/red-team/, /knowledge fact/, /waiting for the owner/, /new agents wait for the owner/, /grown-agent limit/];
const isGate = (reason) => GATES.some((re) => re.test(reason));

// Personal data never goes into state/: no email addresses or phone numbers in an agent brief.
const PERSONAL = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'contains an email address (no personal data in agent briefs)'],
  [/(?:\+|\b00)\d[\d\s().-]{7,}\d/, 'contains a phone number (no personal data in agent briefs)'],
  [/(?:\(\d{3}\)\s?|\b\d{3}[\s.-])\d{3}[\s.-]\d{4}\b/, 'contains a phone number (no personal data in agent briefs)'],
];
// Secrets never go into state/ either: text shaped like a live key or token is refused (and never echoed).
const SECRETS = /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}|\bsk-[A-Za-z0-9_-]{16,}|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}|\bxox[abpr]-[A-Za-z0-9-]{10,}|\bAIza[0-9A-Za-z_-]{30,}|\bEAA[A-Za-z0-9]{30,}|\bBearer\s+[A-Za-z0-9._~+/=-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const KNOWLEDGE_ID = /^K-[A-Za-z0-9._-]{1,78}$/;

export const slugOf = (name) => String(name ?? '').trim().toLowerCase().replace(/^om-(grown-)?/, '');

const cfgOf = () => readJson(R('config', 'evolution.json'), { mode: 'propose', agents: {}, protected: [] });

export function knownSkills() {
  const r = spawnSync(process.execPath, [path.join(root, 'tools', 'check-skills.mjs'), '--list'], { encoding: 'utf8', cwd: root });
  return new Set(String(r.stdout ?? '').split(/\r?\n/).filter(Boolean));
}

export async function agentNames() {
  const { roster } = await import('./roster.mjs');
  const names = new Set(roster.map((a) => a.name));
  for (const a of readJson(R('config', 'learned-agents.json'), { agents: [] }).agents ?? []) names.add(a.name);
  return names;
}

// Departments a grown agent can ship into: the DEPARTMENTS of roster-extra.mjs that evolve.mjs accepts
// today (probed through checkProposal, so this follows evolve.mjs if it ever widens its list).
export function shippableDepartments({ cfg = cfgOf(), base = { facts: [] } } = {}) {
  return Object.keys(DEPARTMENTS).filter((dept) => {
    const probe = { id: 'EVO-probe', kind: 'new-agent', agent: { slug: 'probe', title: 'p', does: 'x'.repeat(40), notes: 'x'.repeat(60), dept, model: 'sonnet', skills: ['x'] } };
    return !checkProposal(probe, { owner: true, cfg, base }).some((r) => r.startsWith('unknown department'));
  });
}

export function builderOptions({ skills = knownSkills(), cfg = cfgOf() } = {}) {
  const ship = new Set(shippableDepartments({ cfg }));
  const models = MODELS.filter((m) => (cfg.agents?.new_agents?.models ?? MODELS).includes(m));
  return {
    departments: Object.entries(DEPARTMENTS).map(([id, d]) => ({ id, name: d.name, layer: d.layer, shippable: ship.has(id) })),
    models,
    tools: ALLOWED_TOOLS,
    skills: [...skills].sort(),
  };
}

const list = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : String(v).split(',')).map((x) => String(x).trim()).filter(Boolean);

// Pure: form -> { ok, errors, gates, proposal }. errors block writing; gates only hold the proposal in evolve.mjs.
export function buildProposal(form = {}, { names = new Set(), skills, cfg = cfgOf(), base, now = new Date().toISOString(), pending = [] } = {}) {
  if (!form || typeof form !== 'object' || Array.isArray(form)) return { ok: false, errors: ['form must be a JSON object'], gates: [], proposal: null };
  const errors = [];
  if (typeof now !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(now) || Number.isNaN(Date.parse(now))) {
    errors.push('now must be an ISO date-time');
    now = new Date().toISOString();
  }
  const slug = slugOf(form.name ?? form.slug);
  const title = String(form.title ?? '').trim();
  const does = String(form.does ?? '').trim();
  const notesIn = String(form.notes ?? '').trim();
  const outputs = list(form.outputs);
  const tools = list(form.tools);
  const agentSkills = [...new Set(list(form.skills))];
  const dept = String(form.dept ?? '').trim();
  const model = String(form.model ?? 'sonnet').trim().toLowerCase();

  if (!/^[a-z0-9-]{3,40}$/.test(slug)) errors.push('name must be 3–40 lowercase letters, digits or hyphens');
  else {
    for (const n of [slug, `om-${slug}`, `om-grown-${slug}`]) if (names.has(n)) { errors.push(`name clashes with existing agent ${n}`); break; }
    if (pending.includes(slug)) errors.push(`a proposal for om-grown-${slug} is already waiting`);
  }
  if (title.length > LIMITS.title) errors.push(`title is longer than ${LIMITS.title} characters`);
  if (does.length > LIMITS.does) errors.push(`"what it does" is longer than ${LIMITS.does} characters`);
  if (notesIn.length > LIMITS.notes) errors.push(`notes are longer than ${LIMITS.notes} characters`);
  if (!Object.hasOwn(DEPARTMENTS, dept)) errors.push(`unknown department ${dept || '(none)'}; pick one of ${Object.keys(DEPARTMENTS).join(', ')}`);
  if (!MODELS.includes(model)) errors.push(`model must be sonnet or haiku, not ${model}`);
  if (agentSkills.length > LIMITS.skills) errors.push(`at most ${LIMITS.skills} skills`);
  for (const t of tools) if (!ALLOWED_TOOLS.includes(t)) errors.push(`tool ${t} is not allowed: custom agents get web tools only (${ALLOWED_TOOLS.join(', ')})`);
  if (outputs.length > LIMITS.outputs) errors.push(`at most ${LIMITS.outputs} outputs`);
  for (const o of outputs) {
    if (o.length > LIMITS.output) errors.push('an output description is too long');
    if (/(^|[\\/])\.\.([\\/]|$)|^[\\/]|^[A-Za-z]:/.test(o)) errors.push(`output ${o} must stay inside the product workspace (relative path, no ..)`);
  }
  const knowledgeIds = list(form.knowledge_ids);
  for (const k of knowledgeIds) if (!KNOWLEDGE_ID.test(k)) { errors.push('knowledge_ids must be knowledge fact ids (K-...)'); break; }
  const rationaleIn = String(form.rationale ?? '').trim();
  if (rationaleIn.length > LIMITS.notes) errors.push(`rationale is longer than ${LIMITS.notes} characters`);
  const allText = [String(form.name ?? form.slug ?? ''), title, does, notesIn, ...outputs, ...agentSkills, ...tools, rationaleIn].join('\n');
  for (const [re, label] of PERSONAL) if (re.test(allText)) errors.push(label);
  if (SECRETS.test(allText)) errors.push('contains text shaped like a key or token (secrets come only from env, never from a form)');

  // Outputs have no field in the grown-agent record, so they become part of the brief the agent reads.
  const notes = outputs.length ? `${notesIn}\nOutputs: ${outputs.join('; ')}. Write them under outbox/grown/ or research/grown/; every outbound step waits for the owner's approval.` : notesIn;
  const day = now.slice(0, 10);
  const proposal = {
    id: `EVO-build-${day}-${slug || 'agent'}`.slice(0, 80),
    kind: 'new-agent',
    agent: { slug, title, does, dept, model, skills: agentSkills, notes },
    rationale: rationaleIn || `Custom agent built by the owner with the no-code agent builder: ${title}`,
    knowledge_ids: knowledgeIds,
    source: 'agent-builder',
    created_at: now,
  };

  // The same guard rules evolve.mjs applies when it ships the proposal (FORBIDDEN text, shell words,
  // installed skills, department and model lists, required lengths). Copy: checkProposal edits agent.slug.
  const reasons = checkProposal(structuredClone(proposal), { names, skills, owner: false, cfg, ...(base ? { base } : {}) });
  // The rationale is stored with the proposal, so it meets the same text rules (FORBIDDEN, shell words) as the brief.
  if (rationaleIn) {
    const probe = { id: 'EVO-probe', kind: 'new-agent', agent: { slug: 'probe', title: 'p', does: 'x'.repeat(40), notes: rationaleIn.padEnd(60, '.'), dept: 'evolve', model: 'sonnet', skills: ['x'] } };
    for (const r of checkProposal(probe, { owner: true, cfg, base: { facts: [] } })) if (/^agent |shell access/.test(r)) errors.push(`rationale: ${r}`);
  }
  const gates = [];
  for (const r of reasons) (isGate(r) ? gates : errors).push(r);
  const uniq = [...new Set(errors)];
  return { ok: uniq.length === 0, errors: uniq, gates, proposal: uniq.length ? null : proposal };
}

function pendingSlugs() {
  let files = [];
  try { files = fs.readdirSync(PROPOSALS()).filter((f) => f.endsWith('.json')); } catch { return []; }
  return files.map((f) => readJson(PROPOSALS(f), {})).filter((p) => p.kind === 'new-agent').map((p) => slugOf(p.agent?.slug));
}

// Writes the proposal file (never overwrites one); returns where it went and what still holds it.
export async function proposeAgent(form, opts = {}) {
  const names = opts.names ?? await agentNames();
  const skills = opts.skills ?? knownSkills();
  const res = buildProposal(form, { ...opts, names, skills, pending: opts.pending ?? pendingSlugs() });
  if (!res.ok) return { written: false, errors: res.errors, gates: res.gates };
  const file = PROPOSALS(`${res.proposal.id}.json`);
  if (fs.existsSync(file)) return { written: false, errors: [`proposal ${res.proposal.id} already exists`], gates: res.gates };
  fs.mkdirSync(PROPOSALS(), { recursive: true });
  writeJson(file, res.proposal);
  return {
    written: true, id: res.proposal.id, agent: `om-grown-${res.proposal.agent.slug}`,
    file: path.relative(process.env.WHALYOM_HOME ?? root, file).replace(/\\/g, '/'),
    gates: res.gates,
    next: res.gates.length ? 'held until the gates pass: run om-red-team on it, or apply as owner with node tools/evolve.mjs apply ' + res.proposal.id + ' --owner' : `node tools/evolve.mjs apply ${res.proposal.id}`,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, ref] = process.argv.slice(2);
  const i = process.argv.indexOf('--now');
  const now = i > -1 ? process.argv[i + 1] : new Date().toISOString();
  const form = () => { const f = readJson(path.resolve(ref ?? ''), null); if (!f) { console.error(`form not found or not JSON: ${ref}`); process.exit(2); } return f; };
  let out;
  if (cmd === 'options') out = builderOptions();
  else if (cmd === 'validate') { const r = buildProposal(form(), { names: await agentNames(), skills: knownSkills(), now, pending: pendingSlugs() }); out = { ok: r.ok, errors: r.errors, gates: r.gates, id: r.proposal?.id ?? null }; }
  else if (cmd === 'propose') out = await proposeAgent(form(), { now });
  else { console.error('Usage: node tools/agent-builder.mjs options | validate <form.json> | propose <form.json> [--now ISO]'); process.exit(2); }
  console.log(JSON.stringify(out));
  if (out.errors?.length) process.exitCode = 1;
}
