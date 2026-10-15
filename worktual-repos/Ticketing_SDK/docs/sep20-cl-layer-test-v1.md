# Sep 20 CL layer test v1

Organization `1012`. From-scratch run. Context Layer `http://192.168.11.25:8765`.
Partial write: **2443** cases so far.

## Agents (`ticketing.agents`)

| id | role | name | email |
|---|---|---|---|
| 1025 | agent | Shobana R | isabeldalu7@gmail.com |
| 1026 | agent | Lokesh B | l.balamurugan@worktual.com |
| 1027 | resolver | Anshu Kushwaha | anshukushwaha454@gmail.com |
| 1028 | admin | Booxoo Admin | ecom.booxoo@gmail.com |
| 1029 | agent | mohamed fazil | smohamedfazil16@gmail.com |
| 1030 | resolver | Arun Ayyappan | a.ayyappan@worktual.com |
| 1031 | resolver | Priya Moorthy | mohanapriyamoorthy11@gmail.com |
| 1032 | resolver | Chandru R | c.ramaraj@worktual.com |

## Summary

- Cases: **2443** · CL_ERROR 381 · FALLBACK_FAIL 359 · FALLBACK_PASS 324 · GAP 3 · MISMATCH 440 · PASS 365 · UNMAPPED 571

## Failed queries (CL_ERROR / FALLBACK_FAIL)


- **open_tickets_metric group_by=- time=all_time** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: Server disconnected without sending a response.
- **open_tickets_metric group_by=- time=today** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **open_tickets_metric group_by=- time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **open_tickets_metric group_by=- time=last_30d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **open_tickets_metric group_by=priority time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **open_tickets_metric group_by=queue_name time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **open_tickets_metric group_by=status time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **outbound_email_volume group_by=- time=all_time** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **outbound_email_volume group_by=- time=today** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **outbound_email_volume group_by=- time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **outbound_email_volume group_by=- time=last_30d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **outbound_email_volume group_by=kind time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **outbound_email_volume group_by=status time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_approvals_metric group_by=- time=all_time** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_approvals_metric group_by=- time=today** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_approvals_metric group_by=- time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_approvals_metric group_by=- time=last_30d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_approvals_metric group_by=agent_id time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_approvals_metric group_by=status time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_approvals_metric group_by=tool_name time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_approvals_metric group_by=ticket_priority time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_approvals_metric group_by=ticket_status time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_approvals_metric group_by=queue_name time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_tickets_metric group_by=- time=all_time** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_tickets_metric group_by=- time=today** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_tickets_metric group_by=- time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_tickets_metric group_by=- time=last_30d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_tickets_metric group_by=status time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_tickets_metric group_by=status_display_name time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_tickets_metric group_by=is_closed_by_status time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_tickets_metric group_by=priority time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_tickets_metric group_by=channel time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_tickets_metric group_by=category time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_tickets_metric group_by=skill time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_tickets_metric group_by=assignee_name time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_tickets_metric group_by=assignee_role time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_tickets_metric group_by=resolver_name time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_tickets_metric group_by=queue_name time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_tickets_metric group_by=queue_type time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_tickets_metric group_by=account_name time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_tickets_metric group_by=organization_name time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_tickets_metric group_by=organization_business_type time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_tickets_metric group_by=team_supports_ticketing time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_tickets_metric group_by=created_by_name time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_tickets_metric group_by=customer_name time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_tickets_metric group_by=has_assignee time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_tickets_metric group_by=has_resolver time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_tickets_metric group_by=has_first_response time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_tickets_metric group_by=has_csat_rating time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **pending_tickets_metric group_by=is_overdue time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **proactive_audit_volume group_by=- time=all_time** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **proactive_audit_volume group_by=- time=today** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **proactive_audit_volume group_by=- time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **proactive_audit_volume group_by=- time=last_30d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **proactive_audit_volume group_by=agent_id time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **proactive_audit_volume group_by=decision time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **queue_count group_by=- time=all_time** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **queue_count group_by=- time=today** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **queue_count group_by=- time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **queue_count group_by=- time=last_30d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **queue_count group_by=queue_name time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **queue_count group_by=queue_type time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **queue_count group_by=sla_status time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **queue_coverage_count group_by=- time=all_time** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **queue_coverage_count group_by=- time=today** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **queue_coverage_count group_by=- time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **queue_coverage_count group_by=- time=last_30d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **queue_coverage_count group_by=queue_name time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **queue_coverage_count group_by=queue_type time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **queue_coverage_count group_by=sla_status time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **queue_coverage_count group_by=user_name time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **queue_coverage_count group_by=user_role time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **queue_coverage_count group_by=myaccount_team_name time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **queue_coverage_count group_by=team_supports_ticketing time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **queues_at_risk_metric group_by=- time=all_time** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **queues_at_risk_metric group_by=- time=today** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **queues_at_risk_metric group_by=- time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **queues_at_risk_metric group_by=- time=last_30d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **queues_at_risk_metric group_by=queue_name time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **queues_at_risk_metric group_by=queue_type time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **queues_at_risk_metric group_by=sla_status time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **reassignment_volume group_by=- time=all_time** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **reassignment_volume group_by=- time=today** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **reassignment_volume group_by=- time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **reassignment_volume group_by=- time=last_30d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **reassignment_volume group_by=action time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **reassignment_volume group_by=ticket_priority time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **reassignment_volume group_by=ticket_status time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **reassignment_volume group_by=queue_name time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **reassignment_volume group_by=assignee_name time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **reassignment_volume group_by=actor_name time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **recommendation_acceptance_rate group_by=- time=all_time** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **recommendation_acceptance_rate group_by=- time=today** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **recommendation_acceptance_rate group_by=- time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **recommendation_acceptance_rate group_by=- time=last_30d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **recommendation_acceptance_rate group_by=agent_id time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **recommendation_acceptance_rate group_by=status time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **recommendation_acceptance_rate group_by=ticket_priority time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **recommendation_acceptance_rate group_by=ticket_status time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **recommendation_acceptance_rate group_by=queue_name time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **recommendation_volume group_by=- time=all_time** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **recommendation_volume group_by=- time=today** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **recommendation_volume group_by=- time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **recommendation_volume group_by=- time=last_30d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **recommendation_volume group_by=agent_id time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **recommendation_volume group_by=status time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **recommendation_volume group_by=ticket_priority time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **recommendation_volume group_by=ticket_status time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **recommendation_volume group_by=queue_name time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **rejected_metric group_by=- time=all_time** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **rejected_metric group_by=- time=today** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **rejected_metric group_by=- time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **rejected_metric group_by=- time=last_30d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **rejected_metric group_by=agent_id time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **rejected_metric group_by=status time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **rejected_metric group_by=tool_name time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **rejected_metric group_by=ticket_priority time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **rejected_metric group_by=ticket_status time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **rejected_metric group_by=queue_name time=last_7d** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused
- **reopen_rate group_by=- time=all_time** (agent 1028 admin): `RETRYABLE` context layer semantic unavailable: [Errno 61] Connection refused

## Mismatches (CL vs Postgres)


- **accounts_served group_by=- time=all_time** (agent 1028 admin): CL `0.0` vs DB `1501`
- **accounts_served group_by=- time=last_7d** (agent 1028 admin): CL `0.0` vs DB `117`
- **accounts_served group_by=- time=last_30d** (agent 1028 admin): CL `0.0` vs DB `517`
- **accounts_served group_by=status_display_name time=last_7d** (agent 1028 admin): CL `0.0` vs DB `117`
- **accounts_served group_by=is_closed_by_status time=last_7d** (agent 1028 admin): CL `0.0` vs DB `117`
- **accounts_served group_by=skill time=last_7d** (agent 1028 admin): CL `0.0` vs DB `117`
- **accounts_served group_by=assignee_role time=last_7d** (agent 1028 admin): CL `0.0` vs DB `117`
- **accounts_served group_by=queue_type time=last_7d** (agent 1028 admin): CL `0.0` vs DB `117`
- **accounts_served group_by=account_name time=last_7d** (agent 1028 admin): CL `0.0` vs DB `117`
- **accounts_served group_by=organization_name time=last_7d** (agent 1028 admin): CL `0.0` vs DB `117`
- **accounts_served group_by=organization_business_type time=last_7d** (agent 1028 admin): CL `0.0` vs DB `117`
- **accounts_served group_by=team_supports_ticketing time=last_7d** (agent 1028 admin): CL `0.0` vs DB `117`
- **accounts_served group_by=has_assignee time=last_7d** (agent 1028 admin): CL `0.0` vs DB `117`
- **accounts_served group_by=has_resolver time=last_7d** (agent 1028 admin): CL `0.0` vs DB `117`
- **accounts_served group_by=has_first_response time=last_7d** (agent 1028 admin): CL `0.0` vs DB `117`
- **accounts_served group_by=has_csat_rating time=last_7d** (agent 1028 admin): CL `0.0` vs DB `117`
- **accounts_served group_by=is_overdue time=last_7d** (agent 1028 admin): CL `0.0` vs DB `117`
- **active_tickets_metric group_by=- time=all_time** (agent 1028 admin): CL `2.0` vs DB `904`
- **active_tickets_metric group_by=- time=last_7d** (agent 1028 admin): CL `2.0` vs DB `70`
- **active_tickets_metric group_by=- time=last_30d** (agent 1028 admin): CL `2.0` vs DB `302`
- **active_tickets_metric group_by=status_display_name time=last_7d** (agent 1028 admin): CL `0.0` vs DB `70`
- **active_tickets_metric group_by=is_closed_by_status time=last_7d** (agent 1028 admin): CL `2.0` vs DB `70`
- **active_tickets_metric group_by=skill time=last_7d** (agent 1028 admin): CL `2.0` vs DB `70`
- **active_tickets_metric group_by=assignee_role time=last_7d** (agent 1028 admin): CL `2.0` vs DB `70`
- **active_tickets_metric group_by=queue_type time=last_7d** (agent 1028 admin): CL `2.0` vs DB `70`
- **active_tickets_metric group_by=account_name time=last_7d** (agent 1028 admin): CL `2.0` vs DB `70`
- **active_tickets_metric group_by=organization_name time=last_7d** (agent 1028 admin): CL `2.0` vs DB `70`
- **active_tickets_metric group_by=organization_business_type time=last_7d** (agent 1028 admin): CL `2.0` vs DB `70`
- **active_tickets_metric group_by=team_supports_ticketing time=last_7d** (agent 1028 admin): CL `2.0` vs DB `70`
- **active_tickets_metric group_by=has_assignee time=last_7d** (agent 1028 admin): CL `2.0` vs DB `70`
- **active_tickets_metric group_by=has_resolver time=last_7d** (agent 1028 admin): CL `2.0` vs DB `70`
- **active_tickets_metric group_by=has_first_response time=last_7d** (agent 1028 admin): CL `2.0` vs DB `70`
- **active_tickets_metric group_by=has_csat_rating time=last_7d** (agent 1028 admin): CL `2.0` vs DB `70`
- **active_tickets_metric group_by=is_overdue time=last_7d** (agent 1028 admin): CL `2.0` vs DB `70`
- **approval_volume group_by=- time=all_time** (agent 1028 admin): CL `1350.0` vs DB `1501`
- **approval_volume group_by=- time=today** (agent 1028 admin): CL `12.0` vs DB `0`
- **approval_volume group_by=- time=last_7d** (agent 1028 admin): CL `1350.0` vs DB `117`
- **approval_volume group_by=- time=last_30d** (agent 1028 admin): CL `1350.0` vs DB `517`
- **approval_volume group_by=agent_id time=last_7d** (agent 1028 admin): CL `140.0` vs DB `117`
- **approval_volume group_by=tool_name time=last_7d** (agent 1028 admin): CL `140.0` vs DB `117`
- **approval_volume group_by=ticket_priority time=last_7d** (agent 1028 admin): CL `288.0` vs DB `117`
- **approval_volume group_by=ticket_status time=last_7d** (agent 1028 admin): CL `1085.0` vs DB `117`
- **assigned_tickets_metric group_by=status_display_name time=last_7d** (agent 1028 admin): CL `21.0` vs DB `117`
- **assigned_tickets_metric group_by=is_closed_by_status time=last_7d** (agent 1028 admin): CL `96.0` vs DB `117`
- **assigned_tickets_metric group_by=has_first_response time=last_7d** (agent 1028 admin): CL `12.0` vs DB `117`
- **assigned_tickets_metric group_by=has_csat_rating time=last_7d** (agent 1028 admin): CL `81.0` vs DB `117`
- **assigned_tickets_metric group_by=is_overdue time=last_7d** (agent 1028 admin): CL `53.0` vs DB `117`
- **audit_event_volume group_by=- time=all_time** (agent 1028 admin): CL `1663.0` vs DB `1501`
- **audit_event_volume group_by=- time=today** (agent 1028 admin): CL `5.0` vs DB `0`
- **audit_event_volume group_by=- time=last_7d** (agent 1028 admin): CL `279.0` vs DB `117`
- **audit_event_volume group_by=- time=last_30d** (agent 1028 admin): CL `679.0` vs DB `517`
- **audit_event_volume group_by=action time=last_7d** (agent 1028 admin): CL `2.0` vs DB `117`
- **audit_event_volume group_by=ticket_priority time=last_7d** (agent 1028 admin): CL `95.0` vs DB `117`
- **audit_event_volume group_by=ticket_status time=last_7d** (agent 1028 admin): CL `21.0` vs DB `117`
- **audit_event_volume group_by=actor_name time=last_7d** (agent 1028 admin): CL `1.0` vs DB `117`
- **average_open_ticket_age_days group_by=- time=all_time** (agent 1028 admin): CL `1.0338796799074075` vs DB `904`
- **average_open_ticket_age_days group_by=- time=today** (agent 1028 admin): CL `24.0` vs DB `0`
- **average_open_ticket_age_days group_by=- time=last_7d** (agent 1028 admin): CL `1.033983232662037` vs DB `70`
- **average_open_ticket_age_days group_by=- time=last_30d** (agent 1028 admin): CL `1.034029565162037` vs DB `302`
- **average_overdue_hours group_by=- time=all_time** (agent 1028 admin): CL `50.90433303066305` vs DB `898`
- **average_overdue_hours group_by=- time=today** (agent 1028 admin): CL `24.0` vs DB `0`
- **average_overdue_hours group_by=- time=last_7d** (agent 1028 admin): CL `42.17955421626984` vs DB `64`
- **average_overdue_hours group_by=- time=last_30d** (agent 1028 admin): CL `53.54955258058985` vs DB `296`
- **average_overdue_hours group_by=status_display_name time=last_7d** (agent 1028 admin): CL `39.90398849206349` vs DB `64`
- **average_overdue_hours group_by=is_closed_by_status time=last_7d** (agent 1028 admin): CL `44.45511994047619` vs DB `64`
- **average_overdue_hours group_by=skill time=last_7d** (agent 1028 admin): CL `42.17955421626984` vs DB `64`
- **average_overdue_hours group_by=assignee_role time=last_7d** (agent 1028 admin): CL `42.17955421626984` vs DB `64`
- **average_overdue_hours group_by=queue_type time=last_7d** (agent 1028 admin): CL `42.17955421626984` vs DB `64`
- **average_overdue_hours group_by=account_name time=last_7d** (agent 1028 admin): CL `42.17955421626984` vs DB `64`
- **average_overdue_hours group_by=organization_name time=last_7d** (agent 1028 admin): CL `42.17955421626984` vs DB `64`
- **average_overdue_hours group_by=organization_business_type time=last_7d** (agent 1028 admin): CL `42.17955421626984` vs DB `64`
- **average_overdue_hours group_by=team_supports_ticketing time=last_7d** (agent 1028 admin): CL `42.17955421626984` vs DB `64`
- **average_overdue_hours group_by=has_assignee time=last_7d** (agent 1028 admin): CL `42.17955421626984` vs DB `64`
- **average_overdue_hours group_by=has_resolver time=last_7d** (agent 1028 admin): CL `42.17955421626984` vs DB `64`
- **average_overdue_hours group_by=has_first_response time=last_7d** (agent 1028 admin): CL `42.17955421626984` vs DB `64`
- **average_overdue_hours group_by=has_csat_rating time=last_7d** (agent 1028 admin): CL `32.95984186507936` vs DB `64`
- **average_overdue_hours group_by=is_overdue time=last_7d** (agent 1028 admin): CL `42.17955421626984` vs DB `64`
- **average_resolution_hours_variance group_by=- time=all_time** (agent 1028 admin): CL `49.31638382654011` vs DB `76.51906389354178`
- **average_resolution_hours_variance group_by=- time=last_7d** (agent 1028 admin): CL `27.954917966903075` vs DB `56.12513073286052`
- **average_resolution_hours_variance group_by=- time=last_30d** (agent 1028 admin): CL `47.43200532299742` vs DB `74.40874950904393`
- **average_resolution_time_hours group_by=- time=last_7d** (agent 1028 admin): CL `68.05316636225267` vs DB `56.12513073286052`
- **breached_tickets_metric group_by=- time=all_time** (agent 1028 admin): CL `781.0` vs DB `898`
- **breached_tickets_metric group_by=- time=last_7d** (agent 1028 admin): CL `55.0` vs DB `64`
- **breached_tickets_metric group_by=- time=last_30d** (agent 1028 admin): CL `266.0` vs DB `296`
- **breached_tickets_metric group_by=status_display_name time=last_7d** (agent 1028 admin): CL `0.0` vs DB `64`
- **breached_tickets_metric group_by=is_closed_by_status time=last_7d** (agent 1028 admin): CL `55.0` vs DB `64`
- **breached_tickets_metric group_by=skill time=last_7d** (agent 1028 admin): CL `55.0` vs DB `64`
- **breached_tickets_metric group_by=assignee_role time=last_7d** (agent 1028 admin): CL `55.0` vs DB `64`
- **breached_tickets_metric group_by=queue_type time=last_7d** (agent 1028 admin): CL `55.0` vs DB `64`
- **breached_tickets_metric group_by=account_name time=last_7d** (agent 1028 admin): CL `55.0` vs DB `64`
- **breached_tickets_metric group_by=organization_name time=last_7d** (agent 1028 admin): CL `55.0` vs DB `64`
- **breached_tickets_metric group_by=organization_business_type time=last_7d** (agent 1028 admin): CL `55.0` vs DB `64`
- **breached_tickets_metric group_by=team_supports_ticketing time=last_7d** (agent 1028 admin): CL `55.0` vs DB `64`
- **breached_tickets_metric group_by=has_assignee time=last_7d** (agent 1028 admin): CL `55.0` vs DB `64`
- **breached_tickets_metric group_by=has_resolver time=last_7d** (agent 1028 admin): CL `55.0` vs DB `64`
- **breached_tickets_metric group_by=has_first_response time=last_7d** (agent 1028 admin): CL `10.0` vs DB `64`
- **breached_tickets_metric group_by=has_csat_rating time=last_7d** (agent 1028 admin): CL `55.0` vs DB `64`
- **breached_tickets_metric group_by=is_overdue time=last_7d** (agent 1028 admin): CL `0.0` vs DB `64`
- **closed_tickets_metric group_by=- time=all_time** (agent 1028 admin): CL `597.0` vs DB `274`
- **closed_tickets_metric group_by=- time=last_7d** (agent 1028 admin): CL `47.0` vs DB `21`
- **closed_tickets_metric group_by=- time=last_30d** (agent 1028 admin): CL `215.0` vs DB `105`
- **closed_tickets_metric group_by=is_closed_by_status time=last_7d** (agent 1028 admin): CL `26.0` vs DB `21`
- **closed_tickets_metric group_by=skill time=last_7d** (agent 1028 admin): CL `47.0` vs DB `21`
- **closed_tickets_metric group_by=assignee_role time=last_7d** (agent 1028 admin): CL `47.0` vs DB `21`
- **closed_tickets_metric group_by=queue_type time=last_7d** (agent 1028 admin): CL `47.0` vs DB `21`
- **closed_tickets_metric group_by=account_name time=last_7d** (agent 1028 admin): CL `47.0` vs DB `21`
- **closed_tickets_metric group_by=organization_name time=last_7d** (agent 1028 admin): CL `47.0` vs DB `21`
- **closed_tickets_metric group_by=organization_business_type time=last_7d** (agent 1028 admin): CL `47.0` vs DB `21`
- **closed_tickets_metric group_by=team_supports_ticketing time=last_7d** (agent 1028 admin): CL `47.0` vs DB `21`
- **closed_tickets_metric group_by=has_assignee time=last_7d** (agent 1028 admin): CL `47.0` vs DB `21`
- **closed_tickets_metric group_by=has_resolver time=last_7d** (agent 1028 admin): CL `47.0` vs DB `21`
- **closed_tickets_metric group_by=has_first_response time=last_7d** (agent 1028 admin): CL `0.0` vs DB `21`
- **closed_tickets_metric group_by=has_csat_rating time=last_7d** (agent 1028 admin): CL `11.0` vs DB `21`
- **closed_tickets_metric group_by=is_overdue time=last_7d** (agent 1028 admin): CL `47.0` vs DB `21`
- **csat_detractor_metric group_by=status_display_name time=last_7d** (agent 1028 admin): CL `4.0` vs DB `6`
- **csat_detractor_metric group_by=is_closed_by_status time=last_7d** (agent 1028 admin): CL `2.0` vs DB `6`
- **csat_detractor_metric group_by=has_first_response time=last_7d** (agent 1028 admin): CL `0.0` vs DB `6`
- **csat_detractor_metric group_by=has_csat_rating time=last_7d** (agent 1028 admin): CL `0.0` vs DB `6`
- **csat_neutral_metric group_by=status_display_name time=last_7d** (agent 1028 admin): CL `3.0` vs DB `6`
- **csat_neutral_metric group_by=is_closed_by_status time=last_7d** (agent 1028 admin): CL `3.0` vs DB `6`

## How to overcome

- Use date-only `time.start` / `time.end` (`YYYY-MM-DD`). Full ISO timestamps broke Context Layer SQL.
- UNMAPPED metrics need a certified warehouse SQL definition before CL can be SoT.
- Customer/team/status/priority lists need a warehouse entityHint; ticket-only SQL will error or GAP.
- Agent/resolver rows must stay scoped to assignee/resolver id; extra ticket numbers are RBAC leaks.
- Add `ask_sql_layer` to `shared/ticketing_tool_catalog.json` so MCP clients can discover it.

## All queries

