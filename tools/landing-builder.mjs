#!/usr/bin/env node
// Whalyom landing page builder.
//   node tools/landing-builder.mjs <slug> [--template <name>|all] [--variant <id>|all] [--out <dir>]
//                                         [--clean] [--publish] [--task <task-id>] [--strict] [--list]
// Reads products/<slug>/{product.json, claims.md, profile.md, landing/brief.json, connection.json} and writes
// products/<slug>/landing/dist/<template>/index.html (+ <variant>/index.html, sitemap.xml, llms.txt, build.json).
//   --template  one of the templates, a comma list, or all (default: brief.page.template(s), else all)
//   --variant   build an A/B variant from brief.variants next to the control (all = every variant);
//               writes landing/variants.json for om-bandit-cro
//   --clean     leave out placeholder sections and the preview bar (for a final check, not for unverified pages)
//   --publish   copy the build into the local static site (site/<slug>/landing/), served at /site/<slug>/landing/
//   --task      also write runs/<task-id>.json (outputs, publish approvals, proposed experiments) for apply-results
//   --strict    exit 1 when the claims guard dropped any copy
// Prints one JSON line: pages, issues (copy the guard dropped and why), placeholders.
import fs from 'node:fs';
import path from 'node:path';
import { root } from './lib/env.mjs';
import { buildLanding } from './landing/build.mjs';
import { publishLanding } from './landing/publish.mjs';
import { TEMPLATES } from './landing/templates.mjs';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i > -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined; };
const flag = (k) => args.includes(k);

if (flag('--list')) {
  console.log(JSON.stringify(Object.entries(TEMPLATES).map(([name, t]) => ({ name, label: t.label, description: t.description }))));
  process.exit(0);
}
const slug = args[0];
if (!slug || slug.startsWith('--') || !/^[a-z0-9_-]+$/i.test(slug)) {
  console.error('Usage: node tools/landing-builder.mjs <slug> [--template <name>|all] [--variant <id>|all] [--out <dir>] [--clean] [--publish] [--task <id>] [--strict] [--list]');
  process.exit(2);
}
const dir = path.join(root, 'products', slug);
if (!fs.existsSync(path.join(dir, 'product.json'))) { console.error(`No product workspace at products/${slug}`); process.exit(2); }

try {
  const r = buildLanding({ dir, template: opt('--template'), variant: opt('--variant'), out: opt('--out'), clean: flag('--clean'), task: opt('--task') });
  let published = null;
  if (flag('--publish')) {
    if (opt('--out')) published = { ok: false, detail: '--publish uses the default output folder; drop --out' };
    else published = publishLanding({ dir, slug, templates: r.templates });
  }
  const summary = {
    slug, out: path.relative(root, r.out).replace(/\\/g, '/'), derived_from_claims: r.derived,
    pages: r.pages.map((p) => ({ template: p.template, variant: p.variant, file: p.file, kb: Math.round(p.bytes / 102.4) / 10, placeholders: p.placeholders, lead_mode: p.lead_mode })),
    issues: r.issues, variants_file: r.variants_file, run_file: r.run_file,
    published: published && { ok: published.ok, detail: published.detail, url: published.ok ? `http://localhost:${process.env.WHALYOM_PORT ?? 4321}/site/${slug}/landing/` : null },
  };
  console.log(JSON.stringify(summary));
  if (flag('--strict') && r.issues.length) process.exit(1);
} catch (e) {
  console.error(`landing-builder: ${e.message}`);
  process.exit(1);
}
