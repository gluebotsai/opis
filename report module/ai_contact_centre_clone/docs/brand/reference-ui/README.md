# Worktual — Reference UI Screenshots

Canonical visual references for **ai_contact_center_2**. Match layout, spacing, and tokens in [`UI_THEME.md`](../UI_THEME.md) and [`LAYOUTS.md`](../LAYOUTS.md).

Legacy My Account / Setup screenshots live in [`../old/reference-ui/`](../old/reference-ui/).

---

## Contact Center admin

Each authenticated screen has up to four variants:

| Suffix | Meaning |
|--------|---------|
| *(none)* | Sidebar expanded (260px), default split |
| `-right-expanded` | Sidebar expanded, right content panel at 65% |
| `-sidebar-hidden` | Sidebar collapsed (72px icon rail), default split |
| `-sidebar-hidden-right-expanded` | Sidebar collapsed, right content panel at 65% |

### Login

| File | Screen |
|------|--------|
| [`login.png`](./login.png) | Sign-in |

### Dashboard

| File | Screen |
|------|--------|
| [`dashboard.png`](./dashboard.png) | Default |
| [`dashboard-right-expanded.png`](./dashboard-right-expanded.png) | Right panel expanded |
| [`dashboard-sidebar-hidden.png`](./dashboard-sidebar-hidden.png) | Sidebar collapsed |
| [`dashboard-sidebar-hidden-right-expanded.png`](./dashboard-sidebar-hidden-right-expanded.png) | Sidebar collapsed + right expanded |

### Queues

| File | Screen |
|------|--------|
| [`queues.png`](./queues.png) | Default |
| [`queues-right-expanded.png`](./queues-right-expanded.png) | Right panel expanded |
| [`queues-sidebar-hidden.png`](./queues-sidebar-hidden.png) | Sidebar collapsed |
| [`queues-sidebar-hidden-right-expanded.png`](./queues-sidebar-hidden-right-expanded.png) | Sidebar collapsed + right expanded |

### Workspace

| File | Screen |
|------|--------|
| [`workspace.png`](./workspace.png) | Three-panel layout, sidebar expanded |
| [`workspace-sidebar-hidden.png`](./workspace-sidebar-hidden.png) | Three-panel layout, sidebar collapsed |

### Reports & Analytics

| File | Screen |
|------|--------|
| [`reports.png`](./reports.png) | Default |
| [`reports-right-expanded.png`](./reports-right-expanded.png) | Right panel expanded |
| [`reports-sidebar-hidden.png`](./reports-sidebar-hidden.png) | Sidebar collapsed |
| [`reports-sidebar-hidden-right-expanded.png`](./reports-sidebar-hidden-right-expanded.png) | Sidebar collapsed + right expanded |

---

## Regenerating screenshots

With the dev server running on port 5173:

```bash
node docs/brand/scripts/capture-screenshots.mjs
```

Optional env: `BASE_URL`, `SCREENSHOT_EMAIL`, `SCREENSHOT_PASSWORD`.
