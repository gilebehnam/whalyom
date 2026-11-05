// Checks an installed Whalyom endpoint (satellite, WordPress plugin, Worker, Next.js route, Netlify edge)
// from the hub: signed health, unsigned requests refused, response signature, clock skew, version,
// CORS on /collect, the tracker, TLS (certificate days left), and robots.txt / sitemap / llms.txt.
// Used by: node tools/attach.mjs <slug> --verify <url>
import tls from 'node:tls';
import { satellite } from '../lib/satellite-client.mjs';
import { VERSION } from './whalyom-satellite.mjs';

const cmpVer = (a, b) => { const pa = String(a).split('.').map(Number); const pb = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0); } return 0; };
const get = async (url, init = {}) => { try { const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(init.timeout ?? 10000), ...init }); return { ok: r.ok, status: r.status, headers: r.headers, text: init.method === 'HEAD' || init.method === 'OPTIONS' ? '' : await r.text() }; } catch (e) { return { ok: false, status: 0, error: String(e.cause?.code ?? e.message ?? e) }; } };

export function certDaysLeft(host, port = 443, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const sock = tls.connect({ host, port, servername: host, timeout: timeoutMs }, () => {
      const c = sock.getPeerCertificate(); const authorized = sock.authorized; sock.end();
      if (!c || !c.valid_to) return resolve({ error: 'no certificate' });
      resolve({ days: Math.floor((new Date(c.valid_to) - Date.now()) / 86400000), valid_to: c.valid_to, issuer: c.issuer?.O ?? c.issuer?.CN ?? '', authorized, authorizationError: sock.authorizationError ? String(sock.authorizationError) : null, protocol: sock.getProtocol?.() });
    });
    sock.on('error', (e) => resolve({ error: String(e.code ?? e.message) }));
    sock.on('timeout', () => { sock.destroy(); resolve({ error: 'timeout' }); });
  });
}

