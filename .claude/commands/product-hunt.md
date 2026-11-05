---
description: "Product Hunt launch from T-14 to T+7"
argument-hint: "<slug> [date]"
---

Dispatch the `om-producthunt` agent (`.claude/agents/om-producthunt.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: assets, tagline, maker comment and the launch-day checklist; no vote requests.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
