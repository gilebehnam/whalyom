=== Whalyom ===
Contributors: whalyom
Tags: analytics, privacy, leads, marketing
Requires at least: 6.3
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 1.1.0
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

First-party, cookieless analytics and lead capture for the Whalyom marketing hub.

== Description ==

* Tracks page views, scroll depth, CTA and outbound clicks, form submits, leads, conversions, UTMs and Core Web Vitals (LCP, CLS, INP).
* No cookies, no visitor id. Respects Do Not Track and Global Privacy Control. Optional "wait for consent" mode.
* Lead forms: add `data-whalyom-lead="trial"` to any form. A hidden honeypot field is added automatically.
* The Whalyom hub reads events through a signed REST endpoint (HMAC-SHA256, timestamp window, one-time nonce). The plugin is read-only: it never changes site files.

== Installation ==

1. Upload the zip in Plugins → Add New → Upload Plugin, then activate.
2. Settings → Whalyom: enter the site id and paste the hub secret (`OM_SAT_SECRET_<SLUG>` from the hub's `.env`).
3. On the hub: `node tools/attach.mjs <slug> --satellite https://example.test --stack wordpress`, then `node tools/attach.mjs <slug> --verify https://example.test`.

Conversions: call `whalyom.conversion(49)` on the thank-you page.

== Uninstall ==

Deleting the plugin removes its settings, its events table and its transients.
