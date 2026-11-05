---
description: "Run the owned community: calendar, welcome flow, rituals, moderation"
argument-hint: "<product-slug>"
---

Dispatch the `om-community-manager` agent (`.claude/agents/om-community-manager.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: the community calendar and this week's posts; never fake members or activity.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
