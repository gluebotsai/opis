# Worktual — UI Theme & Tokens

Design tokens for **ai_contact_center_2**. Implemented in [`apps/web/src/app/theme.ts`](../../apps/web/src/app/theme.ts) (Ant Design) and Tailwind utility classes in components.

**Principle:** Enterprise, calm, high-contrast navigation + light workspace. Conversation-centric layouts. AI assists inline — never separate “AI app” chrome.

---

## Color palette

### Core application

| Role | Value | Tailwind / token | Ant Design `theme.token` |
|------|-------|------------------|--------------------------|
| App canvas | `#f3f4f6` | `bg-[#f3f4f6]` | `colorBgLayout` |
| Sidebar | `#111111` | `bg-[#111111]` | `Layout.siderBg` |
| Primary action | `#000000` | `bg-black` | `colorPrimary` |
| Primary hover | `#262626` | `hover:bg-neutral-800` | `colorPrimaryHover` |
| Card / surface | `#ffffff` | `bg-white` | `colorBgContainer` |
| Border | `#e5e5e5` | `border-neutral-200` | `colorBorder` |
| Body text | `#171717` | `text-neutral-900` | `colorText` |
| Secondary text | `#737373` | `text-neutral-500` | `colorTextSecondary` |
| Muted label | `#a3a3a3` | `text-neutral-400` | `colorTextTertiary` |
| Destructive | `#dc2626` | `text-red-600` | `colorError` |

### Accent (secondary — not primary CTAs)

| Role | Value | Usage |
|------|-------|--------|
| Violet surface | `from-violet-100 to-indigo-100` | Agent avatar blocks in queue preview |
| Violet text | `text-violet-700` | Avatar initials, active channel chips |
| Channel active chip | `border-violet-200 bg-violet-50 text-violet-700` | Per-agent channel toggles |
| Amber highlight | `text-amber-700` | Open tickets stat when count > 0 |

### Login / marketing only

| Role | Value |
|------|-------|
| Hero background | `#0b0618` |
| Headline accent | `#a78bfa` |
| Icon accent | `#c4b5fd` |

---

## Typography

| Element | Style |
|---------|--------|
| Font | **Inter Variable** (`@fontsource-variable/inter`) |
| Global page title (header) | `text-xl sm:text-2xl font-semibold tracking-tight` |
| Section title | `text-base font-semibold` |
| Eyebrow / context | `text-sm text-neutral-500` |
| Micro label (stats, table headers) | `text-[10px]–[11px] font-medium tracking-wide uppercase text-neutral-400` |
| Sidebar section label | `text-[10px] tracking-[0.14em] uppercase text-white/40` |
| Body | `text-sm` |
| Helper / caption | `text-xs text-neutral-500` |

---

## Radius & elevation

| Element | Radius | Shadow / border |
|---------|--------|-----------------|
| Inputs, buttons | `rounded-xl` (12px) | — |
| Cards, panels | `rounded-2xl` (16px) | `border border-neutral-200 shadow-sm` |
| Icon buttons | `rounded-lg` (8px) | `border border-neutral-200` |
| Pills / tags | `rounded-full` | `border border-neutral-200` |
| Chat bubbles | `rounded-2xl` + corner trim | `rounded-tl-sm` (assistant) / `rounded-tr-sm` (user) |

Ant Design tokens: `borderRadius: 12`, `borderRadiusLG: 16` — keep in sync with Tailwind.

---

## Component patterns

### Panel card (workspace, lists, co-worker shell)

```text
rounded-2xl border border-neutral-200 bg-white shadow-sm
flex h-full min-h-0 flex-col overflow-hidden
```

Source: `apps/web/src/components/workspace/workspace-panel.tsx`

### Stat mini-card (customer panel)

```text
rounded-xl border border-neutral-200 bg-white px-3 py-2.5 shadow-sm
Label: text-[10px] font-medium text-neutral-400
Value: text-sm font-semibold tabular-nums
```

Source: `apps/web/src/components/workspace/workspace-customer-panel.tsx`

### Chat bubble — co-worker

| Role | Classes |
|------|---------|
| User | `bg-white text-neutral-900 shadow-md rounded-2xl rounded-tr-sm` |
| Co-worker | `bg-neutral-50 text-neutral-800 shadow-md rounded-2xl rounded-tl-sm` |

Source: `apps/web/src/components/assistant/copilot-message-list.tsx`

### Chat bubble — workspace conversation

| Role | Treatment |
|------|-----------|
| Agent | `border-neutral-200 bg-neutral-50/50` |
| Customer | `border-neutral-200 bg-white` |

Source: `apps/web/src/components/workspace/workspace-conversation-views.tsx`

### Composer (chat input)

```text
rounded-2xl border border-neutral-200 bg-neutral-50/80 p-1.5
focus-within:border-neutral-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-neutral-200/70
```

Icon-only send button (no separate “AI Assist” row).

### Primary button

```text
h-10 rounded-xl bg-black text-white hover:bg-neutral-800
```

### Status toggle

- On: `bg-black`
- Off: `bg-neutral-300`

---

## Spacing

| Pattern | Value |
|---------|--------|
| App viewport | `h-svh` full height |
| Main content padding | `px-4 py-8 sm:px-8 lg:px-8` |
| Panel gap (workspace) | `gap-4` between three columns |
| Copilot split gap | `gap-5` between co-worker and preview columns |
| Card internal padding | `px-4 py-3` – `p-5` depending on density |

---

## Icons

- Library: **lucide-react**
- Default: `size-4` (16px)
- Channel icons: per-channel mapping in `workspace-channel-icon.tsx` and `guided-queue-preview.tsx`

---

## Ant Design + Tailwind

| Ant Design | Tailwind |
|------------|----------|
| Table, Form, Select, Switch, Tooltip | Sidebar, workspace grid, chat bubbles, custom panels |
| `ConfigProvider` via `worktualTheme` | Layout shell, spacing, responsive grids |

Do **not** mix Ant default 6px radius with `rounded-2xl` cards without syncing tokens.

---

## Code reference

| Token / pattern | File |
|-----------------|------|
| Ant Design theme | `apps/web/src/app/theme.ts` |
| Global styles | `apps/web/src/index.css` |
| App shell | `apps/web/src/layouts/AppLayout.tsx` |
| Page title context | `apps/web/src/features/layout/page-title-context.tsx` |
