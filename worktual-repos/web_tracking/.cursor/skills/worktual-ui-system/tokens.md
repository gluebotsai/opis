# Worktual UI tokens

Exact values from the live Contact Center UI (`apps/web`, September 2026). Spokes copy these hex values. Do not approximate.

## Font

| Token | Value |
|---|---|
| Family | `"Inter Variable", ui-sans-serif, system-ui, sans-serif` |
| CSS | `--font-sans` in `apps/web/src/index.css` |
| Smoothing | `-webkit-font-smoothing: antialiased` |
| Body | 16px root (browser), color `#171717`, background `#f3f4f6` |
| Tabular numbers | `tabular-nums` on KPI values and chart counts |

Load Inter as a variable font. Do not substitute Roboto, Geist, or system UI for product chrome.

## Core palette

| Role | Hex | Notes |
|---|---|---|
| Ink | `#171717` | Body, titles, tooltip fill, segment thumb (`neutral-900`) |
| Sidebar / outgoing bubble / avatar | `#111111` | Not quite black; do not use `#000` here |
| Primary button | `#000000` | Hover `#262626` (`neutral-800`); Ant primary matches |
| Send button | `#171717` (`neutral-900`) | Hover `#262626` |
| Canvas | `#f3f4f6` | App shell + header |
| Login page canvas | `#eceef2` | Login only |
| Login left pane | `#0b0618` | Login only |
| Card / panel | `#ffffff` | |
| Search / segment track / compact fill | `#fafafa` (`neutral-50`) | Segment uses `bg-neutral-50/90` |
| Incoming bubble / hover rows | `#f5f5f5` (`neutral-100`) | |
| Hairline | `#bfbfbf` | **0.6px** on cards, panels, inputs, menus |
| Header hairline | `#bfbfbf` at 80% | `border-[#bfbfbf]/80` |
| List / table cell divider | `#e5e5e5` (`neutral-200`) | Inset under stacked rows |
| Muted | `#737373` (`neutral-500`) | Captions, inactive tabs, chevrons |
| Faint | `#a3a3a3` (`neutral-400`) | Placeholders, table headers, timestamps |
| Secondary text on dark | `rgba(255,255,255,0.70)` | Sidebar idle nav |
| Portal label | `rgba(255,255,255,0.45)` | |
| Nav section label | `rgba(255,255,255,0.40)` | |
| Sidebar hover | `rgba(255,255,255,0.05)` | |
| Sidebar active fill | `rgba(255,255,255,0.10)` | Plus 3px white bar |
| Sidebar footer rule | `rgba(255,255,255,0.10)` | |
| Destructive text | `#dc2626` (`red-600`) | |
| Destructive hover fill | `#fef2f2` (`red-50`) | |
| Destructive outline | `#fecaca` (`red-200`) | |

## Tailwind neutrals used in-app

| Class | Hex |
|---|---|
| `neutral-50` | `#fafafa` |
| `neutral-100` | `#f5f5f5` |
| `neutral-200` | `#e5e5e5` |
| `neutral-300` | `#d4d4d4` (focus-visible rings on info) |
| `neutral-400` | `#a3a3a3` |
| `neutral-500` | `#737373` |
| `neutral-600` | `#525252` |
| `neutral-700` | `#404040` |
| `neutral-800` | `#262626` |
| `neutral-900` | `#171717` |
| `black` | `#000000` |
| `white` | `#ffffff` |

Canvas `#f3f4f6` is **not** a Tailwind neutral step. Use the hex.

## KPI icon tiles

Background 100 + glyph 600. Tile `38×38`, `rounded-xl`.

| Family | Background | Glyph |
|---|---|---|
| Volume / chat | `#dbeafe` `blue-100` | `#2563eb` `blue-600` |
| Success | `#d1fae5` `emerald-100` | `#059669` `emerald-600` |
| Resolved (teal) | `#ccfbf1` `teal-100` | `#0d9488` `teal-600` |
| Time | `#cffafe` `cyan-100` | `#0891b2` `cyan-600` |
| Handle / gauge | `#ede9fe` `violet-100` | `#7c3aed` `violet-600` |
| SLA / target | `#fef3c7` `amber-100` | `#d97706` `amber-600` |
| Hand-off | `#ffe4e6` `rose-100` | `#e11d48` `rose-600` |
| Trend | `#e0e7ff` `indigo-100` | `#4f46e5` `indigo-600` |
| Default | `#f5f5f5` `neutral-100` | `#525252` `neutral-600` |
| Trend up chip | `#ecfdf5` `emerald-50` + `#059669` | |
| Trend down chip | `#fff1f2` `rose-50` + `#f43f5e` `rose-500` | |

## Charts

