// AI creative generation: gates (kill switch, approval, label, likeness consent, creative budget), provider
// choice by env keys, request shapes, mocked generation (no network), provenance sidecar, register and ledger.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  chooseProvider, buildRequest, estimateCost, checkCreativeBudget, creativeSpent, checkGate, generateCreative,
  creativeConnector, configuredProviders,
} from '../creative-gen.mjs';
import { spentThisMonth } from '../budget.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-creative-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const NOW = '2026-11-04T10:00:00.000Z';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

let n = 0;
function product({ mode = 'free', creative = { monthly_cap: 5 }, stage = 'active', approval = 'approved', brief = {}, kill = false } = {}) {
  const dir = path.join(tmp, `p${++n}`);
  fs.mkdirSync(path.join(dir, 'outbox', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'product.json'), JSON.stringify({ slug: `p${n}`, stage, budget: { mode, monthly_cap: 0, daily_cap: 0, currency: 'USD' }, autonomy: { kill }, ...(creative ? { creative } : {}) }));
  const b = { id: 'hero', kind: 'image', title: 'Hero image', prompt: 'A clean desk with a laptop, soft light', size: '1024x1024', quality: 'medium', ...brief };
  fs.writeFileSync(path.join(dir, 'outbox', 'briefs', 'hero.json'), JSON.stringify(b));
  fs.writeFileSync(path.join(dir, 'approvals.json'), JSON.stringify(approval ? [{ id: 'A9', type: 'creative', file: 'outbox/briefs/hero.json', status: approval, compliance: 'pass' }] : []));
  return dir;
}
const BRIEF = 'outbox/briefs/hero.json';
const ENV = { OPENAI_API_KEY: 'sk-test-secret-123456' };

// Mock fetch: records calls, answers by URL.
function mockFetch(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, init });
    const h = routes.find(([m]) => url.includes(m));
    if (!h) throw new Error(`unexpected url ${url}`);
    const r = typeof h[1] === 'function' ? h[1](url, init, calls) : h[1];
    const body = r.bytes ?? (typeof r.json === 'string' ? r.json : JSON.stringify(r.json ?? {}));
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, text: async () => (Buffer.isBuffer(body) ? body.toString('latin1') : body), arrayBuffer: async () => { const b = Buffer.isBuffer(body) ? body : Buffer.from(body); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } };
  };
  f.calls = calls;
  return f;
}
const openaiOk = () => mockFetch([['api.openai.com/v1/images/generations', { json: { created: 1730000000, data: [{ b64_json: PNG.toString('base64') }] } }]]);

test('provider choice follows env keys and kind', () => {
  assert.equal(chooseProvider({ kind: 'image' }, {}).error.includes('no image provider'), true);
  assert.equal(chooseProvider({ kind: 'image' }, { STABILITY_API_KEY: 'x' }).provider, 'stability');
  assert.equal(chooseProvider({ kind: 'image' }, { STABILITY_API_KEY: 'x', OPENAI_API_KEY: 'y' }).provider, 'openai');
  assert.equal(chooseProvider({ kind: 'image' }, { STABILITY_API_KEY: 'x', OPENAI_API_KEY: 'y', OM_CREATIVE_IMAGE_PROVIDER: 'stability' }).provider, 'stability');
  // Runway needs an input image; Luma does not.
  assert.ok(chooseProvider({ kind: 'video' }, { RUNWAYML_API_SECRET: 'r' }).error.includes('input_image'));
  assert.equal(chooseProvider({ kind: 'video' }, { RUNWAYML_API_SECRET: 'r', LUMAAI_API_KEY: 'l' }).provider, 'luma');
  assert.equal(chooseProvider({ kind: 'video', input_image: 'x.png' }, { RUNWAYML_API_SECRET: 'r', LUMAAI_API_KEY: 'l' }).provider, 'runway');
  assert.ok(chooseProvider({ kind: 'video', provider: 'openai' }, ENV).error);
  assert.ok(chooseProvider({ kind: 'audio' }, ENV).error);
  assert.deepEqual(configuredProviders({ LUMAAI_API_KEY: 'l' }), ['luma']);
});

