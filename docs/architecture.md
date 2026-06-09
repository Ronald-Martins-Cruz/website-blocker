# Architecture

## High-level overview

```
                 chrome.storage.local
                 ["youtube.com", ...]   <-- single source of truth
                        ^   |
            writes      |   |  reads / onChanged
            (add/remove)|   v
   +----------------+   |   +-----------------------------+
   |  Popup UI      |---+   |  Background service worker  |
   |  Options UI    |       |  (background.js)            |
   |  (list + form) |       |  - reads blocklist          |
   +----------------+       |  - rebuilds DNR rules        |
                            +--------------+--------------+
                                           |
                                           v
                            declarativeNetRequest dynamic rules
                            (one redirect rule per domain)
                                           |
                            user navigates to a blocked domain
                                           |
                                           v
                                 redirect to blocked.html
                                  ("Be Aware" message)
```

## Components

### 1. `manifest.json`
Declares MV3 config: permissions, the background service worker, the popup
(`action.default_popup`), the options page, and which resources are
web-accessible (so `blocked.html` can be redirected to).

### 2. Background service worker — `src/background.js`
The brain. Responsibilities:
- On install/startup and whenever `chrome.storage.local` changes, **read the
  blocklist** and **rebuild the dynamic DNR rules** so they match the list.
- Build one rule per host (matches the host + its `www.` variant only):
  ```js
  {
    id: <stable integer>,
    priority: 1,
    action: {
      type: "redirect",
      redirect: { extensionPath: "/src/blocked.html" }
    },
    condition: {
      // escapeRegex turns "youtube.com" into "youtube\.com"
      regexFilter: "^https?://(?:www\\.)?" + escapeRegex(host) + "(?::\\d+)?(?:[/?#]|$)",
      resourceTypes: ["main_frame"]
    }
  }
  ```
- Sync = remove all existing dynamic rules, then add the freshly computed set
  (simplest correct approach; the list is small).

### 3. Blocklist storage module — `src/storage.js`
Thin wrapper around `chrome.storage.local` shared by the UI:
- `getBlocklist()` → `Promise<string[]>`
- `addDomain(input)` → normalizes input to a domain, dedupes, saves
- `removeDomain(domain)` → removes and saves
- `normalizeDomain(input)` → see "Domain normalization" below.

### 4. Popup UI — `src/popup.html` + `src/popup.js` + `src/popup.css`
Opened by clicking the toolbar icon. Shows:
- An input + "Add" button to block a new site.
- The current blocklist with a "Remove" button per row.
Reads/writes via the storage module. The background worker reacts to changes
automatically via `storage.onChanged`.

### 5. Options page — `src/options.html` + `src/options.js`
Reachable from `chrome://extensions`. Same functionality as the popup (can
share the same JS/CSS), giving a larger management surface as required by FR-3.

### 6. Block page — `src/blocked.html` + `src/blocked.css`
The redirect target. A full page showing the **"Be Aware"** message. Self-
contained (no network), styleable, the only thing the user sees for a blocked
site.

## Domain normalization (FR-1 & FR-3 input handling)

Goal: turn whatever the user types into a canonical host to store.

1. If the input has no scheme, prepend `https://` so it can be parsed by `URL`.
2. Parse with `new URL(...)` and take `hostname`.
3. Lowercase and strip a trailing dot.
4. Strip a leading `www.` so the stored host is canonical.
5. Reject empty / invalid hostnames.

> `www.` is stripped on storage, then re-added by the matching rule's
> `(?:www\.)?`, so `youtube.com` and `www.youtube.com` collapse to one entry
> that blocks both. Other subdomains (`music.youtube.com`) are left alone.

Examples:
| Input | Stored | Blocks |
|---|---|---|
| `youtube.com` | `youtube.com` | `youtube.com`, `www.youtube.com` |
| `https://www.youtube.com/watch?v=x` | `youtube.com` | `youtube.com`, `www.youtube.com` |
| `HTTP://YouTube.com` | `youtube.com` | `youtube.com`, `www.youtube.com` |
| `music.youtube.com` | `music.youtube.com` | `music.youtube.com`, `www.music.youtube.com` |

> To block a specific subdomain like `music.youtube.com`, the user adds it
> explicitly; it then blocks that host plus its own `www.` variant only.

## Data flow: adding a site
1. User types `reddit.com` in the popup, clicks Add.
2. `popup.js` → `storage.addDomain("reddit.com")` normalizes + saves to
   `chrome.storage.local`.
3. `chrome.storage.onChanged` fires in `background.js`.
4. `background.js` recomputes DNR rules → `reddit.com` now has a redirect rule.
5. Navigating to `reddit.com` is redirected to `blocked.html`. (No restart.)

## Data flow: hitting a blocked site
1. User navigates to `http://youtube.com/anything`.
2. The `main_frame` request matches the regex rule for `youtube.com` (which
   also covers `www.youtube.com`).
3. DNR redirects to `chrome-extension://<id>/src/blocked.html`.
4. The "Be Aware" page renders.

## Proposed file layout

```
websiteBlockerExtension/
├─ manifest.json
├─ src/
│  ├─ background.js     # service worker: syncs DNR rules from storage
│  ├─ storage.js        # blocklist read/write + domain normalization
│  ├─ popup.html
│  ├─ popup.js
│  ├─ popup.css
│  ├─ options.html
│  ├─ options.js        # may reuse popup.js logic
│  ├─ blocked.html      # "Be Aware" page
│  └─ blocked.css
└─ docs/
   ├─ requirements.md
   ├─ technology-stack.md
   └─ architecture.md
```

## Key risks / notes
- **`web_accessible_resources`:** `blocked.html` must be declared so DNR can
  redirect to it.
- **Rule IDs must be stable integers** and unique; generate them from the
  domain's index or a counter and rebuild the whole set on each change to avoid
  stale rules.
- **DNR dynamic rule limit** is well into the thousands — far beyond a personal
  blocklist, so no concern here.
- **Service worker lifecycle:** the worker sleeps when idle; that's fine because
  DNR rules persist independently of it. We only need the worker to run when the
  list *changes* (via `onChanged`) and on `onInstalled`/`onStartup`.
