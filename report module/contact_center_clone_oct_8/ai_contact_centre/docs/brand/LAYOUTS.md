# Worktual — Layout Patterns

Screen layout reference for **ai_contact_center_2**. Match tokens in [`UI_THEME.md`](./UI_THEME.md).

---

## 1. App shell

Full viewport layout used on every authenticated page.

```text
┌──────────────┬──────────────────────────────────────────────────────────┐
│ Dark sidebar │ Global header: [Page title]     [toolbar] [role · org]   │
│ 260px / 72px │──────────────────────────────────────────────────────────│
│ collapsed    │ Main content (gray canvas, flex-1, overflow hidden)    │
│              │                                                          │
│ ModuleMark   │                                                          │
│ Nav links    │                                                          │
│ User/logout  │                                                          │
└──────────────┴──────────────────────────────────────────────────────────┘
```

| Property | Value |
|----------|--------|
| Root | `flex h-svh overflow-hidden bg-[#f3f4f6]` |
| Sidebar expanded | `w-[260px] bg-[#111111]` |
| Sidebar collapsed | `w-[72px]` |
| Header | `border-b border-neutral-200/80 bg-[#f3f4f6]` |
| Page title | Set via `useSetPageTitle()` / `PageTitleProvider` — rendered in global header, not per-page `h1` in content |
| Main | `flex-1 min-h-0 overflow-hidden` — content fills remaining viewport height |

**Source:** `apps/web/src/layouts/AppLayout.tsx`

### Global header toolbar

Right side of header (admin):

- Availability status
- Phone / notifications icons
- Role · organization badge (`Admin · worktual1`)

**Source:** `apps/web/src/components/workspace/workspace-toolbar.tsx`

---

## 2. Three-panel workspace

Used for **My Workspace** (admin + agent). Three separate panel cards on gray canvas — not one monolithic white container.

```text
┌─────────────────┬────────────────────────────┬─────────────────────┐
│ Inbox / list    │ Conversation window        │ Customer + co-worker │
│ ~26%            │ flex-1                     │ ~28%                 │
│                 │                            │                      │
│ Search + tabs   │ Header + messages          │ Customer summary     │
│ Conversation    │ Composer + suggested reply │ Co-worker chat       │
│ rows            │                            │ (embedded)           │
└─────────────────┴────────────────────────────┴─────────────────────┘
```

| Property | Value |
|----------|--------|
| Grid | `xl:grid-cols-[minmax(280px,26%)_minmax(0,1fr)_minmax(300px,28%)]` |
| Gap | `gap-4` |
| Panel wrapper | `WorkspacePanel` — `rounded-2xl border border-neutral-200 bg-white shadow-sm` |
| Height | `h-full min-h-0` flex chain from `h-svh` root |

**Source:**

- `apps/web/src/components/workspace/workspace-panels.tsx`
- `apps/web/src/components/workspace/workspace-panel.tsx`
- `apps/web/src/pages/workspace/WorkspacePage.tsx`

### Inbox panel (left)

- Search: `h-10 rounded-xl border-neutral-200 bg-neutral-50`
- Tabs: All / Mine / Unassigned with counts
- Conversation rows with channel icon, preview, time

**Source:** `workspace-inbox-panel.tsx`

### Conversation panel (center)

- Channel-specific header
- Chat or email view (`WorkspaceChatView` / `WorkspaceEmailView`)
- Composer with inline suggested-reply strip (dismiss + click-to-insert)
- Icon-only send — matches co-worker composer style

**Source:** `workspace-chat-panel.tsx`, `workspace-conversation-composer.tsx`

### Customer + co-worker panel (right)

Top: compact CRM-style customer summary. Bottom: embedded `WorkspaceAiPanel` (co-worker).

**Customer summary blocks:**

1. Avatar + name + tier badge + email + channel · queue
2. **Stat grid** (2 cols): Lifetime value, Open tickets — `border-neutral-200` mini-cards
3. Contact block: `rounded-xl bg-neutral-50/80`
4. Tags: `rounded-full border border-neutral-200`
5. Collapsible Notes

**Source:** `workspace-customer-panel.tsx`, `workspace-ai-panel.tsx`

---

## 3. Co-worker split workspace (Queues)

