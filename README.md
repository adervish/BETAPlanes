# BETAPlanes

Flight tracker for Beta Technologies test planes. Scrapes flight history from FlightAware's public website, stores it in Cloudflare D1, and displays routes on Google Maps with per-plane and per-flight toggle controls.

## How It Works

### Data Pipeline

1. **Scraper** fetches FlightAware's public flight pages for each tail number
2. Flight list pages contain embedded JSON (`var trackpollBootstrap = {...}`) with flight metadata and track coordinates
3. If inline track data isn't available, the scraper fetches the individual tracklog page and parses the HTML table
4. Flight and track data is stored in Cloudflare D1 (SQLite)
5. A daily cron job (6 AM UTC) re-scrapes all planes automatically
6. Fetched HTML pages are cached in D1 — tracklog pages are cached forever, flight list pages are re-fetched each run

### Architecture

```
FlightAware ──scrape──> Cloudflare Worker (Hono) ──store──> D1 Database
                              │
                              ├── /api/planes        GET  plane list
                              ├── /api/flights       GET  flights by tail
                              ├── /api/tracks/:id    GET  track points
                              ├── /api/stats         GET  per-plane stats
                              ├── /api/stats/daily   GET  daily flight hours
                              ├── /api/scrape        POST trigger full scrape
                              ├── /api/scrape/flight POST scrape a specific flight URL
                              ├── /api/scrape/logs   GET  scrape log history
                              ├── /logs              GET  scrape log viewer (HTML)
                              ├── /:tailNumber       GET  single-plane view
                              └── /                  GET  main app (static)
```

### Frontend

Vanilla HTML/CSS/JS served as static assets. No build step, no framework.

- **Google Maps** with dark theme, color-coded polylines per plane, click for flight details
- **Sidebar** with plane cards, toggle switches, flight stats, and expandable flight lists
- **Daily chart** showing aggregate flight hours per day (canvas-based bar chart)

### Planes

| Tail | Color | Default View |
|------|-------|:---:|
| N916LF | Red (#e74c3c) | Yes |
| N336MR | Blue (#3498db) | Yes |
| N214BT | Green (#2ecc71) | Yes |
| N401NZ | Orange (#f39c12) | Yes |
| N709JL | Purple (#9b59b6) | Yes |
| N521SS | Teal (#1abc9c) | No |
| N27SJ | Dark Orange (#e67e22) | No |
| N556LU | Pink (#e84393) | No |

Non-default planes are scraped but only visible when navigating to `/<TAIL_NUMBER>` (e.g. `/N521SS`).

## Project Structure

```
BETAPlanes/
  src/
    index.ts              # Hono app, route registration, cron handler
    types.ts              # Shared TypeScript interfaces
    lib/
      scraper.ts          # FlightAware scraper (runs in Worker)
    routes/
      planes.ts           # /api/planes
      flights.ts          # /api/flights
      tracks.ts           # /api/tracks/:id
      stats.ts            # /api/stats, /api/stats/daily
  public/                 # Static assets (served by Cloudflare)
    index.html
    css/style.css
    js/
      app.js              # Init, URL-based plane filtering
      map.js              # Google Maps, polylines, InfoWindows
      sidebar.js          # Plane cards, toggles, state
      chart.js            # Daily flight hours bar chart
      api.js              # Fetch wrapper
  scripts/
    scrape.ts             # CLI scraper (alternative to Worker scraper)
  schema.sql              # D1 tables, indexes, seed data
  wrangler.toml           # Cloudflare Workers config
```

## Setup

### Prerequisites

- Node.js
- A Cloudflare account
- Wrangler CLI (`npm install -g wrangler` or use npx)

### Install

```bash
npm install
```

### Initialize the Database

Create the D1 database (first time only):

```bash
npx wrangler d1 create betaplanes-db
# Copy the database_id into wrangler.toml
```

Initialize the schema:

```bash
# Local
npm run db:init

# Remote (production)
npm run db:init:remote
```

## Running Locally

```bash
npx wrangler dev
```

This starts the dev server (usually at `http://localhost:8787`). It uses the local D1 database.

### Populating Data

**Option 1: Trigger the Worker scraper**

```bash
curl -X POST http://localhost:8787/api/scrape
```

This scrapes FlightAware for all configured planes and stores the results. Takes a minute or two due to rate limiting.

**Option 2: Use the CLI scraper**

```bash
npm run scrape          # writes to local D1
npm run scrape:remote   # writes to remote D1
```

The CLI scraper caches raw HTML files in `scripts/cache/` for faster re-runs during development.

### Scraping a Specific Flight

If a flight isn't picked up by the automatic scraper (e.g. old flights not listed on the live page), you can scrape it by URL:

```bash
curl -X POST http://localhost:8787/api/scrape/flight \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.flightaware.com/live/flight/N521SS/history/20251218/1958Z/KLDJ/KDXR"}'
```

## Deploying

```bash
# Initialize remote DB (first time)
npm run db:init:remote

# Deploy the Worker
npm run deploy
```

The Worker is deployed to `https://betaplanes.acd.workers.dev`. The daily cron trigger runs at 6 AM UTC automatically.

## Useful Commands

```bash
# Check scrape logs
curl https://betaplanes.acd.workers.dev/api/scrape/logs

# View scrape logs in browser
open https://betaplanes.acd.workers.dev/logs

# Query D1 directly
npx wrangler d1 execute betaplanes-db --local --command="SELECT COUNT(*) FROM flights;"
npx wrangler d1 execute betaplanes-db --remote --command="SELECT COUNT(*) FROM flights;"

# Clear cached data for a plane and re-scrape
npx wrangler d1 execute betaplanes-db --local --command="DELETE FROM track_points WHERE flight_id LIKE '%N521SS%';"
npx wrangler d1 execute betaplanes-db --local --command="DELETE FROM flights WHERE tail_number = 'N521SS';"
npx wrangler d1 execute betaplanes-db --local --command="DELETE FROM scrape_cache WHERE cache_key LIKE '%N521SS%';"
```

## Adding a New Plane

1. Add the tail number to `TAIL_NUMBERS` in both `src/lib/scraper.ts` and `scripts/scrape.ts`
2. Insert the plane into the database:
   ```bash
   npx wrangler d1 execute betaplanes-db --local \
     --command="INSERT OR IGNORE INTO planes (tail_number, display_name, color, show_default) VALUES ('NXXXXX', 'NXXXXX', '#hexcolor', 0);"
   npx wrangler d1 execute betaplanes-db --remote \
     --command="INSERT OR IGNORE INTO planes (tail_number, display_name, color, show_default) VALUES ('NXXXXX', 'NXXXXX', '#hexcolor', 0);"
   ```
3. Add the plane to the `INSERT` statement in `schema.sql` for future DB initializations
4. Set `show_default` to `1` to show on the main page, or `0` to only show at `/<TAIL_NUMBER>`
5. Deploy: `npm run deploy`

## Notes

- FlightAware rate limits aggressively. The scraper may get `429` responses — these are logged and the affected pages will be retried on the next run.
- The live flight page (`/live/flight/{tail}`) only includes recent flights in its embedded JSON. Older flights that aren't listed there need to be scraped individually using the `/api/scrape/flight` endpoint.
- Track data is cached forever in D1. Flight list and history pages are re-fetched on each scrape run to pick up new flights.
- The CLI scraper (`scripts/scrape.ts`) caches HTML to the filesystem in `scripts/cache/`. Use `--no-cache` to force re-fetch.
