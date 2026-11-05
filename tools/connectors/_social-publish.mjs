// Shared pieces for the native social publishers (instagram.mjs, facebook.mjs, tiktok-posting.mjs).
//   - Idempotency by approval id: products/<slug>/social/published.json keeps one row per
//     "<connector>:<approval id>" with the platform ref (and, for Instagram, the media container made
//     before publishing). A retry of the same approval returns the stored ref, or resumes from the
//     stored container, and never creates a second post. The file holds ids only, no personal data.
//   - Disclosure labels are kept: a draft that says sponsored / paid partnership / branded content must
//     carry a disclosure label ("#ad", "Paid partnership" ...); the label (and an AI label, when the
//     draft gives one) is put at the start of the caption when the text does not already contain it.
//     A sponsored draft without a label is refused, never posted unlabeled.
//   - Media must be public https URLs (the platforms pull them); anything else is refused.
// Pure helpers plus two tiny file functions; no network here.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from '../lib/env.mjs';

export const truthy = (v) => v === true || ['true', 'yes', '1'].includes(String(v ?? '').trim().toLowerCase());

// "a, b" or ["a", "b"] → ["a", "b"]
export const listOf = (v) => (Array.isArray(v) ? v : String(v ?? '').split(',')).map((s) => (typeof s === 'string' ? s.trim() : s)).filter(Boolean);

export const isHttpsUrl = (u) => {
  if (typeof u !== 'string') return false;
  try { const x = new URL(u); return x.protocol === 'https:' && !x.username && !x.password; } catch { return false; }
};

// Labels the post must show. Throws when a sponsored post has no disclosure label.
const DISCLOSURE_OK = /(#ad\b|#advert|#sponsored|\bsponsored\b|\bpaid partnership\b|\bad\b|\banzeige\b|\bwerbung\b|#تبلیغ|تبلیغ|همکاری تجاری)/i;
export function labelsFor(item = {}, meta = {}) {
  const disclosure = String(item.disclosure ?? meta.disclosure ?? '').trim();
  const sponsored = truthy(item.sponsored) || truthy(meta.sponsored) || truthy(meta.paid_partnership) || truthy(meta.branded_content);
  if (sponsored && !disclosure) throw new Error('sponsored post has no disclosure label; add "disclosure: #ad" (or "Paid partnership") to the draft');
  if (disclosure && !DISCLOSURE_OK.test(disclosure)) throw new Error(`disclosure "${disclosure.slice(0, 40)}" is not a clear ad label (use #ad, Ad, Sponsored or Paid partnership)`);
  const ai = String(meta.ai_label ?? '').trim();
  const aiGenerated = truthy(meta.ai_generated) || Boolean(ai);
  return { disclosure, sponsored: sponsored || Boolean(disclosure), ai_label: ai, ai_generated: aiGenerated, labels: [disclosure, ai].filter(Boolean) };
}

// True when the text carries the label as a whole token ("#ad" inside "#adventure", or "Ad" inside
// "add", does not count).
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const hasLabel = (text, label) => new RegExp(`(^|[^\\p{L}\\p{N}_#])${esc(String(label))}(?![\\p{L}\\p{N}_])`, 'iu').test(String(text ?? ''));

// Puts each label the text does not already contain at the start of the caption.
export function withLabels(text, labels = []) {
  const t = String(text ?? '').trim();
  const missing = labels.filter((l) => !hasLabel(t, l));
  return missing.length ? `${missing.join(' · ')}\n${t}`.trim() : t;
}

export const countHashtags = (s) => (String(s).match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;
export const countMentions = (s) => (String(s).match(/(^|\s)@[\w.]+/g) ?? []).length;

// ── idempotency store ──
const storeFile = (ctx) => (ctx?.dir ? path.join(ctx.dir, 'social', 'published.json') : null);
export const storeKey = (name, item) => `${name}:${item.id}`;
export function storeGet(ctx, key) {
  const f = storeFile(ctx);
  if (!f) return null;
  const s = readJson(f, {});
  return s && typeof s === 'object' ? s[key] ?? null : null;
}
export function storePut(ctx, key, row) {
  const f = storeFile(ctx);
  if (!f) return;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const s = readJson(f, {});
  const next = s && typeof s === 'object' && !Array.isArray(s) ? s : {};
  if (row === null) delete next[key];
  else next[key] = { ...(next[key] ?? {}), ...row, at: new Date(ctx.now ?? Date.now()).toISOString() };
  writeJson(f, next);
}

// Suppression (products/<slug>/suppression.json, written by tools/inbox.mjs): a reply whose lead or
// contact id is listed is refused. Fails closed: an unreadable file refuses every reply to a person.
export function suppressionError(ctx, ids = []) {
  const want = ids.filter((x) => x != null && x !== '').map(String);
  if (!want.length || !ctx?.dir) return null;
  const f = path.join(ctx.dir, 'suppression.json');
  if (!fs.existsSync(f)) return null;
  let j;
  try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return 'suppression.json is unreadable; no reply to a person until it is fixed'; }
  const rows = Array.isArray(j) ? j : Array.isArray(j?.entries) ? j.entries : [];
  const listed = new Set(rows.flatMap((e) => [e?.lead, e?.contact]).filter((x) => x != null && x !== '').map(String));
  return want.some((x) => listed.has(x)) ? 'this person is on suppression.json; reply not sent' : null;
}

// Hours since an ISO time (Infinity when unknown).
export const hoursSince = (iso, now) => { const t = Date.parse(iso ?? ''); return Number.isFinite(t) ? (Date.parse(now ?? new Date().toISOString()) - t) / 3600000 : Infinity; };

export const sleeper = (ctx) => ctx.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
