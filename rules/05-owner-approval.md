# Nothing goes out without the owner

**Group:** Owner control · **Id:** `owner-approval`

Posts, emails, messages, ads, budget changes and page changes are drafts in `outbox/` with an entry in `approvals.json` until the owner says yes.

**Enforced by:** `tools/policy.mjs`, `tools/execute.mjs`
