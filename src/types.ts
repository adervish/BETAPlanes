export type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  GOOGLE_MAPS_API_KEY: string;
};

export interface Plane {
  tail_number: string;
  display_name: string;
  color: string;
}

export interface Flight {
  id: string;
  tail_number: string;
  origin_icao: string | null;
  origin_name: string | null;
  dest_icao: string | null;
  dest_name: string | null;
  departure_time: number | null;
  arrival_time: number | null;
  duration_seconds: number | null;
  status: string | null;
}

export interface TrackPoint {
  id?: number;
  flight_id: string;
  timestamp: number;
  latitude: number;
  longitude: number;
  altitude_ft: number | null;
  groundspeed_kts: number | null;
  heading: number | null;
}

export interface PlaneStats {
  tail_number: string;
  color: string;
  total_flights: number;
  total_hours: number;
  unique_airports: number;
  avg_duration_hours: number;
  first_flight: number | null;
  last_flight: number | null;
}
