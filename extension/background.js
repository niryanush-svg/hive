// =================================================================
// HIVE by NY — Background Service Worker v3.0
// Architecture: chrome.scripting.executeScript (NO content scripts)
// Each operation runs a self-contained function directly in the AI tab.
// Zero shared state, zero scoping issues, zero file dependencies.
// =================================================================

const VERSION = "3.6.7";

const ENGINES = {
  chatgpt: { patterns: ["chatgpt.com", "chat.openai.com"], homeUrl: "https://chatgpt.com/" },
  gemini:  { patterns: ["gemini.google.com"],               homeUrl: "https://gemini.google.com/app" },
  claude:  { patterns: ["claude.ai"],                       homeUrl: "https://claude.ai/new" }
};
const BUILTIN_IDS = Object.keys(ENGINES);

// ── 3.6.6: engine layouts come from the web app; more engines by user grant ──
// 4.10.26 (NIGHT-LOG Results 37-38): chatgpt.com shipped a new DOM — no
// [data-message-author-role], no #prompt-textarea — and every selector HIVE
// had for it went blind while ChatGPT kept answering. Every selector the in-tab
// functions use is now a PROFILE key the web app can override (HIVE:SET_PROFILES,
// stored in chrome.storage.local), so the next site redesign is a web deploy,
// not a store review. The in-tab functions keep their own defaults; a profile
// value that is not a valid selector falls back to the default.
// Engines beyond the three built-ins ("site engines": any chat site) need the
// user's explicit grant from an extension page (grant.html) — the web app can
// ask, never add. A site engine = { origin, name } in hiveSites + a host grant.
const PROFILE_KEYS = ["input", "send", "stop", "ready", "response", "responseBody", "userTurn", "busy"];

async function storeGet(key, dflt) {
  try { const o = await chrome.storage.local.get(key); return (o && o[key]) || dflt; } catch (e) { return dflt; }
}
async function getProfiles() { return await storeGet("hiveProfiles", {}); }
async function profileFor(engineId) {
  const p = (await getProfiles())[engineId];
  return (p && p.sel) || {};
}
async function getSites() { return await storeGet("hiveSites", {}); }
function siteIdFor(origin) {
  return "site_" + new URL(origin).hostname.replace(/^www\./, "").replace(/[^a-z0-9]/gi, "_").toLowerCase();
}
async function siteGranted(origin) {
  return await chrome.permissions.contains({ origins: [origin + "/*"] }).catch(() => false);
}
async function getEngine(engineId) {
  if (ENGINES[engineId]) return ENGINES[engineId];
  const s = (await getSites())[engineId];
  if (!s || !s.origin) return null;
  const prof = (await getProfiles())[engineId] || {};
  const home = (typeof prof.homeUrl === "string" && prof.homeUrl.startsWith(s.origin + "/")) ? prof.homeUrl : s.origin + "/";
  return { patterns: [s.origin + "/"], homeUrl: home, site: true, origin: s.origin, name: s.name || engineId };
}
async function allEngineIds() { return BUILTIN_IDS.concat(Object.keys(await getSites())); }

// ── Install / uninstall hooks (3.6.5) ──
// CWS dashboard 17.9.26: 68 installs, 8 uninstalls, but only ~7 weekly-active
// users — nothing happened after install, and Chrome hides the toolbar icon
// under the puzzle menu by default. Open HIVE once, with this extension's ID
// in the hash, so the first run is the same one-click path the popup offers.
const WEB_APP_URL = "https://hive-ny.pages.dev/";
chrome.runtime.onInstalled.addListener((details) => {
  try {
    if (details && details.reason === "install") {
      chrome.tabs.create({ url: WEB_APP_URL + "#hive_ext_id=" + chrome.runtime.id });
    }
    // Exit page: the web app shows a one-line "why did you leave?" form.
    chrome.runtime.setUninstallURL(WEB_APP_URL + "#uninstalled");
  } catch (e) {}
});

// ── Tab finder ──
// v3.3.4 FIX (field bug): a user with TWO matching tabs (e.g. Gemini's landing
// page + the actual chat) got probed on the WRONG one and stayed "not_ready"
// forever. Now: collect ALL matching tabs, prefer app-like URLs, and remember
// which tab last passed the login probe so inject/poll/extract hit that one.
const READY_TABS = {}; // engineId -> tabId that last passed checkLoginFn

async function findEngineTabs(engineId) {
  const engine = await getEngine(engineId);
  if (!engine) return [];
  const tabs = await chrome.tabs.query({});
  // Site engines match on the origin PREFIX — a substring test would let
  // "https://other.example/?u=https://site/" pass for the granted site.
  const matches = tabs.filter(t => t.url && engine.patterns.some(p => engine.site ? t.url.startsWith(p) : t.url.includes(p)));
  // The real chat lives under /app (Gemini) / /new (Claude) etc. — prefer those
  // over bare marketing/share pages of the same domain.
  // v3.6.2 (NIGHT-LOG Result 10): with TWO equally app-like tabs of one engine
  // (the user's own + the one HIVE opened), the sort was stable on query order
  // and drove the OLDER tab while the user watched the new one stay blank.
  // Tie-break on the tab the user touched most recently, then the active tab.
  const appLike = t => (t.url.includes("/app") || t.url.includes("/new") || t.url.includes("/c/") || t.url.includes("/chat/")) ? 1 : 0;
  matches.sort((a, b) =>
    (appLike(b) - appLike(a)) ||
    ((b.active ? 1 : 0) - (a.active ? 1 : 0)) ||
    ((b.lastAccessed || 0) - (a.lastAccessed || 0)));
  return matches;
}

async function findEngineTab(engineId) {
  const candidates = await findEngineTabs(engineId);
  const remembered = READY_TABS[engineId];
  let tab = null;
  if (remembered) tab = candidates.find(t => t.id === remembered) || null;
  if (!tab) tab = candidates[0] || null;
  // v3.6.4: remember the last Gemini conversation URL we saw — the /app
  // zero state is dead for injection (below), and this is the cheapest way
  // back into a live conversation.
  if (tab && engineId === "gemini" && GEMINI_CONVO_RE.test(tab.url || "")) GEMINI_LAST_CONVO = tab.url;
  return tab;
}

// v3.6.4 (ENC-LOG Entries 1, 10 — controlled 4-cell test): on Gemini's fresh
// /app welcome page NOTHING submits — not synthetic events, not real
// keystrokes — while the identical injection inside an existing conversation
// (/app/<id>) works every time. HIVE's own NEW_CHAT and the routine's tab
// refresh both park the tab on /app, so Gemini has failed every entry since.
// Before injecting into a zero-state tab, move it into a conversation: the
// last one we saw this session, else the first item in the sidebar.
// v3.6.5 (release audit 18.9): a user signed in to a second Google account
// lives under /u/<n>/app — without the optional segment the guard never ran
// for them and the 3.6.4 fix was dead.
const GEMINI_CONVO_RE = /^https:\/\/gemini\.google\.com\/(u\/\d+\/)?app\/[A-Za-z0-9_-]+/;
const GEMINI_ZERO_RE  = /^https:\/\/gemini\.google\.com\/(u\/\d+\/)?(app\/?)?(\?.*)?(#.*)?$/;
let GEMINI_LAST_CONVO = null;

function geminiOpenSidebarConvoFn() {
  // Runs inside the Gemini tab. Report the first recent conversation's URL
  // (verified 16.9.26: the sidebar renders <a href="/app/<id>"> items, and a
  // click on one lands in the conversation; the outer list item does not).
  function deep(sel, root, depth) {
    root = root || document; depth = depth || 0;
    try { const h = root.querySelector(sel); if (h) return h; } catch (e) { return null; }
    if (depth > 4 || !root.querySelectorAll) return null;
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) { const h = deep(sel, el.shadowRoot, depth + 1); if (h) return h; }
    }
    return null;
  }
  // a.href is browser-resolved; a root-absolute "/app/<id>" loses the /u/<n>/
  // account prefix — ensureGeminiConversation re-adds it before navigating.
  const a = deep('a[href^="/app/"], a[href*="/app/"][href^="/u/"]');
  if (a) { const href = a.href; try { a.click(); } catch (e) {} return { ok: true, href }; }
  const item = deep('[data-test-id="conversation"]');
  if (item) { item.click(); return { ok: true, href: null }; }
  return { ok: false, error: "no_sidebar_conversation" };
}

async function ensureGeminiConversation(tab) {
  if (!GEMINI_ZERO_RE.test(tab.url || "")) return tab;
  // Patch review 18.9: never cross Google accounts. A /u/<n>/ tab must stay in
  // /u/<n>/ — a remembered conversation or a root-absolute sidebar href from
  // another account would land in the DEFAULT account ("conversation not found").
  const acct = u => (((u || "").match(/^https:\/\/gemini\.google\.com\/(u\/\d+\/)/) || [])[1] || "");
  const pfx = acct(tab.url);
  try {
    if (GEMINI_LAST_CONVO && acct(GEMINI_LAST_CONVO) === pfx) {
      await chrome.tabs.update(tab.id, { url: GEMINI_LAST_CONVO });
      await new Promise(r => setTimeout(r, 3500));
    } else {
      // A tab OPEN_ENGINES just created may not have its sidebar yet — try
      // a few times over ~10s before giving up.
      let r = null;
      for (let i = 0; i < 4 && !(r && r.ok); i++) {
        if (i) await new Promise(r2 => setTimeout(r2, 2500));
        r = await runInTab(tab.id, geminiOpenSidebarConvoFn, [], 5000);
      }
      if (r && r.ok && r.href) {
        // Navigate from here too — the in-tab click is a router change and a
        // fresh tab has occasionally swallowed it.
        const fresh0 = await chrome.tabs.get(tab.id);
        const target = acct(r.href) ? r.href : r.href.replace("https://gemini.google.com/", "https://gemini.google.com/" + pfx);
        if (!GEMINI_CONVO_RE.test(fresh0.url || "") && GEMINI_CONVO_RE.test(target) && acct(target) === pfx) await chrome.tabs.update(tab.id, { url: target });
      }
      await new Promise(r2 => setTimeout(r2, 3000));
    }
    const fresh = await chrome.tabs.get(tab.id);
    const inConvo = GEMINI_CONVO_RE.test(fresh.url || "");
    if (inConvo) GEMINI_LAST_CONVO = fresh.url;
    console.log("[HIVE] gemini zero-state → conversation:", inConvo ? "ok" : "still on /app");
    return fresh;
  } catch (e) { return tab; }
}

