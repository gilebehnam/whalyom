// Builds the per-site install package for each supported stack. Pure functions: they return
// { stack, files: { relPath: string|Buffer }, steps: [..], connection: {...} } and attach.mjs writes them
// under sites/<slug>/<stack>/. Secrets are never written into a package: every place that needs the
// site secret carries the placeholder __WHALYOM_SECRET__ and the steps say where the real value lives
// (OM_SAT_SECRET_<SLUG> in the hub's local .env). The one exception is the legacy
// sites/<slug>/install-satellite.sh, which embeds the secret unless attach runs with --no-embed-secret.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRACKER_JS, VERSION } from './whalyom-satellite.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const integ = (rel) => fs.readFileSync(path.join(root, 'integrations', rel), 'utf8');
export const SECRET_PLACEHOLDER = '__WHALYOM_SECRET__';
export const STACKS = ['node', 'docker', 'wordpress', 'nextjs', 'netlify', 'cloudflare', 'snippet', 'gtm'];
export const STACK_LABELS = {
  node: 'Linux/VPS with Node (systemd)', docker: 'Docker / docker compose', wordpress: 'WordPress plugin',
  nextjs: 'Next.js / Vercel route handler', netlify: 'Netlify edge function', cloudflare: 'Cloudflare Worker (KV or D1)',
  snippet: 'Any HTML site: Shopify, Wix, Webflow, Squarespace, Framer, static', gtm: 'Google Tag Manager (Custom HTML tag)',
};
// Signed API prefix per stack (the hub client needs it).
export const STACK_PREFIX = { node: '/_whalyom', docker: '/_whalyom', cloudflare: '/_whalyom', netlify: '/_whalyom', wordpress: '/wp-json/whalyom/v1', nextjs: '/api/whalyom', snippet: null, gtm: null };

const fill = (text, vars) => text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const wrap = (s, n = 76) => s.match(new RegExp(`.{1,${n}}`, 'g')).join('\n');

export function siteVars({ slug, domain, endpoint, secretEnv }) {
  const apex = domain.replace(/^www\./, '');
  const origins = [`https://${apex}`, `https://www.${apex}`].join(',');
  const labels = apex.split('.');
  return { SLUG: slug, DOMAIN: domain, APEX: apex, ZONE: labels.slice(-2).join('.'), ORIGINS: origins, SECRET_ENV: secretEnv, VERSION, ENDPOINT: (endpoint ?? `https://${domain}`).replace(/\/$/, '') };
}

