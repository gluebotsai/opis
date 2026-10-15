yaml = """
  ticketing.contact_profile:
    mode: node
    label: SupportProfile
    key: id
    properties: [id, organization_id, cdp_id, account_id, external_id, status,
                 total_tickets, password_set_at, last_portal_login_at,
                 created_at, updated_at]
    relationships:
      - {type: HAS_SUPPORT_PROFILE, direction: in, target_label: Tenant, target_key: id, from_column: organization_id}
      - {type: OVERLAY_OF, direction: out, target_label: Contact, target_key: cdp_id, from_column: cdp_id}
      - {type: OF_ACCOUNT, direction: out, target_label: ClientAccount, target_key: id, from_column: account_id}

  ticketing.ticketing_accounts:
    mode: node
    label: ClientAccount
    key: id
    properties: [id, organization_id, name, status, created_at, updated_at]
    relationships:
      - {type: HAS_CLIENT_ACCOUNT, direction: in, target_label: Tenant, target_key: id, from_column: organization_id}

  ticketing.agents:
    mode: node
    label: TicketAgent
    key: id
    properties: [id, organization_id, setup_user_id, support_email, support_phone]
    relationships:
      - {type: HAS_TICKET_AGENT, direction: in, target_label: Tenant, target_key: id, from_column: organization_id}
      - {type: OVERLAY_OF, direction: out, target_label: User, target_key: id, from_column: setup_user_id}

  ticketing.agent_queues:
    mode: node
    label: TicketQueue
    key: id
    properties: [id, organization_id, external_id, queue_name, description,
                 type, open_tickets, assigned, sla_status, created_at, updated_at]
    relationships:
      - {type: HAS_TICKET_QUEUE, direction: in, target_label: Tenant, target_key: id, from_column: organization_id}
      - {type: MIRRORED_FROM, direction: out, target_label: Team, target_key: id, from_column: id}

  ticketing.agent_queue_members:
    mode: relationship_only
    from_label: TicketQueue
    from_key: id
    from_column: queue_id
    to_label: TicketAgent
    to_key: id
    to_column: user_id
    type: HAS_MEMBER

  ticketing.tickets:
    mode: node
    label: Ticket
    key: id
    properties: [id, organization_id, ticket_number, subject, description,
                 status, priority, customer_id, customer_name, customer_email,
                 customer_phone, channel, assignee_id, assignee_name,
                 resolver_id, resolver_name, queue_id, queue_name, attachments,
                 due_at, first_response_at, resolved_at, csat_score, csat_rated_at,
                 category, skill, ai_summary, created_by_id, created_by_name,
                 created_at, updated_at]
    relationships:
      - {type: HAS_TICKET, direction: in, target_label: Tenant, target_key: id, from_column: organization_id}
      - {type: REPORTED_VIA, direction: out, target_label: SupportProfile, target_key: id, from_column: customer_id}
      - {type: ASSIGNED_TO, direction: out, target_label: TicketAgent, target_key: id, from_column: assignee_id}
      - {type: RESOLVED_BY, direction: out, target_label: TicketAgent, target_key: id, from_column: resolver_id}
      - {type: CREATED_BY, direction: out, target_label: TicketAgent, target_key: id, from_column: created_by_id}
      - {type: IN_QUEUE, direction: out, target_label: TicketQueue, target_key: id, from_column: queue_id}
      - {type: USES_STATUS, direction: out, target_label: TicketStatus, target_key: status, from_column: status}
      - {type: GOVERNED_BY, direction: out, target_label: TicketSLA, target_key: priority, from_column: priority}

  ticketing.ticket_notes:
    mode: node
    label: TicketNote
    key: id
    properties: [id, organization_id, ticket_id, author_id, author_name,
                 body, visibility, created_at]
    relationships:
      - {type: HAS_TICKET_NOTE, direction: in, target_label: Ticket, target_key: id, from_column: ticket_id}
      - {type: AUTHORED_BY, direction: out, target_label: TicketAgent, target_key: id, from_column: author_id}

  ticketing.ticket_statuses:
    mode: node
    label: TicketStatus
    key: id
    properties: [id, organization_id, status, display_name, is_system,
                 is_terminal, sort_order, active, created_at, updated_at]
    relationships:
      - {type: DEFINES_TICKET_STATUS, direction: in, target_label: Tenant, target_key: id, from_column: organization_id}

  ticketing.sla_policies:
    mode: node
    label: TicketSLA
    key: id
    properties: [id, organization_id, priority, resolution_hours,
                 first_response_hours, display_name, is_system, sort_order,
                 active, created_at, updated_at]
    relationships:
      - {type: DEFINES_TICKET_SLA, direction: in, target_label: Tenant, target_key: id, from_column: organization_id}

  ticketing.dashboard_metrics:
    mode: node
    label: DashboardMetrics
    key: organization_id
    properties: [id, organization_id, open_tickets, on_hold, overdue, due_today,
                 unassigned, open_change, on_hold_change, overdue_change,
                 due_today_change, unassigned_change, captured_at]
    relationships:
      - {type: HAS_DASHBOARD_METRICS, direction: in, target_label: Tenant, target_key: id, from_column: organization_id}

  ticketing.kb_articles:
    mode: node
    label: KnowledgeArticle
    key: id
    properties: [id, organization_id, external_id, title, content, category,
                 author_name, author_id, status, views, attachments,
                 created_at, updated_at]
    relationships:
      - {type: HAS_KNOWLEDGE_ARTICLE, direction: in, target_label: Tenant, target_key: id, from_column: organization_id}
      - {type: AUTHORED_BY, direction: out, target_label: TicketAgent, target_key: id, from_column: author_id}

  ticketing.macros:
    mode: node
    label: ReplyTemplate
    key: id
    properties: [id, organization_id, title, body, created_by_id, created_by_name,
                 created_at, updated_at]
    relationships:
      - {type: HAS_REPLY_TEMPLATE, direction: in, target_label: Tenant, target_key: id, from_column: organization_id}
      - {type: CREATED_BY, direction: out, target_label: TicketAgent, target_key: id, from_column: created_by_id}

  ticketing.automation_rules:
    mode: node
    label: AutomationRule
    key: id
    properties: [id, organization_id, name, event, enabled, priority,
                 created_by_id, created_by_name, created_at, updated_at]
    relationships:
      - {type: HAS_AUTOMATION_RULE, direction: in, target_label: Tenant, target_key: id, from_column: organization_id}
      - {type: CREATED_BY, direction: out, target_label: TicketAgent, target_key: id, from_column: created_by_id}

  ticketing.audit_events:
    mode: node
    label: AuditEvent
    key: id
    properties: [id, organization_id, actor_id, actor_name, action,
                 ticket_id, ticket_number, created_at]
    relationships:
      - {type: HAS_AUDIT_EVENT, direction: in, target_label: Tenant, target_key: id, from_column: organization_id}
      - {type: ACTED_BY, direction: out, target_label: TicketAgent, target_key: id, from_column: actor_id}
      - {type: ON_TICKET, direction: out, target_label: Ticket, target_key: id, from_column: ticket_id}

  ticketing.email_message_refs:
    mode: node
    label: InboundEmailRef
    key: id
    properties: [id, organization_id, message_id, ticket_id, ticket_number, created_at]
    relationships:
      - {type: THREADS_TO, direction: out, target_label: Ticket, target_key: id, from_column: ticket_id}

  ticketing.outbound_email_log:
    mode: node
    label: OutboundEmail
    key: id
    properties: [id, organization_id, ticket_id, ticket_number, kind, to_email,
                 subject, body_preview, status, error, created_at]
    relationships:
      - {type: SENT_FOR, direction: out, target_label: Ticket, target_key: id, from_column: ticket_id}

  ticketing.conversation_contexts:
    mode: node
    label: WorkflowSession
    key: id
    properties: [id, organization_id, user_id, user_key, session_key,
                 version, created_at, updated_at, expires_at]
    relationships:
      - {type: HAS_WORKFLOW_SESSION, direction: in, target_label: Tenant, target_key: id, from_column: organization_id}
      - {type: OWNED_BY, direction: out, target_label: TicketAgent, target_key: id, from_column: user_id}

  ticketing.workflow_events:
    mode: node
    label: WorkflowEvent
    key: id
    properties: [id, organization_id, user_id, user_key, session_key, request_id,
                 conversation_context_id, workflow_id, workflow_type, event_type,
                 version, created_at, expires_at]
    relationships:
      - {type: HAS_WORKFLOW_EVENT, direction: in, target_label: Tenant, target_key: id, from_column: organization_id}
      - {type: GENERATED_BY, direction: out, target_label: TicketAgent, target_key: id, from_column: user_id}
      - {type: IN_CONTEXT, direction: out, target_label: WorkflowSession, target_key: id, from_column: conversation_context_id}

  ticketing.proactive_outbox:
    mode: node
    label: ProactiveEvent
    key: id
    properties: [id, organization_id, event_type, ticket_id, ticket_number, actor,
                 created_at, processed_at]
    relationships:
      - {type: FOR_TICKET, direction: out, target_label: Ticket, target_key: id, from_column: ticket_id}

  ticketing.proactive_recommendations:
    mode: node
    label: ProactiveRecommendation
    key: id
    properties: [id, organization_id, agent_id, ticket_id, status, reason, dedupe_key, created_at]
    relationships:
      - {type: ON_TICKET, direction: out, target_label: Ticket, target_key: id, from_column: ticket_id}

  ticketing.proactive_approvals:
    mode: node
    label: ProactiveApproval
    key: id
    properties: [id, organization_id, agent_id, ticket_id, status, tool_name, created_at]
    relationships:
      - {type: ON_TICKET, direction: out, target_label: Ticket, target_key: id, from_column: ticket_id}

  ticketing.proactive_audit:
    mode: node
    label: ProactiveAudit
    key: id
    properties: [id, organization_id, agent_id, ticket_id, event_id, decision, reason, tool_name, created_at]
    relationships:
      - {type: ON_TICKET, direction: out, target_label: Ticket, target_key: id, from_column: ticket_id}
      - {type: FROM_EVENT, direction: out, target_label: ProactiveEvent, target_key: id, from_column: event_id}

  ticketing.proactive_routing_weights:
    mode: node
    label: ProactiveRoutingWeights
    key: organization_id
    properties: [organization_id, updated_at]
    relationships:
      - {type: HAS_ROUTING_WEIGHTS, direction: in, target_label: Tenant, target_key: id, from_column: organization_id}
"""
with open("ticketing_fixed.yaml", "w") as f:
    f.write(yaml)
