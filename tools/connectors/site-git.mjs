// Publishes approved pages to the product's website repository (static site, GitHub Pages,
// Cloudflare Pages, Netlify, Vercel: anything that deploys on push).
// Needs OM_SITE_REPO_<SLUG> (or OM_SITE_REPO): a local clone of the site repo, and optional
// OM_SITE_CONTENT_DIR (default "content"). The draft's front matter "path" sets the target file.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readDraft } from '../lib/env.mjs';

const repoFor = (slug, env) => env[`OM_SITE_REPO_${slug.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`] || env.OM_SITE_REPO;

export default {
  name: 'site-git',
  handles: 'type "publish" with channel "site" or "blog" (pages and articles)',
  needs: ['OM_SITE_REPO_<SLUG> or OM_SITE_REPO (local clone of the site repo)'],
  accepts: (item) => item.type === 'publish' && ['site', 'blog', 'landing', undefined].includes(item.channel),
  configured: (env) => Object.keys(env).some((k) => k.startsWith('OM_SITE_REPO') && env[k]),
  // Only for products that have a repo of their own (or a shared OM_SITE_REPO).
  usableFor: (ctx) => Boolean(repoFor(ctx.slug, ctx.env)),
  async execute(item, ctx) {
    const repo = repoFor(ctx.slug, ctx.env);
    if (!repo || !fs.existsSync(path.join(repo, '.git'))) return { ok: false, detail: `site repo not found for ${ctx.slug}` };
    const { meta } = readDraft(path.join(ctx.dir, item.file));
    const rel = meta.path || path.join(ctx.env.OM_SITE_CONTENT_DIR || 'content', path.basename(item.file));
    const target = path.resolve(repo, rel);
    if (!target.startsWith(path.resolve(repo) + path.sep)) return { ok: false, detail: 'target path leaves the site repo' };
    if (ctx.dryRun) return { ok: true, ref: 'dry-run', detail: `would write ${rel} and push` };
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(ctx.dir, item.file), target);
    const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
    git('add', rel);
    git('-c', 'user.name=OM', '-c', 'user.email=om@localhost', 'commit', '-m', `content: ${item.title ?? rel} (OM ${item.id})`);
    git('push');
    return { ok: true, ref: git('rev-parse', '--short', 'HEAD'), detail: `published ${rel}` };
  },
};
