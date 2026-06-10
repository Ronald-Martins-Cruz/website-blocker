// toolbar-popup.js — toolbar popup entry point.
// Wires the shared blocklist UI onto the popup's root element.
// initUI performs the initial render itself.

import { initUI } from "./blocklist-ui.js";

const root = document.querySelector(".popup") || document.body;
initUI(root);
