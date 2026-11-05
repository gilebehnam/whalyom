// Whalyom collector as a Cloudflare Worker, for {{DOMAIN}}.
// Routes (wrangler.toml): {{DOMAIN}}/whalyom.js, {{DOMAIN}}/collect, {{DOMAIN}}/_whalyom/*
// Everything else on the route passes through to the origin untouched.
//   Storage: Workers KV (binding WHALYOM_KV) by default; bind a D1 database as WHALYOM_DB to use D1 instead.
//   Secret:  wrangler secret put WHALYOM_SECRET   (paste the value of {{SECRET_ENV}} from the hub's .env)
//   Origins: WHALYOM_ORIGINS var, comma-separated (only these sites may post to /collect).
// The hub reads it like a satellite: node tools/attach.mjs {{SLUG}} --satellite https://{{DOMAIN}}
import { createHandler, kvStore, d1Store, memoryStore } from './whalyom-core.mjs';
import trackerJs from './tracker.mjs';

let handler; let boundTo;
function getHandler(env) {
  if (handler && boundTo === env) return handler;
  const store = env.WHALYOM_DB ? d1Store(env.WHALYOM_DB) : env.WHALYOM_KV ? kvStore(env.WHALYOM_KV) : memoryStore();
  handler = createHandler({
    kind: 'cloudflare-worker',
    secret: env.WHALYOM_SECRET,
    store,
    siteId: env.WHALYOM_SITE_ID || '{{SLUG}}',
    origins: String(env.WHALYOM_ORIGINS || '{{ORIGINS}}').split(',').filter(Boolean),
    trackerJs,
  });
  boundTo = env;
  return handler;
}

export default {
  async fetch(request, env) {
    const res = await getHandler(env)(request);
    return res ?? fetch(request);
  },
};
