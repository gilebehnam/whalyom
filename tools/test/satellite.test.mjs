// Site attachment end to end: attach a domain, run its satellite, collect first-party events,
// pull them from the hub, and apply an approved change on the site through the satellite.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { satellite } from '../lib/satellite-client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const slug = `zzsat${process.pid}`;
const domain = `${slug}.test`;
const siteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-site-'));
// Every spawned tool keeps its secrets in a temp file (OM_ENV_FILE), never in the repo's real .env.
const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-env-'));
const envFile = path.join(envDir, '.env');
const realEnv = path.join(root, '.env');
const hashFile = (f) => (fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') : null);
let realEnvBefore;
const port = 4700 + (process.pid % 200);
const base = `http://127.0.0.1:${port}`;
let sat; let secret;
const node = (script, args = [], env = {}) => {
  const r = spawnSync(process.execPath, [path.join(root, 'tools', script), ...args], { encoding: 'utf8', cwd: root, env: { ...process.env, OM_ENV_FILE: envFile, ...env } });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout;
};
const startSat = (extra = []) => new Promise((resolve, reject) => {
  sat = spawn(process.execPath, [path.join(root, 'tools', 'satellite', 'whalyom-satellite.mjs'), '--root', siteRoot, '--secret', secret, '--port', String(port), ...extra], { env: { ...process.env, OM_ENV_FILE: envFile } });
  const t = setTimeout(() => reject(new Error('satellite did not start')), 10000);
  sat.stdout.on('data', (d) => { if (String(d).includes('Whalyom satellite')) { clearTimeout(t); resolve(); } });
});
const stopSat = () => new Promise((r) => { sat.once('exit', r); sat.kill(); });

before(async () => {
  fs.writeFileSync(path.join(siteRoot, 'index.html'), '<h1>Home</h1>');
  fs.writeFileSync(path.join(siteRoot, '.env'), 'DB_PASSWORD=hunter2');
  realEnvBefore = hashFile(realEnv);
  const out = JSON.parse(node('attach.mjs', [domain, '--name', 'Satellite Test', '--satellite', base]));
  assert.equal(out.slug, slug);
  secret = fs.readFileSync(envFile, 'utf8').match(new RegExp(`OM_SAT_SECRET_${slug.toUpperCase()}=([a-f0-9]+)`))[1];
  await startSat();
});
after(async () => {
  if (sat && sat.exitCode === null) await stopSat();
  fs.rmSync(path.join(root, 'products', slug), { recursive: true, force: true });
  fs.rmSync(path.join(root, 'sites', slug), { recursive: true, force: true });
  fs.rmSync(siteRoot, { recursive: true, force: true });
  try {
    assert.equal(hashFile(realEnv), realEnvBefore, 'the repo .env is never written by the test');
    assert.match(fs.readFileSync(envFile, 'utf8'), new RegExp(`^OM_SAT_SECRET_${slug.toUpperCase()}=`, 'm'));
  } finally { fs.rmSync(envDir, { recursive: true, force: true }); }
});

test('attach writes the workspace, connection and a one-file installer', () => {
  const conn = JSON.parse(fs.readFileSync(path.join(root, 'products', slug, 'connection.json'), 'utf8'));
  assert.equal(conn.domain, domain); assert.equal(conn.satellite, base);
  const inst = fs.readFileSync(path.join(root, 'sites', slug, 'install-satellite.sh'), 'utf8');
  assert.match(inst, /systemd/); assert.match(inst, new RegExp(secret));
  assert.ok(fs.readFileSync(path.join(root, '.gitignore'), 'utf8').includes('sites/'), 'installers with secrets stay out of git');
});

test('attach refuses a plain-http satellite URL unless the host is local', () => {
  const run = (a) => spawnSync(process.execPath, [path.join(root, 'tools', 'attach.mjs'), ...a], { encoding: 'utf8', cwd: root, env: { ...process.env, OM_ENV_FILE: envFile } });
  // A new domain: refused before any workspace or connection is created.
  const plainSlug = `zzplain${process.pid}`;
  try {
    const r = run([`${plainSlug}.test`, '--satellite', 'http://example.test']);
    assert.equal(r.status, 2, r.stderr || r.stdout);
    assert.match(r.stderr, /https/);
    assert.equal(fs.existsSync(path.join(root, 'products', plainSlug, 'connection.json')), false);
    assert.equal(run([`${plainSlug}.test`, '--satellite', 'not a url']).status, 2);
  } finally {
    fs.rmSync(path.join(root, 'products', plainSlug), { recursive: true, force: true });
    fs.rmSync(path.join(root, 'sites', plainSlug), { recursive: true, force: true });
  }
  // An existing workspace: the saved local satellite stays, the cleartext one is never stored.
  const connFile = path.join(root, 'products', slug, 'connection.json');
  const r = run([slug, '--satellite', 'http://example.test']);
  assert.equal(r.status, 2, r.stderr || r.stdout);
  assert.equal(JSON.parse(fs.readFileSync(connFile, 'utf8')).satellite, base);
  // A local http host (the before() hook) and https are accepted.
  assert.equal(run([slug, '--satellite', base]).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(connFile, 'utf8')).satellite, base);
});

