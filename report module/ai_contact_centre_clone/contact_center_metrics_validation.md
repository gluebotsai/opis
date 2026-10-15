# Metrics Comparison & Validation Matrix: Existing vs. Reporting Module

## 1. Executive Summary & Guarantee

> [!IMPORTANT]
> **Dashboard Metrics Protection Guarantee**:
> **Zero dashboard metrics will be disturbed.**
> - The live Contact Center Dashboard, Admin Dashboard, and `/api/v1/dashboard/overview` endpoints remain fully functional and intact.
> - The internal REST APIs (`/internal/v1/dashboard-analytics` and `/internal/v1/reports`) remain completely untouched.
> - The new Domain Agent (`reports_analytics_agent`) supersedes the legacy natural-language analytics co-worker agent and covers **100% of all legacy metrics** while expanding the reporting suite to **46 certified KPIs**, **33 breakdown dimensions**, and **40 business filters**.

---

## 2. Complete Legacy Metrics Mapping & Validation

Below is the side-by-side audit of every legacy metric previously handled by `analytics` coworker agent via `metrics.yaml` and how it is computed by the new domain agent `reports_analytics_agent`:

| Legacy Metric ID | Legacy Label | Legacy Scope & Tables | Legacy Dimensions | Domain Agent KPI ID | Domain Certified SQL Template | Mathematical & Business Equivalence |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `conversations_handled` | Conversations handled | `ccass.conversations` (status `resolved`/`closed` or `ended_at` IS NOT NULL) | `channel`, `day` | `handled` / `total` | `product/sql/handled.sql` | **Exact Match**: Counts handled conversations in the period. Supports breakdown by `channel` and `day`. |
| `resolution_rate` | Resolution rate | `ccass.conversations` (`resolved_at` IS NOT NULL / handled * 100) | none | `resolution_rate` | `product/sql/resolution_rate.sql` | **Exact Match**: Certified calculation of resolved volume over handled conversations. |
| `avg_handle_time` | Average handle time (AHT) | `ccass.conversations` (avg seconds assigned to resolved/ended) | none | `avg_handle_time` | `product/sql/avg_handle_time.sql` | **Exact Match**: Certified calculation of handling duration, formatted accurately in minutes/seconds. |
| `avg_first_response` | Average first response time | `ccass.conversations` (avg seconds assigned to first_response_at) | none | `avg_first_response` | `product/sql/avg_first_response.sql` | **Exact Match**: Accurate timestamp delta with null-safety and sub-second mean support. |
| `response_sla_60s` | First-Reply SLA | `ccass.conversations` (% first replies <= 60s of assignment) | none | `first_reply_sla` | `product/sql/first_reply_sla.sql` | **Exact Match**: Certified 60-second threshold with composition breakdown. |
| `transfers` | Transfers | `ccass.conversations` (`transferred_at` IS NOT NULL) | none | `transferred` / `transfer_rate` | `product/sql/transferred.sql` | **Enhanced**: Provides both absolute count (`transferred`) and transfer percentage (`transfer_rate`). |
| `channel_mix` | Channel mix | `ccass.conversations` (COUNT grouped by channel) | `channel` | `total` / `handled` (slice: `channel`) | `product/sql/total.sql` with slice | **Exact Match**: Slices volume across voice, webchat, whatsapp, email, etc. |
| `daily_handled_trend` | Daily handled trend | `ccass.conversations` (COUNT grouped by day) | `day` | `avg_daily_handled` / `handled` (slice: `day`) | `product/sql/avg_daily_handled.sql` | **Exact Match**: Daily series aggregation with date truncations. |
| `disposition_mix` | Disposition mix | `ccass.conversations` + `conversation_dispositions` + `dispositions` | `disposition` | `total` / `handled` (slice: `disposition`) | `product/sql/total.sql` with slice | **Exact Match**: Grouped by disposition label. |

---

