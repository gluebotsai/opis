# Worktual Contact Centre — UI Design Guidelines

Derived from Worktual Contact Center v2 (`apps/web`). Brand hub: [`docs/brand/`](brand/). Use **Ant Design + Tailwind** per the technical stack.

| Quick links | |
|-------------|---|
| Brand naming & voice | [`brand/BRAND_GUIDELINES.md`](brand/BRAND_GUIDELINES.md) |
| Tokens & components | [`brand/UI_THEME.md`](brand/UI_THEME.md) |
| Layout patterns | [`brand/LAYOUTS.md`](brand/LAYOUTS.md) |
| Screenshots | [`brand/reference-ui/`](brand/reference-ui/) |

**Principle:** Enterprise, calm, high-contrast navigation + light workspace. Conversation-centric layouts. AI assists inline — never a separate “AI app” chrome.

---

## 1. Brand

| Element | Guideline |
|---------|-----------|
| Product name | **Worktual Contact Center** (login/marketing: “AI-Powered Contact Center for Enterprise Teams”) |
| Logo | [`worktual-logo.png`](brand/worktual-logo.png) — runtime path `/brand/worktual-logo.png` via `WorktualMark`; height `h-7`–`h-8` |
| Portal labels | Uppercase eyebrow: `ADMIN PORTAL` / `AGENT PORTAL` — `text-[10px] tracking-[0.14em] text-white/45` on dark sidebar |

Canonical logo: [`docs/brand/worktual-logo.png`](brand/worktual-logo.png). At web scaffold time, copy to `apps/web/public/brand/worktual-logo.png` and reuse the v1 `WorktualMark` component pattern.

### Reference UI (canonical screenshots)

**Contact Center (current):** [`docs/brand/reference-ui/`](brand/reference-ui/) — see that folder’s README for the full index.

| Screenshot | Description |
|------------|-------------|
| [`login.png`](brand/reference-ui/login.png) | Contact Center sign-in |
| [`dashboard.png`](brand/reference-ui/dashboard.png) (+ `-right-expanded`, `-sidebar-hidden`, `-sidebar-hidden-right-expanded`) | Dashboard + co-worker split |
| [`queues.png`](brand/reference-ui/queues.png) (+ `-right-expanded`, `-sidebar-hidden`, `-sidebar-hidden-right-expanded`) | Queues + co-worker split |
| [`workspace.png`](brand/reference-ui/workspace.png) (+ `-sidebar-hidden`) | Three-panel workspace + customer 360 + co-worker |
| [`reports.png`](brand/reference-ui/reports.png) (+ `-right-expanded`, `-sidebar-hidden`, `-sidebar-hidden-right-expanded`) | Reports & Analytics |

**Legacy My Account / Setup (historical):** [`docs/brand/old/reference-ui/`](brand/old/reference-ui/)

| Screenshot | Description |
|------------|-------------|
| [`login.png`](brand/old/reference-ui/login.png) | My Account sign-in (legacy) |
| [`customer-portal-dashboard.png`](brand/old/reference-ui/customer-portal-dashboard.png) | Customer portal dashboard |
| [`setup-list-business-hours.png`](brand/old/reference-ui/setup-list-business-hours.png) | Setup list + table |
| [`setup-form-business-hours.png`](brand/old/reference-ui/setup-form-business-hours.png) | Setup add/edit form |

**Platform shell patterns (from reference UI):**

- **Scope pill** (top of content): `Company admin · all branches` — `rounded-full bg-neutral-200/80 px-3 py-1 text-xs`
- **Nested sidebar:** section label e.g. `CUSTOMER PORTAL` / `SETUP WORKSPACE`; expandable groups; active nested item = rounded bg + **left white accent bar**
- **List layout:** main table card (left) + fixed **~280px** right rail: primary CTA on top, then white summary cards
- **Form layout:** full-width form card; black **Close form** / **Create** in header; circular **day toggles** (active = black fill, inactive = white outline)
- **Dashboard:** 4-up stat cards with icon, large number, caption footer

Contact Centre admin/agent portals should reuse this same shell — only nav items and page content change.

---

## 2. Color palette

### Core (v1 — map to Ant Design `theme.token`)

| Role | Hex / class | Ant Design token |
|------|-------------|------------------|
| **App canvas** | `#f3f4f6` (`neutral-100`) | `colorBgLayout` |
| **Sidebar** | `#111111` | Custom layout sider |
| **Primary action** | `#000000` (black) | `colorPrimary` |
| **Primary hover** | `neutral-800` | `colorPrimaryHover` |
| **Card / surface** | `#ffffff` | `colorBgContainer` |
| **Border** | `neutral-200` | `colorBorder` |
| **Body text** | `neutral-900` | `colorText` |
| **Secondary text** | `neutral-500` | `colorTextSecondary` |
| **Muted label** | `neutral-400` | `colorTextTertiary` |
| **Destructive** | `red-50` bg / `red-600` text | `colorError` |

