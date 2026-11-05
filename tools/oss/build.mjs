// Builds the free, open-source edition of Whalyom as a ready-to-publish repository: dist/whalyom-oss/
//   node tools/oss/build.mjs [--out <dir>] [--strict]
// The free edition runs on the user's own Claude Code (or Codex) with their own subscription:
// every agent, skill, workflow, command and rule, the engine in tools/, the verified knowledge base,
// the local Command Center and the whalyom-core MCP server, under the MIT license.
// It never contains the paid online app (tools/cloud/web*, accounts, pricing), the licensed fonts,
// real product workspaces, state/, accounts/, secrets or the owner's dashboard links.
// Texts come from tools/oss/*.md with {{placeholders}} filled from tools/stats.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stats } from '../stats.mjs';
import { COMMANDS, GROUPS } from '../commands.mjs';
import { RULES, RULE_GROUPS } from '../rules.mjs';
import { hero } from './hero.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : undefined; };
const out = path.resolve(opt('--out') ?? path.join(root, 'dist', 'whalyom-oss'));
const strict = args.includes('--strict');
const MARKER = '.whalyom-oss';
export const REPO = process.env.WHALYOM_OSS_REPO || 'gilebehnam/whalyom';

// Paths (relative, forward slashes) that never ship in the free edition.
export const DENY = [
  /^products\/(?!(_template|sample-quoteflow)(\/|$))/, /^products\/[^/]+\/(edge|leads|social-inbox|inbox|crm\/edits)(\/|$)/, /(^|\/)leads\.jsonl$/, /^state(\/|$)/, /^accounts(\/|$)/, /^tenants(\/|$)/, /^site(\/|$)/, /^sites(\/|$)/, /^dist(\/|$)/, /^\.git(\/|$)/,
  /^tools\/cloud\/(web[^/]*|accounts\.mjs|hud\.mjs)$/, /^tools\/test\/web\.test\.mjs$/, /^tools\/plugin\/package\.mjs$/, /^config\/pricing\.json$/, /^assets\/fonts\/private(\/|$)/,
  /^knowledge\/(inbox\.jsonl|rejected\.jsonl|runs)(\/|$)/, /^docs\/(COMMERCIAL\.md|STATS\.json)$/, /^LICENSE-COMMERCIAL\.md$/,
  /(^|\/)\.env(\..*)?$/, /(^|\/)secrets(\/|$)/, /\.(pem|key|p12|pfx)$/i, /(^|\/)credentials[^/]*\.json$/i, /(^|\/)settings\.local\.json$/, /(^|\/)proven-config\.json$/, /(^|\/)\.proven-config-version$/, /(^|\/)\.whalyom-license$/,
];
const allowEnvExample = (rel) => /(^|\/)\.env\.example$/.test(rel);
export const denied = (rel) => !allowEnvExample(rel) && DENY.some((r) => r.test(rel));

// The owner's private dashboard links never ship; the free edition points at the user's own.
const scrubLinks = (s) => s.replace(/https:\/\/claude\.ai\/(code\/)?artifact\/[A-Za-z0-9_-]+/g, '<your dashboard artifact link>');

