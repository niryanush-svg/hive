import { layout, htmlResponse, escapeHtml } from "./layout.js";
import { getEntryByQid, getClaimsByEntryId, getRecentEntries, getSourcesForClaim, getContributionsForClaim } from "../db.js";
import { SITE_ORIGIN } from "../routes/seo.js";

// D1 stores "YYYY-MM-DD HH:MM:SS" (UTC). schema.org dates must be ISO 8601, and
// an unparseable date is worse than an absent one — return null and omit it.
function toIsoDate(value) {
    if (!value) return null;
    const s = String(value).trim();
    const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
    if (m) return `${m[1]}T${m[2]}Z`;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
}

// Reader-facing labels for the internal status vocabulary. The internal
// names stay in the DB and the API; a lay reader sees these.
const STATUS_LABEL = {
    "established": "All AIs agree",
    "well-supported": "Most AIs agree",
    "convergent-unverified": "AIs agree, no source cited",
    "disputed": "Contested",
    "single-source": "One AI, not contradicted",
    "refuted": "Refuted",
    "preserved-no-verdict": "Opinion — not graded",
    "perpetually-contested": "Unresolved dispute",
    "draft": "Partial agreement",
    "unverified": "Not checked yet"
};
const ENTRY_STATUS_LABEL = {
    "established": "AI panel agrees",
    "well-supported": "AI panel largely agrees",
    "draft": "Partial agreement",
    "disputed": "Contested",
    "perpetually-contested": "Unresolved dispute",
    "unverified": "Not verified"
};
const ENGINE_NAME = { claude: "Claude", chatgpt: "ChatGPT", gemini: "Gemini", grok: "Grok", perplexity: "Perplexity", copilot: "Copilot" };
function engineName(id) { return ENGINE_NAME[id] || String(id || "").replace(/^\w/, ch => ch.toUpperCase()); }
function statusLabel(st) { return STATUS_LABEL[st] || st; }
function parseJsonSafe(txt) { try { return txt ? JSON.parse(txt) : null; } catch (e) { return null; } }
function asSentence(t) {
    const x = String(t || "").replace(/\s+/g, " ").trim();
    if (!x) return "";
    return /[.!?]$/.test(x) ? x : x + ".";
}

// ── Homepage: search + recent entries ──
export async function homePage(env) {
    // Launch readiness 5.2: while the pre-13.10 entries are being rebuilt, the
    // front page shows only entries with a stance-verified summary. Falls back
    // to everything if none qualify yet.
    const all = await getRecentEntries(env.DB, 60);
    const stanced = all.filter(e => e.has_agreement);
    const recent = (stanced.length ? stanced : all).slice(0, 20);
    const recentHtml = recent.length === 0
        ? `<p class="empty-state">No verified entries yet. Be the first to contribute!</p>`
        : `<ul class="recent-list">${recent.map(e => `
            <li>
              <a href="/entry/${escapeHtml(e.wikidata_qid)}">${escapeHtml(e.canonical_label)}</a>
              <span class="status-badge status-${escapeHtml(e.status)}">${escapeHtml(ENTRY_STATUS_LABEL[e.status] || e.status)}</span>
              <span class="qid">${escapeHtml(e.wikidata_qid)}</span>
            </li>
        `).join("")}</ul>`;

    const body = `
<div class="mission-box">
  <h2>Multi-AI verified, atomic, transparent.</h2>
  <p>
    HIVE is an encyclopedia where every claim is verified by multiple independent AIs and rated by source quality.
    Built on top of <a href="https://www.wikidata.org" target="_blank" rel="noopener">Wikidata</a>'s 122 million item identifiers.
    Disputes preserved, not erased. Sources required for every challenge.
  </p>
</div>

<form class="search-form" action="/search" method="GET">
  <input type="text" name="q" placeholder="Search any topic — person, place, event, idea…" required>
  <button type="submit">Search</button>
</form>

<div class="claims-section">
  <h2>Recently verified</h2>
  ${recentHtml}
</div>
`;
    return htmlResponse(layout({
        title: "HIVE Encyclopedia",
        body,
        canonical: "/",
        jsonLd: {
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: "HIVE Encyclopedia",
            url: SITE_ORIGIN,
            description: "An encyclopedia where every atomic claim is checked by multiple independent AI models, with agreement, dissent and sources recorded per claim.",
            potentialAction: {
                "@type": "SearchAction",
                target: { "@type": "EntryPoint", urlTemplate: `${SITE_ORIGIN}/search?q={search_term_string}` },
                "query-input": "required name=search_term_string"
            }
        }
    }));
}

