# Whalyom backlog

Updated 2026-11-06T19:37:21.270Z. Ranked by priority (gap × weight). "owner" items need an account, key or decision only the owner can give.

1. **[owner] Attach a real product with a domain (/whalyom attach <domain>) and the site tracker, so every claim about Whalyom is measured on real buyers.** (priority 22.5)
   Proof of results: leads and verified sales on real products: 0.5/5 (2 active product(s), 0 with a site, 0 with leads, 0 with sales, 0 with verified revenue)
2. **[owner] Connect the site (satellite or edge), email sending (Resend), payments (Stripe read key) and one social or ad account; Whalyom cannot open accounts or accept terms itself.** (priority 15)
   Connected to the channels it acts on: 0/5 (0 connected site(s); channel keys present: none)
3. **[system] Approve or auto-approve (earned autonomy) the first replies; run om-lead-to-sale on every daemon cycle that finds new leads.** (priority 12)
   Speed to lead: no lead waits past its limit: 2/5 (no leads yet to answer)
4. **[system] Feed state/agent-outcomes.json into om-evolve: improve or retire agents whose items reach the market without results, copy the playbooks of agents that sell.** (priority 12)
   Agents judged by sales, not by output: 1/5 (no agent output has reached the market yet)
5. **[owner] Switch on earned autonomy (product.json autonomy.earned: true) so action types the owner keeps approving unchanged run on their own; caps, compliance and price stay guarded.** (priority 10.5)
   Zero-touch operation inside the owner's guardrails: 1.5/5 (0 item(s) went out, 0 without a human click; earned autonomy on for 2 of 2 product(s))
6. **[system] om-product-manager keeps pm/competitors.json from competitors' own pages and ships the missing features with the highest buyer impact first.** (priority 9)
   Ahead of competitors feature by feature: 2/5 (no competitor matrix yet (pm/competitors.json))
7. **[system] Route work by results: the mega heads delegate to specialists with outcome credit first; agents unused for 90 days become candidates to merge.** (priority 6.4)
   The workforce is used, not just listed: 1.8/5 (58 of 536 agents have done at least one task)
8. **[system] Self-serve sign-up and billing for other companies** (priority 5)
   built (tenants, plans, Stripe Checkout, signed webhook, edge routes; see Section B) but not yet run against live Stripe. The owner still has to create the Stripe products and recurring prices (growth, scale, agency), add the webhook endpoin
9. **[system] Real-time push from the cloud** (priority 5)
   `tools/cloud/realtime.mjs` streams the live documents from the edge (`GET /live/stream`, SSE) for hosted clients. The Command Center artifact also updates instantly while a Claude session runs; the hourly GitHub daemon writes the same state
10. **[owner] Accounts and keys** (priority 4)
   ad accounts with payment methods, Meta System User token, Resend, Stripe read key, site repository, webhooks or n8n for other channels; GitHub repository secrets for the hourly daemon. Whalyom cannot create accounts, add payment methods or 
11. **[owner] Keys for the native connectors** (priority 4)
   X (posting and ads), Reddit Ads, Apple Search Ads, Google, Microsoft, TikTok and LinkedIn all have native connectors in tools/connectors/; each needs the owner's API keys. Reddit and Apple request shapes are marked "verify against current A
12. **[owner] Keys for the 2026-11-04 connectors** (priority 4)
   Instagram and Facebook (Graph API tokens with app review), TikTok posting (Content Posting API token, audited app for public posts), Twilio voice (account, number and a public https webhook base), Amazon Ads and Walmart Connect (advertiser 
