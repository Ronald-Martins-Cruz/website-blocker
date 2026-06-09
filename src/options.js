// options.js — entry point for the full-page options UI (ES module).
// Reuses the shared blocklist logic from ui.js; initUI does the first render.

import { initUI } from "./ui.js";

const root = document.getElementById("options-root");
initUI(root);
