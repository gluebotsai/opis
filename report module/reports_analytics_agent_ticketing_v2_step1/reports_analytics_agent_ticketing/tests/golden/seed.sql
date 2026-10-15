-- TEST DATABASE ONLY. Never run against live ticketing / accounts / cdp.
-- Org 900001 is the golden tenant. Org 900002 proves isolation.

BEGIN;

-- Minimal rows; expand as each KPI is proven. Hand-computed expected.yml matches this seed.

INSERT INTO ticketing.ticket_statuses (organization_id, status, display_name, is_system, is_terminal, sort_order, active)
VALUES
    (900001, 'Open', 'Open', true, false, 1, true),
    (900001, 'Pending', 'In Progress', true, false, 2, true),
    (900001, 'Reopened', 'Reopened', true, false, 3, true),
    (900001, 'Resolved', 'Resolved', true, true, 4, true),
    (900001, 'Overdue', 'Overdue', true, false, 5, true),
    (900001, 'Closed', 'Closed', true, true, 6, true)
ON CONFLICT DO NOTHING;

INSERT INTO ticketing.sla_policies (organization_id, priority, resolution_hours, first_response_hours, active)
VALUES
    (900001, 'low', 72, 8, true),
    (900001, 'medium', 24, 4, true),
    (900001, 'high', 8, 2, true),
    (900001, 'urgent', 4, 1, true)
ON CONFLICT DO NOTHING;

