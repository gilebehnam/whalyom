// X (Twitter) API v2: POST /2/tweets. Only active when keys are present.
// Auth, either:
//   OAuth 1.0a user context: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET
//     (app with Read and Write permission; regenerate the access token after changing permissions), or
//   OAuth 2.0 user token with tweet.write: X_USER_ACCESS_TOKEN.
// Threads: separate tweets in the draft with a line containing only "---". Each part is checked
// against 280 characters, counting every URL as 23 (t.co). CJK double-weighting is not modelled.
import crypto from 'node:crypto';
import { defineConnector, loadDraft, request, fail } from './_http.mjs';

const API = 'https://api.x.com/2/tweets';
const OAUTH1 = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET'];
const pct = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// OAuth 1.0a HMAC-SHA1 header. The JSON body is not part of the signature base (RFC 5849 §3.4.1.3).
export function oauth1Header(method, url, env, { nonce = crypto.randomBytes(16).toString('hex'), timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const u = new URL(url);
  const oauth = { oauth_consumer_key: env.X_API_KEY, oauth_nonce: nonce, oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: String(timestamp), oauth_token: env.X_ACCESS_TOKEN, oauth_version: '1.0' };
  const params = [...Object.entries(oauth), ...u.searchParams.entries()].map(([k, v]) => [pct(k), pct(v)]).sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1));
  const base = [method.toUpperCase(), pct(`${u.origin}${u.pathname}`), pct(params.map(([k, v]) => `${k}=${v}`).join('&'))].join('&');
  const sig = crypto.createHmac('sha1', `${pct(env.X_API_SECRET)}&${pct(env.X_ACCESS_TOKEN_SECRET)}`).update(base).digest('base64');
  return 'OAuth ' + Object.entries({ ...oauth, oauth_signature: sig }).map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(', ');
}

export const tweetLength = (s) => [...String(s).replace(/https?:\/\/\S+/g, 'x'.repeat(23))].length;
export const splitThread = (body) => body.split(/\r?\n\s*---\s*\r?\n/).map((s) => s.trim()).filter(Boolean);

export default defineConnector({
  name: 'x',
  handles: 'type "post" with channel "x" (API v2 tweets; threads split on "---" lines)',
  needs: ['X_API_KEY + X_API_SECRET + X_ACCESS_TOKEN + X_ACCESS_TOKEN_SECRET, or X_USER_ACCESS_TOKEN'],
  required: (env) => (env.X_USER_ACCESS_TOKEN || OAUTH1.every((k) => env[k]) ? [] : ['X_USER_ACCESS_TOKEN or ' + OAUTH1.join(' + ')]),
  accepts: (item) => item.type === 'post' && ['x', 'twitter'].includes(item.channel),
  prepare(item, ctx) {
    const { body, title } = loadDraft(item, ctx);
    const parts = splitThread(body || title || '');
    if (!parts.length) return { error: 'empty post' };
    if (parts.length > 25) return { error: `thread has ${parts.length} parts; keep it to 25 or fewer` };
    const long = parts.map((t, i) => [i + 1, tweetLength(t)]).filter(([, n]) => n > 280);
    if (long.length) return { error: `part(s) over 280 characters: ${long.map(([i, n]) => `#${i} (${n})`).join(', ')}` };
    return { parts, preview: `post ${parts.length === 1 ? 'one tweet' : `a ${parts.length}-part thread`} to X` };
  },
  async send(p, item, ctx) {
    const ids = [];
    for (const text of p.parts) {
      const json = { text };
      if (ids.length) json.reply = { in_reply_to_tweet_id: ids.at(-1) };
      const authorization = ctx.env.X_USER_ACCESS_TOKEN && !OAUTH1.every((k) => ctx.env[k]) ? `Bearer ${ctx.env.X_USER_ACCESS_TOKEN}` : oauth1Header('POST', API, ctx.env);
      const r = await request(ctx, { url: API, headers: { authorization }, json });
      if (!r.ok || !r.data?.data?.id) return { ok: false, ref: ids.join(','), detail: `${fail(r, ctx, 'X')}${ids.length ? ` (after ${ids.length} part(s) posted: ${ids.join(',')})` : ''}` };
      ids.push(r.data.data.id);
    }
    return { ok: true, ref: ids.join(','), detail: `posted ${ids.length} tweet(s) to X` };
  },
});
