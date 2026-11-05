# Whalyom saved workflows

Saved workflows live in `.claude/workflows/*.js`. The main session runs them with the Workflow tool (`{name: "<workflow>", args: {...}}`); subagents cannot. Each one is a deterministic multi-phase pipeline that dispatches `om-*` agents, so a run is repeatable and resumable.

## Contract every Whalyom workflow keeps

- **Single writer.** Agents write `products/<slug>/runs/<task-id>.json`; the workflow ends with `node tools/apply-results.mjs <slug>`. Agents never edit `tasks.json`, `approvals.json` or `experiments.json`. The one exception is the `merge reviews` step at the end, which sets `compliance` and `review_notes` on that run's pending approvals while nothing else runs.
- **Nothing outbound.** Drafts go to `outbox/` (and `content/`, `sales/`, `research/`); every publish, send, spend or price action becomes an approval entry in the run file. The workflows never run `tools/execute.mjs`, so nothing is published, sent or paid for until the owner approves (`/om approve`, the dashboard, or the next autopilot run under the product's autonomy level).
- **Budget.** A `Context` step reads `product.json`. Free mode proposes no paid spend. The paid workflows stop in free mode, clamp daily and monthly amounts to the caps in script code (not just in the prompt), and never raise a cap. A paused product (`stage: "paused"`) does nothing.
- **Adversarial review.** Quality-critical drafts go through `om-editor`, `om-compliance-guard` and `om-red-team` in parallel, each told to look for problems. A `block` triggers one repair round by the producing agent and a second review; anything still blocked has its approvals marked `compliance: block`. Review verdicts are written to `reports/review-<PFX>-<code>-<agent>.md`.
- **Task ids.** Each workflow has a prefix (`LCH`, `SEO`, `AEO`, …) plus the date from `args.now`, so a run's files and approvals are easy to find and two workflows never collide.
- **Report.** The last phase applies results, merges review verdicts into approvals, rebuilds `state/`, and `om-reporter` writes `reports/<workflow>-<date>.md`. Run `/om sync` afterwards to update the dashboard.
- **Resume-safe.** No `Date.now()`, `Math.random()` or `new Date()`; pass the time in `args.now` (ISO string).
- **Fallback.** If an agent type is not registered in the session, the workflow runs `general-purpose` with `.claude/agents/<name>.md` as its instructions.

## The workflows

Every workflow takes `slug` and `now`, except `om-self-heal` (`slug` optional) and `om-knowledge-refresh`, `om-evolve` and `om-product-evolution` (no slug). Optional args are listed after them.

| Workflow | What it does | Extra args |
|---|---|---|
| `om-onboard` | First run: research, profile, claims, ICP, 30-day plan | `domain?` |
| `om-autopilot` | The mega-agent cycle: health, plan, waves with evaluation, review, learn, report | `maxWaves?`, `perWave?` |
| `om-portfolio` | `om-autopilot` for every active product | `maxWaves?`, `perWave?` |
| `om-launch` | T-14 → T+7 launch on Product Hunt, HN, Reddit, newsletters, launch sites, X, LinkedIn: readiness gate, per-platform drafts with review, launch-day runbook, consented launch email, follow-up and experiments | `launchDate?`, `platforms?` |
| `om-seo-sprint` | Keywords, SERPs and cannibalization check → one cluster → briefs → articles (writer, review, JSON-LD) → internal links → publish approvals, indexing plan, rank tracking | `articles?` (4, max 10), `cluster?` |
| `om-aeo` | AI-answer baseline for buyer questions → citable passages and snippets → llms.txt and JSON-LD → entity, lists and review-site work → review → re-check protocol (or delta vs the last baseline) | `questions?` (20), `recheck?` |
| `om-content-engine` | One pillar (given or written and reviewed) → about 20 channel-native assets, each compliance-checked → batch editor/red-team/brand review → UTMs and calendar | `pillar?`, `topic?`, `assets?` (20, max 30) |
| `om-paid-sniper` | Micro budgets (sniper mode in `budget.mjs`, cap ≤ 100 by default): one channel, hooks and variants, campaign spec with one spend approval, ad-to-page match, kill rules and killswitch dry run, review, reinvestment plan | `channel?` |
| `om-paid-portfolio` | Larger budgets: tracking readiness gate, account audit, attribution, split with 10–20% exploration (scaled down in code if over budget), per-channel build and review, CPA kill rules, retargeting | `channels?` |
| `om-lead-to-sale` | Unanswered inbound leads → enrichment from public business sources → speed-to-lead reply → SDR next step → follow-ups (consented leads only) → checkout link within deal-desk rules → review. No leads: templates and pipeline stages | `max?` (10) |
| `om-free-growth` | Zero budget: funnel and free plan (`tools/funnel.mjs`, `tools/free-engine.mjs`) → leak fixes (missing capture, unanswered leads, routing) → each free channel's weekly quota with tracked links, each reviewed for claims and platform rules → review | `hours?` (owner hours this week; default `free.hours_per_week` or 6), `max_channels?` (6) |
| `om-lifecycle` | Journey map, cohorts and KPIs → onboarding, activation, trial, upgrade, churn, win-back, expansion, advocacy sequences with review → deliverability and SMS/push consent → experiments | `stages?` |
| `om-cro-loop` | Friction finder, funnel and forms → ranked hypotheses, each attacked by three judges (killed on two refutations) → bandit test, built variants, review → verdicts from real metrics only → learnings | `tests?` (3, max 6) |
| `om-competitor-watch` | Weekly diff of competitor sites (`node tools/competitor-watch.mjs <slug>` writes the polite-crawl snapshots and `research/competitor-diff.json` / `.md`), pricing, ads and reviews → battlecards checked for fairness and sources → counter-moves, new tasks, comparison pages → review | `max?` (5) |
| `om-landing` | Message, offer and conversion brief → headlines and copy → build with `tools/landing-builder.mjs` when present, otherwise hand-written HTML → QA (links, speed, schema, trust) and fixes → review → per-source variants and a bandit test | `page?`, `goal?`, `audience?`, `variants?` (2, max 4) |
| `om-localize` | Next markets (or given ones) → URL and hreflang structure → per market: local keywords, translation, adaptation, native and legal review → local communities and campaign drafts inside the existing caps | `markets?`, `max?` (2, max 4) |
| `om-weekly-retro` | Metrics, budget, learn and killswitch scripts → anomalies whose causes must survive a red-team refutation → retro, cost, forecast → verdicts and learnings → next-week tasks drafted, attacked, then committed → Monday brief | `maxAnomalies?` (5) |
| `om-self-heal` | Ops doctor per workspace → self-debug → bug hunter fix with a test → red team checks no guard was loosened (halts if it was) → repeat until clean → `npm test` → proposals for recurring causes | `slug?`, `maxRounds?` (3) |
| `om-knowledge-refresh` | Fetch feeds → topic batches → watchers/scouts extract dated facts → fact verifier tries to reject each against its source → merge, re-check stale facts → briefs and `om-knowledge-*` skills → skill smith proposes agent rules → red team → `tools/evolve.mjs apply` and tests → alerts for affected products | `maxItems?` (60), `maxProposals?` (10); no slug |
| `om-evolve` | Evolution director picks weakest agents → golden-set benchmark → one proposal each → re-benchmark with it → red team and skill auditor → ship measured gains, tests or rollback | `maxAgents?` (10); no slug |
| `om-mega-sweep` | Context and briefs → the department-head mega agents in parallel → revenue mega agent names the constraint → red team on the plan, compliance guard on drafts | `depts?` (all 22) |
| `om-product-evolution` | Whalyom improving itself: Measure (agent outcome credit, product scorecard and backlog) → Compete (competitor feature matrix) → Prioritize (product manager specs the top buildable items, owner requests) → Build (each item with a test; red team checks no guard was loosened) → Verify (full suite, re-measure) → Report | `maxItems?` (3, max 5), `compete?` (true); no slug |

## Running one

From the main session:

```
Workflow({ name: "om-seo-sprint", args: { slug: "my-product", now: "2026-11-03T09:00:00Z", articles: 4 } })
```

Then `/om sync`, and show the owner what waits in `approvals.json`. Through the skills: `/om flow <workflow> <slug> [key=value …]` or `/whalyom flow …` (see `.claude/skills/om/SKILL.md`).

Live mode note: workflows report to this session only when they finish, so the live control room is pushed at the start and end of a workflow run (as with `om-autopilot`).

## Suggested cadence

- Daily: `om-portfolio` (scheduled), `om-lead-to-sale` when leads arrive.
- Weekly: `om-weekly-retro`, `om-competitor-watch`, `om-cro-loop` (closes running tests), `om-self-heal`, then `om-knowledge-refresh` and `om-evolve`; `om-free-growth` per product in free mode.
- Weekly on Fridays: `om-product-evolution` (local scheduled task "Whalyom: weekly product evolution").
- Monthly per active product: `om-mega-sweep`.
- Per campaign: `om-launch`, `om-landing`, `om-content-engine`, `om-seo-sprint`, `om-aeo`, `om-lifecycle`, `om-localize`.
- Paid: `om-paid-sniper` or `om-paid-portfolio`, after the owner sets a budget with `/whalyom inject-budget`. Each one tells you to run the other when the budget size calls for it.

## Tests

`node --test tools/test/workflows.test.mjs` (also part of `npm test`) checks every workflow file without spawning agents: the meta literal is pure and names the file, the script compiles, `phase()` calls match `meta.phases`, every `om-*` name is an agent in `.claude/agents/`, there is no clock or randomness, Whalyom workflows keep the contract above, and three dry runs with schema-shaped fake data (free, sniper and portfolio budgets) finish using only existing agent types and declared phases.

## Adding a workflow

Copy the shared helper block (between `// ── shared helpers` and `// ── end shared helpers` in `om-launch.js`), give the workflow a prefix, keep `Context` first and `Report` last, use only agents that exist in `.claude/agents/`, and run the test above.
