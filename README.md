# TradePulse AI — Product-Focused Edition

A local Windows React + Express + SQLite research application for finding **potential US buyers of Indian singing bowls** and related handicrafts. This project uses real open data, not invented business records. **The original dark emerald website theme and structural layout are preserved.**

## First run on Windows

1. Install **Node.js 22.13+** (Node 24 recommended). Internet is required to install dependencies and search live open-data sources.
2. **Close the old TradePulse API/dashboard terminals first** so port 4100 cannot keep running the previous yoga-heavy code. Unzip to a NEW folder, open `TradePulse-AI`, and double-click `START-TRADEPULSE-WINDOWS.bat`. It creates `server/.env`, installs dependencies, and launches the API plus dashboard.
3. Open **http://localhost:3000** (or the port printed by Vite). Click **Discovery**, select Singing Bowls + city/state, and **Run Discovery Scan**.
4. Watch **Extraction Stream** for actual provider stages, fetched listings, attempted website checks, website rejection reasons, and saved counts.
5. Open **Buyers**. The unified Buyers directory shows **High Relevance** and **Potential Buyers** together. Each card/row shows company name, location, website, public email, phone, relevance tier, qualification reason, evidence URL, and manual review status. Businesses without email carry a clear "Missing Contact" label and are excluded from contact-ready exports.
6. Read each dossier's **exact excerpt and supporting URL**. Confirm that the business is truly a relevant potential purchaser and its contact is suitable. Only then click **Mark reviewed**. The **Export Reviewed CSV** button produces the internship's exact nine columns.

### Discovery data sources (from the Gemini free-data architecture)

| Provider | Status | Configuration | Notes |
| --- | --- | --- | --- |
| **Overture Maps** | Enabled by default | `ENABLE_OVERTURE=true` | Direct public places GeoParquet queried by DuckDB. Does not provide verified buyer intent or email deliverability. |
| **Geoapify** | Optional | `GEOAPIFY_API_KEY=...` | API key and current provider quotas apply. Uses location-filtered retail categories, pages and deduplication. |
| **OpenStreetMap / Overpass** | Disabled by default | `ENABLE_OVERPASS=true` | Public shared resources; minimum one-minute gap between requests. Respect provider fair-use rules. |
| **First-party business websites** | Enabled | No API key | Short, timeout-limited crawl of homepage, visible product/shop links, and contact pages. Emails are public/unverified. |

**No Google Places connector or Google Places billing configuration is included.** MapLedger bulk data collection is excluded due to the restrictions noted in the Gemini document. Do not assume any free-provider quota is unlimited.

### Discovery capacity and quality

- Defaults: `OVERTURE_GRID=2` and `OVERTURE_ROWS_PER_TILE=3000` (up to **12,000 raw Overture listings** across four tiles, plus optional provider listings); `MAX_WEBSITES_PER_SCAN=900`; `MAX_LEADS_PER_SCAN=1800`; concurrency 5.
- Modify `server/.env` to tune limits. Runtime caps: maximum 5,000 qualified leads, 2,500 website checks, 4×4 spatial tiles, and 8,000 rows per tile. Bigger scans may use substantially more network and CPU.
- No number of real buyers is guaranteed. A high scan cap does not invent leads.
- Generic yoga/puppy-yoga studios, unrelated instrument specialists, schools and religious organizations are excluded from Singing Bowls screening.
- **Strong match** requires a first-party product phrase with nearby selling evidence (such as product catalogue, inventory or add-to-cart); **Potential** means a specialty retailer has a product mention without confirmed inventory; **Research** means no evidence strong enough to treat it as an outreach contact. Even Strong match does **not** prove importing activity or intent to buy from you.
- Websites may be unavailable, dynamic, blocked, or indexed incompletely. Inspect every candidate before contact. Progress counts are checks *attempted*, not proof every website responded.

## Gmail outreach (optional; explicit user approval required)

