-- Adaptive quorum: classify entries to right-size verification effort.

ALTER TABLE entries ADD COLUMN contention_classification TEXT DEFAULT 'unknown';
ALTER TABLE entries ADD COLUMN initial_quorum_size INTEGER DEFAULT 3;
ALTER TABLE entries ADD COLUMN classified_at TEXT;
ALTER TABLE entries ADD COLUMN classified_by_node_id TEXT;

CREATE INDEX idx_entries_classification ON entries(contention_classification);

-- Classification log: every classification decision preserved.
CREATE TABLE classification_log (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    classification TEXT NOT NULL,
    reasoning TEXT,
    signals_json TEXT,                       -- raw signals used (P31, edit-protection, etc.)
    classified_by_node_id TEXT,
    timestamp TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_classlog_entry ON classification_log(entry_id);
