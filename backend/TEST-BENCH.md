# HIVE — Test Bench

A graded set of claims/questions to validate HIVE across the full contention
spectrum. Run each, check it lands on the **Expected** result. This is how you
prove the epistemics work — not perfect, just honestly calibrated.

> Verify mode = paste a **claim** (one statement). Panel mode = ask a **question**.

---

## A. VERIFY mode (a claim → one clear verdict)

The verdict banner should be unmissable and in plain language.

| # | Claim | Expected verdict | What it tests |
|---|---|---|---|
| 1 | Paris is the capital of France. | ✅ **Likely true / Well-supported** | basic true fact, clean sourcing |
| 2 | Water boils at 100°C at sea level. | ✅ **Well-supported** | textbook fact |
| 3 | The Great Wall of China is visible from space with the naked eye. | ❌ **Likely false** | myth where popular belief is wrong — needs *sourced* contradiction |
| 4 | Humans use only 10% of their brains. | ❌ **Likely false** | classic myth; tests refuted-with-evidence |
| 5 | Intermittent fasting is more effective than calorie restriction for weight loss. | ⚖️ **Genuinely disputed** | live scientific debate → must NOT pick a side |
| 6 | Nuclear power is the safest form of energy. | ⚖️ **Genuinely disputed** | depends on framing → disputed, not a verdict |
| 7 | Capital punishment is morally wrong. | 💬 **A matter of opinion** | normative → no truth verdict |
| 8 | Acme Corp is the most innovative company in its industry. | ⚠️ **Only self-reported** | self-claim / power-asymmetry → capped |
| 9 | Exactly 14 undiscovered mammal species live in the Amazon. | ❓ **Can't verify** | no possible evidence → unverifiable |
| 10 | *(the charged real-world claim you tested)* | ⚖️ **Genuinely disputed** | the guard that protects the product on hot topics |

**The key new test is #5/#6/#10:** before the fix these could come back as a
confident `refuted`/`established`. Now, with 0 gathered sources or strong
arguments on both sides, they must land on **⚖️ Genuinely disputed**. If any of
them shows a confident ✅/❌ with **0 sources**, the guard failed — report it.

**What good looks like (Verify):**
- The bottom-line banner is obvious and in plain words.
- "How sure" + "N sources found" are shown — a confident verdict with 0 sources should never appear.
- Disputed/opinion claims preserve both sides under "Details for the curious".

---

## B. PANEL mode (a question → debate + synthesis)

Tests the multi-AI debate, the **always-on Falsifier**, and echo-chamber honesty.

| # | Question | What to watch for |
|---|---|---|
| 1 | Does sugar cause hyperactivity in children? | Falsifier should **challenge the agreement** and demand a source; consensus marks it "convergent — not independently verified" |
| 2 | Is intermittent fasting effective for long-term weight loss? | nuance by certainty level; honest about weak long-term evidence |
| 3 | What are the leading explanations for the fall of the Roman Empire? | multiple framings surfaced, not one flattened answer |
| 4 | Cheap, realistic ways to lower a home electricity bill? | practical synthesis that beats any single answer |

**What good looks like (Panel):**
- When the engines **agree**, the Falsifier still runs and attacks the agreement (look for the ⚔ falsifier card).
- The consensus flags ungrounded agreement as **"convergent, not verified"** rather than presenting it as proof.
- If only 1 engine is connected, a "single model, not a panel" notice appears.

---

## C. Reliability self-test (no claim needed)

Settings → **🔍 Test all engines**. Expected: a per-engine ✅/⚠️ with plain advice
("open the tab / sign in / switch to API mode"). This catches "connected but
extraction broke" — the real failure mode.

---

*Build check: Settings shows `HIVE web build`. Re-run after a `Ctrl+Shift+R` if the stamp is stale.*
