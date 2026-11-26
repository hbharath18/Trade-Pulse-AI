# Verification — TradePulse AI (latest build)

## Executed in this build environment (all passed)
- `npm test` in `server/`: **63/63** — classifier, crawler (redirects, DNS/SSL/timeout/403/429/5xx, robots.txt, sitemap, JSON-LD, MX check, placeholder e-mails), discovery pipeline, SQLite store, CSV, Gmail safeguards, **real DuckDB SQL** against a parquet file with the Overture places schema shape, and a **full HTTP end-to-end run** (fake businesses + fake websites -> /api/discover -> SQLite -> /api/leads, /api/research, status -> CSV).
- Mutation checks: re-introducing the original defects (exact-origin redirect rule, studio-as-seller, loose "shop/order" cue, flipping save order, retrying a 403, ignoring robots.txt, skipping mail-domain check, cache never hitting, SQL on taxonomy.primary only) made the relevant tests fail.
- `tsc --noEmit` and `vite build` (production bundle) succeed. `src/index.css` is unchanged.
- The Express server starts and answers all API routes on a clean database.

## NOT verified here — please check on your machine
- **Live Overture (S3), Geoapify and Overpass queries.** The sandbox could not reach them. The Overture field structure (taxonomy.primary/hierarchy/alternates, addresses, websites) was confirmed from the published schema, but I could not download the official category list; the Extraction Stream shows the real "Overture categories seen" after your first scan.
- **Real websites.** All crawling tests use simulated sites. Real-world blocking, slow hosts and JavaScript-only shops will vary; the failure breakdown tells you which.
- **Gmail OAuth, real sending, real reply tracking, OpenAI drafting.** Tested only with mocked Google. No email was sent.
- Windows launcher (`START-TRADEPULSE-WINDOWS.bat`) was not executed (Linux sandbox); its logic is unchanged except it needs no new dependencies.

Public e-mails are not mailbox-verified. A product mention or a seller's inventory does not prove a business will buy from you. Review each record before sending.
