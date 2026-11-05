---
name: om-agentic-commerce
description: "Make a product discoverable, comparable and purchasable by AI shopping and browsing agents: product data and feeds, structured data, agent-friendly pages and checkout, protocol readiness and measurement. Use when a product sells online and AI assistants or agents are a channel."
---

# Agentic commerce readiness

AI assistants now research, compare and sometimes buy for users. Agents favour products whose facts are explicit, consistent and machine-readable. Current protocols, partner programmes and dates change fast: read `om-knowledge-ai-tech` and `om-knowledge-ecommerce` first and cite them.

**1. Product truth, one source.** Name, variants, price, currency, tax, availability, shipping times and costs, returns, warranty, and the key specs buyers compare. Keep it identical on the page, in the feed, in structured data and in claims.md. Contradictions make agents skip a product or quote it wrongly.

**2. Feeds.** A complete product feed (Merchant Center or equivalent) with identifiers (GTIN, MPN, brand), rich attributes and accurate availability. Refresh it as often as stock changes.

**3. Structured data.** Product, Offer, AggregateRating (real reviews only), shipping and return policy markup, Organization, FAQ where visible. Validate it.

**4. Agent-friendly pages.**
- The specs agents compare are in HTML text, not only in images or scripts.
- A clean accessibility tree (labels, roles).
- Stable URLs.
- No interstitials that block automated reading.
- The crawler and agent access in robots.txt matches what the owner decided per AI agent.

**5. Checkout.**
- Guest checkout.
- Clear final price.
- Standard wallets.
- Machine-readable policies.
- Readiness for the agent checkout protocols your platform and payment provider support. Enrol only through official programmes, and only after the owner approves.

**6. Measurement.** Tag AI-referred traffic (referrer and UTM conventions); add "AI assistant" to self-reported attribution; run the `om-llm-visibility-lab` prompt panel monthly for buying-intent questions.

**7. Risk.**
- No dark patterns aimed at agents.
- No hidden text for AI.
- No fake reviews.
- Prices agents see must equal prices people pay.
