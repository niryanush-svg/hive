// Adaptive quorum classifier.
// Classifies a topic by contention level. Uses Wikidata P31 (instance of)
// signals + a hardcoded heuristic table. Output drives the initial quorum size.

function json(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }
    });
}

// Map Wikidata P31 (instance of) values → classification.
// Built from common Q-IDs we'd expect to see. Extensible.
const P31_CLASSIFICATION = {
    // Conflicts and disputed territory → contested-historical
    "Q198":     "contested-historical",  // war
    "Q188055":  "contested-historical",  // armed conflict
    "Q41397":   "contested-historical",  // genocide
    "Q21025":   "contested-historical",  // territorial dispute
    "Q26720107": "contested-historical", // border dispute
    "Q3024240": "contested-historical",  // historical period

    // Political/normative positions → contested-normative
    "Q179805":  "contested-normative",   // philosophical concept
    "Q41217":   "contested-normative",   // legal concept
    "Q39381":   "contested-normative",   // controversy
    "Q1454986": "contested-normative",   // social issue
    "Q201948":  "contested-normative",   // ethical issue

    // Contested scientific
    "Q11862829": "contested-scientific", // academic discipline (may be soft science)
    "Q4421":    "contested-scientific",  // forest (no, but as placeholder)
    "Q35666":   "contested-scientific",  // pseudoscience

    // Time-sensitive: current officeholders, living people in politics
    "Q5":       "time-sensitive",        // human (will refine: living + politician → time-sensitive)
    "Q294414":  "time-sensitive",        // public office
    "Q4164871": "time-sensitive",        // position

    // Mathematical / formal
    "Q11862813": "formal",               // mathematical theorem
    "Q3018178":  "formal",               // theorem
    "Q174104":  "formal",                // mathematical constant
    "Q12503":   "formal",                // axiom

    // Trivial empirical (most things default here)
    "Q3624078": "trivial-empirical",     // sovereign state
    "Q6256":    "trivial-empirical",     // country
    "Q515":     "trivial-empirical",     // city
    "Q4022":    "trivial-empirical",     // river
    "Q8502":    "trivial-empirical",     // mountain
    "Q7397":    "trivial-empirical",     // software
    "Q11424":   "trivial-empirical",     // film
    "Q571":     "trivial-empirical",     // book
    "Q482994":  "trivial-empirical",     // album
    "Q11629":   "trivial-empirical",     // scientific concept
};

// Quorum size by classification
const QUORUM_BY_CLASSIFICATION = {
    "formal": 3,
    "trivial-empirical": 3,
    "time-sensitive": 3,
    "contested-historical": 5,
    "contested-scientific": 7,
    "contested-normative": 7,
    "unknown": 3
};

