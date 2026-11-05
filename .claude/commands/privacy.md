---
description: "The data map, consent setup and privacy notice check"
argument-hint: "<product-slug>"
---

Dispatch the `om-privacy-officer` agent (`.claude/agents/om-privacy-officer.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: data map, lawful basis and gaps; legal text goes to the owner and a lawyer.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