test('request shapes per provider', () => {
  const o = buildRequest('openai', { prompt: 'p', size: '1536x1024' }, ENV);
  assert.equal(o.url, 'https://api.openai.com/v1/images/generations');
  assert.equal(o.json.model, 'gpt-image-1');
  assert.equal(o.json.size, '1536x1024');
  assert.match(o.headers.authorization, /^Bearer /);
  const s = buildRequest('stability', { prompt: 'p', negative_prompt: 'text' }, { STABILITY_API_KEY: 'k' });
  assert.match(s.url, /\/v2beta\/stable-image\/generate\/core$/);
  assert.equal(s.form.negative_prompt, 'text');
  assert.equal(s.headers.accept, 'application/json');
  const r = buildRequest('runway', { prompt: 'p', duration: 5 }, { RUNWAYML_API_SECRET: 'k' }, { image_data_uri: 'data:image/png;base64,AA' });
  assert.equal(r.url, 'https://api.dev.runwayml.com/v1/image_to_video');
  assert.equal(r.headers['x-runway-version'], '2024-11-06');
  assert.equal(r.json.promptImage, 'data:image/png;base64,AA');
  assert.equal(r.json.duration, 5);
  const l = buildRequest('luma', { prompt: 'p', input_image: 'https://cdn.example/x.png' }, { LUMAAI_API_KEY: 'k' });
  assert.equal(l.url, 'https://api.lumalabs.ai/dream-machine/v1/generations');
  assert.equal(l.json.keyframes.frame0.url, 'https://cdn.example/x.png');
  assert.ok(estimateCost('runway', { duration: 10 }) > estimateCost('runway', { duration: 5 }));
  assert.equal(estimateCost('openai', {}, {}, { openai: 0.5 }), 0.5);
});

test('creative budget: free mode needs an explicit cap; caps are enforced; only kind "creative" counts', () => {
  const dir = product();
  const ledger = path.join(dir, 'ledger.jsonl');
  assert.equal(checkCreativeBudget({ budget: { mode: 'free' } }, ledger, 0.07, NOW).ok, false);
  assert.match(checkCreativeBudget({ budget: { mode: 'free' } }, ledger, 0.07, NOW).why, /free mode/);
  assert.equal(checkCreativeBudget({ budget: { mode: 'paid', monthly_cap: 500 } }, ledger, 0.07, NOW).ok, false, 'ad budget is never borrowed');
  assert.equal(checkCreativeBudget({ budget: { mode: 'free' }, creative: { monthly_cap: 1 } }, ledger, 0.07, NOW).ok, true);
  fs.writeFileSync(ledger, [
    { at: '2026-11-03T00:00:00Z', kind: 'creative', amount: 0.95, channel: 'creative' },
    { at: '2026-10-30T00:00:00Z', kind: 'creative', amount: 50, channel: 'creative' },
    { at: '2026-11-03T00:00:00Z', kind: 'spend', amount: 40, channel: 'meta' },
  ].map((x) => JSON.stringify(x)).join('\n') + '\n');
  assert.deepEqual(creativeSpent(ledger, NOW), { month: 0.95, today: 0 });
  assert.equal(checkCreativeBudget({ creative: { monthly_cap: 1 } }, ledger, 0.07, NOW).ok, false);
  assert.equal(checkCreativeBudget({ creative: { monthly_cap: 2, daily_cap: 0.05 } }, ledger, 0.07, NOW).ok, false);
  assert.equal(checkCreativeBudget({ creative: { monthly_cap: 2, daily_cap: 1 } }, ledger, 0.07, NOW).ok, true);
  // budget.mjs counts ad spend only: creative rows never move the ad caps.
  assert.equal(spentThisMonth(ledger, NOW, { kpis: false }), 40);
});

