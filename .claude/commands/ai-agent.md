---
description: "Design a customer-facing AI agent: tools, knowledge, guardrails, handoff, evals"
argument-hint: "<slug> <use>"
---

Dispatch the `om-ai-agent-architect` agent (`.claude/agents/om-ai-agent-architect.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: a reviewed blueprint for the use named; nothing goes live without approval.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
