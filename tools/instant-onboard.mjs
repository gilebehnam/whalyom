// Install-and-go: the moment a site installs Whalyom, this turns it into a working product workspace.
//   node tools/instant-onboard.mjs <domain|url> [--slug s] [--name n] [--stack snippet|wordpress|satellite|…]
//        [--now ISO] [--html-file f] [--no-queue]
// In seconds and without any LLM it:
//   1. creates products/<slug>/ (domain set) if it does not exist yet, marked "edge" when the site sends its
//      events to this hub;
//   2. reads the public home page, robots.txt, sitemap.xml and llms.txt and runs the instant audit
//      (tools/lib/site-audit.mjs): scores, the highest-impact fixes, and what the page itself says;
//   3. writes reports/instant-audit.md, research/crawl/instant.json and booster drafts (lead capture,
//      sticky CTA, structured data) to outbox/boosters/, each waiting for one owner approval;
//   4. records the quick-win tasks and the onboarding wave in a runs/ result and merges it with
//      tools/apply-results.mjs (the single writer), so the agents can start on them;
//   5. queues the full AI onboarding (state/queue/onboard-<slug>.json): the hub starts it with Claude Code
//      when it can (tools/hub-service.mjs), else the next daily run picks it up.
// Nothing is published, sent or spent: every booster and every outbound action waits for the owner.
import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditSite, auditMarkdown } from './lib/site-audit.mjs';
import { readJson, writeJson, root } from './lib/env.mjs';

// Node's fetch ignores HTTP(S)_PROXY unless NODE_USE_ENV_PROXY is set at startup: re-run once with it.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain && (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(r.status ?? 1);
}

export const slugFor = (host) => host.replace(/^www\./, '').replace(/\.[a-z]{2,}$/i, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'site';
export const hostOf = (input) => { const s = String(input).trim(); const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); return u.hostname.toLowerCase(); };

// The product whose domain is this host (www. ignored), if any.
export function productForHost(host, productsDir = path.join(root, 'products')) {
  const want = host.replace(/^www\./, '');
  for (const s of fs.existsSync(productsDir) ? fs.readdirSync(productsDir) : []) {
    if (s.startsWith('_')) continue;
    const p = readJson(path.join(productsDir, s, 'product.json'), null);
    if (p?.domain && String(p.domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').toLowerCase() === want) return s;
  }
  return null;
}

// Only public websites are fetched: a host given by a site (or a forged beacon) must never make this
// computer or the cloud box read its own network (router pages, cloud metadata at 169.254.169.254, …).
export const publicHostName = (h) => /^(?=.{3,253}$)[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z][a-z0-9-]{1,62}$/.test(h) && !/(^|\.)(localhost|local|internal|intranet|lan|home|corp|arpa)$/.test(h);
export function privateAddress(ip) {
  const a = String(ip).toLowerCase().replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(a)) {
    const [x, y] = a.split('.').map(Number);
    return x === 0 || x === 10 || x === 127 || (x === 100 && y >= 64 && y < 128) || (x === 169 && y === 254) || (x === 172 && y >= 16 && y < 32) || (x === 192 && y === 168) || (x === 198 && (y === 18 || y === 19)) || x >= 224;
  }
  return a === '::' || a === '::1' || /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(a);
}
async function publicTarget(url) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol) || !publicHostName(u.hostname.toLowerCase())) return `not a public web address: ${u.hostname}`;
  try {
    const { lookup } = await import('node:dns/promises');
    const addrs = await lookup(u.hostname, { all: true });
    if (!addrs.length || addrs.some((r) => privateAddress(r.address))) return `${u.hostname} points to a private network address`;
  } catch (e) { return `${u.hostname} does not resolve (${e.code ?? e.message})`; }
  return null;
}
async function get(url, timeoutMs = 15000) {
  try {
    let current = url;
    for (let hop = 0; hop < 5; hop++) {
      const bad = await publicTarget(current);
      if (bad) return { status: 0, text: '', bytes: 0, error: bad };
      const res = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'WhalyomAudit/1.0 (+site owner installed Whalyom)', accept: 'text/html,*/*' } });
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) { current = new URL(loc, current).toString(); continue; }
      const text = await res.text();
      return { status: res.status, text: text.slice(0, 3e6), bytes: text.length, url: current };
    }
    return { status: 0, text: '', bytes: 0, error: 'too many redirects' };
  } catch (e) { return { status: 0, text: '', bytes: 0, error: String(e.message ?? e) }; }
}
// profile.md is replaced by the audit draft only while it is still the untouched template (or missing):
// a profile the product analyst wrote, even one that starts with a plain "# Profile" heading, is never overwritten.
const norm = (t) => String(t).replace(/\r\n/g, '\n').trim();
export function isTemplateProfile(text) {
  const tplFile = path.join(root, 'products', '_template', 'profile.md');
  const tpl = fs.existsSync(tplFile) ? fs.readFileSync(tplFile, 'utf8') : null;
  return (tpl != null && norm(text) === norm(tpl)) || /^# Profile\s*\n+Written by om-product-analyst during onboarding\.\s*$/.test(norm(text));
}
const run = (args) => new Promise((resolve) => execFile(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 120000 }, (err) => resolve({ status: err ? (err.code ?? 1) : 0 })));

