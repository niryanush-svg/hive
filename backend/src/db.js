// ═══════════════════════════════════════════════════════════════
// D1 query helpers. Thin wrapper to keep route handlers concise.
// All queries parameterized — no string interpolation into SQL.
// ═══════════════════════════════════════════════════════════════

export async function getEntryByQid(db, qid) {
    if (!db) return null;
    const result = await db.prepare(`
        SELECT * FROM entries WHERE wikidata_qid = ? LIMIT 1
    `).bind(qid).first();
    return result;
}

export async function getClaimsByEntryId(db, entryId) {
    if (!db) return [];
    const result = await db.prepare(`
        SELECT * FROM atomic_claims
        WHERE entry_id = ?
        ORDER BY status DESC, created_at ASC
    `).bind(entryId).all();
    return result.results || [];
}

// Which AIs voted on a claim — with model name, tier, paid/free, weight.
// This is what the reader sees: full attribution, nothing hidden.
export async function getContributionsForClaim(db, claimId) {
    if (!db) return [];
    const result = await db.prepare(`
        SELECT cc.vote, cc.weight, cc.role, cc.contributor_id, cc.origin_node_id,
               m.display_name, m.family, m.tier, m.is_paid, m.geography
        FROM claim_contributions cc
        LEFT JOIN models m ON m.id = cc.model_id
        WHERE cc.claim_id = ?
        ORDER BY cc.weight DESC
    `).bind(claimId).all();
    return result.results || [];
}

export async function getSourcesForClaim(db, claimId) {
    if (!db) return [];
    const result = await db.prepare(`
        SELECT s.*, cs.supports_or_contradicts, cs.quote, cs.page_number, cs.independence
        FROM claim_sources cs
        JOIN sources s ON s.id = cs.source_id
        WHERE cs.claim_id = ?
        ORDER BY s.source_weight DESC
    `).bind(claimId).all();
    return result.results || [];
}

export async function insertEntry(db, entry) {
    if (!db) throw new Error("DB not available");
    return await db.prepare(`
        INSERT INTO entries (id, wikidata_qid, canonical_label, canonical_language, status, convergence_score, quorum_size, metadata_json, last_verified_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(wikidata_qid) DO UPDATE SET
            canonical_label = excluded.canonical_label,
            status = excluded.status,
            convergence_score = excluded.convergence_score,
            quorum_size = excluded.quorum_size,
            metadata_json = COALESCE(excluded.metadata_json, entries.metadata_json),
            updated_at = datetime('now'),
            last_verified_at = excluded.last_verified_at
    `).bind(
        entry.id,
        entry.wikidata_qid,
        entry.canonical_label,
        entry.canonical_language || 'en',
        entry.status || 'draft',
        entry.convergence_score || 0,
        entry.quorum_size || 0,
        entry.metadata_json || null,
        entry.last_verified_at || new Date().toISOString()
    ).run();
}

export async function insertClaim(db, claim) {
    if (!db) throw new Error("DB not available");
    return await db.prepare(`
        INSERT INTO atomic_claims (id, entry_id, wikidata_pid, text, text_normalized, type, status, agreement_count, total_quorum, writer_ids_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            text = excluded.text,
            text_normalized = excluded.text_normalized,
            type = excluded.type,
            status = excluded.status,
            agreement_count = excluded.agreement_count,
            total_quorum = excluded.total_quorum,
            writer_ids_json = excluded.writer_ids_json,
            updated_at = datetime('now')
    `).bind(
        claim.id,
        claim.entry_id,
        claim.wikidata_pid || null,
        claim.text,
        normalizeText(claim.text),
        claim.type || 'FACT',
        claim.status || 'unverified',
        claim.agreement_count || 0,
        claim.total_quorum || 0,
        JSON.stringify(claim.writer_ids || [])
    ).run();
}

// Remove the claims of an entry that a fresh verification round no longer
// produced. Claim ids are text slugs, so a reworded claim gets a new id and
// the old row would otherwise live on forever. Contributions, sources and
// challenges on the dropped rows cascade. D1 allows 100 bound parameters per
// statement, hence the chunking.
export async function pruneClaimsNotIn(db, entryId, keepIds) {
    if (!db) throw new Error("DB not available");
    const rows = await db.prepare(`SELECT id FROM atomic_claims WHERE entry_id = ?`).bind(entryId).all();
    const keep = new Set(keepIds || []);
    const stale = (rows.results || []).map(r => r.id).filter(id => !keep.has(id));
    for (let i = 0; i < stale.length; i += 50) {
        const chunk = stale.slice(i, i + 50);
        await db.prepare(`DELETE FROM atomic_claims WHERE entry_id = ? AND id IN (${chunk.map(() => "?").join(",")})`)
            .bind(entryId, ...chunk).run();
    }
    return stale.length;
}

