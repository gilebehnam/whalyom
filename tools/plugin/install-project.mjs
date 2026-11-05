// Sets up a Whalyom workspace in a project from the installed plugin (or from this repo).
//   node tools/plugin/install-project.mjs [--to <project dir>] [--force]
// Copies: tools/ (engine scripts, zero npm dependencies), products/_template, playbooks/,
// .env.example, docs/CONNECTORS.md and docs/ATTACH.md. Never overwrites an existing file unless
// --force is given, and --force only ever touches tools/ (the engine), never products or .env.
// The MCP server keeps running from the plugin (it carries the MCP SDK); it finds this project
// through WHALYOM_HOME.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const toIdx = args.indexOf('--to');
const to = path.resolve(toIdx > -1 ? args[toIdx + 1] : process.cwd());
const force = args.includes('--force');
if (path.resolve(to) === src) { console.log(JSON.stringify({ ok: true, note: 'target is the engine itself; nothing to copy' })); process.exit(0); }

const out = { to, copied: 0, kept: 0, updated: 0 };
function copy(rel, { overwritable = false } = {}) {
  const s = path.join(src, rel);
  if (!fs.existsSync(s)) return;
  if (fs.statSync(s).isDirectory()) { for (const e of fs.readdirSync(s)) copy(path.join(rel, e), { overwritable }); return; }
  if (/(^|[\\/])test[\\/]/.test(rel)) return;
  const d = path.join(to, rel);
  if (fs.existsSync(d)) {
    if (!(force && overwritable)) { out.kept++; return; }
    fs.copyFileSync(s, d); out.updated++; return;
  }
  fs.mkdirSync(path.dirname(d), { recursive: true });
  fs.copyFileSync(s, d); out.copied++;
}

copy('tools', { overwritable: true });
copy(path.join('products', '_template'));
copy('playbooks');
for (const f of ['.env.example', path.join('docs', 'CONNECTORS.md'), path.join('docs', 'ATTACH.md')]) copy(f);
const pkg = path.join(to, 'package.json');
if (!fs.existsSync(pkg)) { fs.writeFileSync(pkg, JSON.stringify({ name: path.basename(to).toLowerCase().replace(/[^a-z0-9-]/g, '-'), private: true, type: 'module' }, null, 2) + '\n'); out.copied++; }
const gi = path.join(to, '.gitignore');
const ignore = ['.env', '.env.*', '!.env.example', 'sites/', 'secrets/', '.whalyom-license'];
const have = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
const add = ignore.filter((l) => !have.split(/\r?\n/).includes(l));
if (add.length) fs.appendFileSync(gi, `${have && !have.endsWith('\n') ? '\n' : ''}# Whalyom: secrets never go in the repo\n${add.join('\n')}\n`);
out.next = ['cp .env.example .env and fill only the connectors you want (docs/CONNECTORS.md)', 'create a product: node tools/new-product.mjs <slug> --name "<Name>" (or the workspace_create MCP tool)'];
console.log(JSON.stringify(out));
