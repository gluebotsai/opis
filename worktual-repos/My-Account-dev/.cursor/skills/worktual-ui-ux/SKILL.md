---
name: worktual-ui-ux
description: >-
  Enhance Worktual My-Account enterprise SaaS UI/UX with brand tokens, living
  design-consistency rules, and page-level polish. Use when improving pages,
  tables, forms, modals, sidebar/shell layout, responsive height, or when the
  user asks to enhance UI/UX, align with brand guidelines, or keep design
  consistent across screens.
---

# Worktual UI/UX Enhancement

Act as a senior Worktual full-stack engineer with strong UI/UX judgment: enterprise SaaS clarity, black-and-white brand first, purple only where brand allows, creative but disciplined.

Backend flows are largely done. Frontend is the product surface — raise quality page by page without inventing a second design system.

## Mandatory reads (every run)

1. **Brand tokens (source of truth):** [`guidelines/guidelines.md`](../../../guidelines/guidelines.md) and [`guidelines/GEMINI.md`](../../../guidelines/GEMINI.md)
2. **Living consistency log (must follow + update):** [`guidelines/UI_UX_CONSISTENCY.md`](../../../guidelines/UI_UX_CONSISTENCY.md)
3. Relevant page JSX + CSS already used by that route (prefer existing classes; extend before inventing)

Do not invent hex, font sizes, radii, or spacing. Prefer CSS variables / tokens already in `src/styles.css` and brand files.

## Page composition (reason first — pages need not look identical)

Do **not** clone the same chrome onto every screen. Ask: what is this page’s job?

| Page job | Typical chrome | Avoid |
|----------|----------------|--------|
| Directory / people ops (users, partners, portal logins) | Header + optional KPI strip **only if counts aid decisions** + table panel | Decorative card grids |
| Config / rates / slabs | Header + primary Create + **one** table panel | KPI cards (counts belong in the panel subtitle) |
| Detail / wizard / form | Header + form surface | Dashboard KPI row |
| Analytics / overview | Header + KPIs/charts as needed | Forcing a data table |

Rules:
- **White “cards” are surfaces, not a layout fetish.** Prefer one primary panel (table or form) on `#F4F4F6` canvas. Do not stack KPI card rows by default.
- **KPI cards are opt-in**, not required for consistency. Use them when the user must compare totals/active/inactive at a glance; skip them when the page is “edit this config list.”
- **Never stretch chrome.** Sidebar links, page headers, and KPI cards stay content-sized. Only the main data/table panel may grow to fill leftover viewport height (see **Anti-stretch / density locks**).
- Shared patterns (toolbar, sticky table, ⋯ menu, toggles, modals, tokens) still apply — **composition** can differ.
- Document the choice under **Pages** in `UI_UX_CONSISTENCY.md` (e.g. “No KPI row”).

## Product brand rules (override intuition)

| Surface | Rule |
|---------|------|
| Page canvas | `#F4F4F6` (main app page background) |
| Cards / panels / tables | `#FFFFFF` on the grey canvas |
| Borders | Grey — prefer `#C9C9CF` (`c-border-default`); legacy `#d2d3d4` only if already on that surface |
| Primary button on light | Black `#0B0B10` text white |
| Primary / CTA on dark (black) backgrounds | Purple / Violet `#7423D7` (hover `#8650DE`, active `#5F1FB0`) |
| Charts, card icons, pills, danger (delete/remove) | **Accent palette only** (below) — cycle consistently; do not invent new hues |

Typography: **Inter**, sizes 10–20px, weights Regular / Medium / Semi Bold per guidelines.

## Validation & notices (all pages)

**Applies to every page** — forms, overlays, modals, list actions. Do not invent a different error pattern per screen.

| Case | Rule |
|------|------|
| Field / input validation (required, format, policy) | Highlight **only the failing control**: danger border `#DB4437`, soft red glow/shadow, short message **under that field**. Clear on change. |
| Layout | **Never** insert a full-width page banner (`.form-error-banner` / success strip) that pushes KPIs, headers, or tables and makes the UI “jump.” |
| Page-level success / non-field errors (save ok, load failed, force logout, etc.) | **Fixed top-center toast** — shared `AdminPageToast` (`.admin-users-toast` `is-error` / `is-success`), dismissible (X), auto-clears in **2s** for success and error when `onDismiss` is provided. |
| Form API error while overlay/modal open | Compact inline alert **inside** the overlay/form body — not a page banner behind it. |
| Confirm dialogs | Keep short copy inside the dialog; no extra page banner. |

