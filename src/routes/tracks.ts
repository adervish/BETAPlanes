import { Hono } from "hono";
import type { Bindings } from "../types";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/:flightId", async (c) => {
  const flightId = c.req.param("flightId");
  const result = await c.env.DB.prepare(
    "SELECT timestamp, latitude, longitude, altitude_ft, groundspeed_kts, heading FROM track_points WHERE flight_id = ? ORDER BY timestamp ASC"
  )
    .bind(flightId)
    .all();
  return c.json(result.results);
});

export default app;
