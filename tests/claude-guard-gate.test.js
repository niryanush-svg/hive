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
function verdict(p, ageMs) {
  p.age(ageMs||20000); p.poll(); p.w._hiveLastGrowthTime = Date.now() - 60000; const po = p.poll();
  const ex = p.extract();
  return { poll: po.status, extract: ex && ex.response ? "ANSWER:" + ex.response.slice(0, 40) : "REFUSED:" + (ex && ex.error) };
}
function show(n, v){ console.log(n, JSON.stringify(v)); }
const HQ1="[HIVE context: you are one of three panel engines] Question: what is rebar spacing?";
const HQ2="[HIVE context: you are one of three panel engines] Question: what is concrete cover?";
// G1 old answer virtualised away, genuine identical new answer
{ const p=makePage(); p.user(LONG_Q); const old=p.answer(ANS); p.inject(LONG_Q); const u=p.user(LONG_Q); p.answer(ANS); old.remove();
  show("G1 old virtualised, new identical @20s", verdict(p));
  const p2=makePage(); p2.user(LONG_Q); const o2=p2.answer(ANS); p2.inject(LONG_Q); p2.user(LONG_Q); p2.answer(ANS); o2.remove();
  show("G1 @80s", verdict(p2,80000)); }
// G2 three identical in a row (normal)
{ const p=makePage(); p.user(LONG_Q); p.answer(ANS); p.user(LONG_Q); p.answer(ANS); p.inject(LONG_Q); p.user(LONG_Q); p.answer(ANS);
  show("G2 three identical normal", verdict(p)); }
// G2b two prior identical, full remount, our turn NOT rendered, same Q
{ const p=makePage(); const u1=p.user(LONG_Q); const a1=p.answer(ANS); const u2=p.user(LONG_Q); const a2=p.answer(ANS); p.inject(LONG_Q);
  [u1,a1,u2,a2].forEach(e=>p.remount(e));
  show("G2b two prior identical + full remount, our turn missing (must refuse)", verdict(p)); }
// G2c same but DIFFERENT HIVE question sharing head; prior two answers identical
{ const p=makePage(); const u1=p.user(HQ1); const a1=p.answer(ANS); const u2=p.user(HQ1); const a2=p.answer(ANS); p.inject(HQ2);
  [u1,a1,u2,a2].forEach(e=>p.remount(e));
  show("G2c diff Q same head, two prior identical + remount, our turn missing (must refuse)", verdict(p)); }
// G2d same as G2b but our turn rendered, no answer yet
{ const p=makePage(); const u1=p.user(LONG_Q); const a1=p.answer(ANS); const u2=p.user(LONG_Q); const a2=p.answer(ANS); p.inject(LONG_Q);
  [u1,a1,u2,a2].forEach(e=>p.remount(e)); p.user(LONG_Q);
  show("G2d remount, our turn rendered, no answer (must refuse)", verdict(p)); }
// G3 candidate nested inside another [data-is-streaming]
{ const p=makePage(); p.user(LONG_Q); p.answer(ANS); p.inject(LONG_Q); p.user(LONG_Q);
  const outer=p.w.document.createElement("div"); outer.setAttribute("data-is-streaming","false"); p.w.document.getElementById("chat").appendChild(outer);
  const inner=p.answer(ANS); outer.appendChild(inner);
  show("G3 nested new identical (accept)", verdict(p)); }
// G3b nested OLD remounted, our turn rendered, no new answer
{ const p=makePage(); p.user(LONG_Q); const old=p.answer(ANS);
  const outer=p.w.document.createElement("div"); outer.setAttribute("data-is-streaming","false"); old.replaceWith(outer); outer.appendChild(old);
  p.inject(LONG_Q); const o2=p.remount(outer); o2.querySelectorAll("[data-hive-seen]").forEach(e=>e.removeAttribute("data-hive-seen"));
  show("G3b nested old remounted, our turn missing (must refuse)", verdict(p));
  p.user(LONG_Q); show("G3b' + our turn rendered (must refuse)", verdict(p)); }
// G4 streaming partial == old full
{ const OLD="HIVE engine test"; const p=makePage(); p.user(LONG_Q); p.answer(OLD); p.inject(LONG_Q); p.user(LONG_Q); const n=p.answer(OLD,true);
  p.age(20000); show("G4 partial==old, streaming attr true", {poll:p.poll().status});
  n.querySelector("p").textContent=OLD+" passed."; show("G4 grown", {poll:p.poll().status});
  n.setAttribute("data-is-streaming","false"); show("G4 done", verdict(p)); }
// G4b same, old copy virtualised
{ const OLD="HIVE engine test"; const p=makePage(); p.user(LONG_Q); const o=p.answer(OLD); p.inject(LONG_Q); p.user(LONG_Q); const n=p.answer(OLD,true); o.remove();
  p.age(20000); show("G4b partial==old, old gone", {poll:p.poll().status, tflag:!!p.w._hiveTimedOutNoNewElement});
  n.querySelector("p").textContent=OLD+" passed."; n.setAttribute("data-is-streaming","false"); show("G4b grown+done", verdict(p)); }
// G4c partial==old, old gone, elapsed>75s at that instant (long thinking) -> does a transient match kill the run?
{ const OLD="HIVE engine test"; const p=makePage(); p.user(LONG_Q); const o=p.answer(OLD); p.inject(LONG_Q); p.user(LONG_Q); const n=p.answer(OLD,true); o.remove();
  p.age(80000); const r=p.poll(); show("G4c transient match at 80s, streaming attr true", {poll:r.status, tflag:!!p.w._hiveTimedOutNoNewElement});
  n.querySelector("p").textContent=OLD+" passed."; n.setAttribute("data-is-streaming","false"); show("G4c after growth", {extract:p.extract()}); }
// G5 weird inputs: fp null, no user turns, empty elements
{ const p=makePage(); p.inject(LONG_Q); p.user(LONG_Q); p.answer(ANS); show("G5 fresh chat fp=null", verdict(p)); }
{ const p=makePage(); p.user(LONG_Q); p.answer(""); p.inject(LONG_Q); p.user(LONG_Q); p.answer(""); show("G5b empty answers", verdict(p)); }
