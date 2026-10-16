-- Anonymous contributor tokens + contribution attribution.
-- Browser stores a token; backend tracks counts. Full OAuth comes later.

-- Track which entries/claims/challenges came from which contributor.
ALTER TABLE entries ADD COLUMN contributor_id TEXT;
ALTER TABLE challenges ADD COLUMN contributor_id TEXT;

CREATE INDEX idx_entries_contributor ON entries(contributor_id);
CREATE INDEX idx_challenges_contributor ON challenges(contributor_id);

-- Contributors: anonymous-by-default, can later be linked to OAuth.
-- We don't repurpose `users` because that's reserved for fully-authed accounts.
CREATE TABLE contributors (
    id TEXT PRIMARY KEY,                     -- random token (anon_<rand>)
    display_name TEXT,                       -- optional friendly name (e.g. "researcher_42")
    entries_contributed INTEGER DEFAULT 0,
    challenges_filed INTEGER DEFAULT 0,
    challenges_accepted INTEGER DEFAULT 0,
    reputation_score INTEGER DEFAULT 0,
    linked_user_id TEXT REFERENCES users(id), -- nullable, populated on OAuth bind later
    created_at TEXT DEFAULT (datetime('now')),
    last_active_at TEXT
);

CREATE INDEX idx_contributors_reputation ON contributors(reputation_score DESC);
