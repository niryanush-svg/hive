// Release tests for the web app: parse-check + the REAL functions extracted from index.html,
// including bridge.queryEngine driven by a fake bridge and a fast-forward clock.
// Usage (from hive-web-deploy): node web-test2.js [index.html]
const fs = require("fs"), vm = require("vm");
const html = fs.readFileSync(process.argv[2] || "index.html", "utf8");
let parseFail = 0;
// JS blocks only: the 10.10 build added two application/ld+json blocks, which are data, not script.
const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*\btype=["']?application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
const ldBlocks = [...html.matchAll(/<script[^>]*\btype=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
ldBlocks.forEach((b, i) => { try { JSON.parse(b); } catch (e) { parseFail++; console.log("LD+JSON FAIL", i, e.message); } });
console.log("ld+json blocks:", ldBlocks.length, "(must be 2 since 2026.10.10-a)");
blocks.forEach((b, i) => { try { new vm.Script(b); } catch (e) { parseFail++; console.log("PARSE FAIL", i, e.message); } });
console.log("script blocks:", blocks.length, "parse failures:", parseFail);

// top-level declarations end at the first closing brace in column 0
function grabFn(name) { const i = html.indexOf("\nfunction " + name + "("); if (i < 0) throw new Error("no fn " + name); const e = html.indexOf("\n}", i + 1); return html.slice(i, e + 2); }
function grabConst(name) { const i = html.indexOf("\nconst " + name + " ="); if (i < 0) throw new Error("no const " + name); return html.slice(i, html.indexOf("\n", i + 1)); }
function grabBridge() { const i = html.indexOf("\nconst bridge = {"); const e = html.indexOf("\n};", i + 1); return html.slice(i, e + 3); }

let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  got=" + JSON.stringify(got) + " want=" + JSON.stringify(want))); };

// ── pure functions ──
const ctx = vm.createContext({});
vm.runInContext(grabFn("enumerationsInQuestion") + grabFn("looksLikeAnswerStub") + grabFn("looksLikeSearchStub"), ctx);
const E = q => vm.runInContext("enumerationsInQuestion", ctx)(q);
const STUB = (t, s) => vm.runInContext("looksLikeAnswerStub", ctx)(t, s);

eq("Q7 the three mistakes", E("Plan a 5-day first-time trip to Japan for a couple in November: daily itinerary, budget in dollars, and the three mistakes first-timers make."), ["three mistakes first-timers make"]);
eq("Q1 five most important clauses", E("What are the five most important clauses to negotiate in a commercial construction contract, ranked?").length, 1);
eq("top 5 risks", E("Give me the top 5 risks of buying off-plan").length, 1);
eq("#13 Give me 7 tips", E("Give me 7 tips for negotiating rent").length, 1);
eq("#13 List 5 red flags", E("List 5 red flags in a lease").length, 1);
eq("#13 what are 4 signs", E("what are 4 signs of a bad contractor").length, 1);
eq("#15 quantity then enumeration", E("In 5 days five things must be ready: which?").length, 1);
eq("#16 three points restored", E("Summarize the three points of the argument").length, 1);
eq("#16 digit points still quantity", E("The team won by 3 points last night, why?"), []);
eq("HE three rules of thumb", E("תן לי שלושה כללי אצבע להשקעה").length, 1);
eq("HE construct five clauses", E("מהם חמשת הסעיפים החשובים בחוזה בנייה").length, 1);
eq("#14 HE prefix bet", E("הסבר בשלושה שלבים איך לבדוק חוזה").length, 1);
eq("#14 HE prefix vav", E("תן סקירה ושלושה כללי אצבע לחיסכון").length, 1);
const QUANT = [
  ["3 months/5-day", "I have 3 months and a 5-day window to decide"],
  ["5 bedroom", "Is a 5 bedroom house in Austin a good investment for 10 years?"],
  ["10 employees", "We are a company of 10 employees choosing a CRM"],
  ["three million", "Should I invest three million dollars in multifamily?"],
  ["need 4 developers", "we need 4 developers and 2 designers, how to hire?"],
  ["What if 5 tenants", "What if 5 tenants leave at once?"],
  ["HE esrot/maaser", "יש עשרות אפשרויות ומעשר ראשון"],
  ["HE sasson", "שמחה וששון ליהודים"],
  ["HE chashash", "יש לי חשש גדול מהעסקה"],
  ["HE 4 rooms", "האם כדאי לקנות דירת ארבעה חדרים בחיפה"],
  ["HE 3 years", "לחכות שלוש שנים או לקנות עכשיו"],
  ["HE 5 million", "יש לי חמישה מיליון שקל להשקעה"],
  ["HE at six am", "הפגישה בשש בבוקר, מה להכין"],
  ["HE 46 with 3 kids", "בן ארבעים ושש עם שלושה ילדים, איך לחסוך"],
];
for (const [n, q] of QUANT) eq("quantity: " + n, E(q), []);
const t0 = Date.now(); E(("the 5 things ".repeat(900)) + "שלושה כללים ".repeat(200)); eq("10K-char question under 200ms", Date.now() - t0 < 200, true);

eq("stub: Iron Dome default", STUB("Iron Dome"), true);
eq("stub: Iron Dome shortOk", STUB("Iron Dome", true), false);
eq("stub: Central planning shortOk", STUB("Central planning", true), false);
eq("stub: 'Searching the web' shortOk refused", STUB("Searching the web", true), true);
eq("stub: 'Thinking…' shortOk refused", STUB("Thinking…", true), true);
eq("stub: timer shortOk refused", STUB("Thought for 12 seconds", true), true);
eq("stub: citation row shortOk refused", STUB("reuters.com\nbbc.com", true), true);
eq("stub: default caption rule unchanged", STUB("Claude is planning the answer"), true);

// ── Meeting: process musts (live gate 19.9, NIGHT-LOG Result 30) ──
{
  const c2 = vm.createContext({ Object, Array, String, RegExp });
  vm.runInContext(grabConst("PROCESS_MUST_RE") + grabConst("PROCESS_FILLER") + grabFn("dropProcessMusts") + grabFn("missingMusts"), c2);
  const DROP = c => vm.runInContext("dropProcessMusts", c2)(c);
  const MISSING = (t, m) => vm.runInContext("missingMusts", c2)(t, m);
  const r30 = { shape: "decision", count: null, must: ["דיון בין עמדות מנוגדות", "הכרעת עמדה סופית", "אופק זמן 2035"], consensus: false };
  eq("R30 contract: process musts dropped, content must kept", DROP(r30).must, ["אופק זמן 2035"]);
  eq("R25 contract: both process musts dropped", DROP({ shape: "decision", count: null, must: ["דיון מרובה עמדות", "עמדה מוכרעת ומפורשת"], consensus: false }).must, []);
  eq("R20 contract (EN): position dropped, content kept", DROP({ must: ["quantitative data grounding", "explicit stated position", "two-year wait horizon"] }).must, ["quantitative data grounding", "two-year wait horizon"]);
  eq("Manager-style content musts untouched", DROP({ must: ["daily itinerary", "budget in US dollars", "three mistakes first-timers make"] }).must.length, 3);
  eq("null contract passes through", DROP(null), null);
  eq("input contract is not mutated", r30.must.length, 3);
  const card = "MEETING CONSENSUS\nDiscussion: השאלה הייתה האם AI תחליף את רוב עבודות הצווארון הלבן עד 2035. שלושת המנועים הגיעו ל\"לא\".\nPositions:\n- Gemini: לא תהיה החלפה עד אופק זמן 2035.";
  eq("R30 card vs ORIGINAL musts: the false alarm this fixes", MISSING(card, r30.must).length, 2);
  eq("R30 card vs filtered musts: clean", MISSING(card, DROP(r30).must), []);
}

// ── queryEngine with a FAKE bridge and a fast-forward clock ──
async function sim({ id = "chatgpt", script, opts, question = "q" }) {
  let now = 1e9; const injected = [];
  const c = vm.createContext({
    console: { log() {} }, localStorage: { getItem() { return null; } }, chrome: undefined,
    Object, Math, JSON, String, Array, Promise, RegExp,
    Date: { now: () => now },
    setTimeout: (fn, ms) => { now += ms; Promise.resolve().then(fn); },
  });
  vm.runInContext([grabFn("looksLikeSearchStub"), grabConst("NO_BROWSE_RETRY_MS"), grabConst("NO_BROWSE_PREFIX"),
    grabFn("looksLikeAnswerStub"), grabFn("scrubUiArtifacts"), grabBridge(), "globalThis.__bridge = bridge;"].join("\n"), c);
  const b = c.__bridge, start = now;
  b.inject = async (i, q) => { injected.push(q); return { ok: true }; };
  b.poll = async () => script((now - start) / 1000, injected.length).poll;
  b.extract = async () => ({ response: script((now - start) / 1000, injected.length).text });
  b.newChat = async () => ({});
  const r = await b.queryEngine(id, question, false, opts);
  return { r, secs: Math.round((now - start) / 1000), injections: injected.length };
}

(async () => {
  let o;
  const R22 = "{\n\nCongress.gov\nDVIDS\nBulletin of the Atomic Scientists\nCongress.gov\nDefault";
  o = await sim({ script: () => ({ poll: { status: "streaming" }, text: R22 }) });
  eq("ceiling: Result-22 ChatGPT stub -> honest error, ONE injection, ~300s", [!!o.r.error, o.r.response || null, o.injections, o.secs <= 310], [true, null, 1, true]);

  o = await sim({ script: t => ({ poll: { status: t > 8 ? "complete" : "streaming" }, text: t > 6 ? "Iron Dome" : "" }), opts: { shortOk: true, maxWaitMs: 120000 } });
  eq("shortOk: 'Iron Dome' completes fast, not truncated", [o.r.response, o.secs < 30, !!o.r.truncated], ["Iron Dome", true, false]);

  o = await sim({ script: () => ({ poll: { status: "streaming" }, text: "Iron" }), opts: { shortOk: true, maxWaitMs: 120000 } });
  eq("shortOk: stalled first word comes back FLAGGED truncated at the cap", [o.r.truncated === true, o.secs <= 125], [true, true]);

  o = await sim({ script: () => ({ poll: { status: "streaming" }, text: "Searching the web" }), opts: { shortOk: true, maxWaitMs: 90000 } });
  eq("shortOk: caption at the ceiling -> error, never a response", [!!o.r.error, o.r.response || null], [true, null]);

  const plan = 'SKIP: The question is atomic.\nCONTRACT: {"shape":"explanation","count":null,"must":[],"consensus":false}';
  o = await sim({ id: "claude", script: t => ({ poll: { status: t > 4 ? "complete" : "streaming" }, text: t > 3 ? plan : "" }), opts: { minAnswerLenExact: 40 } });
  eq("planner: 104-char SKIP+CONTRACT returns in seconds", [o.r.response === plan, o.secs < 30], [true, true]);

  o = await sim({ id: "claude", script: t => ({ poll: { status: t > 4 ? "complete" : "streaming" }, text: t > 3 ? plan : "" }) });
  eq("default floor unchanged: same reply WITHOUT the opt waits for the ceiling", o.secs >= 295, true);

  o = await sim({ id: "claude", script: t => ({ poll: { status: t > 40 ? "complete" : "streaming" }, text: "A full answer. ".repeat(Math.min(40, Math.max(1, Math.floor(t)))) }) });
  eq("normal long answer unaffected", [!!o.r.response, !o.r.error, o.secs < 120], [true, true, true]);

  o = await sim({ script: (t, inj) => inj === 1 ? { poll: { status: t > 80 ? "timeout" : "streaming" }, text: "" } : { poll: { status: "streaming" }, text: "" } });
  eq("no_response re-ask: exactly ONE retry and it is capped", [o.injections, o.secs <= 215], [2, true]);

  // final-gate cases
  const oneLine = "Buenos dias a todos y bienvenidos";
  o = await sim({ id: "gemini", script: t => ({ poll: { status: t > 6 ? "complete" : "streaming" }, text: t > 4 ? oneLine : "" }) });
  eq("gate#4: FINISHED short one-liner (gemini) still delivered, flagged truncated", [o.r.response, o.r.truncated === true, !o.r.error], [oneLine, true, true]);

  const prose680 = ("Both amazon.com and ebay.com are reasonable places to start, but they differ in fees and buyer protection. ").repeat(6);
  o = await sim({ script: () => ({ poll: { status: "streaming" }, text: prose680 }) });
  eq("gate#10: static 600+ chars of ChatGPT prose naming two sites is kept, not discarded", [!!o.r.response, !o.r.error], [true, true]);
  // …and the ceiling branch itself: text still growing at 300s, so only the ceiling can return it
  o = await sim({ script: t => ({ poll: { status: "streaming" }, text: prose680.slice(0, 400 + Math.min(250, Math.floor(t))) }) });
  eq("gate#10: growing ChatGPT prose at the CEILING is returned truncated, not discarded", [!!o.r.response, o.r.truncated === true, !o.r.error], [true, true, true]);

  const fullPlan = "PLAN:\n1. Compare purchase price against rent for the next two years in the target city.\n2. Check mortgage rate scenarios and the monthly payment under each.\n3. Decide.\nCONTRACT: {\"shape\":\"decision\",\"count\":null,\"must\":[\"rate scenarios\"],\"consensus\":false}";
  o = await sim({ id: "claude", opts: { minAnswerLenExact: 40 },
    script: t => t < 3 ? { poll: { status: "streaming" }, text: "" }
      : t < 9 ? { poll: { status: "complete" }, text: fullPlan.slice(0, 60) }     // 6s "complete" flicker on a fragment
      : { poll: { status: t > 20 ? "complete" : "streaming" }, text: fullPlan } });
  eq("gate#5: planner does NOT accept a 60-char fragment on a 6s complete flicker", o.r.response === fullPlan, true);

  // ── render-on-quorum (20.9): the REAL queryAllSilently + bridge.queryEngine, three engines
  //    running concurrently on one virtual clock (timers fire in due-time order) ──
  async function fanout({ ids, script }) {
    let now = 1e9; const timers = []; const injected = {}; const logs = [];
    const c = vm.createContext({
      console: { log: (...a) => logs.push(a.join(" ")) }, localStorage: { getItem() { return null; } }, chrome: undefined,
      Object, Math, JSON, String, Array, Promise, RegExp, Set,
      Date: { now: () => now },
      setTimeout: (fn, ms) => { timers.push({ at: now + ms, fn }); },
    });
    vm.runInContext([grabFn("looksLikeSearchStub"), grabConst("QUORUM_GRACE_MS"), grabConst("QUORUM_ALIVE_MS"), grabConst("QUORUM_STREAMING_MS"), grabConst("QUORUM_MIN_TOTAL_MS"), grabFn("makeQuorum"), grabFn("quorumNoteOk"),
      grabConst("NO_BROWSE_RETRY_MS"), grabConst("NO_BROWSE_PREFIX"), grabFn("looksLikeAnswerStub"), grabFn("scrubUiArtifacts"), grabBridge(),
      "const engines = { queryEngine: (id, q, n, o) => bridge.queryEngine(id, q, n, o) };",
      html.slice(html.indexOf("\nasync function queryAllSilently("), html.indexOf("\n}", html.indexOf("\nasync function queryAllSilently(")) + 2),
      "globalThis.__bridge = bridge; globalThis.__fan = queryAllSilently;"].join("\n"), c);
    const b = c.__bridge, start = now, T = () => (now - start) / 1000;
    b.inject = async (id) => { injected[id] = (injected[id] || 0) + 1; return { ok: true }; };
    b.poll = async (id) => script(id, T(), injected[id]).poll;
    b.extract = async (id) => ({ response: script(id, T(), injected[id]).text });
    b.newChat = async () => ({});
    let done = false, val;
    c.__fan(ids, "question").then(v => { done = true; val = v; });
    while (!done) {
      await new Promise(r => setImmediate(r));
      if (done) break;
      timers.sort((x, y) => x.at - y.at);
      const t = timers.shift(); if (!t) throw new Error("virtual clock deadlock");
      now = Math.max(now, t.at); t.fn();
    }
    const by = Object.fromEntries(val.map(r => [r.engineId, r]));
    return { by, secs: Math.round(T()), injected, logs };
  }
  const LONG = "A full and finished answer with real sentences in it. ".repeat(12);
  // the stalled-ChatGPT text actually logged in Result 22 (76 chars; under every floor, so only the ceiling or the quorum ends the wait)
  const STUB280 = "{\n\nCongress.gov\nDVIDS\nBulletin of the Atomic Scientists\nCongress.gov\nDefault";
  const doneAt = (s) => (t) => ({ poll: { status: t > s ? "complete" : "streaming" }, text: t > s - 4 ? LONG : "" });

  let f = await fanout({ ids: ["gemini", "claude", "chatgpt"], script: (id, t) =>
    id === "gemini" ? doneAt(38)(t) : id === "claude" ? doneAt(124)(t) : { poll: { status: "streaming" }, text: t > 20 ? STUB280 : "" } });
  eq("quorum R29 shape: 2 answered, stalled ChatGPT released ~60s after the 2nd (not at 300s), one injection",
    [f.by.gemini.ok, f.by.claude.ok, f.by.chatgpt.ok, f.secs >= 180 && f.secs <= 200, f.injected.chatgpt], [true, true, false, true, 1]);

  f = await fanout({ ids: ["gemini", "claude", "chatgpt"], script: (id, t) =>
    id === "gemini" ? doneAt(30)(t) : id === "claude" ? doneAt(60)(t)
      : { poll: { status: t > 250 ? "complete" : "streaming" }, text: LONG.slice(0, Math.min(LONG.length, Math.floor(t) * 3)) } });
  eq("quorum: a slow engine whose text is STILL GROWING is not cut — it finishes with its whole answer", [f.by.chatgpt.ok, (f.by.chatgpt.response || "").length === LONG.trim().length], [true, true]);

  f = await fanout({ ids: ["gemini", "claude"], script: (id, t) =>
    id === "gemini" ? doneAt(30)(t) : { poll: { status: "streaming" }, text: "" } });
  eq("quorum: with only TWO engines nobody is released early (both are needed)", [f.secs >= 295, f.logs.some(l => /quorum:/.test(l))], [true, false]);

  f = await fanout({ ids: ["gemini", "claude", "chatgpt"], script: (id, t) =>
    id === "gemini" ? { poll: { status: t > 80 ? "timeout" : "streaming" }, text: "" } : id === "claude" ? doneAt(40)(t) : doneAt(200)(t) });
  eq("quorum: one engine FAILED + one answered is not a quorum — the third is waited for", [f.by.gemini.ok, f.by.chatgpt.ok, f.secs >= 195], [false, true, true]);

  f = await fanout({ ids: ["gemini", "claude", "chatgpt"], script: (id, t) =>
    id === "gemini" ? doneAt(20)(t) : id === "claude" ? doneAt(50)(t) : { poll: { status: t > 80 ? "timeout" : "streaming" }, text: "" } });
  eq("quorum: once reached, a silent ChatGPT is NOT re-asked (one injection) and the run ends early", [f.injected.chatgpt, f.secs <= 125], [1, true]);

  // ── the cases the 20.9 patch review reproduced against the FIRST quorum version ──
  const ANSWER = "Claude thought for two minutes and then wrote a complete, well structured answer. ".repeat(35).trim();
  // silent thinker: zero text, bridge says "streaming", first word well after the deadline
  for (const first of [126, 140, 170]) {
    f = await fanout({ ids: ["gemini", "chatgpt", "claude"], script: (id, t) =>
      id === "gemini" ? doneAt(30)(t) : id === "chatgpt" ? doneAt(60)(t)
        : { poll: { status: t > first + 30 ? "complete" : "streaming" }, text: t < first ? "" : ANSWER.slice(0, Math.min(ANSWER.length, Math.floor((t - first) * 100))) } });
    eq("review#2: silent-but-streaming Claude, first word at " + first + "s, keeps its WHOLE answer", [f.by.claude.ok, (f.by.claude.response || "").length === ANSWER.length, !f.by.claude.truncated], [true, true, true]);
  }
  // NIGHT-LOG Result 11 shape: 129 chars at 50s, "Searching the web" until 135s, real answer at 180s
  f = await fanout({ ids: ["gemini", "chatgpt", "claude"], script: (id, t) =>
    id === "gemini" ? doneAt(30)(t) : id === "chatgpt" ? doneAt(60)(t)
      : { poll: { status: t > 185 ? "complete" : "streaming" }, text: t < 50 ? "" : t < 135 ? "Let me search for current data on this. I will look at several sources before answering so the figures are right." : ANSWER.slice(0, Math.min(ANSWER.length, Math.floor((t - 135) * 80))) } });
  eq("review#7: Result-11 shape (search pause 85s mid-answer) returns the full answer, not the 113-char preamble", [(f.by.claude.response || "").length === ANSWER.length], [true]);
  // released with nothing captured: an honest error, never a just-started fragment passed off as complete
  f = await fanout({ ids: ["gemini", "claude", "chatgpt"], script: (id, t) =>
    id === "gemini" ? doneAt(30)(t) : id === "claude" ? doneAt(60)(t)
      : { poll: { status: "streaming" }, text: t < 241 ? "" : "Sure. Here is a first sentence that has only just started to appear." } });
  eq("review#1: released with NOTHING captured (text appears 1s later) -> error, never a fragment returned as a complete answer", [f.by.chatgpt.ok, !!f.by.chatgpt.error, f.secs <= 250], [false, true, true]);
  // the Result-24 stall signature: bridge says "complete", extract is empty -> not protected, released at the deadline
  f = await fanout({ ids: ["gemini", "claude", "chatgpt"], script: (id, t) =>
    id === "gemini" ? doneAt(30)(t) : id === "claude" ? doneAt(60)(t) : { poll: { status: t > 90 ? "complete" : "streaming" }, text: "" } });
  eq("R24 shape: ChatGPT 'complete' with EMPTY text is released at the deadline (~150s) with an honest error", [f.by.chatgpt.ok, !!f.by.chatgpt.error, f.secs <= 160], [false, true, true]);
  // API-speed peers: the tab engine still gets its minimum total time
  f = await fanout({ ids: ["gemini", "claude", "chatgpt"], script: (id, t) =>
    id === "gemini" ? doneAt(6)(t) : id === "claude" ? doneAt(9)(t) : doneAt(140)(t) });
  eq("review#8: peers answer in 6s/9s (API speed) — a tab engine finishing at 140s is NOT cut at ~70s", [f.by.chatgpt.ok, !f.by.chatgpt.truncated], [true, true]);
  // …and the stalled-ChatGPT saving is still there
  f = await fanout({ ids: ["gemini", "claude", "chatgpt"], script: (id, t) =>
    id === "gemini" ? doneAt(40)(t) : id === "claude" ? doneAt(118)(t) : { poll: { status: "streaming" }, text: t > 25 ? STUB280 : "" } });
  eq("R25 shape: stalled ChatGPT stub released ~60s after the 2nd answer (≈180s, not 300s+)", [f.by.chatgpt.ok, f.secs >= 172 && f.secs <= 195], [false, true]);

  // a THINKING ChatGPT (no text at all, bridge says streaming) is not a stalled one
  f = await fanout({ ids: ["gemini", "claude", "chatgpt"], script: (id, t) =>
    id === "gemini" ? doneAt(24)(t) : id === "claude" ? doneAt(69)(t)
      : { poll: { status: t > 180 ? "complete" : "streaming" }, text: t < 160 ? "" : ANSWER.slice(0, Math.min(ANSWER.length, Math.floor((t - 160) * 200))) } });
  eq("R28 shape: ChatGPT silent until 160s, done ~177s — kept whole, not released at 150s", [f.by.chatgpt.ok, (f.by.chatgpt.response || "").length === ANSWER.length], [true, true]);
  // a static ChatGPT citation row of 280 chars is never a finished answer (single engine, no quorum involved)
  const ROW280 = ("Japan Meteorological Agency\nJapan Travel\nTokyo Metro\nJR East\nNavitime\nKlook\n").repeat(4).slice(0, 280);
  o = await sim({ script: () => ({ poll: { status: "streaming" }, text: ROW280 }) });
  eq("R29 text: a static 280-char ChatGPT citation row is refused (error), not returned as the answer", [!!o.r.error, o.r.response || null], [true, null]);
  // …while real ChatGPT prose of the same size still comes through
  const PROSE280 = "Book the Shinkansen seats a few days ahead in November. Stay near a major station so day trips are easy. Carry some cash because smaller restaurants and temples often do not take cards. Expect cool evenings and pack layers for Kyoto and Nikko.".slice(0, 280);
  o = await sim({ script: t => ({ poll: { status: t > 30 ? "complete" : "streaming" }, text: PROSE280 }) });
  eq("…and 240 chars of real ChatGPT prose still completes normally", [o.r.response === PROSE280, !o.r.error], [true, true]);

  // ── final-gate cases (20.9 evening) ──
  // the extension reports "complete" during a tool pause: a short preamble is not the answer
  f = await fanout({ ids: ["gemini", "chatgpt", "claude"], script: (id, t) =>
    id === "gemini" ? doneAt(30)(t) : id === "chatgpt" ? doneAt(60)(t)
      : { poll: { status: (t > 85 && t < 170) || t > 200 ? "complete" : "streaming" },
          text: t < 40 ? "" : t < 170 ? "Let me search for current data on this before I answer it." : ANSWER.slice(0, Math.min(ANSWER.length, Math.floor((t - 170) * 120))) } });
  eq("gate#2: Claude on a 58-char preamble with status 'complete' during a search pause keeps its WHOLE answer", [(f.by.claude.response || "").length === ANSWER.length, !f.by.claude.truncated], [true, true]);
  // a poll that cannot run ("unknown") is not evidence of a stall
  f = await fanout({ ids: ["gemini", "chatgpt", "claude"], script: (id, t) =>
    id === "gemini" ? doneAt(30)(t) : id === "chatgpt" ? doneAt(60)(t)
      : { poll: { status: t < 165 ? "unknown" : t > 195 ? "complete" : "streaming" }, text: t < 165 ? "" : ANSWER.slice(0, Math.min(ANSWER.length, Math.floor((t - 165) * 120))) } });
  eq("gate#5: status 'unknown' with no text until 165s is not released at the 150s deadline", [f.by.claude.ok, (f.by.claude.response || "").length === ANSWER.length], [true, true]);
  // the ChatGPT stub guard must not starve a real short bulleted answer
  const STEPS = "Short answer: yes\n- Tokyo: 2 nights\n- Kyoto: 2 nights\n- Osaka: 1 night\n- Rail pass: not worth it\n- Budget: about $3,200 for two";
  o = await sim({ script: () => ({ poll: { status: "streaming" }, text: STEPS }) });
  eq("gate#3: a real 130-char bulleted ChatGPT answer (status streaming) is returned, not starved to the ceiling", [o.r.response === STEPS, o.secs < 200], [true, true]);
  // a must that mixes a process phrase with a content object stays checked
  {
    const c3 = vm.createContext({ Object, Array, String, RegExp });
    vm.runInContext(grabConst("PROCESS_MUST_RE") + grabConst("PROCESS_FILLER") + grabFn("dropProcessMusts"), c3);
    const DROP3 = c => vm.runInContext("dropProcessMusts", c3)(c).must;
    eq("gate#7: mixed musts stay checked, pure process musts are skipped",
      DROP3({ must: ["final answer in US dollars", "the Fed's final decision on rates in 2025", "explicit stated position", "הכרעת עמדה סופית", "עמדת בנק ישראל"] }),
      ["final answer in US dollars", "the Fed's final decision on rates in 2025", "עמדת בנק ישראל"]);
  }

  // ── trust line extraction (7.10.26, NIGHT-LOG Results 42/44: raw TRUST_JSON leaked into the card) ──
  {
    const c4 = vm.createContext({ Object, Array, String, RegExp, JSON });
    vm.runInContext(grabFn("extractTrust"), c4);
    const TR = s => vm.runInContext("extractTrust", c4)(s);
    const BODY = "Mezzanine sits between senior debt and equity.\n✓ Agreement: all three agree on the position in the stack\n⚠ Disagreement: pricing range";
    const J = '{"agreement":"partial","contested":["cap level $5-6M vs $8M"],"check":["mezz typically prices at 10-14%"]}';
    let r = TR(BODY + "\nTRUST_JSON: " + J);
    eq("trust: plain last line parsed and stripped", [r.clean, r.trust && r.trust.agreement], [BODY, "partial"]);
    r = TR(BODY + "\nTRUST_JSON:\njson\n" + J + "\n");
    eq("trust: code-block language label between prefix and brace (Claude/Gemini extractor)", [r.clean, r.trust && r.trust.contested.length], [BODY, 1]);
    r = TR(BODY + "\nTRUST_JSON:\n```json\n" + J + "\n```");
    eq("trust: fenced JSON block stripped with its fences", [r.clean, !!r.trust], [BODY, true]);
    r = TR(BODY + "\nTRUST_JSON: " + J + "\n\nLet me know if you want the glossary expanded.");
    eq("trust: closing remark after the JSON survives, marker + object do not", [r.clean, r.trust && r.trust.check[0]], [BODY + "\nLet me know if you want the glossary expanded.", "mezz typically prices at 10-14%"]);
    r = TR(BODY + "\nTRUST_JSON: {\"agreement\":\"partial\",\"contested\":[\"a } in a string\"],\"check\":[]}");
    eq("trust: braces inside strings do not end the object", r.trust && r.trust.contested[0], "a } in a string");
    r = TR(BODY + "\nTRUST_JSON: {\"agreement\":\"partial\",\"contested\":[");
    eq("trust: truncated JSON is still stripped (no trust)", [r.clean, r.trust], [BODY, null]);
    r = TR(BODY);
    eq("trust: no marker → text untouched", [r.clean, r.trust], [BODY, null]);
    eq("trust: empty / null input", [TR("").clean, TR(null).clean], ["", ""]);
  }

  // ── deep links (web 2026.10.11-a): share link round-trip, never auto-run ──
  {
    const c5 = vm.createContext({ Object, Array, String, RegExp, JSON, URLSearchParams, encodeURIComponent });
    vm.runInContext(grabConst("DEEP_LINK_ORIGIN") + grabConst("DEEP_LINK_MODES") + grabConst("DEEP_LINK_MAX_Q")
      + grabFn("modeToDeepLink") + grabFn("buildDeepLink") + grabFn("parseDeepLink") + grabFn("buildShareMarkdown"), c5);
    const BL = (q, m) => vm.runInContext("buildDeepLink", c5)(q, m);
    const PL = h => vm.runInContext("parseDeepLink", c5)(h);
    const SM = r => vm.runInContext("buildShareMarkdown", c5)(r);
    const Q = "Is drinking coffee daily good or bad for you? & why";
    const link = BL(Q, "conductor");
    eq("deeplink: internal mode maps to manager, origin + hash", link.startsWith("https://hive-ny.pages.dev/#q=") && link.endsWith("&mode=manager"), true);
    eq("deeplink: round-trip keeps the & and the question", PL(new URL(link).hash), { question: Q, mode: "conductor" });
    eq("deeplink: external mode names accepted as-is", BL("x", "factcheck").endsWith("&mode=factcheck"), true);
    eq("deeplink: unknown / missing mode falls back to meeting", [BL("x", "bogus").endsWith("&mode=meeting"), BL("x").endsWith("&mode=meeting")], [true, true]);
    eq("deeplink: empty question → no link", BL("   ", "panel"), "");
    eq("deeplink: question clipped at the cap", new URL(BL("a".repeat(900), "panel")).hash.length < 700, true);
    eq("deeplink: parse ignores the ext-id handoff hash", PL("#hive_ext_id=abcdefghijklmnopabcdefghijklmnop"), null);
    eq("deeplink: parse ignores #uninstalled and empty", [PL("#uninstalled"), PL(""), PL(null)], [null, null, null]);
    eq("deeplink: bad mode in the link → mode null, question kept", PL("#q=hello%20there&mode=evil"), { question: "hello there", mode: null });
    eq("deeplink: whitespace-only q → null", PL("#q=%20%20&mode=meeting"), null);
    const md = SM({ question: Q, answer: "Mostly fine in moderation.", mode: "panel", trust: null, engineNames: ["Claude", "Gemini"] });
    eq("deeplink: share markdown carries the link before the signature",
       md.indexOf("Run it across your own AIs: https://hive-ny.pages.dev/#q=") > 0 && md.indexOf("Run it across") < md.indexOf("_Generated with HIVE"), true);
    eq("deeplink: share markdown without a question has no link line", SM({ question: "", answer: "x", mode: "panel", trust: null, engineNames: [] }).includes("Run it across"), false);
  }

  console.log(fails || parseFail ? "\nFAILED " + (fails + parseFail) : "\nALL PASS");
  process.exit(fails || parseFail ? 1 : 0);
})();
