# SERP analysis: Quoteflow (sample), top 20 target queries

Task O14 · 2026-11-02 · Agent: om-serp-analyst · Skill: aaron-marketing:serp-analysis
TEST PRODUCT: brief.md says it does not exist. Nothing here is for publication.

## Evidence quality (read first)
- No keyword research file exists (no research/keywords.md), so the 20 queries come from the gap list in research/competitors.md. No volume or KD data (N/A, no SEO tool connected).
- Tooling limits: no Bash, so the keyless Firecrawl/Tavily SERP connectors could not run. WebSearch ran for 4 queries (Q1, Q2, Q9, Q13). It returns a result list without verified rank order, ads, AI Overviews, PAA or snippets. Those four are **Observed (partial)**: result types are real, positions and features are not verified.
- The other 16 are **Estimated** (model inference from category knowledge). Treat them as hypotheses until a live check is done.
- Locale: US/English default; UK/CA/AU variants not checked (pending).
- True Difficulty (0-100) is **Estimated** for all rows; no backlink data. Weights per skill: top-10 authority 25, page authority 20, content bar 20, backlinks needed 20, SERP stability 15.
- Site stage: new site, no domain, DR 0. "Fit" assumes a new site.

## Observed findings (4 queries)
- **Q1 "freelance proposal software"**: results are vendor feature pages (Wethos, SignNow, Plutio, Agiled, Offorte), plus affiliate-style roundups (Prospero blog, Agiled "12 tools ranked for 2026", Indy, Fitgap, Slashdot, topai). Independent review (Nusii on daveswift.com). Several thin or odd-domain pages (duckdns.org, pages.dev) appear. Intent: commercial investigation, list-led. Bonsai, HoneyBook, Proposify and PandaDoc were not prominent in what came back. Roundups list competitors with entry prices around $8-25/month, which makes Quoteflow's $19 Pro mid-pack, not a price advantage (vendor claims, unverified).
- **Q2 "freelance proposal template"**: mix of template downloads. Gumroad/Payhip paid ($12-25), Google Docs, ClickUp, Visme, PandaDoc, Bonsai (hellobonsai.com/proposal-template/freelance), Paperform, Papersign, Ryan Robinson blog, plus junk/hijacked .gov/.edu subdomains. Intent: transactional-informational, wants a downloadable file. Software vendors rank here with template pages that funnel to their tool.
- **Q9 "bonsai alternative"**: ambiguous. Results split between bonsai.sh/cbonsai, plants, and a wrongly matched Bonsai (field service software). Software-alternatives pages seen are directories (Product Hunt, Krowdbase, TechnologyCounter, Toolfinder). The right query form is "Bonsai alternatives for freelancers" or "hellobonsai alternative". Not worth targeting as a bare keyword.
- **Q13 "how to ask for a deposit in a proposal"**: help-center articles from field-service and design tools (DesignManager, Wethos, TaxDome, DripJobs, Ivy), plus Agiled hub posts and small blogs. No dominant authority publisher. Consensus content: deposit 25-50%, ask inside the proposal, frame as standard process, milestones for big jobs. Gap: help-center results are tool-specific; a tool-neutral guide with a script and a deposit-in-proposal feature is open.

## Query table
Intent: I informational, C commercial, T transactional, N navigational. Basis: O observed (partial), E estimated.

