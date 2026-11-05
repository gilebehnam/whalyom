---
description: "Threads where the product genuinely helps, with replies that follow each subreddit's rules"
argument-hint: "<product-slug>"
---

Dispatch the `om-reddit` agent (`.claude/agents/om-reddit.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: helpful replies after reading each community's rules; posting is an approval.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
