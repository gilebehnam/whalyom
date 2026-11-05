---
description: "Creators whose audience matches yours, with outreach and deal terms"
argument-hint: "<product-slug>"
---

Dispatch the `om-influencer-scout` agent (`.claude/agents/om-influencer-scout.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: creator shortlist with fit, rates if public and disclosure terms.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