INSERT INTO ticketing.agents (id, organization_id, support_email, status, role, created_at)
VALUES
    (91001, 900001, 'admin@golden.test', 'Active', 'admin', TIMESTAMPTZ '2026-08-01 00:00:00+00'),
    (91002, 900001, 'agent@golden.test', 'Active', 'agent', TIMESTAMPTZ '2026-08-01 00:00:00+00'),
    (91003, 900001, 'resolver@golden.test', 'Active', 'resolver', TIMESTAMPTZ '2026-08-01 00:00:00+00'),
    (91004, 900001, 'inactive@golden.test', 'Inactive', 'agent', TIMESTAMPTZ '2026-08-01 00:00:00+00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ticketing.agent_queues (id, organization_id, queue_name, type, created_at)
VALUES
    (92001, 900001, 'Golden Queue A', 'support', TIMESTAMPTZ '2026-08-01 00:00:00+00'),
    (92002, 900001, 'Golden Queue B', 'support', TIMESTAMPTZ '2026-08-01 00:00:00+00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ticketing.agent_queue_members (organization_id, queue_id, user_id, created_at)
VALUES
    (900001, 92001, 91002, TIMESTAMPTZ '2026-08-01 00:00:00+00'),
    (900001, 92001, 91003, TIMESTAMPTZ '2026-08-01 00:00:00+00'),
    (900001, 92002, 91002, TIMESTAMPTZ '2026-08-01 00:00:00+00');

INSERT INTO ticketing.contact_profile (id, organization_id, cdp_id, status, total_tickets, account_id, created_at)
VALUES
    (93001, 900001, 'cdp-golden-acme', 'Active', 3, 94001, TIMESTAMPTZ '2026-08-01 00:00:00+00'),
    (93002, 900001, 'cdp-golden-beta', 'Inactive', 1, NULL, TIMESTAMPTZ '2026-08-01 00:00:00+00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ticketing.ticketing_accounts (id, organization_id, name, status, created_at)
VALUES
    (94001, 900001, 'Acme', 'Active', TIMESTAMPTZ '2026-08-01 00:00:00+00')
ON CONFLICT (id) DO NOTHING;

-- 8 tickets for org 900001 (all created 2026-09-01 UTC except noted)
-- T1 Open assigned 91002 queue A
-- T2 Open assigned 91002 queue A
-- T3 Pending assigned 91002 queue A
-- T4 Reopened assigned 91002 queue A
-- T5 Resolved assigned 91002 resolver 91003 queue A, csat 5
-- T6 Overdue assigned 91002 queue B
-- T7 Closed assigned 91002 queue B
-- T8 Open unassigned high queue B, customer 93002

INSERT INTO ticketing.tickets (
    id, organization_id, ticket_number, subject, status, priority, channel,
    customer_id, customer_name, assignee_id, assignee_name, resolver_id, resolver_name,
    queue_id, queue_name, due_at, first_response_at, resolved_at, csat_score, csat_rated_at,
    created_by_id, created_by_name, created_at, updated_at, attachments
) VALUES
    (95001, 900001, '#G1', 'g1', 'Open', 'medium', 'Email', 93001, 'Acme User', 91002, 'agent', NULL, NULL, 92001, 'Golden Queue A', TIMESTAMPTZ '2026-09-02 10:00:00+00', NULL, NULL, NULL, NULL, 91001, 'admin', TIMESTAMPTZ '2026-09-01 10:00:00+00', TIMESTAMPTZ '2026-09-01 10:00:00+00', '{}'),
    (95002, 900001, '#G2', 'g2', 'Open', 'medium', 'Email', 93001, 'Acme User', 91002, 'agent', NULL, NULL, 92001, 'Golden Queue A', TIMESTAMPTZ '2026-09-02 10:00:00+00', NULL, NULL, NULL, NULL, 91001, 'admin', TIMESTAMPTZ '2026-09-01 11:00:00+00', TIMESTAMPTZ '2026-09-01 11:00:00+00', '{}'),
    (95003, 900001, '#G3', 'g3', 'Pending', 'medium', 'Chat', 93001, 'Acme User', 91002, 'agent', NULL, NULL, 92001, 'Golden Queue A', TIMESTAMPTZ '2026-09-02 10:00:00+00', TIMESTAMPTZ '2026-09-01 12:00:00+00', NULL, NULL, NULL, 91001, 'admin', TIMESTAMPTZ '2026-09-01 12:00:00+00', TIMESTAMPTZ '2026-09-01 12:00:00+00', '{}'),
    (95004, 900001, '#G4', 'g4', 'Reopened', 'medium', 'Email', 93001, 'Acme User', 91002, 'agent', 91003, 'resolver', 92001, 'Golden Queue A', TIMESTAMPTZ '2026-09-02 10:00:00+00', TIMESTAMPTZ '2026-09-01 13:00:00+00', NULL, NULL, NULL, 91001, 'admin', TIMESTAMPTZ '2026-09-01 13:00:00+00', TIMESTAMPTZ '2026-09-01 13:00:00+00', '{}'),
    (95005, 900001, '#G5', 'g5', 'Resolved', 'medium', 'Email', 93001, 'Acme User', 91002, 'agent', 91003, 'resolver', 92001, 'Golden Queue A', TIMESTAMPTZ '2026-09-02 10:00:00+00', TIMESTAMPTZ '2026-09-01 14:00:00+00', TIMESTAMPTZ '2026-09-01 18:00:00+00', 5, TIMESTAMPTZ '2026-09-01 19:00:00+00', 91001, 'admin', TIMESTAMPTZ '2026-09-01 14:00:00+00', TIMESTAMPTZ '2026-09-01 19:00:00+00', '{}'),
    (95006, 900001, '#G6', 'g6', 'Overdue', 'high', 'Email', 93001, 'Acme User', 91002, 'agent', NULL, NULL, 92002, 'Golden Queue B', TIMESTAMPTZ '2026-09-01 16:00:00+00', NULL, NULL, NULL, NULL, 91001, 'admin', TIMESTAMPTZ '2026-09-01 15:00:00+00', TIMESTAMPTZ '2026-09-01 15:00:00+00', '{}'),
    (95007, 900001, '#G7', 'g7', 'Closed', 'low', 'Phone', 93002, 'Beta User', 91002, 'agent', 91003, 'resolver', 92002, 'Golden Queue B', TIMESTAMPTZ '2026-09-04 10:00:00+00', TIMESTAMPTZ '2026-09-01 16:30:00+00', TIMESTAMPTZ '2026-09-01 20:00:00+00', 3, TIMESTAMPTZ '2026-09-01 21:00:00+00', 91002, 'agent', TIMESTAMPTZ '2026-09-01 16:00:00+00', TIMESTAMPTZ '2026-09-01 21:00:00+00', '{}'),
    (95008, 900001, '#G8', 'g8', 'Open', 'high', 'Email', 93002, 'Beta User', NULL, 'Unassigned', NULL, NULL, 92002, 'Golden Queue B', TIMESTAMPTZ '2026-09-02 10:00:00+00', NULL, NULL, NULL, NULL, 91001, 'admin', TIMESTAMPTZ '2026-09-01 17:00:00+00', TIMESTAMPTZ '2026-09-01 17:00:00+00', '{}');

INSERT INTO ticketing.tickets (
    id, organization_id, ticket_number, subject, status, priority, channel,
    created_at, updated_at, attachments
) VALUES
    (95999, 900002, '#ISO1', 'other org', 'Open', 'medium', 'Email', TIMESTAMPTZ '2026-09-01 10:00:00+00', TIMESTAMPTZ '2026-09-01 10:00:00+00', '{}');

INSERT INTO ticketing.ticket_notes (id, organization_id, ticket_id, author_id, author_name, body, created_at)
VALUES
    (96001, 900001, 95003, 91002, 'agent', 'public reply', TIMESTAMPTZ '2026-09-01 12:05:00+00'),
    (96002, 900001, 95005, 91002, 'agent', 'note', TIMESTAMPTZ '2026-09-01 14:05:00+00');

INSERT INTO ticketing.audit_events (id, organization_id, ticket_id, action, actor_id, actor_name, meta, created_at)
VALUES
    (97001, 900001, 95001, 'ticket.assigned', 91001, 'admin', '{}'::jsonb, TIMESTAMPTZ '2026-09-01 10:01:00+00'),
    (97002, 900001, 95001, 'ticket.assigned', 91001, 'admin', '{}'::jsonb, TIMESTAMPTZ '2026-09-01 10:02:00+00'),
    (97003, 900001, 95005, 'ticket.escalated', 91002, 'agent', '{}'::jsonb, TIMESTAMPTZ '2026-09-01 14:10:00+00'),
    (97004, 900001, 95005, 'ticket.status_changed', 91003, 'resolver', '{"prev_status":"Resolved","new_status":"Reopened"}'::jsonb, TIMESTAMPTZ '2026-09-01 19:30:00+00');

INSERT INTO ticketing.kb_articles (id, organization_id, title, status, category, views, created_at)
VALUES
    (98001, 900001, 'How to reset', 'Published', 'howto', 10, TIMESTAMPTZ '2026-08-15 00:00:00+00'),
    (98002, 900001, 'Draft piece', 'Draft', 'howto', 1, TIMESTAMPTZ '2026-08-16 00:00:00+00');

INSERT INTO ticketing.notifications (id, organization_id, user_id, kind, is_read, created_at)
VALUES
    (99001, 900001, 91002, 'ticket', false, TIMESTAMPTZ '2026-09-01 18:00:00+00'),
    (99002, 900001, 91002, 'ticket', true, TIMESTAMPTZ '2026-09-01 18:01:00+00'),
    (99003, 900001, 91003, 'ticket', false, TIMESTAMPTZ '2026-09-01 18:02:00+00');

INSERT INTO ticketing.proactive_recommendations (id, organization_id, ticket_id, agent_id, status, created_at)
VALUES
    (99101, 900001, '95001', 'sema', 'accepted', TIMESTAMPTZ '2026-09-01 11:00:00+00'),
    (99102, 900001, '95002', 'sema', 'dismissed', TIMESTAMPTZ '2026-09-01 11:00:00+00'),
    (99103, 900001, '95003', 'sema', 'open', TIMESTAMPTZ '2026-09-01 11:00:00+00');

INSERT INTO ticketing.proactive_approvals (id, organization_id, ticket_id, agent_id, status, tool_name, created_at)
VALUES
    (99201, 900001, '95001', 'sema', 'approved', 'macro', TIMESTAMPTZ '2026-09-01 11:00:00+00'),
    (99202, 900001, '95002', 'sema', 'rejected', 'macro', TIMESTAMPTZ '2026-09-01 11:00:00+00'),
    (99203, 900001, '95003', 'sema', 'pending', 'macro', TIMESTAMPTZ '2026-09-01 11:00:00+00');

COMMIT;
