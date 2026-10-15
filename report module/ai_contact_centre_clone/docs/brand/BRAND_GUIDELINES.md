# Worktual — Brand Guidelines

Canonical brand rules for **ai_contact_center_2**. For colors, typography, and component tokens see [`UI_THEME.md`](./UI_THEME.md). For screen layouts see [`LAYOUTS.md`](./LAYOUTS.md).

---

## Product naming

| Context | Name |
|---------|------|
| Product (full) | **Worktual Contact Center** |
| Login / marketing tagline | AI-Powered Contact Center for Enterprise Teams |
| AI assistant in UI | **Worktual co-worker** (never “Copilot” in user-facing copy) |
| Admin shell label | `ADMIN PORTAL` |
| Agent shell label | `AGENT PORTAL` |

Portal labels use uppercase eyebrow styling: `text-[10px] tracking-[0.14em] text-white/45` on the dark sidebar.

---

## Logo & marks

| Asset | Path | Usage |
|-------|------|--------|
| Worktual logo | [`worktual-logo.png`](./worktual-logo.png) | Login, marketing; runtime `/brand/worktual-logo.png` |
| Module mark | `apps/web/src/components/brand/ModuleMark.tsx` | Collapsible app sidebar |
| Co-worker mark | `apps/web/src/components/brand/CopilotMark.tsx` | Co-worker chat header |

### Logo sizing

- Sidebar / header: `h-7`–`h-8` (~28–32px height)
- Do not stretch, recolor, or add effects to the logo
- On dark backgrounds use the provided white/light mark variants from `ModuleMark`

---

## Voice & tone

- **Operational and calm** — enterprise contact-center software, not a consumer chat app
- **Concise** — short sentences; one question at a time in guided flows
- **Helpful** — explain what happened after actions; offer clear next steps
- **Human** — refer to the assistant as “your co-worker”, not a bot or AI product name

### Do / don’t (copy)

| Do | Don’t |
|----|--------|
| “Your Worktual co-worker” | “Copilot”, “AI assistant module” |
| “Say **create queue** when ready” | Long procedural paragraphs |
| Plain-language errors | Raw API / Prisma errors in UI |

---

## Color usage (brand level)

| Role | When to use |
|------|-------------|
| **Black** (`#000`) | Primary CTAs, active toggles, sidebar-adjacent emphasis |
| **Neutral gray canvas** (`#f3f4f6`) | App background — never full-page white |
| **Violet accent** | Login hero, agent avatar initials, active channel chips in queue preview |
| **Purple gradients** | Login hero panel only — not for in-app buttons |

Full token table: [`UI_THEME.md`](./UI_THEME.md).

---

## Reference screenshots

See [`reference-ui/`](./reference-ui/) for canonical PNG references. When adding new major surfaces, add a screenshot and row to that README.

---

## Related docs

- [`README.md`](./README.md) — asset index
- [`UI_THEME.md`](./UI_THEME.md) — design tokens
- [`LAYOUTS.md`](./LAYOUTS.md) — layout patterns
- [`../DESIGN_GUIDELINES.md`](../DESIGN_GUIDELINES.md) — full UI implementation guide
