# Human ontology audit

- Core labels count: 143
- Employee in core: True
- User in core labels: False
- user.kind: []
- staff.role: []

## People gaps
{
  "missing_ticket_assignee_role_presets": [
    "tk.triage_routing_domain",
    "tk.resolution_lifecycle_domain"
  ],
  "missing_staff_role_presets": [
    "tk.triage_routing_domain",
    "tk.resolution_lifecycle_domain",
    "tk.ticket_lifecycle_executor",
    "tk.intelligent_assignment_executor"
  ],
  "employee_graph_label": true,
  "user_graph_label": false
}

## Slice leaks
{
  "tk.super": [],
  "cc.super": [],
  "crm.super": []
}

## Forbidden module relations
followup.yml:Callback|FOR_CUSTOMER|Contact
ticket.yml:Ticket|FOR_CUSTOMER|Contact
ticket.yml:Ticket|ASSIGNED_L1|Agent
ticket.yml:Ticket|RESOLVER_L2|Agent

## Forbidden slice relations
cc.agent_assist.yml:Ticket FOR_CUSTOMER Contact
cc.agent_assist.yml:Ticket ASSIGNED_L1 Agent
cc.agent_assist.yml:Ticket RESOLVER_L2 Agent
cc.agent_assist.yml:Callback FOR_CUSTOMER Contact
cc.ai_support.yml:Ticket FOR_CUSTOMER Contact
cc.ai_support.yml:Ticket ASSIGNED_L1 Agent
cc.ai_support.yml:Ticket RESOLVER_L2 Agent
cc.coworker.yml:Callback FOR_CUSTOMER Contact
cc.followup.yml:Callback FOR_CUSTOMER Contact
cc.interaction_ops.yml:Callback FOR_CUSTOMER Contact
cc.omnichannel.yml:Ticket FOR_CUSTOMER Contact
cc.omnichannel.yml:Ticket ASSIGNED_L1 Agent
cc.omnichannel.yml:Ticket RESOLVER_L2 Agent
cc.presence.yml:Callback FOR_CUSTOMER Contact
cc.recovery.yml:Callback FOR_CUSTOMER Contact
cc.super.yml:Ticket FOR_CUSTOMER Contact
cc.super.yml:Ticket ASSIGNED_L1 Agent
cc.super.yml:Ticket RESOLVER_L2 Agent
cc.super.yml:Callback FOR_CUSTOMER Contact
hub.orchestrator.yml:Ticket FOR_CUSTOMER Contact
hub.orchestrator.yml:Ticket ASSIGNED_L1 Agent
hub.orchestrator.yml:Ticket RESOLVER_L2 Agent
hub.orchestrator.yml:Callback FOR_CUSTOMER Contact
tk.admin.yml:Ticket FOR_CUSTOMER Contact
tk.admin.yml:Ticket ASSIGNED_L1 Agent
tk.admin.yml:Ticket RESOLVER_L2 Agent
tk.portal.yml:Ticket FOR_CUSTOMER Contact
tk.portal.yml:Ticket ASSIGNED_L1 Agent
tk.portal.yml:Ticket RESOLVER_L2 Agent
tk.proactive.yml:Ticket FOR_CUSTOMER Contact
