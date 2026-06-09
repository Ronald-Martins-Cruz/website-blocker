// background.js — DNR sync engine (MV3 service worker, ES module).
// Reads the blocklist from storage.js and mirrors it into chrome
// declarativeNetRequest dynamic rules. The worker may sleep; that's fine
// because DNR rules persist independently. Sync runs on install/startup
// and whenever the "blocklist" storage key changes.

import { getBlocklist } from "./storage.js";

/**
 * Escape regex metacharacters (especially ".") so a host is matched literally.
 * @param {string} s
 * @returns {string}
 */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a DNR redirect rule that sends matching main-frame requests to the
 * "Be Aware" page.
 * @param {string} host canonical host (e.g. "youtube.com")
 * @param {number} id unique positive integer rule id
 * @returns {object}
 */
function buildRule(host, id) {
  return {
    id,
    priority: 1,
    action: { type: "redirect", redirect: { extensionPath: "/src/blocked.html" } },
    condition: {
      regexFilter: "^https?://(?:www\\.)?" + escapeRegex(host) + "(?::\\d+)?(?:[/?#]|$)",
      resourceTypes: ["main_frame"]
    }
  };
}

/**
 * Full-replace the dynamic rule set so it mirrors the current blocklist.
 * @returns {Promise<void>}
 */
async function syncRules() {
  const list = await getBlocklist();

  const current = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = current.map((rule) => rule.id);

  const addRules = list.map((host, index) => buildRule(host, index + 1));

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
}

// Triggers.
chrome.runtime.onInstalled.addListener(() => {
  syncRules();
});

chrome.runtime.onStartup.addListener(() => {
  syncRules();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && Object.prototype.hasOwnProperty.call(changes, "blocklist")) {
    syncRules();
  }
});
