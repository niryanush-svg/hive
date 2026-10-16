// ═══════════════════════════════════════════════════════════════
// HIVE Encyclopedia — Backend Worker
// Cloudflare Worker + D1 + R2
// ═══════════════════════════════════════════════════════════════
//
// Public-facing API for HIVE Encyclopedia. Built on Wikidata Q-IDs.
// CORS-open so the extension and any client can read.
// Writes require auth (TODO: Google OAuth wiring).
// ═══════════════════════════════════════════════════════════════

import { handleEntry } from "./routes/entry.js";
import { handleClaim } from "./routes/claim.js";
import { handleChallenge } from "./routes/challenge.js";
import { handleSource } from "./routes/source.js";
import { handleVerify } from "./routes/verify.js";
import { handleRecent } from "./routes/recent.js";
import { handleWikidata } from "./routes/wikidata.js";
import { handleClassify } from "./routes/classify.js";
import { handleContributor } from "./routes/contributor.js";
import { handleQueue } from "./routes/queue.js";
import { handleModels } from "./routes/models.js";
import { handleSubmitVote } from "./routes/submit-vote.js";
import { handleReport } from "./routes/report.js";
import { robotsTxt, sitemapXml, llmsTxt } from "./routes/seo.js";
import { homePage, searchPage, entryPage, aboutPage, contributePage, mePage, howItWorksPage } from "./html/pages.js";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Hive-User-Id, X-Hive-Contributor-Id",
    "Access-Control-Max-Age": "86400"
};

function json(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS, ...extraHeaders }
    });
}

function notFound(message = "Not found") {
    return json({ error: message }, 404);
}

function methodNotAllowed() {
    return json({ error: "Method not allowed" }, 405);
}

export default {
    async fetch(request, env, ctx) {
        // CORS preflight
        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        const url = new URL(request.url);
        const path = url.pathname;

        try {
            // ── Health check ──
            if (path === "/api/health") {
                return json({
                    ok: true,
                    service: "hive-encyclopedia",
                    version: "0.1.0",
                    timestamp: new Date().toISOString(),
                    db_ready: !!env.DB
                });
            }

            // ── Entries ──
            // GET  /api/entry/:qid          → fetch one entry by Wikidata Q-ID
            // POST /api/entry               → create or update entry (requires verified payload)
            // GET  /api/entry/:qid/claims   → fetch atomic claims for an entry
            if (path.startsWith("/api/entry")) {
                return await handleEntry(request, env, path);
            }

            // ── Claims ──
            if (path.startsWith("/api/claim")) {
                return await handleClaim(request, env, path);
            }

            // ── Challenges ──
            // POST /api/challenge — submit challenge with mandatory sources
            // GET  /api/challenge/:id — fetch challenge status
            if (path.startsWith("/api/challenge")) {
                return await handleChallenge(request, env, path);
            }

            // ── Sources ──
            if (path.startsWith("/api/source")) {
                return await handleSource(request, env, path);
            }

            // ── Verify (request a new verification round) ──
            if (path.startsWith("/api/verify")) {
                return await handleVerify(request, env, path);
            }

            // ── Recent activity (for a homepage feed) ──
            if (path === "/api/recent") {
                return await handleRecent(request, env);
            }

            // ── Wikidata proxy (avoid CORS issues for the extension) ──
            if (path.startsWith("/api/wikidata")) {
                return await handleWikidata(request, env, path);
            }

            // ── Adaptive quorum classifier ──
            if (path === "/api/classify") {
                return await handleClassify(request, env, path);
            }

            // ── Contributor (anon tokens, OAuth scaffold) ──
            if (path.startsWith("/api/contributor")) {
                return await handleContributor(request, env, path);
            }

            // ── Work queue (entry creation, re-verification, node polling) ──
            if (path.startsWith("/api/queue")) {
                return await handleQueue(request, env, path);
            }

            // ── Model registry (read-only — weights set by system) ──
            if (path.startsWith("/api/models")) {
                return await handleModels(request, env, path);
            }

            // ── Submit AI votes (enforces one-AI-per-user, weighted aggregation) ──
            if (path === "/api/submit-vote") {
                return await handleSubmitVote(request, env, path);
            }

            // ── Bug / feedback reports (straight from the web app to the dev) ──
            if (path === "/api/report") {
                return await handleReport(request, env, path);
            }

            // ── Discovery surface (crawlers + AI assistants) ──
            // Declared BEFORE the HTML pages so the platform's managed
            // robots.txt cannot shadow ours.
            if (path === "/robots.txt") {
                return robotsTxt();
            }
            if (path === "/sitemap.xml") {
                return await sitemapXml(env);
            }
            if (path === "/llms.txt") {
                return llmsTxt();
            }

            // ── HTML pages (everything not /api/*) ──
            if (path === "/" || path === "") {
                return await homePage(env);
            }
            if (path === "/search") {
                return await searchPage(url.searchParams.get("q") || "");
            }
            if (path.startsWith("/entry/")) {
                const qid = path.slice("/entry/".length).replace(/\/$/, "");
                return await entryPage(qid, env);
            }
            if (path === "/about") {
                return aboutPage();
            }
            if (path === "/contribute") {
                return contributePage();
            }
            if (path === "/me") {
                return mePage();
            }
            if (path === "/how-it-works") {
                return howItWorksPage();
            }

            return notFound();
        } catch (err) {
            console.error("[HIVE-API] Unhandled error:", err);
            return json({
                error: "Internal server error",
                message: err.message,
                stack: env.ENVIRONMENT === "development" ? err.stack : undefined
            }, 500);
        }
    }
};

export { json, notFound, methodNotAllowed, CORS_HEADERS };
