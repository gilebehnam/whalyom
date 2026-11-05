// Google OAuth access token for Search Console, GA4 Data API and Google Ads.
// Either GOOGLE_ACCESS_TOKEN (short-lived, e.g. from `gcloud auth print-access-token`), or the
// refresh-token trio GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN (an OAuth
// client of type "Desktop" with the scopes the owner granted: webmasters, analytics.readonly, adwords).
import { request, redact } from './_http.mjs';

// Default Google Ads API version for the ads connector, pauseGoogle() and the metrics reader;
// GOOGLE_ADS_API_VERSION overrides it. Google sunsets a version about a year after release: check
// developers.google.com/google-ads/api/docs/sunset-dates (2026-11-04: v23 oldest working, v26 latest).
export const GOOGLE_ADS_API_VERSION = 'v26';

export const googleMissing = (env) => (env.GOOGLE_ACCESS_TOKEN || (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN)
  ? [] : ['GOOGLE_ACCESS_TOKEN or GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN']);

const cache = new Map();
export async function googleToken(ctx) {
  const env = ctx.env;
  if (env.GOOGLE_ACCESS_TOKEN) return env.GOOGLE_ACCESS_TOKEN;
  const k = env.GOOGLE_CLIENT_ID + env.GOOGLE_REFRESH_TOKEN;
  const hit = cache.get(k);
  if (hit && hit.exp > Date.now() + 60000) return hit.token;
  const r = await request(ctx, { url: 'https://oauth2.googleapis.com/token', form: { grant_type: 'refresh_token', client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: env.GOOGLE_REFRESH_TOKEN } });
  if (!r.ok || !r.data?.access_token) throw new Error(`Google token exchange failed: HTTP ${r.status} ${redact(r.text, env).slice(0, 160)}`);
  cache.set(k, { token: r.data.access_token, exp: Date.now() + Number(r.data.expires_in ?? 3000) * 1000 });
  return r.data.access_token;
}
