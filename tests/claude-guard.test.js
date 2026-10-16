// Runs the REAL pollFn / extractFn (and the real inject-time state block) from a
// background.js against a synthetic claude.ai-shaped DOM.
// Usage: node claude-guard.test.js <path-to-background.js>
const fs = require("fs");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const SRC = fs.readFileSync(process.argv[2], "utf8");

// ── pull function sources out of background.js ──
function sliceFn(name) {
  const start = SRC.indexOf("\nfunction " + name + "(");
  if (start < 0) throw new Error("no " + name);
  // next top-level declaration after it
  const rest = SRC.slice(start + 1);
  const m = rest.slice(10).search(/\n(async function |function |const |let |\/\/ ── )/);
  return rest.slice(0, m + 10);
}
const pollSrc = sliceFn("pollFn");
const extractSrc = sliceFn("extractFn");
// the inject-time state block, verbatim
const injAll = sliceFn("injectFn");
const a = injAll.indexOf("// Store state for polling");
const bMarker = "const pathAtInject = location.pathname;";
const b = injAll.indexOf(bMarker);
if (a < 0 || b < 0) throw new Error("inject state block markers not found");
// include everything up to the next blank-line-separated section after pathAtInject
let tail = injAll.slice(b + bMarker.length);
const stampEnd = tail.indexOf("\n\n");
const injectStateSrc = "function injectState(question, platform) {\n" + injAll.slice(a, b + bMarker.length) + tail.slice(0, stampEnd) + "\n}";

function makePage() {
  const dom = new JSDOM("<!doctype html><body><main id=chat></main></body>", { url: "https://claude.ai/chat/abc" });
  const w = dom.window;
  // jsdom has no innerText; a browser does, and several extract fallbacks read ONLY innerText —
  // without this polyfill those paths are silently dead in the harness (S7 could not fail).
  Object.defineProperty(w.HTMLElement.prototype, "innerText", { configurable: true, get() { return this.textContent; }, set(v) { this.textContent = v; } });
  const ctx = vm.createContext({
    window: w, document: w.document, location: w.location, Node: w.Node, Event: w.Event,
    console, Date, Math, JSON, String, Object, Array, RegExp, Promise, setTimeout, clearTimeout,
    getComputedStyle: w.getComputedStyle.bind(w),
  });
  vm.runInContext(pollSrc + "\n" + extractSrc + "\n" + injectStateSrc, ctx);
  const chat = w.document.getElementById("chat");
  const api = {
    w, ctx,
    user(text) { const d = w.document.createElement("div"); d.setAttribute("data-testid", "user-message"); d.textContent = text; chat.appendChild(d); return d; },
    answer(text, streaming) { const wrap = w.document.createElement("div"); wrap.setAttribute("data-is-streaming", streaming ? "true" : "false"); const p = w.document.createElement("p"); p.textContent = text; wrap.appendChild(p); chat.appendChild(wrap); return wrap; },
    remount(el) { const c = el.cloneNode(true); c.removeAttribute("data-hive-seen"); el.replaceWith(c); return c; },
    inject(q) { vm.runInContext("injectState", ctx)(q, "claude"); },
    age(ms) { w._hiveInjectTime = Date.now() - ms; },
    poll() { return vm.runInContext("pollFn", ctx)("claude"); },
    extract() { return vm.runInContext("extractFn", ctx)("claude"); },
  };
  return api;
}

const LONG_Q = "Reply with exactly this sentence and nothing else: HIVE engine test passed.";
const ANS = "HIVE engine test passed.";
const OLD_AI = "Artificial intelligence (AI) is the field of computer science concerned with building systems that perform tasks normally requiring human intelligence.";
let fails = 0;
function check(name, cond, got) { console.log((cond ? "PASS" : "FAIL") + "  " + name + (cond ? "" : "   got=" + JSON.stringify(got))); if (!cond) fails++; }

