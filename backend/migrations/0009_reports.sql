-- ═══════════════════════════════════════════════════════════════
-- Bug / feedback reports sent straight from the HIVE web app.
--
-- A "Report a problem" button captures the live context (the question, which
-- engines were connected, the last error, the page URL/userAgent) and POSTs it
-- here. The developer reads these directly from D1 to fix issues — no email,
-- no third-party tracker, no PII beyond what the user typed.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    kind TEXT DEFAULT 'bug',            -- bug | feedback
    message TEXT,                       -- the user's note (optional)
    context_json TEXT,                  -- {question, engines, error, mode, url, userAgent, appVersion}
    contributor_id TEXT,                -- anon node id, if present
    status TEXT DEFAULT 'open',         -- open | triaged | fixed
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
