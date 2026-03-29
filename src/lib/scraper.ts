import { parseHTML } from "linkedom";

const TAIL_NUMBERS = ["N916LF", "N336MR", "N214BT", "N401NZ", "N709JL", "N521SS", "N27SJ", "N556LU"];
const BASE_URL = "https://www.flightaware.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface FlightInfo {
  id: string;
  tail_number: string;
  origin_icao: string | null;
  origin_name: string | null;
  dest_icao: string | null;
  dest_name: string | null;
  departure_time: number | null;
  arrival_time: number | null;
  status: string | null;
  trackLogUrl: string | null;
}

interface TrackPoint {
  timestamp: number;
  latitude: number;
  longitude: number;
  altitude_ft: number | null;
  groundspeed_kts: number | null;
  heading: number | null;
}

async function fetchWithCache(
  db: D1Database,
  url: string,
  cacheKey: string,
  log: string[]
): Promise<string | null> {
  // Check cache — cached pages are kept forever
  const cached = await db
    .prepare("SELECT html FROM scrape_cache WHERE cache_key = ?")
    .bind(cacheKey)
    .first<{ html: string }>();

  if (cached) {
    return cached.html;
  }

  // Fetch
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (res.status === 429) {
    log.push(`  [429] Rate limited: ${url}`);
    return null;
  }

  if (!res.ok) {
    log.push(`  [${res.status}] Failed: ${url}`);
    return null;
  }

  const html = await res.text();

  // Upsert cache
  await db
    .prepare(
      "INSERT OR REPLACE INTO scrape_cache (cache_key, url, html, fetched_at) VALUES (?, ?, ?, datetime('now'))"
    )
    .bind(cacheKey, url, html)
    .run();

  return html;
}

function parseBootstrapJSON(html: string): Record<string, unknown> | null {
  const marker = "var trackpollBootstrap = ";
  const start = html.indexOf(marker);
  if (start === -1) return null;

  const jsonStart = start + marker.length;
  let depth = 0;
  let i = jsonStart;
  for (; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }

  try {
    return JSON.parse(html.substring(jsonStart, i + 1));
  } catch {
    return null;
  }
}

function parseFlightList(html: string, tail: string): FlightInfo[] {
  const data = parseBootstrapJSON(html);
  if (!data) return [];

  const flights: FlightInfo[] = [];
  const flightsObj = data.flights as Record<string, Record<string, unknown>>;
  for (const key of Object.keys(flightsObj || {})) {
    const flightData = flightsObj[key];
    const activityLog = flightData?.activityLog as { flights?: Record<string, unknown>[] };
    const activityFlights = activityLog?.flights || [];

    if (activityFlights.length > 0) {
      // Standard structure: flight details inside activityLog.flights[]
      for (const f of activityFlights) {
        const origin = f.origin as Record<string, unknown> | undefined;
        const dest = f.destination as Record<string, unknown> | undefined;
        const takeoff = f.takeoffTimes as Record<string, unknown> | undefined;
        const landing = f.landingTimes as Record<string, unknown> | undefined;
        const links = f.links as Record<string, unknown> | undefined;

        flights.push({
          id: f.flightId as string,
          tail_number: tail,
          origin_icao: (origin?.icao as string) || null,
          origin_name: (origin?.friendlyName as string) || null,
          dest_icao: (dest?.icao as string) || null,
          dest_name: (dest?.friendlyName as string) || null,
          departure_time:
            (takeoff?.actual as number) || (takeoff?.estimated as number) || null,
          arrival_time:
            (landing?.actual as number) || (landing?.estimated as number) || null,
          status: (f.flightStatus as string) || null,
          trackLogUrl: (links?.trackLog as string) || null,
        });
      }
    } else if (flightData?.flightId) {
      // Alternate structure: flight details directly on the top-level flight object
      const origin = flightData.origin as Record<string, unknown> | undefined;
      const dest = flightData.destination as Record<string, unknown> | undefined;
      const takeoff = flightData.takeoffTimes as Record<string, unknown> | undefined;
      const landing = flightData.landingTimes as Record<string, unknown> | undefined;
      const links = flightData.links as Record<string, unknown> | undefined;

      flights.push({
        id: flightData.flightId as string,
        tail_number: tail,
        origin_icao: (origin?.icao as string) || null,
        origin_name: (origin?.friendlyName as string) || null,
        dest_icao: (dest?.icao as string) || null,
        dest_name: (dest?.friendlyName as string) || null,
        departure_time:
          (takeoff?.actual as number) || (takeoff?.estimated as number) || null,
        arrival_time:
          (landing?.actual as number) || (landing?.estimated as number) || null,
        status: (flightData.flightStatus as string) || null,
        trackLogUrl: (links?.trackLog as string) || null,
      });
    }
  }

  return flights;
}

