---
description: "Google Business Profile, Apple Business Connect and Bing Places complete and active"
argument-hint: "<product-slug>"
---

Dispatch the `om-gbp-manager` agent (`.claude/agents/om-gbp-manager.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: profile gaps and this week's posts; edits and replies are approvals.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
