// ui.js — shared render/add/remove + break logic for popup + options.
// CSP-safe: no innerHTML with user data, no inline handlers.
//
// DOM CONTRACT — the HTML page must provide, inside `root`:
//   <section id="global-break"></section>     (global break panel target)
//   <form id="add-form">
//     <input id="domain-input" type="text" />
//     <button type="submit">Add</button>
//   </form>
//   <p id="add-error"></p>
//   <ul id="blocklist"></ul>
//
// Lookup is scoped to `root` via querySelector("#id").

import {
  getBlocklist,
  addDomain,
  removeDomain,
  getBreaks,
  startGlobalBreak,
  cancelGlobalBreak,
  startSiteBreak,
  cancelSiteBreak,
  getBreatheGate,
  setBreatheGate
} from "./storage.js";

/**
 * Begin a break, routing through the box-breathing gate (FB-2) when it's on.
 * With the gate on we hand the request to the background worker, which opens
 * the detached breathe window; the break is granted only once that window
 * closes. With it off, the break starts immediately (the original behavior).
 * @param {string|null} host canonical host, or null for the global break
 * @param {number} durationMs
 * @returns {Promise<void>}
 */
async function requestBreak(host, durationMs) {
  if (await getBreatheGate()) {
    chrome.runtime.sendMessage({ type: "breathe-gate", host: host ?? null, durationMs });
    return;
  }
  if (host === null) {
    await startGlobalBreak(durationMs);
  } else {
    await startSiteBreak(host, durationMs);
  }
}

/**
 * Format a millisecond duration as "1h 23m 45s", dropping leading zero units.
 * Always at least "0s" so we never render an empty countdown.
 * @param {number} ms
 * @returns {string}
 */