// S1 — same question asked twice, identical answer on a new node after our new turn.
{
  const p = makePage();
  p.user(LONG_Q); p.answer(ANS);
  p.inject(LONG_Q);
  p.user(LONG_Q); p.answer(ANS);
  p.age(80000);
  const po = p.poll(), ex = p.extract();
  check("S1 repeated question + identical answer: poll is NOT timeout", po.status !== "timeout", po);
  check("S1 extract returns the answer", ex && ex.response && ex.response.includes("HIVE engine test passed"), ex);
}
// S2 — Result 19: our turn rendered, Claude has not answered, OLD answer re-mounted unstamped.
{
  const p = makePage();
  p.user("Write an encyclopedia entry about artificial intelligence, 800 words"); const oldA = p.answer(OLD_AI);
  p.inject("האם כדאי לרוכשי דירה ראשונה בישראל לקנות עכשיו או לחכות שנתיים נהלו דיון");
  p.remount(oldA);
  p.user("האם כדאי לרוכשי דירה ראשונה בישראל לקנות עכשיו או לחכות שנתיים נהלו דיון");
  p.age(80000);
  const po = p.poll(), ex = p.extract();
  check("S2 re-mounted old answer BEFORE our turn: poll refuses (timeout at 80s)", po.status === "timeout", po);
  const p2 = makePage();
  p2.user("Write an encyclopedia entry about artificial intelligence, 800 words"); const oldB = p2.answer(OLD_AI);
  p2.inject("האם כדאי לרוכשי דירה ראשונה בישראל לקנות עכשיו או לחכות שנתיים נהלו דיון");
  p2.remount(oldB);
  p2.user("האם כדאי לרוכשי דירה ראשונה בישראל לקנות עכשיו או לחכות שנתיים נהלו דיון");
  p2.age(10000);
  const ex2 = p2.extract();
  check("S2 extract refuses the old text", ex2 && !ex2.response && /stale_response_element|no_new_response/.test(ex2.error || ""), ex2);
}
// S3 — old answer re-mounted, our turn NOT yet rendered, different question → not ours.
{
  const p = makePage();
  p.user("Write an encyclopedia entry about artificial intelligence, 800 words"); const oldA = p.answer(OLD_AI);
  p.inject("What are the five most important clauses in a construction contract ranked");
  p.remount(oldA);
  p.age(10000);
  const po = p.poll(), ex = p.extract();
  check("S3 re-mounted old answer, our turn missing: poll keeps waiting", po.status === "streaming", po);
  check("S3 extract refuses", ex && !ex.response, ex);
}
// S4 — normal run: different question, different new answer.
{
  const p = makePage();
  p.user("Write an encyclopedia entry about artificial intelligence, 800 words"); p.answer(OLD_AI);
  p.inject("What are the five most important clauses in a construction contract ranked");
  p.user("What are the five most important clauses in a construction contract ranked");
  p.answer("1. Scope of work. The owner wants a fixed, fully specified scope. 2. Price and payment terms. 3. Schedule and delay damages. 4. Change orders. 5. Warranties and defects liability.");
  p.age(80000);
  const po = p.poll(), ex = p.extract();
  check("S4 normal run: poll not timeout", po.status !== "timeout", po);
  check("S4 extract returns the new answer", ex && ex.response && ex.response.includes("Scope of work"), ex);
}
// S5 — identical answer but it sits BEFORE our new turn (old node re-mounted, Claude silent) with the SAME question.
{
  const p = makePage();
  p.user(LONG_Q); const oldA = p.answer(ANS);
  p.inject(LONG_Q);
  p.remount(oldA);
  p.user(LONG_Q); // our new turn, no answer yet
  p.age(10000);
  const po = p.poll(), ex = p.extract();
  check("S5 same question, old identical answer re-mounted before our turn: poll waits", po.status === "streaming", po);
  check("S5 extract refuses", ex && !ex.response, ex);
}
// S6 — stamped user turn is never treated as ours (old turn identical to our question, ours not rendered, old answer re-mounted).
{
  const p = makePage();
  p.user(LONG_Q); const oldA = p.answer(ANS);
  p.inject(LONG_Q);
  p.remount(oldA); // answer lost its stamp, user turn kept it
  p.age(10000);
  const po = p.poll(), ex = p.extract();
  check("S6 old (stamped) identical user turn + re-mounted old answer: poll waits", po.status === "streaming", po);
  check("S6 extract refuses", ex && !ex.response, ex);
}
// S7 — live gate 18.9 (NIGHT-LOG Result 26): Claude searched the web and wrote NOTHING
// (usage limit). The page state, copied from the real conversation: the user message is
// made of <p class="whitespace-pre-wrap"> paragraphs; the new response container holds
// only tool-status chrome. Extract must say "no answer", never the tail of our own prompt
// and never the previous turn's answer.
{
  const p = makePage();
  const doc = p.w.document, chat = doc.getElementById("chat");
  const userMsg = (paras) => { const d = doc.createElement("div"); d.setAttribute("data-testid", "user-message"); for (const t of paras) { const para = doc.createElement("p"); para.className = "whitespace-pre-wrap"; para.textContent = t; d.appendChild(para); } chat.appendChild(d); return d; };
  userMsg(["Earlier question about something else entirely, long enough to be a head."]); p.answer("An earlier, finished answer that must never come back as the new one.");
  const Q = "You are the evidence seat. Claim: Iron Dome intercepts over 90 percent of the rockets it engages.";
  p.inject(Q);
  userMsg([Q, "Return JSON only.", "Do NOT include status, confidence, or a verdict. Evidence only."]);
  const resp = doc.createElement("div"); resp.setAttribute("data-is-streaming", "false");
  for (let i = 0; i < 2; i++) { const blk = doc.createElement("div"); const live = doc.createElement("span"); live.setAttribute("aria-live", "polite"); live.textContent = "Searched the web"; blk.appendChild(live); resp.appendChild(blk); }
  chat.appendChild(resp);
  p.age(60000);
  const ex = p.extract();
  check("S7 empty answer (search only): extract returns NO response", ex && !ex.response, ex);
  check("S7 …and in particular not the tail of our own prompt", !(ex && /Evidence only/.test(ex.response || "")), ex);
  check("S7 …and not the previous turn's answer", !(ex && /earlier, finished answer/.test(ex.response || "")), ex);
}
console.log(fails ? ("\n" + fails + " FAILED") : "\nALL PASS");
process.exit(fails ? 1 : 0);
