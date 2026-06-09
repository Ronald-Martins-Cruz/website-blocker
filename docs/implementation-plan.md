# Implementation Plan — Website Blocker Extension

This plan turns the design in [requirements.md](requirements.md),
[architecture.md](architecture.md), and [technology-stack.md](technology-stack.md)
into an ordered, buildable sequence of steps.

## Decisions locked for v1

- **Block page:** static "Be Aware" message only — no blocked-domain readout,
  no quotes.
- **Testing:** manual verification against the 8 acceptance criteria. No Node,
  no test runner (keeps the no-build goal intact).
- **Icons:** none. The manifest omits the `icons`/`action.default_icon` keys;
  Chrome shows its default puzzle-piece icon.
- **No build step, no framework, vanilla ES modules**, loaded via "Load unpacked".

## Target file layout

```
websiteBlockerExtension/
├─ manifest.json
├─ src/
│  ├─ background.js     # service worker: syncs DNR rules from storage
│  ├─ storage.js        # blocklist read/write + domain normalization (ES module)
│  ├─ popup.html
│  ├─ popup.js
│  ├─ popup.css
│  ├─ options.html
│  ├─ options.js        # imports the shared UI logic
│  ├─ ui.js             # shared render/add/remove logic for popup + options
│  ├─ blocked.html      # "Be Aware" page
│  └─ blocked.css
└─ docs/                # (already present)
```

> Note: `ui.js` is added beyond the architecture doc's layout so the popup and
> options page share one implementation instead of duplicating it (FR-3 wants
> identical behavior in both surfaces). If you'd rather keep it flat, fold
> `ui.js` into `popup.js` and have `options.js` import from `popup.js`.

---

## Step 1 — `manifest.json`

MV3 manifest wiring every component together.

- `manifest_version: 3`, `name`, `version`, `description`.
- `permissions`: `["declarativeNetRequest", "storage"]`.
- `host_permissions`: `["<all_urls>"]` (lets redirect rules apply to any blocked site).
- `background`: `{ "service_worker": "src/background.js", "type": "module" }`
  (`type: module` so `background.js` can `import` from `storage.js`).
- `action`: `{ "default_popup": "src/popup.html" }` (no `default_icon`).
- `options_page`: `"src/options.html"`.
- `web_accessible_resources`: expose `src/blocked.html` to `<all_urls>` so DNR
  can redirect to it. Shape:
  ```json
  "web_accessible_resources": [
    { "resources": ["src/blocked.html"], "matches": ["<all_urls>"] }
  ]
  ```

**Done when:** the unpacked extension loads at `chrome://extensions` with no
manifest errors.

---

## Step 2 — `src/storage.js` (storage + normalization)

The shared data layer. Pure-ish, no DOM. Exports:

- `normalizeDomain(input) -> string | null`
  1. Trim. If empty → `null`.
  2. If no scheme (`^\w+://`), prepend `https://`.
  3. `new URL(...)` in a try/catch; on throw → `null`.
  4. Take `hostname`, lowercase, strip a trailing dot.
  5. Strip a single leading `www.`.
  6. If the result is empty or has no `.` → `null` (reject junk).
- `getBlocklist() -> Promise<string[]>` — reads `chrome.storage.local`
  key `blocklist`, defaults to `[]`.
- `addDomain(input) -> Promise<{ok, domain?, reason?}>` — normalize, reject if
  invalid, dedupe against current list, save the new array.
- `removeDomain(domain) -> Promise<void>` — filter it out, save.

Single storage key: `{ blocklist: string[] }`.

**Verify against the normalization table** in architecture.md §"Domain
normalization" (youtube.com, https://www.youtube.com/..., HTTP://YouTube.com,
music.youtube.com) by reasoning through each — no automated test per the
testing decision.

**Done when:** functions exist and match the table mentally; used by later steps.

---

## Step 3 — `src/background.js` (the DNR sync engine)

The brain. Imports `getBlocklist` from `storage.js`.

- `escapeRegex(s)` — escape regex metacharacters (esp. `.`).
- `buildRule(host, id)` — returns the DNR rule object:
  ```js
  {
    id,
    priority: 1,
    action: { type: "redirect",
              redirect: { extensionPath: "/src/blocked.html" } },
    condition: {
      regexFilter: "^https?://(?:www\\.)?" + escapeRegex(host) + "(?::\\d+)?(?:[/?#]|$)",
      resourceTypes: ["main_frame"]
    }
  }
  ```
