-- ═══════════════════════════════════════════════════════════════
-- Sybil hardening: let the SERVER decide origin, not the client.
--
-- 0007 collapsed votes by client-supplied origin_node_id. But a client can lie:
-- clear localStorage, mint three base IDs, and present one machine as three
-- independent nodes. The fix is to derive a server-side origin signal the client
-- cannot forge — a salted hash of the request IP (Cloudflare's CF-Connecting-IP).
-- Three engines from one machine share an IP, so they collapse to one origin
-- regardless of what localStorage claims.
--
-- We store a HASH, never the raw IP (no-PII rule). Limitation: users behind one
-- NAT/household share an IP and will under-count as one origin — that errs toward
-- *under*-claiming independence, the safe direction for an epistemic system.
-- A future OAuth subject (verified_subject) overrides IP and fixes the NAT case.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE claim_contributions ADD COLUMN origin_ip_hash TEXT;
ALTER TABLE claim_contributions ADD COLUMN verified_subject TEXT;
ALTER TABLE entry_panel ADD COLUMN origin_ip_hash TEXT;
ALTER TABLE entry_panel ADD COLUMN verified_subject TEXT;