// ── Search results page ──
export async function searchPage(query) {
    if (!query) {
        return htmlResponse(layout({
            title: "Search — HIVE",
            body: `<p class="empty-state">No query.</p>`,
            noindex: true
        }));
    }

    // Proxy to Wikidata search
    const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&search=${encodeURIComponent(query)}&limit=15&origin=*`;
    let results = [];
    try {
        const resp = await fetch(searchUrl, {
            headers: { "User-Agent": "HIVE-Encyclopedia/0.1" }
        });
        if (resp.ok) {
            const data = await resp.json();
            results = data.search || [];
        }
    } catch (e) {
        console.error("Wikidata search failed:", e);
    }

    const resultsHtml = results.length === 0
        ? `<p class="empty-state">No results found on Wikidata. Try a different search term.</p>`
        : `<div class="search-results">${results.map(r => `
            <a class="search-result" href="/entry/${escapeHtml(r.id)}">
              <div class="qid">${escapeHtml(r.id)}</div>
              <div class="label">${escapeHtml(r.label || "")}</div>
              ${r.description ? `<div class="desc">${escapeHtml(r.description)}</div>` : ""}
            </a>
        `).join("")}</div>`;

    const body = `
<form class="search-form" action="/search" method="GET">
  <input type="text" name="q" value="${escapeHtml(query)}" required>
  <button type="submit">Search</button>
</form>

<p style="color: var(--muted); font-size: 14px; margin: 8px 0;">
  Searching Wikidata for: <strong>${escapeHtml(query)}</strong>
</p>

${resultsHtml}
`;
    return htmlResponse(layout({
        title: `Search "${escapeHtml(query)}" — HIVE`,
        body,
        noindex: true
    }));
}

// ── Entry page: full read view ──
export async function entryPage(qid, env) {
    if (!/^Q\d+$/.test(qid)) {
        return htmlResponse(layout({
            title: "Invalid Q-ID — HIVE",
            body: `<p class="empty-state">Invalid Wikidata Q-ID. Must match pattern Q&lt;number&gt;.</p>`,
            noindex: true
        }), 400);
    }

    const entry = await getEntryByQid(env.DB, qid);

    if (!entry) {
        // Fetch from Wikidata so the page is still useful — and offer to verify.
        let wikidataLabel = qid;
        let wikidataDesc = "";
        try {
            const r = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, {
                headers: { "User-Agent": "HIVE-Encyclopedia/0.1 (https://hive.niryanush.workers.dev)" }
            });
            if (r.ok) {
                const data = await r.json();
                const ent = data.entities?.[qid];
                wikidataLabel = ent?.labels?.en?.value || qid;
                wikidataDesc = ent?.descriptions?.en?.value || "";
            }
        } catch (e) { console.error("Wikidata fetch failed:", e); }

        const body = `
<div class="entry-header">
  <h1>${escapeHtml(wikidataLabel)}</h1>
  <div class="entry-meta">
    <span class="qid">${escapeHtml(qid)}</span>
    <span class="status-badge status-unverified">not yet verified</span>
  </div>
</div>

${wikidataDesc ? `<p style="color: var(--muted); margin-bottom: 24px;">${escapeHtml(wikidataDesc)}</p>` : ""}

<div class="mission-box">
  <h2>Be the first to verify this entry.</h2>
  <p>
    HIVE doesn't have a verified entry for <strong>${escapeHtml(wikidataLabel)}</strong> yet.
    Click <strong>"Request creation"</strong> and your request joins the queue. A volunteer node picks it up, runs a multi-AI verification round, and submits the result.
  </p>
  <button class="btn-primary" id="requestCreateBtn" style="margin-top:12px;" data-qid="${escapeHtml(qid)}" data-label="${escapeHtml(wikidataLabel)}">
    Request creation
  </button>
  <div id="requestResult" style="margin-top:12px;"></div>
</div>

<p style="font-size: 14px; color: var(--muted);">
  Wikidata reference:
  <a href="https://www.wikidata.org/wiki/${escapeHtml(qid)}" target="_blank" rel="noopener">${escapeHtml(qid)} on Wikidata</a>
</p>

<script>
async function requestEntryCreation(qid, label) {
  const out = document.getElementById("requestResult");
  out.innerHTML = "Requesting...";
  try {
    const r = await fetch("/api/queue/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wikidata_qid: qid, requested_label: label })
    });
    const data = await r.json();
    if (r.ok) {
      out.innerHTML =
        "<div class='modal-message success'>Request added to queue. Classification: <strong>" +
        data.classification + "</strong>. Initial quorum: " + data.initial_quorum_size +
        " AIs. Position ahead of you in queue: " + data.position_ahead_of_you +
        ".<br><br>A volunteer node will pick this up shortly. Bookmark this page — check back in a few minutes.</div>";
    } else {
      out.innerHTML = "<div class='modal-message error'>" + (data.error || "Request failed") + "</div>";
    }
  } catch (e) {
    out.innerHTML = "<div class='modal-message error'>Network error: " + e.message + "</div>";
  }
}
document.getElementById("requestCreateBtn").addEventListener("click", function () {
  requestEntryCreation(this.getAttribute("data-qid"), this.getAttribute("data-label"));
});
</script>
`;
        return htmlResponse(layout({
            title: `${escapeHtml(wikidataLabel)} — HIVE (unverified)`,
            body,
            description: wikidataDesc,
            noindex: true
        }), 404);
    }

    // Entry exists — render it as an article first, audit trail second.
    const claims = await getClaimsByEntryId(env.DB, entry.id);
    const meta = parseJsonSafe(entry.metadata_json) || {};

    const claimsWithData = await Promise.all(claims.map(async c => {
        const sources = await getSourcesForClaim(env.DB, c.id);
        const contributions = await getContributionsForClaim(env.DB, c.id);
        return { ...c, sources, contributions, writers: parseJsonSafe(c.writer_ids_json) || [] };
    }));

    // ── Agreement figures. Prefer the summary the node computed (it knows
    // about contradictions found in the full texts); fall back to counting
    // statuses for entries written before the stance pass existed.
    const factual = claimsWithData.filter(c => c.type !== "NORMATIVE" && c.status !== "preserved-no-verdict");
    const countBy = st => factual.filter(c => c.status === st).length;
    const ag = (meta.agreement && typeof meta.agreement === "object") ? meta.agreement : null;
    const agreedAll = ag ? ag.agreed_all : countBy("established");
    const agreedSome = ag ? ag.agreed_some : countBy("well-supported") + countBy("convergent-unverified");
    const single = ag ? ag.uncontested_single : countBy("single-source");
    const contested = ag ? ag.contested : countBy("disputed") + countBy("refuted");
    const totalFactual = ag ? ag.total : factual.length;
    const agreedN = agreedAll + agreedSome;
    const agreedPct = totalFactual ? Math.round(100 * agreedN / totalFactual) : 0;
    const contestedPct = totalFactual ? Math.round(100 * contested / totalFactual) : 0;
    const quorum = entry.quorum_size || (meta.writers || []).length || 3;
    const writerNames = (meta.writers || []).map(engineName);
    const contestedClaims = (ag && Array.isArray(ag.contested_claims) && ag.contested_claims.length)
        ? ag.contested_claims
        : claimsWithData.filter(c => c.status === "disputed" || c.status === "refuted")
            .map(c => ({ text: c.text, by: c.writers, against: [] }));
    const origins = new Set();
    for (const c of claimsWithData) for (const x of c.contributions)
        origins.add(x.verified_subject || x.origin_ip_hash || x.origin_node_id || x.contributor_id || "anon");
    const nodeCount = Math.max(1, origins.size);

    // ── Lead paragraph: definitions first, then the facts most writers agreed
    // on. Composed, not generated — every sentence is a claim on this page.
    // A sentence that opens with the topic and defines it ("Gross domestic
    // product is ...") is the natural first line; the decomposers' DEFINITION
    // tag alone is too loose (it also covers "G denotes government spending").
    const labelEsc = String(entry.canonical_label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const acronym = String(entry.canonical_label).split(/\s+/).length > 1 ? String(entry.canonical_label).split(/\s+/).map(w => w[0]).join("") : "";
    const labelRe = new RegExp("^(the\\s+)?(" + labelEsc + (acronym.length > 1 ? "|" + acronym : "") + ")\\b[^.]{0,40}\\b(is|are|refers|measures|means|denotes)\\b", "i");
    const rank = c => (c.status === "established" ? 3 : c.status === "well-supported" ? 2 : c.status === "single-source" ? 1 : 0) * 10
                    + (c.agreement_count || 0) + (labelRe.test(String(c.text || "")) ? 5 : 0);
    const leadPool = factual.filter(c => c.status !== "disputed" && c.status !== "refuted").sort((a, b) => rank(b) - rank(a));
    const leadDefs = leadPool.filter(c => c.type === "DEFINITION").slice(0, 2);
    const leadFacts = leadPool.filter(c => c.type !== "DEFINITION" && !leadDefs.includes(c));
    const leadParts = [];
    let leadLen = 0;
    for (const c of leadDefs.concat(leadFacts)) {
        const sn = asSentence(c.text);
        if (leadParts.length >= 4 || (leadParts.length >= 2 && leadLen + sn.length > 520)) break;
        leadParts.push(sn); leadLen += sn.length;
    }
    const lead = leadParts.join(" ");
    const leadIsAgreed = leadDefs.concat(leadFacts).slice(0, leadParts.length).every(c => c.status === "established" || c.status === "well-supported");

    // ── Sections
    const mark = c => {
        const n = c.agreement_count || (c.writers || []).length || 0;
        const names = (c.writers || []).map(engineName).join(", ");
        return `<span class="claim-mark" title="${escapeHtml(names ? "Stated or supported by: " + names : "")}">${n}/${quorum}</span>`;
    };
    const li = c => `<li id="c-${escapeHtml(c.id)}">${escapeHtml(asSentence(c.text))} ${mark(c)}</li>`;
    const sectionAgreed = factual.filter(c => c.status === "established" || c.status === "well-supported" || c.status === "convergent-unverified")
        .sort((a, b) => rank(b) - rank(a));
    const sectionSingle = factual.filter(c => c.status === "single-source");
    const sectionContested = factual.filter(c => c.status === "disputed" || c.status === "refuted");
    const sectionNormative = claimsWithData.filter(c => c.type === "NORMATIVE" || c.status === "preserved-no-verdict");
    const contestedDetail = c => {
        const extra = contestedClaims.find(x => x.text === c.text);
        const by = (extra?.by || c.writers || []).map(engineName);
        const against = (extra?.against || []).map(engineName);
        const who = against.length ? `${by.join(", ")} say this; ${against.join(", ")} ${against.length === 1 ? "disagrees" : "disagree"}.`
                  : by.length ? `Stated by ${by.join(", ")}; marked contested by the panel.` : "";
        return `<li id="c-${escapeHtml(c.id)}">${escapeHtml(asSentence(c.text))} ${mark(c)}${who ? `<div class="claim-who">${escapeHtml(who)}</div>` : ""}</li>`;
    };

    const sectionsHtml = `
