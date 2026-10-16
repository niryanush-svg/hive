import { appendVerificationLog } from "../db.js";

function json(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*"
        }
    });
}

// POST /api/verify — log a verification round.
// Body: { entry_id, quorum_size, writer_ids, result_status, convergence_score, prompts_hash, triggered_by }
// This endpoint is called by the client (extension) AFTER it has run the AIs and aggregated.
// The backend's job is to persist the result, not to run the AIs itself.
export async function handleVerify(request, env, path) {
    if (request.method !== "POST") {
        return json({ error: "Method not allowed; use POST" }, 405);
    }

    const body = await request.json().catch(() => null);
    if (!body) return json({ error: "Invalid JSON" }, 400);

    const required = ["entry_id", "quorum_size", "writer_ids", "result_status", "convergence_score", "prompts_hash", "triggered_by"];
    for (const field of required) {
        if (body[field] === undefined) {
            return json({ error: `Missing required field: ${field}` }, 400);
        }
    }

    const logId = `verlog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await appendVerificationLog(env.DB, {
        id: logId,
        entry_id: body.entry_id,
        quorum_size: body.quorum_size,
        writer_ids: body.writer_ids,
        decomposer_id: body.decomposer_id,
        result_status: body.result_status,
        convergence_score: body.convergence_score,
        prompts_hash: body.prompts_hash,
        prompts_version: body.prompts_version || '1.0',
        triggered_by: body.triggered_by,
        triggered_by_user_id: body.triggered_by_user_id,
        raw_entries_json: body.raw_entries ? JSON.stringify(body.raw_entries) : null
    });

    return json({ ok: true, log_id: logId }, 201);
}
