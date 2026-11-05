---
description: "Every lead, its stage and the next action; hot leads first"
argument-hint: "<product-slug>"
---

Run `node tools/funnel.mjs <slug>` and `node tools/lead-score.mjs <slug>`.

Show hot leads, leads waiting past the SLA and `funnel/next-actions.json`, without personal data in the summary.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
