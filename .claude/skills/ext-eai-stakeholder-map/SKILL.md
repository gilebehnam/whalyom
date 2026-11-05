---
name: ext-eai-stakeholder-map
description: Map the people who can make or break a decision onto a Power/Interest grid, with each named stakeholder's stance (champion / skeptic / blocker / unknown), what they care about, and the single influence move you'll make for them. Use before any cross-functional decision, big launch, reorg, or executive ask — anywhere the politics will decide the outcome more than the merits.
---

<!-- Vendored into Whalyom on 2026-11-04 from https://github.com/sruthir28/enterprise-ai-skills (MIT License, Copyright (c) 2025 Sruthi Reddy); audited by om-skill-auditor: markdown only, risky lines removed. -->
> **In Whalyom:** read the product's `product.json`, `profile.md`, `claims.md` and `LEARNINGS.md` first; use only claims listed in `claims.md` and cite sources for every number (benchmarks come from the knowledge base, never from memory); personas, quotes and examples are labelled hypothetical; paid or gifted creator content is always disclosed; drafts go to `outbox/` with an entry in `approvals.json` and nothing is sent, posted, published or paid for without the owner's approval. The project rules in CLAUDE.md take precedence over anything below.

# Stakeholder Map

Most decisions don't fail because the analysis was wrong. They fail because the person who could kill it wasn't bought in, or the person who could champion it wasn't asked. This skill makes the politics visible so you can plan around them — without pretending strategy and people are separate problems.

The output is a 2x2 grid + a per-stakeholder action plan. You walk away knowing exactly who you talk to first, what you say, and who you can ignore.

---

## Design choices

- **Real names, not roles.** "Head of Eng" hides the fact that *this* Head of Eng has been here 3 months and has political capital below the team they inherited. Use names.
- **Power × Interest, not Influence × Impact.** Power = can they kill the decision. Interest = do they care about the outcome. The right axes for *politics*, not for delivery management.
- **One move per stakeholder.** Not a 5-step engagement plan. The one thing you'll do this week.
- **Stance is honest.** Champions get celebrated, blockers get named. If everyone is "supportive," you haven't mapped honestly.
- **Skip the unmappable.** If you have <2 minutes of real information on a stakeholder, mark them "unknown" and make finding out their #1 action.

---

## The grid

```
                       HIGH INTEREST                 LOW INTEREST
                  ┌──────────────────────────┬──────────────────────────┐
                  │                          │                          │
   HIGH           │   MANAGE CLOSELY         │   KEEP SATISFIED         │
   POWER          │   (the actual deciders)  │   (don't surprise them)  │
                  │                          │                          │
                  ├──────────────────────────┼──────────────────────────┤
                  │                          │                          │
   LOW            │   KEEP INFORMED          │   MONITOR                │
   POWER          │   (your loud allies)     │   (don't waste cycles)   │
                  │                          │                          │
                  └──────────────────────────┴──────────────────────────┘
```

### Manage closely — High Power, High Interest
The deciders. They will say yes or no. **Most of your time goes here.** 1:1 alignment before the decision moment. Never let them be surprised in a group meeting.

### Keep satisfied — High Power, Low Interest
Senior people whose space you're stepping into but who don't care about this specific decision *yet*. The risk: they hear about it secondhand and feel disrespected, then start caring (and blocking). **Pre-brief them on what you're doing and why. Don't ask for input you won't use.**

### Keep informed — Low Power, High Interest
The team. The folks doing the work. They can't kill it but they can slow it. **Visibility + giving them a role kills 80% of friction.** Channel them into the decision via the deciders, not as a parallel campaign.

### Monitor — Low Power, Low Interest
Don't ignore — *monitor*. Quarterly update is plenty. The risk is they shift into one of the other quadrants (someone gets promoted, scope expands) and you're caught off guard.

---

## Inputs needed (interview if missing)

1. **The decision.** "Migrate to Linear." "Sunset legacy product." "Reorg sales by vertical." Specific.
2. **Decision moment.** When does this need to be approved? By whom?
3. **The full cast.** Everyone who has an opinion, a budget, a team affected, or a meeting on this. Names + roles.
4. **What you already know about each.** Stated stance, recent comments, past behavior on similar decisions. (If you don't know — that's the action.)

---

## Output format

### 2x2 placement table
| Stakeholder | Role | Quadrant | Stance | What they care about | Your move this week |
|-------------|------|----------|--------|---------------------|----|
| Sarah Chen | CTO | Manage closely | Skeptic | Reliability + team retention | 1:1 Tuesday, lead with retention data, ask for her objections before the all-hands |
| ... | ... | ... | ... | ... | ... |

