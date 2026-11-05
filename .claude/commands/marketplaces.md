---
description: "Rank listings on Amazon, Etsy, eBay and regional marketplaces"
argument-hint: "<product-slug>"
---

Dispatch the `om-marketplace-seo` agent (`.claude/agents/om-marketplace-seo.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: listing fixes: titles, bullets, attributes, images and Q&A.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
