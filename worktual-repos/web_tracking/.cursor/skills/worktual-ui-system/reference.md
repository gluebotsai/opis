# Worktual UI recipes

Read this when implementing a screen or matching a screenshot. Prefer existing `apps/web` components over new markup. Tokens: [tokens.md](tokens.md). Icons: [icons.md](icons.md).

## Current UI (pixel proof)

1440×900 @2x captures. Refresh with `npm run capture:ui-references -w web`.

| Screen | File |
|---|---|
| Login (marketing chrome — do not copy into app) | [references/login.png](references/login.png) |
| Reports | [references/dashboard-reports.png](references/dashboard-reports.png) |
| Analytics | [references/dashboard-analytics.png](references/dashboard-analytics.png) |
| Contacts | [references/contacts.png](references/contacts.png) |
| Queues | [references/queues.png](references/queues.png) |
| Agents | [references/agents.png](references/agents.png) |
| Presence | [references/presence.png](references/presence.png) |
| Shifts | [references/shifts.png](references/shifts.png) |
| Workspace | [references/workspace.png](references/workspace.png) |
| Live monitoring | [references/monitoring.png](references/monitoring.png) |
| Internal chat | [references/team-chat.png](references/team-chat.png) |
| Reports KPI + lines close-up | [references/reports-kpis-lines.png](references/reports-kpis-lines.png) |
| Reports pies + bars close-up | [references/reports-pies-bars.png](references/reports-pies-bars.png) |

Icons: [references/icons/channels/](references/icons/channels/), [references/icons/lucide/](references/icons/lucide/), [references/icons/brand/](references/icons/brand/).

If capture stops on login, set `SCREENSHOT_EMAIL` / `SCREENSHOT_PASSWORD` to an admin that exists in the running cc-core, then re-run. `login.png` is always capturable without a session.

## Layout recipe

```
#f3f4f6 canvas
├── sidebar #111111 (260 / 72)
└── main
    ├── header (canvas, 0.6px #bfbfbf/80)
    │   ├── h1 20/24px semibold
    │   └── actions: presence 38px · bells 38px · avatar 36px
    └── inset px-5 pt-3 pb-5
        └── CopilotWorkspace (optional left chat + right content)
            └── panel: rounded-2xl border 0.6px #bfbfbf bg-white
                ├── header px-4 py-3 + hairline
                └── PanelScrollArea px-4 py-4
```

Copilot / content split: `lg:grid-cols-[minmax(0,60fr)_minmax(0,40fr)]` or the workspace 3-column inbox grid. Never add a second page title above a panel that already has `text-[18px] font-semibold`. App header already owns the page name.

## Button variants (already 38px)

`Button` / `IconButton` from `button.tsx`.

| Variant | Fill | Text | Notes |
|---|---|---|---|
| `primary` | `#000` | white 14px | hover `#262626` |
| `primaryIcon` | `#000` | white | 38×38 |
| `secondary` | ghost | 12px `#737373` | hover `neutral-100` |
| `outline` / `toolbar` | white + hairline | 14px `#404040` | |
| `destructive` | white + `red-200` | 12px `red-600` | |
| `panelIcon` | white + hairline | `#171717` 18px SVG | **no shadow** |
| `ghostIcon` / `ghostIconSm` | ghost | `#171717` | 38×38 |
| `ghostIconDanger` | hairline | hover red | |
| `chip` | white + hairline | 11px | |
| `send` | `#171717` | white | **only** control with `0 2px 8px rgba(0,0,0,0.18)` |
| `sendDisabled` | `neutral-200/90` | `neutral-400` | |
| `link` | none | `#737373` | |

## Search + filter row

Match Contacts / Tasks / Monitoring / Inbox:

```
h-[38px] rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50
pr-3 pl-9 text-sm text-neutral-900 placeholder:text-neutral-400
focus:border-neutral-400 focus:bg-white focus:ring-2 focus:ring-neutral-200
```

Filter `MenuSelect`: `h-[38px]`, same hairline + `bg-neutral-50`, chevron 18px. Open menu: `rounded-xl` hairline, `shadow-sm`, selected row `Check` 16px.

## Tabs

**Segment (default)** — Reports/Analytics, filters:

```
h-[38px] rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50/90 p-0.5
thumb: rounded-md border border-neutral-900 bg-neutral-900 shadow-sm
active label: 14px medium white
idle label: 14px medium #737373
```

**Line** — underline tabs: `border-b 0.6px #bfbfbf`; active `border-b-2 #171717` + 12px medium ink; idle `#737373`.

## KPI cards

### Reports — `DashboardKpiCard`

