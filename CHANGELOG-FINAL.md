# TradePulse AI — Discovery & Extraction Fix (latest)

## Root causes found in the previous build and fixed
1. **Redirected websites were silently discarded.** `inspectPublicWebsite` fetched http→https / non-www→www sites and then threw the pages away because the final origin differed from the listed one, with no error recorded. Now the final address becomes the site and only social/parking redirects are refused.
2. **"Strong match" meant very little.** The selling test accepted generic words (`shop`, `order`, `products`, `handmade`, `shipping`) and reported a fixed 90% confidence. Replaced by an evidence class + exact excerpt + source URL + reason; transactional markers only (price, add-to-cart, stock, product schema, "shop/buy ... singing bowls"); blog/event/about pages cannot supply selling evidence alone. No percentages.
3. **Generic gift shops filled the candidate pool** (every `gift_shop` scored 72). Tiered listing scores: 100 / 90 / 80 (importers, wholesalers, handicraft) / 60 (generic gift shop); specialists are always inspected first.
4. **Most relevant listings vanished when a site failed.** Unreachable specialist listings are now kept as research leads with the exact failure reason.
5. **No failure diagnostics.** 19 failure categories (DNS, SSL, timeout, blocked, rate-limited, 404, 5xx, robots, redirect-to-social, etc.) counted live and in the summary.
6. **Contact pages were almost never reached**, JSON-LD product data was stripped, JS-only sites looked like "no product". Fixed (priority queue, JSON-LD, JS-shell detection, sitemap product discovery).
7. **Overture SQL** now matches `taxonomy.primary` + `hierarchy` + `alternates` (underscores normalised), orders by relevance before `LIMIT`, de-duplicates across tiles, warns when a tile hits the cap, optionally includes rows with empty locality.
8. **Saved order flipped on every save; saves were not atomic.** New `store.js` (transactional, stable order).
9. Fake progress fill removed; progress is real counters only.

## New in this version
- robots.txt compliance (Disallow/Allow/Crawl-delay/Sitemap); 401/403/429/CAPTCHA are reported, never bypassed.
- Sitemap-based discovery of singing-bowl product pages.
- E-mail: placeholder/platform/technical addresses rejected; DNS mail-domain check (labelled NOT mailbox verification); source URL and source type (website vs listing) stored.
- Four-way classification: confirmed seller / wholesale evidence (Strong), retailer mention / **equipment user** (Potential), research, irrelevant. Studios are low-priority and capped; a mention never becomes a purchasing claim.
- Site-check cache (resume after interruption, fast re-scans); configurable caps; per-provider listing counts, evidence-class counts, Overture categories seen and a full rejection breakdown in the Extraction Stream.
- Tests: 63 backend tests, including real DuckDB SQL against an Overture-shaped parquet file and a full HTTP end-to-end run.

The original theme (`src/index.css`) is unchanged.

---

# TradePulse AI — Consolidated Repair

- Preserved original `src/index.css` unchanged, including dark/emerald brand tokens, fonts and spacing.
- Removed Google Places API endpoints, UI cards, environment fields and dependencies. Removed the unused TomTom preview UI/backend to keep focus on the requested open-data stack.
- Replaced yoga/wellness-first discovery with specialty-retail-focused Overture, optional Geoapify pagination, and optional rate-limited Overpass.
- Raised defaults to up to 12,000 raw Overture listings, 900 websites checked and a target of 1,800 qualified prospects per scan; exposed higher safe configuration caps.
- Added evidence excerpts and exact product URLs; separated product sale evidence from mere mentions.
- Excluded generic yoga studios, churches, schools and unrelated instrument retailers.
- Introduced separate Research Leads storage and a Buyers page tab without redesigning site layout.
- Added real scan stages, website check counter and a progress bar. Rejection statistics now distinguish failed websites, missing product evidence and missing public emails.
- Preserved existing opt-in Gmail OAuth, manual send confirmation, daily 50 attempt cap, optional OpenAI drafts, reply tracking and nine-column CSV export.
- Added false-positive regression tests based on Pawty Yoga and unrelated instrument shops.
