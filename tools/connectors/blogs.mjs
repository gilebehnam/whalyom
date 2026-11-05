// Blog and article platforms: dev.to, Hashnode, Medium, WordPress (REST) and Ghost (Admin API).
// Accept approval type "publish" on their own channel only ("devto", "hashnode", "medium",
// "wordpress", "ghost"), so the site/blog/landing routing of site-git, satellite and local-site
// never changes. Everything is created as a DRAFT unless the approval has activate: true or the
// draft's front matter says published: true. Cross-posts should set canonical_url in front matter.
import crypto from 'node:crypto';
import { defineConnector, loadDraft, request, fail, isLive, tagsOf } from './_http.mjs';
import { mdToHtml } from './local-site.mjs';

const isPublish = (item, channels) => item.type === 'publish' && channels.includes(item.channel);
const article = (item, ctx) => {
  const d = loadDraft(item, ctx);
  if (!d.body) throw new Error('empty article');
  return { ...d, body: d.body.replace(/^#\s+.+\r?\n+/, ''), live: isLive(item, d.meta) };
};
const mode = (live) => (live ? 'publish' : 'create a draft of');

export const devto = defineConnector({
  name: 'devto',
  handles: 'type "publish" with channel "devto" (article, draft unless activate: true)',
  needs: ['DEVTO_API_KEY'],
  accepts: (item) => isPublish(item, ['devto', 'dev.to']),
  prepare(item, ctx) { const a = article(item, ctx); return { ...a, preview: `${mode(a.live)} "${a.title}" on dev.to` }; },
  async send(p, item, ctx) {
    const tags = tagsOf(p.meta, 4).map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean);
    const r = await request(ctx, { url: 'https://dev.to/api/articles', headers: { 'api-key': ctx.env.DEVTO_API_KEY, accept: 'application/vnd.forem.api-v1+json' },
      json: { article: { title: p.title, body_markdown: p.body, published: p.live, tags, canonical_url: p.meta.canonical_url || undefined, description: p.meta.description || undefined } } });
    return r.ok ? { ok: true, ref: r.data?.url ?? String(r.data?.id ?? ''), detail: `${p.live ? 'published' : 'draft created'} on dev.to` } : { ok: false, detail: fail(r, ctx, 'dev.to') };
  },
});

export const hashnode = defineConnector({
  name: 'hashnode',
  handles: 'type "publish" with channel "hashnode" (GraphQL createDraft, or publishPost with activate: true)',
  needs: ['HASHNODE_TOKEN', 'HASHNODE_PUBLICATION_ID'],
  unverified: 'Hashnode GraphQL input shapes (CreateDraftInput / PublishPostInput) checked against public docs only.',
  accepts: (item) => isPublish(item, ['hashnode']),
  prepare(item, ctx) { const a = article(item, ctx); return { ...a, preview: `${mode(a.live)} "${a.title}" on Hashnode` }; },
  async send(p, item, ctx) {
    const input = { title: p.title, publicationId: ctx.env.HASHNODE_PUBLICATION_ID, contentMarkdown: p.body };
    if (p.meta.canonical_url) input.originalArticleURL = p.meta.canonical_url;
    const tags = tagsOf(p.meta, 5);
    if (tags.length) input.tags = tags.map((t) => ({ slug: t.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: t }));
    const query = p.live
      ? 'mutation Publish($input: PublishPostInput!) { publishPost(input: $input) { post { id url } } }'
      : 'mutation Draft($input: CreateDraftInput!) { createDraft(input: $input) { draft { id } } }';
    const r = await request(ctx, { url: 'https://gql.hashnode.com', headers: { authorization: ctx.env.HASHNODE_TOKEN }, json: { query, variables: { input } } });
    if (!r.ok || r.data?.errors?.length) return { ok: false, detail: r.data?.errors?.length ? `Hashnode: ${r.data.errors.map((e) => e.message).join('; ').slice(0, 200)}` : fail(r, ctx, 'Hashnode') };
    const ref = p.live ? r.data?.data?.publishPost?.post?.url : r.data?.data?.createDraft?.draft?.id;
    return { ok: true, ref: ref ?? '', detail: `${p.live ? 'published' : 'draft created'} on Hashnode` };
  },
});

export const medium = defineConnector({
  name: 'medium',
  handles: 'type "publish" with channel "medium" (integration token; draft unless activate: true)',
  needs: ['MEDIUM_TOKEN'],
  unverified: 'Medium no longer issues integration tokens to new accounts; existing tokens still work. The API is unmaintained.',
  accepts: (item) => isPublish(item, ['medium']),
  prepare(item, ctx) { const a = article(item, ctx); return { ...a, preview: `${mode(a.live)} "${a.title}" on Medium` }; },
  async send(p, item, ctx) {
    const headers = { authorization: `Bearer ${ctx.env.MEDIUM_TOKEN}`, accept: 'application/json' };
    const me = await request(ctx, { url: 'https://api.medium.com/v1/me', method: 'GET', headers });
    if (!me.ok || !me.data?.data?.id) return { ok: false, detail: fail(me, ctx, 'Medium /me') };
    const r = await request(ctx, { url: `https://api.medium.com/v1/users/${me.data.data.id}/posts`, headers,
      json: { title: p.title, contentFormat: 'markdown', content: `# ${p.title}\n\n${p.body}`, canonicalUrl: p.meta.canonical_url || undefined, tags: tagsOf(p.meta, 3), publishStatus: p.live ? 'public' : 'draft' } });
    return r.ok ? { ok: true, ref: r.data?.data?.url ?? '', detail: `${p.live ? 'published' : 'draft created'} on Medium` } : { ok: false, detail: fail(r, ctx, 'Medium') };
  },
});

export const wordpress = defineConnector({
  name: 'wordpress',
  handles: 'type "publish" with channel "wordpress" (REST API post, status draft unless activate: true)',
  needs: ['WP_URL', 'WP_USER', 'WP_APP_PASSWORD'],
  accepts: (item) => isPublish(item, ['wordpress', 'wp']),
  prepare(item, ctx) { const a = article(item, ctx); return { ...a, preview: `${mode(a.live)} "${a.title}" on ${ctx.env.WP_URL || '(WP_URL)'}` }; },
  async send(p, item, ctx) {
    const auth = Buffer.from(`${ctx.env.WP_USER}:${ctx.env.WP_APP_PASSWORD.replace(/\s+/g, '')}`).toString('base64');
    const r = await request(ctx, { url: `${ctx.env.WP_URL.replace(/\/$/, '')}/wp-json/wp/v2/posts`, headers: { authorization: `Basic ${auth}` },
      json: { title: p.title, content: mdToHtml(p.body), status: p.live ? 'publish' : 'draft', excerpt: p.meta.description || undefined, slug: p.meta.slug || undefined } });
    return r.ok ? { ok: true, ref: r.data?.link ?? String(r.data?.id ?? ''), detail: `${p.live ? 'published' : 'draft created'} on WordPress (post ${r.data?.id ?? '?'})` } : { ok: false, detail: fail(r, ctx, 'WordPress') };
  },
});

// Ghost Admin API token: JWT (HS256) signed with the hex secret of the "id:secret" Admin API key, 5 minutes.
const b64url = (b) => Buffer.from(b).toString('base64url');
export function ghostToken(adminKey, nowSec = Math.floor(Date.now() / 1000)) {
  const [id, secret] = String(adminKey).split(':');
  if (!id || !secret) throw new Error('GHOST_ADMIN_API_KEY must look like <id>:<secret>');
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: id }));
  const body = b64url(JSON.stringify({ iat: nowSec, exp: nowSec + 300, aud: '/admin/' }));
  const sig = crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