function parseTrackLog(html: string): TrackPoint[] {
  const points: TrackPoint[] = [];

  // Try JSON track data first
  const data = parseBootstrapJSON(html);
  if (data) {
    const flightsObj = data.flights as Record<string, Record<string, unknown>>;
    for (const key of Object.keys(flightsObj || {})) {
      const track = flightsObj[key]?.track as Array<Record<string, unknown>>;
      if (Array.isArray(track) && track.length > 0) {
        for (const pt of track) {
          const coord = pt.coord as number[];
          if (coord && coord.length >= 2) {
            points.push({
              timestamp: (pt.timestamp as number) || 0,
              latitude: coord[1],
              longitude: coord[0],
              altitude_ft: pt.alt != null ? Math.round(pt.alt as number) : null,
              groundspeed_kts: (pt.gs as number) || null,
              heading: null,
            });
          }
        }
        if (points.length > 0) return points;
      }
    }
  }

  // Fallback: parse HTML table with linkedom DOM parser
  const { document } = parseHTML(html);
  const table = document.getElementById("tracklogTable");
  if (!table) return points;

  const rows = table.querySelectorAll("tr");
  for (const row of rows) {
    const cells = row.querySelectorAll("td");
    if (cells.length < 7) continue;

    const lat = parseFloat(cells[1].textContent || "");
    const lon = parseFloat(cells[2].textContent || "");
    if (isNaN(lat) || isNaN(lon)) continue;

    const kts = parseInt(cells[4].textContent || "") || null;
    const altText = (cells[6].textContent || "").replace(/,/g, "");
    const alt = parseInt(altText) || null;
    const courseText = cells[3].textContent || "";
    const headingMatch = courseText.match(/(\d+)/);
    const heading = headingMatch ? parseInt(headingMatch[1]) : null;

    points.push({
      timestamp: 0,
      latitude: lat,
      longitude: lon,
      altitude_ft: alt,
      groundspeed_kts: kts,
      heading,
    });
  }

  return points;
}

