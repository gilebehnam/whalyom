# QA review: outbox items (om-qa-tester)

Checks: links and UTMs, title and meta length, one H1, unverified claims (C12-C19), unfilled placeholders, plan facts against claims.md.
Site-wide: product.json has no domain, so no real URLs exist; link and UTM checks cannot run yet. Brief says the product is fictional, so nothing may go live.

A1: fix. Removed the parenthetical builder note "(No outcome claims...)" from the page body. Title 58, meta 143 fine. Before build: real URLs with UTMs on both CTAs, the secondary link and "Full plan details".
A2: pass. Title 55, meta 154. No number of price options may be stated until the owner confirms. Same pre-build URL/UTM items as A1.
A3: block. Unfilled "[OWNER TO CONFIRM]" placeholders in the Pro card and the FAQ "What counts as a proposal"; owner decision 4 (Pro vs Free, a price change) is open. Unblock: owner answers, placeholders removed, rerun.
A4: block. Draft for lawyer review with many bracketed unknowns (entity, address, contact email, date, processors, hosting, retention, cookies) and L1-L5 open. The front-matter description says "not for publication", and the file has a draft banner and a "Reviewer notes (remove before publishing)" block; all must be stripped at build. No links or UTMs needed. Unblock: owner answers L1-L5, lawyer sign-off, placeholders filled.
A5: fix. Script only, not a publishable page, so no links or UTMs; the end card domain is a deliberate placeholder. Voiceover uses C2-C7 and C10 only. Changes: the unsupported "Three tools" hook was dropped (status quo not in claims.md); "2 or 3 options" in shot 4 became "the price options" (no number of options until the owner confirms). Remaining: shot 1 packs about 25 spoken words into 6 seconds (about 2.3 words per second needs about 10 s), so lengthen shot 1 or trim the line before recording. The upload itself needs a working prototype, a domain and the owner lifting the fictional-product hold.
