---
description: "Instant marketing audit of a site: SEO, AI search, speed, conversion and trust"
argument-hint: "<domain or slug>"
---

If the argument is a domain without a workspace, run `node tools/instant-onboard.mjs $ARGUMENTS` for the instant audit.

If it is a slug, dispatch om-site-crawler, om-tech-seo, om-geo-optimizer and om-cro in one message, each writing to `products/<slug>/research/`.

Report the ten fixes with the biggest expected effect first, each with the file or page it touches.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
