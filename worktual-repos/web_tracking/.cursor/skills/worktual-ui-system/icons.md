# Worktual icons

Three families. Do not mix them for the same job.

| Family | Use | Files |
|---|---|---|
| **Channel brand SVGs** | Every channel glyph in inbox, monitoring, queues, contacts, offers | [references/icons/channels/](references/icons/channels/) |
| **Lucide** | In-app chrome: search, close, KPI, charts, composer | [references/icons/lucide/](references/icons/lucide/) |
| **Ant Design icons** | Sidebar leftovers + login marketing only | Do not add new Ant icons in product chrome |

Custom: workspace headset in [references/icons/custom/workspace-headset.svg](references/icons/custom/workspace-headset.svg).

Brand marks (sidebar / login): [references/icons/brand/](references/icons/brand/).

| File | Use |
|---|---|
| `worktual-logo.png` | Expanded sidebar + login wordmark (`h-8` / `h-7`) |
| `worktual-icon.png` | Collapsed sidebar `size-8 rounded-md` |
| `copilot-logo.png` | Copilot panel mark |
| `workspace-nav-icon.png` | Legacy; live nav uses the headset SVG |

## Size matrix

Stroke for Lucide chrome/KPI icons is **2.25** unless noted. Channel SVGs are filled artwork — do not add a stroke.

| Context | Hit target | Glyph | Stroke | Radius |
|---|---|---|---|---|
| `Button` / `IconButton` `panelIcon` | 38×38 | **18px** | 2.25 | `rounded-lg` |
| Primary / outline / toolbar with icon | 38 tall | **18px** | 2.25 | `rounded-lg` |
| Composer send | 38×38 | 18px (`ArrowUp`) | 2.25 | `rounded-lg` |
| Search field leading icon | 38 tall field | 18px, inset left | 2.25 | — |
| `MenuSelect` chevron | 38 tall field | **18px** `#737373` | 2.25 | — |
| Presence toolbar chevron | 38 tall chip | **16px** (`size-4`) | 2.25 | — |
| Reports KPI tile | **38×38** `rounded-xl` | **18px** | **2.25** | tinted fill |
| Analytics layer header tile | 38×38 `rounded-xl` | 18px (legacy `size-6` only if already in that header) | 2.25 | — |
| Info (KPI / chart) | 16×16 | **14px** (`size-3.5`) `#a3a3a3` | 2.25 | — |
| Chart expand | 28×28 (`size-7`) | **14px** | 2 | `rounded-lg`, no shadow |
| Segment icon-only | 38 tall | **14px** | 2.25 | — |
| Trend chip arrow | 16×16 circle | **10px** (`size-2.5`) | 2.5 | — |
| Status banner | — | **18px** | 2.25 | — |
| Banner dismiss | 38×38 | 18px | 2.25 | — |
| Sidebar nav (Lucide) | row `py-2.5` | `size-[1.2em]` (~16px), stroke **1.75** | 1.75 | — |
| Sidebar headset | row | `size-[1.4em]` (~18px) | custom 1.5–1.7 | — |
| Sidebar Ant icons | row | `text-base` (~16px) | Ant | — |
| Sidebar collapse | 24×24 | **14px** | 2 | hairline circle |
| Header account | 36×36 (`size-9`) | letter, `text-sm` semibold | — | full circle `#111111` |
| Popover account | 40×40 (`size-10`) | letter | — | full circle |
| Channel in lists / table | **16×16** (`size-4`) | brand SVG | — | `rounded-[4px]` |
| Channel in meta row | 16×16 | brand SVG | — | `rounded-[4px]` |
| Channel in queue picker | 24×24 (`size-6`) | brand SVG | — | `rounded-lg` |
| Channel in offer toast | 28×28 (`size-7`) | brand SVG | — | `rounded-lg` |
| Channel in conversation header | 20–24px as coded | brand SVG | — | slightly rounded |
| Presence / legend dots | 8×8 (`size-2`) | none | — | full circle |
| Donut legend swatch | 8×8 | none | — | full circle |

`IconButton` defaults to `panelIcon`: white fill, `#bfbfbf` 0.6px, `#171717` glyph, hover `neutral-50`, `active:scale-95`, **no shadow**. Danger hover: `red-50` / `red-600`.

## Channel brand icons

Source: `apps/web/src/assets/channels/`. Wrapper: `WorkspaceChannelIcon` — default `inline-flex size-4 overflow-hidden rounded-[4px]`. Prefer the **SVG** files. PNGs in the same folder are older rasters; do not introduce new PNGs.

Aliases: `webchat` / `web chat` → chat; `call` / `calls` → voice.

