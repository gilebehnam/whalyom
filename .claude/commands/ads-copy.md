---
description: "Ad variants per angle for one platform, with image and video briefs"
argument-hint: "<slug> <platform>"
---

Dispatch the `om-ad-creative` agent (`.claude/agents/om-ad-creative.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: ad variants inside the platform limits, every claim from claims.md.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
