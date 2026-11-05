---
description: "Support reply templates in your voice, with steps and escalation"
argument-hint: "<product-slug>"
---

Dispatch the `om-support-macro-writer` agent (`.claude/agents/om-support-macro-writer.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: macros that never promise anything outside the policy.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
