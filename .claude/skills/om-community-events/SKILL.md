---
name: om-community-events
description: "Run community and events in Whalyom: the community's purpose and who it is for, rituals and the programming calendar, moderation and safety, an ambassador program with disclosed benefits, meetups and virtual summits (run sheets, speakers, consent-based registration, follow-up), and measuring community by active members, answered questions, member-sourced leads and retention. Use for any task about a Discord, Slack or forum community, ambassadors, meetups, webinars at scale, summits or event presence."
---

# Community and events

A community lasts when members get value from each other, not only from the brand. The head is `om-mega-community`. Real members, real conversations, and events people chose to attend. No fake members, no seeded fake engagement.

## 1. Purpose and who it is for

Before any channel is opened, write `research/community/charter.md`:

1. Who it is for (one or two member types) and who it is not for.
2. What members get without buying: answers, peers, templates, feedback, early access.
3. What the business gets: retention, product feedback, referrals, content.
4. Where it lives (Discord, Slack, a forum, a LinkedIn group, in-person) and why that place fits the members.
5. The one sentence that tells a new member why to stay.

If there is no reason for members to talk to each other, run events or a newsletter instead.

## 2. Rituals and programming calendar

`om-community-manager` keeps `outbox/community/calendar.md`: weekly rituals (intro thread, office hours, show-and-tell, wins of the week), monthly events (AMA, workshop, challenge) and quarterly moments. Each item has an owner, a prompt, and a fallback if attendance is low. Fewer rituals done every time beat many done once.

## 3. Moderation and safety

`om-discord-moderator` writes `research/community/moderation.md`: the code of conduct, what gets removed, warning and ban steps, anti-spam and raid settings, onboarding questions, roles and permissions, and escalation to the owner for threats, harassment, self-harm, legal and privacy issues. Moderators disclose their role. Member data stays in the platform; exports only with a lawful basis.

## 4. Ambassador program

`om-ambassador-program` designs `outbox/community/ambassadors.md`: who qualifies (active, helpful members, invited, never bought), what they do, the benefits (access, swag, credit, revenue share), written terms, and the disclosure ambassadors must use when they talk about the product anywhere. Benefits are disclosed, posts are labelled, and no ambassador posts fake reviews or votes.

## 5. Meetups and virtual summits

For every event, `outbox/community/events/<id>/` holds:

- **Brief:** goal, audience, format, date, budget inside the caps, success measure.
- **Speakers:** invitations, a speaker brief, consent to record and publish, slide review against `claims.md` for anything said for the brand.
- **Registration:** only the fields needed, marketing consent as a separate unticked box, a privacy note, accessibility needs asked.
- **Run sheet:** minute-by-minute plan, roles, tech check, backup for every failure point, the code of conduct read out.
- **Follow-up:** recording and slides to attendees, a different message to no-shows, a feedback survey, and leads routed to `funnel/updates/` only for consented registrants.

`om-meetup-organizer` runs in-person meetups (venue, capacity, host partners); `om-virtual-summit-producer` runs multi-session online events; `om-event-producer` covers booths and sponsored events; `om-events-scout` finds outside events worth attending, speaking at or hosting a side event.

## 6. Invites

`om-micro-event-invite` drafts one invite for one segment: what, when, who it is for, why come, one link. Invites go only to consented contacts or through the community's own announcement channel, within its rules.

## Who does what

| Agent | Work |
|---|---|
| om-mega-community | Charter, calendar, priorities, sign-off |
| om-community-manager | Rituals, programming, member onboarding |
| om-discord-slack | Channel setup, structure, integrations |
| om-discord-moderator | Code of conduct, moderation, safety |
| om-ambassador-program | Ambassador terms, benefits, disclosure |
| om-meetup-organizer | In-person meetups |
| om-virtual-summit-producer | Virtual summits and multi-session events |
| om-event-producer | Booths, sponsorships, own events |
| om-events-scout | Outside events and calls for speakers |
| om-community-analyst | Community metrics and reports |
| om-micro-event-invite | One event invite |

## Guardrails

- Claims only from `claims.md`. No invented numbers, testimonials, reviews or customer names. No fake members, sock-puppet accounts, bought members or seeded fake activity.
- Nothing outbound without approval: announcements, invites, ambassador terms, event pages and sponsorship spend are drafts plus an entry in `approvals.json`, executed by `tools/execute.mjs`.
- Spend inside `budget.monthly_cap` and `budget.daily_cap`. Consent for every registrant and contact; recordings only with speakers' consent.
- Agents write results to `runs/<task-id>.json`, never to `tasks.json` or `approvals.json`.

## Measures

`om-community-analyst` reports monthly in `research/community/metrics.md`: active members (posted or attended in 30 days) against total, new members and how they found it, questions asked and the share answered by members, time to first answer, event registrations, attendance and no-show rate, member-sourced leads and sales credited in `funnel/`, and retention of members against non-members where the data allows. Each ritual and event names its hypothesis and metric in `experiments.json`.