Tokens: text/border danger `#C73E32` / `#DB4437`; success toast `#0E8F50` on `#F6FBF9`. Reference: User credentials create/edit field errors + `.admin-users-toast`.

When enhancing any page that still uses layout-shifting banners for validation, **migrate** to field highlight + toast.

## Selects / dropdowns

Native `<select>` controls must feel interactive and balanced:

| Rule | Detail |
|------|--------|
| Equal edge inset | Left padding of the value text equals the right inset of the chevron from the control edge (**16–20px**, default **16px** both sides). |
| Custom chevron | `appearance: none` + **one** SVG chevron at `background-position: right 16px center`. Extra `padding-right` (~48px = 16 + icon + 16) so text never overlaps the icon. |
| Single icon only | Never render a Lucide `ChevronDown` (or other icon) beside a native `<select>` — that doubles the portal/CSS chevron. Custom triggers (`AdminFieldSelect`, filter buttons) may keep their own Lucide chevron. |
| Cursor | `cursor: pointer` (and on the wrapping control when the select is transparent). |
| Hover | Visible hover: darker border (`#23232B` / near-black) and/or subtle wash (`#F4F4F6`); do not change `background` shorthand in a way that drops the chevron image — use `background-color` / `border-color`. |
| Focus | Keep violet focus ring `#5F1FB0` (unchanged). |
| Disabled | No pointer / no hover wash. |

Do **not** rely on the browser’s default select arrow — it makes right padding look larger than the left text inset and often skips a pointer cursor.

Reference: `.admin-users-field select`, `.admin-users-filter-dropdown__field select`, `.admin-commission-slabs-page__country select` in `admin-users-light.css` / `admin-commission-slabs.css`; global non-admin: `portal-chrome.css`.

## Tables — row hover only when navigable

**Rule:** A table row may show hover wash + pointer **only if clicking the row navigates** (route change or opens a full detail page).

| Case | Hover? |
|------|--------|
| Row `onClick` → `navigate(...)` / link to another page | Yes — opt-in class (`tr.is-clickable`, `sa-table__clickable`, `sales-oversight-table__row--clickable`) |
| Row is display-only; actions via ⋯ menu, toggles, Review/View buttons, inline fields | **No** — never apply `tbody tr:hover` |

- Do **not** put a blanket `tbody tr:hover` on shared admin table CSS.
- Prefer opt-in: `.admin-users-table tbody tr.is-clickable:hover { background: #F4F4F6 }` (+ `cursor: pointer` on `.is-clickable`).
- Button/control hover (⋯ trigger, delete icon, toggles) is fine — that is control affordance, not row navigation affordance.
- When enhancing any page: if the table has hover but no row navigation, **remove the row hover**.

Documented in [`guidelines/UI_UX_CONSISTENCY.md`](../../../guidelines/UI_UX_CONSISTENCY.md) → **Tables (data grids)**.

## Create / edit forms — right side overlay

**Create and edit forms open as a right-side overlay (drawer), not a centered modal.**

| Rule | Detail |
|------|--------|
| When | Create / Edit / “add something” flows with a multi-field form |
| Placement | Full-height panel docked to the **right**; dimmed backdrop over the page |
| Width | ~`min(480px, 100vw)` (document exceptions for wide forms, e.g. up to 560px) |
| Surface | `#FFFFFF`, left border `#C9C9CF`, soft shadow into the canvas |
| Structure | Sticky header (title + close) → scrollable form body → sticky footer actions (Cancel + primary) |
| Footer actions | Equal-width Cancel + primary; **`min-height: 40px`** content-sized (never stretched). Create/Save labels **text only** — no Save floppy icon. Form must be `display: flex` column (`.admin-users-form.admin-side-overlay__form`); do not let page `.admin-users-form { display: grid }` stretch the footer |
| Behavior | Backdrop click + Escape close; trap focus in panel; `aria-modal="true"` |
| Fields | Same form tokens as elsewhere (gaps, borders, selects rules) — prefer **single-column** fields in the overlay |
| Validation | Follow **Validation & notices (all pages)** — field highlight, never a jumping page banner |

**Still use a centered modal for:** short confirmations only (delete, force logout, irreversible yes/no) — not for create/edit forms.

Classes: `.admin-side-overlay` / `__backdrop` / `__panel` in `admin-users-light.css`. Wide: `__panel--wide` (`560px`) for bulk CSV / multi-step create.
Multi-step create (e.g. Partners): show **step status at top of overlay** (`.admin-overlay-steps`) — active / done / upcoming; completed steps clickable.
Reference: User credentials Create/Edit; Commission slabs Create/Edit; Partners `PartnerCreateOverlay`.

