---
description: "Clean the tag manager: consent-gated tags, naming, no personal data"
argument-hint: "<product-slug>"
---

Dispatch the `om-tag-governance` agent (`.claude/agents/om-tag-governance.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: tag audit and the container changes as an approval.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
