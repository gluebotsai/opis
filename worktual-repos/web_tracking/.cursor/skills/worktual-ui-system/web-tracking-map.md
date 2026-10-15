# Worktual UI — Web Tracking Analytics mapping

This repo implements the Worktual UI system in **`web/`** (not `apps/web` from Contact Center).

| CCaaS skill path | Web tracking path |
|------------------|-------------------|
| `apps/web/src/index.css` | `web/src/styles.css` |
| `apps/web/src/layouts/AppLayout.tsx` | `web/src/layout/AppShell.jsx` |
| Sidebar shell | `web/src/layout/Sidebar.jsx` |
| Page header | `web/src/layout/TopHeader.jsx` |
| Login | `web/src/pages/Login.tsx` |
| KPI tiles | `web/src/components/KpiIcon.jsx`, `.kpi-card-ref` in styles |
| Charts | `web/src/components/Charts.jsx`, `.dashboard-chart-card` |
| Chat / co-worker | `web/src/components/ChatInterface.jsx`, `.chat-bubble-*` |
| Reports panel | `web/src/components/ReportsPanel.jsx` |

When auditing or restyling, read [SKILL.md](SKILL.md) + [tokens.md](tokens.md), then apply changes in `web/src/styles.css` first.
