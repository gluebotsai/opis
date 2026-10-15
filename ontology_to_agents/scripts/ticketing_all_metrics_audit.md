# Ticketing metrics audit

- API: `http://127.0.0.1:8765`
- Org: 1000 | User: 1005 | Agent: `tk.reporting`
- Metrics: 95
- HTTP 200: 95
- Postgres verified: 88
- Postgres SQL match: 88
- HTTP failures: 0
- PG mismatches: 0
- Unverified (no SQL): 7

## Latency (wall-clock seconds per metric)

| stat | seconds |
|------|---------|
| min | 2.71 |
| avg | 2.76 |
| p50 | 2.77 |
| p95 | 2.81 |
| max | 2.83 |
| total | 262.1 |

## Per-metric results

| metric | http | source | elapsed_s | compile_ms | wh_ms | api | pg | verified | match |
|--------|------|--------|-----------|------------|-------|-----|-----|----------|-------|
| ticket_volume | 200 | sql_template | 2.8 | 0 | 0 | 110.0 | 110.0 | Y | Y |
| resolved_tickets_metric | 200 | sql_template | 2.8 | 0 | 0 | 11.0 | 11.0 | Y | Y |
| open_tickets_metric | 200 | sql_template | 2.7 | 0 | 0 | 0.0 | 0.0 | Y | Y |
| active_tickets_metric | 200 | sql_template | 2.8 | 0 | 0 | 0.0 | 0.0 | Y | Y |
| resolution_rate | 200 | sql_template | 2.8 | 0 | 0 | 0.1 | 0.1 | Y | Y |
| unassigned_tickets_metric | 200 | sql_template | 2.8 | 0 | 0 | 2.0 | 2.0 | Y | Y |
| unassignment_rate | 200 | sql_template | 2.8 | 0 | 0 | 0.01818181818181818 | 0.01818181818181818 | Y | Y |
| customers_served | 200 | sql_template | 2.8 | 0 | 0 | 29.0 | 29.0 | Y | Y |
| accounts_served | 200 | sql_template | 2.8 | 0 | 0 | 0.0 | 0.0 | Y | Y |
| open_ticket_age_days_total | 200 | sql_template | 2.8 | 0 | 0 | 0.0 | None | Y | Y |
| average_open_ticket_age_days | 200 | sql_template | 2.8 | 0 | 0 | None | None | N | N |
| tickets_created_today_metric | 200 | sql_template | 2.8 | 0 | 0 | 1.0 | 1.0 | Y | Y |
| tickets_last_30_days | 200 | sql_template | 2.8 | 0 | 0 | 110.0 | 110.0 | Y | Y |
| days_since_last_ticket | 200 | sql_template | 2.8 | 0 | 0 | 0.004839900578703703 | 0.004883153969907407 | Y | Y |
| reopened_tickets_metric | 200 | sql_template | 2.8 | 0 | 0 | 3.0 | 3.0 | Y | Y |
| high_priority_ticket_volume | 200 | sql_template | 2.8 | 0 | 0 | 78.0 | 78.0 | Y | Y |
| closed_tickets_metric | 200 | sql_template | 2.8 | 0 | 0 | 10.0 | 10.0 | Y | Y |
| pending_tickets_metric | 200 | sql_template | 2.8 | 0 | 0 | 100.0 | 100.0 | Y | Y |
| assigned_tickets_metric | 200 | sql_template | 2.8 | 0 | 0 | 108.0 | 108.0 | Y | Y |
| assignment_rate | 200 | sql_template | 2.8 | 0 | 0 | 0.9818181818181818 | 0.9818181818181818 | Y | Y |
| tickets_last_7_days | 200 | sql_template | 2.8 | 0 | 0 | 10.0 | 10.0 | Y | Y |
| average_tickets_per_day | 200 | sql_template | 2.8 | 0 | 0 | 110.0 | 110.0 | Y | Y |
| active_customers_metric | 200 | sql_template | 2.7 | 0 | 0 | 0.0 | 0.0 | Y | Y |
| breached_tickets_metric | 200 | sql_template | 2.8 | 0 | 0 | 95.0 | 95.0 | Y | Y |
| sla_breach_rate | 200 | sql_template | 2.8 | 0 | 0 | 9.5 | 9.5 | Y | Y |
| resolution_hours_total | 200 | sql_template | 2.8 | 0 | 0 | 750.2847095372222 | 750.2847095372222 | Y | Y |
| resolved_for_avg | 200 | sql_template | 2.8 | 0 | 0 | 11.0 | 11.0 | Y | Y |
| average_resolution_time_hours | 200 | sql_template | 2.8 | 0 | 0 | 75.02847095372222 | 75.02847095372222 | Y | Y |
| first_response_hours_total | 200 | sql_template | 2.8 | 0 | 0 | 1044.5359985133334 | 1044.5359985133334 | Y | Y |
| tickets_with_first_response_metric | 200 | sql_template | 2.8 | 0 | 0 | 60.0 | 60.0 | Y | Y |
| average_first_response_hours | 200 | sql_template | 2.8 | 0 | 0 | 17.408933308555557 | None | N | N |
| average_first_response_minutes | 200 | sql_template | 2.8 | 0 | 0 | 1044.5359985133334 | None | N | N |
| first_response_sla_met_metric | 200 | sql_template | 2.8 | 0 | 0 | 52.0 | 52.0 | Y | Y |
| tickets_with_first_response_sla_target_metric | 200 | sql_template | 2.8 | 0 | 0 | 60.0 | 60.0 | Y | Y |
| first_response_sla_compliance_rate | 200 | sql_template | 2.8 | 0 | 0 | 0.8666666666666667 | 0.8666666666666667 | Y | Y |
| first_response_coverage_rate | 200 | sql_template | 2.8 | 0 | 0 | 0.5454545454545454 | 0.5454545454545454 | Y | Y |
| resolution_hours_variance_total | 200 | sql_template | 2.8 | 0 | 0 | 590.2847095372222 | 590.2847095372222 | Y | Y |
| tickets_with_sla_target_metric | 200 | sql_template | 2.8 | 0 | 0 | 10.0 | 10.0 | Y | Y |
| average_resolution_hours_variance | 200 | sql_template | 2.8 | 0 | 0 | 59.02847095372222 | None | N | N |
| tickets_with_resolution_sla_target_metric | 200 | sql_template | 2.8 | 0 | 0 | 10.0 | 10.0 | Y | Y |
| resolution_sla_met_metric | 200 | sql_template | 2.8 | 0 | 0 | 4.0 | 4.0 | Y | Y |
| resolution_sla_compliance_rate | 200 | sql_template | 2.8 | 0 | 0 | 0.4 | 0.4 | Y | Y |
| due_today_tickets_metric | 200 | sql_template | 2.8 | 0 | 0 | 0.0 | 0.0 | Y | Y |
| current_overdue_tickets_metric | 200 | sql_template | 2.8 | 0 | 0 | 99.0 | 99.0 | Y | Y |
| unanswered_tickets_metric | 200 | sql_template | 2.8 | 0 | 0 | 50.0 | 50.0 | Y | Y |
| sla_at_risk_tickets_metric | 200 | sql_template | 2.8 | 0 | 0 | 0.0 | 0.0 | Y | Y |
| average_overdue_hours | 200 | sql_template | 2.8 | 0 | 0 | 111.26386448953704 | 111.26386448953704 | Y | Y |
| queues_at_risk_metric | 200 | sql_template | 2.7 | 0 | 0 | 0.0 | 0.0 | Y | Y |
| csat_score_total | 200 | sql_template | 2.8 | 0 | 0 | 13.0 | 13.0 | Y | Y |
| csat_rated_metric | 200 | sql_template | 2.8 | 0 | 0 | 3.0 | 3.0 | Y | Y |
| average_csat_score | 200 | sql_template | 2.7 | 0 | 0 | 4.333333333333333 | 4.333333333333333 | Y | Y |
| csat_response_rate | 200 | sql_template | 2.8 | 0 | 0 | 0.2727272727272727 | 0.2727272727272727 | Y | Y |
| csat_promoter_metric | 200 | sql_template | 2.8 | 0 | 0 | 3.0 | 3.0 | Y | Y |
| csat_neutral_metric | 200 | sql_template | 2.8 | 0 | 0 | 0.0 | 0.0 | Y | Y |
| csat_detractor_metric | 200 | sql_template | 2.8 | 0 | 0 | 0.0 | 0.0 | Y | Y |
| csat_promoter_rate | 200 | sql_template | 2.8 | 0 | 0 | 1.0 | 1.0 | Y | Y |
| csat_detractor_rate | 200 | sql_template | 2.8 | 0 | 0 | 0.0 | 0.0 | Y | Y |
| reopen_rate | 200 | sql_template | 2.8 | 0 | 0 | 0.2727272727272727 | 0.2727272727272727 | Y | Y |
| queue_coverage_count | 200 | sql_template | 2.7 | 0 | 0 | 42.0 | 42.0 | Y | Y |
| distinct_agents_in_queues | 200 | sql_template | 2.8 | 0 | 0 | 5.0 | 5.0 | Y | Y |
| distinct_queues_covered | 200 | sql_template | 2.7 | 0 | 0 | 16.0 | 16.0 | Y | Y |
| tickets_with_resolver_metric | 200 | sql_template | 2.8 | 0 | 0 | 106.0 | 106.0 | Y | Y |
| tickets_without_resolver_metric | 200 | sql_template | 2.8 | 0 | 0 | 4.0 | 4.0 | Y | Y |
| active_agents_metric | 200 | sql_template | 2.7 | 0 | 0 | 1.0 | 1.0 | Y | Y |
| queue_count | 200 | sql_template | 2.7 | 0 | 0 | 19.0 | 19.0 | Y | Y |
| note_volume | 200 | sql_template | 2.7 | 0 | 0 | 47.0 | 47.0 | Y | Y |
| internal_note_volume | 200 | sql_template | 2.7 | 0 | 0 | 29.0 | 29.0 | Y | Y |
| customer_reply_volume | 200 | sql_template | 2.7 | 0 | 0 | 18.0 | 18.0 | Y | Y |
| internal_note_ratio | 200 | sql_template | 2.7 | 0 | 0 | 0.6170212765957447 | 0.6170212765957447 | Y | Y |
| average_notes_per_ticket | 200 | sql_template | 2.8 | 0 | 0 | 0.42727272727272725 | None | N | N |
| notification_volume | 200 | sql_template | 2.7 | 0 | 0 | 840.0 | 840.0 | Y | Y |
| unread_notifications_metric | 200 | sql_template | 2.7 | 0 | 0 | 840.0 | 840.0 | Y | Y |
| outbound_email_volume | 200 | sql_template | 2.7 | 0 | 0 | 834.0 | 834.0 | Y | Y |
| audit_event_volume | 200 | sql_template | 2.7 | 0 | 0 | 350.0 | 350.0 | Y | Y |
| escalation_volume | 200 | sql_template | 2.7 | 0 | 0 | 4.0 | 4.0 | Y | Y |
| reassignment_volume | 200 | sql_template | 2.7 | 0 | 0 | 47.0 | 47.0 | Y | Y |
| escalation_rate | 200 | sql_template | 2.8 | 0 | 0 | 0.03636363636363636 | None | N | N |
| kb_article_volume | 200 | sql_template | 2.7 | 0 | 0 | 28.0 | 28.0 | Y | Y |
| kb_published_article_metric | 200 | sql_template | 2.7 | 0 | 0 | 0.0 | 0.0 | Y | Y |
| kb_views_total | 200 | sql_template | 2.7 | 0 | 0 | 59.0 | 59.0 | Y | Y |
| macro_volume | 200 | sql_template | 2.7 | 0 | 0 | 12.0 | 12.0 | Y | Y |
| recommendation_volume | 200 | sql_template | 2.7 | 0 | 0 | 1373.0 | 1373.0 | Y | Y |
| accepted_recommendations_metric | 200 | sql_template | 2.8 | 0 | 0 | 0.0 | 0.0 | Y | Y |
| dismissed_recommendations_metric | 200 | sql_template | 2.7 | 0 | 0 | 0.0 | 0.0 | Y | Y |
| open_recommendations_metric | 200 | sql_template | 2.7 | 0 | 0 | 1373.0 | 1373.0 | Y | Y |
| recommendation_acceptance_rate | 200 | sql_template | 2.7 | 0 | 0 | 0.0 | 0.0 | Y | Y |
| approval_volume | 200 | sql_template | 2.7 | 0 | 0 | 336.0 | 336.0 | Y | Y |
| approved_metric | 200 | sql_template | 2.7 | 0 | 0 | 25.0 | 25.0 | Y | Y |
| rejected_metric | 200 | sql_template | 2.7 | 0 | 0 | 86.0 | 86.0 | Y | Y |
| pending_approvals_metric | 200 | sql_template | 2.7 | 0 | 0 | 225.0 | 225.0 | Y | Y |
| approval_rate | 200 | sql_template | 2.7 | 0 | 0 | 0.0744047619047619 | 0.0744047619047619 | Y | Y |
| decision_hours_total | 200 | sql_template | 2.7 | 0 | 0 | 0.0 | 0.0 | Y | Y |
| decided_approvals_metric | 200 | sql_template | 2.7 | 0 | 0 | 336.0 | 336.0 | Y | Y |
| average_decision_hours | 200 | sql_template | 2.7 | 0 | 0 | 0.0 | None | N | N |
| proactive_audit_volume | 200 | sql_template | 2.7 | 0 | 0 | 6739.0 | 6739.0 | Y | Y |
