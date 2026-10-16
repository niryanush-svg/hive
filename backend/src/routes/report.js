// Bug / feedback reports from the HIVE web app.
//
// POST /api/report          — submit a report (open to all; rate-limited by size)
// GET  /api/report?key=...  — list recent reports (developer only; needs REPORT_KEY)
//
// The "Report a problem" button in the web app captures live diagnostics so the
// developer can reproduce and fix issues directly from D1.

function json(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }
    });
}

import { rateLimit, tooManyRequests } from "../ratelimit.js";

const MAX_MESSAGE = 4000;
const MAX_CONTEXT = 20000;

export async function handleReport(request, env, path) {
    if (request.method === "POST") {
        const rl = await rateLimit(env, request, "report", 10, 600);
        if (!rl.ok) return tooManyRequests(rl.retryAfter);
        const body = await request.json().catch(() => null);
        if (!body) return json({ error: "Invalid JSON" }, 400);

        const message = (body.message || "").toString().slice(0, MAX_MESSAGE);
        const kind = body.kind === "feedback" ? "feedback" : "bug";
        let contextJson = null;
        try {
            contextJson = JSON.stringify(body.context || {}).slice(0, MAX_CONTEXT);
        } catch (e) { contextJson = null; }
        const contributorId = request.headers.get("X-Hive-Contributor-Id") || body.contributor_id || null;

        if (!message && !contextJson) return json({ error: "Empty report" }, 400);

        const id = `rep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        try {
            await env.DB.prepare(`
                INSERT INTO reports (id, kind, message, context_json, contributor_id)
                VALUES (?, ?, ?, ?, ?)
            `).bind(id, kind, message, contextJson, contributorId).run();
        } catch (e) {
            return json({ error: "Could not save report", detail: e.message }, 500);
        }
        return json({ ok: true, report_id: id, note: "Thanks — this went straight to the developer." }, 201);
    }

    // Developer-only listing. Guarded by a shared key so reports aren't public.
    if (request.method === "GET") {
        const url = new URL(request.url);
        const key = url.searchParams.get("key");
        if (!env.REPORT_KEY || key !== env.REPORT_KEY) {
            return json({ error: "Reports are private. Provide ?key=<REPORT_KEY>." }, 403);
        }
        const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);
        const rows = await env.DB.prepare(`
            SELECT id, kind, message, context_json, contributor_id, status, created_at
            FROM reports ORDER BY created_at DESC LIMIT ?
        `).bind(limit).all();
        return json({ count: (rows.results || []).length, reports: rows.results || [] });
    }

    return json({ error: "Method not allowed" }, 405);
}
