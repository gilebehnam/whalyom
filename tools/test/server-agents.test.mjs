// Command Center "New agent", branding and autonomy routes (tools/server.mjs):
//   - POST /api/agents needs the per-start owner token, writes only an evolution proposal (never ships an agent,
//     never sets red_team), refuses forms the builder refuses, and only passes the form fields on;
//   - GET /api/agents/options lists departments, models, tools and skills;
//   - GET /branding serves validated white-label fields only (bad fields dropped, no support e-mail), else 404;
//   - live/autonomy is part of the live stream.
// Proposals go to a temp WHALYOM_HOME, so the repo's state/evolution is never touched. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { root } from '../lib/env.mjs';
import { testEnv } from './_env.mjs';

const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const rmRetry = async (f) => { for (let i = 0; i < 40; i++) { try { fs.rmSync(f, { recursive: true, force: true }); return; } catch { await new Promise((r) => setTimeout(r, 250)); } } };

test('New agent writes a held proposal only, with the owner token; branding and autonomy are served safely', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-srv-agents-'));
  fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'knowledge'), { recursive: true });
  fs.copyFileSync(path.join(root, 'config', 'evolution.json'), path.join(tmp, 'config', 'evolution.json'));
  fs.writeFileSync(path.join(tmp, 'knowledge', 'base.json'), JSON.stringify({ facts: [] }));
  // Planted only when absent, and removed afterwards.
  const brandFile = path.join(root, 'config', 'branding.json');
  const plantBrand = !fs.existsSync(brandFile);
  if (plantBrand) fs.writeFileSync(brandFile, JSON.stringify({ name: 'Acme Growth', primary_color: '#1A73E8', logo_url: 'javascript:alert(1)', support_email: 'help@acme.example', custom_domain: 'app.acme.example' }));
  const autoFile = path.join(root, 'state', 'live-autonomy.json');
  const plantAuto = !fs.existsSync(autoFile);
  if (plantAuto) fs.writeFileSync(autoFile, JSON.stringify({ generated_at: '2026-11-04T10:00:00.000Z', products: [{ slug: 'zz-demo', level: 'supervised', earned_on: true, need: 10, held: false, counts: { manual: 1, earned: 1 }, rows: [{ key: 'post|linkedin', mode: 'manual', streak: 7, need: 10, next: 'post|linkedin: 7 of 10', last_break: null, held: false }, { key: 'post|x', mode: 'earned', streak: 12, need: 10, next: null, last_break: null, held: false }] }] }));
  const learnedBefore = fs.existsSync(path.join(root, 'config', 'learned-agents.json')) ? fs.readFileSync(path.join(root, 'config', 'learned-agents.json'), 'utf8') : null;
  const slug = `zz-radar-${process.pid}`;

  const port = await freePort();
  const env = testEnv(process.env, { WHALYOM_HOME: tmp, WHALYOM_KNOWLEDGE: path.join(tmp, 'knowledge') });
  const srv = spawn(process.execPath, [path.join(root, 'tools', 'server.mjs'), '--port', String(port)], { cwd: root, env });
  try {
    await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('server did not start')), 30000); srv.stdout.on('data', (d) => { if (String(d).includes('Command Center')) { clearTimeout(t); resolve(); } }); });
    const base = `http://127.0.0.1:${port}`;
    const html = await (await fetch(base + '/')).text();
    const tok = html.match(/"token":"([a-f0-9]+)"/)[1];
    assert.match(html, /id="autoPane"/); assert.match(html, /id="agDlg"/); assert.match(html, /id="cloudDlg"/);
    const post = (p, b, t = tok) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(t ? { 'x-whalyom-token': t } : {}) }, body: JSON.stringify(b) });
    const form = (over = {}) => ({
      name: slug, title: 'Churn Radar', dept: 'lifecycle', model: 'haiku', skills: ['kj-retention'],
      does: 'Reads usage exports and flags accounts showing early churn signals each week.',
      notes: 'Read product.json, profile.md, claims.md and LEARNINGS.md first. Draft save offers only from claims.md.',
      outputs: ['research/grown/churn-radar.md'], tools: ['WebSearch', 'WebFetch'], ...over,
    });

    // Options for the form.
    const opt = await (await fetch(base + '/api/agents/options')).json();
    assert.ok(opt.departments.some((d) => d.id === 'lifecycle' && d.shippable));
    assert.deepEqual(opt.models.filter((m) => !['sonnet', 'haiku'].includes(m)), []);
    assert.ok(opt.tools.includes('WebSearch') && !opt.tools.includes('Bash'));
    assert.ok(opt.skills.includes('kj-retention'));

    // No token, wrong token: refused, nothing written.
    assert.equal((await post('/api/agents', form(), '')).status, 403);
    assert.equal((await post('/api/agents', form(), 'f'.repeat(32))).status, 403);
    const dir = path.join(tmp, 'state', 'evolution', 'proposals');
    assert.ok(!fs.existsSync(dir) || fs.readdirSync(dir).length === 0, 'nothing written without the token');

    // Forms the builder refuses come back as 400 with the reasons.
    const bad = await post('/api/agents', form({ tools: ['Bash'], notes: 'Email jane@example.com every lead.' }));
    assert.equal(bad.status, 400);
    const bj = await bad.json();
    assert.equal(bj.ok, false);
    assert.ok(bj.errors.some((e) => /tool Bash is not allowed/.test(e)));
    assert.ok(bj.errors.some((e) => /email address/.test(e)));
    assert.equal((await post('/api/agents', [1, 2])).status, 400, 'an array body is refused');

    // A valid form: a proposal only. A smuggled red_team / status / id never reaches it.
    const ok = await post('/api/agents', { ...form(), red_team: { passed: true }, status: 'applied', id: 'EVO-evil', activate: true });
    assert.equal(ok.status, 200);
    const oj = await ok.json();
    assert.equal(oj.ok, true); assert.equal(oj.shipped, false);
    assert.equal(oj.agent, `om-grown-${slug}`);
    assert.match(oj.id, new RegExp(`^EVO-build-\\d{4}-\\d{2}-\\d{2}-${slug}$`));
    assert.ok(oj.gates.some((g) => /red-team/.test(g)), 'held for the red team');
    const file = path.join(tmp, oj.file);
    assert.ok(file.startsWith(path.join(tmp, 'state', 'evolution', 'proposals')));
    const prop = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(prop.kind, 'new-agent'); assert.equal(prop.red_team, undefined); assert.equal(prop.status, undefined); assert.equal(prop.activate, undefined);
    assert.equal(prop.id, oj.id);
    assert.ok(!fs.existsSync(path.join(root, '.claude', 'agents', `om-grown-${slug}.md`)), 'no agent file is built');
    assert.ok(!fs.existsSync(path.join(tmp, 'config', 'learned-agents.json')), 'nothing shipped in the temp home');
    const learnedAfter = fs.existsSync(path.join(root, 'config', 'learned-agents.json')) ? fs.readFileSync(path.join(root, 'config', 'learned-agents.json'), 'utf8') : null;
    assert.equal(learnedAfter, learnedBefore, 'repo learned agents untouched');

    // A second proposal for the same agent is refused (one waits already).
    const dup = await post('/api/agents', form());
    assert.equal(dup.status, 400);
    assert.ok((await dup.json()).errors.some((e) => /already/.test(e)));

    // Branding: only validated fields, never the support e-mail or domain.
    const br = await fetch(base + '/branding');
    assert.equal(br.headers.get('cache-control'), 'no-store');
    if (plantBrand) {
      assert.equal(br.status, 200);
      const b = (await br.json()).branding;
      assert.deepEqual(b, { name: 'Acme Growth', logo_url: null, primary_color: '#1a73e8' });
    }
    assert.equal((await fetch(base + '/branding', { method: 'POST', headers: { 'x-whalyom-token': tok } })).status, 404, 'branding is read-only');

    // The autonomy doc streams with the other live docs.
    const ctrl = new AbortController();
    const res = await fetch(base + '/stream', { signal: ctrl.signal });
    const reader = res.body.getReader(); let got = '';
    const deadline = Date.now() + 10000;
    while (!got.includes('"path":"live/autonomy"') && Date.now() < deadline) got += new TextDecoder().decode((await reader.read()).value);
    ctrl.abort();
    assert.ok(got.includes('"path":"live/autonomy"'), 'streams live/autonomy');
  } finally {
    srv.kill();
    if (plantBrand) await rmRetry(brandFile);
    if (plantAuto) await rmRetry(autoFile);
    await rmRetry(tmp);
  }
});

test('without config/branding.json the branding route answers 404', { skip: fs.existsSync(path.join(root, 'config', 'branding.json')) }, async () => {
  const port = await freePort();
  const srv = spawn(process.execPath, [path.join(root, 'tools', 'server.mjs'), '--port', String(port)], { cwd: root, env: testEnv() });
  try {
    await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('server did not start')), 30000); srv.stdout.on('data', (d) => { if (String(d).includes('Command Center')) { clearTimeout(t); resolve(); } }); });
    const r = await fetch(`http://127.0.0.1:${port}/branding`);
    assert.equal(r.status, 404);
    assert.deepEqual(await r.json(), { error: 'no branding' });
  } finally { srv.kill(); }
});
