# HIVE web 2026.10.16-g — Fact-check: evidence contradictions weigh, no positive verdict without the critic (NOT DEPLOYED) · 3.6.7 profiles in memory

3.6.7 live gate, 16.10 17:55 ET: "The Great Wall of China is visible from space with the naked eye" came back **Likely true** on 11 sources — one supporting (Cernan), the rest contradicting (Scientific American, Yang Liwei, ESA) — because (1) contradicting sources inside the evidence set never weighed, only the adversary's counters did, and (2) the adversary seat (ChatGPT) had failed mid-run, so "no strong counter" read as "no objection". `aggregatePOK` now: independent contradicting sources pull the verdict to disputed, or refuted when they are ≥2 and ≥2× the supporting ones; and when the adversary seat gave nothing, established/well-supported are withheld as "Can't verify — nothing argued against the claim; run again". Six verdict shapes unit-tested (Great Wall shape → refuted). web.test.js ALL PASS.

3.6.7 (zip rebuilt, sha 8149A5C6…C942): the live gate also showed `SET_PROFILES` failing — the manifest has no `storage` permission (the 3.6.6 stub hid it). Adding a permission would disable the extension on auto-update until accepted, so profiles now live in service-worker memory and the web re-pushes them on every ping (web -f). Live after reload: set/get/clear OK, unknown engine rejected.

Gate state: Fact-check — verdict bug found and fixed (re-run pending); Manager — running; Meeting — pending. ChatGPT seat: the bridge preferred one of Nir's own ChatGPT tabs, which accepted the injection and never produced a readable answer (`timeout_no_new_response`); a fresh tab worked.

# HIVE web 2026.10.16-c — failed engines explained in plain language (NOT DEPLOYED)

Launch readiness §2. A Meeting card used to read "⚠ submit_not_confirmed" and a Manager worker card "timeout_no_new_response". Now: "<Engine> didn't answer: <what happened and what to do> [code]" via `explainEngineFailure` — closed tab, layout change (reopen; HIVE updates selectors remotely), timeout (bring the tab forward), empty answer (usually a usage limit), permission. The run still continues with the other engines, as before. Stance prompt hardened: "answer by reading, do not write code" (Gemini Flash-Lite answered with a Python script on 16.10). web.test.js ALL PASS; mirror synced. Carries -b (profile push).

# HIVE Bridge 3.6.7 — remote selector profiles, for real (BUILT 16.10.26, NOT SUBMITTED) · web 2026.10.16-b pushes them (NOT DEPLOYED)

Launch readiness 3.1. 3.6.6 shipped only half of "the next site redesign is a web deploy":
injectFn/pollFn/extractFn honour profile selectors via `sel(key)`, but the service worker
never passed a profile (`args: [question, engineId]`) and had no message to receive one.

## Extension (background.js, manifest 3.6.7, zip hive-bridge-3.6.7.zip sha256 3D10AD78…D6AF, 30,872 bytes, same 9 members as 3.6.6 — rebuilt 16.10 15:30 with the usage-limit probe; the 60FD44DD build is superseded)
- **Usage-limit probe** (readiness 2.1): when extractFn returns nothing (`timeout_no_new_response` / `no_new_response_element` / `empty_response_element`), `limitProbeFn` reads the tab's visible text for the provider's limit banner (ChatGPT, Claude, Gemini incl. the Hebrew quota notice) and the error becomes `usage_limit`. Web -e wording: "out of quota on that account for now — HIVE continued with the other AIs".
- `HIVE:SET_PROFILES {profiles:{<engine>:{sel:{input,send,stop,ready,response,responseBody,userTurn,busy}}}}`
  → `sanitizeProfiles` (built-in ids only, PROFILE_KEYS only, strings ≤ 400 chars) → merged into
  `chrome.storage.local.hiveProfiles`. `HIVE:GET_PROFILES` returns them. Empty object clears an engine.
- `profileFor(engineId)` now passed as S to inject / poll / extract. The in-tab `sel()` still
  re-validates each selector with querySelector, so a bad value falls back to the built-in.
- Suites: chatgpt-layout ALL PASS, claude-guard ALL PASS, gate G2b/G2c/G2d/G3b REFUSE, adversarial
  only R8 BAD (known), gemini-account ALL PASS. sanitizeProfiles unit-tested (bogus key, non-string,
  over-long, unknown engine all dropped; flat and `sel`-wrapped shapes both accepted).
- Permissions unchanged → store review should be the fast path.

## Web (2026.10.16-b)
- `engine-config.json` may carry `profiles`; pushed to the bridge once per page load right after
  the first successful ping (`pushRemoteProfiles`). Pre-3.6.7 bridges answer Unknown and are ignored.

## Operating procedure after 3.6.7 is live
A chat site changes its DOM → put the new selector(s) under `profiles.<engine>.sel` in
`engine-config.json` → web deploy → every bridge picks it up on its next page load. If no selector
rescues it, `engines.<engine>.enabled=false` + note pauses the engine for everyone (3.2).

