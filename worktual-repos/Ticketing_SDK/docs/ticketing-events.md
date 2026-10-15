# Ticketing system events

Catalog of events emitted or recorded by the Worktual ticketing app (Express / Postgr                                                                                                                                                                                                 es).  
Source of truth in code: `ui-backend/src/server/audit.ts`, `ui-backend/src/server/notifications.ts`, and `ui-backend/server.ts`.

---

## 1. Audit trail (`ticketing.audit_events`)

Append-only log for ticket lifecycle. Typed in code as `AuditAction`.


| Action                  | When it fires                                                 | Typical meta                                       |                |
| ----------------------- | ------------------------------------------------------------- | -------------------------------------------------- | -------------- |
| `ticket.created`        | A ticket is filed (UI or create flow)                         | Subject, assignee, channel, etc.                   |                |
| `ticket.assigned`       | Assignee is set or changed (non-escalate path)                | `from`, `to`, assignee id                          |                |
| `ticket.escalated`      | Ticket escalated (detail UI, escalate API, or co-worker chat) | `from`, `to`, assignee id, rationale / via         |                |
| `ticket.status_changed` | Status changes (e.g. Open → Pending, Resolved)                | Previous / new status                              |                |
| `ticket.updated`        |                                                               | Other ticket field updates (priority, queue, etc.) | Changed fields |
| `ticket.note_added`     | Internal or public note / reply is posted                     | Visibility, preview                                |                |




### Ticket history UI

The ticket timeline is built mainly from these audit actions:

- `ticket.created` → “Ticket submitted”
- `ticket.status_changed` → status label change
- `ticket.assigned` → “Assigned to …”
- `ticket.escalated` → “Escalated to …”

Notes also appear in the conversation thread (and write `ticket.note_added`).

---



## 2. Inbox notifications (`notifications`)

User-facing inbox items. Typed as `NotifyKind`. Each kind maps to an account preference column.


| Kind         | Preference flag             | Typical trigger                                                           |
| ------------ | --------------------------- | ------------------------------------------------------------------------- |
| `assignment` | `notify_ticket_assignments` | Ticket assigned or escalated to you                                       |
| `update`     | `notify_ticket_updates`     | Ticket updated, or note/reply added                                       |
| `sla`        | `notify_sla_alerts`         | SLA breached (past due → Overdue)                                         |
| `security`   | `notify_security_alerts`    | Password changed, 2FA enabled/disabled                                    |
| `product`    | `notify_product_updates`    | Reserved for product announcements (pref exists; little/no emitter today) |


Notifications may include `ticket_number` / customer name for deep-link into Search / ticket list.

---



## 3. Account & security events

Not always written to `audit_events`, but they are real system events:


| Event                   | Storage / side effect                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------- |
| Login success           | `user_login_events` + `user_sessions`                                                  |
| Session active / revoke | `user_sessions`                                                                        |
| Password changed        | `users.password_changed_at` (+ accounts mirror when present) + `security` notification |
| Two-factor toggled      | `users.two_factor_enabled` + `security` notification                                   |


---



## 4. Automatic ticket lifecycle (SLA)


| Event             | Behavior                                                          |
| ----------------- | ----------------------------------------------------------------- |
| SLA sweep         | Open tickets with `due_at < now` → status set to `Overdue`        |
| SLA breach notify | `kind: sla` notification to assignee, or org agents if unassigned |


Runs as part of ticket list / metrics paths that call the SLA sweep helper.

---



## 5. Co-worker / LangGraph actions (not audit rows)

These change UI or DB but do **not** add a dedicated audit action unless they go through escalate/create ticket APIs:


| Action type                    | Effect                                                                     |
| ------------------------------ | -------------------------------------------------------------------------- |
| `navigate`                     | Open a module (role-gated)                                                 |
| `set_filter` / `clear_filters` | Filter ticket / customer / KB / teams lists                                |
| `create_ticket`                | Start create-ticket flow (role-gated)                                      |
| `create_team`                  | Start create-team flow (role-gated)                                        |
| `escalate`                     | Applied by Express → writes `ticket.escalated` + `assignment` notification |
| `refresh_tickets`              | UI reload after escalate                                                   |


---



## 6. What is not audited today

These may happen in the product but have **no** matching `*.created` / `*.updated` audit actions in the current code:

- Knowledge Base create / edit / delete  
- Customer create / update  
- Teams / queues create  
- Macros, org preferences, escalation directory changes  
- Pure filter / navigate co-worker turns

---



## Quick reference

**Audit actions:**  
`ticket.created` · `ticket.assigned` · `ticket.escalated` · `ticket.status_changed` · `ticket.updated` · `ticket.note_added`

**Notification kinds:**  
`assignment` · `update` · `sla` · `security` · `product`

**Account:**  
login · session · password change · 2FA toggle  

**Automation:**  
SLA breach → Overdue + `sla` notify  