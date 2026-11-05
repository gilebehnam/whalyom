---
name: ext-eai-workshop-designer
description: Design a half-day or full-day strategy workshop that ends with a committed decision and named owners — not a "great discussion" with no artifact. Outputs an hour-by-hour agenda, breakout prompts with expected outputs, pre-reads, facilitator playbook for when things go sideways, and the post-workshop artifact that justifies the day. Use for offsites, leadership alignment sessions, kickoff workshops, planning meetings >2 hours.
---

<!-- Vendored into Whalyom on 2026-11-04 from https://github.com/sruthir28/enterprise-ai-skills (MIT License, Copyright (c) 2025 Sruthi Reddy); audited by om-skill-auditor: markdown only, risky lines removed. -->
> **In Whalyom:** read the product's `product.json`, `profile.md`, `claims.md` and `LEARNINGS.md` first; use only claims listed in `claims.md` and cite sources for every number (benchmarks come from the knowledge base, never from memory); personas, quotes and examples are labelled hypothetical; paid or gifted creator content is always disclosed; drafts go to `outbox/` with an entry in `approvals.json` and nothing is sent, posted, published or paid for without the owner's approval. The project rules in CLAUDE.md take precedence over anything below.

# Workshop Designer

Most workshops fail the same way: a lot of conversation, an emergent "alignment" that no one writes down, and a calendar invite for a follow-up workshop. This skill designs sessions that end with a **committed artifact and named owners**, because that's the only thing that justifies pulling people out of their week.

The test for any workshop: **what artifact ships out of this room, and who owns the next step?** If you can't answer, don't run the workshop.

---

## Design choices

- **One outcome, not three.** A workshop with three goals achieves zero. Force-rank to one decision or one artifact.
- **Diverge then converge, never both at once.** Brainstorm sessions and decision sessions are different brain modes. Mixing them creates "discussion" that converges on nothing.
- **Breakouts < 4 people.** Above 4, one person dominates. Report-backs < 5 min each, or you lose the room.
- **Energy curve matters.** Heavy thinking morning, application + decisions afternoon. Never schedule a decision moment right after lunch.
- **The artifact is the deliverable, not the meeting.** Pre-build the template; the workshop fills it in. Leaving "we'll write it up later" is how alignment evaporates by Tuesday.
- **Facilitator plays referee, not participant.** If you have a stake in the decision, you can't facilitate. Pick one or the other.

---

## Inputs needed (interview if missing)

1. **Workshop goal — one sentence.** "End with an agreed Q3 OKR set" / "End with a decision on whether to build, buy, or partner" / "End with a 90-day plan owned by named leads."
2. **Attendees.** Names + roles. Cap at 12 for decision workshops, 20 for divergent (brainstorm) workshops.
3. **Duration.** Half-day (4 hrs incl. break), full-day (6–7 hrs incl. lunch + breaks). Multi-day = different format.
4. **What's already decided going in.** Constraints, locked-in choices. Surface these upfront so people don't re-litigate them.
5. **What's open.** The actual decision space.
6. **What the artifact is.** The thing that leaves the room. (Strategy on a page, OKRs, decision memo, prioritized roadmap, etc.)
7. **Who facilitates.** Internal (cheaper, has context) or external (neutral, harder to derail).

---

## Output format

### 1. Workshop charter (1 page, pre-read)
- The one outcome
- Decisions in scope vs. out of scope
- Attendee list with role in the workshop (decider / contributor / observer)
- Required pre-work

### 2. Hour-by-hour agenda

| Time | Block | Mode | Output | Owner |
|------|-------|------|--------|-------|
| 9:00 | Frame + outcome | Plenary | Shared understanding of one outcome | Facilitator |
| 9:15 | Constraints recap | Plenary | Locked items on the wall, no debate | Sponsor |
| 9:30 | Divergent: option generation | Breakout (3s) | 5–8 options per group | Breakouts |
| 10:30 | Report-back + cluster | Plenary | One synthesized list, ~12 options | Facilitator |
| 11:00 | Break | — | — | — |
| 11:15 | Convergent: rank options | Plenary, dot-vote | Top 3 options | All |
| 12:00 | Lunch | — | — | — |
| 1:00 | Deep-dive top option | Breakout (5–6) | Filled-in decision template | Sub-team |
| 2:30 | Plenary review + decide | Plenary | Go / no-go + owner | All |
| 3:00 | Wrap + commitments | Plenary | Named owners, dates, next step | Facilitator |
| 3:30 | Done | — | Filled artifact in hand | — |

### 3. Breakout playbook
For each breakout: the **prompt** (one question), **expected output** (concrete deliverable), **time** (strict), **roles** (timekeeper, scribe, reporter).

### 4. Facilitator's "what if" notes
The 5 things that go wrong and what to do:
- "One exec dominates" → name it, rotate to round-robin
- "Group can't converge in the convergent block" → cut to 2 options, force a coin-flip-or-rationale framing
- "New constraint surfaces mid-day" → park it on a 'parking lot' wall, re-decide if it changes the call
- "Sponsor changes the goal mid-workshop" → pause, get the new outcome in writing, ask the room if it still works
- "Pre-reads weren't read" → 10 min silent reading of the 1-page summary, skip the original frame block

### 5. The artifact template
The thing the workshop fills in. Pre-built. Examples:
- Strategy on a page (Aspiration / Where to play / How to win / Capabilities / Mgmt systems)
- Q3 OKR set (3 objectives, 3 KRs each, owners)
- Decision memo (Context / Options / Recommendation / Risks / Ask)

### 6. Post-workshop send (24-hour SLA)
What goes out within 24 hrs: the artifact + the commitments table (who owns what by when). Drafted before the workshop, populated during.

