---
description: "Complementary products and agencies for co-marketing and referrals"
argument-hint: "<product-slug>"
---

Dispatch the `om-partner-scout` agent (`.claude/agents/om-partner-scout.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: partner candidates and a proposed swap for each.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
