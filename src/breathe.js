// breathe.js — the box-breathing ceremony (FB-2) shown in a detached window
// before a break is granted. Lives in its own file because MV3's extension-page
// CSP (script-src 'self') forbids inline scripts.
//
// Box breathing: 3 cycles of 4s in → 4s hold → 4s out → 4s hold (~48s).
//
// This page never grants the break itself. Both finishing the cycles and
// closing the window early funnel through the same act — the window closing —
// and background.js grants the break on windows.onRemoved. So completing the
// ceremony just closes the window after a short beat; there is intentionally
// no "give up" button (to drop an unwanted break, use the End break control).

const PHASE_MS = 4000;
const CYCLES = 3;
const PHASES = [
  { label: "Breathe in", action: "inhale" },
  { label: "Hold", action: "hold" },
  { label: "Breathe out", action: "exhale" },
  { label: "Hold", action: "hold" }
];
const TOTAL_PHASES = CYCLES * PHASES.length;

const circle = document.getElementById("circle");
const phaseEl = document.getElementById("phase");
const countEl = document.getElementById("count");
const cycleEl = document.getElementById("cycle");
const subtitleEl = document.getElementById("subtitle");

// -- Subtitle: which break this pause precedes (display only). --------------
const params = new URLSearchParams(location.search);
const host = params.get("host");
const durationMs = Number(params.get("duration"));

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || h === 0) parts.push(`${m}m`);
  return parts.join(" ");
}

const where = host ? host : "all sites";
const howLong = formatDuration(durationMs);
subtitleEl.textContent = howLong
  ? `Then ${where} opens for ${howLong}.`
  : `Then ${where} opens.`;

// -- The ceremony. ----------------------------------------------------------
let startTime = null;
let lastPhase = -1;
let finished = false;

function applyPhase(action) {
  if (action === "inhale") circle.classList.add("expanded");
  else if (action === "exhale") circle.classList.remove("expanded");
  // "hold" leaves the circle where it is.
}

function frame(now) {
  if (finished) return;
  if (startTime === null) startTime = now;
  const elapsed = now - startTime;
  const phaseIndex = Math.floor(elapsed / PHASE_MS);

  if (phaseIndex >= TOTAL_PHASES) {
    finish();
    return;
  }

  if (phaseIndex !== lastPhase) {
    lastPhase = phaseIndex;
    const phase = PHASES[phaseIndex % PHASES.length];
    phaseEl.textContent = phase.label;
    cycleEl.textContent =
      `Cycle ${Math.floor(phaseIndex / PHASES.length) + 1} of ${CYCLES}`;
    applyPhase(phase.action);
  }

  const intoPhase = elapsed - phaseIndex * PHASE_MS;
  countEl.textContent = String(Math.max(1, Math.ceil((PHASE_MS - intoPhase) / 1000)));

  requestAnimationFrame(frame);
}

function finish() {
  finished = true;
  phaseEl.textContent = "Enjoy your break";
  countEl.textContent = "";
  cycleEl.textContent = "";
  circle.classList.add("expanded");
  // Closing the window grants the break (background.js, windows.onRemoved).
  setTimeout(() => window.close(), 900);
}

requestAnimationFrame(frame);
