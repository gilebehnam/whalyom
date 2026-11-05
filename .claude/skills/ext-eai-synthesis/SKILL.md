---
name: ext-eai-synthesis
description: Force the "so what" out of a messy pile of raw inputs — interview notes, customer transcripts, survey results, research dumps, meeting recordings — into 3 insights with evidence and implication. Use when you have more data than you have meaning, and someone is about to ask "ok, so what does this mean?" Different from summarization; output must change how the reader acts.
---

<!-- Vendored into Whalyom on 2026-11-04 from https://github.com/sruthir28/enterprise-ai-skills (MIT License, Copyright (c) 2025 Sruthi Reddy); audited by om-skill-auditor: markdown only, risky lines removed. -->
> **In Whalyom:** read the product's `product.json`, `profile.md`, `claims.md` and `LEARNINGS.md` first; use only claims listed in `claims.md` and cite sources for every number (benchmarks come from the knowledge base, never from memory); personas, quotes and examples are labelled hypothetical; paid or gifted creator content is always disclosed; drafts go to `outbox/` with an entry in `approvals.json` and nothing is sent, posted, published or paid for without the owner's approval. The project rules in CLAUDE.md take precedence over anything below.

# Synthesis

Most people summarize when they should synthesize. Summary compresses what was said. Synthesis names the pattern and forces the implication. This skill does the second thing.

The test: **did the output change how the reader will act?** If no, you wrote a summary. Rewrite.

---

## Design choices (why this skill is opinionated)

- **3 insights, never more.** If you have 5, you haven't synthesized yet — you have themes. Force-rank to 3.
- **Headlines are claims, not topics.** "Customers will pay 20% more for self-serve onboarding" beats "Customers care about onboarding."
- **Every insight ends with a so-what.** A claim without an implication is trivia. The so-what tells the reader what to do differently.
- **Evidence is specific.** Direct quotes, exact numbers, named sources. No "many customers said" — that's compressed mush.
- **Synthesis is reductive.** You will throw away 80% of the raw input. That's the job. If you keep all of it, you summarized.

---

## Inputs the skill needs (interview if missing)

1. **The raw inputs.** Interview notes, transcripts, survey data, research, meeting recordings. Paste or link.
2. **Who's the reader?** Exec, peer, team. Changes the so-what.
3. **What decision is downstream?** "Should we build X?" "Cut Y?" "Reorg Z?" The synthesis should serve a specific call.
4. **What did you go in believing?** Your prior hypothesis. (Helps catch confirmation bias and surface true surprises.)

If the decision is unknown, ask before synthesizing. Synthesis without a decision becomes a summary.

---

## The process

### 1. Cluster (induction, not deduction)
Read everything. Tag each data point with the theme it belongs to. Don't start with themes and force-fit — let themes emerge from the data. You're looking for *repeated patterns*, not single anecdotes.

### 2. Force-rank to 3
You'll have 5–10 emerging themes. Cut to 3. Use this rank:
- Frequency (how often did it come up?)
- Severity (how big a deal is it for the decision?)
- Surprise (did it contradict what you went in believing?)

The top 3 by combined rank become the insights.

### 3. Name each insight as a claim
Each insight is one sentence. It must:
- State the finding (not the topic)
- Be specific (numbers, names, mechanism)
- Be falsifiable (someone could disagree with evidence)

| ❌ Topic | ✅ Claim |
|---------|---------|
| "Onboarding feedback" | "Customers drop off at step 3 because they don't see value before being asked to invite teammates" |
| "Pricing concerns" | "Mid-market buyers cap at $50K because that's their no-approval threshold" |
| "Competitive landscape" | "Two competitors launched our roadmap feature; we have 6 months before parity is table stakes" |

### 4. Stack the evidence (2–3 bullets per insight)
Under each insight, list the specific data that supports it. Direct quotes, exact numbers, sources. The reader should be able to push back on any insight and you can point to the evidence.

### 5. Write the so-what (1 line per insight)
For each insight, finish this sentence: *"Because this is true, the reader should ___."* If you can't fill the blank, the insight isn't sharp enough.

### 6. Anti-summary check
Read the output. Ask: would a smart person who'd never seen the raw data know what to do next? If they'd say "interesting, tell me more" — you summarized. If they'd say "ok, then we should ___" — you synthesized.

---

## Output format

