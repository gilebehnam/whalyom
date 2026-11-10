---
name: om-martech-ops
description: "Run web and martech engineering in Whalyom: live site changes as reviewed diffs or plugin files after approval, staging first with a rollback plan, CMS operations on WordPress and Shopify, tag governance, stack audits, email HTML that renders, form to CRM integrations with consent fields, Core Web Vitals and server-side conversions with deduplication. Use for any task that touches the live site, tags, tracking, the CMS, email templates, forms, integrations or page speed."
---

# Web and martech engineering

This department changes the systems marketing runs on. The head is `om-mega-martech`. The rule that matters most: nothing changes on a live site, tag container, CRM or email platform until the owner approves the exact change.

## 1. How a change ships

1. **Diff, not edit.** Every change is a reviewed diff, a theme or plugin file, or a must-use loader file, written to `outbox/martech/changes/<id>/` with `CHANGE.md`: what changes, why, the files, the risk and the test.
2. **Staging first.** Apply on staging or a preview theme, test, and attach the evidence (screenshots, test output, a speed run).
3. **Rollback plan.** Every change names how to undo it in minutes: the previous file, the plugin to deactivate, the tag version to restore. Back up before any change.
4. **Approval.** One entry in `approvals.json` per change. After approval `tools/execute.mjs` and `tools/connectors/site-install.mjs` apply it; site-install adds files only.
5. **Verify live.** Re-run the test on production and record the result in `runs/<task-id>.json`.

## 2. CMS operations

- **WordPress:** changes through a child theme, a small plugin or a must-use plugin, never edits to core or a parent theme. Check plugin compatibility and the PHP version before adding anything. Keep a list of active plugins and why each is there.
- **Shopify:** theme changes on a duplicate theme first, app installs listed with their scopes, metafields and sections over hard-coded edits.
- Content edits (titles, meta, schema, redirects) are batched with a before and after table.

## 3. Tag governance

`om-tag-governance` keeps `research/martech/tags.json`:

- One tag manager container per site, with a naming rule (`platform - type - event`) and an owner per tag.
- Every marketing tag fires only after the consent it needs; consent defaults follow the banner and Google Consent Mode where used.
- No personal data in tags, URLs or event parameters: no emails, names or phone numbers in plain text.
- Unused and duplicate tags are removed after approval. Every container publish has a version note.

`om-micro-tag-audit` checks one page: which tags fire, before or after consent, and what they send.

## 4. Stack audit

`om-martech-stack-auditor` writes `research/martech/stack.md`: each tool, what it does, its monthly cost (from the owner), who uses it, the data it holds, and how data flows between tools. Flag overlap (two tools doing one job), tools nobody uses, data copied without a processor agreement, and gaps that block measurement. Recommendations are proposals; the owner decides.

## 5. Email HTML

`om-email-developer` builds templates in `outbox/martech/email/`: table-based layout that renders in the major clients (Gmail, Outlook, Apple Mail), inline styles, dark mode checked, alt text on every image, a plain-text part, a visible one-click unsubscribe and the sender's postal address. Test renders are attached before approval.

## 6. Forms to CRM

`om-form-integration-engineer` maps every form in `research/martech/forms.json`: fields, the CRM field each maps to, the consent field (separate, unticked, with the text and timestamp stored), the lead source and UTMs, spam protection, and the error path. Test with a test record, then delete it. A form without a stored consent record does not feed email or SMS.

## 7. Core Web Vitals

`om-page-speed` reads field data where available and lab runs otherwise, per template: LCP, INP and CLS against Google's published thresholds. Fixes are code-level (image sizes and formats, preload of the hero, deferred third-party scripts, reserved space for embeds) and ship through section 1.

## 8. Server-side conversions

`om-capi-planner` and `om-tracking-engineer` specify server-side events (Meta Conversions API, Google enhanced conversions, GA4 Measurement Protocol, TikTok Events API) in `research/martech/server-events.json`: event names, parameters, the shared event id that deduplicates browser and server events, hashed identifiers only where consent allows, and the test that checks counts match.

## Who does what

| Agent | Work |
|---|---|
| om-mega-martech | Change queue, risk review, sign-off |
| om-site-engineer | Diffs, plugin files, staging tests, rollback plans |
| om-cms-operator | WordPress and Shopify operations |
| om-tag-governance | Container, naming, consent gating |
| om-micro-tag-audit | One-page tag audit |
| om-martech-stack-auditor | Stack inventory, overlap, data flow |
| om-email-developer | Email HTML and plain-text parts |
| om-form-integration-engineer | Form to CRM mapping with consent |
| om-tracking-engineer | Analytics events, UTMs, pixels |
| om-capi-planner | Server-side events and deduplication |
| om-page-speed | Core Web Vitals fixes |

## Guardrails

- No change to a live site, container, CRM, email platform or integration without the owner's approval in `approvals.json`; `tools/execute.mjs` executes it. No credentials in files, chat or `.env` edits by agents.
- Copy on pages and emails uses only claims from `claims.md`. No invented numbers, testimonials, reviews or customer names.
- Tags respect consent; forms store consent; no personal data in tags or URLs. Paid tools and ad spend stay inside `budget.monthly_cap` and `budget.daily_cap`.
- Agents write results to `runs/<task-id>.json`, never to `tasks.json` or `approvals.json`.

## Measures

Changes shipped without rollback, failed deploys and time to roll back, tag coverage and tags firing before consent (target zero), share of conversions received server-side and deduplicated, form-to-CRM match rate, email render pass rate, Core Web Vitals per template, and stack cost per month. Each change that should move a metric is logged in `experiments.json`.