${sectionAgreed.length ? `<section class="entry-section"><h2>What the AI panel agrees on</h2><ul class="prose-claims">${sectionAgreed.map(li).join("")}</ul></section>` : ""}
${sectionContested.length ? `<section class="entry-section contested"><h2>Contested</h2><p class="section-note">Claims where at least one AI on the panel disagrees. Both sides are kept; HIVE does not pick a winner.</p><ul class="prose-claims">${sectionContested.map(contestedDetail).join("")}</ul></section>` : ""}
${sectionSingle.length ? `<section class="entry-section"><h2>Stated by one AI, not contradicted</h2><p class="section-note">Each of these was written by one AI; the others did not mention it and did not contradict it.</p><ul class="prose-claims">${sectionSingle.map(li).join("")}</ul></section>` : ""}
${sectionNormative.length ? `<section class="entry-section"><h2>Values and interpretation</h2><p class="section-note">Opinions and value judgements. Preserved as stated, never graded true or false.</p><ul class="prose-claims">${sectionNormative.map(li).join("")}</ul></section>` : ""}`;

    // ── Audit trail (the old per-claim cards), folded.
    const order = ["established", "well-supported", "convergent-unverified", "disputed", "single-source", "refuted", "preserved-no-verdict", "unverified"];
    const STATUS_TIP = {
        "established": "Stated or supported by every AI on the panel and contradicted by none.",
        "well-supported": "Stated or supported by most of the panel and contradicted by none.",
        "convergent-unverified": "The AIs agree, but no verifiable external source was cited. Agreement alone is not proof.",
        "disputed": "At least one AI on the panel contradicts this claim. Both positions are kept.",
        "single-source": "Written by one AI; the others neither repeated nor contradicted it.",
        "refuted": "The weighted, sourced evidence indicates this claim is false.",
        "preserved-no-verdict": "A values / opinion claim. Preserved without a true-or-false verdict.",
        "unverified": "Not yet checked by the AI panel."
    };
    const audit = claimsWithData.slice().sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
    const auditHtml = audit.map(c => {
        const agreeAIs = c.contributions.filter(x => x.vote === 'agree');
        const disagreeAIs = c.contributions.filter(x => x.vote === 'disagree');
        const nAIs = c.contributions.length;
        const cOrigins = new Set(c.contributions.map(x => x.verified_subject || x.origin_ip_hash || x.origin_node_id || x.contributor_id || x));
        const nIndep = cOrigins.size;
        const voteRow = ai => `
                  <div class="ai-attribution-item">
                    <span class="${ai.vote === 'disagree' ? 'ai-vote-disagree' : 'ai-vote-agree'}">${ai.vote === 'disagree' ? '✗' : '✓'}</span>
                    <span class="ai-model" title="Weight: ${(ai.weight || 1).toFixed(2)} | Tier: ${ai.tier || '?'} | Paid: ${ai.is_paid ? 'Yes' : 'Free'} | Region: ${ai.geography || '?'}">${escapeHtml(ai.display_name || ai.model_id)}</span>
                    <span class="ai-weight">(${(ai.weight || 1).toFixed(2)})</span>
                  </div>`;
        const attributionHtml = nAIs ? `
              <div class="ai-attribution">
                <div style="font-weight: 600; margin-bottom: 4px;">Votes: <span style="font-weight: 400; color: var(--muted, #888); font-size: 12px;">${nAIs} AI${nAIs === 1 ? "" : "s"} · ${nIndep} independent origin${nIndep === 1 ? "" : "s"}</span></div>
                ${agreeAIs.map(voteRow).join("")}${disagreeAIs.map(voteRow).join("")}
              </div>` : "";
        const writersLine = (c.writers || []).length
            ? `<span>Written or supported by: ${escapeHtml((c.writers || []).map(engineName).join(", "))}</span>` : "";
        return `
        <div class="claim-card s-${escapeHtml(c.status)}" id="a-${escapeHtml(c.id)}">
          <div class="claim-text">${escapeHtml(c.text)}</div>
          <div class="claim-meta">
            <span class="status-badge status-${escapeHtml(c.status)}" title="${escapeHtml(STATUS_TIP[c.status] || '')}" style="cursor:help;">${escapeHtml(statusLabel(c.status))}</span>
            <span>${escapeHtml(c.type)}</span>
            ${writersLine}
            <span title="Independence grade — how many separate people/nodes and cited sources back this, as opposed to how many AIs on one panel agree.">Independence: ${escapeHtml(c.evidence_grade || 'unrated')}</span>
            ${c.sources.length ? `<span>${c.sources.length} source${c.sources.length === 1 ? "" : "s"}</span>` : ""}
            <span class="claim-actions">
              <button class="btn-tiny challenge-btn" data-claim-id="${escapeHtml(c.id)}" data-claim-text="${escapeHtml(c.text)}" data-entry-id="${escapeHtml(c.entry_id)}">Challenge</button>
            </span>
          </div>
          ${attributionHtml}
          ${c.sources.length ? `
            <div style="margin-top: 10px; font-size: 13px;">
              ${c.sources.map(s => `
                <div class="source-card">
                  <span class="source-type">${escapeHtml(s.source_type)}</span>
                  ${s.url && /^https?:\/\//i.test(s.url) ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a>` : escapeHtml(s.title)}
                  ${s.publication_date ? `<span style="color: var(--muted)"> · ${escapeHtml(s.publication_date)}</span>` : ""}
                </div>
              `).join("")}
            </div>
          ` : ""}
        </div>`;
    }).join("");

    const pct = n => totalFactual ? (100 * n / totalFactual) : 0;
    const barSeg = (cls, n, label) => n ? `<span class="seg ${cls}" style="width:${pct(n).toFixed(1)}%" title="${escapeHtml(label)}: ${n}"></span>` : "";
    const verifiedOn = (entry.last_verified_at || entry.updated_at || "").slice(0, 10);
    const panelLine = writerNames.length ? `Checked by ${writerNames.join(", ")}` : `Checked by ${quorum} AIs`;

    const body = `
<article class="entry">
<div class="entry-header">
  <h1>${escapeHtml(entry.canonical_label)}</h1>
  ${lead ? `<p class="entry-lead">${escapeHtml(lead)}</p>` : ""}
  <div class="entry-meta">
    <span class="status-badge status-${escapeHtml(entry.status)}" title="${escapeHtml(STATUS_TIP[entry.status] || '')}">${escapeHtml(ENTRY_STATUS_LABEL[entry.status] || entry.status)}</span>
    <span>${escapeHtml(panelLine)}</span>
    ${verifiedOn ? `<span>${escapeHtml(verifiedOn)}</span>` : ""}
    <span class="qid"><a href="https://www.wikidata.org/wiki/${escapeHtml(entry.wikidata_qid)}" target="_blank" rel="noopener">${escapeHtml(entry.wikidata_qid)}</a></span>
  </div>
</div>

<section class="agreement-box" aria-label="Agreement">
  <div class="agreement-headline">
    <strong>${agreedN} of ${totalFactual}</strong> claims agreed by the AI panel <strong>(${agreedPct}%)</strong>
    ${contested ? ` · <strong class="contested-n">${contested} contested (${contestedPct}%)</strong>` : ` · nothing contested`}
  </div>
  <div class="agreement-bar" role="img" aria-label="${agreedAll} agreed by all, ${agreedSome} by most, ${single} by one AI, ${contested} contested">
    ${barSeg("seg-all", agreedAll, "All AIs agree")}${barSeg("seg-some", agreedSome, "Most AIs agree")}${barSeg("seg-single", single, "One AI, not contradicted")}${barSeg("seg-contested", contested, "Contested")}
  </div>
  <ul class="agreement-legend">
    <li><i class="seg-all"></i>All ${quorum} agree: ${agreedAll}</li>
    <li><i class="seg-some"></i>Most agree: ${agreedSome}</li>
    <li><i class="seg-single"></i>One AI, not contradicted: ${single}</li>
    <li><i class="seg-contested"></i>Contested: ${contested}</li>
    ${sectionNormative.length ? `<li><i class="seg-opinion"></i>Opinions, not graded: ${sectionNormative.length}</li>` : ""}
  </ul>
  ${contestedClaims.length ? `<div class="agreement-disputes"><strong>In dispute:</strong><ul>${contestedClaims.slice(0, 6).map(x =>
      `<li>${escapeHtml(asSentence(x.text))}${(x.against || []).length ? ` <span class="claim-who">— ${escapeHtml((x.by || []).map(engineName).join(", "))} vs ${escapeHtml((x.against || []).map(engineName).join(", "))}</span>` : ""}</li>`).join("")}</ul></div>` : ""}
  <p class="agreement-note">${nodeCount === 1
      ? `This panel was run by one person's node. Agreement between AIs is a signal, not proof — they share training data and can repeat the same error. A second independent node raises the grade.`
      : `${nodeCount} independent nodes contributed to this entry.`}
    ${!leadIsAgreed && lead ? ` The summary above includes claims only one AI stated.` : ""}</p>
</section>

${sectionsHtml}

<details class="audit">
  <summary>How this was verified — per-claim audit trail (${claimsWithData.length} claims)</summary>
  <p class="section-note">Every claim with the AIs that wrote or supported it, its independence grade, cited sources, and a Challenge button. ${meta.merge_method ? `Claims merged via ${escapeHtml(String(meta.merge_method))}` : ""}${meta.stance_method ? `, stances via ${escapeHtml(String(meta.stance_method))}` : ""}.</p>
  ${auditHtml || `<p class="empty-state">No atomic claims recorded yet.</p>`}
</details>
</article>
`;
    const description = lead ? lead.slice(0, 155).replace(/\s+\S*$/, "") + (lead.length > 155 ? "…" : "")
                             : `${entry.canonical_label}: ${claims.length} claims checked by ${quorum} AIs; ${agreedPct}% agreed.`;
    return htmlResponse(layout({
        title: `${escapeHtml(entry.canonical_label)} — HIVE`,
        body,
        description,
        canonical: `/entry/${entry.wikidata_qid}`,
        jsonLd: {
            "@context": "https://schema.org",
            "@type": "Article",
            headline: entry.canonical_label,
            description,
            abstract: lead || undefined,
            url: `${SITE_ORIGIN}/entry/${entry.wikidata_qid}`,
            inLanguage: entry.canonical_language || "en",
            datePublished: toIsoDate(entry.created_at),
            dateModified: toIsoDate(entry.updated_at) || toIsoDate(entry.created_at),
            author: { "@type": "Organization", name: "HIVE multi-AI panel" },
            publisher: { "@type": "Organization", name: "HIVE Encyclopedia", url: SITE_ORIGIN },
            isPartOf: { "@type": "WebSite", name: "HIVE Encyclopedia", url: SITE_ORIGIN },
            mainEntity: {
                "@type": "DefinedTerm",
                name: entry.canonical_label,
                description: lead || undefined,
                sameAs: `https://www.wikidata.org/wiki/${entry.wikidata_qid}`
            },
            about: {
                "@type": "Thing",
                name: entry.canonical_label,
                sameAs: `https://www.wikidata.org/wiki/${entry.wikidata_qid}`
            }
        }
    }));
}

