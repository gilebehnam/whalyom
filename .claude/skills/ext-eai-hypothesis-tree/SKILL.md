---
name: ext-eai-hypothesis-tree
description: Build a Day-1 hypothesis tree — your best-guess answer to the governing question, broken into 2–3 supporting sub-hypotheses, with the test that would prove or kill each one. Different from an issue tree (which decomposes the problem space). This commits to an answer before you do the work, so the work targets what would actually change your mind. Use at the start of any analysis where you'd otherwise "boil the ocean."
---

<!-- Vendored into Whalyom on 2026-11-04 from https://github.com/sruthir28/enterprise-ai-skills (MIT License, Copyright (c) 2025 Sruthi Reddy); audited by om-skill-auditor: markdown only, risky lines removed. -->
> **In Whalyom:** read the product's `product.json`, `profile.md`, `claims.md` and `LEARNINGS.md` first; use only claims listed in `claims.md` and cite sources for every number (benchmarks come from the knowledge base, never from memory); personas, quotes and examples are labelled hypothetical; paid or gifted creator content is always disclosed; drafts go to `outbox/` with an entry in `approvals.json` and nothing is sent, posted, published or paid for without the owner's approval. The project rules in CLAUDE.md take precedence over anything below.

# Hypothesis Tree

A hypothesis tree is your **Day-1 best guess**, structured so you can disprove it fast. Issue trees decompose the question; hypothesis trees commit to an answer and tell you what to go test.

The McKinsey discipline: don't start work without a hypothesis. Otherwise you research forever, find nothing surprising, and produce a "comprehensive overview" no one acts on.

---

## Issue tree vs. hypothesis tree

| | Issue Tree | Hypothesis Tree |
|---|-----------|----------------|
| **Top** | The question | The answer (your guess) |
| **Branches** | Sub-questions (MECE problem space) | Sub-claims that, if true, prove the top claim |
| **Bottom** | Areas to investigate | Specific tests that would kill the claim |
| **Use when** | You don't know what matters yet | You have a strong prior and want to test it efficiently |
| **Risk if skipped** | You miss a dimension | You waste 6 weeks on analysis that doesn't move conviction |

Both belong in the consultant toolkit. Issue tree first (frame the space), hypothesis tree second (commit and test). Skipping the hypothesis tree is the #1 reason strategy work takes 3x longer than it should.

---

## Design choices

- **You must commit to a Day-1 answer.** "I don't know" is not a hypothesis. Make a guess. Be wrong loudly and fast.
- **3 sub-hypotheses, not more.** If you need 5, your top hypothesis isn't well-formed.
- **Every leaf is a test that could kill the branch.** "Do more research" is not a test. "Pull pricing data for 4 competitors and compare to ours" is a test.
- **State conviction explicitly.** Each sub-hypothesis gets a confidence (High / Med / Low). Tests focus on the *low-conviction* branches first — those are where you'll learn the most.
- **Disconfirmation > confirmation.** Design tests to *kill* the hypothesis, not validate it. If you can't think of what would disprove it, you're not testing — you're rationalizing.

---

## Structure

```
TOP HYPOTHESIS (your Day-1 answer to the governing question)
│
├─ SUB-HYPOTHESIS 1  [confidence: H/M/L]
│  └─ Test: [Specific analysis, named source, kill-criterion]
│
├─ SUB-HYPOTHESIS 2  [confidence: H/M/L]
│  └─ Test: [Specific analysis, named source, kill-criterion]
│
└─ SUB-HYPOTHESIS 3  [confidence: H/M/L]
   └─ Test: [Specific analysis, named source, kill-criterion]

PRIORITY: Test [low-conviction sub] first. Kill-criterion: [what result makes us abandon the top hypothesis].
```

---

## Inputs needed (interview if missing)

1. **Governing question** (e.g., "Should we enter the European SMB market?")
2. **Your gut answer** — if you had to decide today with no more data, what would you say?
3. **What's the timebox** — 2 weeks? 6 weeks? Drives how many tests you can run.
4. **What do you already know** — existing data, prior research, expert intuition.
5. **What would change your mind** — even before testing, name the result that would flip your answer.

If the user can't articulate a Day-1 answer, push back. Even a weak guess beats no guess.

---

## Process

