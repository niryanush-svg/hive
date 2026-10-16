// ═══════════════════════════════════════════════════════════════
// Source ladder + grounding-strength scoring. Single source of truth,
// shared by challenge.js (challenge bars) and submit-vote.js (grading),
// so the two can never drift.
//
// The encyclopedia's spirit: AIs are RESEARCHERS that bring verifiable
// external sources, not voters. A claim's grounding strength comes from the
// distinct, independent external sources cited for it — never from how many
// models agreed.
// ═══════════════════════════════════════════════════════════════

// Source-type weight ladder (A strongest … H weakest).
export const SOURCE_WEIGHTS = {
    A: 100, // peer-reviewed academic
    B: 90,  // government / official
    C: 80,  // trusted databases
    D: 70,  // established news
    E: 70,  // books from reputable publishers
    F: 60,  // primary documents
    G: 50,  // other encyclopedias
    H: 40   // expert testimony
};

// Compute a 0..1 grounding strength for a claim from its claim_sources rows.
//
// A row only COUNTS toward grounding if:
//   - it supports the claim (not a contradiction),
//   - it is on the A–H ladder,
//   - it carries a non-empty verbatim quote (the anti-illusion guard — a cite
//     with no quote of the supporting sentence is not evidence),
//   - its independence is not 'orbit' and not 'unknown' (unknown is treated as
//     non-independent — conservative, so an unverified self-report can't lift a
//     claim).
// Counted ONCE per distinct publisher (fallback url/doi), so three engines
// citing the same paper = one source, not three.
export function computeSourceStrength(claimSourceRows) {
    if (!Array.isArray(claimSourceRows) || claimSourceRows.length === 0) return 0;
    const seen = new Set();
    let total = 0;
    for (const r of claimSourceRows) {
        const supports = (r.supports_or_contradicts || "supports") === "supports";
        const type = r.source_type;
        const hasQuote = !!(r.quote && String(r.quote).trim().length > 0);
        const indep = (r.independence || "unknown");
        if (!supports || !SOURCE_WEIGHTS[type] || !hasQuote) continue;
        if (indep === "orbit" || indep === "unknown") continue;
        const key = (r.publisher || r.url || r.doi || r.source_id || "").toString().toLowerCase().trim();
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        total += SOURCE_WEIGHTS[type] / 100;
    }
    return Math.min(1, total);
}
