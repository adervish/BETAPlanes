import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Bindings } from "./types";
import planes from "./routes/planes";
import flights from "./routes/flights";
import tracks from "./routes/tracks";
import stats from "./routes/stats";
import { runScraper } from "./lib/scraper";

const app = new Hono<{ Bindings: Bindings }>();
app.use("*", cors());

app.route("/api/planes", planes);
app.route("/api/flights", flights);
app.route("/api/tracks", tracks);
app.route("/api/stats", stats);

app.post("/api/scrape", async (c) => {
  const logs = await runScraper(c.env.DB);
  return c.json({ ok: true, logs });
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
