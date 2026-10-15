# Session replay: mobile recordings on desktop admin

Issue sheet for BA / QA and engineering notes for the portrait display fix.

## Issue summary

| Field | Content |
|--------|---------|
| **Title** | Session replay: mobile/Android recordings display poorly on Windows admin (portrait stretched / wrong layout) |
| **Module** | Session replay — `web/src/pages/SessionReplay.jsx`, `web/src/components/SessionReplayPlayer.jsx` |
| **Severity** | Medium (playback works; analyst UX degraded) |
| **Recording** | Capture quality reported good on **Windows** and **mobile** |
| **Regression scope** | **Windows → Windows**: OK. **Mobile → viewed on Windows admin**: poor (tall vertical strip, layout unlike device) |

## Steps to reproduce

1. Record a session on an **Android** phone on a tracked storefront (e.g. Booxoo).
2. In Worktual admin on **desktop Windows**, open **Session replay** for that session.
3. Open a **desktop-recorded** session on the same site and compare layout.

## Expected vs actual

| | Description |
|---|-------------|
| **Expected** | Mobile replay readable on desktop: phone-like aspect ratio, centered, reasonable page height; content matches what the user saw on device. |
| **Actual (before fix)** | Replay scaled to full dashboard width from narrow recorded width → very tall viewport; DOM `scrollWidth` could inflate width and distort layout. |

## Root cause (engineering)

- Player used `scale = containerWidth / recordedWidth` only (fit-to-width).
- Portrait sessions became full-width × proportionally tall columns.
- `measureReplayViewport` expanded width using `scrollWidth`, which often exceeds mobile CSS viewport on real pages.

## Fix (product)

- **Portrait** recordings: **contain** fit inside ~80vh max height, **centered** device-style frame, letterboxed.
- **Landscape / desktop** recordings: unchanged fit-to-width behavior.
- UI badge: **Mobile recording · {width}×{height}** when portrait.
- Portrait viewport measurement uses rrweb **Meta** dimensions only (no `scrollWidth` inflation).

## Out of scope

- Re-recording logic, ClickHouse chunks, rrweb version upgrade (unless Meta missing on device).
- Changes under `live_web_tracking_folder_2/`.

## Acceptance criteria

- [ ] Portrait session (typical Android ~390×844): centered frame, letterboxed, max height ~**80vh**, no excessive scroll from replay column alone.
- [ ] Desktop session (≥1280 wide): looks the same as before (full-width fit).
- [ ] Label shows recorded dimensions for mobile (e.g. `Mobile recording · 390×844`).
- [ ] Resize browser: replay refits; portrait stays contained.
- [ ] Manual QA: at least **one Android** and **one desktop** session on Session replay page.

## Screenshots (attach in ticket)

1. **Before:** mobile session on desktop admin (full-width tall strip).
2. **After:** centered mobile frame on same session.
3. **Control:** desktop-recorded session unchanged.

## Follow-ups (optional)

- If Meta (type 4) is missing on some chunks, infer portrait from session device in `dim_sessions` or snapshot (phase 2).
- Toolbar toggle “Fit width / Device view” if users request it.