| Token | Hex | Use |
|---|---|---|
| Series 1 / webchat / voice / handled line | `#3b82f6` | |
| Series 2 / email | `#f59e0b` | |
| Series 3 / WhatsApp | `#8b5cf6` | |
| Series 4 / Instagram | `#ec4899` | |
| Series 5 / Facebook | `#1877f2` | |
| Handle-time / forecast line | `#fdba74` | |
| Line area fill | `#bfdbfe` | |
| Axis labels | `#212121` | 12px |
| Grid | `#858f96` | dashed |
| Baseline | `#909090` | 0.6px solid |
| Hover dim | opacity `0.28` | other bars/slices |
| Fallback bar (legacy helper) | `#2563eb` `#0d9488` `#4f46e5` `#7c3aed` `#0284c7` | `CHART_BAR_COLORS` — prefer `CHART_PIE_SERIES` |

Donut: compact **156px** diameter, ring **22px**; expanded **256px**, ring **28px**. Legend swatch `8px` circle.

Bar: compact width ~**22px**, expanded ~**28px**, cap `slotWidth * 0.28`. Plot height 200 / 360 via `useChartPlotSize`. Stagger X labels when slot `< 64px`.

## Channel brand tiles (SVG fills)

16×16 rounded-rect icons. Files in [references/icons/channels/](references/icons/channels/).

| Channel | Tile fill | File |
|---|---|---|
| Web chat | `#3A3FE0` | `web-chat.svg` |
| Email | `#E06E3A` | `email.svg` |
| WhatsApp | `#25D366` | `whatsapp.svg` |
| Voice / call | `#00B885` | `call.svg` |
| Facebook | `#1877F2` | `facebook.svg` |
| Instagram | gradient `#F58529` → `#DD2A7B` → `#8134AF` | `instagram.svg` |
| SMS | `#3A9EE0` | `sms.svg` |
| Video | `#E2A400` | `video.svg` |
| Voicemail | `#653AE0` | `voicemail.svg` |

Chart slice colors for the same channels are the `CHART_PIE_SERIES` hexes above, **not** these tile fills (web chat chart slice is `#3b82f6`, tile is `#3A3FE0`).

## Presence

8px (`size-2`) dots on the 38px toolbar chip.

| State | Dot |
|---|---|
| Ready | `#10b981` `emerald-500` |
| Away | `#f59e0b` `amber-500` |
| Not ready | `#a3a3a3` `neutral-400` |
| Break | `#8b5cf6` `violet-500` |
| After contact work (toolbar) | `#8b5cf6` `violet-500` |
| Busy | `#ef4444` `red-500` |

## Status banners

`rounded-xl`, `0.6px` border, `px-3.5 py-3`, `14px` text, icon 18px.

| Tone | Border | Fill | Title | Body | Icon |
|---|---|---|---|---|---|
| Success | `emerald-200` `#a7f3d0` | `emerald-50` `#ecfdf5` | `emerald-900` | `emerald-800` | `CheckCircle2` |
| Warning | `amber-200` `#fde68a` | `amber-50` `#fffbeb` | `amber-950` | `amber-900` | `AlertTriangle` |
| Error | `red-200` `#fecaca` | `red-50` `#fef2f2` | `red-900` | `red-700` | `CircleAlert` |
| Info | `#bfbfbf` | `neutral-50` `#fafafa` | `neutral-900` | `neutral-700` | `Info` |

## Login / marketing (do not use in-app)

| Token | Spec |
|---|---|
| Page canvas | `#eceef2` |
| Top bar | `#000000`, height 56px (`h-14`) |
| Contact Us | `#7423d7`, `14px`, `rounded-lg`, `px-3.5 py-1.5` |
| Hero pane | `#0b0618` |
| AI-Powered | `#c18fff` |
| Feature body | `rgba(255,255,255,0.55)` |
| Feature icon tile | 36px, `rounded-lg`, fill `rgba(255,255,255,0.05)`, border `rgba(255,255,255,0.15)`, glyph `#c18fff` |
| Card | `rounded-2xl`, shadow `0 20px 60px rgba(15,23,42,0.12)` |
| Welcome | 24px / 28px semibold |
| Helper | `#5e5e69` 14px |
| Fields | **44px** (`h-11`), `rounded-xl`, hairline `#bfbfbf`, leading Ant icon 12px inset |
| Show/Hide | 12px `#262626` |
| Forgot password | `#2563eb` underline (hover `#1e40af`) — login only |
| Sign in | 44px, `rounded-xl`, `#000` |
| Footer | 12px `#737373` |

## Radius

| Token | Value | Where |
|---|---|---|
| `rounded-md` | 6px | Segment thumb, menu rows |
| `rounded-lg` | 8px | Buttons, inputs, selects, chips, menus |
| `rounded-xl` | 12px | Chart cards, banners, KPI tiles, nav items, Ant controls |
| `rounded-2xl` | 16px | Panels, Reports KPI cards, bubbles, login card |
| `rounded-[4px]` | 4px | Channel glyphs in lists |
| `rounded-full` | pill | Avatars, presence dots, sidebar collapse |
| Instagram tile | `rx=3` | Slightly rounder than other channel tiles (`rx=2`) |

