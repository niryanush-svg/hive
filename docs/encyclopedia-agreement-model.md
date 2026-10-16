# Encyclopedia — diagnosis, 13.10.26

Nir's four observations (entries unreadable, won't rank in Google, no visible way
to create an entry, and "why is everything disputed?") turn out to share a single
root cause, plus one separate dead end. Measured on the live site, not inferred.

---

## 1. The root cause: the claim matcher can never fire

`aggregateEncyclopediaEntries` merges claims from the three writers using
`claimsMatch`, a Jaccard token-overlap test with `threshold = 0.45`.

Measured on the live **Gross domestic product** entry (Q12638), all 2,080 claim
pairs:

```
jaccard   max = 0.40   mean = 0.050    >= 0.45 : 0 pairs merge
containment max = 0.83 mean = 0.115    >= 0.70 : 6 pairs merge
```

**The maximum achievable similarity (0.40) is below the threshold (0.45).** The
matcher does not "rarely" merge — it mathematically cannot merge anything, on any
entry. Confirmed on the page itself: **64 of 65 claims are badged
`single-source`**, each credited to one AI.

Jaccard is the wrong metric here anyway. Two sentences stating the same fact in
different words share few tokens:

- "The capitalization rate is the ratio of net operating income to property value."
- "Cap rate equals a property's annual NOI divided by its market price."

Jaccard = 2/15 = 0.13. Containment (|A∩B| / min(|A|,|B|)) is far better suited to
sentence-length claims of differing length — hence 0.83 vs 0.40 above.

### Everything downstream is this bug wearing different clothes

- **"Everything is disputed."** Convergence = grounded/total. Nothing merges, so
  nothing reaches `established`/`well-supported`, so convergence lands at 3-8% on
  every entry and the recommendation falls through to `contested` → status
  `disputed`. All 20 live entries show it. **It is a measurement artifact, not
  disagreement between the models.** Nir's instinct was right.
- **"Unreadable."** Three AIs × ~21 claims should collapse into ~21 claims with
  3/3 agreement. Instead the page renders 65 separate one-sentence claims, each
  wrapped in the same metadata block (`single-source` / `Type:` / `Evidence:
  unproven` / `Challenge` / `AI Panel: 3 AIs` / `✓ Claude Opus 4.8 (1.00)`).
- **"Won't rank in Google."** A page of 65 near-identical boilerplate blocks with
  no prose is exactly the thin/repetitive content signal search engines demote.

### Fix options

1. **Swap the metric** — containment ≥ 0.70 with better normalisation
   (stopwords, abbreviation expansion NOI/GDP/cap rate). Cheap, pure-function,
   unit-testable, zero engine cost. Fixes the arithmetic immediately.
2. **AI merge pass** — a neutral fourth engine merges the three claim lists. Much
   more accurate, costs one extra engine call per entry, and we already rotate a
   neutral decomposer so the pattern exists.
3. Both: (1) now, (2) when quality matters more than quota.

Either way **existing entries keep their wrong status until rebuilt** — the
backend upserts, so re-running a topic corrects it.

---

## 2. The separate dead end: entry requests go nowhere

The creation path exists and works as far as the UI:

> search a term → it queries Wikidata live and lists candidates → pick one →
> **"Request creation"** → `POST /api/queue/request` → joins the queue → "a
> volunteer node picks it up".

But `GET /api/queue/next` returns `{"available": []}` and **nothing drains that
queue**. `hiveNode.processNext()` exists in the web app and is wired to the
queue — but our only node, the `hive-routine` scheduled task, calls
`HIVE.writeEntry(label, {qid})` straight from the static
`tools/encyclopedia-topics.md` file. It never looks at the queue.

So a visitor who requests an entry gets "Request added to queue" and then
nothing ever happens. That is worse than having no button.

**Fix:** the routine should drain the request queue FIRST (real user demand) and
fall back to the static topic file only when the queue is empty. That is a
change to the task prompt plus `HIVE.processOne()`, not new code.

---

## 3. Google: the markup is fine, the content is not

Checked on the live entry page — this part is already correct and does not need
work:

- `<title>`, `<meta name="description">`, canonical, Open Graph, Twitter card
- `<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">`
- `WebSite` JSON-LD with a `SearchAction` on the index
- `/sitemap.xml`, `/robots.txt`, `/llms.txt` all return 200

What is missing is, in order of weight:

1. **Readable content.** See §1. No lead paragraph, no sections, no prose — just
   a claim dump. This is the single biggest ranking blocker.
2. **Nobody has submitted the sitemap.** Both domains had zero index entries on
   Bing/DDG as of 11.10. Needs Google Search Console + Bing Webmaster
   verification — requires Nir's account and a token served by the worker.
3. **Zero inbound links.** Nothing points at the encyclopedia.
4. No `Article`/`DefinedTerm` JSON-LD on entry pages (only `WebSite` on the index).

---

## 4. What an entry should look like

Wikipedia gives you the article and hides the citations. We do the opposite: we
publish the audit trail and never wrote the article. The audit trail is our
differentiator and it should stay — but underneath, not instead.

Proposed shape:

1. **Lead paragraph** — 2-4 sentences in plain prose, composed from the claims
   the panel actually agreed on. This is what Google indexes and what a reader
   reads.
2. **An agreement figure that means something** — "17 of 21 claims agreed by all
   three AIs (81%)" with the contested ones named. This is Nir's "give the
   dispute a percentage", and after §1 the percentage will finally be real.
3. **Body sections** — claims grouped by type (definition / mechanism / numbers
   / contested) as readable paragraphs, not one card per sentence.
4. **The audit trail, collapsed** — per-claim AI attribution, sources and the
   Challenge button behind a "show how this was verified" disclosure.

Status vocabulary also needs softening for a lay reader: `single-source`,
`preserved-no-verdict`, `perpetually-contested` and `Evidence: unproven` are
internal terms that read as alarming.

---

## Recommended order

1. Fix the matcher (§1 option 1) — one function, unit-testable, unblocks the
   number, costs nothing.
2. Rebuild the 20 live entries with the fixed matcher; see what real convergence
   looks like.
3. Rewrite the entry template (§4) — article on top, audit trail below.
4. Point the routine at the request queue (§2).
5. Submit sitemaps to Search Console / Bing (needs Nir).

---

## Done 13.10.26 (evening)

- §1 fixed twice over: containment matcher + AI merge pass (web 2026.10.13-a, live), then
  a **stance pass** (web 2026.10.13-b) after the live rebuild showed the deeper issue —
  three entries cover different facts, and silence was being counted as non-agreement.
- §4 built: entry page rewritten (`src/html/pages.js`, CSS in `layout.js`).
- Found and fixed on the way: claim rows were never pruned on rebuild (170 claims on the
  live GDP page), `metadata_json` never refreshed, and `/api/submit-vote` rewrote every
  claim to `single-source` because one node is capped at UNPROVEN.
- Still open: §2 (routine → request queue), §3.2 sitemaps (Nir), rebuild of the 20 entries.
