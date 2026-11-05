// Generic webhook connector: hands an approved item to an automation platform (n8n, Make,
// Zapier, Pipedream) that does the posting. One URL per channel, or one catch-all.
//   OM_WEBHOOK_<CHANNEL>=https://...   e.g. OM_WEBHOOK_X, OM_WEBHOOK_LINKEDIN, OM_WEBHOOK_GOOGLE_ADS
//   OM_WEBHOOK_DEFAULT=https://...      used when no channel-specific URL is set
//   OM_WEBHOOK_SECRET=...               sent as the X-OM-Signature header (HMAC-SHA256 of the body)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { redact, hostOf } from './_http.mjs';

const key = (channel) => `OM_WEBHOOK_${String(channel || 'default').toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
const urlFor = (item, env) => env[key(item.channel)] || env.OM_WEBHOOK_DEFAULT;

export default {
  name: 'webhook',
  handles: 'any approved item, by channel (n8n / Make / Zapier / Pipedream)',
  needs: ['OM_WEBHOOK_<CHANNEL> or OM_WEBHOOK_DEFAULT'],
  // Only items that have a URL (own channel or OM_WEBHOOK_DEFAULT), so exporters and manual still get the rest.
  accepts: (item, env = process.env) => Boolean(urlFor(item, env)),
  configured: (env) => Object.keys(env).some((k) => k.startsWith('OM_WEBHOOK_') && k !== 'OM_WEBHOOK_SECRET' && env[k]),
  async execute(item, ctx) {
    const url = urlFor(item, ctx.env);
    if (!url) return { ok: false, detail: `no webhook for channel ${item.channel ?? 'default'}` };
    const file = item.file ? path.join(ctx.dir, item.file) : null;
    const content = file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const body = JSON.stringify({ product: ctx.slug, approval: item, content, sent_at: ctx.now });
    const headers = { 'content-type': 'application/json' };
    if (ctx.env.OM_WEBHOOK_SECRET) headers['x-om-signature'] = crypto.createHmac('sha256', ctx.env.OM_WEBHOOK_SECRET).update(body).digest('hex');
    if (ctx.dryRun) return { ok: true, ref: 'dry-run', detail: `would POST ${body.length} bytes to ${hostOf(url)}` };
    const res = await fetch(url, { method: 'POST', headers, body });
    const text = await res.text();
    return { ok: res.ok, ref: res.headers.get('x-request-id') ?? '', detail: `HTTP ${res.status} ${redact(text, ctx.env).slice(0, 200)}` };
  },
};
