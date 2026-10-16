// Work queue for entry creation and re-verification.
//
// Three actors:
//   1. Requesters: anyone can request that HIVE write or re-verify an entry.
//   2. Nodes: HIVE Bridge browser extensions, run by volunteer contributors
//      using their own logged-in AI accounts (ChatGPT, Gemini, Claude).
//      Nodes poll for work, run the AI quorum, and submit results.
//   3. Backend: holds the queue, classifies items, attributes credit.
//
// Endpoints:
//   POST /api/queue/request       — request entry creation
//   GET  /api/queue/next          — node polls for work
//   POST /api/queue/:id/claim     — node claims an item (atomic)
//   POST /api/queue/:id/complete  — node submits verified entry
//   POST /api/queue/:id/fail      — node reports failure (node should still get partial credit)
//   GET  /api/queue/status        — public queue stats

import { classifyTopic } from "./classify.js";
import { rateLimit, tooManyRequests } from "../ratelimit.js";

function json(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }
    });
}

// Mint a queue item ID. Lexicographically sortable for fairness debugging.
function newQueueId() {
    return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Claim-stale timeout — if a node claims an item but doesn't complete within
// this window, the item is returned to the queue for another node.
const CLAIM_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

export async function handleQueue(request, env, path) {
    const segments = path.split("/").filter(Boolean); // ["api","queue", ...]
    const op = segments[2];
    const id = segments[3];

    // ── Public stats (no auth) ──
    if (request.method === "GET" && op === "status") {
        const counts = await env.DB.prepare(`
            SELECT status, COUNT(*) as n FROM queue_items GROUP BY status
        `).all();
        const summary = {};
        for (const row of (counts.results || [])) summary[row.status] = row.n;
        return json({ status_counts: summary });
    }

    // ── Node polls for next work item ──
    if (request.method === "GET" && op === "next") {
        // Release stale claims first
        await env.DB.prepare(`
            UPDATE queue_items
            SET status = 'pending', claimed_by_contributor_id = NULL, claimed_at = NULL
            WHERE status = 'claimed' AND claimed_at < datetime('now', '-1 hour')
        `).run();
        // Return up to 5 pending items, highest priority first
        const items = await env.DB.prepare(`
            SELECT id, wikidata_qid, requested_label, request_type, requested_quorum_size, classification, priority, request_count, created_at
            FROM queue_items
            WHERE status = 'pending'
            ORDER BY priority DESC, created_at ASC
            LIMIT 5
        `).all();
        return json({ available: items.results || [] });
    }

    // ── User-facing: request entry creation ──
    if (request.method === "POST" && op === "request") {
        const rl = await rateLimit(env, request, "queue_request", 20, 600);
        if (!rl.ok) return tooManyRequests(rl.retryAfter);
        const body = await request.json().catch(() => null);
        if (!body || !body.wikidata_qid) return json({ error: "wikidata_qid required" }, 400);
        if (!/^Q\d+$/.test(body.wikidata_qid)) return json({ error: "Invalid Q-ID" }, 400);

        const contributorId = request.headers.get("X-Hive-Contributor-Id") || body.contributor_id || null;

        // Look up classification + canonical label from Wikidata.
        let label = body.requested_label;
        let classification = "unknown";
        let initialQuorum = 3;
        try {
            const r = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${body.wikidata_qid}.json`, {
                headers: { "User-Agent": "HIVE-Encyclopedia/0.1" }
            });
            if (r.ok) {
                const data = await r.json();
                const ent = data.entities?.[body.wikidata_qid];
                if (ent) {
                    label = label || ent.labels?.en?.value;
                    const desc = ent.descriptions?.en?.value;
                    const p31 = (ent.claims?.P31 || []).map(s => s.mainsnak?.datavalue?.value?.id).filter(Boolean);
                    const extras = {
                        p570_date_of_death: ent.claims?.P570?.[0]?.mainsnak?.datavalue?.value?.time || null,
                        p39_position_held: (ent.claims?.P39 || []).filter(s => !s.qualifiers?.P582).map(s => s.mainsnak?.datavalue?.value?.id).filter(Boolean)
                    };
                    const c = classifyTopic({ p31_values: p31, label, description: desc, extras });
                    classification = c.classification;
                    initialQuorum = c.initial_quorum_size;
                }
            }
        } catch (e) { console.warn("Classifier fetch failed:", e); }

        // Merge with an existing pending item for the same Q-ID — bump priority + counter.
        const existing = await env.DB.prepare(`
            SELECT id, request_count, priority FROM queue_items
            WHERE wikidata_qid = ? AND status IN ('pending', 'claimed', 'processing')
            LIMIT 1
        `).bind(body.wikidata_qid).first();

        let queueId;
        if (existing) {
            queueId = existing.id;
            await env.DB.prepare(`
                UPDATE queue_items SET request_count = request_count + 1, priority = priority + 1
                WHERE id = ?
            `).bind(queueId).run();
        } else {
            queueId = newQueueId();
            await env.DB.prepare(`
                INSERT INTO queue_items
                  (id, wikidata_qid, requested_label, request_type, requested_by_contributor_id,
                   requested_quorum_size, classification)
                VALUES (?, ?, ?, 'create', ?, ?, ?)
            `).bind(queueId, body.wikidata_qid, label, contributorId, initialQuorum, classification).run();
        }

        // Log this specific request
        await env.DB.prepare(`
            INSERT INTO queue_requests (id, queue_item_id, contributor_id, user_agent)
            VALUES (?, ?, ?, ?)
        `).bind(
            `qr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
            queueId,
            contributorId,
            request.headers.get("User-Agent")?.slice(0, 200) || null
        ).run();

        // Return position estimate
        const pos = await env.DB.prepare(`
            SELECT COUNT(*) as n FROM queue_items
            WHERE status = 'pending' AND (priority > (SELECT priority FROM queue_items WHERE id = ?) OR (priority = (SELECT priority FROM queue_items WHERE id = ?) AND created_at < (SELECT created_at FROM queue_items WHERE id = ?)))
        `).bind(queueId, queueId, queueId).first();

        return json({
            ok: true,
            queue_id: queueId,
            classification,
            initial_quorum_size: initialQuorum,
            position_ahead_of_you: pos?.n || 0,
            note: "Request added. A volunteer node will pick this up. Higher demand = higher priority."
        }, 201);
    }

    // URL shape for item ops is POST /api/queue/:itemId/:action
    //   segments = ["api","queue", itemId, action]
    //   → op (segments[2]) IS the queue item id, id (segments[3]) IS the action.
    // (Earlier this checked segments[4] and bound `id` as the item id — so claim
    // bound the literal string "claim" as the id and never matched a row, and
    // complete/fail fell through to a 404. The node flow could never claim or
    // close an item. Fixed: itemId = op, action = id.)
    const itemId = op;

    // Launch readiness 4.4: claim / complete / fail share one bucket — a node
    // touches a handful of items an hour.
    if (request.method === "POST" && (id === "claim" || id === "complete" || id === "fail")) {
        const rl = await rateLimit(env, request, "queue_node", 60, 600);
        if (!rl.ok) return tooManyRequests(rl.retryAfter);
    }

    // ── Node claims an item (atomic — only one node gets it) ──
    if (request.method === "POST" && id === "claim") {
        const contributorId = request.headers.get("X-Hive-Contributor-Id");
        if (!contributorId) return json({ error: "X-Hive-Contributor-Id header required for nodes" }, 401);
        const result = await env.DB.prepare(`
            UPDATE queue_items
            SET status = 'claimed', claimed_by_contributor_id = ?, claimed_at = datetime('now')
            WHERE id = ? AND status = 'pending'
        `).bind(contributorId, itemId).run();
        if (!result.meta.changes) return json({ error: "Item not available (already claimed or not pending)" }, 409);
        return json({ ok: true, queue_id: itemId, claimed_by: contributorId });
    }

    // ── Node submits completed verification result ──
    if (request.method === "POST" && id === "complete") {
        const contributorId = request.headers.get("X-Hive-Contributor-Id");
        const body = await request.json().catch(() => null);
        if (!body || !body.entry_id) return json({ error: "entry_id required (the entry already POSTed to /api/entry)" }, 400);

        // result_entry_id has a FK to entries(id) — the entry must already exist
        // (the node POSTs it to /api/entry first). Guard so a bad/missing id
        // returns a clean 400 instead of a 500 FK violation.
        let result;
        try {
            result = await env.DB.prepare(`
                UPDATE queue_items
                SET status = 'completed', completed_at = datetime('now'), result_entry_id = ?
                WHERE id = ? AND claimed_by_contributor_id = ?
            `).bind(body.entry_id, itemId, contributorId).run();
        } catch (e) {
            return json({ error: "entry_id does not reference an existing entry — POST it to /api/entry before completing", detail: e.message }, 400);
        }
        if (!result.meta.changes) return json({ error: "Cannot complete — not the claimer or already completed" }, 409);
        // Credit the contributor
        if (contributorId) {
            try {
                await env.DB.prepare(`
                    UPDATE contributors
                    SET reputation_score = reputation_score + 10, last_active_at = datetime('now')
                    WHERE id = ?
                `).bind(contributorId).run();
            } catch (e) {}
        }
        return json({ ok: true, queue_id: itemId });
    }

    if (request.method === "POST" && id === "fail") {
        const contributorId = request.headers.get("X-Hive-Contributor-Id");
        const body = await request.json().catch(() => ({}));
        await env.DB.prepare(`
            UPDATE queue_items
            SET status = 'pending', claimed_by_contributor_id = NULL, claimed_at = NULL,
                error_message = ?
            WHERE id = ? AND claimed_by_contributor_id = ?
        `).bind(body.reason || "node failed", itemId, contributorId).run();
        return json({ ok: true, queue_id: itemId, reposted: true });
    }

    return json({ error: "Unknown queue route" }, 404);
}
