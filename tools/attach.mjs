// Attach Whalyom to a product or website with one command.
//   node tools/attach.mjs <domain|slug> [--name N] [--repo <local path or git URL>] [--satellite <https://site base URL>] [--preset saas]
//        [--stack <wordpress|node|docker|nextjs|netlify|cloudflare|snippet|gtm|auto|all>[,...]] [--endpoint <collector URL>]
//        [--no-embed-secret] [--verify <url>]
// What it does:
//   1. Creates the product workspace (domain set) if it does not exist yet. An existing slug works too.
//   2. Repo link (optional, recommended): a local path is linked, a git URL is cloned into sites/<slug>.
//      Agents then read the real site code and content, and the site-git connector publishes
//      approved changes by committing to it (the host deploys on push). The framework and the install
//      stack are detected.
//   3. Satellite (on the site's server): generates a secret, stores it in .env, and writes
//      sites/<slug>/install-satellite.sh — copy that one file to the server and run `bash install-satellite.sh`.
//      It installs the satellite as a service, so the hub can read site data, collect first-party
//      analytics and leads, and (if you allow) apply approved changes.
//   4. Stack packages (--stack, or auto-detected from the repo): sites/<slug>/<stack>/ with the files for that
//      platform and INSTALL.md with copy-paste steps. Packages never contain the secret (placeholder
//      __WHALYOM_SECRET__); it stays in the local .env as OM_SAT_SECRET_<SLUG>.
//   5. Records the connection in products/<slug>/connection.json and prints the next steps (never the secret).
//   --verify <url>: checks an installed endpoint (signature, clock skew, version, CORS, TLS, robots/sitemap/llms.txt),
//      stores the result in connection.json and state/live-sites.json (via sync-sites), and exits.
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, readJson, writeJson, root, envPath } from './lib/env.mjs';
import { secretEnvName } from './lib/satellite-client.mjs';
import { STACKS, STACK_PREFIX, buildInstaller, buildPackage, detectStack, nginxSnippet, siteVars, writePackage } from './satellite/packages.mjs';

loadEnv();
const args = process.argv.slice(2);
const target = args[0];
const usage = 'Usage: node tools/attach.mjs <domain|slug> [--name N] [--repo PATH|GIT_URL] [--satellite URL] [--preset P] [--stack S[,S]] [--endpoint URL] [--no-embed-secret] [--verify URL]';
if (!target || target.startsWith('--')) { console.error(usage); process.exit(2); }
const opt = (k) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : undefined; };
const flag = (k) => args.includes(k);

// <slug> of an existing workspace, or a domain.
let domain; let slug;
const existing = /^[a-z0-9-]+$/.test(target) ? readJson(path.join(root, 'products', target, 'product.json'), null) : null;
if (existing?.domain) { slug = target; domain = String(existing.domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase(); }
else {
  domain = target.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) { console.error(existing ? `products/${target} has no domain in product.json: attach it by domain first.` : `Not a domain: ${target}`); process.exit(2); }
  slug = domain.replace(/^www\./, '').replace(/\.[a-z]+$/, '').replace(/[^a-z0-9]+/g, '-');
}
// A satellite returns consented lead details and site files: it must be reached over HTTPS
// (plain http only for a local test host), checked before anything is created or saved.
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const safeSatelliteUrl = (u) => {
  try { const x = new URL(u); return x.protocol === 'https:' || (x.protocol === 'http:' && LOCAL_HOSTS.has(x.hostname.toLowerCase())); } catch { return false; }
};
const satArg = opt('--satellite');
if (satArg !== undefined) {
  if (!safeSatelliteUrl(satArg)) { console.error(`Refused --satellite ${satArg}: the satellite URL must use https:// (plain http is allowed only for 127.0.0.1, localhost or [::1]), so lead details never travel in cleartext.`); process.exit(2); }
}
const dir = path.join(root, 'products', slug);
const siteDir = path.join(root, 'sites', slug);
const steps = [];
const secretKey = secretEnvName(slug);

// --verify: check an installed endpoint and exit.
const verifyUrl = opt('--verify');
if (verifyUrl && !fs.existsSync(path.join(dir, 'product.json'))) { console.error(`No workspace products/${slug}: attach the site first.`); process.exit(1); }

