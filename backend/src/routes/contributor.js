import { rateLimit, tooManyRequests } from "../ratelimit.js";
// Anonymous contributor tokens. A browser stores its anon ID in localStorage;
// every entry/challenge POST includes it. Future Google OAuth binds the anon
// ID to a real user.

function json(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }
    });
}

// POST /api/contributor/new — mint a fresh anonymous ID
// GET  /api/contributor/:id — fetch contributor profile
// GET  /api/contributor/:id/contributions — list entries this contributor added
export async function handleContributor(request, env, path) {
    const segments = path.split("/").filter(Boolean); // ["api","contributor",...]
    const op = segments[2];

    if (request.method === "POST" && op === "new") {
        // Launch readiness 4.4: a browser creates one node id, ever.
        const rl = await rateLimit(env, request, "contributor_new", 10, 600);
        if (!rl.ok) return tooManyRequests(rl.retryAfter);
        const id = "anon_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
        const body = await request.json().catch(() => ({}));
        const displayName = body.display_name || null;
        await env.DB.prepare(`
            INSERT INTO contributors (id, display_name, last_active_at)
            VALUES (?, ?, datetime('now'))
        `).bind(id, displayName).run();
        return json({ ok: true, contributor_id: id, display_name: displayName }, 201);
    }

    if (request.method === "GET" && segments[2] && segments[3] !== "contributions") {
        const id = segments[2];
        const row = await env.DB.prepare(`
            SELECT * FROM contributors WHERE id = ? LIMIT 1
        `).bind(id).first();
        if (!row) return json({ error: "Contributor not found" }, 404);
        return json({ contributor: row });
    }

    if (request.method === "GET" && segments[3] === "contributions") {
        const id = segments[2];
        const rows = await env.DB.prepare(`
            SELECT id, wikidata_qid, canonical_label, status, updated_at
            FROM entries WHERE contributor_id = ? ORDER BY updated_at DESC LIMIT 100
        `).bind(id).all();
        const chs = await env.DB.prepare(`
            SELECT id, target_claim_id, target_entry_id, challenge_type, status, created_at
            FROM challenges WHERE contributor_id = ? ORDER BY created_at DESC LIMIT 100
        `).bind(id).all();
        return json({
            contributor_id: id,
            entries: rows.results || [],
            challenges: chs.results || []
        });
    }

    return json({ error: "Unknown contributor route" }, 404);
}
