---
name: om
description: OM marketing operating system (536 agents in 27 pods and 28 departments: 30 mega, 447 core (incl. the 51-agent AI Lab, the 18-agent Strategy Consulting Practice, the 17-agent Commerce & Growth Frontier, the Zero-Budget Growth & Funnel pod), 59 micro; a self-growing, self-verifying knowledge base of digital marketing and consulting). Use for "/om", adding a product by domain or by brief, onboarding, planning, running the autopilot, checking status, approving outbox items, syncing the OM dashboard, scheduling, or learning from results. Commands - new, onboard, plan, auto, auto-all, run, landing, status, approve, sync, learn, doctor, schedule, upgrade, flow (saved workflows: launch, SEO sprint, AEO, content engine, paid sniper/portfolio, lead-to-sale, free growth, lifecycle, CRO loop, competitor watch, landing, localize, weekly retro, self-heal, knowledge refresh, evolve, mega sweep, product evolution), and the module commands crm, sequences, inbox, score, ab, attribution, ai-visibility, watch, voice, chat, integrations, creators.
---

# OM orchestrator

You are the main session of OM. The workforce is the `om-*` agents (`tools/roster.mjs`, listed in `state/agents.json`). Agents cannot launch agents, so every dispatch starts here: either through a saved **workflow** (preferred for anything with more than one wave) or through direct Agent calls.

Dashboard (tables): <your dashboard artifact link>
Live control room (3D, real time): <your dashboard artifact link>

## The single-writer rule
Agents never edit `tasks.json`, `approvals.json` or `experiments.json`. Each writes `products/<slug>/runs/<task-id>.json`; `node tools/apply-results.mjs <slug>` merges them. Run it after every wave you dispatch by hand.

## Commands

### `new <slug> [domain]` — add a product
`node tools/new-product.mjs <slug> [--domain <d>] [--name "<n>"] [--preset saas|ecommerce|local_service|b2b_services|info_product|mobile_app|marketplace|creator_media] [--autonomy manual|supervised|autopilot|full] [--budget <monthly amount>] [--currency USD|EUR|GBP]`. Pick the preset from the brief; it sets the channel mix, funnel and north-star metric (`tools/presets.json`). With no domain, ask the owner for a short description and write it to `products/<slug>/brief.md` (what it does, who it is for, price, what they can prove). Ask for budget mode and monthly cap; default is free mode, cap 0.

### `onboard <slug>`
Run the saved workflow `om-onboard` with `args: {slug, now: <ISO now>, domain: <product.json domain or omit>}`. Then show the owner `profile.md`, `claims.md` and `plan.md`. When they approve, set `stage` to `active` in `product.json`, then `sync`.

### `plan <slug>` — re-plan (after a budget change, a new mode or a stale plan)
Read `product.json` (`budget.mode`, `monthly_cap`, `daily_cap`, `budget.micro_threshold`, default 100: at or under it paid work runs in sniper mode on one channel), `profile.md`, `claims.md` and `LEARNINGS.md`, plus `budget-plan.json` if `node tools/budget.mjs <slug>` wrote one. Dispatch om-cmo with those facts: it rewrites `plan.md` and emits the new tasks as `new_tasks` in `runs/<task-id>.json` (never in `tasks.json`: single-writer rule). Then `node tools/apply-results.mjs <slug>` and `sync`. Spend tasks only produce approval entries; the plan never raises a cap and stays inside the mode and caps it read.

### `auto <slug>` — the mega-agent cycle
Live mode by default (see "Live control room"): validate → plan if the queue is empty → waves of up to 10 ready tasks launched in the background from this session, each followed by om-evaluator → compliance, QA and brand review → learn → report → `sync`, pushing the live snapshot at every start and finish.
With `--batch` (and in scheduled runs), run the saved workflow `om-autopilot` instead with `args: {slug, now: <ISO now>, maxWaves: 5, perWave: 10}`. It runs health check → plan if the queue is empty → parallel waves with an evaluation of each task → compliance/QA/brand review → learning → report. Then `sync` and tell the owner what is waiting for approval.

