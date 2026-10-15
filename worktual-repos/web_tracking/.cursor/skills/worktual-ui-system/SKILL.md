---
name: worktual-ui-system
description: >-
  Worktual enterprise visual language for Contact Center and other spokes:
  Inter, #111111 sidebar, #f3f4f6 canvas, #bfbfbf 0.6px hairlines, 38px
  controls, 18px icons, KPI/chart/chat recipes, channel brand icons. Use when
  building, restyling, or reviewing any Worktual web UI, apps/web, dashboards,
  reports, analytics, workspace, contacts, monitoring, or when matching
  Worktual look, colors, type, icon size, charts, or hierarchy.
---

# Worktual UI System

Enterprise design system for Worktual product chrome. Reproduce the **live Contact Center UI** in `apps/web`. Do not invent a palette, radius, control height, or chart look.

**A pointed-at instance is a type change.** Restyling one bar chart, KPI, table, or bubble means changing the shared component so Reports, Analytics, copilot, and performance all match. Ask first only when the change would look wrong on another surface.

| Read next | When |
|---|---|
| [tokens.md](tokens.md) | Exact hex, type, radius, shadow, spacing |
| [icons.md](icons.md) | Icon families, sizes, stroke, file catalog |
| [reference.md](reference.md) | Screen recipes and CSS gotchas |
| [references/](references/) | Current UI screenshots + icon SVGs |
| [web-tracking-map.md](web-tracking-map.md) | Path mapping for **this** web-tracking repo (`web/`) |

Refresh screenshots (Vite must be running):

```bash
npm run capture:ui-references -w web
```

Defaults: `cc-admin@worktual.local` / `Worktual@123` at `http://localhost:5173`. Override with `BASE_URL`, `SCREENSHOT_EMAIL`, `SCREENSHOT_PASSWORD`.

Refresh icon copies from the product:

```bash
npm run sync:ui-icons -w web
```

## Spoke adoption

This skill is the **Worktual CCaaS visual source of truth**. Other spokes (workforce, billing, CRM, portals) follow these tokens even when they cannot import `apps/web` React files.

1. Copy **tokens**, not vibes. Same Inter, same `#111111` / `#f3f4f6` / `#bfbfbf`, same 38px controls and 18px glyphs.
2. Reuse the **channel SVGs** in [references/icons/channels/](references/icons/channels/). Do not draw a Lucide phone as WhatsApp.
3. Reuse the **chart series and axis spec**. Do not invent a second chart card.
4. Login/marketing lavender (`#7423d7`, `#c18fff`) stays on **login and marketing only**. In-app chrome is graphite + white.
5. If the spoke *can* share this monorepo, import the components in **Reuse first**. Do not fork a second `Button`.

## Source of truth

Live code wins over this markdown if they ever drift. Pixel proof is the PNGs in `references/`.

| Layer | File |
|---|---|
| Font / body / canvas | `apps/web/src/index.css` |
| Buttons | `apps/web/src/components/ui/button.tsx` |
| Segments | `apps/web/src/components/ui/segment-tabs.tsx` |
| Selects | `apps/web/src/components/ui/menu-select.tsx` |
| Reports KPI + charts | `apps/web/src/components/dashboard/dashboard-charts.tsx` |
| List KPI tiles | `apps/web/src/components/ui/kpi-card.tsx` |
| Bubbles | `apps/web/src/components/ui/message-bubble-styles.ts` |
| Shell | `apps/web/src/layouts/AppLayout.tsx` |
| Channel glyphs | `apps/web/src/components/workspace/workspace-channel-icon.tsx` |

**Do not copy** `dashboard-card-theme.ts` for charts or KPI tiles. It still holds old teal/pink series, 13px titles, and 32px icon tiles. Live Reports use `dashboard-charts.tsx`.

## Non-negotiables

