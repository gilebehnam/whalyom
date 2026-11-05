// Prints the one line a site owner pastes into any website to start Whalyom on it.
//   node tools/install-snippet.mjs [--url https://edge.example.com] [--consent required]
// Creates the hub's install key (OM_INSTALL_KEY in the local .env) on first use. The key is public
// by design (it sits in every page's HTML): it only lets a site send events and read its approved
// boosters; new domains are onboarded within OM_EDGE_DOMAINS / OM_EDGE_MAX_NEW_SITES, and nothing
// is ever published, sent or spent without the owner's approval.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, root } from './lib/env.mjs';

loadEnv();
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(`--${k}`); return i > -1 ? args[i + 1] : undefined; };

export function ensureInstallKey(envFile = path.join(root, '.env')) {
  if (process.env.OM_INSTALL_KEY && process.env.OM_INSTALL_KEY.length >= 16) return process.env.OM_INSTALL_KEY;
  const key = `wy_${crypto.randomBytes(12).toString('hex')}`;
  const lines = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('OM_INSTALL_KEY=')) : [];
  lines.push(`OM_INSTALL_KEY=${key}`);
  fs.writeFileSync(envFile, lines.filter((l, i) => l || i < lines.length - 1).join('\n') + '\n');
  process.env.OM_INSTALL_KEY = key;
  return key;
}

export function snippet(edgeUrl, key, { consent } = {}) {
  const base = String(edgeUrl).replace(/\/$/, '');
  return `<script src="${base}/whalyom.js" data-site="${key}" data-endpoint="${base}/collect"${consent ? ` data-consent="${consent}"` : ''} async></script>`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const key = ensureInstallKey();
  const url = opt('url') ?? process.env.OM_EDGE_URL;
  if (!url) {
    console.log(`Install key ready (OM_INSTALL_KEY in .env). Set OM_EDGE_URL to the public HTTPS address of your Whalyom edge (Docker image, VPS or a tunnel to \`node tools/cloud/edge.mjs\`), then run this again to get the snippet.`);
    process.exit(0);
  }
  const line = snippet(url, key, { consent: opt('consent') });
  console.log(`Paste this line before </head> on every page of the site (or in Shopify theme.liquid, Wix/Squarespace custom code, Webflow head code, WordPress header, or a Google Tag Manager Custom HTML tag):\n\n${line}\n\nWithin seconds of the first visit Whalyom creates the site's workspace, runs the instant audit and drafts the first boosters for your approval. In the EU/UK, add data-consent="required" and call whalyom.consent(true) from your cookie banner.`);
}