// ── About page ──
export function aboutPage() {
    const body = `
<h1 style="font-family: var(--serif); font-size: 32px; margin-bottom: 24px;">About HIVE</h1>

<div class="mission-box">
  <h2>What we're building</h2>
  <p>
    HIVE is an encyclopedia where every entry is verified by multiple independent AIs, and every claim is rated by the strength of its evidence — not by editorial fiat.
  </p>
</div>

<h2 style="font-family: var(--serif); font-size: 24px; margin: 32px 0 12px;">Method</h2>
<ul style="padding-left: 24px; line-height: 1.8;">
  <li><strong>Atomic claims:</strong> Each entry is decomposed into discrete factual statements. Each gets its own status.</li>
  <li><strong>Multi-AI quorum:</strong> 3 AIs write independently. Where they agree, the claim is established. Where they don't, the claim is contested and more AIs are recruited (up to 15).</li>
  <li><strong>Diversity required:</strong> Each step adds a new diversity dimension — model family, geography, license, language ecosystem.</li>
  <li><strong>Source ladder:</strong> Sources are classified A–H by reliability. Challenges require citation above the bar of the claim's current status.</li>
  <li><strong>Dissent preserved:</strong> Minority views are never erased. The dissent log is part of the public record.</li>
  <li><strong>Wikidata foundation:</strong> One entry per Q-ID. Translations on demand. Languages do not fragment knowledge.</li>
</ul>

<h2 style="font-family: var(--serif); font-size: 24px; margin: 32px 0 12px;">What we are not</h2>
<p style="color: var(--muted); margin-bottom: 12px;">
  HIVE is <em>not</em> a "truth oracle." Truth is hard, and multiple AIs often share the same blind spots. We don't pretend to overcome that magically.
</p>
<p style="color: var(--muted);">
  HIVE <em>is</em> a transparency machine — every prompt, every AI's output, every source, every challenge is preserved and visible. Where AIs agree with strong citations, you can lean in. Where they don't, the dispute itself is the signal.
</p>

<h2 style="font-family: var(--serif); font-size: 24px; margin: 32px 0 12px;">License & data</h2>
<p style="color: var(--muted);">
  All HIVE content is licensed CC BY-SA 4.0 — free to use, share, and adapt with attribution. Built on top of Wikidata (CC0). API and weekly dumps available to all.
</p>
`;
    return htmlResponse(layout({
        title: "About — HIVE",
        body,
        description: "HIVE Encyclopedia: multi-AI verified atomic claims with transparent sources.",
        canonical: "/about"
    }));
}

