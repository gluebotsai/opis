# Worktual UI/UX Consistency

Living design rules for My-Account. **Agents must read this before enhancing UI and update it after every enhancement.**

Brand token source of truth:
- [`guidelines.md`](./guidelines.md)
- [`GEMINI.md`](./GEMINI.md)

Skill: `.cursor/skills/worktual-ui-ux/SKILL.md`

---

## How to use this file

1. Before changing a page, find matching **Patterns** and **Pages** sections below and reuse them.
2. After shipping UI changes, update the relevant pattern (or add one) and add a **Changelog** entry.
3. Prefer concrete rules (tokens, breakpoints, class names, reference files) over vague taste notes.

---

## Global brand (product)

| Token / role | Value | Notes |
|--------------|-------|--------|
| Canvas | `#F4F4F6` | Main page background |
| Surface / cards | `#FFFFFF` | Panels, KPIs, tables, modals on canvas |
| Subtle bg | `#F4F4F6` | Row hover / nested wash inside white surfaces |
| Border default | `#C9C9CF` | Prefer over ad-hoc greys |
| Text primary | `#0B0B10` | Body |
| Text secondary | `#3F3F49` | Muted |
| Primary CTA (light surface) | bg `#0B0B10` / text `#FFFFFF` | Hover `#3F3F49` |
| CTA on dark / black surface | bg `#7423D7` / text `#FFFFFF` | Hover `#8650DE`, active `#5F1FB0` |
| Focus ring | `#5F1FB0` | Violet-700 |
| Font | Inter | 10 / 12 / 14 / 16 / 18 / 20 |

Do not invent chrome colors. For charts, card icons, pills, and danger (delete/remove), use the **Accent palette** only.

### Accent palette (charts · card icons · pills · danger)

| Hex | Typical use |
|-----|-------------|
| `#808080` | Neutral / grey series, muted icon |
| `#653AE0` | Primary accent series, brand-leaning icon/pill |
| `#E0B73A` | Warning / attention series |
| `#3A9EE0` | Info / cool series |
| `#D83AE0` | Magenta accent series |
| `#3A3FE0` | Indigo / secondary cool series |
| `#E06E3A` | Caution / warm / **red chart series**; preferred delete/remove cue; **Revenue trend** line+area |
| `#098F6A` | Success / positive series |

- Cycle in a stable order for multi-series charts; keep series→color identical across pages.
- Card icons / pills: one accent per meaning; document first use under Patterns.
- Page chrome stays B&W; accents are for charts, card icons, pills, destructive cues — not for primary buttons on light surfaces.

---

## Breakpoints & density

| Name | Condition | Behavior |
|------|-----------|----------|
| Shell compact | `max-width: 1280px` | Sidebar off-canvas; hamburger in shell header; `--bp-shell-compact-max: 1280px` |
| Short height | ~`max-height: 720px` (and tighter bands as needed) | Compact page headers/KPIs; scroll inside data panels |
| Target QA size | **1280 × 558–585** | Must not squash mid-word; no uncontrolled overflow |

---

## Patterns

### Shell / sidebar

- Nav (`.sidebar__nav`) scrolls; profile + Logout (`.sidebar__footer`) stay fixed at bottom.
- Hide nav scrollbar (`scrollbar-width: none` + webkit hide).
- Compact shell ≤1280px via `ShellLayout` `useMediaQuery` + matching CSS.
- Compact menu toggle (`.shell-header__toggle`): black `#0B0B10` surface + white icon; no border.
- **Shell scroll contract (locked):** `.app-shell` fills the viewport (`height: 100dvh`, `overflow: hidden`). **`main.app-content` is the default scroll container** (`overflow-y: auto`, `min-height: 0`). Never put `overflow: hidden` on `.app-content` unless a page proves an inner scroll region (table wrap / mail panes) and still keep `min-height: 0` on the flex chain. Fill-height directory pages may set `overflow: hidden` on the **page** (not main) so only the panel/`tbody` scrolls; detail/overview pages with content-sized panels should keep page/main `overflow-y: auto` so short viewports (~1280×560) never trap content.
- **Nav link height (locked):** `.sidebar__link` fixed **46px** (`height` / `min-height` / `max-height`). Nav grid must use `align-content: start` + `grid-auto-rows: max-content` so leftover sidebar height does **not** stretch links equally.
- **Nav link chrome (all portals):** icon + label only — **no** trailing chevron. Match Admin sidebar layout across sales, finance, customer, partner, reseller, number-mgmt, sales-admin.
- **Action nav items:** optional `navItem.onSelect` renders a `button.sidebar__link` (same 46px chrome) instead of a route — used for partner/reseller Lead creation opening a shell overlay.
- **Profile card → preferences popover (all `SidebarFooter` shells):** click `.sidebar__tenant--button` opens `.sidebar-preferences-menu` above the card (Theme + Sidebar). **My Profile** row appears only when `onOpenAccount` is provided → existing `AccountSettingsOverlay`. Escape + outside click close. Legacy `/admin/account`, `/account`, `/number-management/account`, `/finance/account` still open the overlay via `openAccount` state.
- **Theme:** Light / Dark / System — persisted in `localStorage` (`worktual.ui.theme`); applied as `html[data-theme="light"|"dark"]` via `uiPreferences.js` + `theme-dark.css` (semantic tokens + shared admin/portal surfaces + hardcoded light overrides). Dark canvas `#0B0B10`, surface `#15151C`, muted `#20202A`, border `#343442`. Dark **primary buttons** purple `#7423D7` / hover `#8650DE` / active `#5F1FB0` with white text. Remap `--au-*` on admin/partner/reseller/sales list pages **and NM pages** (`.nm-dashboard-page` / `.nm-mapping-page` / `.nm-customer-page`). Page intros, panel count subtitles, empty-state title/copy/icons, and search placeholders must use `--text-primary` / `--text-secondary` / `--text-caption` / `--text-placeholder` (never hardcoded `#3F3F49` / `#5E5E69` / `#0B0B10` on dark). Sticky table action columns must use surface tokens (not `#fff`) — see Tables. Sidebar stays inverse/dark. **Dark theme active nav:** `.sidebar__link.is-active` uses purple wash `color-mix(in srgb, #7423d7 36%, #0b0b10)` with light label/icon (`--text-on-dark` / `--icon-on-dark`) — not grey `#3F3F49`; inactive hover stays `--color-neutral-700`. Applies to all `app-shell` portals. Light theme keeps grey active pill on the inverse sidebar. Defaults to **Light**. `theme-dark.css` is imported in `main.tsx` after portal chrome and re-imported in `App.tsx` so dark overrides stay late in the cascade.
- **Sidebar layout:** Full (280px) / Icons only (~72px rail, labels via `title`) / Hybrid (icons by default, expand on sidebar `:hover` / `:focus-within`). Persisted as `worktual.ui.sidebarMode`. Classes: `app-shell--sidebar-*` + `sidebar--*`. Compact ≤1280 drawer ignores icons/hybrid width.
- **Hybrid expand (locked):** collapsed state **matches Icons** (mark logo, centered 46px controls, labels `display: none` — no clip-leak of first letters). Expanded (`:hover` / `:focus-within`) **matches Full** (wordmark, 24px padding, section labels, link/logout labels, Settings profile card with meta). Shell width still animates 72→280 via `--sidebar-current-width`.
- **Nav performance:** shells are React Router **layout routes** (`Outlet`) so the sidebar stays mounted across page changes; page modules stay `React.lazy`; sidebar hover/focus **prefetches** chunks via `routePrefetch.js`; page chunk Suspense uses compact `.route-loading--page` inside `app-content` (not full-app “Loading workspace…”).
- Reference: `ShellLayout.tsx`, `ShellPageOutlet.tsx`, `SidebarFooter.tsx`, `SidebarPreferencesMenu.tsx`, `uiPreferences.js`, `routePrefetch.js`, `theme-dark.css`, `AccountSettingsOverlay.tsx`, `App.tsx`, `styles.css`

### Density / anti-stretch (locked — do not regress)

**Why KPIs looked “expanded” / progressive card→table gaps:** page chrome fills the viewport. If the page is `display: grid` with default `align-content: stretch` (or a KPI strip grows with leftover height), **auto rows share leftover space**. Cards stay content-sized at the top of a taller KPI row → empty canvas under the cards that *looks* like a growing gap before the table. Pages with taller headers or less table content leave more free space, so the gap gets worse page-to-page (credentials OK → CPU larger → Partners larger).

| Element | Rule |
|---------|------|
| `.admin-users-page` | **`display: flex; flex-direction: column; gap: 24px`** — never stretched grid auto-rows. `padding-bottom: 0` |
| Page header | `flex: 0 0 auto` — content height only |
| KPI grid / cards | `flex: 0 0 auto`; `align-self: start`; `height: max-content`; `align-items: start`; `grid-auto-rows: max-content`; cards `height: auto` / `align-self: start`; padding ~`14px 16px` |
| Sidebar nav links | Fixed **46px**; nav `align-content: start` |
| Master/detail ticket list items | List pane may stretch/scroll with the split; **items stay content-sized** — `.customer-support-list` must use `align-content: start` + `grid-auto-rows: max-content`; items `height: auto` / `align-self: start` (never share leftover pane height) |
| Panel / table **empty states** (icon + title + copy) | Grid empty blocks that `flex: 1` to fill the panel must use **`align-content: center`** + **`grid-auto-rows: max-content`** so icon/title/description stay one tight cluster in the middle — never let default grid stretch separate the icon from the text (e.g. `.sales-support-empty`, `.finance-queue-empty-state`, `.nm-*-empty-state`, partner/reseller empty states) |
| Main table panel only | May `flex: 1 1 auto` so **tbody** fills remaining height and scrolls |
| Card→panel spacing | Must equal page gap (**24px**) on every list page — measure `panel.top − card.bottom` |

**Never** let KPI cards, the KPI grid row, page headers, sidebar links, **master/detail list cards**, or **empty-state grid rows** absorb leftover viewport height. Do not tune per-page gaps to paper over stretch.

Reference: `src/styles/admin-users-light.css`, `src/styles.css` (`.admin-users-page`).

### Page header + KPIs

- One clear title + short subtitle; primary CTA top-right when the page creates records.
- **KPI strip is optional.** Prefer it on directory pages where totals/active/inactive change decisions; **omit** on config/rate/slab pages — put the count in the panel subtitle instead.
- Pages do not need identical composition; shared tokens + table/toolbar patterns matter more than matching chrome.
- When KPIs are used: **content-sized** compact row (see **Density / anti-stretch**); short viewports reduce padding/font; truncate with `title`; white surface, `1px` border `#C9C9CF`, radius `12px`, no heavy shadow.
- **KPI icon accent mapping (locked, when used):** Total `#3A3FE0` · Active `#098F6A` · Inactive `#808080` · Last updated `#E0B73A` · Companies `#653AE0` · Countries `#3A9EE0`
- Prefer filling remaining height into the **main table panel only**, not stacking or stretching chrome above the table.

### Toolbars (search / filters / export)

- Prefer actions on the **same row** as the panel title (e.g. “All users”) when space allows: Search, **Download**, then **Filters** (Filters rightmost so the popover `right: 0` aligns to the toolbar end).
- Buttons: secondary outline on light (`#C9C9CF`); primary black `#0B0B10` for main affirmative; delete/remove `#E06E3A`.
- Search focus ring: `#5F1FB0`.

### Tables (data grids)

- Sticky table header; sticky actions column when row actions exist.
- **Sticky Actions / pinned columns (dark + light):** use semantic surface tokens (`var(--bg-surface)`, `var(--bg-subtle)`, or `var(--au-surface)`), never hardcoded `#fff` / `#ffffff`. Opaque sticky cells must track the theme; `theme-dark.css` keeps a high-specificity safety net with `!important` for late page CSS.
- **Actions column is always last** (far right) — dedicated `<th aria-label="Actions" />` + sticky `td:last-child` (56px). Never nest ⋯ inside Status (or any middle column).
- Horizontal overflow: `.admin-users-panel__table-wrap` uses `overflow-x: auto` (shared `overflow: auto`); give the table a **`min-width`** when columns would otherwise compress instead of scrolling (e.g. Customer portal users `min-width: 960px` / `720px` compact). Data-column widths must leave room for sticky Actions (`56px`); do not let percentages sum to 100% of the full table. Sticky Actions stay pinned on the right while scrolling.
- Row actions: **⋯ (`MoreHorizontal`) menu** — not a row of icon buttons — unless the page documents an exception. Trigger: no border (wash on hover only). **Dark theme:** trigger bg `var(--bg-canvas-subtle)` (`#0B0B10`), icon `var(--text-primary)`; hover/open `var(--bg-hover)` — not sticky-cell `--bg-surface` (button may be blacker than the Actions cell).
- Menu surface: solid `#FFFFFF`, border `#C9C9CF`, high z-index above sticky cells; min-width enough for longest label (e.g. “Force logout”).
- Anchor hugs the 34px ⋯ trigger (not the full row height). **Portaled row menus (locked when table overflow clips):** render the menu with `createPortal(..., document.body)` + `position: fixed` (`.admin-users-row-menu--portal`) and viewport-aware coords so Edit/Delete stay fully visible above following rows, the panel footer, and sticky cells — never rely on absolute menus inside `.admin-users-panel__table-wrap` (`overflow: auto`). Reference: User credentials + Commission slabs.
- Delete menu item: text `#E06E3A`.
- **Delete from ⋯ (locked):** always opens a **centered** confirm popup (`confirm-modal-overlay` / `admin-users-modal`) — never opens the Edit right overlay and never nests Delete inside the edit drawer. Apply on every admin/data table with a Delete row action (User credentials, Customer portal users, Commission slabs, Number mapping, NM customer mappings, etc.).
- Close on outside click + Escape.
- Long cell text: ellipsis + `title`; `table-layout: fixed`; never expand row height for content.
- Compact screens: hide secondary columns (document **per page**). Shared compact rules must target only the credentials table (`.admin-users-credentials-page`) — never blanket `nth-child(7|8)` on all `.admin-users-page` tables (that hides **Actions** on 7–8 column grids like Customer portal users / Partners).
- **Never hide** the sticky Actions column (`th/td:last-child` with ⋯).
- Panel fills remaining height; **tbody scrolls**, not the whole app when possible.
- **Row hover (locked):** only when the **whole row** navigates on click (route change / detail page). Opt-in class (e.g. `tr.is-clickable` / `sa-table__clickable` / `sales-oversight-table__row--clickable`) + `cursor: pointer` + subtle `#F4F4F6` wash. **No row hover** on action-only tables (⋯ menu, toggles, Review / View buttons, inline edits). Do not imply clickability when the row does nothing.
- Reference: `src/pages/AdminUsersPage.jsx`, `src/styles/admin-users-light.css`

### Status toggle (row switch)

- Use for **Active / Inactive** when the primary row control is enable/disable (not a pill-only display).
- Track off: `#C9C9CF`; track on: `#098F6A`; thumb `#FFFFFF`; focus ring `#5F1FB0`.
- Place in the **rightmost sticky column**; keep ⋯ menu (Edit / Delete) in the column before it when both exist.
- Label text optional; hide label on compact width/height. Label color: `--text-secondary` (Inactive) / `--text-primary` when `.is-on` — never hardcode `#3f3f49` (invisible on dark).
- Optimistic update + rollback on API failure.
- Reference: `AdminCommissionSlabsPage` + `.admin-slab-toggle`

### Pills & role badges (accent mapping)

| Meaning | Hex |
|---------|-----|
| Status Active | `#098F6A` |
| Status Inactive | `#808080` |
| Role Sales | `#653AE0` |
| Role Finance | `#3A9EE0` |
| Role Sales Admin | `#098F6A` |
| Role Company admin (customer portal) | `#653AE0` |
| Role Branch user (customer portal) | `#3A9EE0` |
| Support status Open | `#3A9EE0` |
| Support status In progress | `#653AE0` |
| Support status Waiting | `#E0B73A` |
| Support status Resolved | `#098F6A` |
| Support status Closed | `#808080` |
| Support priority Low | `#808080` |
| Support priority Medium | `#E0B73A` |
| Support priority High | `#E06E3A` |
| Support priority Urgent | `#D83AE0` |
| Finance queue Pending / awaiting confirmation | `#E0B73A` |
| Finance queue Awaiting payment | `#3A9EE0` |
| Finance queue Paid | `#098F6A` |
| Finance queue Rejected / failed | `#E06E3A` |
| Avatar tones | purple `#653AE0`, teal `#098F6A`, amber `#E0B73A`, rose `#D83AE0`, blue `#3A9EE0`, indigo `#3A3FE0` |

### Profile avatars / initials (global)

**Rule:** Every profile/initials circle uses the accent palette — never monochrome grey washes.

| Piece | Rule |
|-------|------|
| Palette | purple `#653AE0`, teal `#098F6A`, amber `#E0B73A`, rose `#D83AE0`, blue `#3A9EE0`, indigo `#3A3FE0` — **exclude** neutral `#808080` (reads as grey) and warm `#E06E3A` (reserved for danger/revenue) |
| Assignment | Stable hash of `id` / email / name → tone via `getAvatarTone(seed)` in `src/lib/brandColors.js` (`accentAvatarTones`) — same person always same color |
| Look | Soft wash = `color-mix(in srgb, accent 14%, #fff)` (amber 18%) + **accent-colored** initials text — no invented soft hex |
| Component | Prefer `<ProfileAvatar seed name email className="…__avatar" />` (`src/components/ProfileAvatar.tsx`) |
| CSS | Shared tones in `src/styles/profile-avatar.css` (loaded after `styles.css` / brand-enforcement so legacy grey overrides cannot win). Applies to `.admin-users-name-cell__avatar--*`, `.sa-agent-cell__avatar--*`, `.mail-*-avatar--*`, `.profile-avatar--*` |
| Company icon circles | Same tone classes when a `Building2` (or similar) sits in an avatar circle — hash the org/partner/reseller id |
| Do not | Grey `#F4F4F6` / neutral stacks for initials; solid black mail-accent for every sender; invent hex outside the accent table |

**Surfaces:** Admin User credentials, Customer portal users, Partners, Resellers (contact + company), Sales agents table + oversight dashboard agent column, Mail list + read pane sender.

Sidebar profile card stays Settings icon (not initials) — do not invent a sidebar initials avatar unless product asks.

Reference: `brandColors.js` (`getAvatarTone`, `getProfileInitials`, `accentAvatarTones`), `ProfileAvatar.tsx`, `profile-avatar.css`.

### Modals / dialogs

