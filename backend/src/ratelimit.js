// Per-IP fixed-window rate limiting for unauthenticated write endpoints.
// Fail-OPEN on any error (never break an endpoint because the limiter hiccupped).

// Salted hash of the REAL client IP. Uses CF-Connecting-IP only — never the
// client-settable X-Forwarded-For, which could be spoofed to dodge the limit.
async function ipHash(request, env) {
    const ip = request.headers.get("CF-Connecting-IP");
    if (!ip) return null;
    const salt = (env && env.ORIGIN_SALT) || "hive-origin-v1";
    const data = new TextEncoder().encode(salt + "|rl|" + ip);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return "ip_" + Array.from(new Uint8Array(digest)).slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Returns { ok: true } or { ok: false, retryAfter } (seconds).
// bucket: endpoint name; limit: max requests per window; windowSec: window length.
export async function rateLimit(env, request, bucket, limit, windowSec = 600) {
    try {
        if (!env || !env.DB) return { ok: true };
        const h = await ipHash(request, env);
        if (!h) return { ok: true }; // no CF IP (e.g. local dev) — don't block
        const now = Math.floor(Date.now() / 1000);
        const windowStart = now - (now % windowSec);
        const key = `${h}:${bucket}:${windowStart}`;

        await env.DB.prepare(
            `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
             ON CONFLICT(key) DO UPDATE SET count = count + 1`
        ).bind(key, windowStart).run();

        const row = await env.DB.prepare(`SELECT count FROM rate_limits WHERE key = ?`).bind(key).first();
        const count = row ? row.count : 1;

        // Opportunistic cleanup of stale windows (cheap, occasional).
        if (Math.random() < 0.02) {
            await env.DB.prepare(`DELETE FROM rate_limits WHERE window_start < ?`).bind(now - windowSec * 4).run();
        }

        if (count > limit) return { ok: false, retryAfter: windowStart + windowSec - now };
        return { ok: true };
    } catch (e) {
        return { ok: true }; // fail open
    }
}

export function tooManyRequests(retryAfter) {
    return new Response(JSON.stringify({ error: "Too many requests — slow down.", retry_after_seconds: retryAfter }, null, 2), {
        status: 429,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Retry-After": String(retryAfter || 60)
        }
    });
}