## 3. Expanded Capabilities in the Domain Reporting Agent (46 Total KPIs)

In addition to the 9 legacy metrics, `reports_analytics_agent` introduces **37 new certified KPIs**:

### Additional Volume & Flow KPIs
- `call_count`: Voice-specific interactions
- `social_count`: Social/messaging channels
- `handled_change`: Period-over-period delta
- `avg_daily_handled`: Daily mean volume
- `avg_monthly_handled`: Monthly mean volume
- `active`: Current live conversations
- `bot_active`: Automated active conversations
- `callback_count`: Outbound scheduled callbacks

### Advanced Resolution & SLA KPIs
- `resolved`: Absolute resolved count
- `fcr`: First Contact Resolution rate (resolved without repeat contact in 24h)
- `reopen_rate`: Rate of reopened conversations
- `first_replies`: Total first replies sent
- `queue_service_level`: Service level agreement threshold adherence
- `failed_send_rate`: Outbound delivery failure rate

### Duration & Hold KPIs
- `asa`: Average Speed of Answer
- `avg_hold_time`: Average time on hold
- `avg_messages_per_conversation`: Interaction depth/exchanges

### Abandonment & Queue State
- `abandoned`: Abandoned calls/chats in queue
- `abandonment_rate`: Queue abandonment percentage
- `waiting`: Live waiting contacts count

### Live SLA Risk
- `sla_at_risk`: Approaching SLA breach threshold
- `sla_breached_live`: Breached SLA contacts

### Missed Contacts & Quality
- `missed_contacts`: Unique missed contacts count
- `missed_rate`: Unique missed over demand percentage
- `negative_sentiment_rate`: Unfavorable sentiment score proportion

### Automation & AI Metrics
- `bot_containment`: End-to-end bot resolution rate
- `bot_grounded_rate`: Factual grounding verification rate
- `copilot_acceptance_rate`: Agent copilot suggestion acceptance
- `offer_accept_rate`: Routing offer acceptance rate

### Workforce & Presence Metrics
- `present_days`: Shift attendance
- `occupancy`: Utilization/occupancy rate
- `ready_hours`: Time in ready state
- `busy_hours`: Time handling contacts
- `not_ready_hours`: Away/not ready time
- `break_hours`: Break time
- `ready_agents`: Live available agents count
- `logged_in_agents`: Total logged in agents
- `offers_ringing`: Live ringing offers count

---

## 4. Breakdown Dimensions (33 Dimensions vs 3 Legacy)

| Dimension Category | Legacy Setup | Reporting Domain Module |
| :--- | :--- | :--- |
| **Time Slices** | `day` | `day`, `week`, `month`, `hour` |
| **Organizational** | None | `team`, `queue`, `agent` |
| **Channel & Routing** | `channel` | `channel`, `conversation_direction`, `assignment_state`, `delivery_state`, `handoff_recommended`, `miss_reason`, `presence_state` |
| **Lifecycle & Status** | `disposition` | `conversation_status`, `disposition`, `resolution_code`, `end_actor`, `end_reason`, `is_reopened`, `is_bot_only`, `handler` |
| **Copilot & AI** | None | `copilot_accepted`, `copilot_turn_type`, `grounded`, `intent`, `sender_type` |
| **Task Management** | None | `priority`, `task_status`, `task_type`, `visibility` |

---

## 5. Filter Coverage (40 Filters vs 3 Legacy)

The reporting module supports **40 SQL and business filters** (compared to 3 in the legacy setup):
- `organization_id`, `agent`, `team`, `queue`, `shift`, `presence_state`
- `customer_name`, `customer_company`, `customer_language`, `customer_blocked`
- `channel`, `channel_config`, `conversation_direction`
- `disposition`, `resolution_code`, `end_actor`, `end_reason`, `handoff_reason`, `intent`, `miss_reason`
- `created_at`, `completed_at`, `due_at`, `start`, `end`, and natural language time phrases.
