---
description: "Local service and radius ads inside the caps, measured in calls and bookings"
argument-hint: "<product-slug>"
---

Dispatch the `om-local-ads-planner` agent (`.claude/agents/om-local-ads-planner.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: local campaigns with kill rules; spend only through approvals.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
