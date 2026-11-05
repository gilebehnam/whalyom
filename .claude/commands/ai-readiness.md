---
description: "How well AI agents and assistants can read and use your site"
argument-hint: "<product-slug>"
---

Dispatch the `om-agent-readiness-auditor` agent (`.claude/agents/om-agent-readiness-auditor.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: agent-readiness audit with the fixes.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
