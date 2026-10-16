import { insertChallenge, insertSource, isSourceBlocked } from "../db.js";
import { SOURCE_WEIGHTS } from "../sources.js";
import { rateLimit, tooManyRequests } from "../ratelimit.js";

function json(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*"
        }
    });
}

// SOURCE_WEIGHTS now lives in ../sources.js (shared with the grader).

// Challenge-strength rules per the dirgom.
function challengeMeetsBar(targetStatus, sources) {
    const weighted = sources.map(s => ({
        type: s.source_type,
        weight: SOURCE_WEIGHTS[s.source_type] || 0
    }));
    const aOrB = weighted.filter(s => s.type === 'A' || s.type === 'B').length;
    const cOrD = weighted.filter(s => s.type === 'C' || s.type === 'D').length;

    if (targetStatus === 'established') {
        return aOrB >= 2 || cOrD >= 3;
    }
    if (targetStatus === 'well-supported') {
        return aOrB >= 1 || (sources.filter(s => ['B','C'].includes(s.source_type)).length >= 2);
    }
    // disputed or below: any D-or-better source admitted.
    return weighted.some(s => s.weight >= 70);
}

// POST /api/challenge — submit a challenge.
// Required: target (claim_id or entry_id), challenge_type, sources (≥1, with type+url+title).
export async function handleChallenge(request, env, path) {
    if (request.method !== "POST") {
        return json({ error: "Method not allowed; use POST" }, 405);
    }

    const rl = await rateLimit(env, request, "challenge", 15, 600);
    if (!rl.ok) return tooManyRequests(rl.retryAfter);

    const body = await request.json().catch(() => null);
    if (!body) return json({ error: "Invalid JSON" }, 400);
    if (!body.challenge_type || !['refute','support','amend','flag-bias'].includes(body.challenge_type)) {
        return json({ error: "challenge_type must be one of: refute, support, amend, flag-bias" }, 400);
    }
    if (!body.target_claim_id && !body.target_entry_id) {
        return json({ error: "Must specify target_claim_id or target_entry_id" }, 400);
    }
    if (!Array.isArray(body.sources) || body.sources.length === 0) {
        return json({
            error: "At least one source is required for a challenge",
            help: "Submit {sources: [{url, title, source_type, ...}]}. Without evidence, no challenge."
        }, 400);
    }

    // Validate each source against blocklist + minimum fields.
    const sourceIds = [];
    const accepted = [];   // the source objects that passed — kept aligned with sourceIds
    const rejected = [];
    for (const src of body.sources) {
        if (!src.title) {
            rejected.push({ source: src, reason: "missing title" });
            continue;
        }
        if (!src.source_type || !SOURCE_WEIGHTS[src.source_type]) {
            rejected.push({ source: src, reason: `invalid source_type: ${src.source_type}. Must be A-H.` });
            continue;
        }
        // Only http(s) URLs — never store a javascript:/data: URI that could
        // later render as a live link on a public entry page.
        if (src.url && !/^https?:\/\//i.test(src.url)) {
            rejected.push({ source: src, reason: "url must start with http:// or https://" });
            continue;
        }
        if (src.url) {
            const blocked = await isSourceBlocked(env.DB, src.url);
            if (blocked) {
                rejected.push({ source: src, reason: `blocked: ${blocked.reason}` });
                continue;
            }
        }

        const sourceId = `src_${Math.random().toString(36).slice(2, 12)}`;
        await insertSource(env.DB, {
            id: sourceId,
            url: src.url,
            doi: src.doi,
            isbn: src.isbn,
            title: src.title,
            authors: src.authors || [],
            publication_date: src.publication_date,
            source_type: src.source_type,
            source_weight: SOURCE_WEIGHTS[src.source_type],
            publisher: src.publisher,
            language: src.language || 'en'
        });
        sourceIds.push(sourceId);
        accepted.push(src);   // keep aligned with sourceIds
    }

    if (sourceIds.length === 0) {
        return json({
            error: "All submitted sources were rejected",
            rejected
        }, 400);
    }

    // The evidence bar is set by the TARGET's real status in the DB — never by a
    // client-supplied target_status (which a challenger could set to 'disputed'
    // to sneak past the bar protecting an 'established' claim).
    let targetStatus;
    if (body.target_claim_id) {
        const row = await env.DB.prepare(`SELECT status FROM atomic_claims WHERE id = ? LIMIT 1`).bind(body.target_claim_id).first();
        if (!row) return json({ error: "target claim not found" }, 404);
        targetStatus = row.status;
    } else {
        const row = await env.DB.prepare(`SELECT status FROM entries WHERE id = ? LIMIT 1`).bind(body.target_entry_id).first();
        if (!row) return json({ error: "target entry not found" }, 404);
        targetStatus = row.status;
    }

    // Check the evidence bar against the ACCEPTED sources (aligned with sourceIds).
    const meetsBar = challengeMeetsBar(targetStatus, accepted);
    if (!meetsBar) {
        return json({
            error: "Submitted sources do not meet the evidence bar for this claim's status",
            help: `To challenge a '${targetStatus}' claim, you need stronger sources. See /docs/dirgom for ladder.`,
            target_status: targetStatus,
            sources_accepted: sourceIds.length,
            sources_rejected: rejected.length
        }, 422);
    }

    const challengeId = `chl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const contributorId = request.headers.get("X-Hive-Contributor-Id") || body.contributor_id || null;
    await insertChallenge(env.DB, {
        id: challengeId,
        target_claim_id: body.target_claim_id,
        target_entry_id: body.target_entry_id,
        challenger_user_id: body.challenger_user_id || null,
        challenge_type: body.challenge_type,
        explanation: body.explanation,
        new_source_ids: sourceIds
    });
    if (contributorId) {
        await env.DB.prepare(`UPDATE challenges SET contributor_id = ? WHERE id = ?`).bind(contributorId, challengeId).run();
        try {
            await env.DB.prepare(`
                UPDATE contributors
                SET challenges_filed = challenges_filed + 1, last_active_at = datetime('now')
                WHERE id = ?
            `).bind(contributorId).run();
        } catch (e) {}
    }

    return json({
        ok: true,
        challenge_id: challengeId,
        sources_accepted: sourceIds.length,
        sources_rejected: rejected.length,
        rejected_details: rejected,
        next_step: "Challenge is pending. Will trigger re-verification when reviewed."
    }, 201);
}