| kind | agent | role | query | status | CL | DB |
|---|---|---|---|---|---|---|
| semantic | 1028 | admin | accepted_recommendations_metric group_by=- time=all_time | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | accepted_recommendations_metric group_by=- time=today | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | accepted_recommendations_metric group_by=- time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | accepted_recommendations_metric group_by=- time=last_30d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | accepted_recommendations_metric group_by=agent_id time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | accepted_recommendations_metric group_by=status time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | accepted_recommendations_metric group_by=ticket_priority time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | accepted_recommendations_metric group_by=ticket_status time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | accepted_recommendations_metric group_by=queue_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | accounts_served group_by=- time=all_time | MISMATCH | 0.0 | 1501 |
| semantic | 1028 | admin | accounts_served group_by=- time=today | PASS | 0.0 | 0 |
| semantic | 1028 | admin | accounts_served group_by=- time=last_7d | MISMATCH | 0.0 | 117 |
| semantic | 1028 | admin | accounts_served group_by=- time=last_30d | MISMATCH | 0.0 | 517 |
| semantic | 1028 | admin | accounts_served group_by=status time=last_7d | PASS | 0.0 | 6 buckets |
| semantic | 1028 | admin | accounts_served group_by=status_display_name time=last_7d | MISMATCH | 0.0 | 117 |
| semantic | 1028 | admin | accounts_served group_by=is_closed_by_status time=last_7d | MISMATCH | 0.0 | 117 |
| semantic | 1028 | admin | accounts_served group_by=priority time=last_7d | PASS | 0.0 | 4 buckets |
| semantic | 1028 | admin | accounts_served group_by=channel time=last_7d | PASS | 0.0 | 4 buckets |
| semantic | 1028 | admin | accounts_served group_by=category time=last_7d | PASS | 0.0 | 40 buckets |
| semantic | 1028 | admin | accounts_served group_by=skill time=last_7d | MISMATCH | 0.0 | 117 |
| semantic | 1028 | admin | accounts_served group_by=assignee_name time=last_7d | PASS | 0.0 | 3 buckets |
| semantic | 1028 | admin | accounts_served group_by=assignee_role time=last_7d | MISMATCH | 0.0 | 117 |
| semantic | 1028 | admin | accounts_served group_by=resolver_name time=last_7d | PASS | 0.0 | 4 buckets |
| semantic | 1028 | admin | accounts_served group_by=queue_name time=last_7d | PASS | 0.0 | 7 buckets |
| semantic | 1028 | admin | accounts_served group_by=queue_type time=last_7d | MISMATCH | 0.0 | 117 |
| semantic | 1028 | admin | accounts_served group_by=account_name time=last_7d | MISMATCH | 0.0 | 117 |
| semantic | 1028 | admin | accounts_served group_by=organization_name time=last_7d | MISMATCH | 0.0 | 117 |
| semantic | 1028 | admin | accounts_served group_by=organization_business_type time=last_7d | MISMATCH | 0.0 | 117 |
| semantic | 1028 | admin | accounts_served group_by=team_supports_ticketing time=last_7d | MISMATCH | 0.0 | 117 |
| semantic | 1028 | admin | accounts_served group_by=created_by_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | accounts_served group_by=customer_name time=last_7d | PASS | 0.0 | 112 buckets |
| semantic | 1028 | admin | accounts_served group_by=has_assignee time=last_7d | MISMATCH | 0.0 | 117 |
| semantic | 1028 | admin | accounts_served group_by=has_resolver time=last_7d | MISMATCH | 0.0 | 117 |
| semantic | 1028 | admin | accounts_served group_by=has_first_response time=last_7d | MISMATCH | 0.0 | 117 |
| semantic | 1028 | admin | accounts_served group_by=has_csat_rating time=last_7d | MISMATCH | 0.0 | 117 |
| semantic | 1028 | admin | accounts_served group_by=is_overdue time=last_7d | MISMATCH | 0.0 | 117 |
| semantic | 1028 | admin | active_agents_metric group_by=- time=all_time | UNMAPPED | 3.0 | None |
| semantic | 1028 | admin | active_agents_metric group_by=- time=today | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | active_agents_metric group_by=- time=last_7d | UNMAPPED | 3.0 | None |
| semantic | 1028 | admin | active_agents_metric group_by=- time=last_30d | UNMAPPED | 3.0 | None |
| semantic | 1028 | admin | active_agents_metric group_by=role time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | active_agents_metric group_by=status time=last_7d | UNMAPPED | 3.0 | None |
| semantic | 1028 | admin | active_customers_metric group_by=- time=all_time | UNMAPPED | 1000.0 | None |
| semantic | 1028 | admin | active_customers_metric group_by=- time=today | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | active_customers_metric group_by=- time=last_7d | UNMAPPED | 1000.0 | None |
| semantic | 1028 | admin | active_customers_metric group_by=- time=last_30d | UNMAPPED | 1000.0 | None |
| semantic | 1028 | admin | active_customers_metric group_by=status time=last_7d | UNMAPPED | 1000.0 | None |
| semantic | 1028 | admin | active_tickets_metric group_by=- time=all_time | MISMATCH | 2.0 | 904 |
| semantic | 1028 | admin | active_tickets_metric group_by=- time=today | PASS | 0.0 | 0 |
| semantic | 1028 | admin | active_tickets_metric group_by=- time=last_7d | MISMATCH | 2.0 | 70 |
| semantic | 1028 | admin | active_tickets_metric group_by=- time=last_30d | MISMATCH | 2.0 | 302 |
| semantic | 1028 | admin | active_tickets_metric group_by=status time=last_7d | PASS | 0.0 | 6 buckets |
| semantic | 1028 | admin | active_tickets_metric group_by=status_display_name time=last_7d | MISMATCH | 0.0 | 70 |
| semantic | 1028 | admin | active_tickets_metric group_by=is_closed_by_status time=last_7d | MISMATCH | 2.0 | 70 |
| semantic | 1028 | admin | active_tickets_metric group_by=priority time=last_7d | PASS | 1.0 | 4 buckets |
| semantic | 1028 | admin | active_tickets_metric group_by=channel time=last_7d | PASS | 0.0 | 4 buckets |
| semantic | 1028 | admin | active_tickets_metric group_by=category time=last_7d | PASS | 0.0 | 40 buckets |
| semantic | 1028 | admin | active_tickets_metric group_by=skill time=last_7d | MISMATCH | 2.0 | 70 |
| semantic | 1028 | admin | active_tickets_metric group_by=assignee_name time=last_7d | PASS | 1.0 | 3 buckets |
| semantic | 1028 | admin | active_tickets_metric group_by=assignee_role time=last_7d | MISMATCH | 2.0 | 70 |
| semantic | 1028 | admin | active_tickets_metric group_by=resolver_name time=last_7d | PASS | 2.0 | 4 buckets |
| semantic | 1028 | admin | active_tickets_metric group_by=queue_name time=last_7d | PASS | 0.0 | 7 buckets |
| semantic | 1028 | admin | active_tickets_metric group_by=queue_type time=last_7d | MISMATCH | 2.0 | 70 |
| semantic | 1028 | admin | active_tickets_metric group_by=account_name time=last_7d | MISMATCH | 2.0 | 70 |
| semantic | 1028 | admin | active_tickets_metric group_by=organization_name time=last_7d | MISMATCH | 2.0 | 70 |
| semantic | 1028 | admin | active_tickets_metric group_by=organization_business_type time=last_7d | MISMATCH | 2.0 | 70 |
| semantic | 1028 | admin | active_tickets_metric group_by=team_supports_ticketing time=last_7d | MISMATCH | 2.0 | 70 |
| semantic | 1028 | admin | active_tickets_metric group_by=created_by_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | active_tickets_metric group_by=customer_name time=last_7d | PASS | 0.0 | 112 buckets |
| semantic | 1028 | admin | active_tickets_metric group_by=has_assignee time=last_7d | MISMATCH | 2.0 | 70 |
| semantic | 1028 | admin | active_tickets_metric group_by=has_resolver time=last_7d | MISMATCH | 2.0 | 70 |
| semantic | 1028 | admin | active_tickets_metric group_by=has_first_response time=last_7d | MISMATCH | 2.0 | 70 |
| semantic | 1028 | admin | active_tickets_metric group_by=has_csat_rating time=last_7d | MISMATCH | 2.0 | 70 |
| semantic | 1028 | admin | active_tickets_metric group_by=is_overdue time=last_7d | MISMATCH | 2.0 | 70 |
| semantic | 1028 | admin | approval_rate group_by=- time=all_time | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | approval_rate group_by=- time=today | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | approval_rate group_by=- time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | approval_rate group_by=- time=last_30d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | approval_rate group_by=agent_id time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | approval_rate group_by=status time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | approval_rate group_by=tool_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | approval_rate group_by=ticket_priority time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | approval_rate group_by=ticket_status time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | approval_rate group_by=queue_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | approval_volume group_by=- time=all_time | MISMATCH | 1350.0 | 1501 |
| semantic | 1028 | admin | approval_volume group_by=- time=today | MISMATCH | 12.0 | 0 |
| semantic | 1028 | admin | approval_volume group_by=- time=last_7d | MISMATCH | 1350.0 | 117 |
| semantic | 1028 | admin | approval_volume group_by=- time=last_30d | MISMATCH | 1350.0 | 517 |
| semantic | 1028 | admin | approval_volume group_by=agent_id time=last_7d | MISMATCH | 140.0 | 117 |
| semantic | 1028 | admin | approval_volume group_by=status time=last_7d | PASS | 1350.0 | 6 buckets |
| semantic | 1028 | admin | approval_volume group_by=tool_name time=last_7d | MISMATCH | 140.0 | 117 |
| semantic | 1028 | admin | approval_volume group_by=ticket_priority time=last_7d | MISMATCH | 288.0 | 117 |
| semantic | 1028 | admin | approval_volume group_by=ticket_status time=last_7d | MISMATCH | 1085.0 | 117 |
| semantic | 1028 | admin | approval_volume group_by=queue_name time=last_7d | PASS | 87.0 | 7 buckets |
| semantic | 1028 | admin | approved_metric group_by=- time=all_time | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | approved_metric group_by=- time=today | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | approved_metric group_by=- time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | approved_metric group_by=- time=last_30d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | approved_metric group_by=agent_id time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | approved_metric group_by=status time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | approved_metric group_by=tool_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | approved_metric group_by=ticket_priority time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | approved_metric group_by=ticket_status time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | approved_metric group_by=queue_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | assigned_tickets_metric group_by=- time=all_time | PASS | 1501.0 | 1501 |
| semantic | 1028 | admin | assigned_tickets_metric group_by=- time=today | PASS | 0.0 | 0 |
| semantic | 1028 | admin | assigned_tickets_metric group_by=- time=last_7d | PASS | 117.0 | 117 |
| semantic | 1028 | admin | assigned_tickets_metric group_by=- time=last_30d | PASS | 517.0 | 517 |
| semantic | 1028 | admin | assigned_tickets_metric group_by=status time=last_7d | PASS | 21.0 | 6 buckets |
| semantic | 1028 | admin | assigned_tickets_metric group_by=status_display_name time=last_7d | MISMATCH | 21.0 | 117 |
| semantic | 1028 | admin | assigned_tickets_metric group_by=is_closed_by_status time=last_7d | MISMATCH | 96.0 | 117 |
| semantic | 1028 | admin | assigned_tickets_metric group_by=priority time=last_7d | PASS | 41.0 | 4 buckets |
| semantic | 1028 | admin | assigned_tickets_metric group_by=channel time=last_7d | PASS | 20.0 | 4 buckets |
| semantic | 1028 | admin | assigned_tickets_metric group_by=category time=last_7d | PASS | 1.0 | 40 buckets |
| semantic | 1028 | admin | assigned_tickets_metric group_by=skill time=last_7d | PASS | 117.0 | 117 |
| semantic | 1028 | admin | assigned_tickets_metric group_by=assignee_name time=last_7d | PASS | 56.0 | 3 buckets |
| semantic | 1028 | admin | assigned_tickets_metric group_by=assignee_role time=last_7d | PASS | 117.0 | 117 |
| semantic | 1028 | admin | assigned_tickets_metric group_by=resolver_name time=last_7d | PASS | 43.0 | 4 buckets |
| semantic | 1028 | admin | assigned_tickets_metric group_by=queue_name time=last_7d | PASS | 15.0 | 7 buckets |
| semantic | 1028 | admin | assigned_tickets_metric group_by=queue_type time=last_7d | PASS | 117.0 | 117 |
| semantic | 1028 | admin | assigned_tickets_metric group_by=account_name time=last_7d | PASS | 117.0 | 117 |
| semantic | 1028 | admin | assigned_tickets_metric group_by=organization_name time=last_7d | PASS | 117.0 | 117 |
| semantic | 1028 | admin | assigned_tickets_metric group_by=organization_business_type time=last_7d | PASS | 117.0 | 117 |
| semantic | 1028 | admin | assigned_tickets_metric group_by=team_supports_ticketing time=last_7d | PASS | 117.0 | 117 |
| semantic | 1028 | admin | assigned_tickets_metric group_by=created_by_name time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | assigned_tickets_metric group_by=customer_name time=last_7d | PASS | 1.0 | 112 buckets |
| semantic | 1028 | admin | assigned_tickets_metric group_by=has_assignee time=last_7d | PASS | 117.0 | 117 |
| semantic | 1028 | admin | assigned_tickets_metric group_by=has_resolver time=last_7d | PASS | 117.0 | 117 |
| semantic | 1028 | admin | assigned_tickets_metric group_by=has_first_response time=last_7d | MISMATCH | 12.0 | 117 |
| semantic | 1028 | admin | assigned_tickets_metric group_by=has_csat_rating time=last_7d | MISMATCH | 81.0 | 117 |
| semantic | 1028 | admin | assigned_tickets_metric group_by=is_overdue time=last_7d | MISMATCH | 53.0 | 117 |
| semantic | 1028 | admin | assignment_rate group_by=- time=all_time | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | assignment_rate group_by=- time=today | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | assignment_rate group_by=- time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | assignment_rate group_by=- time=last_30d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | assignment_rate group_by=status time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | assignment_rate group_by=status_display_name time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | assignment_rate group_by=is_closed_by_status time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | assignment_rate group_by=priority time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | assignment_rate group_by=channel time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | assignment_rate group_by=category time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | assignment_rate group_by=skill time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | assignment_rate group_by=assignee_name time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | assignment_rate group_by=assignee_role time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | assignment_rate group_by=resolver_name time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | assignment_rate group_by=queue_name time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | assignment_rate group_by=queue_type time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | assignment_rate group_by=account_name time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | assignment_rate group_by=organization_name time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | assignment_rate group_by=organization_business_type time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | assignment_rate group_by=team_supports_ticketing time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | assignment_rate group_by=created_by_name time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | assignment_rate group_by=customer_name time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | assignment_rate group_by=has_assignee time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | assignment_rate group_by=has_resolver time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | assignment_rate group_by=has_first_response time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | assignment_rate group_by=has_csat_rating time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | assignment_rate group_by=is_overdue time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | audit_event_volume group_by=- time=all_time | MISMATCH | 1663.0 | 1501 |
| semantic | 1028 | admin | audit_event_volume group_by=- time=today | MISMATCH | 5.0 | 0 |
| semantic | 1028 | admin | audit_event_volume group_by=- time=last_7d | MISMATCH | 279.0 | 117 |
| semantic | 1028 | admin | audit_event_volume group_by=- time=last_30d | MISMATCH | 679.0 | 517 |
| semantic | 1028 | admin | audit_event_volume group_by=action time=last_7d | MISMATCH | 2.0 | 117 |
| semantic | 1028 | admin | audit_event_volume group_by=ticket_priority time=last_7d | MISMATCH | 95.0 | 117 |
| semantic | 1028 | admin | audit_event_volume group_by=ticket_status time=last_7d | MISMATCH | 21.0 | 117 |
| semantic | 1028 | admin | audit_event_volume group_by=queue_name time=last_7d | PASS | 25.0 | 7 buckets |
| semantic | 1028 | admin | audit_event_volume group_by=assignee_name time=last_7d | PASS | 112.0 | 3 buckets |
| semantic | 1028 | admin | audit_event_volume group_by=actor_name time=last_7d | MISMATCH | 1.0 | 117 |
| semantic | 1028 | admin | average_csat_score group_by=- time=all_time | PASS | 3.834763948497854 | 3.834763948497854 |
| semantic | 1028 | admin | average_csat_score group_by=- time=today | UNMAPPED | 3.5 | None |
| semantic | 1028 | admin | average_csat_score group_by=- time=last_7d | PASS | 3.7777777777777777 | 3.7777777777777777 |
| semantic | 1028 | admin | average_csat_score group_by=- time=last_30d | PASS | 3.788235294117647 | 3.788235294117647 |
| semantic | 1028 | admin | average_csat_score group_by=queue_name time=last_7d | PASS | 4.0 | 7 buckets |
| semantic | 1028 | admin | average_csat_score group_by=agent_name time=last_7d | FALLBACK_PASS | 3.834763948497854 | 3.7777777777777777 |
| semantic | 1028 | admin | average_decision_hours group_by=- time=all_time | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | average_decision_hours group_by=- time=today | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | average_decision_hours group_by=- time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | average_decision_hours group_by=- time=last_30d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | average_first_response_hours group_by=- time=all_time | PASS | 11.222629041959754 | 11.222629041959754 |
| semantic | 1028 | admin | average_first_response_hours group_by=- time=today | UNMAPPED | 24.0 | None |
| semantic | 1028 | admin | average_first_response_hours group_by=- time=last_7d | PASS | 10.60957570345238 | 10.60957570345238 |
| semantic | 1028 | admin | average_first_response_hours group_by=- time=last_30d | PASS | 11.202971350660677 | 11.202971350660677 |
| semantic | 1028 | admin | average_first_response_minutes group_by=- time=all_time | PASS | 673.3577425175852 | 673.3577425175852 |
| semantic | 1028 | admin | average_first_response_minutes group_by=- time=today | UNMAPPED | 300.0 | None |
| semantic | 1028 | admin | average_first_response_minutes group_by=- time=last_7d | PASS | 636.5745422071428 | 636.5745422071428 |
| semantic | 1028 | admin | average_first_response_minutes group_by=- time=last_30d | PASS | 672.1782810396406 | 672.1782810396406 |
| semantic | 1028 | admin | average_notes_per_ticket group_by=- time=all_time | UNMAPPED | 0.1039307128580946 | None |
| semantic | 1028 | admin | average_notes_per_ticket group_by=- time=today | UNMAPPED | 300.0 | None |
| semantic | 1028 | admin | average_notes_per_ticket group_by=- time=last_7d | UNMAPPED | 1.3333333333333333 | None |
| semantic | 1028 | admin | average_notes_per_ticket group_by=- time=last_30d | UNMAPPED | 0.30174081237911027 | None |
| semantic | 1028 | admin | average_notes_per_ticket group_by=status time=last_7d | UNMAPPED | 2.8363636363636364 | None |
| semantic | 1028 | admin | average_notes_per_ticket group_by=status_display_name time=last_7d | UNMAPPED | 2.8363636363636364 | None |
| semantic | 1028 | admin | average_notes_per_ticket group_by=is_closed_by_status time=last_7d | UNMAPPED | 1.625 | None |
| semantic | 1028 | admin | average_notes_per_ticket group_by=priority time=last_7d | UNMAPPED | 1.2195121951219512 | None |
| semantic | 1028 | admin | average_notes_per_ticket group_by=channel time=last_7d | UNMAPPED | 1.95 | None |
| semantic | 1028 | admin | average_notes_per_ticket group_by=category time=last_7d | UNMAPPED | 5.0 | None |
| semantic | 1028 | admin | average_notes_per_ticket group_by=skill time=last_7d | UNMAPPED | 1.3333333333333333 | None |
| semantic | 1028 | admin | average_notes_per_ticket group_by=assignee_name time=last_7d | UNMAPPED | 0.9285714285714286 | None |
| semantic | 1028 | admin | average_notes_per_ticket group_by=assignee_role time=last_7d | UNMAPPED | 1.3333333333333333 | None |
| semantic | 1028 | admin | average_notes_per_ticket group_by=resolver_name time=last_7d | UNMAPPED | 1.5813953488372092 | None |
| semantic | 1028 | admin | average_notes_per_ticket group_by=queue_name time=last_7d | UNMAPPED | 0.6666666666666666 | None |
| semantic | 1028 | admin | average_notes_per_ticket group_by=queue_type time=last_7d | UNMAPPED | 1.3333333333333333 | None |
| semantic | 1028 | admin | average_notes_per_ticket group_by=account_name time=last_7d | UNMAPPED | 1.3333333333333333 | None |
| semantic | 1028 | admin | average_notes_per_ticket group_by=organization_name time=last_7d | UNMAPPED | 1.3333333333333333 | None |
| semantic | 1028 | admin | average_notes_per_ticket group_by=organization_business_type time=last_7d | UNMAPPED | 1.3333333333333333 | None |
| semantic | 1028 | admin | average_notes_per_ticket group_by=team_supports_ticketing time=last_7d | UNMAPPED | 1.3333333333333333 | None |
| semantic | 1028 | admin | average_notes_per_ticket group_by=created_by_name time=last_7d | UNMAPPED | 300.0 | None |
| semantic | 1028 | admin | average_notes_per_ticket group_by=customer_name time=last_7d | UNMAPPED | 300.0 | None |
| semantic | 1028 | admin | average_notes_per_ticket group_by=has_assignee time=last_7d | UNMAPPED | 1.3333333333333333 | None |
| semantic | 1028 | admin | average_notes_per_ticket group_by=has_resolver time=last_7d | UNMAPPED | 1.3333333333333333 | None |
| semantic | 1028 | admin | average_notes_per_ticket group_by=has_first_response time=last_7d | UNMAPPED | 1.3333333333333333 | None |
| semantic | 1028 | admin | average_notes_per_ticket group_by=has_csat_rating time=last_7d | UNMAPPED | 1.9259259259259258 | None |
| semantic | 1028 | admin | average_notes_per_ticket group_by=is_overdue time=last_7d | UNMAPPED | 2.4375 | None |
| semantic | 1028 | admin | average_open_ticket_age_days group_by=- time=all_time | MISMATCH | 1.0338796799074075 | 904 |
| semantic | 1028 | admin | average_open_ticket_age_days group_by=- time=today | MISMATCH | 24.0 | 0 |
| semantic | 1028 | admin | average_open_ticket_age_days group_by=- time=last_7d | MISMATCH | 1.033983232662037 | 70 |
| semantic | 1028 | admin | average_open_ticket_age_days group_by=- time=last_30d | MISMATCH | 1.034029565162037 | 302 |
| semantic | 1028 | admin | average_overdue_hours group_by=- time=all_time | MISMATCH | 50.90433303066305 | 898 |
| semantic | 1028 | admin | average_overdue_hours group_by=- time=today | MISMATCH | 24.0 | 0 |
| semantic | 1028 | admin | average_overdue_hours group_by=- time=last_7d | MISMATCH | 42.17955421626984 | 64 |
| semantic | 1028 | admin | average_overdue_hours group_by=- time=last_30d | MISMATCH | 53.54955258058985 | 296 |
| semantic | 1028 | admin | average_overdue_hours group_by=status time=last_7d | PASS | 39.90398849206349 | 6 buckets |
| semantic | 1028 | admin | average_overdue_hours group_by=status_display_name time=last_7d | MISMATCH | 39.90398849206349 | 64 |
| semantic | 1028 | admin | average_overdue_hours group_by=is_closed_by_status time=last_7d | MISMATCH | 44.45511994047619 | 64 |
| semantic | 1028 | admin | average_overdue_hours group_by=priority time=last_7d | PASS | 51.60506188271605 | 4 buckets |
| semantic | 1028 | admin | average_overdue_hours group_by=channel time=last_7d | PASS | 53.46576423611111 | 4 buckets |
| semantic | 1028 | admin | average_overdue_hours group_by=category time=last_7d | PASS | 69.0 | 40 buckets |
| semantic | 1028 | admin | average_overdue_hours group_by=skill time=last_7d | MISMATCH | 42.17955421626984 | 64 |
| semantic | 1028 | admin | average_overdue_hours group_by=assignee_name time=last_7d | PASS | 45.52301335470086 | 3 buckets |
| semantic | 1028 | admin | average_overdue_hours group_by=assignee_role time=last_7d | MISMATCH | 42.17955421626984 | 64 |
| semantic | 1028 | admin | average_overdue_hours group_by=resolver_name time=last_7d | PASS | 47.37046342592593 | 4 buckets |
| semantic | 1028 | admin | average_overdue_hours group_by=queue_name time=last_7d | PASS | 30.941389444444443 | 7 buckets |
| semantic | 1028 | admin | average_overdue_hours group_by=queue_type time=last_7d | MISMATCH | 42.17955421626984 | 64 |
| semantic | 1028 | admin | average_overdue_hours group_by=account_name time=last_7d | MISMATCH | 42.17955421626984 | 64 |
| semantic | 1028 | admin | average_overdue_hours group_by=organization_name time=last_7d | MISMATCH | 42.17955421626984 | 64 |
| semantic | 1028 | admin | average_overdue_hours group_by=organization_business_type time=last_7d | MISMATCH | 42.17955421626984 | 64 |
| semantic | 1028 | admin | average_overdue_hours group_by=team_supports_ticketing time=last_7d | MISMATCH | 42.17955421626984 | 64 |
| semantic | 1028 | admin | average_overdue_hours group_by=created_by_name time=last_7d | UNMAPPED | 77.0 | None |
| semantic | 1028 | admin | average_overdue_hours group_by=customer_name time=last_7d | PASS | 29.0 | 112 buckets |
| semantic | 1028 | admin | average_overdue_hours group_by=has_assignee time=last_7d | MISMATCH | 42.17955421626984 | 64 |
| semantic | 1028 | admin | average_overdue_hours group_by=has_resolver time=last_7d | MISMATCH | 42.17955421626984 | 64 |
| semantic | 1028 | admin | average_overdue_hours group_by=has_first_response time=last_7d | MISMATCH | 42.17955421626984 | 64 |
| semantic | 1028 | admin | average_overdue_hours group_by=has_csat_rating time=last_7d | MISMATCH | 32.95984186507936 | 64 |
| semantic | 1028 | admin | average_overdue_hours group_by=is_overdue time=last_7d | MISMATCH | 42.17955421626984 | 64 |
| semantic | 1028 | admin | average_resolution_hours_variance group_by=- time=all_time | MISMATCH | 49.31638382654011 | 76.51906389354178 |
| semantic | 1028 | admin | average_resolution_hours_variance group_by=- time=today | UNMAPPED | 24.0 | None |
| semantic | 1028 | admin | average_resolution_hours_variance group_by=- time=last_7d | MISMATCH | 27.954917966903075 | 56.12513073286052 |
| semantic | 1028 | admin | average_resolution_hours_variance group_by=- time=last_30d | MISMATCH | 47.43200532299742 | 74.40874950904393 |
| semantic | 1028 | admin | average_resolution_time_hours group_by=- time=all_time | PASS | 76.51906389354178 | 76.51906389354178 |
| semantic | 1028 | admin | average_resolution_time_hours group_by=- time=today | UNMAPPED | 48.0 | None |
| semantic | 1028 | admin | average_resolution_time_hours group_by=- time=last_7d | MISMATCH | 68.05316636225267 | 56.12513073286052 |
| semantic | 1028 | admin | average_resolution_time_hours group_by=- time=last_30d | PASS | 75.75056285169289 | 74.40874950904393 |
| semantic | 1028 | admin | average_resolution_time_hours group_by=priority time=last_7d | PASS | 64.12351035353535 | 4 buckets |
| semantic | 1028 | admin | average_resolution_time_hours group_by=queue_name time=last_7d | PASS | 54.30013958333333 | 7 buckets |
| semantic | 1028 | admin | average_tickets_per_day group_by=- time=all_time | UNMAPPED | 1501.0 | None |
| semantic | 1028 | admin | average_tickets_per_day group_by=- time=today | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | average_tickets_per_day group_by=- time=last_7d | UNMAPPED | 117.0 | None |
| semantic | 1028 | admin | average_tickets_per_day group_by=- time=last_30d | UNMAPPED | 517.0 | None |
| semantic | 1028 | admin | average_tickets_per_day group_by=status time=last_7d | UNMAPPED | 21.0 | None |
| semantic | 1028 | admin | average_tickets_per_day group_by=status_display_name time=last_7d | UNMAPPED | 21.0 | None |
| semantic | 1028 | admin | average_tickets_per_day group_by=is_closed_by_status time=last_7d | UNMAPPED | 96.0 | None |
| semantic | 1028 | admin | average_tickets_per_day group_by=priority time=last_7d | UNMAPPED | 41.0 | None |
| semantic | 1028 | admin | average_tickets_per_day group_by=channel time=last_7d | UNMAPPED | 20.0 | None |
| semantic | 1028 | admin | average_tickets_per_day group_by=category time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | average_tickets_per_day group_by=skill time=last_7d | UNMAPPED | 117.0 | None |
| semantic | 1028 | admin | average_tickets_per_day group_by=assignee_name time=last_7d | UNMAPPED | 56.0 | None |
| semantic | 1028 | admin | average_tickets_per_day group_by=assignee_role time=last_7d | UNMAPPED | 117.0 | None |
| semantic | 1028 | admin | average_tickets_per_day group_by=resolver_name time=last_7d | UNMAPPED | 43.0 | None |
| semantic | 1028 | admin | average_tickets_per_day group_by=queue_name time=last_7d | UNMAPPED | 15.0 | None |
| semantic | 1028 | admin | average_tickets_per_day group_by=queue_type time=last_7d | UNMAPPED | 117.0 | None |
| semantic | 1028 | admin | average_tickets_per_day group_by=account_name time=last_7d | UNMAPPED | 117.0 | None |
| semantic | 1028 | admin | average_tickets_per_day group_by=organization_name time=last_7d | UNMAPPED | 117.0 | None |
| semantic | 1028 | admin | average_tickets_per_day group_by=organization_business_type time=last_7d | UNMAPPED | 117.0 | None |
| semantic | 1028 | admin | average_tickets_per_day group_by=team_supports_ticketing time=last_7d | UNMAPPED | 117.0 | None |
| semantic | 1028 | admin | average_tickets_per_day group_by=created_by_name time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | average_tickets_per_day group_by=customer_name time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | average_tickets_per_day group_by=has_assignee time=last_7d | UNMAPPED | 117.0 | None |
| semantic | 1028 | admin | average_tickets_per_day group_by=has_resolver time=last_7d | UNMAPPED | 117.0 | None |
| semantic | 1028 | admin | average_tickets_per_day group_by=has_first_response time=last_7d | UNMAPPED | 12.0 | None |
| semantic | 1028 | admin | average_tickets_per_day group_by=has_csat_rating time=last_7d | UNMAPPED | 81.0 | None |
| semantic | 1028 | admin | average_tickets_per_day group_by=is_overdue time=last_7d | UNMAPPED | 53.0 | None |
| semantic | 1028 | admin | breached_tickets_metric group_by=- time=all_time | MISMATCH | 781.0 | 898 |
| semantic | 1028 | admin | breached_tickets_metric group_by=- time=today | PASS | 0.0 | 0 |
| semantic | 1028 | admin | breached_tickets_metric group_by=- time=last_7d | MISMATCH | 55.0 | 64 |
| semantic | 1028 | admin | breached_tickets_metric group_by=- time=last_30d | MISMATCH | 266.0 | 296 |
| semantic | 1028 | admin | breached_tickets_metric group_by=status time=last_7d | PASS | 0.0 | 6 buckets |
| semantic | 1028 | admin | breached_tickets_metric group_by=status_display_name time=last_7d | MISMATCH | 0.0 | 64 |
| semantic | 1028 | admin | breached_tickets_metric group_by=is_closed_by_status time=last_7d | MISMATCH | 55.0 | 64 |
| semantic | 1028 | admin | breached_tickets_metric group_by=priority time=last_7d | PASS | 23.0 | 4 buckets |
| semantic | 1028 | admin | breached_tickets_metric group_by=channel time=last_7d | PASS | 11.0 | 4 buckets |
| semantic | 1028 | admin | breached_tickets_metric group_by=category time=last_7d | PASS | 0.0 | 40 buckets |
| semantic | 1028 | admin | breached_tickets_metric group_by=skill time=last_7d | MISMATCH | 55.0 | 64 |
| semantic | 1028 | admin | breached_tickets_metric group_by=assignee_name time=last_7d | PASS | 29.0 | 3 buckets |
| semantic | 1028 | admin | breached_tickets_metric group_by=assignee_role time=last_7d | MISMATCH | 55.0 | 64 |
| semantic | 1028 | admin | breached_tickets_metric group_by=resolver_name time=last_7d | PASS | 19.0 | 4 buckets |
| semantic | 1028 | admin | breached_tickets_metric group_by=queue_name time=last_7d | PASS | 7.0 | 7 buckets |
| semantic | 1028 | admin | breached_tickets_metric group_by=queue_type time=last_7d | MISMATCH | 55.0 | 64 |
| semantic | 1028 | admin | breached_tickets_metric group_by=account_name time=last_7d | MISMATCH | 55.0 | 64 |
| semantic | 1028 | admin | breached_tickets_metric group_by=organization_name time=last_7d | MISMATCH | 55.0 | 64 |
| semantic | 1028 | admin | breached_tickets_metric group_by=organization_business_type time=last_7d | MISMATCH | 55.0 | 64 |
| semantic | 1028 | admin | breached_tickets_metric group_by=team_supports_ticketing time=last_7d | MISMATCH | 55.0 | 64 |
| semantic | 1028 | admin | breached_tickets_metric group_by=created_by_name time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | breached_tickets_metric group_by=customer_name time=last_7d | PASS | 0.0 | 112 buckets |
| semantic | 1028 | admin | breached_tickets_metric group_by=has_assignee time=last_7d | MISMATCH | 55.0 | 64 |
| semantic | 1028 | admin | breached_tickets_metric group_by=has_resolver time=last_7d | MISMATCH | 55.0 | 64 |
| semantic | 1028 | admin | breached_tickets_metric group_by=has_first_response time=last_7d | MISMATCH | 10.0 | 64 |
| semantic | 1028 | admin | breached_tickets_metric group_by=has_csat_rating time=last_7d | MISMATCH | 55.0 | 64 |
| semantic | 1028 | admin | breached_tickets_metric group_by=is_overdue time=last_7d | MISMATCH | 0.0 | 64 |
| semantic | 1028 | admin | closed_tickets_metric group_by=- time=all_time | MISMATCH | 597.0 | 274 |
| semantic | 1028 | admin | closed_tickets_metric group_by=- time=today | PASS | 0.0 | 0 |
| semantic | 1028 | admin | closed_tickets_metric group_by=- time=last_7d | MISMATCH | 47.0 | 21 |
| semantic | 1028 | admin | closed_tickets_metric group_by=- time=last_30d | MISMATCH | 215.0 | 105 |
| semantic | 1028 | admin | closed_tickets_metric group_by=status time=last_7d | PASS | 21.0 | 6 buckets |
| semantic | 1028 | admin | closed_tickets_metric group_by=status_display_name time=last_7d | PASS | 21.0 | 21 |
| semantic | 1028 | admin | closed_tickets_metric group_by=is_closed_by_status time=last_7d | MISMATCH | 26.0 | 21 |
| semantic | 1028 | admin | closed_tickets_metric group_by=priority time=last_7d | PASS | 11.0 | 4 buckets |
| semantic | 1028 | admin | closed_tickets_metric group_by=channel time=last_7d | PASS | 6.0 | 4 buckets |
| semantic | 1028 | admin | closed_tickets_metric group_by=category time=last_7d | PASS | 0.0 | 40 buckets |
| semantic | 1028 | admin | closed_tickets_metric group_by=skill time=last_7d | MISMATCH | 47.0 | 21 |
| semantic | 1028 | admin | closed_tickets_metric group_by=assignee_name time=last_7d | PASS | 20.0 | 3 buckets |
| semantic | 1028 | admin | closed_tickets_metric group_by=assignee_role time=last_7d | MISMATCH | 47.0 | 21 |
| semantic | 1028 | admin | closed_tickets_metric group_by=resolver_name time=last_7d | PASS | 16.0 | 4 buckets |
| semantic | 1028 | admin | closed_tickets_metric group_by=queue_name time=last_7d | PASS | 6.0 | 7 buckets |
| semantic | 1028 | admin | closed_tickets_metric group_by=queue_type time=last_7d | MISMATCH | 47.0 | 21 |
| semantic | 1028 | admin | closed_tickets_metric group_by=account_name time=last_7d | MISMATCH | 47.0 | 21 |
| semantic | 1028 | admin | closed_tickets_metric group_by=organization_name time=last_7d | MISMATCH | 47.0 | 21 |
| semantic | 1028 | admin | closed_tickets_metric group_by=organization_business_type time=last_7d | MISMATCH | 47.0 | 21 |
| semantic | 1028 | admin | closed_tickets_metric group_by=team_supports_ticketing time=last_7d | MISMATCH | 47.0 | 21 |
| semantic | 1028 | admin | closed_tickets_metric group_by=created_by_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | closed_tickets_metric group_by=customer_name time=last_7d | PASS | 1.0 | 112 buckets |
| semantic | 1028 | admin | closed_tickets_metric group_by=has_assignee time=last_7d | MISMATCH | 47.0 | 21 |
| semantic | 1028 | admin | closed_tickets_metric group_by=has_resolver time=last_7d | MISMATCH | 47.0 | 21 |
| semantic | 1028 | admin | closed_tickets_metric group_by=has_first_response time=last_7d | MISMATCH | 0.0 | 21 |
| semantic | 1028 | admin | closed_tickets_metric group_by=has_csat_rating time=last_7d | MISMATCH | 11.0 | 21 |
| semantic | 1028 | admin | closed_tickets_metric group_by=is_overdue time=last_7d | MISMATCH | 47.0 | 21 |
| semantic | 1028 | admin | csat_detractor_metric group_by=- time=all_time | PASS | 70.0 | 70 |
| semantic | 1028 | admin | csat_detractor_metric group_by=- time=today | PASS | 0.0 | 0 |
| semantic | 1028 | admin | csat_detractor_metric group_by=- time=last_7d | PASS | 6.0 | 6 |
| semantic | 1028 | admin | csat_detractor_metric group_by=- time=last_30d | PASS | 32.0 | 32 |
| semantic | 1028 | admin | csat_detractor_metric group_by=status time=last_7d | PASS | 4.0 | 6 buckets |
| semantic | 1028 | admin | csat_detractor_metric group_by=status_display_name time=last_7d | MISMATCH | 4.0 | 6 |
| semantic | 1028 | admin | csat_detractor_metric group_by=is_closed_by_status time=last_7d | MISMATCH | 2.0 | 6 |
| semantic | 1028 | admin | csat_detractor_metric group_by=priority time=last_7d | PASS | 1.0 | 4 buckets |
| semantic | 1028 | admin | csat_detractor_metric group_by=channel time=last_7d | PASS | 1.0 | 4 buckets |
| semantic | 1028 | admin | csat_detractor_metric group_by=category time=last_7d | PASS | 0.0 | 40 buckets |
| semantic | 1028 | admin | csat_detractor_metric group_by=skill time=last_7d | PASS | 6.0 | 6 |
| semantic | 1028 | admin | csat_detractor_metric group_by=assignee_name time=last_7d | PASS | 3.0 | 3 buckets |
| semantic | 1028 | admin | csat_detractor_metric group_by=assignee_role time=last_7d | PASS | 6.0 | 6 |
| semantic | 1028 | admin | csat_detractor_metric group_by=resolver_name time=last_7d | PASS | 2.0 | 4 buckets |
| semantic | 1028 | admin | csat_detractor_metric group_by=queue_name time=last_7d | PASS | 0.0 | 7 buckets |
| semantic | 1028 | admin | csat_detractor_metric group_by=queue_type time=last_7d | PASS | 6.0 | 6 |
| semantic | 1028 | admin | csat_detractor_metric group_by=account_name time=last_7d | PASS | 6.0 | 6 |
| semantic | 1028 | admin | csat_detractor_metric group_by=organization_name time=last_7d | PASS | 6.0 | 6 |
| semantic | 1028 | admin | csat_detractor_metric group_by=organization_business_type time=last_7d | PASS | 6.0 | 6 |
| semantic | 1028 | admin | csat_detractor_metric group_by=team_supports_ticketing time=last_7d | PASS | 6.0 | 6 |
| semantic | 1028 | admin | csat_detractor_metric group_by=created_by_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | csat_detractor_metric group_by=customer_name time=last_7d | PASS | 0.0 | 112 buckets |
| semantic | 1028 | admin | csat_detractor_metric group_by=has_assignee time=last_7d | PASS | 6.0 | 6 |
| semantic | 1028 | admin | csat_detractor_metric group_by=has_resolver time=last_7d | PASS | 6.0 | 6 |
| semantic | 1028 | admin | csat_detractor_metric group_by=has_first_response time=last_7d | MISMATCH | 0.0 | 6 |
| semantic | 1028 | admin | csat_detractor_metric group_by=has_csat_rating time=last_7d | MISMATCH | 0.0 | 6 |
| semantic | 1028 | admin | csat_detractor_metric group_by=is_overdue time=last_7d | PASS | 6.0 | 6 |
| semantic | 1028 | admin | csat_detractor_rate group_by=- time=all_time | UNMAPPED | 0.15021459227467812 | None |
| semantic | 1028 | admin | csat_detractor_rate group_by=- time=today | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | csat_detractor_rate group_by=- time=last_7d | UNMAPPED | 0.16666666666666666 | None |
| semantic | 1028 | admin | csat_detractor_rate group_by=- time=last_30d | UNMAPPED | 0.18823529411764706 | None |
| semantic | 1028 | admin | csat_detractor_rate group_by=status time=last_7d | UNMAPPED | 0.2857142857142857 | None |
| semantic | 1028 | admin | csat_detractor_rate group_by=status_display_name time=last_7d | UNMAPPED | 0.2857142857142857 | None |
| semantic | 1028 | admin | csat_detractor_rate group_by=is_closed_by_status time=last_7d | UNMAPPED | 0.09090909090909091 | None |
| semantic | 1028 | admin | csat_detractor_rate group_by=priority time=last_7d | UNMAPPED | 0.125 | None |
| semantic | 1028 | admin | csat_detractor_rate group_by=channel time=last_7d | UNMAPPED | 0.2 | None |
| semantic | 1028 | admin | csat_detractor_rate group_by=category time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | csat_detractor_rate group_by=skill time=last_7d | UNMAPPED | 0.16666666666666666 | None |
| semantic | 1028 | admin | csat_detractor_rate group_by=assignee_name time=last_7d | UNMAPPED | 0.1875 | None |
| semantic | 1028 | admin | csat_detractor_rate group_by=assignee_role time=last_7d | UNMAPPED | 0.16666666666666666 | None |
| semantic | 1028 | admin | csat_detractor_rate group_by=resolver_name time=last_7d | UNMAPPED | 0.16666666666666666 | None |
| semantic | 1028 | admin | csat_detractor_rate group_by=queue_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | csat_detractor_rate group_by=queue_type time=last_7d | UNMAPPED | 0.16666666666666666 | None |
| semantic | 1028 | admin | csat_detractor_rate group_by=account_name time=last_7d | UNMAPPED | 0.16666666666666666 | None |
| semantic | 1028 | admin | csat_detractor_rate group_by=organization_name time=last_7d | UNMAPPED | 0.16666666666666666 | None |
| semantic | 1028 | admin | csat_detractor_rate group_by=organization_business_type time=last_7d | UNMAPPED | 0.16666666666666666 | None |
| semantic | 1028 | admin | csat_detractor_rate group_by=team_supports_ticketing time=last_7d | UNMAPPED | 0.16666666666666666 | None |
| semantic | 1028 | admin | csat_detractor_rate group_by=created_by_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | csat_detractor_rate group_by=customer_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | csat_detractor_rate group_by=has_assignee time=last_7d | UNMAPPED | 0.16666666666666666 | None |
| semantic | 1028 | admin | csat_detractor_rate group_by=has_resolver time=last_7d | UNMAPPED | 0.16666666666666666 | None |
| semantic | 1028 | admin | csat_detractor_rate group_by=has_first_response time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | csat_detractor_rate group_by=has_csat_rating time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | csat_detractor_rate group_by=is_overdue time=last_7d | UNMAPPED | 0.16666666666666666 | None |
| semantic | 1028 | admin | csat_neutral_metric group_by=- time=all_time | PASS | 80.0 | 80 |
| semantic | 1028 | admin | csat_neutral_metric group_by=- time=today | PASS | 0.0 | 0 |
| semantic | 1028 | admin | csat_neutral_metric group_by=- time=last_7d | PASS | 6.0 | 6 |
| semantic | 1028 | admin | csat_neutral_metric group_by=- time=last_30d | PASS | 23.0 | 23 |
| semantic | 1028 | admin | csat_neutral_metric group_by=status time=last_7d | PASS | 3.0 | 6 buckets |
| semantic | 1028 | admin | csat_neutral_metric group_by=status_display_name time=last_7d | MISMATCH | 3.0 | 6 |
| semantic | 1028 | admin | csat_neutral_metric group_by=is_closed_by_status time=last_7d | MISMATCH | 3.0 | 6 |
| semantic | 1028 | admin | csat_neutral_metric group_by=priority time=last_7d | PASS | 1.0 | 4 buckets |
| semantic | 1028 | admin | csat_neutral_metric group_by=channel time=last_7d | PASS | 1.0 | 4 buckets |
| semantic | 1028 | admin | csat_neutral_metric group_by=category time=last_7d | PASS | 0.0 | 40 buckets |
| semantic | 1028 | admin | csat_neutral_metric group_by=skill time=last_7d | PASS | 6.0 | 6 |
| semantic | 1028 | admin | csat_neutral_metric group_by=assignee_name time=last_7d | PASS | 2.0 | 3 buckets |
| semantic | 1028 | admin | csat_neutral_metric group_by=assignee_role time=last_7d | PASS | 6.0 | 6 |
| semantic | 1028 | admin | csat_neutral_metric group_by=resolver_name time=last_7d | PASS | 1.0 | 4 buckets |
| semantic | 1028 | admin | csat_neutral_metric group_by=queue_name time=last_7d | PASS | 1.0 | 7 buckets |
| semantic | 1028 | admin | csat_neutral_metric group_by=queue_type time=last_7d | PASS | 6.0 | 6 |
| semantic | 1028 | admin | csat_neutral_metric group_by=account_name time=last_7d | PASS | 6.0 | 6 |
| semantic | 1028 | admin | csat_neutral_metric group_by=organization_name time=last_7d | PASS | 6.0 | 6 |
| semantic | 1028 | admin | csat_neutral_metric group_by=organization_business_type time=last_7d | PASS | 6.0 | 6 |
| semantic | 1028 | admin | csat_neutral_metric group_by=team_supports_ticketing time=last_7d | PASS | 6.0 | 6 |
| semantic | 1028 | admin | csat_neutral_metric group_by=created_by_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | csat_neutral_metric group_by=customer_name time=last_7d | PASS | 0.0 | 112 buckets |
| semantic | 1028 | admin | csat_neutral_metric group_by=has_assignee time=last_7d | PASS | 6.0 | 6 |
| semantic | 1028 | admin | csat_neutral_metric group_by=has_resolver time=last_7d | PASS | 6.0 | 6 |
| semantic | 1028 | admin | csat_neutral_metric group_by=has_first_response time=last_7d | MISMATCH | 0.0 | 6 |
| semantic | 1028 | admin | csat_neutral_metric group_by=has_csat_rating time=last_7d | MISMATCH | 0.0 | 6 |
| semantic | 1028 | admin | csat_neutral_metric group_by=is_overdue time=last_7d | PASS | 6.0 | 6 |
| semantic | 1028 | admin | csat_promoter_metric group_by=- time=all_time | PASS | 316.0 | 316 |
| semantic | 1028 | admin | csat_promoter_metric group_by=- time=today | PASS | 0.0 | 0 |
| semantic | 1028 | admin | csat_promoter_metric group_by=- time=last_7d | PASS | 24.0 | 24 |
| semantic | 1028 | admin | csat_promoter_metric group_by=- time=last_30d | PASS | 115.0 | 115 |
| semantic | 1028 | admin | csat_promoter_metric group_by=status time=last_7d | PASS | 7.0 | 6 buckets |
| semantic | 1028 | admin | csat_promoter_metric group_by=status_display_name time=last_7d | MISMATCH | 7.0 | 24 |
| semantic | 1028 | admin | csat_promoter_metric group_by=is_closed_by_status time=last_7d | MISMATCH | 17.0 | 24 |
| semantic | 1028 | admin | csat_promoter_metric group_by=priority time=last_7d | PASS | 6.0 | 4 buckets |
| semantic | 1028 | admin | csat_promoter_metric group_by=channel time=last_7d | PASS | 3.0 | 4 buckets |
| semantic | 1028 | admin | csat_promoter_metric group_by=category time=last_7d | PASS | 0.0 | 40 buckets |
| semantic | 1028 | admin | csat_promoter_metric group_by=skill time=last_7d | PASS | 24.0 | 24 |
| semantic | 1028 | admin | csat_promoter_metric group_by=assignee_name time=last_7d | PASS | 11.0 | 3 buckets |
| semantic | 1028 | admin | csat_promoter_metric group_by=assignee_role time=last_7d | PASS | 24.0 | 24 |
| semantic | 1028 | admin | csat_promoter_metric group_by=resolver_name time=last_7d | PASS | 9.0 | 4 buckets |
| semantic | 1028 | admin | csat_promoter_metric group_by=queue_name time=last_7d | PASS | 3.0 | 7 buckets |
| semantic | 1028 | admin | csat_promoter_metric group_by=queue_type time=last_7d | PASS | 24.0 | 24 |
| semantic | 1028 | admin | csat_promoter_metric group_by=account_name time=last_7d | PASS | 24.0 | 24 |
| semantic | 1028 | admin | csat_promoter_metric group_by=organization_name time=last_7d | PASS | 24.0 | 24 |
| semantic | 1028 | admin | csat_promoter_metric group_by=organization_business_type time=last_7d | PASS | 24.0 | 24 |
| semantic | 1028 | admin | csat_promoter_metric group_by=team_supports_ticketing time=last_7d | PASS | 24.0 | 24 |
| semantic | 1028 | admin | csat_promoter_metric group_by=created_by_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | csat_promoter_metric group_by=customer_name time=last_7d | PASS | 0.0 | 112 buckets |
| semantic | 1028 | admin | csat_promoter_metric group_by=has_assignee time=last_7d | PASS | 24.0 | 24 |
| semantic | 1028 | admin | csat_promoter_metric group_by=has_resolver time=last_7d | PASS | 24.0 | 24 |
| semantic | 1028 | admin | csat_promoter_metric group_by=has_first_response time=last_7d | MISMATCH | 0.0 | 24 |
| semantic | 1028 | admin | csat_promoter_metric group_by=has_csat_rating time=last_7d | MISMATCH | 0.0 | 24 |
| semantic | 1028 | admin | csat_promoter_metric group_by=is_overdue time=last_7d | PASS | 24.0 | 24 |
| semantic | 1028 | admin | csat_promoter_rate group_by=- time=all_time | UNMAPPED | 0.6781115879828327 | None |
| semantic | 1028 | admin | csat_promoter_rate group_by=- time=today | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | csat_promoter_rate group_by=- time=last_7d | UNMAPPED | 0.6666666666666666 | None |
| semantic | 1028 | admin | csat_promoter_rate group_by=- time=last_30d | UNMAPPED | 0.6764705882352942 | None |
| semantic | 1028 | admin | csat_promoter_rate group_by=status time=last_7d | UNMAPPED | 0.5 | None |
| semantic | 1028 | admin | csat_promoter_rate group_by=status_display_name time=last_7d | UNMAPPED | 0.5 | None |
| semantic | 1028 | admin | csat_promoter_rate group_by=is_closed_by_status time=last_7d | UNMAPPED | 0.7727272727272727 | None |
| semantic | 1028 | admin | csat_promoter_rate group_by=priority time=last_7d | UNMAPPED | 0.75 | None |
| semantic | 1028 | admin | csat_promoter_rate group_by=channel time=last_7d | UNMAPPED | 0.6 | None |
| semantic | 1028 | admin | csat_promoter_rate group_by=category time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | csat_promoter_rate group_by=skill time=last_7d | UNMAPPED | 0.6666666666666666 | None |
| semantic | 1028 | admin | csat_promoter_rate group_by=assignee_name time=last_7d | UNMAPPED | 0.6875 | None |
| semantic | 1028 | admin | csat_promoter_rate group_by=assignee_role time=last_7d | UNMAPPED | 0.6666666666666666 | None |
| semantic | 1028 | admin | csat_promoter_rate group_by=resolver_name time=last_7d | UNMAPPED | 0.75 | None |
| semantic | 1028 | admin | csat_promoter_rate group_by=queue_name time=last_7d | UNMAPPED | 0.75 | None |
| semantic | 1028 | admin | csat_promoter_rate group_by=queue_type time=last_7d | UNMAPPED | 0.6666666666666666 | None |
| semantic | 1028 | admin | csat_promoter_rate group_by=account_name time=last_7d | UNMAPPED | 0.6666666666666666 | None |
| semantic | 1028 | admin | csat_promoter_rate group_by=organization_name time=last_7d | UNMAPPED | 0.6666666666666666 | None |
| semantic | 1028 | admin | csat_promoter_rate group_by=organization_business_type time=last_7d | UNMAPPED | 0.6666666666666666 | None |
| semantic | 1028 | admin | csat_promoter_rate group_by=team_supports_ticketing time=last_7d | UNMAPPED | 0.6666666666666666 | None |
| semantic | 1028 | admin | csat_promoter_rate group_by=created_by_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | csat_promoter_rate group_by=customer_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | csat_promoter_rate group_by=has_assignee time=last_7d | UNMAPPED | 0.6666666666666666 | None |
| semantic | 1028 | admin | csat_promoter_rate group_by=has_resolver time=last_7d | UNMAPPED | 0.6666666666666666 | None |
| semantic | 1028 | admin | csat_promoter_rate group_by=has_first_response time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | csat_promoter_rate group_by=has_csat_rating time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | csat_promoter_rate group_by=is_overdue time=last_7d | UNMAPPED | 0.6666666666666666 | None |
| semantic | 1028 | admin | csat_rated_metric group_by=- time=all_time | PASS | 466.0 | 466 |
| semantic | 1028 | admin | csat_rated_metric group_by=- time=today | PASS | 0.0 | 0 |
| semantic | 1028 | admin | csat_rated_metric group_by=- time=last_7d | PASS | 36.0 | 36 |
| semantic | 1028 | admin | csat_rated_metric group_by=- time=last_30d | PASS | 170.0 | 170 |
| semantic | 1028 | admin | csat_rated_metric group_by=status time=last_7d | PASS | 14.0 | 6 buckets |
| semantic | 1028 | admin | csat_rated_metric group_by=status_display_name time=last_7d | MISMATCH | 14.0 | 36 |
| semantic | 1028 | admin | csat_rated_metric group_by=is_closed_by_status time=last_7d | MISMATCH | 22.0 | 36 |
| semantic | 1028 | admin | csat_rated_metric group_by=priority time=last_7d | PASS | 8.0 | 4 buckets |
| semantic | 1028 | admin | csat_rated_metric group_by=channel time=last_7d | PASS | 5.0 | 4 buckets |
| semantic | 1028 | admin | csat_rated_metric group_by=category time=last_7d | PASS | 0.0 | 40 buckets |
| semantic | 1028 | admin | csat_rated_metric group_by=skill time=last_7d | PASS | 36.0 | 36 |
| semantic | 1028 | admin | csat_rated_metric group_by=assignee_name time=last_7d | PASS | 16.0 | 3 buckets |
| semantic | 1028 | admin | csat_rated_metric group_by=assignee_role time=last_7d | PASS | 36.0 | 36 |
| semantic | 1028 | admin | csat_rated_metric group_by=resolver_name time=last_7d | PASS | 12.0 | 4 buckets |
| semantic | 1028 | admin | csat_rated_metric group_by=queue_name time=last_7d | PASS | 4.0 | 7 buckets |
| semantic | 1028 | admin | csat_rated_metric group_by=queue_type time=last_7d | PASS | 36.0 | 36 |
| semantic | 1028 | admin | csat_rated_metric group_by=account_name time=last_7d | PASS | 36.0 | 36 |
| semantic | 1028 | admin | csat_rated_metric group_by=organization_name time=last_7d | PASS | 36.0 | 36 |
| semantic | 1028 | admin | csat_rated_metric group_by=organization_business_type time=last_7d | PASS | 36.0 | 36 |
| semantic | 1028 | admin | csat_rated_metric group_by=team_supports_ticketing time=last_7d | PASS | 36.0 | 36 |
| semantic | 1028 | admin | csat_rated_metric group_by=created_by_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | csat_rated_metric group_by=customer_name time=last_7d | PASS | 0.0 | 112 buckets |
| semantic | 1028 | admin | csat_rated_metric group_by=has_assignee time=last_7d | PASS | 36.0 | 36 |
| semantic | 1028 | admin | csat_rated_metric group_by=has_resolver time=last_7d | PASS | 36.0 | 36 |
| semantic | 1028 | admin | csat_rated_metric group_by=has_first_response time=last_7d | MISMATCH | 0.0 | 36 |
| semantic | 1028 | admin | csat_rated_metric group_by=has_csat_rating time=last_7d | MISMATCH | 0.0 | 36 |
| semantic | 1028 | admin | csat_rated_metric group_by=is_overdue time=last_7d | PASS | 36.0 | 36 |
| semantic | 1028 | admin | csat_response_rate group_by=- time=all_time | UNMAPPED | 0.7805695142378559 | None |
| semantic | 1028 | admin | csat_response_rate group_by=- time=today | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | csat_response_rate group_by=- time=last_7d | UNMAPPED | 0.7659574468085106 | None |
| semantic | 1028 | admin | csat_response_rate group_by=- time=last_30d | UNMAPPED | 0.7906976744186046 | None |
| semantic | 1028 | admin | csat_response_rate group_by=status time=last_7d | UNMAPPED | 0.6666666666666666 | None |
| semantic | 1028 | admin | csat_response_rate group_by=status_display_name time=last_7d | UNMAPPED | 0.6666666666666666 | None |
| semantic | 1028 | admin | csat_response_rate group_by=is_closed_by_status time=last_7d | UNMAPPED | 0.8461538461538461 | None |
| semantic | 1028 | admin | csat_response_rate group_by=priority time=last_7d | UNMAPPED | 0.7272727272727273 | None |
| semantic | 1028 | admin | csat_response_rate group_by=channel time=last_7d | UNMAPPED | 0.8333333333333334 | None |
| semantic | 1028 | admin | csat_response_rate group_by=category time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | csat_response_rate group_by=skill time=last_7d | UNMAPPED | 0.7659574468085106 | None |
| semantic | 1028 | admin | csat_response_rate group_by=assignee_name time=last_7d | UNMAPPED | 0.8 | None |
| semantic | 1028 | admin | csat_response_rate group_by=assignee_role time=last_7d | UNMAPPED | 0.7659574468085106 | None |
| semantic | 1028 | admin | csat_response_rate group_by=resolver_name time=last_7d | UNMAPPED | 0.75 | None |
| semantic | 1028 | admin | csat_response_rate group_by=queue_name time=last_7d | UNMAPPED | 0.6666666666666666 | None |
| semantic | 1028 | admin | csat_response_rate group_by=queue_type time=last_7d | UNMAPPED | 0.7659574468085106 | None |
| semantic | 1028 | admin | csat_response_rate group_by=account_name time=last_7d | UNMAPPED | 0.7659574468085106 | None |
| semantic | 1028 | admin | csat_response_rate group_by=organization_name time=last_7d | UNMAPPED | 0.7659574468085106 | None |
| semantic | 1028 | admin | csat_response_rate group_by=organization_business_type time=last_7d | UNMAPPED | 0.7659574468085106 | None |
| semantic | 1028 | admin | csat_response_rate group_by=team_supports_ticketing time=last_7d | UNMAPPED | 0.7659574468085106 | None |
| semantic | 1028 | admin | csat_response_rate group_by=created_by_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | csat_response_rate group_by=customer_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | csat_response_rate group_by=has_assignee time=last_7d | UNMAPPED | 0.7659574468085106 | None |
| semantic | 1028 | admin | csat_response_rate group_by=has_resolver time=last_7d | UNMAPPED | 0.7659574468085106 | None |
| semantic | 1028 | admin | csat_response_rate group_by=has_first_response time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | csat_response_rate group_by=has_csat_rating time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | csat_response_rate group_by=is_overdue time=last_7d | UNMAPPED | 0.7659574468085106 | None |
| semantic | 1028 | admin | csat_score_total group_by=- time=all_time | MISMATCH | 1787.0 | 3.834763948497854 |
| semantic | 1028 | admin | csat_score_total group_by=- time=today | GAP | None | None |
| semantic | 1028 | admin | csat_score_total group_by=- time=last_7d | MISMATCH | 136.0 | 3.7777777777777777 |
| semantic | 1028 | admin | csat_score_total group_by=- time=last_30d | MISMATCH | 644.0 | 3.788235294117647 |
| semantic | 1028 | admin | csat_score_total group_by=status time=last_7d | PASS | 47.0 | 2 buckets |
| semantic | 1028 | admin | csat_score_total group_by=status_display_name time=last_7d | MISMATCH | 47.0 | 3.7777777777777777 |
| semantic | 1028 | admin | csat_score_total group_by=is_closed_by_status time=last_7d | MISMATCH | 89.0 | 3.7777777777777777 |
| semantic | 1028 | admin | csat_score_total group_by=priority time=last_7d | PASS | 32.0 | 4 buckets |
| semantic | 1028 | admin | csat_score_total group_by=channel time=last_7d | PASS | 19.0 | 4 buckets |
| semantic | 1028 | admin | csat_score_total group_by=category time=last_7d | PASS | 5.0 | 25 buckets |
| semantic | 1028 | admin | csat_score_total group_by=skill time=last_7d | MISMATCH | 136.0 | 3.7777777777777777 |
| semantic | 1028 | admin | csat_score_total group_by=assignee_name time=last_7d | PASS | 61.0 | 3 buckets |
| semantic | 1028 | admin | csat_score_total group_by=assignee_role time=last_7d | MISMATCH | 136.0 | 3.7777777777777777 |
| semantic | 1028 | admin | csat_score_total group_by=resolver_name time=last_7d | PASS | 47.0 | 3 buckets |
| semantic | 1028 | admin | csat_score_total group_by=queue_name time=last_7d | PASS | 16.0 | 7 buckets |
| semantic | 1028 | admin | csat_score_total group_by=queue_type time=last_7d | MISMATCH | 136.0 | 3.7777777777777777 |
| semantic | 1028 | admin | csat_score_total group_by=account_name time=last_7d | MISMATCH | 136.0 | 3.7777777777777777 |
| semantic | 1028 | admin | csat_score_total group_by=organization_name time=last_7d | MISMATCH | 136.0 | 3.7777777777777777 |
| semantic | 1028 | admin | csat_score_total group_by=organization_business_type time=last_7d | MISMATCH | 136.0 | 3.7777777777777777 |
| semantic | 1028 | admin | csat_score_total group_by=team_supports_ticketing time=last_7d | MISMATCH | 136.0 | 3.7777777777777777 |
| semantic | 1028 | admin | csat_score_total group_by=created_by_name time=last_7d | UNMAPPED | 2.0 | None |
| semantic | 1028 | admin | csat_score_total group_by=customer_name time=last_7d | PASS | 2.0 | 36 buckets |
| semantic | 1028 | admin | csat_score_total group_by=has_assignee time=last_7d | MISMATCH | 136.0 | 3.7777777777777777 |
| semantic | 1028 | admin | csat_score_total group_by=has_resolver time=last_7d | MISMATCH | 136.0 | 3.7777777777777777 |
| semantic | 1028 | admin | csat_score_total group_by=has_first_response time=last_7d | MISMATCH | 136.0 | 3.7777777777777777 |
| semantic | 1028 | admin | csat_score_total group_by=has_csat_rating time=last_7d | MISMATCH | 136.0 | 3.7777777777777777 |
| semantic | 1028 | admin | csat_score_total group_by=is_overdue time=last_7d | MISMATCH | 136.0 | 3.7777777777777777 |
| semantic | 1028 | admin | current_overdue_tickets_metric group_by=- time=all_time | PASS | 898.0 | 898 |
| semantic | 1028 | admin | current_overdue_tickets_metric group_by=- time=today | PASS | 0.0 | 0 |
| semantic | 1028 | admin | current_overdue_tickets_metric group_by=- time=last_7d | PASS | 64.0 | 64 |
| semantic | 1028 | admin | current_overdue_tickets_metric group_by=- time=last_30d | PASS | 296.0 | 296 |
| semantic | 1028 | admin | current_overdue_tickets_metric group_by=status time=last_7d | PASS | 0.0 | 6 buckets |
| semantic | 1028 | admin | current_overdue_tickets_metric group_by=status_display_name time=last_7d | MISMATCH | 0.0 | 64 |
| semantic | 1028 | admin | current_overdue_tickets_metric group_by=is_closed_by_status time=last_7d | PASS | 64.0 | 64 |
| semantic | 1028 | admin | current_overdue_tickets_metric group_by=priority time=last_7d | PASS | 28.0 | 4 buckets |
| semantic | 1028 | admin | current_overdue_tickets_metric group_by=channel time=last_7d | PASS | 14.0 | 4 buckets |
| semantic | 1028 | admin | current_overdue_tickets_metric group_by=category time=last_7d | PASS | 0.0 | 40 buckets |
| semantic | 1028 | admin | current_overdue_tickets_metric group_by=skill time=last_7d | PASS | 64.0 | 64 |
| semantic | 1028 | admin | current_overdue_tickets_metric group_by=assignee_name time=last_7d | PASS | 32.0 | 3 buckets |
| semantic | 1028 | admin | current_overdue_tickets_metric group_by=assignee_role time=last_7d | PASS | 64.0 | 64 |
| semantic | 1028 | admin | current_overdue_tickets_metric group_by=resolver_name time=last_7d | PASS | 23.0 | 4 buckets |
| semantic | 1028 | admin | current_overdue_tickets_metric group_by=queue_name time=last_7d | PASS | 8.0 | 7 buckets |
| semantic | 1028 | admin | current_overdue_tickets_metric group_by=queue_type time=last_7d | PASS | 64.0 | 64 |
| semantic | 1028 | admin | current_overdue_tickets_metric group_by=account_name time=last_7d | PASS | 64.0 | 64 |
| semantic | 1028 | admin | current_overdue_tickets_metric group_by=organization_name time=last_7d | PASS | 64.0 | 64 |
| semantic | 1028 | admin | current_overdue_tickets_metric group_by=organization_business_type time=last_7d | PASS | 64.0 | 64 |
| semantic | 1028 | admin | current_overdue_tickets_metric group_by=team_supports_ticketing time=last_7d | PASS | 64.0 | 64 |
| semantic | 1028 | admin | current_overdue_tickets_metric group_by=created_by_name time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | current_overdue_tickets_metric group_by=customer_name time=last_7d | PASS | 0.0 | 112 buckets |
| semantic | 1028 | admin | current_overdue_tickets_metric group_by=has_assignee time=last_7d | PASS | 64.0 | 64 |
| semantic | 1028 | admin | current_overdue_tickets_metric group_by=has_resolver time=last_7d | PASS | 64.0 | 64 |
| semantic | 1028 | admin | current_overdue_tickets_metric group_by=has_first_response time=last_7d | MISMATCH | 10.0 | 64 |
| semantic | 1028 | admin | current_overdue_tickets_metric group_by=has_csat_rating time=last_7d | PASS | 64.0 | 64 |
| semantic | 1028 | admin | current_overdue_tickets_metric group_by=is_overdue time=last_7d | MISMATCH | 0.0 | 64 |
| semantic | 1028 | admin | customer_reply_volume group_by=- time=all_time | MISMATCH | 158.0 | 1501 |
| semantic | 1028 | admin | customer_reply_volume group_by=- time=today | MISMATCH | 7.0 | 0 |
| semantic | 1028 | admin | customer_reply_volume group_by=- time=last_7d | MISMATCH | 158.0 | 117 |
| semantic | 1028 | admin | customer_reply_volume group_by=- time=last_30d | MISMATCH | 158.0 | 517 |
| semantic | 1028 | admin | customer_reply_volume group_by=visibility time=last_7d | MISMATCH | 158.0 | 117 |
| semantic | 1028 | admin | customer_reply_volume group_by=is_internal_note time=last_7d | MISMATCH | 158.0 | 117 |
| semantic | 1028 | admin | customer_reply_volume group_by=ticket_priority time=last_7d | MISMATCH | 51.0 | 117 |
| semantic | 1028 | admin | customer_reply_volume group_by=ticket_status time=last_7d | MISMATCH | 158.0 | 117 |
| semantic | 1028 | admin | customer_reply_volume group_by=queue_name time=last_7d | PASS | 10.0 | 7 buckets |
| semantic | 1028 | admin | customer_reply_volume group_by=assignee_name time=last_7d | PASS | 54.0 | 3 buckets |
| semantic | 1028 | admin | customer_reply_volume group_by=author_name time=last_7d | MISMATCH | 158.0 | 117 |
| semantic | 1028 | admin | customers_served group_by=- time=all_time | UNMAPPED | 1000.0 | None |
| semantic | 1028 | admin | customers_served group_by=- time=today | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | customers_served group_by=- time=last_7d | UNMAPPED | 111.0 | None |
| semantic | 1028 | admin | customers_served group_by=- time=last_30d | UNMAPPED | 450.0 | None |
| semantic | 1028 | admin | customers_served group_by=status time=last_7d | UNMAPPED | 21.0 | None |
| semantic | 1028 | admin | customers_served group_by=status_display_name time=last_7d | UNMAPPED | 21.0 | None |
| semantic | 1028 | admin | customers_served group_by=is_closed_by_status time=last_7d | UNMAPPED | 91.0 | None |
| semantic | 1028 | admin | customers_served group_by=priority time=last_7d | UNMAPPED | 40.0 | None |
| semantic | 1028 | admin | customers_served group_by=channel time=last_7d | UNMAPPED | 20.0 | None |
| semantic | 1028 | admin | customers_served group_by=category time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | customers_served group_by=skill time=last_7d | UNMAPPED | 111.0 | None |
| semantic | 1028 | admin | customers_served group_by=assignee_name time=last_7d | UNMAPPED | 54.0 | None |
| semantic | 1028 | admin | customers_served group_by=assignee_role time=last_7d | UNMAPPED | 111.0 | None |
| semantic | 1028 | admin | customers_served group_by=resolver_name time=last_7d | UNMAPPED | 42.0 | None |
| semantic | 1028 | admin | customers_served group_by=queue_name time=last_7d | UNMAPPED | 15.0 | None |
| semantic | 1028 | admin | customers_served group_by=queue_type time=last_7d | UNMAPPED | 111.0 | None |
| semantic | 1028 | admin | customers_served group_by=account_name time=last_7d | UNMAPPED | 111.0 | None |
| semantic | 1028 | admin | customers_served group_by=organization_name time=last_7d | UNMAPPED | 111.0 | None |
| semantic | 1028 | admin | customers_served group_by=organization_business_type time=last_7d | UNMAPPED | 111.0 | None |
| semantic | 1028 | admin | customers_served group_by=team_supports_ticketing time=last_7d | UNMAPPED | 111.0 | None |
| semantic | 1028 | admin | customers_served group_by=created_by_name time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | customers_served group_by=customer_name time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | customers_served group_by=has_assignee time=last_7d | UNMAPPED | 111.0 | None |
| semantic | 1028 | admin | customers_served group_by=has_resolver time=last_7d | UNMAPPED | 111.0 | None |
| semantic | 1028 | admin | customers_served group_by=has_first_response time=last_7d | UNMAPPED | 12.0 | None |
| semantic | 1028 | admin | customers_served group_by=has_csat_rating time=last_7d | UNMAPPED | 79.0 | None |
| semantic | 1028 | admin | customers_served group_by=is_overdue time=last_7d | UNMAPPED | 53.0 | None |
| semantic | 1028 | admin | days_since_last_ticket group_by=- time=all_time | UNMAPPED | 0.7378834622685185 | None |
| semantic | 1028 | admin | days_since_last_ticket group_by=- time=today | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | days_since_last_ticket group_by=- time=last_7d | UNMAPPED | 0.7379574901736111 | None |
| semantic | 1028 | admin | days_since_last_ticket group_by=- time=last_30d | UNMAPPED | 0.737995365474537 | None |
| semantic | 1028 | admin | days_since_last_ticket group_by=status time=last_7d | UNMAPPED | 1.0881593704282406 | None |
| semantic | 1028 | admin | days_since_last_ticket group_by=status_display_name time=last_7d | UNMAPPED | 1.088196685 | None |
| semantic | 1028 | admin | days_since_last_ticket group_by=is_closed_by_status time=last_7d | UNMAPPED | 0.7381066454282408 | None |
| semantic | 1028 | admin | days_since_last_ticket group_by=priority time=last_7d | UNMAPPED | 0.7381438503703703 | None |
| semantic | 1028 | admin | days_since_last_ticket group_by=channel time=last_7d | UNMAPPED | 1.0159125248032408 | None |
| semantic | 1028 | admin | days_since_last_ticket group_by=category time=last_7d | UNMAPPED | 1.065094354537037 | None |
| semantic | 1028 | admin | days_since_last_ticket group_by=skill time=last_7d | UNMAPPED | 0.738257297974537 | None |
| semantic | 1028 | admin | days_since_last_ticket group_by=assignee_name time=last_7d | UNMAPPED | 0.7382945566782407 | None |
| semantic | 1028 | admin | days_since_last_ticket group_by=assignee_role time=last_7d | UNMAPPED | 0.7383317378125 | None |
| semantic | 1028 | admin | days_since_last_ticket group_by=resolver_name time=last_7d | UNMAPPED | 0.7383697758912037 | None |
| semantic | 1028 | admin | days_since_last_ticket group_by=queue_name time=last_7d | UNMAPPED | 0.8895642901157408 | None |
| semantic | 1028 | admin | days_since_last_ticket group_by=queue_type time=last_7d | UNMAPPED | 0.7384446244560186 | None |
| semantic | 1028 | admin | days_since_last_ticket group_by=account_name time=last_7d | UNMAPPED | 0.7384818996064815 | None |
| semantic | 1028 | admin | days_since_last_ticket group_by=organization_name time=last_7d | UNMAPPED | 0.7385191689120371 | None |
| semantic | 1028 | admin | days_since_last_ticket group_by=organization_business_type time=last_7d | UNMAPPED | 0.7385562924189815 | None |
| semantic | 1028 | admin | days_since_last_ticket group_by=team_supports_ticketing time=last_7d | UNMAPPED | 0.7385934979050925 | None |
| semantic | 1028 | admin | days_since_last_ticket group_by=created_by_name time=last_7d | UNMAPPED | 2.9077277052662036 | None |
| semantic | 1028 | admin | days_since_last_ticket group_by=customer_name time=last_7d | UNMAPPED | 4.97737142037037 | None |
| semantic | 1028 | admin | days_since_last_ticket group_by=has_assignee time=last_7d | UNMAPPED | 0.7387050076041667 | None |
| semantic | 1028 | admin | days_since_last_ticket group_by=has_resolver time=last_7d | UNMAPPED | 0.738742148912037 | None |
| semantic | 1028 | admin | days_since_last_ticket group_by=has_first_response time=last_7d | UNMAPPED | 0.9288375100925926 | None |
| semantic | 1028 | admin | days_since_last_ticket group_by=has_csat_rating time=last_7d | UNMAPPED | 0.7388169410763888 | None |
| semantic | 1028 | admin | days_since_last_ticket group_by=is_overdue time=last_7d | UNMAPPED | 0.8730773635185185 | None |
| semantic | 1028 | admin | decided_approvals_metric group_by=- time=all_time | UNMAPPED | 1354.0 | None |
| semantic | 1028 | admin | decided_approvals_metric group_by=- time=today | UNMAPPED | 16.0 | None |
| semantic | 1028 | admin | decided_approvals_metric group_by=- time=last_7d | UNMAPPED | 1354.0 | None |
| semantic | 1028 | admin | decided_approvals_metric group_by=- time=last_30d | UNMAPPED | 1354.0 | None |
| semantic | 1028 | admin | decided_approvals_metric group_by=agent_id time=last_7d | UNMAPPED | 142.0 | None |
| semantic | 1028 | admin | decided_approvals_metric group_by=status time=last_7d | UNMAPPED | 1354.0 | None |
| semantic | 1028 | admin | decided_approvals_metric group_by=tool_name time=last_7d | UNMAPPED | 142.0 | None |
| semantic | 1028 | admin | decided_approvals_metric group_by=ticket_priority time=last_7d | UNMAPPED | 291.0 | None |
| semantic | 1028 | admin | decided_approvals_metric group_by=ticket_status time=last_7d | UNMAPPED | 1089.0 | None |
| semantic | 1028 | admin | decided_approvals_metric group_by=queue_name time=last_7d | UNMAPPED | 87.0 | None |
| semantic | 1028 | admin | decision_hours_total group_by=- time=all_time | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | decision_hours_total group_by=- time=today | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | decision_hours_total group_by=- time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | decision_hours_total group_by=- time=last_30d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | decision_hours_total group_by=agent_id time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | decision_hours_total group_by=status time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | decision_hours_total group_by=tool_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | decision_hours_total group_by=ticket_priority time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | decision_hours_total group_by=ticket_status time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | decision_hours_total group_by=queue_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | dismissed_recommendations_metric group_by=- time=all_time | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | dismissed_recommendations_metric group_by=- time=today | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | dismissed_recommendations_metric group_by=- time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | dismissed_recommendations_metric group_by=- time=last_30d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | dismissed_recommendations_metric group_by=agent_id time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | dismissed_recommendations_metric group_by=status time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | dismissed_recommendations_metric group_by=ticket_priority time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | dismissed_recommendations_metric group_by=ticket_status time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | dismissed_recommendations_metric group_by=queue_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | distinct_agents_in_queues group_by=- time=all_time | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | distinct_agents_in_queues group_by=- time=today | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | distinct_agents_in_queues group_by=- time=last_7d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | distinct_agents_in_queues group_by=- time=last_30d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | distinct_agents_in_queues group_by=queue_name time=last_7d | UNMAPPED | 3.0 | None |
| semantic | 1028 | admin | distinct_agents_in_queues group_by=queue_type time=last_7d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | distinct_agents_in_queues group_by=sla_status time=last_7d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | distinct_agents_in_queues group_by=user_name time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | distinct_agents_in_queues group_by=user_role time=last_7d | UNMAPPED | 3.0 | None |
| semantic | 1028 | admin | distinct_agents_in_queues group_by=myaccount_team_name time=last_7d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | distinct_agents_in_queues group_by=team_supports_ticketing time=last_7d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | distinct_queues_covered group_by=- time=all_time | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | distinct_queues_covered group_by=- time=today | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | distinct_queues_covered group_by=- time=last_7d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | distinct_queues_covered group_by=- time=last_30d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | distinct_queues_covered group_by=queue_name time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | distinct_queues_covered group_by=queue_type time=last_7d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | distinct_queues_covered group_by=sla_status time=last_7d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | distinct_queues_covered group_by=user_name time=last_7d | UNMAPPED | 5.0 | None |
| semantic | 1028 | admin | distinct_queues_covered group_by=user_role time=last_7d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | distinct_queues_covered group_by=myaccount_team_name time=last_7d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | distinct_queues_covered group_by=team_supports_ticketing time=last_7d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | due_today_tickets_metric group_by=- time=all_time | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | due_today_tickets_metric group_by=- time=today | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | due_today_tickets_metric group_by=- time=last_7d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | due_today_tickets_metric group_by=- time=last_30d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | due_today_tickets_metric group_by=status time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | due_today_tickets_metric group_by=status_display_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | due_today_tickets_metric group_by=is_closed_by_status time=last_7d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | due_today_tickets_metric group_by=priority time=last_7d | UNMAPPED | 3.0 | None |
| semantic | 1028 | admin | due_today_tickets_metric group_by=channel time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | due_today_tickets_metric group_by=category time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | due_today_tickets_metric group_by=skill time=last_7d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | due_today_tickets_metric group_by=assignee_name time=last_7d | UNMAPPED | 5.0 | None |
| semantic | 1028 | admin | due_today_tickets_metric group_by=assignee_role time=last_7d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | due_today_tickets_metric group_by=resolver_name time=last_7d | UNMAPPED | 3.0 | None |
| semantic | 1028 | admin | due_today_tickets_metric group_by=queue_name time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | due_today_tickets_metric group_by=queue_type time=last_7d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | due_today_tickets_metric group_by=account_name time=last_7d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | due_today_tickets_metric group_by=organization_name time=last_7d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | due_today_tickets_metric group_by=organization_business_type time=last_7d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | due_today_tickets_metric group_by=team_supports_ticketing time=last_7d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | due_today_tickets_metric group_by=created_by_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | due_today_tickets_metric group_by=customer_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | due_today_tickets_metric group_by=has_assignee time=last_7d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | due_today_tickets_metric group_by=has_resolver time=last_7d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | due_today_tickets_metric group_by=has_first_response time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | due_today_tickets_metric group_by=has_csat_rating time=last_7d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | due_today_tickets_metric group_by=is_overdue time=last_7d | UNMAPPED | 3.0 | None |
| semantic | 1028 | admin | escalation_rate group_by=- time=all_time | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | escalation_rate group_by=- time=today | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | escalation_rate group_by=- time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | escalation_rate group_by=- time=last_30d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | escalation_rate group_by=status time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | escalation_rate group_by=status_display_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | escalation_rate group_by=is_closed_by_status time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | escalation_rate group_by=priority time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | escalation_rate group_by=channel time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | escalation_rate group_by=category time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | escalation_rate group_by=skill time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | escalation_rate group_by=assignee_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | escalation_rate group_by=assignee_role time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | escalation_rate group_by=resolver_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | escalation_rate group_by=queue_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | escalation_rate group_by=queue_type time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | escalation_rate group_by=account_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | escalation_rate group_by=organization_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | escalation_rate group_by=organization_business_type time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | escalation_rate group_by=team_supports_ticketing time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | escalation_rate group_by=created_by_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | escalation_rate group_by=customer_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | escalation_rate group_by=has_assignee time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | escalation_rate group_by=has_resolver time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | escalation_rate group_by=has_first_response time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | escalation_rate group_by=has_csat_rating time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | escalation_rate group_by=is_overdue time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | escalation_volume group_by=- time=all_time | MISMATCH | 0.0 | 1501 |
| semantic | 1028 | admin | escalation_volume group_by=- time=today | PASS | 0.0 | 0 |
| semantic | 1028 | admin | escalation_volume group_by=- time=last_7d | MISMATCH | 0.0 | 117 |
| semantic | 1028 | admin | escalation_volume group_by=- time=last_30d | MISMATCH | 0.0 | 517 |
| semantic | 1028 | admin | escalation_volume group_by=action time=last_7d | MISMATCH | 0.0 | 117 |
| semantic | 1028 | admin | escalation_volume group_by=ticket_priority time=last_7d | MISMATCH | 0.0 | 117 |
| semantic | 1028 | admin | escalation_volume group_by=ticket_status time=last_7d | MISMATCH | 0.0 | 117 |
| semantic | 1028 | admin | escalation_volume group_by=queue_name time=last_7d | PASS | 0.0 | 7 buckets |
| semantic | 1028 | admin | escalation_volume group_by=assignee_name time=last_7d | PASS | 0.0 | 3 buckets |
| semantic | 1028 | admin | escalation_volume group_by=actor_name time=last_7d | MISMATCH | 0.0 | 117 |
| semantic | 1028 | admin | first_response_coverage_rate group_by=- time=all_time | MISMATCH | 0.9187208527648234 | 11.222629041959754 |
| semantic | 1028 | admin | first_response_coverage_rate group_by=- time=today | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | first_response_coverage_rate group_by=- time=last_7d | MISMATCH | 0.8974358974358975 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_coverage_rate group_by=- time=last_30d | MISMATCH | 0.9148936170212766 | 11.202971350660677 |
| semantic | 1028 | admin | first_response_coverage_rate group_by=status time=last_7d | PASS | 1.0 | 6 buckets |
| semantic | 1028 | admin | first_response_coverage_rate group_by=status_display_name time=last_7d | MISMATCH | 1.0 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_coverage_rate group_by=is_closed_by_status time=last_7d | MISMATCH | 0.875 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_coverage_rate group_by=priority time=last_7d | PASS | 0.8536585365853658 | 4 buckets |
| semantic | 1028 | admin | first_response_coverage_rate group_by=channel time=last_7d | PASS | 0.9 | 4 buckets |
| semantic | 1028 | admin | first_response_coverage_rate group_by=category time=last_7d | PASS | 1.0 | 40 buckets |
| semantic | 1028 | admin | first_response_coverage_rate group_by=skill time=last_7d | MISMATCH | 0.8974358974358975 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_coverage_rate group_by=assignee_name time=last_7d | PASS | 0.9285714285714286 | 3 buckets |
| semantic | 1028 | admin | first_response_coverage_rate group_by=assignee_role time=last_7d | MISMATCH | 0.8974358974358975 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_coverage_rate group_by=resolver_name time=last_7d | PASS | 0.8604651162790697 | 4 buckets |
| semantic | 1028 | admin | first_response_coverage_rate group_by=queue_name time=last_7d | PASS | 0.8 | 7 buckets |
| semantic | 1028 | admin | first_response_coverage_rate group_by=queue_type time=last_7d | MISMATCH | 0.8974358974358975 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_coverage_rate group_by=account_name time=last_7d | MISMATCH | 0.8974358974358975 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_coverage_rate group_by=organization_name time=last_7d | MISMATCH | 0.8974358974358975 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_coverage_rate group_by=organization_business_type time=last_7d | MISMATCH | 0.8974358974358975 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_coverage_rate group_by=team_supports_ticketing time=last_7d | MISMATCH | 0.8974358974358975 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_coverage_rate group_by=created_by_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | first_response_coverage_rate group_by=customer_name time=last_7d | PASS | 1.0 | 112 buckets |
| semantic | 1028 | admin | first_response_coverage_rate group_by=has_assignee time=last_7d | MISMATCH | 0.8974358974358975 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_coverage_rate group_by=has_resolver time=last_7d | MISMATCH | 0.8974358974358975 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_coverage_rate group_by=has_first_response time=last_7d | MISMATCH | 0.0 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_coverage_rate group_by=has_csat_rating time=last_7d | MISMATCH | 0.8518518518518519 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_coverage_rate group_by=is_overdue time=last_7d | MISMATCH | 0.9622641509433962 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_hours_total group_by=- time=all_time | MISMATCH | 15476.0054488625 | 11.222629041959754 |
| semantic | 1028 | admin | first_response_hours_total group_by=- time=today | UNMAPPED | 24.0 | None |
| semantic | 1028 | admin | first_response_hours_total group_by=- time=last_7d | MISMATCH | 1114.0054488625 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_hours_total group_by=- time=last_30d | MISMATCH | 5299.0054488625 | 11.202971350660677 |
| semantic | 1028 | admin | first_response_hours_total group_by=status time=last_7d | PASS | 218.0 | 6 buckets |
| semantic | 1028 | admin | first_response_hours_total group_by=status_display_name time=last_7d | MISMATCH | 218.0 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_hours_total group_by=is_closed_by_status time=last_7d | MISMATCH | 896.0054488625 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_hours_total group_by=priority time=last_7d | PASS | 362.0054488625 | 4 buckets |
| semantic | 1028 | admin | first_response_hours_total group_by=channel time=last_7d | PASS | 198.0 | 4 buckets |
| semantic | 1028 | admin | first_response_hours_total group_by=category time=last_7d | PASS | 12.0 | 40 buckets |
| semantic | 1028 | admin | first_response_hours_total group_by=skill time=last_7d | MISMATCH | 1114.0054488625 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_hours_total group_by=assignee_name time=last_7d | PASS | 484.0054488625 | 3 buckets |
| semantic | 1028 | admin | first_response_hours_total group_by=assignee_role time=last_7d | MISMATCH | 1114.0054488625 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_hours_total group_by=resolver_name time=last_7d | PASS | 299.0054488625 | 4 buckets |
| semantic | 1028 | admin | first_response_hours_total group_by=queue_name time=last_7d | PASS | 121.0 | 7 buckets |
| semantic | 1028 | admin | first_response_hours_total group_by=queue_type time=last_7d | MISMATCH | 1114.0054488625 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_hours_total group_by=account_name time=last_7d | MISMATCH | 1114.0054488625 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_hours_total group_by=organization_name time=last_7d | MISMATCH | 1114.0054488625 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_hours_total group_by=organization_business_type time=last_7d | MISMATCH | 1114.0054488625 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_hours_total group_by=team_supports_ticketing time=last_7d | MISMATCH | 1114.0054488625 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_hours_total group_by=created_by_name time=last_7d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | first_response_hours_total group_by=customer_name time=last_7d | PASS | 10.0 | 112 buckets |
| semantic | 1028 | admin | first_response_hours_total group_by=has_assignee time=last_7d | MISMATCH | 1114.0054488625 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_hours_total group_by=has_resolver time=last_7d | MISMATCH | 1114.0054488625 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_hours_total group_by=has_first_response time=last_7d | MISMATCH | 1114.0054488625 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_hours_total group_by=has_csat_rating time=last_7d | MISMATCH | 705.0054488625 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_hours_total group_by=is_overdue time=last_7d | MISMATCH | 562.0 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_compliance_rate group_by=- time=all_time | MISMATCH | 0.17113850616388687 | 11.222629041959754 |
| semantic | 1028 | admin | first_response_sla_compliance_rate group_by=- time=today | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | first_response_sla_compliance_rate group_by=- time=last_7d | MISMATCH | 0.17142857142857143 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_compliance_rate group_by=- time=last_30d | MISMATCH | 0.1733615221987315 | 11.202971350660677 |
| semantic | 1028 | admin | first_response_sla_compliance_rate group_by=status time=last_7d | PASS | 0.09523809523809523 | 6 buckets |
| semantic | 1028 | admin | first_response_sla_compliance_rate group_by=status_display_name time=last_7d | MISMATCH | 0.09523809523809523 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_compliance_rate group_by=is_closed_by_status time=last_7d | MISMATCH | 0.19047619047619047 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_compliance_rate group_by=priority time=last_7d | PASS | 0.05714285714285714 | 4 buckets |
| semantic | 1028 | admin | first_response_sla_compliance_rate group_by=channel time=last_7d | PASS | 0.16666666666666666 | 4 buckets |
| semantic | 1028 | admin | first_response_sla_compliance_rate group_by=category time=last_7d | PASS | 0.0 | 40 buckets |
| semantic | 1028 | admin | first_response_sla_compliance_rate group_by=skill time=last_7d | MISMATCH | 0.17142857142857143 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_compliance_rate group_by=assignee_name time=last_7d | PASS | 0.23076923076923078 | 3 buckets |
| semantic | 1028 | admin | first_response_sla_compliance_rate group_by=assignee_role time=last_7d | MISMATCH | 0.17142857142857143 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_compliance_rate group_by=resolver_name time=last_7d | PASS | 0.2702702702702703 | 4 buckets |
| semantic | 1028 | admin | first_response_sla_compliance_rate group_by=queue_name time=last_7d | PASS | 0.16666666666666666 | 7 buckets |
| semantic | 1028 | admin | first_response_sla_compliance_rate group_by=queue_type time=last_7d | MISMATCH | 0.17142857142857143 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_compliance_rate group_by=account_name time=last_7d | MISMATCH | 0.17142857142857143 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_compliance_rate group_by=organization_name time=last_7d | MISMATCH | 0.17142857142857143 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_compliance_rate group_by=organization_business_type time=last_7d | MISMATCH | 0.17142857142857143 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_compliance_rate group_by=team_supports_ticketing time=last_7d | MISMATCH | 0.17142857142857143 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_compliance_rate group_by=created_by_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | first_response_sla_compliance_rate group_by=customer_name time=last_7d | PASS | 0.0 | 112 buckets |
| semantic | 1028 | admin | first_response_sla_compliance_rate group_by=has_assignee time=last_7d | MISMATCH | 0.17142857142857143 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_compliance_rate group_by=has_resolver time=last_7d | MISMATCH | 0.17142857142857143 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_compliance_rate group_by=has_first_response time=last_7d | MISMATCH | 0.0 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_compliance_rate group_by=has_csat_rating time=last_7d | MISMATCH | 0.18840579710144928 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_compliance_rate group_by=is_overdue time=last_7d | MISMATCH | 0.1568627450980392 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_met_metric group_by=- time=all_time | MISMATCH | 236.0 | 11.222629041959754 |
| semantic | 1028 | admin | first_response_sla_met_metric group_by=- time=today | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | first_response_sla_met_metric group_by=- time=last_7d | MISMATCH | 18.0 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_met_metric group_by=- time=last_30d | MISMATCH | 82.0 | 11.202971350660677 |
| semantic | 1028 | admin | first_response_sla_met_metric group_by=status time=last_7d | PASS | 2.0 | 6 buckets |
| semantic | 1028 | admin | first_response_sla_met_metric group_by=status_display_name time=last_7d | MISMATCH | 2.0 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_met_metric group_by=is_closed_by_status time=last_7d | MISMATCH | 16.0 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_met_metric group_by=priority time=last_7d | PASS | 2.0 | 4 buckets |
| semantic | 1028 | admin | first_response_sla_met_metric group_by=channel time=last_7d | PASS | 3.0 | 4 buckets |
| semantic | 1028 | admin | first_response_sla_met_metric group_by=category time=last_7d | PASS | 0.0 | 40 buckets |
| semantic | 1028 | admin | first_response_sla_met_metric group_by=skill time=last_7d | MISMATCH | 18.0 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_met_metric group_by=assignee_name time=last_7d | PASS | 12.0 | 3 buckets |
| semantic | 1028 | admin | first_response_sla_met_metric group_by=assignee_role time=last_7d | MISMATCH | 18.0 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_met_metric group_by=resolver_name time=last_7d | PASS | 10.0 | 4 buckets |
| semantic | 1028 | admin | first_response_sla_met_metric group_by=queue_name time=last_7d | PASS | 2.0 | 7 buckets |
| semantic | 1028 | admin | first_response_sla_met_metric group_by=queue_type time=last_7d | MISMATCH | 18.0 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_met_metric group_by=account_name time=last_7d | MISMATCH | 18.0 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_met_metric group_by=organization_name time=last_7d | MISMATCH | 18.0 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_met_metric group_by=organization_business_type time=last_7d | MISMATCH | 18.0 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_met_metric group_by=team_supports_ticketing time=last_7d | MISMATCH | 18.0 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_met_metric group_by=created_by_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | first_response_sla_met_metric group_by=customer_name time=last_7d | PASS | 0.0 | 112 buckets |
| semantic | 1028 | admin | first_response_sla_met_metric group_by=has_assignee time=last_7d | MISMATCH | 18.0 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_met_metric group_by=has_resolver time=last_7d | MISMATCH | 18.0 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_met_metric group_by=has_first_response time=last_7d | MISMATCH | 0.0 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_met_metric group_by=has_csat_rating time=last_7d | MISMATCH | 13.0 | 10.60957570345238 |
| semantic | 1028 | admin | first_response_sla_met_metric group_by=is_overdue time=last_7d | MISMATCH | 8.0 | 10.60957570345238 |
| semantic | 1028 | admin | high_priority_open_tickets_metric group_by=- time=all_time | MISMATCH | 1.0 | 904 |
| semantic | 1028 | admin | high_priority_open_tickets_metric group_by=- time=today | PASS | 0.0 | 0 |
| semantic | 1028 | admin | high_priority_open_tickets_metric group_by=- time=last_7d | MISMATCH | 1.0 | 70 |
| semantic | 1028 | admin | high_priority_open_tickets_metric group_by=- time=last_30d | MISMATCH | 1.0 | 302 |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=- time=all_time | MISMATCH | 539.0 | 1501 |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=- time=today | PASS | 0.0 | 0 |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=- time=last_7d | MISMATCH | 46.0 | 117 |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=- time=last_30d | MISMATCH | 194.0 | 517 |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=created_at time=last_7d | MISMATCH | 9.0 | 117 |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=resolved_at time=last_7d | MISMATCH | 1.0 | 117 |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=due_at time=last_7d | MISMATCH | 10.0 | 117 |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=status time=last_7d | PASS | 9.0 | 6 buckets |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=status_display_name time=last_7d | MISMATCH | 9.0 | 117 |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=is_closed_by_status time=last_7d | MISMATCH | 37.0 | 117 |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=priority time=last_7d | PASS | 41.0 | 4 buckets |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=channel time=last_7d | PASS | 13.0 | 4 buckets |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=category time=last_7d | PASS | 0.0 | 40 buckets |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=skill time=last_7d | MISMATCH | 46.0 | 117 |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=assignee_name time=last_7d | PASS | 24.0 | 3 buckets |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=assignee_role time=last_7d | MISMATCH | 46.0 | 117 |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=resolver_name time=last_7d | PASS | 17.0 | 4 buckets |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=queue_name time=last_7d | PASS | 8.0 | 7 buckets |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=queue_type time=last_7d | MISMATCH | 46.0 | 117 |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=account_name time=last_7d | MISMATCH | 46.0 | 117 |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=organization_name time=last_7d | MISMATCH | 46.0 | 117 |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=organization_business_type time=last_7d | MISMATCH | 46.0 | 117 |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=team_supports_ticketing time=last_7d | MISMATCH | 46.0 | 117 |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=created_by_name time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=customer_name time=last_7d | PASS | 1.0 | 112 buckets |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=has_assignee time=last_7d | MISMATCH | 46.0 | 117 |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=has_resolver time=last_7d | MISMATCH | 46.0 | 117 |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=has_first_response time=last_7d | MISMATCH | 6.0 | 117 |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=has_csat_rating time=last_7d | MISMATCH | 35.0 | 117 |
| semantic | 1028 | admin | high_priority_ticket_volume group_by=is_overdue time=last_7d | MISMATCH | 16.0 | 117 |
| semantic | 1028 | admin | internal_note_ratio group_by=- time=all_time | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | internal_note_ratio group_by=- time=today | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | internal_note_ratio group_by=- time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | internal_note_ratio group_by=- time=last_30d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | internal_note_ratio group_by=visibility time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | internal_note_ratio group_by=is_internal_note time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | internal_note_ratio group_by=ticket_priority time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | internal_note_ratio group_by=ticket_status time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | internal_note_ratio group_by=queue_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | internal_note_ratio group_by=assignee_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | internal_note_ratio group_by=author_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | internal_note_volume group_by=- time=all_time | MISMATCH | 0.0 | 1501 |
| semantic | 1028 | admin | internal_note_volume group_by=- time=today | PASS | 0.0 | 0 |
| semantic | 1028 | admin | internal_note_volume group_by=- time=last_7d | MISMATCH | 0.0 | 117 |
| semantic | 1028 | admin | internal_note_volume group_by=- time=last_30d | MISMATCH | 0.0 | 517 |
| semantic | 1028 | admin | internal_note_volume group_by=visibility time=last_7d | MISMATCH | 0.0 | 117 |
| semantic | 1028 | admin | internal_note_volume group_by=is_internal_note time=last_7d | MISMATCH | 0.0 | 117 |
| semantic | 1028 | admin | internal_note_volume group_by=ticket_priority time=last_7d | MISMATCH | 0.0 | 117 |
| semantic | 1028 | admin | internal_note_volume group_by=ticket_status time=last_7d | MISMATCH | 0.0 | 117 |
| semantic | 1028 | admin | internal_note_volume group_by=queue_name time=last_7d | PASS | 0.0 | 7 buckets |
| semantic | 1028 | admin | internal_note_volume group_by=assignee_name time=last_7d | PASS | 0.0 | 3 buckets |
| semantic | 1028 | admin | internal_note_volume group_by=author_name time=last_7d | MISMATCH | 0.0 | 117 |
| semantic | 1028 | admin | kb_article_volume group_by=- time=all_time | MISMATCH | 0.0 | 1501 |
| semantic | 1028 | admin | kb_article_volume group_by=- time=today | PASS | 0.0 | 0 |
| semantic | 1028 | admin | kb_article_volume group_by=- time=last_7d | MISMATCH | 0.0 | 117 |
| semantic | 1028 | admin | kb_article_volume group_by=- time=last_30d | MISMATCH | 0.0 | 517 |
| semantic | 1028 | admin | kb_article_volume group_by=category time=last_7d | MISMATCH | None | 41 buckets |
| semantic | 1028 | admin | kb_article_volume group_by=status time=last_7d | MISMATCH | None | 6 buckets |
| semantic | 1028 | admin | kb_article_volume group_by=author_name time=last_7d | GAP | None | 118 |
| semantic | 1028 | admin | kb_published_article_metric group_by=- time=all_time | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | kb_published_article_metric group_by=- time=today | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | kb_published_article_metric group_by=- time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | kb_published_article_metric group_by=- time=last_30d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | kb_published_article_metric group_by=category time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | kb_published_article_metric group_by=status time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | kb_published_article_metric group_by=author_name time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | kb_views_total group_by=- time=all_time | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | kb_views_total group_by=- time=today | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | kb_views_total group_by=- time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | kb_views_total group_by=- time=last_30d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | kb_views_total group_by=category time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | kb_views_total group_by=status time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | kb_views_total group_by=author_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | macro_volume group_by=- time=all_time | MISMATCH | 1.0 | 1502 |
| semantic | 1028 | admin | macro_volume group_by=- time=today | MISMATCH | 0.0 | 1 |
| semantic | 1028 | admin | macro_volume group_by=- time=last_7d | MISMATCH | 1.0 | 118 |
| semantic | 1028 | admin | macro_volume group_by=- time=last_30d | MISMATCH | 1.0 | 518 |
| semantic | 1028 | admin | note_volume group_by=- time=all_time | MISMATCH | 158.0 | 1502 |
| semantic | 1028 | admin | note_volume group_by=- time=today | MISMATCH | 7.0 | 1 |
| semantic | 1028 | admin | note_volume group_by=- time=last_7d | MISMATCH | 158.0 | 118 |
| semantic | 1028 | admin | note_volume group_by=- time=last_30d | MISMATCH | 158.0 | 518 |
| semantic | 1028 | admin | note_volume group_by=visibility time=last_7d | MISMATCH | 158.0 | 118 |
| semantic | 1028 | admin | note_volume group_by=is_internal_note time=last_7d | MISMATCH | 158.0 | 118 |
| semantic | 1028 | admin | note_volume group_by=ticket_priority time=last_7d | MISMATCH | 51.0 | 118 |
| semantic | 1028 | admin | note_volume group_by=ticket_status time=last_7d | MISMATCH | 158.0 | 118 |
| semantic | 1028 | admin | note_volume group_by=queue_name time=last_7d | PASS | 10.0 | 7 buckets |
| semantic | 1028 | admin | note_volume group_by=assignee_name time=last_7d | PASS | 54.0 | 3 buckets |
| semantic | 1028 | admin | note_volume group_by=author_name time=last_7d | MISMATCH | 158.0 | 118 |
| semantic | 1028 | admin | notification_volume group_by=- time=all_time | MISMATCH | 47693.0 | 1502 |
| semantic | 1028 | admin | notification_volume group_by=- time=today | MISMATCH | 5552.0 | 1 |
| semantic | 1028 | admin | notification_volume group_by=- time=last_7d | MISMATCH | 47693.0 | 118 |
| semantic | 1028 | admin | notification_volume group_by=- time=last_30d | MISMATCH | 47693.0 | 518 |
| semantic | 1028 | admin | notification_volume group_by=kind time=last_7d | MISMATCH | 6.0 | 118 |
| semantic | 1028 | admin | notification_volume group_by=is_read time=last_7d | MISMATCH | 47693.0 | 118 |
| semantic | 1028 | admin | open_recommendations_metric group_by=- time=all_time | MISMATCH | 133.0 | 905 |
| semantic | 1028 | admin | open_recommendations_metric group_by=- time=today | MISMATCH | 69.0 | 1 |
| semantic | 1028 | admin | open_recommendations_metric group_by=- time=last_7d | MISMATCH | 133.0 | 71 |
| semantic | 1028 | admin | open_recommendations_metric group_by=- time=last_30d | MISMATCH | 133.0 | 303 |
| semantic | 1028 | admin | open_recommendations_metric group_by=agent_id time=last_7d | MISMATCH | 8.0 | 71 |
| semantic | 1028 | admin | open_recommendations_metric group_by=status time=last_7d | PASS | 133.0 | 6 buckets |
| semantic | 1028 | admin | open_recommendations_metric group_by=ticket_priority time=last_7d | MISMATCH | 2.0 | 71 |
| semantic | 1028 | admin | open_recommendations_metric group_by=ticket_status time=last_7d | MISMATCH | 8.0 | 71 |
| semantic | 1028 | admin | open_recommendations_metric group_by=queue_name time=last_7d | PASS | 1.0 | 7 buckets |
| semantic | 1028 | admin | open_ticket_age_days_total group_by=- time=all_time | MISMATCH | 2.1321515507175928 | 905 |
| semantic | 1028 | admin | open_ticket_age_days_total group_by=- time=today | MISMATCH | 0.0 | 1 |
| semantic | 1028 | admin | open_ticket_age_days_total group_by=- time=last_7d | MISMATCH | 2.1323288649305554 | 71 |
| semantic | 1028 | admin | open_ticket_age_days_total group_by=- time=last_30d | MISMATCH | 2.1324214349074073 | 303 |
| semantic | 1028 | admin | open_ticket_age_days_total group_by=status time=last_7d | PASS | 0.0 | 6 buckets |
| semantic | 1028 | admin | open_ticket_age_days_total group_by=status_display_name time=last_7d | MISMATCH | 0.0 | 71 |
| semantic | 1028 | admin | open_ticket_age_days_total group_by=is_closed_by_status time=last_7d | MISMATCH | 2.1326867157638887 | 71 |
| semantic | 1028 | admin | open_ticket_age_days_total group_by=priority time=last_7d | PASS | 0.9430313428819445 | 4 buckets |
| semantic | 1028 | admin | open_ticket_age_days_total group_by=channel time=last_7d | PASS | 0.0 | 4 buckets |
| semantic | 1028 | admin | open_ticket_age_days_total group_by=category time=last_7d | PASS | 0.0 | 40 buckets |
| semantic | 1028 | admin | open_ticket_age_days_total group_by=skill time=last_7d | MISMATCH | 2.133041448333333 | 71 |
| semantic | 1028 | admin | open_ticket_age_days_total group_by=assignee_name time=last_7d | PASS | 0.9432088021527778 | 3 buckets |
| semantic | 1028 | admin | open_ticket_age_days_total group_by=assignee_role time=last_7d | MISMATCH | 2.133219375509259 | 71 |
| semantic | 1028 | admin | open_ticket_age_days_total group_by=resolver_name time=last_7d | PASS | 2.1333080338425927 | 4 buckets |
| semantic | 1028 | admin | open_ticket_age_days_total group_by=queue_name time=last_7d | PASS | 0.0 | 7 buckets |
| semantic | 1028 | admin | open_ticket_age_days_total group_by=queue_type time=last_7d | MISMATCH | 2.1334855593287037 | 71 |
| semantic | 1028 | admin | open_ticket_age_days_total group_by=account_name time=last_7d | MISMATCH | 2.1335741552314813 | 71 |
| semantic | 1028 | admin | open_ticket_age_days_total group_by=organization_name time=last_7d | MISMATCH | 2.1336629070833335 | 71 |
| semantic | 1028 | admin | open_ticket_age_days_total group_by=organization_business_type time=last_7d | MISMATCH | 2.133751518101852 | 71 |
| semantic | 1028 | admin | open_ticket_age_days_total group_by=team_supports_ticketing time=last_7d | MISMATCH | 2.133840108032407 | 71 |
| semantic | 1028 | admin | open_ticket_age_days_total group_by=created_by_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | open_ticket_age_days_total group_by=customer_name time=last_7d | PASS | 0.0 | 113 buckets |
| semantic | 1028 | admin | open_ticket_age_days_total group_by=has_assignee time=last_7d | MISMATCH | 2.134089793472222 | 71 |
| semantic | 1028 | admin | open_ticket_age_days_total group_by=has_resolver time=last_7d | MISMATCH | 2.1341784049305557 | 71 |
| semantic | 1028 | admin | open_ticket_age_days_total group_by=has_first_response time=last_7d | MISMATCH | 2.1342673420601854 | 71 |
| semantic | 1028 | admin | open_ticket_age_days_total group_by=has_csat_rating time=last_7d | MISMATCH | 2.1343560650925926 | 71 |
| semantic | 1028 | admin | open_ticket_age_days_total group_by=is_overdue time=last_7d | MISMATCH | 2.1344460420833333 | 71 |
| semantic | 1028 | admin | open_tickets_metric group_by=- time=all_time | CL_ERROR | None | 905 |
| semantic | 1028 | admin | open_tickets_metric group_by=- time=today | CL_ERROR | None | 1 |
| semantic | 1028 | admin | open_tickets_metric group_by=- time=last_7d | CL_ERROR | None | 71 |
| semantic | 1028 | admin | open_tickets_metric group_by=- time=last_30d | CL_ERROR | None | 303 |
| semantic | 1028 | admin | open_tickets_metric group_by=priority time=last_7d | CL_ERROR | None | grouped |
| semantic | 1028 | admin | open_tickets_metric group_by=queue_name time=last_7d | CL_ERROR | None | grouped |
| semantic | 1028 | admin | open_tickets_metric group_by=status time=last_7d | CL_ERROR | None | grouped |
| semantic | 1028 | admin | outbound_email_volume group_by=- time=all_time | CL_ERROR | None | 1502 |
| semantic | 1028 | admin | outbound_email_volume group_by=- time=today | CL_ERROR | None | 1 |
| semantic | 1028 | admin | outbound_email_volume group_by=- time=last_7d | CL_ERROR | None | 118 |
| semantic | 1028 | admin | outbound_email_volume group_by=- time=last_30d | CL_ERROR | None | 518 |
| semantic | 1028 | admin | outbound_email_volume group_by=kind time=last_7d | CL_ERROR | None | 118 |
| semantic | 1028 | admin | outbound_email_volume group_by=status time=last_7d | CL_ERROR | None | grouped |
| semantic | 1028 | admin | pending_approvals_metric group_by=- time=all_time | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_approvals_metric group_by=- time=today | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_approvals_metric group_by=- time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_approvals_metric group_by=- time=last_30d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_approvals_metric group_by=agent_id time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_approvals_metric group_by=status time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_approvals_metric group_by=tool_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_approvals_metric group_by=ticket_priority time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_approvals_metric group_by=ticket_status time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_approvals_metric group_by=queue_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_tickets_metric group_by=- time=all_time | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_tickets_metric group_by=- time=today | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_tickets_metric group_by=- time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_tickets_metric group_by=- time=last_30d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_tickets_metric group_by=status time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_tickets_metric group_by=status_display_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_tickets_metric group_by=is_closed_by_status time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_tickets_metric group_by=priority time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_tickets_metric group_by=channel time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_tickets_metric group_by=category time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_tickets_metric group_by=skill time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_tickets_metric group_by=assignee_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_tickets_metric group_by=assignee_role time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_tickets_metric group_by=resolver_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_tickets_metric group_by=queue_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_tickets_metric group_by=queue_type time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_tickets_metric group_by=account_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_tickets_metric group_by=organization_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_tickets_metric group_by=organization_business_type time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_tickets_metric group_by=team_supports_ticketing time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_tickets_metric group_by=created_by_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_tickets_metric group_by=customer_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_tickets_metric group_by=has_assignee time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_tickets_metric group_by=has_resolver time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_tickets_metric group_by=has_first_response time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_tickets_metric group_by=has_csat_rating time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | pending_tickets_metric group_by=is_overdue time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | proactive_audit_volume group_by=- time=all_time | CL_ERROR | None | 1502 |
| semantic | 1028 | admin | proactive_audit_volume group_by=- time=today | CL_ERROR | None | 1 |
| semantic | 1028 | admin | proactive_audit_volume group_by=- time=last_7d | CL_ERROR | None | 118 |
| semantic | 1028 | admin | proactive_audit_volume group_by=- time=last_30d | CL_ERROR | None | 518 |
| semantic | 1028 | admin | proactive_audit_volume group_by=agent_id time=last_7d | CL_ERROR | None | 118 |
| semantic | 1028 | admin | proactive_audit_volume group_by=decision time=last_7d | CL_ERROR | None | 118 |
| semantic | 1028 | admin | queue_count group_by=- time=all_time | CL_ERROR | None | None |
| semantic | 1028 | admin | queue_count group_by=- time=today | CL_ERROR | None | None |
| semantic | 1028 | admin | queue_count group_by=- time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | queue_count group_by=- time=last_30d | CL_ERROR | None | None |
| semantic | 1028 | admin | queue_count group_by=queue_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | queue_count group_by=queue_type time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | queue_count group_by=sla_status time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | queue_coverage_count group_by=- time=all_time | CL_ERROR | None | None |
| semantic | 1028 | admin | queue_coverage_count group_by=- time=today | CL_ERROR | None | None |
| semantic | 1028 | admin | queue_coverage_count group_by=- time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | queue_coverage_count group_by=- time=last_30d | CL_ERROR | None | None |
| semantic | 1028 | admin | queue_coverage_count group_by=queue_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | queue_coverage_count group_by=queue_type time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | queue_coverage_count group_by=sla_status time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | queue_coverage_count group_by=user_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | queue_coverage_count group_by=user_role time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | queue_coverage_count group_by=myaccount_team_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | queue_coverage_count group_by=team_supports_ticketing time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | queues_at_risk_metric group_by=- time=all_time | CL_ERROR | None | None |
| semantic | 1028 | admin | queues_at_risk_metric group_by=- time=today | CL_ERROR | None | None |
| semantic | 1028 | admin | queues_at_risk_metric group_by=- time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | queues_at_risk_metric group_by=- time=last_30d | CL_ERROR | None | None |
| semantic | 1028 | admin | queues_at_risk_metric group_by=queue_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | queues_at_risk_metric group_by=queue_type time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | queues_at_risk_metric group_by=sla_status time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | reassignment_volume group_by=- time=all_time | CL_ERROR | None | 1502 |
| semantic | 1028 | admin | reassignment_volume group_by=- time=today | CL_ERROR | None | 1 |
| semantic | 1028 | admin | reassignment_volume group_by=- time=last_7d | CL_ERROR | None | 118 |
| semantic | 1028 | admin | reassignment_volume group_by=- time=last_30d | CL_ERROR | None | 518 |
| semantic | 1028 | admin | reassignment_volume group_by=action time=last_7d | CL_ERROR | None | 118 |
| semantic | 1028 | admin | reassignment_volume group_by=ticket_priority time=last_7d | CL_ERROR | None | 118 |
| semantic | 1028 | admin | reassignment_volume group_by=ticket_status time=last_7d | CL_ERROR | None | 118 |
| semantic | 1028 | admin | reassignment_volume group_by=queue_name time=last_7d | CL_ERROR | None | grouped |
| semantic | 1028 | admin | reassignment_volume group_by=assignee_name time=last_7d | CL_ERROR | None | grouped |
| semantic | 1028 | admin | reassignment_volume group_by=actor_name time=last_7d | CL_ERROR | None | 118 |
| semantic | 1028 | admin | recommendation_acceptance_rate group_by=- time=all_time | CL_ERROR | None | None |
| semantic | 1028 | admin | recommendation_acceptance_rate group_by=- time=today | CL_ERROR | None | None |
| semantic | 1028 | admin | recommendation_acceptance_rate group_by=- time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | recommendation_acceptance_rate group_by=- time=last_30d | CL_ERROR | None | None |
| semantic | 1028 | admin | recommendation_acceptance_rate group_by=agent_id time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | recommendation_acceptance_rate group_by=status time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | recommendation_acceptance_rate group_by=ticket_priority time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | recommendation_acceptance_rate group_by=ticket_status time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | recommendation_acceptance_rate group_by=queue_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | recommendation_volume group_by=- time=all_time | CL_ERROR | None | 1502 |
| semantic | 1028 | admin | recommendation_volume group_by=- time=today | CL_ERROR | None | 1 |
| semantic | 1028 | admin | recommendation_volume group_by=- time=last_7d | CL_ERROR | None | 118 |
| semantic | 1028 | admin | recommendation_volume group_by=- time=last_30d | CL_ERROR | None | 518 |
| semantic | 1028 | admin | recommendation_volume group_by=agent_id time=last_7d | CL_ERROR | None | 118 |
| semantic | 1028 | admin | recommendation_volume group_by=status time=last_7d | CL_ERROR | None | grouped |
| semantic | 1028 | admin | recommendation_volume group_by=ticket_priority time=last_7d | CL_ERROR | None | 118 |
| semantic | 1028 | admin | recommendation_volume group_by=ticket_status time=last_7d | CL_ERROR | None | 118 |
| semantic | 1028 | admin | recommendation_volume group_by=queue_name time=last_7d | CL_ERROR | None | grouped |
| semantic | 1028 | admin | rejected_metric group_by=- time=all_time | CL_ERROR | None | None |
| semantic | 1028 | admin | rejected_metric group_by=- time=today | CL_ERROR | None | None |
| semantic | 1028 | admin | rejected_metric group_by=- time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | rejected_metric group_by=- time=last_30d | CL_ERROR | None | None |
| semantic | 1028 | admin | rejected_metric group_by=agent_id time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | rejected_metric group_by=status time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | rejected_metric group_by=tool_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | rejected_metric group_by=ticket_priority time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | rejected_metric group_by=ticket_status time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | rejected_metric group_by=queue_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | reopen_rate group_by=- time=all_time | CL_ERROR | None | 905 |
| semantic | 1028 | admin | reopen_rate group_by=- time=today | CL_ERROR | None | 1 |
| semantic | 1028 | admin | reopen_rate group_by=- time=last_7d | CL_ERROR | None | 71 |
| semantic | 1028 | admin | reopen_rate group_by=- time=last_30d | CL_ERROR | None | 303 |
| semantic | 1028 | admin | reopen_rate group_by=queue_name time=last_7d | CL_ERROR | None | grouped |
| semantic | 1028 | admin | reopen_rate group_by=priority time=last_7d | CL_ERROR | None | grouped |
| semantic | 1028 | admin | reopened_tickets_metric group_by=- time=all_time | CL_ERROR | None | 905 |
| semantic | 1028 | admin | reopened_tickets_metric group_by=- time=today | CL_ERROR | None | 1 |
| semantic | 1028 | admin | reopened_tickets_metric group_by=- time=last_7d | CL_ERROR | None | 71 |
| semantic | 1028 | admin | reopened_tickets_metric group_by=- time=last_30d | CL_ERROR | None | 303 |
| semantic | 1028 | admin | reopened_tickets_metric group_by=status time=last_7d | CL_ERROR | None | grouped |
| semantic | 1028 | admin | reopened_tickets_metric group_by=status_display_name time=last_7d | CL_ERROR | None | 71 |
| semantic | 1028 | admin | reopened_tickets_metric group_by=is_closed_by_status time=last_7d | CL_ERROR | None | 71 |
| semantic | 1028 | admin | reopened_tickets_metric group_by=priority time=last_7d | CL_ERROR | None | grouped |
| semantic | 1028 | admin | reopened_tickets_metric group_by=channel time=last_7d | FALLBACK_FAIL | 119.0 | grouped |
| semantic | 1028 | admin | reopened_tickets_metric group_by=category time=last_7d | PASS | 1.0 | 40 buckets |
| semantic | 1028 | admin | reopened_tickets_metric group_by=skill time=last_7d | MISMATCH | 11.0 | 71 |
| semantic | 1028 | admin | reopened_tickets_metric group_by=assignee_name time=last_7d | PASS | 4.0 | 3 buckets |
| semantic | 1028 | admin | reopened_tickets_metric group_by=assignee_role time=last_7d | MISMATCH | 11.0 | 71 |
| semantic | 1028 | admin | reopened_tickets_metric group_by=resolver_name time=last_7d | PASS | 5.0 | 4 buckets |
| semantic | 1028 | admin | reopened_tickets_metric group_by=queue_name time=last_7d | PASS | 2.0 | 7 buckets |
| semantic | 1028 | admin | reopened_tickets_metric group_by=queue_type time=last_7d | MISMATCH | 11.0 | 71 |
| semantic | 1028 | admin | reopened_tickets_metric group_by=account_name time=last_7d | MISMATCH | 11.0 | 71 |
| semantic | 1028 | admin | reopened_tickets_metric group_by=organization_name time=last_7d | MISMATCH | 11.0 | 71 |
| semantic | 1028 | admin | reopened_tickets_metric group_by=organization_business_type time=last_7d | MISMATCH | 11.0 | 71 |
| semantic | 1028 | admin | reopened_tickets_metric group_by=team_supports_ticketing time=last_7d | MISMATCH | 11.0 | 71 |
| semantic | 1028 | admin | reopened_tickets_metric group_by=created_by_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | reopened_tickets_metric group_by=customer_name time=last_7d | PASS | 0.0 | 113 buckets |
| semantic | 1028 | admin | reopened_tickets_metric group_by=has_assignee time=last_7d | MISMATCH | 11.0 | 71 |
| semantic | 1028 | admin | reopened_tickets_metric group_by=has_resolver time=last_7d | MISMATCH | 11.0 | 71 |
| semantic | 1028 | admin | reopened_tickets_metric group_by=has_first_response time=last_7d | MISMATCH | 0.0 | 71 |
| semantic | 1028 | admin | reopened_tickets_metric group_by=has_csat_rating time=last_7d | MISMATCH | 11.0 | 71 |
| semantic | 1028 | admin | reopened_tickets_metric group_by=is_overdue time=last_7d | MISMATCH | 2.0 | 71 |
| semantic | 1028 | admin | resolution_hours_total group_by=- time=all_time | MISMATCH | 45681.88114444444 | 76.51906389354178 |
| semantic | 1028 | admin | resolution_hours_total group_by=- time=today | UNMAPPED | 24.0 | None |
| semantic | 1028 | admin | resolution_hours_total group_by=- time=last_7d | MISMATCH | 2637.8811444444445 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_hours_total group_by=- time=last_30d | MISMATCH | 15997.881144444444 | 74.40874950904393 |
| semantic | 1028 | admin | resolution_hours_total group_by=status time=last_7d | PASS | 1184.8389013888889 | 6 buckets |
| semantic | 1028 | admin | resolution_hours_total group_by=status_display_name time=last_7d | MISMATCH | 1184.8389013888889 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_hours_total group_by=is_closed_by_status time=last_7d | MISMATCH | 1453.0422430555554 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_hours_total group_by=priority time=last_7d | PASS | 705.3586138888888 | 4 buckets |
| semantic | 1028 | admin | resolution_hours_total group_by=channel time=last_7d | PASS | 370.7094472222222 | 4 buckets |
| semantic | 1028 | admin | resolution_hours_total group_by=category time=last_7d | PASS | 3.0938902777777777 | 40 buckets |
| semantic | 1028 | admin | resolution_hours_total group_by=skill time=last_7d | MISMATCH | 2637.8811444444445 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_hours_total group_by=assignee_name time=last_7d | PASS | 1266.0755680555556 | 3 buckets |
| semantic | 1028 | admin | resolution_hours_total group_by=assignee_role time=last_7d | MISMATCH | 2637.8811444444445 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_hours_total group_by=resolver_name time=last_7d | PASS | 949.1975097222222 | 4 buckets |
| semantic | 1028 | admin | resolution_hours_total group_by=queue_name time=last_7d | PASS | 325.8008375 | 7 buckets |
| semantic | 1028 | admin | resolution_hours_total group_by=queue_type time=last_7d | MISMATCH | 2637.8811444444445 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_hours_total group_by=account_name time=last_7d | MISMATCH | 2637.8811444444445 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_hours_total group_by=organization_name time=last_7d | MISMATCH | 2637.8811444444445 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_hours_total group_by=organization_business_type time=last_7d | MISMATCH | 2637.8811444444445 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_hours_total group_by=team_supports_ticketing time=last_7d | MISMATCH | 2637.8811444444445 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_hours_total group_by=created_by_name time=last_7d | UNMAPPED | 31.10722361111111 | None |
| semantic | 1028 | admin | resolution_hours_total group_by=customer_name time=last_7d | PASS | 53.0 | 113 buckets |
| semantic | 1028 | admin | resolution_hours_total group_by=has_assignee time=last_7d | MISMATCH | 2637.8811444444445 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_hours_total group_by=has_resolver time=last_7d | MISMATCH | 2637.8811444444445 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_hours_total group_by=has_first_response time=last_7d | MISMATCH | 2637.8811444444445 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_hours_total group_by=has_csat_rating time=last_7d | MISMATCH | 625.9958402777778 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_hours_total group_by=is_overdue time=last_7d | MISMATCH | 2637.8811444444445 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_hours_variance_total group_by=- time=all_time | MISMATCH | 29441.881144444444 | 76.51906389354178 |
| semantic | 1028 | admin | resolution_hours_variance_total group_by=- time=today | UNMAPPED | 24.0 | None |
| semantic | 1028 | admin | resolution_hours_variance_total group_by=- time=last_7d | MISMATCH | 1313.8811444444445 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_hours_variance_total group_by=- time=last_30d | MISMATCH | 10197.881144444444 | 74.40874950904393 |
| semantic | 1028 | admin | resolution_hours_variance_total group_by=status time=last_7d | PASS | 688.8389013888889 | 6 buckets |
| semantic | 1028 | admin | resolution_hours_variance_total group_by=status_display_name time=last_7d | MISMATCH | 688.8389013888889 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_hours_variance_total group_by=is_closed_by_status time=last_7d | MISMATCH | 625.0422430555556 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_hours_variance_total group_by=priority time=last_7d | PASS | 617.3586138888888 | 4 buckets |
| semantic | 1028 | admin | resolution_hours_variance_total group_by=channel time=last_7d | PASS | 246.70944722222222 | 4 buckets |
| semantic | 1028 | admin | resolution_hours_variance_total group_by=category time=last_7d | PASS | -68.90610972222223 | 40 buckets |
| semantic | 1028 | admin | resolution_hours_variance_total group_by=skill time=last_7d | MISMATCH | 1313.8811444444445 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_hours_variance_total group_by=assignee_name time=last_7d | PASS | 802.0755680555556 | 3 buckets |
| semantic | 1028 | admin | resolution_hours_variance_total group_by=assignee_role time=last_7d | MISMATCH | 1313.8811444444445 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_hours_variance_total group_by=resolver_name time=last_7d | PASS | 505.1975097222222 | 4 buckets |
| semantic | 1028 | admin | resolution_hours_variance_total group_by=queue_name time=last_7d | PASS | 181.8008375 | 7 buckets |
| semantic | 1028 | admin | resolution_hours_variance_total group_by=queue_type time=last_7d | MISMATCH | 1313.8811444444445 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_hours_variance_total group_by=account_name time=last_7d | MISMATCH | 1313.8811444444445 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_hours_variance_total group_by=organization_name time=last_7d | MISMATCH | 1313.8811444444445 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_hours_variance_total group_by=organization_business_type time=last_7d | MISMATCH | 1313.8811444444445 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_hours_variance_total group_by=team_supports_ticketing time=last_7d | MISMATCH | 1313.8811444444445 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_hours_variance_total group_by=created_by_name time=last_7d | UNMAPPED | 7.107223611111111 | None |
| semantic | 1028 | admin | resolution_hours_variance_total group_by=customer_name time=last_7d | PASS | 45.0 | 113 buckets |
| semantic | 1028 | admin | resolution_hours_variance_total group_by=has_assignee time=last_7d | MISMATCH | 1313.8811444444445 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_hours_variance_total group_by=has_resolver time=last_7d | MISMATCH | 1313.8811444444445 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_hours_variance_total group_by=has_first_response time=last_7d | MISMATCH | 1313.8811444444445 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_hours_variance_total group_by=has_csat_rating time=last_7d | MISMATCH | 217.99584027777777 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_hours_variance_total group_by=is_overdue time=last_7d | MISMATCH | 1313.8811444444445 | 56.12513073286052 |
| semantic | 1028 | admin | resolution_rate group_by=- time=all_time | UNMAPPED | 0.3974700399467377 | None |
| semantic | 1028 | admin | resolution_rate group_by=- time=today | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | resolution_rate group_by=- time=last_7d | UNMAPPED | 0.3983050847457627 | None |
| semantic | 1028 | admin | resolution_rate group_by=- time=last_30d | UNMAPPED | 0.41505791505791506 | None |
| semantic | 1028 | admin | resolution_rate group_by=queue_name time=last_7d | UNMAPPED | 0.4 | None |
| semantic | 1028 | admin | resolution_rate group_by=priority time=last_7d | UNMAPPED | 0.2682926829268293 | None |
| semantic | 1028 | admin | resolution_sla_compliance_rate group_by=- time=all_time | UNMAPPED | 0.22780569514237856 | None |
| semantic | 1028 | admin | resolution_sla_compliance_rate group_by=- time=today | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | resolution_sla_compliance_rate group_by=- time=last_7d | UNMAPPED | 0.40425531914893614 | None |
| semantic | 1028 | admin | resolution_sla_compliance_rate group_by=- time=last_30d | UNMAPPED | 0.26976744186046514 | None |
| semantic | 1028 | admin | resolution_sla_compliance_rate group_by=status time=last_7d | UNMAPPED | 0.3333333333333333 | None |
| semantic | 1028 | admin | resolution_sla_compliance_rate group_by=status_display_name time=last_7d | UNMAPPED | 0.3333333333333333 | None |
| semantic | 1028 | admin | resolution_sla_compliance_rate group_by=is_closed_by_status time=last_7d | UNMAPPED | 0.46153846153846156 | None |
| semantic | 1028 | admin | resolution_sla_compliance_rate group_by=priority time=last_7d | UNMAPPED | 0.18181818181818182 | None |
| semantic | 1028 | admin | resolution_sla_compliance_rate group_by=channel time=last_7d | UNMAPPED | 0.3333333333333333 | None |
| semantic | 1028 | admin | resolution_sla_compliance_rate group_by=category time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | resolution_sla_compliance_rate group_by=skill time=last_7d | UNMAPPED | 0.40425531914893614 | None |
| semantic | 1028 | admin | resolution_sla_compliance_rate group_by=assignee_name time=last_7d | UNMAPPED | 0.35 | None |
| semantic | 1028 | admin | resolution_sla_compliance_rate group_by=assignee_role time=last_7d | UNMAPPED | 0.40425531914893614 | None |
| semantic | 1028 | admin | resolution_sla_compliance_rate group_by=resolver_name time=last_7d | UNMAPPED | 0.4375 | None |
| semantic | 1028 | admin | resolution_sla_compliance_rate group_by=queue_name time=last_7d | UNMAPPED | 0.16666666666666666 | None |
| semantic | 1028 | admin | resolution_sla_compliance_rate group_by=queue_type time=last_7d | UNMAPPED | 0.40425531914893614 | None |
| semantic | 1028 | admin | resolution_sla_compliance_rate group_by=account_name time=last_7d | UNMAPPED | 0.40425531914893614 | None |
| semantic | 1028 | admin | resolution_sla_compliance_rate group_by=organization_name time=last_7d | UNMAPPED | 0.40425531914893614 | None |
| semantic | 1028 | admin | resolution_sla_compliance_rate group_by=organization_business_type time=last_7d | UNMAPPED | 0.40425531914893614 | None |
| semantic | 1028 | admin | resolution_sla_compliance_rate group_by=team_supports_ticketing time=last_7d | UNMAPPED | 0.40425531914893614 | None |
| semantic | 1028 | admin | resolution_sla_compliance_rate group_by=created_by_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | resolution_sla_compliance_rate group_by=customer_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | resolution_sla_compliance_rate group_by=has_assignee time=last_7d | UNMAPPED | 0.40425531914893614 | None |
| semantic | 1028 | admin | resolution_sla_compliance_rate group_by=has_resolver time=last_7d | UNMAPPED | 0.40425531914893614 | None |
| semantic | 1028 | admin | resolution_sla_compliance_rate group_by=has_first_response time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | resolution_sla_compliance_rate group_by=has_csat_rating time=last_7d | UNMAPPED | 0.36363636363636365 | None |
| semantic | 1028 | admin | resolution_sla_compliance_rate group_by=is_overdue time=last_7d | UNMAPPED | 0.40425531914893614 | None |
| semantic | 1028 | admin | resolution_sla_met_metric group_by=- time=all_time | UNMAPPED | 136.0 | None |
| semantic | 1028 | admin | resolution_sla_met_metric group_by=- time=today | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | resolution_sla_met_metric group_by=- time=last_7d | UNMAPPED | 19.0 | None |
| semantic | 1028 | admin | resolution_sla_met_metric group_by=- time=last_30d | UNMAPPED | 58.0 | None |
| semantic | 1028 | admin | resolution_sla_met_metric group_by=status time=last_7d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | resolution_sla_met_metric group_by=status_display_name time=last_7d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | resolution_sla_met_metric group_by=is_closed_by_status time=last_7d | UNMAPPED | 12.0 | None |
| semantic | 1028 | admin | resolution_sla_met_metric group_by=priority time=last_7d | UNMAPPED | 2.0 | None |
| semantic | 1028 | admin | resolution_sla_met_metric group_by=channel time=last_7d | UNMAPPED | 2.0 | None |
| semantic | 1028 | admin | resolution_sla_met_metric group_by=category time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | resolution_sla_met_metric group_by=skill time=last_7d | UNMAPPED | 19.0 | None |
| semantic | 1028 | admin | resolution_sla_met_metric group_by=assignee_name time=last_7d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | resolution_sla_met_metric group_by=assignee_role time=last_7d | UNMAPPED | 19.0 | None |
| semantic | 1028 | admin | resolution_sla_met_metric group_by=resolver_name time=last_7d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | resolution_sla_met_metric group_by=queue_name time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | resolution_sla_met_metric group_by=queue_type time=last_7d | UNMAPPED | 19.0 | None |
| semantic | 1028 | admin | resolution_sla_met_metric group_by=account_name time=last_7d | UNMAPPED | 19.0 | None |
| semantic | 1028 | admin | resolution_sla_met_metric group_by=organization_name time=last_7d | UNMAPPED | 19.0 | None |
| semantic | 1028 | admin | resolution_sla_met_metric group_by=organization_business_type time=last_7d | UNMAPPED | 19.0 | None |
| semantic | 1028 | admin | resolution_sla_met_metric group_by=team_supports_ticketing time=last_7d | UNMAPPED | 19.0 | None |
| semantic | 1028 | admin | resolution_sla_met_metric group_by=created_by_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | resolution_sla_met_metric group_by=customer_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | resolution_sla_met_metric group_by=has_assignee time=last_7d | UNMAPPED | 19.0 | None |
| semantic | 1028 | admin | resolution_sla_met_metric group_by=has_resolver time=last_7d | UNMAPPED | 19.0 | None |
| semantic | 1028 | admin | resolution_sla_met_metric group_by=has_first_response time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | resolution_sla_met_metric group_by=has_csat_rating time=last_7d | UNMAPPED | 4.0 | None |
| semantic | 1028 | admin | resolution_sla_met_metric group_by=is_overdue time=last_7d | UNMAPPED | 19.0 | None |
| semantic | 1028 | admin | resolved_for_avg group_by=- time=all_time | PASS | 597.0 | 597 |
| semantic | 1028 | admin | resolved_for_avg group_by=- time=today | PASS | 0.0 | 0 |
| semantic | 1028 | admin | resolved_for_avg group_by=- time=last_7d | PASS | 47.0 | 47 |
| semantic | 1028 | admin | resolved_for_avg group_by=- time=last_30d | PASS | 215.0 | 215 |
| semantic | 1028 | admin | resolved_for_avg group_by=status time=last_7d | PASS | 21.0 | 6 buckets |
| semantic | 1028 | admin | resolved_for_avg group_by=status_display_name time=last_7d | MISMATCH | 21.0 | 47 |
| semantic | 1028 | admin | resolved_for_avg group_by=is_closed_by_status time=last_7d | MISMATCH | 26.0 | 47 |
| semantic | 1028 | admin | resolved_for_avg group_by=priority time=last_7d | PASS | 11.0 | 4 buckets |
| semantic | 1028 | admin | resolved_for_avg group_by=channel time=last_7d | PASS | 6.0 | 4 buckets |
| semantic | 1028 | admin | resolved_for_avg group_by=category time=last_7d | PASS | 0.0 | 40 buckets |
| semantic | 1028 | admin | resolved_for_avg group_by=skill time=last_7d | PASS | 47.0 | 47 |
| semantic | 1028 | admin | resolved_for_avg group_by=assignee_name time=last_7d | PASS | 20.0 | 3 buckets |
| semantic | 1028 | admin | resolved_for_avg group_by=assignee_role time=last_7d | PASS | 47.0 | 47 |
| semantic | 1028 | admin | resolved_for_avg group_by=resolver_name time=last_7d | PASS | 16.0 | 4 buckets |
| semantic | 1028 | admin | resolved_for_avg group_by=queue_name time=last_7d | PASS | 6.0 | 7 buckets |
| semantic | 1028 | admin | resolved_for_avg group_by=queue_type time=last_7d | PASS | 47.0 | 47 |
| semantic | 1028 | admin | resolved_for_avg group_by=account_name time=last_7d | PASS | 47.0 | 47 |
| semantic | 1028 | admin | resolved_for_avg group_by=organization_name time=last_7d | PASS | 47.0 | 47 |
| semantic | 1028 | admin | resolved_for_avg group_by=organization_business_type time=last_7d | PASS | 47.0 | 47 |
| semantic | 1028 | admin | resolved_for_avg group_by=team_supports_ticketing time=last_7d | PASS | 47.0 | 47 |
| semantic | 1028 | admin | resolved_for_avg group_by=created_by_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | resolved_for_avg group_by=customer_name time=last_7d | PASS | 1.0 | 113 buckets |
| semantic | 1028 | admin | resolved_for_avg group_by=has_assignee time=last_7d | PASS | 47.0 | 47 |
| semantic | 1028 | admin | resolved_for_avg group_by=has_resolver time=last_7d | PASS | 47.0 | 47 |
| semantic | 1028 | admin | resolved_for_avg group_by=has_first_response time=last_7d | MISMATCH | 0.0 | 47 |
| semantic | 1028 | admin | resolved_for_avg group_by=has_csat_rating time=last_7d | MISMATCH | 11.0 | 47 |
| semantic | 1028 | admin | resolved_for_avg group_by=is_overdue time=last_7d | PASS | 47.0 | 47 |
| semantic | 1028 | admin | resolved_tickets_metric group_by=- time=all_time | PASS | 597.0 | 597 |
| semantic | 1028 | admin | resolved_tickets_metric group_by=- time=today | PASS | 0.0 | 0 |
| semantic | 1028 | admin | resolved_tickets_metric group_by=- time=last_7d | PASS | 47.0 | 47 |
| semantic | 1028 | admin | resolved_tickets_metric group_by=- time=last_30d | PASS | 215.0 | 215 |
| semantic | 1028 | admin | resolved_tickets_metric group_by=status time=last_7d | PASS | 21.0 | 6 buckets |
| semantic | 1028 | admin | resolved_tickets_metric group_by=status_display_name time=last_7d | MISMATCH | 21.0 | 47 |
| semantic | 1028 | admin | resolved_tickets_metric group_by=is_closed_by_status time=last_7d | MISMATCH | 26.0 | 47 |
| semantic | 1028 | admin | resolved_tickets_metric group_by=priority time=last_7d | PASS | 11.0 | 4 buckets |
| semantic | 1028 | admin | resolved_tickets_metric group_by=channel time=last_7d | PASS | 6.0 | 4 buckets |
| semantic | 1028 | admin | resolved_tickets_metric group_by=category time=last_7d | PASS | 0.0 | 40 buckets |
| semantic | 1028 | admin | resolved_tickets_metric group_by=skill time=last_7d | PASS | 47.0 | 47 |
| semantic | 1028 | admin | resolved_tickets_metric group_by=assignee_name time=last_7d | PASS | 20.0 | 3 buckets |
| semantic | 1028 | admin | resolved_tickets_metric group_by=assignee_role time=last_7d | PASS | 47.0 | 47 |
| semantic | 1028 | admin | resolved_tickets_metric group_by=resolver_name time=last_7d | PASS | 16.0 | 4 buckets |
| semantic | 1028 | admin | resolved_tickets_metric group_by=queue_name time=last_7d | PASS | 6.0 | 7 buckets |
| semantic | 1028 | admin | resolved_tickets_metric group_by=queue_type time=last_7d | PASS | 47.0 | 47 |
| semantic | 1028 | admin | resolved_tickets_metric group_by=account_name time=last_7d | PASS | 47.0 | 47 |
| semantic | 1028 | admin | resolved_tickets_metric group_by=organization_name time=last_7d | PASS | 47.0 | 47 |
| semantic | 1028 | admin | resolved_tickets_metric group_by=organization_business_type time=last_7d | PASS | 47.0 | 47 |
| semantic | 1028 | admin | resolved_tickets_metric group_by=team_supports_ticketing time=last_7d | PASS | 47.0 | 47 |
| semantic | 1028 | admin | resolved_tickets_metric group_by=created_by_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | resolved_tickets_metric group_by=customer_name time=last_7d | PASS | 1.0 | 113 buckets |
| semantic | 1028 | admin | resolved_tickets_metric group_by=has_assignee time=last_7d | PASS | 47.0 | 47 |
| semantic | 1028 | admin | resolved_tickets_metric group_by=has_resolver time=last_7d | PASS | 47.0 | 47 |
| semantic | 1028 | admin | resolved_tickets_metric group_by=has_first_response time=last_7d | MISMATCH | 0.0 | 47 |
| semantic | 1028 | admin | resolved_tickets_metric group_by=has_csat_rating time=last_7d | MISMATCH | 11.0 | 47 |
| semantic | 1028 | admin | resolved_tickets_metric group_by=is_overdue time=last_7d | PASS | 47.0 | 47 |
| semantic | 1028 | admin | sla_at_risk_tickets_metric group_by=- time=all_time | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | sla_at_risk_tickets_metric group_by=- time=today | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | sla_at_risk_tickets_metric group_by=- time=last_7d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | sla_at_risk_tickets_metric group_by=- time=last_30d | UNMAPPED | 7.0 | None |
| semantic | 1028 | admin | sla_at_risk_tickets_metric group_by=priority time=last_7d | UNMAPPED | 3.0 | None |
| semantic | 1028 | admin | sla_at_risk_tickets_metric group_by=queue_name time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | sla_breach_rate group_by=- time=all_time | MISMATCH | 1.3082077051926297 | 898 |
| semantic | 1028 | admin | sla_breach_rate group_by=- time=today | PASS | 0.0 | 0 |
| semantic | 1028 | admin | sla_breach_rate group_by=- time=last_7d | MISMATCH | 1.1702127659574468 | 64 |
| semantic | 1028 | admin | sla_breach_rate group_by=- time=last_30d | MISMATCH | 1.2372093023255815 | 296 |
| semantic | 1028 | admin | sla_breach_rate group_by=priority time=last_7d | PASS | 2.090909090909091 | 4 buckets |
| semantic | 1028 | admin | sla_breach_rate group_by=queue_name time=last_7d | PASS | 1.1666666666666667 | 7 buckets |
| semantic | 1028 | admin | sla_breach_rate group_by=channel time=last_7d | PASS | 1.8333333333333333 | 4 buckets |
| semantic | 1028 | admin | ticket_volume group_by=- time=all_time | PASS | 1502.0 | 1502 |
| semantic | 1028 | admin | ticket_volume group_by=- time=today | PASS | 1.0 | 1 |
| semantic | 1028 | admin | ticket_volume group_by=- time=last_7d | PASS | 118.0 | 118 |
| semantic | 1028 | admin | ticket_volume group_by=- time=last_30d | PASS | 518.0 | 518 |
| semantic | 1028 | admin | ticket_volume group_by=priority time=last_7d | PASS | 41.0 | 4 buckets |
| semantic | 1028 | admin | ticket_volume group_by=queue_name time=last_7d | PASS | 15.0 | 7 buckets |
| semantic | 1028 | admin | ticket_volume group_by=channel time=last_7d | PASS | 20.0 | 4 buckets |
| semantic | 1028 | admin | ticket_volume group_by=status time=last_7d | PASS | 21.0 | 6 buckets |
| semantic | 1028 | admin | tickets_created_today_metric group_by=- time=all_time | MISMATCH | 1.0 | 1502 |
| semantic | 1028 | admin | tickets_created_today_metric group_by=- time=today | PASS | 1.0 | 1 |
| semantic | 1028 | admin | tickets_created_today_metric group_by=- time=last_7d | MISMATCH | 1.0 | 118 |
| semantic | 1028 | admin | tickets_created_today_metric group_by=- time=last_30d | MISMATCH | 1.0 | 518 |
| semantic | 1028 | admin | tickets_created_today_metric group_by=status time=last_7d | PASS | 0.0 | 6 buckets |
| semantic | 1028 | admin | tickets_created_today_metric group_by=status_display_name time=last_7d | MISMATCH | 0.0 | 118 |
| semantic | 1028 | admin | tickets_created_today_metric group_by=is_closed_by_status time=last_7d | MISMATCH | 1.0 | 118 |
| semantic | 1028 | admin | tickets_created_today_metric group_by=priority time=last_7d | PASS | 0.0 | 4 buckets |
| semantic | 1028 | admin | tickets_created_today_metric group_by=channel time=last_7d | PASS | 0.0 | 4 buckets |
| semantic | 1028 | admin | tickets_created_today_metric group_by=category time=last_7d | PASS | 0.0 | 40 buckets |
| semantic | 1028 | admin | tickets_created_today_metric group_by=skill time=last_7d | MISMATCH | 1.0 | 118 |
| semantic | 1028 | admin | tickets_created_today_metric group_by=assignee_name time=last_7d | PASS | 0.0 | 3 buckets |
| semantic | 1028 | admin | tickets_created_today_metric group_by=assignee_role time=last_7d | MISMATCH | 1.0 | 118 |
| semantic | 1028 | admin | tickets_created_today_metric group_by=resolver_name time=last_7d | PASS | 0.0 | 4 buckets |
| semantic | 1028 | admin | tickets_created_today_metric group_by=queue_name time=last_7d | PASS | 0.0 | 7 buckets |
| semantic | 1028 | admin | tickets_created_today_metric group_by=queue_type time=last_7d | MISMATCH | 1.0 | 118 |
| semantic | 1028 | admin | tickets_created_today_metric group_by=account_name time=last_7d | MISMATCH | 1.0 | 118 |
| semantic | 1028 | admin | tickets_created_today_metric group_by=organization_name time=last_7d | MISMATCH | 1.0 | 118 |
| semantic | 1028 | admin | tickets_created_today_metric group_by=organization_business_type time=last_7d | MISMATCH | 1.0 | 118 |
| semantic | 1028 | admin | tickets_created_today_metric group_by=team_supports_ticketing time=last_7d | MISMATCH | 1.0 | 118 |
| semantic | 1028 | admin | tickets_created_today_metric group_by=created_by_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | tickets_created_today_metric group_by=customer_name time=last_7d | PASS | 0.0 | 113 buckets |
| semantic | 1028 | admin | tickets_created_today_metric group_by=has_assignee time=last_7d | MISMATCH | 1.0 | 118 |
| semantic | 1028 | admin | tickets_created_today_metric group_by=has_resolver time=last_7d | MISMATCH | 1.0 | 118 |
| semantic | 1028 | admin | tickets_created_today_metric group_by=has_first_response time=last_7d | MISMATCH | 0.0 | 118 |
| semantic | 1028 | admin | tickets_created_today_metric group_by=has_csat_rating time=last_7d | MISMATCH | 1.0 | 118 |
| semantic | 1028 | admin | tickets_created_today_metric group_by=is_overdue time=last_7d | MISMATCH | 1.0 | 118 |
| semantic | 1028 | admin | tickets_last_30_days group_by=- time=all_time | UNMAPPED | 506.0 | None |
| semantic | 1028 | admin | tickets_last_30_days group_by=- time=today | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | tickets_last_30_days group_by=- time=last_7d | UNMAPPED | 118.0 | None |
| semantic | 1028 | admin | tickets_last_30_days group_by=- time=last_30d | UNMAPPED | 506.0 | None |
| semantic | 1028 | admin | tickets_last_30_days group_by=status time=last_7d | UNMAPPED | 21.0 | None |
| semantic | 1028 | admin | tickets_last_30_days group_by=status_display_name time=last_7d | UNMAPPED | 21.0 | None |
| semantic | 1028 | admin | tickets_last_30_days group_by=is_closed_by_status time=last_7d | UNMAPPED | 97.0 | None |
| semantic | 1028 | admin | tickets_last_30_days group_by=priority time=last_7d | UNMAPPED | 41.0 | None |
| semantic | 1028 | admin | tickets_last_30_days group_by=channel time=last_7d | UNMAPPED | 20.0 | None |
| semantic | 1028 | admin | tickets_last_30_days group_by=category time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | tickets_last_30_days group_by=skill time=last_7d | UNMAPPED | 118.0 | None |
| semantic | 1028 | admin | tickets_last_30_days group_by=assignee_name time=last_7d | UNMAPPED | 56.0 | None |
| semantic | 1028 | admin | tickets_last_30_days group_by=assignee_role time=last_7d | UNMAPPED | 118.0 | None |
| semantic | 1028 | admin | tickets_last_30_days group_by=resolver_name time=last_7d | UNMAPPED | 43.0 | None |
| semantic | 1028 | admin | tickets_last_30_days group_by=queue_name time=last_7d | UNMAPPED | 15.0 | None |
| semantic | 1028 | admin | tickets_last_30_days group_by=queue_type time=last_7d | UNMAPPED | 118.0 | None |
| semantic | 1028 | admin | tickets_last_30_days group_by=account_name time=last_7d | UNMAPPED | 118.0 | None |
| semantic | 1028 | admin | tickets_last_30_days group_by=organization_name time=last_7d | UNMAPPED | 118.0 | None |
| semantic | 1028 | admin | tickets_last_30_days group_by=organization_business_type time=last_7d | UNMAPPED | 118.0 | None |
| semantic | 1028 | admin | tickets_last_30_days group_by=team_supports_ticketing time=last_7d | UNMAPPED | 118.0 | None |
| semantic | 1028 | admin | tickets_last_30_days group_by=created_by_name time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | tickets_last_30_days group_by=customer_name time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | tickets_last_30_days group_by=has_assignee time=last_7d | UNMAPPED | 118.0 | None |
| semantic | 1028 | admin | tickets_last_30_days group_by=has_resolver time=last_7d | UNMAPPED | 118.0 | None |
| semantic | 1028 | admin | tickets_last_30_days group_by=has_first_response time=last_7d | UNMAPPED | 12.0 | None |
| semantic | 1028 | admin | tickets_last_30_days group_by=has_csat_rating time=last_7d | UNMAPPED | 82.0 | None |
| semantic | 1028 | admin | tickets_last_30_days group_by=is_overdue time=last_7d | UNMAPPED | 54.0 | None |
| semantic | 1028 | admin | tickets_last_7_days group_by=- time=all_time | UNMAPPED | 104.0 | None |
| semantic | 1028 | admin | tickets_last_7_days group_by=- time=today | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | tickets_last_7_days group_by=- time=last_7d | UNMAPPED | 104.0 | None |
| semantic | 1028 | admin | tickets_last_7_days group_by=- time=last_30d | UNMAPPED | 104.0 | None |
| semantic | 1028 | admin | tickets_last_7_days group_by=status time=last_7d | UNMAPPED | 19.0 | None |
| semantic | 1028 | admin | tickets_last_7_days group_by=status_display_name time=last_7d | UNMAPPED | 19.0 | None |
| semantic | 1028 | admin | tickets_last_7_days group_by=is_closed_by_status time=last_7d | UNMAPPED | 85.0 | None |
| semantic | 1028 | admin | tickets_last_7_days group_by=priority time=last_7d | UNMAPPED | 35.0 | None |
| semantic | 1028 | admin | tickets_last_7_days group_by=channel time=last_7d | UNMAPPED | 16.0 | None |
| semantic | 1028 | admin | tickets_last_7_days group_by=category time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | tickets_last_7_days group_by=skill time=last_7d | UNMAPPED | 104.0 | None |
| semantic | 1028 | admin | tickets_last_7_days group_by=assignee_name time=last_7d | UNMAPPED | 50.0 | None |
| semantic | 1028 | admin | tickets_last_7_days group_by=assignee_role time=last_7d | UNMAPPED | 104.0 | None |
| semantic | 1028 | admin | tickets_last_7_days group_by=resolver_name time=last_7d | UNMAPPED | 40.0 | None |
| semantic | 1028 | admin | tickets_last_7_days group_by=queue_name time=last_7d | UNMAPPED | 13.0 | None |
| semantic | 1028 | admin | tickets_last_7_days group_by=queue_type time=last_7d | UNMAPPED | 104.0 | None |
| semantic | 1028 | admin | tickets_last_7_days group_by=account_name time=last_7d | UNMAPPED | 104.0 | None |
| semantic | 1028 | admin | tickets_last_7_days group_by=organization_name time=last_7d | UNMAPPED | 104.0 | None |
| semantic | 1028 | admin | tickets_last_7_days group_by=organization_business_type time=last_7d | UNMAPPED | 104.0 | None |
| semantic | 1028 | admin | tickets_last_7_days group_by=team_supports_ticketing time=last_7d | UNMAPPED | 104.0 | None |
| semantic | 1028 | admin | tickets_last_7_days group_by=created_by_name time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | tickets_last_7_days group_by=customer_name time=last_7d | UNMAPPED | 1.0 | None |
| semantic | 1028 | admin | tickets_last_7_days group_by=has_assignee time=last_7d | UNMAPPED | 104.0 | None |
| semantic | 1028 | admin | tickets_last_7_days group_by=has_resolver time=last_7d | UNMAPPED | 104.0 | None |
| semantic | 1028 | admin | tickets_last_7_days group_by=has_first_response time=last_7d | UNMAPPED | 11.0 | None |
| semantic | 1028 | admin | tickets_last_7_days group_by=has_csat_rating time=last_7d | UNMAPPED | 73.0 | None |
| semantic | 1028 | admin | tickets_last_7_days group_by=is_overdue time=last_7d | UNMAPPED | 48.0 | None |
| semantic | 1028 | admin | tickets_with_first_response_metric group_by=- time=all_time | MISMATCH | 1380.0 | 11.214500666814613 |
| semantic | 1028 | admin | tickets_with_first_response_metric group_by=- time=today | MISMATCH | 1.0 | 0.0054713416666666665 |
| semantic | 1028 | admin | tickets_with_first_response_metric group_by=- time=last_7d | MISMATCH | 106.0 | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_first_response_metric group_by=- time=last_30d | MISMATCH | 474.0 | 11.179347932920184 |
| semantic | 1028 | admin | tickets_with_first_response_metric group_by=status time=last_7d | PASS | 21.0 | 6 buckets |
| semantic | 1028 | admin | tickets_with_first_response_metric group_by=status_display_name time=last_7d | MISMATCH | 21.0 | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_first_response_metric group_by=is_closed_by_status time=last_7d | MISMATCH | 85.0 | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_first_response_metric group_by=priority time=last_7d | PASS | 35.0 | 4 buckets |
| semantic | 1028 | admin | tickets_with_first_response_metric group_by=channel time=last_7d | PASS | 18.0 | 4 buckets |
| semantic | 1028 | admin | tickets_with_first_response_metric group_by=category time=last_7d | PASS | 1.0 | 40 buckets |
| semantic | 1028 | admin | tickets_with_first_response_metric group_by=skill time=last_7d | MISMATCH | 106.0 | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_first_response_metric group_by=assignee_name time=last_7d | PASS | 52.0 | 3 buckets |
| semantic | 1028 | admin | tickets_with_first_response_metric group_by=assignee_role time=last_7d | MISMATCH | 106.0 | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_first_response_metric group_by=resolver_name time=last_7d | PASS | 37.0 | 4 buckets |
| semantic | 1028 | admin | tickets_with_first_response_metric group_by=queue_name time=last_7d | PASS | 12.0 | 7 buckets |
| semantic | 1028 | admin | tickets_with_first_response_metric group_by=queue_type time=last_7d | MISMATCH | 106.0 | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_first_response_metric group_by=account_name time=last_7d | MISMATCH | 106.0 | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_first_response_metric group_by=organization_name time=last_7d | MISMATCH | 106.0 | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_first_response_metric group_by=organization_business_type time=last_7d | MISMATCH | 106.0 | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_first_response_metric group_by=team_supports_ticketing time=last_7d | MISMATCH | 106.0 | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_first_response_metric group_by=created_by_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | tickets_with_first_response_metric group_by=customer_name time=last_7d | PASS | 1.0 | 113 buckets |
| semantic | 1028 | admin | tickets_with_first_response_metric group_by=has_assignee time=last_7d | MISMATCH | 106.0 | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_first_response_metric group_by=has_resolver time=last_7d | MISMATCH | 106.0 | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_first_response_metric group_by=has_first_response time=last_7d | MISMATCH | 0.0 | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_first_response_metric group_by=has_csat_rating time=last_7d | MISMATCH | 70.0 | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_first_response_metric group_by=is_overdue time=last_7d | MISMATCH | 52.0 | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_first_response_sla_target_metric group_by=- time=all_time | MISMATCH | 1380.0 | 11.214500666814613 |
| semantic | 1028 | admin | tickets_with_first_response_sla_target_metric group_by=- time=today | MISMATCH | 1.0 | 0.0054713416666666665 |
| semantic | 1028 | admin | tickets_with_first_response_sla_target_metric group_by=- time=last_7d | MISMATCH | 106.0 | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_first_response_sla_target_metric group_by=- time=last_30d | MISMATCH | 474.0 | 11.179347932920184 |
| semantic | 1028 | admin | tickets_with_first_response_sla_target_metric group_by=status time=last_7d | PASS | 21.0 | 6 buckets |
| semantic | 1028 | admin | tickets_with_first_response_sla_target_metric group_by=status_display_name time=last_7d | MISMATCH | 21.0 | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_first_response_sla_target_metric group_by=is_closed_by_status time=last_7d | MISMATCH | 85.0 | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_first_response_sla_target_metric group_by=priority time=last_7d | CL_ERROR | None | grouped |
| semantic | 1028 | admin | tickets_with_first_response_sla_target_metric group_by=channel time=last_7d | CL_ERROR | None | grouped |
| semantic | 1028 | admin | tickets_with_first_response_sla_target_metric group_by=category time=last_7d | CL_ERROR | None | grouped |
| semantic | 1028 | admin | tickets_with_first_response_sla_target_metric group_by=skill time=last_7d | CL_ERROR | None | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_first_response_sla_target_metric group_by=assignee_name time=last_7d | CL_ERROR | None | grouped |
| semantic | 1028 | admin | tickets_with_first_response_sla_target_metric group_by=assignee_role time=last_7d | CL_ERROR | None | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_first_response_sla_target_metric group_by=resolver_name time=last_7d | CL_ERROR | None | grouped |
| semantic | 1028 | admin | tickets_with_first_response_sla_target_metric group_by=queue_name time=last_7d | CL_ERROR | None | grouped |
| semantic | 1028 | admin | tickets_with_first_response_sla_target_metric group_by=queue_type time=last_7d | CL_ERROR | None | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_first_response_sla_target_metric group_by=account_name time=last_7d | CL_ERROR | None | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_first_response_sla_target_metric group_by=organization_name time=last_7d | CL_ERROR | None | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_first_response_sla_target_metric group_by=organization_business_type time=last_7d | CL_ERROR | None | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_first_response_sla_target_metric group_by=team_supports_ticketing time=last_7d | CL_ERROR | None | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_first_response_sla_target_metric group_by=created_by_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_first_response_sla_target_metric group_by=customer_name time=last_7d | CL_ERROR | None | grouped |
| semantic | 1028 | admin | tickets_with_first_response_sla_target_metric group_by=has_assignee time=last_7d | CL_ERROR | None | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_first_response_sla_target_metric group_by=has_resolver time=last_7d | CL_ERROR | None | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_first_response_sla_target_metric group_by=has_first_response time=last_7d | CL_ERROR | None | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_first_response_sla_target_metric group_by=has_csat_rating time=last_7d | CL_ERROR | None | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_first_response_sla_target_metric group_by=is_overdue time=last_7d | CL_ERROR | None | 10.509536983058176 |
| semantic | 1028 | admin | tickets_with_resolution_sla_target_metric group_by=- time=all_time | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolution_sla_target_metric group_by=- time=today | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolution_sla_target_metric group_by=- time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolution_sla_target_metric group_by=- time=last_30d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolution_sla_target_metric group_by=status time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolution_sla_target_metric group_by=status_display_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolution_sla_target_metric group_by=is_closed_by_status time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolution_sla_target_metric group_by=priority time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolution_sla_target_metric group_by=channel time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolution_sla_target_metric group_by=category time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolution_sla_target_metric group_by=skill time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolution_sla_target_metric group_by=assignee_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolution_sla_target_metric group_by=assignee_role time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolution_sla_target_metric group_by=resolver_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolution_sla_target_metric group_by=queue_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolution_sla_target_metric group_by=queue_type time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolution_sla_target_metric group_by=account_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolution_sla_target_metric group_by=organization_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolution_sla_target_metric group_by=organization_business_type time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolution_sla_target_metric group_by=team_supports_ticketing time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolution_sla_target_metric group_by=created_by_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolution_sla_target_metric group_by=customer_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolution_sla_target_metric group_by=has_assignee time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolution_sla_target_metric group_by=has_resolver time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolution_sla_target_metric group_by=has_first_response time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolution_sla_target_metric group_by=has_csat_rating time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolution_sla_target_metric group_by=is_overdue time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolver_metric group_by=- time=all_time | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolver_metric group_by=- time=today | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolver_metric group_by=- time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolver_metric group_by=- time=last_30d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolver_metric group_by=status time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolver_metric group_by=status_display_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolver_metric group_by=is_closed_by_status time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolver_metric group_by=priority time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolver_metric group_by=channel time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolver_metric group_by=category time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolver_metric group_by=skill time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolver_metric group_by=assignee_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolver_metric group_by=assignee_role time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolver_metric group_by=resolver_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolver_metric group_by=queue_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolver_metric group_by=queue_type time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolver_metric group_by=account_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolver_metric group_by=organization_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolver_metric group_by=organization_business_type time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolver_metric group_by=team_supports_ticketing time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolver_metric group_by=created_by_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolver_metric group_by=customer_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolver_metric group_by=has_assignee time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolver_metric group_by=has_resolver time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolver_metric group_by=has_first_response time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolver_metric group_by=has_csat_rating time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_resolver_metric group_by=is_overdue time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_sla_target_metric group_by=- time=all_time | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_sla_target_metric group_by=- time=today | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_sla_target_metric group_by=- time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_sla_target_metric group_by=- time=last_30d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_sla_target_metric group_by=status time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_sla_target_metric group_by=status_display_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_sla_target_metric group_by=is_closed_by_status time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_sla_target_metric group_by=priority time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_sla_target_metric group_by=channel time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_sla_target_metric group_by=category time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_sla_target_metric group_by=skill time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_sla_target_metric group_by=assignee_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_sla_target_metric group_by=assignee_role time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_sla_target_metric group_by=resolver_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_sla_target_metric group_by=queue_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_sla_target_metric group_by=queue_type time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_sla_target_metric group_by=account_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_sla_target_metric group_by=organization_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_sla_target_metric group_by=organization_business_type time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_sla_target_metric group_by=team_supports_ticketing time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_sla_target_metric group_by=created_by_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_sla_target_metric group_by=customer_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_sla_target_metric group_by=has_assignee time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_sla_target_metric group_by=has_resolver time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_sla_target_metric group_by=has_first_response time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_sla_target_metric group_by=has_csat_rating time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_with_sla_target_metric group_by=is_overdue time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_without_resolver_metric group_by=- time=all_time | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_without_resolver_metric group_by=- time=today | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_without_resolver_metric group_by=- time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_without_resolver_metric group_by=- time=last_30d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_without_resolver_metric group_by=status time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_without_resolver_metric group_by=status_display_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_without_resolver_metric group_by=is_closed_by_status time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_without_resolver_metric group_by=priority time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_without_resolver_metric group_by=channel time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_without_resolver_metric group_by=category time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_without_resolver_metric group_by=skill time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_without_resolver_metric group_by=assignee_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_without_resolver_metric group_by=assignee_role time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_without_resolver_metric group_by=resolver_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_without_resolver_metric group_by=queue_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_without_resolver_metric group_by=queue_type time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_without_resolver_metric group_by=account_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_without_resolver_metric group_by=organization_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_without_resolver_metric group_by=organization_business_type time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_without_resolver_metric group_by=team_supports_ticketing time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_without_resolver_metric group_by=created_by_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_without_resolver_metric group_by=customer_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_without_resolver_metric group_by=has_assignee time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_without_resolver_metric group_by=has_resolver time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_without_resolver_metric group_by=has_first_response time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_without_resolver_metric group_by=has_csat_rating time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | tickets_without_resolver_metric group_by=is_overdue time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | unanswered_tickets_metric group_by=- time=all_time | CL_ERROR | None | None |
| semantic | 1028 | admin | unanswered_tickets_metric group_by=- time=today | CL_ERROR | None | None |
| semantic | 1028 | admin | unanswered_tickets_metric group_by=- time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | unanswered_tickets_metric group_by=- time=last_30d | CL_ERROR | None | None |
| semantic | 1028 | admin | unanswered_tickets_metric group_by=priority time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | unanswered_tickets_metric group_by=queue_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | unanswered_tickets_metric group_by=channel time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | unassigned_tickets_metric group_by=- time=all_time | CL_ERROR | None | 1502 |
| semantic | 1028 | admin | unassigned_tickets_metric group_by=- time=today | CL_ERROR | None | 1 |
| semantic | 1028 | admin | unassigned_tickets_metric group_by=- time=last_7d | CL_ERROR | None | 118 |
| semantic | 1028 | admin | unassigned_tickets_metric group_by=- time=last_30d | CL_ERROR | None | 518 |
| semantic | 1028 | admin | unassigned_tickets_metric group_by=status time=last_7d | CL_ERROR | None | grouped |
| semantic | 1028 | admin | unassigned_tickets_metric group_by=status_display_name time=last_7d | CL_ERROR | None | 118 |
| semantic | 1028 | admin | unassigned_tickets_metric group_by=is_closed_by_status time=last_7d | CL_ERROR | None | 118 |
| semantic | 1028 | admin | unassigned_tickets_metric group_by=priority time=last_7d | CL_ERROR | None | grouped |
| semantic | 1028 | admin | unassigned_tickets_metric group_by=channel time=last_7d | CL_ERROR | None | grouped |
| semantic | 1028 | admin | unassigned_tickets_metric group_by=category time=last_7d | CL_ERROR | None | grouped |
| semantic | 1028 | admin | unassigned_tickets_metric group_by=skill time=last_7d | CL_ERROR | None | 118 |
| semantic | 1028 | admin | unassigned_tickets_metric group_by=assignee_name time=last_7d | CL_ERROR | None | grouped |
| semantic | 1028 | admin | unassigned_tickets_metric group_by=assignee_role time=last_7d | CL_ERROR | None | 118 |
| semantic | 1028 | admin | unassigned_tickets_metric group_by=resolver_name time=last_7d | CL_ERROR | None | grouped |
| semantic | 1028 | admin | unassigned_tickets_metric group_by=queue_name time=last_7d | CL_ERROR | None | grouped |
| semantic | 1028 | admin | unassigned_tickets_metric group_by=queue_type time=last_7d | CL_ERROR | None | 118 |
| semantic | 1028 | admin | unassigned_tickets_metric group_by=account_name time=last_7d | CL_ERROR | None | 118 |
| semantic | 1028 | admin | unassigned_tickets_metric group_by=organization_name time=last_7d | CL_ERROR | None | 118 |
| semantic | 1028 | admin | unassigned_tickets_metric group_by=organization_business_type time=last_7d | CL_ERROR | None | 118 |
| semantic | 1028 | admin | unassigned_tickets_metric group_by=team_supports_ticketing time=last_7d | CL_ERROR | None | 118 |
| semantic | 1028 | admin | unassigned_tickets_metric group_by=created_by_name time=last_7d | CL_ERROR | None | None |
| semantic | 1028 | admin | unassigned_tickets_metric group_by=customer_name time=last_7d | CL_ERROR | None | grouped |
| semantic | 1028 | admin | unassigned_tickets_metric group_by=has_assignee time=last_7d | FALLBACK_FAIL | 0.0 | 118 |
| semantic | 1028 | admin | unassigned_tickets_metric group_by=has_resolver time=last_7d | MISMATCH | 0.0 | 118 |
| semantic | 1028 | admin | unassigned_tickets_metric group_by=has_first_response time=last_7d | MISMATCH | 0.0 | 118 |
| semantic | 1028 | admin | unassigned_tickets_metric group_by=has_csat_rating time=last_7d | MISMATCH | 0.0 | 118 |
| semantic | 1028 | admin | unassigned_tickets_metric group_by=is_overdue time=last_7d | MISMATCH | 0.0 | 118 |
| semantic | 1028 | admin | unassignment_rate group_by=- time=all_time | FALLBACK_PASS | 0.0 | None |
| semantic | 1028 | admin | unassignment_rate group_by=- time=today | FALLBACK_PASS | 0.0 | None |
| semantic | 1028 | admin | unassignment_rate group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1028 | admin | unassignment_rate group_by=- time=last_30d | FALLBACK_PASS | 0.0 | None |
| semantic | 1028 | admin | unassignment_rate group_by=status time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | unassignment_rate group_by=status_display_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | unassignment_rate group_by=is_closed_by_status time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | unassignment_rate group_by=priority time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | unassignment_rate group_by=channel time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | unassignment_rate group_by=category time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | unassignment_rate group_by=skill time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | unassignment_rate group_by=assignee_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | unassignment_rate group_by=assignee_role time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | unassignment_rate group_by=resolver_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | unassignment_rate group_by=queue_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | unassignment_rate group_by=queue_type time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | unassignment_rate group_by=account_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | unassignment_rate group_by=organization_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | unassignment_rate group_by=organization_business_type time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | unassignment_rate group_by=team_supports_ticketing time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | unassignment_rate group_by=created_by_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | unassignment_rate group_by=customer_name time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | unassignment_rate group_by=has_assignee time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | unassignment_rate group_by=has_resolver time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | unassignment_rate group_by=has_first_response time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | unassignment_rate group_by=has_csat_rating time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | unassignment_rate group_by=is_overdue time=last_7d | UNMAPPED | 0.0 | None |
| semantic | 1028 | admin | unread_notifications_metric group_by=- time=all_time | FALLBACK_PASS | 47965.0 | None |
| semantic | 1028 | admin | unread_notifications_metric group_by=- time=today | FALLBACK_PASS | 47965.0 | None |
| semantic | 1028 | admin | unread_notifications_metric group_by=- time=last_7d | FALLBACK_PASS | 47965.0 | None |
| semantic | 1028 | admin | unread_notifications_metric group_by=- time=last_30d | FALLBACK_PASS | 47965.0 | None |
| semantic | 1028 | admin | unread_notifications_metric group_by=kind time=last_7d | UNMAPPED | 6.0 | None |
| semantic | 1028 | admin | unread_notifications_metric group_by=is_read time=last_7d | UNMAPPED | 47997.0 | None |
| semantic | 1025 | agent | accepted_recommendations_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1025 | agent | accounts_served group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 118 |
| semantic | 1025 | agent | active_agents_metric group_by=- time=last_7d | FALLBACK_PASS | 3.0 | None |
| semantic | 1025 | agent | active_customers_metric group_by=- time=last_7d | FALLBACK_PASS | 1000.0 | None |
| semantic | 1025 | agent | active_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 2.0 | 71 |
| semantic | 1025 | agent | approval_rate group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1025 | agent | approval_volume group_by=- time=last_7d | FALLBACK_FAIL | 1356.0 | 118 |
| semantic | 1025 | agent | approved_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1025 | agent | assigned_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 1502.0 | 118 |
| semantic | 1025 | agent | assignment_rate group_by=- time=last_7d | FALLBACK_PASS | 1.0 | None |
| semantic | 1025 | agent | audit_event_volume group_by=- time=last_7d | FALLBACK_FAIL | 1670.0 | 118 |
| semantic | 1025 | agent | average_csat_score group_by=- time=last_7d | FALLBACK_PASS | 3.763440860215054 | 3.7777777777777777 |
| semantic | 1025 | agent | average_decision_hours group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1025 | agent | average_first_response_hours group_by=- time=last_7d | FALLBACK_FAIL | 11.214500666814613 | 10.509536983058176 |
| semantic | 1025 | agent | average_first_response_minutes group_by=- time=last_7d | FALLBACK_FAIL | 672.8700400088768 | 630.5722189834905 |
| semantic | 1025 | agent | average_notes_per_ticket group_by=- time=last_7d | FALLBACK_PASS | 0.1051930758988016 | None |
| semantic | 1025 | agent | average_open_ticket_age_days group_by=- time=last_7d | FALLBACK_FAIL | 1.085104564548611 | 71 |
| semantic | 1025 | agent | average_overdue_hours group_by=- time=last_7d | FALLBACK_FAIL | 50.90433303066305 | 64 |
| semantic | 1025 | agent | average_resolution_hours_variance group_by=- time=last_7d | FALLBACK_FAIL | 49.31638382654011 | 56.12513073286052 |
| semantic | 1025 | agent | average_resolution_time_hours group_by=- time=last_7d | FALLBACK_FAIL | 78.97765490664845 | 56.12513073286052 |
| semantic | 1025 | agent | average_tickets_per_day group_by=- time=last_7d | FALLBACK_PASS | 1502.0 | None |
| semantic | 1025 | agent | breached_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 781.0 | 64 |
| semantic | 1025 | agent | closed_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 597.0 | 21 |
| semantic | 1025 | agent | csat_detractor_metric group_by=- time=last_7d | FALLBACK_FAIL | 70.0 | 6 |
| semantic | 1025 | agent | csat_detractor_rate group_by=- time=last_7d | FALLBACK_PASS | 0.15021459227467812 | None |
| semantic | 1025 | agent | csat_neutral_metric group_by=- time=last_7d | FALLBACK_FAIL | 80.0 | 6 |
| semantic | 1025 | agent | csat_promoter_metric group_by=- time=last_7d | FALLBACK_FAIL | 316.0 | 24 |
| semantic | 1025 | agent | csat_promoter_rate group_by=- time=last_7d | FALLBACK_PASS | 0.6781115879828327 | None |
| semantic | 1025 | agent | csat_rated_metric group_by=- time=last_7d | FALLBACK_FAIL | 466.0 | 36 |
| semantic | 1025 | agent | csat_response_rate group_by=- time=last_7d | FALLBACK_PASS | 0.7805695142378559 | None |
| semantic | 1025 | agent | csat_score_total group_by=- time=last_7d | FALLBACK_FAIL | 1787.0 | 3.7777777777777777 |
| semantic | 1025 | agent | current_overdue_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 898.0 | 64 |
| semantic | 1025 | agent | customer_reply_volume group_by=- time=last_7d | FALLBACK_FAIL | 158.0 | 118 |
| semantic | 1025 | agent | customers_served group_by=- time=last_7d | FALLBACK_PASS | 1000.0 | None |
| semantic | 1025 | agent | days_since_last_ticket group_by=- time=last_7d | FALLBACK_PASS | 0.02240264300925926 | None |
| semantic | 1025 | agent | decided_approvals_metric group_by=- time=last_7d | FALLBACK_PASS | 1356.0 | None |
| semantic | 1025 | agent | decision_hours_total group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1025 | agent | dismissed_recommendations_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1025 | agent | distinct_agents_in_queues group_by=- time=last_7d | FALLBACK_PASS | 7.0 | None |
| semantic | 1025 | agent | distinct_queues_covered group_by=- time=last_7d | FALLBACK_PASS | 7.0 | None |
| semantic | 1025 | agent | due_today_tickets_metric group_by=- time=last_7d | FALLBACK_PASS | 7.0 | None |
| semantic | 1025 | agent | escalation_rate group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1025 | agent | escalation_volume group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 118 |
| semantic | 1025 | agent | first_response_coverage_rate group_by=- time=last_7d | FALLBACK_FAIL | 0.918774966711052 | 10.509536983058176 |
| semantic | 1025 | agent | first_response_hours_total group_by=- time=last_7d | FALLBACK_FAIL | 15476.010920204166 | 10.509536983058176 |
| semantic | 1025 | agent | first_response_sla_compliance_rate group_by=- time=last_7d | FALLBACK_FAIL | 0.17173913043478262 | 10.509536983058176 |
| semantic | 1025 | agent | first_response_sla_met_metric group_by=- time=last_7d | FALLBACK_FAIL | 237.0 | 10.509536983058176 |
| semantic | 1025 | agent | high_priority_open_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 114.0 | 71 |
| semantic | 1025 | agent | high_priority_ticket_volume group_by=- time=last_7d | FALLBACK_FAIL | 114.0 | 118 |
| semantic | 1025 | agent | internal_note_ratio group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1025 | agent | internal_note_volume group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 118 |
| semantic | 1025 | agent | kb_article_volume group_by=- time=last_7d | FALLBACK_FAIL | 54.0 | 118 |
| semantic | 1025 | agent | kb_published_article_metric group_by=- time=last_7d | FALLBACK_PASS | 54.0 | None |
| semantic | 1025 | agent | kb_views_total group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1025 | agent | macro_volume group_by=- time=last_7d | FALLBACK_FAIL | 1.0 | 118 |
| semantic | 1025 | agent | note_volume group_by=- time=last_7d | FALLBACK_FAIL | 158.0 | 118 |
| semantic | 1025 | agent | notification_volume group_by=- time=last_7d | FALLBACK_FAIL | 48084.0 | 118 |
| semantic | 1025 | agent | open_recommendations_metric group_by=- time=last_7d | FALLBACK_FAIL | 140.0 | 71 |
| semantic | 1025 | agent | open_ticket_age_days_total group_by=- time=last_7d | FALLBACK_FAIL | 2.1766448603240742 | 71 |
| semantic | 1025 | agent | open_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 71 |
| semantic | 1025 | agent | outbound_email_volume group_by=- time=last_7d | FALLBACK_FAIL | 2126.0 | 118 |
| semantic | 1025 | agent | pending_approvals_metric group_by=- time=last_7d | FALLBACK_PASS | 1356.0 | None |
| semantic | 1025 | agent | pending_tickets_metric group_by=- time=last_7d | FALLBACK_PASS | 905.0 | None |
| semantic | 1025 | agent | proactive_audit_volume group_by=- time=last_7d | FALLBACK_FAIL | 2970.0 | 118 |
| semantic | 1025 | agent | queue_count group_by=- time=last_7d | FALLBACK_PASS | 7.0 | None |
| semantic | 1025 | agent | queue_coverage_count group_by=- time=last_7d | FALLBACK_PASS | 27.0 | None |
| semantic | 1025 | agent | queues_at_risk_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1025 | agent | reassignment_volume group_by=- time=last_7d | FALLBACK_FAIL | 2.0 | 118 |
| semantic | 1025 | agent | recommendation_acceptance_rate group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1025 | agent | recommendation_volume group_by=- time=last_7d | FALLBACK_FAIL | 141.0 | 118 |
| semantic | 1025 | agent | rejected_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1025 | agent | reopen_rate group_by=- time=last_7d | FALLBACK_FAIL | 0.20491803278688525 | 71 |
| semantic | 1025 | agent | reopened_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 119.0 | 71 |
| semantic | 1025 | agent | resolution_hours_total group_by=- time=last_7d | FALLBACK_FAIL | 45681.88114444444 | 56.12513073286052 |
| semantic | 1025 | agent | resolution_hours_variance_total group_by=- time=last_7d | FALLBACK_FAIL | 29441.881144444444 | 56.12513073286052 |
| semantic | 1025 | agent | resolution_rate group_by=- time=last_7d | FALLBACK_PASS | 0.3935483870967742 | None |
| semantic | 1025 | agent | resolution_sla_compliance_rate group_by=- time=last_7d | FALLBACK_PASS | 0.22780569514237856 | None |
| semantic | 1025 | agent | resolution_sla_met_metric group_by=- time=last_7d | FALLBACK_PASS | 136.0 | None |
| semantic | 1025 | agent | resolved_for_avg group_by=- time=last_7d | FALLBACK_FAIL | 597.0 | 47 |
| semantic | 1025 | agent | resolved_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 597.0 | 47 |
| semantic | 1025 | agent | sla_at_risk_tickets_metric group_by=- time=last_7d | FALLBACK_PASS | 1.0 | None |
| semantic | 1025 | agent | sla_breach_rate group_by=- time=last_7d | FALLBACK_FAIL | 1.3360655737704918 | 64 |
| semantic | 1025 | agent | ticket_volume group_by=- time=last_7d | FALLBACK_FAIL | 310.0 | 118 |
| semantic | 1025 | agent | tickets_created_today_metric group_by=- time=last_7d | FALLBACK_FAIL | 1.0 | 118 |
| semantic | 1025 | agent | tickets_last_30_days group_by=- time=last_7d | FALLBACK_PASS | 506.0 | None |
| semantic | 1025 | agent | tickets_last_7_days group_by=- time=last_7d | FALLBACK_PASS | 104.0 | None |
| semantic | 1025 | agent | tickets_with_first_response_metric group_by=- time=last_7d | FALLBACK_FAIL | 1380.0 | 10.509536983058176 |
| semantic | 1025 | agent | tickets_with_first_response_sla_target_metric group_by=- time=last_7d | FALLBACK_FAIL | 1380.0 | 10.509536983058176 |
| semantic | 1025 | agent | tickets_with_resolution_sla_target_metric group_by=- time=last_7d | FALLBACK_PASS | 597.0 | None |
| semantic | 1025 | agent | tickets_with_resolver_metric group_by=- time=last_7d | FALLBACK_PASS | 1502.0 | None |
| semantic | 1025 | agent | tickets_with_sla_target_metric group_by=- time=last_7d | FALLBACK_PASS | 597.0 | None |
| semantic | 1025 | agent | tickets_without_resolver_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1025 | agent | unanswered_tickets_metric group_by=- time=last_7d | FALLBACK_PASS | 32.0 | None |
| semantic | 1025 | agent | unassigned_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 118 |
| semantic | 1025 | agent | unassignment_rate group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1025 | agent | unread_notifications_metric group_by=- time=last_7d | FALLBACK_PASS | 48125.0 | None |
| semantic | 1026 | agent | accepted_recommendations_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1026 | agent | accounts_served group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 118 |
| semantic | 1026 | agent | active_agents_metric group_by=- time=last_7d | FALLBACK_PASS | 3.0 | None |
| semantic | 1026 | agent | active_customers_metric group_by=- time=last_7d | FALLBACK_PASS | 1000.0 | None |
| semantic | 1026 | agent | active_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 2.0 | 71 |
| semantic | 1026 | agent | approval_rate group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1026 | agent | approval_volume group_by=- time=last_7d | FALLBACK_FAIL | 1356.0 | 118 |
| semantic | 1026 | agent | approved_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1026 | agent | assigned_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 1502.0 | 118 |
| semantic | 1026 | agent | assignment_rate group_by=- time=last_7d | FALLBACK_PASS | 1.0 | None |
| semantic | 1026 | agent | audit_event_volume group_by=- time=last_7d | FALLBACK_FAIL | 1670.0 | 118 |
| semantic | 1026 | agent | average_csat_score group_by=- time=last_7d | FALLBACK_PASS | 3.8780487804878048 | 3.7777777777777777 |
| semantic | 1026 | agent | average_decision_hours group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1026 | agent | average_first_response_hours group_by=- time=last_7d | FALLBACK_FAIL | 11.214500666814613 | 10.509536983058176 |
| semantic | 1026 | agent | average_first_response_minutes group_by=- time=last_7d | FALLBACK_FAIL | 672.8700400088768 | 630.5722189834905 |
| semantic | 1026 | agent | average_notes_per_ticket group_by=- time=last_7d | FALLBACK_PASS | 0.1051930758988016 | None |
| semantic | 1026 | agent | average_open_ticket_age_days group_by=- time=last_7d | FALLBACK_FAIL | 1.0924914865972222 | 71 |
| semantic | 1026 | agent | average_overdue_hours group_by=- time=last_7d | FALLBACK_FAIL | 50.90433303066305 | 64 |
| semantic | 1026 | agent | average_resolution_hours_variance group_by=- time=last_7d | FALLBACK_FAIL | 49.31638382654011 | 56.12513073286052 |
| semantic | 1026 | agent | average_resolution_time_hours group_by=- time=last_7d | FALLBACK_FAIL | 76.58044109944869 | 56.12513073286052 |
| semantic | 1026 | agent | average_tickets_per_day group_by=- time=last_7d | FALLBACK_PASS | 1502.0 | None |
| semantic | 1026 | agent | breached_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 781.0 | 64 |
| semantic | 1026 | agent | closed_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 597.0 | 21 |
| semantic | 1026 | agent | csat_detractor_metric group_by=- time=last_7d | FALLBACK_FAIL | 70.0 | 6 |
| semantic | 1026 | agent | csat_detractor_rate group_by=- time=last_7d | FALLBACK_PASS | 0.15021459227467812 | None |
| semantic | 1026 | agent | csat_neutral_metric group_by=- time=last_7d | FALLBACK_FAIL | 80.0 | 6 |
| semantic | 1026 | agent | csat_promoter_metric group_by=- time=last_7d | FALLBACK_FAIL | 316.0 | 24 |
| semantic | 1026 | agent | csat_promoter_rate group_by=- time=last_7d | FALLBACK_PASS | 0.6781115879828327 | None |
| semantic | 1026 | agent | csat_rated_metric group_by=- time=last_7d | FALLBACK_FAIL | 466.0 | 36 |
| semantic | 1026 | agent | csat_response_rate group_by=- time=last_7d | FALLBACK_PASS | 0.7805695142378559 | None |
| semantic | 1026 | agent | csat_score_total group_by=- time=last_7d | FALLBACK_FAIL | 1787.0 | 3.7777777777777777 |
| semantic | 1026 | agent | current_overdue_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 898.0 | 64 |
| semantic | 1026 | agent | customer_reply_volume group_by=- time=last_7d | FALLBACK_FAIL | 158.0 | 118 |
| semantic | 1026 | agent | customers_served group_by=- time=last_7d | FALLBACK_PASS | 1000.0 | None |
| semantic | 1026 | agent | days_since_last_ticket group_by=- time=last_7d | FALLBACK_PASS | 0.029799311898148148 | None |
| semantic | 1026 | agent | decided_approvals_metric group_by=- time=last_7d | FALLBACK_PASS | 1356.0 | None |
| semantic | 1026 | agent | decision_hours_total group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1026 | agent | dismissed_recommendations_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1026 | agent | distinct_agents_in_queues group_by=- time=last_7d | FALLBACK_PASS | 7.0 | None |
| semantic | 1026 | agent | distinct_queues_covered group_by=- time=last_7d | FALLBACK_PASS | 7.0 | None |
| semantic | 1026 | agent | due_today_tickets_metric group_by=- time=last_7d | FALLBACK_PASS | 7.0 | None |
| semantic | 1026 | agent | escalation_rate group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1026 | agent | escalation_volume group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 118 |
| semantic | 1026 | agent | first_response_coverage_rate group_by=- time=last_7d | FALLBACK_FAIL | 0.918774966711052 | 10.509536983058176 |
| semantic | 1026 | agent | first_response_hours_total group_by=- time=last_7d | FALLBACK_FAIL | 15476.010920204166 | 10.509536983058176 |
| semantic | 1026 | agent | first_response_sla_compliance_rate group_by=- time=last_7d | FALLBACK_FAIL | 0.17173913043478262 | 10.509536983058176 |
| semantic | 1026 | agent | first_response_sla_met_metric group_by=- time=last_7d | FALLBACK_FAIL | 237.0 | 10.509536983058176 |
| semantic | 1026 | agent | high_priority_open_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 232.0 | 71 |
| semantic | 1026 | agent | high_priority_ticket_volume group_by=- time=last_7d | FALLBACK_FAIL | 232.0 | 118 |
| semantic | 1026 | agent | internal_note_ratio group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1026 | agent | internal_note_volume group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 118 |
| semantic | 1026 | agent | kb_article_volume group_by=- time=last_7d | FALLBACK_FAIL | 58.0 | 118 |
| semantic | 1026 | agent | kb_published_article_metric group_by=- time=last_7d | FALLBACK_PASS | 58.0 | None |
| semantic | 1026 | agent | kb_views_total group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1026 | agent | macro_volume group_by=- time=last_7d | FALLBACK_FAIL | 1.0 | 118 |
| semantic | 1026 | agent | note_volume group_by=- time=last_7d | FALLBACK_FAIL | 158.0 | 118 |
| semantic | 1026 | agent | notification_volume group_by=- time=last_7d | FALLBACK_FAIL | 48189.0 | 118 |
| semantic | 1026 | agent | open_recommendations_metric group_by=- time=last_7d | FALLBACK_FAIL | 143.0 | 71 |
| semantic | 1026 | agent | open_ticket_age_days_total group_by=- time=last_7d | FALLBACK_FAIL | 2.19153169125 | 71 |
| semantic | 1026 | agent | open_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 1.0 | 71 |
| semantic | 1026 | agent | outbound_email_volume group_by=- time=last_7d | FALLBACK_FAIL | 2126.0 | 118 |
| semantic | 1026 | agent | pending_approvals_metric group_by=- time=last_7d | FALLBACK_PASS | 1356.0 | None |
| semantic | 1026 | agent | pending_tickets_metric group_by=- time=last_7d | FALLBACK_PASS | 905.0 | None |
| semantic | 1026 | agent | proactive_audit_volume group_by=- time=last_7d | FALLBACK_FAIL | 2975.0 | 118 |
| semantic | 1026 | agent | queue_count group_by=- time=last_7d | FALLBACK_PASS | 7.0 | None |
| semantic | 1026 | agent | queue_coverage_count group_by=- time=last_7d | FALLBACK_PASS | 27.0 | None |
| semantic | 1026 | agent | queues_at_risk_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1026 | agent | reassignment_volume group_by=- time=last_7d | FALLBACK_FAIL | 2.0 | 118 |
| semantic | 1026 | agent | recommendation_acceptance_rate group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1026 | agent | recommendation_volume group_by=- time=last_7d | FALLBACK_FAIL | 143.0 | 118 |
| semantic | 1026 | agent | rejected_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1026 | agent | reopen_rate group_by=- time=last_7d | FALLBACK_FAIL | 0.1946564885496183 | 71 |
| semantic | 1026 | agent | reopened_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 119.0 | 71 |
| semantic | 1026 | agent | resolution_hours_total group_by=- time=last_7d | FALLBACK_FAIL | 45681.88114444444 | 56.12513073286052 |
| semantic | 1026 | agent | resolution_hours_variance_total group_by=- time=last_7d | FALLBACK_FAIL | 29441.881144444444 | 56.12513073286052 |
| semantic | 1026 | agent | resolution_rate group_by=- time=last_7d | FALLBACK_PASS | 0.4198717948717949 | None |
| semantic | 1026 | agent | resolution_sla_compliance_rate group_by=- time=last_7d | FALLBACK_PASS | 0.22780569514237856 | None |
| semantic | 1026 | agent | resolution_sla_met_metric group_by=- time=last_7d | FALLBACK_PASS | 136.0 | None |
| semantic | 1026 | agent | resolved_for_avg group_by=- time=last_7d | FALLBACK_FAIL | 597.0 | 47 |
| semantic | 1026 | agent | resolved_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 597.0 | 47 |
| semantic | 1026 | agent | sla_at_risk_tickets_metric group_by=- time=last_7d | FALLBACK_PASS | 5.0 | None |
| semantic | 1026 | agent | sla_breach_rate group_by=- time=last_7d | FALLBACK_FAIL | 1.1755725190839694 | 64 |
| semantic | 1026 | agent | ticket_volume group_by=- time=last_7d | FALLBACK_FAIL | 624.0 | 119 |
| semantic | 1026 | agent | tickets_created_today_metric group_by=- time=last_7d | FALLBACK_FAIL | 2.0 | 119 |
| semantic | 1026 | agent | tickets_last_30_days group_by=- time=last_7d | FALLBACK_PASS | 507.0 | None |
| semantic | 1026 | agent | tickets_last_7_days group_by=- time=last_7d | FALLBACK_PASS | 103.0 | None |
| semantic | 1026 | agent | tickets_with_first_response_metric group_by=- time=last_7d | FALLBACK_FAIL | 1380.0 | 10.509536983058176 |
| semantic | 1026 | agent | tickets_with_first_response_sla_target_metric group_by=- time=last_7d | FALLBACK_FAIL | 1380.0 | 10.509536983058176 |
| semantic | 1026 | agent | tickets_with_resolution_sla_target_metric group_by=- time=last_7d | FALLBACK_PASS | 597.0 | None |
| semantic | 1026 | agent | tickets_with_resolver_metric group_by=- time=last_7d | FALLBACK_PASS | 1502.0 | None |
| semantic | 1026 | agent | tickets_with_sla_target_metric group_by=- time=last_7d | FALLBACK_PASS | 597.0 | None |
| semantic | 1026 | agent | tickets_without_resolver_metric group_by=- time=last_7d | FALLBACK_PASS | 1.0 | None |
| semantic | 1026 | agent | unanswered_tickets_metric group_by=- time=last_7d | FALLBACK_PASS | 44.0 | None |
| semantic | 1026 | agent | unassigned_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 1.0 | 118 |
| semantic | 1026 | agent | unassignment_rate group_by=- time=last_7d | FALLBACK_PASS | 0.0006653359946773121 | None |
| semantic | 1026 | agent | unread_notifications_metric group_by=- time=last_7d | FALLBACK_PASS | 48259.0 | None |
| semantic | 1027 | resolver | accepted_recommendations_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1027 | resolver | accounts_served group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 119 |
| semantic | 1027 | resolver | active_agents_metric group_by=- time=last_7d | FALLBACK_PASS | 3.0 | None |
| semantic | 1027 | resolver | active_customers_metric group_by=- time=last_7d | FALLBACK_PASS | 1000.0 | None |
| semantic | 1027 | resolver | active_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 3.0 | 72 |
| semantic | 1027 | resolver | approval_rate group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1027 | resolver | approval_volume group_by=- time=last_7d | FALLBACK_FAIL | 1356.0 | 119 |
| semantic | 1027 | resolver | approved_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1027 | resolver | assigned_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 1502.0 | 118 |
| semantic | 1027 | resolver | assignment_rate group_by=- time=last_7d | FALLBACK_PASS | 0.9993346640053227 | None |
| semantic | 1027 | resolver | audit_event_volume group_by=- time=last_7d | FALLBACK_FAIL | 1671.0 | 119 |
| semantic | 1027 | resolver | average_csat_score group_by=- time=last_7d | FALLBACK_PASS | 3.9072847682119205 | 3.7777777777777777 |
| semantic | 1027 | resolver | average_decision_hours group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1027 | resolver | average_first_response_hours group_by=- time=last_7d | FALLBACK_FAIL | 11.214500666814613 | 10.509536983058176 |
| semantic | 1027 | resolver | average_first_response_minutes group_by=- time=last_7d | FALLBACK_FAIL | 672.8700400088768 | 630.5722189834905 |
| semantic | 1027 | resolver | average_notes_per_ticket group_by=- time=last_7d | FALLBACK_PASS | 0.1051230871590153 | None |
| semantic | 1027 | resolver | average_open_ticket_age_days group_by=- time=last_7d | FALLBACK_FAIL | 0.7340939039236111 | 72 |
| semantic | 1027 | resolver | average_overdue_hours group_by=- time=last_7d | FALLBACK_FAIL | 50.90433303066305 | 64 |
| semantic | 1027 | resolver | average_resolution_hours_variance group_by=- time=last_7d | FALLBACK_FAIL | 49.31638382654011 | 56.12513073286052 |
| semantic | 1027 | resolver | average_resolution_time_hours group_by=- time=last_7d | FALLBACK_FAIL | 76.66437809620597 | 56.12513073286052 |
| semantic | 1027 | resolver | average_tickets_per_day group_by=- time=last_7d | FALLBACK_PASS | 1503.0 | None |
| semantic | 1027 | resolver | breached_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 781.0 | 64 |
| semantic | 1027 | resolver | closed_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 597.0 | 21 |
| semantic | 1027 | resolver | csat_detractor_metric group_by=- time=last_7d | FALLBACK_FAIL | 70.0 | 6 |
| semantic | 1027 | resolver | csat_detractor_rate group_by=- time=last_7d | FALLBACK_PASS | 0.15021459227467812 | None |
| semantic | 1027 | resolver | csat_neutral_metric group_by=- time=last_7d | FALLBACK_FAIL | 80.0 | 6 |
| semantic | 1027 | resolver | csat_promoter_metric group_by=- time=last_7d | FALLBACK_FAIL | 316.0 | 24 |
| semantic | 1027 | resolver | csat_promoter_rate group_by=- time=last_7d | FALLBACK_PASS | 0.6781115879828327 | None |
| semantic | 1027 | resolver | csat_rated_metric group_by=- time=last_7d | FALLBACK_FAIL | 466.0 | 36 |
| semantic | 1027 | resolver | csat_response_rate group_by=- time=last_7d | FALLBACK_PASS | 0.7805695142378559 | None |
| semantic | 1027 | resolver | csat_score_total group_by=- time=last_7d | FALLBACK_FAIL | 1787.0 | 3.7777777777777777 |
| semantic | 1027 | resolver | current_overdue_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 898.0 | 64 |
| semantic | 1027 | resolver | customer_reply_volume group_by=- time=last_7d | FALLBACK_FAIL | 158.0 | 119 |
| semantic | 1027 | resolver | customers_served group_by=- time=last_7d | FALLBACK_PASS | 1000.0 | None |
| semantic | 1027 | resolver | days_since_last_ticket group_by=- time=last_7d | FALLBACK_PASS | 0.0037642822569444443 | None |
| semantic | 1027 | resolver | decided_approvals_metric group_by=- time=last_7d | FALLBACK_PASS | 1356.0 | None |
| semantic | 1027 | resolver | decision_hours_total group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1027 | resolver | dismissed_recommendations_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1027 | resolver | distinct_agents_in_queues group_by=- time=last_7d | FALLBACK_PASS | 7.0 | None |
| semantic | 1027 | resolver | distinct_queues_covered group_by=- time=last_7d | FALLBACK_PASS | 7.0 | None |
| semantic | 1027 | resolver | due_today_tickets_metric group_by=- time=last_7d | FALLBACK_PASS | 7.0 | None |
| semantic | 1027 | resolver | escalation_rate group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1027 | resolver | escalation_volume group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 119 |
| semantic | 1027 | resolver | first_response_coverage_rate group_by=- time=last_7d | FALLBACK_FAIL | 0.9188290086493679 | 10.41188518442108 |
| semantic | 1027 | resolver | first_response_hours_total group_by=- time=last_7d | FALLBACK_FAIL | 15476.071714733056 | 10.41188518442108 |
| semantic | 1027 | resolver | first_response_sla_compliance_rate group_by=- time=last_7d | FALLBACK_FAIL | 0.1723388848660391 | 10.41188518442108 |
| semantic | 1027 | resolver | first_response_sla_met_metric group_by=- time=last_7d | FALLBACK_FAIL | 238.0 | 10.41188518442108 |
| semantic | 1027 | resolver | high_priority_open_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 198.0 | 72 |
| semantic | 1027 | resolver | high_priority_ticket_volume group_by=- time=last_7d | FALLBACK_FAIL | 198.0 | 119 |
| semantic | 1027 | resolver | internal_note_ratio group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1027 | resolver | internal_note_volume group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 119 |
| semantic | 1027 | resolver | kb_article_volume group_by=- time=last_7d | FALLBACK_FAIL | 59.0 | 119 |
| semantic | 1027 | resolver | kb_published_article_metric group_by=- time=last_7d | FALLBACK_PASS | 59.0 | None |
| semantic | 1027 | resolver | kb_views_total group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1027 | resolver | macro_volume group_by=- time=last_7d | FALLBACK_FAIL | 1.0 | 119 |
| semantic | 1027 | resolver | note_volume group_by=- time=last_7d | FALLBACK_FAIL | 158.0 | 119 |
| semantic | 1027 | resolver | notification_volume group_by=- time=last_7d | FALLBACK_FAIL | 48533.0 | 119 |
| semantic | 1027 | resolver | open_recommendations_metric group_by=- time=last_7d | FALLBACK_FAIL | 146.0 | 72 |
| semantic | 1027 | resolver | open_ticket_age_days_total group_by=- time=last_7d | FALLBACK_FAIL | 2.2064349153703704 | 72 |
| semantic | 1027 | resolver | open_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 2.0 | 72 |
| semantic | 1027 | resolver | outbound_email_volume group_by=- time=last_7d | FALLBACK_FAIL | 2192.0 | 119 |
| semantic | 1027 | resolver | pending_approvals_metric group_by=- time=last_7d | FALLBACK_PASS | 1356.0 | None |
| semantic | 1027 | resolver | pending_tickets_metric group_by=- time=last_7d | FALLBACK_PASS | 906.0 | None |
| semantic | 1027 | resolver | proactive_audit_volume group_by=- time=last_7d | FALLBACK_FAIL | 2985.0 | 119 |
| semantic | 1027 | resolver | queue_count group_by=- time=last_7d | FALLBACK_PASS | 7.0 | None |
| semantic | 1027 | resolver | queue_coverage_count group_by=- time=last_7d | FALLBACK_PASS | 27.0 | None |
| semantic | 1027 | resolver | queues_at_risk_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1027 | resolver | reassignment_volume group_by=- time=last_7d | FALLBACK_FAIL | 3.0 | 119 |
| semantic | 1027 | resolver | recommendation_acceptance_rate group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1027 | resolver | recommendation_volume group_by=- time=last_7d | FALLBACK_FAIL | 146.0 | 119 |
| semantic | 1027 | resolver | rejected_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1027 | resolver | reopen_rate group_by=- time=last_7d | FALLBACK_FAIL | 0.23414634146341465 | 72 |
| semantic | 1027 | resolver | reopened_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 119.0 | 72 |
| semantic | 1027 | resolver | resolution_hours_total group_by=- time=last_7d | FALLBACK_FAIL | 45681.88114444444 | 56.12513073286052 |
| semantic | 1027 | resolver | resolution_hours_variance_total group_by=- time=last_7d | FALLBACK_FAIL | 29441.881144444444 | 56.12513073286052 |
| semantic | 1027 | resolver | resolution_rate group_by=- time=last_7d | FALLBACK_PASS | 0.3720508166969147 | None |
| semantic | 1027 | resolver | resolution_sla_compliance_rate group_by=- time=last_7d | FALLBACK_PASS | 0.22780569514237856 | None |
| semantic | 1027 | resolver | resolution_sla_met_metric group_by=- time=last_7d | FALLBACK_PASS | 136.0 | None |
| semantic | 1027 | resolver | resolved_for_avg group_by=- time=last_7d | FALLBACK_FAIL | 597.0 | 47 |
| semantic | 1027 | resolver | resolved_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 597.0 | 47 |
| semantic | 1027 | resolver | sla_at_risk_tickets_metric group_by=- time=last_7d | FALLBACK_PASS | 3.0 | None |
| semantic | 1027 | resolver | sla_breach_rate group_by=- time=last_7d | FALLBACK_FAIL | 1.4390243902439024 | 64 |
| semantic | 1027 | resolver | ticket_volume group_by=- time=last_7d | FALLBACK_FAIL | 551.0 | 119 |
| semantic | 1027 | resolver | tickets_created_today_metric group_by=- time=last_7d | FALLBACK_FAIL | 2.0 | 119 |
| semantic | 1027 | resolver | tickets_last_30_days group_by=- time=last_7d | FALLBACK_PASS | 506.0 | None |
| semantic | 1027 | resolver | tickets_last_7_days group_by=- time=last_7d | FALLBACK_PASS | 103.0 | None |
| semantic | 1027 | resolver | tickets_with_first_response_metric group_by=- time=last_7d | FALLBACK_FAIL | 1381.0 | 10.41188518442108 |
| semantic | 1027 | resolver | tickets_with_first_response_sla_target_metric group_by=- time=last_7d | FALLBACK_FAIL | 1381.0 | 10.41188518442108 |
| semantic | 1027 | resolver | tickets_with_resolution_sla_target_metric group_by=- time=last_7d | FALLBACK_PASS | 597.0 | None |
| semantic | 1027 | resolver | tickets_with_resolver_metric group_by=- time=last_7d | FALLBACK_PASS | 1503.0 | None |
| semantic | 1027 | resolver | tickets_with_sla_target_metric group_by=- time=last_7d | FALLBACK_PASS | 597.0 | None |
| semantic | 1027 | resolver | tickets_without_resolver_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1027 | resolver | unanswered_tickets_metric group_by=- time=last_7d | FALLBACK_PASS | 44.0 | None |
| semantic | 1027 | resolver | unassigned_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 119 |
| semantic | 1027 | resolver | unassignment_rate group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1027 | resolver | unread_notifications_metric group_by=- time=last_7d | FALLBACK_PASS | 48592.0 | None |
| semantic | 1029 | agent | accepted_recommendations_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1029 | agent | accounts_served group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 119 |
| semantic | 1029 | agent | active_agents_metric group_by=- time=last_7d | FALLBACK_PASS | 3.0 | None |
| semantic | 1029 | agent | active_customers_metric group_by=- time=last_7d | FALLBACK_PASS | 1000.0 | None |
| semantic | 1029 | agent | active_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 2.0 | 72 |
| semantic | 1029 | agent | approval_rate group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1029 | agent | approval_volume group_by=- time=last_7d | FALLBACK_FAIL | 1357.0 | 119 |
| semantic | 1029 | agent | approved_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1029 | agent | assigned_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 1503.0 | 119 |
| semantic | 1029 | agent | assignment_rate group_by=- time=last_7d | FALLBACK_PASS | 1.0 | None |
| semantic | 1029 | agent | audit_event_volume group_by=- time=last_7d | FALLBACK_FAIL | 1676.0 | 119 |
| semantic | 1029 | agent | average_csat_score group_by=- time=last_7d | FALLBACK_PASS | 3.8214285714285716 | 3.7777777777777777 |
| semantic | 1029 | agent | average_decision_hours group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1029 | agent | average_first_response_hours group_by=- time=last_7d | FALLBACK_FAIL | 11.206424123630018 | 10.41188518442108 |
| semantic | 1029 | agent | average_first_response_minutes group_by=- time=last_7d | FALLBACK_FAIL | 672.3854474178011 | 624.7131110652648 |
| semantic | 1029 | agent | average_notes_per_ticket group_by=- time=last_7d | FALLBACK_PASS | 0.1051230871590153 | None |
| semantic | 1029 | agent | average_open_ticket_age_days group_by=- time=last_7d | FALLBACK_FAIL | 1.1074068146527778 | 72 |
| semantic | 1029 | agent | average_overdue_hours group_by=- time=last_7d | FALLBACK_FAIL | 50.90433303066305 | 64 |
| semantic | 1029 | agent | average_resolution_hours_variance group_by=- time=last_7d | FALLBACK_FAIL | 49.31638382654011 | 56.12513073286052 |
| semantic | 1029 | agent | average_resolution_time_hours group_by=- time=last_7d | FALLBACK_FAIL | 75.03535998956703 | 56.12513073286052 |
| semantic | 1029 | agent | average_tickets_per_day group_by=- time=last_7d | FALLBACK_PASS | 1503.0 | None |
| semantic | 1029 | agent | breached_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 781.0 | 64 |
| semantic | 1029 | agent | closed_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 597.0 | 21 |
| semantic | 1029 | agent | csat_detractor_metric group_by=- time=last_7d | FALLBACK_FAIL | 70.0 | 6 |
| semantic | 1029 | agent | csat_detractor_rate group_by=- time=last_7d | FALLBACK_PASS | 0.15021459227467812 | None |
| semantic | 1029 | agent | csat_neutral_metric group_by=- time=last_7d | FALLBACK_FAIL | 80.0 | 6 |
| semantic | 1029 | agent | csat_promoter_metric group_by=- time=last_7d | FALLBACK_FAIL | 316.0 | 24 |
| semantic | 1029 | agent | csat_promoter_rate group_by=- time=last_7d | FALLBACK_PASS | 0.6781115879828327 | None |
| semantic | 1029 | agent | csat_rated_metric group_by=- time=last_7d | FALLBACK_FAIL | 466.0 | 36 |
| semantic | 1029 | agent | csat_response_rate group_by=- time=last_7d | FALLBACK_PASS | 0.7805695142378559 | None |
| semantic | 1029 | agent | csat_score_total group_by=- time=last_7d | FALLBACK_FAIL | 1787.0 | 3.7777777777777777 |
| semantic | 1029 | agent | current_overdue_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 898.0 | 64 |
| semantic | 1029 | agent | customer_reply_volume group_by=- time=last_7d | FALLBACK_FAIL | 158.0 | 119 |
| semantic | 1029 | agent | customers_served group_by=- time=last_7d | FALLBACK_PASS | 1000.0 | None |
| semantic | 1029 | agent | days_since_last_ticket group_by=- time=last_7d | FALLBACK_PASS | 0.01121868332175926 | None |
| semantic | 1029 | agent | decided_approvals_metric group_by=- time=last_7d | FALLBACK_PASS | 1357.0 | None |
| semantic | 1029 | agent | decision_hours_total group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1029 | agent | dismissed_recommendations_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1029 | agent | distinct_agents_in_queues group_by=- time=last_7d | FALLBACK_PASS | 7.0 | None |
| semantic | 1029 | agent | distinct_queues_covered group_by=- time=last_7d | FALLBACK_PASS | 7.0 | None |
| semantic | 1029 | agent | due_today_tickets_metric group_by=- time=last_7d | FALLBACK_PASS | 7.0 | None |
| semantic | 1029 | agent | escalation_rate group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1029 | agent | escalation_volume group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 119 |
| semantic | 1029 | agent | first_response_coverage_rate group_by=- time=last_7d | FALLBACK_FAIL | 0.9188290086493679 | 10.41188518442108 |
| semantic | 1029 | agent | first_response_hours_total group_by=- time=last_7d | FALLBACK_FAIL | 15476.071714733056 | 10.41188518442108 |
| semantic | 1029 | agent | first_response_sla_compliance_rate group_by=- time=last_7d | FALLBACK_FAIL | 0.1723388848660391 | 10.41188518442108 |
| semantic | 1029 | agent | first_response_sla_met_metric group_by=- time=last_7d | FALLBACK_FAIL | 238.0 | 10.41188518442108 |
| semantic | 1029 | agent | high_priority_open_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 193.0 | 72 |
| semantic | 1029 | agent | high_priority_ticket_volume group_by=- time=last_7d | FALLBACK_FAIL | 193.0 | 119 |
| semantic | 1029 | agent | internal_note_ratio group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1029 | agent | internal_note_volume group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 119 |
| semantic | 1029 | agent | kb_article_volume group_by=- time=last_7d | FALLBACK_FAIL | 59.0 | 119 |
| semantic | 1029 | agent | kb_published_article_metric group_by=- time=last_7d | FALLBACK_PASS | 59.0 | None |
| semantic | 1029 | agent | kb_views_total group_by=- time=last_7d | FALLBACK_PASS | 10.0 | None |
| semantic | 1029 | agent | macro_volume group_by=- time=last_7d | FALLBACK_FAIL | 1.0 | 119 |
| semantic | 1029 | agent | note_volume group_by=- time=last_7d | FALLBACK_FAIL | 158.0 | 119 |
| semantic | 1029 | agent | notification_volume group_by=- time=last_7d | FALLBACK_FAIL | 48653.0 | 119 |
| semantic | 1029 | agent | open_recommendations_metric group_by=- time=last_7d | FALLBACK_FAIL | 149.0 | 72 |
| semantic | 1029 | agent | open_ticket_age_days_total group_by=- time=last_7d | FALLBACK_FAIL | 2.221352837060185 | 72 |
| semantic | 1029 | agent | open_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 1.0 | 72 |
| semantic | 1029 | agent | outbound_email_volume group_by=- time=last_7d | FALLBACK_FAIL | 2192.0 | 119 |
| semantic | 1029 | agent | pending_approvals_metric group_by=- time=last_7d | FALLBACK_PASS | 1357.0 | None |
| semantic | 1029 | agent | pending_tickets_metric group_by=- time=last_7d | FALLBACK_PASS | 906.0 | None |
| semantic | 1029 | agent | proactive_audit_volume group_by=- time=last_7d | FALLBACK_FAIL | 2989.0 | 119 |
| semantic | 1029 | agent | queue_count group_by=- time=last_7d | FALLBACK_PASS | 7.0 | None |
| semantic | 1029 | agent | queue_coverage_count group_by=- time=last_7d | FALLBACK_PASS | 27.0 | None |
| semantic | 1029 | agent | queues_at_risk_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1029 | agent | reassignment_volume group_by=- time=last_7d | FALLBACK_FAIL | 3.0 | 119 |
| semantic | 1029 | agent | recommendation_acceptance_rate group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1029 | agent | recommendation_volume group_by=- time=last_7d | FALLBACK_FAIL | 149.0 | 119 |
| semantic | 1029 | agent | rejected_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1029 | agent | reopen_rate group_by=- time=last_7d | FALLBACK_FAIL | 0.20187793427230047 | 72 |
| semantic | 1029 | agent | reopened_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 119.0 | 72 |
| semantic | 1029 | agent | resolution_hours_total group_by=- time=last_7d | FALLBACK_FAIL | 45681.88114444444 | 56.12513073286052 |
| semantic | 1029 | agent | resolution_hours_variance_total group_by=- time=last_7d | FALLBACK_FAIL | 29441.881144444444 | 56.12513073286052 |
| semantic | 1029 | agent | resolution_rate group_by=- time=last_7d | FALLBACK_PASS | 0.375 | None |
| semantic | 1029 | agent | resolution_sla_compliance_rate group_by=- time=last_7d | FALLBACK_PASS | 0.22780569514237856 | None |
| semantic | 1029 | agent | resolution_sla_met_metric group_by=- time=last_7d | FALLBACK_PASS | 136.0 | None |
| semantic | 1029 | agent | resolved_for_avg group_by=- time=last_7d | FALLBACK_FAIL | 597.0 | 47 |
| semantic | 1029 | agent | resolved_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 597.0 | 47 |
| semantic | 1029 | agent | sla_at_risk_tickets_metric group_by=- time=last_7d | FALLBACK_PASS | 1.0 | None |
| semantic | 1029 | agent | sla_breach_rate group_by=- time=last_7d | FALLBACK_FAIL | 1.4553990610328638 | 65 |
| semantic | 1029 | agent | ticket_volume group_by=- time=last_7d | FALLBACK_FAIL | 568.0 | 119 |
| semantic | 1029 | agent | tickets_created_today_metric group_by=- time=last_7d | FALLBACK_FAIL | 2.0 | 119 |
| semantic | 1029 | agent | tickets_last_30_days group_by=- time=last_7d | FALLBACK_PASS | 506.0 | None |
| semantic | 1029 | agent | tickets_last_7_days group_by=- time=last_7d | FALLBACK_PASS | 102.0 | None |
| semantic | 1029 | agent | tickets_with_first_response_metric group_by=- time=last_7d | FALLBACK_FAIL | 1381.0 | 10.41188518442108 |
| semantic | 1029 | agent | tickets_with_first_response_sla_target_metric group_by=- time=last_7d | FALLBACK_FAIL | 1381.0 | 10.41188518442108 |
| semantic | 1029 | agent | tickets_with_resolution_sla_target_metric group_by=- time=last_7d | FALLBACK_PASS | 597.0 | None |
| semantic | 1029 | agent | tickets_with_resolver_metric group_by=- time=last_7d | FALLBACK_PASS | 1503.0 | None |
| semantic | 1029 | agent | tickets_with_sla_target_metric group_by=- time=last_7d | FALLBACK_PASS | 597.0 | None |
| semantic | 1029 | agent | tickets_without_resolver_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1029 | agent | unanswered_tickets_metric group_by=- time=last_7d | FALLBACK_PASS | 46.0 | None |
| semantic | 1029 | agent | unassigned_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 119 |
| semantic | 1029 | agent | unassignment_rate group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1029 | agent | unread_notifications_metric group_by=- time=last_7d | FALLBACK_PASS | 48775.0 | None |
| semantic | 1030 | resolver | accepted_recommendations_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1030 | resolver | accounts_served group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 119 |
| semantic | 1030 | resolver | active_agents_metric group_by=- time=last_7d | FALLBACK_PASS | 3.0 | None |
| semantic | 1030 | resolver | active_customers_metric group_by=- time=last_7d | FALLBACK_PASS | 1000.0 | None |
| semantic | 1030 | resolver | active_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 2.0 | 72 |
| semantic | 1030 | resolver | approval_rate group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1030 | resolver | approval_volume group_by=- time=last_7d | FALLBACK_FAIL | 1359.0 | 119 |
| semantic | 1030 | resolver | approved_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1030 | resolver | assigned_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 1503.0 | 119 |
| semantic | 1030 | resolver | assignment_rate group_by=- time=last_7d | FALLBACK_PASS | 1.0 | None |
| semantic | 1030 | resolver | audit_event_volume group_by=- time=last_7d | FALLBACK_FAIL | 1676.0 | 119 |
| semantic | 1030 | resolver | average_csat_score group_by=- time=last_7d | FALLBACK_PASS | 3.840909090909091 | 3.7777777777777777 |
| semantic | 1030 | resolver | average_decision_hours group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1030 | resolver | average_first_response_hours group_by=- time=last_7d | FALLBACK_FAIL | 11.206424123630018 | 10.41188518442108 |
| semantic | 1030 | resolver | average_first_response_minutes group_by=- time=last_7d | FALLBACK_FAIL | 672.3854474178011 | 624.7131110652648 |
| semantic | 1030 | resolver | average_notes_per_ticket group_by=- time=last_7d | FALLBACK_PASS | 0.1051230871590153 | None |
| semantic | 1030 | resolver | average_open_ticket_age_days group_by=- time=last_7d | FALLBACK_FAIL | 1.1148429027083333 | 72 |
| semantic | 1030 | resolver | average_overdue_hours group_by=- time=last_7d | FALLBACK_FAIL | 50.90433303066305 | 65 |
| semantic | 1030 | resolver | average_resolution_hours_variance group_by=- time=last_7d | FALLBACK_FAIL | 49.31638382654011 | 56.12513073286052 |
| semantic | 1030 | resolver | average_resolution_time_hours group_by=- time=last_7d | FALLBACK_FAIL | 78.19763360042735 | 56.12513073286052 |
| semantic | 1030 | resolver | average_tickets_per_day group_by=- time=last_7d | FALLBACK_PASS | 1503.0 | None |
| semantic | 1030 | resolver | breached_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 782.0 | 65 |
| semantic | 1030 | resolver | closed_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 597.0 | 21 |
| semantic | 1030 | resolver | csat_detractor_metric group_by=- time=last_7d | FALLBACK_FAIL | 70.0 | 6 |
| semantic | 1030 | resolver | csat_detractor_rate group_by=- time=last_7d | FALLBACK_PASS | 0.15021459227467812 | None |
| semantic | 1030 | resolver | csat_neutral_metric group_by=- time=last_7d | FALLBACK_FAIL | 80.0 | 6 |
| semantic | 1030 | resolver | csat_promoter_metric group_by=- time=last_7d | FALLBACK_FAIL | 316.0 | 24 |
| semantic | 1030 | resolver | csat_promoter_rate group_by=- time=last_7d | FALLBACK_PASS | 0.6781115879828327 | None |
| semantic | 1030 | resolver | csat_rated_metric group_by=- time=last_7d | FALLBACK_FAIL | 466.0 | 36 |
| semantic | 1030 | resolver | csat_response_rate group_by=- time=last_7d | FALLBACK_PASS | 0.7805695142378559 | None |
| semantic | 1030 | resolver | csat_score_total group_by=- time=last_7d | FALLBACK_FAIL | 1787.0 | 3.7777777777777777 |
| semantic | 1030 | resolver | current_overdue_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 899.0 | 65 |
| semantic | 1030 | resolver | customer_reply_volume group_by=- time=last_7d | FALLBACK_FAIL | 158.0 | 119 |
| semantic | 1030 | resolver | customers_served group_by=- time=last_7d | FALLBACK_PASS | 1000.0 | None |
| semantic | 1030 | resolver | days_since_last_ticket group_by=- time=last_7d | FALLBACK_PASS | 0.018645949988425926 | None |
| semantic | 1030 | resolver | decided_approvals_metric group_by=- time=last_7d | FALLBACK_PASS | 1360.0 | None |
| semantic | 1030 | resolver | decision_hours_total group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1030 | resolver | dismissed_recommendations_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1030 | resolver | distinct_agents_in_queues group_by=- time=last_7d | FALLBACK_PASS | 7.0 | None |
| semantic | 1030 | resolver | distinct_queues_covered group_by=- time=last_7d | FALLBACK_PASS | 7.0 | None |
| semantic | 1030 | resolver | due_today_tickets_metric group_by=- time=last_7d | FALLBACK_PASS | 7.0 | None |
| semantic | 1030 | resolver | escalation_rate group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1030 | resolver | escalation_volume group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 119 |
| semantic | 1030 | resolver | first_response_coverage_rate group_by=- time=last_7d | FALLBACK_FAIL | 0.9188290086493679 | 10.41188518442108 |
| semantic | 1030 | resolver | first_response_hours_total group_by=- time=last_7d | FALLBACK_FAIL | 15476.071714733056 | 10.41188518442108 |
| semantic | 1030 | resolver | first_response_sla_compliance_rate group_by=- time=last_7d | FALLBACK_FAIL | 0.1723388848660391 | 10.41188518442108 |
| semantic | 1030 | resolver | first_response_sla_met_metric group_by=- time=last_7d | FALLBACK_FAIL | 238.0 | 10.41188518442108 |
| semantic | 1030 | resolver | high_priority_open_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 45.0 | 72 |
| semantic | 1030 | resolver | high_priority_ticket_volume group_by=- time=last_7d | FALLBACK_FAIL | 45.0 | 119 |
| semantic | 1030 | resolver | internal_note_ratio group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1030 | resolver | internal_note_volume group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 119 |
| semantic | 1030 | resolver | kb_article_volume group_by=- time=last_7d | FALLBACK_FAIL | 59.0 | 119 |
| semantic | 1030 | resolver | kb_published_article_metric group_by=- time=last_7d | FALLBACK_PASS | 59.0 | None |
| semantic | 1030 | resolver | kb_views_total group_by=- time=last_7d | FALLBACK_PASS | 10.0 | None |
| semantic | 1030 | resolver | macro_volume group_by=- time=last_7d | FALLBACK_FAIL | 1.0 | 119 |
| semantic | 1030 | resolver | note_volume group_by=- time=last_7d | FALLBACK_FAIL | 158.0 | 119 |
| semantic | 1030 | resolver | notification_volume group_by=- time=last_7d | FALLBACK_FAIL | 48836.0 | 119 |
| semantic | 1030 | resolver | open_recommendations_metric group_by=- time=last_7d | FALLBACK_FAIL | 151.0 | 72 |
| semantic | 1030 | resolver | open_ticket_age_days_total group_by=- time=last_7d | FALLBACK_FAIL | 2.236185813240741 | 72 |
| semantic | 1030 | resolver | open_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 72 |
| semantic | 1030 | resolver | outbound_email_volume group_by=- time=last_7d | FALLBACK_FAIL | 2244.0 | 119 |
| semantic | 1030 | resolver | pending_approvals_metric group_by=- time=last_7d | FALLBACK_PASS | 1360.0 | None |
| semantic | 1030 | resolver | pending_tickets_metric group_by=- time=last_7d | FALLBACK_PASS | 906.0 | None |
| semantic | 1030 | resolver | proactive_audit_volume group_by=- time=last_7d | FALLBACK_FAIL | 2997.0 | 119 |
| semantic | 1030 | resolver | queue_count group_by=- time=last_7d | FALLBACK_PASS | 7.0 | None |
| semantic | 1030 | resolver | queue_coverage_count group_by=- time=last_7d | FALLBACK_PASS | 27.0 | None |
| semantic | 1030 | resolver | queues_at_risk_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1030 | resolver | reassignment_volume group_by=- time=last_7d | FALLBACK_FAIL | 3.0 | 119 |
| semantic | 1030 | resolver | recommendation_acceptance_rate group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1030 | resolver | recommendation_volume group_by=- time=last_7d | FALLBACK_FAIL | 153.0 | 119 |
| semantic | 1030 | resolver | rejected_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1030 | resolver | reopen_rate group_by=- time=last_7d | FALLBACK_FAIL | 0.11538461538461539 | 72 |
| semantic | 1030 | resolver | reopened_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 119.0 | 72 |
| semantic | 1030 | resolver | resolution_hours_total group_by=- time=last_7d | FALLBACK_FAIL | 45681.88114444444 | 56.12513073286052 |
| semantic | 1030 | resolver | resolution_hours_variance_total group_by=- time=last_7d | FALLBACK_FAIL | 29441.881144444444 | 56.12513073286052 |
| semantic | 1030 | resolver | resolution_rate group_by=- time=last_7d | FALLBACK_PASS | 0.3795620437956204 | None |
| semantic | 1030 | resolver | resolution_sla_compliance_rate group_by=- time=last_7d | FALLBACK_PASS | 0.22780569514237856 | None |
| semantic | 1030 | resolver | resolution_sla_met_metric group_by=- time=last_7d | FALLBACK_PASS | 136.0 | None |
| semantic | 1030 | resolver | resolved_for_avg group_by=- time=last_7d | FALLBACK_FAIL | 597.0 | 47 |
| semantic | 1030 | resolver | resolved_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 597.0 | 47 |
| semantic | 1030 | resolver | sla_at_risk_tickets_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1030 | resolver | sla_breach_rate group_by=- time=last_7d | FALLBACK_FAIL | 1.5 | 65 |
| semantic | 1030 | resolver | ticket_volume group_by=- time=last_7d | FALLBACK_FAIL | 137.0 | 119 |
| semantic | 1030 | resolver | tickets_created_today_metric group_by=- time=last_7d | FALLBACK_FAIL | 2.0 | 119 |
| semantic | 1030 | resolver | tickets_last_30_days group_by=- time=last_7d | FALLBACK_PASS | 506.0 | None |
| semantic | 1030 | resolver | tickets_last_7_days group_by=- time=last_7d | FALLBACK_PASS | 101.0 | None |
| semantic | 1030 | resolver | tickets_with_first_response_metric group_by=- time=last_7d | FALLBACK_FAIL | 1381.0 | 10.41188518442108 |
| semantic | 1030 | resolver | tickets_with_first_response_sla_target_metric group_by=- time=last_7d | FALLBACK_FAIL | 1381.0 | 10.41188518442108 |
| semantic | 1030 | resolver | tickets_with_resolution_sla_target_metric group_by=- time=last_7d | FALLBACK_PASS | 597.0 | None |
| semantic | 1030 | resolver | tickets_with_resolver_metric group_by=- time=last_7d | FALLBACK_PASS | 1503.0 | None |
| semantic | 1030 | resolver | tickets_with_sla_target_metric group_by=- time=last_7d | FALLBACK_PASS | 597.0 | None |
| semantic | 1030 | resolver | tickets_without_resolver_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1030 | resolver | unanswered_tickets_metric group_by=- time=last_7d | FALLBACK_PASS | 11.0 | None |
| semantic | 1030 | resolver | unassigned_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 119 |
| semantic | 1030 | resolver | unassignment_rate group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1030 | resolver | unread_notifications_metric group_by=- time=last_7d | FALLBACK_PASS | 48953.0 | None |
| semantic | 1031 | resolver | accepted_recommendations_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1031 | resolver | accounts_served group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 119 |
| semantic | 1031 | resolver | active_agents_metric group_by=- time=last_7d | FALLBACK_PASS | 3.0 | None |
| semantic | 1031 | resolver | active_customers_metric group_by=- time=last_7d | FALLBACK_PASS | 1000.0 | None |
| semantic | 1031 | resolver | active_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 2.0 | 72 |
| semantic | 1031 | resolver | approval_rate group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1031 | resolver | approval_volume group_by=- time=last_7d | FALLBACK_FAIL | 1361.0 | 119 |
| semantic | 1031 | resolver | approved_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1031 | resolver | assigned_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 1503.0 | 119 |
| semantic | 1031 | resolver | assignment_rate group_by=- time=last_7d | FALLBACK_PASS | 1.0 | None |
| semantic | 1031 | resolver | audit_event_volume group_by=- time=last_7d | FALLBACK_FAIL | 1679.0 | 119 |
| semantic | 1031 | resolver | average_csat_score group_by=- time=last_7d | FALLBACK_PASS | 3.772222222222222 | 3.7777777777777777 |
| semantic | 1031 | resolver | average_decision_hours group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1031 | resolver | average_first_response_hours group_by=- time=last_7d | FALLBACK_FAIL | 11.206424123630018 | 10.41188518442108 |
| semantic | 1031 | resolver | average_first_response_minutes group_by=- time=last_7d | FALLBACK_FAIL | 672.3854474178011 | 624.7131110652648 |
| semantic | 1031 | resolver | average_notes_per_ticket group_by=- time=last_7d | FALLBACK_PASS | 0.10711909514304724 | None |
| semantic | 1031 | resolver | average_open_ticket_age_days group_by=- time=last_7d | FALLBACK_FAIL | 1.1222607528587962 | 72 |
| semantic | 1031 | resolver | average_overdue_hours group_by=- time=last_7d | FALLBACK_FAIL | 50.90433303066305 | 65 |
| semantic | 1031 | resolver | average_resolution_hours_variance group_by=- time=last_7d | FALLBACK_FAIL | 49.31638382654011 | 56.12513073286052 |
| semantic | 1031 | resolver | average_resolution_time_hours group_by=- time=last_7d | FALLBACK_FAIL | 78.16049444444445 | 56.12513073286052 |
| semantic | 1031 | resolver | average_tickets_per_day group_by=- time=last_7d | FALLBACK_PASS | 1503.0 | None |
| semantic | 1031 | resolver | breached_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 782.0 | 65 |
| semantic | 1031 | resolver | closed_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 597.0 | 21 |
| semantic | 1031 | resolver | csat_detractor_metric group_by=- time=last_7d | FALLBACK_FAIL | 70.0 | 6 |
| semantic | 1031 | resolver | csat_detractor_rate group_by=- time=last_7d | FALLBACK_PASS | 0.15021459227467812 | None |
| semantic | 1031 | resolver | csat_neutral_metric group_by=- time=last_7d | FALLBACK_FAIL | 80.0 | 6 |
| semantic | 1031 | resolver | csat_promoter_metric group_by=- time=last_7d | FALLBACK_FAIL | 316.0 | 24 |
| semantic | 1031 | resolver | csat_promoter_rate group_by=- time=last_7d | FALLBACK_PASS | 0.6781115879828327 | None |
| semantic | 1031 | resolver | csat_rated_metric group_by=- time=last_7d | FALLBACK_FAIL | 466.0 | 36 |
| semantic | 1031 | resolver | csat_response_rate group_by=- time=last_7d | FALLBACK_PASS | 0.7805695142378559 | None |
| semantic | 1031 | resolver | csat_score_total group_by=- time=last_7d | FALLBACK_FAIL | 1787.0 | 3.7777777777777777 |
| semantic | 1031 | resolver | current_overdue_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 900.0 | 66 |
| semantic | 1031 | resolver | customer_reply_volume group_by=- time=last_7d | FALLBACK_FAIL | 161.0 | 119 |
| semantic | 1031 | resolver | customers_served group_by=- time=last_7d | FALLBACK_PASS | 1000.0 | None |
| semantic | 1031 | resolver | days_since_last_ticket group_by=- time=last_7d | FALLBACK_PASS | 0.026083276215277777 | None |
| semantic | 1031 | resolver | decided_approvals_metric group_by=- time=last_7d | FALLBACK_PASS | 1363.0 | None |
| semantic | 1031 | resolver | decision_hours_total group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1031 | resolver | dismissed_recommendations_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1031 | resolver | distinct_agents_in_queues group_by=- time=last_7d | FALLBACK_PASS | 7.0 | None |
| semantic | 1031 | resolver | distinct_queues_covered group_by=- time=last_7d | FALLBACK_PASS | 7.0 | None |
| semantic | 1031 | resolver | due_today_tickets_metric group_by=- time=last_7d | FALLBACK_PASS | 7.0 | None |
| semantic | 1031 | resolver | escalation_rate group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1031 | resolver | escalation_volume group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 119 |
| semantic | 1031 | resolver | first_response_coverage_rate group_by=- time=last_7d | FALLBACK_FAIL | 0.9188290086493679 | 10.41188518442108 |
| semantic | 1031 | resolver | first_response_hours_total group_by=- time=last_7d | FALLBACK_FAIL | 15476.071714733056 | 10.41188518442108 |
| semantic | 1031 | resolver | first_response_sla_compliance_rate group_by=- time=last_7d | FALLBACK_FAIL | 0.1723388848660391 | 10.41188518442108 |
| semantic | 1031 | resolver | first_response_sla_met_metric group_by=- time=last_7d | FALLBACK_FAIL | 238.0 | 10.41188518442108 |
| semantic | 1031 | resolver | high_priority_open_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 196.0 | 72 |
| semantic | 1031 | resolver | high_priority_ticket_volume group_by=- time=last_7d | FALLBACK_FAIL | 196.0 | 119 |
| semantic | 1031 | resolver | internal_note_ratio group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1031 | resolver | internal_note_volume group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 119 |
| semantic | 1031 | resolver | kb_article_volume group_by=- time=last_7d | FALLBACK_FAIL | 59.0 | 119 |
| semantic | 1031 | resolver | kb_published_article_metric group_by=- time=last_7d | FALLBACK_PASS | 59.0 | None |
| semantic | 1031 | resolver | kb_views_total group_by=- time=last_7d | FALLBACK_PASS | 10.0 | None |
| semantic | 1031 | resolver | macro_volume group_by=- time=last_7d | FALLBACK_FAIL | 1.0 | 119 |
| semantic | 1031 | resolver | note_volume group_by=- time=last_7d | FALLBACK_FAIL | 161.0 | 119 |
| semantic | 1031 | resolver | notification_volume group_by=- time=last_7d | FALLBACK_FAIL | 49277.0 | 119 |
| semantic | 1031 | resolver | open_recommendations_metric group_by=- time=last_7d | FALLBACK_FAIL | 154.0 | 72 |
| semantic | 1031 | resolver | open_ticket_age_days_total group_by=- time=last_7d | FALLBACK_FAIL | 1.2488841916435185 | 72 |
| semantic | 1031 | resolver | open_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 72 |
| semantic | 1031 | resolver | outbound_email_volume group_by=- time=last_7d | FALLBACK_FAIL | 2328.0 | 119 |
| semantic | 1031 | resolver | pending_approvals_metric group_by=- time=last_7d | FALLBACK_PASS | 1366.0 | None |
| semantic | 1031 | resolver | pending_tickets_metric group_by=- time=last_7d | FALLBACK_PASS | 906.0 | None |
| semantic | 1031 | resolver | proactive_audit_volume group_by=- time=last_7d | FALLBACK_FAIL | 3013.0 | 119 |
| semantic | 1031 | resolver | queue_count group_by=- time=last_7d | FALLBACK_PASS | 7.0 | None |
| semantic | 1031 | resolver | queue_coverage_count group_by=- time=last_7d | FALLBACK_PASS | 27.0 | None |
| semantic | 1031 | resolver | queues_at_risk_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1031 | resolver | reassignment_volume group_by=- time=last_7d | FALLBACK_FAIL | 3.0 | 119 |
| semantic | 1031 | resolver | recommendation_acceptance_rate group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1031 | resolver | recommendation_volume group_by=- time=last_7d | FALLBACK_FAIL | 155.0 | 119 |
| semantic | 1031 | resolver | rejected_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1031 | resolver | reopen_rate group_by=- time=last_7d | FALLBACK_FAIL | 0.2026431718061674 | 72 |
| semantic | 1031 | resolver | reopened_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 119.0 | 72 |
| semantic | 1031 | resolver | resolution_hours_total group_by=- time=last_7d | FALLBACK_FAIL | 45681.88114444444 | 56.12513073286052 |
| semantic | 1031 | resolver | resolution_hours_variance_total group_by=- time=last_7d | FALLBACK_FAIL | 29441.881144444444 | 56.12513073286052 |
| semantic | 1031 | resolver | resolution_rate group_by=- time=last_7d | FALLBACK_PASS | 0.4149908592321755 | None |
| semantic | 1031 | resolver | resolution_sla_compliance_rate group_by=- time=last_7d | FALLBACK_PASS | 0.22780569514237856 | None |
| semantic | 1031 | resolver | resolution_sla_met_metric group_by=- time=last_7d | FALLBACK_PASS | 136.0 | None |
| semantic | 1031 | resolver | resolved_for_avg group_by=- time=last_7d | FALLBACK_FAIL | 597.0 | 47 |
| semantic | 1031 | resolver | resolved_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 597.0 | 47 |
| semantic | 1031 | resolver | sla_at_risk_tickets_metric group_by=- time=last_7d | FALLBACK_PASS | 2.0 | None |
| semantic | 1031 | resolver | sla_breach_rate group_by=- time=last_7d | FALLBACK_FAIL | 1.2070484581497798 | 66 |
| semantic | 1031 | resolver | ticket_volume group_by=- time=last_7d | FALLBACK_FAIL | 547.0 | 119 |
| semantic | 1031 | resolver | tickets_created_today_metric group_by=- time=last_7d | FALLBACK_FAIL | 2.0 | 119 |
| semantic | 1031 | resolver | tickets_last_30_days group_by=- time=last_7d | FALLBACK_PASS | 506.0 | None |
| semantic | 1031 | resolver | tickets_last_7_days group_by=- time=last_7d | FALLBACK_PASS | 100.0 | None |
| semantic | 1031 | resolver | tickets_with_first_response_metric group_by=- time=last_7d | FALLBACK_FAIL | 1381.0 | 10.41188518442108 |
| semantic | 1031 | resolver | tickets_with_first_response_sla_target_metric group_by=- time=last_7d | FALLBACK_FAIL | 1381.0 | 10.41188518442108 |
| semantic | 1031 | resolver | tickets_with_resolution_sla_target_metric group_by=- time=last_7d | FALLBACK_PASS | 597.0 | None |
| semantic | 1031 | resolver | tickets_with_resolver_metric group_by=- time=last_7d | FALLBACK_PASS | 1503.0 | None |
| semantic | 1031 | resolver | tickets_with_sla_target_metric group_by=- time=last_7d | FALLBACK_PASS | 597.0 | None |
| semantic | 1031 | resolver | tickets_without_resolver_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1031 | resolver | unanswered_tickets_metric group_by=- time=last_7d | FALLBACK_PASS | 42.0 | None |
| semantic | 1031 | resolver | unassigned_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 119 |
| semantic | 1031 | resolver | unassignment_rate group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1031 | resolver | unread_notifications_metric group_by=- time=last_7d | FALLBACK_PASS | 49335.0 | None |
| semantic | 1032 | resolver | accepted_recommendations_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1032 | resolver | accounts_served group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 119 |
| semantic | 1032 | resolver | active_agents_metric group_by=- time=last_7d | FALLBACK_PASS | 3.0 | None |
| semantic | 1032 | resolver | active_customers_metric group_by=- time=last_7d | FALLBACK_PASS | 1000.0 | None |
| semantic | 1032 | resolver | active_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 1.0 | 72 |
| semantic | 1032 | resolver | approval_rate group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1032 | resolver | approval_volume group_by=- time=last_7d | FALLBACK_FAIL | 1366.0 | 119 |
| semantic | 1032 | resolver | approved_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1032 | resolver | assigned_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 1503.0 | 119 |
| semantic | 1032 | resolver | assignment_rate group_by=- time=last_7d | FALLBACK_PASS | 1.0 | None |
| semantic | 1032 | resolver | audit_event_volume group_by=- time=last_7d | FALLBACK_FAIL | 1679.0 | 119 |
| semantic | 1032 | resolver | average_csat_score group_by=- time=last_7d | FALLBACK_PASS | 3.8351648351648353 | 3.7777777777777777 |
| semantic | 1032 | resolver | average_decision_hours group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1032 | resolver | average_first_response_hours group_by=- time=last_7d | FALLBACK_FAIL | 11.206424123630018 | 10.41188518442108 |
| semantic | 1032 | resolver | average_first_response_minutes group_by=- time=last_7d | FALLBACK_FAIL | 672.3854474178011 | 624.7131110652648 |
| semantic | 1032 | resolver | average_notes_per_ticket group_by=- time=last_7d | FALLBACK_PASS | 0.10711909514304724 | None |
| semantic | 1032 | resolver | average_open_ticket_age_days group_by=- time=last_7d | FALLBACK_FAIL | 1.2530457897916667 | 72 |
| semantic | 1032 | resolver | average_overdue_hours group_by=- time=last_7d | FALLBACK_FAIL | 50.90433303066305 | 66 |
| semantic | 1032 | resolver | average_resolution_hours_variance group_by=- time=last_7d | FALLBACK_FAIL | 49.31638382654011 | 56.12513073286052 |
| semantic | 1032 | resolver | average_resolution_time_hours group_by=- time=last_7d | FALLBACK_FAIL | 72.18561458947886 | 56.12513073286052 |
| semantic | 1032 | resolver | average_tickets_per_day group_by=- time=last_7d | FALLBACK_PASS | 1503.0 | None |
| semantic | 1032 | resolver | breached_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 783.0 | 66 |
| semantic | 1032 | resolver | closed_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 597.0 | 21 |
| semantic | 1032 | resolver | csat_detractor_metric group_by=- time=last_7d | FALLBACK_FAIL | 70.0 | 6 |
| semantic | 1032 | resolver | csat_detractor_rate group_by=- time=last_7d | FALLBACK_PASS | 0.15021459227467812 | None |
| semantic | 1032 | resolver | csat_neutral_metric group_by=- time=last_7d | FALLBACK_FAIL | 80.0 | 6 |
| semantic | 1032 | resolver | csat_promoter_metric group_by=- time=last_7d | FALLBACK_FAIL | 316.0 | 24 |
| semantic | 1032 | resolver | csat_promoter_rate group_by=- time=last_7d | FALLBACK_PASS | 0.6781115879828327 | None |
| semantic | 1032 | resolver | csat_rated_metric group_by=- time=last_7d | FALLBACK_FAIL | 466.0 | 36 |
| semantic | 1032 | resolver | csat_response_rate group_by=- time=last_7d | FALLBACK_PASS | 0.7805695142378559 | None |
| semantic | 1032 | resolver | csat_score_total group_by=- time=last_7d | FALLBACK_FAIL | 1787.0 | 3.7777777777777777 |
| semantic | 1032 | resolver | current_overdue_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 900.0 | 66 |
| semantic | 1032 | resolver | customer_reply_volume group_by=- time=last_7d | FALLBACK_FAIL | 161.0 | 119 |
| semantic | 1032 | resolver | customers_served group_by=- time=last_7d | FALLBACK_PASS | 1000.0 | None |
| semantic | 1032 | resolver | days_since_last_ticket group_by=- time=last_7d | FALLBACK_PASS | 0.03351050939814815 | None |
| semantic | 1032 | resolver | decided_approvals_metric group_by=- time=last_7d | FALLBACK_PASS | 1366.0 | None |
| semantic | 1032 | resolver | decision_hours_total group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1032 | resolver | dismissed_recommendations_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1032 | resolver | distinct_agents_in_queues group_by=- time=last_7d | FALLBACK_PASS | 7.0 | None |
| semantic | 1032 | resolver | distinct_queues_covered group_by=- time=last_7d | FALLBACK_PASS | 7.0 | None |
| semantic | 1032 | resolver | due_today_tickets_metric group_by=- time=last_7d | FALLBACK_PASS | 7.0 | None |
| semantic | 1032 | resolver | escalation_rate group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1032 | resolver | escalation_volume group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 119 |
| semantic | 1032 | resolver | first_response_coverage_rate group_by=- time=last_7d | FALLBACK_FAIL | 0.9188290086493679 | 10.41188518442108 |
| semantic | 1032 | resolver | first_response_hours_total group_by=- time=last_7d | FALLBACK_FAIL | 15476.071714733056 | 10.41188518442108 |
| semantic | 1032 | resolver | first_response_sla_compliance_rate group_by=- time=last_7d | FALLBACK_FAIL | 0.1723388848660391 | 10.41188518442108 |
| semantic | 1032 | resolver | first_response_sla_met_metric group_by=- time=last_7d | FALLBACK_FAIL | 238.0 | 10.41188518442108 |
| semantic | 1032 | resolver | high_priority_open_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 100.0 | 72 |
| semantic | 1032 | resolver | high_priority_ticket_volume group_by=- time=last_7d | FALLBACK_FAIL | 100.0 | 119 |
| semantic | 1032 | resolver | internal_note_ratio group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1032 | resolver | internal_note_volume group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 119 |
| semantic | 1032 | resolver | kb_article_volume group_by=- time=last_7d | FALLBACK_FAIL | 59.0 | 119 |
| semantic | 1032 | resolver | kb_published_article_metric group_by=- time=last_7d | FALLBACK_PASS | 59.0 | None |
| semantic | 1032 | resolver | kb_views_total group_by=- time=last_7d | FALLBACK_PASS | 10.0 | None |
| semantic | 1032 | resolver | macro_volume group_by=- time=last_7d | FALLBACK_FAIL | 1.0 | 119 |
| semantic | 1032 | resolver | note_volume group_by=- time=last_7d | FALLBACK_FAIL | 161.0 | 119 |
| semantic | 1032 | resolver | notification_volume group_by=- time=last_7d | FALLBACK_FAIL | 49427.0 | 119 |
| semantic | 1032 | resolver | open_recommendations_metric group_by=- time=last_7d | FALLBACK_FAIL | 156.0 | 72 |
| semantic | 1032 | resolver | open_ticket_age_days_total group_by=- time=last_7d | FALLBACK_FAIL | 1.2563354752662037 | 72 |
| semantic | 1032 | resolver | open_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 72 |
| semantic | 1032 | resolver | outbound_email_volume group_by=- time=last_7d | FALLBACK_FAIL | 2328.0 | 119 |
| semantic | 1032 | resolver | pending_approvals_metric group_by=- time=last_7d | FALLBACK_PASS | 1367.0 | None |
| semantic | 1032 | resolver | pending_tickets_metric group_by=- time=last_7d | FALLBACK_PASS | 906.0 | None |
| semantic | 1032 | resolver | proactive_audit_volume group_by=- time=last_7d | FALLBACK_FAIL | 3017.0 | 119 |
| semantic | 1032 | resolver | queue_count group_by=- time=last_7d | FALLBACK_PASS | 7.0 | None |
| semantic | 1032 | resolver | queue_coverage_count group_by=- time=last_7d | FALLBACK_PASS | 27.0 | None |
| semantic | 1032 | resolver | queues_at_risk_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1032 | resolver | reassignment_volume group_by=- time=last_7d | FALLBACK_FAIL | 3.0 | 119 |
| semantic | 1032 | resolver | recommendation_acceptance_rate group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1032 | resolver | recommendation_volume group_by=- time=last_7d | FALLBACK_FAIL | 156.0 | 119 |
| semantic | 1032 | resolver | rejected_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1032 | resolver | reopen_rate group_by=- time=last_7d | FALLBACK_FAIL | 0.168141592920354 | 72 |
| semantic | 1032 | resolver | reopened_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 119.0 | 72 |
| semantic | 1032 | resolver | resolution_hours_total group_by=- time=last_7d | FALLBACK_FAIL | 45681.88114444444 | 56.12513073286052 |
| semantic | 1032 | resolver | resolution_hours_variance_total group_by=- time=last_7d | FALLBACK_FAIL | 29441.881144444444 | 56.12513073286052 |
| semantic | 1032 | resolver | resolution_rate group_by=- time=last_7d | FALLBACK_PASS | 0.4232209737827715 | None |
| semantic | 1032 | resolver | resolution_sla_compliance_rate group_by=- time=last_7d | FALLBACK_PASS | 0.22780569514237856 | None |
| semantic | 1032 | resolver | resolution_sla_met_metric group_by=- time=last_7d | FALLBACK_PASS | 136.0 | None |
| semantic | 1032 | resolver | resolved_for_avg group_by=- time=last_7d | FALLBACK_FAIL | 597.0 | 47 |
| semantic | 1032 | resolver | resolved_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 597.0 | 47 |
| semantic | 1032 | resolver | sla_at_risk_tickets_metric group_by=- time=last_7d | FALLBACK_PASS | 2.0 | None |
| semantic | 1032 | resolver | sla_breach_rate group_by=- time=last_7d | FALLBACK_FAIL | 1.1946902654867257 | 66 |
| semantic | 1032 | resolver | ticket_volume group_by=- time=last_7d | FALLBACK_FAIL | 267.0 | 119 |
| semantic | 1032 | resolver | tickets_created_today_metric group_by=- time=last_7d | FALLBACK_FAIL | 2.0 | 119 |
| semantic | 1032 | resolver | tickets_last_30_days group_by=- time=last_7d | FALLBACK_PASS | 505.0 | None |
| semantic | 1032 | resolver | tickets_last_7_days group_by=- time=last_7d | FALLBACK_PASS | 97.0 | None |
| semantic | 1032 | resolver | tickets_with_first_response_metric group_by=- time=last_7d | FALLBACK_FAIL | 1381.0 | 10.41188518442108 |
| semantic | 1032 | resolver | tickets_with_first_response_sla_target_metric group_by=- time=last_7d | FALLBACK_FAIL | 1381.0 | 10.41188518442108 |
| semantic | 1032 | resolver | tickets_with_resolution_sla_target_metric group_by=- time=last_7d | FALLBACK_PASS | 597.0 | None |
| semantic | 1032 | resolver | tickets_with_resolver_metric group_by=- time=last_7d | FALLBACK_PASS | 1503.0 | None |
| semantic | 1032 | resolver | tickets_with_sla_target_metric group_by=- time=last_7d | FALLBACK_PASS | 597.0 | None |
| semantic | 1032 | resolver | tickets_without_resolver_metric group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1032 | resolver | unanswered_tickets_metric group_by=- time=last_7d | FALLBACK_PASS | 25.0 | None |
| semantic | 1032 | resolver | unassigned_tickets_metric group_by=- time=last_7d | FALLBACK_FAIL | 0.0 | 119 |
| semantic | 1032 | resolver | unassignment_rate group_by=- time=last_7d | FALLBACK_PASS | 0.0 | None |
| semantic | 1032 | resolver | unread_notifications_metric group_by=- time=last_7d | FALLBACK_PASS | 49639.0 | None |
| sql | 1025 | agent | List tickets for this organization | CL_ERROR | None | 20 |
| sql | 1025 | agent | List tickets assigned to me | MISMATCH | ['5820', '5845', '5847', '6014', '6036', '6150', '6298', '6365', '6399', '6611', '6738', '6747'] | ['1019', '1060', '1093', '1283', '1366', '1473', '1503', '152', '24', '336', '394', '496'] |
| sql | 1025 | agent | List tickets created by me | MISMATCH | ['5820', '5845', '5847', '6014', '6036', '6150', '6298', '6365', '6399', '6611', '6738', '6747'] | ['1091', '1234', '1275', '1283', '1366', '1381', '1473', '336', '394', '561', '601', '616'] |
| sql | 1025 | agent | List unassigned tickets | CL_ERROR | None | 0 |
| sql | 1025 | agent | List tickets with status Overdue | MISMATCH | ['5820', '5845', '5847', '6036', '6054', '6150', '6201', '6298', '6747', '6764', '6773', '7041'] | ['1019', '1026', '1053', '1093', '1234', '1366', '1381', '1473', '160', '299', '394', '561'] |
| sql | 1025 | agent | List medium priority tickets | MISMATCH | ['1060', '1069', '1227', '1228', '1247', '1254', '1281', '1324', '1345', '1347', '1363', '1376'] | ['1053', '1060', '1081', '1091', '1283', '1503', '152', '24', '299', '329', '605', '616'] |
| sql | 1025 | agent | List tickets created in the last 7 days | MISMATCH | ['5820', '5845', '5847', '6014', '6036', '6150', '6298', '6365', '6399', '6611', '6738', '6747'] | ['1019', '1060', '1093', '1283', '1366', '1473', '1503', '152', '24', '336', '394', '496'] |
| sql | 1025 | agent | List the 10 most recently created tickets | MISMATCH | ['5845', '5847', '6014', '6365', '6399', '6611', '6738', '7160', '7174', '7181'] | ['1019', '1060', '1093', '1503', '24', '336', '616', '687', '721', '933'] |
| sql | 1025 | agent | List customers in this organization | CL_ERROR | None | 20 |
| sql | 1025 | agent | Find the customer with email laustin@gmail.com | CL_ERROR | None | 1 |
| sql | 1025 | agent | List ticket statuses | CL_ERROR | None | 6 |
| sql | 1025 | agent | List ticket priorities | PASS | ['high', 'low', 'medium', 'urgent'] | ['high', 'low', 'medium', 'urgent'] |
| sql | 1025 | agent | List teams | CL_ERROR | None | 7 |
| sql | 1025 | agent | Find the team named Order Management & Fulfillment | CL_ERROR | None | 1 |
| sql | 1025 | agent | Show the members of the team Order Management & Fulfillment | CL_ERROR | None | 4 |
| sql | 1026 | agent | List tickets for this organization | CL_ERROR | None | 20 |
| sql | 1026 | agent | List tickets assigned to me | MISMATCH | ['1179', '5747', '5773', '5834', '5936', '6018', '6074', '6085', '6401', '6404', '6469', '6596'] | ['1', '1104', '1131', '1151', '1177', '1408', '340', '396', '407', '479', '515', '578'] |
| sql | 1026 | agent | List tickets created by me | MISMATCH | ['1179', '5747', '5773', '5834', '5936', '6018', '6074', '6085', '6401', '6404', '6469', '6596'] | ['1104', '1151', '1177', '1298', '1321', '1333', '1408', '340', '396', '407', '479', '515'] |
| sql | 1026 | agent | List unassigned tickets | CL_ERROR | None | 0 |
| sql | 1026 | agent | List tickets with status Overdue | MISMATCH | ['1179', '5834', '5936', '6018', '6074', '6166', '6229', '6404', '6469', '6596', '6805', '6829'] | ['1', '1008', '1151', '1177', '1298', '1321', '1333', '278', '340', '396', '479', '515'] |
| sql | 1026 | agent | List medium priority tickets | MISMATCH | ['1127', '1143', '1200', '1251', '1256', '1408', '1444', '1446', '1447', '1465', '1471', '1489'] | ['1143', '1168', '1282', '1408', '1491', '253', '286', '316', '396', '407', '560', '578'] |
| sql | 1026 | agent | List tickets created in the last 7 days | MISMATCH | ['1179', '5747', '5773', '5834', '5936', '6018', '6074', '6085', '6401', '6404', '6469', '6596'] | ['1', '1104', '1131', '1151', '1177', '1408', '340', '396', '407', '479', '515', '578'] |
| sql | 1026 | agent | List the 10 most recently created tickets | MISMATCH | ['1179', '5747', '5773', '5834', '5936', '6018', '6074', '6085', '6401', '6404', '6469', '6596'] | ['1', '1131', '1177', '340', '396', '407', '515', '699', '864', '95'] |
| sql | 1026 | agent | List customers in this organization | CL_ERROR | None | 20 |
| sql | 1026 | agent | Find the customer with email laustin@gmail.com | CL_ERROR | None | 1 |
| sql | 1026 | agent | List ticket statuses | CL_ERROR | None | 6 |
| sql | 1026 | agent | List ticket priorities | PASS | ['high', 'low', 'medium'] | ['high', 'low', 'medium', 'urgent'] |
| sql | 1026 | agent | List teams | CL_ERROR | None | 7 |
| sql | 1026 | agent | Find the team named Order Management & Fulfillment | CL_ERROR | None | 1 |
| sql | 1026 | agent | Show the members of the team Order Management & Fulfillment | CL_ERROR | None | 4 |
| sql | 1027 | resolver | List tickets for this organization | CL_ERROR | None | 20 |
| sql | 1027 | resolver | List tickets assigned to me | MISMATCH | ['1179', '5773', '5847', '5936', '5973', '6018', '6048', '6363', '6401', '6404', '6480', '6596'] | [] |
| sql | 1027 | resolver | List tickets created by me | MISMATCH | ['1179', '5773', '5847', '5936', '5973', '6018', '6048', '6363', '6401', '6404', '6480', '6596'] | [] |
| sql | 1027 | resolver | List unassigned tickets | CL_ERROR | None | 0 |
| sql | 1027 | resolver | List tickets with status Overdue | MISMATCH | ['1179', '5847', '5936', '5973', '6018', '6125', '6229', '6363', '6404', '6596', '6929', '7126'] | ['1', '114', '1333', '1434', '1499', '340', '479', '641', '685', '716', '726', '786'] |
| sql | 1027 | resolver | List medium priority tickets | MISMATCH | ['1036', '1143', '1200', '1251', '1408', '1465', '1479', '1481', '1483', '1484', '1489', '1499'] | ['1036', '1091', '1143', '1168', '1283', '1408', '1499', '1502', '286', '685', '723', '726'] |
| sql | 1027 | resolver | List tickets created in the last 7 days | MISMATCH | ['1179', '5773', '5847', '5936', '5973', '6018', '6048', '6363', '6401', '6404', '6480', '6596'] | ['1', '1036', '1104', '1131', '1333', '1408', '1502', '340', '370', '479', '641', '685'] |
| sql | 1027 | resolver | List the 10 most recently created tickets | MISMATCH | ['1179', '5773', '5847', '5936', '5973', '6018', '6048', '6363', '6401', '6404', '6480', '6596'] | ['1', '1036', '1131', '1502', '340', '370', '723', '802', '864', '95'] |
| sql | 1027 | resolver | List customers in this organization | CL_ERROR | None | 20 |
| sql | 1027 | resolver | Find the customer with email laustin@gmail.com | CL_ERROR | None | 1 |
| sql | 1027 | resolver | List ticket statuses | CL_ERROR | None | 6 |
| sql | 1027 | resolver | List ticket priorities | PASS | ['high', 'low', 'medium'] | ['high', 'low', 'medium', 'urgent'] |
| sql | 1027 | resolver | List teams | CL_ERROR | None | 7 |
| sql | 1027 | resolver | Find the team named Order Management & Fulfillment | CL_ERROR | None | 1 |
| sql | 1027 | resolver | Show the members of the team Order Management & Fulfillment | CL_ERROR | None | 4 |
| sql | 1028 | admin | List tickets for this organization | GAP | ['5747', '5773', '6014', '6018', '6085', '6365', '6399', '6404', '6480', '6503', '6611', '6714'] | ['1', '1131', '1177', '1198', '1371', '1502', '1503', '336', '340', '370', '396', '407'] |
| sql | 1028 | admin | List tickets assigned to me | CL_ERROR | None | 0 |
| sql | 1028 | admin | List tickets created by me | CL_ERROR | None | 1 |
| sql | 1028 | admin | List unassigned tickets | CL_ERROR | None | 0 |
| sql | 1028 | admin | List tickets with status Overdue | CL_ERROR | None | 20 |
| sql | 1028 | admin | List medium priority tickets | CL_ERROR | None | 20 |
| sql | 1028 | admin | List tickets created in the last 7 days | CL_ERROR | None | 20 |
| sql | 1028 | admin | List the 10 most recently created tickets | CL_ERROR | None | 10 |
| sql | 1028 | admin | List customers in this organization | CL_ERROR | None | 20 |
| sql | 1028 | admin | Find the customer with email laustin@gmail.com | CL_ERROR | None | 1 |
| sql | 1028 | admin | List ticket statuses | CL_ERROR | None | 6 |
| sql | 1028 | admin | List ticket priorities | CL_ERROR | None | 4 |
| sql | 1028 | admin | List teams | CL_ERROR | None | 7 |
| sql | 1028 | admin | Find the team named Order Management & Fulfillment | CL_ERROR | None | 1 |
| sql | 1028 | admin | Show the members of the team Order Management & Fulfillment | CL_ERROR | None | 4 |
| sql | 1029 | agent | List tickets for this organization | CL_ERROR | None | 20 |
| sql | 1029 | agent | List tickets assigned to me | CL_ERROR | None | 20 |
| sql | 1029 | agent | List tickets created by me | CL_ERROR | None | 20 |
| sql | 1029 | agent | List unassigned tickets | CL_ERROR | None | 0 |
| sql | 1029 | agent | List tickets with status Overdue | CL_ERROR | None | 20 |
| sql | 1029 | agent | List medium priority tickets | CL_ERROR | None | 20 |
| sql | 1029 | agent | List tickets created in the last 7 days | CL_ERROR | None | 20 |
| sql | 1029 | agent | List the 10 most recently created tickets | CL_ERROR | None | 10 |
| sql | 1029 | agent | List customers in this organization | CL_ERROR | None | 20 |
| sql | 1029 | agent | Find the customer with email laustin@gmail.com | CL_ERROR | None | 1 |
| sql | 1029 | agent | List ticket statuses | CL_ERROR | None | 6 |
| sql | 1029 | agent | List ticket priorities | CL_ERROR | None | 4 |
| sql | 1029 | agent | List teams | CL_ERROR | None | 7 |
| sql | 1029 | agent | Find the team named Order Management & Fulfillment | CL_ERROR | None | 1 |
| sql | 1029 | agent | Show the members of the team Order Management & Fulfillment | CL_ERROR | None | 4 |
| sql | 1030 | resolver | List tickets for this organization | CL_ERROR | None | 20 |
| sql | 1030 | resolver | List tickets assigned to me | CL_ERROR | None | 0 |
| sql | 1030 | resolver | List tickets created by me | CL_ERROR | None | 0 |
| sql | 1030 | resolver | List unassigned tickets | CL_ERROR | None | 0 |
| sql | 1030 | resolver | List tickets with status Overdue | CL_ERROR | None | 20 |
| sql | 1030 | resolver | List medium priority tickets | CL_ERROR | None | 20 |
| sql | 1030 | resolver | List tickets created in the last 7 days | CL_ERROR | None | 7 |
| sql | 1030 | resolver | List the 10 most recently created tickets | CL_ERROR | None | 10 |
| sql | 1030 | resolver | List customers in this organization | CL_ERROR | None | 20 |
| sql | 1030 | resolver | Find the customer with email laustin@gmail.com | CL_ERROR | None | 1 |
| sql | 1030 | resolver | List ticket statuses | CL_ERROR | None | 6 |
| sql | 1030 | resolver | List ticket priorities | CL_ERROR | None | 4 |
| sql | 1030 | resolver | List teams | CL_ERROR | None | 7 |
| sql | 1030 | resolver | Find the team named Order Management & Fulfillment | CL_ERROR | None | 1 |
| sql | 1030 | resolver | Show the members of the team Order Management & Fulfillment | CL_ERROR | None | 4 |
| sql | 1031 | resolver | List tickets for this organization | CL_ERROR | None | 20 |
| sql | 1031 | resolver | List tickets assigned to me | CL_ERROR | None | 0 |
| sql | 1031 | resolver | List tickets created by me | CL_ERROR | None | 0 |
| sql | 1031 | resolver | List unassigned tickets | CL_ERROR | None | 0 |
| sql | 1031 | resolver | List tickets with status Overdue | CL_ERROR | None | 20 |
| sql | 1031 | resolver | List medium priority tickets | CL_ERROR | None | 20 |
| sql | 1031 | resolver | List tickets created in the last 7 days | CL_ERROR | None | 20 |
| sql | 1031 | resolver | List the 10 most recently created tickets | CL_ERROR | None | 10 |
| sql | 1031 | resolver | List customers in this organization | CL_ERROR | None | 20 |
| sql | 1031 | resolver | Find the customer with email laustin@gmail.com | CL_ERROR | None | 1 |
| sql | 1031 | resolver | List ticket statuses | CL_ERROR | None | 6 |
| sql | 1031 | resolver | List ticket priorities | CL_ERROR | None | 4 |
| sql | 1031 | resolver | List teams | CL_ERROR | None | 7 |
| sql | 1031 | resolver | Find the team named Order Management & Fulfillment | CL_ERROR | None | 1 |
| sql | 1031 | resolver | Show the members of the team Order Management & Fulfillment | CL_ERROR | None | 4 |
| sql | 1032 | resolver | List tickets for this organization | CL_ERROR | None | 20 |
| sql | 1032 | resolver | List tickets assigned to me | MISMATCH | ['5747', '5820', '5845', '5932', '6150', '6256', '6298', '6738', '6855', '6934', '7054', '7094'] | [] |
| sql | 1032 | resolver | List tickets created by me | MISMATCH | ['5747', '5820', '5845', '5932', '6150', '6256', '6298', '6738', '6855', '6934', '7054', '7094'] | [] |
| sql | 1032 | resolver | List unassigned tickets | CL_ERROR | None | 0 |
| sql | 1032 | resolver | List tickets with status Overdue | MISMATCH | ['5820', '5845', '5859', '5932', '6054', '6150', '6201', '6298', '6855', '6934', '7054', '7094'] | ['1019', '1026', '1053', '1093', '115', '1177', '1183', '1234', '1375', '177', '236', '299'] |
| sql | 1032 | resolver | List medium priority tickets | MISMATCH | ['1060', '1187', '1190', '1227', '1230', '1256', '1263', '1281', '1299', '1347', '1376', '1419'] | ['1053', '1060', '115', '1167', '1183', '1262', '1460', '177', '180', '24', '299', '329'] |
| sql | 1032 | resolver | List tickets created in the last 7 days | MISMATCH | ['5747', '5820', '5845', '5932', '6150', '6256', '6298', '6738', '6855', '6934', '7054', '7094'] | ['1019', '1026', '1060', '1093', '1177', '1275', '166', '236', '24', '329', '391', '496'] |
| sql | 1032 | resolver | List the 10 most recently created tickets | MISMATCH | ['5747', '5845', '6150', '6738', '6855', '7125', '7145', '7158', '7165', '7174'] | ['1019', '1060', '1093', '1177', '166', '24', '496', '578', '601', '69'] |
| sql | 1032 | resolver | List customers in this organization | CL_ERROR | None | 20 |
| sql | 1032 | resolver | Find the customer with email laustin@gmail.com | CL_ERROR | None | 1 |
| sql | 1032 | resolver | List ticket statuses | CL_ERROR | None | 6 |
| sql | 1032 | resolver | List ticket priorities | PASS | ['high', 'medium', 'urgent'] | ['high', 'low', 'medium', 'urgent'] |
| sql | 1032 | resolver | List teams | CL_ERROR | None | 7 |
| sql | 1032 | resolver | Find the team named Order Management & Fulfillment | CL_ERROR | None | 1 |
| sql | 1032 | resolver | Show the members of the team Order Management & Fulfillment | CL_ERROR | None | 4 |
