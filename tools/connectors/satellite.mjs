// Applies approved site changes through the product's Whalyom Satellite (installed on its server).
// Accepts "publish" items for site/blog/landing and "site-change" items. The draft's front matter
// "path" sets the file on the site (relative to the site root); otherwise pages go to whalyom/<name>.html.
// Needs connection.json "satellite" URL and the site secret in .env (written by tools/attach.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { readDraft, readJson } from '../lib/env.mjs';
import { satellite, secretEnvName } from '../lib/satellite-client.mjs';
import { mdToHtml } from './local-site.mjs';

const WRITABLE = new Set(['node', 'docker', 'satellite']);

export default {
  name: 'satellite',
  handles: 'type "publish" or "site-change" on an attached site, through its satellite',
  needs: ['tools/attach.mjs <domain> --satellite <url>'],
  accepts: (item) => item.type === 'site-change' || (item.type === 'publish' && ['site', 'blog', 'landing', 'seo', undefined].includes(item.channel)),
  // Configured per product at execute time (needs that product's connection + secret).
  configured: (env) => Object.keys(env).some((k) => k.startsWith('OM_SAT_SECRET_') && env[k]),
  // Only the Node satellite (node/docker stacks) can write files; WordPress, Worker, Next.js and Netlify endpoints are read-only.
  usableFor: (ctx) => { const c = readJson(path.join(ctx.dir, 'connection.json'), {}); return Boolean(c.satellite && ctx.env[secretEnvName(ctx.slug)] && WRITABLE.has(c.stack ?? 'node')); },
  async execute(item, ctx) {
    const conn = readJson(path.join(ctx.dir, 'connection.json'), {});
    const secret = ctx.env[secretEnvName(ctx.slug)];
    if (!conn.satellite || !secret) return { ok: false, detail: 'product has no connected satellite' };
    const file = path.join(ctx.dir, item.file ?? '');
    if (!item.file || !fs.existsSync(file)) return { ok: false, detail: `draft not found: ${item.file}` };
    const { meta, body } = readDraft(file);
    const isHtmlTarget = !meta.path || /\.html?$/.test(meta.path);
    const name = (meta.slug || meta.title || item.title || item.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const target = meta.path || `whalyom/${name}.html`;
    const content = item.type === 'site-change' || !isHtmlTarget ? body : `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${meta.title ?? item.title ?? name}</title><meta name="description" content="${meta.description ?? ''}"></head><body>${mdToHtml(body)}<script async src="/whalyom.js"></script></body></html>\n`;
    if (ctx.dryRun) return { ok: true, ref: 'dry-run', detail: `would write ${target} on ${conn.domain}` };
    const r = await satellite(conn.satellite, secret, { prefix: conn.prefix ?? '/_whalyom' }).apply(target, content, { reason: `Whalyom ${item.id}: ${item.title ?? ''}`, base_sha: meta.base_sha });
    return { ok: true, ref: r.path, detail: `wrote ${r.path} on ${conn.domain}${r.backup ? ` (backup ${r.backup})` : ''}` };
  },
};
