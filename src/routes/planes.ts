import { Hono } from "hono";
import type { Bindings } from "../types";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", async (c) => {
  const tail = c.req.query("tail");
  let result;
  if (tail) {
    result = await c.env.DB.prepare("SELECT tail_number, display_name, color, show_default FROM planes WHERE tail_number = ?").bind(tail).all();
  } else {
    const showAll = c.req.query("all");
    if (showAll) {
      result = await c.env.DB.prepare("SELECT tail_number, display_name, color, show_default FROM planes").all();
    } else {
      result = await c.env.DB.prepare("SELECT tail_number, display_name, color, show_default FROM planes WHERE show_default = 1").all();
    }
  }
  return c.json(result.results);
});

app.get("/:tail", async (c) => {
  const tail = c.req.param("tail");
  const result = await c.env.DB.prepare("SELECT tail_number, display_name, color FROM planes WHERE tail_number = ?").bind(tail).first();
  if (!result) return c.json({ error: "Not found" }, 404);
  return c.json(result);
});

// Bundled endpoint: plane + stats + flights with embedded tracks
app.get("/:tail/flights", async (c) => {
  const tail = c.req.param("tail");

  const plane = await c.env.DB.prepare(
    "SELECT tail_number, display_name, color, show_default FROM planes WHERE tail_number = ?"
  ).bind(tail).first();
  if (!plane) return c.json({ error: "Not found" }, 404);

  const [flightsResult, statsResult, airportsResult] = await Promise.all([
    c.env.DB.prepare(
      "SELECT * FROM flights WHERE tail_number = ? ORDER BY departure_time DESC LIMIT 100"
    ).bind(tail).all(),
    c.env.DB.prepare(`
      SELECT COUNT(f.id) AS total_flights,
        COALESCE(SUM(f.duration_seconds), 0) / 3600.0 AS total_hours,
        MAX(f.departure_time) AS last_flight
      FROM flights f WHERE f.tail_number = ?
    `).bind(tail).first(),
    c.env.DB.prepare(`
      SELECT COUNT(DISTINCT airport) AS count FROM (
        SELECT origin_icao AS airport FROM flights WHERE tail_number = ? AND origin_icao IS NOT NULL
        UNION
        SELECT dest_icao FROM flights WHERE tail_number = ? AND dest_icao IS NOT NULL
      )
    `).bind(tail, tail).first(),
  ]);

  const flights = flightsResult.results as Record<string, unknown>[];

  // Batch-fetch all tracks for these flights in one query
  if (flights.length > 0) {
    const flightIds = flights.map((f) => f.id as string);
    const placeholders = flightIds.map(() => "?").join(",");
    const tracksResult = await c.env.DB.prepare(
      `SELECT flight_id, timestamp, latitude, longitude, altitude_ft, groundspeed_kts, heading
       FROM track_points WHERE flight_id IN (${placeholders}) ORDER BY timestamp ASC`
    ).bind(...flightIds).all();

    // Group tracks by flight_id
    const tracksByFlight: Record<string, unknown[]> = {};
    for (const tp of tracksResult.results) {
      const fid = (tp as Record<string, unknown>).flight_id as string;
      if (!tracksByFlight[fid]) tracksByFlight[fid] = [];
      tracksByFlight[fid].push(tp);
    }

    // Embed tracks into each flight
    for (const flight of flights) {
      (flight as Record<string, unknown>).track = tracksByFlight[flight.id as string] || [];
    }
  }

  const stats = statsResult as Record<string, unknown>;

  return c.json({
    plane,
    stats: {
      total_flights: stats.total_flights,
      total_hours: Math.round((stats.total_hours as number) * 10) / 10,
      unique_airports: (airportsResult as Record<string, unknown>)?.count ?? 0,
      last_flight: stats.last_flight,
    },
    flights,
  });
});

export default app;