async function scrapeTail(db: D1Database, tail: string): Promise<string[]> {
  const log: string[] = [];
  log.push(`=== ${tail} ===`);

  // Step 1: Get flight list — always fetch fresh (delete cached version first)
  const flightsUrl = `${BASE_URL}/live/flight/${tail}`;
  const flightsCacheKey = `flights:${tail}`;
  await db
    .prepare("DELETE FROM scrape_cache WHERE cache_key = ?")
    .bind(flightsCacheKey)
    .run();
  const html = await fetchWithCache(db, flightsUrl, flightsCacheKey, log);
  if (!html) {
    log.push(`  Failed to fetch flight list`);
    return log;
  }

  const flights = parseFlightList(html, tail);

  // Step 1b: Also fetch the history page for additional flights
  const historyCacheKey = `history:${tail}`;
  await db
    .prepare("DELETE FROM scrape_cache WHERE cache_key = ?")
    .bind(historyCacheKey)
    .run();
  const historyUrl = `${BASE_URL}/live/flight/${tail}/history`;
  const historyHtml = await fetchWithCache(db, historyUrl, historyCacheKey, log);
  if (historyHtml) {
    const historyFlights = parseFlightList(historyHtml, tail);
    const existingIds = new Set(flights.map((f) => f.id));
    for (const hf of historyFlights) {
      if (!existingIds.has(hf.id)) {
        flights.push(hf);
      }
    }
  }

  log.push(`  Found ${flights.length} flights`);

  for (const flight of flights) {
    const duration =
      flight.departure_time && flight.arrival_time
        ? flight.arrival_time - flight.departure_time
        : null;

    // Insert flight (ignore if exists)
    await db
      .prepare(
        "INSERT OR IGNORE INTO flights (id, tail_number, origin_icao, origin_name, dest_icao, dest_name, departure_time, arrival_time, duration_seconds, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        flight.id,
        tail,
        flight.origin_icao,
        flight.origin_name,
        flight.dest_icao,
        flight.dest_name,
        flight.departure_time,
        flight.arrival_time,
        duration,
        flight.status
      )
      .run();

    // Check if we already have track points for this flight
    const existing = await db
      .prepare("SELECT COUNT(*) as cnt FROM track_points WHERE flight_id = ?")
      .bind(flight.id)
      .first<{ cnt: number }>();

    if (existing && existing.cnt > 0) {
      continue; // Already have track data
    }

    if (!flight.trackLogUrl) continue;

    // Fetch tracklog
    const trackCacheKey = `tracklog:${flight.id}`;
    const trackUrl = `${BASE_URL}${flight.trackLogUrl}`;
    const trackHtml = await fetchWithCache(db, trackUrl, trackCacheKey, log);
    if (!trackHtml) {
      log.push(`  [skip] ${flight.id}: fetch failed`);
      continue;
    }

    const trackPoints = parseTrackLog(trackHtml);
    log.push(
      `  ${flight.id}: ${trackPoints.length} pts (${flight.origin_icao} → ${flight.dest_icao})`
    );

    if (trackPoints.length === 0) continue;

    // Batch insert track points
    const BATCH_SIZE = 50;
    for (let i = 0; i < trackPoints.length; i += BATCH_SIZE) {
      const batch = trackPoints.slice(i, i + BATCH_SIZE);
      const stmts = batch.map((pt) =>
        db
          .prepare(
            "INSERT INTO track_points (flight_id, timestamp, latitude, longitude, altitude_ft, groundspeed_kts, heading) VALUES (?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            flight.id,
            pt.timestamp,
            pt.latitude,
            pt.longitude,
            pt.altitude_ft,
            pt.groundspeed_kts,
            pt.heading
          )
      );
      await db.batch(stmts);
    }
  }

  return log;
}

