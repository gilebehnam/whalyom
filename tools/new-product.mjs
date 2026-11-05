// Creates products/<slug>/ from the template.
// node tools/new-product.mjs <slug> [--domain example.com] [--name "Product name"] [--brief-file path]
//   [--preset saas] [--autonomy manual|supervised|autopilot|full] [--budget <monthly cap>] [--currency USD|EUR|GBP] [--no-earned]
// New products get earned autonomy on (autonomy.earned {streak: 10} from the template: price and never_auto types never
// earn it, spend still needs the caps and compliance must pass); --no-earned sets autonomy.earned to false.
// Every option is checked before anything touches the disk. The workspace is built in products/_tmp-<slug>-<pid>/
// (the leading _ keeps listers away from it) and renamed into place only when product.json and brief.md are written,
// so a bad flag or a failed step never leaves a half-made products/<slug>/ that blocks the retry.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const slug = args[0];
const AUTONOMY = ['manual', 'supervised', 'autopilot', 'full'];
const CURRENCIES = ['USD', 'EUR', 'GBP'];
const SWITCHES = ['--no-earned'];
const FLAGS = ['--domain', '--name', '--brief-file', '--preset', '--autonomy', '--budget', '--currency'];
let presets = {};
try { presets = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'presets.json'), 'utf8')).presets ?? {}; } catch { /* reported as an unknown preset below */ }
const usage = `Usage: node tools/new-product.mjs <slug a-z0-9-> [--domain d] [--name n] [--brief-file f] [--preset ${Object.keys(presets).join('|') || 'p'}] [--autonomy ${AUTONOMY.join('|')}] [--budget <monthly cap, number >= 0>] [--currency ${CURRENCIES.join('|')}] [--no-earned]`;
const fail = (msg, code = 2) => { console.error(msg); process.exit(code); };
if (!slug || !/^[a-z0-9-]+$/.test(slug)) fail(usage);

// Parse: every flag must be known and carry a value (a missing value used to fall back to a default silently).
const o = {};
for (let i = 1; i < args.length; i += 2) {
  const k = args[i], v = args[i + 1];
  if (SWITCHES.includes(k)) { o[k] = true; i--; continue; }
  if (!FLAGS.includes(k)) fail(`Unknown option ${k}.\n${usage}`);
  if (v === undefined || v.startsWith('--')) fail(`${k} needs a value.\n${usage}`);
  o[k] = v;
}

// Validate before touching disk.
const presetKey = o['--preset'] ?? 'saas';
if (!presets[presetKey]) fail(`Unknown preset ${presetKey}. Options: ${Object.keys(presets).join(', ')}`);
if (o['--autonomy'] !== undefined && !AUTONOMY.includes(o['--autonomy'])) fail(`Unknown autonomy ${o['--autonomy']}. Options: ${AUTONOMY.join(', ')}`);
let budget;
if (o['--budget'] !== undefined) {
  budget = Number(o['--budget']);
  if (o['--budget'].trim() === '' || !Number.isFinite(budget) || budget < 0) fail(`--budget must be a number >= 0, got ${o['--budget']}`);
}
if (o['--currency'] !== undefined && !CURRENCIES.includes(o['--currency'])) fail(`Unknown currency ${o['--currency']}. Options: ${CURRENCIES.join(', ')}`);
let briefText = '# Brief\n\nDescribe the product: what it does, who it is for, price, and anything you can prove.\n';
if (o['--brief-file'] !== undefined) {
  try { briefText = fs.readFileSync(o['--brief-file'], 'utf8'); } catch (e) { fail(`Cannot read --brief-file ${o['--brief-file']}: ${e.code ?? e.message}`); }
}

const dest = path.join(root, 'products', slug);
if (fs.existsSync(dest)) fail(`products/${slug} already exists`, 1);
const tmp = path.join(root, 'products', `_tmp-${slug}-${process.pid}`);
try {
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.cpSync(path.join(root, 'products', '_template'), tmp, { recursive: true });
  fs.mkdirSync(path.join(tmp, 'runs', 'applied'), { recursive: true });

  const pj = path.join(tmp, 'product.json');
  const p = JSON.parse(fs.readFileSync(pj, 'utf8'));
  p.slug = slug;
  p.name = o['--name'] ?? slug;
  p.domain = o['--domain'] ?? '';
  p.created_at = new Date().toISOString();
  const pre = presets[presetKey];
  p.preset = presetKey;
  p.model = presetKey;
  p.goals.north_star = pre.north_star;
  p.channels.enabled = pre.channels;
  p.channels.paid_candidates = pre.paid_first;
  p.funnel = pre.funnel;
  if (o['--autonomy']) p.autonomy.level = o['--autonomy'];
  // Earned autonomy defaults on (template); never_auto always keeps price and call, whatever the template says
  // (voice.mjs refuses policy-approved calls too; this keeps earned trust from ever reaching them).
  p.autonomy.never_auto = [...new Set(['price', 'call', ...(p.autonomy.never_auto ?? [])])];
  if (o['--no-earned']) p.autonomy.earned = false;
  else if (p.autonomy.earned === undefined) p.autonomy.earned = { streak: 10 };
  // A budget of 0 keeps free mode with both caps 0 (as server.mjs /api/product does); the daily cap never exceeds the monthly one.
  if (budget > 0) { p.budget.mode = 'paid'; p.budget.monthly_cap = budget; p.budget.daily_cap = Math.min(budget, Math.max(1, Math.round(budget / 30))); }
  else if (budget === 0) { p.budget.mode = 'free'; p.budget.monthly_cap = 0; p.budget.daily_cap = 0; }
  if (o['--currency']) p.budget.currency = o['--currency'];
  fs.writeFileSync(pj, JSON.stringify(p, null, 2));
  fs.writeFileSync(path.join(tmp, 'brief.md'), briefText);

  if (fs.existsSync(dest)) throw new Error(`products/${slug} already exists`);
  fs.renameSync(tmp, dest);
  console.log(`created products/${slug}${p.domain ? ` for ${p.domain}` : ' (no domain yet)'}`);
} catch (e) {
  fs.rmSync(tmp, { recursive: true, force: true });
  fail(`could not create products/${slug}: ${e.message} (nothing was left behind; fix the cause and run again)`, 1);
}
