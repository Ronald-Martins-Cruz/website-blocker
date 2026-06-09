// ui.js — shared render/add/remove logic for popup + options (ES module).
// Wires up a container ("root") that follows the DOM CONTRACT below.
// No innerHTML with user data, no inline handlers: CSP-safe.
//
// DOM CONTRACT — the HTML page must provide, inside `root`:
//   <form id="add-form">
//     <input id="domain-input" type="text" />
//     <button type="submit">Add</button>   (any submit-type button)
//   </form>
//   <p id="add-error"></p>                  (inline error text target)
//   <ul id="blocklist"></ul>                (list container; rows injected here)
//
// Lookup is scoped to `root` via querySelector("#id"), so the IDs only need to
// be unique within the root subtree.

import { getBlocklist, addDomain, removeDomain } from "./storage.js";

/**
 * Initialize the blocklist UI inside `root`.
 * @param {HTMLElement} root container element holding the contracted structure.
 */
export function initUI(root) {
  if (!root) throw new Error("initUI: root element is required");

  const form = root.querySelector("#add-form");
  const input = root.querySelector("#domain-input");
  const errorEl = root.querySelector("#add-error");
  const listEl = root.querySelector("#blocklist");

  if (!form || !input || !errorEl || !listEl) {
    throw new Error(
      "initUI: missing required elements. Need #add-form, #domain-input, " +
        "#add-error and #blocklist inside root."
    );
  }

  function showError(message) {
    errorEl.textContent = message || "";
  }

  async function render() {
    const list = await getBlocklist();

    // Clear existing rows without innerHTML.
    listEl.replaceChildren();

    for (const domain of list) {
      const li = document.createElement("li");
      li.className = "blocklist-item";
      li.dataset.domain = domain;

      const label = document.createElement("span");
      label.className = "blocklist-domain";
      label.textContent = domain;

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "blocklist-remove";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", async () => {
        await removeDomain(domain);
        await render();
      });

      li.append(label, removeBtn);
      listEl.append(li);
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showError("");

    const result = await addDomain(input.value);
    if (!result.ok) {
      showError(result.reason || "Could not add domain");
      return;
    }

    input.value = "";
    await render();
  });

  // Keep popup + options in sync when both are open, and reflect background
  // changes. Re-render only when the blocklist key in local storage changed.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && Object.prototype.hasOwnProperty.call(changes, "blocklist")) {
      render();
    }
  });

  // Initial paint.
  render();
}