export async function instantOnboard(input, opts = {}) {
  const now = opts.now ?? new Date().toISOString();
  const host = hostOf(input);
  if (!publicHostName(host)) throw new Error(`${host} is not a public website domain`);
  const productsDir = opts.productsDir ?? path.join(root, 'products');
  let slug = opts.slug ?? productForHost(host, productsDir);
  const created = !slug;
  if (!slug) {
    slug = slugFor(host);
    let n = 2; while (fs.existsSync(path.join(productsDir, slug))) slug = `${slugFor(host)}-${n++}`;
    const made = await run([path.join(root, 'tools', 'new-product.mjs'), slug, '--domain', host.replace(/^www\./, ''), '--name', opts.name ?? host.replace(/^www\./, '')]);
    if (made.status !== 0) throw new Error(`could not create the workspace for ${host}`);
  }
  const dir = path.join(productsDir, slug);
  const origin = `https://${host}`;

  // 1. Public pages (or a fixture in tests).
  const home = opts.home ?? (opts.html != null ? { status: 200, text: opts.html, bytes: opts.html.length, url: `${origin}/` } : await get(`${origin}/`));
  // apply-results.mjs only knows <root>/products: a workspace elsewhere (tests) is never merged into the wrong one.
  const canMerge = opts.merge !== false && path.resolve(productsDir) === path.resolve(root, 'products');
  // A home page that could not be read (DNS, timeout, private address, 5xx) is not audited: an audit of an empty
  // page would ask the owner to switch on boosters for a site Whalyom never saw. The workspace and a report with
  // the reason and the retry commands are written; boosters, approvals, tasks and the onboarding queue wait.
  if (!home.status || home.status >= 500) {
    const error = home.error ?? `home page answered HTTP ${home.status}`;
    const p = readJson(path.join(dir, 'product.json'), {});
    p.installed_at ??= now;
    writeJson(path.join(dir, 'product.json'), p);
    const conn = readJson(path.join(dir, 'connection.json'), { domain: host.replace(/^www\./, '') });
    Object.assign(conn, { domain: conn.domain ?? host, installed_at: conn.installed_at ?? now, stack: opts.stack ?? conn.stack ?? 'snippet', ...(opts.edge ? { edge: true } : {}) });
    writeJson(path.join(dir, 'connection.json'), conn);
    fs.mkdirSync(path.join(dir, 'reports'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'reports', 'instant-audit.md'), `# Instant audit — ${host} (${now.slice(0, 10)})\n\n## Could not read ${origin}/: ${error}\n\nNothing was audited, so no boosters, approvals or quick-win tasks were created and the AI onboarding is not queued yet.\n\nRetry once the site is up:\n\n    node tools/instant-onboard.mjs ${host}\n\nor audit a saved copy of the home page:\n\n    node tools/instant-onboard.mjs ${host} --html-file saved.html\n`);
    fs.mkdirSync(path.join(dir, 'runs'), { recursive: true });
    const runId = `INSTANT-${now.replace(/[^0-9]/g, '').slice(0, 14)}`;
    writeJson(path.join(dir, 'runs', `${runId}.json`), { task_id: runId, agent: 'om-site-crawler', status: 'done', summary: `Instant audit of ${host} skipped: could not read the home page (${error}). Retry when the site is up.`.slice(0, 300), output: ['reports/instant-audit.md'], approvals: [], new_tasks: [] });
    const merged = canMerge ? await run([path.join(root, 'tools', 'apply-results.mjs'), slug, '--now', now]) : { status: 1 };
    return { slug, created, host, score: null, scores: null, boosters: [], approvals: 0, tasks: 0, merged: merged.status === 0, reachable: false, error };
  }
  const [robots, sitemap, llms] = opts.html != null ? [opts.robots ?? null, opts.sitemap ?? null, opts.llms ?? null] : await Promise.all(['/robots.txt', '/sitemap.xml', '/llms.txt'].map(async (p) => { const r = await get(origin + p, 8000); return r.status >= 200 && r.status < 300 && r.text ? r.text.slice(0, 200000) : null; }));
  const audit = auditSite({ url: home.url || `${origin}/`, html: home.text, robots, sitemap, llms, bytes: home.bytes, status: home.status || 0 });

  // 2. Workspace files.
  const p = readJson(path.join(dir, 'product.json'), {});
  if (created || !p.name || p.name === host) p.name = audit.facts.name || p.name;
  if (audit.facts.lang && !p.language_detected) p.language_detected = audit.facts.lang;
  p.installed_at ??= now;
  writeJson(path.join(dir, 'product.json'), p);
  const conn = readJson(path.join(dir, 'connection.json'), { domain: host.replace(/^www\./, '') });
  Object.assign(conn, { domain: conn.domain ?? host, installed_at: conn.installed_at ?? now, stack: opts.stack ?? conn.stack ?? 'snippet', ...(opts.edge ? { edge: true } : {}) });
  writeJson(path.join(dir, 'connection.json'), conn);
  fs.mkdirSync(path.join(dir, 'research', 'crawl'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'reports'), { recursive: true });
  writeJson(path.join(dir, 'research', 'crawl', 'instant.json'), { at: now, scores: audit.scores, facts: audit.facts, checks: audit.checks });
  fs.writeFileSync(path.join(dir, 'reports', 'instant-audit.md'), auditMarkdown(audit, now));
  if (!fs.existsSync(path.join(dir, 'profile.md')) || isTemplateProfile(fs.readFileSync(path.join(dir, 'profile.md'), 'utf8'))) {
    fs.writeFileSync(path.join(dir, 'profile.md'), `# Profile (first draft from the instant audit, ${now.slice(0, 10)})\n\n- Name: ${audit.facts.name}\n- Site: ${origin}\n- What the home page says: ${audit.facts.title}${audit.facts.description ? ` — ${audit.facts.description}` : ''}\n- Main calls to action: ${audit.facts.ctas.map((c) => c.text).join(' · ') || 'none found'}\n- Language: ${audit.facts.lang ?? 'unknown'}\n\nThe product analyst replaces this with the full profile during onboarding. Claims stay empty until verified in claims.md.\n`);
  }

  // 3. Booster drafts + approvals; quick-win tasks; onboarding wave.
  fs.mkdirSync(path.join(dir, 'outbox', 'boosters'), { recursive: true });
  const existing = readJson(path.join(dir, 'approvals.json'), []);
  const approvals = [];
  for (const b of audit.boosters) {
    const file = `outbox/boosters/${b.id}.json`;
    writeJson(path.join(dir, file), b);
    if (existing.some((a) => a.file === file && a.status === 'pending')) continue;
    approvals.push({ type: 'publish', channel: 'onsite-booster', title: `Switch on: ${b.type.replace('-', ' ')} on ${host} — ${b.why}`.slice(0, 200), file });
  }
  // A domain that is not on the hub's allow-list gets the free audit now and its AI onboarding only after
  // the owner says yes (tools/hub-service.mjs waits for this approval).
  if (opts.needsOwner && !existing.some((a) => a.channel === 'ai-onboarding')) {
    approvals.push({ type: 'onboard', channel: 'ai-onboarding', title: `Start the AI onboarding for ${host}? It installed the Whalyom snippet; the free audit is in reports/instant-audit.md. Approve only if this is your site or a client's.`.slice(0, 240) });
  }
  const tasks = readJson(path.join(dir, 'tasks.json'), []);
  const open = new Set(tasks.filter((t) => t.status !== 'done').map((t) => t.agent));
  const new_tasks = [];
  if (!tasks.length) {
    new_tasks.push(
      { id: 'IO1', title: `Crawl ${host} in full`, agent: 'om-site-crawler', brief: 'Start from research/crawl/instant.json; crawl the whole site (pages, pricing, signup flow, tech, tracking) into research/crawl/.', priority: 1 },
      { id: 'IO2', title: 'Write the product profile and the first claims', agent: 'om-product-analyst', brief: 'Replace the draft profile.md; list only claims you can prove from the site in claims.md.', depends_on: ['IO1'], priority: 1 },
      { id: 'IO3', title: 'Define the ideal customer', agent: 'om-icp-builder', brief: 'ICP and two personas from the site, reviews and communities.', depends_on: ['IO2'], priority: 2 },
      { id: 'IO4', title: 'Map competitors and their prices', agent: 'om-competitor-intel', brief: 'Direct and indirect competitors, positioning, pricing, the channels they win on.', depends_on: ['IO2'], priority: 2 },
      { id: 'IO5', title: 'First 30-day growth plan', agent: 'om-cmo', brief: 'Use reports/instant-audit.md quick wins first; one revenue goal; the fastest path to the first sale.', depends_on: ['IO3', 'IO4'], priority: 1 },
    );
  }
  for (const [i, c] of audit.quickWins.slice(0, 6).entries()) {
    if (open.has(c.agent) && new_tasks.every((t) => t.agent !== c.agent)) continue;
    new_tasks.push({ id: `QW${i + 1}`, title: `Quick win: ${c.id} (${c.area})`, agent: c.agent, brief: `${c.fix} Evidence: reports/instant-audit.md. Draft the change to outbox/ with an approval; use only claims in claims.md.`, priority: 1 });
  }
  fs.mkdirSync(path.join(dir, 'runs'), { recursive: true });
  const runId = `INSTANT-${now.replace(/[^0-9]/g, '').slice(0, 14)}`;
  writeJson(path.join(dir, 'runs', `${runId}.json`), { task_id: runId, agent: 'om-site-crawler', status: 'done', summary: `Instant audit of ${host}: ${audit.scores.overall}/100; ${audit.boosters.length} booster(s) ready for approval; ${new_tasks.length} task(s) queued.`, output: ['reports/instant-audit.md', 'research/crawl/instant.json'], approvals, new_tasks });
  const merged = canMerge ? await run([path.join(root, 'tools', 'apply-results.mjs'), slug, '--now', now]) : { status: 1 };

  // 4. Queue the AI onboarding.
  if (opts.queue !== false) {
    fs.mkdirSync(path.join(root, 'state', 'queue'), { recursive: true });
    writeJson(path.join(root, 'state', 'queue', `onboard-${slug}.json`), { slug, host, queued_at: now, reason: created ? 'new site installed Whalyom' : 'site re-audited', ...(opts.needsOwner ? { needs_owner: true } : {}) });
  }
  return { slug, created, host, score: audit.scores.overall, scores: audit.scores, boosters: audit.boosters.map((b) => b.id), approvals: approvals.length, tasks: new_tasks.length, merged: merged.status === 0, reachable: Boolean(home.status), error: home.error };
}

if (isMain) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(`--${k}`); return i > -1 ? args[i + 1] : undefined; };
  if (!args[0] || args[0].startsWith('--')) { console.error('Usage: node tools/instant-onboard.mjs <domain|url> [--slug s] [--name n] [--stack s] [--edge] [--now ISO] [--html-file f] [--no-queue]'); process.exit(2); }
  const html = opt('html-file') ? fs.readFileSync(opt('html-file'), 'utf8') : undefined;
  const r = await instantOnboard(args[0], { slug: opt('slug'), name: opt('name'), stack: opt('stack'), edge: args.includes('--edge'), now: opt('now'), html, queue: !args.includes('--no-queue') });
  console.log(JSON.stringify(r));
  // An unreadable site exits 1 with the reason on stderr, so /api/install/site reports it instead of a success.
  if (!r.reachable) { console.error(`Could not read https://${r.host}/: ${r.error}. Nothing was audited; retry once the site is up, or pass --html-file saved.html.`); process.exit(1); }
}