export async function insertSource(db, source) {
    if (!db) throw new Error("DB not available");
    return await db.prepare(`
        INSERT INTO sources (id, url, doi, isbn, title, authors_json, publication_date, source_type, source_weight, publisher, language)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
    `).bind(
        source.id,
        source.url || null,
        source.doi || null,
        source.isbn || null,
        source.title,
        JSON.stringify(source.authors || []),
        source.publication_date || null,
        source.source_type,
        source.source_weight,
        source.publisher || null,
        source.language || 'en'
    ).run();
}

// Link a source to a claim (the evidence row). claim_sources already had a
// read-join (getSourcesForClaim) but no writer — this is it.
export async function insertClaimSource(db, link) {
    if (!db) throw new Error("DB not available");
    return await db.prepare(`
        INSERT INTO claim_sources (claim_id, source_id, supports_or_contradicts, quote, page_number, independence)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(claim_id, source_id) DO UPDATE SET
            supports_or_contradicts = excluded.supports_or_contradicts,
            quote = excluded.quote,
            independence = excluded.independence
    `).bind(
        link.claim_id,
        link.source_id,
        link.supports_or_contradicts || 'supports',
        link.quote || null,
        link.page_number || null,
        link.independence || 'unknown'
    ).run();
}

export async function insertChallenge(db, challenge) {
    if (!db) throw new Error("DB not available");
    return await db.prepare(`
        INSERT INTO challenges (id, target_claim_id, target_entry_id, challenger_user_id, challenge_type, explanation, new_source_ids_json, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `).bind(
        challenge.id,
        challenge.target_claim_id || null,
        challenge.target_entry_id || null,
        challenge.challenger_user_id || null,
        challenge.challenge_type,
        challenge.explanation || null,
        JSON.stringify(challenge.new_source_ids || [])
    ).run();
}

export async function appendVerificationLog(db, log) {
    if (!db) throw new Error("DB not available");
    return await db.prepare(`
        INSERT INTO verification_log (id, entry_id, quorum_size, writer_ids_json, decomposer_id, result_status, convergence_score, prompts_hash, prompts_version, triggered_by, triggered_by_user_id, raw_entries_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        log.id,
        log.entry_id,
        log.quorum_size,
        JSON.stringify(log.writer_ids || []),
        log.decomposer_id || null,
        log.result_status,
        log.convergence_score,
        log.prompts_hash,
        log.prompts_version || '1.0',
        log.triggered_by,
        log.triggered_by_user_id || null,
        log.raw_entries_json || null
    ).run();
}

export async function isSourceBlocked(db, url) {
    if (!db || !url) return false;
    // Simple LIKE-based blocklist check. SQLite native LIKE.
    const result = await db.prepare(`
        SELECT id, reason FROM source_blocklist
        WHERE ? LIKE url_pattern
        LIMIT 1
    `).bind(url).first();
    return result || false;
}

// Every entry, for the sitemap. Ordered newest-first so that if the limit is
// ever hit it is the stalest entries that fall off, not the freshest.
export async function getAllEntriesForSitemap(db, limit = 45000) {
    if (!db) return [];
    const result = await db.prepare(`
        SELECT wikidata_qid, updated_at
        FROM entries
        ORDER BY updated_at DESC
        LIMIT ?
    `).bind(limit).all();
    return result.results || [];
}

export async function getRecentEntries(db, limit = 20) {
    if (!db) return [];
    const result = await db.prepare(`
        SELECT id, wikidata_qid, canonical_label, status, convergence_score, updated_at,
               CASE WHEN metadata_json LIKE '%"stanced":true%' THEN 1 ELSE 0 END AS has_agreement
        FROM entries
        ORDER BY updated_at DESC
        LIMIT ?
    `).bind(limit).all();
    return result.results || [];
}

// Normalize text for matching: lowercase, strip punctuation, collapse whitespace.
// This is the same heuristic used in the frontend Jaccard claim matcher so
// the DB and the in-memory aggregator agree on what "same claim" means.
function normalizeText(text) {
    if (!text) return "";
    return text.toLowerCase()
        .replace(/[.,;:!?()"'`‘’“”]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

export { normalizeText };
