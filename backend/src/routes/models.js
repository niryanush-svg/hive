// Model registry: public read-only. Everything visible, nothing editable.
//
// The reader can SEE which models exist, their weights, tier, paid/free,
// geography — but cannot change any of it. Weights are set by the system,
// not by users, precisely so no one can game their own AI's influence.

function json(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=300"
        }
    });
}

// GET /api/models        — full registry
// GET /api/models/:id    — one model
export async function handleModels(request, env, path) {
    if (request.method !== "GET") {
        // Writes are intentionally NOT supported via the API. Weights change
        // only through reviewed migrations, never user input.
        return json({ error: "Model registry is read-only. Weights are set by the system, not by users." }, 405);
    }

    const segments = path.split("/").filter(Boolean); // ["api","models",":id"?]
    const id = segments[2];

    if (id) {
        const m = await env.DB.prepare(`SELECT * FROM models WHERE id = ? LIMIT 1`).bind(id).first();
        if (!m) return json({ error: "Model not found" }, 404);
        return json({ model: m });
    }

    const result = await env.DB.prepare(`
        SELECT id, family, display_name, tier, is_paid, base_weight, release_epoch, geography, ecosystem, active
        FROM models WHERE active = 1
        ORDER BY base_weight DESC, family
    `).all();
    return json({
        count: (result.results || []).length,
        note: "Weights are set by HIVE's published methodology, not by users. Frontier paid models weigh ~1.0; small free models ~0.4. Different families and geographies add diversity. You cannot change these — that's the point.",
        models: result.results || []
    });
}
