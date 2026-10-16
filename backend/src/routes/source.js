function json(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*"
        }
    });
}

// GET /api/source/:id → fetch source metadata
export async function handleSource(request, env, path) {
    const segments = path.split("/").filter(Boolean);
    const sourceId = segments[2];

    if (request.method === "GET") {
        if (!sourceId) return json({ error: "Source ID required" }, 400);
        const source = await env.DB.prepare(`
            SELECT * FROM sources WHERE id = ? LIMIT 1
        `).bind(sourceId).first();
        if (!source) return json({ error: "Source not found" }, 404);
        return json({ source });
    }

    return json({ error: "Method not allowed" }, 405);
}