// v3.3.6 FIX (field bug #3): Chrome's Memory Saver DISCARDS background tabs —
// executeScript on a discarded tab hangs until exec_timeout. Two testers hit
// "(error: exec_timeout)" on every engine at once because their AI tabs were
// open but frozen. Wake a discarded tab (reload) before touching it.
async function ensureTabAwake(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && (tab.discarded || tab.status === "unloaded")) {
      await chrome.tabs.reload(tabId);
      await new Promise(r => setTimeout(r, 3500)); // let the app shell mount
      return true; // was asleep
    }
  } catch (e) {}
  return false;
}

// ── Execute a function in a tab and return the result ──
async function runInTab(tabId, func, args = [], timeoutMs = 15000) {
  try {
    // Per-call timeout: a wedged tab must never hang executeScript forever
    // (which would freeze CHECK_ENGINES / the Verify preflight).
    const exec = chrome.scripting.executeScript({ target: { tabId }, func, args });
    const results = await Promise.race([
      exec,
      new Promise((_, reject) => setTimeout(() => reject(new Error("exec_timeout")), timeoutMs))
    ]);
    // results is an array of InjectionResult objects, one per frame
    if (results && results[0]) {
      return results[0].result;
    }
    return null;
  } catch (e) {
    console.log("[HIVE] executeScript error:", e.message);
    return { error: e.message };
  }
}

// =================================================================
// SELF-CONTAINED FUNCTIONS — these run INSIDE the AI tab
// They cannot access anything from background.js scope.
// All selectors and logic must be inline.
// =================================================================

