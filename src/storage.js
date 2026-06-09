// storage.js — blocklist read/write + domain normalization (ES module).
// Single source of truth: chrome.storage.local under the key "blocklist".
// Pure-ish: no DOM access.

const STORAGE_KEY = "blocklist";

/**
 * Normalize whatever the user typed into a canonical host to store.
 * @param {string} input
 * @returns {string|null} canonical host, or null if invalid/junk.
 */
export function normalizeDomain(input) {
  if (typeof input !== "string") return null;

  // 1. Trim. If empty -> null.
  const trimmed = input.trim();
  if (trimmed === "") return null;

  // 2. If no scheme (^\w+://), prepend "https://" so URL can parse it.
  const withScheme = /^\w+:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;

  // 3. Parse with URL in a try/catch; on throw -> null.
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  // 4. Take hostname, lowercase, strip a trailing dot.
  let host = url.hostname.toLowerCase().replace(/\.$/, "");

  // 5. Strip a single leading "www.".
  if (host.startsWith("www.")) {
    host = host.slice(4);
  }

  // 6. Reject empty or dot-less hostnames (junk).
  if (host === "" || !host.includes(".")) return null;

  return host;
}

/**
 * Read the blocklist from chrome.storage.local, defaulting to [].
 * @returns {Promise<string[]>}
 */
export async function getBlocklist() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const list = result[STORAGE_KEY];
  return Array.isArray(list) ? list : [];
}

/**
 * Normalize and add a domain to the blocklist.
 * @param {string} input
 * @returns {Promise<{ok: boolean, domain?: string, reason?: string}>}
 */
export async function addDomain(input) {
  const domain = normalizeDomain(input);
  if (domain === null) {
    return { ok: false, reason: "Invalid domain" };
  }

  const list = await getBlocklist();
  if (list.includes(domain)) {
    return { ok: false, reason: "Domain already in blocklist" };
  }

  const next = [...list, domain];
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return { ok: true, domain };
}

/**
 * Remove a domain from the blocklist and save.
 * @param {string} domain
 * @returns {Promise<void>}
 */
export async function removeDomain(domain) {
  const list = await getBlocklist();
  const next = list.filter((d) => d !== domain);
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
}
