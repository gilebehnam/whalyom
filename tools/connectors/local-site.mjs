// Free, zero-key publishing: turns approved pages and articles into a static site under
// site/<slug>/ with index, sitemap.xml and llms.txt (for AI-answer engines). The local server
// serves it at /site/<slug>/; any free static host (GitHub Pages, Cloudflare Pages, Netlify)
// can publish the same folder later. Always configured, so free mode never fails for want of keys.
import fs from 'node:fs';
import path from 'node:path';
import { readDraft, root } from '../lib/env.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Small markdown subset: headings, lists, links, bold, paragraphs. Enough for drafts the agents write.
export function mdToHtml(md) {
  const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g, '<a href="$2">$1</a>');
  const out = []; let list = false;
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^(#{1,4})\s+(.*)$/); const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (!li && list) { out.push('</ul>'); list = false; }
    if (h) out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    else if (li) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(li[1])}</li>`); }
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push('</ul>');
  return out.join('\n');
}

const pageHtml = (title, bodyHtml, description) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(description ?? '')}"><style>body{font:17px/1.6 system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;color:#0f172a}a{color:#0e7490}h1,h2{line-height:1.25}</style></head><body>${bodyHtml}</body></html>\n`;

export function rebuildIndex(siteDir, slug, productName) {
  const pages = fs.readdirSync(siteDir).filter((f) => f.endsWith('.html') && f !== 'index.html');
  const base = process.env.OM_SITE_BASE_URL ? `${process.env.OM_SITE_BASE_URL.replace(/\/$/, '')}/` : `/site/${slug}/`;
  const titles = pages.map((f) => [f, (fs.readFileSync(path.join(siteDir, f), 'utf8').match(/<title>(.*?)<\/title>/) ?? [])[1] ?? f]);
  fs.writeFileSync(path.join(siteDir, 'index.html'), pageHtml(productName, `<h1>${esc(productName)}</h1><ul>${titles.map(([f, t]) => `<li><a href="${f}">${t}</a></li>`).join('')}</ul>`, productName));
  fs.writeFileSync(path.join(siteDir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${['index.html', ...pages].map((f) => `  <url><loc>${base}${f}</loc></url>`).join('\n')}\n</urlset>\n`);
  fs.writeFileSync(path.join(siteDir, 'llms.txt'), `# ${productName}\n\n${titles.map(([f, t]) => `- [${t}](${base}${f})`).join('\n')}\n`);
}

export default {
  name: 'local-site',
  handles: 'type "publish" (pages, articles, landing pages) into a free static site, no keys needed',
  needs: [],
  accepts: (item) => item.type === 'publish' && ['site', 'blog', 'landing', 'seo', undefined].includes(item.channel),
  configured: () => true,
  async execute(item, ctx) {
    // Built landing pages (tools/landing-builder.mjs) are copied as-is into site/<slug>/landing/<template>/.
    if (item.landing || /(^|[\\/])landing[\\/]dist[\\/]/.test(item.file ?? '')) return (await import('../landing/publish.mjs')).publishApproval(item, ctx);
    const file = path.join(ctx.dir, item.file ?? '');
    if (!item.file || !fs.existsSync(file)) return { ok: false, detail: `draft not found: ${item.file}` };
    const { meta, body } = readDraft(file);
    const title = meta.title || (body.match(/^#\s+(.+)$/m) ?? [])[1] || item.title || item.id;
    const name = (meta.slug || title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || item.id;
    const siteDir = path.join(root, 'site', ctx.slug);
    if (ctx.dryRun) return { ok: true, ref: 'dry-run', detail: `would publish site/${ctx.slug}/${name}.html` };
    fs.mkdirSync(siteDir, { recursive: true });
    fs.writeFileSync(path.join(siteDir, `${name}.html`), pageHtml(title, mdToHtml(body), meta.description));
    const product = JSON.parse(fs.readFileSync(path.join(ctx.dir, 'product.json'), 'utf8'));
    rebuildIndex(siteDir, ctx.slug, product.name ?? ctx.slug);
    return { ok: true, ref: `site/${ctx.slug}/${name}.html`, detail: `published locally at /site/${ctx.slug}/${name}.html (sitemap and llms.txt updated)` };
  },
};