Ant Design override: `.ant-btn`, `.ant-input`, `.ant-select-selector`, `.ant-picker` → **12px**. `.ant-card` → **16px**.

## Borders

| Token | Spec |
|---|---|
| Hairline | `0.6px solid #bfbfbf` |
| List row | `0.6px solid #e5e5e5`, inset `12px` or `16px` |
| Table header/cell | `0.6px solid #e5e5e5` |
| Assistant table wrap | `0.6px solid #bfbfbf`, radius 12px |
| Line tabs | container `0.6px #bfbfbf`; active `2px #171717` |
| Sidebar active bar | `3px × 60%` height, white, `border-radius: 0 2px 2px 0` |
| Destructive button | `1px solid #fecaca` (the one 1px exception) |

## Shadows

| Token | Spec | Where |
|---|---|---|
| None | `shadow-none` | Reports KPI + chart cards |
| Tight | `shadow-sm` | Menus, collapse knob, account avatar, segment thumb |
| Send | `0 2px 8px rgba(0,0,0,0.18)` | Composer send **only** |
| Presence menu | `shadow-lg` | Presence dropdown |
| Panel wrap | `shadow-xl/50` | `ShadowPanel` outer; inner card is hairline only |
| Login card | `0 20px 60px rgba(15,23,42,0.12)` | Login only |
| Date popover | `0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.08)` | Performance range |
| Close / panelIcon | **no shadow** | |

## Focus

| Token | Spec |
|---|---|
| Search / select | `focus:border-neutral-400 focus:bg-white focus:ring-2 focus:ring-neutral-200` |
| Info | `focus-visible:ring-2 focus-visible:ring-neutral-300` |
| Open select | same as focus, while menu is open |

## Spacing and layout

| Token | Value |
|---|---|
| Sidebar expanded | 260px |
| Sidebar collapsed | 72px |
| Summary rail | 280px |
| Header account popover | 224px (`w-56`) |
| Page section gap | `24px` (`space-y-6`) |
| Card grid gap | `16px` |
| Panel header | `px-16px py-12px` |
| Panel body | `px-16px py-16px` |
| Reports KPI card | `px-16px py-16px`, min-height 136px |
| Compact list KPI | `px-10px py-6px` |
| Bubble | `px-14px py-10px` (`px-3.5 py-2.5`) |
| Copilot split | `lg:grid-cols-[minmax(0,60fr)_minmax(0,40fr)]` |
| Donut card min | 347px |
| Export KPI grid | 4 equal columns, 8 cards |

## Motion

| Token | Spec |
|---|---|
| Segment thumb | `300ms` `cubic-bezier(0.4, 0, 0.2, 1)` |
| Sidebar width | `200ms` |
| Icon press | `active:scale-95` on panelIcon / send |
| Reduce | `motion-reduce:transition-none` on segments |

## Z-index (practical)

| Surface | Value |
|---|---|
| Sidebar collapse | `z-10` |
| Presence / header menus | `z-20` |
| `MenuSelect` portal | `z-80` |
| Ant modal / popover | Ant defaults |

## Type details

| Role | Size | Line | Weight | Tracking | Color |
|---|---|---|---|---|---|
| App header title | 20px / 24px | tight | 600 | `tracking-tight` | `#171717` |
| Panel title | 18px | — | 600 | — | `#171717` |
| Section description | 14px | snug | 400 | — | `#171717` or `#737373` |
| Body / bubble / input | 14px | relaxed on bubbles (`leading-relaxed`) | 400 | — | `#171717` |
| Assistant HTML | 14px | 1.7 | 400 | — | `#171717` |
| Button primary/outline | 14px (`text-sm`) | — | 500 | — | white / `#404040` |
| Button secondary | 12px (`text-xs`) | — | 500 | — | `#737373` |
| Chip | 11px | — | 400 | — | `#404040` |
| Reports KPI label | 14px | — | 600 | — | `#262626` |
| Reports KPI value | 22px | `leading-none` | 700 | `tracking-tight` | `#171717` |
| Compact KPI label | 14px / 11px | — | 700 / 600 | `0.08em` / wide | `#171717` |
| Compact KPI value | 20px / 14px | `leading-none` | 700 | `tracking-tight` | `#171717` |
| Chart title | 14px | — | 700 | — | `#171717` |
| Chart subtitle | 14px | — | 400 | — | `#737373` |
| Axis | 12px | — | 400 ticks / 600 titles / 500 categories | — | `#212121` |
| Tooltip | 12px | 1.4 | 400 | — | white on `#171717` |
| Table header | 11px | — | 500 | `0.12em` uppercase | `#a3a3a3` |
| Nav | 14px | — | 400 / 500 active | — | white / 70% |
| Portal label | 12px | — | 400 | `0.14em` uppercase | white 45% |

Assistant lists: wrap `14px 16px`, radius 12px, fill `#fafafa`, hairline `#bfbfbf`. Code: fill `#f3f4f6`, radius 12px, `13px`.
