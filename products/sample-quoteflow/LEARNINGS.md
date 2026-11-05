# Learnings

Rules learned from this product's experiments. Each rule cites the experiment ids behind it. om-learner maintains this file; every planning run reads it first.

Last updated: 2026-11-04 by om-learner (LEARN-2026-11-04). Sources: experiments.json (18 entries: 12 planned, 1 blocked, 3 retired as superseded, and none with a verdict) and the evaluator scores in tasks.json (G01 5, T39 5, G09 5, G39 5, G05 4, T41 4, G07 4, G14 4). Previous update: 2026-11-03 (LEARN-2026-11-03).

## 1. Proven rules (from experiment verdicts)

None yet. No experiment has a verdict. The product is paused. It has no domain, analytics, tracking, interview notes, payments or revenue (product.json `accounts` are all null). Do not treat any hypothesis in experiments.json as a learning until it has a verdict at its stated min_sample.

Status on 2026-11-04:
- Due at the Fri 2026-11-13 gate review: E-O20-1 (beta gate), E-O20-2 (proposal volume vs Free cap), E-O8-2 (category frame), E-O8-3 (deposit-gap pain). T20261103 records them, then T20261105 (om-learner) turns them into rules here.
- Blocked: E-O15-1 (decision 4 is open, and the hypothesis mixes three variables). E-G09-2 (payments are not live, and decision 4 is open).
- Waiting on traffic and a baseline: E-O8-1, then E-G09-1, then E-G14-1, then E-JTBD-1, in that order.
- Long window: E-O18-1 to E-O18-5, ending 2026-12-02 or 2027-01-01.
- Retired, so do not count them: E-O11-1 (merged into E-O8-1), E-O19-1 (duplicate of E-O20-2), E-O19-2 (duplicate of E-O20-1).

## 2. Working practices (from evaluator reviews and experiment reviews, not from market results)

These rules are about how to do the work. They say nothing about which messages or channels sell. Each one cites its source. Treat them as house rules until something contradicts them. Rules marked "seen 2x" have happened again since the last update.

**Experiment design**
- P1 (seen 2x). Give every experiment a min_sample, a stop_date and a verdict field when you log it, not later. On 2026-11-02 none of the 15 entries had both. On 2026-11-03 the three new entries also arrived without them. If no baseline exists yet, write "not set" and name the trigger that sets it, for example "after 7 days of traffic". (EXP-2026-11-02, EXP-2026-11-03; E-G09-1, E-G09-2, E-G14-1)
- P2. Check for an existing experiment before you add one. Three pairs duplicated each other and would have been counted twice. (E-O19-1 = E-O20-2, E-O19-2 = E-O20-1, E-O11-1 = E-O8-1)
- P3 (seen 2x). At low traffic, run one landing-page change at a time with two arms, and queue the rest. Overlapping tests on the same page leave each one underpowered. The queue is now E-O8-1, then E-G09-1 on the winner, then E-G14-1, then E-JTBD-1. (E-O8-1, E-O11-1, E-JTBD-1, E-G09-1, E-G14-1; EXP-2026-11-03)
- P4. Test one variable per arm. A hypothesis that bundles cap, trial and price cannot show which one caused the result. (E-O15-1)
- P5. Label weak designs in the verdict. Before/after is not randomized. Self-reported is not observed. "Zero removals" on a few posts proves little. (E-O18-3, E-O20-2, E-O18-2)
- P6. If a gate fails, record the experiments that depend on it as "not run", not as losses. If the gate experiment itself misses, record it as a loser and name the blocker. Do not quietly retry it. (E-O18-1, E-O20-1)
- P7a (new). A share or a rate taken from a handful of events is noise. State the minimum event count before you read a share. (E-O18-1 min_sample note; E-O8-1 "report directional only if underpowered")
- P7b (new, from the knowledge base). Do not use email opens to measure the trial-email sequence. Apple Mail Privacy Protection inflates them (K-40e9f4674d). E-O18-3 already uses activation, which is correct. Keep later email experiments on clicks, replies and proposal_sent.

**Drafting and briefs**
- P7 (seen 2x). Do not draft a page as publishable while it depends on an open owner decision. Mark it blocked and name the decision. The pricing page with an empty Pro card was blocked by brand, QA, compliance and the evaluator in both review rounds. (G05 score 4, BG-review, BG-review-2, QA-outbox, QA-outbox-2, G35-review, E-O15-1)
- P8. Landing variants should differ only in the element under test. This kept E-O8-1 clean, and the evaluator credited it. (G05, E-O8-1)
- P9. When the brief and the source file disagree, follow the source and say so. G01 listed all 16 decision lines although the brief said 13, disclosed the mismatch, and scored 5. (G01)
- P10. Read placement instructions literally. "As top items" means at the top of the table, not starred where they already sit. (T41 score 4)
- P11. The run summary must match the file. T41's summary said it created the file, but the file header credited G01, and the evaluator marked this as a provenance inconsistency. (T41)
- P12 (seen 2x). Outputs that say what they could not do score highest: the missing input, the audit still pending, the edits left for the main session. (T39 5, G01 5, G09 5, G39 5)
- P13 (new). Label assumptions and still make the call. When an owner input is missing, label every value that depends on it as an assumption or a plan rule, then give a clear recommendation and say what would reverse it. G39 had no owner answers and still scored 5 this way. Work that silently builds on a missing input, or cannot be used until that input exists, scored 4: G07 (stack assumed), G05 (Pro card empty), G14 (needs a prototype). (G39 5; G07 4, G05 4, G14 4)
- P14 (new). Hooks and framing lines are claims too. A line that implies the buyer's status quo ("Three tools...") must be checked against claims.md like any feature line. (G14 review)
- P15 (new). Check your own arithmetic and timings before you hand in. Evaluators recompute them. G39's arithmetic held in every scenario and scored 5. G14's 75-second plan held about 65 seconds of speech (150 words at 2.3 words per second), and the evaluator marked it down. (G39, G14)
- P16 (new). Cite fact ids, and flag a fact as unconfirmed when it is. G09 cited K-d61ac4930b for the UK rule, marked it unconfirmed, and scored 5 on accuracy. (G09, G07)

**Research and task hygiene**
- P17 (new). A failed fetch means "not reached", not "not found". Retry it, or use another route, before you mark a row not found. T5 marked Bonsai and Proposify as unreachable. K1 loaded all four vendor pages the same day. G03 and G04 also fell back to homepages or web search after 404s and blocks, and they labelled the fallback. (T5, K1, G03, G04)
- P18 (new). Check tasks.json for open or done work before you add a task. The cost review found about 9 open tasks that duplicate other work: four separate competitor checks (T3, T5, T44, T47 against G03), plus T2, T45, T46, T43, T6 and T1. This is P2 applied to tasks. (COST-2026-11-03, T20261104)

## 3. Not promoted to playbooks/

Nothing is promoted on 2026-11-04. A playbook rule has to hold in more than one product. The only other workspace is `_template`, which has no experiments and no reviews. `playbooks/scoreboard.json` holds only `zz-paid-*` test fixtures (ecommerce preset, identical fitness 9.838), which are not product evidence.

Most likely to generalise: P1, P2/P18, P3, P4, P13 and P17. They are about process and do not depend on this ICP. Promote them when a second real product's experiment review or evaluator scores agree.
