# Contributing

- One file per concern: `extension/background.js` (service worker + in-tab functions), `web/index.html` (the whole app), `backend/src` (worker).
- Every change to an in-tab function needs a case in `tests/` recorded from the real site layout; the suites must end ALL PASS (see tests/README.md for the two known exceptions).
- A chat site changing its DOM is handled first through `web/engine-config.json` (selector profiles, kill switch), and only then through an extension release.
- Keep the one sentence at the top of the README byte-identical wherever it appears.
