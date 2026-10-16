// Runs the REAL pollFn / extractFn (and the real inject-time state block) from a
// background.js against a synthetic chatgpt.com-shaped DOM — the layout the site
// shipped on 4.10.26 (NIGHT-LOG Results 37-44; probed live 7.10.26):
//   div[data-turn-key] > div[data-talvt-turn-state] > …
//     > div[data-content-search-unit-key="fallback-turn-N:2:assistant"]
//       > div.group > div.MarkdownRoot-xxxx[data-markdown-text-style] > p.Paragraph-xxxx
// No [data-message-author-role], no .markdown / .prose, answer outside <main>.
// Usage: node chatgpt-layout.test.js <path-to-background.js>
const fs = require("fs");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const SRC = fs.readFileSync(process.argv[2], "utf8");

function sliceFn(name) {
  const start = SRC.indexOf("\nfunction " + name + "(");
  if (start < 0) throw new Error("no " + name);
  const rest = SRC.slice(start + 1);
  const m = rest.slice(10).search(/\n(async function |function |const |let |\/\/ ── )/);
  return rest.slice(0, m + 10);
}
const pollSrc = sliceFn("pollFn");
const extractSrc = sliceFn("extractFn");
const injAll = sliceFn("injectFn");
const a = injAll.indexOf("// Store state for polling");
const bMarker = "const pathAtInject = location.pathname;";
const b = injAll.indexOf(bMarker);
if (a < 0 || b < 0) throw new Error("inject state block markers not found");
let tail = injAll.slice(b + bMarker.length);
const stampEnd = tail.indexOf("\n\n");
const injectStateSrc = "function injectState(question, platform) {\n" + injAll.slice(a, b + bMarker.length) + tail.slice(0, stampEnd) + "\n}";

function makePage(opts) {
  opts = opts || {};
  const dom = new JSDOM("<!doctype html><body><main>Where should we begin?</main><div id=thread></div><form><div class='ProseMirror' contenteditable='true'></div></form></body>", { url: "https://chatgpt.com/c/abc" });
  const w = dom.window;
  Object.defineProperty(w.HTMLElement.prototype, "innerText", { configurable: true, get() { return this.textContent; }, set(v) { this.textContent = v; } });
  const ctx = vm.createContext({
    window: w, document: w.document, location: w.location, Node: w.Node, NodeFilter: w.NodeFilter, Event: w.Event,
    console, Date, Math, JSON, String, Object, Array, RegExp, Promise, Set, setTimeout, clearTimeout,
    getComputedStyle: w.getComputedStyle.bind(w),
  });
  vm.runInContext(pollSrc + "\n" + extractSrc + "\n" + injectStateSrc, ctx);
  const thread = w.document.getElementById("thread");
  let turnNo = 0;
  const api = {
    w, ctx,
    // new layout (4.10.26)
    user(text) {
      const t = w.document.createElement("div"); t.setAttribute("data-turn-key", "t" + turnNo);
      const u = w.document.createElement("div"); u.setAttribute("data-content-search-unit-key", "fallback-turn-" + turnNo + ":0:user"); u.textContent = text;
      t.appendChild(u); thread.appendChild(t); return u;
    },
    answer(paras, state) {
      const t = w.document.createElement("div"); t.setAttribute("data-turn-key", "a" + turnNo);
      const st = w.document.createElement("div"); st.setAttribute("data-talvt-turn-state", state || "complete");
      const unit = w.document.createElement("div"); unit.setAttribute("data-content-search-unit-key", "fallback-turn-" + turnNo + ":2:assistant");
      const grp = w.document.createElement("div"); grp.className = "group";
      const root = w.document.createElement("div"); root.className = "MarkdownRoot-rZKhxa"; root.setAttribute("data-markdown-text-style", "");
      for (const p of [].concat(paras)) { const el = w.document.createElement(p.startsWith("- ") ? "li" : "p"); el.className = "Paragraph-abc"; el.textContent = p.replace(/^- /, ""); root.appendChild(el); }
      grp.appendChild(root); unit.appendChild(grp); st.appendChild(unit); t.appendChild(st); thread.appendChild(t);
      turnNo++;
      return { turn: t, state: st, unit, root };
    },
    // old layout (pre-4.10) — must keep working
    oldAnswer(text) {
      const m = w.document.createElement("div"); m.setAttribute("data-message-author-role", "assistant");
      const md = w.document.createElement("div"); md.className = "markdown prose"; const p = w.document.createElement("p"); p.textContent = text; md.appendChild(p); m.appendChild(md); thread.appendChild(m); return m;
    },
    inject(q) { vm.runInContext("injectState", ctx)(q, "chatgpt"); },
    age(ms) { w._hiveInjectTime = Date.now() - ms; },
    quiet(ms) { w._hiveLastGrowthTime = Date.now() - ms; },
    poll() { return vm.runInContext("pollFn", ctx)("chatgpt"); },
    extract() { return vm.runInContext("extractFn", ctx)("chatgpt"); },
  };
  return api;
}

