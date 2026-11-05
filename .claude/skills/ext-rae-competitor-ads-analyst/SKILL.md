---
name: ext-rae-competitor-ads-analyst
description: "Extract and analyze competitor advertising from public ad libraries (Facebook Ad Library, Google Ads Transparency Center, TikTok, LinkedIn). Identifies messaging patterns, creative formats, pain points targeted, and positioning gaps. Use for competitive intelligence, campaign planning, and creative inspiration."
license: MIT
origin: custom
author: Rebecca Rae Barton
author_url: https://github.com/thatrebeccarae
metadata:
  version: 1.0.0
  category: paid-media
  domain: competitive-intelligence
  updated: 2026-03-13
  tested: 2026-03-17
  tested_with: "Claude Code v2.1"
---

> **Whalyom note (added on install; not part of the upstream skill).** Source: https://github.com/thatrebeccarae/claude-marketing (MIT). Inside Whalyom: read `product.json`, `profile.md`, `claims.md` and `LEARNINGS.md` first. Use only claims from `claims.md`; treat every statistic, benchmark or example in this skill as a general heuristic, never as a claim about the product. Write drafts to `outbox/` and results to `runs/<task-id>.json`; nothing is published, sent, or changes ad spend without owner approval, and budget caps in `product.json` always hold. No fake accounts, vote manipulation, bulk unsolicited DMs, or scraping against a site's terms. Code, API and CLI examples are reference only: do not install packages or run them against live accounts. Related upstream skills are installed as `ext-rae-<slug>` where available; if one is missing, use the closest Whalyom skill or work from this file.

# Competitor Ads Analyst

Analyze competitor advertising from public ad libraries to understand what messaging, creative formats, and positioning strategies are working.


## Core Capabilities

- Extract ads from public ad libraries (Facebook, Google, TikTok, LinkedIn)
- Categorize ad creative by format, message type, and funnel stage
- Identify pain points competitors highlight (with frequency scoring)
- Map competitor positioning and find white space
- Extract headline and copy formulas
- Track creative format trends (UGC, before/after, testimonial, etc.)
- Generate competitive intelligence reports and swipe files

## Ad Library Access

| Platform | URL | Access |
|----------|-----|--------|
| Meta (Facebook/Instagram) | facebook.com/ads/library | Free, public |
| Google Ads | adstransparency.google.com | Free, public |
| TikTok | library.tiktok.com | Free, public |
| LinkedIn | linkedin.com/ad-library | Requires account |

## Workflow

### 1. Define Scope

- **Competitors:** 3-5 companies to analyze
- **Timeframe:** Last 30, 60, or 90 days
- **Platforms:** Which ad libraries to search
- **Focus:** Messaging, creative format, audience targeting, or all

### 2. Extract Ads

For each competitor, collect:
- Ad copy (headline, primary text, CTA)
- Creative format (image, video, carousel, UGC)
- Landing page URL
- Active date range (if visible)
- Platform and placement

### 3. Categorize

Classify each ad by:

**Message Type:**
- Pain point (problem-aware)
- Solution (product-aware)
- Social proof (testimonial, case study, press)
- Offer (discount, free trial, demo)
- Educational (how-to, tip, guide)
- Brand (awareness, positioning)

**Funnel Stage:**
- Top (awareness, problem education)
- Middle (consideration, comparison)
- Bottom (conversion, offer, urgency)

**Creative Format:**
- Static image
- Video (short <15s, medium 15-60s, long >60s)
- Carousel
- UGC-style
- Before/after
- Screenshot/product demo
- Testimonial quote card
- Data/stat visualization

### 4. Analyze Patterns

- **Pain point frequency:** Which problems appear most across competitors?
- **Message clustering:** Are competitors saying the same things?
- **Format preferences:** Which creative types are most used?
- **Positioning map:** Where does each competitor sit on key dimensions?
- **Gaps:** What messages/angles are NO competitors using?

### 5. Generate Output

Choose from: competitive report, swipe file, messaging matrix, or creative brief.

## Key Principles

1. **Analyze patterns, not individual ads.** One ad is an anecdote; 20 ads from 5 competitors is intelligence.
2. **Look for gaps, not just patterns.** The most valuable finding is what competitors are NOT saying.
3. **Separate observation from recommendation.** Report what you see, then separately recommend what to do with it.
4. **Date everything.** Competitive intelligence decays fast.
5. **Never copy, always adapt.** The goal is informed inspiration, not plagiarism.

For analysis frameworks and output templates, see [REFERENCE.md](REFERENCE.md).
