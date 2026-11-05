// Tracks which dashboard datasets changed since the last upload.
// node tools/sync-manifest.mjs            → prints {changed: [{name, file}], datasets: {...}}
// node tools/sync-manifest.mjs --mark <name> <blobUrl>   → records an upload
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = path.join(root, 'state');
const manifestFile = path.join(stateDir, '.synced.json');
const NAMES = ['products', 'tasks', 'approvals', 'experiments', 'kpis', 'agents', 'funnel'];

const manifest = (() => { try { return JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch { return {}; } })();
const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

const args = process.argv.slice(2);
if (args[0] === '--mark') {
  const [, name, url] = args;
  const file = path.join(stateDir, `${name}.json`);
  manifest[name] = { url, sha256: hash(file), at: new Date().toISOString() };
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  console.log(`marked ${name}`);
} else {
  const changed = NAMES
    .map((name) => ({ name, file: path.join(stateDir, `${name}.json`) }))
    .filter(({ name, file }) => fs.existsSync(file) && manifest[name]?.sha256 !== hash(file));
  console.log(JSON.stringify({ changed, datasets: manifest }, null, 2));
}