test('satellite only answers signed requests and never exposes secrets', async () => {
  assert.equal((await fetch(`${base}/_whalyom/health`)).status, 401);
  const s = satellite(base, secret);
  const h = await s.health();
  assert.equal(h.ok, true); assert.equal(h.writes, false);
  const listing = await s.files('');
  assert.ok(listing.entries.some((e) => e.name === 'index.html'));
  assert.ok(!listing.entries.some((e) => e.name === '.env'));
  await assert.rejects(s.files('.env'), /not found or not allowed/);
  await assert.rejects(s.files('../../etc/hosts'), /not found or not allowed/);
  await assert.rejects(satellite(base, 'x'.repeat(64)).health(), /bad signature/);
});

test('first-party tracking flows into hub metrics, leads and site status', async () => {
  const js = await (await fetch(`${base}/whalyom.js`)).text();
  assert.match(js, /sendBeacon/);
  const hit = (b) => fetch(`${base}/collect`, { method: 'POST', body: JSON.stringify(b) });
  assert.equal((await hit({ type: 'pageview', path: '/', utm: { source: 'reddit', campaign: 'launch' } })).status, 204);
  assert.equal((await hit({ type: 'lead', path: '/pricing', utm: { source: 'reddit', campaign: 'launch' }, form: 'trial' })).status, 204);
  assert.equal((await hit({ type: 'conversion', path: '/thanks', value: 19, utm: { source: 'reddit', campaign: 'launch' } })).status, 204);
  assert.equal((await hit({ type: 'evil' })).status, 400);
  const out = JSON.parse(node('sync-sites.mjs').trim().split(/\r?\n/).at(-1));
  assert.ok(out.sites_status.includes(`${domain}:connected`));
  node('metrics.mjs', [slug]);
  const kpis = JSON.parse(fs.readFileSync(path.join(root, 'products', slug, 'metrics', 'kpis.json'), 'utf8'));
  const get = (m) => kpis.filter((k) => k.metric === m && k.channel === 'reddit').reduce((s, k) => s + k.value, 0);
  assert.equal(get('sessions'), 1); assert.equal(get('leads'), 1); assert.equal(get('client_conversions'), 1); assert.equal(get('client_revenue'), 19);
  assert.equal(get('conversions'), 0, 'browser beacons never count as server-side conversions'); assert.equal(get('revenue'), 0);
  assert.match(fs.readFileSync(path.join(root, 'products', slug, 'leads.jsonl'), 'utf8'), /"form":"trial"/);
  // state/live-sites.json is shared: a running hub syncs with the real .env, which never holds this test's
  // secret, and can overwrite the row with 'no-secret'. Re-sync this one site and read again a few times.
  const liveState = () => JSON.parse(fs.readFileSync(path.join(root, 'state', 'live-sites.json'), 'utf8')).sites.find((s) => s.product === slug)?.state;
  let state = liveState();
  for (let i = 0; i < 5 && state !== 'connected'; i++) { node('sync-sites.mjs', ['--only', slug]); state = liveState(); }
  assert.equal(state, 'connected');
  assert.equal(JSON.parse(node('sync-sites.mjs').trim().split(/\r?\n/).at(-1)).sites, out.sites, 'second sync is idempotent');
});

