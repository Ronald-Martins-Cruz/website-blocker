// settings-page.js — entry point for the full-page settings UI (ES module).
// Reuses the shared blocklist logic from blocklist-ui.js; initUI does the first render.

import { initUI } from "./blocklist-ui.js";

const root = document.getElementById("options-root");
initUI(root);
