import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Bindings } from "./types";
import planes from "./routes/planes";
import flights from "./routes/flights";
import tracks from "./routes/tracks";
import stats from "./routes/stats";
import features from "./routes/features";
import plates from "./routes/plates";
import search from "./routes/search";
import { runScraper, scrapeFlightUrl } from "./lib/scraper";

const app = new Hono<{ Bindings: Bindings }>();
app.use("*", cors());

app.get("/api/config", (c) => {
  return c.json({ mapsApiKey: c.env.GOOGLE_MAPS_API_KEY });
});

app.route("/api/planes", planes);
app.route("/api/flights", flights);
app.route("/api/tracks", tracks);
app.route("/api/stats", stats);
app.route("/api/features", features);
app.route("/api/plates", plates);
app.route("/api/search", search);

app.post("/api/scrape", async (c) => {
  const logs = await runScraper(c.env.DB);
  return c.json({ ok: true, logs });
});

app.post("/api/scrape/flight", async (c) => {
  const body = await c.req.json<{ url: string }>();
  if (!body.url) return c.json({ error: "url is required" }, 400);
  const logs = await scrapeFlightUrl(c.env.DB, body.url);
  return c.json({ ok: true, logs });
});

app.get("/api/scrape/logs", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT id, started_at, finished_at, log_text, flights_found, tracks_added FROM scrape_logs ORDER BY id DESC LIMIT 30"
  ).all();
  return c.json(result.results);
});

// Serve the SPA for /:tailNumber routes (non-default planes)
app.get("/:tail{N[A-Z0-9]+}", async (c) => {
  const tail = c.req.param("tail");
  // Verify it's a real plane in our DB
  const plane = await c.env.DB.prepare("SELECT tail_number FROM planes WHERE tail_number = ?").bind(tail).first();
  if (!plane) return c.notFound();
  // Serve index.html — the frontend JS reads the URL path
  return c.env.ASSETS.fetch(new Request("https://placeholder/index.html"));
});

app.get("/logs", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT id, started_at, finished_at, log_text, flights_found, tracks_added FROM scrape_logs ORDER BY id DESC LIMIT 30"
  ).all();
  const logs = result.results as Array<{
    id: number;
    started_at: string;
    finished_at: string;
    log_text: string;
    flights_found: number;
    tracks_added: number;
  }>;

  const rows = logs
    .map((l) => {
      const started = new Date(l.started_at);
      const finished = new Date(l.finished_at);
      const durationSec = ((finished.getTime() - started.getTime()) / 1000).toFixed(1);
      const logEscaped = l.log_text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

      return `<div class="log-entry">
        <div class="log-header">
          <span class="log-date">${started.toLocaleString("en-US", { timeZone: "UTC" })} UTC</span>
          <span class="log-stats">${l.flights_found} flights found | ${l.tracks_added} new tracks | ${durationSec}s</span>
        </div>
        <pre class="log-body">${logEscaped}</pre>
      </div>`;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BETAPlanes - Scrape Logs</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; background: #1a1a2e; color: #e0e0e0; padding: 24px; }
    h1 { color: #e94560; margin-bottom: 4px; }
    .subtitle { color: #8899aa; font-size: 14px; margin-bottom: 24px; }
    .subtitle a { color: #e94560; text-decoration: none; }
    .log-entry { background: #16213e; border-radius: 8px; margin-bottom: 12px; overflow: hidden; border-left: 3px solid #0f3460; }
    .log-header { padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; background: #0f3460; cursor: pointer; }
    .log-header:hover { background: #133a6a; }
    .log-date { font-weight: 600; font-size: 14px; }
    .log-stats { font-size: 12px; color: #8899aa; }
    .log-body { padding: 12px 16px; font-size: 12px; line-height: 1.6; white-space: pre-wrap; color: #aab; display: none; }
    .log-entry.open .log-body { display: block; }
    .empty { text-align: center; padding: 60px; color: #667788; }
  </style>
</head>
<body>
  <h1>Scrape Logs</h1>
  <p class="subtitle">Last 30 runs | <a href="/">Back to map</a></p>
  ${logs.length === 0 ? '<div class="empty">No scrape logs yet. Trigger one with POST /api/scrape</div>' : rows}
  <script>
    document.querySelectorAll(".log-header").forEach(function(h) {
      h.addEventListener("click", function() {
        h.parentElement.classList.toggle("open");
      });
    });
  </script>
</body>
</html>`;

  return c.html(html);
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: { DB: D1Database }, ctx: ExecutionContext) {
    ctx.waitUntil(
      runScraper(env.DB).then((logs) => {
        console.log("Scraper completed:", logs.join("\n"));
      })
    );
  },
};