function formatRemaining(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (h > 0 || m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

/**
 * Parse hour + minute input strings into milliseconds. Returns null for
 * "no duration entered" / invalid input.
 * @param {string} hoursStr
 * @param {string} minutesStr
 * @returns {number|null}
 */
function parseDuration(hoursStr, minutesStr) {
  const h = hoursStr.trim() === "" ? 0 : Number(hoursStr);
  const m = minutesStr.trim() === "" ? 0 : Number(minutesStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || m < 0) return null;
  const totalMs = Math.floor(h * 3600_000 + m * 60_000);
  if (totalMs <= 0) return null;
  return totalMs;
}

/**
 * Build a labelled <input type="number"> for hour/minute pickers.
 * @param {string} label
 * @param {string} className
 * @param {number} max
 * @returns {{wrapper: HTMLElement, input: HTMLInputElement}}
 */
function makeNumberField(label, className, max) {
  const wrapper = document.createElement("label");
  wrapper.className = "duration-field";
  const input = document.createElement("input");
  input.type = "number";
  input.className = className;
  input.min = "0";
  input.max = String(max);
  input.step = "1";
  input.inputMode = "numeric";
  input.placeholder = "0";
  const span = document.createElement("span");
  span.className = "duration-label";
  span.textContent = label;
  wrapper.append(input, span);
  return { wrapper, input };
}

export function initUI(root) {
  if (!root) throw new Error("initUI: root element is required");

  const globalBreakEl = root.querySelector("#global-break");
  const form = root.querySelector("#add-form");
  const input = root.querySelector("#domain-input");
  const errorEl = root.querySelector("#add-error");
  const listEl = root.querySelector("#blocklist");

  if (!globalBreakEl || !form || !input || !errorEl || !listEl) {
    throw new Error(
      "initUI: missing required elements. Need #global-break, #add-form, " +
        "#domain-input, #add-error and #blocklist inside root."
    );
  }

  // Per-host break-form expanded state. Persists across re-renders so the
  // user's input isn't blown away by an unrelated storage change.
  const expanded = new Set();

  // Optional: the box-breathing gate toggle (FB-2). Pages that don't render it
  // simply leave the gate at its stored value (on by default).
  const breatheToggle = root.querySelector("#breathe-toggle");
  if (breatheToggle) {
    getBreatheGate().then((on) => {
      breatheToggle.checked = on;
    });
    breatheToggle.addEventListener("change", () => {
      setBreatheGate(breatheToggle.checked);
    });
  }

  async function syncBreatheToggle() {
    if (!breatheToggle) return;
    breatheToggle.checked = await getBreatheGate();
  }

  function showError(message) {
    errorEl.textContent = message || "";
  }

  // -------------------------------------------------------------------------
  // Global break panel
  // -------------------------------------------------------------------------

  function renderGlobalBreak(breaks) {
    globalBreakEl.replaceChildren();
    const now = Date.now();
    const active = breaks.global !== null && breaks.global > now;

    const title = document.createElement("h2");
    title.className = "global-break-title";
    title.textContent = active ? "All sites on break" : "Take a break from all sites";
    globalBreakEl.append(title);

    if (active) {
      const remaining = document.createElement("p");
      remaining.className = "global-break-remaining";
      const span = document.createElement("span");
      span.dataset.countdown = "global";
      span.dataset.expiry = String(breaks.global);
      span.textContent = formatRemaining(breaks.global - now);
      remaining.append("Time left: ", span);

      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "break-cancel";
      cancel.textContent = "End break";
      cancel.addEventListener("click", async () => {
        await cancelGlobalBreak();
      });

      globalBreakEl.append(remaining, cancel);
      return;
    }

    const formEl = document.createElement("form");
    formEl.className = "break-form";

    const { wrapper: hWrap, input: hIn } = makeNumberField("h", "duration-hours", 99);
    const { wrapper: mWrap, input: mIn } = makeNumberField("m", "duration-minutes", 59);

    const start = document.createElement("button");
    start.type = "submit";
    start.className = "break-start";
    start.textContent = "Start break";

    const err = document.createElement("p");
    err.className = "break-error";

    formEl.addEventListener("submit", async (event) => {
      event.preventDefault();
      err.textContent = "";
      const ms = parseDuration(hIn.value, mIn.value);
      if (ms === null) {
        err.textContent = "Enter at least 1 minute.";
        return;
      }
      await requestBreak(null, ms);
    });

    formEl.append(hWrap, mWrap, start);
    globalBreakEl.append(formEl, err);
  }

  // -------------------------------------------------------------------------
  // Blocklist
  // -------------------------------------------------------------------------

  function renderRow(host, breaks) {
    const li = document.createElement("li");
    li.className = "blocklist-item";
    li.dataset.domain = host;

    const top = document.createElement("div");
    top.className = "blocklist-row";

    const label = document.createElement("span");
    label.className = "blocklist-domain";
    label.textContent = host;

    const actions = document.createElement("div");
    actions.className = "blocklist-actions";

    const now = Date.now();
    const globalActive = breaks.global !== null && breaks.global > now;
    const siteExpiry = breaks.sites[host];
    const siteActive = typeof siteExpiry === "number" && siteExpiry > now;

    if (globalActive) {
      const note = document.createElement("span");
      note.className = "blocklist-note";
      note.textContent = "global break";
      actions.append(note);
    } else if (siteActive) {
      const remaining = document.createElement("span");
      remaining.className = "blocklist-remaining";
      remaining.dataset.countdown = `site:${host}`;
      remaining.dataset.expiry = String(siteExpiry);
      remaining.textContent = formatRemaining(siteExpiry - now);

      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "break-cancel break-cancel-small";
      cancel.textContent = "End break";
      cancel.addEventListener("click", async () => {
        await cancelSiteBreak(host);
      });

      actions.append(remaining, cancel);
    } else {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "break-toggle";
      toggle.textContent = expanded.has(host) ? "Cancel" : "Break";
      toggle.addEventListener("click", () => {
        if (expanded.has(host)) expanded.delete(host);
        else expanded.add(host);
        render();
      });
      actions.append(toggle);
    }

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "blocklist-remove";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", async () => {
      expanded.delete(host);
      await removeDomain(host);
    });
    actions.append(removeBtn);

    top.append(label, actions);
    li.append(top);

    if (!globalActive && !siteActive && expanded.has(host)) {
      const formEl = document.createElement("form");
      formEl.className = "break-form break-form-inline";

      const { wrapper: hWrap, input: hIn } = makeNumberField("h", "duration-hours", 99);
      const { wrapper: mWrap, input: mIn } = makeNumberField("m", "duration-minutes", 59);

      const start = document.createElement("button");
      start.type = "submit";
      start.className = "break-start break-start-small";
      start.textContent = "Start";

      const err = document.createElement("p");
      err.className = "break-error";

      formEl.addEventListener("submit", async (event) => {
        event.preventDefault();
        err.textContent = "";
        const ms = parseDuration(hIn.value, mIn.value);
        if (ms === null) {
          err.textContent = "Enter at least 1 minute.";
          return;
        }
        expanded.delete(host);
        await requestBreak(host, ms);
      });

      formEl.append(hWrap, mWrap, start);
      li.append(formEl, err);
    }

    return li;
  }

  async function render() {
    const [list, breaks] = await Promise.all([getBlocklist(), getBreaks()]);

    renderGlobalBreak(breaks);

    listEl.replaceChildren();
    for (const host of list) {
      listEl.append(renderRow(host, breaks));
    }
  }

  // -------------------------------------------------------------------------
  // Countdown ticker — updates [data-countdown] text every second without
  // a full DOM rebuild, so any half-typed input the user has stays put.
  // -------------------------------------------------------------------------

  function tick() {
    const now = Date.now();
    let needsRender = false;
    const nodes = root.querySelectorAll("[data-countdown]");
    for (const node of nodes) {
      const expiry = Number(node.dataset.expiry);
      if (!Number.isFinite(expiry)) continue;
      const remaining = expiry - now;
      if (remaining <= 0) {
        // Storage cleanup driven by the alarm will re-render us; meanwhile show 0.
        node.textContent = formatRemaining(0);
        needsRender = true;
      } else {
        node.textContent = formatRemaining(remaining);
      }
    }
    if (needsRender) render();
  }

  const tickHandle = setInterval(tick, 1000);
  window.addEventListener("beforeunload", () => clearInterval(tickHandle));

  // -------------------------------------------------------------------------
  // Add form + storage subscription + initial paint
  // -------------------------------------------------------------------------

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showError("");

    const result = await addDomain(input.value);
    if (!result.ok) {
      showError(result.reason || "Could not add domain");
      return;
    }

    input.value = "";
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (
      Object.prototype.hasOwnProperty.call(changes, "blocklist") ||
      Object.prototype.hasOwnProperty.call(changes, "breaks")
    ) {
      render();
    }
    if (Object.prototype.hasOwnProperty.call(changes, "breatheGate")) {
      syncBreatheToggle();
    }
  });

  render();
}
