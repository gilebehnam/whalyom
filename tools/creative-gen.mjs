// AI image and video creative generation with provenance.
//   Input   an approved creative brief in products/<slug>/outbox/ (JSON, or markdown with front matter
//           whose body is the prompt). "Approved" means approvals.json has an item whose file is the brief
//           with status approved / auto-approved (or the executor hands that item over, status executing).
//   Output  products/<slug>/outbox/creative/<id>/<image|video>.<ext>  the generated asset (internal draft)
//           products/<slug>/outbox/creative/<id>/provenance.json      sidecar provenance record
//           products/<slug>/research/ai-content-register.json         one entry per generated asset
//           products/<slug>/ledger.jsonl                              {at, channel:"creative", amount, kind:"creative", ...}
// Nothing is published, posted or sent. The result carries an approval_draft (type "publish", status
// "pending") that the single writer (apply-results / the executor wiring) may add to approvals.json; the
// asset only leaves the outbox through that approval.
//
// Guards (all fail closed, none can be switched off from a brief):
//   - kill switch: OM_KILL=1, product stage "paused" or autonomy.kill = true → nothing runs;
//   - the brief must be approved (see above) and must not ask to drop the AI label; an item handed in by
//     the executor must match the approved / executing item on disk; one approval pays for one generation;
//   - every asset is labelled AI-generated (provenance.ai_generated = true, label never empty);
//   - a real person's likeness (brief.people[] or depicts_real_person) needs a non-empty consent file in
//     the product's consent/ folder for every person; public figures are refused outright; guard flags
//     fail closed ("true", "yes", 1 all count as true);
//   - creative budget: product.json creative.monthly_cap (and optional creative.daily_cap). No cap → refused
//     (in free mode this is the "explicit creative cap" the owner must set; in paid / hybrid too, so ad
//     money is never spent on generation by accident). Estimate + spent this month must fit the cap;
//     spend is counted from ledger.jsonl rows with kind "creative" (budget.mjs ignores them, so ad caps
//     are unchanged). Estimates use the duration and resolution the provider bills; a job the provider
//     may have billed (accepted, network error or 5xx on submit) is booked even when it fails;
//   - secrets come from env only and every error text is redacted; no prompt or key reaches state/.
//
// Providers, chosen by env keys (brief.provider, then OM_CREATIVE_IMAGE_PROVIDER / OM_CREATIVE_VIDEO_PROVIDER,
// then the first configured one):
//   image  openai     OPENAI_API_KEY        POST https://api.openai.com/v1/images/generations (gpt-image-1, b64_json)
//          stability  STABILITY_API_KEY     POST https://api.stability.ai/v2beta/stable-image/generate/{core|ultra|sd3}
//   video  runway     RUNWAYML_API_SECRET   POST https://api.dev.runwayml.com/v1/image_to_video, poll /v1/tasks/{id}
//          luma       LUMAAI_API_KEY        POST https://api.lumalabs.ai/dream-machine/v1/generations, poll /generations/{id}
// Request shapes follow each provider's public API reference; fields marked UNCERTAIN below may change
// between API versions and are worth checking against the docs before the first paid run. Costs are
// estimates (providers do not return a price), recorded with estimated: true.
//
// Usage: node tools/creative-gen.mjs <slug> <outbox/brief.json|md> [--dry-run]   check the gates, then generate
//        node tools/creative-gen.mjs <slug> --check <brief>                         gates only, no network
//        node tools/creative-gen.mjs <slug> --budget                                creative spend this month vs caps
//        node tools/creative-gen.mjs --providers                                    which providers are configured
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadEnv, readJson, writeJson, readDraft, root } from './lib/env.mjs';
import { redact } from './connectors/_http.mjs';

export const CREATIVE_KINDS = ['image', 'video'];
export const DEFAULT_LABEL = 'AI-generated';
export const APPROVED_STATUSES = ['approved', 'auto-approved'];
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// ── Providers ──────────────────────────────────────────────────────────────
// Estimated USD per asset (UNCERTAIN: check the provider's pricing page; product.json
// creative.cost_overrides {"openai": 0.05, ...} replaces any of them). Estimates lean high on purpose.
export const COST_ESTIMATES = {
  openai: { low: 0.02, medium: 0.07, high: 0.25 }, // gpt-image-1 per image, by quality, sizes up to 1536px
  stability: { core: 0.03, ultra: 0.08, sd3: 0.07 }, // credits at $0.01 each
  runway: { per_second: 0.05 }, // gen4_turbo: 5 credits per second at $0.01 per credit
  luma: { per_second: 0.2 }, // ray-2, 720p; UNCERTAIN, kept conservative
};

