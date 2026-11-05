---
name: om-video-studio
description: Run the video and audio studio in Whalyom: one long recording cut into many pieces, script structure (hook, payoff, CTA), captions and subtitles, thumbnail and title tests, retention graph reading, podcasts, webinars, live streams, sonic branding, music and footage rights, and labels for AI-generated media. Use for any task about video, YouTube, Shorts, podcasts, webinars, live streams, captions, thumbnails or audio identity.
---

# Video and audio studio

The studio makes few recordings and many assets. The head is `om-mega-studio`. Scripts say only what `claims.md` supports, every asset has rights on file, and nothing is published without the owner's approval.

## 1. One recording, many cuts

Plan from the long piece down:

1. **Record once:** a webinar, podcast episode, demo, founder talk or customer interview (with consent).
2. **Cut many:** the full episode, chapters, 3 to 6 short clips (one idea each), an audiogram, quote cards, a blog post from the transcript, a newsletter section.
3. **Index it:** `research/studio/library.json` lists every recording with its transcript path, the clips cut from it, the rights status and where each was published.

`om-video-repurposer` picks clips by a clear idea that stands alone, not by length.

## 2. Script structure

Every script in `outbox/studio/scripts/<id>.md` has:

- **Hook (first seconds):** the problem, a surprising true fact from `claims.md`, or the result shown first. No logo intro before the hook.
- **Payoff:** deliver what the hook promised, with a demo or proof, one idea per short.
- **CTA:** one action, matching the stage (watch the full video, get the guide, book a demo).
- Timing marks, on-screen text lines, B-roll notes and the claim id behind each factual line.

## 3. Captions and subtitles

Every published video gets accurate captions: they serve deaf and hard-of-hearing viewers and the many who watch with sound off. Keep a `.srt` or `.vtt` file per video in `outbox/studio/captions/`, edited by a person after any automatic pass (names, product terms, numbers). Burned-in text for short-form, sidecar files for long-form, translated subtitles for each market in `product.json`.

## 4. Thumbnails and titles

`om-thumbnail-tester` drafts three thumbnail concepts per video (face and emotion, bold short text, the object of curiosity) and `om-youtube` writes title variants. Test with the platform's own test tool where available, or a timed swap, one variable at a time. The title and thumbnail must match what the video delivers; misleading packaging hurts retention and breaks platform rules.

## 5. Reading the retention graph

`om-video-retention-analyst` reads exported retention and traffic data into `research/studio/retention/<video>.md`:

- Early drop: the hook or the packaging promise did not match.
- Steady slope: normal; compare against the channel's own past videos, not outside benchmarks.
- Sharp dips: a slow section, an off-topic part or an early CTA. Mark the timestamp.
- Bumps: rewatched moments worth turning into clips.

Each read ends with one change for the next script.

## 6. Podcasts, webinars and live streams

- **Podcast:** episode plan, guest brief and consent form, question list, show notes with chapters and links, clips. Guests approve any quote used in promotion.
- **Webinar:** topic tied to a buyer job, run sheet, registration with marketing consent as a separate unticked box, reminder emails, replay policy stated honestly, follow-up by attendance.
- **Live stream:** run sheet, moderator, chat rules, a fallback if the stream fails, the replay edit.

## 7. Sonic branding

`om-sonic-brand-designer` writes the audio brief in `research/studio/sonic.md`: intro and outro sting, background beds, the voice-over style, loudness targets per platform, and where sound must never be used. Use the same sting everywhere so it becomes a brand asset.

## 8. Rights and AI labels

- Music, footage, fonts and images are licensed for the use (platform, paid ads, duration) or owned. The license file sits next to the asset in `outbox/studio/rights/`.
- People on screen or on audio sign a release before publishing; customers too.
- AI-generated or AI-altered video, voice or images carry the platform's AI label and a provenance sidecar. Cloned voices need the person's written consent. Never imitate a real person without it.

## Who does what

| Agent | Work |
|---|---|
| om-mega-studio | Plan, recording calendar, sign-off |
| om-video-producer | Storyboards, shot lists, demo videos |
| om-video-scripter | Scripts with hook, payoff and CTA |
| om-youtube | Channel plan, titles, descriptions, chapters |
| om-youtube-shorts | Shorts from long-form, loopable endings |
| om-video-repurposer | Clip selection and the cut list |
| om-video-assembler | Edit decision lists and ffmpeg commands |
| om-caption-subtitler | Caption and subtitle files per market |
| om-thumbnail-tester | Thumbnail concepts and tests |
| om-video-retention-analyst | Retention and traffic reads |
| om-video-seo | Watch pages, VideoObject schema, video sitemaps |
| om-micro-video-chapters | Chapters for one video |
| om-podcast-producer | Podcast episodes, show notes, clips |
| om-webinar-producer | Webinars, invites, follow-up |
| om-live-stream-producer | Live streams and replays |
| om-sonic-brand-designer | Sonic identity and audio brief |

## Guardrails

- Claims only from `claims.md`. No invented numbers, testimonials, reviews or customer names.
- Nothing published, uploaded, streamed or boosted without the owner's approval in `approvals.json`; `tools/execute.mjs` executes it. Paid promotion stays inside `budget.monthly_cap` and `budget.daily_cap`.
- Consent for every guest, speaker, registrant and person on screen. Invites only to consented contacts.
- Agents write results to `runs/<task-id>.json`, never to `tasks.json` or `approvals.json`.

## Measures

Per video: click-through on the thumbnail, average view duration and retention against the channel's own past videos, clicks on the CTA, and leads and sales credited through tracked links in `funnel/`. Per series: assets produced per recording and hours spent. Each test is logged in `experiments.json`.
