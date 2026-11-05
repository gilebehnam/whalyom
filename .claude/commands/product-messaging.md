---
description: "What a feature means to each buyer: problem, value, proof and words"
argument-hint: "<slug> <feature>"
---

Dispatch the `om-product-marketer` agent (`.claude/agents/om-product-marketer.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: messaging for the feature the owner named, per segment, proof from claims.md only.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
