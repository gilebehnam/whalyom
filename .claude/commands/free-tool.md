---
description: "A small free tool (calculator, checker) that earns links and leads"
argument-hint: "<product-slug>"
---

Dispatch the `om-free-tool-builder` agent (`.claude/agents/om-free-tool-builder.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: a free tool spec and build that answers a real buyer question.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