// ── How HIVE Works — the three flows explained ──
export function howItWorksPage() {
    const body = `
<h1 style="font-family: var(--serif); font-size: 32px; margin-bottom: 16px;">How HIVE works</h1>

<p style="color: var(--muted); margin-bottom: 24px;">
  Three things can happen in HIVE: somebody asks for an entry, somebody challenges a claim, or somebody contributes their AI to do the work. Here's how each flow goes.
</p>

<h2 style="font-family: var(--serif); font-size: 24px; margin: 32px 0 12px;">1 · Entry creation</h2>
<p style="color: var(--muted);">
  HIVE never writes anything on its own. Every entry starts from a human request.
</p>

<pre style="background: var(--card); padding: 14px; border-radius: 6px; font-family: var(--mono); font-size: 12px; overflow-x: auto; line-height: 1.55;">
You: search "Marie Curie"
  → no HIVE entry yet
  → click "Request creation"
  ↓
Backend receives request:
  · Fetches Wikidata Q-ID
  · Classifies the topic (formal / trivial / time-sensitive /
    contested-historical / contested-scientific / contested-normative)
  · Picks initial quorum size (3 for simple, 7 for contested)
  · Adds to work queue with priority based on how many people want it
  ↓
A volunteer node (HIVE Bridge in someone's browser) polls the queue.
  · It claims your request (atomic — only one node gets it)
  · Spins up N independent AI tabs (Claude / ChatGPT / Gemini / + others)
  · Each AI writes an entry independently — they don't see each other
  · A neutral decomposer AI splits each into atomic claims
  · Aggregator compares: claims agreed on by all N AIs → "established"
  · Disagreement above threshold → escalate by 2 AIs (5 → 7 → 9 → ... → 15)
  ↓
Final POK record submitted to the backend:
  · Each atomic claim has its own status
  · Sources cited per claim
  · Dissent log preserved
  · Your queue item marked complete
  ↓
You visit the entry page — it's now alive with multi-AI verification.
The node gets +10 reputation. Future requests get the same treatment.
</pre>

<p style="color: var(--muted); margin-top: 12px;">
  Until enough volunteer nodes exist, requests can take minutes to hours. We bootstrap with Wikidata + Wikipedia content (status <code>single-source</code>) so every entry has something readable from day one.
</p>

<h2 style="font-family: var(--serif); font-size: 24px; margin: 40px 0 12px;">2 · Challenge a claim</h2>
<p style="color: var(--muted);">
  Once a claim exists, anyone can argue with it. But not with hot takes — with sources.
</p>

<pre style="background: var(--card); padding: 14px; border-radius: 6px; font-family: var(--mono); font-size: 12px; overflow-x: auto; line-height: 1.55;">
You: read the entry, spot a claim you think is wrong
  → click "Challenge"
  ↓
Form opens:
  · Pick challenge type: refute / amend / support / flag-bias
  · Optional explanation
  · ADD SOURCES (required, ≥ 1)
    Each source: URL, title, source type A-H (peer-reviewed → expert testimony)
    Plus verbatim quote and publication date
  ↓
Backend validates each source:
  · Blocklist check (Twitter / blogs / AI-generated → auto-rejected)
  · Type validity (must be A through H)
  · Evidence bar based on claim's current status:
       established  → need ≥2 type-A/B  OR ≥3 type-C/D
       well-supported → need ≥1 type-A  OR ≥2 type-B/C
       disputed → any type-D+ source admitted
  ↓
If the bar is met:
  · Challenge marked "pending"
  · Triggers a re-verification round (if claim becomes contested enough)
  · Nodes get a queue item for re-verification
  ↓
Re-verification re-runs the multi-AI quorum with the new evidence in context.
The new sources shift the verdict — strong contradicting source → status drops.
</pre>

<h2 style="font-family: var(--serif); font-size: 24px; margin: 40px 0 12px;">3 · Contribute your AI to the network</h2>
<p style="color: var(--muted);">
  This is where HIVE scales. Every volunteer who lends their browser-logged-in AI accounts becomes a verification node.
</p>

<pre style="background: var(--card); padding: 14px; border-radius: 6px; font-family: var(--mono); font-size: 12px; overflow-x: auto; line-height: 1.55;">
You: install the HIVE Bridge browser extension (Chrome)
  · Open tabs for ChatGPT, Gemini, Claude — be logged in to all three
  · Extension reads work-queue items from the backend
  · "I have 3 AIs available, what work needs doing?"
  ↓
For each item:
  · The Bridge sends the topic prompt to all 3 AI tabs in parallel
  · Each AI writes its entry — they don't see each other's responses
  · Bridge collects, decomposes, aggregates
  · Submits result to /api/queue/&lt;id&gt;/complete
  ↓
You earn reputation:
  · +10 per entry processed
  · Your tab is busy for ~30 seconds per entry
  · You can leave it running in the background, contribute thousands of
    entries over weeks
  · /me page shows your contribution history
  ↓
The more volunteer nodes the network has:
  · Faster turnaround on requests
  · More AI diversity (different families = better signal)
  · More geographic diversity (different regions reduce cultural bias)
</pre>

<h2 style="font-family: var(--serif); font-size: 24px; margin: 40px 0 12px;">The two contracts HIVE keeps</h2>
<ol style="padding-left: 24px; line-height: 1.8; color: var(--muted);">
  <li><strong>Transparency.</strong> Every claim shows which AIs agreed, which sources backed it, what dissent existed. The full transcript of every verification round is preserved and queryable via API.</li>
  <li><strong>No editorial fiat.</strong> Nothing gets removed because someone in charge dislikes it. Status changes only with new evidence above the bar. Dissent is preserved — never erased.</li>
</ol>

<p style="color: var(--muted); margin-top: 24px; font-size: 14px;">
  Questions or issues? The whole backend is open-source. The schema is documented in <code>migrations/0001_init.sql</code>. The Worker logic is in <code>src/</code>.
</p>
`;
    return htmlResponse(layout({
        title: "How HIVE works — HIVE Encyclopedia",
        body,
        description: "The three flows in HIVE: entry creation, challenges, and volunteer node contribution.",
        canonical: "/how-it-works"
    }));
}