export const PROVIDERS = {
  openai: { kind: 'image', needs: ['OPENAI_API_KEY'], model: (env) => env.OPENAI_IMAGE_MODEL || 'gpt-image-1' },
  stability: { kind: 'image', needs: ['STABILITY_API_KEY'], model: (env) => env.STABILITY_IMAGE_MODEL || 'core' },
  runway: { kind: 'video', needs: ['RUNWAYML_API_SECRET'], model: (env) => env.RUNWAY_VIDEO_MODEL || 'gen4_turbo', needsInputImage: true },
  luma: { kind: 'video', needs: ['LUMAAI_API_KEY'], model: (env) => env.LUMA_VIDEO_MODEL || 'ray-2' },
};
const ORDER = { image: ['openai', 'stability'], video: ['runway', 'luma'] };
export const providerConfigured = (name, env = {}) => Boolean(PROVIDERS[name]) && PROVIDERS[name].needs.every((k) => Boolean(env[k]));
export const configuredProviders = (env = {}) => Object.keys(PROVIDERS).filter((p) => providerConfigured(p, env));

// Picks the provider for a brief, or {error}. A Runway video needs an input image; without one the next
// configured video provider is used.
export function chooseProvider(brief, env = {}) {
  const kind = brief?.kind;
  if (!CREATIVE_KINDS.includes(kind)) return { error: `brief kind must be one of ${CREATIVE_KINDS.join(', ')}` };
  const fits = (p) => PROVIDERS[p]?.kind === kind && providerConfigured(p, env) && !(PROVIDERS[p].needsInputImage && !brief.input_image);
  if (brief.provider) {
    if (!PROVIDERS[brief.provider] || PROVIDERS[brief.provider].kind !== kind) return { error: `provider "${brief.provider}" cannot make ${kind}` };
    if (!providerConfigured(brief.provider, env)) return { error: `provider "${brief.provider}" is not configured (needs ${PROVIDERS[brief.provider].needs.join(', ')})` };
    if (!fits(brief.provider)) return { error: `provider "${brief.provider}" needs input_image for ${kind}` };
    return { provider: brief.provider };
  }
  const pref = env[kind === 'image' ? 'OM_CREATIVE_IMAGE_PROVIDER' : 'OM_CREATIVE_VIDEO_PROVIDER'];
  if (pref && fits(pref)) return { provider: pref };
  const p = ORDER[kind].find(fits);
  if (p) return { provider: p };
  const any = ORDER[kind].filter((x) => providerConfigured(x, env));
  return { error: any.length ? `configured ${kind} provider(s) ${any.join(', ')} need input_image` : `no ${kind} provider configured (set one of ${ORDER[kind].map((x) => PROVIDERS[x].needs[0]).join(', ')})` };
}

const seconds = (brief) => Math.max(1, Math.min(10, Number(brief.duration) || 5));
// The duration the provider actually bills (the request rounds the brief's duration to an allowed value).
export const billedSeconds = (provider, brief) => (provider === 'runway' ? (seconds(brief) >= 8 ? 10 : 5) : provider === 'luma' ? (seconds(brief) >= 8 ? 9 : 5) : 0);
// Luma price scales with pixels; 720p is the base. Unknown resolutions count as the most expensive (fail closed).
const LUMA_RES_FACTOR = { '540p': 1, '720p': 1, '1080p': 2.25, 1080: 2.25, '4k': 9 };
const lumaFactor = (brief) => LUMA_RES_FACTOR[String(brief.resolution ?? '720p').toLowerCase()] ?? 9;
export function estimateCost(provider, brief, env = {}, overrides = {}) {
  const video = PROVIDERS[provider]?.kind === 'video';
  const resF = provider === 'luma' ? lumaFactor(brief) : 1;
  if (Number.isFinite(Number(overrides?.[provider])) && Number(overrides[provider]) > 0) return round2(overrides[provider] * (video ? (billedSeconds(provider, brief) / 5) * resF : 1) * (video ? 1 : Math.max(1, Math.min(4, Number(brief.n) || 1))));
  const n = Math.max(1, Math.min(4, Number(brief.n) || 1));
  // Unknown or "auto" quality may render at high quality: estimate it as high.
  if (provider === 'openai') return round2((COST_ESTIMATES.openai[brief.quality ?? 'medium'] ?? COST_ESTIMATES.openai.high) * n);
  if (provider === 'stability') { const m = PROVIDERS.stability.model(env); return round2((COST_ESTIMATES.stability[m] ?? COST_ESTIMATES.stability.ultra) * n); }
  if (provider === 'runway') return round2(COST_ESTIMATES.runway.per_second * billedSeconds(provider, brief));
  if (provider === 'luma') return round2(COST_ESTIMATES.luma.per_second * billedSeconds(provider, brief) * resF);
  return Infinity;
}