const Q = "What are the five most important clauses in a construction contract, ranked?";
const ANS = ["Here are the five clauses, ranked:", "- Scope of work", "- Price and payment terms", "- Schedule and delay damages", "- Change orders", "- Warranties and defects liability"];
let fails = 0;
function check(name, cond, got) { console.log((cond ? "PASS" : "FAIL") + "  " + name + (cond ? "" : "   got=" + JSON.stringify(got))); if (!cond) fails++; }

// C1 — the field case: a previous answer on the page, we inject, ChatGPT answers in the new layout.
{
  const p = makePage();
  p.user("Earlier question"); p.answer("Earlier answer about something else entirely.");
  p.inject(Q);
  p.age(10000);
  let po = p.poll(), ex = p.extract();
  check("C1 before the answer: poll waits (streaming), extract refuses", po.status === "streaming" && ex && !ex.response, { po, ex });
  p.user(Q); p.answer(ANS, "complete");
  p.age(12000);
  p.poll(); // first sample records the text length (growth tracker)
  p.quiet(9000);
  po = p.poll(); ex = p.extract();
  check("C1 new-layout answer: poll reports complete", po.status === "complete", po);
  check("C1 extract returns the MarkdownRoot text", ex && ex.response && ex.response.includes("Scope of work") && ex.response.includes("Warranties"), ex);
  check("C1 extract keeps list structure (domToText)", ex && /\n- Scope of work/.test(ex.response), ex && ex.response);
  check("C1 extract does not return the main zero-state", ex && !/Where should we begin/.test(ex.response), ex);
}
// C2 — no new turn ever appears → honest timeout at 90s (unchanged behaviour).
{
  const p = makePage();
  p.user("Earlier question"); p.answer("Earlier answer about something else entirely.");
  p.inject(Q);
  p.age(95000);
  const po = p.poll(), ex = p.extract();
  check("C2 no new turn at 95s: poll says timeout", po.status === "timeout", po);
  check("C2 extract refuses the stamped old answer", ex && !ex.response, ex);
}
// C3 — turn state says it is still working: poll waits while the text is fresh…
{
  const p = makePage();
  p.inject(Q);
  p.user(Q); const t = p.answer(["Here are the five clauses, ranked:"], "in_progress");
  p.age(12000);
  p.poll(); p.quiet(9000);
  let po = p.poll();
  check("C3 turn state in_progress, text 9s quiet: poll still streaming", po.status === "streaming", po);
  // …but an unknown/renamed state cannot hold us past 30s of quiet
  p.age(50000); p.quiet(40000);
  po = p.poll();
  check("C3 turn state in_progress but 40s quiet: falls back to the old heuristics (complete)", po.status === "complete", po);
  t.state.setAttribute("data-talvt-turn-state", "complete");
  p.quiet(6000);
  po = p.poll();
  check("C3 turn state complete: complete", po.status === "complete", po);
}
// C4 — the OLD layout still works (selectors are additive).
{
  const p = makePage();
  p.oldAnswer("Earlier answer in the old layout.");
  p.inject(Q);
  p.age(12000); p.quiet(9000);
  let ex = p.extract();
  check("C4 old layout, stamped old answer refused", ex && !ex.response, ex);
  p.oldAnswer("1. Scope of work. 2. Price. 3. Schedule. 4. Change orders. 5. Warranties.");
  p.poll(); p.quiet(9000);
  const po = p.poll(); ex = p.extract();
  check("C4 old layout new answer: poll complete + extract returns it", po.status === "complete" && ex && ex.response && ex.response.includes("Scope of work"), { po, ex });
}
// C5 — the 4.10 page as probed live: FIVE finished assistant units already there, none is ours.
{
  const p = makePage();
  for (let i = 0; i < 5; i++) { p.user("old q " + i); p.answer("old answer " + i + " with enough text to be a real answer in the thread."); }
  p.inject(Q);
  p.age(20000);
  const po = p.poll(), ex = p.extract();
  check("C5 five stamped units, nothing new: poll streaming, extract refuses", po.status === "streaming" && ex && !ex.response, { po, ex });
}

console.log(fails ? "\nFAILED " + fails : "\nALL PASS");
process.exit(fails ? 1 : 0);
