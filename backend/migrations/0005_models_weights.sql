-- Model registry + per-claim AI attribution + weighted aggregation.
--
-- Design goals (per user):
--  1. Each of the N AIs verifying an entry must come from a DIFFERENT user/node.
--     No single user supplies two voices on the same entry — that would let one
--     person's biases count twice and undermine decentralization.
--  2. Different models carry different weight. A frontier paid model (Opus 4.7,
--     GPT-5) is weighted higher than a small free model (Haiku, GPT-4o-mini).
--  3. Everything visible to the reader; nothing editable by the reader.
--  4. Unproven / false claims are marked as such and NOT given equal weight.

-- ── Model registry: every AI model HIVE knows how to weight. ──
CREATE TABLE models (
    id TEXT PRIMARY KEY,                  -- "claude-opus-4-7", "gpt-5", "gemini-2.5-pro"
    family TEXT NOT NULL,                 -- Anthropic / OpenAI / Google / Meta / Mistral / DeepSeek / xAI
    display_name TEXT NOT NULL,           -- "Claude Opus 4.7"
    tier TEXT NOT NULL,                   -- frontier / mid / small / open
    is_paid INTEGER NOT NULL DEFAULT 1,   -- 1 = requires paid subscription, 0 = free
    base_weight REAL NOT NULL DEFAULT 1.0,-- voting weight (frontier paid ~1.0, small free ~0.4)
    release_epoch TEXT,                   -- coarse training-cutoff identifier, e.g. "2025-Q4"
    geography TEXT DEFAULT 'US',          -- where the model is hosted/trained (bias signal)
    ecosystem TEXT DEFAULT 'western',     -- western / eastern / other
    notes TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ── Per-claim AI contribution: who said what, with what model. ──
-- This is the granular record behind every claim's agreement_count. It lets us
-- show the reader exactly which AIs (model + user) voted for a claim, and apply
-- weighted aggregation.
CREATE TABLE claim_contributions (
    id TEXT PRIMARY KEY,
    claim_id TEXT NOT NULL REFERENCES atomic_claims(id) ON DELETE CASCADE,
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    model_id TEXT REFERENCES models(id),
    contributor_id TEXT,                  -- which user's node ran this AI
    vote TEXT NOT NULL,                   -- agree / disagree / abstain
    weight REAL NOT NULL DEFAULT 1.0,     -- snapshot of model weight at contribution time
    role TEXT,                            -- writer / decomposer / falsifier
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_contrib_claim ON claim_contributions(claim_id);
CREATE INDEX idx_contrib_entry ON claim_contributions(entry_id);
CREATE INDEX idx_contrib_model ON claim_contributions(model_id);

-- ── CRITICAL: one user supplies at most one AI per entry. ──
-- A user (contributor) can run several models, but only ONE of their votes
-- counts per entry. This unique index enforces it at the DB level: a second
-- insert for the same (entry_id, contributor_id, role=writer) fails.
CREATE UNIQUE INDEX idx_one_writer_per_user_per_entry
    ON claim_contributions(entry_id, contributor_id, role)
    WHERE role = 'writer' AND contributor_id IS NOT NULL;

-- ── Verification participation: which (user, model) pairs verified an entry. ──
-- Enforces the "different users" rule at the entry level and records the panel.
CREATE TABLE entry_panel (
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    contributor_id TEXT NOT NULL,
    model_id TEXT REFERENCES models(id),
    role TEXT NOT NULL,                   -- writer / decomposer / lead
    weight REAL DEFAULT 1.0,
    joined_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (entry_id, contributor_id, role)
);

CREATE INDEX idx_panel_entry ON entry_panel(entry_id);

-- ── Add weighted columns to atomic_claims ──
ALTER TABLE atomic_claims ADD COLUMN weighted_agreement REAL DEFAULT 0;
ALTER TABLE atomic_claims ADD COLUMN weighted_total REAL DEFAULT 0;
ALTER TABLE atomic_claims ADD COLUMN evidence_grade TEXT DEFAULT 'unverified';
-- evidence_grade: proven / well-supported / contested / unproven / false / normative

-- ── Seed the model registry with current (2026) models + weights. ──
-- Weight rationale: frontier paid = 1.0, mid paid = 0.7, small/free = 0.4,
-- open-weight self-hosted = 0.5 (diversity bonus offsets smaller training).
INSERT INTO models (id, family, display_name, tier, is_paid, base_weight, release_epoch, geography, ecosystem) VALUES
  ('claude-opus-4-8',   'Anthropic', 'Claude Opus 4.8',   'frontier', 1, 1.00, '2026-Q1', 'US', 'western'),
  ('claude-opus-4-7',   'Anthropic', 'Claude Opus 4.7',   'frontier', 1, 0.98, '2025-Q4', 'US', 'western'),
  ('claude-sonnet-4-6', 'Anthropic', 'Claude Sonnet 4.6', 'mid',      1, 0.75, '2025-Q4', 'US', 'western'),
  ('claude-haiku-4-5',  'Anthropic', 'Claude Haiku 4.5',  'small',    1, 0.45, '2025-Q3', 'US', 'western'),
  ('gpt-5',             'OpenAI',    'GPT-5',             'frontier', 1, 1.00, '2025-Q3', 'US', 'western'),
  ('gpt-5-mini',        'OpenAI',    'GPT-5 mini',        'mid',      1, 0.65, '2025-Q3', 'US', 'western'),
  ('gpt-4o',            'OpenAI',    'GPT-4o',            'mid',      1, 0.70, '2025-Q1', 'US', 'western'),
  ('gpt-4o-mini',       'OpenAI',    'GPT-4o mini',       'small',    0, 0.40, '2025-Q1', 'US', 'western'),
  ('gemini-2.5-pro',    'Google',    'Gemini 2.5 Pro',    'frontier', 1, 0.98, '2025-Q4', 'US', 'western'),
  ('gemini-2.5-flash',  'Google',    'Gemini 2.5 Flash',  'small',    0, 0.45, '2025-Q4', 'US', 'western'),
  ('gemini-2.0-flash',  'Google',    'Gemini 2.0 Flash',  'small',    0, 0.40, '2025-Q1', 'US', 'western'),
  ('llama-4-405b',      'Meta',      'Llama 4 405B',      'frontier', 0, 0.80, '2025-Q2', 'US', 'western'),
  ('mistral-large-3',   'Mistral',   'Mistral Large 3',   'mid',      0, 0.65, '2025-Q3', 'EU', 'western'),
  ('deepseek-v3',       'DeepSeek',  'DeepSeek V3',       'frontier', 0, 0.75, '2025-Q2', 'CN', 'eastern'),
  ('qwen-3-max',        'Alibaba',   'Qwen 3 Max',        'frontier', 0, 0.70, '2025-Q3', 'CN', 'eastern'),
  ('grok-4',            'xAI',       'Grok 4',            'frontier', 1, 0.85, '2025-Q4', 'US', 'western'),
  ('unknown',           'Unknown',   'Unknown model',     'small',    0, 0.30, NULL, 'unknown', 'unknown');