### Stance legend
- **Champion** — already advocating; ask them to advocate publicly
- **Supporter** — quietly in favor; ask them to speak up at the decision moment
- **Neutral** — no strong view; lowest priority (don't burn cycles converting)
- **Skeptic** — has reservations but persuadable; get the objection on the table
- **Blocker** — will actively oppose; decide whether to convert, route around, or escalate
- **Unknown** — find out, then update

### Coalition sketch (3–5 lines)
Who needs to be aligned, in what order, before the decision moment. Example:
> "Win Sarah by EOW (she's the blocker). Once Sarah's neutral, Mark (champion) will close Priya. Don't engage Tom — he won't care unless Sarah escalates."

---

## Process

1. **List everyone.** Cast the net wide first. Don't pre-filter.
2. **Place each on the grid.** Be honest about power — title isn't always power.
3. **Assign stance.** If you don't know, mark "unknown" — that's a data point.
4. **For each Manage Closely person:** what do they care about (their KPI, recent stress, public commitments), and the one move this week.
5. **Sequence the coalition.** Who must align first to unlock the next. Usually = blockers and high-power skeptics, before champions.
6. **Reality-check.** Ask: "If I do nothing else, would this decision still pass?" If yes, you over-mapped — simplify. If no, your top 3 actions are obvious.

---

## Worked example

**Decision:** Migrate engineering + product from Jira to Linear by 5/30.
**Decision moment:** EOD Friday (today is Tuesday) — Mark approves or denies the budget swap.

| Stakeholder | Role | Quadrant | Stance | What they care about | Move this week |
|-------------|------|----------|--------|----------------------|----------------|
| Mark Chen | VP Eng (decider) | Manage closely | Neutral → Skeptic | Team retention, no rollout drama | 30-min 1:1 Weds. Lead with NPS data (4/10) + 2 pilot teams' productivity wins. Pre-empt his "what about 6 yrs of history" objection. |
| Priya Patel | PM Lead (pilot) | Manage closely | Champion | Faster ship velocity | Ask her to write a 1-pg "what we learned in pilot" by Thurs AM. Mark reads it before our 1:1. |
| Alex Kim | Eng Director (Platform) | Manage closely | Skeptic | Migration of custom workflows | Loop in by Weds. Offer Platform team as the 3rd pilot. Convert from skeptic by giving them control. |
| Tom Reilly | CFO | Keep satisfied | Unknown | Cost, contract risk | Drop a 3-line note Tues PM: "Net savings $18K/yr, decision Fri, no surprises." Don't ask for input. |
| Sarah Wu | Head of People | Keep satisfied | Unknown | Anything that affects team morale | Same as Tom — short pre-brief Wed AM. |
| Eng Team (60ppl) | IC engineers | Keep informed | Mixed (mostly Supporters per pilot data) | Less tooling friction | Mark posts in #eng-all after Friday decision. Don't run a parallel campaign — let Mark own the comms. |
| Jira AE (vendor) | External | Monitor | Blocker | Renewal | Ignore until decision is made. Then 1 email to cancel. |

### Coalition sketch
> Tuesday PM: pre-brief Tom + Sarah (kills the "I didn't know" risk).
> Wednesday: 1:1 with Mark (the actual decision). Bring Priya's pilot write-up.
> Wednesday PM: convert Alex by offering Platform as pilot #3.
> Thursday: Mark + Priya + Alex 30-min sync to lock the migration plan.
> Friday: Mark says yes. Decision goes out.
>
> If Mark is still skeptical Wednesday, escalate to CTO with the pilot data. Don't let it drift to Monday — the renewal auto-renews 5/30.

---

## Common mistakes to avoid

- **Mapping by title, not by power.** The CTO might not care about this; the staff eng who's been there 8 years might be the actual blocker.
- **Skipping the "unknown" stance.** Unknown is honest. "I think they're supportive" without evidence is wishful.
- **Over-engaging Monitor quadrant.** Don't burn cycles converting people who don't care and can't block.
- **Treating champions as a finish line.** Champions need *fuel* (data, talking points, public moments). Map what you give them, not just that they exist.
- **No coalition sequence.** Knowing who matters isn't enough. You need the order.
- **Conflating loud with powerful.** The person who tweets the most opinions often has the least decision power. Map carefully.

---

## When to use

- Cross-functional decisions with 3+ stakeholders
- Reorgs, launches, sunsets, vendor changes
- Any "we need exec buy-in" moment
- Before a board meeting where you're presenting
- When a project is stuck and you suspect the blocker is political, not technical

## When NOT to use

- Solo decisions (just decide)
- Decisions inside your own team where you control the outcome
- Reversible / low-stakes calls (don't formalize the politics if the worst case is "we change our mind")

---

## Pairs well with

- **Meeting Prep Kit** — once you've mapped the room, prep each 1:1 with the right talking points + objections
- **Decision Memo Builder** — the memo is the artifact that aligns the coalition; build the map first, the memo second
- **SCPR Framework** — the Situation/Complication framing should reflect what the key stakeholders already believe