// Pure classifier: given a list of P31 values + topic label, decide classification.
// Returns { classification, initial_quorum_size, reasoning, signals }
// extras: { p570_date_of_death, p39_position_held } help distinguish
//         a current officeholder from a historical figure.
export function classifyTopic({ p31_values, label, description, extras }) {
    const signals = { p31: p31_values || [], label, description: description || "", extras: extras || {} };
    const lowerLabel = (label || "").toLowerCase();
    const lowerDesc = (description || "").toLowerCase();
    const isHuman = (p31_values || []).includes("Q5");
    const isDead = !!(extras && extras.p570_date_of_death);
    const hasCurrentRole = !!(extras && extras.p39_position_held && extras.p39_position_held.length > 0);

    // Step 1: P31 signal — first matching value wins
    let cls = null;
    let reasoning = "";
    for (const v of (p31_values || [])) {
        if (P31_CLASSIFICATION[v]) {
            cls = P31_CLASSIFICATION[v];
            reasoning = `Wikidata P31=${v} → ${cls}`;
            break;
        }
    }

    // Step 1.5: Person-specific refinement
    // Default rule said "any human = time-sensitive" — wrong for historical figures.
    if (cls === "time-sensitive" && isHuman) {
        if (isDead) {
            cls = "trivial-empirical";
            reasoning = "Person has Wikidata P570 (date of death) → historical, not time-sensitive";
        } else if (!hasCurrentRole && !/president|prime minister|chairman|leader|king|queen|emperor|pope/i.test(lowerDesc)) {
            // Living human without a current public office → not time-sensitive
            cls = "trivial-empirical";
            reasoning = "Living human with no documented current public position";
        }
    }

    // Step 2: keyword heuristics (cheap, helpful when P31 inconclusive)
    if (!cls) {
        if (/\b(war|conflict|genocide|massacre|invasion|occupation)\b/.test(lowerLabel + " " + lowerDesc)) {
            cls = "contested-historical";
            reasoning = "Keyword signal (war/conflict/genocide)";
        } else if (/\b(abortion|euthanasia|capital punishment|atheism|religion|morality|ethics)\b/.test(lowerLabel)) {
            cls = "contested-normative";
            reasoning = "Keyword signal (normative topic)";
        } else if (/\b(homeopathy|astrology|acupuncture|gmo|climate change|vaccine|chiropractic)\b/.test(lowerLabel)) {
            cls = "contested-scientific";
            reasoning = "Keyword signal (contested scientific)";
        } else if (/\b(theorem|proof|axiom|formula|equation|integral|derivative)\b/.test(lowerLabel)) {
            cls = "formal";
            reasoning = "Keyword signal (mathematical/formal)";
        } else if (/\b(president|prime minister|chairman|CEO|leader|current)\b/.test(lowerDesc)) {
            cls = "time-sensitive";
            reasoning = "Keyword signal (current officeholder)";
        }
    }

    // Step 3: default
    if (!cls) {
        cls = "trivial-empirical";
        reasoning = "Default: no specific signals matched";
    }

    return {
        classification: cls,
        initial_quorum_size: QUORUM_BY_CLASSIFICATION[cls] || 3,
        reasoning,
        signals
    };
}

// POST /api/classify — classify a topic by QID or by label.
// Body: { wikidata_qid?, label?, description?, p31_values? }
export async function handleClassify(request, env, path) {
    if (request.method !== "POST") {
        return json({ error: "Use POST" }, 405);
    }

    const body = await request.json().catch(() => null);
    if (!body) return json({ error: "Invalid JSON" }, 400);

    let label = body.label;
    let description = body.description;
    let p31_values = body.p31_values || [];
    let extras = body.extras || {};

    // If only QID given, fetch from Wikidata
    if (body.wikidata_qid && (!label || p31_values.length === 0)) {
        try {
            const r = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${body.wikidata_qid}.json`, {
                headers: { "User-Agent": "HIVE-Encyclopedia/0.1" }
            });
            if (r.ok) {
                const data = await r.json();
                const ent = data.entities?.[body.wikidata_qid];
                if (ent) {
                    label = label || ent.labels?.en?.value;
                    description = description || ent.descriptions?.en?.value;
                    p31_values = (ent.claims?.P31 || []).map(s => s.mainsnak?.datavalue?.value?.id).filter(Boolean);
                    // Pull death-date and current-position signals
                    extras.p570_date_of_death = ent.claims?.P570?.[0]?.mainsnak?.datavalue?.value?.time || null;
                    extras.p39_position_held = (ent.claims?.P39 || [])
                        .filter(s => s.rank !== 'deprecated')
                        // current positions have no P582 end-time qualifier
                        .filter(s => !s.qualifiers?.P582)
                        .map(s => s.mainsnak?.datavalue?.value?.id)
                        .filter(Boolean);
                }
            }
        } catch (e) {
            console.error("Wikidata fetch failed:", e);
        }
    }

    const result = classifyTopic({ p31_values, label, description, extras });
    return json({
        ...result,
        input: { wikidata_qid: body.wikidata_qid, label, description, p31_values_count: p31_values.length }
    });
}
