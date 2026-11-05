# Installing Whalyom on a website

One command generates the install package for the site's stack, with copy-paste steps:

```
node tools/attach.mjs <domain|slug> --stack <stack>[,<stack>]     # or --stack auto / --stack all
node tools/attach.mjs <slug> --satellite https://example.test       # tell the hub where the endpoint is
node tools/attach.mjs <slug> --verify https://example.test          # check it, record it in state/live-sites.json
```

Packages are written to `sites/<slug>/<stack>/` (gitignored) and each has an `INSTALL.md`. **No package contains the secret.** Wherever a secret is needed you see `__WHALYOM_SECRET__` or a prompt for it: use the value of `OM_SAT_SECRET_<SLUG>` from the hub's local `.env`. The legacy one-file installer `sites/<slug>/install-satellite.sh` still embeds the secret (for backwards compatibility). Add `--no-embed-secret` to keep it out.

When a repo is linked (`--repo`), the stack is detected (WordPress files, `next`, `wrangler.toml`, `netlify.toml`, `Dockerfile`, Shopify theme, static generators) and that package is generated automatically.

## Stacks

| `--stack` | For | What you get | Hub API prefix | Writes |
|---|---|---|---|---|
| `node` | Any Linux/VPS with Node 18+ | `install-satellite.sh` (checksum-verified, hardened systemd unit, safe to re-run, `--uninstall [--purge]`, `--status`), nginx + Caddy snippets | `/_whalyom` | with `--allow-writes` |
| `docker` | Docker / compose hosts | `Dockerfile` (checksum check, non-root), `docker-compose.yml` (site mounted read-only, `cap_drop: ALL`, read-only FS, port bound to 127.0.0.1), `.env.example` | `/_whalyom` | with `WHALYOM_ALLOW_WRITES=1` and a writable mount |
| `wordpress` | WordPress 6.3+ / PHP 7.4+ | `whalyom.zip` plugin: tracker, signed REST `whalyom/v1/{health,events}`, public `collect`, settings page, uninstall cleanup | `/wp-json/whalyom/v1` | never (read-only) |
| `nextjs` | Next.js App Router on Vercel or Node | `app/api/whalyom/[op]/route.js`, `lib/whalyom-core.mjs`, `public/whalyom.js`, `<Script>` helper | `/api/whalyom` | never |
| `netlify` | Netlify | edge function folder `netlify/edge-functions/whalyom/` | `/_whalyom` | never |
| `cloudflare` | Any site proxied by Cloudflare | Worker + `wrangler.toml` (KV, or D1 placeholder), routes only `/whalyom.js`, `/collect`, `/_whalyom/*` | `/_whalyom` | never |
| `snippet` | Shopify, Wix, Webflow, Squarespace, Framer, plain HTML | `embed.html` (script tag), `inline.html` (no external script), `whalyom.js` | needs a collector | n/a |
| `gtm` | Google Tag Manager | Custom HTML tag + conversion tag | needs a collector | n/a |

