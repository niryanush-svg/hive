import { getSourcesForClaim } from "../db.js";

function json(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*"
        }
    });
}

// GET /api/claim/:id → fetch one claim + its sources
export async function handleClaim(request, env, path) {
    const segments = path.split("/").filter(Boolean); // ["api","claim",":id"]
    const claimId = segments[2];

    if (request.method === "GET") {
        if (!claimId) return json({ error: "Claim ID required" }, 400);
        const claim = await env.DB.prepare(`
            SELECT * FROM atomic_claims WHERE id = ? LIMIT 1
        `).bind(claimId).first();
        if (!claim) return json({ error: "Claim not found" }, 404);
        const sources = await getSourcesForClaim(env.DB, claimId);
        return json({ claim, sources });
    }

    return json({ error: "Method not allowed" }, 405);
}