Do **not** open create/edit forms as `admin-users-modal` centered cards going forward; migrate when enhancing a page.

## Accent palette (charts · card icons · pills · danger)

Use **only** these hex values for charts, icons inside cards/KPIs, status pills/badges, and destructive cues (delete / remove). Reuse the same mapping across pages.

| Hex | Typical use |
|-----|-------------|
| `#808080` | Neutral / grey series, muted icon |
| `#653AE0` | Primary accent series, brand-leaning icon/pill |
| `#E0B73A` | Warning / attention series |
| `#3A9EE0` | Info / cool series |
| `#D83AE0` | Magenta accent series |
| `#3A3FE0` | Indigo / secondary cool series |
| `#E06E3A` | Caution / warm / **red chart series**; strong delete/remove cue; **Revenue trend** line+area only |
| `#098F6A` | Success / positive series |

Rules:
- Do not mix in Figma semantic reds/greens for these UI accents unless the living MD documents an exception.
- Multi-series charts: assign colors from this list in a stable order; keep the same series→color on every page.
- **Revenue trend (sales oversight):** single-series chart must use **`#E06E3A` only** (`accentRevenueTrend` in `brandColors.js`) for stroke, fill/gradient, markers, and hover guide — never `#653AE0` on this chart. Hover: nearest-point snap across the plot, vertical guide, ring marker, tooltip with date + amount.
- Card icons / pills: pick one accent per semantic meaning and reuse (document in `UI_UX_CONSISTENCY.md` when first chosen).
- **Profile initials avatars:** soft wash of accent + accent text via `getAvatarTone` / `ProfileAvatar` / `profile-avatar.css` — never grey monochrome circles. See consistency MD → Profile avatars / initials.
- Danger (delete / remove): prefer `#E06E3A` (or document the chosen accent); keep primary page chrome B&W.

## Enhancement workflow

Copy and track:

```
UI/UX Task:
- [ ] 1. Read brand MDs + UI_UX_CONSISTENCY.md
- [ ] 2. Inspect target page (structure, density, overflow, short viewport)
- [ ] 3. Apply existing component rules from consistency MD (table, KPI, modal, etc.)
- [ ] 4. Implement visual + layout fixes (CSS first; JS only if behavior needed)
- [ ] 5. Verify ~1280×560–600 and normal desktop
- [ ] 6. Append/update rules in UI_UX_CONSISTENCY.md for anything new or changed
- [ ] 7. Summarize what changed + which consistency sections were updated
```

### Step details

**1–2. Align before inventing**  
If the page has a table and `UI_UX_CONSISTENCY.md` already defines Table rules, reuse them (actions menu, sticky column, truncation, column hide). Same for headers, KPIs, filters, modals, sidebar.

**3–4. Whole-page pass, not one widget**  
Decide composition first (see **Page composition**). Then align the chrome that page actually needs: header, optional KPIs, toolbar, primary panel, empty/loading, modals. Do not add KPI cards just because another admin page has them. Always apply **Validation & notices (all pages)** — no layout-jumping banners.

**5. Short-viewport QA**  
Layouts that look fine at large height often break near **1280×558–585**. Prefer compact chrome, scroll inside the data panel, sticky table header/actions, truncate with title/tooltip — never grow the page from long text.

**6. Consistency MD is required output**  
After every enhancement, update [`guidelines/UI_UX_CONSISTENCY.md`](../../../guidelines/UI_UX_CONSISTENCY.md):

- New pattern → add a **Component / Pattern** section with concrete rules (classes, tokens, behavior).
- Existing pattern refined → edit that section; add a dated **Changelog** bullet.
- Page-specific layout → add under **Pages** with route + key classes.

Template for a new rule:

```markdown
### Tables (data grids)
- Sticky header; sticky actions column
- Row actions: ⋯ menu (Edit / …), solid white menu surface, z-index above sticky cells
- Long text: ellipsis + native `title` or tooltip; never expand row height for content
- Row hover only when the row navigates on click (`tr.is-clickable`); no hover on action-only tables
- At compact width/height: hide secondary columns (document which)
- Reference implementation: `AdminUsersPage` + `admin-users-light.css`
```

## Design priorities

1. **Clarity over decoration** — enterprise density, clear hierarchy, one job per section.
2. **Consistency over novelty** — match living MD; do not restyle a table a second way.
3. **Brand silence** — mostly B&W; violet for focus, links, dark-surface CTAs, and approved accents.
4. **Responsive height** — as important as responsive width.
5. **Accessible interaction** — focus rings (`#5F1FB0`), keyboard close for menus/modals, visible hit targets.

## Anti-stretch / density locks (do not regress)