- Use **only** for short confirms (delete, force logout, irreversible yes/no).
- Radius `16px` card; border `#C9C9CF`; canvas white; centered.
- Primary = black on light; destructive confirm uses `#E06E3A` (danger button + delete confirm panel).
- Keep footer actions consistent: Cancel secondary, Confirm primary/danger.
- Focus rings `#5F1FB0`.
- **Invoice review (`InvoiceReviewModal`):** Regular and Temporary Lead share the same **generate_invoice.js pt template** (black WORKTUAL header with equal vertical pad / dynamic height; transparent white mark beside brand — knock out black square from `worktual-logo.png`; header meta is Invoice # + Date only — no Due Date). Pencil sheet also omits Due Date. Description must not include “Billing period …”. Payment Terms keep **Due on …** only (no Monthly/Yearly Bill range). Fixed Solution/Description/Qty/Unit Price/Subtotal columns + Financial Summary card. Pencil toggles **in-preview sheet editing**. Layout: items → amount in words + summary → **bank | note** → three footer cards (auto-grow). Preview keeps Chrome’s PDF toolbar; prefer in-app **Download PDF** (blob + invoice number). **Done** rebuilds via `buildInvoicePdfFromSheet`. Temporary Lead **Invoice contents** radios (default **All in one**). Do not invent purple chrome.

### Forms

- Gaps: 8px field internals / 16px between fields (brand gap tokens).
- Inputs: border `#C9C9CF`, radius 8px unless existing control specifies 12px buttons.
- Placeholder `#7E7E88`; focus ring violet.
- **Password strength (`.password-strength`):** accent palette only — Weak `#E06E3A` · Fair `#E0B73A` · Good `#3A9EE0` · Strong `#098F6A` (`PasswordStrengthBar.tsx`).
- **Mobile / phone compound (`.mobile-field` in admin create/edit):** outer shell only — flat white + `1px #C9C9CF` + radius **8px**, **no** drop/inset shadow. Nested dial select + number input are borderless; focus ring on the shell (`:focus-within`) matches sibling inputs (`#5F1FB0` + 3px soft wash). Do not restyle the inner `<input>` with its own border/shadow (that creates a recessed double-chrome look). Classes: `.admin-users-field--mobile .mobile-field` (`styles.css` + `admin-users-light.css`).
- **Create / Edit:** open in a **right side overlay** (see below) — never a centered modal.
- Validation / notices: follow **Validation & notices (global)** below.
- **Integer / decimal zero select (global):** when an integer-like input shows exact `0` / `0.0` (not empty, not `100`), focus/click selects the value so the next keystroke replaces it. Also strips leading zeros while typing (`04555` → `4555`) so React controlled fields stay correct even if the caret cleared the selection. Installed app-wide via `installSelectZeroOnFocus()` in `main.tsx` (`src/lib/integerInputFocus.js`). Applies to `type="number"` and `inputMode="numeric"|"decimal"` text inputs. Opt out with `data-select-zero="false"`. Phone / `.mobile-field` inputs are excluded. Non-zero values are never auto-selected on focus.

### Validation & notices (global — all pages)

**Mandatory on every page** when showing form or action feedback:

| Case | Do | Do not |
|------|----|--------|
| Input validation | Mark failing field: border `#DB4437` + soft red shadow + message under field; clear on edit | Full-width `.form-error-banner` (or success strip) in page flow that shifts KPIs/tables |
| Required field mark | Red asterisk via `.field__required` / `.admin-users-field__required` (`#C73E32` / `var(--color-danger)`) — never black text `*` | Black or muted asterisk matching the label color |
| Page success / load / action notices | Fixed top-center toast (`AdminPageToast` / `.admin-users-toast` `is-success` / `is-error`), dismissible (X) | Inline banners that reflow the page |
| Toast auto-clear | Default `autoDismissMs={2000}` on `AdminPageToast` for **both** success and error (when `onDismiss` is provided) | Persistent layout-shifting success strips; long-lived page toasts |
| Overlay/modal open + API error | Compact alert inside the overlay/form | Banner on the page behind the overlay |

Reference: `AdminPageToast.tsx`, `AdminUsersPage` (`.admin-users-field.is-invalid`, `.admin-users-field__error`, `.admin-users-toast`). Migrate older pages when enhancing.

### Side overlay (create / edit forms)

- Full-height panel docked to the **right**; dimmed backdrop (`rgba(11,11,16,0.4)`).
- Width: `min(480px, 100vw)` default; document wider exceptions.
- Surface `#FFFFFF`, left edge border `#C9C9CF`, shadow into page.
- Layout: sticky header (title + close; **no** “Admin” / section eyebrow) → **optional step status** → scrollable body → sticky footer (Cancel + primary, **equal-width** buttons).
- **Overlay form layout (locked):** `.admin-users-form.admin-side-overlay__form` must be **`display: flex; flex-direction: column`** — never let `.admin-users-form { display: grid }` win. Grid stretch inflates the footer and makes Cancel/Create buttons tall.
- **Footer buttons (locked):** content height **`min-height: 40px`** (`align-items: center`, `height: auto`); equal width; Create/Save labels are **text only** (no Save floppy icon). Match Create partner / Create slab / My account.
- Page headers: title + subtitle only — do not show `.admin-users-page__eyebrow` / “Admin” above the H1.
- Multi-step create: `.admin-overlay-steps` under header — show all steps; active `#653AE0`, done `#098F6A`, upcoming grey; completed steps clickable to revisit.
- Prefer single-column fields inside the overlay.
- Close: backdrop click, Escape, header X, Cancel/Close footer; `role="dialog"` + `aria-modal="true"`. **Dark theme:** header `.admin-users-panel__icon-button` uses canvas `#0B0B10` + light icon (hover/focus/active `--bg-hover`); bulk “Back to single user” uses `--text-secondary` / `--text-primary` (not remapped violet grey).
- **Draft minimize (typed overlays):** when the form is dirty, backdrop / Escape / header X / Cancel **minimize** to a right-edge `.side-overlay-draft-island` (Y-drag, stack, click resume, ✕ discard) — **never silently discard** typed changes. Clean forms close immediately. Shared: `SideOverlayDraftIsland`, `useSideOverlayDraftDismiss`, `sideOverlayFormDraft.js` (lead forms keep `leadFormDraft.js` + `LeadCreateDraftIsland` wrapper). Applies to User credentials create/edit/bulk, Partners, Resellers, Commission slabs, My Profile (`AccountSettingsOverlay`), Customer Support raise ticket, and sales/partner/reseller Create/Edit lead overlays.
- Classes: `.admin-side-overlay`, `__backdrop`, `__panel` (`admin-users-light.css`).
- Wide variant: `.admin-side-overlay__panel--wide` → `min(560px, 100vw)` (bulk CSV / partner / reseller create).
- Step chrome CSS: `.admin-overlay-steps*` + `--with-steps` footer in `admin-users-light.css`.
- Reference: `AdminUsersPage` Create/Edit; `PartnerCreateOverlay` (create + edit); `ResellerCreateOverlay` (create + edit); Commission slabs Create/Edit.

### Selects / dropdowns

- **Equal edge inset:** left padding of the selected text matches the chevron’s inset from the right edge (default **16px**, range 16–20px).
- Use `appearance: none` + **one** custom CSS chevron (`background-position: right 16px center`); `padding-right` ≈ `48px` so text clears the icon.
- **Never** add a Lucide `ChevronDown` sibling next to a native `<select>` (doubles the CSS chevron). Keep Lucide only on custom triggers (`AdminFieldSelect`, toolbar Filter/View buttons).
- **`cursor: pointer`** on the `<select>` (and wrapper when used).
- **Hover:** border darkens toward `#23232B` / `--border-strong` and/or subtle wash (`--bg-subtle` / light `#F4F4F6`); preserve chevron via `background-color` (not `background` shorthand).
- Focus ring remains `#5F1FB0`; disabled: no pointer / no hover. **Never** flash white fill on `:focus` / `:active` / open.
- **Surfaces:** prefer `background-color: var(--bg-surface)` + `color: var(--text-primary)` + `border-color: var(--border-default)` on native selects and `AdminFieldSelect` triggers — do **not** hardcode `#fff` / `#ffffff` (breaks dark theme when page CSS loads after `theme-dark.css`).
- **Admin dropdowns that must open below:** do **not** rely on native `<select>` popup positioning (OS menus center on the current value and cover the field). Use `AdminFieldSelect` — light: white menu `#FFFFFF`, border `#C9C9CF`; **always opens below** the trigger (`top: trigger.bottom + 4`), portaled to `document.body`, `max-height` scroll if viewport is short. Selected option: light violet wash + check icon. Option rows use **transparent** background (inherit menu surface) — never hardcode white on `__option`.
- **Dark theme (`html[data-theme="dark"]`):** portaled menus escape page wrappers — style globally under `html[data-theme="dark"]`. Menu surface `--bg-surface`, border `--border-default`, option text `--text-primary`, hover `--bg-hover`, selected violet wash on surface, check `#8650de`. No white option rows with light text. Safety-net: `theme-dark.css` (`.admin-field-select__menu` / `__option`, row menus, filter popovers, sidebar prefs, workspace/checkbox dropdowns, export menus).
- **Dark native selects:** rest / hover / focus / `:active` use `--bg-canvas-subtle` (hover `--bg-hover`) + light text + muted chevron SVG. Do **not** use `background` shorthand on selects (wipes chevron). Covers Product pricing Region (`.admin-pricing-region-select`), admin filter/field selects, leads/finance/partner/NM/SA period+sort filters, portal-chrome non-admin selects. `select option` surfaces use `--bg-surface`. Transparent page-size controls keep chevron only (no solid white shell).
- **Filters popover + portaled menus:** outside-click close must ignore `.admin-field-select__menu` via `isAdminFieldSelectMenuTarget` — otherwise choosing Role/Status closes the drawer before the value applies. Panel header stays `z-index: 8` + filter dropdown `z-index: 40` so the popover paints above the table body. Filters control is **rightmost** in the toolbar; popover `right: 0`.
- Applies to: User credentials form fields; Cancellation status + execution timing; Filters drawers (Users / CPU / Partners / Resellers / slabs); Commission country toolbar (`admin-field-select--toolbar`); Admin Product pricing Region.
- Reference: `AdminFieldSelect.tsx` + `admin-users-light.css` + `admin-pricing.css` + `theme-dark.css`. Native selects may remain for page-size / period / sort controls (OS popup not fully CSS-themeable).

### Empty / loading / error

- Empty: short message + optional secondary CTA; no decorative illustration spam.
- Loading: existing spinners/skeletons; keep layout stable (no jump).
- Field/page feedback: see **Validation & notices (global)** — not layout-shifting banners.

### Truncation & tooltips

- Prefer CSS ellipsis + `title` or existing tooltip pattern.
- Avoid mid-word clamps that destroy readability on short height (login copy lesson).

### Buttons (quick map)

| Variant | When |
|---------|------|
| Primary dark | Main action on white/light |
| Alt violet | Main action on black/dark chrome, or brand link emphasis |
| Secondary | Cancel / secondary |
| Tertiary / ghost | Low emphasis |
| Danger | Delete / destructive |

---

## Pages

### Quote — Choose products (`products-page--select`)

- **Composition:** full-page wizard step on canvas `#F4F4F6` (`--bg-canvas-subtle`) — **not** a centered modal / floating sheet.
- Header (Back + title + subtitle) + toolbar (count + Select all) sit on the canvas; **only product cards** are white `#FFFFFF` surfaces (`border #C9C9CF`).
- Do **not** wrap select stage in bordered/shadowed `max-width` panel chrome (`.products-panel` sheet styles are neutralized under `--select`).
- Grid: 3 cols desktop → 2 cols mid → 1 col compact; cards stay tappable select tiles (check + optional Active status).
- **Next** stays in a sticky bottom action row on the canvas (not trapped in a short centered card).
- Assign-branches / invoice-review may keep the denser panel sheet (`products-panel` / `--configuring`). Set pricing uses the flat canvas pattern (see below).
- Reference: `ProductWorkflowPage.tsx`, `.products-page--select` in `styles.css`

### Quote — Set pricing (`products-page--configure`)

- **Composition:** full-page wizard step on canvas `#F4F4F6` — same chrome philosophy as Choose products; **not** a centered modal / floating sheet.
- Applies to **all products** in configure stage via stage class — not product-specific selectors: **CCAAS** (`ccaas`), **CRM** (`crm`), **CDP** (`cdp`), **Campaign** (`campaign`), **Value Management** (`value-management`), **Ticketing** (`ticketing`), plus **Generic** fallback.
- Header: Back + **Set pricing** title only — **no** “N of M products ready” subtitle (`header.products-header > p` omitted when `stage === "configure"`). Choose products / assign-branches keep their status copy.
- **No** toolbar count (“N products in quote”) on configure — omit `.products-toolbar` when `stage === "configure"`; select / assign-branches keep theirs.
- Product progress chips (`.pricing-progress`) sit content-sized on the canvas under the header.
- **Surfaces on canvas:** white `.pricing-form` + white `.pricing-summary` (`border #C9C9CF` / `--border-default`, radius **8px**); no outer `.products-panel` sheet; nested card shadows softened/removed under `--configure`.
- **Pricing summary Current product (locked):** top block is `.pricing-summary__current` — `#F4F4F6` wash, 1px `#C9C9CF`, 8px radius, stacked **Current product** eyebrow (caption grey, not violet) + product name + optional billing cycle + helper note. Metric rows / lines / Final Payable use the same `#C9C9CF` tile chrome; Final Payable uses neutral wash (no violet border/text). Quote switcher list under **In this quote** (`.configured-products`) separated by a top divider.
- **Temporary Lead period / due date:** summary stacks **Period** (Start + End in a 2-col grid) then a separate **Due date** row above Final Payable. Labels left-align above inputs (`.pricing-summary__period` / `__due-date` override the default `dl div` space-between row). Entire date tile (`.pricing-summary__date-field`) is clickable and opens the native calendar via `showPicker()`. Selected `dueDate` drives invoice Payment Terms “Due on …” **and** the PDF header **Due Date** line (under Date) when set.
- **Temporary Lead — no catalog defaults / nothing mandatory:** finance-only Temporary Lead Set pricing starts empty/zero for **all products**. `zeroCatalogDefaults` clears initial prices/qty; implementation fee and other fields are **not required** — user can Send Invoice at all zeros and edit amounts on the review sheet. Selecting a CCAAS plan still does not seed catalog volumes/rates. Normal sales leads keep catalog defaults and required-field validation.
- **Progress chips (`.pricing-progress__item`):** 1px `var(--border-default)`; active (`.is-active`): light wash `#F4F4F6` / `--color-neutral-100` + same thin grey border — **no** black `--btn-primary-bg` ring. Brand-enforcement must not re-apply black border.
- **Current Product list (`.configured-product`):** 1px `var(--border-default)` (`#C9C9CF`), radius **8px** (same as summary metric/line tiles). Active (`.is-active`): light wash `#F4F4F6` / `--color-neutral-100` only — **no** black ring, thick outline, inset bar, or purple glow. Brand-enforcement must not re-apply `--btn-primary-bg` ring on these buttons.
- **Section order (locked — match CCAAS):** Base plan / modules / configuration → **Add-ons** → **Implementation** (fee + implementation discount, when shown) → **Discount last** (`PlanDiscountSections`: monthly plan discount + add-on discount; mid-period addons-only shows add-on discount only). Do not place plan/add-on discount blocks above Add-ons. Generic: base fields → usage/notes → Discount section at bottom.
- **Shared package chrome (`.pricing-package` / accordion — CRM / CDP / Campaign / Value Management / Ticketing):** major sections use the **same accordion** as CCAAS (`.ccaas-pricing-panel` / `.ccaas-collapse-toggle` via shared `PricingCollapsePanel`). Click the section header to open/close (chevron rotates when `.is-open`). **Default open:** Base Plan (or Add-ons when mid-period addons-only); Add-ons / Implementation / Discount start **collapsed** until clicked — match CCAAS Modules-open / Config+Add-ons-closed. **Do not** put a package/base-plan `FeatureEnableToggle` in `.ccaas-collapse-header__end` — Base Plan content is always accessible via the accordion; packages are enabled when shown (seeded on create; quote inclusion also derives from filled seats/price fields). Inner body: `.pricing-package__base` section dividers + `.pricing-package-addons` / `.ccaas-addon-section` rows; flush body when add-ons scroll panel is the direct child. Package scrolls add-ons internally on short viewports (`max-height` + `overflow: auto`).
- **Toggles — when allowed:**
  - **Keep** `FeatureEnableToggle` / `.feature-switch` for: (1) CCAAS mid-period **agent seats** and **phone numbers** only (content toggles **inside** add-ons body — not accordion header package switches); (2) `BillingCycleToggle` (billing cycle, not add-on enable).
  - **Do not** use switches for Base Plan / package enable in accordion headers, or for CRM / CDP / Campaign / VM / Ticketing / Generic add-on rows, contact/ticket slabs, or Campaign’s whole Add-on package.
  - Checkboxes: multi-select only (renewal add-on list, language `CheckboxDropdown`) — not for single add-on enable.
- **Add-ons pattern (non-CCAAS + CCAAS channel packs):** always-visible fields in `AddonStaticSection` / `QuantityRateAddonSection` (title + caption + qty/rate grid). Enable flags sync from values (`count > 0` or slab ≠ None) — no reveal-on-toggle. Contact / ticket slabs: select with **None** (same interaction as CCAAS channel-wise). White surface, `#C9C9CF` border, 8px radius, section headers, shared spacing.
- **Native selects** in `.pricing-hierarchy` / `.pricing-form-grid` / `.pricing-section` / `.pricing-package-addons` / `.ccaas-addons`: equal **16px** inset, one CSS chevron, `cursor: pointer`, hover `#23232B` border / `#F4F4F6` wash — never Lucide chevron beside `<select>`.
- **Accordion panels (all Set pricing products — `.ccaas-pricing-panel` / `.ccaas-plan-picker`):** white surface, 1px `--border-default` (`#C9C9CF`), radius **8px** (match `.pricing-form`). Collapse toggle: white header + `#F4F4F6` hover wash; chevron muted secondary; focus ring `--login-accent-700` (`#5F1FB0`); **equal row height** — `min-height: 66px` (62px ≤720px height) + `.ccaas-collapse-toggle__copy` always reserves title + 16px caption line (empty `&nbsp;` when no description). Invalid accordion uses field-danger wash (not a page banner). Shared helper: `PricingCollapsePanel` (also powers `PricingPackage` / `PricingSection` for Implementation + Discount). CCAAS plan picker: click header (or reopen after select) to expand plan cards — same open-on-click language. Generic: Base pricing + Discount panels.
- **CCAAS Configuration table (`.ccaas-config-table-wrap` / `.ccaas-config-table`):** ITEM | RATE | TOTAL grid for qty/rate/total edit fields. Sticky uppercase header on `#F4F4F6`; row dividers `--color-neutral-100`; **no row hover** (inline edit, not navigable). Inputs: 1px `#C9C9CF`, radius 8px, compact `min-height` 36px (32px ≤720px height), tabular nums, focus `#5F1FB0`, invalid field-level danger only. Unit hints (Rate/Agent etc.) stay caption under headers — not cluttered KPI chrome. Wrap scrolls internally (`max-height` + `overflow: auto`; tighter ≤720px height / ≤640px width) so the page does not explode. ≤640px: stacked row cards (thead hidden).
- **CCAAS Add-ons (`.ccaas-addons` / `.mid-period-addons`):** one clean panel under the Add-ons accordion — **no nested grey cards**. Agent seats / phone numbers use **toggle rows** (`FeatureEnableToggle`): compact title + caption + switch when off; reveal qty/rate fields inline when on. Channel-wise: denser **2-col** grid ≥720px; each channel is a thin bordered row (select + optional count/price) — **no row hover** (not navigable). Do **not** copy agent/number toggles onto other products’ add-ons.
- **Wide:** `.pricing-layout` grid `1fr | 320px` with sticky summary (`top: 16px`).
- **≤1023px:** stack summary under form (`grid-template-columns: 1fr`; summary `position: static`).
- **Validation (all products):** on Next/continue, highlight **each** invalid control (`.field--invalid` danger border + soft glow) with a short `.field__error` message **under the field** (Implementation Fee, base price/seats, slabs, etc.). Open the accordion that owns the error (`PricingCollapsePanel` `invalid` / `defaultOpen`). Footer may repeat the first specific message; do **not** rely on a generic banner alone. Clear highlights when the user edits (`updateActiveConfig`). CCAAS keeps module/config/add-on invalid markers; non-CCAAS uses `getProductConfigFieldErrors`.
- **Actions:** sticky bottom footer (`.products-actions.pricing-actions`) — Previous + Save & Next / Review invoice — same sticky pattern as select Next.
- **Short viewport (≤720px height):** compact header/padding; form body scrolls; sticky footer stays usable (~1280×560–600); CCAAS config table + add-ons / `.pricing-package-addons` scroll inside their panels.
- Do **not** regress Choose products (`--select`) when editing configure chrome.
- Reference: `ProductWorkflowPage.tsx` (`PricingCollapsePanel` / `ProductPricingForm` + product forms / `AddonStaticSection` / `QuantityRateAddonSection`), `.products-page--configure` / `.ccaas-pricing-panel*` / `.ccaas-collapse-*` / `.pricing-package*` / `.ccaas-config-table*` / `.ccaas-addons` in `styles.css`

### Mail — Workspace (`/mail`)

- **Composition:** folder sidebar + toolbar + list/read (or Signature/Templates panels). Fill-height flex column; only workspace panes scroll.
- **Notices:** ephemeral load/OAuth/send/API errors and success → fixed top-center pill toast (`AdminPageToast` `variant="pill"`). Auto-clears in 2s (success and error). **No** in-flow `.mail-page__notice-card` banners — they must not push the toolbar or message list.
- **Persistent status chrome:** `.mail-page__outlook-connect` while redirecting to Microsoft sign-in (in-flow banner). **Mailbox not configured** (MS env missing — `!needsOutlookConnect && !mailReady`) → amber **pill on the right of `.mail-topbar`** (`.mail-topbar__status-pill--warning`), not a full-width card above the toolbar. Detail in `title`; × dismisses for the tab session (`worktual.mail.setup-banner-dismissed`). `.mail-page__banners` only when Outlook connect is active.
- **Outlook connect retry:** when `needsOutlookConnect` after skipped/cancelled/timed-out auto-connect, show content-sized black **Sign in with Microsoft** (`.mail-topbar__connect-outlook`) — not the amber env pill. Click clears pending OAuth flags and restarts Microsoft OAuth (no redirect loop). Empty list copy points to that toolbar control. Compose finance page shows the same CTA when disconnected.
- List load errors also route through page toast (not inline in the list pane).
- **≤1023px read open state (locked):** list hides via `.mail-list-shell.is-mobile-hidden` when a message is selected; `.mail-read-shell.is-open` shows the shell. Read content visibility is `.mail-read-shell.is-open .mail-read-pane` (and `.mail-read-pane.is-open` for compose/signature). Do **not** require `is-open` only on the pane for reading — that blanked the screen. `.mail-read-pane__back` clears selection and returns to the list.
- Reference: `MailPage.tsx`, `.mail-page*` in `styles.css`

### Mail — Folders sidebar

- Sidebar folders: **Inbox · Sent Items · Drafts · Archive · Junk Email** (+ Signature / Templates below).
- **Removed from sidebar:** Deleted Items, Notes, Conversation History.
- Drafts / Archive / Junk use the same list/detail APIs as Inbox/Sent (Graph well-known or IMAP candidates). If the mailbox lacks the folder, show empty + “not available” — do not hard-error.
- Move menu destinations: Inbox · Archive · Junk · Deleted Items (Deleted is move/delete only, not a nav item).
- Reference: `MailFolderSidebar.tsx`, `mailUi.js` (`MAIL_FOLDER_OPTIONS`, `MAIL_MOVE_FOLDER_OPTIONS`), `backend/.../mail/folders.ts`

### Mail — Signature (`MailSignaturePanel`)

- **Composition:** config form — header + HTML editor + preview (no KPI; no TipTap for signatures).
- Signatures must preserve pasted Outlook/Gmail HTML (tables, images, links, social icons). Use `MailHtmlSignatureEditor` (contentEditable + `mailHtmlPaste.js`), not TipTap — ProseMirror strips signature markup.
- Paste: prefer `text/html`; full signature blocks replace editor contents; preview uses `MailMessageBody` iframe (`sandbox="allow-same-origin"`).
- **Short viewport (≤720px):** keep the HTML editor visible — hide paste hint, clamp editor `min-height` to 120px, cap preview `max-height` (~120px / 20vh) with scroll; preview `MailMessageBody` uses compact min/max heights.
- Primary Save: black `#0B0B10`, text only; notices via `AdminPageToast` pill.
- Reference: `MailSignaturePanel.tsx`, `MailHtmlSignatureEditor.tsx`, `mailHtmlPaste.js`

### Mail — Templates (`MailTemplatesPanel`)

- **Composition:** config form — header + **New/Edit template** surface + **Saved templates** list (no KPI row).
- Canvas: white pane in mail workspace; form + list are bordered `#C9C9CF` surfaces (radius 12px).
- Header: icon tile (accent `#3A3FE0`) + title + one supporting line; compact **Shared** pill (not a loud eyebrow).
- Validation: name required — field highlight `#DB4437` + message under field. Success/errors → fixed `AdminPageToast` pill (no layout-jumping banners).
- Primary Save / Update: black `#0B0B10`, **text only** (no floppy icon), `min-height: 40px`.
- Delete: text action `#E06E3A`; confirm stays centered (`window.confirm` ok for short delete).
- Saved table: sticky header; ellipsis + `title`; **no row hover** (actions only). Empty state with short copy.
- Reference: `MailTemplatesPanel.tsx`, `.mail-templates-panel*` in `styles.css`

### Mail — Compose (`MailComposePanel`)

- **Composition:** overlay compose form — New message chrome → **formatting toolbar** → To / Cc / Bcc / Subject → message body → **auto signature block** → sticky footer actions.
- Toolbar sits **directly under** “New message” (not below Subject). Implemented via `MailRichEditor` `beforeContent` slot for address/subject rows.
- **Density (locked):** chrome `40px`; To/Subject rows fixed `36px`; toolbar controls `24px`. Compose editor is flex column so only the body grows — never stretch toolbar/fields.
- **Formatting toolbar (locked):** single horizontal row (`.mail-editor-toolbar__scroll`) — `flex-wrap: nowrap` + `overflow-x: auto` (thin scrollbar). Do **not** wrap controls onto a second line on narrow/short viewports.
- **Signature (locked):** when a saved signature exists, show it automatically under the body as `.mail-compose__signature` (HTML via `MailMessageBody`, not TipTap). Appended on send via `appendSignatureToHtml` (skip if already present). Pencil toolbar control scrolls to this block.
- **Short viewport (locked):** signature must **not** push the body off-screen. `.mail-compose__signature` uses `flex: 0 1 auto; min-height: 0; max-height: min(160px, 26vh)` (tighter ≤720px / ≤600px); overflow scrolls. `MailMessageBody` in compose uses `minHeight={40}` + `maxHeight={220}` (read pane keeps 200 floor). Editor keeps `min-height` ≥96–140px.
- **No** bottom “Attachments / Attach files” block — attach via toolbar paperclip; chips only when files are selected.
- Footer: **Cancel** and **Send** equal width (`grid` `1fr 1fr`), compact ~36px height.
- Reference: `MailComposePanel.tsx`, `MailRichEditor.tsx`, `MailMessageBody.tsx`, `.mail-compose*` / `.mail-rich-editor--compose` in `styles.css`

### Login (`/login`)

- Stage canvas `#F4F4F6`; form panel `#FFFFFF` + border `#C9C9CF`; story stays dark `#0B0B10`.
- Primary CTA on light form: black `#0B0B10` (Sign in stays `--btn-height-lg` / 48px).
- Header **Contact Us**: violet on black; **same height as Sign in** (`min-height: 48px`, `font-size: 16px`) so the CTA pair feels balanced. Short-height header ≥`56px` so the button fits.
- Reduce purple marketing gradients on story headline; keep Inter.
- **No clipped story copy:** short viewports (`max-height: 720px`) must keep `.login-stage` scrollable (`overflow-y: auto`), story/form `overflow: visible`, content `justify-content: flex-start`, and bottom padding (≥24–36px). Never `overflow: hidden` on story that cuts the last feature line.
- Status: iterated for short-height; card must not feel squashed; avoid mid-word ellipsis on feature copy.
- Reference: `src/pages/LoginPage.tsx`, `src/styles.css`, polish in `src/styles/portal-chrome.css`

### Login — Reset password modal (`.login-forgot-dialog`)

Short centered auth modal (not a create/edit side overlay). Exception to “modals = confirms only” because the reset flow is a short multi-step auth dialog on `/login`.

| Piece | Rule |
|-------|------|
| Surface | `#FFFFFF`, border `#C9C9CF`, radius **8px**, Inter |
| Layout | Flex column: sticky header + scrollable `__body` + sticky `__footer` — do not clip CTAs on short viewports (`max-height: min(560px, 100dvh − 32px)`) |
| **Step-aware copy** | Helper under title only for current step: **email** (admin-mailbox / no platform-admin note) · **otp** (code sent to email) · **password** (choose new password) · **done** — **no** 6-digit / mailbox helper |
| Validation | Field highlight `.field--invalid` + `.field__error` under control; clear on change. API errors = compact `.login-forgot-dialog__alert.is-error` inside body — never a page banner |
| Success | `.login-forgot-dialog__alert.is-success` (`#0E8F50` on `#F6FBF9`) is the primary message; footer CTA **Back to sign in** (black, 40px, text-only) |
| Fields | Focus ring `#5F1FB0`; password rows use `.login-reset-password-field` + visibility toggles; strength meter accent tones (Weak `#E06E3A` · Fair `#E0B73A` · Good `#3A9EE0` · Strong `#098F6A`) |
| Primary CTA | Black `#0B0B10`, `min-height: 40px`, text-only (Send code / Verify code / Update password) |

Classes: `.login-forgot-dialog`, `__backdrop`, `__card`, `__header`, `__helper`, `__form`, `__body`, `__footer`, `__cta`, `__alert`, `.login-reset-password-field`. Reference: `LoginPage.tsx` + `styles.css`.

### Non-admin portal chrome (shared)

- Shared file: `src/styles/portal-chrome.css` (imported from `main.jsx`). **Does not** restyle `.app-shell--admin`.
- Canvas `#F4F4F6` on all non-admin shells (sales, sales-admin, finance/number-mgmt, partner, reseller, customer).
- Surfaces `#FFFFFF` + border `#C9C9CF` for common panels/cards (onboarding-card, KPI cards, directory panels, finance queue, table-card).
- Equal-height card rows: `align-items: stretch` + `grid-auto-rows: auto` (or `1fr` only within a content-sized strip) on `.sales-dashboard-summary`, `.admin-users-kpi-grid` (number-mgmt), `.products-grid`. **Lead customer detail** `.lead-dashboard-stats` uses `grid-auto-rows: auto` + content-sized strip (anti-stretch). **Not** `.sa-kpi-grid` leftover-viewport stretch.
- Finance quotation queue: directory **table** + Review opens wide right overlay (no master/detail split).
- Native `<select>` in non-admin shells + login: appearance none, **one** chevron at `right 16px`, padding `16px` / `~48px`, hover border `#23232B` + wash `#F4F4F6`, focus `#5F1FB0`. Do not add Lucide chevrons beside native selects.
- Table row hover only with `.is-clickable` / `.sa-table__clickable` (covers `.sa-table`, `.data-table`, `.admin-directory-table`, `.leads-table`, finance product table).
- Page notices on customer / sales oversight / finance: `AdminPageToast` (no layout-jumping banners).
- Light polish targets: Partner/Reseller dashboards & lists, Customer dashboard KPI rows.
- Charts: `accentChartSeries` in `brandColors.js` for multi-series / funnel (not greyscale).

### Finance — Quotation queue (`/finance/queue`)

- **Composition:** directory table — header + **one** white panel (no KPI row). Toolbar in panel header: search + status `<select>` + Refresh.
- **Chrome:** page `display: flex; flex-direction: column; gap: 24px` (`.finance-queue-page`); panel `flex: 1` fills leftover viewport; **tbody area scrolls** (sticky thead). Canvas `#F4F4F6`; panel `#FFFFFF`; borders `#C9C9CF`.
- **Scroll:** `.app-content` must remain scrollable (`overflow-y: auto`); page/panel may use `overflow: hidden` so the table wrap is the preferred scroller — never lock `overflow: hidden` on main alone.
- Header: title + subtitle only (no “Finance review” eyebrow).
- Table columns: Company, Tenant, Branch, Amount, Status, Submitted, Review. Cells ellipsis + `title`. **No row hover** — actions via Review only.
- **Status pills (accent):** Pending / awaiting confirmation `#E0B73A` · Awaiting payment `#3A9EE0` · Paid `#098F6A` · Rejected / failed `#E06E3A`.
- **Temporary Lead badge:** grey pill (`.finance-queue-temporary-badge`) beside company name in the table and review overlay header. Approve success copy is **“approved for record”** — no “payment link sent”. Confirm modal skips Stripe/Razorpay for temporary rows.
- **Review:** right **side overlay** (`.finance-queue-overlay`, wide `min(720px, 100vw)`) with invoice actions + approve/reject/payment flows; sticky header + scroll body + Close footer; Escape / backdrop close.
- **Approve gateway errors:** 502/503/504 (or timeout copy) must tell finance the lead/quote was **not deleted** — refresh the queue and retry. Backend approve loads quotations **without PDF base64** and bounds payment-link creation (~18s) with revert-to-pending on failure. Temporary quotes skip payment-link issuance entirely.
- Filter select: equal 16px inset, custom chevron, pointer, hover wash.
- Empty: distinct copy for no data vs no filter/search match + Clear filters.
- Notices: `AdminPageToast` (no layout-jumping banners).
- Reference: `FinanceQueuePage.tsx`, `.finance-queue-*` in `styles.css`

### Finance — Partner commissions (`/finance/commissions`)

- **Composition:** directory — header + **Partners** panel (aggregated) + **Commission slabs** panel (**no KPI row** on list).
- **Chrome:** `.admin-users-page.finance-partner-commissions-page` — flex column + **24px** gap; canvas `#F4F4F6`; H1 **1.35rem**.
- **Nav:** Finance sidebar has **no** standalone Commission slabs item — slabs live on this page only. Legacy `/finance/commission-slabs` redirects here. Admin manage slabs stays at `/admin/commission-slabs`.
- **Partners panel:** one row per partner (no Deal column); columns Partner · Generated · Pending · Paid out · Deals · Status. Rows **navigable** (`tr.is-clickable`) → `/finance/commissions/partners/:partnerId`. Status filter in **Filters** (Pending / Paid / All; **default All**). Footer: **Rows** 10/20/50 + prev / page / next (`admin-users-panel__footer`). Empty: Inbox.
- **Slabs panel:** `CommissionSlabsReadonly` `variant="panel"` — Country in **Filters** popover; admin table; view only.
- Notices: `AdminPageToast` only.
- API: `GET /api/finance/commissions/partners`.
- Reference: `FinancePartnerCommissionsPage.tsx`, `CommissionSlabsReadonly.tsx`, `finance-partner-commissions.css`.

### Finance — Partner commission overview (`/finance/commissions/partners/:id`)

- **Composition:** analytics/detail — black **← Back** + header + **4 KPIs** (Generated `#653AE0`, Pending `#E0B73A`, Paid `#098F6A`, Leads vs customers `#3A9EE0`) + content-sized partner details + **Deals** fill panel only.
- **Partner details:** `flex: 0 0 auto` (must beat shared `.admin-users-page .admin-users-panel { flex: 1 }`) — no phantom bottom gap.
- **Deals table:** Deal · amount · rate · commission · status · payout (**Mark paid** inline on pending). **No row hover** (action column). Footer: **Rows** 10/20/50 + prev / page / next (`admin-users-panel__footer`, same as User credentials).
- **UTR / Mark paid:** shared `validateUtr` / `sanitizeUtrInput` (`^[A-Z]{4}[0-9]{12,20}$` — 4 capital letters + 12–20 digits). Field-level invalid on `.finance-partner-commissions-payout-form__field.field--invalid` + `.field__error` under the UTR input (danger border `#DB4437`); sanitize strips non-alphanumeric and uppercases while typing; block Mark paid when invalid. Same rules for finance queue manual payment reference. No page banner for format errors.
- API: `GET /api/finance/commissions/partners/:id`.
- Reference: `FinancePartnerCommissionDetailPage.tsx`, `finance-partner-commissions.css`, `utrValidation.js`.

### Partner / Reseller portals

- Same non-admin chrome via `portal-chrome.css` + shell classes `.app-shell--partner` / `.app-shell--reseller`.
- Partner role badge: `.customer-portal-role-badge.is-partner` — white surface, border `#C9C9CF`, text `#3F3F49` (not purple `is-admin`). Defined in `portal-chrome.css`.
- Reseller role badge: `.customer-portal-role-badge.is-reseller` — same B&W treatment (`reseller-portal.css`).

### Partner / Reseller — Create lead overlay + draft island

- **Composition:** create opens a **right side overlay** (`admin-side-overlay` / `LeadCreateOverlay`) — not a full-page wizard. Same chrome as sales Create lead.
- **Shell mount:** `PortalLeadCreateProvider` on `PartnerShell` / `ResellerShell` so overlay + draft islands **persist across portal routes** (dashboard ↔ referrals ↔ bank / renewals).
- Partner **and** reseller sidebars have **no** Create lead nav item — create via page header / empty-state CTAs (`startCreateLead`). Legacy routes `/partner/lead-creation` and `/reseller/create-lead` redirect with `state.openCreate`.
- **Draft minimize (all portal create overlays):** backdrop / Escape / Minimize / Cancel keep a session when the form has data — empty forms discard. With data → right-edge `.lead-create-draft-island` (Y-drag, stack, resume / discard). Shared with sales via `useLeadCreateSessions` + `LeadCreateDraftIsland` + `leadFormDraft.js` (`shouldLeadOverlayMinimizeOnDismiss`).
- Modes: `mode="partner"` → `createPartnerLead`; `mode="reseller"` → `createResellerLead`; sales stays `mode="sales"` on ProductsPage.
- Success: shell `AdminPageToast` (auto-clear 2s); overlay closes.
- Reference: `PortalLeadCreateProvider.tsx`, `LeadCreateOverlay.tsx`, `OnboardingPage` `variant="overlay"`, `PartnerShell` / `ResellerShell`.

### Reseller — Dashboard (`/reseller/dashboard`)

- **Composition:** analytics/overview — header + **3 KPIs** + recent-leads panel.
- **Chrome:** `.admin-users-page.reseller-dashboard-page` — flex column + **24px** gap; canvas `#F4F4F6`.
- Header CTA **Create lead** → shell overlay. KPIs: Active `#098F6A` · Renewals due `#E0B73A` · Total `#3A3FE0`.
- Recent leads: navigable rows → detail; empty state with Create lead.
- Notices: `AdminPageToast`. Reference: `ResellerDashboardPage.tsx`, `reseller-portal.css`.

### Reseller — Leads (`/reseller/leads`)

- **Not a sidebar nav item** — removed from `ResellerShell` (nav: Dashboard / Renewals / Invoices). Route kept for deep links and dashboard recent-leads navigation.
- **Composition:** directory — header + one panel (**no KPI**). Search + pagination; navigable rows; status pills; empty vs filtered-empty.
- Create lead CTA → shell overlay. Compact hide Tenant ID / Created.
- Reference: `ResellerLeadsPage.tsx`.

### Reseller — Renewals (`/reseller/renewals`) · Invoices (`/reseller/invoices`)

- **Composition:** directory tables — header + one panel (**no KPI**). Search + pagination; accent status/type pills; **no row hover** (not navigable).
- Empty vs filtered-empty. Notices: `AdminPageToast`.
- Reference: `ResellerRenewalsPage.tsx`, `ResellerInvoicesPage.tsx`.

### Reseller — Lead detail (`/reseller/leads/:id`)

- **Composition:** detail — header + **company profile panel** + **subscriptions panel** (**no KPI**).
- **Chrome:** `.admin-users-page.reseller-lead-detail-page` — flex column + **24 / 20 / 16** gap; canvas `#F4F4F6`; **full-width** panels (`max-width: none`, `width: 100%`) — do not constrain to 800px.
- Profile panel content-sized; **only** subscriptions (`.reseller-detail-panel--fill`) `flex: 1` and fills leftover height; empty/loading shells also use `--fill`.
- Header: **← Back to leads** black text button (`#0B0B10`, underline on hover, violet focus ring) + company title + subtitle (`Tenant ID · Status`). No page eyebrow (shell badge covers company).
- Profile grid: **3 columns** desktop (>900), **2** mid (≤900), **1** ≤640; fields Contact, Work email, Created, Billing address (full-width, 3-line clamp). Long contact/email: ellipsis + native `title`.
- Subscriptions: sticky thead `admin-users-table` in scrollable wrap; **no row hover** (display-only). Empty state Inbox + copy (`.reseller-lead-detail-empty`, `align-content: center` + `grid-auto-rows: max-content`) fills panel body.
- Notices: `AdminPageToast` for load errors (no in-flow banner).
- Compact ≤720px height: clamp subtitle; tighten panel/grid padding and page gap.
- Reference: `ResellerLeadDetailPage.tsx`, `reseller-lead-detail.css`, `reseller-portal.css` (shared shell/list).

### Partner — Dashboard (`/partner/dashboard`)

- **Composition:** analytics/overview — header + **2 KPIs** + **one** recent-referrals panel (not a lone CTA card).
- **Chrome:** `.admin-users-page.partner-dashboard-page` — flex column + **24px** gap; canvas `#F4F4F6`. KPI strip content-sized (`max-width: 640px`, 2 columns); **only** `.admin-users-panel` flex-grows; tbody scrolls.
- Header: title + subtitle; primary CTA top-right **Lead creation** opens shell overlay (not a route). No page eyebrow (shell badge covers company context).
- **KPI icon accents:** Active referrals `#098F6A` · Awaiting assignment `#E0B73A`.
- Panel: **Recent referrals** (up to 8) + **View all** secondary → `/partner/leads`. Rows **navigable** (`tr.is-clickable`) → `/partner/leads/:id` with hover wash.
- Empty state: centered Inbox + copy (header Lead creation CTA remains primary action).
- Notices: `AdminPageToast` only — no in-flow `.form-error` banner.
- Compact ≤1280px / ≤720px height: hide **Quotation** and **Created** columns; clamp subtitle.
- Reference: `PartnerDashboardPage.tsx`, `partner-dashboard.css`, `admin-users-light.css`.

### Partner — My referrals (`/partner/leads`)

- **Composition:** directory table — header + **one** white panel (**no KPI row**; count in panel subtitle).
- **Chrome:** `.admin-users-page.partner-leads-page` — flex column + **24px** gap; canvas `#F4F4F6`; panel `flex: 1`; tbody scrolls (sticky thead).
- Header: title + subtitle; primary CTA top-right **Lead creation** opens shell overlay (same as dashboard). Empty state keeps Inbox + copy only — **no** second Lead creation button.
- Toolbar on panel title row: Search + Assignment `<select>` (All / Assigned / Awaiting) — equal 16px inset, custom chevron, pointer, hover wash.
- Table: Company, Tenant ID, Contact, Lead status, Quotation pill, Assignment pill, Created, Actions. Rows **navigable** (`tr.is-clickable`) → detail.
- **Edit** / **Delete** (Actions): always available for partner-owned referrals (including **Assigned**); `stopPropagation` + `startEditLead(id)` / delete confirm. Do **not** auto-close the edit overlay when `assignedUserId` is set — partners may edit until they delete or sales/finance otherwise locks the record server-side.
- **Pills (accent):** Assignment Assigned `#098F6A` · Unassigned `#E0B73A`; Quotation Paid `#098F6A` · Awaiting payment `#3A9EE0` · Pending finance `#E0B73A` · Rejected `#E06E3A` · Not quoted `#808080`.
- Empty: distinct copy for no data vs no filter match + Clear filters.
- Footer: Rows 10/20/50 + prev/page/next (`admin-users-panel__footer`).
- Notices: `AdminPageToast` only.
- Compact ≤1280px / ≤720px height: hide **Tenant ID** and **Created**.
- Reference: `PartnerLeadsPage.tsx`, `partner-leads.css`, `admin-users-light.css`.

### Partner — Referral detail (`/partner/leads/:id`)

- **Composition:** detail — header + **referral profile panel** + **quotations panel** (**no KPI**).
- **Chrome:** `.admin-users-page.partner-lead-detail-page` — flex column + **24 / 20 / 16** gap; canvas `#F4F4F6`; **full-width** panels (`max-width: none`, `width: 100%`) — do not constrain to 800px.
- Profile panel content-sized; **only** quotations (`.partner-detail-panel--fill`) `flex: 1` and fills leftover height; empty/loading shells also use `--fill`.
- Header: **← Back to referrals** black text button (`#0B0B10`, underline on hover) + company title + short subtitle (no page eyebrow; shell badge covers company). Secondary **Edit referral** / **Delete referral** stay available when assigned; edit opens the same lead overlay via `LeadEditProvider` → `PUT /api/partner/leads/:id` (scoped to partner ownership).
- Profile grid: **3 columns** desktop (>900), **2** mid (≤900), **1** ≤640; fields Tenant ID, Lead status, Contact, Work email, Latest quotation pill, Assignment pill (same accent mapping as My referrals).
- Quotations: sticky thead `admin-users-table` in scrollable wrap; **no row hover** (action column **View invoice** only when awaiting payment / paid). Empty state Inbox + copy fills panel body.
- Notices: `AdminPageToast` for load errors (no in-flow banner). Invoice preview stays centered `InvoiceReviewModal`.
- Compact ≤1280px / ≤720px height: hide **Reviewed** and **Paid** columns; clamp subtitle.
- Reference: `PartnerLeadDetailPage.tsx`, `partner-lead-detail.css`, `partner-leads.css` (pills).

### Partner — Bank details (`/partner/bank-details`)

- **Composition:** detail/form — header + **payout form panel** + **readonly slabs panel** (**no KPI row**).
- **Chrome:** `.admin-users-page.partner-bank-page` — flex column + **24 / 20 / 16** gap; canvas `#F4F4F6`; **full-width** panels (`max-width: none`, `width: 100%`) — do not constrain to 800px.
- Payout form panel content-sized; **only** commission slabs (`.partner-bank-slabs-panel`) `flex: 1` and fills leftover height (table wrap scrolls).
- Header: title + subtitle only (no eyebrow; shell badge covers company).
- **Country-aware payout fields** (from partner `country`, via `/api/partner/bank-account` → `country`):
  - **India:** Account holder, Bank name, Branch (opt), Account number, IFSC code
  - **United Arab Emirates:** Account holder, Bank name, IBAN, SWIFT/BIC (opt), Branch (opt)
  - **United Kingdom:** Account holder, Account number, Sort code, Bank name (opt), IBAN (opt), SWIFT/BIC (opt)
  - Other countries default to India field set. Shared helpers: `partnerBankFields.js` (FE) + `partner-bank-fields.ts` (BE).
- Form panel: **Payout account** — dynamic 2-col field grid (account holder full width; 1-col ≤720); panel subtitle shows partner country; red `*` required marks; field-level invalid (`#DB4437` + message under field). Footer **Save bank details** text-only black primary (`min-height: 40px`) — **no** top border, **no** Save floppy icon / no full-width grey action bar.
- Notices: `AdminPageToast` (auto-clears 2s); map known API validation messages onto fields.
- Slabs: `CommissionSlabsReadonly` `variant="panel"` — admin panel header + Filters country popover + table or empty copy; **no row hover** (read-only). Override admin sticky 56px last-column (`right` pin only) so **Commission rate** is a normal data column; keep `thead th` sticky (`top: 0`) as a unit — never `position: static` on `th:last-child` (that splits Deal range vs Commission rate on scroll).
- Reference: `PartnerBankDetailsPage.tsx`, `partnerBankFields.js`, `partner-bank.css`, `CommissionSlabsReadonly.tsx`.

### Partner — Commissions (`/partner/commissions`)

- **Composition:** earnings — header + **2 KPIs** (Pending `#E0B73A`, Paid `#098F6A`) + **Entries** fill panel + **Commission slabs** content-sized panel.
- **Chrome:** `.admin-users-page.partner-commissions-page` — flex column + **24px** gap; canvas `#F4F4F6`. KPI strip content-sized; **only** Entries `flex: 1`; slabs `flex: 0`.
- **Nav:** Partner sidebar **Commissions** (between My referrals and Bank details).
- **Entries toolbar:** Search (deal / tenant / reference) + status `<select>` (All / Pending / Paid) + period `<select>` (All time / Last 7 / 30 / 90 days) — same select chrome as My referrals. Period uses paid date for paid rows, accrued date for pending.
- **Table:** Deal · Deal amount · Rate · Commission · Date (accrued or paid on) · Reference · Status pill (Pending `#E0B73A` / Paid `#098F6A`). **No row hover**. Sticky thead as one row — Status is not an Actions pin (`right: auto`; `thead th:last-child` must keep `position: sticky; top: 0`). Cascade overrides live in `finance-partner-commissions.css` too (after `CommissionSlabsReadonly` re-imports admin-users-light). Empty vs filtered-empty + Clear filters.
- Footer: fixed page size **4** + page nav (no Rows dropdown).
- Slabs: `CommissionSlabsReadonly` `variant="panel"` (view only; country Filters on that panel). Same sticky rule — disable Actions pin on last col, keep full thead sticky together.
- Notices: `AdminPageToast` only. Do **not** show finance `paidBy`.
- Compact ≤720px height: hide **Deal amount** and **Rate**.
- Reference: `PartnerCommissionsPage.tsx`, `partner-commissions.css`.

### Number management — Dashboard (`/number-management/dashboard`)

- **Composition:** analytics/overview — header + KPI strip + **one** customers table panel.
- **Chrome:** `.admin-users-page.nm-dashboard-page` — flex column + **24px** gap; canvas `#F4F4F6`. KPI strip content-sized (`height: max-content`); **only** `.admin-users-panel` flex-grows; tbody scrolls.
- **Shared admin primitives:** `.admin-users-kpi-grid` / `.admin-users-kpi-card` (5 columns via `.nm-dashboard-kpi`), `.admin-users-panel` + `__section-header` / `__toolbar` / `__search` / `__body` / `__table-wrap`, `.admin-users-table` (same cell padding, caption headers, `#C9C9CF` borders as User credentials).
- Header: title + subtitle only — **no** “Number management” eyebrow.
- **KPI icon accents (locked):** Mapped numbers `#3A3FE0` · Active mappings `#098F6A` · Tenants `#653AE0` · Usage rows `#3A9EE0` · Customers without mapping `#E0B73A`. Truncate label/value with `title`.
- Customers panel: search in header row; count in subtitle. Table: Company, Tenant ID, Contact (+ email), Mappings, Last usage month. Rows **navigate** → `tr.is-clickable` + hover wash `#F4F4F6`. Ellipsis + `title`.
- **Eligibility:** active **Contact Center / CRM / Campaign** subscription **and** total **number entitlement > 0**. Counts: CC = agents (+ mid-period agents) + extra phone numbers; CRM = licensed users (+ additional users) + purchased numbers; Campaign = purchased numbers only. Orgs with a zero total are hidden. KPI cards and customer rows use that set. Subtitle + empty copy state this rule.
- **Empty states:** no eligible customers vs no search match + Clear search.
- Load errors: fixed `AdminPageToast` (no layout-jumping banner).
- Shares finance shell chrome (`.app-shell--finance`).
- Reference: `NumberManagementDashboardPage.tsx`, `number-store.ts`, `.nm-dashboard-*` overrides in `styles.css` + `admin-users-light.css`

### Number management — Customer detail (`/number-management/customers/:organizationId`)

- **Composition:** detail/drill-down — header + customer info panel + **one** mapped-numbers panel. **No KPI row**; **no eyebrow**. **Agent / DID usage removed** from this page (and removed from Finance nav/route).
- **Chrome:** page `display: flex; flex-direction: column; gap: 24px` (`.nm-customer-page`); customer info content-sized; mapped-numbers panel (`.nm-customer-panel--mappings`) fills leftover viewport; tbody scrolls. Canvas `#F4F4F6`; surfaces `#FFFFFF`; borders `#C9C9CF`.
- Header: company title (truncate + `title`) + tenant subtitle + **Back to dashboard** (secondary). No eyebrow.
- **Customer information:** one white panel with definition grid (`.nm-customer-detail-grid`) — left: Contact / Country / Industry; right: **Billing address** (above Email) / Email / Status; **Products purchased** full width. Enterprise density; ellipsis + `title` on values; address wraps.
- **Products purchased:** NM products with **≥ 1** entitled number (`customer.purchasedProducts`; zero-count products omitted). Per-product pill shows **purchased** + **to map** (`numberCount` / `mapped` / `remaining` from active mappings). Accent pills — Contact Center `#653AE0` · CRM `#3A9EE0` · Campaign `#098F6A`. Remaining > 0 boldens “N to map”; 0 shows “all mapped”. Detail 404 when customer total entitlement is 0.
- **Status pills (accent):** Active `#098F6A` · Inactive `#808080` · other lifecycle values neutral grey pill.
- **Mapped numbers:** admin table chrome (`.admin-users-table`) — Number, **Product**, Status, Notes, ⋯ actions. **No Type / Agent columns.** Fixed **64px** rows; product + status accent pills; sticky actions; **no row hover** (actions via ⋯ only).
- **⋯ menu:** Edit (right side overlay) · Mark active / Mark inactive · Delete (centered confirm). Same row-menu pattern as Number mapping / User credentials.
- **Pagination footer:** `admin-users-panel__footer` — Showing X–Y of Z · **Rows per page** 10/20/50 · prev / page / next (same as User credentials).
- Panel header: count subtitle + **Manage mappings** (secondary → filtered list) + **Map number** (primary → **create right overlay on this page**, tenant locked). Number mapping page Create still opens its own overlay there.
- Notices: `AdminPageToast` (auto-clears 2s). Overlay form errors stay inline.
- At ≤900px: detail grid single column; hide **Notes**.
- Shares finance shell chrome (`.app-shell--finance`).
- Reference: `NumberManagementCustomerDetailPage.tsx`, `.nm-customer-*` in `styles.css` + `admin-users-light.css`

### Number management — Number inventory (`/number-management/inventory`)
- **Job:** Manage telecom providers + unassigned DID inventory (CSV bulk).
- **Composition:** split workspace — providers list (left) + selected provider numbers (right). **No KPI row.**
- **Chrome:** page `display: flex; flex-direction: column; gap: 24px` (`.admin-users-page.nm-inventory-page`); canvas `#F4F4F6`. Header content-sized; **only** `.nm-inventory-layout` + both `.admin-users-panel`s flex-grow. Scroll inside provider list / numbers table body (short-viewport friendly).
- **Provider fields (UI):** name, image, country. **Storage / Account ID** commented out of form + display (DB columns remain; API optional empty / patch keeps existing when omitted).
- **Add / Edit provider:** right **side overlay** (`.admin-side-overlay`) — sticky header + scroll body + sticky footer Cancel + Create/Save (text only, `min-height: 40px`). Escape + backdrop close. Field-level validation; API errors in `.admin-side-overlay__alert`; success via `AdminPageToast` (no layout-jumping banners).
- **Delete provider:** centered confirm modal; danger confirm uses accent `#E06E3A`.
- **Add number:** dial-code + national digits (defaults to provider country); country-wise validation (`validateMobileForDialCode`); Add button height matches input (40px) via spacer label.
- **CSV:** number-only; import opens centered resolve dialog; invalid/country-mismatch rows listed as conflicts with reason — not a create/edit form.
- **Provider card logo:** wide rect (72×40) with `object-fit: contain` (no hard crop of wide logos). Active card: single border + soft fill (no double inset ring).
- **Numbers table:** Number + remove action. **No row hover** (actions via trash icon only). Remove icon hover accent `#E06E3A`.
- **Empty states:** Inbox / Building2 + short copy; providers empty offers **Add provider** CTA.
- **Dark theme:** `--au-*` remap + empty/search/provider-card contrast (same pattern as Number mapping / Dashboard).
- **Access:** `number_management` role only.
- Reference: `NumberInventoryPage.tsx`, `.nm-inventory-*` in `styles.css` + `admin-users-light.css` + `theme-dark.css`.

### Number management — Number mapping (`/number-management/mappings`)
- **Composition:** config/list — header + primary **Create mapping** + **one** table panel. **No KPI row** (counts live in panel subtitle).
- **Chrome:** page `display: flex; flex-direction: column; gap: 24px` (`.admin-users-page.nm-mapping-page`); canvas `#F4F4F6`.
- **Shared admin table:** panel/table use the same primitives as User credentials — `.admin-users-panel` + `__section-header` / `__toolbar` / `__search` / `__body` / `__table-wrap` + `.admin-users-table` (+ sticky header/actions, cell padding, caption headers, `#C9C9CF` row borders). Mapping-only extras: product/status pills, column widths, status filter select (`.nm-mapping-status-filter`).
- Header: title + subtitle only — **no** eyebrow. Create in header (black primary + Plus).
- Toolbar in panel header: shared search + status `<select>` (equal 16px inset, custom chevron, pointer, hover wash).
- Table: Tenant, Number, **Product**, Status, Notes, ⋯ actions. Ellipsis + `title`. Sticky actions column — **no** left edge shadow (mapping exception). **No row hover** — actions via ⋯ only (Edit / Delete). No Type / Agent columns.
- **⋯ menu (locked):** shared `.admin-users-row-menu`; anchor hugs the 34px trigger; near viewport bottom flips up (`.is-up`).
- **Product pills (accent):** Contact Center `#653AE0` · CRM `#3A9EE0` · Campaign `#098F6A` (same as customer detail).
- **Status pills (accent):** Active `#098F6A` · Inactive `#808080`.
- **Product-wise mapping:** each mapping requires `productId` (`contact-center` / `crm` / `campaign`). Capacity = seat/purchased entitlement minus active mappings for that product (`GET /mapping-capacity?tenantId=`). **Unique number** globally (one number → one product). Overlay Product select lists only products with remaining slots.
- **From customer detail:** **Map number** opens create overlay on the customer page (tenant locked). **Manage mappings** → `/mappings?tenantId=&customerId=` keeps scope in the URL, filters the list, fills search with that tenant, and shows header **Back to customer**. Sidebar **Number mapping** (`/mappings` with no query) always shows all tenants (no back). **Clear filters** drops scope query params.
- **Create / Edit:** right **side overlay**; Create shows **N number inputs** for remaining product slots (e.g. 2 purchased → 2 boxes); no Type / Agent label. Product/Status via `AdminFieldSelect`. Required Tenant / Product / each Number. Create submits one mapping per filled number. API errors: compact alert inside overlay.
- **Available numbers:** top-level **Available numbers** button beside the Numbers heading opens centered picker (`.nm-available-modal`). Choose provider → multi-select **unmapped** provider inventory only; selection meta + hard cap at product remaining slots (e.g. CRM 1 remaining → max 1). **Use selected** fills number rows + sets provider. Escape / backdrop close. Manual typing still allowed in the overlay fields.
- **Phone validation:** Create/Edit overlay — **each number row** has its own country dial code + digits (`mobile-field`); defaults to the customer’s country (`mapping-capacity.dialCode`); per-row editable. Digit rules from `MOBILE_VALIDATION_RULES`; India also enforces 6–9 prefix.
- **Delete:** centered confirm modal (danger `#E06E3A`); not `window.confirm`.
- Empty: no mappings vs no filter/search match + Clear filters / Create CTA. **Dark theme:** empty title `--text-primary`, copy/icon `--text-secondary` / `--text-caption` (no hardcoded light greys).
- Notices: `AdminPageToast` (no layout-jumping banners). Dark toast uses danger/success wash surfaces (not stark white cards).
- At ≤900px: hide Notes column.
- Reference: `NumberMappingPage.tsx`, `.nm-mapping-*` in `styles.css` + `admin-users-light.css` + `theme-dark.css`

### Number management — My Profile (sidebar tenant → overlay)

- **Not a nav item.** Removed from number management sidebar links.
- Open from `.sidebar__tenant` (role card) → `AccountSettingsOverlay` title **My Profile** (owned by `NumberManagementShell`).
- Overlay: sticky header + scrollable form + sticky footer Cancel + **Save changes** (text only, `min-height: 40px`). **Draft minimize:** dirty profile edits → `.side-overlay-draft-island` on dismiss.
- Form: single-column fields; red required marks; work email **read-only** with short hint; field-level password errors; compact success notice inside overlay (auto-clears 2s).
- Legacy `/number-management/account` → `NumberManagementAccountPage` redirects to `/number-management/dashboard` with `openAccount: true`.
- Shares finance shell chrome (`.app-shell--finance`).
- Reference: `NumberManagementShell.tsx`, `AccountSettingsOverlay.tsx`, `AccountSettingsForm.tsx`, `NumberManagementAccountPage.tsx`.

### Admin — User credentials (`/admin/users`)


- **Chrome:** page canvas `#F4F4F6`, cards/panels `#FFFFFF`, borders `1px #C9C9CF`, text `#0B0B10` / `#3F3F49` / `#5E5E69`.
- Class: `admin-users-page admin-users-credentials-page` (canvas `#F4F4F6`).
- Toolbar in panel title row; KPI compact with locked accent icons; table sticky header/actions; ⋯ menu (Edit, Mark active/inactive, Force logout, Delete).
- Table rows are **not** navigable — **no row hover wash** (actions via ⋯ only).
- **Create user / Edit user:** right **side overlay** (`.admin-side-overlay`); sticky header + scroll body + sticky footer (Cancel + primary). Single-column fields. Bulk upload uses `--wide` (`min(560px, 100vw)`). Role / Country / mobile dial code use `AdminFieldSelect` (menu always below the field). **Draft minimize:** dirty create/edit/bulk dismiss → `.side-overlay-draft-island`; clean forms close immediately.
- **Mobile number field:** compound `.mobile-field` (flag dial + digits) matches sibling text inputs — flat `#C9C9CF` / 8px / white; no inset or drop shadow; focus on the shell only.
- **Country ↔ mobile dial code:** changing **Country** sets dial code + trims the number to that rule (`applyCountryDefaultsToLeadForm`). Changing the **dial code** sets **Country** via `getCountryForDialCode` (+1 keeps Canada when already Canada, else United States) and trims digits / updates max length.
- **Validation:** field-level only — `.admin-users-field.is-invalid` red border `#DB4437` + soft red shadow; message under that field. No page banner jump.
- **Page notices:** fixed `.admin-users-toast` (success/error) after overlay closes or for list actions.
- **Mark inactive (⋯):** opens a **centered** confirm modal — for `sales` / `sales_admin`, require **New sales executive** + reason, then **Reassign & mark inactive** (reassign all owned leads/customers, then deactivate). Other roles: confirm only. Do **not** call deactivate directly from the menu (avoids “Reassign N customers…” toast error). Mark active stays a direct list action.
- **Delete user (⋯):** centered confirm only — **not** the Edit overlay. For `sales` / `sales_admin`, require reassignment then **Reassign & delete**; other roles: confirm delete. **No Delete block** inside the Edit right overlay (Reassign customers may remain). Force logout / Reassign customers: stay **centered** confirm modals (danger `#E06E3A` where destructive).
- Delete / danger: `#E06E3A` (menu item, danger buttons, delete confirm panel).
- Status pills: Active `#098F6A`, Inactive `#808080`.
- ≤1360px width or ≤720px height: hide **Last updated** and **Updated by**.
- Truncation + `title` on KPI values and table cells; short-height subtitle clamp with `title`.
- Reference: `AdminUsersPage.jsx`, `admin-users-light.css`

### Admin — Customer portal users (`/admin/customer-portal-users`)

- Reuses **Admin User credentials** chrome (`admin-users-page admin-cpu-page` + `admin-users-light.css`).
- **Chrome:** page canvas `#F4F4F6`, cards/panels `#FFFFFF`.
- KPIs: Total / Active / Inactive (locked accents) + **Companies** `#653AE0` (`Building2` icon).
- Toolbar: Search + Filters (role / status) + Download CSV on panel title row.
- Table: Company, Name (avatar initials), Email, Branch, Status, Last updated, **⋯ Actions (last / sticky)** — same column order as Partners / User credentials (no Role column — filter/search/CSV still support role).
- Horizontal scroll: `.admin-users-panel__table-wrap` + table `min-width: 960px` (compact hide Branch/Last updated → `720px`). Data-column % leave room for sticky Actions `56px`.
- Row actions: sticky last-column ⋯ → **Mark active / Mark inactive**, **Force logout**, **Delete**; Escape + outside click close. Actions must stay visible at all breakpoints.
- Force logout / Delete: centered confirm modals; danger `#E06E3A`. Deactivate also clears sessions.
- **Notices:** fixed top-center pill toast (`AdminPageToast` `variant="pill"`) — no in-flow banner / no KPI flicker; auto-clears in 2s.
- ≤1360px width or ≤720px height: hide **Branch** and **Last updated** only (not Actions).
- Pagination footer + page size (10 / 20 / 50).
- Reference: `AdminCustomerPortalUsersPage.tsx`, `admin-customer-portal-users.css`

### Admin — Partners (`/admin/partners`)

- Reuses **Admin User credentials** chrome (`admin-users-page admin-partners-page` + `admin-users-light.css`).
- **Chrome:** page canvas `#F4F4F6`, cards/panels `#FFFFFF`.
- Header primary CTA: **Create partner** opens **right side overlay** (`.admin-side-overlay` + `PartnerCreateOverlay`).
- **Edit** (⋯ menu): same **right side overlay** — prefilled; 4-step status (Details → Contact → Portal → Bank). Create stays 3 steps.
- Create/Edit overlay width: `--wide` (`560px`); sticky header + steps + scroll body + footer (Cancel / Back / Continue|Create|Save changes). **Draft minimize:** dirty dismiss → `.side-overlay-draft-island`.
- Create overlay: **3-step status at top** — compact horizontal pills (number + label) with connectors; no border under header. Active `#653AE0`, done `#098F6A`, upcoming grey. Completed steps clickable.
- KPIs: Total / Active / Inactive (locked accents) + **Countries** `#3A9EE0` (`Globe2` icon).
- Toolbar: Search + Filters (status / country) + Download CSV on panel title row.
- Table: Company, Contact (avatar), Work email, Country, Portal login, Status, Last updated, ⋯ actions.
- Row actions: ⋯ menu → **Edit** (right overlay) · **Mark active** / **Mark inactive** (inactive confirm modal) · **Force logout** (centered confirm) · **Delete** (centered confirm); Escape + outside click close.
- Force logout / Delete: admin-users modal card; danger confirm `#E06E3A`. Delete is blocked when the partner still has referral leads or commission entries (mark inactive instead). No Delete or Active toggle inside the Edit overlay.
- **Create/Edit overlay — Details:** no **Designation** field (role is already Partner); backend still accepts optional `designation` (`""` on create).
- **Create/Edit overlay — Contact:** one **Mobile number** compound field (`.mobile-field` + `AdminFieldSelect` dial code + digits) — same pattern as User credentials; country on Details step applies dial defaults via `applyCountryDefaultsToLeadForm`.
- **Create/Edit uniqueness:** backend rejects duplicate **work email** (`partners.work_email` + `partner_users.email`) and **mobile** (dial+digits normalized). Overlay maps those API messages onto `workEmail` / `mobileNumber` field invalid states (danger border + message under field) and returns to the Contact step — not a layout-jumping banner.
- **Create/Edit overlay — Portal access:** no separate portal login email — **work email** is the portal login on save; step shows display name + password only (edit password optional). Active/inactive is managed from the list ⋯ menu, not the overlay.
- **Page notices:** `AdminPageToast` (no layout-jumping banners).
- ≤1360px width or ≤720px height: hide **Country** and **Last updated**.
- Pagination footer + page size (10 / 20 / 50).
- Legacy `/admin/partners/new` → list + `openCreate`; `/admin/partners/:id/edit` → list + `openEditPartnerId`.
- Reference: `PartnersPage.tsx`, `PartnerCreateOverlay.tsx`, `admin-partners.css`

### Admin — Edit partner (`/admin/partners/:id/edit`)

- **Composition:** redirects to Partners list and opens the shared **right side overlay** (not a full-page wizard).
- Overlay reuses create chrome (`PartnerCreateOverlay` with `partner` prop); edit steps include Bank details.
- **Validation:** field-level `{ field, message }` via `validatePartnerWizardStep` (`isEdit: true`); API uniqueness conflicts mapped the same way as create (`mapPartnerSubmitError`).
- Reference: `PartnerEditPage.tsx` (redirect), `PartnerCreateOverlay.tsx`, `partnerWizard.tsx`

### Admin — Resellers (`/admin/resellers`)

- Same list chrome as Partners (`admin-users-page admin-resellers-page` + `admin-resellers.css`).
- Header primary CTA: **Create reseller** opens **right side overlay** (`.admin-side-overlay` + `ResellerCreateOverlay`).
- **Edit** (⋯ menu): same **right side overlay** — prefilled; 4-step status (Details → Contact → Billing → Portal access). Create uses the same steps.
- Create/Edit overlay width: `--wide` (`560px`); sticky header + steps + scroll body + footer (Cancel / Back / Continue|Create|Save changes). **Draft minimize:** dirty dismiss → `.side-overlay-draft-island`.
- Create overlay: **4-step status at top** — Details → Contact → Billing → Portal access; compact pills + connectors; active `#653AE0`, done `#098F6A`. Completed steps clickable.
- **Create/Edit overlay — Details:** no **Designation** field (role is already Reseller); backend still accepts optional `designation` (`""` on create).
- KPIs: Total / Active / Inactive + **Countries** `#3A9EE0`.
- Table: Company, Contact, **Invoice email**, Country, Portal login, Status, Last updated, ⋯ actions.
- Row actions: ⋯ menu → **Edit** (right overlay) · **Force logout** (centered confirm); Escape + outside click close.
- Force logout: admin-users modal card; danger confirm `#E06E3A`.
- Notices: `AdminPageToast`. Compact hide Country / Last updated.
- Legacy `/admin/resellers/new` → list + `openCreate`; `/admin/resellers/:id/edit` → list + `openEditResellerId`.
- Reference: `ResellersPage.tsx`, `ResellerCreateOverlay.tsx`, `admin-resellers.css`

### Admin — Edit reseller (`/admin/resellers/:id/edit`)

- **Composition:** redirects to Resellers list and opens the shared **right side overlay** (not a full-page wizard).
- Overlay reuses create chrome (`ResellerCreateOverlay` with `reseller` prop); password optional on edit.
- **Validation:** field-level `{ field, message }` via `validateResellerWizardStep` (`isEdit: true`).
- Reference: `ResellerEditPage.tsx` (redirect), `ResellerCreateOverlay.tsx`, `resellerWizard.tsx`

### Admin — Commission slabs (`/admin/commission-slabs`)

- **Composition:** config list — **no KPI card row** (count lives in panel subtitle). Header + Create + one table panel.
- Reuses list chrome tokens (`admin-users-page admin-commission-slabs-page` + `admin-users-light.css`).
- **Chrome:** page canvas `#F4F4F6`, table panel `#FFFFFF`.
- Header primary CTA: **Create slab** (top right) opens create/edit in a **right side overlay**.
- Toolbar: Search + Country select + Filters (status) + Download CSV.
- Table: From, To, Rate %, ⋯ (Edit / Delete), **Status toggle** (rightmost sticky). ⋯ before Status is intentional when both exist (see Status toggle pattern). **⋯ menu portals** to `body` (fixed) so overflow on the table wrap does not clip Edit/Delete. **No Sort order** column/field — list sorts by From amount; API still defaults `sortOrder` to `0`.
- Toggle: off `#C9C9CF` / on `#098F6A` (see Status toggle pattern).
- Create/Edit: `.admin-side-overlay` form (From, To, Rate % only); Delete confirm stays centered modal (danger `#E06E3A`). **Draft minimize:** dirty dismiss → `.side-overlay-draft-island`.
- ≤1360px width or ≤720px height: hide toggle text label.
- Reference: `AdminCommissionSlabsPage.tsx`, `admin-commission-slabs.css`

### Admin — Cancellation requests (`/admin/cancellation-requests`)

- **Composition:** directory table — header + one panel (no KPI row); **Review** opens right **side overlay**.
- **Chrome:** `admin-users-page admin-cancellation-queue-page`; canvas `#F4F4F6`, panel `#FFFFFF`; compact header gap.
- Toolbar: Search + status filter select (equal padding / pointer / hover).
- Table: Request, Company, Type, Branch, Status pill, Submitted, Review. **No row hover** (action via Review). `min-width: 1180px` so sticky Review still works when Status is wide.
- **Status column:** wider (`~24%`, `min-width: 12.5rem`); cell + `.admin-cancel-status` pill allow wrap (`white-space: normal`) so labels like **Scheduled — active until period end** stay fully readable — no hard clip / no ellipsis-only.
- Footer: **Rows** 10/20/50 + prev / page / next — same `admin-users-panel__footer` as User credentials / Partners.
- Status pills (accent): pending `#E0B73A` · escalated `#E06E3A` · approved `#098F6A` · rejected `#808080`.
- **Empty states:** distinct copy for no data vs no filter match + Clear filters when filtered empty.
- Approve/Reject: confirm modal; reject note field-level invalid.
- Reference: `AdminCancellationQueuePage.tsx`, `admin-cancellation-queue.css`

### Admin — Invoice settings (`/admin/invoice-settings`)

- **Composition:** config form — header + one white panel (no KPI). Reuses partner-bank form chrome (`admin-users-page` + `partner-bank.css`).
- **Fields:** Invoice prefix (editable), Next sequence + Series year (read-only), bank details (account name, bank, account number, IFSC, branch).
- Series format: `{prefix}-{year}-{n}` (default `WIPL-2026-1`). Sales preview uses `{prefix}-{year}-DRAFT` without allocating.
- GST on invoices: optional buyer GSTIN (hidden when empty); Tamil Nadu seller → CGST+SGST 9% each (intra) or IGST 18% (inter-state India).
- **PDF black header (generate_invoice pt template):** `unit: pt`, PAGE_W 595.28, MARGIN 34, black bar min 128pt with equal top/bottom pad and content vertically centered (grows if needed) — left ~26pt transparent white mark + **WORKTUAL**, tagline, SIDCO address, `GST:`, phone, `finance@worktual.com`, website — right meta: **Invoice #**, **Date** only (no Due Date). Customer section starts at `headerH + 15`. Description omits Billing period; Payment Terms use Due on … only. Items table fixed pt widths (Solution 85 / Description 244 / Qty 28 / Unit Price 85 / Subtotal 85). Footer: amount in words + Financial Summary → **bank | note** (auto-grow) → three footer cards (auto-grow). Editable sheet mirrors (no Due Date field). Frontend and backend pt drawers in `invoice.js` / `invoice.ts` (no autoTable).
- Notices: `AdminPageToast`.
- Reference: `AdminInvoiceSettingsPage.tsx`, `invoiceSettings.js`.

### Admin — Product pricing (`/admin/pricing`)

- **Composition:** config/rates — **no KPI row**. Header + product rail + **one** white form panel.
- **Chrome:** canvas `#F4F4F6`; panel `#FFFFFF`; borders `#C9C9CF`. Page is `display: flex; flex-direction: column; gap: 24px`.
- **CSS sole source:** `styles/admin-pricing.css` (imported by the page). Do **not** reintroduce `.admin-pricing-*` rules in `styles.css`.
- Header: title + subtitle only (no “Admin” eyebrow / settings icon). Save catalog is **text-only** primary. Last-saved meta ellipsis + `title`; hide meta at short height ≤720px.
- Product rail: short labels (Contact Center, CRM, …); full catalog name on `title` hover. Quiet links — active = white surface + border, not heavy card stack.
- Panel: sticky-feel header (short product title + **product-specific lede**) + toolbar (Product name + **Region** select with visible label) + scrollable body.
- Each product form wraps in `.admin-pricing-product` (flex column, **16px** gap) so CC / CRM / CDP / Campaign / Value Mgmt / Ticketing / Regions share the same stack rhythm.
- Region `<select>` (`.admin-pricing-region-select`): equal 16px inset, custom chevron, pointer, hover wash; surfaces use semantic tokens (`--bg-surface` / `--text-primary`). Dark: no white flash on click/focus — `theme-dark.css` safety-net keeps canvas-subtle fill + chevron. Product name toolbar input ellipsizes long labels.
- Subtabs: segmented control (grey track + black active) — not floating pill clusters.
- Sections / add-on blocks / channel cards: **flat white** bordered surfaces (no nested `#F4F4F6` card fill). One-time Implementation pill uses accent `#E0B73A` / warning text.
- **Section grid full-span:** checkbox, `.form-grid`, `.admin-plan-addons__block`, tables, plan-fee strips, empty hints — always `grid-column: 1 / -1` (never half-width beside a checkbox). Lone single fields max-width **280px**.
- **Implementation (all products):** compact `.admin-pricing-plan-fee` strip (`ImplementationFeeStrip`) — not a lonely half-width input.
- Numeric field labels: red `*` required mark (`#C73E32`) — not a “Required” text badge.
- Inline add-row / region create errors: field `is-invalid` + message under the control (not page banners). Catalog save notices stay on `AdminPageToast`.
- Configuration defaults table: compact **Qty · Rate** pair per plan column; labels once in header (not repeated in every cell). Sticky thead + sticky **Item** column; delete accents `#E06E3A` on **every** item row. **No row hover** (action-only table). **Add configuration** (secondary + Plus) below the table adds a feature row (or restores a deleted built-in by the same name).
- Plans tab: per-plan **Implementation fee** sits as a compact one-time strip inside the plan section (not a separate full card); modules table below.
- **CRM / Campaign numbers:** Base metrics include **Number count** + **Per number price**. **Additional numbers** use always-visible qty/rate fields (`QuantityRateAddonSection` / `AddonStaticSection`); enable follows `count > 0` (no switch). Sales quotes bill `count × rate`; mid-period uses `midPeriodAddons.numbers`.
- **Add-On Storage (all products):** catalog `storageAddOn` — label **Add-On Storage**, unit **GB**, enabled by default. Regional default rates: India **3000** INR, UK/international **30** ($30 amount on UK region), Dubai **110** AED. Admin section on every product form (CCAAS Add-ons tab + CRM/CDP/Campaign/VM/Ticketing). Seeded via defaults merge; admin can change per region.
- **Campaign channels:** humanized labels (Web Push, App Push, SMS, WhatsApp, …); empty state when no channels.
- **Slabs (contacts / tickets / channels):** empty copy when no tiers; sticky Tier column on `.admin-pricing-table--slabs`.
- **Regions:** configured table + Add region (required name/currency); empty state when none.
- **Notices:** `AdminPageToast` only — no layout-jumping success/error banners.
- Unsaved bar: fixed footer; attention dot `#E0B73A`; Discard + Save text-only.
- Reference: `AdminPricingPage.tsx`, `admin-pricing.css`

### Sales — Payment follow-up forward mail (`/products/:leadId/payment-forward`)

- **Composition:** detail/compose — back link + page header + payment summary card + **mail compose** surface (no KPI).
- **Chrome:** reuse shared `.compose-mail-page` + `.mail-compose` (same as finance submit compose / mail workspace) — never legacy `.compose-mail-form` / unstyled `<label class="field">` stacks.
- Header: `lead-dashboard-page__back` + eyebrow **Sales follow-up** + title + `.compose-mail-page__copy`.
- Payment summary: `.payment-forward-summary` with **2 columns** (`auto minmax(0,1fr)` icon + copy) — do not reuse the dashboard’s 3-column grid (icon / copy / actions).
- Compose: New message chrome → From / To (+ Cc/Bcc toggles) / Subject → editable plain-text body (`.mail-compose__body`) → footer chip “Payment link in message body” + equal-width **Cancel** / **Send**.
- Errors: inline `.mail-compose__error` in the footer (not a page banner that jumps layout).
- Reference: `ForwardPaymentPage.tsx`, `.payment-forward-page` / `.mail-compose*` in `styles.css`.

### Sales — Leads / Customers lists (`/products`, `/customers`)

- **Composition:** directory table — header + **one** white panel (no KPI row).
- **Chrome:** match admin list density — page `display: flex; flex-direction: column; gap: 24px`; panel `flex: 1` fills leftover viewport; **tbody area scrolls** (`.leads-table-wrap`), sticky thead + sticky Actions column.
- Header primary CTA (top right): **Create lead** — black `#0B0B10`, Plus icon, `min-height: 44px`, radius `12px` (same as admin Create user/partner). Opens a **right-side overlay** (`admin-side-overlay` pattern, same chrome as `PartnerCreateOverlay`) instead of navigating away — steps at top, sticky footer Cancel + Back + Continue/Create lead.
- **Lead scope (Products / quote generation):** All leads · My leads · **Temporary Lead**. Temporary leads are for immediate finance-only invoices (Implementation only · Configuration only · Implementation and configuration · Add-on only · All in one) — **no payment link**, no customer go-live. They are excluded from All/Mine API lists and from sales dashboard converted-customer widgets. Create under Temporary Lead stamps `leadKind=temporary`.
- **Invoice review contents edit:** Pencil opens **in-sheet** click-to-edit of the invoice preview (regular + Temporary); Done rebuilds PDF from the edited sheet.
- **Draft minimize (Create + Edit lead overlays):** backdrop / Escape / Minimize / **Cancel** keep a session when the form is dirty — **create:** any entered data; **edit:** diff from loaded baseline (`leadFormDraft.js`). Clean forms close immediately. Dirty → right-edge `.lead-create-draft-island` (Y-drag, stack, click resume, ✕ discard). **Never silently discard** typed changes on outside dismiss.
- **Edit lead:** same right-side overlay as Create (`LeadEditProvider` on `SalesWorkspaceShell`; `startEditLead` from Products / Customers ⋯ menus). Two-step wizard preserved; sticky footer Cancel + Back + Continue / **Save changes**. Legacy `/onboarding/:leadId/edit` redirects to `/products` with `state.openEditLeadId`.
- `/onboarding` redirects to `/products` with `state.openCreate` so old links/bookmarks/sidebar nav still open the create overlay.
- **Create lead overlay — Address & billing:** keep default **2-column** `.form-grid` (same as Basic details); address / state / tax use `field--full`. Head office / branch blocks are **flat** (no card border, tinted fill, or left accent bar). Checking “other offices or branches” seeds one branch section; **Add branch** / **Add another branch** appends another. Each branch mirrors HQ plus a **Branch profile** grid. Overlay body scrolls; nested step-2 overflow disabled.
- **Create lead overlay — required marks:** labels use red `.field__required` `*` (`#C73E32`), not black.
- **Create lead overlay — mobile field:** `.mobile-field` dial control (flag + code + chevron) is **content-sized** (`grid-template-columns: max-content minmax(0,1fr)`); number input takes remaining width. No always-visible `.field__hint` under Mobile / Secondary mobile (or branch mobiles) — keep field-level errors only. Country code is required with the number and persisted (`mobile_country_code` / `secondary_mobile_country_code`).
- **Create lead overlay — industry:** `industryType` resolved from selection (or custom “Other”) and written to `leads.industry_type` (+ prospect org) on create/update.
- Table: navigable rows (`is-clickable` hover); ⋯ menu (`LeadActionsMenu`) for Edit / View / Start quote / Mark inactive.
- **Equal row height (locked):** tbody rows **64px**; company name (and other cells) **ellipsis + `title`** — never wrap / grow row height for long names.
- Footer: **Rows per page** (10 / 20 / 50) + prev / page / next — same `admin-users-panel__footer` pattern as admin lists.
- **Customers vs Leads (lifecycle):** once converted/live (`organizations.lifecycle_status=active` / Paid history), a new product quote must **not** remove them from **Customers**. While the quote is **Pending Finance Review**, lead status stays **Paid** (Customers by status must not show Partially paid). After finance **approve** (awaiting payment), lead becomes **Partially paid** — never demoted to Approved / Pending. `reconcileLeadPaymentFulfillment` follows the same rule. Quote generation (`/products`, `pipelineOnly`) continues to exclude Paid / Partially paid — open quotations are worked from **Customers** detail (`/customers/:leadId`). Temporary Lead finance-only flow unchanged.
- Customers: no Since column; Actions replaces it.
- Reference: `ProductsPage.tsx`, `CustomersPage.tsx`, `.leads-page` / `.leads-table*` in `styles.css`; create overlay in `LeadCreateOverlay.tsx`; edit overlay in `LeadEditProvider.tsx` — both wrap `OnboardingPage` `variant="overlay"`.

### Sales — Quote generation customer detail (`/products/:leadId`, `/customers/:leadId`)

- **Composition:** detail/overview — header (Back + company + Delete customer) + **5 content-sized KPIs** + Customer details / Locations / Quotations in progress / Purchased products panels.
- **Customer details ‖ Locations (locked):** `.lead-dashboard-grid` uses `align-items: stretch` so both panels share the same row height (Locations matches taller Customer details). Direct grid children use column flex + `min-height: 100%`. Do not use `align-items: start` on this pair.
- **Chrome:** full `app-content` width — **no** `max-width` centering / inset sheet. Page `.lead-dashboard-page`: `display: flex; flex-direction: column; gap: 24px`. Canvas `#F4F4F6`; KPI cards + panels `#FFFFFF`; borders `#C9C9CF`; no heavy shadow.
- **KPI strip (locked):** `.lead-dashboard-stats` `flex: 0 0 auto`; `height: max-content`; `grid-auto-rows: auto`; equal height within the row only. Default **5 columns**; ≤1439 → 3; ≤900 → 2; ≤640 → 1. Short height ≤720: denser padding/icons.
- **KPI definitions:**
  - **Active products** — count of **product-paid live** subscriptions (`isActivePaidSubscription`) — not implementation-fee-only / pre-live OTC.
  - **UAT / implementation** — count of payment-confirmed products still pre-live (`isPreLivePaidProduct`: implementing / UAT / UAT expired / awaiting go-live payment). Subtitle: “In UAT or implementation” (or “None in progress”).
  - Locations · Est. MRR (from live paid only) · Customer since.
- **KPI icon accents (locked):** Active `#098F6A` · UAT/implementation `#3A9EE0` · Locations `#653AE0` · Est. MRR `#E06E3A` · Customer since `#E0B73A`.
- Back link: black `#0B0B10` text (not muted caption). Location select active/hover: `#F4F4F6` wash + grey/black border — **no** violet/blue brand wash.
- **Notices:** fixed `AdminPageToast` for load/sync errors, finance/billing flashes, portal access messages — **no** in-flow `form-error` / `form-success` banners that shift KPIs.
- Keep SSE refresh, open quotations list, purchased products, Delete customer behavior.
- **Temporary Lead:** header copy shows **Finance approval only**; Payment follow-up / Forward payment / portal access are hidden — temporary leads stop at finance approve (no payment link). **No KPI strip**, **Purchased products**, or **Customer product requests** — portal/subscription panels do not apply to finance-only temporary leads. CTA is **Generate invoice** (not Start a purchase / New product purchase); still opens the product workflow for a finance-only quote.
- **Payment follow-up card:** under the amount, do **not** show “Payment failed” status text or `failureReason` — failed state is already clear from **Payment history** (`Failed` badge). Keep non-failed status labels (Awaiting / reported / paid), payment link, product rows, provider line, and **Forward again to customer**.
- **Payment history cards (`PaidPaymentRow`):** invoice access is the in-row blue **View invoice** link on each product line (`.lead-dashboard-link-button` in `PaymentProductStatusList`) — **no** duplicate card-level secondary **View invoice** on the right. Keep **View by product** / **View by location** when multi-invoice modes apply; card-level **View invoice** only as fallback when there is no product line to host the link. Same card is used for the inline history list and the “View all” modal.
- **Customer product requests panel:** open portal requests (including `inquiry` → title/type **New product inquiry**); status accent pills; View full details + Open in workflow. SSE on `product_request.*`.
- **Start a purchase:** **New product purchase** → Choose products (catalog minus already active). **Existing product (add-ons only)** → when multiple active products, Choose products filtered to actives (pick which to add capacity to); when exactly one active product (or per-row **Purchase add-ons** with `productId`/`subscriptionId`), open Set pricing in add-ons-only mode for that product. Do **not** auto-pick `activeProducts[0]` / hard-default **value-management** (CVM).
- **Redo pricing (finance reject):** **Redo pricing** on a Rejected open quotation navigates to ProductWorkflow with `freshQuote` + `seedFromRejectedQuotation` (assignments / configs / optional `sourceProductRequestId`). Lands on **Set pricing** (`configure`) for the same product(s) — not Choose products (`select`). First-time quote / Temporary Lead / renewal / addon / product-request seeds unchanged.
- **Quotations in progress — superseded Rejected:** keep Rejected visible for Redo until a newer non-rejected quote (Pending / Approved / Paid) covers the same `sourceProductRequestId` or overlapping product+branch. After redo → approve → pay, the old Rejected row leaves this panel (API `GET …/open-quotations`); Purchased products / payment history unchanged.
- Reference: `LeadDashboardPage.tsx`, `leadDashboard.js`, `lead-dashboard.css` (+ base `.lead-dashboard-*` in `styles.css`).

### Sales — My Profile (sidebar tenant → overlay)

- **Not a nav item.** Removed from sales / sales-admin sidebar links.
- Open from `.sidebar__tenant` (role card) → `AccountSettingsOverlay` title **My Profile** (owned by `SalesWorkspaceShell`).
- Overlay: sticky header + scrollable form + sticky footer Cancel + **Save changes** (text only, `min-height: 40px`). **Draft minimize:** dirty profile edits → `.side-overlay-draft-island` on dismiss.
- Form: single-column fields; red required marks; sales/finance work email **read-only** with short hint; field-level password errors; compact success notice inside overlay (auto-clears 2s).
- Legacy `/account` → `SalesAccountPage` redirects to `/dashboard` with `openAccount: true`.
- Reference: `SalesWorkspaceShell.tsx`, `AccountSettingsOverlay.tsx`, `AccountSettingsForm.tsx`, `SalesAccountPage.tsx`.

### Sales — Support (`/support`)

- **Composition:** queue + detail workspace — header + **one** white panel (no KPI row). Toolbar (search + filter) sits in the panel header with ticket count subtitle.
- **Chrome:** page `display: flex; flex-direction: column; gap: 24px` (`.sales-support-page`); panel `flex: 1` fills leftover viewport; list + detail scroll inside the panel (not the whole app). Canvas `#F4F4F6`; panel/list/detail `#FFFFFF`; borders `#C9C9CF`.
- Header: title + subtitle only — **no** “Sales workspace” eyebrow / Headphones icon in the H1.
- Filter dropdown selects: equal 16px inset, custom chevron, pointer, hover wash (shared `.leads-filter-dropdown`).
- **Split width:** list column `minmax(320px, 360px)`; detail column `minmax(0, 1fr)` with detail pane **`max-width: 798px`** (`space-maxWidth-xlarge`), `min-width: 0`, `justify-self: start` — reading column / reply composer do **not** stretch to full leftover width on wide screens. Shared with customer My tickets queue (`.customer-support-queue` / `.customer-support-detail`).
- **Ticket list density (anti-stretch):** queue may `align-items: stretch` so the list **pane** matches detail height and scrolls; list is `display: grid` with **`align-content: start`** + **`grid-auto-rows: max-content`**. Ticket cards (`.customer-support-list__item`) stay **content-sized** (`height: auto`, `align-self: start`) — selected/active state must **not** stretch the card to fill leftover list height (same lock as sidebar nav / KPI stretch).
- Ticket list: selectable cards (hover wash `#F4F4F6`; active = wash + black border). Subject **2-line clamp** + `title`; meta ellipsis + `title`.
- **Status pills (accent):** Open `#3A9EE0` · In progress `#653AE0` · Waiting `#E0B73A` · Resolved `#098F6A` · Closed `#808080`.
- **Priority pills (accent):** Low `#808080` · Medium `#E0B73A` · High `#E06E3A` · Urgent `#D83AE0`.
- Reply: field highlight + under-field error (no page banner); Send reply = black primary, content-sized (`width: auto`, `justify-self: start`, `min-height: 40px`, padding `0 24px`); text + Send icon on sales.
- **Empty states:** distinct copy for no tickets vs no filter/search match + **Clear filters** when filtered empty.
- Load errors: fixed `AdminPageToast`.
- Reference: `SalesSupportPage.tsx`, `.sales-support-*` + shared `.customer-support-*` / `.support-*-pill` in `styles.css`.

### Customer — Support (`/customer/support`)

- **Composition:** My tickets list + detail workspace — header (title/subtitle + **Raise ticket** CTA) + filters + queue/detail panel. **No tab bar** (single view).
- **Raise ticket:** header primary CTA (black `#0B0B10`, label **Raise ticket**) opens a **right side overlay** (`.admin-side-overlay` / `.customer-support-raise-overlay`) — not inline, not a centered modal. Sticky header + scroll body + sticky footer (Cancel + Submit ticket); single-column fields; account context block in overlay body.
- **Validation:** field highlight + under-field errors; API errors in overlay `.admin-side-overlay__alert`; success via fixed `AdminPageToast` after submit (close overlay, refresh list, focus new ticket).
- **Draft minimize:** dirty dismiss → `.side-overlay-draft-island` via `useSideOverlayDraftDismiss` + `isSupportRaiseTicketFormEmpty`.
- **Split width:** same as Sales Support — list `320–360px`, detail pane capped at **798px** (shared `.customer-support-queue` / `.customer-support-detail`).
- Ticket list cards: same anti-stretch lock as Sales Support (content-sized rows; list scrolls if needed).
- Status/priority pills: same accent mapping as Sales Support.
- Send reply: black primary, content-sized (`.customer-support-reply__button`).
- Reference: `CustomerSupportPage.tsx` + shared support classes in `styles.css`.

### Sales — Dashboard (`/dashboard`)

- **Composition:** analytics/overview — header + KPI strip + 3 insight panels + **Product requests** panel + customers table.
- **Chrome:** page canvas `#F4F4F6`; KPI/insight/table surfaces `#FFFFFF`; borders `#C9C9CF`; no heavy card shadow.
- Page: `display: flex; flex-direction: column; gap: 24px`. KPI strip content-sized (`flex: 0 0 auto`); cards in the row share **equal height** (`align-items: stretch`).
- Header: title + subtitle only (no “Sales Admin” / workspace eyebrow).
- **KPI — Total customers:** same membership as **Customers** module (`isPaidCustomer` / `countTotalCustomers`) — Paid, Partially paid, and active orgs awaiting payment on a new quote. Must **not** drop to 0 when an existing customer’s open quote is finance-approved. Hint: “All active accounts”. Dashboard derives the value from portfolio `customers.length` so the KPI matches the table.
- **KPI icon accents (locked):** Total customers `#3A3FE0` · Active subscriptions `#653AE0` · Portfolio MRR `#098F6A` · Pending finance `#E0B73A` · Renewals `#3A9EE0`.
- **Pending finance review KPI:** count of quotations with status `Pending Finance Review` for leads the SE owns (created **or** assigned) — same open state as the finance queue. Includes first-time Temporary Leads **and** existing customers whose lead stays `Paid` while a new quote awaits finance (do **not** count lead status alone; do **not** force Partially paid on submit). API: `GET /api/customers/portfolio` → `summary.pendingFinanceReview`.
- **Live refresh:** dashboard reloads portfolio on mount, window `focus`, and SSE `quotation.*` / `payment.*` / `product_request.*` (debounced) — submit for finance / finance approve / awaiting payment should bump KPIs without a full page reload when the overview stays open or when returning to `/dashboard`.
- Customers by status donut: accent colors by status (Paid `#098F6A`, Partially paid `#3A9EE0`, …) — **no black/grey series**. Partially paid appears only after finance approve (or real partial payment), not for pending-finance-only.
- Product adoption bars: single blue `#3A9EE0` for all products; always show full catalog (6 products), including **0** counts (muted bar).
- **Product requests panel:** white surface; list of open customer portal requests (inquiry / new / upgrade / mixed) for leads the SE owns (created or assigned). Row: company, title, type label (`New product inquiry` for `inquiry`), date, accent status pill (reuse `.lead-dashboard-badge--*`), **Open customer** → `/customers/:leadId`. SSE refresh on `product_request.*` via `requests` channel. API: `GET /api/customers/product-requests`.
- Customers table rows **navigate** → `tr.is-clickable` + row hover wash `#F4F4F6`. Upcoming renewals list: **no** row hover (Create quote button only).
- **Notices:** `AdminPageToast` for load errors (no layout-jumping banner).
- Reference: `SalesDashboardPage.tsx`, `DashboardPage.tsx`, `sales-dashboard.css`

### Sales — Quote generation / Leads (`/products`)

- **Composition:** header + optional **Open product requests** strip (content-sized, only when count > 0) + Browse leads fill panel.
- Product requests strip: same scoping/labels as dashboard; Open customer → `/customers/:leadId`. Does **not** flex-grow (`.leads-panel--product-requests`).
- Reference: `ProductsPage.tsx`.

### Sales oversight (dashboard / agents / lead / product)

- **Composition (Team dashboard):** analytics/overview — header + **6 content-sized KPIs** + charts/tables below. KPIs must **not** fill leftover viewport height.
- **Chrome:** `.sa-dashboard` is `display: flex; flex-direction: column; gap: 24px` (not stretched grid). KPI strip `.sa-kpi-grid`: `flex: 0 0 auto`; `height: max-content`; `grid-auto-rows: auto`; **`align-items: stretch`** so cards in a row share equal height (row height = content, never `1fr` of leftover viewport).
- **KPI card body:** `.sa-kpi-card__body` flex column; meta `<small>` pinned with `margin-top: auto` + reserved line so row heights stay even when trends show.
- **KPI grid density:** default **3 columns** (2 rows for 6 cards); **6 columns** ≥1600px; stay **3 columns** through shell-compact ≤1280; **2 columns** ≤900px; **1 column** ≤640px.
- **Compact width (≤1280) + short height (≤720px):** match admin KPI density — padding `10px 12px`, 32px icons, value ~1.15rem, **hide meta `<small>`** so all six cards are uniform; truncate label/value with `title`.
- **Period select:** custom chevron, equal 16px inset, pointer + hover wash (same select pattern as admin lists).
- **Sales lead overview:** detail/read-only — header (Back · company · “Lead overview · Read only” + tenant id) + **3 content-sized summary KPIs** (Assigned agent / Active products / Est. MRR) with accent icons — **no Status KPI** (customer status not shown on oversight lead pages). Panels: Customer details, Quotation history (**height locked to Customer details**; list scrolls inside), Purchased products (navigable `tr.is-clickable`), Assignment history. Shell: `.admin-users-page.sa-lead-detail-page` (`sa-lead-detail.css`). Empty states use Inbox. Notices: `AdminPageToast`. Reference: `SalesOversightLeadDetail.tsx`.
- **Sales agent detail:** detail/overview — header + **4 content-sized KPIs** + Assigned leads panel. Page gap **24px** (match Team dashboard / agents; ≤720px → **20px**, ≤600px → **16px** — never inherit admin `gap: 10px`). **Page H1 = 1.35rem** (≤720 → 1.25rem) across oversight. **Period** lives inside Assigned leads **Filters** popover (`.sa-agent-detail-filter-dropdown`: **~260px** wide, single-column fields, scroll body **max ~240px**, sticky Clear/Apply at **28px** height; uniform `#C9C9CF` field borders). Table: row padding **`14px 12px`** (match admin/customer lists); body text **0.875rem / weight 500 / `#3F3F49`** (company `#0B0B10`); product tags max 2 + `+N`, nowrap; **Reassign** text link. **Short height must not hide Actions** — override admin `nth-child(7–8)` hide (hide Revenue by class). Column prefs `sa-agent-detail-columns:v2`. Reference: `SalesOversightAgentDetail.tsx` + `sa-agent-detail.css`.
- **Partner referrals awaiting assignment (Team dashboard):** admin panel + table (`sa-unassigned-leads`); Assign to select (16px/48px chevron) + black **Assign** text action; sticky Actions ≥6.5rem; horizontal scroll via table wrap (`min-width: 720px`); Inbox empty; `AdminPageToast` (no in-flow banners). Reference: `UnassignedPartnerLeadsPanel.tsx` + `sa-unassigned-leads.css`.
- **Sales agents (directory):** same chrome as admin lists / Partner referrals — `.admin-users-page.sa-agents-page` + `.admin-users-panel`. **No KPI row.** Page H1 **1.35rem** (≤720 → 1.25rem). Toolbar: search + **Filters** only. **Period**, **Sort**, Activity / Deals / Department all live in Filters popover (`.sa-agents-filter-dropdown` — scrollable body, sticky Reset/Apply). Page gap locked **24 / 20 / 16**. Clickable rows → agent detail. Reference: `SalesOversightAgents.tsx` + `sa-agents.css`.
- **Oversight page headers:** Team dashboard / agents / agent detail / lead overview share **1.35rem** H1 (compact **1.25rem** ≤720px) — do not use admin `1.75rem` display size on these routes.
- Charts / funnel / KPI icons use **accent palette** via `accentChartSeries` + `chartPalette` in `brandColors.js` (not greyscale).
- **Revenue trend (locked red):** stroke, markers, area gradient, and hover guide use **only** `#E06E3A` (`accentRevenueTrend`) — no purple on this series.
- **Revenue hover:** pointer anywhere on the chart snaps to nearest day; dashed vertical guide + ring marker; tooltip follows the point (date + compact INR). Leave chart clears hover.
- Funnel bars cycle `accentChartSeries`; KPI icons purple/blue/indigo/teal; trend up `#098F6A` / down `#E06E3A`.
- **Pipeline funnel interactivity:** each stage is a button (`.sa-funnel-chart__row`) — hover wash via `--bg-subtle`, bar brightness emphasize, cursor pointer; click toggles `aria-pressed` / `.is-selected` (dim siblings with `.is-dimmed`); selection summary `.sa-funnel-chart__selection` (status + value + % of pipeline). Keyboard Enter/Space + `:focus-visible` ring via `--border-focus`. Works in light + dark via semantic tokens. “By value” chip stays label-only. No dashboard-wide status filter yet.
- Page notices: fixed `AdminPageToast`.
- Reference: `SalesOversightDashboard.tsx`, `.sa-dashboard` / `.sa-kpi-*` in `styles.css`, `brandColors.js` (`accentRevenueTrend`)

### Product usage / subscription overview (shared)

- **Routes:** sales/admin oversight product drill-down, sales workspace lead product, **customer** `/customer/products/:productKey`.
- **Composition:** detail/read-only — header + **two** content-sized panels (Subscription status · Billing period) + **Usage this period** fill panel. **No KPI strip**; **no eyebrow** (read-only lives in subtitle).
- **Chrome:** `.admin-users-page.product-overview-page` — flex column + gap **24 / 20 / 16**; canvas `#F4F4F6`; panels `.admin-users-panel` `#FFFFFF` / `#C9C9CF`. H1 **1.35rem** (≤720 → **1.25rem**). Black text **← Back** (not violet).
- **Header:** product name + subtitle `Company · Product usage · Read only`. Optional `headerActions` (customer **Request upgrade** / cancellation badge) sit in the header row (`min-height: 40px` buttons).
- **Subscription status:** definition grid (`.product-overview-grid`) — Status pill, Plan, Branch, Change type, Monthly price, Billing cycle, dates. Accent status pills: Active `#098F6A` · in-progress `#E0B73A` · cancelled/inactive caution `#E06E3A` / neutral `#808080` · other `#3A9EE0`.
- **Section icons (accent):** Status `#653AE0` · Billing `#3A9EE0` · Usage `#098F6A`.
- **Billing period:** copy + black progress bar + days-left meta (content-sized panel).
- **Usage panel:** only panel that `flex: 1`; body scrolls. Metric cards bordered `#C9C9CF`; track fill **`#3A9EE0`** (no violet hover wash). Empty copy when no limits / not active. **Campaign** uses the same multi-bar pattern as CCaaS (contacts + channel meters via `buildProductUsageMetrics`).
- Notices: `AdminPageToast` only (no in-flow banners).
- Reference: `ProductSubscriptionOverview.tsx`, `CustomerProductOverviewPage.tsx`, `product-overview.css`.

### Customer — Products (`/customer/products`)

- **Composition:** header + Subscribed products / Product requests / Cancellation requests panels (plus optional My Plans go-live when present). **No KPI strip.**
- **Product · location labels:** use **full catalog product name** via `getProductName` (not short codes like CDP / Campaign from `getProductLabel`) plus `formatCustomerPortalBranchLabel` — e.g. `AI Native Campaign Management · HQ`. HQ/primary/legacy `"hq"` → **HQ**; named branch from lead/org addresses → human label; UUID / missing friendly label → **Branch**. Never show raw branch ids or abbreviated product codes in My Plans / product / cancellation rows.
- **Active products (dashboard KPI):** live paid subscriptions via `/api/v1/me/entitlements` → `buildLeadDashboardModel` / `isActivePaidSubscription`. **Head office** portal users must receive **all branch** subscriptions (grant sync must not strip non-HQ locations after a new-product payment). **Branch** users see only their location — never blank the account when another branch has an awaiting-payment quote. Awaiting-payment / implementing rows may appear in purchased / go-live lists but must not wipe already-live products.
- **Campaign usage (CCaaS-style bars):** AI Native Campaign Management shows **Campaign contacts** (base entitlement, typically 50k) plus **per-channel** progress bars — Web Push, App Push, Email, SMS, WhatsApp — same `UsageBar` chrome as CCaaS (used/limit, % used, remaining). Limits resolve from quote config → catalog channel `defaultCount` → pricing-sheet free allowances (Email / WhatsApp first **1000**). Used stays **0** until usage telemetry exists. SMS / push bars appear when the subscription or catalog has a positive limit.
- **Request new product:** always visible in header (unless branch-drop pending badge). **Disabled** (greyed, `title="All products already purchased"`) when every `PRODUCT_CATALOG` id is already owned — count subscriptions **and** Implementing/UAT go-live rows (OTC-paid), not live-only. When enabled: **centered confirm modal** (`NewProductInquiryModal`) → notify sales via `requestType: "inquiry"` (no product picker / configure / pricing). Success → `AdminPageToast` (2s) + close modal. Duplicate open inquiry → notify again.
- **Upgrade / cancel:** unchanged (`/customer/products/:productKey/request` for upgrades). Bare `/customer/products/request` redirects to Products unless editing an existing configured request.
- **Notices:** `AdminPageToast` only.
- Reference: `CustomerProductsPage.tsx`, `NewProductInquiryModal.tsx`, `getProductName` in `productCatalog.js`, `formatCustomerPortalBranchLabel` in `customerPortal.js`, `buildProductUsageMetrics` in `leadDashboard.js`.

### Sales — Implementation / UAT (`/customers/:leadId/implementation-uat`)

- **Composition:** detail / ops form list — header + **one** fill panel (product sections). **No KPI strip**; **no eyebrow**.
- **Chrome:** `.admin-users-page.implementation-uat-page` — flex column + gap **24 / 20 / 16**; canvas `#F4F4F6`; panel `.admin-users-panel` `#FFFFFF` / `#C9C9CF`. H1 **1.35rem** (≤720 → **1.25rem**). Header actions: Back to customer + Refresh (`min-height: 40px` secondary buttons).
- **Panel:** sticky-feel section header (“Products” + count helper); body scrolls on short viewports (~1280×560). Product rows are **sections with dividers** inside the white panel (not nested grey cards).
- **Status pills (accent only):** Implementing (`awaiting_implementation`) `#E0B73A` / progress · UAT / awaiting go-live payment `#3A9EE0` / info · UAT expired `#E06E3A` / caution · Live `#098F6A` / success · unknown `#808080` / neutral. Classes: `.implementation-uat-status-pill--*`.
- **Visibility:** **Send UAT** form + CTA only while `awaiting_implementation`. After send (`uat`), credential form and Send **hide** (status + expiry only). **Extend UAT** form + primary CTA only when `uat_expired` (duration + credentials, re-emails customer).
- **Fields:** label-above `.admin-users-field` (2-col → 1-col ≤720); **UAT duration** native `<select>` (3 / 5 / 7 / 14 days) with equal-inset chevron; portal URL / username / password / notes; borders `#C9C9CF`; focus `#5F1FB0`. Change-request copy stays **inline** caution notice inside the section (not a page banner).
- **Actions:** primary **Send UAT** / **Extend UAT** black `#0B0B10`, `min-height: 40px`, content-sized (never stretch-tall). Payload includes `durationDays`. ≤720: stack fields + full-width buttons.
- **Notices:** load / send / extend → fixed pill `AdminPageToast` (auto-clears 2s). No in-flow `.form-error` banners.
- Reference: `ImplementationUatPage.tsx`, `implementation-uat.css`, `goLive.js`.

---

## Recommended standards (add as we go)

Ideas the skill should keep enforcing — promote into **Patterns** when first implemented:

1. **Density scale** — shared compact tokens for short-height (header, KPI, table row) instead of one-off magic numbers per page.
2. **Shared Table primitive** — one CSS block / component for sticky + ⋯ menu + truncation so pages don’t fork.
3. **Toast / alert strip** — ~~promote~~ **done as pattern:** fixed toast + field-level validation (see Validation & notices); still consolidate one shared toast component across portals.
4. **Filter drawer / popover** — one pattern for Filters across admin lists.
5. **Date / ID formatting** — monospace or tabular nums for IDs; consistent date format.
6. **Permission-aware UI** — hide vs disable actions consistently; tooltip explains why disabled.
7. **Motion** — 150–200ms ease for menus/sidebar only; no decorative motion.
8. **Focus order** — modal focus trap; return focus to ⋯ trigger on close.
9. **Print / export** — download actions don’t break toolbar wrapping on compact width.
10. **Dark marketing chrome vs app chrome** — login/marketing may use black panels + violet CTA; app shell stays white canvas + black primary.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-08-05 | **Lead create state dropdown:** Head office / branch division fields use `AdminFieldSelect` (always opens below, viewport-clamped scrollable menu; scrolls field into view when &lt; ~3 rows fit). Fixes native `<select>` overflowing Create lead drawer. |
| 2026-08-05 | **UTR 4 letters + 12–20 digits:** `validateUtr` / `sanitizeUtrInput` use `^[A-Z]{4}[0-9]{12,20}$`; sanitize uppercases. Docs: Finance Partner commission overview. |
| 2026-08-05 | **UTR 16–22 alphanumeric (mixed case):** `validateUtr` / `sanitizeUtrInput` use `^[A-Za-z0-9]{16,22}$`; no uppercase forcing in sanitize, CSS, or finance queue inputs. Docs: Finance Partner commission overview. |
| 2026-08-04 | **Partner/Finance commissions Status sticky thead:** Status `th:last-child` must keep `top: 0` when also using sticky `right` (finance list); partner Entries disables Actions pin and reasserts sticky after admin-users-light re-import. Docs: Partner Commissions. |
| 2026-08-06 | **Number inventory UX pass:** Add/Edit provider → right **side overlay** (sticky header/footer, Escape + backdrop, field validation + toast). Removed **Storage / Account ID** from form, meta, and provider cards (DB columns remain; API optional). Panel flex + short-viewport polish; delete confirm `#E06E3A`; dark theme parity. Docs: Pages → Number inventory. |
| 2026-08-06 | **Number inventory add-number:** country dial + national field with provider-country validation; logo avatar `object-fit: contain` in wide rect; search/list padding aligned; Add button height matches input. Docs: Pages → Number inventory. |
| 2026-08-06 | **Number inventory polish:** search toolbar `flex: 0` (no mid-panel float); logo upload full-width rectangle dropzone. Docs: Pages → Number inventory. |
| 2026-08-06 | **Number inventory page:** NM nav **Number inventory** — providers + unassigned numbers + CSV resolve; Map Number picks from provider inventory (or types manually). Docs: Pages → Number inventory. |
| 2026-08-04 | **Login story no clip:** short-height stage scrolls; story/form overflow visible + flex-start + bottom padding so Number management (and all feature copy) is fully readable. Docs: Login. |
| 2026-08-04 | **Admin Product pricing — Add-On Storage:** every product has `storageAddOn` (label Add-On Storage, unit GB) with regional default rates India `₹3000`, UK/international `30` ($30 amount), Dubai `110` AED; editable in Admin Pricing per region. Docs: Admin Product pricing. |
| 2026-08-04 | **UTR CAPITAL-only:** `sanitizeUtrInput` / `normalizeUtrInput` force A–Z + digits (no lowercase); pattern `^[A-Z0-9]+$`; partner Mark paid + finance queue manual reference. Docs: Finance Partner commission overview. |
| 2026-08-04 | **Finance Partner commission UTR Mark paid:** field-level `field--invalid` + `.field__error` under UTR input; sanitize strips non-alphanumeric; shared 8–22 `validateUtr` blocks submit. Docs: Finance Partner commission overview. |
| 2026-08-04 | **Admin Partners create/edit uniqueness:** work email + mobile checked in DB on create/update (exclude self on edit); overlay maps API duplicates to Contact-step field errors. Docs: Admin Partners / Edit partner. |
| 2026-08-04 | **Partner commissions Entries sticky thead:** same Actions-pin pitfall as slabs — `position: static` on Status `th:last-child` split the header on scroll. Disable `right` pin only; keep full thead sticky. Docs: Partner Commissions. |
| 2026-08-04 | **Partner Edit referral on assigned leads:** overlay no longer auto-closes when `assignedUserId` is set (was open→close flash). Partners may edit owned referrals after assignment; API already scopes by partnerId. Docs: Partner My referrals / Referral detail. |
| 2026-08-04 | **Partner/Finance slabs sticky thead:** overriding admin Actions pin must not use `position: static` on `th:last-child` — that drops vertical sticky for Commission rate while Deal range stays pinned. Disable `right` pin only; keep `thead th` sticky together. Docs: Partner Bank details / Commissions. |
| 2026-08-03 | **Dark Status toggle labels:** `.admin-slab-toggle` Active/Inactive uses `--text-primary` / `--text-secondary` (not `#3f3f49`); footer hint `--text-caption`. Dark safety-net + cancellation empty/detail secondary copy tokenized. Docs: Status toggle. |
| 2026-08-03 | **Dark sidebar active nav:** `.sidebar__link.is-active` purple wash `color-mix(#7423d7 36%, #0b0b10)` under `html[data-theme="dark"]` (all `app-shell` portals); inactive hover stays grey. Light theme unchanged. Docs: Shell / sidebar Theme. |
| 2026-08-03 | **Dark native select white flash:** Product pricing Region + app-wide toolbar/filter/period selects no longer hardcode `#fff` on rest/hover/focus; `theme-dark.css` uses `background-color` (not shorthand) + hover/focus/active safety-net so dark fill + chevron stay. Light unchanged (tokens). Docs: Selects / dropdowns + Admin Product pricing. |
| 2026-08-03 | **Admin Cancellation Queue status pill:** Status column widened + pill wrap so “Scheduled — active until period end” is fully readable; table `min-width: 1180px` keeps sticky Review. Docs: Pages → Admin Cancellation requests. |
| 2026-08-03 | **Dark NM Number mapping contrast:** page intro, panel “N mappings” subtitle, empty-state title/copy/icon, search placeholder, and status filter select use semantic text/surface tokens; `theme-dark.css` remaps `--au-*` on NM pages + toast wash. Same caption/empty pattern on NM Dashboard / Mail helpers. Docs: Shell Theme + Pages → Number mapping. |
| 2026-08-03 | **Dark overlay Close + back link:** `.admin-users-panel__icon-button` dark canvas `#0B0B10` + light icon (hover/focus/active stay dark); `.admin-users-bulk__back` uses `--text-secondary`/`--text-primary` so “Back to single user” stays readable. Light theme unchanged. Docs: Side overlay. |
| 2026-08-03 | **Dark custom select menus:** `.admin-field-select__option` no longer hardcodes white; dark theme sets menu/option/hover/selected/disabled via semantic tokens under `html[data-theme="dark"]` (portaled to `body`). Same safety-net for row menus, filter/sidebar/workspace/checkbox/export dropdowns. Light menus stay white. Docs: Selects / dropdowns. |
| 2026-08-03 | **Dark ⋯ menu-trigger black:** `.admin-users-table__menu-trigger` uses canvas `#0B0B10` (`--bg-canvas-subtle`) + light icon; hover/open `--bg-hover` — removed from sticky Actions surface/`!important` group so the button stays black. Light theme unchanged. Docs: Tables. |
| 2026-08-03 | **Pipeline funnel interactive:** stage rows are buttons with hover/selected/dimmed states + focus-visible ring (semantic tokens for light/dark); click toggles stage highlight and shows value share summary. Docs: Pages → Sales oversight. |
| 2026-08-01 | **Reseller lead detail full-width:** removed `max-width: 800px`; panels span `app-content`; profile 3-col grid; subscriptions `--fill` absorbs leftover height; black back link; brand empty state. Docs: Pages → Reseller Lead detail. |
| 2026-07-31 | **Hybrid sidebar:** collapsed matches Icons (no label clip-leak); expanded matches Full (wordmark + labels + Settings card). Docs: Shell / sidebar. |
| 2026-07-31 | **Customer Support — Raise ticket overlay:** removed My tickets / Raise ticket tab bar; default view is My tickets list + detail. Header CTA **Raise ticket** opens right-side overlay (not inline tab). Field validation under fields; success toast; draft minimize on dirty dismiss. Docs: Pages → Customer Support. |
| 2026-07-31 | **Side overlay draft minimize (admin + profile):** dirty right-side overlay forms (User credentials create/edit/bulk, Partners, Resellers, Commission slabs, My Profile) minimize to shared `.side-overlay-draft-island` on backdrop / Escape / Cancel — not silent close. Shared `SideOverlayDraftIsland`, `useSideOverlayDraftDismiss`, `sideOverlayFormDraft.js`. Lead overlays unchanged (`LeadCreateDraftIsland` wrapper). |
| 2026-07-31 | **Admin Partners / Resellers create-edit:** removed **Designation** from Details step (role is already Partner/Reseller); API still accepts optional `designation`. Docs: Pages → Admin Partners / Resellers. |
| 2026-07-31 | **Admin Partners ⋯ Delete:** centered confirm + `DELETE /api/admin/partners/:id`; blocked when referrals/commissions exist. Docs: Pages → Admin Partners. |
| 2026-07-31 | **Table Delete = centered confirm:** ⋯ Delete must not open Edit overlay; remove Delete from edit drawers; User credentials Delete confirms in popup (sales reassign-then-delete). Docs: Tables + Admin User credentials. |
| 2026-07-31 | **Admin User credentials Mark inactive:** ⋯ → centered modal; sales/sales_admin must reassign leads/customers then deactivate; other roles confirm only. Docs: Pages → Admin User credentials. |
| 2026-07-31 | **Table empty-state cluster:** panel empty grids that flex-fill use `align-content: center` + `grid-auto-rows: max-content` so icon/title/copy stay grouped (Sales Support and shared empty-state classes). Docs: Density / anti-stretch. |
| 2026-07-31 | **Invoice logo + content trim:** knock out black logo square + pin mark beside WORKTUAL; remove Due Date (PDF + sheet), Billing period from Description, Monthly/Yearly Bill from Payment Terms; keep Due on …; Chrome PDF toolbar + named Download PDF. |
| 2026-07-31 | **Invoice logo + Chrome PDF toolbar:** restore native Chrome PDF toolbar; keep in-app named Download PDF. |
| 2026-07-31 | **Invoice preview named download + layout grow:** in-app Download PDF uses blob + invoice number filename; black header equal vertical pad (PDF + sheet); bank/note/footer cards auto-grow on FE/BE drawers + editable sheet. Docs: Modals + Admin Invoice. |
| 2026-07-31 | **Invoice PDF pt template port:** Frontend `invoice.js` and backend `invoice.ts` both use generate_invoice.js pt drawers (no autoTable); sheet layout bank+note side-by-side then three footer cards. |
| 2026-07-31 | **WIPL invoice template + Temporary Lead UX:** PDF/header/Solution column/signature match WIPL sample for regular + Temporary; Temporary Set pricing allows all-zero send (no mandatory impl fee); invoice review Pencil uses contentEditable in-place edit (not form inputs); period/due whole-box opens calendar. Docs: Modals + Quote — Set pricing + Admin Invoice. |
| 2026-07-31 | **Set pricing summary Current product card:** `.pricing-summary__current` card chrome; caption eyebrows (no violet); aligned metric tiles + Final Payable neutral wash; **In this quote** product switcher. Docs: Pages → Quote — Set pricing. |
| 2026-07-31 | **Temporary Lead detail chrome:** omit KPI strip, Purchased products, and Customer product requests; CTA **Generate invoice** (not Start a purchase). Regular customers unchanged. Docs: Pages → Sales — Quote generation customer detail. |
| 2026-07-31 | **Lead/customer detail equal panel height:** Customer details ‖ Locations in `.lead-dashboard-grid` stretch to the same row height (`align-items: stretch`). Docs: Pages → Sales — Quote generation customer detail. |
| 2026-07-30 | **Start a purchase — Existing product (add-ons only):** no longer auto-opens Set pricing for `activeProducts[0]` (often CVM / value-management). Multiple actives → Choose product for add-ons; single active or per-row Purchase add-ons with product id → add-ons-only configure. Docs: Pages → Sales — Quote generation customer detail. |
| 2026-07-30 | **Quotations in progress — hide superseded Rejected:** after Redo (or a newer Approved/Paid quote) for the same product request / product+branch, the old Rejected row leaves open quotations; Rejected stays until a replacement exists so Redo remains available. Docs: Pages → Sales — Quote generation customer detail. |
| 2026-07-30 | **Customers by status — no early Partially paid:** submit for finance keeps existing customers **Paid**; Partially paid only after finance approve (Approved + Paid history) or real partial payment. Pending finance KPI still counts quotations. Docs: Pages → Leads / Customers + Sales — Dashboard. |
| 2026-07-30 | **Sales overview Pending finance review KPI:** counts open `Pending Finance Review` quotations for SE-owned leads (created/assigned), not lead status — so Paid customers with a new quote awaiting finance increment the KPI; SSE/`focus` refresh on `quotation.*`. Docs: Pages → Sales — Dashboard. |
| 2026-07-30 | **Total customers KPI:** Sales overview counts the same portfolio membership as Customers (`isPaidCustomer` / `countTotalCustomers`) — Partially paid and active orgs awaiting new-product payment stay included; Temporary Lead / first-time prospects unchanged. Docs: Pages → Sales — Dashboard. |
| 2026-07-30 | **Customer portal Active products:** HQ entitlements include all-branch subscriptions; grant resync no longer deletes non-HQ grants for head-office users (fix after new-product payment). Branch users keep location-scoped products; awaiting-payment quotes must not blank the dashboard. Docs: Pages → Customer — Products. |
| 2026-07-30 | **Campaign usage multi-channel bars:** Customer Products / product overview Campaign usage mirrors CCaaS — contacts + Web Push / App Push / Email / SMS / WhatsApp meters; limits from quote → catalog → free 1000 email/WhatsApp. Docs: Pages → Customer — Products. |
| 2026-07-30 | **Redo pricing after finance reject:** Resume rejected quotation at Set pricing for the same product(s)/config (not Choose products). Docs: Pages → Sales — Quote generation customer detail. |
| 2026-07-30 | **Customers stay customers on new quote:** finance approve / reject / revert no longer demotes Paid customers to Approved/Pending/Rejected; status stays Paid while pending finance, then Partially paid after approve. Portfolio lists active orgs regardless of transient lead status. Docs: Pages → Leads / Customers lists. |
| 2026-07-31 | **Sales Edit lead overlay + unsaved dismiss:** Edit opens the same right-side overlay as Create (`LeadEditProvider` on sales shell; `startEditLead` from Products/Customers). Dirty create/edit forms minimize to `.lead-create-draft-island` on backdrop / Escape / Minimize / Cancel — no silent discard. Edit dirty = diff from loaded baseline (`leadFormDraft.js`). Legacy `/onboarding/:leadId/edit` → `/products` + `openEditLeadId`. Create Cancel now uses same minimize path. |
| 2026-07-30 | **Invoice review in-sheet edit:** Pencil replaces the PDF preview with an editable A4 sheet (customer, lines, dates, amounts, terms); Done rebuilds PDF via `buildInvoicePdfFromSheet`. Docs: Modals + Pages → Leads lists. |
| 2026-07-30 | **Invoice review Pencil edit:** Temporary Lead “Invoice contents” gets a Pencil icon-button; limited edit panel (due date, period start/end, optional session notes) with Cancel/Done; Done updates assignment config and regenerates PDF preview (notes not on PDF). Docs: Modals + Pages → Leads lists. |
| 2026-07-30 | **Sales Support ticket list anti-stretch:** list pane may match detail height and scroll, but `.customer-support-list` uses `align-content: start` + `grid-auto-rows: max-content` so ticket cards stay content-sized (no full-height empty selected card). Docs: Density / anti-stretch + Pages → Sales Support. |
| 2026-07-30 | **Temporary Lead Set pricing — no catalog defaults:** all products start empty; CCAAS plan select no longer seeds tier volumes/rates (Agent/SMS/Email etc.); module capability changes stay at 0. Normal sales leads unchanged. Docs: Pages → Quote — Set pricing. |
| 2026-07-30 | **Invoice PDF header:** left company address no longer overlaps Invoice # — meta column is measured; address wraps inside max width; **Due Date** under Date when set (Temporary Lead). Docs: Pages → Admin Invoice settings + Quote — Set pricing. |
| 2026-07-30 | **Temporary Lead pricing summary:** fixed Period Start/End label/input alignment; added selectable **Due date** below Period (above Final Payable); invoice Payment Terms use selected due date. Docs: Pages → Quote — Set pricing. |
| 2026-07-30 | **Invoice GST / series / bank:** optional GSTIN; IGST vs CGST/SGST by buyer state; admin Invoice settings (`WIPL-year-n` series + bank block on PDF); sales preview draft number. Docs: Pages → Admin Invoice settings. |
| 2026-07-30 | **Temporary Lead invoice contents:** five modes — Implementation only · Configuration only · Implementation and configuration · Add-on only · All in one (add-ons only billed when Add-on only or All in one). Docs: Pages → Leads lists / quote generation. |
| 2026-07-30 | **Temporary Lead (finance approval only):** Products scope Temporary Lead; finance queue Temporary badge + approve-for-record (no payment link); lead detail hides payment follow-up. Docs: Pages → Leads lists, Finance queue, Quote generation customer detail. |
| 2026-07-30 | **Mail Outlook connect retry:** after skipped/cancelled Microsoft sign-in, topbar **Sign in with Microsoft** restarts OAuth (`needsOutlookConnect`); amber “Mailbox not available yet” stays env-missing only. Compose finance + login popup pending clear aligned. Docs: Pages → Mail Workspace. |
| 2026-07-30 | **Customer Products full product names:** My Plans Accept/Go live and cancellation rows use `getProductName` (catalog full name) + location — e.g. `Cognitive Customer Data Platform (CDP) · HQ`, not `CDP · HQ`. Docs: Pages → Customer — Products. |
| 2026-07-30 | **Customer Products location labels:** My Plans / product rows show **HQ** (not `hq`) and **Branch** (or human branch name) instead of UUIDs via `formatCustomerPortalBranchLabel`. Docs: Pages → Customer — Products. |
| 2026-07-30 | **Payment history — no duplicate View invoice:** removed card-level right-side **View invoice** when the product-line link is present (`PaidPaymentRow`); keep multi-mode **View by product/location** + fallback only if no product rows. Docs: Pages → Sales — Quote generation customer detail. |
| 2026-07-30 | **Payment follow-up no duplicate failed copy:** under-amount “Payment failed” status + `failureReason` removed from sales Payment follow-up card (history `Failed` badge remains). Docs: Pages → Quote generation customer detail. |
| 2026-07-30 | **Quote Set pricing field validation:** empty/zero Implementation Fee (and other required base/add-on fields) highlight the control with under-field `.field__error`; accordion opens; footer uses first specific message — not generic-only. All products via `getProductConfigFieldErrors` + CCAAS field errors. Docs: Pages → Quote — Set pricing. |
| 2026-07-30 | **Sales/Customer Support detail width:** list column `minmax(320px, 360px)`; detail pane capped at brand **798px** (`min-width: 0`, `justify-self: start`) so subject/thread/reply no longer stretch full leftover width; Send reply black primary content-sized. Docs: Pages → Sales Support + Customer Support. |
| 2026-07-30 | **Customer Products — Request new product:** CTA no longer opens configure workflow; centered confirm → sales `inquiry` notify; button disabled when all catalog products purchased (incl. Implementing/UAT go-live). Docs: Pages → Customer — Products. |
| 2026-07-30 | **Quote generation customer detail full-width:** removed `max-width: 1120px` centering; `#F4F4F6` canvas + white panels; 5 content-sized KPIs incl. **UAT / implementation** (`isPreLivePaidProduct`); Active products stay product-paid live only; accent KPI icons; `AdminPageToast` (no layout-jumping banners). Docs: Pages → Sales — Quote generation customer detail. |
| 2026-07-30 | **Centered page toasts (2s):** `AdminPageToast` defaults to top-center fixed + `autoDismissMs={2000}` for success **and** error (when `onDismiss` is set); base `.admin-users-toast` CSS centered in `admin-users-light.css` + `portal-chrome.css`; callers no longer pass 3–4s overrides. Overlay-inline form alerts unchanged. Docs: Validation & notices. |
| 2026-08-03 | **Dark sticky Actions columns:** converted sticky last/action cols (admin tables, Unassigned Leads, leads, NM, finance thead, admin pricing Item/Tier) from `#fff` to `--bg-surface` / `--au-surface`; `theme-dark.css` `!important` safety net for late page CSS. Docs: Tables + Theme. |
| 2026-08-03 | **Dark theme portal pass (1A):** expanded `theme-dark.css` — dark canvas/surface tokens, purple primary CTAs, `--au-*` remap, high-specificity overrides for admin tables/overlays/pricing, sales/finance/partner/reseller/NM/mail light leaks; re-import in `App.tsx` after route CSS. Docs: Shell / sidebar Theme. |
| 2026-08-03 | **Quote Set pricing accordion equal height:** `.ccaas-collapse-toggle` `min-height: 66px` + copy grid always reserves caption line so Implementation / Discount rows match Choose a plan / Modules. Docs: Pages → Quote — Set pricing. |
| 2026-07-30 | **Login Reset password modal:** step-aware helper (hide 6-digit/mailbox copy on password + success); field validation + compact in-modal alerts; sticky header/body/footer scroll; black 40px CTAs; focus `#5F1FB0`; strength meter accent palette (Strong `#098F6A`). Docs: Pages → Login — Reset password modal. |
| 2026-07-30 | **Shell scroll contract:** `.app-content` stays the default scroll container (`overflow-y: auto`); removed trapping `overflow: hidden` on finance queue + audited partner/reseller/sales-admin/product-overview/UAT shells. Fill-table pages keep page/panel `overflow: hidden` + table-wrap scroll; detail pages keep page scroll on short viewports. Docs: Patterns → Shell scroll contract. |
| 2026-07-29 | **Admin mobile number field flat:** `.mobile-field` in User credentials Create/Edit (and shared `.admin-users-field--mobile`) matches sibling inputs — no drop/inset shadow; nested input borderless; shell focus `#5F1FB0`. Docs: Forms + Pages → Admin User credentials. |
| 2026-07-29 | **Colored profile initials (global):** shared `getAvatarTone` / `getProfileInitials` + `ProfileAvatar` + `profile-avatar.css` — soft accent washes (palette only); removed grey tone overrides in `styles.css`; applied on User credentials, CPU, Partners, Resellers, sales agents, oversight dashboard, mail. Docs: Patterns → Profile avatars / initials. |
| 2026-07-31 | **Sales Implementation / UAT duration + hide/extend:** duration select (3/5/7/14 days) on Send/Extend; Send UI only for Implementing; hides while UAT active; Extend UAT (primary) only after expiry; API `durationDays`. Docs: Pages → Sales — Implementation / UAT. |
| 2026-07-29 | **Sales Implementation / UAT:** admin detail chrome — `#F4F4F6` canvas + one white Products panel; accent status pills (Implementing `#E0B73A`); label-above credential fields; black 40px Send UAT; pill `AdminPageToast` (no layout-jumping banners); short-viewport scroll. Docs: Pages → Sales — Implementation / UAT. |
| 2026-07-29 | **Quote Set pricing — no Base Plan header toggle:** removed package/base-plan `FeatureEnableToggle` from `.ccaas-collapse-header__end` on CRM / CDP / Campaign / VM / Ticketing (`PricingPackage`); accordion opens content always; packages seeded enabled; quote inclusion derives from filled fields when flag is stale false. Keep CCAAS mid-period agent/number toggles inside add-ons body + BillingCycleToggle. Docs: Pages → Quote — Set pricing. |
| 2026-07-29 | **Quote Set pricing — accordion all products:** CRM / CDP / Campaign / VM / Ticketing / Generic (and Implementation + Discount via `PricingSection`) use shared `PricingCollapsePanel` with CCAAS `.ccaas-pricing-panel` / `.ccaas-collapse-toggle` — click header to open/close; Base Plan (or addons-only Add-ons) default open; other sections closed until click. Docs: Pages → Quote — Set pricing. |
| 2026-07-29 | **Quote Set pricing — consistency pass:** Discount sections last (after Add-ons + Implementation, matching CCAAS); dialed back `FeatureEnableToggle` — kept only for CCAAS mid-period agent/number + Base Plan package enable + BillingCycleToggle; CRM/CDP/Campaign/VM/Ticketing/Generic add-ons use always-visible `AddonStaticSection` / `QuantityRateAddonSection` + slab select None (no switches). Docs: Pages → Quote — Set pricing. |
| 2026-07-29 | **Quote Set pricing — all products:** CRM / CDP / Campaign / Value Management / Ticketing / Generic aligned to CCAAS add-on chrome — flattened `.pricing-package` (white / `#C9C9CF` / 8px, section dividers); shared select chevron rules on pricing hierarchy; package add-ons scroll on short viewports. Docs: Pages → Quote — Set pricing. |
| 2026-07-29 | **Quote Set pricing CCAAS Add-ons:** replaced checkboxes with `FeatureEnableToggle` rows (agent seats / phone numbers expand qty+rate when on); flattened nested grey cards; channel-wise 2-col denser grid + select chevron rules; panel scrolls on short viewports. Docs: Pages → Quote — Set pricing. |
| 2026-07-29 | **Quote Set pricing CCAAS Configuration table:** `.ccaas-config-table-wrap` / `.ccaas-config-table` polished — sticky ITEM/RATE/TOTAL header, 8px/`#C9C9CF` panel chrome, styled qty/rate/total inputs + `#5F1FB0` focus, no row hover, internal scroll for short viewports; accordion/add-on borders aligned. Docs: Pages → Quote — Set pricing. |
| 2026-07-29 | **Quote Set pricing chrome:** hide header “N of M ready” + toolbar “N in quote” when `stage === "configure"`; soften `.pricing-progress__item.is-active` to thin grey `--border-default` (styles + brand-enforcement). Docs: Pages → Quote — Set pricing. |
| 2026-07-29 | **Quote Set pricing Current Product:** `.configured-product` / `.is-active` use thin grey `#C9C9CF` border + 8px radius + `#F4F4F6` wash; removed black ring / inset bar (styles + brand-enforcement). Docs: Pages → Quote — Set pricing. |
| 2026-07-31 | **Partner My referrals edit:** removed empty-state Lead creation CTA; Actions **Edit** (awaiting assignment only) → detail + `openEditLeadId`; detail **Edit referral** via `LeadEditProvider` mode=`partner` + `PUT /api/partner/leads/:id`. Docs: Pages → Partner My referrals / Referral detail. |
| 2026-07-29 | **Quote Set pricing:** removed centered modal-style panel on configure stage; full canvas + white form/summary surfaces + sticky Previous/Next; all products. Docs: Pages → Quote — Set pricing. |
| 2026-07-29 | **Quote Choose products:** removed centered modal-style panel on select stage; full canvas + product cards only + sticky Next. Docs: Pages → Quote — Choose products. |
| 2026-07-29 | **Admin Customer portal users Actions visible:** shared compact CSS hid `nth-child(7|8)` on all admin tables (credentials “Last updated / Updated by”), which removed **Actions** on 7-col portal users; scoped hide to `.admin-users-credentials-page`; CPU table `min-width` + data % leave sticky Actions `56px`. Docs: Tables + Pages → Customer portal users. |
| 2026-07-29 | **Finance approve 502 / vanishing lead:** approve path skips PDF hydrate + bounds payment-link timeout; Lead dashboard shows retryable “Service temporarily unavailable” on 502/503/504. Docs: Finance queue. |
| 2026-07-29 | **Admin Commission slabs ⋯ menu portal:** Edit/Delete was clipped by table-wrap overflow; menu now portals to `body` with fixed coords (same as User credentials). Docs: Tables + Pages → Commission slabs. |
| 2026-07-29 | **Admin Resellers Edit:** Edit (⋯) opens the same right side overlay as Create (prefilled, 4 steps); legacy `/edit` route redirects to list. Docs: Pages → Resellers / Edit reseller. |
| 2026-07-29 | **Admin Partners Edit:** Edit (⋯) opens the same right side overlay as Create (prefilled, 4 steps incl. Bank); legacy `/edit` route redirects to list. Docs: Pages → Partners / Edit partner. |
| 2026-07-29 | **Admin Customer portal users table:** ⋯ Actions moved to dedicated sticky last column (not beside Status); table `min-width` + wrap `overflow-x` for narrow widths. Docs: Tables (data grids) + Pages → Customer portal users. |
| 2026-07-29 | **Product usage overview → admin chrome:** removed sales KPI strip/eyebrow; admin panels + definition grid; accent status pills; usage fill panel (`#3A9EE0` bars); customer Request upgrade in header actions. Docs: Pages → Product usage / subscription overview. |
| 2026-07-28 | **Partner Commissions:** restored slabs panel; unified Entries table with Search + status filter (All/Pending/Paid) like My referrals; pagination. Docs: Pages → Partner Commissions. |
| 2026-07-28 | **Payment follow-up forward mail:** replaced dead `.compose-mail-form` UI with shared `.mail-compose` (chrome, rows, Cc/Bcc, Cancel/Send footer); 2-col payment summary on forward page. Docs: Pages → Sales Payment follow-up forward mail. |
| 2026-07-28 | **Partner Commissions polish:** removed slabs from page; Payment history is sole fill panel (min-height so rows visible); hide empty Pending panel; explicit table text colors; Paid status pill. Docs: Pages → Partner Commissions. |
| 2026-07-28 | **Partner Commissions + payment history:** sidebar Commissions nav; Pending + Payment history (paid date / UTR / notes); KPIs; admin pagination. Docs: Pages → Partner Commissions. |
| 2026-07-28 | **Hybrid sidebar clip-reveal:** no layout swap on expand (icons/text stay put); rail width only uncovers labels; Finance slot keeps hairline→text; settings stays icon-sized. |
| 2026-07-28 | **Hybrid sidebar no vertical jump:** locked brand 48px + nav margin-top 16px; section label stays hidden on expand so the hovered icon does not shift to another item. |
| 2026-07-28 | **Collapsed sidebar brand mark:** icons/hybrid rail shows `worktual-logo.png` at top; full/hybrid-expanded keeps wordmark. |
| 2026-07-28 | **Sidebar Settings menu (icons rail):** preferences popover portals to `document.body` (fixed) so it is not clipped by the narrow sidebar / main content. |
| 2026-07-28 | **Finance Partner commissions list pagination:** Partners panel footer **Rows** 10/20/50 + page nav (same as admin tables). Docs: Pages → Finance Partner commissions. |
| 2026-07-28 | **Finance partner overview density:** Partner details content-sized (no stretch gap); Deals panel gets admin **Rows** 10/20/50 + page nav footer. Docs: Pages → Finance Partner commission overview. |
| 2026-07-27 | **Finance My Profile:** removed nav link; opens from sidebar profile card preferences menu (overlay), same as number-mgmt / sales. Legacy `/finance/account` redirects with `openAccount`. |
| 2026-07-28 | **Finance Partner commissions → partner overview:** list is partner-aggregated (no Deal column); clickable rows open partner detail (generated / paid / leads vs customers / deals + Mark paid). APIs `/api/finance/commissions/partners`. Docs: Pages → Finance Partner commissions. |
| 2026-07-28 | **Finance:** removed **Commission slabs** nav item and standalone page; `/finance/commission-slabs` redirects to Partner commissions (slabs panel remains there). Admin `/admin/commission-slabs` unchanged. |
| 2026-07-28 | **Partner Bank details country-aware form:** India / UAE / UK field sets from partner country; IBAN + SWIFT columns; API returns `country` with bank account. Docs: Pages → Partner Bank details. |
| 2026-07-28 | **Partner Bank details polish:** removed Save footer top border; slabs table Commission rate column no longer clipped by admin 56px sticky Actions. Docs: Pages → Partner Bank details. |
| 2026-07-28 | **Partner Bank details full-width:** removed `max-width: 800px`; panels span `app-content`; payout form content-sized; slabs `--fill` absorbs leftover height. Docs: Pages → Partner Bank details. |
| 2026-07-27 | **Partner referral detail back link:** ← Back to referrals is black text button (`#0B0B10`), not violet. Docs: Pages → Partner Referral detail. |
| 2026-07-27 | **Partner referral detail full-width:** removed `max-width: 800px`; panels span `app-content`; profile 3-col grid; quotations `--fill` panel absorbs leftover height. Docs: Pages → Partner Referral detail. |
| 2026-07-27 | **Finance:** removed **Agent / DID usage** nav item, route `/finance/agent-did-usage`, and page. Docs: Number management Customer detail note. |
| 2026-07-27 | **Finance Partner commissions → admin chrome:** entries + slabs panels; Status/Country in Filters popovers; admin table density; compact 28px filter actions. Docs: Pages → Finance Partner commissions. |
| 2026-07-27 | **Sales agent detail density:** leads table row padding match admin/customer (`14px 12px`); Filters Clear/Apply locked to **28px** height. Docs: Pages → Sales oversight. |
| 2026-07-27 | **Sales agent detail table + Filters:** even row height/typography (0.8125rem/500); tags capped + nowrap; Reassign → text link; Filters popover narrowed (~260px), single-column, scroll-capped, uniform field borders. Docs: Pages → Sales oversight. |
| 2026-07-27 | **Sales oversight Filters consolidate:** Period + Sort moved into agents Filters popover (scrollable); Period into agent-detail Filters (scrollable); Reassign buttons compacted (~26–28px). Docs: Pages → Sales oversight. |
| 2026-07-27 | **Sales oversight compact consistency:** Period moved into agents toolbar next to Filters; compact Filters popover; H1 locked **1.35rem** (≤720 **1.25rem**) across dashboard/agents/detail/lead; page gaps **24/20/16** (never admin 10px); short-height no longer hides Actions/Reassign (override `nth-child(7–8)` hide; hide Revenue); Reassign = black primary. Docs: Pages → Sales oversight. |
| 2026-07-27 | **Sales oversight consistency:** Contact Us = Sign in height (48px); agent detail page gap 24px; sticky text Actions ≥6.5rem (Reassign visible); partner assign panel → admin table + toast + horizontal scroll; column prefs v2 restores Assigned default. Docs: Login + Sales oversight. |
| 2026-07-27 | **Sales agent detail leads table:** removed Actions/View; rows clickable → lead overview (`tr.is-clickable`). Docs: Pages → Sales oversight. |
| 2026-07-27 | **Sales lead overview:** removed Status KPI (customer status not shown); summary is 3 cards. Docs: Pages → Sales oversight. |
| 2026-07-29 | **Mail mobile open fix:** ≤1023px read pane shows via `.mail-read-shell.is-open .mail-read-pane`; Back clears selection. Message fetch uses `/api/mail/messages/item?uid=`. Docs: Pages → Mail Workspace. |
| 2026-07-27 | **Sales lead overview → admin chrome:** `sa-lead-detail-page` + KPI summary (block label/value) + customer/quotation/products/assignment panels; purchased rows clickable; Inbox empties. Docs: Pages → Sales oversight. |
| 2026-07-27 | **Sales agent detail polish:** KPI icons centered + Product mix Layers icon/`#653AE0`; Rows 10/20/50 admin select chrome; **Status column removed** from leads table/export columns. Docs: Pages → Sales oversight. |
| 2026-07-27 | **Sales agent detail short-viewport:** compact header (Period inline); KPIs stay 4-col until 900px; leads panel flex-fills + internal scroll; ≤720px denser chrome / hide panel subtitle. Docs: Pages → Sales oversight. |
| 2026-07-27 | **Sales agent detail → admin chrome:** `admin-users-page` + KPI grid + Assigned leads panel/table/footer; Filters/Export tool buttons; action-only leads (no row hover). Docs: Pages → Sales oversight. |
| 2026-07-27 | **Sales agents Filters:** removed list/grid toggle; added admin Filters popover (Activity, Deals, Department). Docs: Pages → Sales oversight. |
| 2026-07-27 | **Sales agents pagination footer:** `#C9C9CF` top border (not neutral-100); Rows select min-width + 16px/48px single chevron. Docs: Pages → Sales oversight. |
| 2026-07-27 | **Sales agents → admin directory chrome:** `.admin-users-page` / panel / sticky table / Rows pagination; clickable rows; Period/Sort single CSS chevron; list/grid toggle kept. Docs: Pages → Sales oversight. |
| 2026-07-27 | **Native select single chevron:** removed Lucide `ChevronDown` siblings next to `<select>` (Period/Sort, rows-per-page, etc.); one CSS chevron at `right 16px`, padding `16px` / `~48px`. Docs: Patterns → Selects. |
| 2026-07-27 | **Mail setup status → topbar pill:** “Mailbox not available yet” moved into right-side amber pill in `.mail-topbar` (dismissible); removed full-width setup card. Docs: Pages → Mail Workspace. |
| 2026-07-27 | **Mail setup banner compact:** amber status strip + dismiss; one-line on ≤1280 / ≤720 so mailbox toolbar isn’t pushed down. Docs: Pages → Mail Workspace. |
| 2026-07-27 | **Mail formatting toolbar:** single-line horizontal scroll (`.mail-editor-toolbar__scroll`) — no wrap on narrow compose. Docs: Pages → Mail Compose. |
| 2026-07-27 | **Mail compose short-viewport:** signature iframe no longer crushes message body (`min-height: 0` + capped max-height; `MailMessageBody` min/max for compose). Docs: Pages → Mail Compose. |
| 2026-07-27 | **Sales oversight KPI consistency (compact):** equal-height cards within each row (`align-items: stretch` + `grid-auto-rows: auto`); hide meta line ≤1280 / ≤720px (match admin); `.sa-kpi-card__body` layout. Docs: Pages → Sales oversight. |
| 2026-07-27 | **Sales oversight Team dashboard density:** stop KPI stretch on short viewports; page flex column + content-sized 3-col KPI grid; short-height compact chrome; period select chevron. Docs: Pages → Sales oversight; portal equal-height list drops `.sa-kpi-grid`. |
| 2026-07-26 | **Admin User credentials ⋯ menu portal:** last-row upward menu was covered by sticky rows (only Edit / Mark inactive visible). Menu now portals to `body` with fixed coords so all 4 actions show. Docs: Tables (data grids). |
| 2026-07-26 | **Number management Dashboard → admin primitives:** KPI grid/cards + customers panel/table reuse `.admin-users-*` (same chrome as User credentials); keep 5-card KPI accents. Docs: Pages → Number management Dashboard. |
| 2026-07-26 | **Number mapping table → admin primitives:** panel/table reuse `.admin-users-panel` / `.admin-users-table` (same chrome as User credentials); keep mapping pills + no actions-column shadow. Docs: Pages → Number management Mapping. |
| 2026-07-26 | **Number mapping ⋯ menu fix:** menu was overlapping the trigger (anchor stretched to 64px row + missing open-state z-index on `.nm-mapping-table`). Anchor hugs trigger; absolute below/flip-up. Docs: Pages → Number management Mapping. |
| 2026-07-26 | **Available numbers modal polish:** white sticky-header/footer picker (`min(560px)`); Add to pool + Pool sections; live search; selection meta chip; selected-row wash; field-level add errors; empty Inbox state; remove hover `#E06E3A`; Escape close. Docs: Pages → Number management Mapping. |
| 2026-07-26 | **Number mapping per-number dial:** Create/Edit overlay country code is per number row (not shared); Available pool fill preserves each selected number’s dial. Docs: Pages → Number management Mapping. |
| 2026-07-26 | **Number mapping phone fields:** country dial code + digit-length validation on Create overlay and Available numbers pool; default dial from customer country. Docs: Pages → Number management Mapping. |
| 2026-07-26 | **Number mapping Available numbers:** pool of unmapped numbers; Create overlay picker multi-select up to product slots + add/remove in modal. Docs: Pages → Number management Mapping. |
| 2026-07-26 | **Number mapping Create:** N number fields from remaining product entitlement; removed Type/Agent from overlay + table. Docs: Pages → Number management Mapping. |
| 2026-07-26 | **Number mapping from customer:** Go to Number mapping opens Create overlay with locked Tenant ID; Manage mappings filters by tenant. Docs: Pages → Number management Mapping. |
| 2026-07-26 | **Number management Customer detail:** Products purchased pills omit products with 0 entitled numbers (minimum 1). Docs: Pages → Number management Customer detail. |
| 2026-07-26 | **Number mapping:** product-scoped mappings (CC/CRM/Campaign) with remaining entitlement capacity; unique number across products; Product column + create/edit select. Docs: Pages → Number management Mapping + Customer detail. |
| 2026-07-27 | **Nav speed:** layout-route shells (`Outlet`) + sidebar hover prefetch + in-content lazy fallback; pages stay `React.lazy`. Docs: Shell / sidebar. |
| 2026-07-27 | **Shell preferences:** profile card popover — Theme (light/dark/system) + Sidebar (full/icons/hybrid); `uiPreferences.js` + `theme-dark.css`; all SidebarFooter shells. Docs: Shell / sidebar. |
| 2026-07-27 | **Cancellation requests:** pagination footer (Rows 10/20/50 + page controls) matching admin lists. Docs: Pages → Admin Cancellation requests. |
| 2026-07-27 | **Commission slabs:** removed Sort order from table, create/edit overlay, and CSV. Docs: Pages → Admin Commission slabs. |
| 2026-07-27 | **Integer zero select:** focus/click selects exact `0`; input capture strips leading zeros (`04555`→`4555`) for controlled fields. Global via `integerInputFocus.js`. Docs: Patterns → Forms. |
| 2026-07-27 | **NM Mapping back:** scoped Manage mappings view shows **Back to customer** (`customerId` in URL). Docs: Pages → Number management Mapping. |
| 2026-07-27 | **NM Mapping tenant scope:** Manage mappings keeps `?tenantId=`; sidebar Number mapping (clean URL) shows all tenants. Docs: Pages → Number management Mapping. |
| 2026-07-27 | **NM Customer Map number:** opens create right overlay on customer detail (locked tenant); Number mapping Create unchanged on its page. Docs: Pages → Number management Customer detail. |
| 2026-07-27 | **NM Customer Products purchased:** pills show purchased count + remaining to map (`mapped`/`remaining` from API). Docs: Pages → Number management Customer detail. |
| 2026-07-27 | **NM Customer mapped numbers:** pagination footer (rows 10/20/50 + page controls) matching admin lists. Docs: Pages → Number management Customer detail. |
| 2026-07-27 | **NM Customer detail:** removed Agent/DID usage panel; mapped numbers admin table (no Type/Agent); ⋯ Edit / Mark active·inactive / Delete; edit right overlay. Docs: Pages → Number management Customer detail. |
| 2026-07-27 | **Admin Filters popover:** Role/Status selection works with portaled `AdminFieldSelect` (outside-click ignores menu); Filters rightmost + z-index above table so popover aligns and is not covered. Docs: Toolbars + Selects. |
| 2026-07-27 | **Partner Referral detail:** admin panel chrome — profile + quotations panels, accent pills, empty state, toast (no layout-jumping banner); no row hover on quotes table. Docs: Pages → Partner Referral detail. |
| 2026-07-26 | **Reseller sidebar:** removed Leads nav item; route `/reseller/leads` kept for deep links / dashboard. Docs: Reseller Leads. |
| 2026-07-26 | **Reseller portal UI pass:** dashboard KPIs + recent leads; leads/renewals/invoices directory chrome (search, pagination, pills, empty states); lead detail panels; Create lead right overlay + draft island (no sidebar Create); `is-reseller` badge. Docs: Reseller pages. |
| 2026-07-26 | **Partner sidebar:** removed Lead creation nav item; create stays on page CTAs → shell overlay. Docs: Partner/Reseller Create lead overlay. |
| 2026-07-26 | **Partner/Reseller create lead:** right-side overlay + draft island (sales parity); `PortalLeadCreateProvider` on shells so islands persist across portal routes; sidebar Create uses `onSelect`; legacy create routes redirect with `openCreate`. Docs: Partner/Reseller Create lead overlay. |
| 2026-07-26 | **Partner Bank details:** form chrome — payout account panel (field-level validation, text-only Save), readonly slabs `variant="panel"`, `AdminPageToast` (no layout-jumping banners / floppy icon). Docs: Pages → Partner Bank details. |
| 2026-07-26 | **Partner My referrals:** directory chrome — header Lead creation CTA, one fill-height panel (search + assignment select), navigable rows, accent quotation/assignment pills, empty vs filtered-empty, pagination footer, `AdminPageToast`. Docs: Pages → Partner My referrals. |
| 2026-07-26 | **Partner Dashboard:** overview chrome — header Lead creation CTA, 2 content-sized KPIs (Active `#098F6A` / Awaiting `#E0B73A`), fill-height Recent referrals panel with empty state + navigable rows, `AdminPageToast`; role badge `is-partner` (B&W). Docs: Pages → Partner Dashboard. |
| 2026-07-26 | **Number management:** eligibility = number entitlement total > 0 (CC agents + extras; CRM users + extras; Campaign purchased numbers). Zero-total orgs hidden from dashboard/detail/mapping. Docs: Pages → Number management Dashboard + Customer detail. |
| 2026-07-26 | **Number management Customer detail:** **Products purchased** pills show per-product purchased number counts from subscription entitlements. Docs: Pages → Number management Customer detail. |
| 2026-07-26 | **Number management Customer detail:** Customer information shows **Products purchased** pills (active Contact Center / CRM / Campaign). Docs: Pages → Number management Customer detail. |
| 2026-07-26 | **Number management Dashboard:** customer list + KPIs limited to orgs with active Contact Center / CRM / Campaign subscriptions. Docs: Pages → Number management Dashboard. |
| 2026-07-26 | **Admin Product pricing (per product):** shared `.admin-pricing-product` stack; product-specific ledes; full-span section grids; `ImplementationFeeStrip` on CRM/CDP/Campaign/VM/Ticketing; Additional numbers block; Campaign channel labels; slab/region empty states. Docs: Pages → Admin Product pricing. |
| 2026-07-26 | **Admin Product pricing:** sole CSS in `admin-pricing.css` (removed conflicting legacy block from `styles.css`); white channel/add-on surfaces; Region label + select polish; red `*` on numeric fields; field-level add-row errors; sticky Item column; short-height meta hide. Docs: Pages → Admin Product pricing. |
| 2026-07-26 | **Admin User credentials:** Country and mobile dial code stay in sync both ways (country → dial + digit trim; dial → country via `getCountryForDialCode`). Docs: Pages → Admin User credentials. |
| 2026-07-25 | **Mail workspace notices:** replaced in-flow `.mail-page__notice-card` (OAuth/load/API errors) with fixed pill `AdminPageToast`; success auto-clears in 3s; DB/API errors default to error toast (not green info). Kept `.mail-page__outlook-connect` + `.mail-page__setup-card` as persistent status chrome; empty `.mail-page__banners` no longer reserves space. Docs: Pages → Mail Workspace. |
| 2026-07-25 | **Number management My Profile:** removed nav item; open from sidebar tenant card → right overlay (`AccountSettingsOverlay`); `/number-management/account` redirects with `openAccount`. Reuses shared form polish (red required marks, read-only managed email + hint, text-only Save). Docs: Shell + Pages → Number management My Profile. |
| 2026-07-25 | **Number management Customer detail:** flex detail page (no eyebrow/KPI); customer info definition grid; mapped numbers + usage panels; month select chevrons; accent status pills; read-only tables (no row hover); empty states + mapping link; `AdminPageToast`. Docs: Pages → Number management Customer detail. |
| 2026-07-25 | **Number management Mapping:** inline form → config table + Create/Edit right overlay; status filter select; ⋯ Edit/Delete; accent status pills; delete confirm modal; field validation + `AdminPageToast`; no KPI/eyebrow. Docs: Pages → Number management Mapping. |
| 2026-07-25 | **Number management Dashboard:** flex page + accent KPI strip + fill-height customers table; search in panel header; navigable rows (`is-clickable`); `AdminPageToast`; no eyebrow. Docs: Pages → Number management Dashboard. |
| 2026-07-25 | **Finance Quotation queue:** list/detail → directory table + Review wide right overlay; search + status select toolbar; accent status pills; no row hover; empty vs filtered-empty. Docs: Pages → Finance Quotation queue. |
| 2026-07-25 | **Sales My Profile:** removed nav item; open from sidebar tenant card → right overlay (`AccountSettingsOverlay`); `/account` redirects with `openAccount`. Form polish: red required marks, read-only managed email + hint, text-only Save. Docs: Shell + Pages → Sales My Profile. |
| 2026-07-25 | **Sales Support:** flex page + one white panel (toolbar in header); no eyebrow/icon H1; accent status/priority pills; list/detail fill + scroll; filter select chevrons; reply field errors + primary Send; empty vs filtered-empty. Docs: Pages → Sales Support. |
| 2026-07-25 | **Create lead overlay:** red `.field__required` asterisks; compact `.mobile-field` dial control; removed always-visible mobile `.field__hint`; country codes required + persisted; industry type resolve hardened for DB save. Docs: Sales Leads + Validation. |
| 2026-07-25 | **Leads/Customers table rows:** fixed 64px row height; long company names ellipsis + `title` (no wrap). Docs: Sales Leads. |
| 2026-07-25 | **Create lead draft island:** vertical half-rounded right-edge tab; Y-only drag; pointer cursor on whole tab; hover peeks out. Docs: Sales Leads draft minimize. |
| 2026-07-25 | **Mail compose auto-signature:** saved signature shows under the compose body (`.mail-compose__signature`) and is appended on send without TipTap mangling. |
| 2026-07-25 | **Mail signature paste:** TipTap replaced with HTML-preserving `MailHtmlSignatureEditor` so Outlook/Gmail signatures keep layout in editor + preview. Docs: Pages → Mail Signature. |
| 2026-07-25 | **Mail templates UI:** dedicated `.mail-templates-panel` — config form + saved list, Shared pill, field-level name validation, pill toast, text-only Save, danger Delete, empty state. Docs: Pages → Mail Templates. |
| 2026-07-25 | **Mail folders:** sidebar keeps Inbox/Sent/Drafts/Archive/Junk only; removed Deleted/Notes/Conversation History. Drafts/Archive/Junk wired via existing mail APIs; Deleted remains move destination only. |
| 2026-07-25 | **Sales oversight Revenue trend:** series locked to red `#E06E3A` (`accentRevenueTrend`); chart-wide nearest-point hover (guide + ring + tooltip). Skill + Pages updated. |
| 2026-07-25 | **Admin dropdowns open below:** status/filter/form selects use `AdminFieldSelect` (Cancellation, Users, CPU, Partners, Resellers, Commission slabs). |
| 2026-07-28 | **Customer portal:** Account moved from sidebar nav into footer settings menu (tenant button → Account). Account page invoices block removed (Invoices nav remains). Branch add is confirmation-only (no details form); sales collects location later. |
| 2026-07-25 | **Admin Customer portal users notices:** replaced layout-shifting success banner with fixed top-center pill toast (`AdminPageToast` pill); auto-clears in 3s. |
| 2026-07-25 | **Inactive row ⋯ menus:** do not put `opacity` on `tr.is-inactive` (stacking context covers the menu). Mute non-action `td`s only. |
| 2026-07-25 | **Admin Customer portal users:** ⋯ beside Status — Mark active/inactive, Force logout, Delete (+ APIs `PATCH`/`DELETE` `/api/admin/customer-users/:id`). Role column removed earlier. |
| 2026-07-25 | **Admin Customer portal users:** removed Role column from table; filter/search/CSV retain role. Compact hide indices updated (Branch / Last updated). |
| 2026-07-25 | **Admin User credentials Create/Edit:** Role, Country, and mobile dial-code use `AdminFieldSelect` so menus always open **below** the field (not OS-native overlay-on-field). Docs: Selects / dropdowns. |
| 2026-07-24 | **Create lead — compact multi draft islands:** smaller draggable chips (icon + step); multiple sessions stack; empty forms never become islands (discard on minimize). |
| 2026-07-24 | **Create lead — draft island:** backdrop / Escape / Minimize collapses overlay to right-edge `.lead-create-draft-island` (form state kept); Cancel or island ✕ discards; island click or Create lead CTA resumes. Docs: Pages → Sales Leads. |
| 2026-07-24 | **Create lead overlay — restore 2-col form grid:** removed forced single-column on `.admin-lead-create-overlay__body .form-grid`; Basic details / branch profile use side-by-side fields again; address/tax stay full width. |
| 2026-07-24 | **Create lead — flat location sections:** removed `.location-section` card chrome (border / fill / black or accent inset bar) for HQ and branches; fields sit flush like Basic details. |
| 2026-07-24 | **Create lead — multi-branch Address & billing:** overlay forces single-column fields; each branch is a HQ-style `location-section` (address / state / tax) plus Basic-details-style branch profile; Add another branch appends another section. Docs: Pages → Sales Leads. |
| 2026-07-24 | **Sales Leads — Create lead overlay:** header Create lead now opens a right-side `admin-side-overlay` (same chrome as `PartnerCreateOverlay`: backdrop, Escape, steps, sticky footer) instead of navigating to `/onboarding`. `OnboardingPage` gained a `variant="overlay"` mode (sales create only — partner and edit flows unchanged) via thin wrapper `LeadCreateOverlay.jsx`. `/onboarding` route now redirects to `/products` with `state.openCreate` to open the overlay for old links/nav. |
| 2026-07-24 | **Sales Leads CTA:** header Create lead (Plus + black primary) matches admin Create pattern; opens onboarding wizard. |
| 2026-07-24 | **Sidebar nav:** removed trailing chevrons on all portals; `ShellLayout` matches Admin (icon + label only). Dropped `showChevron` prop. |
| 2026-07-24 | **Non-admin portals pass:** shared `portal-chrome.css` (canvas/surfaces, equal-height KPI + finance queue panels, selects, navigable-only hover, login polish); banners→`AdminPageToast` on customer/sales-oversight/finance; funnel `accentChartSeries`; admin untouched. |
| 2026-07-24 | **Sales Dashboard:** grey canvas + white surfaces; accent KPI icons; navigable customer rows (`is-clickable`); no renewals-row hover; `AdminPageToast`; removed header eyebrows. Docs: Pages → Sales Dashboard. |
| 2026-07-24 | **Table row hover:** only for navigable rows (`tr.is-clickable` / equivalent). Removed default `.admin-users-table tbody tr:hover` wash on admin list tables (Users, CPU, Partners, Resellers, slabs, cancellation). Skill + Tables pattern updated. |
| 2026-07-24 | **Admin Product pricing:** config composition (no KPI); short product rail; white panel on grey canvas; segmented subtabs; compact Qty·Rate config table; region select chevron; `AdminPageToast`; text-only Save. Docs: Pages → Product pricing. |
| 2026-07-24 | **Non-admin portal chrome:** expanded `portal-chrome.css` — shared canvas/surfaces, equal-height KPI/product rows, native select chrome, navigable-only table hover; login stage grey + white form + black CTA; `.leads-table__row` hover gated behind `is-clickable` (Products/Customers + number-mgmt rows). |
| 2026-07-24 | **Overlay footer buttons:** Create/Edit forms keep `.admin-side-overlay__form` as flex (not stretched grid); footer actions `min-height: 40px`, text-only Create/Save (no floppy icon). Matches Create partner / Create slab. |
| 2026-07-24 | **Progressive KPI→table gap lock:** `.admin-users-page` must stay `display: flex` + `gap: 24px` (not stretched `display: grid`). KPI grid `height: max-content`. Card→panel gap identical on Users / CPU / Partners / Resellers. Skill anti-stretch + anti-patterns updated. |
| 2026-07-24 | **Anti-stretch lock:** sidebar nav links fixed 46px (`align-content: start`); KPI cards content-sized (`flex: 0 0 auto`); only table panel may flex-grow. Skill + consistency updated so this does not regress. |
| 2026-07-23 | Compact shell menu toggle: white bg + violet hamburger (`#7423D7`) for contrast on dark header. |
| 2026-07-23 | Admin My account moved to sidebar tenant card → right overlay; removed from nav; `/admin/account` redirects with overlay open. |
| 2026-07-23 | Removed page/overlay “Admin” (and similar) eyebrows — headers are title + subtitle only. |
| 2026-07-23 | Mail compose: fixed chrome/To/Subject/toolbar heights (no flex-stretch); toolbar under New message; equal Cancel/Send. |
| 2026-07-23 | Resellers Create: right side overlay with 4-step status (Details → Contact → Billing → Portal); `/admin/resellers/new` opens overlay on list. Shared `.admin-overlay-steps` moved to `admin-users-light.css`. |
| 2026-07-23 | Partners Create: right side overlay with 3-step status (Details → Contact → Portal); `/admin/partners/new` opens overlay on list. |
| 2026-07-23 | Fix Resellers grey canvas + white surfaces; Cancellation → table + overlay + empty states; Sales oversight charts/KPI icons use accent palette (`accentChartSeries`). |
| 2026-07-23 | Admin Resellers list → Partners chrome + toast; Partner/Reseller create/edit wizards → light canvas + field-level validation; shared `AdminPageToast`; cancellation + sales oversight toasts. |
| 2026-07-23 | Admin cancellation queue + sales oversight: migrated layout-jumping banners to `AdminPageToast`; reject note field-level validation; drop-branch info notice. |
| 2026-07-23 | Skill + consistency: **Validation & notices** elevated to global all-pages rule (field highlight + fixed toast; no layout-jumping banners). |
| 2026-07-23 | User credentials: field-level validation (red border + shadow on invalid input); page success/error → fixed toast (no layout jump). |
| 2026-07-23 | Admin User credentials: Create/Edit (+ bulk) migrated to right side overlay; Escape close; bulk uses `--wide` 560px. Confirms stay centered. |
| 2026-07-23 | Forms: Create/Edit use right side overlay (not centered modal); confirms stay modal. Skill + CSS `.admin-side-overlay`; Commission slabs Create/Edit migrated. |
| 2026-07-23 | Selects/dropdowns: equal L/R edge inset (12px text + chevron), `cursor: pointer`, hover border/wash; skill + CSS on admin field/filter/country selects. |
| 2026-07-23 | Skill + consistency: page composition — KPI cards opt-in; pages need not look identical. Commission slabs: removed KPI card row (config table only). |
| 2026-07-23 | Admin Commission slabs: list chrome + Create slab CTA; table with ⋯ Edit/Delete; right-column Active/Inactive toggle (`#098F6A` / `#C9C9CF`); modal create/edit; Status toggle pattern added. |
| 2026-07-23 | Grey page canvas `#F4F4F6` extended to Admin Customer portal users + Partners (same as User credentials); skill already documents canvas rule. |
| 2026-07-23 | Page canvas rule → `#F4F4F6` (skill + consistency); trial applied on Admin User credentials only (`admin-users-credentials-page`); cards stay `#FFFFFF`. |
| 2026-07-23 | Admin Partners: aligned to User credentials chrome; Countries KPI `#3A9EE0`; Filters (status/country) + Download; sticky table + ⋯ Edit/Force logout; compact hide Country/Last updated. |
| 2026-07-23 | Admin Customer portal users: aligned to User credentials chrome; KPI/companies accent `#653AE0`; role pills org_admin/branch_user; Filters + Download; sticky table + ⋯ force logout; compact hide Branch/Last updated. |
| 2026-07-23 | Admin User credentials full pass: brand chrome `#FFFFFF`/`#C9C9CF`, accent KPI/pill/avatar map, danger `#E06E3A`, focus `#5F1FB0`, truncation titles, short-viewport density. |
| 2026-07-23 | Accent palette added for charts, card icons, pills, danger (`#808080` … `#098F6A`); skill + reference updated. |
| 2026-07-23 | Initial file: brand globals, shell/sidebar, tables, toolbars, KPIs, login + admin users notes; skill `worktual-ui-ux` created. |
