CREATE TABLE site_weather_locations (
    site_id TEXT PRIMARY KEY,
    location_name TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    timezone TEXT NOT NULL,
    resolved_at TEXT NOT NULL
);

CREATE TABLE weather_forecasts (
    site_id TEXT PRIMARY KEY,
    document BLOB NOT NULL,
    fetched_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE INDEX weather_forecasts_expires_idx ON weather_forecasts(expires_at);
