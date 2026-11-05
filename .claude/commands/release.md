---
description: "Tier a release and plan what each tier gets across channels"
argument-hint: "<slug> <change>"
---

Dispatch the `om-release-marketer` agent (`.claude/agents/om-release-marketer.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: tier the change the owner described and draft what that tier gets; sends are approvals.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
