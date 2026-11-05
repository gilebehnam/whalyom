// Whalyom knowledge CLI (see tools/knowledge/engine.mjs).
//   node tools/knowledge.mjs refresh [--force] [--only <source-id>]   fetch due feeds into knowledge/inbox.jsonl
//   node tools/knowledge.mjs apply [--trust <run-id,...>]             merge verified knowledge runs into knowledge/base.json
//   node tools/knowledge.mjs check [--mark]                           stale facts, overdue sources, outdated briefs
//   node tools/knowledge.mjs brief                                    department briefs, BRIEFING.md, om-knowledge-* skills
//   node tools/knowledge.mjs cycle                                    refresh (if due) + apply + check --mark + brief
//   node tools/knowledge.mjs search "<words>" [--topic t] [--limit n]  best-matching verified facts
//   node tools/knowledge.mjs hashes <run-file>                        statement_hash per fact index, for verifier verdicts
// Every command accepts --now <ISO time> and prints one JSON line. The daemon runs `cycle` once a
// day; the om-knowledge-refresh workflow adds the LLM steps (extract, verify, teach) around it.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { refresh, apply, check, brief, search, config, K, factId } from './knowledge/engine.mjs';

// Node's fetch ignores HTTP(S)_PROXY unless NODE_USE_ENV_PROXY is set at startup: re-run once with it.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  && (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(r.status ?? 1);
}
import { readJson, writeJson, root } from './lib/env.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : undefined; };
const now = opt('now') ?? new Date().toISOString();

async function agentDept() {
  const { roster } = await import('./roster.mjs');
  return Object.fromEntries(roster.map((a) => [a.name, a.dept]));
}

// Dashboard summary and system alerts for Needs You Know.
function publish(status) {
  writeJson(path.join(root, 'state', 'knowledge.json'), status);
  const file = path.join(root, 'state', 'system-alerts.json');
  const alerts = readJson(file, []).filter((a) => a.source !== 'knowledge');
  if (status.facts_stale) alerts.push({ level: 'warning', title: `Knowledge: ${status.facts_stale} fact(s) due for re-verification`, detail: 'Run the om-knowledge-refresh workflow (or /whalyom evolve) so the curator re-checks them against their sources.', source: 'knowledge', at: now, resolved: false });
  if (status.sources_overdue?.length > 3) alerts.push({ level: 'warning', title: `Knowledge: ${status.sources_overdue.length} feed(s) not fetched recently`, detail: status.sources_overdue.slice(0, 5).map((s) => `${s.id}${s.last_error ? ` (${s.last_error})` : ''}`).join(', '), source: 'knowledge', at: now, resolved: false });
  writeJson(file, alerts);
}

export async function cycle(opts = {}) {
  const t = opts.now ?? now;
  const cfg = config();
  const last = readJson(K('state.json'), {}).last_refresh;
  const offline = process.env.OM_KNOWLEDGE_OFFLINE === '1';
  const due = !offline && (opts.force || !last || Date.parse(t) - Date.parse(last) >= (cfg.refresh_every_hours ?? 24) * 3600000);
  const fetched = due ? await refresh({ now: t, force: opts.force }) : { skipped: offline ? 'offline (OM_KNOWLEDGE_OFFLINE=1)' : 'not due', last_refresh: last };
  const merged = cfg.auto_apply === false ? { skipped: 'knowledge.auto_apply is false' } : apply({ now: t, agents: new Set(Object.keys(await agentDept())) });
  const status = check({ now: t, mark: true });
  const briefs = brief({ now: t, agentDept: await agentDept() });
  const summary = { at: t, fetched: due ? { new_items: fetched.new_items, failed: fetched.sources.filter((s) => s.ok === false).length } : fetched, merged: merged.skipped ? merged : { added: merged.added.length, updated: merged.updated.length, retired: merged.retired.length, rejected: merged.rejected.length, waiting: merged.waiting }, ...status, briefs: briefs.files };
  publish(summary);
  return summary;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const cmd = args[0];
  let out;
  if (cmd === 'refresh') out = await refresh({ now, force: flag('force'), only: opt('only') });
  else if (cmd === 'apply') out = apply({ now, trust: (opt('trust') ?? '').split(',').filter(Boolean), agents: new Set(Object.keys(await agentDept())) });
  else if (cmd === 'check') { out = check({ now, mark: flag('mark') }); publish(out); }
  else if (cmd === 'brief') out = brief({ now, agentDept: await agentDept() });
  else if (cmd === 'cycle') out = await cycle({ now, force: flag('force') });
  else if (cmd === 'search') {
    const words = args.slice(1).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && ['--topic', '--limit', '--now'].includes(all[i])));
    out = search(words.join(' '), { topic: opt('topic'), limit: Number(opt('limit') ?? 10), now });
  }
  else if (cmd === 'hashes' && args[1]) {
    // A verifier copies each statement_hash into its keep or fix verdict, binding the verdict to the
    // exact fact it checked (apply() rejects a keep or fix whose hash does not match the fact).
    const run = readJson(path.resolve(args[1]), null);
    if (!run) { console.error(`Cannot read run file ${args[1]}`); process.exit(2); }
    out = {
      run_id: run.run_id ?? null,
      facts: (Array.isArray(run.facts) ? run.facts : []).map((f, index) => ({ index, statement_hash: factId(f ?? {}), statement: String(f?.statement ?? '').slice(0, 120) })),
      retire: (Array.isArray(run.retire) ? run.retire : []).map((r) => r?.id).filter(Boolean),
    };
  }
  else { console.error('Usage: node tools/knowledge.mjs refresh|apply|check|brief|cycle|search|hashes [--now ISO] [--force] [--only id] [--trust ids] [--mark]'); process.exit(2); }
  console.log(JSON.stringify(out));
}