test('gates: kill switch, approval, label, likeness consent, free mode without cap', () => {
  assert.match(checkGate({ dir: product({ kill: true }), briefRel: BRIEF, env: ENV, now: NOW }).why, /kill switch/);
  assert.match(checkGate({ dir: product({ stage: 'paused' }), briefRel: BRIEF, env: ENV, now: NOW }).why, /kill switch/);
  assert.match(checkGate({ dir: product(), briefRel: BRIEF, env: { ...ENV, OM_KILL: '1' }, now: NOW }).why, /kill switch/);
  assert.match(checkGate({ dir: product({ approval: 'pending' }), briefRel: BRIEF, env: ENV, now: NOW }).why, /pending/);
  assert.match(checkGate({ dir: product({ approval: null }), briefRel: BRIEF, env: ENV, now: NOW }).why, /no approval/);
  assert.match(checkGate({ dir: product({ brief: { disable_label: true } }), briefRel: BRIEF, env: ENV, now: NOW }).why, /label/);
  assert.match(checkGate({ dir: product({ brief: { label: '' } }), briefRel: BRIEF, env: ENV, now: NOW }).why, /label/);
  assert.match(checkGate({ dir: product({ brief: { public_figure: true } }), briefRel: BRIEF, env: ENV, now: NOW }).why, /public figures/);
  assert.match(checkGate({ dir: product({ brief: { depicts_real_person: true } }), briefRel: BRIEF, env: ENV, now: NOW }).why, /consent/);
  assert.match(checkGate({ dir: product({ brief: { people: [{ consent_file: 'consent/x.pdf' }] } }), briefRel: BRIEF, env: ENV, now: NOW }).why, /consent/);
  assert.match(checkGate({ dir: product({ brief: { people: [{ consent_file: '../../etc/passwd' }] } }), briefRel: BRIEF, env: ENV, now: NOW }).why, /consent/);
  assert.match(checkGate({ dir: product({ creative: null }), briefRel: BRIEF, env: ENV, now: NOW }).why, /free mode/);
  assert.match(checkGate({ dir: product(), briefRel: 'approvals.json', env: ENV, now: NOW }).why, /outbox/);
  assert.match(checkGate({ dir: product(), briefRel: BRIEF, env: {}, now: NOW }).why, /no image provider/);
  const ok = checkGate({ dir: product(), briefRel: BRIEF, env: ENV, now: NOW });
  assert.equal(ok.ok, true);
  assert.equal(ok.provider, 'openai');
});