### Login / marketing accent (hero panel only)

| Role | Value |
|------|--------|
| Hero background | `#0b0618` |
| Headline accent | `#a78bfa` (violet) |
| Icon accent | `#c4b5fd` |
| Gradient | Purple radial overlays on dark (`rgba(124,58,237,0.45)`, `rgba(88,28,135,0.35)`) |

### Status

| State | Treatment |
|-------|-----------|
| Active | Black toggle / `font-medium text-neutral-900` |
| Inactive | `neutral-300` toggle / `text-neutral-600` |
| Error | `bg-red-50 px-3 py-2 text-sm text-red-600 rounded-xl` |
| Selected shift chip | `bg-black text-white ring-2 ring-black/20 ring-offset-2` |

---

## 3. Typography

| Element | Style |
|---------|--------|
| Font | **Inter Variable** (`@fontsource-variable/inter`) |
| Page title | `text-2xl sm:text-3xl font-semibold tracking-tight` |
| Section title | `text-base font-semibold` |
| Eyebrow / context | `text-sm text-neutral-600` (e.g. “Setup workspace”, “Contact Center Admin”) |
| Micro label (stats, table headers) | `text-[11px] font-medium tracking-[0.12em] uppercase text-neutral-400` |
| Sidebar section label | `text-[10px] tracking-[0.14em] uppercase text-white/40` |
| Body | `text-sm` |
| Helper / caption | `text-xs text-neutral-600` |

**Ant Design:** Set `fontFamily` to Inter; use `Typography.Title` level 2–3 for page titles; keep eyebrow as custom `Text type="secondary"`.

---

## 4. Spacing & layout

| Pattern | Value |
|---------|--------|
| Page max width | `max-w-6xl` (lists/forms), `max-w-5xl` (coming soon) |
| Page padding | `px-4 py-5 sm:px-6 lg:px-8 lg:py-6` |
| Section gap | `gap-5` between major blocks |
| Card padding | `p-5 sm:p-6` |
| Sidebar width | `260px` desktop; `280px` mobile drawer |

### App shell (from v1)

```
┌─────────────────────────────────────────────────────────┐
│ [Dark sidebar 260px]  │ [Header: role badge + email]   │
│  Logo + portal label  │──────────────────────────────────│
│  Nav links            │  Main content (gray canvas)     │
│  User + logout        │                                 │
└─────────────────────────────────────────────────────────┘
```

- **Sidebar:** `bg-[#111111] text-white`, nav item `rounded-xl px-3 py-2.5`, active `bg-white/10 font-medium`
- **Header:** `border-b border-neutral-200/80 bg-[#f3f4f6]`, role pill `rounded-full bg-neutral-200/80 px-3 py-1 text-xs`
- **Mobile:** Hamburger → overlay drawer, `bg-black/40` scrim

**Ant Design:** `Layout` with dark `Sider` + `Content`; match tokens above in `ConfigProvider`.

---

## 5. Radius & elevation

| Element | Radius |
|---------|--------|
| Inputs, buttons (primary) | `rounded-xl` (12px) |
| Cards, panels | `rounded-2xl` (16px) |
| Icon buttons | `rounded-lg` (8px) |
| Shift chips | `rounded-full` |
| Avatar | `rounded-full` |

| Element | Shadow |
|---------|--------|
| Cards | `shadow-sm` + `border border-neutral-200` |
| Login card | `shadow-[0_20px_60px_rgba(15,23,42,0.12)]` |
| Mobile sidebar | `shadow-2xl` |

**CSS variable (v1):** `--radius: 0.625rem` — Ant Design `borderRadius: 12`, `borderRadiusLG: 16`.

---

## 6. Components

### Buttons

| Type | Classes (v1) | Ant Design |
|------|--------------|------------|
| Primary | `h-10 rounded-xl bg-black text-white hover:bg-neutral-800` | `type="primary"` (override to black) |
| Secondary | `border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50` | `default` |
| Icon action | `size-8 rounded-lg border border-neutral-200` | `Button` `size="small"` + icon |
| Destructive icon hover | `hover:bg-red-50 hover:text-red-600` | `danger` variant on icon buttons |

Height: **40px** (`h-10`) for main actions; **44px** (`h-11`) for login inputs.

### Form fields

- Height `h-11`, `rounded-xl`, `border-neutral-200`
- Focus: `focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200`
- Labels: `text-sm font-medium text-neutral-800`
- Optional hint: `(optional)` in `text-neutral-400`
- Icon-in-field: `lucide` icon `left-3`, padding `pl-10`