---

## Process

1. **Lock the one outcome.** Push back on multi-outcome workshops. Run two days or one workshop and a follow-up.
2. **Design the artifact first.** Reverse-engineer the agenda from what the artifact needs.
3. **Plot the energy curve.** Heavy thinking 10am–12pm, decision 2pm–3pm, never after lunch directly.
4. **Mode-tag every block:** divergent / convergent / plenary / breakout. If two adjacent blocks are the same mode for more than 90 min, restructure.
5. **Write the facilitator script.** Not the slides — the verbatim framing for each transition. "We just spent an hour generating options. Now we're going to converge to three. The criterion is X. Each person gets 3 dots."
6. **Pre-build the "what if" playbook.** Workshops go sideways for the same 5 reasons.
7. **Calendar the post-send before the workshop.** 24-hr SLA for the artifact. If you don't pre-commit, it slips.

---

## Worked example

**Workshop:** Align the 12-person leadership team on Q3 strategic priorities.
**One outcome:** Leave with a Q3 strategy-on-a-page signed off by all 12.
**Duration:** Full day, 9:00–3:30.
**Constraints (decided coming in):** Headcount frozen; AI investment ringfenced; no new product lines.
**Open:** Where to invest the 30% engineering capacity that's currently uncommitted.

### Pre-reads (sent 5 days before)
- Q2 retrospective: top 3 wins, top 3 misses (1 page)
- 6 candidate investment areas with 1-paragraph cases each (3 pages)
- Strategy-on-a-page template, pre-filled with locked items (1 page)

### Agenda

| Time | Block | Mode | Output |
|------|-------|------|--------|
| 9:00 | Frame: today we leave with the strategy-on-a-page filled. The one open question: where do we point the uncommitted 30% capacity? | Plenary | Shared frame |
| 9:15 | Q2 reflect: 1 win + 1 miss from each leader (1 min each, no discussion) | Plenary | Public reflection, surfaces what's on people's minds |
| 9:45 | Breakouts of 3: rank the 6 candidate investments + propose 1 outside the pre-read | Breakout | 4 ranked lists |
| 10:30 | Report-back + cluster | Plenary | One unified list, ~7 options |
| 11:00 | Break | | |
| 11:15 | Silent dot-voting: each leader gets 5 dots, places on the 7 options | Convergent | Top 3 emerge |
| 11:45 | Devil's advocate: 1 person assigned to argue against each of the top 3 | Plenary | Stress-tested top 3 |
| 12:15 | Lunch | | |
| 1:15 | Breakouts of 4: each group takes one of the top 3 and fills in a 1-page "what this looks like in Q3" (investment, expected outcome, risks) | Breakout | 3 filled 1-pagers |
| 2:30 | Plenary: choose 1 (or up to 2 if separable) | Convergent | Decision |
| 2:45 | Fill in the strategy-on-a-page live on screen | Plenary | Artifact complete |
| 3:15 | Commitments: named owner for each Q3 priority, kickoff date | Plenary | Owners table |
| 3:30 | Wrap | | Artifact + commitments in hand |

### Facilitator's "what if"
- **Most likely failure:** group can't converge to 1 in the 2:30 block. Pre-decide: if no 70% consensus by 2:45, sponsor (CEO) gets the tie-breaker. Communicate this upfront so it's not a surprise.
- **Second risk:** Q2 retrospective opens old wounds. Time-box hard, no rebuttals, facilitator interrupts if anyone goes >90 sec.
- **Third risk:** someone re-litigates the headcount freeze. Point at the wall ("locked items"), defer to a different forum.

### Post-workshop send (drafted before, populated during)
Email within 24 hours, subject: "Q3 strategy: locked. What you own."
- Strategy on a page (attached PDF, photo of physical version on the wall)
- Commitments table: each leader's Q3 priority owner-name + first milestone date
- Next sync: 2-week check-in with this same group

---

## Common mistakes to avoid

- **Multi-outcome workshops.** "Alignment + brainstorm + decisions" = none of the three. Pick one.
- **No artifact template.** "We'll write it up" = it doesn't get written up. Pre-build.
- **Schedule fills, work doesn't.** Tight timeboxes feel good but don't generate output. Build in 15 min of slippage per major block.
- **Mixing divergent and convergent.** "Let's brainstorm options and pick the best one in 45 min" produces neither good options nor a defensible pick.
- **Decision moment right after lunch.** Energy nadir. Schedule application work there, not commitment.
- **>4 in a breakout.** Loud voice dominates. Always split into 3s or 4s.
- **No "what if" playbook.** Workshops sideways predictably. Have the moves ready.
- **The sponsor facilitates.** They have a stake — they'll bias the room. Pick a neutral facilitator or rotate someone external in.

---

## When to use

- Leadership offsites (half-day or full-day)
- Quarterly planning sessions
- Strategy resets after a major change
- Kickoff workshops for cross-functional initiatives
- M&A integration alignment
- Any working session > 2 hours

## When NOT to use

- Recurring meetings (use a different format)
- Status updates (workshop is too much; use an async memo)
- 1:1s, small group decisions <5 people (use Meeting Prep Kit)
- Trainings (different design — facilitation vs. learning are different jobs)

---

## Pairs well with

- **Meeting Prep Kit** — pre-workshop 1:1s with key attendees to map stances; reduces in-room surprises
- **Stakeholder Map** — map the room before designing the agenda; the breakouts you design depend on who's in the room
- **Decision Memo Builder** — the artifact that leaves a decision workshop is often a decision memo
- **Storyline Builder** — pre-reads structured as a storyline land better than narrative pre-reads