```
min-h-[136px] rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white px-4 py-4 shadow-none
row: label 14px semibold #262626 + info 14px glyph · 38×38 tinted icon
center: value 22px bold tabular #171717
foot: caption 14px #737373 · optional 11px trend chip
```

On-screen: `grid-cols-2 @[42rem]/kpis:grid-cols-3` then a second `grid-cols-2` for Resolved / Daily Avg.

Export (`.performance-export-capture`): **4 equal columns**, all eight cards 136px. Hide `[data-export-ignore]` and `[data-html2canvas-ignore]`.

### List rails — `KpiCard`

Compact summary tiles (contacts/tasks rails). Not the Reports tile.

```
md: min-h-[136px] px-3.5 py-4; label 14px bold tracking 0.08em; value 20px
sm: rounded-xl px-2.5 py-1.5; label 11px; value 14px
caption 11px #a3a3a3
```

## Chart card

`ExpandableChartCard` — also used by copilot `PlotChartCard`.

```
rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4
title 14px bold capitalize + info
subtitle mt-0.5 14px #737373 (under title, not under the metric)
metric + expand (28px hit, 14px glyph) on the right
```

### Line

- `TrendLineChart` / `DashboardSparklineChart` smooth curve
- Handled `#3b82f6`, handle-time `#fdba74`
- Axis titles required on Reports: Date / Handled conversations / Average handle time
- Axis duration = hours (`22h`); tooltip keeps `1h 57m`
- Grid `#858f96` dashed, baseline `#909090` 0.6px, labels 12px `#212121`

### Donut

- Size 156 / 256, ring 22 / 28
- Series: `#3b82f6 #f59e0b #8b5cf6 #ec4899 #1877f2`
- Legend: 8px swatch, label `#171717`, value `font-semibold` + `n (p%)`
- Parent grid: `minmax(min(100%,347px),1fr)`

### Bar (`DashboardBarChart` + `DashboardPresenceMixChart`)

- Size like line charts: `useChartPlotSize`, height 200 / 360, real container width
- Never fixed viewBox + `aspectRatio` (that shrinks 12px text)
- Bar ~22–28px, series from `CHART_PIE_SERIES` (first `#3b82f6`)
- Hover: other bars opacity 0.28
- X labels: single line + ellipsis; stagger when slot `< 64px`
- Axis titles are props. Reports: `Disposition` / `Conversations`. Presence: `Presence state` / `Time share (%)`. Analytics factors: `Factor` / `Share` with `%`

## Analytics

- Page `space-y-6`, sections `space-y-3`
- Layer header: 38×38 `rounded-xl` icon + `14px` semibold title + `14px` `#737373` description
- Predictive tiles follow Reports KPI chrome
- Diagnostic prose `14px`
- Contributing factors: `DashboardBarChart` inside `ExpandableChartCard`

## Chat bubbles

`messageBubbleClassName({ outgoing })`

- Shell `14px` `px-3.5 py-2.5` `rounded-2xl`
- Outgoing `#111111` + white; delivery meta `white/70`; `rounded-tr-sm`
- `AssistantMessageContent` inverted path must `stripColors` and `!text-white`
- Incoming `bg-neutral-100` `#f5f5f5`, `rounded-tl-none`

## Lists and tables

- Stacked rows: `listRowDividerClassName` — inset `0.6px #e5e5e5`
- Ant table header: 11px medium uppercase tracking `0.12em` `#a3a3a3` on `#fafafa`
- Main content links inherit ink (`#171717`), not blue
- Assistant markdown tables: wrap hairline `#bfbfbf` radius 12px; cells `10px 12px`, nowrap, min 256px

## Export preview dialog

- PNG ready: **no** second “Report preview” title bar. Image header is the only title. Filename in footer. Close control has **no shadow**.
- CSV/PDF: one dialog header (title + filename).
- Capture order matches Reports: lines, then pies, then bars.

## Custom CSS the agent must not fight

`apps/web/src/index.css`

- Ant primary = black / hover `#262626`
- Ant inputs/buttons radius 12px
- Tooltip inner 12px / line-height 1.4
- `.nav-item-active::before` 3×60% white bar
- `.panel-scroll-native` hides native scrollbar
- `.performance-export-capture` expands overflow and restacks export grids
- Assistant inverted bubbles stay white

## Stale tokens

`dashboard-card-theme.ts` still exports teal/pink series, 13px chart titles, `size-8` KPI tiles, and a slate drop shadow. **Ignore it** when matching the live UI. Use `dashboard-charts.tsx` (`CHART_PIE_SERIES`, `DashboardKpiCard`, `ExpandableChartCard`).
