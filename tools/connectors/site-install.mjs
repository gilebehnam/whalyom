// Installs Whalyom on the product's own website over cPanel or SSH, after the owner approved it.
// An approved "publish" item with channel "site-install" carries a plan file (outbox/site-install/plan.json,
// written by tools/add-product.mjs) listing files to place on the server. It only ADDS files under the
// site's web root (the WordPress plugin and a must-use loader, or a standalone collector); it never edits
// or deletes an existing file, and refuses any path that leaves the web root.
// Access, from the local .env only (never stored in the workspace, never logged):
//   cPanel: OM_CPANEL_URL_<SLUG> (https://host:2083), OM_CPANEL_USER_<SLUG>, OM_CPANEL_TOKEN_<SLUG> (API token)
//   SSH:    OM_SSH_TARGET_<SLUG> (user@host or user@host:port), OM_SSH_KEY_<SLUG> (path to the private key file)
// cPanel calls: UAPI Fileman::list_files and Fileman::save_file_content, API 2 Fileman::mkdir for new
// folders (verify against current cPanel API docs). SSH uses the system ssh with BatchMode (no prompts).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { redact } from './_http.mjs';
import { root } from '../lib/env.mjs';

export const envKey = (base, slug) => `${base}_${String(slug).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
export const accessFor = (slug, env = process.env) => {
  const cp = { url: env[envKey('OM_CPANEL_URL', slug)], user: env[envKey('OM_CPANEL_USER', slug)], token: env[envKey('OM_CPANEL_TOKEN', slug)] };
  if (cp.url && cp.user && cp.token) return { method: 'cpanel', ...cp };
  const ssh = { target: env[envKey('OM_SSH_TARGET', slug)], key: env[envKey('OM_SSH_KEY', slug)] };
  if (ssh.target) return { method: 'ssh', ...ssh };
  return null;
};

// A relative path inside the web root, or null.
export function safeRel(p) {
  const n = path.posix.normalize(String(p ?? '').replace(/\\/g, '/')).replace(/^\/+/, '');
  if (!n || n === '.' || n.startsWith('..') || n.includes('/../') || /^[a-z]:/i.test(n)) return null;
  return n;
}

const cpanelBase = (a) => String(a.url).replace(/\/+$/, '');
const cpHeaders = (a) => ({ authorization: `cpanel ${a.user}:${a.token}` });

export async function cpanelList(a, dir, { fetch: f = fetch } = {}) {
  const r = await f(`${cpanelBase(a)}/execute/Fileman/list_files?dir=${encodeURIComponent(dir)}&include_mime=0`, { headers: cpHeaders(a) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.status !== 1) throw new Error(`cPanel list ${dir}: HTTP ${r.status} ${(j.errors ?? []).join(' ').slice(0, 160)}`);
  return (j.data ?? []).map((x) => ({ name: x.file ?? x.name, type: x.type }));
}

async function cpanelEnsureDir(a, dir, f) {
  const parts = dir.split('/').filter(Boolean);
  for (let i = 1; i <= parts.length; i++) {
    const parent = parts.slice(0, i - 1).join('/') || '.';
    const name = parts[i - 1];
    const have = await cpanelList(a, parent, { fetch: f }).catch(() => []);
    if (have.some((x) => x.name === name)) continue;
    const r = await f(`${cpanelBase(a)}/json-api/cpanel?cpanel_jsonapi_apiversion=2&cpanel_jsonapi_module=Fileman&cpanel_jsonapi_func=mkdir&path=${encodeURIComponent(parent)}&name=${encodeURIComponent(name)}`, { headers: cpHeaders(a) });
    if (!r.ok) throw new Error(`cPanel mkdir ${parent}/${name}: HTTP ${r.status}`);
  }
}

async function cpanelPut(a, webroot, rel, content, f) {
  const full = `${webroot}/${rel}`;
  const dir = path.posix.dirname(full); const file = path.posix.basename(full);
  const existing = await cpanelList(a, dir, { fetch: f }).catch(() => null);
  if (existing?.some((x) => x.name === file)) return { rel, skipped: 'exists' };
  await cpanelEnsureDir(a, dir, f);
  const body = new URLSearchParams({ dir, file, content, from_charset: 'UTF-8', to_charset: 'UTF-8' });
  const r = await f(`${cpanelBase(a)}/execute/Fileman/save_file_content`, { method: 'POST', headers: { ...cpHeaders(a), 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.status !== 1) throw new Error(`cPanel save ${rel}: HTTP ${r.status} ${(j.errors ?? []).join(' ').slice(0, 160)}`);
  return { rel, written: true };
}

const sshArgs = (a) => {
  const m = String(a.target).match(/^([^@\s]+@[^:\s]+)(?::(\d+))?$/);
  if (!m) throw new Error('SSH target must be user@host or user@host:port');
  return ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15', ...(m[2] ? ['-p', m[2]] : []), ...(a.key ? ['-i', a.key] : []), m[1]];
};
export function sshRun(a, command, { input, run = spawnSync } = {}) {
  const r = run('ssh', [...sshArgs(a), command], { input, encoding: 'utf8', timeout: 60000 });
  if (r.error) throw new Error(`ssh: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`ssh exited ${r.status}: ${String(r.stderr ?? '').slice(0, 200)}`);
  return String(r.stdout ?? '');
}
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
function sshPut(a, webroot, rel, content, run) {
  const full = `${webroot}/${rel}`;
  // Write only when the file does not exist yet (set -C: no clobber); never overwrite the owner's files.
  const out = sshRun(a, `mkdir -p ${shq(path.posix.dirname(full))} && if [ -e ${shq(full)} ]; then echo EXISTS; else (set -C; cat > ${shq(full)}) && echo WROTE; fi`, { input: content, run });
  return out.includes('EXISTS') ? { rel, skipped: 'exists' } : { rel, written: true };
}

