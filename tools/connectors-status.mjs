// Shows which connectors are configured (secrets present) without printing any secret.
// Usage: node tools/connectors-status.mjs
import { loadEnv } from './lib/env.mjs';
import { status } from './connectors/index.mjs';

loadEnv();
const s = status(process.env);
s.push({ name: 'stripe (metrics)', configured: Boolean(process.env.STRIPE_API_KEY), needs: ['STRIPE_API_KEY (restricted, read-only)'], handles: 'daily revenue into metrics' });
for (const c of s) console.log(`${c.configured ? 'ON ' : 'off'}  ${c.name.padEnd(18)} ${c.handles}${c.configured ? '' : `  — needs ${c.needs.join(', ')}`}`);
