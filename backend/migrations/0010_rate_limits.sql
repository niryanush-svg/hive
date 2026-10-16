-- ═══════════════════════════════════════════════════════════════
-- Per-IP fixed-window rate limiting for unauthenticated write endpoints
-- (report / queue-request / challenge). Every such POST is an unthrottled D1
-- write on a CORS-open public API; without this a tight loop can flood the
-- tables, inflate D1 cost, and (for queue-request) amplify outbound Wikidata
-- fetches. Keyed by a salted hash of CF-Connecting-IP + endpoint bucket + window.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,          -- iphash:bucket:windowStart
    count INTEGER NOT NULL DEFAULT 0,
    window_start INTEGER NOT NULL  -- unix seconds, floored to the window
);

CREATE INDEX IF NOT EXISTS idx_rate_window ON rate_limits(window_start);