// Pure request builders (tested without network). Each returns {url, method, headers, json|form}.
export function buildRequest(provider, brief, env = {}, inputs = {}) {
  const prompt = String(brief.prompt ?? '').trim();
  const model = PROVIDERS[provider].model(env);
  if (provider === 'openai') {
    return {
      url: 'https://api.openai.com/v1/images/generations', method: 'POST', model,
      headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      // gpt-image-1 always answers with base64 (data[].b64_json); response_format is only for dall-e models.
      json: { model, prompt, n: Math.max(1, Math.min(4, Number(brief.n) || 1)), size: brief.size ?? '1024x1024', quality: brief.quality ?? 'medium', output_format: 'png' },
    };
  }
  if (provider === 'stability') {
    const ep = ['core', 'ultra'].includes(model) ? model : 'sd3';
    const form = { prompt, output_format: 'png', aspect_ratio: brief.aspect_ratio ?? '1:1' };
    if (brief.negative_prompt) form.negative_prompt = String(brief.negative_prompt);
    if (ep === 'sd3') form.model = model; // e.g. sd3.5-large (UNCERTAIN: model ids change)
    if (brief.seed != null) form.seed = String(brief.seed);
    return {
      url: `https://api.stability.ai/v2beta/stable-image/generate/${ep}`, method: 'POST', model,
      // Accept application/json → {image: base64, finish_reason, seed}; the body must be multipart/form-data.
      headers: { authorization: `Bearer ${env.STABILITY_API_KEY}`, accept: 'application/json' },
      form,
    };
  }
  if (provider === 'runway') {
    return {
      url: 'https://api.dev.runwayml.com/v1/image_to_video', method: 'POST', model,
      headers: { authorization: `Bearer ${env.RUNWAYML_API_SECRET}`, 'content-type': 'application/json', 'x-runway-version': env.RUNWAY_API_VERSION || '2024-11-06' },
      // promptImage: https URL or data URI. ratio values per model (UNCERTAIN: gen4_turbo lists 1280:720, 720:1280, 960:960 …).
      json: { model, promptImage: inputs.image_data_uri ?? brief.input_image, promptText: prompt.slice(0, 1000), ratio: brief.ratio ?? '1280:720', duration: billedSeconds('runway', brief), ...(brief.seed != null ? { seed: Number(brief.seed) } : {}) },
    };
  }
  if (provider === 'luma') {
    const json = { prompt, model, aspect_ratio: brief.aspect_ratio ?? '16:9', resolution: brief.resolution ?? '720p', duration: `${billedSeconds('luma', brief)}s` }; // UNCERTAIN: allowed durations (docs show 5s; 9s for ray-2)
    if (brief.input_image && /^https:\/\//.test(brief.input_image)) json.keyframes = { frame0: { type: 'image', url: brief.input_image } };
    return {
      url: 'https://api.lumalabs.ai/dream-machine/v1/generations', method: 'POST', model,
      headers: { authorization: `Bearer ${env.LUMAAI_API_KEY}`, 'content-type': 'application/json', accept: 'application/json' },
      json,
    };
  }
  throw new Error(`unknown provider ${provider}`);
}

async function http(ctx, req) {
  const f = ctx.fetch ?? globalThis.fetch;
  const init = { method: req.method ?? 'GET', headers: { ...(req.headers ?? {}) } };
  if (req.json !== undefined) init.body = JSON.stringify(req.json);
  else if (req.form !== undefined) { const fd = new FormData(); for (const [k, v] of Object.entries(req.form)) fd.append(k, v); init.body = fd; }
  const res = await f(req.url, init);
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) { const e = new Error(`${new URL(req.url).host} HTTP ${res.status} ${redact(data?.error?.message ?? data?.errors?.join?.('; ') ?? data?.detail ?? text, ctx.env).slice(0, 200)}`); e.status = res.status; throw e; }
  return data ?? {};
}