1. In Google Cloud, enable the **Gmail API**, configure a personal OAuth consent screen and add your Gmail as a **test user** if in Testing mode.
2. Create/use a **Web application** OAuth 2.0 client (recommended for simple localhost setup), with Authorized redirect URI `http://localhost:4100/api/gmail/callback`. Review your current client type if unsure.
3. Enter `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_CLIENT_TYPE=web` and `GOOGLE_REDIRECT_URI` in local `server/.env`; **do not share credentials**. Restart the backend after edits.
4. In **Settings**, click **Connect Gmail**; you must personally authorize in Google's browser screen. In **Settings**, save your genuine sender name and real physical mailing address.
5. Review a relevant buyer independently, open **Outreach**, edit the template, preview, select up to **10** reviewed recipients, type `SEND N`, and confirm in the UI. **Nothing sends automatically**. Up to **50 email attempts per UTC day**. Avoid contacting suppressed/recently contacted buyers; honor opt-outs.
6. Open **Replies & History** and manually click **Check tracked replies**. Only recorded Gmail threads and the recipient address are matched. This is not comprehensive inbox synchronization.

`gmail.readonly` is a restricted scope; Google verification or testing-mode refresh-token expiry may affect access. **Live OAuth / sending and replies require your account, and cannot be guaranteed working on your machine from a code-only test.** The token encryption key is stored locally in `server/.tradepulse-token-key`; back it up with the DB if migrating computers. Sending status means Gmail API accepted the request, not guaranteed delivery.

### OpenAI drafting (optional)

Since you do not have OpenAI API billing/credits, the app works with editable **free templates**. To enable OpenAI drafting later, set `ENABLE_OPENAI=true` and `OPENAI_API_KEY=...` in `server/.env`; API usage may be billed independently of ChatGPT Plus.

## CSV format

**DATE | SR NO. | CATEGORY | PRODUCT NAME | COMPANY NAME | LOCATION | WEBSITE | EMAIL | CONTACT NO.**

Only *manually reviewed, non-suppressed qualified buyers with public emails* are exported. Empty phone numbers remain empty; no facts are fabricated. CSV cells are escaped to reduce spreadsheet formula injection.

## Manual startup and tests

```powershell
# From the TradePulse-AI project root:
if (!(Test-Path server\.env)) { Copy-Item server\.env.example server\.env }
npm ci
npm --prefix server ci
# One terminal:
npm run dev:api
# Another terminal:
npm run dev
# Tests:
npm --prefix server test
npm run build
```

The Windows launcher performs installation automatically. Node modules and secrets are intentionally **not** bundled; npm installation needs a network connection. If live Overture/S3 is unavailable, check server logs and provider reachability; do not substitute made-up data.

## References

- Overture Places: https://docs.overturemaps.org/guides/places/ and https://docs.overturemaps.org/getting-data/
- Geoapify Places: https://apidocs.geoapify.com/docs/places/
- OpenStreetMap Overpass usage: https://wiki.openstreetmap.org/wiki/Overpass_API
- Gmail API: https://developers.google.com/workspace/gmail/api/guides

See `TEST-REPORT.md` for verified tests and outstanding live checks.


## How a business is classified (evidence-based)

| Class | Tier | Meaning |
|---|---|---|
| confirmed seller | Strong match | Singing bowls shown with price / add-to-cart / stock / product data, or "shop/buy ... singing bowls", on a non-studio business |
| wholesale evidence | Strong match | Singing bowls next to wholesale / trade / distributor wording |
| retailer mention | Potential | Specialty retailer mentions the product; availability unconfirmed |
| equipment user | Potential | Studio/service describing (first person) sound-healing sessions with the instruments; **purchasing intent not verified**; capped per scan |
| research / mention only / adjacent retailer / unverified site | Research Leads | Some relevance or the site could not be read; kept with the reason |
| not relevant | not saved | No meaningful relationship |

Every Buyer Dossier shows the exact excerpt, the page URL, the classification reason, how the e-mail was found (website or listing), and that mailbox verification was **not** performed.

## Reading the Extraction Stream
Listings by provider, category prospects, websites read vs failed (by reason: DNS, SSL, timeout, blocked, robots, ...), product matches, e-mails found / rejected, outreach-ready records, research leads, and a rejection breakdown. If `blocked by site` dominates, those sites refuse automated access and are intentionally not bypassed.