These bugs happened after making admin pages fill the viewport with flex/grid. **Do not repeat.**

| Bug | Cause | Locked fix |
|-----|--------|------------|
| Sidebar nav links stretched equally (tall empty links) | `.sidebar__nav` is `display: grid` + `flex: 1` → default `align-content: stretch` grows rows | `align-content: start`; `grid-auto-rows: max-content`; `.sidebar__link` fixed **46px** height |
| KPI cards tall with empty space; table “moved below” | KPI strip/cards absorbed leftover column height | KPI grid/cards `flex: 0 0 auto`; `align-items: start`; `height: auto`; padding ~`14px 16px` |
| **Progressive gap** under KPI cards (page 1 OK, page 2 larger, page 3 larger…) | `.admin-users-page` was `display: grid` with `align-content: normal` (stretch). Auto rows shared leftover viewport height; cards stayed content-sized → **phantom space under cards**. Taller headers / less table content = more leftover = larger gap | Page **must** be `display: flex; flex-direction: column; gap: 24px` (not grid). KPI grid `height: max-content; align-self: start`. **Only** `.admin-users-panel` may `flex: 1`. Card→panel gap must equal page `gap` (**24px**) on every list page |
| Only table should fill leftover height | Chrome competed with panel for flex growth | **Only** `.admin-users-panel` (main data panel) may `flex: 1 1 auto`; header + KPIs never grow |

**Before shipping any admin layout change:** open User credentials → Customer portal users → Partners → Resellers and confirm **card→table gap is identical (24px)** — measure `panel.top - card.bottom`, not only `panel.top - kpiGrid.bottom`. Sidebar nav links stay compact; KPI cards hug content.

**QA check (required):** if credentials looks tight but partners/CPU look “pushed down,” assume grid stretch / phantom KPI-row height — do not “fix” by shrinking gap tokens per page.

## Anti-patterns

- Purple-on-white marketing gradients, glow, glassmorphism, random card stacks
- Copying KPI card rows onto every admin page “for consistency”
- **Stretching** sidebar links, KPI cards, or page headers to fill leftover viewport height
- **`.admin-users-page { display: grid }`** (or any stretched auto rows) that creates progressive phantom gaps between KPI cards and the table — keep **flex column + 24px gap**
- Inventing hex outside guidelines / consistency MD
- Mid-word aggressive clamps that break sentences (“secur…”)
- Transparent sticky overlays that show table text through menus
- Full-page scroll when only the table body should scroll
- Duplicate button styles (black + purple both as primary on the same light surface)
- Native `<select>` with default OS arrow (uneven padding, no pointer cursor, weak hover)
- Create/Edit forms in a centered modal — use the **right side overlay** instead
- Overlay footer Cancel/Create buttons stretched tall (from `.admin-users-form { display: grid }` winning) — keep overlay form as **flex column**; footer buttons **40px** text-only
- Page/error/success **banners in document flow** that shift KPIs or tables — use **field highlight** + **fixed toast** on every page
- **Table row hover without navigation** — hover wash + pointer only when the row click redirects; action-only tables stay flat

## Recommended practices (always consider)

See also the recommendations section in `UI_UX_CONSISTENCY.md`. When enhancing, check:

- Empty / loading / error states match brand surfaces
- **Validation & notices:** field-level red border/shadow for input errors; fixed toast for page success/errors — **no layout-jumping banners** (all pages)
- Filter / search / export sit in one toolbar row with the panel title when space allows
- Create/Edit: right side overlay (not centered modal); delete/confirm stays centered modal
- Destructive actions confirmed; delete/remove accents from accent palette (`#E06E3A` preferred)
- Sidebar: nav scrolls, **fixed-height links (46px)**, profile + logout fixed, scrollbar hidden, shell compact ≤1280px
- KPI strip content-sized; only the main table panel flex-grows
- Card / KPI icons and pills: accent palette only; chrome icons on light stay neutral unless accent is intentional
- Charts: accent palette in stable series order across pages; Revenue trend locked red `#E06E3A` with nearest-point hover tooltip
- **Tables:** row hover only if the row navigates on click; otherwise no hover wash

## Additional resources

- Brand detail: [`guidelines/guidelines.md`](../../../guidelines/guidelines.md)
- Brand quick context: [`guidelines/GEMINI.md`](../../../guidelines/GEMINI.md)
- Living rules + changelog: [`guidelines/UI_UX_CONSISTENCY.md`](../../../guidelines/UI_UX_CONSISTENCY.md)
- Runtime tokens: `src/lib/brandColors.js`, `src/styles/brand-enforcement.css`