| Channel | File | Tile |
|---|---|---|
| Web chat | [web-chat.svg](references/icons/channels/web-chat.svg) | `#3A3FE0` |
| Email | [email.svg](references/icons/channels/email.svg) | `#E06E3A` |
| WhatsApp | [whatsapp.svg](references/icons/channels/whatsapp.svg) | `#25D366` |
| Voice | [call.svg](references/icons/channels/call.svg) | `#00B885` |
| Facebook | [facebook.svg](references/icons/channels/facebook.svg) | `#1877F2` |
| Instagram | [instagram.svg](references/icons/channels/instagram.svg) | orange–pink–purple gradient |
| SMS | [sms.svg](references/icons/channels/sms.svg) | `#3A9EE0` |
| Video | [video.svg](references/icons/channels/video.svg) | `#E2A400` |
| Voicemail | [voicemail.svg](references/icons/channels/voicemail.svg) | `#653AE0` |

**Never** use Lucide `Phone`, `Mail`, `MessageCircle`, or Ant `WhatsAppOutlined` as the channel mark. Those Lucide icons are for contact *form fields* (phone number, email address), not the channel.

## Lucide catalog (product chrome)

Package: `lucide-react`. Default dashboard stroke **2.25**, `currentColor`. Reference SVGs are 24×24, stroke `#171717` / 2.25, so spokes can paste them.

| Icon | Job |
|---|---|
| `Search` | List/filter fields |
| `X` | Close / dismiss |
| `Check` | Selected menu row, confirm |
| `CheckCircle2` | Success KPI, resolved, banners |
| `ChevronDown` / `Left` / `Right` | Selects, collapse, disclosure |
| `Info` | KPI/chart/sentiment info |
| `Expand` / `Shrink` | Chart and copilot expand |
| `PanelLeftClose` | Minimize copilot |
| `ArrowUp` | Composer send |
| `MessagesSquare` | Handled volume KPI |
| `Clock3` | First response KPI |
| `Gauge` | Handle time KPI |
| `Target` | SLA KPI |
| `ArrowUpRight` / `ArrowDownRight` | Hand-off KPI + trend |
| `TrendingUp` | Daily avg KPI |
| `FileBarChart2` / `LineChart` | Reports / Analytics segment (icon-only) |
| `Bell` | Admin notifications, missed contacts |
| `Users` | Contacts nav + people pickers |
| `MessageSquare` | Internal chat nav |
| `MonitorDot` | Live monitoring nav |
| `Plus` / `Pencil` / `Trash2` | Create / edit / delete |
| `Download` | Export |
| `CalendarRange` | Date range |
| `LoaderCircle` | Spinners |
| `AlertTriangle` / `CircleAlert` | Warning / error |
| `Phone` / `Mail` / `MapPin` / `Building2` / `Globe2` | Contact fields |
| `Sparkles` | Guided / copilot affordance |

Reference files: [references/icons/lucide/](references/icons/lucide/).

## Sidebar

| Item | Icon |
|---|---|
| Dashboard | Ant `DashboardOutlined` |
| Contacts | Lucide `Users` `size-[1.2em]` stroke 1.75 |
| Queues / My Tasks | Ant `UnorderedListOutlined` |
| Workspace | custom headset `size-[1.4em]` |
| Live Monitoring | Lucide `MonitorDot` `size-[1.2em]` stroke 1.75 |
| Internal Chat | Lucide `MessageSquare` `size-[1.2em]` stroke 1.75 |
| My Performance | Ant `BarChartOutlined` |
| Logout | Ant `LogoutOutlined` |

Color: inherit from the row (`white/70` idle, `#fff` active). Do not paint sidebar icons blue.

## Header / copilot

| Control | Icon | Size |
|---|---|---|
| Account | letter avatar, not a user icon | 36px header / 40px popover |
| Presence | 8px status dot + `ChevronDown` 16px | 38px chip |
| Notifications / missed | `Bell` / `PhoneMissed` | 18px in 38px `panelIcon` |
| Copilot send | `ArrowUp` | 18px in 38px send |
| Copilot close / reset / download | `X` `RotateCcw` `Download` `Expand` | 18px in 38px `panelIcon` |

## Reports KPI set

| Metric | Lucide | Tile classes |
|---|---|---|
| Handled Volume | `MessagesSquare` | `bg-blue-100 text-blue-600` |
| Resolution Rate | `CheckCircle2` | `bg-emerald-100 text-emerald-600` |
| Avg First Response | `Clock3` | `bg-cyan-100 text-cyan-600` |
| Avg Handle Time | `Gauge` | `bg-violet-100 text-violet-600` |
| First-Reply SLA | `Target` | `bg-amber-100 text-amber-600` |
| Hand-offs | `ArrowUpRight` | `bg-rose-100 text-rose-600` |
| Resolved | `CheckCircle2` | `bg-teal-100 text-teal-600` |
| Daily Avg Handled | `TrendingUp` | `bg-indigo-100 text-indigo-600` |

## Do / don't

- Do keep 18px glyphs inside 38px buttons.
- Do use brand channel SVGs at 16px in tables and 24–28px in headers/offers.
- Do use Lucide `Phone`/`Mail` on contact *forms*.
- Don't introduce Heroicons, Phosphor, or a second Lucide stroke width on chrome.
- Don't put colored channel Lucide icons in the sidebar.
- Don't scale SVG with CSS so a 24px viewBox becomes a 12px fuzzy glyph — set `width`/`height`/`className` to the matrix size.
