---
description: "A checklist, template or mini-course that earns an email"
argument-hint: "<product-slug>"
---

Dispatch the `om-lead-magnet` agent (`.claude/agents/om-lead-magnet.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: one lead magnet and its capture page draft.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