// 1. workspace
if (!fs.existsSync(dir)) {
  execFileSync(process.execPath, [path.join(root, 'tools', 'new-product.mjs'), slug, '--domain', domain, '--name', opt('--name') ?? domain, '--preset', opt('--preset') ?? 'saas'], { stdio: 'pipe' });
  steps.push(`Created workspace products/${slug} for ${domain}.`);
} else steps.push(`Workspace products/${slug} already exists.`);
const product = readJson(path.join(dir, 'product.json'), {});
if (!product.domain) { product.domain = domain; writeJson(path.join(dir, 'product.json'), product); }

const setEnv = (key, value) => {
  const f = envPath();
  const lines = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  const i = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (i > -1) lines[i] = `${key}=${value}`; else lines.push(`${key}=${value}`);
  fs.writeFileSync(f, lines.join('\n') + '\n', { mode: 0o600 });
};
const connection = readJson(path.join(dir, 'connection.json'), { domain, attached_at: new Date().toISOString() });
const satUrl = satArg;
if (satUrl) connection.satellite = satUrl.replace(/\/$/, '');
const stackArg = opt('--stack');
const requested = stackArg ? stackArg.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : [];
for (const s of requested) if (![...STACKS, 'auto', 'all'].includes(s)) { console.error(`Unknown stack "${s}". One of: ${STACKS.join(', ')}, auto, all`); process.exit(2); }