## Nir's steps
1. Reload the unpacked folder (chrome://extensions → ↻) → the version tooltip says 3.6.7.
2. One live run per mode on hive-ny.pages.dev (the gate: NIGHT-LOG result per mode).
3. `node tools\cws-publish.js hive-bridge-3.6.7.zip` (re-auth first if cws-auth is stale) + Edge manual.

# HIVE web 2026.10.16-a — remote engine kill switch (NOT DEPLOYED) · worker: hardening + has_agreement + home filter (NOT DEPLOYED)

Launch-readiness work (`LAUNCH-READINESS.md`, opened 16.10).

## Web
- `/engine-config.json` read on load (no-store): `{engines:{chatgpt|gemini|claude:{enabled,note}}, notice}`.
  An engine with `enabled:false` is unavailable with a visible reason in the preflight
  error (`errEngineDisabled`, EN+HE); `notice` shows as a status line. Pausing a broken
  engine for everyone = edit the json + web deploy. `HIVE.remoteConfig()` / `HIVE.engineDisabled(id)`
  exposed for tests; jsdom test with a mocked config PASS; web.test.js ALL PASS.
- Carries -c (publishMinAgreed 0.4) and -d (stance retry + no-evidence fallback).
- FINDING: the 3.6.6 "remote profiles" are a stub — no HIVE:SET_PROFILES handler, the in-tab
  functions never read S. Selector overrides are 3.6.7 work (readiness 3.1).

## Worker (hive-backend)
- POST /api/entry: rate limit 30/10 min per IP, X-Hive-Contributor-Id required (401), claim
  cap 400, quality gate (409) — never replaces a stance-verified entry with an unverified one,
  never drops below half the claims (entries ≥ 10 claims). 6-case unit test.
- Rate limits added: submit_vote 60, contributor_new 10, queue claim/complete/fail 60 (per 10 min).
- /api/recent rows carry has_agreement (= stanced summary); home page lists stanced entries only
  while the rebuild runs (falls back to all when none).

## Routine / tools
- store-monitor.sh prints ALERT lines: weekly-active users −20%, rating < 3.5, store version newer
  than the built manifest. Routine push on ALERT still to wire (readiness 7.1).

# HIVE web 2026.10.13-d — agreement floor 0.4 + stance retry/fallback (NOT DEPLOYED) · worker: has_agreement on /api/recent (NOT DEPLOYED)

Night of 13.10: 13 live entries rebuilt on 2026.10.13-b (ENC-LOG 76-80).

## Findings
- Settled topics corroborate 45-72% of their claims with ZERO contradictions (GDP 47%,
  Plate tectonics 46%, Blockchain 50%, Freedom of speech 53%, Sleep 58%, Dark matter 69%,
  Roman Empire 72%); the remainder is coverage difference between three short entries.
  Capital punishment 23% (politically contested, factually uncontradicted). GDP carried the
  only real dispute: 2 claims, ChatGPT vs Gemini on illegal activity in GDP.
- Gemini's DAILY quota dies after ~12 entries in an evening (3 Gemini calls per entry).
  Four entries ran with a dead Gemini (Evolution, Inflation, Photosynthesis, Machine
  learning): stance pass "none" → the no-evidence fallback labelled them "contested".

## Web (-c, -d)
- `AGREEMENT_RULES.publishMinAgreed` 0.5 → 0.4: a settled topic with no contradiction
  reads "AI panel largely agrees"; 23% stays "Partial agreement".
- Without stance evidence the verdict is publish (≥0.7) or escalate — never contested.
- Stance pass retries once on the next engine in rotation; unusable responses logged
  (`[HIVE enc] stance pass unusable from <id>: …`).
- Suites: web.test.js ALL PASS, in-page aggregator self-test 15/16 (pre-existing
  selectDiverseNodes failure). Mirror byte-identical.

## Backend (db.js)
- `/api/recent` rows carry `has_agreement` (= metadata has `"stanced":true`), so the
  routine's rebuild lane finds stale entries in ONE request instead of 60.

## Routine (tools/hive_routine.py + SKILL.md)
- Priority: public request queue (`NEXT QUEUE`, `HIVE.processOne()`) > rebuild of a live
  entry without a stanced summary (`NEXT REBUILD`) > new topic from the file.
- Lock held by mtime until 14.10 09:00 ET (Gemini quota). `lock-release` to resume.

# HIVE web 2026.10.13-b — Stance pass: silence is not dispute (NOT YET DEPLOYED) + backend entry page rewrite (worker NOT YET DEPLOYED)

Live GDP rebuild on 2026.10.13-a (21:01-21:12 ET, under the lock): merge pass fired
(`147 claims → 105 unique via ai:chatgpt`), but 82 of 105 were still single-source and
the entry stayed `disputed` at 15%. The writers' entries were 6.6K / 5.4K / 2.9K chars —
they cover different facts. The aggregator read "not mentioned" as "not agreed".

## Web (index.html)
- **Stance pass** after merge+aggregate: a neutral engine (rotation after the merger)
  gets every unique claim and every writer's FULL entry and answers S/C/- per claim per
  entry. Support found in the full text counts as agreement; an explicit contradiction
  makes the claim `disputed` (new `contradicted_by`); silence leaves it uncontested.
  Guards: a writer that stated a claim keeps its support; <50% coverage → ignored
  (`stance_method: "none"`). +1 engine call per entry.
- **Agreement model** (`summarizeAgreement`): `record.agreement = {total, agreed_all,
  agreed_some, uncontested_single, contested, agreed_share, contested_share,
  contested_claims[{text, by, against}]}`. With stances: publish when contested ≤ 10%
  and agreed ≥ 50%, escalate ≤ 25%, else contested. Without stances: old 0.7/0.5 rule.
  `convergence_score` = agreed_share. Sent to the backend in `metadata.agreement`.
- Decomposer prompt rule 6: one claim per fact, 10-30 per entry (ChatGPT decomposer
  emitted 15.8K chars of claims).
- Self-test fixtures rewritten (the old "X born 1879" phrases are under the 5-token
  floor); 5 new stance checks. 15/16 pass under jsdom — the one failure
  (`selectDiverseNodes prefers diverse families`) is pre-existing and untouched.
- web.test.js ALL PASS, test_matcher PASS, test_merge PASS. Mirror byte-identical.

## Backend (hive-backend, Nir deploys the worker)
- `db.js`: entry upsert now refreshes `metadata_json`; claim insert is an upsert on id;
  new `pruneClaimsNotIn` — a rebuild REPLACES the claim set (live GDP page was carrying
  170 claims = 65 old + 105 new; stale rows never died).
- `submit-vote.js`: votes no longer demote `status`. One node is capped at UNPROVEN by
  design, which rewrote every claim — including 3/3 panel agreement — to `single-source`.
  Panel reading (`status`) and independence reading (`evidence_grade`) are two axes;
  votes may still set refuted / disputed / established / well-supported.
- `pages.js` entry page rewritten: lead paragraph composed from agreed claims
  (definition sentence first), agreement box "N of M claims agreed (x%) · k contested
  (y%)" with a colour bar and the contested claims NAMED (who vs who), sections
  (agrees / contested / one AI not contradicted / values), per-claim audit trail folded
  in `<details>`, readable labels ("All AIs agree", "One AI, not contradicted",
  "Opinion — not graded") instead of the internal vocabulary, meta description = lead,
  Article JSON-LD gets `abstract` + `mainEntity: DefinedTerm`. Home page badges readable.
  Rendered offline against live GDP data with a fake D1 (test-results preview, removed).

## Next
1. Nir deploys web + worker (lines in chat). 2. Rebuild GDP under the lock → read
`agreement` + `stance_method`, confirm the prune (claims_count == page count). 3. Rebuild
the other 19 entries. 4. Routine drains the request queue first. 5. Sitemaps (Nir).

# HIVE web 2026.10.13-a — Encyclopedia matcher rewrite + AI merge pass (NOT YET DEPLOYED; Nir runs the deploy line)

Root cause of "everything is disputed" (`hive-backend/ENCYCLOPEDIA-DIAGNOSIS-2026-10-13.md`):
the claim matcher (Jaccard ≥ 0.45 on raw tokens) could never fire — measured max
0.40 across all 2,080 pairs of the live GDP entry. 65 claims → 64 `single-source`,
convergence 3–8%, every entry `disputed`. A measurement artifact, not disagreement.

## Shipped
- **Lexical matcher rewritten** (`claimsMatch`): containment |A∩B|/min(|A|,|B|)
  ≥ 0.75 over normalised tokens (stopwords, NOI/GDP/cap-rate/AI/USA/% canon,
  light stemming), min 5 content tokens, exact-text short-circuit. Guards:
  numbers must agree, directional antonyms (rose/fell) never merge.
  `tokenizeForSim` / `jaccardSimilarity` untouched (Meeting mode depends on them).
- **AI merge pass** before aggregation: a neutral engine (`pickDecomposer`
  rotation) groups the three writers' claims into same-fact groups
  (`buildEncyclopediaMergePrompt` → strict JSON → `applyMergeGroups`). Every id
  returns exactly once: dropped ids re-added as singletons, invented ids ignored,
  one vote per writer per fact, merge rejected (→ lexical fallback) if it touched
  < 50% of claims or the call fails. Record carries `merge_method: "ai:<id>" | "lexical"`.
  Cost: +1 engine call per entry.
- Console: `[HIVE enc] merge: N claims → M unique via …`.

## Verified
- `test_matcher.js` on the 65 real GDP claims: 65 → 60 unique, 4 groups, guards hold
  (lexical alone is the floor; the AI pass is the real mechanism).
- `test_merge.js`: established 3/3, well-supported 2/3, rose/fell kept apart,
  8 → 5 unique, convergence 0.4, bad merges rejected — PASS.
- `web.test.js`: ALL PASS.

## Not yet
- Live rebuild of the 20 entries (upsert) — after deploy, under the engine lock.
- Entry page UX rewrite in hive-backend (lead paragraph, "17 of 21 agreed (81%)",
  sectioned body, audit trail collapsed, Article JSON-LD).
- Routine drains the request queue first (`HIVE.processOne()`), static file fallback.

# HIVE web 2026.10.11-a — Deep links (DEPLOYED 11.10.26 10:55 ET by Nir, https://754b9e46.hive-ny.pages.dev; alias verified byte-identical, deep link opened live)

Second item of the 10.10 brief audit (`test-results/BRIEF-AUDIT-2026-10-10.md`),
chosen because it is web-only — ships on a deploy, no store cycle — while the
extension lane still waits on the 3.6.6 reload. Extension untouched.

## Shipped: deep links
- URL shape: `https://hive-ny.pages.dev/#q=<question>&mode=manager|meeting|factcheck`.
  **Hash, not query string** — the question never reaches a Cloudflare log or a
  crawler, and it coexists with the `#hive_ext_id` handoff (which strips only its
  own hash). Question clipped at 600 chars.
- **Never auto-runs.** Opening a link prefills the question, selects the mode,
  enters the chat and toasts "press Send". A link that silently pushed an
  arbitrary prompt into the visitor's own ChatGPT / Claude / Gemini accounts
  would be a prompt-injection vector — the brief asked for auto-run; declined on
  purpose. Without the bridge the toast points at HIVE Bridge instead, and Send
  still lands on the existing per-engine diagnostic with the store link.
- New **Link** button on both result cards (Manager synthesis + Meeting
  consensus): copies the deep link, toast confirms. Share records now carry the
  mode (`stashShareRecord({... mode: conductorMode ...})`).
- Share export (`buildShareMarkdown`) gains "Run it across your own AIs: <link>"
  before the signature — the shared artifact now carries the loop back in.
- Helpers: `DEEP_LINK_ORIGIN / DEEP_LINK_MODES / DEEP_LINK_MAX_Q`,
  `modeToDeepLink`, `buildDeepLink`, `parseDeepLink`, `adoptDeepLink` (boot IIFE
  after the stored-ID ping). i18n en + he: `linkCopied`, `linkUnavailable`,
  `deepLinkReady`, `deepLinkNoBridge`.

## Test harness fix (`tools/tests/web.test.js`)
- The 10.10 build's two `application/ld+json` blocks were being parsed as
  JavaScript, so the suite had reported **2 parse failures since 10.10** (the
  10.10 changelog says "parse clean" — it was not run after the JSON-LD landed).
  The block regex now skips ld+json; those blocks are JSON-validated instead.
- 12 new deep-link assertions (round-trip with `&`, mode mapping, cap, handoff
  hashes ignored, bad mode → null, share markdown carries the link). 96/96, ALL PASS.
- Mirror synced byte-identical.

## Still open
- Extension 3.6.6: built 7.10, Nir's browser still answered PING 3.6.5 at 10:30 ET 11.10.
- Indexing: zero results for both domains on Bing / DuckDuckGo (11.10) — nobody
  has submitted the sitemaps. Search Console + Bing Webmaster + IndexNow need
  Nir's Google account and one verification token served by the worker.
- Remote selector config stays the 3.6.7 headline.

---

# HIVE web 2026.10.10-a — Share Comparison + discoverability (DEPLOYED 10.10.26)

Live and verified on the canonical alias: build stamp `2026.10.10-a`, `robots.txt` / `llms.txt` / `sitemap.xml` / `og-image.png` all 200, the canonical sentence present in all five places on the page. Deploy URL https://361579ad.hive-ny.pages.dev. Extension untouched — 3.6.6 zip still waiting on Nir.

Answers an architecture brief Nir brought in (10.10.26). Of its nine items, two
were already shipped, three rest on a wrong premise about the codebase, one is
incremental — and the brief misses the item our own incident history says
matters most. Audit in `test-results/BRIEF-AUDIT-2026-10-10.md`.

## Shipped: Share Comparison
The shareable artifact out of HIVE is not the answer — any single AI gives you
an answer. It is the agreement record: one question, several engines that did
not see each other, and an honest note of where they diverged.

- `SHARE_BUFFER` + `stashShareRecord()` — `renderSynthesis` / `renderConsensus`
  stash the structured record (question, answer, trust, engines that answered)
  and tag the actions row with `data-share-id`. The exporter reads that record
  instead of scraping `innerText`, so the trust data survives into the export.
- `buildShareMarkdown()` — clean Markdown: bolded question (clipped at 300
  chars), the answer, then `**Partial agreement** - Claude, ChatGPT, Gemini`
  with up to three contested points, then the signature
  `_Generated with HIVE - your AIs as one team - https://hive-ny.pages.dev_`.
  Deliberately NOT included: each worker's full text — three full answers is
  ~10K characters, which is not a shareable artifact, and the divergence is
  already distilled in the trust data.
- `copyTextRobust()` — `navigator.clipboard` rejects without a secure context
  or a user gesture in some embeddings; falls back to the textarea path.
- `HIVE.shareSynthesis` is now async: `navigator.share` first (real share sheet
  on ChromeOS/Windows), `AbortError` treated as "user dismissed", not a failure;
  otherwise clipboard + toast. Cards with no stashed record still share their
  plain text, so nothing regressed.
- i18n `sharedCopied` / `shareFailed` in en + he.

Verified: parse clean; builder unit-tested (7 assertions, with-trust and
bare-Meeting shapes); loaded on a local server — zero console errors, handler
is an AsyncFunction, legacy fallback path copies the right text and does not
throw. Mirror synced byte-identical (sha256 a758d6d7…).

## Also in this build: machine-discoverability layer
The site was invisible to AI crawlers - no structured data, no robots.txt, no
llms.txt, one stray og tag. Since a growing share of "what tool should I use"
questions is now answered by an assistant rather than a search page, that is a
closed distribution channel. Added, all inside the same pending deploy:

- `SoftwareApplication` + `FAQPage` JSON-LD (both validated). No
  `aggregateRating` - we have zero ratings and will not invent one.
- Open Graph + Twitter card meta and `og-image.png` (the 1400x560 marquee), so
  the links the new Share export produces unfurl with a picture instead of a
  bare URL.
- `robots.txt` explicitly allowing GPTBot, OAI-SearchBot, ClaudeBot,
  PerplexityBot, Google-Extended, Applebot-Extended, CCBot.
- `llms.txt` - plain-prose description of the three modes, the own-accounts
  moat, privacy, and links into the encyclopedia.
- `sitemap.xml`, a canonical link, and ONE fixed summary sentence reused across
  description / og / llms, so independent sources phrase HIVE identically -
  that consistency is what lets a model repeat the claim confidently.

Positioning kit for the campaign: `marketing/HIVE-POSITIONING-EN.md`.

### Positioning re-centred (same build, after Nir's correction)
The first pass led with cross-checking. That is error-catching, which has been
mid-funnel proof since August, never the headline. The heart of the product is
the CONNECTION: the assistants a person already pays for have never spoken to
each other, and HIVE puts them in one conversation. Rewritten everywhere it is
stated - meta description, og, twitter, JSON-LD `description`, the "What does
HIVE do?" FAQ answer, and the llms.txt summary. All five copies in the page are
now byte-identical, which is the point: a model repeats a claim it has seen
phrased the same way across independent sources. `featureList` now opens with
the connection ("no new account, no API key required") rather than a mode, and
the differentiator FAQ answers with the conversation rather than the critic.

## NOT done, on purpose
- **Nothing was added to the extension.** 3.6.6 is built and waiting on Nir
  (the chatgpt.com 4.10 DOM fix). Piling features onto an unreleased build
  delays the fix users need now.
- The brief's top infra item for us is one it never names: **remote selector
  config**. Three selector breakages in a month (chatgpt 4.10, Claude's
  `.font-claude-response-body`, Gemini's welcome page), each needing a full
  store release. Fetching selectors as DATA (not code — that distinction keeps
  the "no remote code" store declaration true) would cut that to minutes.
  Spec it for the release after 3.6.6 ships.

---

# HIVE 3.6.1 — Changelog (12.9.26, consolidated fix release; stores were on 3.6.0)

Diagnosis that drove this release (ENC-LOG Entry 8, 10.9.26): every encyclopedia
build failed "too many writer failures" although Claude and ChatGPT both wrote
full answers (9,996 / 11,675 chars in the tab). HIVE stopped listening early —
a timing bug, not a selector bug. Two lines: the extension reported Claude
"complete" the instant `data-is-streaming` flipped off (`|| elapsed > 3000`
always true), and the web side's definitive-complete path ignored the caller's
800-char floor and accepted a 606-char fragment.

## Web app (index.html, build 2026.09.12-a)
- **Completion respects the floor** — a "complete" status arriving with less text
  than the caller asked for is treated as a pause, not an answer; polling continues.
- **Below-floor patience is time-based and floor-scaled** — 150s of true quiet for
  long-form callers (encyclopedia writers), 60s for ordinary calls; previously a
  poll count (~30-100s) that ChatGPT's web-search pause alone exceeded.
- **Per-call ceiling is extendable** — encyclopedia writers now wait up to 7 min
  (default stays 5).
- **Meeting mode honesty** — when fewer than two engines actually answer round 1,
  or the discussion round doesn't complete, a notice says so (it used to stop
  silently under a single engine's card).
- **Fact-check dissent block** — the contradiction stage is told to list ONLY
  conflicting evidence (it was filling "Contradictions found" with supporting
  studies); empty dissent fields are hidden instead of rendering "(none)"; the
  falsification placeholder is gone.
- **Tables render** — Markdown pipe-tables in Manager/Meeting answers become real
  tables (they came out as a glued run-on string).
- **Worker trail label** counts engines that actually answered ("2 of 3 workers
  answered"), not failure cards.
- Version chip 3.6.1, build stamp 2026.09.12-a.

## Extension (background.js 3.6.1)
- **Claude completion** — requires genuine text stability (≥15s quiet) instead of
  "attribute off OR 3 seconds elapsed".
- **Gemini stale-answer guard** — the newest response must follow OUR user turn
  (`user-query` text matched against the injected question); a previous
  conversation still rendering at inject time can no longer be returned as the
  answer (NIGHT-LOG Result 4: an Opportunity-Zones article answered a REIT question).
- **Gemini structure-preserving extraction** — a DOM walk re-inserts newlines,
  list markers and " | " between table cells (textContent glued them).
- **Gemini submit** — the hand-proven Quill sequence (write paragraphs, drop
  `ql-blank`, real InputEvent) is tried first; send/stop button search also looks
  inside open shadow roots.

## Not in this release
- Render-on-quorum for the 300s ChatGPT ceiling (design change, no spec yet).
- A per-engine "search/tool in progress" signal (the floor-aware wait covers it).
- Gemini's Flash-Lite / empty-answer state is an account condition, not code.

---

# HIVE 3.6.0 — Changelog (since 3.3, the live store version)

## New features
- **Trust Strip** — every Manager synthesis now ends with a visible trust bar: agreement meter (●●○ full / partial / split), ⚠️ contested-point chips, and 🔍 "Check" chips on key claims. Clicking 🔍 runs the full HIVE Fact-check (3 independent engines + sources) on that claim only. Trust is shown, not explained.
- **Manager selector** — the user can delegate discussion management to a specific engine (Claude / ChatGPT / Gemini / any ready custom engine) or leave it on Auto. Saved per browser.
- **Try without installing** — new wizard in Settings: two free keys (Google AI Studio Gemini + Groq) give a real 3-AI council (Gemini + Llama 3.3 70B + GPT-OSS 120B) with zero extension install, no credit card. Keys tested live before activation; stored only in localStorage. The extension becomes an upgrade (use your real accounts with their memory/files), not a prerequisite.
- **Open my AI tabs for me** — one button opens missing chatgpt.com / gemini / claude.ai tabs in the background.
- **Example question chips** on the empty state — one click fills and sends.

## Reliability (field-reported bugs, all fixed)
- **Verified submit** — the engine relay now confirms a question was actually sent (Stop-button visible or composer emptied), retries the button, then falls back to Enter; scaled submit window up to 30s for long pastes. Fixes silent failures on long questions.
- **Long-answer stability** — answer-completion polling waits longer on long questions (10s stability for >2K chars; 9 stable checks web-side) so long answers are no longer cut mid-stream.
- **Sleeping tabs woken automatically** — Chrome Memory Saver discards background AI tabs; HIVE now detects a discarded tab, reloads it and waits before injecting. Fixes exec_timeout across all engines.
- **Right tab, every time** — when several ChatGPT/Gemini/Claude tabs are open, HIVE probes up to 3 and prefers the actual app tab (/app, /new, /c/); remembers the tab that worked.
- **Gemini "not ready" fixed** — broadened composer detection (textarea, role=textbox, Hebrew aria-labels).
- **90-second timeouts everywhere** — all direct API adapters and the extension proxy now abort cleanly at 90s with a clear error instead of hanging forever.
- **Precise connection diagnostics** — instead of one misleading "No AI engines connected": per-cause messages (no browser / no extension / engine has no tab / tab not signed in / API mode without key), plus a live checklist in Settings. Works extension-free when an API path is configured.
- **Self-healing reports** — an engine failing twice in a row offers a one-click diagnostic report, so site-DOM breakage reaches the developer without user effort.

## Product & growth
- **Bilingual store listing** — extension renamed "HIVE — Your AIs as one team" / "HIVE — הבינות שלך כצוות אחד" via _locales (en + he).
- **One-time review ask** after the 3rd successful run.
- **New-chat control** — exiting a chat forces the next question to open fresh engine conversations.

## Under the hood
- Synthesis prompt emits a machine-readable TRUST_JSON line (agreement / contested / check claims), parsed and stripped before rendering.
- Custom-engine registry powers both the Manager selector and the free-keys wizard; Groq engines are deduped by baseUrl+model on re-activation.

---

# HIVE 3.6.2 — Extension only (13.9.26). Web stays 3.6.1 / 2026.09.12-a.

Driven by NIGHT-LOG Results 7-10 (the same Manager question run four times over two days) and a live DOM probe of claude.ai on 13.9.26.

## Root cause found: the Claude extractor's primary selector no longer exists
`.font-claude-response-body` matches nothing in current claude.ai conversations (0 hits in every message probed). Every extraction since the class vanished fell through to the `<p>`-join fallback, which drops bare `<li>` items, `<h1-4>` headings and every `<table>`. That is why list items came and went between runs (they survive only when Claude wraps an item's text in `<p>`), why headings vanished in Result 10, and why the 3.7.1 "prefer the container when 1.3x longer" fix never fired — it lived inside the dead branch.

## Changes (background.js)
- **Claude extraction walks the cleaned container** (`domToText`) as the primary path; the legacy class/paragraph paths remain as fallbacks. The clone now also strips `.sr-only` chrome ("Claude responded: …", thinking captions) and tool-use status blocks ("Searched the web" + query). Verified on the Result 9 conversation: 5,239 chars vs 1,990 from the old join; Days 1-5, mistakes 1-3, and the budget table all present; zero leaked chrome.
- **`domToText` emits Markdown the web already renders**: `### ` headings, numbered `1. ` items for `<ol>` (`- ` for `<ul>`), pipe-tables with a separator row. Gemini extraction gets the same structure for free.
- **Claude completion listens to the page's own status** (`aria-live`: "Claude is responding" / "Searching the web" = busy; "Claude finished the response" = done). Result 10 declared a 920-char stub complete at 19s while Claude was mid-search; the real answer was 4,939 chars. Quiet-window fallback raised to 45s once a tool-use block is present (searches chain).
- **Submit verification demands real evidence**: Stop button, a NEW user turn in the transcript, or composer-emptied AND URL moved into a conversation. "Composer emptied" alone false-positived on fresh welcome pages (Result 10: 300s waited on a tab that never left "New chat"). Window 6s → 8s.
- **Tab choice tie-breaks on the tab the user touched last** (then the active tab). With two equally app-like tabs of one engine — the user's own plus the one HIVE opened — the stable sort drove the older tab while the user watched the new one stay blank. Most likely what Result 10 actually was (the user had just opened his own engine tabs alongside the tester's).
- Version 3.6.2. Package: `hive-bridge-3.6.2.zip`.

## Not changed
- ChatGPT extraction still returns citation-chip stubs on search-heavy answers (five runs in a row at the 300s ceiling) — separate issue, not in this release.
- Gemini fresh-welcome-page injection: unchanged here; Result 10 still showed zero Gemini output. Needs its own probe.

## Web app 3.6.2 (index.html, build 2026.09.13-b) — deployed 13.9.26
- **Bridge verdict respected**: the heuristic "stable after" completion no longer fires while the bridge reports streaming unless the text has been quiet for max(floor patience, 90s). Result 11 shipped a 129-char Claude worker stub during a web search with the bridge saying "Searching the web"; Result 12, with the guard, captured the full 4,071-char worker answer.
- **Heading lines render**: `### Title` lines from the bridge's structure-preserving extraction render as a bold block line instead of showing the marker.
- Version chip 3.6.2, build stamp 2026.09.13-b.

## Verification (NIGHT-LOG Results 11-12, 13.9.26)
Q7 (Manager, Japan itinerary) — the question that failed in ten consecutive runs — completed cleanly twice on 3.6.2 + web 3.6.2: plan card, five days, budget heading + table, three mistakes, trust strip. Remaining open items are ChatGPT's citation-stub truncation at the 300s ceiling and Gemini's silent welcome-page failure — both pre-existing, both outside this release.

## Web app 3.6.2 — UX review close-out + Verify resilience (builds 2026.09.13-c/d/e, deployed 13.9.26)
Closes the 24.8.26 UX/UI review (test-results/UX-REVIEW.md is now the standing gate):
- **Settings jargon → human words**: "Engine sources · your tabs or your own key"; per-engine buttons "Your tabs" / "Your key" (HE too); FAQ, privacy and About alt copy follow. "Falsifier" was never user-facing.
- **About step 3** no longer tells users to paste an extension ID from chrome://extensions — it is the toolbar-icon path, matching the connection modal.
- **Stepper carries a time expectation** ("≈ 1 min" / "כדקה"); stepper labels translated.
- **Phone / non-Chromium notice** on the landing, keyed on the user agent (a desktop Chrome without the extension must not see it). Verified with Android-UA emulation.
- **Hebrew toggle re-renders the sources grid** (buttons stayed English before).
- **Fact-check no longer dies with one engine** (Result 14): `runVerify` used `Promise.all`; Gemini's injection `exec_timeout` rejected the whole run and rendered a bare "exec_timeout" card while Claude and ChatGPT had finished. Now all three seats settle, a failed seat retries once on an engine that answered, and only an all-dead panel errors out.

---

# HIVE 3.6.3 — Extension only (13.9.26 evening). Web 3.6.2 / 2026.09.13-f.

## Root cause found: "new response" detection was count-based, and claude.ai virtualises long conversations
NIGHT-LOG Result 15: in Fact-check, Claude's evidence answer was on the page (JSON, verified in-tab) but the bridge reported `no_response` for the full 5 minutes. The tab held 3 `[data-is-streaming]` elements before injection and still 3 after Claude answered — claude.ai unmounts older turns, so `count > countAtInject` can never become true. HIVE keeps ONE rolling conversation per engine by default, so this hit every session after a few turns — and explains earlier unexplained Claude misses.

## Change (background.js)
- `injectFn` stamps every existing response element (`data-hive-seen`) for all three engines; `pollFn`/`extractFn` treat the LAST response element as new iff it carries no stamp. The count comparison remains only as a fallback where stamping failed.
- Version 3.6.3. Package `hive-bridge-3.6.3.zip`.

## Web 2026.09.13-f
- Verify retries only the evidence seat (adversary/contradiction are tolerated empty) — serial retries on one healthy engine made Result 15 a 15-minute run.

## Release
- 14.9.26 — `hive-bridge-3.6.3.zip` uploaded and submitted to the Chrome Web Store (item ihlfiaencagdngolncjkbioknfmeolbl); pending Google review. Edge Add-ons: manual upload pending.

---

# HIVE 3.6.4 — Extension + Web (16.9.26). Web build 2026.09.16-a.

## Root cause found: Gemini's Quill text was wiped by the generic paste path
ENC-LOG Entry 10's controlled 4-cell test proved HIVE's own Gemini injection works inside a conversation (test D) — yet every entry since 3.6.1 failed with `submit_not_confirmed`. Reading `injectFn` with that in hand: the Gemini-specific Quill path (3.6.1) wrote the text, and then the generic "Method 1" paste block — which ran UNCONDITIONALLY — did `selectAll` + `delete` and a synthetic paste Quill ignores. The composer was empty by the time the send button was clicked.

## Changes (background.js)
- **Method 1 paste runs only when nothing is inserted yet** — the Gemini Quill path is no longer undone.
- **Gemini zero-state guard**: before injecting, if the tab sits on the `/app` welcome page (dead for injection — not even real keystrokes submit there), the bridge moves it into a conversation: the last `/app/<id>` URL seen this session, else the first sidebar conversation. Console line: `[HIVE] gemini zero-state → conversation: ok|still on /app`.
- Version 3.6.4. Package `hive-bridge-3.6.4.zip`.

## Web 3.6.4 / 2026.09.16-a
- **Encyclopedia writer prompt for ChatGPT says DO NOT BROWSE.** Six entries in a row (5-10) came back as a 300-450-char stub of citation-chip labels — ChatGPT's search-grounded answer never renders past the citation row in a background tab. The entry needs the model's own knowledge plus citations, so browsing is off for that writer only. Manager/Meeting/Fact-check prompts are unchanged (search freshness is a feature there); the hidden-tab search stall remains open for those modes.
- Version chip 3.6.4.

## Note on the quorum
ENC-LOG Entries 9-10 said "fixing Gemini alone leaves the lane one writer short". That was wrong: `runEncyclopedia` accepts `validEntries >= 0.6 × 3 = 1.8`, i.e. TWO healthy writers of three. Claude + Gemini is enough; the ChatGPT no-browse change is a third.

## Release
- 16.9.26 — Chrome Web Store shows **3.6.3 live** (7 users, no rating yet). 3.6.4 to both stores after one verified encyclopedia run on the reloaded extension. Edge Add-ons: Nir uploads manually (Partner Center).

## 3.6.4 build history (16.9.26) — three builds, only the last is good
- build 1 (11:4x): Method-1 guard + zero-state guard that clicked the sidebar's outer list item — the item does not navigate; Gemini still exec_timeout (ENC-LOG Entry 11).
- build 2 (11:56): anchor-based guard — but the patch dropped `ensureTabAwake()`; every HIVE:INJECT failed with "ensureTabAwake is not defined". Never ran a successful query.
- **build 3 (12:06:53, sha256 67526a59…3769): `ensureTabAwake` restored; `npx eslint@8 --no-eslintrc --env browser,es2022 --global chrome --rule no-undef:error background.js popup.js` added to the packaging step (exit 0).** Direct Gemini test PASSED (NIGHT-LOG Result 18): NEW_CHAT → /app → INJECT ok in 5s → "HIVE-TEST-OK" extracted at 50s.
- Packaging rule from here on: `node --check` + eslint no-undef BEFORE Compress-Archive, every time.


---

# HIVE 3.6.5 — Extension + Web (17.9.26). Web build 2026.09.17-a. Web DEPLOYED 17.9 15:58 ET; extension NOT yet in the stores.

Consolidation release per Nir ("לא על כל שטות לעדכן גרסה"): everything the routine runs, the
QA logs and the first look at the Chrome Web Store dashboard turned up since 3.6.4, in one
package. Built and lint-clean; waiting for Nir's go on the deploy and the store uploads.

## Why this release exists: the install → activation gap
CWS dashboard, 30 days to 16.9.26: **68 installs, 8 uninstalls (net 60), yet ~7 weekly-active
users.** Read together with the code: nothing happened after install (no `onInstalled`), Chrome
hides the icon under the puzzle menu, and the popup's primary action sat third, under an
"advanced" option. Most installers never reached the first run.

## Extension (background.js / popup.html 3.6.5)
- **Welcome tab on install** — `chrome.runtime.onInstalled` (reason `install`) opens
  `https://hive-ny.pages.dev/#hive_ext_id=<id>`, the same one-click connect path the popup uses.
- **Uninstall URL** — `setUninstallURL(".../#uninstalled")`; the web app shows a one-line
  "why did you leave?" strip with a mailto. We had zero signal on the 8 uninstalls.
- **Popup reordered** — "Open HIVE ›" is first; the engine dots follow; "Connect any AI provider"
  is collapsed under "Advanced" (was a full section above the primary button).
- **Claude stale-answer guard** (NIGHT-LOG Result 19: a Hebrew housing question rendered the
  previous run's "Artificial intelligence" encyclopedia paragraph in the CLAUDE panel):
  (a) the same "is the last user turn OUR question" check Gemini has had since 3.6.1, now in
  `pollFn` and `extractFn` for Claude; (b) a content fingerprint of the last pre-existing answer
  taken at inject — the `data-hive-seen` DOM stamp is lost when claude.ai re-mounts a node, the
  fingerprint is not. Extract returns `stale_response_element` / `not_our_turn` instead of the
  old text.
- Version 3.6.5. Package `hive-bridge-3.6.5.zip` (25,152 bytes, sha256
  6179B5A5D913F66D41ED7958B4B5CB12F7E7C121312E642E11EAAC1AC3AA6693). `node --check` + eslint
  no-undef: clean.

## Web 3.6.5 / 2026.09.17-a (index.html; master + mirror synced; NOT deployed)
- **ChatGPT search-stub fallback** — the open "search-grounded answer stalls at the citation
  row in a hidden tab" issue (seven consecutive runs at the 300s ceiling, Results 11-17). When
  ChatGPT's answer comes back as a citation stub (below floor or at the ceiling), `queryEngine`
  asks once more in the SAME conversation with browsing forbidden — a non-search reply renders
  in seconds in the same hidden tab (Result 16). First attempt still searches (freshness).
  Console: `[HIVE] chatgpt search-stub (N chars) — re-asking without browsing`.
- **Explicit enumerations land in `must`** — "the three mistakes", "five clauses",
  "שלושה כללי אצבע" are added to the answer contract in code (`augmentContractFromQuestion`),
  so the checker can notice when they are skipped (Result 9 passed without the three mistakes).
  Counts of 3+ only; time/money units and "more/other …" excluded.
- **Version tooltip finally shows the bridge** — the silent ping on load (the path that actually
  connects) now sets `bridgeVersion`; open since 13.9.
- **`#uninstalled` strip** (see extension).
- Version chip 3.6.5, build stamp 2026.09.17-a.

## Routine (`hive-routine/SKILL.md`) and tooling
- Part B runs only 22:00-08:59 local; any other firing does the store check and exits (a 15:17
  firing on 17.9 lost its HIVE tab mid-run — Nir was at the keyboard).
- QA picker keys on a `Q<N>` token in Result headings, not the Result number (Results 8-18 are
  re-runs of Q7/Q9/Q10, which made the picker skip Q8, Q11-Q18). New headings carry the token.
- PushNotification must be loaded via ToolSearch before use (the 3.6.3 go-live produced no push).
- `store-monitor.sh`: comment that `chrome_users` is weekly-active, not installs.

## Not in this release
- ChromeOS = 41% of installs / US = 94% — looks like managed (school/enterprise) devices, not
  organic; nothing to code, worth watching.
- Hebrew About/FAQ/privacy panes (UX-REVIEW follow-up) — translation, not a fix.

## Verification still owed before the stores
1. Reload the unpacked extension → PING returns 3.6.5.
2. Deploy web (`npx wrangler pages deploy . --project-name=hive-ny --branch=main` from
   `hive-web-deploy/`) → chip 3.6.5 / stamp 2026.09.17-a, tooltip shows "Bridge 3.6.5".
3. Re-run Q19 (Meeting, Hebrew) — the CLAUDE panel must not show the old AI paragraph.
4. One Manager question that triggers ChatGPT search — look for the "re-asking without
   browsing" line and a full ChatGPT card.
5. UX gate §3 in an extension-less browser; §4 on the pair going to the stores.

---

# HIVE 3.6.5 — release audit, 18.9.26 (same version number: 3.6.5 was never uploaded)

Nir, 18.9: "before 3.6.5 goes up, make sure every fix is in and ready — I don't want to find
another bug in two days." Three multi-agent passes over the release candidate (7-dimension
audit → adversarial review of the patches → final gate), every finding re-checked by a
second agent. No blocker; six real defects fixed; the review of the FIRST round of patches
found defects in those patches too, which is why there were three passes. Final gate:
GO-WITH-NOTES ×3, nothing blocks the store upload.

New package: `hive-bridge-3.6.5.zip`, 26,929 bytes, sha256
1161CBD403FDC358FC9906E62F6DB76083427062A06EA0BC749A7BBC3C030D0B (third build of the day: the
live gate found one more bug after the reviews — see "Empty Claude answer" below). Forward-slash entry names
(PowerShell's Compress-Archive wrote backslashes since 3.6.1 — against the zip spec; built
with python zipfile now). Permissions identical to 3.6.3 → no re-approval on update.
The 17.9 package (sha 6179B5A5…) is superseded — do not upload it.

## Extension (background.js)
- **Claude "old answer" fingerprint no longer rejects a genuine identical answer.** 3.6.5's
  content fingerprint made a repeated question with a deterministic reply (Test engines run
  twice) time out at 75s. Now a fingerprint match counts as OURS only on positive evidence:
  the last user turn is new since inject (user turns are stamped too), carries our question,
  precedes the candidate, AND the page holds one MORE copy of that text than at inject
  (`_hiveFpCountAtInject`) with an older copy before our turn. Why so strict: every HIVE panel
  prompt opens with the same "[HIVE context: …" frame, so the question-head test cannot tell
  two HIVE questions apart — the first version of this patch reopened the Result-19 stale
  read and the patch review caught it. Every failure mode of the final rule is a 75s timeout,
  never a wrong answer.
- **Gemini zero-state guard works for a second Google account.** `/u/<n>/app` matched neither
  regex, so the 3.6.4 fix never ran for those users. The guard now also never crosses
  accounts (remembered conversation / root-absolute sidebar href from another account).
- **Empty Claude answer no longer comes back as HIVE's own prompt or as the previous answer**
  (found by the LIVE gate, not by the reviews — NIGHT-LOG Result 26). When Claude's turn holds
  no text (it searched the web and stopped: usage limit), extractFn fell through to page-wide
  fallbacks: `.whitespace-pre-wrap` is the USER message's paragraph class on claude.ai, so HIVE
  reported the tail of its own prompt as Claude's answer; with an earlier turn in the
  conversation `[data-is-streaming] p` returned the PREVIOUS answer instead. Present in 3.6.0 and
  in the store's 3.6.3. An empty new container now means `empty_response_element`, nothing else.
- Known, accepted: a repeated question whose alphanumeric head is under 12 chars still takes
  the 75s timeout (safe direction; HIVE's own prompts are never that short).

## Web (index.html, build 2026.09.18-a — NOT deployed yet)
- **ChatGPT no-browse re-ask: removed at the 300s ceiling**, capped at 120s (240s for
  long-form callers) where it remains. It fired in Results 21 and 22 and both times cost a
  second 300s for nothing (runs of 10-12 min). A citation row at the ceiling is now an
  honest `no_response` ("2 of 3") instead of being fed to the synthesis as ChatGPT's view.
- **Short answers can complete** (`opts.shortOk`): "Contribute to Encyclopedia" could never
  succeed through the tabs — the subject ("Iron Dome", 9 chars) sat under every floor, waited
  300s and was then discarded as a stub; "Test engines" had the same fate with "OK" and
  reported three healthy engines as broken after 5 minutes. Guards: a truncated/first-word
  fragment is never used as a public subject; Test engines passes only on the sentence it
  asked for and otherwise says "stalled / partial answer".
- **Planner stall**: the legitimate ~100-char "SKIP … CONTRACT {…}" reply sat under the
  120 floor → "Planning…" for the full 300s on every such turn (`minAnswerLenExact: 40`,
  with a closed-CONTRACT / 10s-quiet requirement so half a plan is not accepted).
- **Enumeration detector**: quantities are no longer must-items ("5 bedroom", "10 employees",
  "שלוש שנים", "ארבעה חדרים"); Hebrew word boundary ("חשש", "מעשר"); one-letter prefixes
  kept ("בשלושה שלבים"); "Give me 7 tips" / "List 5 red flags" kept; regex lastIndex rewind.
- `#uninstalled` Hebrew strip `dir="rtl"` (from 17.9, never deployed) goes out with this build.

## Tests (new, `tools/tests/`, see README there)
Real code, not copies: the harnesses slice `pollFn` / `extractFn` / the inject-state block out
of background.js and run them against a synthetic claude.ai DOM (jsdom); the web suite slices
`bridge.queryEngine` out of index.html and drives it with a fake bridge and a fast-forward
clock. 48 web checks + three extension scenario sets (author S1-S6, adversarial R-set, gate
G-set), all behaving as intended on the final files (R8 is the known accepted miss); the
same web suite fails 15 checks on the live 17-b build. Packaging rule from here on:
`node --check` + eslint no-undef + these suites BEFORE zipping, and zip with python.

## Live gate (§4) on the 17.9 build, before the patches
Meeting OK (Result 20), Manager OK (Result 21), Fact-check OK (Result 22, 18.9) — all DEGRADED
on ChatGPT and slow (10-12 min) because of the re-ask this audit removed.
**Still owed on the FINAL build:** reload the unpacked extension → PING 3.6.5 → one run per
mode. The extension patches have run in jsdom only, never in a real browser.

## Open — decisions / next release
- Gemini: on a `/app` zero-state tab HIVE moves into the user's most recent PERSONAL
  conversation and asks there, and "New chat" never yields a fresh Gemini chat. Consistent
  with how HIVE uses whatever conversation is open in ChatGPT/Claude, but it navigates the
  tab. Worth re-testing whether `/app` is dead only in a HIDDEN tab (ENC-LOG Entry 10 ran in
  a harness tab) — if so the guard can go.
- ChatGPT long answers stall in a hidden tab (Results 20-22: three runs, zero ChatGPT
  output). Root cause is Chrome's background-tab throttling; needs an extension-side answer
  (visible mini-window / keep-alive), 3.6.6. The stepper still says "≈ 1 min".
- Edge Add-ons: a 3.6.4 update has sat "In draft" since 16.9 — never submitted. Replace its
  package with this 3.6.5 zip and press Publish. After Edge serves 3.6.5, point Edge users at
  the Edge listing (install + review links are hard-coded to the Chrome Web Store today).
- Minor, pre-existing: engine-tab matching is a URL substring test; `#hive_ext_id` is stored
  before a ping confirms it; 2-3-char subjects ("UN") are under the extension's extract floor.

## 19.9.26 — live gate on the FINAL pair (extension 4th build sha 1161CBD4… + web 2026.09.18-a, deployed 19.9 10:26 ET)
- **Test engines ×2:** 3/3 working in 54s, then 3/3 in 16s (Result 27) — could not pass at all before.
- **Fact-check:** OK, ALL THREE engines, ~3 min (Result 28; 10 min on the old pair). First full ChatGPT answer in six live runs — its tab was fresh (opened ~5 min earlier).
- **Manager:** OK, 2 of 3, ~8 min (Result 29). New ceiling behaviour confirmed live: `chatgpt ceiling text is a stub (280 chars) — reporting no_response`, no second injection, synthesis starts the same second.
- **Meeting (Hebrew):** consensus with all three engines, but a FALSE "SHORT OF WHAT YOU ASKED" banner (Result 30): the planner's PROCESS musts ("דיון בין עמדות מנוגדות", "הכרעת עמדה סופית") are matched word-for-word by `missingMusts` and fail on Hebrew inflection + English section labels. Pre-existing, web-only.
  → **Fix in master/mirror, build 2026.09.19-a, NOT deployed:** `dropProcessMusts` — Meeting drops discussion/position/decision-type musts before the brief and the check; content musts stay. 8 new checks in `tools/tests/web.test.js` (56 total, all green).
- Extension: no change since the 18.9 evening build. **Extension side of the gate is GREEN** — every extension fix ran in a real browser (Results 23, 27-30), no stale read, no prompt leak.
- Next, web-only (no store review): render-on-quorum — once 2 of 3 workers are in, give the third ~60-90s instead of the full 300s. That single ceiling is now the whole difference between a 3-minute and an 8-minute run.

## 20.9.26 — web build 2026.09.20-a (master + mirror; NOT deployed). Extension unchanged.
Two web-only changes, both driven by the 19.9 live gate. Reviewed twice by independent agents:
the FIRST version got a NO-GO and was reworked; the rework passed a final gate (GO-WITH-NOTES ×2,
nothing blocking) and the gate's follow-ups are in.

**1. Render-on-quorum** — a three-engine fan-out no longer waits the full 300s for one stalled
engine. `makeQuorum` / `quorumNoteOk`: when n-1 of n (n>=3) have answered, the rest get until
max(now+60s, fan-out start+150s). At that deadline an engine is released ONLY if it is not
provably working: status "streaming"/"unknown", or (Claude/Gemini) a provisional text under the
floor, buys up to 90s more; a ChatGPT sitting on a static citation row does not (that is the
stall signature of Results 21-29), a ChatGPT with no text or under 20 chars does. After that,
release needs 90s (working) / 45s (other) without text growth. A release with nothing usable is
an honest `no_response`, never a fragment. Applied to queryAllSilently, queryAllAndRender(
Grounded), Meeting round 2 and the Fact-check seats (three distinct engines only). Manager tries
cleanly-finished engines as lead before one whose own seat failed or was cut.
Replay of the logged runs on a virtual clock (real queryEngine + queryAllSilently): every run
where ChatGPT stalled ends its wait at 150-190s instead of 300s (R21, R22, R24, R25, R29); R28
and R30, where ChatGPT answered, are identical to live. Known, accepted trade-offs: a ChatGPT
that sits >90s on a citation row and THEN recovers after the deadline is lost (no live run ever
showed that); an engine silent for more than deadline+90s (~4 min) is released; once the quorum
is reached a silent ChatGPT is not re-asked (the re-ask never recovered anything in the logs).
Also: a static ChatGPT citation row of 120-400 chars is no longer accepted as a finished answer
by the quiet-text rule (live returns it as ChatGPT's view); bulleted / "label: value" answers
are exempt.

**2. Meeting: process requirements are skipped in the CHECK only** (Result 30's false "SHORT OF
WHAT YOU ASKED"). The engines still get every must in their brief. `dropProcessMusts` skips a
must only when NOTHING substantive is left after removing process phrases + filler words — so
"final answer in US dollars" / "עמדת בנק ישראל" stay checked. Fuzz on both reviewers' lists:
0/144 content musts skipped, 3/76 process musts still checked.

Tests: `tools/tests/web.test.js` — 76 checks, incl. three concurrent engines on a virtual clock.
Still owed: a live run of the three modes on 20-a after the deploy (none of this has run in a
real browser).

## 20.9.26 evening — SHIPPED
- **Chrome Web Store: 3.6.5 submitted** (upload SUCCESS, publish OK; API shows crxVersion 3.6.5 → Google review → auto-publish). Zip sha256 1161CBD4…0D0B.
- **Web 2026.09.20-a deployed** (https://652952e8.hive-ny.pages.dev; live == master byte for byte) and verified LIVE in all three modes (NIGHT-LOG Results 31-33): the stalled ChatGPT is released at ~180s instead of 300s (600s on 17-b); Meeting 12.4 → 6.4 min with no false banner; Fact-check 10 → 3.1 min; Manager 8 → 7.0 min (one repair pass, see below).
- **Edge: Nir's manual step** — Partner Center tab opened on the product's packages page (sign-in required); replace the 3.6.4 draft package with the 3.6.5 zip and press Publish.
- Next, web-only: `missingMusts` literal word matching still costs repair passes on good answers (Result 32: "budget figures in US dollars" vs a "$" budget) — needs synonym/symbol awareness or an LLM check; the stepper's "≈ 1 min"; the ChatGPT hidden-tab stall itself (3.6.6, extension side).

# 3.6.6 — ChatGPT reads again (7.10.26, Nir's session; built, NOT in stores, web NOT deployed)

## Root cause: chatgpt.com shipped a new DOM on 4.10.26 and poll/extract were never updated
NIGHT-LOG Result 37 found it; the 4.10 session started the fix in `background.js` (VERSION
"3.6.6", new composer selectors, the new assistant selector in injectFn's stamping, the
anchor scan) but stopped there: `pollFn` and `extractFn` still queried only
`[data-message-author-role="assistant"]`, which matches **0 elements** on today's chatgpt.com.
So every call since 4.10 went: inject OK → conversation created → ChatGPT answers in full →
poll sees no new element → `timeout` at 90s → `no_response` → the no-browse re-ask → the same
again. 25 of 25 encyclopedia entries and all QA runs 5-7.10 ran on two engines. The
"hidden-tab stall" of 3.6.5's Open list was this, at least since 4.10.

Live DOM, probed 7.10.26 in a real conversation (5 turns): `[data-message-author-role]` 0,
`.markdown` 0, `.prose` 0, `article` 0, `<main>` holds a 63-char zero-state. The answer is
`[data-content-search-unit-key$=":assistant"]` (5) > `div.group` > `DIV.MarkdownRoot-*`
`[data-markdown-text-style]` (1,831 of the unit's 1,846 chars) > `P.Paragraph-*`; the user turn
is `…:user`; the turn wrapper carries `data-talvt-turn-state="complete"` once done; the
composer is `form .ProseMirror[contenteditable]` (2), `#prompt-textarea` 0, no send/stop testids
while idle.

## Changes (background.js)
- `pollFn` / `extractFn` (chatgpt): response = `[data-message-author-role="assistant"],
  [data-content-search-unit-key$=":assistant"]`; body = `.markdown:not(.result-thinking),
  [class*="MarkdownRoot"], [data-markdown-text-style]`. Old selectors stay as fallbacks (C4).
- `extractFn` walks the body with `domToText` (as Claude does) so lists/tables/headings survive;
  innerText fallback. Gets a profile parameter like pollFn (defaults apply — the web app does not
  send profiles yet; the handlers still call `[engineId]` only).
- `pollFn`: `data-talvt-turn-state` ≠ "complete" counts as busy while the text is < 30s quiet —
  a renamed state can never hold a call past 30s (C3).
- manifest 3.6.6. Permissions identical to the shipped 3.6.5 (verified against the zip) → no
  re-approval on update.
- New suite `tools/tests/chatgpt-layout.test.js` (C1-C5): the live case, the 90s timeout, the
  turn-state rule, the old layout, five finished units on the page. All suites green
  (adversarial R8 = known accepted miss); `node --check` + eslint no-undef clean.

## Web (index.html, build 2026.10.07-a — master + mirror synced; NOT deployed)
- `extractTrust`: the Manager's `TRUST_JSON` line leaked into the synthesis card (Results 42, 44)
  because the regex demanded the JSON be the very last thing in the text; a code-block language
  label ("json"), a fence or a closing remark broke it. Now: last marker anywhere, balanced-brace
  object, stripped whether or not it parses; text after it survives. 8 checks in web.test.js.
- `aggregatePOK`: `subject_can_shape_record` / `power_asymmetry: "high"` no longer set the
  provenance flag on their own — a Suez Canal trade statistic (Result 41) and a Passive House
  figure (Result 43) were capped to "Only self-reported" over independent sources. They cap only
  when NO independent source supports the claim; they stay as heads-ups. The orbit-only rule and
  the in-page self-tests (d)/(3) are unchanged.

## Still open
- The "contested" label on every entry (25 of 25 since 1.10) — decision, not a bug.
- Edge Add-ons manual upload; the stepper's "≈ 1 min"; `missingMusts` literal matching.
- Profiles-from-the-web (PROFILE_KEYS) is wired on the extension side only; the handlers do not
  pass them yet and the web app does not send them. Finish or remove before 3.6.7.
