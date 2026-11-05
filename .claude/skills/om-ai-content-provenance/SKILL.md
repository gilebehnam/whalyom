---
name: om-ai-content-provenance
description: "Label, track and disclose AI-generated or AI-edited images, video, audio and text in marketing: provenance metadata, platform AI labels, consent for likeness and voice, and a register of where synthetic media is used. Use for every generative asset before it reaches the outbox."
---

# AI content provenance and disclosure

For every generated or materially AI-edited asset, record in `research/ai/provenance.md`:
- the asset path
- the tool and model
- the prompt summary
- the human editor
- the date
- the disclosure used
- the consent file for any real person's likeness or voice

**Disclose.**
- Use the platform's own AI label where it exists (Meta, TikTok, YouTube, Google Ads disclosure settings).
- Show a visible note for realistic synthetic people, voices or scenes.
- Chatbots and voice agents say they are AI at the start.
- Follow the current rules in `om-knowledge-ai-regulation` and `om-knowledge-ai-tech`, for example EU AI Act transparency duties and FTC guidance.

**Preserve provenance.** Keep provenance metadata the generator embeds (for example Content Credentials / C2PA, watermarks). Do not strip it in export or compression, and note it in the register.

**Never.**
- A real person's face or voice without written consent.
- "Customers", "employees" or "experts" who do not exist.
- Generated screenshots of a product UI that does not exist.
- Synthetic before/after results.
- Deepfakes of public figures, even as parody, in ads.

**Review.** `om-ai-act-officer` and `om-visual-qa` check the register entry before an approval is created. A missing entry blocks the asset.
