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
 * Does a tab's hostname fall under a blocked host? Mirrors the DNR regex in
 * buildRule: the bare host or its "www." variant, but not other subdomains.
 * @param {string} hostname tab URL hostname (already lowercased by URL parsing)
 * @param {string} blockedHost canonical host from the blocklist
 * @returns {boolean}
 */
function hostMatches(hostname, blockedHost) {
  return hostname === blockedHost || hostname === "www." + blockedHost;
}

/**
 * Reload any already-open tabs whose URL is now blocked, so the DNR rules
 * catch them and redirect to the "Be Aware" page. New navigations are handled
 * by DNR directly; this only covers tabs that were open before the rule existed.
 * @param {string[]} list current blocklist
 * @returns {Promise<void>}
 */
async function redirectOpenTabs(list) {
  if (list.length === 0) return;

  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });

  for (const tab of tabs) {
    if (!tab.url || tab.id === undefined) continue;

    let hostname;
    try {
      hostname = new URL(tab.url).hostname.toLowerCase();
    } catch {
      continue;
    }

    if (list.some((host) => hostMatches(hostname, host))) {
      chrome.tabs.reload(tab.id);
    }
  }
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

  // Rules are now active; sweep open tabs so sites opened before the rule
  // existed get redirected too, not just future navigations.
  await redirectOpenTabs(list);
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
