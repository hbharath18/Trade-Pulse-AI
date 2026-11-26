# TradePulse AI — Multi-Product B2B Lead Discovery & Gmail Outreach Engine

A full-stack, local-first B2B export intelligence and outreach platform built with **React, TypeScript, Vite, Node.js, Express, and SQLite (`node:sqlite` + DuckDB)**. TradePulse AI discovers, qualifies, and manages verified US retail and wholesale buyers for Indian export products—including **Singing Bowls, Indian Handicrafts, Home Decor, Brass Lamps, and Handcrafted Accents**—using real open-data sources and human-approved Gmail outreach.

---

## Key Features

- **Multi-Source Open-Data Discovery Pipeline**: Aggregates business listings from **Overture Maps (GeoParquet via DuckDB)**, **Geoapify Places**, **OpenStreetMap Overpass**, and **TomTom Search**, followed by concurrent, timeout-bounded first-party website crawling.
- **Evidence-Based Buyer Classification**: Scores and classifies businesses into **High Relevance (`Strong match`)**, **Potential Buyers (`Potential`)**, and **Research Leads** with exact page excerpts, source URLs, DNS MX/domain email checks, and a **Revalidate** engine to prune misclassified records.
- **Workflow-Categorized Buyer Directory**: Separates prospects into **Needs Review**, **Reviewed · Ready to Mail**, and **Mail Sent / Replied**, with single-dossier inspection, multi-select **Bulk Approval**, and do-not-contact suppression management.
- **AI-Assisted & Human-Approved Gmail Outreach**:
  - Connects via **Google OAuth 2.0 (PKCE)** with AES-256-GCM encrypted token storage.
  - Generates executive B2B wholesale pitch drafts via **OpenAI (`gpt-5-mini`)** with dynamic personalization tokens (`{companyName}`, `{city}`, `{state}`, `{product}`, `{evidence}`, `{website}`).
  - **Order-Wise Inline Poster Routing**: Automatically renders product posters (`Image1.png` → Singing Bowls, `Image2.png` → Indian Handicrafts, `Image3.png` → Home Decor, etc.) inline at the top of HTML emails alongside shared PDF catalogs.
  - Enforces explicit batch approval (`SEND N`), daily rate caps (`50/day`), physical postal address footers, and unsubscribe instructions.
- **Reply & Bounce Synchronization + 9-Column CSV Exports**: Syncs Gmail threads to log buyer replies and auto-suppress bounced addresses (`mailer-daemon` / 550 DSNs), and exports clean `DD-MM-YYYY` 9-column CSV files filtered by **All Time** or **Date**.

---

## Architecture & Tech Stack

| Layer | Technologies |
| --- | --- |
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS, Lucide Icons |
| **Backend API** | Node.js (v22.13+), Express, Built-in `node:sqlite` (`DatabaseSync`) |
| **Data & Crawling** | DuckDB (Overture Maps GeoParquet on S3), Geoapify API, OSM Overpass API, TomTom API, Custom HTML/Contact Crawler |
| **AI & Outreach** | OpenAI Chat Completions API (`gpt-5-mini`), Gmail REST API v1 (`gmail.send`, `gmail.readonly`), RFC-2047/2387 MIME Builder |

---

## Discovery Data Sources

| Provider | Default Status | Configuration (`server/.env`) | Role in Pipeline |
| --- | --- | --- | --- |
| **Overture Maps** | Enabled | `ENABLE_OVERTURE=true` | Queries public GeoParquet places across spatial tiles via DuckDB (`OVERTURE_GRID=2`, `3000` rows/tile). |
| **First-Party Websites** | Enabled | `MAX_WEBSITES_PER_SCAN=900` | Crawls up to 6 pages per domain (`WEBSITE_CONCURRENCY=5`) to extract product evidence and public emails. |
| **Geoapify Places** | Enabled (Optional) | `GEOAPIFY_API_KEY=...` | Supplements retail/specialty store coverage (`GEOAPIFY_PAGES_PER_SCAN=2`). |
| **OpenStreetMap Overpass** | Enabled (Optional) | `ENABLE_OVERPASS=true` | Queries community-mapped specialty shops with polite rate-limiting. |
| **TomTom Search** | Enabled (Optional) | `TOMTOM_API_KEY=...` | Expands commercial POI discovery across target US cities. |

---

## Buyer Classification Rubric

| Classification | Directory Tier | Criteria |
| --- | --- | --- |
| **Confirmed Seller** | High Relevance (`Strong match`) | First-party product pages showing pricing, add-to-cart, inventory, or explicit `"shop/buy"` language on a retail/wholesale domain. |
| **Wholesale Evidence** | High Relevance (`Strong match`) | Product keywords paired with wholesale, trade, importer, or distributor terminology. |
| **Retailer Mention** | Potential Buyer (`Potential`) | Specialty retailer mentioning the product category without confirmed live stock. |
| **Equipment User** | Potential Buyer (`Potential`) | Verified studio/practitioner describing active instrument use (capped per scan via `MAX_EQUIPMENT_USER_LEADS=10`). |
| **Research / Unverified** | Excluded from Outreach | Sites blocked by robots/WAF or lacking commercial product evidence. |

---

## Quick Start (Windows / Local Development)

### 1. Prerequisites
- **Node.js 22.13+** (or Node 24)
- **Git**

### 2. Installation & Environment Setup
```powershell
git clone [https://github.com/hbharath18/Trade-Pulse-AI.git](https://github.com/hbharath18/Trade-Pulse-AI.git)
cd Trade-Pulse-AI

# Install frontend and backend dependencies
npm ci
npm --prefix server ci

# Create your local environment config from the template
Copy-Item server\.env.example server\.env