if (verifyUrl) {
  const { verifySite } = await import('./satellite/verify-site.mjs');
  if (requested.length === 1 && STACK_PREFIX[requested[0]]) { connection.stack = requested[0]; connection.prefix = STACK_PREFIX[requested[0]]; }
  const prefix = opt('--prefix') ?? connection.prefix ?? '/_whalyom';
  const local = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(?=[/?#]|$)/.test(verifyUrl);
  const result = await verifySite({ url: verifyUrl, secret: process.env[secretKey], prefix, siteOrigin: opt('--site-origin') ?? (local ? new URL(verifyUrl).origin : `https://${domain}`), allowHttp: local });
  connection.verification = { ...result, checks: result.checks.map(({ data, ...c }) => c) };
  if (!connection.satellite && result.endpoint && safeSatelliteUrl(verifyUrl)) connection.satellite = new URL(verifyUrl).origin;
  writeJson(path.join(dir, 'connection.json'), connection);
  try { execFileSync(process.execPath, [path.join(root, 'tools', 'sync-sites.mjs'), '--only', slug], { stdio: 'pipe', env: process.env }); } catch (e) { steps.push(`sync-sites failed: ${String(e.stderr ?? e.message).slice(0, 200)}`); }
  console.log(JSON.stringify({ slug, domain, verify: { url: result.url, status: result.status, score: result.score, failed: result.failed, warnings: result.warnings, checks: result.checks.map((c) => `${c.status.padEnd(4)} ${c.name}: ${c.detail}`) }, steps }, null, 2));
  process.exit(result.status === 'fail' ? 1 : 0);
}

// 2. repo
const repo = opt('--repo');
if (repo) {
  let local = repo;
  if (/^(https?:\/\/|git@)/.test(repo)) {
    local = path.join(siteDir, 'repo');
    if (!fs.existsSync(path.join(local, '.git'))) { fs.mkdirSync(path.dirname(local), { recursive: true }); execFileSync('git', ['clone', '--depth', '50', repo, local], { stdio: 'pipe' }); steps.push(`Cloned ${repo} into sites/${slug}/repo.`); }
  }
  local = path.resolve(local);
  if (!fs.existsSync(local)) { console.error(`Repo path not found: ${local}`); process.exit(1); }
  const has = (f) => fs.existsSync(path.join(local, f));
  const pkg = readJson(path.join(local, 'package.json'), {});
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const framework = deps.next ? 'nextjs' : deps.astro ? 'astro' : deps.nuxt ? 'nuxt' : deps.gatsby ? 'gatsby' : deps['@sveltejs/kit'] ? 'sveltekit' : deps.vite ? 'vite' : has('wp-config.php') || has('wp-content') ? 'wordpress' : has('_config.yml') ? 'jekyll' : has('hugo.toml') || has('config.toml') ? 'hugo' : has('index.html') ? 'static' : 'unknown';
  const contentDir = { nextjs: has('content') ? 'content' : has('src/app') ? 'src/app' : 'app', astro: 'src/content', nuxt: 'content', gatsby: 'content', sveltekit: 'src/routes', vite: 'public', wordpress: 'wp-content', jekyll: '_posts', hugo: 'content', static: '.', unknown: 'content' }[framework];
  setEnv(`OM_SITE_REPO_${slug.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`, local);
  const detected = detectStack(local, framework);
  Object.assign(connection, { repo: local, repo_source: repo, framework, content_dir: contentDir, detected_stack: detected.stack, detected_reason: detected.reason });
  steps.push(`Linked the site repo (${framework}); agents read it and approved changes are committed there (content dir: ${contentDir}). Detected install stack: ${detected.stack} (${detected.reason}).`);
}

// 3. satellite (legacy one-file installer, now hardened: checksum, systemd hardening, idempotent, --uninstall)
let secret = process.env[secretKey];
if (!secret) { secret = crypto.randomBytes(32).toString('hex'); setEnv(secretKey, secret); process.env[secretKey] = secret; }
const embed = !flag('--no-embed-secret');
const vars = siteVars({ slug, domain, endpoint: opt('--endpoint') ?? connection.collector ?? connection.satellite, secretEnv: secretKey });
fs.mkdirSync(siteDir, { recursive: true });
fs.writeFileSync(path.join(siteDir, 'install-satellite.sh'), buildInstaller(vars, { embedSecret: embed ? secret : '' }), { mode: 0o700 });
fs.writeFileSync(path.join(siteDir, 'nginx-snippet.conf'), nginxSnippet(vars));
connection.installer = `sites/${slug}/install-satellite.sh`;
steps.push(embed
  ? `Wrote sites/${slug}/install-satellite.sh (secret stored in .env as ${secretKey}; the installer embeds it, so keep it private — or re-run with --no-embed-secret) and sites/${slug}/nginx-snippet.conf.`
  : `Wrote sites/${slug}/install-satellite.sh without the secret: run it as WHALYOM_SECRET='<value of ${secretKey} from .env>' bash install-satellite.sh. Also sites/${slug}/nginx-snippet.conf.`);

// 4. stack packages
let stacks = requested.includes('all') ? [...STACKS] : requested.filter((s) => s !== 'auto');
if (requested.includes('auto') || (!requested.length && repo)) {
  const d = connection.detected_stack ? { stack: connection.detected_stack, reason: connection.detected_reason } : detectStack(null);
  if (!stacks.includes(d.stack)) stacks.push(d.stack);
}
const packages = [];
for (const stack of stacks) {
  const pkg = buildPackage(stack, vars);
  const out = path.join(siteDir, stack);
  const files = writePackage(out, pkg);
  packages.push({ stack, dir: `sites/${slug}/${stack}`, files, steps: pkg.steps });
  if (pkg.connection.collector) connection.collector = pkg.connection.collector;
}
// The hub talks to one signed endpoint; its API prefix follows the server-side stack.
const serverStack = stacks.find((s) => STACK_PREFIX[s]);
if (serverStack) { connection.stack = serverStack; connection.prefix = STACK_PREFIX[serverStack]; }
if (stacks.length) connection.packages = stacks;
if (packages.length) steps.push(...packages.map((p) => `Package ${p.stack}: ${p.dir}/INSTALL.md (${p.files.length} files).`));
if (!connection.satellite) steps.push(`After installing, connect it: node tools/attach.mjs ${slug} --satellite https://${domain}`);
steps.push(`Then check it: node tools/attach.mjs ${slug} --verify https://${domain}`);

writeJson(path.join(dir, 'connection.json'), connection);
// sites/ holds clones and installers with secrets: keep it out of git.
const gi = path.join(root, '.gitignore');
if (!fs.readFileSync(gi, 'utf8').split(/\r?\n/).includes('sites/')) fs.appendFileSync(gi, '\n# Attached sites: clones and satellite installers (contain secrets)\nsites/\n');
console.log(JSON.stringify({ slug, domain, connection: { ...connection, verification: connection.verification ? { status: connection.verification.status, score: connection.verification.score, checked_at: connection.verification.checked_at } : undefined }, packages: packages.map(({ steps: s, ...p }) => ({ ...p, steps: s })), steps }, null, 2));
