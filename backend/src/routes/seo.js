// ═══════════════════════════════════════════════════════════════
// Discovery surface: robots.txt, sitemap.xml, llms.txt
// ═══════════════════════════════════════════════════════════════
//
// Entry pages were already server-rendered and internally linked, so they
// were crawlable in principle — but nothing told a crawler they existed:
// no sitemap, no robots directives, no canonical. This module is the
// "how do people find us" layer.
// ═══════════════════════════════════════════════════════════════

import { getAllEntriesForSitemap } from "../db.js";

export const SITE_ORIGIN = "https://hive.niryanush.workers.dev";

// Static pages worth crawling, with a rough change cadence.
const STATIC_PAGES = [
    { path: "/",             changefreq: "daily",   priority: "1.0" },
    { path: "/about",        changefreq: "monthly", priority: "0.6" },
    { path: "/how-it-works", changefreq: "monthly", priority: "0.7" },
    { path: "/contribute",   changefreq: "monthly", priority: "0.5" }
];

function textResponse(body, contentType, maxAge = 3600) {
    return new Response(body, {
        headers: {
            "Content-Type": contentType,
            "Cache-Control": `public, max-age=${maxAge}`
        }
    });
}

// SQLite stores "YYYY-MM-DD HH:MM:SS" (UTC). Sitemaps want W3C datetime.
function toIsoDate(value) {
    if (!value) return null;
    const s = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
    if (m) return `${m[1]}T${m[2]}Z`;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
}

