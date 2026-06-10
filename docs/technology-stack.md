# Technology Stack

## Summary

| Concern | Choice | Why |
|---|---|---|
| Extension platform | **Chrome/Edge Extension, Manifest V3** | Required modern format for Chromium browsers |
| Blocking engine | **`declarativeNetRequest` (DNR)** | The MV3-native way to block/redirect requests; fast, runs in the browser, no need to inspect traffic |
| Block screen | **Bundled extension HTML page** (redirect target) | A real, fully styleable "Be Aware" page; reliable |
| Storage | **`chrome.storage.local`** | Persists the blocklist; async API; survives restarts |
| UI (popup + options) | **Plain HTML + CSS + vanilla JS** | No build step, uses only tech already known, ample for this scope |
| Build tooling | **None** | Load-unpacked plain files; nothing to compile |
| Language | **JavaScript (ES modules)** | No transpilation needed; modern Chromium supports it |

## Why these choices

### Manifest V3
Chrome and Edge require Manifest V3 for new extensions. MV3 replaces the old
blocking `webRequest` API with `declarativeNetRequest`, which is what we use.

### `declarativeNetRequest` (the blocking engine)
- We register **dynamic rules** at runtime, one per blocked host.
- Each rule uses a **`regexFilter`** that matches the host **and its `www.`
  variant only**, is protocol-agnostic, and covers every path/port. For the
  canonical host `youtube.com` the filter is:
  ```
  ^https?://(?:www\.)?youtube\.com(?::\d+)?(?:[/?#]|$)
  ```
  - `https?://` → matches both `http` and `https` (protocol-agnostic).
  - `(?:www\.)?` → optionally matches a leading `www.`, so both `youtube.com`
    and `www.youtube.com` match — but `music.youtube.com` / `m.youtube.com` do
    **not** (FR-1: only the host + its `www.` variant).
  - `(?::\d+)?` allows an optional port; `(?:[/?#]|$)` ensures we match the
    whole-host boundary and every path/query/fragment under it.
  - (We use `regexFilter` instead of `urlFilter: "||host^"` because the `||`
    token would match *all* subdomains, which we don't want.)
- The rule's **action is `redirect`** to our bundled `be-aware-page.html`, and the
  **condition restricts to `resourceTypes: ["main_frame"]`** so we only
  intercept real page navigations (not every image/script), giving us the
  "Be Aware" page for FR-2.
- Dynamic rules update **live**, satisfying FR-4 (changes take effect
  immediately).

### `chrome.storage.local` (persistence)
- Stores the canonical blocklist as an array of domains.
- The source of truth for the UI; the background service worker reads it and
  syncs the DNR rules to match.
- `local` (not `sync`) is chosen to avoid Chrome's stricter sync quotas and to
  keep behavior predictable; can be switched to `sync` later if cross-device
  sync is wanted.

### Plain HTML/CSS/JS, no framework, no build
- The UI is a list with an add field and per-item remove buttons — a framework
  (React/Svelte) and a bundler (Vite) would add tooling overhead with no real
  benefit at this size.
- "Load unpacked" runs the source files directly, so the
  edit → reload → test loop is immediate.

## Required permissions (declared in `manifest.json`)

| Permission | Reason |
|---|---|
| `declarativeNetRequest` | Create the blocking/redirect rules |
| `storage` | Save and read the blocklist |
| `host_permissions` (`<all_urls>`) | Allow redirect rules to apply to any site the user blocks |

> Note: `declarativeNetRequest` does **not** let the extension read the content
> of your traffic — it only matches URLs against declared rules. This keeps the
> permission footprint and privacy impact low.

## Tooling for development

- **Chrome / Edge** with Developer Mode enabled (`chrome://extensions`).
- **"Load unpacked"** pointing at the project root.
- No Node, npm, compiler, or bundler required to run the extension.
- (Optional) a code editor with a JSON schema for `manifest.json` for
  autocomplete — not required.
