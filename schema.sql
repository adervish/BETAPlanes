CREATE TABLE IF NOT EXISTS planes (
  tail_number TEXT PRIMARY KEY,
  display_name TEXT,
  color TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS flights (
  id TEXT PRIMARY KEY,
  tail_number TEXT NOT NULL,
  origin_icao TEXT,
  origin_name TEXT,
  dest_icao TEXT,
  dest_name TEXT,
  departure_time INTEGER,
  arrival_time INTEGER,
  duration_seconds INTEGER,
  status TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tail_number) REFERENCES planes(tail_number)
);

CREATE TABLE IF NOT EXISTS track_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flight_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  altitude_ft INTEGER,
  groundspeed_kts INTEGER,
  heading INTEGER,
  FOREIGN KEY (flight_id) REFERENCES flights(id)
);

CREATE TABLE IF NOT EXISTS scrape_cache (
  cache_key TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  html TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_flights_tail ON flights(tail_number);
CREATE INDEX IF NOT EXISTS idx_flights_departure ON flights(departure_time);
CREATE INDEX IF NOT EXISTS idx_track_points_flight ON track_points(flight_id);

INSERT OR IGNORE INTO planes (tail_number, display_name, color) VALUES
  ('N916LF', 'N916LF', '#e74c3c'),
  ('N336MR', 'N336MR', '#3498db'),
  ('N214BT', 'N214BT', '#2ecc71'),
  ('N401NZ', 'N401NZ', '#f39c12'),
  ('N709JL', 'N709JL', '#9b59b6');