// Read-only access check used by tools/add-product.mjs before anything is planned.
export async function checkAccess(a, webroot, { fetch: f = fetch, run = spawnSync } = {}) {
  if (a.method === 'cpanel') { const list = await cpanelList(a, webroot, { fetch: f }); return { ok: true, method: 'cpanel', entries: list.length, wordpress: list.some((x) => x.name === 'wp-config.php' || x.name === 'wp-content') }; }
  const out = sshRun(a, `ls -1A ${shq(webroot)} | head -200`, { run });
  const names = out.split(/\r?\n/).filter(Boolean);
  return { ok: true, method: 'ssh', entries: names.length, wordpress: names.includes('wp-config.php') || names.includes('wp-content') };
}

export default {
  name: 'site-install',
  handles: 'type "publish" with channel "site-install" (adds the Whalyom plugin or collector files to the product\'s own site over cPanel or SSH)',
  needs: ['OM_CPANEL_URL_<SLUG> + OM_CPANEL_USER_<SLUG> + OM_CPANEL_TOKEN_<SLUG>, or OM_SSH_TARGET_<SLUG> (+ OM_SSH_KEY_<SLUG>)'],
  accepts: (item) => item.type === 'publish' && item.channel === 'site-install',
  configured: (env = {}) => Object.keys(env).some((k) => /^OM_(CPANEL_URL|SSH_TARGET)_/.test(k) && env[k]),
  usableFor: (ctx) => Boolean(accessFor(ctx.slug, ctx.env)),
  async execute(item, ctx) {
    const a = accessFor(ctx.slug, ctx.env);
    if (!a) return { ok: false, detail: `no cPanel or SSH access for ${ctx.slug} in .env` };
    let plan;
    try { plan = JSON.parse(fs.readFileSync(path.join(ctx.dir, item.file), 'utf8')); } catch (e) { return { ok: false, detail: `cannot read install plan ${item.file}: ${e.message}` }; }
    const webroot = String(plan.webroot ?? 'public_html').replace(/\/+$/, '');
    const files = (plan.files ?? []).map((x) => ({ rel: safeRel(x.path), source: x.source, content: x.content })).filter((x) => x.rel);
    if (!files.length || files.length !== (plan.files ?? []).length) return { ok: false, detail: 'install plan has no files or a path outside the web root' };
    if (ctx.dryRun) return { ok: true, ref: 'dry-run', detail: `would add ${files.length} file(s) under ${webroot} over ${a.method}` };
    const done = [];
    try {
      for (const x of files) {
        let content = x.content ?? fs.readFileSync(path.resolve(root, x.source), 'utf8');
        // The site secret is filled in here from .env, never written into the workspace.
        if (plan.secret_env && content.includes('__WHALYOM_SECRET__')) content = content.split('__WHALYOM_SECRET__').join(ctx.env[plan.secret_env] ?? '');
        done.push(a.method === 'cpanel' ? await cpanelPut(a, webroot, x.rel, content, ctx.fetch ?? fetch) : sshPut(a, webroot, x.rel, content, ctx.run ?? spawnSync));
      }
    } catch (e) { return { ok: false, detail: redact(String(e.message ?? e), ctx.env).slice(0, 300) }; }
    const written = done.filter((d) => d.written).length;
    return { ok: true, ref: `${a.method}:${webroot}`, detail: `added ${written} file(s), kept ${done.length - written} existing over ${a.method}; next: node tools/attach.mjs ${ctx.slug} --verify https://${plan.domain ?? ''}` };
  },
};
