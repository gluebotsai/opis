# Worktual — Brand & Design System

Canonical brand assets and design documentation for **ai_contact_center_2**.

---

## Documentation

| Doc | Purpose |
|-----|---------|
| [`BRAND_GUIDELINES.md`](./BRAND_GUIDELINES.md) | Product naming, logo, voice & tone |
| [`UI_THEME.md`](./UI_THEME.md) | Colors, typography, radius, component tokens |
| [`LAYOUTS.md`](./LAYOUTS.md) | App shell, workspace, co-worker split, page patterns |
| [`../DESIGN_GUIDELINES.md`](../DESIGN_GUIDELINES.md) | Full implementation guide (Ant Design + Tailwind) |

---

## Assets

| Asset | File | Usage |
|-------|------|--------|
| Logo | [`worktual-logo.png`](./worktual-logo.png) | Login, marketing; render at `h-7`–`h-8` |
| Reference UI | [`reference-ui/`](./reference-ui/) | Current Contact Center screenshots |
| Legacy reference UI | [`old/reference-ui/`](./old/reference-ui/) | Archived My Account / Setup screenshots |
| Screenshot script | [`scripts/capture-screenshots.mjs`](./scripts/capture-screenshots.mjs) | Refresh `reference-ui/` from a running dev server |

### Runtime paths

Copy logo to `apps/web/public/brand/worktual-logo.png` when scaffolding. Components:

- `apps/web/src/components/brand/ModuleMark.tsx` — sidebar
- `apps/web/src/components/brand/CopilotMark.tsx` — co-worker header

### Theme implementation

Ant Design tokens: `apps/web/src/app/theme.ts` (references `UI_THEME.md`).

---

## When to update these docs

Update `LAYOUTS.md` / `UI_THEME.md` when you add or change:

- New major layout (e.g. new portal section)
- Workspace or co-worker panel structure
- Global header, toolbar, or navigation shell
- Chat bubble, composer, or preview card patterns
- Design tokens in `theme.ts`

Add a screenshot to `reference-ui/` for any new canonical screen.
