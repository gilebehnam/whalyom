---
description: "Customer segments that are stable and worth a different message"
argument-hint: "<product-slug>"
---

Dispatch the `om-segment-discoverer` agent (`.claude/agents/om-segment-discoverer.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: segments from consented first-party data, named in buyers' words.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