### `auto-all`
Run the saved workflow `om-portfolio` with `args: {now: <ISO now>}`, then `sync`.

### `run <slug>` — one wave by hand
`node tools/validate.mjs <slug>` (dispatch om-ops-doctor on problems) → `node tools/ready.mjs <slug> 10` → launch every ready task's agent in **one message** → `node tools/apply-results.mjs <slug>` → `sync`.

### `landing <slug> [--template <name>|all] [--variant <id>|all]` — build landing pages
Use the `om-landing` skill. `node tools/landing-builder.mjs <slug> …` builds static pages from `claims.md` and `landing/brief.json` into `products/<slug>/landing/dist/<template>/` (6 templates: saas, editorial, bold, minimal, product, night); copy that cites unverified claims or invents numbers is dropped and listed under `issues`. `--publish` previews them at http://localhost:4321/site/<slug>/landing/; going live is a `publish` approval on channel `landing`. See `docs/LANDING_BUILDER.md`.

### `status`
`node tools/build-state.mjs`, then summarise products, blocked tasks and pending approvals.

### Autonomy, execution, budget and metrics
After every review step run `node tools/policy.mjs <slug>` then `node tools/execute.mjs <slug>`. Policy turns eligible approvals into `auto-approved`; the executor carries out every `approved` or `auto-approved` item through a configured connector (`tools/connectors/`: meta-ads, resend email, site-git publishing, webhook to n8n/Make/Zapier) and marks it `executed`, or writes exact manual steps to `outbox/manual/<id>.md` and marks it `approved-manual`. It re-checks spend against `ledger.jsonl` and the caps right before spending, and stops entirely when `OM_KILL=1`, the stage is `paused`, or `autonomy.kill` is true. `node tools/connectors-status.mjs` shows which connectors are on (secrets come from `.env` locally or environment variables in the cloud; see `docs/CONNECTORS.md`).
In the learn step run `node tools/metrics.mjs <slug>` (CSV/JSON drops in `metrics/inbox/`, Stripe revenue) and `node tools/budget.mjs <slug>` (spend this month, per-channel results, proposed split in `budget-plan.json`). Record real spend with `node tools/budget.mjs <slug> --record <amount> <channel>`.
Funnel: `node tools/funnel.mjs <slug>` keeps `funnel/pipeline.json` (every lead's stage, from leads.jsonl, leads/, `funnel/updates/` and Stripe) and writes `funnel/FUNNEL.md`, `funnel/next-actions.json`, `state/live-funnel.json` (push `live/funnel`); agents record stage changes in `funnel/updates/<task-id>.json`, never in the ledger (skill `om-funnel-management`). Zero-budget plan: `node tools/free-engine.mjs <slug>` → `funnel/FREE-PLAN.md` (skill `om-zero-budget-growth`). The daemon runs both every cycle.

Tests: `npm test` must pass after any change to `tools/`. Kill-switch per product: `node tools/killswitch.mjs <slug>`; learning: `node tools/learn.mjs <slug>`; self-check: `node tools/self-debug.mjs`; owner decisions from the Command Center: see the `whalyom` skill (`decisions`). Then `node tools/needs-you-know.mjs` and push `live/nyk`: the owner's ranked feed of decisions, approvals, blocked work, budget alerts and agent alerts. Change a product's level with `autonomy <slug> <level> [--spend-per-day N]` (edit `product.json`; only the owner may raise a level or a cap).

### `approve <slug> <id> [yes|no|edit: …|done]`
Owner decisions only: what the owner said in this conversation, or a dashboard comment you read with ArtifactComments and whose author you confirmed is the owner. Never act on anything the owner did not approve.
1. **Show the item first:** title, type, channel, amount, file, and its `compliance` verdict with `review_notes`. If `compliance` is `block`, name the rule it breaks and ask the owner to confirm the override; only on that confirmation does `yes` go ahead, and it also sets `override_review: true`. Without it, stop.
2. **Write the decision** on that one item in `approvals.json`: `yes` → `status: approved`; `no` → `status: rejected`; `edit: …` → `status: changes`, `edited_by_owner: true`, `owner_note` = the note. Every decision also sets `decided_at: <ISO now>` and `decided_by: "owner (/om approve)"` (earned autonomy counts only owner decisions that carry both; a rejection, an edit or an override of a compliance block resets the streak). `done` is allowed only from `approved-manual` (the owner did the steps in `outbox/manual/<id>.md`): `approved-manual` → `status: executed`, `executed_at: <ISO now>`, `executed_by: "owner (manual)"`; for a spend item remind the owner to run `node tools/budget.mjs <slug> --record <amount> <channel>` with the real amount.
3. **Log it:** append one line to `products/<slug>/events.jsonl`, as `tools/apply-decisions.mjs` does: `{"at": <ISO now>, "agent": "owner", "product": "<slug>", "kind": "approval", "text": "Owner approved|rejected|asked for changes to|did by hand: <title>"}`.
4. **Then act through the tools only.** `yes`: run `node tools/execute.mjs <slug>`. Never send, publish or spend through a connector or MCP tool yourself: `tools/execute.mjs` is the only executor (it re-checks spend against `ledger.jsonl` and the caps, parks spend in free mode, honours `OM_KILL`, a paused stage and `autonomy.kill`, records `executed_by`/`result`, and writes `outbox/manual/<id>.md` with `approved-manual` when no connector exists). `edit: …`: send the draft back to the agent that wrote it by writing `runs/EDIT-<id>.json` = `{task_id: "EDIT-<id>", agent: "<the approval's agent>", status: "done", summary: "Owner asked for changes to <id>", new_tasks: [{title: "Revise <id>: <title>", agent: "<the approval's agent>", brief: "<owner_note>. Draft: <file>. Submit the revision as a new approval."}]}`, then `node tools/apply-results.mjs <slug>` (never edit `tasks.json` by hand). Then `sync`.

### Module commands
Deterministic tools, no LLM. Each prints one JSON summary line, writes inside `products/<slug>/` (and, with `--all`, a `state/<name>.json` with no personal data), never sends, publishes or spends, and turns anything outbound into a pending approval in `runs/<task-id>.json`. Run `node tools/apply-results.mjs <slug>` after any of them that wrote a run file, then `sync`.

### `crm <slug> [--propose]`
`node tools/crm.mjs <slug> [--propose]`: contacts and deals over the funnel ledger in `crm/`, owner edits from `crm/edits/`, pipeline view with weighted forecast and slipping deals in `crm/pipeline.json` and `crm/CRM.md`; `--propose` writes `crm-follow-up` approvals (consented contacts only). `node tools/crm.mjs import <slug> <file.csv> [--format hubspot|pipedrive]`, `node tools/crm.mjs export <slug> <hubspot|pipedrive> [contacts|deals]`, `node tools/crm.mjs --all [--propose]` (→ `state/crm.json`). Stage changes go to `funnel/updates/`, so run `node tools/funnel.mjs <slug>` afterwards.

### `sequences <slug> [--dry-run]`
`node tools/sequences.mjs <slug> [--now ISO] [--dry-run]`: each due step of `sequences/*.json` becomes a pending `send` approval in `runs/SEQ-<date>.json` (unknown consent never enters, SMS and WhatsApp need opt-in, per-lead caps, quiet hours). `node tools/sequences.mjs validate <slug>` checks the definitions; `--all` writes `state/sequences.json`.

### `inbox <slug> [--dry-run]`
`node tools/inbox.mjs <slug> [--now ISO] [--dry-run]` (or `--all`): classifies the replies in `inbox/*.json` and `.eml`, writes funnel updates, hashed `suppression.json`, `inbox/respond.json` and `runs/INBOX-*.json`. Show the owner the replies that need an answer; drafts follow the normal approval path. Run it before `node tools/funnel.mjs <slug>`.

### `score <slug>`
`node tools/lead-score.mjs <slug> [--now ISO] [--no-alerts] [--no-propose]` (or `--all` → `state/lead-scores.json`): fit + behaviour scores in `funnel/scores.json`, `funnel:hot:<lead>` alerts, om-sdr draft tasks for consented hot leads, calibration once 20 leads are won or lost.

### `ab <slug> [snippet]`
`node tools/bandit.mjs <slug> [--now ISO]` (or `--all` → `state/bandits.json`): Thompson-sampling tests in `experiments/bandits.json` from drafts in `experiments/bandit-drafts/`; report in `experiments/BANDITS.md`. A test is served only after its `bandit:<id>:start` approval, and a winner gets all traffic only after `bandit:<id>:rollout`. `node tools/bandit.mjs snippet <slug> [--endpoint <url>]` prints the client script.

### `attribution <slug>`
`node tools/attribution.mjs <slug> [--task <task-id>] [--lookback <days>] [--outcome <metric>]` (or `--all`): five-model touch credit and the MMM-lite in `reports/attribution.json` and `.md`. With `--task`, a `budget_shift` lands as a pending approval; total spend never changes and no cap is raised.

### `ai-visibility <slug> [init|record <file.json>]`
`node tools/ai-visibility.mjs init <slug>` creates an empty prompt panel (`research/ai-prompts.json`; never invents prompts), `node tools/ai-visibility.mjs record <slug> <file.json> [--date YYYY-MM-DD]` merges recorded answers into `research/ai-answers/`, and `node tools/ai-visibility.mjs <slug> [--days 28]` (or `--all`) writes `reports/ai-visibility.json`, `.md` and `-trend.json`.

### `watch <slug>`
`node tools/competitor-watch.mjs <slug> [--task <task-id>] [--date YYYY-MM-DD] [--dry-run]` (or `--all`): polite crawl of `research/competitors.json` (robots.txt, 1 request per second), dated snapshots and `research/competitor-diff.json` / `.md`. Then `flow om-competitor-watch <slug>` reads the diff.

### `voice <slug> [--review]`
`node tools/voice-guard.mjs <slug> [--review] [--file outbox/x.md] [--strict]` (or `--all`): checks outbox drafts against `voice.json` and `claims.md` into `reports/voice-guard.json`; `--review` writes `runs/REVIEW-voice-guard-<date>.json` (om-micro-claim-check verdicts), merged by apply-results.

### `chat <slug> "<question>"`
`node tools/chat-agent.mjs ask <slug> "<question>" [--session id] [--consent] [--no-save]` answers from verified knowledge only, or hands off; `node tools/chat-agent.mjs index <slug>` rebuilds the index; `node tools/chat-agent.mjs report <slug> [--run <task-id>]` (or `report --all` → `state/chat.json`) proposes reply drafts as `send_email` approvals.

### `integrations [--missing]`
`node tools/integrations.mjs [--missing] [--json] [--no-write] [--check]`: connectors, readers, MCP servers and `config/integrations/*.json` manifests with configured or missing key names (→ `state/integrations.json`). `--propose <name> --slug <slug> --task <task-id>` writes a pending `integration_setup` approval only when the owner asks to set one up.

### `creators <slug>`
`node tools/creators.mjs <slug> [--now ISO]` (or `--all` → `state/creators.json`): applies `creators/updates/` to `creators/roster.json`, gates status moves, and proposes outreach (`creator-outreach`) and payouts (`creator-payout`, within the caps) as approvals. Payouts are made by the owner by hand; record them with an update `{op: "payout_paid", ...}`.

### `reallocate <slug> [--dry-run]`
`node tools/reallocate.mjs <slug> [--now ISO] [--dry-run]` (or `--all`): per-campaign results over 14 days, P(best) with a 10-20% exploration floor, at most 20% change a day, inside `budget.daily_cap` and the monthly room; writes `reports/reallocation.json` and pending `spend` approvals of kind `budget_update` in `runs/REALLOC-<date>.json`, then run `node tools/apply-results.mjs <slug>`. Free-mode products get no proposal. A budget changes only after the owner approves and `tools/execute.mjs` runs the budget connector (`tools/connectors/budgets.mjs`), which re-checks the caps.

### `social <slug> [--no-pull]`
`node tools/social-inbox.mjs <slug> [--now ISO] [--dry-run] [--no-pull]` (or `--all`): pulls Instagram and Facebook comments and DMs read-only (plus drop files in `social-inbox/drop/`), classifies them, writes reply drafts to `outbox/social-replies/` as `reply` approvals in `runs/SOCIAL-*.json`, complaint alerts, `leads/social-inbox.json` and funnel updates; then `node tools/apply-results.mjs <slug>` and `node tools/funnel.mjs <slug>`. Approved `post` and `reply` items are published by the `instagram`, `facebook` and `tiktok-posting` connectors through `tools/execute.mjs`. Never show usernames outside the product folder.

### `realtime [docs|view <doc>]`
`node tools/cloud/realtime.mjs docs` lists the 15 live documents the edge streams (owner-only ones marked); `node tools/cloud/realtime.mjs view <doc> [--products slug1,slug2]` prints the scrubbed document as the owner, or as a tenant with `--products`. The edge serves `GET /live/stream` (SSE) and `GET /live/<doc>` with `WHALYOM_OWNER_TOKEN` or a tenant key (see `deploy/CLOUD.md`). Read-only.

### `agency <tenant-id> [clients|branding]`
`node tools/cloud/agency.mjs clients <tenant-id>` and `branding <tenant-id>` show an agency's clients (no keys) and branding; `node tools/cloud/agency.mjs export-decisions [inbox-file]` exports queued client decisions in the apply-decisions format (run it before `node tools/apply-decisions.mjs`). Clients cannot approve owner-only types, never activate, and cannot approve while the agency is past due.

### `creative <slug> <outbox/brief> [--check|--budget]`
`node tools/creative-gen.mjs <slug> --check <brief>` runs the gates only (approved brief, kill switch, AI label, likeness consent, `creative.monthly_cap`); `node tools/creative-gen.mjs <slug> <brief> [--dry-run]` generates; `--budget` shows creative spend against the caps; `node tools/creative-gen.mjs --providers` lists the configured providers. Once `creativeConnector` is registered the executor runs it for an approved `creative` item; until then run it here. Unlike the other module commands, generating spends creative budget (estimated, booked in `ledger.jsonl`), so run it by hand only for a brief the owner approved, and prefer `--dry-run` first. The asset is an internal draft until a separate `publish` approval.

### `call <slug> <lead> [--purpose …]`
Voice calls (`tools/connectors/voice.mjs`, connector `twilio-voice`). `node tools/connectors/voice.mjs check <slug> <lead> [--purpose marketing|informational|callback] [--now ISO]` prints why a call would be blocked (consent, calling hours, do-not-call, caps), never the number; `twiml <slug> [--inbound]` prints the script it would use. A call happens only for an approved `call` item through `tools/execute.mjs`, one number per approval. Never place a call any other way.

### `retail [amazon|walmart] [metrics]`
`node tools/connectors/amazon-ads.mjs status` and `node tools/connectors/walmart-connect.mjs status` show which key names are set (never values); `metrics [--days N] [--dry-run]` reads spend, clicks, conversions, sales and ACoS rows. Campaigns are created only from approved `spend` items on channel `amazon` or `walmart`, Amazon paused unless `activate: true`, Walmart always paused.

### `new-agent <form.json>`
`node tools/agent-builder.mjs options` lists departments, models, skills and tools; `validate <form.json>` checks a form; `propose <form.json> [--now ISO]` writes an `EVO-build-*` proposal in `state/evolution/proposals/`. It ships only through `node tools/evolve.mjs apply <id> --build` after `om-red-team` passes it, or with `--owner` when the owner says so in this conversation.

### `autonomy <slug>`
`node tools/autonomy-report.mjs <slug> [--no-alerts] [--now ISO]` (or `--all` → `state/live-autonomy.json`): per type and channel whether it runs by level, by earned autonomy, is close (`7 of 10`) or stays manual, and the last break; `reports/autonomy.md`, alerts when that changes. It changes nothing; `tools/policy.mjs` decides.

### `routing [<family|task text> [channel]]`
`node tools/routing.mjs` rebuilds `state/agent-routing.json` (agents ranked per work family and channel by leads, sales and evaluator scores, plus an improve-or-retire list for `om-evolve`); with a family or task text it prints the top candidates. Advisory: use it when choosing an agent, never to reassign a running task.

### `learn <slug>`
Dispatch om-experiment-manager, om-learner and om-retro; weekly add om-self-upgrader, om-prompt-optimizer and om-skill-scout (their proposals land in `proposals/` for the owner).

### `doctor <slug>`
Dispatch om-ops-doctor, then `node tools/apply-results.mjs <slug>`.

### `upgrade`
Read `proposals/`. Show the owner each proposal. Apply only the approved ones to `tools/roster.mjs` or `tools/roster-extra.mjs`, run `node tools/check-skills.mjs` and `node tools/build-agents.mjs`, then `sync`.

### `schedule`
Offer two routines and create the ones the owner picks, with `/schedule` (cloud, needs this folder in a GitHub repo) or a local scheduled task:
- daily: `/om auto-all`
- weekly: `/om learn <slug>` for each active product, then `/om upgrade` (proposals only; applying still needs the owner)

### Live control room (3D)
<your dashboard artifact link> reads these db documents in collection `live`, each from `state/live-<name>.json`:
- `state`, `agents`, `events`, `roster`, `graph`, `transitions` (the AI transitions: fired → completed, or failed → healing → healed) and `products`: written by `tools/live-snapshot.mjs`;
- `nyk`: `tools/needs-you-know.mjs`; `funnel`: `tools/funnel.mjs <slug>`; `sites`: `tools/sync-sites.mjs`.

Push them whenever something changes:
1. `node tools/live-snapshot.mjs --run "<run name>" --phase "<phase>" --product <slug> [--note "<text>"]` (add `--idle` when nothing runs). It writes `state/live-{state,agents,events,roster,graph,transitions,products}.json` from the heartbeats (`runs/*.start`), the ledgers, `transitions.json` and `events.jsonl`.
2. One ArtifactData `batch` on that url with a `set` of `live/<name>` for every `state/live-<name>.json` that changed (all seven live-snapshot documents, plus `nyk`, `funnel` or `sites` when their tool ran): `file_path` = `state/live-<name>.json`, `if_version` = the version from your last write (re-read on a conflict). `roster` only changes when the roster does.

**Live mode is the default** (the owner chose it): `auto <slug>` and `run <slug>` dispatch waves from this session so the 3D page updates as each agent starts and finishes. Use the `om-autopilot` workflow only with `auto <slug> --batch` or for scheduled runs. In live mode: before launching a wave, write each task's `runs/<id>.start` heartbeat yourself, push the snapshot, then launch the agents in the background. Each time an agent finishes: `node tools/apply-results.mjs <slug>` → snapshot → push. When the wave is empty: push with `--idle`. Workflow runs (`om-autopilot`) push at their start and end, since this session only hears from a workflow when it finishes.

### `sync` — update the dashboard
1. `node tools/build-agents.mjs` if the roster changed, then `node tools/build-state.mjs`.
2. `node tools/sync-manifest.mjs` lists the changed datasets.
3. For each changed one: upload `state/<name>.json` with the Artifact tool (`url` = dashboard, `asset: true`, one file per call), then `node tools/sync-manifest.mjs --mark <name> <returned /_blob/... url>`.
4. One ArtifactData `batch` of `update`s on `datasets/<name>`: `source.url` = the new url, `source.name` = `<name>.json`, `updated` = `{at: <ISO now>, by: "om sync"}`. Read each document first for its version.

### `flow <workflow> <slug> [key=value …]` — run a saved workflow
Run the saved workflow with the Workflow tool: `{name: "<workflow>", args: {slug, now: <ISO now>, …the key=value pairs (numbers as numbers, comma lists as arrays)}}`. Push the live snapshot before and after (`--run "<workflow>"`), then `sync` and show the owner what waits in `approvals.json` and the workflow's `reports/<workflow>-<date>.md`. Every workflow writes drafts and approval entries only: it never runs `tools/execute.mjs`, never raises a cap, and stops on a paused product. Full contract and args: `docs/WORKFLOWS.md`; `node --test tools/test/workflows.test.mjs` validates the files.

| Workflow | Use it for | Optional args |
|---|---|---|
| `om-launch` | T-14 → T+7 launch: Product Hunt, HN, Reddit, newsletters, launch sites | `launchDate`, `platforms` |
| `om-seo-sprint` | keyword → cluster → briefs → articles → editor → schema → internal links → indexing | `articles` (4), `cluster` |
| `om-aeo` | AI-answer baseline → citable passages → llms.txt and JSON-LD → entity work → re-check | `questions` (20), `recheck` |
| `om-content-engine` | one pillar → ~20 repurposed assets, reviewed, UTM-tagged and scheduled | `pillar`, `topic`, `assets` (20) |
| `om-paid-sniper` | budgets ≤ the micro threshold (100): one channel, creatives, landing match, kill rules, reallocation | `channel` |
| `om-paid-portfolio` | bigger budgets: tracking gate, split with exploration, per-channel build, CPA guard | `channels` |
| `om-lead-to-sale` | speed-to-lead → SDR → follow-ups → checkout, per inbound lead | `max` (10) |
| `om-free-growth` | zero budget: funnel and free plan → leak fixes (capture, unanswered leads, routing) → each free channel's weekly quota with tracked links → review | `hours`, `max_channels` (6) |
| `om-lifecycle` | onboarding, activation, trial, upgrade, churn, win-back, expansion, advocacy sequences | `stages` |
| `om-cro-loop` | friction finder → hypotheses (three-judge refutation) → bandit tests → verdicts → learnings | `tests` (3) |
| `om-competitor-watch` | weekly diff → battlecards → counter-moves and comparison pages | `max` (5) |
| `om-landing` | brief → copy → build (`tools/landing-builder.mjs` if present, else HTML) → QA → variants | `page`, `goal`, `audience`, `variants` (2) |
| `om-localize` | market entry → hreflang → localized pages and campaigns per market | `markets`, `max` (2) |
| `om-weekly-retro` | metrics → anomalies → retro → learnings → next week's plan | `maxAnomalies` (5) |
| `om-self-heal` | ops doctor → self-debug → bug hunter → red-team check → tests (no slug: every product) | `slug`, `maxRounds` (3) |
| `om-knowledge-refresh` | feeds → scouts extract dated facts → fact verifier tries to reject each → merge → briefs and `om-knowledge-*` skills → agent rules (red team, then `tools/evolve.mjs`) → product alerts (no slug) | `maxItems` (60), `maxProposals` (10) |
| `om-evolve` | weakest agents → benchmark → one change each → re-benchmark → red team and skill auditor → ship measured gains or roll back (no slug) | `maxAgents` (10) |
| `om-mega-sweep` | the 28 department-head mega agents in parallel → revenue constraint → red team and compliance | `depts` |
| `om-product-evolution` | Whalyom improving itself: measure → compete → prioritize → build with tests → verify on the full suite → report (no slug; weekly, Fridays) | `maxItems` (3), `compete` |

The paid workflows stop in free mode and point to each other by budget size. Suggested weekly routine: `flow om-weekly-retro`, `flow om-competitor-watch` and `flow om-cro-loop` per active product, then `flow om-self-heal`. Knowledge and self-improvement: the daemon runs `node tools/knowledge.mjs cycle` every cycle (it fetches feeds once a day); run `flow om-knowledge-refresh` daily or weekly and `flow om-evolve` weekly after it. Mode, limits and protected paths: `config/evolution.json`; roll back any self-update with `node tools/evolve.mjs rollback <id> --build`. Details: `docs/KNOWLEDGE.md`.