```
INSIGHT 1: [Headline claim — one sentence]
Evidence:
- [Specific data point with source]
- [Specific data point with source]
- [Specific data point with source]
So what: [One-line implication for the reader's decision]

INSIGHT 2: [Headline claim]
Evidence: ...
So what: ...

INSIGHT 3: [Headline claim]
Evidence: ...
So what: ...

OVERALL RECOMMENDATION (optional, 1–2 sentences):
[The single thing the reader should do, ladders to all 3 insights]
```

Optional sections only if asked for:
- **What we threw out** — themes that didn't make the top 3 and why
- **What we'd need to test next** — open questions the synthesis doesn't answer

---

## Worked example

**Input:** 12 customer interviews about why churn is up 8% QoQ.
**Reader:** CEO + Head of Product
**Decision downstream:** What to fix in the next 90 days
**Prior hypothesis:** "Pricing is too high"

### INSIGHT 1: Churn is concentrated in customers who never finished onboarding — pricing is a symptom, not a cause.
Evidence:
- 9 of 12 churned customers never completed step 3 of onboarding (team invite). The 3 who did completed all 5 steps and stayed >18 months.
- Customer #4 (Acme Co.): "I never figured out what to do with it, so when renewal came up, $30K felt like a lot for something we weren't using."
- Internal data: customers who complete onboarding within 14 days have 78% retention; those who don't have 31%.

So what: **Pricing changes won't fix this. Cutting price preserves the broken funnel; fixing onboarding step 3 is the highest-leverage move in the next 90 days.**

### INSIGHT 2: The blocker at step 3 is social, not technical — buyers won't invite teammates until they've personally seen value.
Evidence:
- 7 of 9 onboarding dropouts said some version of: "I didn't want to invite my team until I knew it worked." (Customers #2, 3, 5, 6, 8, 9, 11.)
- Step 3 today *requires* inviting at least one teammate to proceed. There is no single-player mode.
- Two competitors (Linear, Notion) let you use the product solo for 14 days before requiring invites.

So what: **Remove the invite gate at step 3. Let users complete a value moment alone, then prompt for team invites at the natural moment they want to share.**

### INSIGHT 3: The customers most likely to renew are the ones our sales team currently ignores — solo champions in mid-market companies.
Evidence:
- All 3 retained interviewees were single-person buyers at companies <500 employees. Average contract: $18K.
- Sales currently routes anything <$25K to self-serve and prioritizes enterprise deals >$100K.
- The 3 largest churned accounts ($120K+) had 4+ committee members and never had a clear internal owner.

So what: **Rebalance go-to-market: invest in self-serve mid-market expansion and stop chasing committee-led enterprise deals in this segment. The unit economics work better and the retention is 2x.**

### OVERALL RECOMMENDATION
The 90-day fix is product (kill the invite gate), not pricing. Then realign sales toward mid-market solo champions.

---

## Common mistakes to avoid

- **Synthesis-by-list.** "Here are 7 themes I heard." That's clustering, not synthesis. Cut to 3 with implication.
- **Vague evidence.** "Most customers said..." Whose? Quote them. Count them. Name them.
- **Topic headlines.** "Onboarding" is a topic. "Onboarding breaks at step 3 because of forced invites" is a claim.
- **Missing the so-what.** An insight without an implication is intellectual content, not decision support.
- **Hiding from the prior.** If your synthesis happens to match exactly what you went in believing, recheck — confirmation bias is the most common failure mode.
- **Summary smuggling.** Don't include "background" or "context" sections. The reader has the raw data if they want it. Synthesis is just the 3 claims + evidence + so-what.

---

## When to use

- After customer/user interviews (5+ conversations)
- After surveys or research dumps
- After cross-functional listening tours
- Before any "what did we learn?" exec readout
- Anytime someone hands you a pile of qualitative data and a decision

## When NOT to use

- You have one data source (just write a clean summary)
- The reader explicitly wants raw notes (synthesis is interpretation; sometimes they want to interpret themselves)
- You don't yet know the decision the synthesis serves (figure that out first)

---

## Pairs well with

- **Issue Tree Builder** — use synthesis insights to populate hypothesis branches with real data
- **Decision Memo Builder** — synthesis output feeds the Context + Complication of the memo
- **McKinsey Critic** — run the draft synthesis through the critic to catch topic-headlines and missing so-whats
