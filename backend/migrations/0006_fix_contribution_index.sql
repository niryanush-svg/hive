-- ═══════════════════════════════════════════════════════════════
-- Fix: the one-AI-per-user index was at the wrong granularity.
--
-- 0005 created idx_one_writer_per_user_per_entry on
--   claim_contributions(entry_id, contributor_id, role)
-- which permits only ONE contribution row per (entry, user, writer) — but a
-- writer must vote on EVERY claim in the entry, so the 2nd claim onward was
-- silently rejected by the unique index (observed: claim #1 graded, #2+ stayed
-- at 0 weighted agreement).
--
-- The entry-level "one AI per user per entry" rule is already enforced correctly
-- by entry_panel's PRIMARY KEY (entry_id, contributor_id, role) and the 409 check
-- in /api/submit-vote. So at the claim level we only need to stop a user from
-- voting twice on the SAME claim with the same role. Re-key the index to include
-- claim_id.
-- ═══════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS idx_one_writer_per_user_per_entry;

CREATE UNIQUE INDEX idx_one_vote_per_user_per_claim
    ON claim_contributions(claim_id, contributor_id, role)
    WHERE contributor_id IS NOT NULL;