`snippet` and `gtm` only add the tracker to pages; events go to a collector (`--endpoint <url>`, default the site's own domain): a satellite (`node`/`docker`) or the Cloudflare Worker. Serverless stores: Next.js/Netlify use Upstash Redis / Vercel KV over REST (`KV_REST_API_URL`, `KV_REST_API_TOKEN`). Without them they keep events in memory only, which is fine for a test but loses data on every cold start.

## Tracking

`/whalyom.js` is first-party and **cookieless**: no cookies and no visitor id. UTMs are kept in `sessionStorage` for the visit only. It sends:

- `pageview` (also on SPA navigation), `scroll` (25/50/75/90 %), `cta` (`data-whalyom-cta` or class `cta`), `outbound` (host only), `form_submit` (form id only, no values), `vitals` (LCP, CLS, INP, once per page), `conversion` via `whalyom.conversion(49)`.
- `lead` from `<form data-whalyom-lead="trial">`. A hidden honeypot field is injected. Submits under 1.5 s are flagged `bot_hint`.
- UTMs: `utm_source/medium/campaign/term/content`. A `gclid`/`fbclid`/`msclkid` sets the source when no UTM is present. Referrers are cut to origin + path, and same-site referrers are dropped.

Privacy:

- Do Not Track and Global Privacy Control turn automatic events off.
- `data-consent="required"` (or `WHALYOM_CONFIG.consent`) queues events until `whalyom.consent(true)`.
- Leads are always counted, but without UTMs or referrer when the visitor opted out.
- **Personal fields** (email, name, company, phone, message) are kept only when the lead carries `consent: true`. The tracker sets it from a checked checkbox named or with an id like `consent`, `gdpr`, `agree` or `optin`; `whalyom.lead({ ..., consent: true })` sets it explicitly. Emails are validated and every field is length-capped. Password, card and other sensitive inputs are never read.

Server side (all endpoints):

- 8 KB body limit, Origin allow-list, 120 events per IP per minute, 5 leads per IP per 10 minutes.
- Honeypot leads are dropped, and repeated beacons are de-duplicated by event id.
- The Node satellite writes consented lead details to a separate `.whalyom/leads.jsonl`, served only by the signed `/_whalyom/leads`. Events and health never contain them. `sync-sites` merges them into `products/<slug>/leads.jsonl`. **That folder is not gitignored: keep lead data out of public repos.**

Configure the tag:

```html
<script defer src="https://example.test/whalyom.js" data-site="example" data-endpoint="https://example.test/collect" data-consent="required"></script>
```

## Security model

| Control | Where |
|---|---|
| HMAC-SHA256 request signature over ts, nonce, method, path+query, body; constant-time compare that never throws | all signed endpoints |
| Replay protection: ±5 min timestamp window + one-time nonce cache (v1 requests are replay-checked by signature; `--strict` refuses v1) | satellite, edge core (store-backed), WordPress (transients) |
| Response signature `x-whalyom-resp-sig` over nonce, status, body; the hub rejects mismatches | satellite, edge, WordPress |
| Body limits: 8 KB on `/collect`, `--max-body` (5 MB) on signed bodies, 413 before reading oversize bodies | satellite, edge, WordPress |
| Path traversal: resolve + root check, symlink realpath check (also for new files), null bytes, blocked list (`.env*`, `.git`, keys, `wp-config.php`, `.htaccess`, `.ssh`, `.npmrc`, `.whalyom`…) for reads and writes | satellite |
| CORS: allow-list via `--origins`; the signed API sends no CORS header | satellite, edge, WordPress |
| Rate limits: collect per IP, leads per IP, bad signatures (20 per minute, then 429 even for valid ones); `--trust-proxy` uses the last X-Forwarded-For hop (the nginx snippet overwrites it) | satellite, edge (per isolate), WordPress |
| Least privilege: systemd `ProtectSystem=strict`, `ReadWritePaths` only `.whalyom` (or the site with writes), `NoNewPrivileges`, no capabilities, runs as the site owner or a `whalyom` system user; secret in a root-only `EnvironmentFile`, not on the command line | installer |
| Supply chain: the installer and Dockerfile verify the satellite's SHA-256 before installing | installer, Docker |

## Verify

`node tools/attach.mjs <slug> --verify <url>` checks:

- the signed health check and the response signature;
- that unsigned requests are refused;
- clock skew (warn > 60 s, fail > 240 s);
- the endpoint version against the hub's;
- writes on or off, and strict mode;
- the CORS allow-list (including that an unknown origin is not reflected);
- the tracker;
- TLS (trusted, days to expiry);
- `robots.txt`, a sitemap and `llms.txt` on the site.

The result goes to `products/<slug>/connection.json` (`verification`) and, through `sync-sites --only <slug>`, to `state/live-sites.json`. The exit code is 1 only when a check fails.

## Limitations

- The edge variants (Worker, Next.js, Netlify) and WordPress are read-only: no file reads or `apply`. Their rate limits and memory store are per isolate. KV is eventually consistent, so replay and de-dupe checks there are best effort within the timestamp window. Prefer D1 or Upstash.
- The D1 adapter is a placeholder that has not been exercised against a real D1 database.
- The WordPress plugin is tested with a PHP CLI harness that stubs WordPress functions, not on a live WordPress install.
- Shopify checkout pages run custom pixels in a sandbox: record purchases with `whalyom.conversion()` on the order status page.
- The tracker is syntax-checked and its server side is tested; it has not been exercised in a real browser by the test suite.
