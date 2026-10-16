// Shared HTML layout. All public pages use this shell.
// Minimal CSS, no external deps. Mobile-first.

// Origin used for canonical / og:url / JSON-LD. Absolute URLs are required
// there — a relative canonical is ignored by some crawlers, and og:url must be
// absolute to be usable at all.
const SITE_ORIGIN = "https://hive.niryanush.workers.dev";

function attr(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// `canonical` is a site-absolute PATH ("/entry/Q937"); it is resolved against
// SITE_ORIGIN here so no caller has to remember the origin.
// `noindex` keeps thin/duplicated pages out of the index while still letting a
// crawler follow their links.
// `jsonLd` is an object (or array) emitted as ld+json structured data.
export function layout({ title, body, description, canonical, noindex, jsonLd }) {
    const safeTitle = (title || "HIVE Encyclopedia").replace(/</g, "&lt;");
    const safeDesc = (description || "A multi-AI verified encyclopedia. Atomic claims, transparent sources, preserved dissent.").replace(/</g, "&lt;");
    const canonicalUrl = canonical ? SITE_ORIGIN + canonical : null;
    // "</" inside a JSON string would close the script element early.
    const jsonLdBlock = jsonLd
        ? `<script type="application/ld+json">${JSON.stringify(jsonLd).split("<").join("\\u003c")}</script>`
        : "";
    return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<meta name="description" content="${safeDesc}">
${noindex ? `<meta name="robots" content="noindex, follow">` : `<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">`}
${canonicalUrl ? `<link rel="canonical" href="${attr(canonicalUrl)}">` : ""}
<meta property="og:type" content="article">
<meta property="og:site_name" content="HIVE Encyclopedia">
<meta property="og:title" content="${attr(safeTitle)}">
<meta property="og:description" content="${attr(safeDesc)}">
${canonicalUrl ? `<meta property="og:url" content="${attr(canonicalUrl)}">` : ""}
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${attr(safeTitle)}">
<meta name="twitter:description" content="${attr(safeDesc)}">
${jsonLdBlock}
<style>
:root {
  --bg: #fafaf7;
  --fg: #1a1a1a;
  --muted: #6b6b6b;
  --accent: #b8860b;
  --link: #064C77;
  --border: #e6e6e0;
  --card: #ffffff;
  --status-established: #2d7a2d;
  --status-well-supported: #4a7a4a;
  --status-convergent-unverified: #5b7a99;
  --status-disputed: #b8860b;
  --status-single-source: #8a6b3a;
  --status-refuted: #a02020;
  --status-perpetually-contested: #6b2b8a;
  --status-unverified: #888888;
  --serif: 'Cormorant Garamond', 'Iowan Old Style', Georgia, serif;
  --sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --mono: 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1a1d20;
    --fg: #ececec;
    --muted: #9b9b9b;
    --accent: #d4a737;
    --link: #5ba3d9;
    --border: #2c3034;
    --card: #22262b;
  }
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html { font-size: 16px; }
body {
  font-family: var(--sans);
  background: var(--bg);
  color: var(--fg);
  line-height: 1.55;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
header {
  border-bottom: 1px solid var(--border);
  padding: 14px 20px;
  background: var(--card);
  /* Sticky so the nav is always reachable — no page should be a dead end. */
  position: sticky;
  top: 0;
  z-index: 50;
}
header .wrap {
  max-width: 960px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap; /* nav wraps under the logo on narrow screens instead of overflowing */
}
header h1 {
  font-family: var(--serif);
  font-size: 26px;
  font-weight: 600;
  letter-spacing: 0.5px;
}
header h1 a { color: var(--fg); }
header nav {
  display: flex;
  gap: 18px;
  font-size: 14px;
}
header nav a { color: var(--muted); }
header nav a:hover { color: var(--link); }
main {
  flex: 1;
  max-width: 960px;
  width: 100%;
  margin: 0 auto;
  padding: 32px 20px;
}
footer {
  border-top: 1px solid var(--border);
  padding: 24px 20px;
  font-size: 13px;
  color: var(--muted);
  text-align: center;
  background: var(--card);
}
footer .wrap { max-width: 960px; margin: 0 auto; }

/* Search box */
.search-form { display: flex; gap: 8px; margin: 20px 0; }
.search-form input {
  flex: 1;
  padding: 10px 14px;
  font-size: 15px;
  font-family: var(--sans);
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--card);
  color: var(--fg);
}
.search-form button {
  padding: 10px 18px;
  background: var(--link);
  color: white;
  border: none;
  border-radius: 6px;
  font-family: var(--sans);
  font-size: 14px;
  cursor: pointer;
}
.search-results { margin-top: 16px; }
.search-result {
  padding: 12px;
  border-bottom: 1px solid var(--border);
  display: block;
  color: var(--fg);
}
.search-result:hover { background: var(--card); text-decoration: none; }
.search-result .qid { font-family: var(--mono); font-size: 12px; color: var(--muted); }
.search-result .label { font-size: 16px; font-weight: 600; margin-top: 2px; }
.search-result .desc { font-size: 14px; color: var(--muted); margin-top: 2px; }

/* Entry page */
.entry-header {
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}
.entry-header h1 {
  font-family: var(--serif);
  font-size: 36px;
  font-weight: 600;
}
.entry-meta {
  margin-top: 8px;
  font-size: 13px;
  color: var(--muted);
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.entry-meta .qid {
  font-family: var(--mono);
  background: var(--card);
  padding: 2px 8px;
  border-radius: 3px;
}
.status-badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 3px 8px;
  border-radius: 3px;
  color: white;
}
.status-established { background: var(--status-established); }
.status-well-supported { background: var(--status-well-supported); }
.status-convergent-unverified { background: var(--status-convergent-unverified); }
.status-disputed { background: var(--status-disputed); }
.status-single-source { background: var(--status-single-source); }
.status-refuted { background: var(--status-refuted); }
.status-perpetually-contested { background: var(--status-perpetually-contested); }
.status-unverified, .status-draft { background: var(--status-unverified); }
.status-preserved-no-verdict { background: var(--status-perpetually-contested); }

/* Claims */
.claims-section { margin-top: 24px; }
.claims-section h2 {
  font-family: var(--serif);
  font-size: 22px;
  font-weight: 600;
  margin-bottom: 12px;
}
.claim-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-left: 3px solid var(--status-unverified);
  border-radius: 4px;
  padding: 14px 16px;
  margin-bottom: 10px;
}
.claim-card.s-established { border-left-color: var(--status-established); }
.claim-card.s-well-supported { border-left-color: var(--status-well-supported); }
.claim-card.s-convergent-unverified { border-left-color: var(--status-convergent-unverified); }
.claim-card.s-disputed { border-left-color: var(--status-disputed); }
.claim-card.s-single-source { border-left-color: var(--status-single-source); }
.claim-card.s-refuted {
  border-left-color: var(--status-refuted);
  background: rgba(160,32,32,0.08);
}
.claim-card.s-preserved-no-verdict { border-left-color: var(--status-perpetually-contested); }
.claim-text { font-size: 15px; line-height: 1.55; }
.ai-attribution {
  margin-top: 10px;
  padding: 8px;
  background: var(--bg);
  border-radius: 4px;
  font-size: 12px;
  color: var(--muted);
}
.ai-attribution-item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0;
}
.ai-model {
  font-family: var(--mono);
  font-weight: 600;
  cursor: help;
  border-bottom: 1px dotted var(--link);
}
.ai-vote-agree { color: var(--status-established); font-weight: 600; }
.ai-vote-disagree { color: var(--status-refuted); font-weight: 600; }
.ai-weight { font-size: 11px; color: var(--muted); }
.claim-meta {
  margin-top: 8px;
  font-size: 12px;
  color: var(--muted);
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.claim-actions { margin-left: auto; display: flex; gap: 8px; }
.btn-tiny {
  padding: 3px 10px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.btn-tiny:hover { color: var(--link); border-color: var(--link); }

/* Sources */
.sources-section { margin-top: 32px; }
.source-card {
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 10px 14px;
  margin-bottom: 8px;
  background: var(--card);
  font-size: 14px;
}
.source-card .source-type {
  display: inline-block;
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 600;
  background: var(--bg);
  padding: 1px 6px;
  border-radius: 3px;
  margin-right: 6px;
}

/* Empty / error */
.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--muted);
}
.empty-state h2 {
  font-family: var(--serif);
  font-size: 24px;
  margin-bottom: 8px;
  color: var(--fg);
}