1. Font is **Inter Variable** (`--font-sans`). Body `#171717`. Canvas `#f3f4f6`.
2. Sidebar is **`#111111`**. Active nav: white text, `rgba(255,255,255,0.1)` fill, **3px × 60%** left white bar. Inactive `text-white/70` (`rgba(255,255,255,0.7)`).
3. Card/panel/control hairlines are **`0.6px solid #bfbfbf`**. List row dividers may use `#e5e5e5`. Do not use 1px `#e5e5e5` as card chrome.
4. Interactive controls are **38px tall**. Glyphs inside those controls are **18px**. Lucide stroke **2.25** on dashboard/chrome icons. Login form is the exception: **44px** (`h-11`) fields and Sign in, `rounded-xl`.
5. Reports KPI icon tiles are **38×38**, `rounded-xl`, glyph **18px**.
6. Panels `rounded-2xl`; chart cards `rounded-xl`. White fill. KPI/chart cards **`shadow-none`**. Close/icon buttons have **no shadow** (composer send is the exception).
7. Reports content order is always **KPIs → two line charts → donuts → bar charts**.
8. Outgoing bubbles **`#111111` + white**. Incoming `neutral-100` + `neutral-800`.
9. Tooltips are **12px** on `#171717`. Mix-chart hover shows **percentage**, not hours.
10. After any UI change, verify in the browser the way a user would.

## Shell

| Surface | Spec |
|---|---|
| App canvas | `#f3f4f6` |
| Sidebar | `#111111`, expanded **260px**, collapsed **72px** |
| Brand mark | expanded logo `h-8`; collapsed icon `size-8 rounded-md` |
| Portal label | `12px` uppercase, tracking `0.14em`, `text-white/45` |
| Nav section | `10px` uppercase, tracking `0.14em`, `text-white/40` |
| Nav item | `14px`, `rounded-xl`, `px-3 py-2.5`, gap `12px`; icon `text-base` (~16px) |
| Sidebar collapse | `size-6` (24px) white circle, hairline `#bfbfbf`, chevron `14px` (`size-3.5`) |
| Header | canvas fill, `border-b 0.6px #bfbfbf/80`, `px-2 py-3` (`sm:px-3 lg:px-4`) |
| Header title | `text-xl sm:text-2xl font-semibold tracking-tight text-neutral-900` |
| Account avatar | `size-9` (36px) `#111111`, `text-sm font-semibold` white, `ring-2 ring-white` |
| Main inset | `px-2 py-5 pt-3 sm:px-5` |
| Content panel | `rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white` (`ShadowPanel` may add `shadow-xl/50` on the outer wrap only) |
| Panel header | `px-4 py-3` + hairline bottom |
| Panel title | `18px` semibold `neutral-900` |
| Panel subtitle | `14px` `neutral-500` |

Primary actions are **black** (`#000` / `bg-black`), hover `#262626` (`neutral-800`). Ant `ant-btn-primary` matches this.

## Type scale

Do not drift to 13/15/16px unless the existing component already does.

| Role | Size | Weight | Color |
|---|---|---|---|
| Marketing login H1 | 36–41.6px | semibold | white / `#c18fff` accent |
| App header title | 20px / 24px `sm` | semibold | `#171717` |
| Panel title | 18px | semibold | `#171717` |
| Section description | 14px | regular | `#171717` on Reports; `#737373` on Analytics layer copy |
| Body / input / bubble | 14px | regular | `#171717` |
| KPI label (Reports) | 14px | semibold | `#262626` (`neutral-800`) |
| KPI value (Reports) | **22px** | bold, tabular | `#171717` |
| KPI caption (Reports) | 14px | regular | `#737373` |
| Compact list KPI label | 14px bold tracking `0.08em` (sm: 11px) | — | `#171717` |
| Compact list KPI value | **20px** (sm: 14px) | bold, tabular | `#171717` |
| Compact KPI caption | 11px | regular | `#a3a3a3` |
| Chart title | 14px | **bold**, capitalize | `#171717` |
| Chart subtitle | 14px | regular | `#737373` |
| Chart axis / tooltip | 12px | regular / 600 titles | axis `#212121` |
| Meta / timestamps | 11px | regular | `#a3a3a3` or `white/70` |
| Table header | 11px | medium, uppercase, tracking `0.12em` | `#a3a3a3` on `#fafafa` |
| Chip / secondary button | 11px / 12px | medium | `#404040` |
| Placeholder | 14px | regular | `#a3a3a3` |

## Color (chrome)

Full hex tables: [tokens.md](tokens.md).

