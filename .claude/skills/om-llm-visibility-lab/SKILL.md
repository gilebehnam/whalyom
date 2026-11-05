---
name: om-llm-visibility-lab
description: "Measure a brand's presence in AI assistant answers (ChatGPT, Perplexity, Gemini, Copilot, Claude, AI Overviews) with a repeatable prompt panel, sampling and simple statistics, and turn gaps into tasks. Use for AI visibility baselines, monthly tracking and after GEO/AEO work."
---

# LLM visibility lab

AI answers vary run to run, so one screenshot proves nothing. Measure like a survey.

**Panel.** 30–60 buyer prompts in the buyer's own words (from VoC and search data), tagged by:
- intent: category, comparison, problem, brand, price
- persona
- market and language

Freeze the panel; version any change.

**Sampling.**
- Each prompt runs at least 3 times per engine and market, in a clean session with no personalization.
- Record the date, the engine and the mode (search on or off).
- Store the raw answers in `research/ai/visibility/<date>/`.

**Metrics per engine.**
- **Mention rate:** answers naming the brand ÷ answers.
- **Position:** the brand's rank among products named.
- **Citation rate:** answers linking the brand's own pages.
- **Sentiment and accuracy:** answers stating something false about the brand get flagged for correction.
- **Share of voice:** brand mentions ÷ all competitor mentions.

**Statistics.**
- Report counts with a 95% interval: Wilson interval for proportions.
- Call a change real only if the intervals do not overlap or the sample is large enough. Say so when it is not.

**From gaps to tasks.**
- Missing in category prompts → entity and third-party mentions (om-entity-builder, om-pr-outreach).
- Missing citations → citable passages and schema (om-geo-optimizer).
- Wrong facts → fix the source pages, and publish clear facts on the brand's own pages.
- Competitor dominance on a source the engines cite → om-comparison-pages.

Do not try to manipulate AI answers with hidden text, fake reviews or spam sites; check `om-knowledge-ai-search` for current engine rules.
