-- Work queue: requested entry creations + re-verifications.
-- Nodes poll this queue and pick up work. Claimed items time out after 1 hour
-- so a stalled node doesn't lock work forever.

CREATE TABLE queue_items (
    id TEXT PRIMARY KEY,
    wikidata_qid TEXT NOT NULL,
    requested_label TEXT,
    request_type TEXT NOT NULL,              -- create / reverify / challenge-triggered
    requested_by_contributor_id TEXT,        -- who asked for this
    requested_quorum_size INTEGER DEFAULT 3, -- from adaptive classifier
    classification TEXT,                     -- pre-classification result
    status TEXT NOT NULL DEFAULT 'pending',  -- pending / claimed / processing / completed / failed / expired
    claimed_by_contributor_id TEXT,          -- which node took it
    claimed_at TEXT,
    completed_at TEXT,
    result_entry_id TEXT REFERENCES entries(id),
    error_message TEXT,
    priority INTEGER DEFAULT 0,              -- higher = sooner (boost on multiple requests)
    request_count INTEGER DEFAULT 1,         -- merged-duplicate counter
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_queue_status ON queue_items(status, priority DESC, created_at);
CREATE INDEX idx_queue_qid ON queue_items(wikidata_qid);

-- A "request log" preserves all individual requests even if merged.
CREATE TABLE queue_requests (
    id TEXT PRIMARY KEY,
    queue_item_id TEXT NOT NULL REFERENCES queue_items(id) ON DELETE CASCADE,
    contributor_id TEXT,
    requested_at TEXT DEFAULT (datetime('now')),
    user_agent TEXT
);

CREATE INDEX idx_queue_requests_item ON queue_requests(queue_item_id);
