// Submit AI contributions (votes) on a claim, enforcing the one-AI-per-user rule
// and applying weighted aggregation.
//
// A node (one user) submits its AI's votes on an entry's claims. The DB unique
// index idx_one_writer_per_user_per_entry rejects a second writer-vote from the
// same user on the same entry — so no single user can supply two voices.

import { tallyWeighted, gradeFromTally, gradeToStatus, collapseByOrigin } from "../weighted.js";
import { rateLimit, tooManyRequests } from "../ratelimit.js";
import { computeSourceStrength } from "../sources.js";

function json(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }
    });
}

// Salted SHA-256 of the request IP. We store the HASH, never the raw IP
// (no-PII rule). The salt keeps the hash from being reversible via a rainbow
// table of the IPv4 space. Returns null when no IP header is present.
async function hashIp(request, env) {
    // CF-Connecting-IP ONLY — never the client-settable X-Forwarded-For, which a
    // caller could vary per request to forge independent origins.
    const ip = request.headers.get("CF-Connecting-IP");
    if (!ip) return null;
    const salt = (env && env.ORIGIN_SALT) || "hive-origin-v1";
    const data = new TextEncoder().encode(salt + "|" + ip.trim());
    const digest = await crypto.subtle.digest("SHA-256", data);
    return "ip_" + Array.from(new Uint8Array(digest)).slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join("");
}

