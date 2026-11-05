# Attaching Whalyom to a product or website

Whalyom runs on **your computer** (the hub) and uses **your Claude**. Each product it markets gets two optional links, set up with one command:

```
node tools/attach.mjs example.test --repo https://github.com/you/example --satellite https://example.test
```

| Link | Where it lives | What it gives Whalyom |
|---|---|---|
| **Repo** (`--repo`) | the site's git repository, cloned into `sites/<slug>/repo` or linked from a local path | full read access to the site's code and content; approved changes become commits, and the host deploys on push |
| **Satellite** (`--satellite`) | a one-file agent on the site's server (`tools/satellite/whalyom-satellite.mjs`), or a read-only equivalent (WordPress plugin, Cloudflare Worker, Next.js route, Netlify edge function) | first-party, cookieless analytics and leads (`/whalyom.js`), file reads, and approved file changes with automatic backups (Node satellite only) |

**Other stacks** (WordPress, Docker, Next.js/Vercel, Netlify, Cloudflare, Shopify/Wix/Webflow/Squarespace/Framer snippet, Google Tag Manager): `node tools/attach.mjs <slug> --stack <stack>`. See [INSTALL_ON_SITES.md](INSTALL_ON_SITES.md). With `--repo`, the stack is detected automatically.

## How the connection works

- **Who connects to whom:** the hub connects **out** to the satellite every 5 minutes. The satellite never calls your computer, so nothing on your machine is exposed.
- **Signed requests:** every hub request is signed with a 64-character secret shared only by the hub (`.env`) and that satellite.
  - The signature covers a timestamp and a one-time nonce, so a captured request cannot be replayed.
  - The satellite signs its answers back, so the hub knows it is talking to its own satellite.
  - Satellites older than 1.1.0 are still reached through the legacy signature; `--strict` turns it off.
- **Off-limits files:** the satellite refuses `.env`, `.git`, keys, credentials, `wp-config.php`, `.htaccess`, `node_modules`, its own `.whalyom` folder, anything outside the site root and symlinks that lead out of it.
- **Writes are off until you allow them.** Start the satellite with `--allow-writes`. Each change is backed up in `.whalyom/backups` and logged in `.whalyom/audit.jsonl`.
- **Approval first:** changes only happen for approvals that passed review and that the product's autonomy level (or you) approved.
- **Leads:** personal fields (email, name, message) are stored only for leads sent with `consent: true`. They go to a separate `.whalyom/leads.jsonl` that only the signed `/_whalyom/leads` serves. `sync-sites` merges them into `products/<slug>/leads.jsonl`.

## Installing the satellite on the server

`attach` writes `sites/<slug>/install-satellite.sh`. Copy that one file to the server and run:

```
bash install-satellite.sh /var/www/example.test
```

What the installer does:

- **Checks the satellite.** It verifies the embedded satellite's SHA-256 before installing it.
- **Installs a hardened service.** The systemd service listens on port 4610 (localhost only) with `--strict --trust-proxy` and the site's origins allow-list. It runs as the site owner, with a read-only system and write access to `.whalyom` only.
- **Is safe to re-run.** Running it again updates the satellite in place.
- **Has options:**
  - `--allow-writes` lets Whalyom apply approved changes;
  - `--status` shows the service;
  - `--uninstall [--purge]` removes it.

Then add the lines from `sites/<slug>/nginx-snippet.conf` to the site's web server, and this tag to every page:

```html
<script defer src="https://example.test/whalyom.js"></script>
```

Forms tagged `data-whalyom-lead="trial"` are recorded as leads. Pages can call `whalyom.conversion(19)` after a purchase.

The installer contains the secret: keep it private. `sites/` is in `.gitignore`. Use `--no-embed-secret` to generate it without the secret and pass `WHALYOM_SECRET=...` when you run it.

## Check the installation

```
node tools/attach.mjs <slug> --verify https://example.test
```

This checks:

- the signature, response signature, clock skew and version;
- CORS and the tracker;
- TLS;
- robots.txt, the sitemap and llms.txt.

It stores the result in `connection.json` and `state/live-sites.json`.

## On your computer

- `node tools/install-hub.mjs` (done once) starts the hub at login and puts a **Whalyom** shortcut on the desktop that opens the Command Center as an app window.
- The hub keeps the Command Center live at http://localhost:4321, syncs every satellite every 5 minutes and runs the hourly cycle. The log is in `state/hub.log`.
- `node tools/install-hub.mjs --uninstall` removes the startup entry and the shortcut.
