---
description: "Conferences, meetups and calls for speakers where your buyers gather"
argument-hint: "<product-slug>"
---

Dispatch the `om-events-scout` agent (`.claude/agents/om-events-scout.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: events in the target markets with dates, cost and the best way in.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
