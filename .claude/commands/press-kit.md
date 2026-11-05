---
description: "The press kit page: boilerplate, facts, bios, logos, screenshots, contact"
argument-hint: "<product-slug>"
---

Dispatch the `om-press-kit` agent (`.claude/agents/om-press-kit.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: the press kit from claims.md and the brand assets.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
