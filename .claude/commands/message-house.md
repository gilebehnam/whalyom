---
description: "One promise, three pillars, proof for each, lines for every channel"
argument-hint: "<product-slug>"
---

Dispatch the `om-message-architect` agent (`.claude/agents/om-message-architect.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: the message house from profile.md and claims.md; every line has proof.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