test('a failed write never moves the lead cursor past consented lead details', async () => {
  const dir = path.join(root, 'products', slug);
  const connFile = path.join(dir, 'connection.json');
  const totalsFile = path.join(dir, 'metrics', 'satellite-totals.json');
  const leadsFile = path.join(dir, 'leads.jsonl');
  const lastLead = JSON.parse(fs.readFileSync(connFile, 'utf8')).last_lead;
  const r = await fetch(`${base}/collect`, { method: 'POST', body: JSON.stringify({ type: 'lead', path: '/demo', form: 'cursor-check', consent: true, email: 'cursor@example.test' }) });
  assert.equal(r.status, 204);
  // A directory in place of the totals file makes atomicWrite's rename fail, as a locked file would.
  const saved = fs.readFileSync(totalsFile, 'utf8');
  fs.rmSync(totalsFile); fs.mkdirSync(totalsFile);
  try {
    const out = JSON.parse(node('sync-sites.mjs').trim().split(/\r?\n/).at(-1));
    assert.ok(out.sites_status.includes(`${domain}:unreachable`));
    assert.equal(JSON.parse(fs.readFileSync(connFile, 'utf8')).last_lead, lastLead, 'lead cursor did not move');
    assert.doesNotMatch(fs.existsSync(leadsFile) ? fs.readFileSync(leadsFile, 'utf8') : '', /cursor@example\.test/);
  } finally { fs.rmSync(totalsFile, { recursive: true, force: true }); fs.writeFileSync(totalsFile, saved); }
  const out = JSON.parse(node('sync-sites.mjs').trim().split(/\r?\n/).at(-1));
  assert.ok(out.sites_status.includes(`${domain}:connected`));
  const lead = fs.readFileSync(leadsFile, 'utf8').trim().split(/\r?\n/).map((l) => JSON.parse(l)).find((l) => l.form === 'cursor-check');
  assert.equal(lead?.contact?.email, 'cursor@example.test');
  assert.notEqual(JSON.parse(fs.readFileSync(connFile, 'utf8')).last_lead, lastLead, 'lead cursor moves once the lead is written');
});

test('approved change is applied on the site through the satellite, with a backup', async () => {
  const dir = path.join(root, 'products', slug);
  fs.mkdirSync(path.join(dir, 'outbox', 'site'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'outbox', 'site', 'home.md'), '---\ntitle: Home\npath: index.html\n---\n<h1>Home, improved</h1>\n');
  fs.writeFileSync(path.join(dir, 'approvals.json'), JSON.stringify([{ id: 'A1', type: 'site-change', channel: 'site', title: 'Better home', file: 'outbox/site/home.md', compliance: 'pass', status: 'approved' }]));
  // Writes are off: the executor records a failure, the site is untouched.
  let r = JSON.parse(node('execute.mjs', [slug], { OM_KILL: '' }).trim().split(/\r?\n/).at(-1));
  assert.equal(r.failed, 1);
  assert.equal(fs.readFileSync(path.join(siteRoot, 'index.html'), 'utf8'), '<h1>Home</h1>');
  await stopSat();
  await startSat(['--allow-writes']);
  r = JSON.parse(node('execute.mjs', [slug], { OM_KILL: '' }).trim().split(/\r?\n/).at(-1));
  assert.equal(r.executed, 1, JSON.stringify(r));
  assert.equal(fs.readFileSync(path.join(siteRoot, 'index.html'), 'utf8'), '<h1>Home, improved</h1>\n');
  assert.equal(fs.readdirSync(path.join(siteRoot, '.whalyom', 'backups')).length, 1);
  assert.match(fs.readFileSync(path.join(siteRoot, '.whalyom', 'audit.jsonl'), 'utf8'), /"op":"apply"/);
});