Used on **Queues** and other admin pages with guided co-worker flows. Two resizable columns with expand/collapse.

```text
┌─────────────────────────────────────┬──────────────────────────┐
│ Co-worker chat (~65% default)       │ Preview / form (~35%)    │
│                                     │                          │
│ CopilotChatShell                    │ GuidedQueueDraftPreview  │
│ Message list + composer             │ or QueueManagePanel      │
│ Expand button on each panel         │                          │
└─────────────────────────────────────┴──────────────────────────┘
```

| Property | Value |
|----------|--------|
| Grid | `lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]` |
| Expanded left | `65fr / 35fr` |
| Expanded right | `35fr / 65fr` |
| Gap | `gap-5` |
| Max width | `max-w-7xl` when sidebar expanded |
| Full height | `fillHeight` + `h-full min-h-0 flex-1` |

**Source:** `apps/web/src/components/assistant/copilot-workspace.tsx`

### Co-worker chat shell

- Header: Co-worker mark + title + restart + expand + options (download PDF)
- Scroll area: message bubbles
- Footer: `CopilotChatInput` — `rounded-2xl` composer, icon send

When `embedded={true}` (inside workspace right panel): no outer border/radius — fills parent panel.

**Source:** `embedded-copilot-panel.tsx`, `copilot-workspace.tsx`

### Guided queue preview (right)

Sections:

1. **Header** — queue name, progress bar, % complete
2. **Up next** — current step card + pending steps list
3. **Completed** — scrollable list of answered steps; auto-scrolls on new items

**Agents & channels completed card:**

- Per-shift grouping
- Agent blocks: avatar + name + per-agent channel toggles (violet active state)
- Channels editable after initial channel step

**Source:** `guided-queue-preview.tsx`

---

## 4. Standard list page

Example: Agents, Presence, Queues list.

```text
[Optional page actions row]
┌────────────────────────────────────────────────────────────┐
│ Search + filters                                           │
│ Table in rounded-2xl border card                           │
└────────────────────────────────────────────────────────────┘
```

**Source:** `AgentsPage.tsx`, `PresencePage.tsx`, `QueuesPage.tsx`

---

## 5. Copilot + content form (Queues create/edit)

When not in guided preview-only mode:

- Left: co-worker chat
- Right: `QueueManagePanel` / `QueueEditor` form in panel card

**Source:** `QueuesPage.tsx`, `queue-manage-panel.tsx`

---

## 6. Login

```text
[Black top bar: logo + Contact Us]
┌──────────────────────┬──────────────────────┐
│ Purple hero (desktop)│ White form card      │
└──────────────────────┴──────────────────────┘
[Trust footer badges]
```

**Source:** `apps/web/src/pages/auth/LoginPage.tsx`

---

## 7. Coming soon / placeholder pages

Centered content in `rounded-2xl border border-neutral-200 bg-white shadow-sm` card.

**Source:** `ComingSoonPage.tsx`, `PageShell.tsx`

---

## Responsive behavior

| Breakpoint | Behavior |
|------------|----------|
| `< xl` | Workspace stacks to single column |
| `< lg` | Copilot split stacks vertically |
| Sidebar | Hidden on mobile; drawer pattern TBD |

---

## Layout do / don’t

| Do | Don’t |
|----|--------|
| Three separate `WorkspacePanel` cards with `gap-4` on gray canvas | One full-width white wrapper around all workspace columns |
| Page title in global `AppLayout` header | Duplicate `h1` inside page content |
| `min-h-0` + `flex-1` chain for full-height panels | Fixed `calc(100dvh - …)` heights |
| Co-worker embedded in customer panel | Separate nav item for “AI module” |
| Expand co-worker or preview manually | Auto-expand preview on guided queue start |

---

## Code index

| Layout | Primary files |
|--------|----------------|
| App shell | `layouts/AppLayout.tsx` |
| Workspace 3-panel | `workspace/workspace-panels.tsx` |
| Co-worker split | `assistant/copilot-workspace.tsx` |
| Queues page | `pages/admin/workforce/QueuesPage.tsx` |
| Guided preview | `workforce/guided-queue-preview.tsx` |
| Navigation | `config/navigation.tsx` |