// ── INJECT: Type question and submit ──
function injectFn(question, platform, S) {
  // 3.6.6: profile selectors from the web app (see PROFILE_KEYS). A value that
  // is not a valid selector is ignored and the built-in default is used.
  S = S || {};
  function sel(key, dflt) {
    const v = S[key];
    if (typeof v === "string" && v) { try { document.querySelector(v); return v; } catch (e) {} }
    return dflt;
  }
  // Helper: find element by selector list
  function find(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) return el;
      } catch (e) {}
    }
    return null;
  }

  // Helper: find by function-based selectors
  function findAdvanced(platform) {
    if (platform === "gemini") {
      const editables = document.querySelectorAll('div[contenteditable="true"]');
      let best = null, bestY = -1;
      editables.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.height > 20 && rect.y > bestY) { best = el; bestY = rect.y; }
      });
      return best;
    }
    if (platform === "claude") {
      const editables = document.querySelectorAll('div[contenteditable="true"]');
      let best = null, bestY = -1;
      editables.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.height > 15 && rect.y > bestY) { best = el; bestY = rect.y; }
      });
      return best;
    }
    if (platform === "chatgpt") {
      return document.querySelector('form div[contenteditable="true"]');
    }
    // 3.6.6 site engines / unknown layouts: the lowest visible composer.
    let best = null, bestY = -1;
    document.querySelectorAll('div[contenteditable="true"], textarea, [role="textbox"]').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.height > 10 && rect.width > 80 && rect.y > bestY && !el.disabled && !el.readOnly) { best = el; bestY = rect.y; }
    });
    return best;
  }

  // Platform-specific input selectors
  // 3.6.6: chatgpt.com (4.10.26) dropped #prompt-textarea — the composer is a
  // ProseMirror div with aria-label "Ask ChatGPT" inside the form.
  const inputSelectors = {
    chatgpt: ['#prompt-textarea', '[data-testid="prompt-textarea"]', 'div[contenteditable="true"][id*="prompt"]', 'form .ProseMirror[contenteditable="true"]', 'form div[contenteditable="true"][role="textbox"]'],
    gemini: ['rich-textarea div[contenteditable="true"]', 'div[contenteditable="true"][aria-label*="prompt" i]', 'div[contenteditable="true"][aria-label*="Enter" i]', '.ql-editor[contenteditable="true"]'],
    claude: ['.tiptap.ProseMirror[contenteditable="true"]', 'div[contenteditable="true"][translate="no"]', 'div[contenteditable="true"].ProseMirror', '[role="textbox"]', 'div[contenteditable="true"]']
  };

  // Find input
  const inputOverride = sel("input", null);
  let input = inputOverride ? find([inputOverride]) : null;
  if (!input) input = find(inputSelectors[platform] || []);
  if (!input) input = findAdvanced(platform);
  if (!input) return { ok: false, error: "Input field not found for " + platform };
  // 3.6.6: site engines may use a plain <textarea>, whose text is .value.
  const isField = /^(TEXTAREA|INPUT)$/.test(input.tagName);
  const textLenOf = () => isField ? String(input.value || "").length : (input.textContent || "").length;

  // ── Robust text insertion ──
  // Strategy: Try clipboard paste first (most reliable for long text),
  // fall back to insertText, then direct DOM manipulation
  input.focus();

  let inserted = false;

  // v3.6.1 (ENC-LOG Entries 3/5/7): Gemini's Quill composer on a fresh /app
  // page ignores synthetic paste/insertText. The sequence that worked by hand:
  // write the paragraph(s), drop the ql-blank placeholder class, fire a real
  // InputEvent. Try it first; the generic methods below remain as fallbacks.
  if (platform === "gemini" && input.classList && input.classList.contains("ql-editor")) {
    try {
      const esc = String(question).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      input.innerHTML = esc.split("\n").map(l => `<p>${l || "<br>"}</p>`).join("");
      input.classList.remove("ql-blank");
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: question }));
      if (input.textContent && input.textContent.length > question.length * 0.5) inserted = true;
    } catch (e) {}
  }

  // Method 1: Synthetic paste event (best for long text with special chars)
  // v3.6.4 (ENC-LOG Entry 10, test D): this block ran UNCONDITIONALLY, so on
  // Gemini it followed the Quill path above with selectAll+delete — wiping the
  // text it had just written — and the synthetic paste Quill ignores put
  // nothing back. Every Gemini submit since 3.6.1 then failed on an empty
  // composer (submit_not_confirmed). Skip it once text is already in.
  if (!inserted) try {
    document.execCommand("selectAll", false, null);
    document.execCommand("delete", false, null);
    const dt = new DataTransfer();
    dt.setData("text/plain", question);
    const pasteEvent = new ClipboardEvent("paste", {
      clipboardData: dt,
      bubbles: true,
      cancelable: true
    });
    input.dispatchEvent(pasteEvent);
    // Check if it worked
    if (textLenOf() > question.length * 0.5) {
      inserted = true;
    }
  } catch (e) {}

  // Method 2: execCommand insertText (reliable for shorter text)
  if (!inserted) {
    try {
      if (isField) input.select(); else document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      document.execCommand("insertText", false, question);
      if (textLenOf() > question.length * 0.5) {
        inserted = true;
      }
    } catch (e) {}
  }

  // Method 3: Direct DOM (last resort — may not trigger React state)
  if (!inserted && isField) {
    try {
      // 3.6.6: a <textarea> needs the native value setter for React to see it.
      const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(input, question);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      inserted = textLenOf() > question.length * 0.5;
    } catch (e) {}
  }
  if (!inserted && !isField) {
    try {
      // For paragraph-based editors (Claude, ChatGPT)
      const p = input.querySelector("p");
      if (p) {
        p.textContent = question;
      } else {
        input.textContent = question;
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      inserted = true;
    } catch (e) {}
  }

  if (!inserted) {
    return { ok: false, error: "Failed to insert text into " + platform };
  }

  // Dispatch input event for frameworks
  input.dispatchEvent(new Event("input", { bubbles: true }));

  // Store state for polling
  // 3.6.6: profile selector or default (self-contained — tools/tests slice this block).
  const P = (k, d) => { const v = (typeof S === "object" && S) ? S[k] : null; if (typeof v === "string" && v) { try { document.querySelector(v); return v; } catch (e) {} } return d; };
  window._hiveLastQuestion = question;
  window._hiveState = "injecting";
  window._hiveInjectTime = Date.now();
  window._hiveStopWasSeen = false;
  window._hiveLastTextLen = 0;
  // FIX (v3.1.2): reset timeout flag — without this, a single timeout
  // contaminates every subsequent query in the same tab.
  window._hiveTimedOutNoNewElement = false;
  // v3.1.3: reset growth tracker so previous response's stability doesn't
  // bleed into the new query's polling.
  window._hiveLastGrowthTime = Date.now();

  // Track response element count at inject time — prevents race condition
  // where pollFn sees OLD "complete" element before NEW response starts
  // 3.6.6: chatgpt.com 4.10.26 — assistant turns are now
  // [data-content-search-unit-key$=":assistant"]; the old attribute stays listed.
  const respSel = P("response", platform === "claude" ? '[data-is-streaming]'
    : platform === "chatgpt" ? '[data-message-author-role="assistant"], [data-content-search-unit-key$=":assistant"]'
    : platform === "gemini" ? 'model-response' : null);
  try { window._hiveResponseCountAtInject = respSel ? document.querySelectorAll(respSel).length : 0; } catch (e) { window._hiveResponseCountAtInject = 0; }
  // v3.6.3 (NIGHT-LOG Result 15): the count baseline above breaks once a site
  // virtualises a long conversation — claude.ai unmounted older turns, the
  // element count never exceeded the inject-time count, and a finished answer
  // sitting on the page was reported as no_response. HIVE keeps one rolling
  // conversation per engine by default, so this hit every session after a few
  // turns. Stamp every response element that exists NOW; from here on, "the
  // new answer" is the LAST response element that carries no stamp — counts
  // no longer matter.
  if (respSel) try {
    document.querySelectorAll(respSel).forEach(el => el.setAttribute("data-hive-seen", "1"));
    // v3.6.5 (NIGHT-LOG Result 19): the stamp lives on the DOM node. When the
    // site re-mounts the list (claude.ai virtualisation, a scroll, a re-render)
    // the old answer comes back on a FRESH, unstamped node and reads as "new".
    // Keep a content fingerprint of the last pre-existing answer as a second
    // line of defence: poll/extract refuse a candidate that matches it.
    const seen = document.querySelectorAll(respSel);
    const lastSeen = seen[seen.length - 1];
    const fpTxt = lastSeen ? (lastSeen.innerText || lastSeen.textContent || "").replace(/\s+/g, " ").trim() : "";
    window._hiveLastRespFp = fpTxt ? (fpTxt.length + ":" + fpTxt.slice(0, 80) + "|" + fpTxt.slice(-80)) : null;
    // Final gate 18.9: how many answers already carry that fingerprint. A
    // genuine repeat ADDS one; a re-mount of old turns cannot (see pollFn).
    window._hiveFpCountAtInject = !window._hiveLastRespFp ? 0 : Array.from(seen).filter(e => {
      const t = (e.innerText || e.textContent || "").replace(/\s+/g, " ").trim();
      return (t.length + ":" + t.slice(0, 80) + "|" + t.slice(-80)) === window._hiveLastRespFp;
    }).length;
  } catch (e) {}
  // v3.6.1 (NIGHT-LOG Result 4): a count baseline is fooled when the tab's
  // previous conversation is still rendering at inject time — the old answer
  // then looks "new" and is returned for an unrelated question. Remember the
  // head of OUR question so poll/extract can check the last user turn.
  window._hiveQuestionHead = String(question || "").replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 40);
  // 3.6.6 layout-free fallback (anchorFn): find OUR question as rendered in
  // the transcript, outside the composer. Keyed on the question's TAIL — every
  // HIVE prompt opens with the same "[HIVE context: …" frame, so the head
  // cannot tell turns apart. The scan lives on window (this isolated world
  // persists between executeScript calls) so anchorFn reuses it.
  window._hiveAnchorKey = String(question || "").replace(/[^\p{L}\p{N}]+/gu, "").slice(-30);
  window._hiveAnchorLen = 0;
  window._hiveAnchorGrowth = Date.now();
  window._hiveAnchorScan = function () {
    const key = window._hiveAnchorKey || "";
    const out = [];
    if (key.length < 12) return out;
    const norm = s => (s || "").replace(/[^\p{L}\p{N}]+/gu, "");
    const end = key.slice(-10);
    const seen = new Set();
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (!norm(n.nodeValue).includes(end)) continue;
      let el = n.parentElement;
      for (let i = 0; el && i < 5 && !norm(el.textContent).includes(key); i++) el = el.parentElement;
      if (!el || el === document.body || seen.has(el)) continue;
      if (el.closest('[contenteditable="true"], textarea, input, nav, aside, [role="navigation"], [role="dialog"]')) continue;
      seen.add(el); out.push(el);
    }
    return out;
  };
  window._hiveAnchorCountAtInject = 0;
  try { window._hiveAnchorCountAtInject = window._hiveAnchorScan().length; } catch (e) {}

  // v3.6.2 (NIGHT-LOG Result 10): "composer emptied" alone is a weak proof of
  // submission on a fresh welcome page. Baseline the user-turn count and the
  // URL so verify() can demand real evidence: a new user turn rendered, or
  // the page moved from /new (or root) into a conversation.
  const userTurnSel = P("userTurn", platform === "claude" ? '[data-testid="user-message"], .font-user-message'
    : platform === "chatgpt" ? '[data-message-author-role="user"], [data-content-search-unit-key$=":user"]'
    : platform === "gemini" ? 'user-query, .query-text' : null);
  let userTurnsAtInject = 0;
  try { userTurnsAtInject = userTurnSel ? document.querySelectorAll(userTurnSel).length : 0; } catch (e) {}
  const pathAtInject = location.pathname;
  // v3.6.5 (release audit 18.9): stamp Claude's existing USER turns as well.
  // The answer fingerprint above is content-only, so a repeated question with
  // a deterministic reply ("Test engines" run twice → "…passed." twice) made
  // the genuine new answer look old and Claude timed out at 75s. poll/extract
  // now accept a fingerprint match when it sits after an UNSTAMPED user turn
  // that carries our question — i.e. provably after our own submission.
  if (platform === "claude") {
    try { document.querySelectorAll(userTurnSel).forEach(el => el.setAttribute("data-hive-seen", "1")); } catch (e) {}
  }

  // ── Submit: poll for an ENABLED send button, then click. ──
  // v3.3.1 FIX: a fixed 300–1200ms delay silently failed on LONG pastes —
  // the site is still ingesting the text, the send button is still disabled,
  // the click lands on nothing, and the question just sits in the composer
  // ("the AIs waited for me to press Enter in every tab"). Now we poll up to
  // 12s for the button to become ENABLED and only then click; Enter fallback.
  return new Promise(resolve => {
    const btnSelectors = platform === "chatgpt" ? [
      '[data-testid="send-button"]', 'button[aria-label="Send prompt"]', 'button[aria-label*="Send" i]'
    ] : platform === "gemini" ? [
      'button[aria-label*="Send" i]', 'button[aria-label*="submit" i]', 'button[aria-label*="שליח" i]'
    ] : platform === "claude" ? [
      'button[aria-label="Send message"]', 'button[aria-label*="Send" i]'
    ] : [
      'button[aria-label*="Send" i]', 'button[data-testid*="send" i]', 'button[aria-label*="Submit" i]',
      'button[aria-label*="שליח" i]', 'form button[type="submit"]'
    ];
    const sendOverride = sel("send", null);
    if (sendOverride) btnSelectors.unshift(sendOverride);

    // v3.6.1: Gemini's send/stop buttons were unreachable to document.querySelector
    // in the field while the accessibility tree saw them (ENC-LOG Entry 7/8) —
    // search open shadow roots too, Gemini only, and only when the plain query misses.
    function deepQuery(sel, root, depth) {
      root = root || document; depth = depth || 0;
      try { const h = root.querySelector(sel); if (h) return h; } catch (e) { return null; }
      if (depth > 4 || !root.querySelectorAll) return null;
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) { const h = deepQuery(sel, el.shadowRoot, depth + 1); if (h) return h; }
      }
      return null;
    }
    function q(sel) { return platform === "gemini" ? deepQuery(sel) : document.querySelector(sel); }

    function findEnabledBtn() {
      for (const sel of btnSelectors) {
        try {
          const b = q(sel);
          if (b && !b.disabled && b.getAttribute("aria-disabled") !== "true") return b;
        } catch (e) {}
      }
      return null;
    }

    function pressEnter() {
      input.focus();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      if (platform === "gemini") {
        input.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      }
    }

    function done(via) {
      window._hiveState = "submitted";
      resolve({ ok: true, submittedVia: via });
    }

    // v3.3.3: VERIFIED submission. Clicking is not enough — on huge pastes the
    // click can land on a still-disabled button and the question sits in the
    // composer while HIVE waits for an answer that never started. A submission
    // only counts once we SEE evidence the site accepted it: the Stop button
    // appeared (generation started) or the composer emptied. Unconfirmed →
    // retry; still unconfirmed → explicit error instead of a silent hang.
    function stopVisible() {
      const sels = ['button[aria-label*="Stop" i]', '[data-testid="stop-button"]',
                    '[data-testid*="stop" i]', 'button[aria-label*="הפסקה" i]'];
      const stopOverride = sel("stop", null);
      if (stopOverride) sels.unshift(stopOverride);
      for (const s of sels) { try { if (q(s)) return true; } catch (e) {} }
      return false;
    }
    function composerLen() { return isField ? String(input.value || "").trim().length : (input.textContent || "").trim().length; }
    const preLen = composerLen();
    function composerEmptied() { return preLen > 0 && composerLen() <= Math.max(2, Math.floor(preLen * 0.1)); }
    // 3.6.6: our question rendered as a turn (outside the composer) is proof
    // of submission on any layout — the user-turn selector may not know it.
    function anchorRendered() {
      try { return window._hiveAnchorScan().length > (window._hiveAnchorCountAtInject || 0); } catch (e) { return false; }
    }
    function newUserTurn() {
      if (anchorRendered()) return true;
      if (!userTurnSel) return false;
      try { return document.querySelectorAll(userTurnSel).length > userTurnsAtInject; } catch (e) { return false; }
    }
    function pathChanged() { return location.pathname !== pathAtInject; }

    // v3.6.2: a submission counts on (a) the Stop button, (b) a NEW user turn
    // in the transcript, or (c) the composer emptied AND the URL moved into a
    // conversation. (c) alone produced false positives on fresh welcome pages
    // (Result 10: 300s waited on a page that never left "New chat"). Window
    // 6s → 8s: the user turn renders a beat after the click.
    function verify(via, onFail) {
      const v0 = Date.now();
      (function vpoll() {
        if (stopVisible() || newUserTurn() || (composerEmptied() && pathChanged())) { done(via); return; }
        if (Date.now() - v0 >= 8000) { onFail(); return; }
        setTimeout(vpoll, 300);
      })();
    }

    // Settle + submit windows scale with paste size (big docs ingest slowly).
    const startDelay = Math.min(3000, question.length > 500 ? 800 + Math.floor(question.length / 5) : 300);
    const SUBMIT_WINDOW_MS = Math.min(30000, 12000 + Math.floor(question.length / 2));
    // Long inputs → long answers with mid-generation pauses; stretch the
    // poll-side stability threshold accordingly (read by pollFn's trackGrowth).
    window._hiveStableMs = question.length > 2000 ? 10000 : 5000;

    setTimeout(() => {
      const t0 = Date.now();
      let clicks = 0;
      (function poll() {
        const btn = findEnabledBtn();
        if (btn) {
          btn.click(); clicks++;
          verify("button", () => {
            if (clicks >= 2) {
              pressEnter();
              verify("enter-after-button", () => resolve({ ok: false, error: "submit_not_confirmed" }));
            } else {
              setTimeout(poll, 400); // click didn't take — button may enable for real shortly
            }
          });
          return;
        }
        if (Date.now() - t0 >= SUBMIT_WINDOW_MS) {
          pressEnter();
          verify("enter-fallback", () => resolve({ ok: false, error: "submit_not_confirmed" }));
          return;
        }
        setTimeout(poll, 250);
      })();
    }, startDelay);
  });
}