// opts: { url, secret, prefix, collector, siteOrigin, skipTls }
export async function verifySite(opts) {
  const base = new URL(opts.url);
  const origin = base.origin;
  const prefix = (opts.prefix ?? '/_whalyom').replace(/\/$/, '');
  const collectUrl = opts.collectPath ? new URL(opts.collectPath, origin).href : prefix === '/wp-json/whalyom/v1' ? `${origin}${prefix}/collect` : prefix === '/api/whalyom' ? `${origin}/api/whalyom/collect` : `${origin}/collect`;
  const trackerUrl = prefix === '/_whalyom' ? `${origin}/whalyom.js` : null;
  const siteOrigin = opts.siteOrigin ?? origin;
  const checks = [];
  const add = (name, status, detail, data) => checks.push({ name, status, detail, ...(data ? { data } : {}) });

  // 1. signed health + response signature + skew + version
  let health = null;
  if (!opts.secret) add('health_signature', 'fail', 'no secret in .env for this site (run attach first)');
  else {
    try {
      const t0 = Date.now();
      health = await satellite(origin, opts.secret, { prefix }).health({ meta: true });
      const meta = health._meta;
      add('health_signature', 'pass', `signed health answered (${meta.version === 2 ? 'v2 nonce' : 'legacy v1'} signature, ${meta.rtt_ms} ms)`);
      add('response_signature', meta.response_signed ? 'pass' : 'warn', meta.response_signed ? 'response is signed with the site secret' : 'response is not signed (endpoint older than 1.1.0): update it');
      const serverTime = Number(health.time) || (meta.date ? Date.parse(meta.date) : NaN);
      if (Number.isFinite(serverTime)) {
        const skew = Math.round(serverTime - (t0 + meta.rtt_ms / 2));
        const abs = Math.abs(skew);
        add('clock_skew', abs > 240000 ? 'fail' : abs > 60000 ? 'warn' : 'pass', `server clock is ${skew >= 0 ? 'ahead' : 'behind'} by ${abs} ms${abs > 60000 ? ' (requests fail beyond 300 s: enable NTP on the server)' : ''}`, { skew_ms: skew, from: health.time ? 'health.time' : 'Date header' });
      } else add('clock_skew', 'warn', 'server time not reported');
      const v = health.version ?? '0.0.0';
      const c = cmpVer(v, VERSION);
      add('version', c < 0 ? 'warn' : 'pass', c < 0 ? `endpoint ${v} is older than ${VERSION}: re-run the installer for this stack` : `endpoint ${v} (${health.kind ?? 'satellite'})`, { version: v, latest: VERSION, kind: health.kind ?? 'satellite' });
      add('writes', 'pass', health.writes ? 'writes are ON (approved changes can be applied)' : 'read-only (writes off)');
      if (health.strict === false) add('strict_mode', 'warn', 'legacy unsigned-nonce requests are still accepted: start the satellite with --strict');
    } catch (e) {
      const why = e.status === 401 ? 'secret does not match (401)' : e.status ? `HTTP ${e.status}: ${e.message}` : e.message;
      add('health_signature', 'fail', why);
    }
  }
  // 2. unsigned must be refused
  const unsigned = await get(`${origin}${prefix}/health`);
  add('signature_enforced', unsigned.status === 401 || unsigned.status === 403 ? 'pass' : unsigned.status === 0 ? 'fail' : 'fail', unsigned.status === 0 ? `unreachable: ${unsigned.error}` : `unsigned health → HTTP ${unsigned.status}`);
  // 3. CORS on /collect
  const pre = await get(collectUrl, { method: 'OPTIONS', headers: { origin: siteOrigin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
  const acao = pre.headers?.get?.('access-control-allow-origin');
  if (pre.status === 0) add('cors', 'fail', `collect endpoint unreachable: ${pre.error}`);
  else if (acao === '*') add('cors', 'warn', 'collect allows any origin: set --origins on the satellite (or WHALYOM_ORIGINS)');
  else if (acao && acao.replace(/\/$/, '').toLowerCase() === siteOrigin.toLowerCase()) {
    const evil = await get(collectUrl, { method: 'OPTIONS', headers: { origin: 'https://evil.invalid', 'access-control-request-method': 'POST' } });
    const leaked = evil.headers?.get?.('access-control-allow-origin');
    add('cors', leaked && leaked !== 'null' && leaked.includes('evil') ? 'fail' : 'pass', leaked && leaked.includes('evil') ? 'collect reflects any origin' : `collect allows ${siteOrigin} only (allow-list)`);
  } else add('cors', pre.status === 204 || pre.status === 200 ? 'warn' : 'warn', `preflight from ${siteOrigin}: HTTP ${pre.status}, allow-origin ${acao ?? 'none'}`);
  const signedCors = unsigned.headers?.get?.('access-control-allow-origin');
  if (signedCors === '*') add('signed_cors', 'warn', 'signed API sends Access-Control-Allow-Origin: * (not needed; the hub is not a browser)');
  // 4. tracker
  if (trackerUrl) {
    const t = await get(trackerUrl);
    add('tracker', t.ok && /whalyom/.test(t.text) ? 'pass' : 'fail', t.ok ? `${trackerUrl} served (${t.text.length} bytes, ${t.headers.get('content-type')})` : `${trackerUrl}: ${t.status || t.error}`);
  }
  // 5. TLS
  if (base.protocol !== 'https:') add('tls', opts.allowHttp ? 'skip' : 'fail', `${origin} is not HTTPS${opts.allowHttp ? ' (local test)' : ': put the endpoint behind HTTPS'}`);
  else if (!opts.skipTls) {
    const c = await certDaysLeft(base.hostname, Number(base.port || 443));
    if (c.error) add('tls', 'fail', `TLS: ${c.error}`);
    else add('tls', !c.authorized ? 'fail' : c.days < 14 ? 'warn' : 'pass', c.authorized ? `certificate valid for ${c.days} more days (${c.issuer}, ${c.protocol})` : `certificate not trusted: ${c.authorizationError}`, { days_left: c.days, valid_to: c.valid_to });
  }
  // 6. discoverability files on the site itself
  const site = new URL(siteOrigin);
  const robots = await get(`${site.origin}/robots.txt`);
  add('robots_txt', robots.ok ? 'pass' : 'warn', robots.ok ? 'robots.txt present' : `robots.txt missing (HTTP ${robots.status || robots.error})`);
  const sitemapUrl = (robots.ok && robots.text.match(/^\s*sitemap:\s*(\S+)/im)?.[1]) || `${site.origin}/sitemap.xml`;
  let sm = await get(sitemapUrl);
  if (!sm.ok && sitemapUrl.endsWith('/sitemap.xml')) sm = await get(`${site.origin}/sitemap_index.xml`);
  add('sitemap', sm.ok && /<(urlset|sitemapindex)/i.test(sm.text) ? 'pass' : 'warn', sm.ok ? `sitemap found (${sitemapUrl})` : 'no sitemap.xml (and none in robots.txt)');
  const llms = await get(`${site.origin}/llms.txt`);
  add('llms_txt', llms.ok && !/<html/i.test(llms.text.slice(0, 200)) ? 'pass' : 'warn', llms.ok ? 'llms.txt present' : 'llms.txt missing (helps AI assistants cite the site)');

  const fails = checks.filter((c) => c.status === 'fail').length;
  const warns = checks.filter((c) => c.status === 'warn').length;
  const scored = checks.filter((c) => c.status !== 'skip');
  return {
    url: opts.url, prefix, checked_at: new Date().toISOString(),
    status: fails ? 'fail' : warns ? 'warn' : 'pass',
    score: Math.round((scored.filter((c) => c.status === 'pass').length / Math.max(1, scored.length)) * 100),
    failed: checks.filter((c) => c.status === 'fail').map((c) => c.name),
    warnings: checks.filter((c) => c.status === 'warn').map((c) => c.name),
    endpoint: health ? { version: health.version, kind: health.kind ?? 'satellite', writes: Boolean(health.writes), events: health.events } : null,
    checks,
  };
}
