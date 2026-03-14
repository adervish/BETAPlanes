import { Hono } from "hono";
import type { Bindings } from "../types";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT
      p.tail_number,
      p.color,
      COUNT(f.id) AS total_flights,
      COALESCE(SUM(f.duration_seconds), 0) / 3600.0 AS total_hours,
      COALESCE(AVG(f.duration_seconds), 0) / 3600.0 AS avg_duration_hours,
      MIN(f.departure_time) AS first_flight,
      MAX(f.departure_time) AS last_flight
    FROM planes p
    LEFT JOIN flights f ON f.tail_number = p.tail_number
    GROUP BY p.tail_number
  `).all();

  const stats = [];
  for (const row of result.results as Record<string, unknown>[]) {
    const tail = row.tail_number as string;
    const airports = await c.env.DB.prepare(`
      SELECT COUNT(DISTINCT airport) AS count FROM (
        SELECT origin_icao AS airport FROM flights WHERE tail_number = ? AND origin_icao IS NOT NULL
        UNION
        SELECT dest_icao FROM flights WHERE tail_number = ? AND dest_icao IS NOT NULL
      )
    `)
      .bind(tail, tail)
      .first();

    stats.push({
      ...row,
      total_hours: Math.round((row.total_hours as number) * 10) / 10,
      avg_duration_hours: Math.round((row.avg_duration_hours as number) * 10) / 10,
      unique_airports: (airports as Record<string, unknown>)?.count ?? 0,
    });
  }

  return c.json(stats);
});

app.get("/daily", async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT
      date(departure_time, 'unixepoch') AS day,
      COALESCE(SUM(duration_seconds), 0) / 3600.0 AS hours
    FROM flights
    WHERE departure_time IS NOT NULL
    GROUP BY day
    ORDER BY day ASC
  `).all();

  return c.json(result.results);
});

export default app;