export async function runScraper(db: D1Database): Promise<string[]> {
  const startedAt = new Date().toISOString();
  const allLogs: string[] = [];
  let totalFlights = 0;
  let totalTracks = 0;

  for (const tail of TAIL_NUMBERS) {
    const logs = await scrapeTail(db, tail);
    allLogs.push(...logs);
    for (const line of logs) {
      if (line.match(/Found \d+ flights/)) {
        totalFlights += parseInt(line.match(/Found (\d+)/)?.[1] || "0");
      }
      if (line.match(/\d+ pts/)) {
        totalTracks++;
      }
    }
  }

  const finishedAt = new Date().toISOString();

  // Save log
  await db
    .prepare(
      "INSERT INTO scrape_logs (started_at, finished_at, log_text, flights_found, tracks_added) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(startedAt, finishedAt, allLogs.join("\n"), totalFlights, totalTracks)
    .run();

  // Prune to last 30 logs
  await db
    .prepare(
      "DELETE FROM scrape_logs WHERE id NOT IN (SELECT id FROM scrape_logs ORDER BY id DESC LIMIT 30)"
    )
    .run();

  return allLogs;
}

export async function scrapeFlightUrl(db: D1Database, url: string): Promise<string[]> {
  const log: string[] = [];

  // Parse URL to extract tail number: /live/flight/{tail}/history/...
  const match = url.match(/\/live\/flight\/(N[A-Z0-9]+)\/history\/(\d{8})\/(\d{4}Z)\/([A-Z0-9]+)\/([A-Z0-9]+)/);
  if (!match) {
    log.push(`Invalid FlightAware URL: ${url}`);
    return log;
  }

  const tail = match[1];
  log.push(`=== Scraping specific flight for ${tail} ===`);

  // Fetch the flight page
  const fullUrl = url.startsWith("http") ? url : `${BASE_URL}${url}`;
  const cacheKey = `manual:${tail}:${match[2]}:${match[3]}:${match[4]}:${match[5]}`;
  const html = await fetchWithCache(db, fullUrl, cacheKey, log);
  if (!html) {
    log.push(`  Failed to fetch flight page`);
    return log;
  }

  const flights = parseFlightList(html, tail);
  if (flights.length === 0) {
    log.push(`  No flight data found on page`);
    return log;
  }

  for (const flight of flights) {
    const duration =
      flight.departure_time && flight.arrival_time
        ? flight.arrival_time - flight.departure_time
        : null;

    await db
      .prepare(
        "INSERT OR IGNORE INTO flights (id, tail_number, origin_icao, origin_name, dest_icao, dest_name, departure_time, arrival_time, duration_seconds, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(flight.id, tail, flight.origin_icao, flight.origin_name, flight.dest_icao, flight.dest_name, flight.departure_time, flight.arrival_time, duration, flight.status)
      .run();

    // Check if we already have track points
    const existing = await db
      .prepare("SELECT COUNT(*) as cnt FROM track_points WHERE flight_id = ?")
      .bind(flight.id)
      .first<{ cnt: number }>();

    if (existing && existing.cnt > 0) {
      log.push(`  ${flight.id}: already have track data`);
      continue;
    }

    // Try to get track from the bootstrap JSON on this page first
    const data = parseBootstrapJSON(html);
    let trackPoints: TrackPoint[] = [];
    if (data) {
      const flightsObj = data.flights as Record<string, Record<string, unknown>>;
      for (const key of Object.keys(flightsObj || {})) {
        const track = flightsObj[key]?.track as Array<Record<string, unknown>>;
        if (Array.isArray(track) && track.length > 0) {
          for (const pt of track) {
            const coord = pt.coord as number[];
            if (coord && coord.length >= 2) {
              trackPoints.push({
                timestamp: (pt.timestamp as number) || 0,
                latitude: coord[1],
                longitude: coord[0],
                altitude_ft: pt.alt != null ? Math.round(pt.alt as number) : null,
                groundspeed_kts: (pt.gs as number) || null,
                heading: null,
              });
            }
          }
          break;
        }
      }
    }

    // If no inline track, try fetching the tracklog page
    if (trackPoints.length === 0 && flight.trackLogUrl) {
      const trackCacheKey = `tracklog:${flight.id}`;
      const trackUrl = `${BASE_URL}${flight.trackLogUrl}`;
      const trackHtml = await fetchWithCache(db, trackUrl, trackCacheKey, log);
      if (trackHtml) {
        trackPoints = parseTrackLog(trackHtml);
      }
    }

    log.push(`  ${flight.id}: ${trackPoints.length} pts (${flight.origin_icao} → ${flight.dest_icao})`);

    if (trackPoints.length === 0) continue;

    const BATCH_SIZE = 50;
    for (let i = 0; i < trackPoints.length; i += BATCH_SIZE) {
      const batch = trackPoints.slice(i, i + BATCH_SIZE);
      const stmts = batch.map((pt) =>
        db
          .prepare(
            "INSERT INTO track_points (flight_id, timestamp, latitude, longitude, altitude_ft, groundspeed_kts, heading) VALUES (?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(flight.id, pt.timestamp, pt.latitude, pt.longitude, pt.altitude_ft, pt.groundspeed_kts, pt.heading)
      );
      await db.batch(stmts);
    }
  }

  return log;
}