// POST /api/submit-vote
// Body: {
//   entry_id, model_id, role: "writer",
//   votes: [{ claim_id, vote: "agree"|"disagree"|"abstain" }]
// }
// Header: X-Hive-Contributor-Id (the user's node)
export async function handleSubmitVote(request, env, path) {
    if (request.method !== "POST") return json({ error: "Use POST" }, 405);

    // Launch readiness 4.4: one panel = up to 3 vote submissions per entry.
    const rl = await rateLimit(env, request, "submit_vote", 60, 600);
    if (!rl.ok) return tooManyRequests(rl.retryAfter);

    const contributorId = request.headers.get("X-Hive-Contributor-Id");
    if (!contributorId) return json({ error: "X-Hive-Contributor-Id header required" }, 401);

    const body = await request.json().catch(() => null);
    if (!body || !body.entry_id || !Array.isArray(body.votes)) {
        return json({ error: "entry_id and votes[] required" }, 400);
    }
    const role = body.role || "writer";
    const modelId = body.model_id || "unknown";
    // The base node behind this contribution. Per-engine votes from one node
    // (base__claude, base__chatgpt, …) all carry the SAME origin_node_id = base,
    // so the grader can collapse them into one independent voice. If a client
    // omits it, the contributor is treated as its own origin (independent).
    // Server-derived origin signals the client cannot forge.
    const originIpHash = await hashIp(request, env);
    const verifiedSubject = body.verified_subject || null; // set once OAuth is wired
    // FAIL-CLOSED: with NO server-derived origin (no OAuth subject and no CF IP —
    // e.g. non-Cloudflare/dev), do NOT trust the client's origin_node_id for
    // independence. Pin all such votes to one shared origin so a caller can't
    // forge N "independent" nodes. On Cloudflare production CF-Connecting-IP is
    // always present, so this only affects the untrusted edge case.
    const originNodeId = (!verifiedSubject && !originIpHash)
        ? "unattested"
        : (body.origin_node_id || contributorId);

    // Look up the model's current weight.
    const model = await env.DB.prepare(`SELECT id, base_weight, display_name, family FROM models WHERE id = ? LIMIT 1`)
        .bind(modelId).first();
    const weight = model ? model.base_weight : 0.30; // unknown model → low weight

    // ── ENFORCE one-AI-per-user-per-entry. ──
    // Check entry_panel for an existing writer from this user on this entry.
    const existingPanel = await env.DB.prepare(`
        SELECT contributor_id, model_id FROM entry_panel
        WHERE entry_id = ? AND contributor_id = ? AND role = ?
        LIMIT 1
    `).bind(body.entry_id, contributorId, role).first();

    if (existingPanel) {
        return json({
            error: "one_ai_per_user_per_entry",
            message: `You already supplied a ${role} (${existingPanel.model_id}) for this entry. Each user contributes at most one AI per entry — this keeps the panel decentralized and prevents one person's biases from counting twice.`,
        }, 409);
    }

    // Register on the panel.
    await env.DB.prepare(`
        INSERT INTO entry_panel (entry_id, contributor_id, model_id, role, weight, origin_node_id, origin_ip_hash, verified_subject)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(entry_id, contributor_id, role) DO NOTHING
    `).bind(body.entry_id, contributorId, modelId, role, weight, originNodeId, originIpHash, verifiedSubject).run();

    // Insert each vote as a claim_contribution + recompute that claim's grade.
    const results = [];
    for (const v of body.votes) {
        if (!v.claim_id || !v.vote) continue;
        const contribId = `cc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        try {
            await env.DB.prepare(`
                INSERT INTO claim_contributions (id, claim_id, entry_id, model_id, contributor_id, vote, weight, role, origin_node_id, origin_ip_hash, verified_subject)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(contribId, v.claim_id, body.entry_id, modelId, contributorId, v.vote, weight, role, originNodeId, originIpHash, verifiedSubject).run();
        } catch (e) {
            // Unique index may reject a duplicate writer per user per entry across claims;
            // that's expected only at the panel level, not per claim, so log and continue.
            console.warn("contribution insert:", e.message);
        }

        // Recompute weighted grade for this claim from ALL contributions —
        // but collapse same-origin votes first so a single node's three engines
        // count as ONE independent voice, not three.
        const allContribs = await env.DB.prepare(`
            SELECT vote, weight, origin_node_id, origin_ip_hash, verified_subject, contributor_id
            FROM claim_contributions WHERE claim_id = ?
        `).bind(v.claim_id).all();
        const claimRow = await env.DB.prepare(`SELECT type, status, agreement_count FROM atomic_claims WHERE id = ? LIMIT 1`)
            .bind(v.claim_id).first();

        const independent = collapseByOrigin(allContribs.results || []);
        const tally = tallyWeighted(independent);

        // Grounding strength from this claim's cited external sources. The AIs are
        // researchers, not voters: agreement alone can't lift a claim past
        // convergent-unverified — only quoted A–H sources do.
        const srcRows = await env.DB.prepare(`
            SELECT cs.supports_or_contradicts, cs.quote, cs.independence,
                   s.source_type, s.publisher, s.url, s.doi, s.id as source_id
            FROM claim_sources cs JOIN sources s ON s.id = cs.source_id
            WHERE cs.claim_id = ?
        `).bind(v.claim_id).all();
        const sourceStrength = computeSourceStrength(srcRows.results || []);

        const graded = gradeFromTally(tally, { type: claimRow?.type || "FACT", sourceStrength });
        // Two axes, kept apart. `status` is the PANEL reading (how many of the
        // writers agreed, whether any contradicted) and `evidence_grade` is the
        // INDEPENDENCE reading (how many separate origins, how strong the cited
        // sources). A single node is capped at UNPROVEN by design - that must
        // show up as the grade, not erase a 3/3 panel agreement by rewriting
        // status to "single-source". Votes may still move status when they say
        // something the panel could not: refuted, disputed, or a genuinely
        // independent establishment.
        const gradedStatus = gradeToStatus(graded.grade);
        const panelStatus = claimRow?.status || "unverified";
        const overriding = new Set(["refuted", "disputed", "established", "well-supported"]);
        const newStatus = overriding.has(gradedStatus) ? gradedStatus
                        : (panelStatus === "unverified" ? gradedStatus : panelStatus);
        const panelCount = Number(claimRow?.agreement_count) || 0;

        await env.DB.prepare(`
            UPDATE atomic_claims
            SET weighted_agreement = ?, weighted_total = ?, evidence_grade = ?,
                status = ?, agreement_count = ?, updated_at = datetime('now')
            WHERE id = ?
        `).bind(
            tally.agreeW, tally.totalW, graded.grade, newStatus,
            Math.max(panelCount, Math.round(tally.agreeW * 10) / 10), v.claim_id
        ).run();

        results.push({ claim_id: v.claim_id, evidence_grade: graded.grade, status: newStatus,
                       weighted_agreement: tally.agreeW,
                       contributions: (allContribs.results || []).length,
                       independent_sources: independent.length,
                       source_strength: Math.round(sourceStrength * 100) / 100,
                       reason: graded.reason });
    }

    return json({
        ok: true,
        entry_id: body.entry_id,
        model: model ? { id: model.id, display_name: model.display_name, weight } : { id: modelId, weight, note: "unknown model — low weight" },
        contributor_id: contributorId,
        votes_recorded: results.length,
        results
    }, 201);
}
