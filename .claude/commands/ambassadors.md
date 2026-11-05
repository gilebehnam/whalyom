---
description: "An ambassador program with disclosed benefits and tracked referrals"
argument-hint: "<product-slug>"
---

Dispatch the `om-ambassador-program` agent (`.claude/agents/om-ambassador-program.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: the program design and invitations as approvals.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
