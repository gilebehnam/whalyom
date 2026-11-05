// Whalyom collector as a Netlify Edge Function, for {{DOMAIN}}.
// Place the folder at: netlify/edge-functions/whalyom/ (index.js, whalyom-core.mjs, tracker.mjs)
//   GET /whalyom.js, POST /collect, GET /_whalyom/health and /_whalyom/events (signed, read-only)
// Environment (Site configuration → Environment variables, scope "Functions"):
//   WHALYOM_SECRET   the value of {{SECRET_ENV}} from the hub's .env
//   WHALYOM_ORIGINS  {{ORIGINS}}
//   KV_REST_API_URL / KV_REST_API_TOKEN   Upstash Redis REST, so events persist (else memory only).
import { createHandler, memoryStore, upstashStore } from './whalyom-core.mjs';
import trackerJs from './tracker.mjs';

const env = (k) => globalThis.Netlify?.env?.get?.(k) ?? globalThis.Deno?.env?.get?.(k) ?? globalThis.process?.env?.[k];
let handle;
const getHandle = () => handle ??= createHandler({
  kind: 'netlify-edge',
  secret: () => env('WHALYOM_SECRET'),
  store: env('KV_REST_API_URL') && env('KV_REST_API_TOKEN') ? upstashStore(env('KV_REST_API_URL'), env('KV_REST_API_TOKEN'), { key: 'whalyom:{{SLUG}}' }) : memoryStore(),
  siteId: '{{SLUG}}',
  origins: String(env('WHALYOM_ORIGINS') || '{{ORIGINS}}').split(',').filter(Boolean),
  trackerJs,
});

// Returning undefined lets Netlify serve the request normally.
export default async (request) => (await getHandle()(request)) ?? undefined;

export const config = { path: ['/whalyom.js', '/collect', '/_whalyom/*'] };
