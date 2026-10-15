# Internal — sales oversight

## Purpose

Sales admin dashboards: agent performance, unassigned leads, reassignment, export audit. Not used by customer product spokes.

## Auth

| Action | Gate |
|--------|------|
| Reads / export audit | `requireSalesOversightAuth` |
| Reassign lead | `requireSalesAdminWriteAuth` |

## Source map

| Layer | Path |
|-------|------|
| Client | [`src/lib/salesOversight.js`](../../src/lib/salesOversight.js) |
| Server | sales oversight handlers in [`server/index.js`](../../server/index.js) |

## Endpoints

| Method | Path | Client helper | Notes |
|--------|------|---------------|-------|
| GET | `/api/sales-oversight/dashboard` | `fetchOversightDashboard` | `?days=` |
| GET | `/api/sales-oversight/agents` | `fetchOversightAgents` | |
| GET | `/api/sales-oversight/agents/:userId` | `fetchOversightAgentDetail` | |
| GET | `/api/sales-oversight/leads/:leadId` | `fetchOversightLeadDetail` | |
| GET | `/api/sales-oversight/unassigned-leads` | `fetchUnassignedLeads` | |
| PUT | `/api/sales-oversight/leads/:leadId/assign` | `reassignLead` | `{ toUserId, reason }` |
| POST | `/api/sales-oversight/export-audit` | `logOversightExportAudit` | Audit log |

## Reuse notes

- Keep oversight inside My Account sales admin; CRM should not duplicate these metrics APIs unless productized later.
