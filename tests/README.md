# HIVE release tests (added 18.9.26)

These run the REAL functions, sliced out of the shipping files — not copies.

One-time setup (jsdom, outside the package so it never ships):
    mkdir %TEMP%\hive-harness && cd %TEMP%\hive-harness && npm init -y && npm i jsdom
    set NODE_PATH=%TEMP%\hive-harness\node_modules

Extension (pass the background.js to test — the source, or one unpacked from the zip):
    node tools/tests/claude-guard.test.js background.js              # S1-S6, must end "ALL PASS"
    node tools/tests/claude-guard-adversarial.test.js background.js  # R-set; only R8 may say BAD (known)
    node tools/tests/claude-guard-gate.test.js background.js         # G-set; G2b/G2c/G2d/G3b must REFUSE
    node tools/tests/gemini-account.test.js background.js            # /u/<n>/ tabs stay in their account
    node tools/tests/chatgpt-layout.test.js background.js            # C1-C5, chatgpt.com 4.10.26 DOM (+ old layout); must end "ALL PASS"

Web (run from hive-web-deploy):
    node ../hive-extension-v2/tools/tests/web.test.js index.html     # must end "ALL PASS"

Run all of them before every zip and every deploy. A new field bug gets a scenario here first.
