// Docs drift checks for the first-run README, the connector tables, the workflow tables and the
// 2026-11 module commands: every command, connector and workflow a doc names must exist in the code.
// Run: node --test tools/test/docs-modules.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(root, f));

// module command word -> tool file
const MODULES = {
  crm: 'tools/crm.mjs',
  sequences: 'tools/sequences.mjs',
  inbox: 'tools/inbox.mjs',
  score: 'tools/lead-score.mjs',
  ab: 'tools/bandit.mjs',
  attribution: 'tools/attribution.mjs',
  'ai-visibility': 'tools/ai-visibility.mjs',
  watch: 'tools/competitor-watch.mjs',
  voice: 'tools/voice-guard.mjs',
  chat: 'tools/chat-agent.mjs',
  integrations: 'tools/integrations.mjs',
  creators: 'tools/creators.mjs',
  // 2026-11-04 modules
  reallocate: 'tools/reallocate.mjs',
  social: 'tools/social-inbox.mjs',
  realtime: 'tools/cloud/realtime.mjs',
  agency: 'tools/cloud/agency.mjs',
  creative: 'tools/creative-gen.mjs',
  call: 'tools/connectors/voice.mjs',
  retail: 'tools/connectors/amazon-ads.mjs',
  'new-agent': 'tools/agent-builder.mjs',
  autonomy: 'tools/autonomy-report.mjs',
  routing: 'tools/routing.mjs',
};

test('README exists and every node tools/... script and npm run script it names exists', () => {
  assert.ok(exists('README.md'), 'README.md exists');
  const readme = read('README.md');
  const scripts = JSON.parse(read('package.json')).scripts ?? {};
  const missing = [];
  for (const m of readme.matchAll(/node (tools\/[\w./-]+\.mjs)/g)) if (!exists(m[1])) missing.push(m[1]);
  for (const m of readme.matchAll(/npm run ([\w:-]+)/g)) if (!(m[1] in scripts)) missing.push(`npm run ${m[1]}`);
  assert.deepEqual(missing, []);
  assert.match(readme, /npm install/);
  assert.match(readme, /\.env\.example/);
});

test('CLAUDE.md names the daemon and every new module tool', () => {
  const claude = read('CLAUDE.md');
  assert.match(claude, /tools\/daemon\.mjs/);
  const missing = [...Object.values(MODULES), 'tools/pwa.mjs'].filter((f) => !claude.includes(f));
  assert.deepEqual(missing, []);
  for (const f of Object.values(MODULES)) assert.ok(exists(f), `${f} exists`);
});

test('the om skill has a command heading per module and the whalyom skill maps each one', () => {
  const om = read('.claude/skills/om/SKILL.md');
  const wh = read('.claude/skills/whalyom/SKILL.md');
  const missing = [];
  for (const [word, file] of Object.entries(MODULES)) {
    if (!om.includes('### `' + word)) missing.push(`om heading ${word}`);
    if (!om.includes(file.replace(/^tools\//, 'tools/'))) missing.push(`om names ${file}`);
    if (!wh.includes('| `' + word)) missing.push(`whalyom row ${word}`);
  }
  assert.deepEqual(missing, []);
});

test('every `om <command>` the whalyom skill points to is an om skill command', () => {
  const om = read('.claude/skills/om/SKILL.md');
  const commands = new Set([...om.matchAll(/^### `([a-z-]+)/gm)].map((m) => m[1]));
  const wh = read('.claude/skills/whalyom/SKILL.md');
  const unknown = [...wh.matchAll(/`om ([a-z-]+)/g)].map((m) => m[1]).filter((c) => !commands.has(c));
  assert.deepEqual([...new Set(unknown)], []);
});

test('docs/ARCHITECTURE_STATE.md has a row per module with its status and live gap', () => {
  const arch = read('docs/ARCHITECTURE_STATE.md');
  const missing = [];
  for (const f of [...Object.values(MODULES), 'tools/pwa.mjs']) {
    const row = arch.split('\n').find((l) => l.startsWith('|') && l.includes('`' + f + '`'));
    if (!row) missing.push(f);
    else if (!/working \(tests[^)]*\); untested live:/.test(row)) missing.push(`${f} status`);
  }
  assert.deepEqual(missing, []);
});

test('every connector in the registry is named in docs/CONNECTORS.md', async () => {
  const { connectors } = await import('../connectors/index.mjs');
  const doc = read('docs/CONNECTORS.md');
  const missing = connectors.map((c) => c.name).filter((n) => !doc.includes('`' + n + '`'));
  assert.deepEqual(missing, []);
  assert.match(doc, /Order: boosters, meta-ads/);
});

test('every workflow the docs and skills list exists, and both tables cover the same set', () => {
  const files = new Set(fs.readdirSync(path.join(root, '.claude/workflows')).filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, '')));
  const rows = (text) => new Set([...text.matchAll(/^\| `(om-[a-z-]+)` \|/gm)].map((m) => m[1]));
  const doc = rows(read('docs/WORKFLOWS.md'));
  const skill = rows(read('.claude/skills/om/SKILL.md'));
  assert.deepEqual([...doc].filter((w) => !files.has(w)), [], 'WORKFLOWS.md rows without a file');
  assert.deepEqual([...skill].filter((w) => !files.has(w)), [], 'om skill rows without a file');
  // The om skill table leaves out the three workflows that have their own commands (onboard, auto, auto-all).
  const own = new Set(['om-onboard', 'om-autopilot', 'om-portfolio']);
  assert.deepEqual([...doc].filter((w) => !own.has(w) && !skill.has(w)), [], 'in WORKFLOWS.md but not in the om skill');
  assert.deepEqual([...skill].filter((w) => !doc.has(w)), [], 'in the om skill but not in WORKFLOWS.md');
  const sweep = read('.claude/workflows/om-mega-sweep.js').match(/const ALL = \[([^\]]*)\]/);
  const n = (sweep[1].match(/['"][^'"]+['"]/g) ?? []).length;
  assert.match(read('docs/WORKFLOWS.md'), new RegExp('`depts\\?` \\(all ' + n + '\\)'));
});
