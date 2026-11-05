// Search-engine indexing: IndexNow (Bing, Yandex, Seznam, Naver…) and Google Search Console sitemaps.
// Approval items of type "index":
//   channel "indexnow" (or none): urls from item.urls or from the draft's lines that are URLs.
//   channel "gsc" / "sitemap": submits item.sitemap (default https://<domain>/sitemap.xml) to Search Console.
// Google retired the anonymous sitemap "ping" endpoint in 2023, so the GSC connector uses the
// Search Console API (sitemaps.submit) with an OAuth token that has the webmasters scope.
import { defineConnector, loadDraft, readProduct, request, fail, hostOf } from './_http.mjs';
import { googleMissing, googleToken } from './google-auth.mjs';

function urlsFor(item, ctx) {
  if (Array.isArray(item.urls) && item.urls.length) return item.urls.map(String);
  if (!item.file) return [];
  const { body } = loadDraft(item, ctx);
  return body.split(/\s+/).filter((t) => /^https?:\/\/\S+$/.test(t));
}

export async function pingIndexNow(ctx, urls, { host, key = ctx.env.INDEXNOW_KEY, keyLocation = ctx.env.INDEXNOW_KEY_LOCATION } = {}) {
  const json = { host, key, urlList: urls };
  if (keyLocation) json.keyLocation = keyLocation;
  return request(ctx, { url: ctx.env.INDEXNOW_ENDPOINT || 'https://api.indexnow.org/indexnow', json, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

export const indexnow = defineConnector({
  name: 'indexnow',
  handles: 'type "index" (channel "indexnow" or none): pings IndexNow with new or changed URLs',
  needs: ['INDEXNOW_KEY'],
  accepts: (item) => item.type === 'index' && [undefined, 'indexnow'].includes(item.channel),
  prepare(item, ctx) {
    const urls = urlsFor(item, ctx);
    if (!urls.length) return { error: 'no URLs: set item.urls or list URLs in the draft' };
    if (urls.length > 10000) return { error: `${urls.length} URLs: IndexNow accepts at most 10000 per request` };
    const host = ctx.env.INDEXNOW_HOST || readProduct(ctx).domain || new URL(urls[0]).host;
    const off = urls.filter((u) => hostOf(u) !== host && hostOf(u) !== `www.${host}`);
    if (off.length) return { error: `URLs must all be on ${host}: ${off.slice(0, 3).join(', ')}` };
    return { urls, host, preview: `submit ${urls.length} URL(s) for ${host} to IndexNow` };
  },
  async send(p, item, ctx) {
    const r = await pingIndexNow(ctx, p.urls, { host: p.host });
    return r.ok ? { ok: true, ref: `indexnow:${p.urls.length}`, detail: `IndexNow accepted ${p.urls.length} URL(s) (HTTP ${r.status})` } : { ok: false, detail: fail(r, ctx, 'IndexNow') };
  },
});

export const gscSitemap = defineConnector({
  name: 'gsc-sitemap',
  handles: 'type "index" with channel "gsc" or "sitemap": submits the sitemap to Google Search Console',
  needs: ['GSC_SITE_URL', 'GOOGLE_ACCESS_TOKEN or GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN'],
  required: (env) => [...(env.GSC_SITE_URL ? [] : ['GSC_SITE_URL']), ...googleMissing(env)],
  accepts: (item) => item.type === 'index' && ['gsc', 'sitemap'].includes(item.channel),
  prepare(item, ctx) {
    const domain = readProduct(ctx).domain;
    const sitemap = item.sitemap || (domain ? `https://${domain}/sitemap.xml` : '');
    if (!/^https?:\/\//.test(sitemap)) return { error: 'no sitemap URL: set item.sitemap or the product domain' };
    return { sitemap, preview: `submit ${sitemap} to Search Console property ${ctx.env.GSC_SITE_URL || '(GSC_SITE_URL)'}` };
  },
  async send(p, item, ctx) {
    const token = await googleToken(ctx);
    const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(ctx.env.GSC_SITE_URL)}/sitemaps/${encodeURIComponent(p.sitemap)}`;
    const r = await request(ctx, { url, method: 'PUT', headers: { authorization: `Bearer ${token}` } });
    return r.ok ? { ok: true, ref: p.sitemap, detail: `sitemap submitted to Search Console (HTTP ${r.status})` } : { ok: false, detail: fail(r, ctx, 'Search Console') };
  },
});

export default [indexnow, gscSitemap];