// ── My contributions page (anonymous — reads from localStorage in browser) ──
export function mePage() {
    const body = `
<h1 style="font-family: var(--serif); font-size: 32px; margin-bottom: 16px;">My contributions</h1>

<div id="me-summary" class="mission-box">
  <p style="color: var(--muted);">Loading your anonymous contributor profile…</p>
</div>

<h2 style="font-family: var(--serif); font-size: 22px; margin: 28px 0 12px;">Entries you added</h2>
<div id="me-entries"><p style="color: var(--muted);">Loading…</p></div>

<h2 style="font-family: var(--serif); font-size: 22px; margin: 28px 0 12px;">Challenges you filed</h2>
<div id="me-challenges"><p style="color: var(--muted);">Loading…</p></div>

<script>
(async () => {
  const id = localStorage.getItem("hive_contributor_id");
  const summary = document.getElementById("me-summary");
  const entriesEl = document.getElementById("me-entries");
  const challengesEl = document.getElementById("me-challenges");

  if (!id) {
    summary.innerHTML = "<h2>Anonymous contributor — pending</h2><p style='color:var(--muted)'>You don't have a contributor ID yet. Submit any entry or challenge and one will be created for you.</p>";
    entriesEl.innerHTML = ""; challengesEl.innerHTML = "";
    return;
  }

  try {
    const profileR = await fetch("/api/contributor/" + id);
    const profile = profileR.ok ? (await profileR.json()).contributor : null;
    const contribR = await fetch("/api/contributor/" + id + "/contributions");
    const contrib = contribR.ok ? await contribR.json() : { entries: [], challenges: [] };

    summary.innerHTML =
      "<h2 style='font-family:var(--serif); font-size:20px;'>Anonymous contributor</h2>" +
      "<p style='color:var(--muted);'>Your contributor ID: <code style='font-family:var(--mono);'>" + id + "</code></p>" +
      "<p style='color:var(--muted); margin-top:8px;'>Stats: " +
      (profile?.entries_contributed || 0) + " entries · " +
      (profile?.challenges_filed || 0) + " challenges filed · " +
      (profile?.challenges_accepted || 0) + " challenges accepted · " +
      "reputation " + (profile?.reputation_score || 0) +
      "</p>";

    if (!contrib.entries.length) {
      entriesEl.innerHTML = "<p style='color:var(--muted);'>No entries yet. Help by writing one.</p>";
    } else {
      entriesEl.innerHTML = "<ul class='recent-list'>" + contrib.entries.map(e =>
        "<li><a href='/entry/" + e.wikidata_qid + "'>" + e.canonical_label + "</a>" +
        "<span class='status-badge status-" + e.status + "'>" + e.status + "</span>" +
        "<span class='qid'>" + e.wikidata_qid + "</span></li>"
      ).join("") + "</ul>";
    }

    if (!contrib.challenges.length) {
      challengesEl.innerHTML = "<p style='color:var(--muted);'>No challenges yet.</p>";
    } else {
      challengesEl.innerHTML = "<ul class='recent-list'>" + contrib.challenges.map(c =>
        "<li><span>" + c.challenge_type + "</span><span class='status-badge status-" + c.status + "'>" + c.status + "</span><span class='qid'>" + c.id + "</span></li>"
      ).join("") + "</ul>";
    }
  } catch (e) {
    summary.innerHTML = "<p style='color:var(--status-refuted);'>Could not load your profile: " + e.message + "</p>";
  }
})();
</script>
`;
    return htmlResponse(layout({
        title: "My contributions — HIVE",
        body,
        noindex: true
    }));
}