**Ant Design:** `Form` + `Input`/`Select` with `size="large"` and custom `className` for `rounded-xl` where needed.

### Cards & stat tiles

```text
Stat tile: rounded-2xl border bg-white px-4 py-4 shadow-sm
  Label: uppercase micro (11px, tracking 0.12em, neutral-400)
  Value: text-2xl font-semibold tracking-tight
```

Use `Card` with no heavy shadow; prefer border + `shadow-sm`.

### Tables

- Wrapper: white card `rounded-2xl border shadow-sm`
- Toolbar: search `h-10 rounded-xl` with `Search` icon, filter count on right
- Header row: `bg-neutral-50`, columns `text-[11px] uppercase tracking-[0.12em] text-neutral-600`
- Body: `border-t border-neutral-100`, cell `py-3.5`
- Row actions: icon buttons `size-8 rounded-lg border`

**Ant Design:** `Table` inside `Card`; customize `header` cell style to match micro uppercase labels.

### Status toggle

- Track: `h-6 w-11 rounded-full`, on = `bg-black`, off = `bg-neutral-300`
- Thumb: `size-5 white shadow`
- Label: “Active” / “Inactive” beside switch

**Ant Design:** `Switch` with `className` overrides or custom component for black active state.

### Empty & loading states

| State | Pattern |
|-------|-----------|
| Loading | `LoaderCircle animate-spin` + `text-sm text-neutral-600`, min-height `280px`–`420px` |
| Empty list | Centered icon in `size-12 rounded-2xl bg-neutral-100`, title `text-lg font-semibold`, CTA primary button |
| Coming soon | `Construction` icon, `min-h-[420px]` centered card |
| Dashed placeholder | `border-dashed border-neutral-200` + helper text |

### Tooltips

- Dark: `bg-neutral-900 text-white text-xs rounded-lg px-3 py-2 max-w-xs`

**Ant Design:** `Tooltip` with dark overlay style.

---

## 7. Page patterns

### Standard list page (e.g. Queues)

1. **Header row:** eyebrow + title + description (left); primary “Add” button (right)
2. **Stat grid:** 4 columns on xl, `sm:grid-cols-2`
3. **Main card:** search + table (or empty state)

### Standard form page (e.g. Queue form)

1. Back link `text-sm text-neutral-600` + eyebrow + title
2. Top actions: Cancel (outline) + Save (primary black)
3. **Two-column layout on xl:** main form sections (left) + summary sidebar `280px` (right)
4. Sections in `rounded-2xl border bg-white p-5 shadow-sm`
5. Sidebar summary: uppercase micro label + `dl` key/value rows

### Login

1. Black top bar: logo + “Contact Us” outline button
2. Split card: purple hero (desktop) + white form
3. Footer trust badges: Secure Login, Real-time AI, Enterprise Security

---

## 8. Icons

- Library: **lucide-react**
- Default size: `size-4` (16px); inline with nav `size-4 shrink-0 opacity-90`
- Empty state heroes: `size-5`–`size-6`

**Ant Design:** Prefer Lucide for custom layouts; Ant icons optional inside Ant components.

---

## 9. Roles & navigation

| Role | Home | Shell label |
|------|------|-------------|
| Admin | `/admin/dashboard` | ADMIN PORTAL |
| Agent | `/agent/inbox` | AGENT PORTAL |

- Role guard: admin cannot browse `/agent/*` and vice versa
- Nav: icon + label, single section (no group labels in v1)

When expanding to [contact_center_portals_understanding.pdf](../Documents/contact_center_portals_understanding.pdf) modules, keep the same visual language — add nav groups with sidebar section labels (`text-[10px] uppercase`).

---

## 10. Conversation workspace

Implemented in `apps/web` — three-panel layout on gray canvas. Full spec: [`brand/LAYOUTS.md`](brand/LAYOUTS.md).

```text
┌──────────────────┬────────────────────────────┬──────────────────┐
│ Conversation     │ Conversation window        │ Customer 360 +   │
│ list (~26%)      │ (messages, composer)       │ co-worker (~28%) │
└──────────────────┴────────────────────────────┴──────────────────┘
```

- **Panels:** separate `WorkspacePanel` cards — `rounded-2xl border border-neutral-200 bg-white shadow-sm`, `gap-4` on `#f3f4f6` canvas
- **Channel:** badge/metadata on rows — not separate apps; chat/email/whatsapp/voice share bubble UI (email uses distinct thread view)
- **Customer 360:** compact summary, stat mini-cards (`border-neutral-200`), contact block, tags, collapsible notes
- **Co-worker:** embedded in right panel via `WorkspaceAiPanel` — no dedicated AI nav route
- **Suggested reply:** inline in composer (compact strip, dismiss, click-to-insert)
- **Height:** `h-svh` + flex `min-h-0` chain — panels grow to bottom of viewport