| Token | Hex | Tailwind |
|---|---|---|
| Ink / body | `#171717` | `neutral-900` |
| Sidebar / bubble / avatar | `#111111` | — |
| Canvas | `#f3f4f6` | gray-100-ish; **not** `neutral-100` |
| Card | `#ffffff` | `white` |
| Hairline | `#bfbfbf` | — |
| List divider | `#e5e5e5` | `neutral-200` |
| Muted text | `#737373` | `neutral-500` |
| Faint text | `#a3a3a3` | `neutral-400` |
| Primary button | `#000000` → hover `#262626` | `black` / `neutral-800` |
| Search fill | `#fafafa` | `neutral-50` |
| Incoming bubble | `#f5f5f5` | `neutral-100` |
| Tooltip | `#171717` | — |
| Focus ring | `#e5e5e5` | `ring-neutral-200` |

**KPI icon tints** (tile only — never as card chrome):

| Family | Tile |
|---|---|
| Volume / chat | `bg-blue-100 text-blue-600` (`#dbeafe` / `#2563eb`) |
| Success / resolved | `bg-emerald-100 text-emerald-600` or teal `bg-teal-100 text-teal-600` |
| Time | `bg-cyan-100 text-cyan-600` |
| Handle / gauge | `bg-violet-100 text-violet-600` |
| SLA / target | `bg-amber-100 text-amber-600` |
| Hand-off | `bg-rose-100 text-rose-600` |
| Trend | `bg-indigo-100 text-indigo-600` |

**Charts only** (`CHART_PIE_SERIES` — do not recolor KPI tiles with these):

1. `#3b82f6` Webchat / voice / first series  
2. `#f59e0b` Email  
3. `#8b5cf6` WhatsApp  
4. `#ec4899` Instagram  
5. `#1877f2` Facebook  

Line: handled `#3b82f6`, handle-time/forecast `#fdba74`, area fill `#bfdbfe`.  
Grid dashed `#858f96`, baseline `#909090` `0.6px`, labels `#212121` `12px`. Hover dims other bars to **0.28**.

## Control and icon sizes

| Control | Box | Glyph |
|---|---|---|
| Primary / outline / toolbar / chip | `h-[38px]`, `rounded-lg` | 18px |
| `panelIcon` / `ghostIcon` / send | `size-[38px]` | 18px (`[&_svg]:size-[18px]`) |
| Segment slider | **always** `h-[38px]`, `p-0.5`, hairline, `bg-neutral-50/90`; thumb `#171717` | 14px when icon-only (`size-3.5`) |
| Search + `MenuSelect` | `h-[38px]`, hairline, `bg-neutral-50` | chevron 18px |
| KPI / layer icon tile | `size-[38px] rounded-xl` | 18px, stroke 2.25 |
| Info | hit `16px`, glyph `14px` (`size-3.5`) | stroke 2.25, `#a3a3a3` |
| Expand chart | hit `28px` (`size-7`), glyph `14px` | no shadow |
| Sidebar collapse | `24px` | 14px |
| Channel glyph (lists) | **16px** (`size-4`), `rounded-[4px]` | brand SVG |
| Channel (headers / offers) | 24–28px | brand SVG |
| Trend chip | 11px semibold | arrow `10px` in `16px` circle |
| Login fields / Sign in | **44px** (`h-11`), `rounded-xl` | Ant leading icon; login only |

Icon families, stroke, and files: [icons.md](icons.md).

## Hierarchy (Reports / Analytics)

Rhythm: page `space-y-6`, section `space-y-3` or `space-y-4`.

**Reports**

1. Snapshot KPIs — 3-col (`@[42rem]/kpis:grid-cols-3`) on screen; export uses **4×2**. Card `min-h-[136px]`, `px-4 py-4`, `shadow-none`.
2. Daily trends — **two line charts** side by side.
3. Channel mix — **two donuts** (AI + Support Agent). Diameter **156px** (256 expanded), ring **22px** (28 expanded). Card min width **347px**.
4. Presence + disposition — **two vertical bar charts**. Bar ~22px (28 expanded).

Section copy: `DashboardSectionHeader` at `text-sm`. Analytics layer descriptions stay `text-neutral-500`.

**Do not** put pies beside line charts. **Do not** squeeze six KPIs into one export row.

## Charts

One chart system. Reports, Analytics, and copilot plots reuse Reports components. Copilot `PlotChartCard` is only a mapper.

Reuse `ExpandableChartCard`, `DashboardSparklineChart`, `DashboardChannelChart`, `DashboardBarChart`, `DashboardPresenceMixChart`, `TrendLineChart`, `InteractiveDonutChart`.