// ── Contribute page ──
export function contributePage() {
    const body = `
<h1 style="font-family: var(--serif); font-size: 32px; margin-bottom: 24px;">Contribute to HIVE</h1>

<div class="mission-box">
  <h2>Ways to help — pick one</h2>
  <p>HIVE is in early alpha. Three ways to contribute right now, from low effort to higher effort.</p>
</div>

<h2 style="font-family: var(--serif); font-size: 22px; margin: 32px 0 12px;">1. Read and challenge (no install needed)</h2>
<p style="color: var(--muted);">
  Browse entries. When you spot a claim you think is wrong, click <strong>Challenge</strong>.
  You'll need to submit at least one source from our <a href="#source-ladder">source ladder</a>.
  Bad citations get rejected automatically.
</p>

<h2 style="font-family: var(--serif); font-size: 22px; margin: 32px 0 12px;">2. Suggest a topic</h2>
<p style="color: var(--muted);">
  Any Wikidata Q-ID can become a HIVE entry — search for it on the homepage. When the entry doesn't exist yet,
  you'll see an "unverified" page that invites a contributor (you, or another) to run a verification round.
</p>

<h2 style="font-family: var(--serif); font-size: 22px; margin: 32px 0 12px;">3. Run a verification node</h2>
<p style="color: var(--muted);">
  Install the HIVE browser extension. It uses your already-logged-in ChatGPT, Gemini, and Claude tabs to write entries
  collaboratively. Each contribution shows in your profile (anonymous contributions also welcome).
</p>
<p style="color: var(--muted); margin-top: 12px;">
  Extension install instructions coming soon. For now, the backend is live and accepting submissions via the API at
  <code style="font-family: var(--mono); background: var(--card); padding: 2px 6px; border-radius: 3px;">/api/entry</code>.
</p>

<h2 id="source-ladder" style="font-family: var(--serif); font-size: 22px; margin: 40px 0 12px;">Source ladder</h2>
<p style="color: var(--muted); margin-bottom: 16px;">
  Challenges require sources. Each source is classified A–H by strength.
</p>
<table style="width: 100%; border-collapse: collapse; font-size: 14px;">
  <thead style="border-bottom: 2px solid var(--border);">
    <tr><th style="text-align: left; padding: 8px 4px;">Type</th><th style="text-align: left; padding: 8px 4px;">Category</th><th style="text-align: left; padding: 8px 4px;">Examples</th></tr>
  </thead>
  <tbody>
    <tr style="border-bottom: 1px solid var(--border);"><td style="padding: 8px 4px;"><strong>A</strong></td><td style="padding: 8px 4px;">Peer-reviewed academic</td><td style="padding: 8px 4px; color: var(--muted);">PubMed, Nature, arXiv</td></tr>
    <tr style="border-bottom: 1px solid var(--border);"><td style="padding: 8px 4px;"><strong>B</strong></td><td style="padding: 8px 4px;">Government / official</td><td style="padding: 8px 4px; color: var(--muted);">census.gov, ECB, courts</td></tr>
    <tr style="border-bottom: 1px solid var(--border);"><td style="padding: 8px 4px;"><strong>C</strong></td><td style="padding: 8px 4px;">Trusted databases</td><td style="padding: 8px 4px; color: var(--muted);">Crossref, ORCID, IMDb</td></tr>
    <tr style="border-bottom: 1px solid var(--border);"><td style="padding: 8px 4px;"><strong>D</strong></td><td style="padding: 8px 4px;">Established news</td><td style="padding: 8px 4px; color: var(--muted);">Reuters, AP, BBC, NYT</td></tr>
    <tr style="border-bottom: 1px solid var(--border);"><td style="padding: 8px 4px;"><strong>E</strong></td><td style="padding: 8px 4px;">Reputable publishers</td><td style="padding: 8px 4px; color: var(--muted);">OUP, Cambridge UP, Penguin</td></tr>
    <tr style="border-bottom: 1px solid var(--border);"><td style="padding: 8px 4px;"><strong>F</strong></td><td style="padding: 8px 4px;">Primary documents</td><td style="padding: 8px 4px; color: var(--muted);">Archival records, letters</td></tr>
    <tr style="border-bottom: 1px solid var(--border);"><td style="padding: 8px 4px;"><strong>G</strong></td><td style="padding: 8px 4px;">Other encyclopedias</td><td style="padding: 8px 4px; color: var(--muted);">Britannica</td></tr>
    <tr><td style="padding: 8px 4px;"><strong>H</strong></td><td style="padding: 8px 4px;">Expert testimony</td><td style="padding: 8px 4px; color: var(--muted);">Recognized authority quotes</td></tr>
  </tbody>
</table>

<p style="color: var(--muted); font-size: 14px; margin-top: 16px;">
  Auto-rejected: social media, self-published blogs, Wikipedia mirrors, AI-generated content.
</p>
`;
    return htmlResponse(layout({
        title: "Contribute — HIVE",
        body,
        description: "Three ways to contribute to HIVE: read & challenge, suggest topics, run a verification node.",
        canonical: "/contribute"
    }));
}
