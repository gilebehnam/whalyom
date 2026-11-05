// The ready-made commands, the rules, the counted numbers and the free open-source edition.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { COMMANDS, GROUPS, commandFile } from '../commands.mjs';
import { RULES, RULE_GROUPS } from '../rules.mjs';
import { stats } from '../stats.mjs';
const HAS_BUILDER = fs.existsSync(fileURLToPath(new URL('../oss/build.mjs', import.meta.url)));

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const exists = (rel) => fs.existsSync(path.join(root, rel));
const BUILTIN = ['help', 'init', 'review', 'status', 'config', 'cost', 'memory', 'doctor', 'login', 'logout', 'model', 'clear', 'compact', 'agents', 'mcp', 'hooks', 'permissions', 'resume', 'export', 'context', 'upgrade', 'schedule', 'loop', 'plan', 'security-review', 'simplify', 'code-review'];

test('commands: unique names, known groups, no clash with built-in slash commands', () => {
  const names = COMMANDS.map((c) => c[0]);
  assert.equal(new Set(names).size, names.length);
  for (const [n, g] of COMMANDS) { assert.match(n, /^[a-z][a-z0-9-]+$/); assert.ok(GROUPS.some(([k]) => k === g), `${n}: group ${g}`); }
  for (const n of names) assert.ok(!BUILTIN.includes(n), `${n} shadows a built-in command`);
});

test('commands: every workflow, tool and om command they point at exists', () => {
  const omSkill = fs.readFileSync(path.join(root, '.claude/skills/om/SKILL.md'), 'utf8');
  for (const c of COMMANDS) {
    const body = commandFile(c);
    for (const m of body.matchAll(/flow (om-[a-z-]+)/g)) assert.ok(exists(`.claude/workflows/${m[1]}.js`), `${c[0]}: workflow ${m[1]}`);
    for (const m of body.matchAll(/node (tools\/[\w/.-]+\.mjs)/g)) assert.ok(exists(m[1]), `${c[0]}: ${m[1]}`);
    for (const m of body.matchAll(/Dispatch the `(om-[a-z0-9-]+)` agent/g)) assert.ok(exists(`.claude/agents/${m[1]}.md`), `${c[0]}: agent ${m[1]}`);
    for (const m of body.matchAll(/run its `([a-z-]+)/g)) assert.ok(omSkill.includes(`### \`${m[1]}`), `${c[0]}: om ${m[1]}`);
    assert.match(body, /^---\ndescription: "/);
  }
});

test('commands and rules on disk match their catalogs', () => {
  for (const tool of ['tools/commands.mjs', 'tools/rules.mjs']) {
    const r = spawnSync(process.execPath, [tool, '--check'], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, `${tool}: ${r.stderr}`);
  }
});

test('rules: unique ids, known groups, and every agent and tool they name exists', () => {
  assert.equal(new Set(RULES.map((r) => r[0])).size, RULES.length);
  for (const [id, g, , , by] of RULES) {
    assert.ok(RULE_GROUPS.some(([k]) => k === g), `${id}: group ${g}`);
    for (const m of by.matchAll(/\bom-[a-z0-9-]+/g)) assert.ok(exists(`.claude/agents/${m[0]}.md`), `${id}: agent ${m[0]}`);
    for (const m of by.matchAll(/`(tools\/[\w/.-]+\.mjs)`/g)) assert.ok(exists(m[1]), `${id}: ${m[1]}`);
  }
});

test('stats are counted from the files and agree with the roster', () => {
  const s = stats();
  assert.equal(s.commands, COMMANDS.length);
  assert.equal(s.rules, RULES.length);
  assert.equal(s.agents, fs.readdirSync(path.join(root, '.claude/agents')).filter((f) => /^om-.*\.md$/.test(f)).length);
  assert.ok(s.departments >= 20 && s.layers === 6 && s.skills > 100 && s.knowledge_facts > 0);
});

test('free edition: the paid app, pricing, fonts, accounts, state and real products never ship', { skip: !HAS_BUILDER }, async () => {
  const { denied, fill } = await import('../oss/build.mjs');
  for (const rel of ['tools/cloud/web.mjs', 'tools/cloud/web-ui.mjs', 'tools/cloud/web-landing.mjs', 'tools/cloud/web-cc.js', 'tools/cloud/accounts.mjs', 'config/pricing.json', 'assets/fonts/private/samarqand-vf.woff2', 'accounts/store.json', 'state/live-roster.json', 'products/acme/product.json', 'products/sample-quoteflow/leads.jsonl', 'products/sample-quoteflow/edge/x.json', '.env', 'LICENSE-COMMERCIAL.md', 'tools/plugin/package.mjs', 'knowledge/inbox.jsonl'])
    assert.ok(denied(rel), `${rel} must be excluded`);
  for (const rel of ['tools/daemon.mjs', 'tools/cloud/edge.mjs', 'tools/plugin/license.mjs', 'config/ai-modes.json', 'products/_template/product.json', 'products/sample-quoteflow/claims.md', '.env.example', 'knowledge/base.json'])
    assert.ok(!denied(rel), `${rel} must ship`);
  assert.equal(fill('{{a}} and {{b}}', { a: 1 }), '1 and {{b}}');
});

test('free edition: every template placeholder has a value', { skip: !HAS_BUILDER }, async () => {
  const { variables, fill } = await import('../oss/build.mjs');
  const vars = variables();
  for (const f of fs.readdirSync(path.join(root, 'tools/oss')).filter((f) => /\.md$|^LICENSE$/.test(f))) {
    const left = fill(fs.readFileSync(path.join(root, 'tools/oss', f), 'utf8'), vars).match(/\{\{\w+\}\}/g);
    assert.equal(left, null, `${f}: ${left}`);
  }
});

test('free edition: builds into a folder with its own README, MIT license, plugin manifest and no findings', { skip: !HAS_BUILDER }, () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wy-oss-'));
  try {
    fs.rmSync(out, { recursive: true });
    const r = spawnSync(process.execPath, ['tools/oss/build.mjs', '--out', out, '--strict'], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    for (const f of ['README.md', 'README.fa.md', 'STORY.md', 'AGENTS.md', 'LICENSE', 'install.sh', 'install.ps1', 'assets/brand/hero.svg', '.claude-plugin/plugin.json', 'docs/COMMANDS.md', 'rules/README.md', '.github/workflows/test.yml'])
      assert.ok(fs.existsSync(path.join(out, f)), f);
    assert.ok(!fs.existsSync(path.join(out, 'tools/cloud/web.mjs')));
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, '.claude-plugin/plugin.json'), 'utf8')).license, 'MIT');
    assert.match(fs.readFileSync(path.join(out, 'LICENSE'), 'utf8'), /^MIT License/);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});
