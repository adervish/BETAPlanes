import { Hono } from "hono";
import type { Bindings } from "../types";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", async (c) => {
  const tail = c.req.query("tail");
  let query: string;
  let bindings: string[] = [];
  if (tail) {
    query = `
      SELECT p.tail_number, p.color,
        COUNT(f.id) AS total_flights,
        COALESCE(SUM(f.duration_seconds), 0) / 3600.0 AS total_hours,
        COALESCE(AVG(f.duration_seconds), 0) / 3600.0 AS avg_duration_hours,
        MIN(f.departure_time) AS first_flight,
        MAX(f.departure_time) AS last_flight
      FROM planes p LEFT JOIN flights f ON f.tail_number = p.tail_number
      WHERE p.tail_number = ?
      GROUP BY p.tail_number`;
    bindings = [tail];
  } else {
    query = `
      SELECT p.tail_number, p.color,
        COUNT(f.id) AS total_flights,
        COALESCE(SUM(f.duration_seconds), 0) / 3600.0 AS total_hours,
        COALESCE(AVG(f.duration_seconds), 0) / 3600.0 AS avg_duration_hours,
        MIN(f.departure_time) AS first_flight,
        MAX(f.departure_time) AS last_flight
      FROM planes p LEFT JOIN flights f ON f.tail_number = p.tail_number
      WHERE p.show_default = 1
      GROUP BY p.tail_number`;
  }
  const stmt = bindings.length > 0
    ? c.env.DB.prepare(query).bind(...bindings)
    : c.env.DB.prepare(query);
  const result = await stmt.all();

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
  const tail = c.req.query("tail");
  let query: string;
  let bindings: string[] = [];
  if (tail) {
    query = `
      SELECT date(departure_time, 'unixepoch') AS day,
        COALESCE(SUM(duration_seconds), 0) / 3600.0 AS hours
      FROM flights
      WHERE departure_time IS NOT NULL AND tail_number = ?
      GROUP BY day ORDER BY day ASC`;
    bindings = [tail];
  } else {
    query = `
      SELECT date(f.departure_time, 'unixepoch') AS day,
        COALESCE(SUM(f.duration_seconds), 0) / 3600.0 AS hours
      FROM flights f JOIN planes p ON f.tail_number = p.tail_number
      WHERE f.departure_time IS NOT NULL AND p.show_default = 1
      GROUP BY day ORDER BY day ASC`;
  }
  const stmt = bindings.length > 0
    ? c.env.DB.prepare(query).bind(...bindings)
    : c.env.DB.prepare(query);
  const result = await stmt.all();

  return c.json(result.results);
});

export default app;
