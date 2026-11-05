// Hub-side client for a Whalyom Satellite (or any endpoint that speaks the same protocol: the WordPress
// plugin, the Cloudflare Worker, the Next.js route and the Netlify edge function).
// Every request is signed with the site's secret, matching tools/satellite/whalyom-satellite.mjs:
//   v2 (default): HMAC-SHA256(secret, ts \n nonce \n METHOD \n path+query \n body), headers x-whalyom-ts/-nonce/-sig
//   v1 (legacy) : HMAC-SHA256(secret, ts \n METHOD \n path+query \n body) — used only to talk to a satellite
//                 older than 1.1.0 (it answers 401 without "sig_versions"), unless { legacy: false }.
// Signed 200 responses from 1.1.0+ carry x-whalyom-resp-sig; the client checks it and rejects a mismatch.
import crypto from 'node:crypto';

export const signRequest = (secret, ts, method, pathAndQuery, body) =>
  crypto.createHmac('sha256', secret).update(`${ts}\n${method}\n${pathAndQuery}\n${body}`).digest('hex');
export const signRequestV2 = (secret, ts, nonce, method, pathAndQuery, body) =>
  crypto.createHmac('sha256', secret).update(`${ts}\n${nonce}\n${method}\n${pathAndQuery}\n${body}`).digest('hex');
export const signResponse = (secret, nonce, status, body) =>
  crypto.createHmac('sha256', secret).update(`resp\n${nonce}\n${status}\n${body}`).digest('hex');

export const secretEnvName = (slug) => `OM_SAT_SECRET_${slug.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

const sameHex = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && /^[0-9a-f]+$/i.test(a)
  && crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));

// opts.prefix: where the signed API lives ('/_whalyom' for the satellite, '/wp-json/whalyom/v1' for WordPress,
// '/api/whalyom' for the Next.js route). opts.requireResponseSig: fail when a 200 is not signed; it also turns off the
// v1 retry (v1 has no response signing), so a 401 without sig_versions cannot downgrade a signing satellite.
export function satellite(baseUrl, secret, opts = {}) {
  const prefix = (opts.prefix ?? '/_whalyom').replace(/\/$/, '');
  const timeout = opts.timeoutMs ?? 15000;
  const once = async (method, pathAndQuery, body, version) => {
    const ts = Date.now();
    const nonce = crypto.randomBytes(16).toString('hex');
    const headers = { 'content-type': 'application/json', 'x-whalyom-ts': String(ts) };
    if (version === 2) { headers['x-whalyom-nonce'] = nonce; headers['x-whalyom-sig'] = signRequestV2(secret, ts, nonce, method, pathAndQuery, body); }
    else headers['x-whalyom-sig'] = signRequest(secret, ts, method, pathAndQuery, body);
    const t0 = Date.now();
    const res = await fetch(new URL(pathAndQuery, baseUrl), { method, body: body || undefined, headers, signal: AbortSignal.timeout(timeout) });
    const text = await res.text();
    let json = {}; try { json = JSON.parse(text); } catch { /* not json */ }
    const respSig = res.headers.get('x-whalyom-resp-sig');
    const meta = { status: res.status, version, rtt_ms: Date.now() - t0, sent_at: ts, date: res.headers.get('date'), response_signed: false, headers: res.headers };
    if (res.ok && version === 2) {
      if (respSig) {
        if (!sameHex(respSig, signResponse(secret, nonce, res.status, text))) { const e = new Error('response signature mismatch (not your satellite, or a proxy changed the body)'); e.status = res.status; e.meta = meta; throw e; }
        meta.response_signed = true;
      } else if (opts.requireResponseSig) { const e = new Error('response is not signed'); e.status = res.status; e.meta = meta; throw e; }
    }
    return { res, json, meta };
  };
  const allowLegacy = opts.legacy !== false && !opts.requireResponseSig;
  const call = async (method, pathAndQuery, payload, withMeta = false) => {
    const body = payload === undefined ? '' : JSON.stringify(payload);
    let { res, json, meta } = await once(method, pathAndQuery, body, 2);
    // A satellite older than 1.1.0 does not know nonces: it answers 401 without "sig_versions".
    if (res.status === 401 && !Array.isArray(json.sig_versions) && allowLegacy && !json.code) ({ res, json, meta } = await once(method, pathAndQuery, body, 1));
    if (!res.ok) { const e = new Error(json.error ?? json.message ?? `HTTP ${res.status}`); e.status = res.status; e.meta = meta; throw e; }
    if (withMeta) Object.defineProperty(json, '_meta', { value: meta, enumerable: false });
    return json;
  };
  return {
    prefix,
    health: (o = {}) => call('GET', `${prefix}/health`, undefined, o.meta),
    files: (p = '') => call('GET', `${prefix}/files?path=${encodeURIComponent(p)}`),
    events: (since = '') => call('GET', `${prefix}/events?since=${encodeURIComponent(since)}`),
    leads: (since = '') => call('GET', `${prefix}/leads?since=${encodeURIComponent(since)}`),
    apply: (p, content, o = {}) => call('POST', `${prefix}/apply`, { path: p, content, ...o }),
    boosters: (items, reason = '') => call('POST', `${prefix}/boosters`, { items, reason }),
    raw: (method, pathAndQuery, payload) => call(method, pathAndQuery, payload, true),
  };
}
