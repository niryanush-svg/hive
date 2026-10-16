import { getEntryByQid, getClaimsByEntryId, insertEntry, insertClaim, insertSource, insertClaimSource, isSourceBlocked, normalizeText, pruneClaimsNotIn } from "../db.js";
import { SOURCE_WEIGHTS } from "../sources.js";
import { rateLimit, tooManyRequests } from "../ratelimit.js";

// Quality gate (launch readiness 4.3). An entry is public and upserted by
// Q-ID, so without this any client could overwrite a good entry with junk.
// A new submission must not be clearly worse than what it replaces:
//   - it may not replace a STANCED summary with a non-stanced one
//   - it may not drop below half the existing claim count
// Returns null when the submission may proceed, else a reason string.
function qualityGateReason(existing, existingClaimCount, body) {
    if (!existing) return null;
    let oldMeta = {};
    try { oldMeta = JSON.parse(existing.metadata_json || "{}") || {}; } catch (e) { oldMeta = {}; }
    const oldStanced = !!(oldMeta.agreement && oldMeta.agreement.stanced);
    const newStanced = !!(body.metadata && body.metadata.agreement && body.metadata.agreement.stanced);
    if (oldStanced && !newStanced) return "existing entry has a stance-verified summary; submission does not";
    const n = Array.isArray(body.atomic_claims) ? body.atomic_claims.length : 0;
    if (existingClaimCount >= 10 && n < existingClaimCount / 2) {
        return `submission has ${n} claims, existing entry has ${existingClaimCount}`;
    }
    return null;
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*"
        }
    });
}

