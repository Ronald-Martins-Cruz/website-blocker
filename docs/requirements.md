# Requirements — Website Blocker Extension

## 1. Purpose

A browser extension that prevents the user from visiting a configurable list of
websites. When the user navigates to a blocked site, the real page never loads;
instead the extension shows a **"Be Aware"** message.

## 2. Target platform

- **Browsers:** Google Chrome and Microsoft Edge (any Chromium-based browser).
- **Extension format:** Manifest V3.

## 3. Functional requirements

### FR-1 — Block by domain (DNS-level matching)
- Blocking a site means blocking the **entire domain**, not a single URL.
- Example: blocking `youtube.com` must also block:
  - `https://youtube.com/`
  - `https://youtube.com/watch?v=abc`
  - `https://youtube.com/any/deep/path`
- **Protocol is irrelevant:** both `http://` and `https://` must be blocked.
- **The host and its `www.` variant are blocked; no other subdomains.**
  Blocking `youtube.com` blocks both `youtube.com` and `www.youtube.com` (and
  all their paths), but does **not** block other subdomains such as
  `music.youtube.com` or `m.youtube.com`. To block those, the user adds them
  explicitly.
- For normalization, a leading `www.` is **stripped** so the stored host is
  canonical (`www.youtube.com` and `youtube.com` collapse to `youtube.com`); the
  `www.` variant is then re-added automatically by the matching rule.
- Matching is on the **host only** — paths, query strings, and ports do
  not affect whether a site is blocked.

### FR-2 — Show a "Be Aware" message
- When a blocked domain is requested in the address bar / a top-level
  navigation, the browser is redirected to a **full page bundled with the
  extension** that displays a "Be Aware" message.
- The original blocked site's content must never be rendered.

### FR-3 — Manage the blocklist easily
- The user can **add** a website to the blocklist.
- The user can **remove** a website from the blocklist.
- The user can **see** the current blocklist.
- This management UI is reachable by:
  - Clicking the extension's icon in the browser toolbar (popup), and/or
  - The extension's options page (reachable from `chrome://extensions` → the
    extension → "Extension options" / "Details").
- Input is forgiving: the user can paste a full URL
  (`https://www.youtube.com/feed`) and the extension extracts and stores just
  the canonical host (`youtube.com` — `www.` and the path are stripped).

### FR-4 — Persistence
- The blocklist persists across browser restarts.
- Changes to the blocklist take effect immediately, without restarting the
  browser or reloading the extension.

## 4. Non-functional requirements

- **No build step required** — the extension loads as plain HTML/CSS/JS via
  "Load unpacked".
- **No external network calls** — everything runs locally; no servers, no
  tracking, no analytics.
- **Minimal permissions** — request only what is needed (see architecture doc).
- **Simple, readable code** — vanilla JS, small files, easy to maintain.

## 5. Explicit non-goals (out of scope for v1)

These are intentionally **not** part of the first version. Listed so scope is
clear; they can be revisited later.

- Password / PIN protection to stop the user from editing the list.
- Time-based schedules (e.g. block only 9am–5pm).
- Syncing the list across devices via an account.
- Blocking inside other browsers (Firefox/Safari) or at the OS level.
- Regex / wildcard rules beyond whole-domain blocking.
- Allowlist mode (block everything except listed sites).

## 6. Acceptance criteria

| # | Given | When | Then |
|---|-------|------|------|
| 1 | `youtube.com` is on the blocklist | I open `https://youtube.com/watch?v=x` | I see the "Be Aware" page, not YouTube |
| 2 | `youtube.com` is on the blocklist | I open `http://youtube.com` | I see the "Be Aware" page |
| 3 | `youtube.com` is on the blocklist | I open `https://www.youtube.com` | I see the "Be Aware" page (`www.` variant is blocked) |
| 4 | `youtube.com` is on the blocklist | I open `https://music.youtube.com` | The site loads normally (other subdomains not blocked) |
| 5 | The blocklist is empty | I open any site | The site loads normally |
| 6 | I add `reddit.com` in the popup | I immediately open `reddit.com` | I see the "Be Aware" page (no restart) |
| 7 | `reddit.com` is blocked | I remove it in the popup and reopen the site | The site loads normally |
| 8 | I paste `https://www.reddit.com/r/x` into the add field | I submit | `reddit.com` is stored (canonical host, `www.`/path stripped) |
