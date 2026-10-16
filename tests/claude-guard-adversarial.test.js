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
  const w = dom.window; Object.defineProperty(w.HTMLElement.prototype,"innerText",{get(){return this.textContent;},configurable:true});
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

// ---------- reviewer scenarios ----------
const Q2 = "What are the five most important clauses in a construction contract ranked";
function nestedUser(p, text) { // outer .font-user-message > inner [data-testid=user-message]
  const d = p.w.document, o = d.createElement("div"); o.className = "font-user-message";
  const i = d.createElement("div"); i.setAttribute("data-testid", "user-message"); i.textContent = text; o.appendChild(i);
  d.getElementById("chat").appendChild(o); return o;
}
function verdict(p) {
  p.age(20000); p.poll(); p.w._hiveLastGrowthTime = Date.now() - 60000; const po = p.poll();
  const ex = p.extract();
  return { poll: po.status, extract: ex && ex.response ? "ANSWER:" + ex.response.slice(0, 40) : "REFUSED:" + (ex && ex.error) };
}
function row(name, p, expectAccept) {
  const v = verdict(p);
  const pollAcc = v.poll === "complete", exAcc = v.extract.startsWith("ANSWER");
  const agree = pollAcc === exAcc;
  const ok = (pollAcc === expectAccept) && (exAcc === expectAccept);
  console.log((ok ? "ok   " : "BAD  ") + (agree ? "" : "[POLL/EXTRACT DISAGREE] ") + name + "  -> " + JSON.stringify(v));
}
{ const p = makePage(); const u = p.user(LONG_Q); const a = p.answer(ANS); p.inject(LONG_Q); p.remount(u); p.remount(a);
  row("R1 full re-mount, identical question, our turn NOT rendered (must refuse)", p, false); }
{ const p = makePage(); p.user(LONG_Q); p.answer(ANS); p.inject(LONG_Q);
  const chat = p.w.document.getElementById("chat"); const html = chat.innerHTML.replace(/ data-hive-seen="1"/g, ""); chat.innerHTML = html;
  row("R1b innerHTML re-mount, identical question (must refuse)", p, false); }
{ const p = makePage(); const PRE = "You are one of three AI engines in a HIVE meeting. ";
  const u = p.user(PRE + "Topic: artificial intelligence"); const a = p.answer(OLD_AI); p.inject(PRE + "Topic: buy a flat now or wait");
  p.remount(u); p.remount(a);
  row("R2 full re-mount, DIFFERENT question sharing 30-char template prefix, our turn NOT rendered (must refuse)", p, false); }
{ const p = makePage(); const u = p.user(LONG_Q); const a = p.answer(ANS); p.inject(LONG_Q); p.remount(u); p.remount(a); p.user(LONG_Q);
  row("R3 full re-mount, our turn rendered, no answer yet (must refuse)", p, false); }
{ const p = makePage(); const u = p.user("Write an encyclopedia entry about artificial intelligence, 800 words"); const a = p.answer(OLD_AI); p.inject(Q2); p.remount(u); p.remount(a);
  row("R4 full re-mount, different question, our turn NOT rendered (must refuse)", p, false); }
{ const p = makePage(); nestedUser(p, LONG_Q); p.answer(ANS); p.inject(LONG_Q); nestedUser(p, LONG_Q); p.answer(ANS);
  row("R5 nested user nodes, repeated Q + identical new answer (must accept)", p, true); }
{ const p = makePage(); nestedUser(p, "Write an encyclopedia entry about artificial intelligence, 800 words"); const a = p.answer(OLD_AI); p.inject(Q2); p.remount(a); nestedUser(p, Q2);
  row("R6 nested, old answer re-mounted before our turn (must refuse)", p, false); }
{ const p = makePage(); const o = nestedUser(p, LONG_Q); const a = p.answer(ANS); p.inject(LONG_Q);
  const c = o.cloneNode(true); c.removeAttribute("data-hive-seen"); o.replaceWith(c); p.remount(a);
  row("R7 nested, outer re-mounted unstamped, inner still stamped (must refuse)", p, false); }
{ const p = makePage(); p.user("What is 2+2?"); p.answer("Four."); p.inject("What is 2+2?"); p.user("What is 2+2?"); p.answer("Four.");
  row("R8 short repeated Q (head<12), identical new answer (should accept)", p, true); }
{ const p = makePage(); const u = p.user(LONG_Q); const a = p.answer(ANS); p.inject(LONG_Q); const u2 = p.user(LONG_Q); const a2 = p.answer(ANS);
  [u, a, u2, a2].forEach(e => p.remount(e)); row("R9 everything re-mounted after new answer (must accept)", p, true); }
{ const p = makePage(); p.user(LONG_Q); p.answer(ANS); p.inject(LONG_Q); p.user(LONG_Q); p.answer(ANS, true);
  console.log("info R10 identical answer still streaming: " + JSON.stringify(verdict(p))); }
{ const p = makePage(); p.user(LONG_Q); p.answer(ANS); p.inject(LONG_Q); p.user("You said: " + LONG_Q); p.answer(ANS);
  row("R11 user turn with sr-only prefix (must accept)", p, true); }
{ const p = makePage(); p.inject(LONG_Q); p.user(LONG_Q); p.answer(ANS); row("R13 fresh chat (must accept)", p, true); }
// R14: old answer re-mounted AND our turn rendered AND different question whose old answer equals... normal different answer after fp-matching middle? n/a
// R15: repeated question, new answer differs (non-deterministic) -> accept
{ const p = makePage(); p.user(LONG_Q); p.answer(ANS); p.inject(LONG_Q); p.user(LONG_Q); p.answer("HIVE engine test passed!");
  row("R15 repeated Q, different answer (must accept)", p, true); }
// R16: timeout path agreement: identical Q, full re-mount of answer only, our turn rendered, 80s
{ const p = makePage(); p.user(LONG_Q); const a = p.answer(ANS); p.inject(LONG_Q); p.remount(a); p.user(LONG_Q); p.age(80000);
  const po = p.poll(), ex = p.extract(); console.log("info R16 timeout path: poll=" + po.status + " extract=" + JSON.stringify(ex)); }