// GET  /api/entry/:qid               → fetch entry + claims
// GET  /api/entry/:qid/claims        → fetch claims only
// POST /api/entry                    → create/update entry from a verified payload
export async function handleEntry(request, env, path) {
    const segments = path.split("/").filter(Boolean); // ["api","entry",":qid"(,"claims")]
    const qid = segments[2];
    const subpath = segments[3];

    if (request.method === "GET") {
        if (!qid) {
            return json({ error: "Q-ID required" }, 400);
        }
        if (!/^Q\d+$/.test(qid)) {
            return json({ error: "Q-ID must match pattern Q<number>" }, 400);
        }

        const entry = await getEntryByQid(env.DB, qid);
        if (!entry) {
            return json({ error: "Entry not yet verified", wikidata_qid: qid, status: "unverified" }, 404);
        }

        if (subpath === "claims") {
            const claims = await getClaimsByEntryId(env.DB, entry.id);
            return json({ entry_id: entry.id, claims });
        }

        // Default: return entry + its claims in one response
        const claims = await getClaimsByEntryId(env.DB, entry.id);
        return json({ entry, claims });
    }

    if (request.method === "POST" && segments.length === 2) {
        // POST /api/entry — submit a verified entry payload
        // Launch readiness 4.1/4.2: a node runs at most a few entries an hour,
        // so 30 per 10 minutes per IP is generous for real use and useless
        // for a flood; and every submission names its node.
        const rl = await rateLimit(env, request, "entry_submit", 30, 600);
        if (!rl.ok) return tooManyRequests(rl.retryAfter);
        const body = await request.json().catch(() => null);
        if (!body || !body.wikidata_qid || !body.atomic_claims) {
            return json({ error: "Missing wikidata_qid or atomic_claims" }, 400);
        }
        if (!/^Q\d+$/.test(body.wikidata_qid)) {
            return json({ error: "Invalid Q-ID" }, 400);
        }
        if (!Array.isArray(body.atomic_claims) || body.atomic_claims.length > 400) {
            return json({ error: "atomic_claims must be an array of at most 400 claims" }, 400);
        }

        const entryId = `hive_${body.wikidata_qid}`;
        // contributor_id comes from header (X-Hive-Contributor-Id) or body
        const contributorId = request.headers.get("X-Hive-Contributor-Id") || body.contributor_id || null;
        if (!contributorId) {
            return json({ error: "X-Hive-Contributor-Id header required — every entry names the node that produced it" }, 401);
        }

        const existing = await getEntryByQid(env.DB, body.wikidata_qid);
        if (existing) {
            const existingClaims = await getClaimsByEntryId(env.DB, existing.id);
            const reason = qualityGateReason(existing, existingClaims.length, body);
            if (reason) {
                return json({ error: "Quality gate: submission would replace a better entry", reason,
                              existing_claims: existingClaims.length, existing_status: existing.status }, 409);
            }
        }
        const entry = {
            id: entryId,
            wikidata_qid: body.wikidata_qid,
            canonical_label: body.canonical_label || body.wikidata_qid,
            canonical_language: body.canonical_language || 'en',
            status: body.status || 'draft',
            convergence_score: body.convergence_score || 0,
            quorum_size: body.quorum_size || 0,
            metadata_json: body.metadata ? JSON.stringify(body.metadata) : null,
            last_verified_at: new Date().toISOString()
        };

        await insertEntry(env.DB, entry);
        if (contributorId) {
            await env.DB.prepare(`UPDATE entries SET contributor_id = ? WHERE id = ?`).bind(contributorId, entryId).run();
            // bump contributor stats (best-effort; ignore if contributor doesn't exist yet)
            try {
                await env.DB.prepare(`
                    UPDATE contributors
                    SET entries_contributed = entries_contributed + 1, last_active_at = datetime('now')
                    WHERE id = ?
                `).bind(contributorId).run();
            } catch (e) {}
        }

        // Upsert atomic claims (+ the sources the AIs cited for each), then drop
        // the claims this round no longer produced - a rebuild REPLACES the set.
        const keepIds = [];
        for (const claim of body.atomic_claims) {
            const claimId = claim.id || `clm_${entryId}_${Math.random().toString(36).slice(2, 10)}`;
            keepIds.push(claimId);
            await insertClaim(env.DB, {
                id: claimId,
                entry_id: entryId,
                wikidata_pid: claim.wikidata_pid || null,
                text: claim.text,
                type: claim.type || 'FACT',
                status: claim.status || 'unverified',
                agreement_count: claim.agreement_count || 0,
                total_quorum: claim.total_quorum || body.quorum_size || 0,
                writer_ids: claim.writer_ids || []
            }).catch(err => console.error(`Failed to insert claim ${claim.text}:`, err.message));

            // Persist each cited source (the researcher's evidence). A source with
            // no quote, an off-ladder type, or a blocklisted URL is SKIPPED — it
            // never drops the claim. The quote requirement is the anti-illusion guard.
            if (Array.isArray(claim.sources)) {
                for (const src of claim.sources) {
                    try {
                        if (!src || !src.source_type || !SOURCE_WEIGHTS[src.source_type]) continue;
                        if (!src.quote || !String(src.quote).trim()) continue;
                        if (src.url && await isSourceBlocked(env.DB, src.url)) continue;
                        const sourceId = src.id || `src_${entryId}_${Math.random().toString(36).slice(2, 10)}`;
                        await insertSource(env.DB, {
                            id: sourceId,
                            url: src.url || null,
                            doi: src.doi || null,
                            title: src.title || src.url || 'source',
                            publication_date: src.publication_date || null,
                            source_type: src.source_type,
                            source_weight: SOURCE_WEIGHTS[src.source_type],
                            publisher: src.publisher || null,
                            language: src.language || 'en'
                        });
                        await insertClaimSource(env.DB, {
                            claim_id: claimId,
                            source_id: sourceId,
                            supports_or_contradicts: src.supports || 'supports',
                            quote: src.quote,
                            independence: src.independence || 'unknown'
                        });
                    } catch (e) { console.warn('claim source skipped:', e.message); }
                }
            }
        }

        let pruned = 0;
        try { pruned = await pruneClaimsNotIn(env.DB, entryId, keepIds); }
        catch (e) { console.error("prune stale claims:", e.message); }

        return json({ ok: true, entry_id: entryId, claims_count: body.atomic_claims.length, pruned_claims: pruned }, 201);
    }

    return json({ error: "Method not allowed" }, 405);
}
