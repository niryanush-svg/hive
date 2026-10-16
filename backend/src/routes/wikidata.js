// Wikidata proxy — fetch entity data on behalf of the extension/website.
// Avoids CORS issues and lets us cache.
// CC0 license on all Wikidata content — no attribution required, but we cite it anyway.

function json(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=3600",
            ...extraHeaders
        }
    });
}

// GET /api/wikidata/entity/:qid → fetch entity from Wikidata API
// GET /api/wikidata/search?q=... → search Wikidata for entities
export async function handleWikidata(request, env, path) {
    const segments = path.split("/").filter(Boolean); // ["api","wikidata","entity"|"search",...]
    const action = segments[2];

    if (action === "entity") {
        const qid = segments[3];
        if (!qid || !/^Q\d+$/.test(qid)) {
            return json({ error: "Valid Q-ID required" }, 400);
        }
        const url = `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`;
        const resp = await fetch(url, {
            headers: { "User-Agent": "HIVE-Encyclopedia/0.1 (https://hive-ny.pages.dev)" }
        });
        if (!resp.ok) {
            return json({ error: `Wikidata returned ${resp.status}` }, 502);
        }
        const data = await resp.json();
        const entity = data.entities?.[qid];
        if (!entity) {
            return json({ error: "Entity not found" }, 404);
        }
        // Trim to the parts we care about. Full entity is huge.
        return json({
            id: entity.id,
            labels: entity.labels,
            descriptions: entity.descriptions,
            aliases: entity.aliases,
            claims_count: Object.keys(entity.claims || {}).length,
            // Surface a few high-value claims if present
            instance_of: entity.claims?.P31?.map(c => c.mainsnak?.datavalue?.value?.id),
            sitelinks_count: Object.keys(entity.sitelinks || {}).length
        });
    }

    if (action === "search") {
        const url = new URL(request.url);
        const q = url.searchParams.get("q");
        const lang = url.searchParams.get("lang") || "en";
        if (!q) return json({ error: "Query parameter q required" }, 400);

        const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=${lang}&search=${encodeURIComponent(q)}&limit=10&origin=*`;
        const resp = await fetch(searchUrl, {
            headers: { "User-Agent": "HIVE-Encyclopedia/0.1 (https://hive-ny.pages.dev)" }
        });
        if (!resp.ok) {
            return json({ error: `Wikidata search returned ${resp.status}` }, 502);
        }
        const data = await resp.json();
        return json({
            query: q,
            results: (data.search || []).map(r => ({
                qid: r.id,
                label: r.label,
                description: r.description,
                concepturi: r.concepturi
            }))
        });
    }

    return json({ error: "Unknown wikidata action. Use /entity/:qid or /search?q=..." }, 404);
}