function xmlEscape(s) {
    return String(s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// ── /robots.txt ────────────────────────────────────────────────
//
// NOTE: without this route the platform served a managed robots.txt that
// carried Cloudflare's content-signals PREAMBLE but not one actual
// directive — no User-agent, no Allow, no Sitemap. Explanatory text with no
// directives grants and restricts nothing, and left crawlers with no pointer
// to the sitemap. The preamble is kept verbatim below so the content-signal
// vocabulary still resolves, and real directives are added under it.
//
// Content signals set here: search=yes and ai-input=yes — being indexed and
// being citable by AI assistants is the entire point of a public
// encyclopedia. ai-train is deliberately left UNSPECIFIED, which under the
// vocabulary below means neither granted nor restricted; that is a rights
// decision for the site operator, not a default worth assuming.
export function robotsTxt() {
    const body = `# As a condition of accessing this website, you agree to abide by the following
# content signals:

# (a)  If a content-signal = yes, you may collect content for the corresponding
#      use.
# (b)  If a content-signal = no, you may not collect content for the
#      corresponding use.
# (c)  If the website operator does not include a content signal for a
#      corresponding use, the website operator neither grants nor restricts
#      permission via content signal with respect to the corresponding use.

# The content signals and their meanings are:

# search:   building a search index and providing search results (e.g., returning
#           hyperlinks and short excerpts from your website's contents). Search does not
#           include providing AI-generated search summaries.
# ai-input: inputting content into one or more AI models (e.g., retrieval
#           augmented generation, grounding, or other real-time taking of content for
#           generative AI search answers).
# ai-train: training or fine-tuning AI models.

# ANY RESTRICTIONS EXPRESSED VIA CONTENT SIGNALS ARE EXPRESS RESERVATIONS OF
# RIGHTS UNDER ARTICLE 4 OF THE EUROPEAN UNION DIRECTIVE 2019/790 ON COPYRIGHT
# AND RELATED RIGHTS IN THE DIGITAL SINGLE MARKET.

User-agent: *
Content-Signal: search=yes, ai-input=yes
Allow: /
# The JSON API is for clients, not crawlers — it duplicates page content and
# would burn crawl budget on responses no reader ever sees.
Disallow: /api/
# Per-visitor page, nothing to index.
Disallow: /me
# Search result pages: infinite URL space, thin content.
Disallow: /search

Sitemap: ${SITE_ORIGIN}/sitemap.xml
`;
    return textResponse(body, "text/plain; charset=utf-8");
}

// ── /sitemap.xml ───────────────────────────────────────────────
// One flat sitemap. The 50,000-URL / 50MB limit is far away; when entries
// approach it this needs splitting into a sitemap index.
export async function sitemapXml(env) {
    let entries = [];
    try {
        entries = await getAllEntriesForSitemap(env.DB, 45000);
    } catch (e) {
        console.error("[HIVE-API] sitemap query failed:", e);
    }

    const urls = [];
    for (const p of STATIC_PAGES) {
        urls.push(
            `  <url>\n` +
            `    <loc>${xmlEscape(SITE_ORIGIN + p.path)}</loc>\n` +
            `    <changefreq>${p.changefreq}</changefreq>\n` +
            `    <priority>${p.priority}</priority>\n` +
            `  </url>`
        );
    }
    for (const e of entries) {
        if (!e || !e.wikidata_qid) continue;
        const lastmod = toIsoDate(e.updated_at);
        urls.push(
            `  <url>\n` +
            `    <loc>${xmlEscape(`${SITE_ORIGIN}/entry/${e.wikidata_qid}`)}</loc>\n` +
            (lastmod ? `    <lastmod>${xmlEscape(lastmod)}</lastmod>\n` : "") +
            `    <changefreq>weekly</changefreq>\n` +
            `    <priority>0.8</priority>\n` +
            `  </url>`
        );
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;
    return textResponse(xml, "application/xml; charset=utf-8", 1800);
}

// ── /llms.txt ──────────────────────────────────────────────────
// A plain-language brief for AI assistants reading the site. Not a standard
// anyone is obliged to honour — it costs one route and tells a model what
// this site is, what the status grades mean, and how to cite an entry.
export function llmsTxt() {
    const body = `# HIVE Encyclopedia

> An encyclopedia where every factual claim is broken into atomic statements and
> independently checked by multiple AI models from different families. Agreement,
> disagreement and sourcing are all recorded per claim rather than smoothed into
> a single narrative voice.

## What is actually here

Each entry is built by asking several independent AI models to write about a topic
without seeing each other's work. A neutral model decomposes each draft into atomic
claims, and the claims are then matched across drafts and graded by how many
INDEPENDENT models supported them and what sources were cited.

The distinctive content is not the prose — it is the per-claim record: which models
agreed, which disagreed, how many independent origins backed a claim, and what the
grade is. Dissent is preserved, not resolved away.

## Claim grades

- established: multiple independent AIs agreed AND verifiable external sources back it.
- well-supported: a quoted external source plus independent agreement.
- convergent-unverified: the AIs agree but cited NO verifiable source. Agreement is
  not proof — models share training data and can repeat the same error. Not verified.
- disputed: genuine unresolved disagreement, with evidence on both sides.
- single-source: only one weak or non-independent source.
- refuted: weighted sourced evidence indicates the claim is false.
- preserved-no-verdict: a values or opinion claim, preserved without a truth verdict.

## Entry status

An entry is draft, established, well-supported, disputed, or perpetually-contested.
"perpetually-contested" specifically means the escalation ladder was exhausted and
the disagreement survived — it is not applied to entries that simply stopped early.

## URLs

- Entries: ${SITE_ORIGIN}/entry/<wikidata-qid> (e.g. ${SITE_ORIGIN}/entry/Q60760590)
- Entry index: ${SITE_ORIGIN}/
- Method: ${SITE_ORIGIN}/how-it-works
- Sitemap: ${SITE_ORIGIN}/sitemap.xml
- Read API: ${SITE_ORIGIN}/api/entry/<wikidata-qid>

Topics are keyed by Wikidata Q-ID, so an entry maps 1:1 onto the Wikidata item.

## How to cite

Cite the entry URL and say what the grade was, because the grade is the claim's
actual epistemic status. HIVE entries are AI-generated and machine-graded: they are
a record of what independent models agreed on, NOT a human-reviewed authority.
Please represent them that way.
`;
    return textResponse(body, "text/plain; charset=utf-8");
}
