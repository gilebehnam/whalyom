// Whalyom endpoint for a Next.js (App Router) site on Vercel or any Node host, for {{DOMAIN}}.
// Place at: app/api/whalyom/[op]/route.js   (and lib/whalyom-core.mjs next to your app)
//   POST /api/whalyom/collect   public beacon for /whalyom.js (copy whalyom.js into public/)
//   GET  /api/whalyom/health    signed, read-only
//   GET  /api/whalyom/events    signed, read-only
// Environment (Vercel → Project → Settings → Environment Variables):
//   WHALYOM_SECRET      the value of {{SECRET_ENV}} from the hub's .env (never commit it)
//   WHALYOM_ORIGINS     {{ORIGINS}}
//   KV_REST_API_URL / KV_REST_API_TOKEN   Vercel KV or Upstash Redis (events survive between invocations).
//   Without them events live in memory only (fine for a test, lost on every cold start).
import { createHandler, memoryStore, upstashStore } from '../../../../lib/whalyom-core.mjs';

export const dynamic = 'force-dynamic';

const store = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
  ? upstashStore(process.env.KV_REST_API_URL, process.env.KV_REST_API_TOKEN, { key: 'whalyom:{{SLUG}}' })
  : memoryStore();
const handle = createHandler({
  kind: 'nextjs',
  prefix: '/api/whalyom',
  collectPath: '/api/whalyom/collect',
  secret: () => process.env.WHALYOM_SECRET,
  store,
  siteId: '{{SLUG}}',
  origins: String(process.env.WHALYOM_ORIGINS || '{{ORIGINS}}').split(',').filter(Boolean),
});
const run = async (request) => (await handle(request)) ?? Response.json({ error: 'not found' }, { status: 404 });

export const GET = run;
export const POST = run;
export const OPTIONS = run;
