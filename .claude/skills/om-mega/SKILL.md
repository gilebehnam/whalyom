---
name: om-mega
description: OM mega-agent. One command that takes a product from nothing to a running marketing machine - creates the workspace (from a domain or a brief), onboards it with research and a plan, runs the autopilot, syncs the dashboard and offers the daily schedule. Use for "/om-mega", "run everything", "full autopilot", or "mega agent".
---

# OM mega-agent

Runs the whole OM pipeline end to end by chaining the `om` skill's commands. Read `.claude/skills/om/SKILL.md` for each command's details.

Input: `/om-mega <slug> [domain]`, or `/om-mega` with no arguments (then run `auto-all`).

1. **Workspace.** If `products/<slug>/` doesn't exist, do `om new` (domain if given; otherwise ask for a short brief, the budget mode and the monthly cap, in one question).
2. **Onboard** if `product.json` stage is `onboarding`: run the `om-onboard` workflow. Show `profile.md`, `claims.md` and `plan.md` to the owner and wait for their approval before setting the stage to `active`. This is the only stop in the pipeline.
3. **Autopilot:** `om auto <slug>` in live mode (the owner's default, so the 3D control room updates as each agent starts and finishes). Use `om auto <slug> --batch` (the `om-autopilot` workflow) only when the owner asks for it or in a scheduled run.
   Then **policy and execute:** run `node tools/policy.mjs <slug>` then `node tools/execute.mjs <slug>`. Policy auto-approves only what the product's autonomy level allows; everything else stays pending for the owner. The executor re-checks spend against `ledger.jsonl` and the caps, and stops on `OM_KILL=1`, a paused stage or `autonomy.kill`. This is not an owner stop.
4. **Sync** the dashboard.
5. **Report** in five lines: tasks done, blocked, items waiting for approval (with the dashboard link), the next run's focus, and spend against the cap.
6. **Schedule:** if no OM routine exists yet, offer the daily `/om auto-all` routine (the `om schedule` command).

Rules that never change: nothing is published, sent or paid for without the owner's approval; spend never goes over the caps in `product.json`; only claims marked verified are used.

## Focused workflows after the first cycle

After step 5, suggest the one or two saved workflows that fit the plan best (run them with `om flow <workflow> <slug>`; contract and args in `docs/WORKFLOWS.md`):
- launching soon → `om-launch`; no landing page for the main offer → `om-landing`
- organic growth in the plan → `om-seo-sprint`, `om-aeo`, `om-content-engine`
- paid or hybrid mode → `om-paid-sniper` (cap ≤ 100) or `om-paid-portfolio`
- leads or users already exist → `om-lead-to-sale`, `om-lifecycle`, `om-cro-loop`
- new country in `product.json` market → `om-localize`
- weekly → `om-weekly-retro`, `om-competitor-watch`, `om-self-heal` (offer to add them to the weekly routine)

Each one writes drafts and approval entries only, so the owner's approval stop still applies.