| # | Query | Intent | Dominant result type | Basis | True Difficulty | New-site fit | Play |
|---|---|---|---|---|---|---|---|
| 1 | freelance proposal software | C | Vendor feature pages + roundups | O | 70 | Low | Roundup inclusion via outreach; own landing page later |
| 2 | freelance proposal template | I/T | Template pages, docs, vendor funnels | O | 65 | Low-Med | Free downloadable template page with tool CTA |
| 3 | best proposal software for freelancers | C | Listicles, affiliate | E | 75 | Low | Get listed, do not out-write |
| 4 | proposal software for small agencies | C | Vendor pages, listicles | E | 68 | Low | Landing page; Team plan angle |
| 5 | web design proposal template | I/T | Template pages, vendor + Canva/Google Docs | E | 55 | Medium | Niche template + pricing options |
| 6 | graphic design proposal template | I/T | Same as Q5 | E | 55 | Medium | Niche template |
| 7 | web development proposal template | I/T | Same as Q5 | E | 52 | Medium | Niche template |
| 8 | social media proposal template | I/T | Template pages | E | 50 | Medium | Niche template |
| 9 | bonsai alternative(s) | C | Ambiguous; directories | O | 60 (ambiguous) | Low | Use "bonsai alternatives for freelancers" |
| 10 | honeybook alternative | C | Vendor "alternative" pages, listicles, G2/Capterra | E | 65 | Low-Med | Alternative page, only after competitor facts verified |
| 11 | proposify alternative | C | Same as Q10 | E | 55 | Medium | Alternative page |
| 12 | pandadoc alternative for freelancers | C | Same, PandaDoc brand-heavy | E | 60 | Medium | Alternative page |
| 13 | how to ask for a deposit in a proposal | I | Help-centers, small blogs | O | 35 | High | Tool-neutral guide + script |
| 14 | how to price a freelance project | I | High-authority blogs (Upwork, Fiverr, Wix style) | E | 72 | Low | Skip head term; target sub-angles |
| 15 | good better best pricing proposal | I | Sparse; contractor/HVAC content | E | 28 | High | Guide adapted to freelancers |
| 16 | proposal scope of work template | I/T | Template + legal/doc sites | E | 60 | Low-Med | Fold into template cluster |
| 17 | proposal vs quote | I | Dictionary-style, invoice-tool blogs | E | 40 | Medium | Short explainer |
| 18 | free proposal generator | T | Free tools, AI generators, vendor tools | E | 58 | Medium | Free tool fits $0 mode; AI-generator competition |
| 19 | proposal with e-signature | C/I | E-sign vendors (DocuSign, Dropbox Sign, PandaDoc) | E | 70 | Low | Skip |
| 20 | freelance proposal software UK / Australia | C | Few region-specific pages | E | 35 | High (unverified) | Check live; VAT/GST not a verified claim (C14) |

## Cross-query patterns
1. Head commercial terms (Q1, Q3, Q4) are won by roundups and vendor pages. The practical route is inclusion in others' lists and review sites (G2, Capterra), not ranking first.
2. Template queries (Q2, Q5-8, Q16) are the volume entry point. Vendors rank with a template page that gates to the tool. The winning format is a usable file or editable doc plus a short guide.
3. Low-competition openings (Q13, Q15, Q17, Q20) are informational, thin or tool-specific. They match the owner's gaps (deposit, price options, regions).
4. Brand-alternative queries need the competitor's actual pages checked before any copy (rule in competitors.md). Do not state competitor facts yet.
5. Noisy, low-quality domains rank for Q1/Q2, which suggests quality bar is uneven. That is a mild positive for a focused page, but it also means the SERP is volatile (stability input).

## Recommended order of attack (new site, free mode)
1. Q13 + Q15 guides (deposit, good-better-best). Easiest, and each demonstrates features C3 and C5.
2. Q2 plus niche template pages (Q5-8) as one cluster with a free template download.
3. Q18 free proposal generator (needs build; claims limited to verified C2-C6; do not say "in minutes", C12).
4. Alternative pages (Q10-12) after competitor verification.
5. Listing and review-site outreach to get into Q1/Q3 roundups.

Claim guardrails for any resulting content: use only C1-C11. No speed, price-advantage (C16), integration, EU, or payment-processing claims.

## Pending
- Live SERP check (features: AI Overview, PAA, snippets, video packs; exact top-10 order) for all 20, via the Firecrawl/Tavily connectors or a screenshot export. Needs Bash or a manual export.
- Keyword volume and KD, backlink counts (no SEO tool connected). All difficulty scores are Estimated until then.
- UK/CA/AU locale SERPs.
- Our own rankings: need a domain and Search Console.
- Competitor pages for Q10-12 (fetch and date their pricing/feature pages).
