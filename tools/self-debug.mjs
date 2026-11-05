// Self-debugger: finds what is broken in the system itself and turns it into a precise fix brief.
// Checks: the automated test suite, every workspace's ledgers, the daemon's recent cycles, failed
// executor actions and failed AI transitions. Writes state/self-debug.json, raises system alerts
// for Needs You Know, and prints the brief the main session hands to om-bug-hunter.
// Safety rule for any fix: the guards in policy.mjs, execute.mjs, budget.mjs, killswitch.mjs and
// tools/connectors/* may be repaired but never loosened; the test suite must pass after the fix.
// Usage: node tools/self-debug.mjs [--no-tests]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, root } from './lib/env.mjs';

const problems = [];
const add = (area, detail, file) => problems.push({ area, detail: String(detail).slice(0, 600), file: file ?? null });

if (!process.argv.includes('--no-tests')) {
  const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'tools/test/*.test.mjs'], { encoding: 'utf8', cwd: root, timeout: 10 * 60 * 1000 });
  const fails = (r.stdout + r.stderr).split(/\r?\n/).filter((l) => /^\s*✖/.test(l) && !/failing tests/.test(l));
  if (r.status !== 0) add('tests', fails.length ? fails.slice(0, 10).join(' | ') : (r.stderr || r.stdout).slice(-600), 'tools/test/');
}

const productsDir = path.join(root, 'products');
for (const slug of fs.readdirSync(productsDir).filter((s) => !s.startsWith('_'))) {
  const v = spawnSync(process.execPath, [path.join(root, 'tools', 'validate.mjs'), slug], { encoding: 'utf8' });
  if (v.status !== 0) add('workspace', v.stdout.trim(), `products/${slug}/`);
  for (const a of readJson(path.join(productsDir, slug, 'approvals.json'), []).filter((x) => x.status === 'failed')) add('executor', `${slug} ${a.id} ${a.executed_by ?? ''}: ${a.last_error ?? 'failed'}`, 'tools/execute.mjs');
  for (const x of readJson(path.join(productsDir, slug, 'transitions.json'), []).filter((t) => t.status === 'failed')) add('transition', `${slug} ${x.id} ${x.from_agent} → ${x.to_agent}: ${x.error ?? 'downstream blocked'}`, `products/${slug}/transitions.json`);
}

const logFile = path.join(root, 'state', 'daemon-log.jsonl');
if (fs.existsSync(logFile)) {
  const recent = fs.readFileSync(logFile, 'utf8').trim().split(/\r?\n/).slice(-24).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  for (const c of recent) for (const p of c.products ?? []) for (const s of p.steps ?? []) if (s.ok === false) add('daemon', `${p.slug} ${s.step ?? s.name}: ${s.error ?? s.stderr ?? 'failed'}`, `tools/${s.step ?? s.name ?? 'daemon'}.mjs`);
}

const know = readJson(path.join(root, 'state', 'knowledge.json'), null);
if (know?.briefs_outdated) add('knowledge', 'knowledge briefs are older than knowledge/base.json: run node tools/knowledge.mjs brief', 'tools/knowledge.mjs');
if ((know?.sources_overdue?.length ?? 0) > 5) add('knowledge', `${know.sources_overdue.length} knowledge feeds failing: ${know.sources_overdue.slice(0, 5).map((s) => `${s.id} ${s.last_error ?? ''}`).join(', ')}`, 'knowledge/sources.json');

const report = { at: new Date().toISOString(), ok: problems.length === 0, problems };
writeJson(path.join(root, 'state', 'self-debug.json'), report);
const sysAlerts = readJson(path.join(root, 'state', 'system-alerts.json'), []).filter((a) => !a.resolved && a.source !== 'self-debug');
for (const p of problems.slice(0, 10)) sysAlerts.push({ level: p.area === 'tests' ? 'critical' : 'warning', title: `Self-debug: ${p.area} problem`, detail: p.detail.slice(0, 200), source: 'self-debug', at: report.at, resolved: false });
writeJson(path.join(root, 'state', 'system-alerts.json'), sysAlerts);

const brief = problems.length
  ? `Fix these Whalyom system problems. Read each file named, find the root cause, change the code and add or extend a test in tools/test/ that would have caught it. Never loosen the guards in policy.mjs, execute.mjs, budget.mjs, killswitch.mjs or tools/connectors/. Run \`npm test\` until it passes, then report what you changed.\n${problems.map((p, i) => `${i + 1}. [${p.area}] ${p.detail}${p.file ? ` (${p.file})` : ''}`).join('\n')}`
  : '';
console.log(JSON.stringify({ ok: report.ok, problems: problems.length, by_area: problems.reduce((m, p) => ({ ...m, [p.area]: (m[p.area] ?? 0) + 1 }), {}), bug_hunter_brief: brief }));