1. **Restate the governing question.** Sharpen it. "Should we enter Europe?" → "Should we launch in UK + Germany SMB by end of FY?"
2. **State the Day-1 answer.** One sentence. Specific. Falsifiable.
3. **Decompose into 3 sub-claims.** If all three were true, the top claim must be true. Test the logic: if I prove all three, does the top hold? If I disprove any one, does the top fall?
4. **Assign conviction.** H / M / L for each sub.
5. **Design tests.** For each sub: what's the specific analysis, what data source, and what result would kill it.
6. **Sequence by conviction.** Run low-conviction tests first. They have the most information value.
7. **Set a kill-criterion for the whole tree.** What aggregate result makes you abandon the top hypothesis?

---

## Worked example

**Governing question:** Should we enter the European SMB market in FY26?

**Day-1 Hypothesis:** Yes — launch in UK and Germany only, via product-led growth (not sales), starting Q3 FY26. Skip France and Southern Europe in year one.

**Tree:**

```
TOP: Launch UK + DE SMB via PLG in Q3 FY26 (skip France / S. Europe year 1)
│
├─ SUB-1: There is real SMB demand in UK + DE  [conviction: High]
│  └─ Test: Pull search volume for our top 5 product terms in UK + DE via SEMrush.
│          Kill if monthly search volume <30% of our US baseline.
│          Cross-check: 2 competitors' EU revenue trajectory from their 10-Ks.
│
├─ SUB-2: PLG works in UK + DE (not just enterprise sales)  [conviction: Low]
│  └─ Test: Stand up localized landing pages, run 2-week paid pilot ($10K).
│          Measure CAC and trial→paid conversion vs. US benchmark.
│          Kill if CAC > 2.5x US or conversion <40% of US.
│
└─ SUB-3: UK + DE specifically (not France/Italy/Spain) is the right wedge  [conviction: Medium]
   └─ Test: Compare 4 dimensions across UK/DE/FR/IT/ES — payment friction (SEPA vs. local),
          language overhead (EN penetration in SMB), regulatory friction (GDPR sub-cases),
          competitor share.
          Kill if France scores higher than DE on 3 of 4 — would force re-sequencing.

PRIORITY: Run Sub-2 first (lowest conviction, highest stakes). 2 weeks, $10K. If PLG fails,
the whole top hypothesis flips to "enter via partner-led sales or don't enter."

OVERALL KILL-CRITERION: If Sub-2 fails AND we can't articulate a sales-led model with <12-month
payback, abandon FY26 entry and revisit FY27 with a partnerships path.
```

Note how this works: 6 weeks of work become 2 weeks of work, because Sub-2 is the load-bearing assumption. If it fails, you stop — no point testing Subs 1 and 3.

---

## Common mistakes to avoid

- **No top hypothesis.** "I want to investigate Europe" is not a hypothesis. Pick an answer.
- **Sub-hypotheses that aren't load-bearing.** If proving a sub doesn't change your conviction in the top, it's the wrong sub.
- **Tests that can't kill the branch.** "Talk to customers" isn't a test. "Run 10 customer calls; kill if 7+ say price is the blocker" is a test.
- **Sequencing high-conviction first.** Wastes the timebox. The whole point is to *get to wrong* fast.
- **No kill-criterion.** Without it, you'll explain away any disconfirming data. Set the bar before you see results.
- **Confusing with issue tree.** If your tree branches into sub-*questions* instead of sub-*claims*, it's an issue tree. Rewrite each branch as a statement.

---

## When to use

- Start of any strategic analysis (market entry, pricing, M&A, restructuring)
- When you've already done an issue tree and need to commit to an answer
- When the team is about to "go gather data" with no clear hypothesis
- Before any board ask that begins "we recommend..."

## When NOT to use

- You genuinely don't know enough to guess (do an issue tree first)
- The question is descriptive, not decision-driving ("what is happening?" vs. "what should we do?")
- The decision is reversible and small (just try it, don't formalize)

---

## Pairs well with

- **Issue Tree Builder** — frame the problem space first, then commit to a hypothesis within it
- **Synthesis** — use synthesis output as input to validate or kill specific sub-hypotheses
- **Decision Memo Builder** — once you've tested and survived, the surviving hypothesis becomes the recommendation
- **McKinsey Critic** — stress-test your tree before you start running tests; cheaper to fix bad framing than bad analysis