// ---- stack detection from a linked repo -----------------------------------------------------
export function detectStack(repoDir, framework) {
  if (!repoDir || !fs.existsSync(repoDir)) return { stack: 'node', reason: 'no repo linked: assume a Linux/VPS server' };
  const has = (f) => fs.existsSync(path.join(repoDir, f));
  let pkg = {}; try { pkg = JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8')); } catch { /* none */ }
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  if (framework === 'wordpress' || has('wp-config.php') || has('wp-content') || has('wp-includes')) return { stack: 'wordpress', reason: 'WordPress files found' };
  if (deps.next || framework === 'nextjs') return { stack: 'nextjs', reason: 'next in package.json' };
  if (has('wrangler.toml') || has('wrangler.json') || has('wrangler.jsonc')) return { stack: 'cloudflare', reason: 'wrangler config found' };
  if (has('netlify.toml') || has('netlify')) return { stack: 'netlify', reason: 'netlify.toml found' };
  if (has('Dockerfile') || has('docker-compose.yml') || has('compose.yaml') || has('compose.yml')) return { stack: 'docker', reason: 'Dockerfile/compose found' };
  if (has('layout/theme.liquid') || has('config/settings_schema.json')) return { stack: 'snippet', reason: 'Shopify theme found' };
  if (has('vercel.json')) return { stack: 'snippet', reason: 'static site on Vercel' };
  if (['astro', 'gatsby', 'jekyll', 'hugo', 'static', 'vite', 'nuxt', 'sveltekit'].includes(framework)) return { stack: 'snippet', reason: `${framework} site without a server of its own` };
  return { stack: 'node', reason: 'default: Linux/VPS server with Node' };
}

// ---- installer ---------------------------------------------------------------------------------
export function satelliteSource() { return fs.readFileSync(path.join(here, 'whalyom-satellite.mjs'), 'utf8'); }
export function buildInstaller(vars, { embedSecret = '' } = {}) {
  const src = satelliteSource();
  const tpl = fs.readFileSync(path.join(here, 'install-satellite.sh.tpl'), 'utf8');
  return fill(tpl, { ...vars, SAT_SHA256: sha256(src), SATELLITE_B64: wrap(Buffer.from(src).toString('base64')), EMBEDDED_SECRET: embedSecret || SECRET_PLACEHOLDER });
}
// The satellite serves the tracker, the collector, the hub-only /_whalyom/* API and the owner-approved
// boosters (/boosters list + /whalyom-boost.js). Every reverse-proxy snippet must route all of them.
export function nginxSnippet(vars) {
  return `# Add inside the server { } block for ${vars.DOMAIN}\nlocation ~ ^/(_whalyom/|collect$|whalyom\\.js$|whalyom-boost\\.js$|boosters$) {\n  proxy_pass http://127.0.0.1:4610;\n  proxy_set_header Host $host;\n  # Overwrite (do not append) so the satellite's per-IP rate limits cannot be spoofed.\n  proxy_set_header X-Forwarded-For $remote_addr;\n  client_max_body_size 6m;\n}\n`;
}
const tag = (vars, extra = '') => `<script defer src="${vars.ENDPOINT}/whalyom.js" data-site="${vars.SLUG}"${extra}></script>`;
const leadExample = '<form data-whalyom-lead="trial"> <input type="email" name="email" required> <button>Start trial</button> </form>';

// ---- tiny zip writer (store method) for the WordPress plugin upload --------------------------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function zip(entries) {
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, content] of entries) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const nameBuf = Buffer.from(name); const crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data); centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ---- packages ------------------------------------------------------------------------------------
const builders = {
  node(v) {
    return {
      files: { 'install-satellite.sh': buildInstaller(v), 'nginx-snippet.conf': nginxSnippet(v), 'Caddyfile.snippet': `# Inside the ${v.DOMAIN} site block\n@whalyom path /_whalyom/* /collect /whalyom.js /whalyom-boost.js /boosters\nreverse_proxy @whalyom 127.0.0.1:4610 {\n  header_up X-Forwarded-For {remote_host}\n}\n` },
      steps: [
        `Copy install-satellite.sh to the server, then run: WHALYOM_SECRET='<value of ${v.SECRET_ENV} from the hub .env>' bash install-satellite.sh /var/www/${v.DOMAIN}`,
        'Re-running it updates the satellite in place (checksum-verified). Add --allow-writes to let Whalyom apply approved changes; --uninstall removes it.',
        'Add nginx-snippet.conf (or Caddyfile.snippet) to the site, reload the web server.',
        `Add to every page: ${tag({ ...v, ENDPOINT: `https://${v.DOMAIN}` })}`,
        `Connect and check: node tools/attach.mjs ${v.SLUG} --satellite https://${v.DOMAIN} --verify https://${v.DOMAIN}`,
      ],
      connection: { stack: 'node', prefix: '/_whalyom' },
    };
  },
  docker(v) {
    const src = satelliteSource();
    return {
      files: {
        'whalyom-satellite.mjs': src,
        Dockerfile: `# Whalyom Satellite ${VERSION} for ${v.DOMAIN}\nFROM node:22-alpine\nWORKDIR /app\nCOPY whalyom-satellite.mjs ./\nRUN echo "${sha256(src)}  whalyom-satellite.mjs" | sha256sum -c - \\\n && mkdir -p /site/.whalyom/backups && chown -R node:node /site/.whalyom\nUSER node\nENV WHALYOM_PORT=4610 WHALYOM_HOST=0.0.0.0 WHALYOM_SITE_ROOT=/site\nEXPOSE 4610\nHEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4610/whalyom.js').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"\nCMD ["node", "whalyom-satellite.mjs", "--trust-proxy", "--strict", "--origins", "${v.ORIGINS}"]\n`,
        'docker-compose.yml': `# docker compose up -d   (put the real secret in .env next to this file; never commit it)\nservices:\n  whalyom-satellite:\n    build: .\n    restart: unless-stopped\n    env_file: .env\n    # Add WHALYOM_ALLOW_WRITES: "1" and drop ":ro" below to let Whalyom apply approved changes.\n    volumes:\n      - /var/www/${v.DOMAIN}:/site:ro\n      - whalyom-data:/site/.whalyom\n    ports:\n      - "127.0.0.1:4610:4610"\n    read_only: true\n    tmpfs: [/tmp]\n    cap_drop: [ALL]\n    security_opt: ["no-new-privileges:true"]\nvolumes:\n  whalyom-data: {}\n`,
        '.env.example': `# Copy to .env and replace the placeholder with the value of ${v.SECRET_ENV} from the hub's .env\nWHALYOM_SECRET=${SECRET_PLACEHOLDER}\n`,
        'nginx-snippet.conf': nginxSnippet(v),
        '.dockerignore': '.env\n*.md\n',
      },
      steps: [
        'Copy this folder to the server. cp .env.example .env and paste the secret (value of ' + v.SECRET_ENV + ' in the hub .env).',
        'Edit the site path in docker-compose.yml if it is not /var/www/' + v.DOMAIN + ', then: docker compose up -d --build',
        'Add nginx-snippet.conf to the site and reload the web server.',
        `Add to every page: ${tag({ ...v, ENDPOINT: `https://${v.DOMAIN}` })}`,
        `Connect and check: node tools/attach.mjs ${v.SLUG} --satellite https://${v.DOMAIN} --verify https://${v.DOMAIN}`,
      ],
      connection: { stack: 'docker', prefix: '/_whalyom' },
    };
  },
  wordpress(v) {
    const base = path.join(root, 'integrations', 'wordpress', 'whalyom');
    const entries = ['whalyom.php', 'uninstall.php', 'readme.txt', 'assets/whalyom.js'].map((f) => [`whalyom/${f}`, fs.readFileSync(path.join(base, f))]);
    const files = Object.fromEntries(entries.map(([n, c]) => [n, c]));
    files['whalyom.zip'] = zip(entries);
    return {
      files,
      steps: [
        'WordPress admin → Plugins → Add New → Upload Plugin → choose whalyom.zip → Activate.',
        `Settings → Whalyom: site id "${v.SLUG}", paste the hub secret (value of ${v.SECRET_ENV} in the hub .env), keep "Respect Do Not Track" on. Save.`,
        'Lead forms: add data-whalyom-lead="trial" to the <form> (works with most form builders via a custom attribute or HTML block).',
        `Connect and check: node tools/attach.mjs ${v.SLUG} --satellite https://${v.DOMAIN} --stack wordpress --verify https://${v.DOMAIN}`,
      ],
      connection: { stack: 'wordpress', prefix: '/wp-json/whalyom/v1' },
    };
  },
  nextjs(v) {
    return {
      files: {
        'app/api/whalyom/[op]/route.js': fill(integ('nextjs/route.js'), v),
        'lib/whalyom-core.mjs': integ('common/whalyom-core.mjs'),
        'public/whalyom.js': TRACKER_JS,
        'whalyom-script.jsx': `// In app/layout.jsx (inside <body>):\nimport Script from 'next/script';\nexport function WhalyomScript() {\n  return <Script src="/whalyom.js" data-endpoint="/api/whalyom/collect" data-site="${v.SLUG}" strategy="afterInteractive" />;\n}\n`,
        '.env.example': `WHALYOM_SECRET=${SECRET_PLACEHOLDER}\nWHALYOM_ORIGINS=${v.ORIGINS}\n# Vercel KV / Upstash Redis REST (so events persist between invocations)\nKV_REST_API_URL=\nKV_REST_API_TOKEN=\n`,
      },
      steps: [
        'Copy app/api/whalyom/[op]/route.js, lib/whalyom-core.mjs and public/whalyom.js into the Next.js project (with a src/ folder: src/app/... and fix the import path).',
        'Render <WhalyomScript /> from whalyom-script.jsx in app/layout.jsx.',
        `Vercel → Settings → Environment Variables: WHALYOM_SECRET (value of ${v.SECRET_ENV} in the hub .env), WHALYOM_ORIGINS, and KV_REST_API_URL/KV_REST_API_TOKEN (Vercel KV or Upstash). Redeploy.`,
        `Connect and check: node tools/attach.mjs ${v.SLUG} --satellite https://${v.DOMAIN} --stack nextjs --verify https://${v.DOMAIN}`,
      ],
      connection: { stack: 'nextjs', prefix: '/api/whalyom' },
    };
  },
  netlify(v) {
    return {
      files: {
        'netlify/edge-functions/whalyom/index.js': fill(integ('netlify/index.js'), v),
        'netlify/edge-functions/whalyom/whalyom-core.mjs': integ('common/whalyom-core.mjs'),
        'netlify/edge-functions/whalyom/tracker.mjs': `export default ${JSON.stringify(TRACKER_JS)};\n`,
        '.env.example': `WHALYOM_SECRET=${SECRET_PLACEHOLDER}\nWHALYOM_ORIGINS=${v.ORIGINS}\nKV_REST_API_URL=\nKV_REST_API_TOKEN=\n`,
      },
      steps: [
        'Copy the netlify/edge-functions/whalyom folder into the site repo and deploy.',
        `Netlify → Site configuration → Environment variables: WHALYOM_SECRET (value of ${v.SECRET_ENV} in the hub .env), WHALYOM_ORIGINS, and Upstash KV_REST_API_URL/KV_REST_API_TOKEN so events persist.`,
        `Add to every page: ${tag({ ...v, ENDPOINT: `https://${v.DOMAIN}` })}`,
        `Connect and check: node tools/attach.mjs ${v.SLUG} --satellite https://${v.DOMAIN} --stack netlify --verify https://${v.DOMAIN}`,
      ],
      connection: { stack: 'netlify', prefix: '/_whalyom' },
    };
  },
  cloudflare(v) {
    return {
      files: {
        'worker.mjs': fill(integ('cloudflare/worker.mjs'), v),
        'whalyom-core.mjs': integ('common/whalyom-core.mjs'),
        'tracker.mjs': `export default ${JSON.stringify(TRACKER_JS)};\n`,
        'wrangler.toml': fill(integ('cloudflare/wrangler.toml'), v),
      },
      steps: [
        'npx wrangler kv namespace create WHALYOM_KV, and paste the id into wrangler.toml (or bind D1 as WHALYOM_DB).',
        `npx wrangler secret put WHALYOM_SECRET, then paste the value of ${v.SECRET_ENV} from the hub .env.`,
        `npx wrangler deploy (the routes take over ${v.DOMAIN}/whalyom.js, /collect and /_whalyom/*; the rest of the site passes through).`,
        `Add to every page: ${tag({ ...v, ENDPOINT: `https://${v.DOMAIN}` })}`,
        `Connect and check: node tools/attach.mjs ${v.SLUG} --satellite https://${v.DOMAIN} --stack cloudflare --verify https://${v.DOMAIN}`,
      ],
      connection: { stack: 'cloudflare', prefix: '/_whalyom' },
    };
  },
  snippet(v) {
    const inline = `<script>window.WHALYOM_CONFIG={endpoint:${JSON.stringify(`${v.ENDPOINT}/collect`)},site:${JSON.stringify(v.SLUG)}};</script>\n<script>\n${TRACKER_JS}</script>\n`;
    return {
      files: {
        'whalyom.js': TRACKER_JS,
        'embed.html': `<!-- Whalyom: paste before </head> on every page -->\n${tag(v, ` data-endpoint="${v.ENDPOINT}/collect"`)}\n<!-- Optional: wait for consent -> add data-consent="required" and call whalyom.consent(true) from your banner. -->\n<!-- Lead form: ${leadExample} -->\n<!-- Purchase: <script>whalyom.conversion(49)</script> on the thank-you page -->\n`,
        'inline.html': `<!-- Whalyom (inline variant for builders that block external scripts) -->\n${inline}`,
      },
      steps: [
        `The snippet sends events to ${v.ENDPOINT}/collect. That collector must exist: a satellite (stack node/docker) on a server you control, or the Cloudflare Worker on a domain proxied by Cloudflare. Use --endpoint <url> to point elsewhere.`,
        'Shopify: Online Store → Themes → Edit code → layout/theme.liquid, paste embed.html before </head>. (Checkout pages: Settings → Customer events is sandboxed; use whalyom.conversion on the order status page.)',
        'Wix: Settings → Custom code → Add code, all pages, Head. Webflow: Site settings → Custom code → Head code, then publish.',
        'Squarespace: Settings → Advanced → Code injection → Header. Framer: Site settings → General → Custom code → End of <head>.',
        'Plain HTML / static generators: paste embed.html into the shared <head> template.',
        `Lead forms: add data-whalyom-lead="trial" to the form element (${leadExample}).`,
      ],
      connection: { stack: 'snippet', collector: v.ENDPOINT },
    };
  },
  gtm(v) {
    return {
      files: {
        'gtm-custom-html.html': `<script>\n  window.WHALYOM_CONFIG = { endpoint: ${JSON.stringify(`${v.ENDPOINT}/collect`)}, site: ${JSON.stringify(v.SLUG)} };\n</script>\n<script>\n${TRACKER_JS}</script>\n`,
        'gtm-conversion-tag.html': '<script>\n  // Fire on your purchase/thank-you trigger. {{Transaction Value}} is your GTM variable.\n  if (window.whalyom) window.whalyom.conversion({{Transaction Value}});\n</script>\n',
      },
      steps: [
        'GTM → Tags → New → Custom HTML: paste gtm-custom-html.html. Trigger: All Pages (Initialization or Page View). Save.',
        'Consent: the tracker is cookieless; to wait for consent anyway, set "Additional consent checks" on the tag (e.g. analytics_storage) in Consent settings.',
        'Optional: a second Custom HTML tag from gtm-conversion-tag.html on the purchase trigger.',
        `Events go to ${v.ENDPOINT}/collect: a satellite or the Cloudflare Worker must be serving that URL (see the node, docker or cloudflare stacks).`,
        'Submit and publish the container.',
      ],
      connection: { stack: 'gtm', collector: v.ENDPOINT },
    };
  },
};

export function buildPackage(stack, vars) {
  if (!builders[stack]) throw new Error(`Unknown stack "${stack}". One of: ${STACKS.join(', ')}`);
  const pkg = builders[stack](vars);
  pkg.stack = stack;
  pkg.files['INSTALL.md'] = `# Whalyom on ${vars.DOMAIN}: ${STACK_LABELS[stack]}\n\nGenerated by \`node tools/attach.mjs ${vars.SLUG} --stack ${stack}\`. Secrets are not in this folder: wherever you see \`${SECRET_PLACEHOLDER}\` or are asked for the secret, use the value of \`${vars.SECRET_ENV}\` from the hub's local \`.env\`.\n\n${pkg.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nFull guide: docs/INSTALL_ON_SITES.md\n`;
  return pkg;
}

export function writePackage(dir, pkg) {
  for (const [rel, content] of Object.entries(pkg.files)) {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
    if (rel.endsWith('.sh')) { try { fs.chmodSync(f, 0o755); } catch { /* windows */ } }
  }
  return Object.keys(pkg.files);
}
