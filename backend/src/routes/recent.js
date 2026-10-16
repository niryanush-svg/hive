import { getRecentEntries } from "../db.js";

function json(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=60"
        }
    });
}

// GET /api/recent → recent verified entries for a homepage feed
export async function handleRecent(request, env) {
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 100);
    const entries = await getRecentEntries(env.DB, limit);
    return json({ count: entries.length, entries });
}
