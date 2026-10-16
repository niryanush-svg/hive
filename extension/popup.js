// HIVE Bridge — toolbar popup.
// Shows which AI engines are open/connected and launches the HIVE web app with
// this extension's ID in the URL hash, so first-time connection is automatic
// (no manual 32-char ID paste). The web app reads #hive_ext_id=<id> on load.

const WEB_APP_URL = "https://hive-ny.pages.dev/";
const ENGINE_IDS = ["chatgpt", "gemini", "claude"];

const STATE_TEXT = { ready: "connected", no_tab: "not open", not_ready: "sign in" };

function setEngine(id, available, reason) {
  const dot = document.getElementById("dot-" + id);
  const state = document.getElementById("state-" + id);
  if (!dot || !state) return;
  if (available) dot.classList.add("on"); else dot.classList.remove("on");
  state.textContent = STATE_TEXT[reason] || (available ? "connected" : "not open");
}

async function refreshStatus() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "HIVE:CHECK_ENGINES" });
    let anyOn = false;
    for (const id of ENGINE_IDS) {
      const info = (res && res[id]) || {};
      const ok = !!info.available;
      setEngine(id, ok, info.reason);
      if (ok) anyOn = true;
    }
    const hint = document.getElementById("hint-none");
    if (hint) hint.className = "hint " + (anyOn ? "hide" : "show");
  } catch (e) {
    for (const id of ENGINE_IDS) {
      const state = document.getElementById("state-" + id);
      if (state) state.textContent = "—";
    }
  }
}

document.getElementById("open-hive").addEventListener("click", (e) => {
  e.preventDefault();
  const url = WEB_APP_URL + "#hive_ext_id=" + chrome.runtime.id;
  chrome.tabs.create({ url });
  window.close();
});

// ── "Connect any AI provider" — optional host-permission grant ──
// One click grants HIVE the runtime permission to reach any OpenAI-compatible
// API the user configures in Settings (bypassing browser CORS via the
// background proxy). Requested only on a user gesture; never at install time.
const PROXY_ORIGINS = ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"];

async function refreshProxy() {
  const dot = document.getElementById("dot-proxy");
  const state = document.getElementById("state-proxy");
  const btn = document.getElementById("enable-proxy");
  if (!dot || !state || !btn) return;
  let granted = false;
  try { granted = await chrome.permissions.contains({ origins: ["https://*/*"] }); } catch (e) {}
  if (granted) {
    dot.classList.add("on"); state.textContent = "enabled";
    btn.textContent = "Enabled ✓"; btn.disabled = true;
  } else {
    dot.classList.remove("on"); state.textContent = "off";
    btn.textContent = "Enable"; btn.disabled = false;
  }
}

document.getElementById("enable-proxy").addEventListener("click", async () => {
  try { await chrome.permissions.request({ origins: PROXY_ORIGINS }); } catch (e) {}
  refreshProxy();
});

refreshStatus();
refreshProxy();