// Downloads a provider output URL (https only, no auth header is ever sent to it).
async function download(ctx, url) {
  if (!/^https:\/\//.test(String(url))) throw new Error('provider returned no https output url');
  const res = await (ctx.fetch ?? globalThis.fetch)(url, { method: 'GET' });
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function poll(ctx, { url, headers, done, failed, maxPolls, interval }) {
  for (let i = 0; i < maxPolls; i++) {
    const d = await http(ctx, { url, method: 'GET', headers });
    if (done(d)) return d;
    const why = failed(d); if (why) throw new Error(why);
    await (ctx.sleep ?? sleepMs)(interval);
  }
  const e = new Error('provider task did not finish in time'); e.submitted = true; throw e;
}

// Runs one generation. Returns {assets:[{bytes, ext}], model, request_id}. Errors are redacted.
// Money fails closed: an error carries submitted = true (so the caller books the estimate) unless the
// first request was cleanly refused with a 4xx (bad key, bad input, rate limit: nothing was generated).
// Network errors, 5xx on submit and anything after the provider accepted the job (content filter,
// missing output, failed download, polling) count as possibly billed.
export async function runProvider(provider, brief, ctx) {
  const env = ctx.env ?? {};
  const req = buildRequest(provider, brief, env, ctx.inputs ?? {});
  const phase = { sent: false, accepted: false };
  try {
    return await runProviderInner(provider, req, ctx, phase);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (phase.accepted || (phase.sent && !(err.status >= 400 && err.status < 500))) err.submitted = true;
    throw err;
  }
}

async function runProviderInner(provider, req, ctx, phase) {
  const pollOpts = { maxPolls: ctx.maxPolls ?? 120, interval: ctx.pollMs ?? 5000 };
  const submit = async () => { phase.sent = true; const d = await http(ctx, req); phase.accepted = true; return d; };
  if (provider === 'openai') {
    const d = await submit();
    const assets = (d.data ?? []).map((x) => x?.b64_json).filter(Boolean).map((b) => ({ bytes: Buffer.from(b, 'base64'), ext: 'png' }));
    if (!assets.length) throw new Error('OpenAI returned no image');
    return { assets, model: req.model, request_id: d.created ? String(d.created) : '', usage: d.usage ?? null };
  }
  if (provider === 'stability') {
    const d = await submit();
    if (d.finish_reason && d.finish_reason !== 'SUCCESS') throw new Error(`Stability finish_reason ${d.finish_reason}`);
    if (!d.image) throw new Error('Stability returned no image');
    return { assets: [{ bytes: Buffer.from(d.image, 'base64'), ext: 'png' }], model: req.model, request_id: d.seed != null ? `seed:${d.seed}` : '' };
  }
  if (provider === 'runway') {
    const t = await submit();
    if (!t.id) throw new Error('Runway returned no task id');
    try {
      const d = await poll(ctx, { ...pollOpts, url: `https://api.dev.runwayml.com/v1/tasks/${encodeURIComponent(t.id)}`, headers: { authorization: req.headers.authorization, 'x-runway-version': req.headers['x-runway-version'] },
        done: (x) => x.status === 'SUCCEEDED', failed: (x) => (['FAILED', 'CANCELLED'].includes(x.status) ? `Runway task ${x.status}: ${String(x.failure ?? x.failureCode ?? '').slice(0, 120)}` : null) });
      const url = Array.isArray(d.output) ? d.output[0] : null;
      return { assets: [{ bytes: await download(ctx, url), ext: 'mp4' }], model: req.model, request_id: t.id };
    } catch (e) { e.request_id = t.id; throw e; }
  }
  if (provider === 'luma') {
    const g = await submit();
    if (!g.id) throw new Error('Luma returned no generation id');
    try {
      const d = await poll(ctx, { ...pollOpts, url: `https://api.lumalabs.ai/dream-machine/v1/generations/${encodeURIComponent(g.id)}`, headers: { authorization: req.headers.authorization, accept: 'application/json' },
        done: (x) => x.state === 'completed', failed: (x) => (x.state === 'failed' ? `Luma generation failed: ${String(x.failure_reason ?? '').slice(0, 120)}` : null) });
      return { assets: [{ bytes: await download(ctx, d.assets?.video), ext: 'mp4' }], model: req.model, request_id: g.id };
    } catch (e) { e.request_id = g.id; throw e; }
  }
  throw new Error(`unknown provider ${provider}`);
}

// ── Brief, approval, consent ───────────────────────────────────────────────
const inside = (dir, rel) => { const abs = path.resolve(dir, String(rel ?? '')); return abs.startsWith(path.resolve(dir) + path.sep) ? abs : null; };
const relPosix = (dir, abs) => path.relative(dir, abs).split(path.sep).join('/');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Reads a brief (JSON, or markdown: front matter fields + body as the prompt). Path must sit under outbox/.
export function loadBrief(dir, briefRel) {
  const abs = inside(dir, briefRel);
  if (!abs || !relPosix(dir, abs).startsWith('outbox/')) throw new Error('the brief must be a file under outbox/');
  if (!fs.existsSync(abs)) throw new Error(`brief not found: ${briefRel}`);
  let b;
  if (abs.endsWith('.json')) b = JSON.parse(fs.readFileSync(abs, 'utf8'));
  else {
    const { meta, body } = readDraft(abs);
    b = { ...meta, prompt: meta.prompt || body.trim() };
  }
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error('the brief must be an object');
  // Guard flags fail closed in both formats: anything but an explicit false / "false" / "no" / 0 / "" counts as true
  // (so "true", "yes" or 1 in a JSON brief cannot slip past the likeness or label checks).
  for (const k of ['depicts_real_person', 'public_figure', 'disable_label', 'no_label']) {
    if (k in b) b[k] = !(b[k] === false || b[k] === 0 || b[k] == null || ['false', 'no', '0', ''].includes(String(b[k]).trim().toLowerCase()));
  }
  if ('ai_generated' in b && ['false', 'no', '0'].includes(String(b.ai_generated).trim().toLowerCase())) b.ai_generated = false;
  if (typeof b.people === 'string') b.people = b.people.split(',').map((s) => s.trim()).filter(Boolean).map((c) => ({ consent_file: c }));
  else if (b.people != null && !Array.isArray(b.people)) b.people = [b.people];
  const rel = relPosix(dir, abs);
  return { ...b, id: String(b.id ?? path.basename(abs).replace(/\.[^.]+$/, '')), file: rel };
}

// The approval for a brief: an item in approvals.json whose file is the brief (or the item handed in by the
// executor). Returns {ok, approval} or {ok:false, why}.
export function findApproval(dir, briefRel, given = null) {
  const okStatus = (a) => APPROVED_STATUSES.includes(a?.status) || (given && a === given && a.status === 'executing');
  const list = readJson(path.join(dir, 'approvals.json'), []);
  const all = Array.isArray(list) ? list : [];
  if (given) {
    if (given.file !== briefRel) return { ok: false, why: 'the approval is for a different file' };
    if (!okStatus(given)) return { ok: false, why: `approval ${given.id} is ${given.status}` };
    if (given.compliance === 'block') return { ok: false, why: `approval ${given.id} is blocked by compliance` };
    // The handed-in item must be the one on disk (the executor saves it as "executing" before the call),
    // so an object built in memory cannot stand in for an owner approval.
    const disk = given.id != null ? all.find((a) => a?.id === given.id) : null;
    if (!disk || disk.file !== briefRel || disk.compliance === 'block' || !(APPROVED_STATUSES.includes(disk.status) || disk.status === 'executing')) {
      return { ok: false, why: `approval ${given.id ?? '(no id)'} is not an approved item in approvals.json` };
    }
    return { ok: true, approval: given };
  }
  const mine = all.filter((a) => a?.file === briefRel);
  const a = mine.find((x) => APPROVED_STATUSES.includes(x.status) && x.compliance !== 'block');
  if (!a) return { ok: false, why: mine.length ? `brief approval is ${mine.map((x) => x.status).join(', ')}` : 'no approval found for this brief in approvals.json' };
  return { ok: true, approval: a };
}

// Likeness rules: every real person needs a consent file inside the product folder; public figures never.
export function checkLikeness(dir, brief) {
  if (brief.public_figure === true) return { ok: false, why: 'public figures are never generated (no deepfakes, even as parody)' };
  const people = Array.isArray(brief.people) ? brief.people : [];
  if (brief.depicts_real_person === true && !people.length) return { ok: false, why: 'brief depicts a real person but lists no consent file (people[].consent_file)' };
  const files = [];
  for (const p of people) {
    const rel = typeof p === 'string' ? p : p?.consent_file;
    const abs = rel ? inside(dir, rel) : null;
    // Consent records live in the product's consent/ folder, so product.json, the brief or any other
    // non-empty file cannot pass as a signed release.
    if (!abs || !relPosix(dir, abs).startsWith('consent/') || !fs.existsSync(abs) || !fs.statSync(abs).isFile() || fs.statSync(abs).size === 0) return { ok: false, why: `missing consent file for a real person${rel ? ` (${rel})` : ''}` };
    files.push({ ref: typeof p === 'object' && p?.ref ? String(p.ref) : null, consent_file: relPosix(dir, abs), consent_sha256: sha256(fs.readFileSync(abs)) });
  }
  return { ok: true, consent: files };
}

// ── Creative budget ────────────────────────────────────────────────────────
export function readCreativeLedger(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((e) => e && e.kind === 'creative');
}
export function creativeSpent(file, nowIso = new Date().toISOString()) {
  const rows = readCreativeLedger(file);
  const sum = (pre) => round2(rows.filter((e) => String(e.at).startsWith(pre)).reduce((s, e) => s + (Number(e.amount) || 0), 0));
  return { month: sum(nowIso.slice(0, 7)), today: sum(nowIso.slice(0, 10)) };
}

// {ok, cap, daily_cap, spent, spent_today, remaining} or {ok:false, why}. Never true without an explicit cap.
export function checkCreativeBudget(product, ledgerFile, estimate, nowIso = new Date().toISOString()) {
  const mode = product?.budget?.mode ?? 'free';
  const c = product?.creative ?? {};
  const cap = Number(c.monthly_cap);
  const daily = c.daily_cap == null ? null : Number(c.daily_cap);
  const { month, today } = creativeSpent(ledgerFile, nowIso);
  const base = { mode, cap: Number.isFinite(cap) ? cap : null, daily_cap: daily, spent: month, spent_today: today, estimate };
  if (!(cap > 0)) return { ...base, ok: false, why: mode === 'free' ? 'free mode: set product.json creative.monthly_cap to allow paid generation' : 'no creative.monthly_cap in product.json' };
  if (!Number.isFinite(estimate) || estimate < 0) return { ...base, ok: false, why: 'no cost estimate for this provider' };
  if (month + estimate > cap + 1e-9) return { ...base, ok: false, why: `creative cap: spent ${month} + estimate ${estimate} > ${cap} this month` };
  if (daily != null && !(daily >= 0)) return { ...base, ok: false, why: 'creative.daily_cap is not a number' };
  if (daily != null && today + estimate > daily + 1e-9) return { ...base, ok: false, why: `creative daily cap: spent ${today} + estimate ${estimate} > ${daily} today` };
  return { ...base, ok: true, remaining: round2(cap - month - estimate) };
}

// ── Gate ───────────────────────────────────────────────────────────────────
// Everything that must hold before any provider call. Pure apart from reading the product folder.
export function checkGate({ dir, briefRel, env = process.env, approval = null, now = new Date().toISOString() }) {
  const product = readJson(path.join(dir, 'product.json'), null);
  if (!product) return { ok: false, why: 'product.json not found' };
  if (env.OM_KILL === '1' || product.stage === 'paused' || product.autonomy?.kill === true) return { ok: false, why: 'kill switch on (OM_KILL, paused stage or autonomy.kill)' };
  let brief;
  try { brief = loadBrief(dir, briefRel); } catch (e) { return { ok: false, why: e.message }; }
  if (!CREATIVE_KINDS.includes(brief.kind)) return { ok: false, why: `brief kind must be one of ${CREATIVE_KINDS.join(', ')}`, brief };
  if (!String(brief.prompt ?? '').trim()) return { ok: false, why: 'brief has no prompt', brief };
  if (brief.disable_label === true || brief.no_label === true || brief.ai_generated === false || (brief.label != null && !String(brief.label).trim())) return { ok: false, why: 'the AI-generated label is required and cannot be removed', brief };
  const ap = findApproval(dir, brief.file, approval);
  if (!ap.ok) return { ok: false, why: ap.why, brief };
  const lk = checkLikeness(dir, brief);
  if (!lk.ok) return { ok: false, why: lk.why, brief };
  let inputAbs = null;
  if (brief.input_image != null && typeof brief.input_image !== 'string') return { ok: false, why: 'input_image must be a path or an https URL', brief };
  if (brief.input_image && !/^https:\/\//.test(brief.input_image)) {
    inputAbs = inside(dir, brief.input_image);
    if (!inputAbs || !fs.existsSync(inputAbs) || !fs.statSync(inputAbs).isFile()) return { ok: false, why: `input_image not found inside the product folder: ${brief.input_image}`, brief };
    // Only image files leave the machine as an input, and never a consent record.
    if (!/\.(png|jpe?g|webp)$/i.test(inputAbs) || relPosix(dir, inputAbs).startsWith('consent/')) return { ok: false, why: 'input_image must be a .png, .jpg or .webp file outside consent/', brief };
  }
  // One approval pays for one generation: a brief approval that already produced an asset needs a new approval.
  const apId = ap.approval?.id;
  if (apId != null && readCreativeLedger(path.join(dir, 'ledger.jsonl')).some((e) => e.approval === apId && e.outcome === 'generated')) {
    return { ok: false, why: `approval ${apId} was already used for a generation; approve the brief again for another run`, brief };
  }
  const ch = chooseProvider(brief, env);
  if (ch.error) return { ok: false, why: ch.error, brief };
  if (ch.provider === 'luma' && inputAbs) return { ok: false, why: 'Luma takes an input image only as an https URL', brief };
  const estimate = estimateCost(ch.provider, brief, env, product.creative?.cost_overrides);
  const bud = checkCreativeBudget(product, path.join(dir, 'ledger.jsonl'), estimate, now);
  if (!bud.ok) return { ok: false, why: bud.why, brief, provider: ch.provider, budget: bud };
  return { ok: true, product, brief, approval: ap.approval, consent: lk.consent, provider: ch.provider, model: PROVIDERS[ch.provider].model(env), estimate, budget: bud, inputAbs };
}

const newId = (briefId, now) => `${String(briefId).replace(/[^A-Za-z0-9-]+/g, '-').slice(0, 40)}-${now.replace(/\D/g, '').slice(0, 14)}-${crypto.randomBytes(2).toString('hex')}`;
const mime = (f) => (/\.png$/i.test(f) ? 'image/png' : /\.jpe?g$/i.test(f) ? 'image/jpeg' : /\.webp$/i.test(f) ? 'image/webp' : 'application/octet-stream');

// Pending publish approval for a generated asset (never written here; the single writer adds it).
export function approvalDraft(rec) {
  return {
    id: `CR-${rec.id}`, type: 'publish', channel: rec.channel ?? null, title: `AI ${rec.kind}: ${rec.brief_title ?? rec.brief}`.slice(0, 120),
    file: rec.provenance_file, asset: rec.assets[0]?.file, agent: 'om-creative-gen', status: 'pending', compliance: 'pending',
    ai_generated: true, label: rec.label, created_at: rec.created_at,
    review_notes: 'AI-generated creative: check the provenance record and use the platform AI label when publishing.',
  };
}

// Generates one creative from an approved brief. opts: {dir, briefRel, env, approval?, fetch?, sleep?, now?,
// dryRun?, pollMs?, maxPolls?}. Returns {ok, id, files, provenance, register_entry, approval_draft} or
// {ok:false, why}. Ledger rows are written only for real provider calls.
export async function generateCreative(opts) {
  const { dir, briefRel, env = process.env, dryRun = false } = opts;
  const now = opts.now ?? new Date().toISOString();
  const g = checkGate({ dir, briefRel, env, approval: opts.approval ?? null, now });
  if (!g.ok) return { ok: false, why: redact(g.why, env), provider: g.provider ?? null };
  const { brief, provider, estimate } = g;
  const preview = `generate ${brief.kind} with ${provider} (${g.model}), estimated ${estimate} ${g.product.budget?.currency ?? 'USD'}`;
  if (dryRun) return { ok: true, dry_run: true, provider, model: g.model, estimate, preview, budget: g.budget };

  const inputs = {};
  const inputRecords = [];
  if (g.inputAbs) {
    const buf = fs.readFileSync(g.inputAbs);
    inputs.image_data_uri = `data:${mime(g.inputAbs)};base64,${buf.toString('base64')}`;
    inputRecords.push({ role: 'input_image', file: relPosix(dir, g.inputAbs), sha256: sha256(buf) });
  } else if (brief.input_image) inputRecords.push({ role: 'input_image', url: brief.input_image });

  const id = newId(brief.id, now);
  const ledgerFile = path.join(dir, 'ledger.jsonl');
  const ledgerRow = (extra) => fs.appendFileSync(ledgerFile, JSON.stringify({ at: now, channel: 'creative', amount: estimate, kind: 'creative', provider, ref: id, approval: g.approval.id ?? null, estimated: true, ...extra }) + '\n');
  let out;
  try {
    out = await runProvider(provider, brief, { env, fetch: opts.fetch, sleep: opts.sleep, inputs, pollMs: opts.pollMs, maxPolls: opts.maxPolls });
  } catch (e) {
    // A task that was accepted but never confirmed may still be billed: count it (fail closed on money).
    if (e?.submitted) ledgerRow({ outcome: 'submitted-unknown', provider_ref: e.request_id ?? null });
    return { ok: false, why: redact(e?.message ?? e, env), provider, counted: Boolean(e?.submitted) };
  }
  ledgerRow({ outcome: 'generated' });

  const outDir = path.join(dir, 'outbox', 'creative', id);
  fs.mkdirSync(outDir, { recursive: true });
  const assets = out.assets.map((a, i) => {
    const name = `${brief.kind}${out.assets.length > 1 ? `-${i + 1}` : ''}.${a.ext}`;
    fs.writeFileSync(path.join(outDir, name), a.bytes);
    return { file: relPosix(dir, path.join(outDir, name)), sha256: sha256(a.bytes), bytes: a.bytes.length };
  });
  const label = String(brief.label ?? DEFAULT_LABEL).trim() || DEFAULT_LABEL;
  const provenance = {
    id, kind: brief.kind, status: 'internal-draft', publish: 'requires an owner approval (approval_draft)',
    ai_generated: true, label, disclosure: brief.disclosure ?? `${label}. Use the platform's own AI label where it exists.`,
    provider, model: out.model, provider_request_id: out.request_id || null,
    prompt: String(brief.prompt).trim(), negative_prompt: brief.negative_prompt ?? null,
    params: Object.fromEntries(['size', 'quality', 'aspect_ratio', 'ratio', 'resolution', 'duration', 'seed', 'n'].filter((k) => brief[k] != null).map((k) => [k, brief[k]])),
    inputs: inputRecords, brief: brief.file, brief_approval: g.approval.id ?? null,
    consent: g.consent, depicts_real_person: g.consent.length > 0,
    assets, created_at: now,
    cost: { amount: estimate, currency: g.product.budget?.currency ?? 'USD', estimated: true },
    content_credentials: 'kept as delivered by the provider; do not strip metadata (C2PA, watermarks) on export',
    human_editor: brief.editor ?? null, placements: brief.placements ?? null,
  };
  const provFile = path.join(outDir, 'provenance.json');
  writeJson(provFile, provenance);

  const regFile = path.join(dir, 'research', 'ai-content-register.json');
  fs.mkdirSync(path.dirname(regFile), { recursive: true });
  const reg = readJson(regFile, []);
  const entry = { id, kind: brief.kind, assets: assets.map((a) => a.file), provenance: relPosix(dir, provFile), provider, model: out.model, label, ai_generated: true,
    consent_files: g.consent.map((c) => c.consent_file), brief: brief.file, created_at: now, cost: provenance.cost.amount, status: 'internal-draft' };
  writeJson(regFile, [...(Array.isArray(reg) ? reg : []), entry]);

  const draft = approvalDraft({ id, kind: brief.kind, brief: brief.file, brief_title: brief.title, channel: brief.channel, assets, label, created_at: now, provenance_file: relPosix(dir, provFile) });
  return { ok: true, id, provider, model: out.model, cost: estimate, files: [...assets.map((a) => a.file), relPosix(dir, provFile)], provenance, register_entry: entry, approval_draft: draft };
}

// Connector shape for tools/connectors/index.mjs: carries out an approved item of type "creative" (the
// brief's approval) by generating, never publishing. Must sit before the webhook catch-all.
export const creativeConnector = {
  name: 'creative-gen',
  handles: 'type "creative": AI image/video generation from the approved brief (internal, nothing published)',
  needs: ['OPENAI_API_KEY | STABILITY_API_KEY | RUNWAYML_API_SECRET | LUMAAI_API_KEY'],
  unverified: 'request shapes follow provider docs; fields marked UNCERTAIN in tools/creative-gen.mjs',
  accepts: (item) => item?.type === 'creative',
  missing: (env) => (configuredProviders(env ?? {}).length ? [] : ['OPENAI_API_KEY or STABILITY_API_KEY or RUNWAYML_API_SECRET or LUMAAI_API_KEY']),
  configured: (env) => configuredProviders(env ?? {}).length > 0,
  async execute(item, ctx) {
    const env = ctx.env ?? {};
    try {
      const r = await generateCreative({ dir: ctx.dir, briefRel: item.file, env, approval: item, fetch: ctx.fetch, now: ctx.now, dryRun: Boolean(ctx.dryRun) });
      if (!r.ok) return { ok: false, detail: r.why };
      if (r.dry_run) return { ok: true, ref: 'dry-run', detail: `would ${r.preview}` };
      return { ok: true, ref: r.id, detail: redact(`generated ${r.files.join(', ')} (${r.provider}, est. ${r.cost}); publishing needs its own approval`, env), committed_daily: 0, creative: { id: r.id, kind: r.provenance?.kind ?? null, approval_draft: r.approval_draft } };
    } catch (e) { return { ok: false, detail: redact(e?.message ?? e, env) }; }
  },
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  loadEnv();
  const args = process.argv.slice(2);
  const env = process.env;
  if (args[0] === '--providers') {
    console.log(JSON.stringify(Object.keys(PROVIDERS).map((p) => ({ provider: p, kind: PROVIDERS[p].kind, configured: providerConfigured(p, env), needs: PROVIDERS[p].needs }))));
    process.exit(0);
  }
  const slug = args[0];
  if (!slug || slug.startsWith('-')) { console.error('Usage: node tools/creative-gen.mjs <slug> <outbox/brief> [--dry-run] | <slug> --check <brief> | <slug> --budget | --providers'); process.exit(2); }
  const dir = path.join(root, 'products', slug);
  if (!fs.existsSync(path.join(dir, 'product.json'))) { console.error(`no product ${slug}`); process.exit(2); }
  if (args[1] === '--budget') {
    const product = readJson(path.join(dir, 'product.json'), {});
    console.log(JSON.stringify({ slug, ...creativeSpent(path.join(dir, 'ledger.jsonl')), monthly_cap: product.creative?.monthly_cap ?? null, daily_cap: product.creative?.daily_cap ?? null, mode: product.budget?.mode ?? 'free' }));
    process.exit(0);
  }
  if (args[1] === '--check') {
    const g = checkGate({ dir, briefRel: args[2], env });
    console.log(JSON.stringify(g.ok ? { slug, ok: true, provider: g.provider, model: g.model, estimate: g.estimate, budget: g.budget } : { slug, ok: false, why: redact(g.why, env) }));
    process.exit(g.ok ? 0 : 1);
  }
  const r = await generateCreative({ dir, briefRel: args[1], env, dryRun: args.includes('--dry-run') });
  const { provenance, ...summary } = r;
  console.log(JSON.stringify({ slug, ...summary }));
  process.exit(r.ok ? 0 : 1);
}
