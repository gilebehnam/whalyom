---
description: "Brief, copy, build, QA and variants of a landing page"
argument-hint: "<slug> [goal]"
---

Use the `om` skill and run `flow om-landing <slug>` (the saved workflow `.claude/workflows/om-landing.js`).

For static templates only: `node tools/landing-builder.mjs <slug> --template all`.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