/* Recent entries */
.recent-list { list-style: none; }
.recent-list li {
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 12px;
}
.recent-list li a { font-weight: 500; flex: 1; }
.recent-list li .qid {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--muted);
}

/* Mission box */
.mission-box {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 20px 24px;
  margin-bottom: 24px;
}
.mission-box h2 {
  font-family: var(--serif);
  font-size: 20px;
  margin-bottom: 8px;
}
.mission-box p { color: var(--muted); font-size: 15px; }

/* Challenge modal */
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5);
  display: none; align-items: center; justify-content: center;
  z-index: 1000;
}
.modal-overlay.open { display: flex; }
.modal {
  background: var(--card);
  border-radius: 8px;
  padding: 24px;
  max-width: 600px;
  width: calc(100% - 40px);
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 12px 48px rgba(0,0,0,0.25);
}
.modal h2 {
  font-family: var(--serif);
  font-size: 22px;
  margin-bottom: 12px;
}
.modal label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
  margin-top: 14px;
  margin-bottom: 4px;
}
.modal input, .modal textarea, .modal select {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-family: var(--sans);
  font-size: 14px;
  background: var(--bg);
  color: var(--fg);
}
.modal textarea { min-height: 60px; resize: vertical; }
.source-row {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 10px;
  margin-top: 8px;
}
.source-row .row2 { display: grid; grid-template-columns: 1fr 100px; gap: 8px; margin-top: 8px; }
.source-row .row3 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
.modal-actions {
  display: flex; justify-content: flex-end; gap: 8px;
  margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border);
}
.btn-primary {
  padding: 8px 18px; background: var(--link); color: white;
  border: none; border-radius: 4px; font-size: 14px; cursor: pointer;
}
.btn-secondary {
  padding: 8px 18px; background: transparent; color: var(--muted);
  border: 1px solid var(--border); border-radius: 4px; font-size: 14px; cursor: pointer;
}
.btn-add-source {
  padding: 6px 12px; background: transparent; color: var(--link);
  border: 1px dashed var(--border); border-radius: 4px; font-size: 13px;
  cursor: pointer; margin-top: 8px;
}
.modal-message {
  margin-top: 12px; padding: 10px; border-radius: 4px;
  font-size: 14px;
}
.modal-message.success { background: rgba(45,122,45,0.15); color: var(--status-established); border: 1px solid var(--status-established); }
.modal-message.error { background: rgba(160,32,32,0.15); color: var(--status-refuted); border: 1px solid var(--status-refuted); }
.modal-help { font-size: 12px; color: var(--muted); margin-top: 4px; }
/* Entry article (13.10.26) */
.entry-lead {
  font-family: var(--serif);
  font-size: 19px;
  line-height: 1.55;
  margin-top: 14px;
  max-width: 68ch;
}
.entry-meta .qid a { color: var(--muted); }
.agreement-box {
  margin: 20px 0 8px;
  padding: 16px 18px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.agreement-headline { font-size: 16px; }
.agreement-headline .contested-n { color: var(--status-disputed); }
.agreement-bar {
  display: flex;
  height: 10px;
  margin: 12px 0 8px;
  border-radius: 5px;
  overflow: hidden;
  background: var(--border);
}
.agreement-bar .seg { display: block; height: 100%; }
.seg-all { background: var(--status-established); }
.seg-some { background: var(--status-well-supported); }
.seg-single { background: var(--status-single-source); }
.seg-contested { background: var(--status-disputed); }
.seg-opinion { background: var(--status-perpetually-contested); }
.agreement-legend {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  font-size: 13px;
  color: var(--muted);
  margin: 0;
  padding: 0;
}
.agreement-legend i {
  display: inline-block;
  width: 10px; height: 10px;
  border-radius: 2px;
  margin-right: 6px;
  vertical-align: -1px;
}
.agreement-disputes { margin-top: 12px; font-size: 14px; }
.agreement-disputes ul { margin: 6px 0 0 18px; }
.agreement-disputes li { margin: 4px 0; }
.agreement-note { margin-top: 12px; font-size: 13px; color: var(--muted); line-height: 1.5; }
.entry-section { margin-top: 28px; }
.entry-section h2 {
  font-family: var(--serif);
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 8px;
}
.entry-section.contested h2 { color: var(--status-disputed); }
.section-note { font-size: 13px; color: var(--muted); margin-bottom: 10px; }
.prose-claims { margin: 0 0 0 20px; padding: 0; font-size: 16px; line-height: 1.6; }
.prose-claims li { margin: 6px 0; }
.claim-mark {
  display: inline-block;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 0 5px;
  margin-left: 6px;
  vertical-align: 1px;
  cursor: help;
}
.claim-who { font-size: 13px; color: var(--muted); margin-top: 2px; }
details.audit { margin-top: 36px; border-top: 1px solid var(--border); padding-top: 12px; }
details.audit summary {
  cursor: pointer;
  font-family: var(--serif);
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 8px;
}
details.audit summary:hover { color: var(--link); }
@media (max-width: 600px) {
  .entry-lead { font-size: 17px; }
  .agreement-legend { gap: 4px 12px; }
}
</style>
</head>
<body>
<header>
  <div class="wrap">
    <h1><a href="/">HIVE</a></h1>
    <nav>
      <a href="/">Browse</a>
      <a href="/about">About</a>
      <a href="/how-it-works">How it works</a>
      <a href="/contribute">Contribute</a>
      <a href="/me" id="navMe">My contributions</a>
    </nav>
  </div>
</header>
<main>
${body}
</main>

<!-- Challenge modal -->
<div class="modal-overlay" id="challengeModal" onclick="if(event.target.id==='challengeModal')closeChallenge()">
  <div class="modal">
    <h2>Challenge a claim</h2>
    <p style="color:var(--muted); font-size:14px;">
      To challenge a claim you must provide at least one source. Strong sources let you challenge stronger statuses.
    </p>
    <input type="hidden" id="chClaimId">
    <input type="hidden" id="chEntryId">

    <label>Claim being challenged</label>
    <div id="chClaimText" style="font-size:14px; padding:8px; background:var(--bg); border:1px solid var(--border); border-radius:4px; color:var(--fg);"></div>

    <label>Type of challenge</label>
    <select id="chType">
      <option value="refute">Refute — this claim is wrong</option>
      <option value="amend">Amend — partially correct, needs revision</option>
      <option value="support">Support — additional evidence reinforcing it</option>
      <option value="flag-bias">Flag bias — claim may be biased / non-neutral</option>
    </select>

    <label>Your explanation (optional)</label>
    <textarea id="chExplanation" placeholder="Briefly explain what's wrong and what the correct version should be."></textarea>

    <label>Sources (at least 1 required)</label>
    <div id="chSources">
      <div class="source-row">
        <input type="text" placeholder="Source URL (https://...)" data-field="url">
        <div class="row3">
          <input type="text" placeholder="Source title" data-field="title">
          <select data-field="source_type">
            <option value="">Type…</option>
            <option value="A">A — Peer-reviewed</option>
            <option value="B">B — Government / official</option>
            <option value="C">C — Trusted database</option>
            <option value="D">D — Established news</option>
            <option value="E">E — Reputable publisher</option>
            <option value="F">F — Primary document</option>
            <option value="G">G — Other encyclopedia</option>
            <option value="H">H — Expert testimony</option>
          </select>
        </div>
        <div class="row2">
          <input type="text" placeholder="Verbatim quote from source" data-field="quote">
          <input type="text" placeholder="Date" data-field="publication_date">
        </div>
      </div>
    </div>
    <button type="button" class="btn-add-source" onclick="addSourceRow()">+ Add another source</button>
    <div class="modal-help">
      A/B sources can challenge any status. D-level sources work only for already-disputed claims.
      Social media, blogs, AI-generated content, and Wikipedia mirrors are auto-rejected.
    </div>

    <div id="chMessage" style="display:none;"></div>

    <div class="modal-actions">
      <button type="button" class="btn-secondary" onclick="closeChallenge()">Cancel</button>
      <button type="button" class="btn-primary" onclick="submitChallenge()">Submit challenge</button>
    </div>
  </div>
</div>

<script>
// Delegated handler — claim text is carried in data-* attributes (never in an
// inline onclick), so AI-generated claim text can't break out into markup/JS.
document.addEventListener("click", function (e) {
  var b = e.target.closest && e.target.closest(".challenge-btn");
  if (b) openChallenge(b.getAttribute("data-claim-id"), b.getAttribute("data-claim-text"), b.getAttribute("data-entry-id"));
});
function openChallenge(claimId, claimText, entryId) {
  document.getElementById("chClaimId").value = claimId || "";
  document.getElementById("chEntryId").value = entryId || "";
  document.getElementById("chClaimText").textContent = claimText || "";
  document.getElementById("chExplanation").value = "";
  document.getElementById("chType").value = "refute";
  document.getElementById("chMessage").style.display = "none";
  // Reset sources to one empty row
  document.getElementById("chSources").innerHTML = document.querySelector("#chSources .source-row").outerHTML;
  document.querySelectorAll("#chSources input, #chSources select").forEach(el => el.value = "");
  document.getElementById("challengeModal").classList.add("open");
}
function closeChallenge() {
  document.getElementById("challengeModal").classList.remove("open");
}
function addSourceRow() {
  const first = document.querySelector("#chSources .source-row");
  const clone = first.cloneNode(true);
  clone.querySelectorAll("input, select").forEach(el => el.value = "");
  document.getElementById("chSources").appendChild(clone);
}
function readSources() {
  const rows = document.querySelectorAll("#chSources .source-row");
  const sources = [];
  for (const row of rows) {
    const get = f => row.querySelector('[data-field="' + f + '"]').value.trim();
    const src = { url: get("url"), title: get("title"), source_type: get("source_type"), quote: get("quote"), publication_date: get("publication_date") };
    if (src.title || src.url) sources.push(src);
  }
  return sources;
}
async function submitChallenge() {
  const msg = document.getElementById("chMessage");
  msg.style.display = "none";
  const sources = readSources();
  if (sources.length === 0) { showMsg("Please add at least one source.", "error"); return; }
  for (const s of sources) {
    if (!s.title) { showMsg("Each source needs a title.", "error"); return; }
    if (!s.source_type) { showMsg("Each source needs a type (A-H).", "error"); return; }
  }

  const payload = {
    target_claim_id: document.getElementById("chClaimId").value || null,
    target_entry_id: document.getElementById("chEntryId").value || null,
    challenge_type: document.getElementById("chType").value,
    explanation: document.getElementById("chExplanation").value,
    sources
  };

  try {
    const r = await fetch("/api/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await r.json();
    if (r.ok) {
      showMsg("Challenge submitted (ID: " + result.challenge_id + "). " + (result.next_step || ""), "success");
      setTimeout(closeChallenge, 3500);
    } else {
      let detail = result.error || "Failed";
      if (result.rejected_details && result.rejected_details.length) {
        detail += " — " + result.rejected_details.map(r => r.reason).join("; ");
      }
      if (result.help) detail += " " + result.help;
      showMsg(detail, "error");
    }
  } catch (e) {
    showMsg("Network error: " + e.message, "error");
  }
}
function showMsg(text, kind) {
  const msg = document.getElementById("chMessage");
  msg.textContent = text;
  msg.className = "modal-message " + kind;
  msg.style.display = "block";
}

// ── Anonymous contributor token bootstrap ──
// On first visit, mint an anon contributor ID and store in localStorage.
// Sent in X-Hive-Contributor-Id header on every API call.
async function getOrMintContributorId() {
  let id = localStorage.getItem("hive_contributor_id");
  if (id) return id;
  try {
    const r = await fetch("/api/contributor/new", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const data = await r.json();
    if (data.contributor_id) {
      localStorage.setItem("hive_contributor_id", data.contributor_id);
      return data.contributor_id;
    }
  } catch (e) { console.warn("[HIVE] Could not mint contributor id:", e); }
  return null;
}
// Fire-and-forget on page load
getOrMintContributorId().then(id => {
  if (id) {
    const meLink = document.getElementById("navMe");
    if (meLink) meLink.href = "/me";
  }
});

// Wrap fetch for /api/challenge and /api/entry to include the header
const _origFetch = window.fetch;
window.fetch = function(input, init) {
  if (typeof input === "string" && (input.includes("/api/challenge") || input.includes("/api/entry"))) {
    const id = localStorage.getItem("hive_contributor_id");
    if (id) {
      init = init || {};
      init.headers = init.headers || {};
      init.headers["X-Hive-Contributor-Id"] = id;
    }
  }
  return _origFetch.call(this, input, init);
};
</script>

<footer>
  <div class="wrap">
    HIVE Encyclopedia · A multi-AI verified knowledge base, built on <a href="https://www.wikidata.org" target="_blank" rel="noopener">Wikidata</a> · CC BY-SA 4.0 · <a href="https://github.com/niryanush-svg/hive" target="_blank" rel="noopener">Source on GitHub</a>
  </div>
</footer>
</body>
</html>`;
}

// Friendly HTTP response shorthand
export function htmlResponse(html, status = 200) {
    return new Response(html, {
        status,
        headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=60"
        }
    });
}

export function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
