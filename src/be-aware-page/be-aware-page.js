// be-aware-page.js — picks a fresh reflective prompt each time the "Be Aware" page
// loads. Lives in its own file because MV3's extension-page CSP (script-src
// 'self') forbids inline scripts.

const prompts = [
  "What were you hoping to feel by visiting this site?",
  "Where is your attention being pulled — and where would you rather it go?",
  "Take one slow breath. What does your body need in this moment?",
  "If you closed this tab now, what would you do with the next 5 minutes?",
  "Is this a real need, or a passing impulse?",
];

document.getElementById("prompt").textContent =
  prompts[Math.floor(Math.random() * prompts.length)];
