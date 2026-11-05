// Publishes built landing pages into the free local static site: site/<slug>/landing/<template>/…
// served by tools/server.mjs at http://localhost:4321/site/<slug>/landing/<template>/.
// Used by the local-site connector for approved `publish` items whose file is under landing/dist/,
// and by `node tools/landing-builder.mjs <slug> --publish` for a local preview.
import fs from 'node:fs';
import path from 'node:path';
import { root } from '../lib/env.mjs';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function publishLanding({ dir, slug, templates, siteRoot = path.join(root, 'site') }) {
  const dist = path.join(dir, 'landing', 'dist');
  if (!fs.existsSync(dist)) return { ok: false, detail: `nothing built yet: run node tools/landing-builder.mjs ${slug}` };
  const names = (templates ?? fs.readdirSync(dist).filter((n) => fs.statSync(path.join(dist, n)).isDirectory()));
  const target = path.join(siteRoot, slug, 'landing');
  const published = [];
  for (const name of names) {
    const src = path.join(dist, name);
    if (!fs.existsSync(path.join(src, 'index.html'))) continue;
    fs.rmSync(path.join(target, name), { recursive: true, force: true });
    fs.cpSync(src, path.join(target, name), { recursive: true });
    published.push(name);
  }
  rebuildLandingIndex(target, slug);
  return { ok: published.length > 0, published, ref: `site/${slug}/landing/`, detail: `published ${published.join(', ') || 'nothing'} at /site/${slug}/landing/` };
}

// Gallery of every published template and variant, plus a combined sitemap and llms.txt.
export function rebuildLandingIndex(target, slug) {
  if (!fs.existsSync(target)) return;
  const entries = [];
  for (const name of fs.readdirSync(target).sort()) {
    const d = path.join(target, name);
    if (!fs.statSync(d).isDirectory() || !fs.existsSync(path.join(d, 'build.json'))) continue;
    const b = JSON.parse(fs.readFileSync(path.join(d, 'build.json'), 'utf8'));
    const vars = fs.readdirSync(d).filter((v) => fs.existsSync(path.join(d, v, 'build.json'))).map((v) => JSON.parse(fs.readFileSync(path.join(d, v, 'build.json'), 'utf8')));
    entries.push({ name, b, vars });
  }
  const base = process.env.OM_SITE_BASE_URL ? `${process.env.OM_SITE_BASE_URL.replace(/\/$/, '')}/${slug}/landing/` : `/site/${slug}/landing/`;
  const li = entries.map(({ name, b, vars }) => `<li><a href="${name}/">${esc(name)}</a> — ${esc(b.headline ?? '')}${vars.length ? ` <span>(variants: ${vars.map((v) => `<a href="${name}/${esc(v.variant)}/">${esc(v.variant)}</a>`).join(', ')})</span>` : ''}${b.placeholders?.length ? ` <em>placeholders: ${esc(b.placeholders.join(', '))}</em>` : ''}</li>`).join('');
  fs.writeFileSync(path.join(target, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Landing pages: ${esc(slug)}</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 16px;color:#0f172a}a{color:#0e7490}em{color:#92400e;font-size:14px}</style></head><body><h1>Landing pages</h1><p>${esc(slug)} — built by the Whalyom landing builder.</p><ul>${li}</ul></body></html>\n`);
  const live = entries.filter(({ b }) => !b.noindex);
  fs.writeFileSync(path.join(target, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${live.map(({ name }) => `  <url><loc>${base}${name}/</loc></url>`).join('\n')}\n</urlset>\n`);
  fs.writeFileSync(path.join(target, 'llms.txt'), `# ${slug} landing pages\n\n${entries.map(({ name, b }) => `- [${b.headline ?? name}](${base}${name}/)`).join('\n')}\n`);
}

// Hook for the local-site connector: an approval whose file is landing/dist/<template>/index.html.
export function publishApproval(item, ctx) {
  const m = String(item.file ?? '').replace(/\\/g, '/').match(/landing\/dist\/([a-z0-9-]+)\//i);
  const template = item.landing?.template ?? m?.[1];
  if (!template) return { ok: false, detail: `not a landing build: ${item.file}` };
  if (ctx.dryRun) return { ok: true, ref: 'dry-run', detail: `would publish site/${ctx.slug}/landing/${template}/` };
  const r = publishLanding({ dir: ctx.dir, slug: ctx.slug, templates: [template] });
  return { ok: r.ok, ref: `site/${ctx.slug}/landing/${template}/index.html`, detail: r.detail };
}
