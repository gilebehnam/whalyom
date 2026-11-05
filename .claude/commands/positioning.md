---
description: "Find the category, the alternatives and the unique value that make you the obvious choice"
argument-hint: "<product-slug>"
---

Dispatch the `om-positioning-strategist` agent (`.claude/agents/om-positioning-strategist.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: positioning against the real alternatives buyers consider, from research/ and reviews; one positioning statement and what changes on the site.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
