---
description: "The ideal customer profile and two or three personas with their words"
argument-hint: "<product-slug>"
---

Dispatch the `om-icp-builder` agent (`.claude/agents/om-icp-builder.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: ICP and personas from research and real customer language.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