const PATTERNS = [
  ['private key', /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/], ['stripe live key', /\b[sr]k_live_[A-Za-z0-9]{10,}/], ['github token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ['slack token', /\bxox[abpr]-[A-Za-z0-9-]{10,}/], ['aws access key', /\bAKIA[0-9A-Z]{16}\b/], ['google api key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['anthropic key', /\bsk-ant-[A-Za-z0-9_-]{20,}/], ['openai key', /\bsk-(proj-)?[A-Za-z0-9]{32,}/],
  ['personal webmail address', /\b[\w.+-]+@(gmail|googlemail|yahoo|hotmail|outlook|icloud|proton)\.(com|me)\b/i], ['private dashboard link', /claude\.ai\/(code\/)?artifact\/[A-Za-z0-9]/],
];
// Documented placeholders and one-letter test fixtures are not findings.
const PLACEHOLDER = /your-token-here|['"][a-z]@(gmail|yahoo|hotmail|outlook)\.com['"]/;

export function fill(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}
const fmt = (n) => Number(n).toLocaleString('en-US');
const faNum = (n) => Number(n).toLocaleString('fa-IR');

export function variables(s = stats()) {
  const roster = (() => { try { return JSON.parse(fs.readFileSync(path.join(root, 'state', 'live-roster.json'), 'utf8')); } catch { return { pods: [] }; } })();
  const by = {};
  for (const p of roster.pods ?? []) for (const a of p.agents ?? []) if (a.dept) (by[a.dept] ??= []).push(a);
  const depts = Object.entries(by).sort((a, b) => b[1].length - a[1].length);
  const head = (list) => list.find((a) => a.name.startsWith('om-mega-'))?.name ?? '';
  const departments_table = `| Department | Agents | Head |\n|---|---:|---|\n${depts.map(([d, l]) => `| ${d} | ${l.length} | ${head(l) ? `\`${head(l)}\`` : ''} |`).join('\n')}`;
  const commands_table = GROUPS.map(([g, t]) => `**${t}:** ${COMMANDS.filter((c) => c[1] === g).map((c) => `\`/${c[0]}\``).join(' · ')}`).join('\n\n');
  const rules_list = RULE_GROUPS.map(([g, t]) => `**${t}:** ${RULES.filter((r) => r[1] === g).map((r) => r[2]).join(' · ')}`).join('\n\n');
  const badge = (label, value, color) => `![${label}](https://img.shields.io/badge/${encodeURIComponent(label)}-${encodeURIComponent(value)}-${color})`;
  const badges = [badge('license', 'MIT', '2b6cb0'), badge('agents', fmt(s.agents), 'F2C230'), badge('skills', fmt(s.skills), '7FE6F2'), badge('departments', s.departments, '7FE6F2'), badge('commands', s.commands, '7FE6F2'), badge('rules', s.rules, '9BE7A2'), badge('verified notes', fmt(s.knowledge_notes), '9BE7A2')].join(' ');
  const out = { ...s, repo: REPO, departments_table, commands_table, rules_list, badges, year: new Date().getFullYear() };
  for (const [k, v] of Object.entries(s)) { out[`${k}_fmt`] = fmt(v); out[`${k}_fa`] = faNum(v); }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (fs.existsSync(out)) {
    if (!fs.existsSync(path.join(out, MARKER))) { console.error(`refusing to overwrite ${out}: it was not built by this script (no ${MARKER})`); process.exit(1); }
    for (const e of fs.readdirSync(out)) if (e !== '.git') fs.rmSync(path.join(out, e), { recursive: true, force: true });
  }
  fs.mkdirSync(out, { recursive: true });
  const report = { built_at: new Date().toISOString(), files: 0, bytes: 0, excluded: [], findings: [] };
  const write = (rel, content) => { const f = path.join(out, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); report.files++; report.bytes += Buffer.byteLength(content); };
  const TEXT = /\.(md|mjs|js|json|txt|html|css|yml|yaml)$/i;
  function copy(srcRel, destRel = srcRel) {
    const src = path.join(root, srcRel);
    if (!fs.existsSync(src)) return;
    const rel = srcRel.replace(/\\/g, '/');
    if (denied(rel)) { report.excluded.push(rel); return; }
    if (fs.statSync(src).isDirectory()) { for (const e of fs.readdirSync(src)) copy(path.join(srcRel, e), path.join(destRel, e)); return; }
    if (TEXT.test(rel) && fs.statSync(src).size < 8e6) write(destRel, scrubLinks(fs.readFileSync(src, 'utf8')));
    else { const d = path.join(out, destRel); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(src, d); report.files++; report.bytes += fs.statSync(src).size; }
  }

  // 1. The workforce and the engine
  for (const d of ['.claude/agents', '.claude/skills', '.claude/workflows', '.claude/commands', '.claude/settings.json', 'rules', 'tools', 'config', 'knowledge', 'playbooks', 'products/_template', 'products/sample-quoteflow', 'live', 'docs', 'integrations', 'assets', 'THIRD_PARTY_NOTICES.md', '.env.example', 'package-lock.json']) copy(d);

  // 2. Texts filled from the live numbers
  const vars = variables();
  for (const [tpl, dest] of [['README.md', 'README.md'], ['README.fa.md', 'README.fa.md'], ['STORY.md', 'STORY.md'], ['AGENTS.md', 'AGENTS.md'], ['CLAUDE.md', 'CLAUDE.md'], ['CONTRIBUTING.md', 'CONTRIBUTING.md'], ['SECURITY.md', 'SECURITY.md'], ['LICENSE', 'LICENSE']]) write(dest, fill(fs.readFileSync(path.join(here, tpl), 'utf8'), vars));
  write('docs/STATS.json', JSON.stringify(stats(), null, 2) + '\n');
  write('assets/brand/hero.svg', hero(stats()));
  for (const f of ['install.sh', 'install.ps1']) copy(path.relative(root, path.join(here, f)), f);
  copy(path.relative(root, path.join(here, 'github')), '.github');

  // 3. Package, plugin manifest, MCP server
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
  write('package.json', JSON.stringify({ name: 'whalyom', version: manifest.version, description: 'Your entire marketing department inside Claude Code: AI agents, skills, commands, rules and a verified knowledge base.', license: 'MIT', type: 'module', repository: `github:${REPO}`, engines: { node: '>=20' }, scripts: { test: pkg.scripts.test, mcp: pkg.scripts.mcp, 'command-center': pkg.scripts['command-center'], commands: 'node tools/commands.mjs --check', rules: 'node tools/rules.mjs --check', stats: 'node tools/stats.mjs' }, dependencies: pkg.dependencies }, null, 2) + '\n');
  write('.claude-plugin/plugin.json', JSON.stringify({ name: 'whalyom', displayName: 'Whalyom', version: manifest.version, description: `Your entire marketing department inside Claude Code: ${vars.agents} AI agents in ${vars.departments} departments, ${vars.skills} skills, ${vars.commands} commands, ${vars.rules} rules and a verified knowledge base. Nothing goes out without your approval.`, author: { name: 'Whalyom' }, homepage: `https://github.com/${REPO}`, repository: `https://github.com/${REPO}`, license: 'MIT', keywords: manifest.keywords, agents: './.claude/agents/', commands: './.claude/commands/', skills: './.claude/skills/' }, null, 2) + '\n');
  write('.claude-plugin/marketplace.json', JSON.stringify({ name: 'whalyom', owner: { name: 'Whalyom' }, plugins: [{ name: 'whalyom', source: './', description: 'Your entire marketing department inside Claude Code.' }] }, null, 2) + '\n');
  write('.mcp.json', JSON.stringify({ mcpServers: { 'whalyom-core': { command: 'node', args: ['tools/mcp/whalyom-core.mjs'], env: { WHALYOM_HOME: '.' } } } }, null, 2) + '\n');
  write('.gitignore', fs.readFileSync(path.join(root, '.gitignore'), 'utf8'));
  write(MARKER, `built ${report.built_at}\n`);

  // 4. Scan
  (function scan(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name); const rel = path.relative(out, f).replace(/\\/g, '/');
      if (e.isDirectory()) { if (!['node_modules', '.git'].includes(e.name)) scan(f); continue; }
      if (!TEXT.test(e.name) && !/\.(sh|ps1|example)$/.test(e.name)) continue;
      fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((l, i) => { if (PLACEHOLDER.test(l)) return; for (const [what, re] of PATTERNS) if (re.test(l)) report.findings.push({ file: rel, line: i + 1, what }); });
    }
  })(out);
  fs.writeFileSync(path.join(root, 'dist', 'whalyom-oss.report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ out, files: report.files, mb: +(report.bytes / 1e6).toFixed(1), excluded: report.excluded.length, findings: report.findings.length }));
  if (report.findings.length) console.error(report.findings.slice(0, 20).map((f) => `${f.file}:${f.line} ${f.what}`).join('\n'));
  if (strict && report.findings.length) process.exit(1);
}
