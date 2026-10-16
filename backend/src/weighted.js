// ═══════════════════════════════════════════════════════════════
// Weighted aggregation — pure functions. No DB, no I/O.
//
// Maps weighted agreement to an evidence_grade that the UI renders.
// Unproven / false claims are NOT given equal weight — they get their
// own grade and are visually marked.
// ═══════════════════════════════════════════════════════════════

// Evidence grades, strongest to weakest.
export const EVIDENCE_GRADE = Object.freeze({
    PROVEN: "proven",                 // formal claim derived, or overwhelming weighted agreement + sources
    WELL_SUPPORTED: "well-supported", // strong weighted agreement BACKED BY a cited external source
    CONVERGENT_UNVERIFIED: "convergent-unverified", // AIs converge but NO verifiable external source — not verification
    CONTESTED: "contested",           // weighted votes split
    UNPROVEN: "unproven",             // insufficient weighted agreement, no contradiction
    FALSE: "false",                   // weighted agreement that the claim is FALSE (disagree votes dominate)
    NORMATIVE: "normative"            // value claim — never graded, preserved
});

// Collapse correlated contributions before tallying.
//
// Votes that share an origin_node_id — e.g. one human running three AI tabs —
// are NOT independent evidence. Counting them as three manufactures the false
// convergence the panel exists to refuse. Within each origin group we keep ONE
// effective vote: the group's net position (weighted agree vs disagree inside
// the origin) carried at the group's single strongest model weight. A self-
// contradicting origin collapses to abstain (it cancels itself out).
//
// Contributions with no origin_node_id fall back to contributor_id, then to a
// per-row unique key — i.e. "treat as its own independent origin" — so missing
// provenance never silently merges two genuinely separate voters.
//
// Consequence: a single-node panel (one origin) yields at most ~1.0 weighted
// agreement, which gradeFromTally caps at UNPROVEN / single-source. Only
// genuinely independent origins accumulate weight toward well-supported and
// established. This is the structural guarantee behind one-AI-per-user.
export function collapseByOrigin(contributions) {
    const groups = new Map();
    let anon = 0;
    for (const c of contributions) {
        // Origin precedence, strongest (least forgeable) first:
        //   verified_subject — OAuth identity, proves a distinct person
        //   origin_ip_hash   — server-derived from request IP, client can't forge
        //   origin_node_id   — client-supplied (provenance, but forgeable)
        //   contributor_id   — fallback
        const key = c.verified_subject || c.origin_ip_hash || c.origin_node_id || c.contributor_id || `__row_${anon++}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(c);
    }
    const collapsed = [];
    for (const [key, group] of groups) {
        if (group.length === 1) { collapsed.push(group[0]); continue; }
        let agreeW = 0, disagreeW = 0, maxW = 0;
        for (const c of group) {
            const w = typeof c.weight === "number" ? c.weight : 1.0;
            if (w > maxW) maxW = w;
            if (c.vote === "agree") agreeW += w;
            else if (c.vote === "disagree") disagreeW += w;
        }
        let vote = "abstain";
        if (agreeW > disagreeW) vote = "agree";
        else if (disagreeW > agreeW) vote = "disagree";
        collapsed.push({ vote, weight: maxW, origin_node_id: key, collapsed_from: group.length });
    }
    return collapsed;
}

// Given a list of contributions [{vote: 'agree'|'disagree'|'abstain', weight}],
// compute weighted agreement and total. Abstain counts toward total at half weight
// (it's a signal of uncertainty, not absence).
//
// Callers that grade a claim should pass the output of collapseByOrigin() so that
// same-origin votes are not double-counted as independent evidence.
export function tallyWeighted(contributions) {
    let agreeW = 0, disagreeW = 0, abstainW = 0;
    for (const c of contributions) {
        const w = typeof c.weight === "number" ? c.weight : 1.0;
        if (c.vote === "agree") agreeW += w;
        else if (c.vote === "disagree") disagreeW += w;
        else abstainW += w;
    }
    const decisiveW = agreeW + disagreeW;            // votes that took a position
    const totalW = agreeW + disagreeW + abstainW;
    return { agreeW, disagreeW, abstainW, decisiveW, totalW };
}

// Decide an evidence grade from a weighted tally + claim type + source strength.
// sourceStrength: 0..1 (fraction/score of cited independent sources). Optional.
export function gradeFromTally(tally, { type = "FACT", sourceStrength = 0, hasStrongContradiction = false } = {}) {
    if (type === "NORMATIVE") {
        return { grade: EVIDENCE_GRADE.NORMATIVE, confidence: 0,
                 reason: "Value claim — preserved without a truth verdict." };
    }

    const { agreeW, disagreeW, decisiveW, totalW } = tally;
    if (totalW === 0) {
        return { grade: EVIDENCE_GRADE.UNPROVEN, confidence: 0, reason: "No AI votes recorded." };
    }

    const agreeFrac = decisiveW > 0 ? agreeW / decisiveW : 0;       // among those who took a side
    const decisiveFrac = totalW > 0 ? decisiveW / totalW : 0;       // how many took a side at all

    // FALSE: the weighted panel actively says it's wrong.
    if (disagreeW > agreeW && disagreeW >= 1.5) {
        return { grade: EVIDENCE_GRADE.FALSE,
                 confidence: Math.min(0.95, 0.5 + 0.1 * disagreeW),
                 reason: `Weighted panel rejects this claim (${disagreeW.toFixed(2)} disagree vs ${agreeW.toFixed(2)} agree).` };
    }

    // CONTESTED: meaningfully split.
    if (decisiveW >= 2 && agreeFrac >= 0.35 && agreeFrac <= 0.7) {
        return { grade: EVIDENCE_GRADE.CONTESTED,
                 confidence: 0.4,
                 reason: `Weighted votes split (${(agreeFrac*100).toFixed(0)}% agree among decisive voters).` };
    }

    // Formal claim with no contradiction → PROVEN (derivation is the evidence).
    if (type === "FORMAL" && !hasStrongContradiction && agreeW >= 1.5) {
        return { grade: EVIDENCE_GRADE.PROVEN, confidence: 0.95,
                 reason: "Formal claim with weighted agreement and no contradiction." };
    }

    // High weighted agreement.
    if (agreeFrac >= 0.85 && agreeW >= 2.0) {
        // Strong agreement + strong independent sources → proven.
        if (sourceStrength >= 0.6 && agreeW >= 2.5) {
            return { grade: EVIDENCE_GRADE.PROVEN,
                     confidence: Math.min(0.97, 0.7 + 0.1 * agreeW),
                     reason: `Strong weighted agreement (${agreeW.toFixed(2)}) backed by independent cited sources.` };
        }
        // GROUNDING THRESHOLD — the heart of the encyclopedia's spirit.
        // Model agreement WITHOUT a verifiable external source can never read as
        // verification: the engines share training data, so converging is a
        // correlation signal, not proof. Cap such claims at convergent-unverified
        // and label them honestly. Only a quoted A–H source crosses into
        // well-supported. (FORMAL claims already returned PROVEN above via the
        // derivation-is-evidence path, so this never demotes a real derivation.)
        if (type !== "FORMAL" && sourceStrength < 0.5) {
            return { grade: EVIDENCE_GRADE.CONVERGENT_UNVERIFIED,
                     confidence: 0.45,
                     reason: `AIs converge (${(agreeFrac*100).toFixed(0)}%, weight ${agreeW.toFixed(2)}) but no verifiable external source is cited — convergent, not verified.` };
        }
        return { grade: EVIDENCE_GRADE.WELL_SUPPORTED,
                 confidence: Math.min(0.85, 0.5 + 0.1 * agreeW),
                 reason: `High weighted agreement (${(agreeFrac*100).toFixed(0)}%) backed by a cited source (strength ${sourceStrength.toFixed(2)}).` };
    }

    // Some agreement but thin.
    if (agreeW >= 1.0 && disagreeW === 0) {
        return { grade: EVIDENCE_GRADE.UNPROVEN,
                 confidence: 0.25,
                 reason: `Only ${agreeW.toFixed(2)} weighted agreement — not enough to establish.` };
    }

    return { grade: EVIDENCE_GRADE.UNPROVEN, confidence: 0.1,
             reason: "Insufficient weighted signal." };
}

// Map an evidence grade → the legacy `status` enum the UI already understands.
// Keeps backward compatibility with existing claim rendering.
export function gradeToStatus(grade) {
    switch (grade) {
        case EVIDENCE_GRADE.PROVEN:         return "established";
        case EVIDENCE_GRADE.WELL_SUPPORTED: return "well-supported";
        case EVIDENCE_GRADE.CONVERGENT_UNVERIFIED: return "convergent-unverified";
        case EVIDENCE_GRADE.CONTESTED:      return "disputed";
        case EVIDENCE_GRADE.FALSE:          return "refuted";
        case EVIDENCE_GRADE.NORMATIVE:      return "preserved-no-verdict";
        case EVIDENCE_GRADE.UNPROVEN:       return "single-source";
        default:                            return "unverified";
    }
}