export const ghost = defineConnector({
  name: 'ghost',
  handles: 'type "publish" with channel "ghost" (Admin API post, draft unless activate: true)',
  needs: ['GHOST_ADMIN_URL', 'GHOST_ADMIN_API_KEY'],
  accepts: (item) => isPublish(item, ['ghost']),
  prepare(item, ctx) { const a = article(item, ctx); return { ...a, preview: `${mode(a.live)} "${a.title}" on ${ctx.env.GHOST_ADMIN_URL || '(GHOST_ADMIN_URL)'}` }; },
  async send(p, item, ctx) {
    const post = { title: p.title, html: mdToHtml(p.body), status: p.live ? 'published' : 'draft' };
    if (p.meta.description) post.custom_excerpt = p.meta.description.slice(0, 300);
    if (p.meta.canonical_url) post.canonical_url = p.meta.canonical_url;
    const tags = tagsOf(p.meta, 10); if (tags.length) post.tags = tags.map((name) => ({ name }));
    const r = await request(ctx, { url: `${ctx.env.GHOST_ADMIN_URL.replace(/\/$/, '')}/ghost/api/admin/posts/?source=html`, headers: { authorization: `Ghost ${ghostToken(ctx.env.GHOST_ADMIN_API_KEY)}`, 'accept-version': 'v5.0' }, json: { posts: [post] } });
    const out = r.data?.posts?.[0];
    return r.ok ? { ok: true, ref: out?.url ?? out?.id ?? '', detail: `${p.live ? 'published' : 'draft created'} on Ghost` } : { ok: false, detail: fail(r, ctx, 'Ghost') };
  },
});

export default [devto, hashnode, medium, wordpress, ghost];
