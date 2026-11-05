// Shared helpers for the fetch-based connectors (zero dependencies).
// Contract every connector built with defineConnector() keeps, so tools/execute.mjs stays the
// single place that enforces the kill switch, free mode, spend caps and approvals:
//   - accepts(item): only its own channel(s), so existing routing never changes;
//   - configured(env): true only when every required secret is present;
//   - execute(item, ctx): ctx.dryRun → preview only, no network. Missing keys → no network,
//     returns ok:false with a dry-run preview (so the executor never marks it executed);
//   - secrets are never logged: every detail/error text is passed through redact().
// Tests inject a mock fetch with ctx.fetch; production uses globalThis.fetch.
import fs from 'node:fs';
import path from 'node:path';
import { readDraft } from '../lib/env.mjs';

export const missingKeys = (env, names) => names.filter((n) => !env?.[n]);

// Replaces every secret value found in env (for the given names, or any name that looks secret)
// with "***". Also strips bearer tokens and URL credentials that might be echoed back.
const SECRETISH = /(KEY|TOKEN|SECRET|PASSWORD|WEBHOOK_URL|_URL_SECRET)/;
export function redact(text, env = {}, names = null) {
  let s = String(text ?? '');
  const keys = names ?? Object.keys(env).filter((k) => SECRETISH.test(k));
  for (const k of keys) {
    const v = env[k];
    if (typeof v === 'string' && v.length >= 6) s = s.split(v).join('***');
  }
  return s.replace(/(Bearer|Basic|Ghost)\s+[A-Za-z0-9._~+/=-]{8,}/g, '$1 ***').replace(/\/\/[^/\s:@]+:[^/\s@]+@/g, '//***@');
}

export async function request(ctx, { url, method = 'POST', headers = {}, json, form, body }) {
  const f = ctx.fetch ?? globalThis.fetch;
  const init = { method, headers: { ...headers } };
  if (json !== undefined) { init.body = JSON.stringify(json); init.headers['content-type'] ??= 'application/json'; }
  else if (form !== undefined) { init.body = form instanceof URLSearchParams ? form : new URLSearchParams(form); }
  else if (body !== undefined) init.body = body;
  const res = await f(url, init);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { ok: res.ok, status: res.status, data, text, headers: res.headers };
}

export const hostOf = (u) => { try { return new URL(u).host; } catch { return '(invalid url)'; } };
export const fail = (r, ctx, what = '') => `${what ? `${what}: ` : ''}HTTP ${r.status} ${redact(r.text, ctx.env).slice(0, 200)}`;

// Reads the approval's draft: markdown with front matter, or a JSON spec (.json).
export function loadDraft(item, ctx) {
  if (!item.file) return { meta: {}, body: String(item.text ?? ''), title: item.title ?? '' };
  const file = path.join(ctx.dir, item.file);
  if (!fs.existsSync(file)) throw new Error(`draft not found: ${item.file}`);
  if (file.endsWith('.json')) {
    const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { meta: spec, body: String(spec.text ?? spec.body ?? ''), title: spec.title ?? spec.name ?? item.title ?? '', spec };
  }
  const { meta, body } = readDraft(file);
  const title = meta.title || (body.match(/^#\s+(.+)$/m) ?? [])[1] || item.title || item.id;
  return { meta, body: body.trim(), title };
}

export const readProduct = (ctx) => { try { return JSON.parse(fs.readFileSync(path.join(ctx.dir, 'product.json'), 'utf8')); } catch { return {}; } };

// Posts go live only when the approval or the draft says so; otherwise blog/newsletter
// connectors create drafts (same idea as meta-ads creating campaigns paused).
export const isLive = (item, meta) => item.activate === true || String(meta?.published ?? '').toLowerCase() === 'true' || meta?.status === 'publish';

export const graphemes = (s) => {
  try { return [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(String(s))].length; } catch { return [...String(s)].length; }
};

export const tagsOf = (meta, max = 4) => String(meta?.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, max);

// Builds a connector with the shared dry-run / missing-key / redaction behaviour.
// spec: { name, handles, needs, required?(env)→missing[], accepts, usableFor?, prepare(item, ctx)→{preview, ...} | {error}, send(p, item, ctx)→result }
export function defineConnector(spec) {
  const required = spec.required ?? ((env) => missingKeys(env, spec.needs));
  return {
    name: spec.name,
    handles: spec.handles,
    needs: spec.needs,
    unverified: spec.unverified ?? null,
    accepts: spec.accepts,
    missing: (env) => required(env ?? {}),
    configured: (env) => required(env ?? {}).length === 0,
    ...(spec.usableFor ? { usableFor: spec.usableFor } : {}),
    async execute(item, ctx) {
      const env = ctx.env ?? {};
      let p;
      try { p = await spec.prepare(item, { ...ctx, env }); } catch (e) { return { ok: false, detail: redact(e.message ?? e, env) }; }
      if (p?.error) return { ok: false, detail: redact(p.error, env) };
      if (ctx.dryRun) return { ok: true, ref: 'dry-run', detail: `would ${p.preview}` };
      const miss = required(env);
      if (miss.length) return { ok: false, ref: 'dry-run', dry_run: true, detail: `missing ${miss.join(', ')}; dry run only: would ${p.preview}` };
      try {
        const r = await spec.send(p, item, { ...ctx, env });
        return { ...r, detail: redact(r.detail ?? '', env) };
      } catch (e) { return { ok: false, detail: redact(e.message ?? e, env) }; }
    },
  };
}

// Builds a read-only data source (metrics or links). read() never writes anything remote.
export function defineReader(spec) {
  const required = spec.required ?? ((env) => missingKeys(env, spec.needs));
  return {
    name: spec.name, kind: spec.kind, handles: spec.handles, needs: spec.needs, unverified: spec.unverified ?? null,
    missing: (env) => required(env ?? {}),
    configured: (env) => required(env ?? {}).length === 0,
    async read(ctx, opts = {}) {
      const env = ctx.env ?? {};
      const miss = required(env);
      if (ctx.dryRun || miss.length) return { ok: !miss.length, dry_run: true, rows: [], links: [], detail: `${miss.length ? `missing ${miss.join(', ')}; ` : ''}would ${spec.preview(opts, env)}` };
      try { return { ok: true, ...(await spec.read({ ...ctx, env }, opts)) }; } catch (e) { return { ok: false, rows: [], links: [], detail: redact(e.message ?? e, env) }; }
    },
  };
}

// Days helper: YYYY-MM-DD strings.
export const isoDay = (d) => new Date(d).toISOString().slice(0, 10);
export const daysAgo = (now, n) => new Date(new Date(now ?? Date.now()).getTime() - n * 86400000);

// CSV writer (RFC 4180 quoting).
export const csvCell = (v) => { const s = v === undefined || v === null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (header, rows) => [header, ...rows.map((r) => header.map((h) => r[h]))].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
