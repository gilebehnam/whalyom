# Cost report: sample-quoteflow

Date: 2026-11-04. Owner: om-cost-optimizer. Task: COST-2026-11-04 (refresh of COST-2026-11-03).
Inputs read: tasks.json (read only), product.json, claims.md, LEARNINGS.md, reports/ops.md, reports/cost.md (previous run), knowledge/briefs/finops.md, tools/roster-extra.mjs and tools/roster-wave4.mjs (model tiers).

## 1. Spend this run

- Budget mode `free`, `monthly_cap` 0, `daily_cap` 0, `spent_this_month` 0, paid channels `[]` (product.json). Spend this run: $0. No ad or paid-tool spend is proposed.
- No cost, token or duration telemetry exists in the workspace. Effort below is counted in tasks and runs, not money. Cost per trial_started cannot be computed: there is no domain, analytics or revenue yet (LEARNINGS.md section 1).

## 2. Effort per result (live count from tasks.json)

| Item | Count |
|---|---|
| Entries with a status in tasks.json | 95 |
| Done | 44 |
| Open (todo) | 51 |
| Blocked or failed | 0 |
| Scored by a reviewer | 4 (G01 5, G05 4, T39 5, T41 4) |

ops.md (2026-11-04) reported 89 tasks, 36 done and 53 todo. The live file now shows 95, 44 and 51, so the queue has moved since that check. The figures above are the live ones.

Results so far are documents, not outcomes. The business result (trial_started, subscription_started, MRR) is still 0, because the domain, analytics and owner decisions are open (plan.md, G01, G36). Every result counted here is a planning or drafting output.

## 3. Duplicate work to cut (fewer runs)

The previous report's merge list (COST-2026-11-03) was not applied: T20261104 is still todo for om-cmo. Re-checked against the live statuses, the list changes as follows.

| Task | Status now | Duplicates | Suggested action |
|---|---|---|---|
| T2 Landing copy from message house | todo | G05 (done, outbox/landing/*) | Cancel. G09, G28 and G35 already read G05 |
| T45 Seed keyword list | todo | O12 (done, research/keywords.md) | Cancel |
| T46 Message house from idea A | todo | O11 (done, research/message-house.md) | Cancel |
| T44 Verify competitor pricing and features | todo | T3 and T5 (both done, 2026-11-03), G03 (done) | Cancel. Its brief (replace UNVERIFIED rows) is already met by T3 and T5 |
| T47 Verify competitor features, pricing, regions | todo | T3, T5, G03 (all done) | Cancel. Only the HoneyBook UK/AU availability check is not yet covered; add it as one line to a later pass if needed |
| T43 Presenting price options guide | todo | G25 (todo, same topic) | Merge into G25 |
| T1 Switch-interview script | todo | G33 (interview kit), T40 (add to interview kit) | Merge into G33 and T40 |
| T6 GA4 and Search Console setup | todo | G07 is done, but G07 is the guide, not the install | Keep. This is the install step, blocked on domain and owner accounts. Not a duplicate. (The previous report was wrong to suggest merging it.) |
| T4 SERP re-check | todo | O14 (done, research/serp.md) | Defer until a live tool or domain exists. Keep only if Bash and a search connector are available |

Net effect of the cancel and merge list: 5 cancels (T2, T45, T46, T44, T47), 2 merges (T43, T1) and 1 deferral (T4). Open tasks fall from 51 to about 43. Coverage stays the same. Competitor pages are already fetched once (T3, T5, G03); cancelling T44 and T47 avoids two more fetch sets of the same four vendor sites.

## 4. Cheaper model where quality holds

Model tiers are read from tools/roster-extra.mjs and tools/roster-wave4.mjs. Corrections to the previous report are marked.

| Task | Agent (model now) | Suggested model | Why quality holds |
|---|---|---|---|
| T42 Competitor review quotes | om-review-miner (sonnet) | haiku | Copying verbatim quotes with URL, role and date is extraction, not reasoning. Quote accuracy is checked against the source page, and compliance checks the quotes before use |
| G22 Slack and Discord groups | om-discord-slack (sonnet) | haiku | List and extraction (join method, promo channel, rules with URL and date). Verify each rule URL by hand |
| G23 Content calendar | om-content-strategist (opus) | sonnet | Calendar and briefs from keywords.md and serp.md. Keep opus for om-cmo and om-product-analyst planning and claims work |
| G08 UTM registry | om-utm-manager (already haiku) | none | Already on haiku. The previous report listed it as a change; it is no change. Keep the QA check on the pattern |

Keep the top model for judgement, compliance and fact checks: G04 community rules (om-community-scout, sonnet; wrong rules cause bans), G13 email compliance (om-deliverability, sonnet; CAN-SPAM, CASL and AU Spam Act accuracy), G27 fact-check (om-editor, sonnet; the publish gate) and G35 compliance pass (om-compliance-guard, sonnet; blocks unsafe claims).

Rule of thumb: downgrade tasks that copy, format or extract from a fixed source. Test any downgrade on one output first and have the pod reviewer score it before the rest of the batch moves.

Test design for the T42 downgrade (see experiments in the result file): compare 10 haiku quotes and 10 sonnet quotes against their source pages. Metric: share of quotes that match the source word for word, with URL, role and date present. Minimum sample 10 per arm. Stop date 2026-11-20. Decision rule: keep haiku if at least 9 of 10 match and none is invented.

Note on measurement: do not judge outputs by email open rates. Apple Mail Privacy Protection inflates opens (finops brief, K-40e9f4674d). Use the source check above, and clicks or replies for any later channel test.

## 5. Fewer runs without a quality loss (other)

- Batch G15 (directories) and G16 (launch platforms) into one run per platform group. The compliance pass (G35) then runs once over the batch.
- Run G35 once after G05, G11, G15, G17, G18 and G20 are drafted, not after each. This is already the design (G35 depends on them).
- Do not re-run G05 or the landing review G09 until the owner answers decision 4 (Pro vs Free). A re-run now only repeats the open placeholders in A3.
- Do not start paid channels to save effort. Paid stays at $0 (product.json, plan.md).

## 6. Brief changes checked (knowledge/briefs/finops.md, generated 2026-11-03)

No change to this plan. The brief's paid-search items (Microsoft Advertising PMax changes of 28 Oct 2026; Google PMax image extraction default from 4 Dec 2026; ads in AI Overviews) apply only if paid channels are switched on, and they are not. If the owner later enables paid search, the PMax image-extraction opt-out and Microsoft's claims guidelines (load claims.md rules and banned phrases before turning on AI copy) must be checked first. Refs: K-12fb55af3a, K-8530245ef4.

## 7. Open items that limit this report

- No token, cost or time data per run. Ask the session runner to log usage per task (agent, model, tokens, seconds) so cost per result can be measured.
- No live data (no domain, no analytics, no revenue). Cost per trial_started cannot be computed yet.

## 8. Recommended next step

1. om-cmo applies the cancel and merge list in section 3 (task T20261104; update it to the list above, since T3 and T5 are done). The main session applies the changes to tasks.json.
2. Run the T42 model test (section 4) on one batch before any other model change. Model changes need the owner's review of the roster.
3. Re-run this report after the Fri 2026-11-13 gate review, once runs carry a usage log.
