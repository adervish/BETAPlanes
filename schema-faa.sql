-- FAA Aviation Data Tables with H3 spatial indexing

CREATE TABLE IF NOT EXISTS faa_airports (
  ident TEXT PRIMARY KEY,
  name TEXT,
  icao_id TEXT,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  elevation REAL,
  type_code TEXT,
  city TEXT,
  state TEXT,
  country TEXT,
  tier INTEGER NOT NULL DEFAULT 3,
  h3_res3 TEXT,
  h3_res4 TEXT,
  h3_res5 TEXT
);
CREATE INDEX IF NOT EXISTS idx_faa_airports_icao ON faa_airports(icao_id);
CREATE INDEX IF NOT EXISTS idx_faa_airports_h3r3 ON faa_airports(h3_res3);
CREATE INDEX IF NOT EXISTS idx_faa_airports_h3r4 ON faa_airports(h3_res4);
CREATE INDEX IF NOT EXISTS idx_faa_airports_h3r5 ON faa_airports(h3_res5);
CREATE INDEX IF NOT EXISTS idx_faa_airports_tier ON faa_airports(tier);

CREATE TABLE IF NOT EXISTS faa_navaids (
  ident TEXT NOT NULL,
  name TEXT,
  class TEXT,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  city TEXT,
  state TEXT,
  country TEXT,
  status TEXT,
  tier INTEGER NOT NULL DEFAULT 2,
  h3_res3 TEXT,
  h3_res4 TEXT,
  h3_res5 TEXT
);
CREATE INDEX IF NOT EXISTS idx_faa_navaids_ident ON faa_navaids(ident);
CREATE INDEX IF NOT EXISTS idx_faa_navaids_h3r3 ON faa_navaids(h3_res3);
CREATE INDEX IF NOT EXISTS idx_faa_navaids_h3r4 ON faa_navaids(h3_res4);
CREATE INDEX IF NOT EXISTS idx_faa_navaids_tier ON faa_navaids(tier);

CREATE TABLE IF NOT EXISTS faa_designated_points (
  ident TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  type_code TEXT,
  state TEXT,
  country TEXT,
  tier INTEGER NOT NULL DEFAULT 3,
  h3_res3 TEXT,
  h3_res4 TEXT,
  h3_res5 TEXT
);
CREATE INDEX IF NOT EXISTS idx_faa_dp_ident ON faa_designated_points(ident);
CREATE INDEX IF NOT EXISTS idx_faa_dp_h3r4 ON faa_designated_points(h3_res4);
CREATE INDEX IF NOT EXISTS idx_faa_dp_h3r5 ON faa_designated_points(h3_res5);
CREATE INDEX IF NOT EXISTS idx_faa_dp_tier ON faa_designated_points(tier);

CREATE TABLE IF NOT EXISTS faa_obstacles (
  oas_number TEXT,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  type_code TEXT,
  agl REAL,
  amsl REAL,
  lighting TEXT,
  city TEXT,
  state TEXT,
  tier INTEGER NOT NULL DEFAULT 3,
  h3_res3 TEXT,
  h3_res4 TEXT,
  h3_res5 TEXT
);
CREATE INDEX IF NOT EXISTS idx_faa_obs_h3r4 ON faa_obstacles(h3_res4);
CREATE INDEX IF NOT EXISTS idx_faa_obs_h3r5 ON faa_obstacles(h3_res5);
CREATE INDEX IF NOT EXISTS idx_faa_obs_tier ON faa_obstacles(tier);

CREATE TABLE IF NOT EXISTS faa_ils (
  ident TEXT,
  airport_id TEXT,
  runway TEXT,
  system_type TEXT,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  category TEXT,
  frequency TEXT,
  state TEXT,
  tier INTEGER NOT NULL DEFAULT 2,
  h3_res4 TEXT,
  h3_res5 TEXT
);
CREATE INDEX IF NOT EXISTS idx_faa_ils_airport ON faa_ils(airport_id);
CREATE INDEX IF NOT EXISTS idx_faa_ils_h3r4 ON faa_ils(h3_res4);
CREATE INDEX IF NOT EXISTS idx_faa_ils_h3r5 ON faa_ils(h3_res5);

-- Track when FAA data was last loaded
CREATE TABLE IF NOT EXISTS faa_load_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  loaded_at TEXT DEFAULT (datetime('now')),
  record_count INTEGER,
  status TEXT
);