test('refused generation makes no network call and writes nothing', async () => {
  const dir = product({ approval: 'pending' });
  const f = openaiOk();
  const r = await generateCreative({ dir, briefRel: BRIEF, env: ENV, fetch: f, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(f.calls.length, 0);
  assert.equal(fs.existsSync(path.join(dir, 'ledger.jsonl')), false);
  assert.equal(fs.existsSync(path.join(dir, 'outbox', 'creative')), false);
});

test('dry run previews without network or ledger', async () => {
  const dir = product();
  const f = openaiOk();
  const r = await generateCreative({ dir, briefRel: BRIEF, env: ENV, fetch: f, now: NOW, dryRun: true });
  assert.equal(r.ok, true); assert.equal(r.dry_run, true);
  assert.equal(f.calls.length, 0);
  assert.equal(fs.existsSync(path.join(dir, 'ledger.jsonl')), false);
});

test('image generation writes asset, provenance, register entry and ledger row; no publish', async () => {
  const dir = product({ brief: { people: [{ ref: 'founder', consent_file: 'consent/founder.pdf' }] } });
  fs.mkdirSync(path.join(dir, 'consent'));
  fs.writeFileSync(path.join(dir, 'consent', 'founder.pdf'), 'signed');
  const approvalsBefore = fs.readFileSync(path.join(dir, 'approvals.json'), 'utf8');
  const f = openaiOk();
  const r = await generateCreative({ dir, briefRel: BRIEF, env: ENV, fetch: f, now: NOW });
  assert.equal(r.ok, true, r.why);
  assert.equal(f.calls.length, 1);
  assert.equal(JSON.parse(f.calls[0].init.body).prompt, 'A clean desk with a laptop, soft light');
  const asset = path.join(dir, r.provenance.assets[0].file);
  assert.deepEqual(fs.readFileSync(asset), PNG);
  assert.match(r.provenance.assets[0].file, /^outbox\/creative\/hero-\d{14}-[0-9a-f]{4}\/image\.png$/);
  const prov = JSON.parse(fs.readFileSync(path.join(path.dirname(asset), 'provenance.json'), 'utf8'));
  assert.equal(prov.ai_generated, true);
  assert.equal(prov.label, 'AI-generated');
  assert.equal(prov.provider, 'openai'); assert.equal(prov.model, 'gpt-image-1');
  assert.equal(prov.created_at, NOW);
  assert.equal(prov.cost.estimated, true);
  assert.equal(prov.consent[0].consent_file, 'consent/founder.pdf');
  assert.equal(prov.depicts_real_person, true);
  assert.equal(prov.brief_approval, 'A9');
  const reg = JSON.parse(fs.readFileSync(path.join(dir, 'research', 'ai-content-register.json'), 'utf8'));
  assert.equal(reg.length, 1); assert.equal(reg[0].id, r.id); assert.equal(reg[0].ai_generated, true);
  const led = fs.readFileSync(path.join(dir, 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(led.length, 1); assert.equal(led[0].kind, 'creative'); assert.equal(led[0].ref, r.id);
  // Nothing outbound: approvals.json untouched, a pending publish draft returned instead.
  assert.equal(fs.readFileSync(path.join(dir, 'approvals.json'), 'utf8'), approvalsBefore);
  assert.equal(r.approval_draft.status, 'pending'); assert.equal(r.approval_draft.type, 'publish'); assert.equal(r.approval_draft.ai_generated, true);
  // No secret anywhere in what was written.
  for (const file of [path.join(dir, 'ledger.jsonl'), path.join(dir, 'research', 'ai-content-register.json'), path.join(path.dirname(asset), 'provenance.json')]) assert.ok(!fs.readFileSync(file, 'utf8').includes(ENV.OPENAI_API_KEY));
});

test('provider error is redacted and not counted; cap stops a second run', async () => {
  const dir = product({ creative: { monthly_cap: 0.1 } });
  const bad = mockFetch([['api.openai.com', { status: 401, json: { error: { message: `bad key ${ENV.OPENAI_API_KEY}` } } }]]);
  const r = await generateCreative({ dir, briefRel: BRIEF, env: ENV, fetch: bad, now: NOW });
  assert.equal(r.ok, false);
  assert.ok(!r.why.includes(ENV.OPENAI_API_KEY));
  assert.equal(fs.existsSync(path.join(dir, 'ledger.jsonl')), false);
  assert.equal((await generateCreative({ dir, briefRel: BRIEF, env: ENV, fetch: openaiOk(), now: NOW })).ok, true);
  // The same approval cannot pay for a second run.
  const reuse = await generateCreative({ dir, briefRel: BRIEF, env: ENV, fetch: openaiOk(), now: NOW });
  assert.equal(reuse.ok, false); assert.match(reuse.why, /already used/);
  // A fresh approval still meets the cap.
  fs.writeFileSync(path.join(dir, 'approvals.json'), JSON.stringify([{ id: 'A10', type: 'creative', file: BRIEF, status: 'approved', compliance: 'pass' }]));
  const f = openaiOk();
  const again = await generateCreative({ dir, briefRel: BRIEF, env: ENV, fetch: f, now: NOW });
  assert.equal(again.ok, false); assert.match(again.why, /creative cap/); assert.equal(f.calls.length, 0);
});

test('stability image via multipart form', async () => {
  const dir = product();
  const f = mockFetch([['api.stability.ai', { json: { image: PNG.toString('base64'), finish_reason: 'SUCCESS', seed: 7 } }]]);
  const r = await generateCreative({ dir, briefRel: BRIEF, env: { STABILITY_API_KEY: 'stab-secret-999' }, fetch: f, now: NOW });
  assert.equal(r.ok, true, r.why);
  assert.ok(f.calls[0].init.body instanceof FormData);
  assert.equal(r.provenance.provider, 'stability');
});

test('runway video: input image as data URI, polling, download; luma refuses a local input image', async () => {
  const dir = product({ brief: { kind: 'video', input_image: 'outbox/creative/base.png', duration: 5 } });
  fs.mkdirSync(path.join(dir, 'outbox', 'creative'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'outbox', 'creative', 'base.png'), PNG);
  let polls = 0;
  const MP4 = Buffer.from('000000186674797069736f6d', 'hex');
  const f = mockFetch([
    ['/v1/image_to_video', { json: { id: 'task-1' } }],
    ['/v1/tasks/task-1', () => (++polls < 2 ? { json: { status: 'RUNNING' } } : { json: { status: 'SUCCEEDED', output: ['https://cdn.runway.example/out.mp4'] } })],
    ['cdn.runway.example', { bytes: MP4 }],
  ]);
  const env = { RUNWAYML_API_SECRET: 'rw-secret-12345' };
  const r = await generateCreative({ dir, briefRel: BRIEF, env, fetch: f, now: NOW, sleep: async () => {}, pollMs: 0 });
  assert.equal(r.ok, true, r.why);
  assert.match(JSON.parse(f.calls[0].init.body).promptImage, /^data:image\/png;base64,/);
  assert.equal(f.calls.at(-1).init.headers?.authorization, undefined, 'no auth header to the CDN');
  assert.deepEqual(fs.readFileSync(path.join(dir, r.provenance.assets[0].file)), MP4);
  assert.equal(r.provenance.inputs[0].file, 'outbox/creative/base.png');
  assert.equal(r.provenance.cost.amount, 0.25);
  fs.writeFileSync(path.join(dir, 'approvals.json'), JSON.stringify([{ id: 'A11', type: 'creative', file: BRIEF, status: 'approved', compliance: 'pass' }]));
  assert.match(checkGate({ dir, briefRel: BRIEF, env: { LUMAAI_API_KEY: 'l' }, now: NOW }).why, /Luma/);
});

test('video task that never finishes is counted (fail closed on money)', async () => {
  const dir = product({ brief: { kind: 'video' } });
  const f = mockFetch([['/generations/g1', { json: { id: 'g1', state: 'dreaming' } }], ['dream-machine/v1/generations', { json: { id: 'g1', state: 'queued' } }]]);
  const r = await generateCreative({ dir, briefRel: BRIEF, env: { LUMAAI_API_KEY: 'luma-secret-1' }, fetch: f, now: NOW, sleep: async () => {}, maxPolls: 2 });
  assert.equal(r.ok, false); assert.equal(r.counted, true);
  const led = fs.readFileSync(path.join(dir, 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(led[0].outcome, 'submitted-unknown');
});

test('connector shape: accepts type creative, generates from the executing approval, never publishes', async () => {
  const dir = product({ approval: 'approved' });
  const item = { id: 'A9', type: 'creative', file: BRIEF, status: 'executing', compliance: 'pass' };
  assert.equal(creativeConnector.accepts(item), true);
  assert.equal(creativeConnector.accepts({ type: 'publish' }), false);
  assert.equal(creativeConnector.configured({}), false);
  assert.equal(creativeConnector.configured(ENV), true);
  const dry = await creativeConnector.execute(item, { dir, env: ENV, dryRun: true, fetch: openaiOk(), now: NOW });
  assert.equal(dry.ref, 'dry-run');
  const r = await creativeConnector.execute(item, { dir, env: ENV, fetch: openaiOk(), now: NOW });
  assert.equal(r.ok, true, r.detail); assert.equal(r.committed_daily, 0);
  assert.equal(r.creative.approval_draft.status, 'pending');
});

test('guard flags fail closed in JSON briefs; consent must sit in consent/; input image must be an image', () => {
  assert.match(checkGate({ dir: product({ brief: { public_figure: 'true' } }), briefRel: BRIEF, env: ENV, now: NOW }).why, /public figures/);
  assert.match(checkGate({ dir: product({ brief: { depicts_real_person: 'yes' } }), briefRel: BRIEF, env: ENV, now: NOW }).why, /consent/);
  assert.match(checkGate({ dir: product({ brief: { depicts_real_person: 1, people: { consent_file: 'product.json' } } }), briefRel: BRIEF, env: ENV, now: NOW }).why, /consent/);
  assert.match(checkGate({ dir: product({ brief: { people: ['product.json'] } }), briefRel: BRIEF, env: ENV, now: NOW }).why, /consent/);
  assert.match(checkGate({ dir: product({ brief: { people: [BRIEF] } }), briefRel: BRIEF, env: ENV, now: NOW }).why, /consent/);
  assert.equal(checkGate({ dir: product({ brief: { public_figure: 'false', depicts_real_person: false } }), briefRel: BRIEF, env: ENV, now: NOW }).ok, true);
  const d = product({ brief: { kind: 'video', input_image: 'product.json' } });
  assert.match(checkGate({ dir: d, briefRel: BRIEF, env: { RUNWAYML_API_SECRET: 'rw-secret-12345' }, now: NOW }).why, /input_image/);
});

test('cost estimates follow what the provider bills', () => {
  assert.equal(estimateCost('runway', { duration: 1 }), 0.25, 'a 1 s brief is billed as 5 s');
  assert.equal(estimateCost('runway', { duration: 9 }), 0.5, 'a 9 s brief is billed as 10 s');
  assert.ok(estimateCost('luma', { resolution: '4k' }) > estimateCost('luma', { resolution: '720p' }) * 8);
  assert.equal(estimateCost('luma', { resolution: 'weird' }), estimateCost('luma', { resolution: '4k' }));
  assert.equal(estimateCost('openai', { quality: 'auto' }), 0.25);
  assert.equal(buildRequest('runway', { prompt: 'p', duration: 9 }, { RUNWAYML_API_SECRET: 'k' }, { image_data_uri: 'data:x' }).json.duration, 10);
});

test('executor item must match approvals.json', async () => {
  const dir = product({ approval: null });
  const forged = { id: 'X1', type: 'creative', file: BRIEF, status: 'executing', compliance: 'pass' };
  const f = openaiOk();
  const r = await creativeConnector.execute(forged, { dir, env: ENV, fetch: f, now: NOW });
  assert.equal(r.ok, false); assert.match(r.detail, /not an approved item/); assert.equal(f.calls.length, 0);
  const dir2 = product({ approval: 'rejected' });
  const r2 = await creativeConnector.execute({ id: 'A9', type: 'creative', file: BRIEF, status: 'executing' }, { dir: dir2, env: ENV, fetch: f, now: NOW });
  assert.equal(r2.ok, false); assert.equal(f.calls.length, 0);
});

test('money fails closed: 5xx, empty answer and failed download are booked; 4xx is not', async () => {
  const led = (dir) => (fs.existsSync(path.join(dir, 'ledger.jsonl')) ? fs.readFileSync(path.join(dir, 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  const d5 = product();
  const r5 = await generateCreative({ dir: d5, briefRel: BRIEF, env: ENV, fetch: mockFetch([['api.openai.com', { status: 502, json: 'bad gateway' }]]), now: NOW });
  assert.equal(r5.ok, false); assert.equal(r5.counted, true); assert.equal(led(d5)[0].outcome, 'submitted-unknown');
  const d0 = product();
  const r0 = await generateCreative({ dir: d0, briefRel: BRIEF, env: ENV, fetch: mockFetch([['api.openai.com', { json: { data: [] } }]]), now: NOW });
  assert.equal(r0.counted, true);
  const d4 = product();
  const r4 = await generateCreative({ dir: d4, briefRel: BRIEF, env: ENV, fetch: mockFetch([['api.openai.com', { status: 429, json: { error: { message: 'slow down' } } }]]), now: NOW });
  assert.equal(r4.counted, false); assert.equal(led(d4).length, 0);
  const dv = product({ brief: { kind: 'video', input_image: 'https://cdn.example/x.png' } });
  const fv = mockFetch([['/v1/image_to_video', { json: { id: 't9' } }], ['/v1/tasks/t9', { json: { status: 'SUCCEEDED', output: ['https://cdn.runway.example/o.mp4'] } }], ['cdn.runway.example', { status: 403, json: 'expired' }]]);
  const rv = await generateCreative({ dir: dv, briefRel: BRIEF, env: { RUNWAYML_API_SECRET: 'rw-secret-12345' }, fetch: fv, now: NOW, sleep: async () => {} });
  assert.equal(rv.ok, false); assert.equal(rv.counted, true); assert.equal(led(dv)[0].provider_ref, 't9');
});

test('CLI: --providers and --check (no network)', () => {
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(OPENAI_|STABILITY_|RUNWAY|LUMA)/.test(k))), OM_NO_DOTENV: '1' };
  const p = spawnSync(process.execPath, [path.join(root, 'tools', 'creative-gen.mjs'), '--providers'], { encoding: 'utf8', env });
  assert.equal(p.status, 0, p.stderr);
  const list = JSON.parse(p.stdout.trim());
  assert.deepEqual(list.map((x) => x.provider), ['openai', 'stability', 'runway', 'luma']);
  assert.ok(list.every((x) => x.configured === false));
  const u = spawnSync(process.execPath, [path.join(root, 'tools', 'creative-gen.mjs')], { encoding: 'utf8', env });
  assert.equal(u.status, 2);
});
