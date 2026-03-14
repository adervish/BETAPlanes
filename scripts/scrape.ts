import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";

const TAIL_NUMBERS = ["N916LF", "N336MR", "N214BT", "N401NZ", "N709JL", "N521SS", "N27SJ", "N556LU"];
const BASE_URL = "https://www.flightaware.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const CACHE_DIR = path.join(__dirname, "cache");


const isRemote = process.argv.includes("--remote");
const noCache = process.argv.includes("--no-cache");
const dbFlag = isRemote ? "--remote" : "--local";

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getCachePath(tail: string, filename: string): string {
  const dir = path.join(CACHE_DIR, tail);
  ensureDir(dir);
  return path.join(dir, filename);
}

async function fetchWithCache(url: string, cachePath: string): Promise<string> {
  if (!noCache && fs.existsSync(cachePath)) {
    console.log(`  [cache] ${path.basename(cachePath)}`);
    return fs.readFileSync(cachePath, "utf-8");
  }

  console.log(`  [fetch] ${url}`);
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  const html = await res.text();
  fs.writeFileSync(cachePath, html);

  // Rate limit: wait 6 seconds between fetches to avoid 429s
  await new Promise((r) => setTimeout(r, 6000));
  return html;
}

function parseFlightList(html: string): FlightInfo[] {
  const startMarker = "var trackpollBootstrap = ";
  const start = html.indexOf(startMarker);
  if (start === -1) throw new Error("trackpollBootstrap not found in HTML");

  const jsonStart = start + startMarker.length;
  // Find the end of the JSON object by counting braces
  let depth = 0;
  let i = jsonStart;
  for (; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const jsonStr = html.substring(jsonStart, i + 1);
  const data = JSON.parse(jsonStr);

  const flights: FlightInfo[] = [];
  for (const key of Object.keys(data.flights || {})) {
    const flightData = data.flights[key];
    const activityFlights = flightData?.activityLog?.flights || [];
    for (const f of activityFlights) {
      flights.push({
        id: f.flightId,
        origin_icao: f.origin?.icao || null,
        origin_name: f.origin?.friendlyName || null,
        dest_icao: f.destination?.icao || null,
        dest_name: f.destination?.friendlyName || null,
        departure_time: f.takeoffTimes?.actual || f.takeoffTimes?.estimated || null,
        arrival_time: f.landingTimes?.actual || f.landingTimes?.estimated || null,
        status: f.flightStatus || null,
        trackLogUrl: f.links?.trackLog || null,
      });
    }
  }

  return flights;
}

interface FlightInfo {
  id: string;
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

function parseTrackLog(html: string): TrackPoint[] {
  const $ = cheerio.load(html);
  const points: TrackPoint[] = [];

  // Also check for trackpollBootstrap JSON on tracklog pages - it may have track data
  const startMarker = "var trackpollBootstrap = ";
  const start = html.indexOf(startMarker);
  if (start !== -1) {
    try {
      const jsonStart = start + startMarker.length;
      let depth = 0;
      let i = jsonStart;
      for (; i < html.length; i++) {
        if (html[i] === "{") depth++;
        else if (html[i] === "}") {
          depth--;
          if (depth === 0) break;
        }
      }
      const data = JSON.parse(html.substring(jsonStart, i + 1));
      for (const key of Object.keys(data.flights || {})) {
        const track = data.flights[key]?.track;
        if (Array.isArray(track) && track.length > 0) {
          for (const pt of track) {
            if (pt.coord && pt.coord.length >= 2) {
              points.push({
                timestamp: pt.timestamp || 0,
                latitude: pt.coord[1],
                longitude: pt.coord[0],
                altitude_ft: pt.alt != null ? pt.alt * 100 : null, // alt is in hundreds of feet
                groundspeed_kts: pt.gs || null,
                heading: null,
              });
            }
          }
          if (points.length > 0) return points;
        }
      }
    } catch {
      // Fall through to HTML table parsing
    }
  }

  // Parse HTML table
  $("#tracklogTable tbody tr, #tracklogTable tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 7) return;

    const latText = $(cells[1]).text().trim();
    const lonText = $(cells[2]).text().trim();

    // FlightAware doubles the values (responsive display) - take first number
    const lat = parseFloat(latText);
    const lon = parseFloat(lonText);

    if (isNaN(lat) || isNaN(lon)) return;

    // Parse speed (kts column, index 4)
    const kts = parseInt($(cells[4]).text().trim()) || null;

    // Parse altitude (feet column, index 6)
    const altText = $(cells[6]).text().trim().replace(/,/g, "");
    const alt = parseInt(altText) || null;

    // Parse heading from course column (index 3), e.g. "234°"
    const courseText = $(cells[3]).text().trim();
    const headingMatch = courseText.match(/(\d+)/);
    const heading = headingMatch ? parseInt(headingMatch[1]) : null;

    points.push({
      timestamp: 0, // We'll use departure_time + index as approximation if needed
      latitude: lat,
      longitude: lon,
      altitude_ft: alt,
      groundspeed_kts: kts,
      heading,
    });
  });

  return points;
}

function escapeSQL(val: string | null): string {
  if (val === null) return "NULL";
  return "'" + val.replace(/'/g, "''") + "'";
}

function runD1(sql: string) {
  const escaped = sql.replace(/"/g, '\\"');
  try {
    execSync(
      `npx wrangler d1 execute betaplanes-db ${dbFlag} --command="${escaped}"`,
      { cwd: path.join(__dirname, ".."), stdio: "pipe" }
    );
  } catch (e: unknown) {
    const err = e as { stderr?: Buffer };
    console.error(`  [d1 error] ${err.stderr?.toString().trim()}`);
  }
}

async function scrapeTail(tail: string) {
  console.log(`\n=== ${tail} ===`);

  // Step 1: Get flight list
  const flightsUrl = `${BASE_URL}/live/flight/${tail}`;
  const cachePath = getCachePath(tail, "flights.html");
  const html = await fetchWithCache(flightsUrl, cachePath);

  const flights = parseFlightList(html);
  console.log(`  Found ${flights.length} flights total`);

  for (const flight of flights) {
    const duration =
      flight.departure_time && flight.arrival_time
        ? flight.arrival_time - flight.departure_time
        : null;

    // Insert flight
    const insertFlight = `INSERT OR IGNORE INTO flights (id, tail_number, origin_icao, origin_name, dest_icao, dest_name, departure_time, arrival_time, duration_seconds, status) VALUES (${escapeSQL(flight.id)}, ${escapeSQL(tail)}, ${escapeSQL(flight.origin_icao)}, ${escapeSQL(flight.origin_name)}, ${escapeSQL(flight.dest_icao)}, ${escapeSQL(flight.dest_name)}, ${flight.departure_time || "NULL"}, ${flight.arrival_time || "NULL"}, ${duration || "NULL"}, ${escapeSQL(flight.status)})`;
    runD1(insertFlight);

    // Step 2: Get track log
    if (!flight.trackLogUrl) {
      console.log(`  [skip] No tracklog URL for ${flight.id}`);
      continue;
    }

    const tracklogCacheFile = `tracklog-${flight.id.replace(/[/:]/g, "_")}.html`;
    const tracklogCachePath = getCachePath(tail, tracklogCacheFile);
    const tracklogUrl = `${BASE_URL}${flight.trackLogUrl}`;

    try {
      const trackHtml = await fetchWithCache(tracklogUrl, tracklogCachePath);
      const trackPoints = parseTrackLog(trackHtml);
      console.log(`  ${flight.id}: ${trackPoints.length} track points (${flight.origin_icao} → ${flight.dest_icao})`);

      // Delete existing track points for this flight to avoid duplicates on re-run
      runD1(`DELETE FROM track_points WHERE flight_id = ${escapeSQL(flight.id)}`);

      // Batch insert track points (in chunks to avoid SQL length limits)
      const BATCH_SIZE = 50;
      for (let i = 0; i < trackPoints.length; i += BATCH_SIZE) {
        const batch = trackPoints.slice(i, i + BATCH_SIZE);
        const values = batch
          .map(
            (pt) =>
              `(${escapeSQL(flight.id)}, ${pt.timestamp}, ${pt.latitude}, ${pt.longitude}, ${pt.altitude_ft ?? "NULL"}, ${pt.groundspeed_kts ?? "NULL"}, ${pt.heading ?? "NULL"})`
          )
          .join(", ");
        const insertTrack = `INSERT INTO track_points (flight_id, timestamp, latitude, longitude, altitude_ft, groundspeed_kts, heading) VALUES ${values}`;
        runD1(insertTrack);
      }
    } catch (e) {
      console.error(`  [error] Failed to get tracklog for ${flight.id}: ${e}`);
    }
  }
}

async function main() {
  console.log(`Scraping FlightAware (${isRemote ? "remote" : "local"} D1, cache=${noCache ? "disabled" : "enabled"})`);

  for (const tail of TAIL_NUMBERS) {
    await scrapeTail(tail);
  }

  console.log("\nDone!");
}

main().catch(console.error);