- `syncRules()`:
  1. `getBlocklist()`.
  2. Get current dynamic rule IDs via
     `chrome.declarativeNetRequest.getDynamicRules()`.
  3. Build the fresh rule set, assigning stable IDs = index + 1.
  4. `updateDynamicRules({ removeRuleIds: <all current ids>, addRules: <new> })`
     — full replace (simplest correct approach; list is small).
- **Triggers:** call `syncRules()` on
  `chrome.runtime.onInstalled`, `chrome.runtime.onStartup`, and
  `chrome.storage.onChanged` (when the `blocklist` key changed).

**Done when:** adding a domain to storage produces a matching dynamic rule
(inspect via `chrome.declarativeNetRequest.getDynamicRules()` in the service
worker console).

---

## Step 4 — `src/blocked.html` + `src/blocked.css`

The redirect target. Self-contained, no network, no inline script needed.

- `blocked.html`: a centered "Be Aware" heading and a short message. Links the
  stylesheet.
- `blocked.css`: simple centered layout, readable typography. Static only.

**Done when:** opening
`chrome-extension://<id>/src/blocked.html` directly shows the styled page.

---

## Step 5 — `src/ui.js` (shared popup/options logic)

DOM logic shared by popup and options. Imports from `storage.js`. Exports one
`initUI(root)` that, given a container element, wires up:

- An add form (text input + Add button) → `addDomain()`, then re-render. Show
  inline error text if `addDomain` returns `{ok:false}`.
- A list rendered from `getBlocklist()`, each row showing the domain + a Remove
  button → `removeDomain()`, then re-render.
- Re-render on `chrome.storage.onChanged` so popup and options stay in sync if
  both are open.

Expects a known set of element IDs/structure that both HTML files provide.

**Done when:** importing `initUI` into a page renders and mutates the list.

---

## Step 6 — `src/popup.html` + `src/popup.js` + `src/popup.css`

- `popup.html`: the add form + list container; loads `popup.css` and
  `popup.js` (`<script type="module">`).
- `popup.js`: `import { initUI } from "./ui.js"` and call it on the popup root.
- `popup.css`: compact width suitable for a toolbar popup (~320px).

**Done when:** clicking the toolbar icon shows a working add/list/remove UI.

---

## Step 7 — `src/options.html` + `src/options.js`

- `options.html`: same structure as the popup, more spacious layout; loads
  `options.js` as a module.
- `options.js`: `import { initUI } from "./ui.js"` and call it.
- Reuse `popup.css` or add minimal options-specific CSS for a wider page.

**Done when:** the options page (via `chrome://extensions` → Details →
Extension options) offers the same add/list/remove behavior.

---

## Step 8 — Manual verification (the 8 acceptance criteria)

Load unpacked at `chrome://extensions` (Developer Mode on), then walk the
acceptance table from [requirements.md](requirements.md) §6:

| # | Action | Expected |
|---|--------|----------|
| 1 | Block `youtube.com`, open `https://youtube.com/watch?v=x` | Be Aware page |
| 2 | open `http://youtube.com` | Be Aware page |
| 3 | open `https://www.youtube.com` | Be Aware page |
| 4 | open `https://music.youtube.com` | loads normally |
| 5 | empty list, open any site | loads normally |
| 6 | add `reddit.com` in popup, open `reddit.com` immediately | Be Aware page (no restart) |
| 7 | remove `reddit.com`, reopen | loads normally |
| 8 | add `https://www.reddit.com/r/x` | stored as `reddit.com` |

For each redirect test, confirm the original site never renders. If a rule
doesn't fire, inspect the service worker console
(`chrome://extensions` → the extension → "service worker") and check
`getDynamicRules()`.

**Done when:** all 8 rows pass.

---

## Build order summary

1. `manifest.json` — scaffold loads cleanly.
2. `storage.js` — data + normalization.
3. `background.js` — DNR rules sync from storage.
4. `blocked.html` / `blocked.css` — redirect target.
5. `ui.js` — shared UI logic.
6. `popup.*` — toolbar UI.
7. `options.*` — options-page UI.
8. Manual verification pass.

## Risks / things to watch (from architecture.md)

- **`web_accessible_resources`** must list `src/blocked.html` or the redirect
  fails silently.
- **Rule IDs** must be unique positive integers; rebuilding the whole set each
  change avoids stale rules.
- **Service worker lifecycle:** the worker may sleep — fine, because DNR rules
  persist independently. Sync runs on install/startup/onChanged only.
- **`background` must be `type: "module"`** for the `import` from `storage.js`
  to work; otherwise drop ES imports in the worker and inline what it needs.
