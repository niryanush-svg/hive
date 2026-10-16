-- HIVE Encyclopedia — initial schema (v1.0)
-- Built on Wikidata Q-IDs. Atomic claims with per-claim status.
-- Append-only verification log. Mandatory citation challenges.

-- ── Entries: one per Wikidata Q-ID. ──
CREATE TABLE entries (
    id TEXT PRIMARY KEY,                    -- "hive_Q937"
    wikidata_qid TEXT UNIQUE NOT NULL,      -- "Q937"
    canonical_label TEXT NOT NULL,          -- "Albert Einstein"
    canonical_language TEXT DEFAULT 'en',
    status TEXT NOT NULL DEFAULT 'draft',   -- draft/established/well-supported/disputed/perpetually-contested
    convergence_score REAL DEFAULT 0,       -- 0.0 - 1.0
    quorum_size INTEGER DEFAULT 0,
    schema_version TEXT DEFAULT '1.0',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    last_verified_at TEXT,
    metadata_json TEXT                       -- JSON: tags, categories, contributors
);

CREATE INDEX idx_entries_qid ON entries(wikidata_qid);
CREATE INDEX idx_entries_status ON entries(status);
CREATE INDEX idx_entries_updated ON entries(updated_at DESC);

-- ── Atomic claims: discrete factual atoms inside an entry. ──
CREATE TABLE atomic_claims (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    wikidata_pid TEXT,                       -- "P569" (date of birth), if applicable
    text TEXT NOT NULL,
    text_normalized TEXT,                    -- lowercase, no punctuation, for matching
    type TEXT NOT NULL DEFAULT 'FACT',       -- FACT/DEFINITION/NARRATIVE/NORMATIVE
    status TEXT NOT NULL DEFAULT 'unverified', -- unverified/established/well-supported/single-source/disputed/preserved-no-verdict
    agreement_count INTEGER DEFAULT 0,
    total_quorum INTEGER DEFAULT 0,
    writer_ids_json TEXT,                    -- JSON array of AI node IDs that produced this claim
    valid_from TEXT,                         -- for time-bound claims ("current president of...")
    valid_until TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_claims_entry ON atomic_claims(entry_id);
CREATE INDEX idx_claims_status ON atomic_claims(status);
CREATE INDEX idx_claims_wikidata_pid ON atomic_claims(wikidata_pid);
CREATE INDEX idx_claims_text_norm ON atomic_claims(text_normalized);

-- ── Sources: citations referenced by claims. Dedup'd across the system. ──
CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    url TEXT,
    doi TEXT,                                -- for academic papers
    isbn TEXT,                               -- for books
    title TEXT NOT NULL,
    authors_json TEXT,
    publication_date TEXT,
    source_type TEXT NOT NULL,               -- A/B/C/D/E/F/G/H (per dirgom ladder)
    source_weight INTEGER NOT NULL,          -- 100/90/80/70/60/50/40 etc.
    publisher TEXT,
    language TEXT DEFAULT 'en',
    verified_at TEXT,                        -- when URL was last verified alive
    verified_status TEXT DEFAULT 'alive',    -- alive/dead/moved/paywalled/uncertain
    blocked INTEGER DEFAULT 0,               -- 0/1 — if matches blocklist
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_sources_url ON sources(url);
CREATE INDEX idx_sources_doi ON sources(doi);
CREATE INDEX idx_sources_type ON sources(source_type);

-- ── Claim-source links (many-to-many). ──
CREATE TABLE claim_sources (
    claim_id TEXT REFERENCES atomic_claims(id) ON DELETE CASCADE,
    source_id TEXT REFERENCES sources(id) ON DELETE CASCADE,
    supports_or_contradicts TEXT NOT NULL,   -- supports/contradicts/partial
    quote TEXT,                              -- verbatim quote from the source
    page_number TEXT,
    independence TEXT,                       -- independent/orbit/unknown
    PRIMARY KEY (claim_id, source_id)
);

-- ── Translations: ONE entry, multiple language renderings. ──
CREATE TABLE translations (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    language TEXT NOT NULL,                  -- "he", "ar", "es", "ja"...
    title_translated TEXT NOT NULL,
    summary_translated TEXT,
    translated_by_node_id TEXT,
    translated_at TEXT DEFAULT (datetime('now')),
    quality_score REAL DEFAULT 0,
    UNIQUE (entry_id, language)
);

CREATE INDEX idx_translations_entry_lang ON translations(entry_id, language);

-- ── Challenges: user-submitted corrections, MUST include sources. ──
CREATE TABLE challenges (
    id TEXT PRIMARY KEY,
    target_claim_id TEXT REFERENCES atomic_claims(id) ON DELETE CASCADE,
    target_entry_id TEXT REFERENCES entries(id) ON DELETE CASCADE,
    challenger_user_id TEXT,                 -- nullable for anonymous challenges
    challenge_type TEXT NOT NULL,            -- refute/support/amend/flag-bias
    explanation TEXT,
    new_source_ids_json TEXT NOT NULL,       -- JSON array — REQUIRED, must contain ≥1
    status TEXT NOT NULL DEFAULT 'pending',  -- pending/under-review/accepted/rejected/insufficient-evidence
    reviewer_notes TEXT,
    triggered_reverify INTEGER DEFAULT 0,    -- 0/1 — was a re-verification round triggered?
    new_quorum_size INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    resolved_at TEXT
);

CREATE INDEX idx_challenges_status ON challenges(status);
CREATE INDEX idx_challenges_claim ON challenges(target_claim_id);

-- ── Verification log: APPEND-ONLY. Every verification round preserved. ──
CREATE TABLE verification_log (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    quorum_size INTEGER NOT NULL,
    writer_ids_json TEXT NOT NULL,
    decomposer_id TEXT,
    result_status TEXT NOT NULL,
    convergence_score REAL,
    prompts_hash TEXT NOT NULL,              -- SHA-256 of the prompts used
    prompts_version TEXT,                    -- semver of HIVE prompts
    triggered_by TEXT NOT NULL,              -- initial/challenge/scheduled/reader-request
    triggered_by_user_id TEXT,
    raw_entries_json TEXT,                   -- the actual AI outputs (compressed if needed)
    timestamp TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_verlog_entry ON verification_log(entry_id);
CREATE INDEX idx_verlog_timestamp ON verification_log(timestamp DESC);

-- ── Users (OAuth-linked). ──
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    google_id TEXT UNIQUE,                   -- nullable until OAuth wired
    email TEXT,
    display_name TEXT,
    contributions_count INTEGER DEFAULT 0,
    entries_written INTEGER DEFAULT 0,
    challenges_filed INTEGER DEFAULT 0,
    challenges_accepted INTEGER DEFAULT 0,
    reputation_score INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    last_active_at TEXT
);

CREATE INDEX idx_users_google ON users(google_id);
CREATE INDEX idx_users_reputation ON users(reputation_score DESC);

-- ── AI nodes: registry of available AIs. Diversity dimensions for the ladder. ──
CREATE TABLE nodes (
    id TEXT PRIMARY KEY,
    model_family TEXT NOT NULL,              -- Anthropic/OpenAI/Google/Meta/Mistral/DeepSeek/...
    model_version TEXT,
    geography TEXT NOT NULL,                 -- US/EU/CN/IL/KE/BR/JP/IN/...
    license TEXT NOT NULL,                   -- proprietary/open-source/research-only
    domain TEXT DEFAULT 'general',           -- general/medical/legal/scientific/...
    ecosystem TEXT NOT NULL,                 -- western/eastern/african/latam/...
    language TEXT DEFAULT 'en',
    training_epoch TEXT,                     -- model training cutoff identifier
    availability_status TEXT DEFAULT 'active',
    operator_user_id TEXT REFERENCES users(id),
    queries_handled INTEGER DEFAULT 0,
    avg_response_time_ms INTEGER,
    disagreement_rate REAL,                  -- fraction of times this node disagreed with the consensus
    created_at TEXT DEFAULT (datetime('now')),
    last_active_at TEXT
);

CREATE INDEX idx_nodes_family ON nodes(model_family);
CREATE INDEX idx_nodes_geography ON nodes(geography);
CREATE INDEX idx_nodes_status ON nodes(availability_status);

-- ── Source blocklist (URL patterns we don't accept). ──
CREATE TABLE source_blocklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url_pattern TEXT NOT NULL,
    reason TEXT NOT NULL,                    -- social-media/AI-generated/circular/unidentified-owner
    blocked_at TEXT DEFAULT (datetime('now')),
    blocked_by_user_id TEXT
);

CREATE INDEX idx_blocklist_pattern ON source_blocklist(url_pattern);

-- ── Seed the blocklist with known bad patterns. ──
INSERT INTO source_blocklist (url_pattern, reason) VALUES
    ('twitter.com/%', 'social-media'),
    ('x.com/%', 'social-media'),
    ('facebook.com/%', 'social-media'),
    ('t.me/%', 'social-media'),
    ('reddit.com/r/%', 'social-media'),
    ('medium.com/@%', 'self-published'),
    ('substack.com/%', 'self-published'),
    ('%.wikipedia.org/%', 'circular'),       -- HIVE doesn't cite Wikipedia (it complements)
    ('en.wikipedia.org/%', 'circular'),
    ('quora.com/%', 'unidentified-authority'),
    ('answers.com/%', 'unidentified-authority');