- Header: title `text-sm font-bold capitalize`, subtitle `mt-0.5 text-sm text-neutral-500` under the title, info + expand on the right.
- Card: `rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4`.
- Line: smooth Catmull-Rom. Axis titles required. Duration ticks are **hours only** (`22h`); full duration stays in tooltips.
- Donut: 156 / 256. Legend label `text-neutral-900`, value `font-semibold` + `n (p%)`. Never 96px chat-only donuts.
- Bar: vertical bars via `useChartPlotSize` (height 200/360). Never a fixed viewBox + `aspectRatio` (that scales 12px text). Crowded X labels ellipsis; stagger when slot `< 64px`. Values include units (`100%`, not `100`).
- Export PNG hides info + expand (`data-export-ignore="true"`).

## Chat / copilot

- Shell: `rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed`.
- Outgoing: `rounded-tr-sm bg-[#111111] text-white`. Strip inline HTML colors when inverted. Meta `text-white/70`.
- Incoming: `rounded-tl-none bg-neutral-100 text-neutral-800`.
- Width: `max-w-[90%]` (expanded copilot user bubble `max-w-[70%]`).
- Composer send: `size-[38px]`, `#171717`, shadow `0 2px 8px rgba(0,0,0,0.18)` — **only** this control uses that shadow.
- Chat KPI/plot cards go through `PlotChartCard` → Reports charts. Durations `45s` / `12m` / `1h 57m`; rates include `%`.

## Login (marketing chrome)

Do not copy this into the signed-in app.

| Token | Spec |
|---|---|
| Page | `#eceef2`; top bar `#000`; hero pane `#0b0618` |
| Accent | Contact Us `#7423d7`; “AI-Powered” `#c18fff`; forgot-password `#2563eb` |
| Card | `rounded-2xl`, shadow `0 20px 60px rgba(15,23,42,0.12)` |
| Fields / Sign in | **44px** (`h-11`), `rounded-xl`, hairline `#bfbfbf` |
| Helper copy | `#5e5e69` |
| Footer | `12px` `#737373` |

## Reuse first

| Need | File |
|---|---|
| Buttons / 38px icons | `apps/web/src/components/ui/button.tsx` |
| Segment slider | `apps/web/src/components/ui/segment-tabs.tsx` |
| Menu select | `apps/web/src/components/ui/menu-select.tsx` |
| List KPI | `apps/web/src/components/ui/kpi-card.tsx` |
| Reports KPI / charts | `apps/web/src/components/dashboard/dashboard-charts.tsx` |
| Section header | `apps/web/src/components/dashboard/dashboard-section-header.tsx` |
| Status banner | `apps/web/src/components/ui/status-banner.tsx` |
| Bubbles | `apps/web/src/components/ui/message-bubble-styles.ts` |
| Panel chrome | `apps/web/src/components/ui/shadow-panel.tsx` |
| List row divider | `apps/web/src/components/ui/list-row.ts` |
| Channel icon | `apps/web/src/components/workspace/workspace-channel-icon.tsx` |
| Page header (rare) | `apps/web/src/components/layout/PageShell.tsx` |
| Global CSS | `apps/web/src/index.css` |

## Forbidden

- New primary colors, 1px card borders, `shadow-2xs`, heavy KPI drop shadows
- Control heights other than 38px (except info 16, expand 28, collapse 24)
- Control glyphs other than 18px (except the small cases in the size table)
- Horizontal progress-bar “charts”, 96px donuts, 11px chart subtitles
- Lucide/Ant stand-ins for WhatsApp, Facebook, Instagram, SMS, web chat
- Copying `dashboard-card-theme.ts` series (`#11878a`, `#db2777`, 13px titles, `size-8` tiles)

## Done check

- [ ] 38px controls, 18px control icons, 38×38 Reports KPI tiles
- [ ] `#bfbfbf` 0.6px card/panel borders, `#111111` sidebar + outgoing bubbles
- [ ] Type matches the scale above
- [ ] Reports order: KPIs → lines → pies → bars
- [ ] Channel glyphs are brand SVGs at the sizes in [icons.md](icons.md)
- [ ] No new colors, radii, or shadows
- [ ] Browser-verified, including empty/error states
