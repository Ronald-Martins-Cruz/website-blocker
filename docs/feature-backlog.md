# Feature Backlog — Website Blocker Extension

Outcome of a design interview that walked the decision tree for what to build
next. Captures the **product identity**, the features that are **in**, and the
ones deliberately **out** — so scope stays coherent and future ideas have a
filter to pass through.

This complements the shipped v1 ([requirements.md](requirements.md)) and the
already-implemented **breaks** layer (temporary "let me through" windows, global
and per-site, in [storage.js](../src/storage.js) /
[background.js](../src/background.js) / [ui.js](../src/ui.js)).

---

## 0. Product identity (the filter)

**A gentle, mindful nudge blocker — never a cage, never judgmental.**

Every feature serves *awareness and light friction*. It must not lock the user
in, and it must not quantify "failure". When a new idea comes up, it earns a
place only if it fits this tone. This single principle is what prunes the
non-goals below.

---

## 1. Desired features (in scope)

### FB-1 — Recurring schedules (per-site)

Today every blocklist entry is *always blocked*; the user opens it manually with
a break. The inverse is automation: time windows where blocking turns on/off by
itself, removing the daily decision.

- **Granularity: per entry.** Each blocklist entry gets a **mode**:
  - `always` — current behavior (default; existing entries migrate to this).
  - `scheduled` — blocked **only inside** its defined time windows, free outside.
- **Breaks always win** over a schedule: starting a break punches through even
  during a blocked window (the escape valve must always work — nudge, not cage).
- Example: *block social media Mon–Fri 09:00–18:00; news sites always.*

**Implementation implications**
- A blocklist entry stops being a bare string and becomes an object, e.g.
  `{ host, mode: "always" | "scheduled", windows: [{ days, start, end }] }`
  (or a parallel schedule map keyed by host). Migration: wrap existing strings
  as `{ host, mode: "always" }`.
- [background.js](../src/background.js) needs alarms at **window boundaries**
  (open/close), not just at break expiry, to re-sync the DNR rule set when a
  window opens or closes.
- `getEffectiveBlockHosts()` becomes: `always` entries ∪ `scheduled` entries
  currently in-window, minus any host covered by an active break.

### FB-2 — Box-breathing gate before a break ⭐ (signature feature)

The break is the back door. The moment the user *requests* one is itself an
impulse moment — the same one the block page already addresses. So the back door
gets the same mindful pause the wall offers.

- **Box breathing: 3 cycles of 4s inhale → 4s hold → 4s exhale → 4s hold**
  (~48s total).
- **Visual element** showing:
  - the **countdown of the current phase** (the 4 seconds ticking down), and
  - the **cycle counter** (e.g. "cycle 2 of 3").
- **Toggle in the popup** to enable/disable. When **off**, a break is a single
  click again (current behavior).
- **Scope: every break** — global and per-site — when the toggle is on.
  Cancelling/ending an active break never asks for breathing (returning to
  blocked is virtuous, never gated).
- **Runs in a detached window** (`chrome.windows.create`, e.g.
  `src/breathe.html`), because a Chrome **popup closes on blur** and a ~48s
  ceremony inside it would be lost on any outside click. The detached window
  does not close on blur and does not pollute the tab history. It receives the
  break params (`global` vs site `host`, duration) via query string.
  - *No new manifest permission*: the `windows` API needs none.
- **Closing the window at any time grants the break** (honors real urgency —
  "I might genuinely need this now"). Completing the 3 cycles also grants it.
  There is intentionally **no "give up" path** through the window; to drop an
  unwanted break, use the existing **End break** button right after.
  - *Impl. note*: handle "completed" and `windows.onRemoved` without granting
    twice (guard with an "already granted" flag).

**Recommended defaults (open for change)**
- Toggle **on by default** — it is the signature feature; opt out if unwanted.
- The wall's existing breathing visual ([blocked.html](../src/blocked.html)) and
  this box-breathing are two separate components for now; the visual can be
  shared later, but the wall stays as-is per current preference.

---

## 2. Undesired features (deliberate non-goals)

Recorded on purpose — keeping the identity lean is as much about what we refuse
as what we build.

| Rejected idea | Why it's out |
|---|---|
| PIN / hard lockdown / punitive breaks | Contradicts the **nudge** identity (cage, not nudge). |
| One-off focus mode / allowlist session | Chose recurring **schedules** over this. |
| "Proceed anyway" friction on the block page | Contradicts the mindful, non-judgmental **wall**. |
| Attempt statistics ("you tried 14× today") | Judgmental quantification — clashes with "notice the urge without judging". |
| Cross-device sync (`chrome.storage.sync`) | No utility convenience features for now. |
| Import / export blocklist | Same — out for now. |
| Subdomain / wildcard matching control | Same — out for now. |

> These can be revisited if the identity ever shifts, but each would have to
> re-earn its place against §0.

---

## 3. Notes

The mindful **wall** is already in place: [blocked.html](../src/blocked.html)
shows a breathing visual and a reflective message, and
[blocked.js](../src/blocked.js) fills `#prompt` with a random reflective question
on each load (CSP-safe, its own file because MV3 forbids inline scripts). Both
FB-2's tone and any future prompt rotation should stay consistent with this
existing voice.