---

## 11. Co-worker (guided admin flows)

Split layout for Queues and similar pages. Spec: [`brand/LAYOUTS.md`](brand/LAYOUTS.md) §3.

```text
┌─────────────────────────────┬──────────────────────┐
│ Co-worker chat (~65%)       │ Preview / form (~35%)│
└─────────────────────────────┴──────────────────────┘
```

- **Grid:** `lg:grid-cols-[65fr_35fr]` with manual expand to 35/65
- **Chat bubbles:** user = white + `rounded-tr-sm`; co-worker = `neutral-50` + `rounded-tl-sm`
- **Composer:** `rounded-2xl border bg-neutral-50/80`, icon-only send
- **Guided preview:** progress bar, Up next / Completed sections, per-agent channel blocks
- **Do not** auto-expand preview panel when guided queue create starts — user expands manually

**Sources:** `copilot-workspace.tsx`, `guided-queue-preview.tsx`, `embedded-copilot-panel.tsx`

---

## 12. Ant Design + Tailwind integration

| Use Ant Design for | Use Tailwind for |
|--------------------|------------------|
| Table, Form, Select, DatePicker, Modal, Drawer | Page layout, spacing, responsive grids |
| Switch, Tabs, Badge, Tooltip | Sidebar shell, login hero, custom stat tiles |
| ConfigProvider theme tokens | One-off marketing gradients |

### Suggested `ConfigProvider` tokens

```ts
{
  token: {
    fontFamily: '"Inter Variable", Inter, sans-serif',
    colorPrimary: '#000000',
    colorPrimaryHover: '#262626',
    borderRadius: 12,
    borderRadiusLG: 16,
    colorBgLayout: '#f3f4f6',
    colorBorder: '#e5e5e5',
  },
}
```

Do **not** mix unrelated radii (avoid Ant default 6px beside `rounded-2xl` cards without token sync).

---

## 13. Accessibility

- All icon-only buttons: `aria-label`
- Status switch: `role="switch"` + `aria-checked`
- Form errors: `role="alert"`
- Focus rings on inputs (visible `ring-2`)
- Sufficient contrast on sidebar (`white/70` min for nav text)

---

## 14. Reference files

### Brand & design docs

| Doc | Contents |
|-----|----------|
| [`brand/README.md`](brand/README.md) | Brand hub index |
| [`brand/BRAND_GUIDELINES.md`](brand/BRAND_GUIDELINES.md) | Naming, logo, voice |
| [`brand/UI_THEME.md`](brand/UI_THEME.md) | Tokens, components |
| [`brand/LAYOUTS.md`](brand/LAYOUTS.md) | All layout patterns |
| [`brand/reference-ui/`](brand/reference-ui/) | Screenshot library |

### UI screenshots

See [`docs/brand/reference-ui/`](brand/reference-ui/) — login, dashboard, queues, workspace, and reports (with right-panel-expanded variants where applicable). Legacy My Account refs: [`docs/brand/old/reference-ui/`](brand/old/reference-ui/).

### Code (ai_contact_center_2)

| Pattern | Source |
|---------|--------|
| App shell & sidebar | `apps/web/src/layouts/AppLayout.tsx` |
| Global header & page title | `apps/web/src/features/layout/page-title-context.tsx` |
| Workspace 3-panel | `apps/web/src/components/workspace/workspace-panels.tsx` |
| Co-worker split | `apps/web/src/components/assistant/copilot-workspace.tsx` |
| Guided queue preview | `apps/web/src/components/workforce/guided-queue-preview.tsx` |
| Ant Design theme | `apps/web/src/app/theme.ts` |
| Login | `apps/web/src/pages/auth/LoginPage.tsx` |
| List pages | `apps/web/src/pages/admin/workforce/*.tsx` |
| Brand marks | `apps/web/src/components/brand/` |
| Navigation | `apps/web/src/config/navigation.tsx` |

---

## 15. Do / Don’t

| Do | Don’t |
|----|--------|
| Keep workspace background `#f3f4f6` | Pure white full-page background |
| Use black for primary CTAs | Purple/blue as default button color (reserve for login hero) |
| Uppercase micro-labels for KPI/table headers | All-caps body text |
| `rounded-xl` / `rounded-2xl` consistently | Mix sharp and pill shapes on same page |
| Inline co-worker in workspace / split admin pages | Dedicated “AI Module” nav item |
| Page title in global header via `useSetPageTitle` | Duplicate page `h1` inside content area |
| Three separate panel cards in workspace | One white wrapper around all columns |
| Per-agent channel toggles in guided preview | Single global channel list only at bottom |
| Empty states with illustration + one CTA | Blank white areas with no guidance |
