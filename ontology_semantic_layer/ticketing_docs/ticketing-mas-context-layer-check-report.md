# Sep 20 CL layer test v1

Organization `1012`. From-scratch run. Context Layer `http://192.168.11.25:8765`.
Partial write: **700** cases so far.

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

- Cases: **700** · FALLBACK_PASS 1 · GAP 1 · MISMATCH 159 · PASS 205 · UNMAPPED 334

## Failed queries (CL_ERROR / FALLBACK_FAIL)

None.

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
