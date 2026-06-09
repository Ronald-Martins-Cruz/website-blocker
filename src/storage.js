// storage.js — blocklist read/write + domain normalization (ES module).
// Single source of truth: chrome.storage.local under the key "blocklist".
// Pure-ish: no DOM access.

const STORAGE_KEY = "blocklist";
const BREAKS_KEY = "breaks";

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
  // Also drop any per-site break for this domain — nothing left to be on break from.
  const breaks = await getBreaks();
  if (Object.prototype.hasOwnProperty.call(breaks.sites, domain)) {
    delete breaks.sites[domain];
    await chrome.storage.local.set({ [BREAKS_KEY]: breaks });
  }
}

// ---------------------------------------------------------------------------
// Breaks: temporary "let me through" windows.
//
// Shape: { global: number|null, sites: { [host]: number } }
// Values are epoch-ms expiry timestamps. A host is on break when:
//   breaks.global > Date.now()  OR  breaks.sites[host] > Date.now()
// ---------------------------------------------------------------------------

/**
 * Read the breaks object from storage. Always returns a normalized shape.
 * @returns {Promise<{global: number|null, sites: Record<string, number>}>}
 */
export async function getBreaks() {
  const result = await chrome.storage.local.get(BREAKS_KEY);
  const raw = result[BREAKS_KEY];
  if (!raw || typeof raw !== "object") return { global: null, sites: {} };
  return {
    global: typeof raw.global === "number" ? raw.global : null,
    sites: raw.sites && typeof raw.sites === "object" ? { ...raw.sites } : {}
  };
}

async function setBreaks(breaks) {
  await chrome.storage.local.set({ [BREAKS_KEY]: breaks });
}

/**
 * Remove break entries whose expiry is in the past. Writes back if anything
 * changed and returns the cleaned object either way.
 * @returns {Promise<{global: number|null, sites: Record<string, number>}>}
 */
export async function cleanExpiredBreaks() {
  const breaks = await getBreaks();
  const now = Date.now();
  let changed = false;

  if (breaks.global !== null && breaks.global <= now) {
    breaks.global = null;
    changed = true;
  }
  for (const host of Object.keys(breaks.sites)) {
    if (breaks.sites[host] <= now) {
      delete breaks.sites[host];
      changed = true;
    }
  }

  if (changed) await setBreaks(breaks);
  return breaks;
}

/**
 * Start (or replace) the global break for `durationMs` milliseconds.
 * @param {number} durationMs positive integer
 * @returns {Promise<number>} expiry epoch-ms
 */
export async function startGlobalBreak(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("startGlobalBreak: durationMs must be a positive number");
  }
  const breaks = await getBreaks();
  const expiresAt = Date.now() + Math.floor(durationMs);
  breaks.global = expiresAt;
  await setBreaks(breaks);
  return expiresAt;
}

export async function cancelGlobalBreak() {
  const breaks = await getBreaks();
  if (breaks.global !== null) {
    breaks.global = null;
    await setBreaks(breaks);
  }
}

/**
 * Start (or replace) a per-site break for `host` lasting `durationMs` ms.
 * @param {string} host canonical host already in the blocklist
 * @param {number} durationMs positive integer
 * @returns {Promise<number>} expiry epoch-ms
 */
export async function startSiteBreak(host, durationMs) {
  if (typeof host !== "string" || host === "") {
    throw new Error("startSiteBreak: host required");
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("startSiteBreak: durationMs must be a positive number");
  }
  const breaks = await getBreaks();
  const expiresAt = Date.now() + Math.floor(durationMs);
  breaks.sites[host] = expiresAt;
  await setBreaks(breaks);
  return expiresAt;
}

export async function cancelSiteBreak(host) {
  const breaks = await getBreaks();
  if (Object.prototype.hasOwnProperty.call(breaks.sites, host)) {
    delete breaks.sites[host];
    await setBreaks(breaks);
  }
}

/**
 * Hosts that should be actively blocked right now: blocklist minus any host
 * covered by an active break (global or per-site). Reads fresh.
 * @returns {Promise<string[]>}
 */
export async function getEffectiveBlockHosts() {
  const [list, breaks] = await Promise.all([getBlocklist(), getBreaks()]);
  const now = Date.now();
  if (breaks.global !== null && breaks.global > now) return [];
  return list.filter((host) => {
    const expiry = breaks.sites[host];
    return !(typeof expiry === "number" && expiry > now);
  });
}