// ── POLL: Check if generation is complete ──
function pollFn(platform, S) {
  // Strategy: Check for Stop button (still generating) vs Send button (done)
  // Also track response text growth to detect real completion
  // 3.6.6: S = profile selectors from the web app; invalid → default.
  S = S || {};
  function sel(key, dflt) {
    const v = S[key];
    if (typeof v === "string" && v) { try { document.querySelector(v); return v; } catch (e) {} }
    return dflt;
  }
  function count(s) { try { return s ? document.querySelectorAll(s).length : 0; } catch (e) { return 0; } }

  const state = window._hiveState || "unknown";
  const injectTime = window._hiveInjectTime || 0;
  const elapsed = Date.now() - injectTime;

  if (state === "idle" || !injectTime) return { status: "idle" };

  // First 3 seconds: always streaming (AI needs time to start)
  if (elapsed < 3000) return { status: "streaming" };

  // ── Locale-aware stop-button detection (used by all engines) ──
  // Stop labels seen in the wild — extend this list when a new locale shows up.
  // We use case-insensitive substring match on aria-label so partial matches work.
  function hasStopButtonAnywhere() {
    const stopPatterns = [
      'button[aria-label*="Stop" i]',
      'button[aria-label*="\u05D4\u05E4\u05E1\u05E7\u05D4" i]', // Hebrew (הפסקה)
      'button[aria-label*="Detener" i]', // Spanish
      'button[aria-label*="Arr\u00EAter" i]', // French (Arrêter)
      'button[aria-label*="Stopp" i]',  // German
      'button[aria-label*="\u062A\u0648\u0642\u0641" i]', // Arabic (توقف)
      'button[aria-label*="\u505C\u6B62" i]',  // Chinese (停止)
      'button[aria-label*="\u505C\u6B62\u3059\u308B" i]', // Japanese
      'button[aria-label*="\u4E2D\u65AD" i]',  // Japanese (中断)
      '[data-testid="stop-button"]',
      '[data-testid*="stop" i]',
      'button[aria-label*="cancel" i]',
      'button[aria-label*="abort" i]'
    ];
    const stopOverride = sel("stop", null);
    if (stopOverride) stopPatterns.unshift(stopOverride);
    for (const sel of stopPatterns) {
      try { if (document.querySelector(sel)) return true; } catch (e) {}
    }
    // v3.6.1: Gemini only — look inside open shadow roots too (see injectFn).
    if (platform === "gemini") {
      try {
        for (const el of document.querySelectorAll("*")) {
          if (!el.shadowRoot) continue;
          for (const sel of stopPatterns) { try { if (el.shadowRoot.querySelector(sel)) return true; } catch (e) {} }
        }
      } catch (e) {}
    }
    return false;
  }

  // ── Universal text-growth tracker ──
  // Returns: 'growing' (textLen increased since last poll), 'stable' (no
  // change for >stableMs), 'unknown' (first sample). Engine-agnostic
  // safety net: if class-based signals fail (UI changed, missing attribute),
  // text-growth detection still tells us whether streaming is happening.
  function trackGrowth(textLen, stableMs) {
    // v3.3.3: injectFn stretches this for long inputs — long answers pause
    // mid-generation (thinking models, search) and 5s of quiet isn't "done".
    stableMs = stableMs || window._hiveStableMs || 5000;
    const prevLen = window._hiveLastTextLen || 0;
    const now = Date.now();
    if (textLen > prevLen) {
      window._hiveLastTextLen = textLen;
      window._hiveLastGrowthTime = now;
      return 'growing';
    }
    const lastGrowth = window._hiveLastGrowthTime || injectTime;
    if (textLen > 0 && (now - lastGrowth) >= stableMs) return 'stable';
    return 'unknown';
  }

  // ── Claude-specific: data-is-streaming attribute is the most reliable signal ──
  if (platform === "claude") {
    const R = sel("response", '[data-is-streaming]');
    const UT = sel("userTurn", '[data-testid="user-message"], .font-user-message');
    const streamingEls = document.querySelectorAll(R);
    const initialCount = window._hiveResponseCountAtInject || 0;

    // v3.6.2 (NIGHT-LOG Result 10, verified live 13.9.26): claude.ai announces
    // its state in aria-live regions — "Claude is responding" / "Searching the
    // web" while working, "Claude finished the response" when done. During a
    // web search data-is-streaming can read "false" with no Stop button and no
    // text growth for 30s+, so the 15s-quiet rule declared a 920-char stub
    // complete while the real 4,900-char answer was still coming. The live
    // region is authoritative; the quiet rule stays as the fallback.
    // NOTE: "Searched the web" (past tense) persists after completion — only
    // progressive forms count as busy.
    function claudeLive() {
      let busy = false, finished = false;
      try {
        document.querySelectorAll('[aria-live], [role="status"]').forEach(el => {
          const t = (el.textContent || "").trim();
          if (!t) return;
          if (/finished the response/i.test(t)) finished = true;
          if (/is responding|searching|browsing|fetching|thinking|running|working|reading|analy[sz]ing/i.test(t)) busy = true;
        });
      } catch (e) {}
      return { busy, finished };
    }
    const live = claudeLive();

    // CRITICAL: Check if a NEW response element appeared since injection.
    // Without this, on 2nd+ query to same tab, we'd see old "false" and declare complete immediately.
    // v3.6.3: "new" = the last response element carries no inject-time stamp
    // (see injectFn). The count comparison stays only as a fallback for a page
    // where stamping failed.
    const lastClaudeEl = streamingEls[streamingEls.length - 1];
    // v3.6.5 (NIGHT-LOG Result 19): the same "is this OUR turn" guard Gemini
    // has had since 3.6.1 — the last user turn on the page must be our
    // question, and the candidate must not be the answer that was already
    // there at inject time (fingerprint; the DOM stamp is lost on re-mount).
    function claudeTurnIsOurs() {
      const head = window._hiveQuestionHead;
      if (!head || head.length < 12) return true;
      const ut = document.querySelectorAll('[data-testid="user-message"], .font-user-message');
      if (!ut.length) return true;
      const lastTxt = (ut[ut.length - 1].textContent || "").replace(/[^\p{L}\p{N}]+/gu, "");
      return !lastTxt || lastTxt.includes(head.slice(0, 30));
    }
    // True only on positive evidence: the last user turn is NEW since inject
    // (no stamp), carries our question, and `el` comes after it in the page.
    function claudeFollowsOurNewTurn(el) {
      try {
        const head = window._hiveQuestionHead;
        if (!head || head.length < 12 || !el) return false;
        const ut = document.querySelectorAll('[data-testid="user-message"], .font-user-message');
        if (!ut.length) return false;
        const u = ut[ut.length - 1];
        if (u.hasAttribute("data-hive-seen")) return false;
        const uTxt = (u.textContent || "").replace(/[^\p{L}\p{N}]+/gu, "");
        if (!uTxt.includes(head.slice(0, 30))) return false;
        if (!(u.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
        // Patch review 18.9: the head test cannot tell HIVE's prompts apart
        // (every panel prompt opens with the same "[HIVE context: …" frame),
        // and a full list re-mount strips the stamp from the OLD user turn
        // too — the old answer then "follows an unstamped turn carrying our
        // question". Demand that the text exists TWICE: the pre-existing copy
        // must still sit BEFORE this user turn. After a re-mount without our
        // turn the candidate is the only copy → refused (the safe direction).
        const fp0 = window._hiveLastRespFp;
        const same = Array.from(document.querySelectorAll("[data-is-streaming]")).filter(e => {
          const t0 = (e.innerText || e.textContent || "").replace(/\s+/g, " ").trim();
          return (t0.length + ":" + t0.slice(0, 80) + "|" + t0.slice(-80)) === fp0;
        });
        // Final gate 18.9: two OLD identical answers (Test engines run twice)
        // also satisfy "exists twice" after a re-mount. Our answer must be one
        // MORE copy than existed at inject time.
        if (same.length <= (window._hiveFpCountAtInject || 0)) return false;
        return same.some(e => e !== el && !!(e.compareDocumentPosition(u) & Node.DOCUMENT_POSITION_FOLLOWING));
      } catch (e) { return false; }
    }
    function claudeIsOldAnswer(el) {
      const fp = window._hiveLastRespFp;
      if (!fp || !el) return false;
      const t = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      if (!t || (t.length + ":" + t.slice(0, 80) + "|" + t.slice(-80)) !== fp) return false;
      // Same text as the pre-existing answer. A repeated question legitimately
      // repeats its answer — it is still ours when it follows our own new turn.
      return !claudeFollowsOurNewTurn(el);
    }
    const claudeNoNew = lastClaudeEl
      ? (lastClaudeEl.hasAttribute("data-hive-seen") || claudeIsOldAnswer(lastClaudeEl))
      : (streamingEls.length <= initialCount);
    if (claudeNoNew || !claudeTurnIsOurs()) {
      // No new response element yet — still waiting for AI to start generating.
      // Increased timeout 20s → 60s: Claude may "think" before creating the
      // streaming element. v3.1.1 had bug where 20s timeout falsely declared
      // complete and extract grabbed the PREVIOUS response (e.g. round-2
      // critique returned as consensus).
      // v3.7.1 field bug: EXTENDED thinking (manager synthesis over long
      // answers) runs >60s before the element appears → false "timeout"
      // killed the synthesis on every engine. If the stop button or a
      // thinking indicator is visible the engine is provably working —
      // allow up to 3 minutes; otherwise 75s.
      const engineBusy = live.busy || hasStopButtonAnywhere() ||
        !!document.querySelector('[class*="thinking" i], [data-testid*="thinking" i]');
      const noElementCeiling = engineBusy ? 180000 : 75000;
      if (elapsed > noElementCeiling) {
        window._hiveState = "complete";
        window._hiveTimedOutNoNewElement = true;
        // Distinct from a real completion: no response element ever appeared, so
        // either the engine produced nothing or its page layout changed.
        return { status: "timeout" };
      }
      return { status: "streaming" };
    }

    // We have a new response element — check its streaming state.
    // Defensive ordering: trust data-is-streaming as primary, but use
    // text-growth as a cross-check so a renamed/missing attribute doesn't
    // silently break us. Stop-button presence is a third corroborating signal.
    const last = streamingEls[streamingEls.length - 1];
    const isStreamingAttr = last.getAttribute('data-is-streaming') === 'true';
    const textLen = last.innerText?.trim().length || 0;
    // v3.6.1: Claude pauses mid-answer for search/tools with data-is-streaming
    // OFF and no stop button (ENC-LOG Entry 8). Demand at least 15s of true
    // quiet before calling that a completion. v3.6.2: 45s once the answer
    // contains a tool-use block — searches chain (search → read → search) and
    // each hop is a fresh pause.
    const usedTools = !!last.querySelector('[class*="group/status"]') || /Searched the web|Fetched|Read /.test(last.innerText || "");
    const quietMs = Math.max(window._hiveStableMs || 5000, usedTools ? 45000 : 15000);
    const growth = trackGrowth(textLen, quietMs);
    const stopVisible = hasStopButtonAnywhere();

    if (isStreamingAttr || stopVisible || live.busy || growth === 'growing') {
      window._hiveState = "streaming";
      if (stopVisible) window._hiveStopWasSeen = true;
      return { status: "streaming" };
    }
    // v3.6.2: the page itself says it is finished → complete once the text has
    // held still for a couple of polls (guards a late re-render), no long wait.
    if (live.finished && !isStreamingAttr && textLen > 0 && (Date.now() - (window._hiveLastGrowthTime || injectTime)) >= 4000) {
      window._hiveState = "complete";
      return { status: "complete" };
    }
    // data-is-streaming="false" on the NEW element AND text genuinely stable →
    // complete. v3.6.1: the old `|| elapsed > 3000` made this fire the instant
    // the attribute flipped off, regardless of growth — the web side then
    // accepted a 606-char fragment of an 11,000-char answer (ENC-LOG Entry 8).
    if (!isStreamingAttr && growth === 'stable') {
      window._hiveState = "complete";
      return { status: "complete" };
    }
    return { status: "streaming" };
  }

  // ── ChatGPT-specific: handle thinking models (o-series, gpt-5-thinking) ──
  if (platform === "chatgpt") {
    // 3.6.6 (NIGHT-LOG Results 37-44, live DOM probed 7.10.26): chatgpt.com no
    // longer renders [data-message-author-role] at all. The assistant turn is
    // [data-content-search-unit-key$=":assistant"], its text sits in a
    // DIV.MarkdownRoot-* (no .markdown / .prose any more), the turn wrapper
    // carries data-talvt-turn-state ("complete" once done) and the answer is NOT
    // inside <main>. injectFn already stamped the new selector; poll/extract
    // kept looking for the old one → "timeout"/no_response at 90s on every call
    // since 4.10 while ChatGPT answered in full. Old selectors stay as fallbacks.
    const R = sel("response", '[data-message-author-role="assistant"], [data-content-search-unit-key$=":assistant"]');
    const RB = sel("responseBody", '.markdown:not(.result-thinking), [class*="MarkdownRoot"], [data-markdown-text-style]');
    const msgs = document.querySelectorAll(R);
    const initialCount = window._hiveResponseCountAtInject || 0;

    // CRITICAL: Check if a NEW assistant message appeared since injection
    // v3.6.3: stamp-based (see injectFn); count only as fallback.
    const lastGptEl = msgs[msgs.length - 1];
    if (lastGptEl ? lastGptEl.hasAttribute("data-hive-seen") : (msgs.length <= initialCount)) {
      // No new response yet — still waiting
      if (elapsed > 90000) {
        window._hiveState = "complete";
        window._hiveTimedOutNoNewElement = true;
        // Distinct from a real completion: no response element ever appeared, so
        // either the engine produced nothing or its page layout changed.
        return { status: "timeout" };
      }
      return { status: "streaming" };
    }

    // We have a new response — now check if it's still generating.
    // Defensive: combine class-based signals with stop button + text growth.
    // FIX (v3.1.2): ChatGPT new UI uses .streaming-animation (was .result-streaming).
    const isThinking = !!document.querySelector('.result-thinking, [data-thinking], [class*="thinking" i]');
    const isStreamingClass = !!document.querySelector('.result-streaming, .streaming-animation, [class*="streaming" i]');
    const stopBtn = hasStopButtonAnywhere();

    // Get actual response text from the NEW message (exclude thinking content)
    const last = msgs[msgs.length - 1];
    const md = last.querySelector(RB) || last.querySelector('.markdown') || last;
    // FIX (v3.1.2): use textContent fallback because .streaming-animation
    // hides innerText during early streaming; textContent still has it.
    const textLen = md ? Math.max(md.innerText.trim().length, md.textContent.trim().length) : 0;
    const growth = trackGrowth(textLen);
    // 3.6.6: the turn wrapper's own state. Anything but "complete" while the text
    // is still fresh counts as busy; an unknown final value cannot hold us for
    // more than 30s of quiet, so a renamed state degrades to the old heuristics.
    const turnWrap = last.closest('[data-talvt-turn-state]');
    const turnState = turnWrap ? (turnWrap.getAttribute('data-talvt-turn-state') || '') : '';
    const quietMs = Date.now() - (window._hiveLastGrowthTime || injectTime);
    const turnBusy = !!turnState && turnState !== 'complete' && quietMs < 30000;

    // ChatGPT-specific: detect "Pasted text" widget when the response is just
    // a click-to-expand button with no meaningful text. Without this we'd
    // wait the full 90s and return "complete" with empty text.
    const pastedTextBtn = last.querySelector('[aria-haspopup="dialog"]');
    // Locale-aware "pasted text" chip detection (was English-only — silently
    // regressed on Hebrew/other UIs). Match known translations, and fall back to
    // a structural cue: a tiny dialog-chip next to an almost-empty response.
    const pastedTextHints = /pasted text|טקסט שהודבק|הודבק|texto pegado|texte collé|eingefügter text|貼り付け|粘贴|نص ملصوق/i;
    const chipText = (pastedTextBtn?.textContent || '').trim();
    const pastedTextOnly = pastedTextBtn && textLen < 30 &&
      (pastedTextHints.test(chipText) || chipText.length < 24);

    // Still thinking, streaming, growing, or stop button visible → wait
    if (isThinking || isStreamingClass || stopBtn || growth === 'growing' || turnBusy) {
      window._hiveState = "streaming";
      if (stopBtn) window._hiveStopWasSeen = true;
      return { status: "streaming" };
    }

    // Pasted-text-only widget without progress → likely tool-use stuck or response failed
    if (pastedTextOnly && elapsed > 30000) {
      window._hiveState = "complete";
      return { status: "complete" };
    }

    // Not thinking, not streaming, actual text exists, stable → complete
    if (!isThinking && !isStreamingClass && textLen > 5 && growth === 'stable') {
      window._hiveState = "complete";
      return { status: "complete" };
    }
    // Fallback: text exists past initial buffer (defensive — class detection may miss)
    if (!isThinking && !isStreamingClass && textLen > 5 && elapsed > 8000) {
      window._hiveState = "complete";
      return { status: "complete" };
    }

    // Stop was seen and is gone, no thinking → complete even without text
    if (window._hiveStopWasSeen && !stopBtn && !isThinking) {
      window._hiveState = "complete";
      return { status: "complete" };
    }

    // Hard timeout after 90 seconds (thinking models can take long)
    if (elapsed > 90000) {
      window._hiveState = "complete";
      return { status: "complete" };
    }

    return { status: "streaming" };
  }

  // ── Gemini / default: button-based + text growth + response count tracking ──
  {
    const mrs = document.querySelectorAll('model-response');
    const initialCount = window._hiveResponseCountAtInject || 0;

    // v3.6.1 (NIGHT-LOG Result 4): the newest model-response must belong to OUR
    // turn. Gemini renders the user's text in <user-query>; if the last one is
    // not our question, what we see is the previous conversation still rendering.
    function geminiTurnIsOurs() {
      const head = window._hiveQuestionHead;
      if (!head || head.length < 12) return true;
      const uq = document.querySelectorAll('user-query, .query-text');
      if (!uq.length) return true; // DOM changed — fall back to the count rule
      const lastTxt = (uq[uq.length - 1].textContent || "").replace(/[^\p{L}\p{N}]+/gu, "");
      return !lastTxt || lastTxt.includes(head.slice(0, 30));
    }

    // CRITICAL: Check if a NEW model-response appeared since injection
    // v3.6.3: stamp-based (see injectFn); count only as fallback.
    const lastMrEl = mrs[mrs.length - 1];
    const geminiNoNew = lastMrEl ? lastMrEl.hasAttribute("data-hive-seen") : (mrs.length <= initialCount);
    if (geminiNoNew || !geminiTurnIsOurs()) {
      // No new response yet — extended 30s → 60s for Drive/Workspace lookup
      if (elapsed > 60000) {
        window._hiveState = "complete";
        window._hiveTimedOutNoNewElement = true;
        // Distinct from a real completion: no response element ever appeared, so
        // either the engine produced nothing or its page layout changed.
        return { status: "timeout" };
      }
      return { status: "streaming" };
    }

    // New response element exists — check if still generating.
    // Locale-aware send button (Gemini-specific; English/Hebrew confirmed).
    function hasSendButton() {
      return !!document.querySelector('button[aria-label*="Send" i]')
        || !!document.querySelector('button[aria-label*="\u05E9\u05DC\u05D9\u05D7" i]')
        || !!document.querySelector('button[aria-label*="Submit" i]')
        || !!document.querySelector('button[aria-label*="Enviar" i]');
    }

    const lastMr = mrs[mrs.length - 1];
    const mc = lastMr.querySelector('message-content') || lastMr.querySelector('response-element') || lastMr;
    // CRITICAL: Gemini uses textContent, NOT innerText (innerText returns empty!)
    const textLen = mc ? (mc.textContent || '').trim().length : 0;
    const growth = trackGrowth(textLen);

    const stopVisible = hasStopButtonAnywhere();
    const sendVisible = hasSendButton();

    if (stopVisible || growth === 'growing') {
      window._hiveState = "streaming";
      if (stopVisible) window._hiveStopWasSeen = true;
      return { status: "streaming" };
    }

    if (window._hiveStopWasSeen && !stopVisible && elapsed > 4000) {
      window._hiveState = "complete";
      return { status: "complete" };
    }

    // Send button back + stable text = done, even for a SHORT reply (e.g. "OK",
    // "42", "כן"). The old textLen>20 floor stranded short answers for the full
    // 5-minute ceiling — and broke the engine self-test, whose probe asks for "OK".
    if (sendVisible && !stopVisible && textLen > 0 && growth === 'stable') {
      window._hiveState = "complete";
      return { status: "complete" };
    }

    if (textLen > 0 && growth === 'stable' && elapsed > 8000) {
      window._hiveState = "complete";
      return { status: "complete" };
    }

    // Defensive absolute timeout — any settled text after 30s.
    if (elapsed > 30000 && textLen > 0) {
      window._hiveState = "complete";
      return { status: "complete" };
    }

    return { status: "streaming" };
  }
}

// ── EXTRACT: Get the last response text ──
function extractFn(platform, S) {
  // 3.6.6: S = profile selectors from the web app (see PROFILE_KEYS); invalid → default.
  S = S || {};
  function sel(key, dflt) {
    const v = S[key];
    if (typeof v === "string" && v) { try { document.querySelector(v); return v; } catch (e) {} }
    return dflt;
  }
  // v3.6.1: Gemini's message-content must be read via text nodes (its CSS makes
  // innerText empty), but raw textContent glues table cells and list items into
  // one run-on string (NIGHT-LOG Result 4). Walk the DOM and re-insert the
  // structure: newlines around blocks, " | " between cells, "- " before items.
  // v3.6.2: emits Markdown the web side already renders — "### " headings,
  // "1. " / "- " list items (ordered lists numbered), pipe-tables with a
  // separator row — so structure survives extraction on every engine.
  function domToText(root) {
    if (!root) return "";
    const BLOCK = new Set(["P","DIV","LI","TR","TABLE","THEAD","TBODY","UL","OL","H1","H2","H3","H4","H5","H6","PRE","BLOCKQUOTE","SECTION","ARTICLE","HR"]);
    let out = "";
    const nl = () => { if (out && !out.endsWith("\n")) out += "\n"; };
    (function walk(n, ctx) {
      if (n.nodeType === 3) { out += n.nodeValue; return; }
      if (n.nodeType !== 1 && n.nodeType !== 11) return;
      const tag = n.tagName || "";
      if (tag === "SCRIPT" || tag === "STYLE") return;
      if (tag === "BR") { out += "\n"; return; }
      const block = BLOCK.has(tag);
      if (block) nl();
      if (/^H[1-4]$/.test(tag)) out += "### ";
      if (tag === "LI") {
        if (ctx.ol) { ctx.ol.i++; out += ctx.ol.i + ". "; } else out += "- ";
      }
      if (tag === "TR") out += "| ";
      if ((tag === "TD" || tag === "TH") && out && !out.endsWith("| ")) out += " | ";
      const childCtx = tag === "OL" ? { ol: { i: 0 } } : tag === "UL" ? { ol: null } : ctx;
      n.childNodes.forEach(c => walk(c, childCtx));
      if (n.shadowRoot) walk(n.shadowRoot, childCtx);
      if (tag === "TR") {
        out += " |";
        // Markdown needs a separator after the first row for a table to render.
        if (n.parentElement && n.parentElement.querySelector("tr") === n) {
          const cols = n.querySelectorAll("td, th").length || 1;
          out += "\n|" + " --- |".repeat(cols);
        }
      }
      if (block) nl();
    })(root, { ol: null });
    return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  // v3.6.1 (NIGHT-LOG Result 4): refuse to extract a Gemini answer that does not
  // follow OUR user turn — see the same check in pollFn.
  function geminiTurnIsOurs() {
    const head = window._hiveQuestionHead;
    if (!head || head.length < 12) return true;
    const uq = document.querySelectorAll('user-query, .query-text');
    if (!uq.length) return true;
    const lastTxt = (uq[uq.length - 1].textContent || "").replace(/[^\p{L}\p{N}]+/gu, "");
    return !lastTxt || lastTxt.includes(head.slice(0, 30));
  }
  function getLastText(selectors) {
    for (const sel of selectors) {
      try {
        const els = document.querySelectorAll(sel);
        const arr = Array.from(els).filter(Boolean);
        if (arr.length > 0) {
          const text = arr[arr.length - 1].innerText?.trim();
          if (text && text.length > 0) return text;
        }
      } catch (e) {}
    }
    return null;
  }

  if (platform === "chatgpt") {
    // FIX (v3.1.2): refuse stale extraction
    if (window._hiveTimedOutNoNewElement) {
      return { response: null, error: "timeout_no_new_response" };
    }
    // 3.6.6 (NIGHT-LOG Results 37-44): same selector change as pollFn — the
    // assistant turn is [data-content-search-unit-key$=":assistant"] and the
    // text lives in DIV.MarkdownRoot-*; [data-message-author-role] / .markdown
    // match nothing on chatgpt.com since 4.10.26. Old selectors kept as fallbacks.
    const R = sel("response", '[data-message-author-role="assistant"], [data-content-search-unit-key$=":assistant"]');
    const RB = sel("responseBody", '.markdown:not(.result-thinking), [class*="MarkdownRoot"], [data-markdown-text-style]');
    const msgs = document.querySelectorAll(R);
    const initialCount = window._hiveResponseCountAtInject || 0;
    // v3.6.3: stamp-based newness (see injectFn); count only as fallback.
    const lastGptX = msgs[msgs.length - 1];
    if (lastGptX ? lastGptX.hasAttribute("data-hive-seen") : (msgs.length <= initialCount)) {
      return { response: null, error: "no_new_response_element" };
    }
    if (msgs.length === 0) return { response: null };

    const last = msgs[msgs.length - 1];

    // Primary: get the non-thinking markdown (the actual response). Walk the
    // container as Markdown (domToText, as Claude does) so lists, tables and
    // headings survive; innerText is the fallback.
    const md = last.querySelector(RB)
      || last.querySelector('.markdown.prose:not(.result-thinking)');
    if (md) {
      let text = "";
      try { text = domToText(md); } catch (e) {}
      if (!text || text.length <= 3) text = md.innerText?.trim() || "";
      if (text && text.length > 0) return { response: text };
    }

    // If only result-thinking exists (no response yet), return null
    if (last.querySelector('.result-thinking') && !last.querySelector('.markdown:not(.result-thinking)')) {
      return { response: null };
    }

    // Fallback: any markdown in the response
    const anyMd = last.querySelector('.markdown');
    if (anyMd) {
      const text = anyMd.innerText?.trim();
      if (text && text.length > 0) return { response: text };
    }

    // Last resort: full container text
    const fullText = last.innerText?.trim();
    if (fullText && fullText.length > 5) return { response: fullText };

    return { response: null };
  }

  if (platform === "gemini") {
    // FIX (v3.1.2): refuse stale extraction so we don't return round-1
    // text as the round-2 falsifier output (observed bug).
    if (window._hiveTimedOutNoNewElement) {
      return { response: null, error: "timeout_no_new_response" };
    }
    // Gemini uses custom elements. CRITICAL: use textContent, NOT innerText
    // (Gemini's CSS makes innerText return empty on message-content)
    const mrs = document.querySelectorAll('model-response');
    const initialCount = window._hiveResponseCountAtInject || 0;
    // v3.6.3: stamp-based newness (see injectFn); count only as fallback.
    const lastMrX = mrs[mrs.length - 1];
    if ((lastMrX ? lastMrX.hasAttribute("data-hive-seen") : (mrs.length <= initialCount)) || !geminiTurnIsOurs()) {
      return { response: null, error: "no_new_response_element" };
    }
    if (mrs.length > 0) {
      const last = mrs[mrs.length - 1];

      // Primary: message-content via textContent (cleanest — no UI labels)
      const mc = last.querySelector('message-content');
      if (mc) {
        const text = domToText(mc) || (mc.textContent || '').trim();
        if (text.length > 3) return { response: text };
      }

      // Secondary: response-element
      const re = last.querySelector('response-element');
      if (re) {
        const text = domToText(re) || (re.textContent || '').trim();
        if (text.length > 3) return { response: text };
      }

      // Tertiary: model-response textContent, strip "Gemini אמר" prefix
      let fullText = (last.textContent || '').trim();
      if (fullText.length > 5) {
        fullText = fullText.replace(/^.*?Gemini\s+(אמר|said)\s*\n*/i, '').trim();
        if (fullText.length > 3) return { response: fullText };
      }
    }

    return { response: null };
  }

  if (platform === "claude") {
    // FIX (v3.1.2): If polling timed out without seeing a new element, do NOT
    // extract — returning the previous element gives stale stale content
    // (we observed round-2 critique returned as round-3 consensus).
    if (window._hiveTimedOutNoNewElement) {
      return { response: null, error: "timeout_no_new_response" };
    }
    // Best selector: data-is-streaming container (works for both streaming and complete)
    const streamEls = document.querySelectorAll('[data-is-streaming]');
    const initialCount = window._hiveResponseCountAtInject || 0;
    // Refuse to extract from a pre-existing element — it's stale by definition.
    // v3.6.3: stamp-based newness (see injectFn); count only as fallback.
    const lastClaudeX = streamEls[streamEls.length - 1];
    if (lastClaudeX ? lastClaudeX.hasAttribute("data-hive-seen") : (streamEls.length <= initialCount)) {
      return { response: null, error: "no_new_response_element" };
    }
    // v3.6.5 (NIGHT-LOG Result 19): refuse the pre-existing answer even when
    // its DOM node was re-mounted without the stamp, and refuse anything that
    // does not follow OUR user turn (mirrors the Gemini guard).
    try {
      const fp = window._hiveLastRespFp;
      const head = window._hiveQuestionHead;
      const ut = document.querySelectorAll('[data-testid="user-message"], .font-user-message');
      if (fp && lastClaudeX) {
        const t = (lastClaudeX.innerText || lastClaudeX.textContent || "").replace(/\s+/g, " ").trim();
        if (t && (t.length + ":" + t.slice(0, 80) + "|" + t.slice(-80)) === fp) {
          // Same text as the pre-existing answer: ours only when it follows a
          // NEW (unstamped) user turn carrying our question — see pollFn.
          let followsOurs = false;
          if (head && head.length >= 12 && ut.length) {
            const u = ut[ut.length - 1];
            const uTxt = (u.textContent || "").replace(/[^\p{L}\p{N}]+/gu, "");
            followsOurs = !u.hasAttribute("data-hive-seen") && uTxt.includes(head.slice(0, 30))
              && !!(u.compareDocumentPosition(lastClaudeX) & Node.DOCUMENT_POSITION_FOLLOWING)
              // …and the pre-existing copy still sits BEFORE that turn (see pollFn).
              && (() => {
                const same = Array.from(streamEls).filter(e => {
                  const t2 = (e.innerText || e.textContent || "").replace(/\s+/g, " ").trim();
                  return (t2.length + ":" + t2.slice(0, 80) + "|" + t2.slice(-80)) === fp;
                });
                // …and one MORE copy than existed at inject time (see pollFn).
                return same.length > (window._hiveFpCountAtInject || 0)
                  && same.some(e => e !== lastClaudeX && !!(e.compareDocumentPosition(u) & Node.DOCUMENT_POSITION_FOLLOWING));
              })();
          }
          if (!followsOurs) return { response: null, error: "stale_response_element" };
        }
      }
      if (head && head.length >= 12 && ut.length) {
        const lastTxt = (ut[ut.length - 1].textContent || "").replace(/[^\p{L}\p{N}]+/gu, "");
        if (lastTxt && !lastTxt.includes(head.slice(0, 30))) {
          return { response: null, error: "not_our_turn" };
        }
      }
    } catch (e) {}
    if (streamEls.length > 0) {
      const lastRaw = streamEls[streamEls.length - 1];

      // v3.7.1 field bug: with extended thinking, the response container
      // includes the thinking widget (step caption + "1m 37s" timer +
      // "running") and the paragraph/container fallbacks scraped IT as the
      // answer. Extract from a clone with thinking/progress nodes removed.
      const last = lastRaw.cloneNode(true);
      try {
        // v3.6.2: also drop the screen-reader chrome ("Claude responded: …" H2,
        // the thinking caption) and tool-use status blocks ("Searched the web"
        // + the query text) — all of which sit INSIDE the response container.
        last.querySelectorAll('[class*="thinking" i], [data-testid*="thinking" i], details, button, [role="progressbar"], .sr-only, [class*="group/status"]')
          .forEach(n => n.remove());
        last.querySelectorAll('[aria-live]').forEach(n => {
          if (/^(Searched|Searching|Fetched|Fetching|Read|Reading) /i.test((n.textContent || "").trim())) {
            const blk = n.closest('div') || n; blk.remove();
          }
        });
      } catch (e) {}

      // v3.6.2 (NIGHT-LOG Results 7-10, root cause): `.font-claude-response-body`
      // no longer exists in claude.ai's DOM — zero matches in every conversation
      // probed on 13.9.26. The branch below (with its 3.7.1 container rule) was
      // dead code, and extraction silently fell through to the `<p>` join, which
      // drops <li> (bare, not <li><p>), <h3> and every <table>. Walk the cleaned
      // container instead and keep the structure as Markdown. The legacy paths
      // remain as fallbacks should the walk ever come back empty.
      try {
        const walked = domToText(last);
        if (walked && walked.length > 3) return { response: walked };
      } catch (e) {}

      // FIX (v3.1.1): .font-claude-response-body is applied PER paragraph in
      // multi-paragraph responses. querySelector returns only the first → we
      // were missing 80%+ of long answers. Use querySelectorAll and join.
      // FIX (v3.7.1, field 7.9.26): the per-paragraph join DROPS numbered/
      // bulleted lists, tables and code blocks (observed: a ranked-5 answer
      // arrived with the 5 list items missing — prose only). If the whole
      // cleaned container holds meaningfully more text than the paragraph
      // join, the join is lossy — prefer the container.
      const containerText = (last.innerText || last.textContent || '').trim();
      const bodies = last.querySelectorAll('.font-claude-response-body');
      if (bodies.length > 0) {
        const joined = Array.from(bodies)
          .map(b => (b.innerText || b.textContent || '').trim())
          .filter(Boolean)
          .join('\n\n');
        if (joined && joined.length > 3) {
          if (containerText.length > joined.length * 1.3) {
            return { response: containerText };
          }
          return { response: joined };
        }
      }

      // Fallback: any paragraphs inside the response container
      const paras = last.querySelectorAll('p');
      if (paras.length > 0) {
        const joined = Array.from(paras)
          .map(p => p.innerText?.trim())
          .filter(Boolean)
          .join('\n\n');
        if (joined && joined.length > 3) return { response: joined };
      }

      // Last fallback: the whole streaming container's innerText
      const fullText = last.innerText?.trim();
      if (fullText && fullText.length > 3) return { response: fullText };

      // v3.6.5 (live gate 18.9, NIGHT-LOG Result 26): our response container
      // exists but holds no answer text — Claude searched the web twice and
      // stopped (usage limit). The page-wide fallbacks that used to follow
      // returned the last `.whitespace-pre-wrap` on the page, which on
      // claude.ai is the last paragraph of the USER's message: HIVE reported
      // the tail of its own prompt ("…Evidence only.") as Claude's answer.
      // The other two fallbacks ('[data-is-streaming] p', the backwards walk
      // over all response elements) could only ever reach an OLDER turn — a
      // stale read. An empty new container means "no answer (yet)", nothing
      // else. (With zero response elements the stale guard above has already
      // returned, so nothing page-wide is reachable any more.)
      return { response: null, error: "empty_response_element" };
    }

    return { response: null };
  }

  return { response: null };
}

// ── CHECK LOGIN: Is the AI ready to receive input? ──
function checkLoginFn(platform) {
  if (platform === "chatgpt") {
    return !!(document.querySelector('#prompt-textarea') || document.querySelector('form'));
  }
  if (platform === "gemini") {
    // v3.3.4: Google ships composer variants (A/B, Workspace shells) — a signed-in
    // user reported perpetual not_ready because neither selector matched. Broadened.
    return !!(document.querySelector('rich-textarea')
      || document.querySelector('div[contenteditable="true"]')
      || document.querySelector('textarea')
      || document.querySelector('[role="textbox"]'));
  }
  if (platform === "claude") {
    return !!(document.querySelector('div[contenteditable="true"]') || document.querySelector('[role="textbox"]'));
  }
  return false;
}

// =================================================================
// COMMAND HANDLERS (run in background.js, call into tabs)
// =================================================================

function handlePing() {
  return { ok: true, version: VERSION };
}

// ── 3.6.7: remote selector profiles (launch readiness 3.1) ──
// The web app pushes { profiles: { chatgpt: { sel: { input: "...", ... } } } }
// from its engine-config.json. Only built-in engine ids and PROFILE_KEYS are
// accepted, values must be short strings; everything else is dropped. An
// empty object for an engine clears its overrides. The in-tab functions
// validate each selector again with document.querySelector before use, so a
// bad value can never do worse than the built-in default.
function sanitizeProfiles(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const id of Object.keys(input)) {
    if (!ENGINES[id]) continue;
    const src = input[id] && typeof input[id] === "object" ? (input[id].sel || input[id]) : {};
    const sel = {};
    for (const k of PROFILE_KEYS) {
      const v = src[k];
      if (typeof v === "string" && v.length > 0 && v.length <= 400) sel[k] = v;
    }
    out[id] = { sel, updatedAt: Date.now() };
  }
  return out;
}
async function handleSetProfiles(msg) {
  const incoming = sanitizeProfiles(msg && msg.profiles);
  const current = await getProfiles();
  const merged = Object.assign({}, current);
  for (const id of Object.keys(incoming)) merged[id] = incoming[id];
  try { await chrome.storage.local.set({ hiveProfiles: merged }); }
  catch (e) { return { ok: false, error: "storage: " + (e && e.message) }; }
  return { ok: true, engines: Object.keys(incoming), keys: Object.fromEntries(Object.keys(incoming).map(id => [id, Object.keys(incoming[id].sel)])) };
}
async function handleGetProfiles() {
  return { ok: true, profiles: await getProfiles(), version: VERSION };
}

async function handleCheckEngines() {
  // Probe all engines in PARALLEL with a short per-probe timeout, so one wedged
  // tab can't stall the whole check (which callers await before Verify/popup).
  const ids = Object.keys(ENGINES);
  const entries = await Promise.all(ids.map(async id => {
    // v3.3.4: probe EVERY matching tab (up to 3) — the first that has a live
    // composer wins and is remembered for inject/poll/extract.
    const tabs = await findEngineTabs(id);
    if (!tabs.length) return [id, { available: false, reason: "no_tab" }];
    // Wake the best candidate if Memory Saver froze it (common at first use).
    await ensureTabAwake(tabs[0].id);
    for (const tab of tabs.slice(0, 3)) {
      const r = await runInTab(tab.id, checkLoginFn, [id], 5000);
      if (r && !r.error) {
        READY_TABS[id] = tab.id;
        return [id, { available: true, reason: "ready", tabId: tab.id }];
      }
    }
    // The AI web apps mount their composer late; give the best candidate one
    // retry before declaring not_ready (avoids a spurious "need 3 engines").
    await new Promise(r => setTimeout(r, 700));
    const retry = await runInTab(tabs[0].id, checkLoginFn, [id], 5000);
    if (retry && !retry.error) {
      READY_TABS[id] = tabs[0].id;
      return [id, { available: true, reason: "ready", tabId: tabs[0].id }];
    }
    return [id, { available: false, reason: "not_ready", tabId: tabs[0].id }];
  }));
  return Object.fromEntries(entries);
}

async function handleInject({ engineId, question }) {
  let tab = await findEngineTab(engineId);
  if (!tab) return { error: "No tab open for " + engineId, engineId };
  await ensureTabAwake(tab.id);
  if (engineId === "gemini") tab = await ensureGeminiConversation(tab);

  // v3.3.3: settle (≤3s) + submit window (≤30s) + up to two 6s verifies —
  // the exec ceiling must clear the worst case for the biggest pastes.
  // v3.7.1: cap 60s → 90s — synthesis injects land on pages still busy
  // rendering the previous long answer; the verified-submit loop needs the
  // headroom (field: "exec_timeout" killed the ChatGPT synthesis fallback).
  const injTimeoutMs = Math.min(90000, 25000 + (question || "").length);
  const result = await runInTab(tab.id, injectFn, [question, engineId, await profileFor(engineId)], injTimeoutMs);
  if (!result || result.error) {
    return { error: result?.error || "Injection failed for " + engineId, engineId };
  }
  return { ok: true, engineId };
}

async function handlePoll({ engineId }) {
  const tab = await findEngineTab(engineId);
  if (!tab) return { status: "error", error: "No tab", engineId };

  const result = await runInTab(tab.id, pollFn, [engineId, await profileFor(engineId)]);
  if (!result || result.error) return { status: "unknown", engineId };
  return { status: result.status, error: result.error, engineId };
}

// 3.6.7: when an engine gives nothing, look for the provider's own limit
// banner before blaming selectors. Runs in the tab, reads visible text only.
function limitProbeFn(platform) {
  const t = (document.body && document.body.innerText || "").slice(-4000);
  const patterns = {
    chatgpt: [/reached your (usage|message|plan) limit/i, /you've hit the .*limit/i, /upgrade to (continue|get more)/i, /try again (in|after) \d/i],
    claude:  [/usage limit/i, /out of messages/i, /message limit reached/i, /limit resets/i],
    gemini:  [/\u05D4\u05DE\u05DB\u05E1\u05D4 \u05E9\u05DC\u05DA/, /quota/i, /reached your limit/i, /limit resets/i]
  };
  const hits = (patterns[platform] || []).concat([/rate limit/i]);
  for (const re of hits) { if (re.test(t)) return { limit: true, match: String(re).slice(0, 40) }; }
  return { limit: false };
}

async function handleExtract({ engineId }) {
  const tab = await findEngineTab(engineId);
  if (!tab) return { error: "No tab", engineId };

  const result = await runInTab(tab.id, extractFn, [engineId, await profileFor(engineId)]);
  // Pass the error THROUGH instead of swallowing it — the orchestrator needs to
  // tell "engine gave an empty answer" apart from "selectors broke / no response".
  if (!result || result.error) {
    let error = result?.error || "extract_failed";
    if (/timeout_no_new_response|no_new_response_element|empty_response_element|extract_failed/.test(error)) {
      try {
        const probe = await runInTab(tab.id, limitProbeFn, [engineId], 3000);
        if (probe && probe.limit) error = "usage_limit";
      } catch (e) {}
    }
    return { response: null, error, engineId };
  }
  return { response: result.response, engineId };
}

async function handleNewChat({ engineId }) {
  const tab = await findEngineTab(engineId);
  if (!tab) return { error: "No tab", engineId };

  // Navigate to home URL to start fresh
  const engine = ENGINES[engineId];
  await chrome.tabs.update(tab.id, { url: engine.homeUrl });

  // Wait for page to load
  await new Promise(r => setTimeout(r, 3000));

  return { ok: true, engineId };
}

// ── OPEN ENGINES: one-click onboarding — open any missing AI tabs. ──
// v3.3.6: the single biggest first-run friction was "now open three sites
// yourself". The web app's setup screen calls this; we open background tabs
// only for engines that have no tab yet.
async function handleOpenEngines() {
  const opened = [];
  for (const id of Object.keys(ENGINES)) {
    const existing = await findEngineTab(id);
    if (!existing) {
      await chrome.tabs.create({ url: ENGINES[id].homeUrl, active: false });
      opened.push(id);
    }
  }
  return { ok: true, opened };
}

// =================================================================
// GENERIC API PROXY — "connect ANY AI"
// Lets the HIVE web app reach any OpenAI-compatible endpoint the user
// configures (OpenRouter, Groq, Together, DeepSeek, Mistral, xAI/Grok,
// or a LOCAL model via Ollama / LM Studio) EVEN when the provider blocks
// direct browser access (CORS) or is an insecure localhost origin the
// https page can't call. The service worker fetch bypasses page CORS for
// any host the extension holds permission for.
//
// SAFETY: this proxy is gated by an OPTIONAL host permission the user
// grants once, by hand, from the toolbar popup ("Connect any AI provider").
// Until granted, every proxy call is refused with permission_needed. The
// request is POST-only, http/https-only, and forwards only what the web
// app sends (the user's own question + their own key) straight to the
// endpoint the user configured — nothing is stored or sent anywhere else.
// =================================================================
async function handleProxyStatus() {
  const granted = await chrome.permissions
    .contains({ origins: ["https://*/*"] })
    .catch(() => false);
  return { granted: !!granted };
}

async function handleProxyFetch({ url, headers, body }) {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return { error: "bad_scheme" };
  }
  let origin;
  try { origin = new URL(url).origin + "/*"; }
  catch { return { error: "bad_url" }; }

  // Fail closed: never fetch a host the user hasn't explicitly authorized.
  const has = await chrome.permissions
    .contains({ origins: [origin] })
    .catch(() => false);
  if (!has) return { error: "permission_needed", origin };

  try {
    // v3.3.5: a hung provider must never hang the whole panel — 90s ceiling.
    const ctrl = new AbortController();
    const killer = setTimeout(() => ctrl.abort(), 90000);
    const res = await fetch(url, {
      method: "POST",
      headers: headers && typeof headers === "object"
        ? headers
        : { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body || {}),
      signal: ctrl.signal
    });
    clearTimeout(killer);
    const text = await res.text().catch(() => "");
    return { ok: true, status: res.status, body: text };
  } catch (e) {
    const msg = (e && e.name === "AbortError") ? "provider timed out (90s)" : (e && e.message ? e.message : String(e));
    return { error: "fetch_failed: " + msg };
  }
}

// ── Message Listeners ──

// Shared command dispatch — used by BOTH the external listener (the HIVE web app
// connecting by extension ID) and the internal listener (the toolbar popup).
async function dispatchHive(msg) {
  switch (msg.type) {
    case "HIVE:PING":          return handlePing();
    case "HIVE:SET_PROFILES":  return await handleSetProfiles(msg);
    case "HIVE:GET_PROFILES":  return await handleGetProfiles();
    case "HIVE:CHECK_ENGINES": return await handleCheckEngines();
    case "HIVE:INJECT":        return await handleInject(msg);
    case "HIVE:POLL":          return await handlePoll(msg);
    case "HIVE:EXTRACT":       return await handleExtract(msg);
    case "HIVE:NEW_CHAT":      return await handleNewChat(msg);
    case "HIVE:QUERY_ENGINE":  return await handleInject(msg);
    case "HIVE:OPEN_ENGINES":  return await handleOpenEngines();
    case "HIVE:PROXY_STATUS":  return await handleProxyStatus();
    case "HIVE:PROXY_FETCH":   return await handleProxyFetch(msg);
    default: return { error: "Unknown: " + msg.type };
  }
}

// External: the hosted HIVE web app (externally_connectable) drives the bridge.
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  dispatchHive(msg).then(sendResponse).catch(e => sendResponse({ error: e.message }));
  return true;
});

// Internal: the toolbar popup (popup.js) asks for engine status, etc.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  dispatchHive(msg).then(sendResponse).catch(e => sendResponse({ error: e.message }));
  return true;
});

console.log("[HIVE] Background v" + VERSION + " loaded — chrome.scripting.executeScript architecture");
