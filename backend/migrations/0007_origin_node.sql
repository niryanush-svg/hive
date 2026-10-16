-- ═══════════════════════════════════════════════════════════════
-- Record the ORIGIN of each contribution, so the grader can refuse
-- same-source convergence.
--
-- In single-node pilot mode one human runs three AI tabs. They are submitted
-- under distinct per-engine contributor IDs (base__claude, base__chatgpt, ...)
-- so the panel shows three voices — useful provenance. But those three voices
-- are NOT independent evidence: they share one origin (one person, one machine,
-- one set of biases). Counting them as three would manufacture exactly the
-- false convergence the panel is built to refuse.
--
-- origin_node_id carries the base node ID alongside the per-engine contributor.
-- The grader collapses contributions that share an origin into a single
-- effective vote (see weighted.js collapseByOrigin), so a single-node panel can
-- never push a claim past "single-source" on its own — only genuinely
-- independent nodes (different origins) accumulate weight toward established.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE claim_contributions ADD COLUMN origin_node_id TEXT;
ALTER TABLE entry_panel ADD COLUMN origin_node_id TEXT;

CREATE INDEX idx_contrib_origin ON claim_contributions(claim_id, origin_node_id);
