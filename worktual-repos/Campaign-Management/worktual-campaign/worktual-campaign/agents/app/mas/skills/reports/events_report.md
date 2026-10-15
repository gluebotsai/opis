# events_report

## purpose
List events and load event detail for the events report surface. Read-only.

## when active
Domain selected `events_report`. User is on events reporting or asks about events/forms outcomes in that workspace.

## chat flow

### 1 — Check memory first
Reuse prior event id / filters from chat when present.

### 2 — Pick the tool

| Intent | Tool |
|--------|------|
| List / filter events | **LIST_EVENTS** |
| One event detail | **GET_EVENT_DETAIL** |

### 3 — Answer from tool results only
Never invent event rows or counts.

### 4 — Follow-up
Campaign KPIs → Domain → `report_kpis`. Campaign list/detail → `report_campaigns`.

## tools (this skill — schemas passed separately)
- **LIST_EVENTS**
- **GET_EVENT_DETAIL**
- **ROUTE_TO_MODULE**

## completion
Events listed or detail returned (or clear empty/not found).

## must not
- Call query_analytics, ask_ontology, LIST_MONITOR_*, GET_CAMPAIGN_*, or STOP_*.
- Invent event data.
- Switch skills (Domain only).

## resume
Continue on the same events thread unless they change filter or event.
