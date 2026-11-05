// Add a product with one command: its domain plus cPanel or SSH access, and Whalyom does the rest.
//   node tools/add-product.mjs <domain> [--name N] [--preset saas|ecommerce|…]
//        [--cpanel https://host:2083 --cpanel-user U [--cpanel-token T]]      cPanel API token
//        [--ssh user@host[:port] [--ssh-key path/to/private_key]]             or SSH
//        [--webroot public_html] [--approve-install] [--no-hub]
// What it does, without spending AI tokens until the last step:
//   1. Saves the access in the local .env only (OM_CPANEL_*_<SLUG> or OM_SSH_*_<SLUG>); a token can also be
//      put there by hand first, so it never appears in the shell history. Nothing secret is printed.
//   2. Creates the workspace and runs the instant audit (tools/instant-onboard.mjs): scores, quick wins,
//      booster drafts, and queues the AI onboarding for the hub.
//   3. Checks the access read-only (lists the web root) and detects WordPress.
//   4. WordPress: makes the site secret (tools/attach.mjs), and plans the install: the Whalyom plugin under
//      wp-content/plugins/whalyom/ and a must-use loader in wp-content/mu-plugins/ that switches it on with
//      the site id and secret (delete that one file to switch Whalyom off). Other sites: the plan explains
//      the snippet step, since Whalyom never edits a page it did not write.
//   5. Records the install as one approval. With --approve-install (the owner approving here and now) it is
//      approved through tools/apply-decisions.mjs and carried out by tools/execute.mjs at once.
//   6. Starts the hub if it is not running: the hub runs the AI onboarding and every later AI job on
//      Claude Platform (WHALYOM_ANTHROPIC_API_KEY), never the Claude Code subscription, inside the mode's budget.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadEnv, readJson, writeJson, root } from './lib/env.mjs';
import { instantOnboard } from './instant-onboard.mjs';
import { accessFor, checkAccess, envKey } from './connectors/site-install.mjs';
import { secretEnvName } from './lib/satellite-client.mjs';

// Sets KEY=value lines in .env (replacing an existing line), without echoing the values.
export function setEnvValues(values, envFile = path.join(root, '.env')) {
  const lines = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8').split(/\r?\n/) : [];
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined || v === null || v === '') continue;
    const i = lines.findIndex((l) => l.startsWith(`${k}=`));
    if (i > -1) lines[i] = `${k}=${v}`; else lines.push(`${k}=${v}`);
    process.env[k] = String(v);
  }
  fs.writeFileSync(envFile, lines.filter((l, i) => l || i < lines.length - 1).join('\n') + '\n', { mode: 0o600 });
}

// The must-use loader: switches the plugin on and supplies the site id and secret, with no WordPress admin step.
export const muLoader = (slug) => `<?php
/**
 * Plugin Name: Whalyom loader
 * Description: Loads the Whalyom plugin with this site's id and secret. Added by Whalyom; delete this file to switch Whalyom off.
 */
defined( 'ABSPATH' ) || exit;
$whalyom_fill = function ( $v ) {
	$v = is_array( $v ) ? $v : array();
	if ( empty( $v['site_id'] ) ) { $v['site_id'] = '${slug}'; }
	if ( empty( $v['secret'] ) ) { $v['secret'] = '__WHALYOM_SECRET__'; }
	return $v;
};
add_filter( 'option_whalyom_settings', $whalyom_fill );
add_filter( 'default_option_whalyom_settings', $whalyom_fill );
if ( ! function_exists( 'is_plugin_active' ) ) { include_once ABSPATH . 'wp-admin/includes/plugin.php'; }
if ( ! is_plugin_active( 'whalyom/whalyom.php' ) && file_exists( WP_PLUGIN_DIR . '/whalyom/whalyom.php' ) ) { require_once WP_PLUGIN_DIR . '/whalyom/whalyom.php'; }
`;

export function installPlan({ slug, domain, webroot = 'public_html', wordpress }) {
  if (!wordpress) return { domain, webroot, stack: 'other', files: [], manual: 'This site is not WordPress: add the one-line tracker yourself (node tools/install-snippet.mjs prints it once OM_EDGE_URL is set), or run node tools/attach.mjs for a server satellite. Whalyom never edits a page it did not write.' };
  const base = 'integrations/wordpress/whalyom';
  const plugin = ['whalyom.php', 'uninstall.php', 'readme.txt', 'assets/whalyom.js'].map((f) => ({ path: `wp-content/plugins/whalyom/${f}`, source: `${base}/${f}` }));
  return { domain, webroot, stack: 'wordpress', secret_env: secretEnvName(slug), files: [...plugin, { path: 'wp-content/mu-plugins/whalyom-loader.php', content: muLoader(slug) }] };
}

