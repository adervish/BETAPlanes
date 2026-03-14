import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Bindings } from "./types";
import planes from "./routes/planes";
import flights from "./routes/flights";
import tracks from "./routes/tracks";
import stats from "./routes/stats";

const app = new Hono<{ Bindings: Bindings }>();
app.use("*", cors());

app.route("/api/planes", planes);
app.route("/api/flights", flights);
app.route("/api/tracks", tracks);
app.route("/api/stats", stats);

export default app;
