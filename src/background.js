// background.js — DNR sync engine (MV3 service worker, ES module).
// Reads the blocklist + breaks from storage.js and mirrors the *effective*
// host set into chrome declarativeNetRequest dynamic rules. The worker may
// sleep; that's fine because DNR rules and chrome.alarms both persist
// independently. Sync runs on install/startup, whenever storage changes,
// and when a break alarm fires.

import {
  getBreaks,
  getEffectiveBlockHosts,
  cleanExpiredBreaks
} from "./storage.js";

const GLOBAL_ALARM = "break:__global__";
const SITE_ALARM_PREFIX = "break:site:";

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
 * Reload any already-open tabs whose URL is currently effectively blocked.
 * Used after a sync to: (a) catch tabs that were open before a rule existed,
 * and (b) kick tabs back to "Be Aware" when their break expires.
 * @param {string[]} list hosts that are blocked right now
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
 * Full-replace the dynamic rule set so it mirrors the *effective* blocklist
 * (blocklist minus hosts that are currently on a break).
 * @returns {Promise<void>}
 */
async function syncRules() {
  const list = await getEffectiveBlockHosts();

  const current = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = current.map((rule) => rule.id);

  const addRules = list.map((host, index) => buildRule(host, index + 1));

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });

  await redirectOpenTabs(list);
}

/**
 * Make chrome.alarms match the current set of active breaks: schedule one
 * alarm per active break, clear any orphaned break alarms. Alarms persist
 * across browser restarts, so this only needs to (re)assert intent.
 * @returns {Promise<void>}
 */
async function syncAlarms() {
  const breaks = await getBreaks();
  const now = Date.now();

  const existing = await chrome.alarms.getAll();
  for (const alarm of existing) {
    if (alarm.name !== GLOBAL_ALARM && !alarm.name.startsWith(SITE_ALARM_PREFIX)) {
      continue;
    }
    const stillActive =
      (alarm.name === GLOBAL_ALARM && breaks.global !== null && breaks.global > now) ||
      (alarm.name.startsWith(SITE_ALARM_PREFIX) &&
        breaks.sites[alarm.name.slice(SITE_ALARM_PREFIX.length)] > now);
    if (!stillActive) {
      await chrome.alarms.clear(alarm.name);
    }
  }

  if (breaks.global !== null && breaks.global > now) {
    chrome.alarms.create(GLOBAL_ALARM, { when: breaks.global });
  }
  for (const [host, expiry] of Object.entries(breaks.sites)) {
    if (expiry > now) {
      chrome.alarms.create(SITE_ALARM_PREFIX + host, { when: expiry });
    }
  }
}

/**
 * Run a full pass: clean expired breaks, sync DNR rules, sync alarms.
 * @returns {Promise<void>}
 */
async function fullSync() {
  await cleanExpiredBreaks();
  await syncRules();
  await syncAlarms();
}

// Triggers.
chrome.runtime.onInstalled.addListener(() => {
  fullSync();
});

chrome.runtime.onStartup.addListener(() => {
  fullSync();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  const touched =
    Object.prototype.hasOwnProperty.call(changes, "blocklist") ||
    Object.prototype.hasOwnProperty.call(changes, "breaks");
  if (touched) {
    // syncRules reflects the new effective list; syncAlarms keeps the alarm
    // set in step with break changes.
    syncRules();
    syncAlarms();
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== GLOBAL_ALARM && !alarm.name.startsWith(SITE_ALARM_PREFIX)) {
    return;
  }
  // Clearing expired entries from storage fires storage.onChanged, which
  // re-runs syncRules and bounces any open tabs back to "Be Aware".
  cleanExpiredBreaks();
});