const node = (script, args, env = process.env) => spawnSync(process.execPath, [path.join(root, 'tools', script), ...args], { cwd: root, encoding: 'utf8', env });
const lastJson = (r) => { try { return JSON.parse(String(r.stdout ?? '').trim().split(/\r?\n/).at(-1)); } catch { return null; } };

function hubRunning() {
  const info = readJson(path.join(root, 'state', 'hub.pid'), null);
  const pid = typeof info === 'object' && info ? info.pid : Number(info);
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function addProduct(domain, opts = {}) {
  const out = { domain, steps: [] };
  const step = (name, ok, detail) => { out.steps.push({ step: name, ok, detail }); };
  const clean = String(domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean)) throw new Error(`not a domain: ${domain}`);

  // 2. Workspace, instant audit, quick wins, AI onboarding queued for the hub.
  const ob = await instantOnboard(clean, { name: opts.name, queue: true });
  out.slug = ob.slug;
  step('workspace and instant audit', ob.merged !== false, `score ${ob.score ?? '?'}/100, ${ob.tasks} quick-win task(s), ${ob.approvals} booster draft(s)${ob.reachable ? '' : ' (site not reachable now)'}`);
  if (opts.preset) { const p = readJson(path.join(root, 'products', ob.slug, 'product.json'), null); if (p) { p.preset = opts.preset; writeJson(path.join(root, 'products', ob.slug, 'product.json'), p); } }

  // 1. Access into .env only.
  const slug = ob.slug;
  // Access from the online panel (opts.access, decrypted in memory) never touches .env; the CLI path keeps it there.
  if (!opts.access && opts.cpanel) setEnvValues({ [envKey('OM_CPANEL_URL', slug)]: opts.cpanel, [envKey('OM_CPANEL_USER', slug)]: opts.cpanelUser, [envKey('OM_CPANEL_TOKEN', slug)]: opts.cpanelToken });
  if (!opts.access && opts.ssh) setEnvValues({ [envKey('OM_SSH_TARGET', slug)]: opts.ssh, [envKey('OM_SSH_KEY', slug)]: opts.sshKey });
  const access = opts.access ?? accessFor(slug, process.env);
  // The executor reads site access from its environment: hand it over for this one child process only.
  const execEnv = opts.access ? { ...process.env, ...(opts.access.method === 'cpanel' ? { [envKey('OM_CPANEL_URL', slug)]: opts.access.url, [envKey('OM_CPANEL_USER', slug)]: opts.access.user, [envKey('OM_CPANEL_TOKEN', slug)]: opts.access.token } : { [envKey('OM_SSH_TARGET', slug)]: opts.access.target, [envKey('OM_SSH_KEY', slug)]: opts.access.key }) } : process.env;
  const webroot = opts.webroot ?? 'public_html';
  let wordpress = /wp-content|wp-includes/i.test(fs.existsSync(path.join(root, 'products', slug, 'research', 'crawl', 'instant.json')) ? fs.readFileSync(path.join(root, 'products', slug, 'research', 'crawl', 'instant.json'), 'utf8') : '');

  // 3. Read-only access check.
  if (access) {
    try { const c = await checkAccess(access, webroot, opts); wordpress = wordpress || c.wordpress; step('site access', true, `${c.method}: ${c.entries} entries in ${webroot}${c.wordpress ? ', WordPress found' : ''}`); }
    catch (e) { step('site access', false, String(e.message).slice(0, 200)); }
  } else step('site access', false, `no access given: add --cpanel/--cpanel-user (token in .env as ${envKey('OM_CPANEL_TOKEN', slug)}) or --ssh`);

  // 4. Site secret and the install plan.
  if (wordpress) { const a = node('attach.mjs', [slug, '--stack', 'wordpress', '--no-embed-secret']); step('site secret', a.status === 0, a.status === 0 ? `kept in .env as ${secretEnvName(slug)}` : String(a.stderr).slice(0, 200)); }
  const plan = installPlan({ slug, domain: clean, webroot, wordpress });
  const pdir = path.join(root, 'products', slug);
  fs.mkdirSync(path.join(pdir, 'outbox', 'site-install'), { recursive: true });
  writeJson(path.join(pdir, 'outbox', 'site-install', 'plan.json'), plan);

  // 5. One approval for the install (only when there is something to install and a way to do it).
  if (plan.files.length && access) {
    const now = new Date().toISOString();
    const taskId = `ADD-${now.slice(0, 10)}-${slug}`;
    fs.mkdirSync(path.join(pdir, 'runs'), { recursive: true });
    writeJson(path.join(pdir, 'runs', `${taskId}.json`), { task_id: taskId, agent: 'om-tracking-engineer', status: 'done', summary: `Install plan for ${clean}`, output: ['outbox/site-install/plan.json'], approvals: [{ type: 'publish', channel: 'site-install', title: `Install Whalyom on ${clean} (${plan.files.length} new files over ${access.method})`, file: 'outbox/site-install/plan.json' }] });
    node('apply-results.mjs', [slug]);
    const ap = readJson(path.join(pdir, 'approvals.json'), []).filter((x) => x.channel === 'site-install' && x.status === 'pending').at(-1);
    if (ap && opts.approveInstall) {
      const inbox = path.join(os.tmpdir(), `om-add-${process.pid}.json`);
      writeJson(inbox, { decisions: [{ product: slug, approval_id: ap.id, decision: 'approve', at: new Date().toISOString(), note: 'approved with add-product --approve-install' }], requests: [] });
      node('apply-decisions.mjs', [inbox]); fs.rmSync(inbox, { force: true });
      const ex = lastJson(node('execute.mjs', [slug], execEnv));
      const done = readJson(path.join(pdir, 'approvals.json'), []).find((x) => x.id === ap.id);
      step('install on the site', done?.status === 'executed', done?.result ?? done?.last_error ?? JSON.stringify(ex ?? {}).slice(0, 200));
    } else if (ap) step('install on the site', true, `waiting for your approval (${ap.id}): approve it in the Command Center or run again with --approve-install`);
  } else if (!plan.files.length) step('install on the site', false, plan.manual);

  // 6. The hub runs the AI onboarding on Claude Platform.
  const key = Boolean(String(process.env.WHALYOM_ANTHROPIC_API_KEY ?? '').trim());
  if (!key) step('AI onboarding', false, 'WHALYOM_ANTHROPIC_API_KEY is not set in .env: the AI onboarding waits in the queue');
  else if (opts.hub === false) step('AI onboarding', true, 'queued; start the hub (node tools/hub-service.mjs) to run it');
  else if (hubRunning()) step('AI onboarding', true, 'queued; the running hub starts it within a minute on Claude Platform');
  else {
    const child = spawn(process.execPath, [path.join(root, 'tools', 'hub-service.mjs')], { cwd: root, detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    step('AI onboarding', true, `queued; hub started (pid ${child.pid}), it runs the onboarding on Claude Platform`);
  }
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  loadEnv();
  const argv = process.argv.slice(2);
  const opt = (k) => { const i = argv.indexOf(`--${k}`); return i > -1 ? argv[i + 1] : undefined; };
  const domain = argv[0];
  if (!domain || domain.startsWith('--')) { console.error('Usage: node tools/add-product.mjs <domain> [--cpanel https://host:2083 --cpanel-user U [--cpanel-token T]] [--ssh user@host[:port] [--ssh-key path]] [--webroot public_html] [--approve-install] [--no-hub] [--name N] [--preset P]'); process.exit(2); }
  try {
    const r = await addProduct(domain, { name: opt('name'), preset: opt('preset'), cpanel: opt('cpanel'), cpanelUser: opt('cpanel-user'), cpanelToken: opt('cpanel-token'), ssh: opt('ssh'), sshKey: opt('ssh-key'), webroot: opt('webroot'), approveInstall: argv.includes('--approve-install'), hub: !argv.includes('--no-hub') });
    console.log(`\nWhalyom: ${r.domain} → products/${r.slug}`);
    for (const s of r.steps) console.log(`  ${s.ok ? '✓' : '✗'} ${s.step}: ${s.detail}`);
    console.log(`\nWatch it in the Command Center (npm run command-center) and the AI spend with: node tools/ai-modes.mjs usage`);
  } catch (e) { console.error(`add-product: ${e.message}`); process.exit(1); }
}
