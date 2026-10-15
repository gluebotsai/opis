#v3 (expanded synonyms for improved retrieval)
metrics = [
  {
    "id": "metric_total_conversations",
    "doc_type": "metric",
    "metric_id": "total_conversations",
    "canonical_name": "Total Conversations",
    "synonyms": [
      "conversation volume",
      "contact volume",
      "number of conversations",
      "how many conversations",
      "overall conversations",
      "conversations count",
      "total interactions",
      "total contacts received",
      "all-channel volume",
      "combined conversation volume",
      "how much traffic did we get",
      "total number of contacts",
      "sum of all conversations",
      "overall contact center volume",
      "how many conversations came in",
      "total chats and calls combined"
    ],
    "description": "Count of distinct conversations started in the period, across all channels (voice and non-voice combined).",
    "dbt_metric_ref": "total_conversations",
    "unit": "count",
    "category": "volume",
    "owner": "ccaas",
    "sensitivity": "low",
    "direction": "neutral",
    "threshold_good": None,
    "threshold_warning": None,
    "threshold_bad": None,
    "threshold_note": "No universal good/bad threshold - volume is contextual to headcount and season. Compare period-over-period instead.",
    "groupable_by": [
      "conversation__channel",
      "conversation__status",
      "conversation__lifecycle_state",
      "conversation__created_at",
      "queue__queue_name",
      "agent__agent_name",
      "conversation__resolution_code"
    ]
  },
{
    "id": "metric_call_volume",
    "doc_type": "metric",
    "metric_id": "call_volume",
    "canonical_name": "Call Volume",
    "synonyms": [
      "voice volume",
      "phone call volume",
      "number of calls",
      "how many calls",
      "call count",
      "voice conversations",
      "total calls",
      "phone volume",
      "voice channel volume",
      "how many calls did we get",
      "total number of phone calls",
      "inbound and outbound call count",
      "how busy was the call queue",
      "voice channel traffic"
    ],
    "description": "Count of conversations on the voice channel only.",
    "dbt_metric_ref": "call_volume",
    "unit": "count",
    "category": "volume",
    "owner": "ccaas",
    "sensitivity": "low",
    "direction": "neutral",
    "threshold_good": None,
    "threshold_warning": None,
    "threshold_bad": None,
    "threshold_note": "No universal good/bad threshold - volume is contextual to headcount and season. Compare period-over-period instead.",
    "groupable_by": [
      "conversation__status",
      "conversation__lifecycle_state",
      "conversation__created_at",
      "queue__queue_name",
      "agent__agent_name",
      "conversation__resolution_code"
    ]
  },
  {
    "id": "metric_handled_volume",
    "doc_type": "metric",
    "metric_id": "handled_volume",
    "canonical_name": "Handled Volume",
    "synonyms": [
      "handled conversations",
      "conversations handled",
      "total handled",
      "volume handled",
      "how many conversations were handled",
      "handled contact volume",
      "number of handled conversations",
      "handled volume",
      "handled chats and calls",
      "total handled interactions",
      "handled conversations count",
      "how many interactions handled"
    ],
    "description": "Count of conversations successfully accepted by human agents or completed by automated bots.",
    "dbt_metric_ref": "handled_volume",
    "unit": "count",
    "category": "volume",
    "owner": "ccaas",
    "sensitivity": "low",
    "direction": "higher_is_better",
    "threshold_good": None,
    "threshold_warning": None,
    "threshold_bad": None,
    "threshold_note": "Contextual to incoming volume and agent capacity.",
    "groupable_by": [
      "conversation__channel",
      "conversation__status",
      "conversation__lifecycle_state",
      "conversation__created_at",
      "queue__queue_name",
      "agent__agent_name"
    ]
  },
  {
    "id": "metric_resolution_rate",
    "doc_type": "metric",
    "metric_id": "resolution_rate",
    "canonical_name": "Resolution Rate",
    "synonyms": [
      "conversation resolution rate",
      "percent resolved",
      "percentage of issues resolved",
      "solve rate",
      "resolution percentage",
      "resolved rate",
      "resolution rate",
      "rate of resolved conversations",
      "issue resolution rate",
      "how many issues were resolved"
    ],
    "description": "Proportion of total conversations that reached a resolved status.",
    "dbt_metric_ref": "resolution_rate",
    "unit": "percent",
    "category": "effectiveness",
    "owner": "ccaas",
    "sensitivity": "medium",
    "direction": "higher_is_better",
    "threshold_good": 0.85,
    "threshold_warning": 0.70,
    "threshold_bad": 0.50,
    "threshold_note": "Benchmark is 70-85%.",
    "groupable_by": [
      "conversation__channel",
      "conversation__created_at",
      "queue__queue_name",
      "agent__agent_name"
    ]
  },
  {
    "id": "metric_chat_volume",
    "doc_type": "metric",
    "metric_id": "chat_volume",
    "canonical_name": "Chat Volume",
    "synonyms": [
      "digital volume",
      "non-voice volume",
      "text conversation volume",
      "chat conversations count",
      "how many chats",
      "digital contact volume",
      "non-call conversations",
      "messaging volume",
      "web and social volume",
      "how many chats did we get",
      "total digital conversations",
      "non-voice channel traffic",
      "chat and message volume",
      "how much chat traffic came in",
      "text-based conversation count"
    ],
    "description": "Count of conversations across all non-voice channels combined (webchat, email, whatsapp, instagram, facebook).",
    "dbt_metric_ref": "chat_volume",
    "unit": "count",
    "category": "volume",
    "owner": "ccaas",
    "sensitivity": "low",
    "direction": "neutral",
    "threshold_good": None,
    "threshold_warning": None,
    "threshold_bad": None,
    "threshold_note": "No universal good/bad threshold - volume is contextual to headcount and season. Compare period-over-period instead.",
    "groupable_by": [
      "conversation__channel",
      "conversation__status",
      "conversation__lifecycle_state",
      "conversation__created_at",
      "queue__queue_name",
      "agent__agent_name",
      "conversation__resolution_code"
    ]
  },
  {
    "id": "metric_email_volume",
    "doc_type": "metric",
    "metric_id": "email_volume",
    "canonical_name": "Email Volume",
    "synonyms": [
      "email conversations",
      "number of emails",
      "how many emails",
      "email count",
      "email channel volume",
      "email contacts",
      "how many emails came in",
      "inbox volume",
      "email traffic",
      "number of email conversations received"
    ],
    "description": "Count of conversations on the email channel only.",
    "dbt_metric_ref": "email_volume",
    "unit": "count",
    "category": "volume",
    "owner": "ccaas",
    "sensitivity": "low",
    "direction": "neutral",
    "threshold_good": None,
    "threshold_warning": None,
    "threshold_bad": None,
    "threshold_note": "No universal good/bad threshold - volume is contextual to headcount and season. Compare period-over-period instead.",
    "groupable_by": [
      "conversation__status",
      "conversation__lifecycle_state",
      "conversation__created_at",
      "queue__queue_name",
      "agent__agent_name",
      "conversation__resolution_code"
    ]
  },
  {
    "id": "metric_social_media_volume",
    "doc_type": "metric",
    "metric_id": "social_media_volume",
    "canonical_name": "Social Media Volume",
    "synonyms": [
      "social media conversations",
      "whatsapp instagram facebook volume",
      "social channel volume",
      "how many social media contacts",
      "social messaging volume",
      "social platform volume",
      "how many DMs did we get",
      "social inbox volume",
      "total social conversations",
      "instagram facebook whatsapp messages count",
      "how much social traffic came in"
    ],
    "description": "Count of conversations across social/messaging channels combined (whatsapp, instagram, facebook).",
    "dbt_metric_ref": "social_media_volume",
    "unit": "count",
    "category": "volume",
    "owner": "ccaas",
    "sensitivity": "low",
    "direction": "neutral",
    "threshold_good": None,
    "threshold_warning": None,
    "threshold_bad": None,
    "threshold_note": "No universal good/bad threshold - volume is contextual to headcount and season. Compare period-over-period instead.",
    "groupable_by": [
      "conversation__channel",
      "conversation__status",
      "conversation__lifecycle_state",
      "conversation__created_at",
      "queue__queue_name",
      "agent__agent_name",
      "conversation__resolution_code"
    ]
  },
  {
    "id": "metric_webchat_volume",
    "doc_type": "metric",
    "metric_id": "webchat_volume",
    "canonical_name": "Webchat Volume",
    "synonyms": [
      "website chat volume",
      "web widget conversations",
      "how many webchats",
      "webchat count",
      "site chat volume",
      "on-site chat volume",
      "how many website chats came in",
      "live chat widget volume",
      "site chat traffic",
      "on-site messaging volume",
      "how busy was the web chat"
    ],
    "description": "Count of conversations on the webchat (website chat widget) channel only.",
    "dbt_metric_ref": "webchat_volume",
    "unit": "count",
    "category": "volume",
    "owner": "ccaas",
    "sensitivity": "low",
    "direction": "neutral",
    "threshold_good": None,
    "threshold_warning": None,
    "threshold_bad": None,
    "threshold_note": "No universal good/bad threshold - volume is contextual to headcount and season. Compare period-over-period instead.",
    "groupable_by": [
      "conversation__status",
      "conversation__lifecycle_state",
      "conversation__created_at",
      "queue__queue_name",
      "agent__agent_name",
      "conversation__resolution_code"
    ]
  },
  {
    "id": "metric_unique_contacts_handled",
    "doc_type": "metric",
    "metric_id": "unique_contacts_handled",
    "canonical_name": "Unique Contacts Handled",
    "synonyms": [
      "distinct customers",
      "unique customers served",
      "how many unique contacts",
      "unique customers handled",
      "distinct contacts served",
      "how many different customers",
      "unique callers",
      "repeat vs unique customers",
      "number of unique users contacted",
      "how many different people did we talk to",
      "distinct customers reached",
      "unique customer count",
      "how many unique people contacted us",
      "number of individual customers served"
    ],
    "description": "Count of distinct contacts (customers) who had at least one conversation in the period.",
    "dbt_metric_ref": "unique_contacts_handled",
    "unit": "count",
    "category": "volume",
    "owner": "ccaas",
    "sensitivity": "low",
    "direction": "neutral",
    "threshold_good": None,
    "threshold_warning": None,
    "threshold_bad": None,
    "threshold_note": "Contextual metric - compare to total_conversations to gauge repeat contact volume.",
    "groupable_by": [
      "conversation__channel",
      "conversation__created_at",
      "queue__queue_name"
    ]
  },
  {
    "id": "metric_open_conversations",
    "doc_type": "metric",
    "metric_id": "open_conversations",
    "canonical_name": "Open Conversations",
    "synonyms": [
      "active conversations",
      "in-progress conversations",
      "currently open contacts",
      "unresolved conversations",
      "pending conversations",
      "conversations still open",
      "unclosed chats",
      "backlog of conversations",
      "how many are still open",
      "how many conversations are still unresolved",
      "what's still open right now",
      "conversations awaiting closure",
      "how big is the open backlog"
    ],
    "description": "Count of conversations currently in status='open' (not yet closed).",
    "dbt_metric_ref": "open_conversations",
    "unit": "count",
    "category": "volume",
    "owner": "ccaas",
    "sensitivity": "low",
    "direction": "lower_is_better",
    "threshold_good": None,
    "threshold_warning": None,
    "threshold_bad": None,
    "threshold_note": "No fixed threshold - a sustained upward trend relative to agent headcount signals backlog risk.",
    "groupable_by": [
      "conversation__channel",
      "queue__queue_name",
      "agent__agent_name",
      "conversation__priority"
    ]
  },
  {
    "id": "metric_sla_breach_rate",
    "doc_type": "metric",
    "metric_id": "sla_breach_rate",
    "canonical_name": "SLA Breach Rate",
    "synonyms": [
      "SLA violations",
      "SLA miss rate",
      "% of SLAs breached",
      "SLA compliance",
      "% SLA missed",
      "SLA failure percentage",
      "service level breach percentage",
      "how many SLAs are we missing",
      "SLA adherence rate",
      "what percent of SLAs are we missing",
      "are we breaching SLA often",
      "SLA breach percentage",
      "how often do we miss SLA",
      "rate of SLA non-compliance"
    ],
    "description": "Proportion of SLA-tracked conversations that breached their SLA (first-response or resolution), out of all SLA-tracked conversations.",
    "dbt_metric_ref": "sla_breach_rate",
    "unit": "percent",
    "category": "sla",
    "owner": "ccaas",
    "sensitivity": "medium",
    "direction": "lower_is_better",
    "threshold_good": 0.05,
    "threshold_warning": 0.1,
    "threshold_bad": 0.15,
    "threshold_note": "good <= 5%, warning 5-10%, bad >= 15%. Tenant-adjustable via seed_kpi_targets.",
    "groupable_by": [
      "conversation__created_at",
      "queue__queue_name"
    ]
  },
  {
    "id": "metric_breached_sla_count",
    "doc_type": "metric",
    "metric_id": "breached_sla_count",
    "canonical_name": "SLA Breaches (count)",
    "synonyms": [
      "number of SLA breaches",
      "how many SLAs breached",
      "total SLA breaches",
      "count of missed SLAs",
      "SLA violation count",
      "number of missed SLAs",
      "how many times did we miss SLA",
      "count of SLA failures",
      "total SLA misses",
      "raw number of breached SLAs"
    ],
    "description": "Raw count of conversations whose SLA state has a non-None breached_at.",
    "dbt_metric_ref": "breached_sla_count",
    "unit": "count",
    "category": "sla",
    "owner": "ccaas",
    "sensitivity": "medium",
    "direction": "lower_is_better",
    "threshold_good": None,
    "threshold_warning": None,
    "threshold_bad": None,
    "threshold_note": "Use sla_breach_rate for a normalized view; this is the raw numerator.",
    "groupable_by": [
      "conversation__created_at",
      "queue__queue_name"
    ]
  },
  {
    "id": "metric_total_agents",
    "doc_type": "metric",
    "metric_id": "total_agents",
    "canonical_name": "Total Agents",
    "synonyms": [
      "agent headcount",
      "number of agents",
      "how many agents",
      "headcount",
      "total reps",
      "total staff",
      "how many reps do we have",
      "agent count",
      "total support staff",
      "how big is the agent team",
      "total number of support reps",
      "size of the agent workforce",
      "how many people work in support",
      "overall agent count"
    ],
    "description": "Count of operational CCaaS agent profiles (ccass.agents), regardless of status.",
    "dbt_metric_ref": "total_agents",
    "unit": "count",
    "category": "workforce",
    "owner": "ccaas",
    "sensitivity": "low",
    "direction": "neutral",
    "threshold_good": None,
    "threshold_warning": None,
    "threshold_bad": None,
    "threshold_note": "Headcount metric, no good/bad direction.",
    "groupable_by": [
      "agent__status",
      "agent__created_at"
    ]
  },
  {
    "id": "metric_active_agents",
    "doc_type": "metric",
    "metric_id": "active_agents",
    "canonical_name": "Active Agents",
    "synonyms": [
      "agents currently active",
      "how many active agents",
      "agents online now",
      "currently working agents",
      "active reps",
      "agents on shift",
      "how many agents are active right now",
      "how many agents are working right now",
      "agents currently logged in",
      "number of live agents",
      "agents available now",
      "how many reps are active"
    ],
    "description": "Count of operational agent profiles with status='active'.",
    "dbt_metric_ref": "active_agents",
    "unit": "count",
    "category": "workforce",
    "owner": "ccaas",
    "sensitivity": "low",
    "direction": "neutral",
    "threshold_good": None,
    "threshold_warning": None,
    "threshold_bad": None,
    "threshold_note": "Headcount metric, no good/bad direction.",
    "groupable_by": [
      "agent__created_at"
    ]
  },
  {
    "id": "metric_total_agents_setup",
    "doc_type": "metric",
    "metric_id": "total_agents_setup",
    "canonical_name": "Total Configured Agents",
    "synonyms": [
      "configured employees",
      "setup user count",
      "total employees configured",
      "user directory count",
      "total setup accounts",
      "how many user profiles exist",
      "how many agent profiles exist",
      "total user accounts configured",
      "how many employees are set up in the system",
      "configured agent count"
    ],
    "description": "Count of platform user directory records (setup_users) - the broader employee/agent config source, distinct from operational ccass.agents.",
    "dbt_metric_ref": "total_agents_setup",
    "unit": "count",
    "category": "workforce",
    "owner": "ccaas",
    "sensitivity": "low",
    "direction": "neutral",
    "threshold_good": None,
    "threshold_warning": None,
    "threshold_bad": None,
    "threshold_note": "Headcount metric, no good/bad direction.",
    "groupable_by": [
      "user__status",
      "user__primary_language",
      "team__team_name"
    ]
  },
  {
    "id": "metric_active_agents_setup",
    "doc_type": "metric",
    "metric_id": "active_agents_setup",
    "canonical_name": "Active Configured Agents",
    "synonyms": [
      "active setup users",
      "active employees",
      "active user accounts",
      "enabled employee accounts",
      "active platform users",
      "how many configured accounts are active",
      "enabled user profile count",
      "how many agent accounts are active",
      "active configured user count"
    ],
    "description": "Count of setup_users records with status='active'.",
    "dbt_metric_ref": "active_agents_setup",
    "unit": "count",
    "category": "workforce",
    "owner": "ccaas",
    "sensitivity": "low",
    "direction": "neutral",
    "threshold_good": None,
    "threshold_warning": None,
    "threshold_bad": None,
    "threshold_note": "Headcount metric, no good/bad direction.",
    "groupable_by": [
      "team__team_name"
    ]
  },
  {
    "id": "metric_open_agent_tasks",
    "doc_type": "metric",
    "metric_id": "open_agent_tasks",
    "canonical_name": "Open Agent Tasks",
    "synonyms": [
      "pending tasks",
      "agent task backlog",
      "unfinished follow-ups",
      "outstanding tasks",
      "follow-up backlog",
      "open callbacks",
      "tasks awaiting action",
      "agent to-do backlog",
      "pending follow-ups count",
      "how many tasks are pending",
      "agent workload backlog",
      "outstanding follow-up count",
      "how many things do agents still need to do",
      "unfinished task count"
    ],
    "description": "Count of agent task inbox items (callbacks, follow-ups, escalations) with status='open'.",
    "dbt_metric_ref": "open_agent_tasks",
    "unit": "count",
    "category": "workforce",
    "owner": "ccaas",
    "sensitivity": "low",
    "direction": "lower_is_better",
    "threshold_good": None,
    "threshold_warning": None,
    "threshold_bad": None,
    "threshold_note": "No fixed threshold - rising trend relative to agent count signals task backlog.",
    "groupable_by": [
      "task__task_type",
      "task__priority",
      "task__channel",
      "task__created_at"
    ]
  },
  {
    "id": "metric_total_transfers",
    "doc_type": "metric",
    "metric_id": "total_transfers",
    "canonical_name": "Total Conversation Transfers",
    "synonyms": [
      "queue transfers",
      "agent transfers",
      "number of transfers",
      "conversation transfers",
      "calls transferred",
      "total handoffs between queues",
      "transfer count",
      "how many transfers happened",
      "how many times were conversations transferred",
      "total number of handoffs",
      "how many conversations changed hands",
      "overall transfer count"
    ],
    "description": "Count of warm/blind transfer requests between queues or agents.",
    "dbt_metric_ref": "total_transfers",
    "unit": "count",
    "category": "handoff",
    "owner": "ccaas",
    "sensitivity": "low",
    "direction": "lower_is_better",
    "threshold_good": None,
    "threshold_warning": None,
    "threshold_bad": None,
    "threshold_note": "Use handover_rate for a normalized view; this is the raw numerator.",
    "groupable_by": [
      "conversation_transfers__state",
      "conversation_transfers__requested_at"
    ]
  },
  {
    "id": "metric_handover_rate",
    "doc_type": "metric",
    "metric_id": "handover_rate",
    "canonical_name": "Handover Rate (transfer-based)",
    "synonyms": [
      "transfer rate",
      "% conversations transferred",
      "conversation transfer percentage",
      "% transferred to another queue",
      "routing transfer rate",
      "how often are chats transferred",
      "what percent of conversations get transferred",
      "how often does routing hand things off",
      "queue-to-queue transfer percentage",
      "share of conversations that get moved"
    ],
    "description": "PROXY. Proportion of conversations that had at least one queue/agent transfer event, out of all conversations. Distinct from ai_handover_rate (which tracks AI-to-human handoff, not queue/agent-to-agent transfer).",
    "dbt_metric_ref": "handover_rate",
    "unit": "percent",
    "category": "handoff",
    "owner": "ccaas",
    "sensitivity": "medium",
    "direction": "lower_is_better",
    "threshold_good": 0.1,
    "threshold_warning": 0.2,
    "threshold_bad": 0.3,
    "threshold_note": "good <= 10%, warning 10-20%, bad >= 30%. High transfer rate signals poor first-contact routing.",
    "groupable_by": [
      "conversation__channel",
      "conversation__created_at",
      "queue__queue_name"
    ]
  },
  {
    "id": "metric_ai_handover_rate",
    "doc_type": "metric",
    "metric_id": "ai_handover_rate",
    "canonical_name": "AI-to-Human Handover Rate",
    "synonyms": [
      "bot escalation rate",
      "AI escalation rate",
      "handoff to human rate",
      "escalation to agent rate",
      "bot to human transfer rate",
      "how often does the bot escalate",
      "AI handoff percentage",
      "chatbot escalation percentage",
      "how often does the bot pass off to a human",
      "percent of bot chats escalated to agents",
      "how frequently does AI hand over to humans",
      "bot-to-agent escalation percentage"
    ],
    "description": "PROXY built from conversations.handoff_reason (no dedicated HandoverEvent table exists). Proportion of conversations where the bot handed off to a human agent, out of all conversations.",
    "dbt_metric_ref": "ai_handover_rate",
    "unit": "percent",
    "category": "ai_performance",
    "owner": "ccaas",
    "sensitivity": "medium",
    "direction": "lower_is_better",
    "threshold_good": 0.2,
    "threshold_warning": 0.35,
    "threshold_bad": 0.5,
    "threshold_note": "good <= 20%, warning 20-35%, bad >= 50%. Lower means the bot is resolving more on its own.",
    "groupable_by": [
      "conversation__channel",
      "conversation__created_at",
      "queue__queue_name"
    ]
  },
  {
    "id": "metric_ai_containment_rate",
    "doc_type": "metric",
    "metric_id": "ai_containment_rate",
    "canonical_name": "AI Containment Rate",
    "synonyms": [
      "bot resolution rate",
      "self-service rate",
      "% resolved by AI",
      "bot deflection rate",
      "automation rate",
      "AI resolution rate",
      "how much does the bot resolve on its own",
      "chatbot success rate",
      "self-serve resolution percentage",
      "how much does the bot handle on its own",
      "percent of conversations fully resolved by AI",
      "what share of chats never need a human",
      "bot self-resolution percentage",
      "how effective is the bot at resolving things without a person"
    ],
    "description": "PROXY: conversations that stayed lifecycle_state='bot' with no handoff_reason and reached closed_at, out of all conversations. Roughly the inverse of ai_handover_rate.",
    "dbt_metric_ref": "ai_containment_rate",
    "unit": "percent",
    "category": "ai_performance",
    "owner": "ccaas",
    "sensitivity": "medium",
    "direction": "higher_is_better",
    "threshold_good": 0.6,
    "threshold_warning": 0.4,
    "threshold_bad": 0.25,
    "threshold_note": "good >= 60%, warning 40-60%, bad <= 25%.",
    "groupable_by": [
      "conversation__channel",
      "conversation__created_at",
      "queue__queue_name"
    ]
  },
  {
    "id": "metric_resolved_dispositions",
    "doc_type": "metric",
    "metric_id": "resolved_dispositions",
    "canonical_name": "Resolved Conversations (final disposition)",
    "synonyms": [
      "closed with disposition",
      "final disposition count",
      "closed and resolved count",
      "final resolution count",
      "conversations closed properly",
      "how many were resolved",
      "how many conversations were properly closed",
      "count of conversations marked resolved",
      "how many got a final resolution",
      "properly closed-out conversation count"
    ],
    "description": "Count of disposition entries marked is_final=True, i.e. conversations that reached a closing disposition.",
    "dbt_metric_ref": "resolved_dispositions",
    "unit": "count",
    "category": "resolution",
    "owner": "ccaas",
    "sensitivity": "low",
    "direction": "higher_is_better",
    "threshold_good": None,
    "threshold_warning": None,
    "threshold_bad": None,
    "threshold_note": "Compare against total_conversations to get a resolution ratio.",
    "groupable_by": [
      "disposition__label",
      "disposition__category",
      "disposition__outcome",
      "conversation_dispositions__applied_at",
      "agent__agent_name"
    ]
  },
  {
    "id": "metric_total_queues_configured",
    "doc_type": "metric",
    "metric_id": "total_queues_configured",
    "canonical_name": "Total Configured Queues",
    "synonyms": [
      "number of queues",
      "how many queues",
      "total routing queues",
      "number of configured queues",
      "how many queues exist",
      "queue count",
      "how many queues do we have set up",
      "total routing queues configured",
      "number of queues in the system"
    ],
    "description": "Count of published routing queues (setup_ccaas_queues).",
    "dbt_metric_ref": "total_queues_configured",
    "unit": "count",
    "category": "config",
    "owner": "ccaas",
    "sensitivity": "low",
    "direction": "neutral",
    "threshold_good": None,
    "threshold_warning": None,
    "threshold_bad": None,
    "threshold_note": "Configuration count, no good/bad direction.",
    "groupable_by": [
      "queue__status",
      "team__team_name"
    ]
  },
  {
    "id": "metric_total_queue_agent_assignments",
    "doc_type": "metric",
    "metric_id": "total_queue_agent_assignments",
    "canonical_name": "Total Queue-Agent Assignments",
    "synonyms": [
      "agents per queue",
      "queue staffing count",
      "agent-queue mapping count",
      "staffing assignments",
      "how many agents assigned to queues",
      "queue membership count",
      "how many agents are assigned across queues",
      "total staffing links between agents and queues",
      "how many agent-to-queue mappings exist"
    ],
    "description": "Count of agent-to-queue membership records, including channel-handling flags and shift type.",
    "dbt_metric_ref": "total_queue_agent_assignments",
    "unit": "count",
    "category": "config",
    "owner": "ccaas",
    "sensitivity": "low",
    "direction": "neutral",
    "threshold_good": None,
    "threshold_warning": None,
    "threshold_bad": None,
    "threshold_note": "Configuration/staffing count, no universal good/bad direction.",
    "groupable_by": [
      "setup_ccaas_queue_agents__shift_type",
      "setup_ccaas_queue_agents__call_type",
      "queue__queue_name",
      "user__user_name"
    ]
  },
  {
    "id": "metric_total_teams",
    "doc_type": "metric",
    "metric_id": "total_teams",
    "canonical_name": "Total Teams",
    "synonyms": [
      "number of teams",
      "how many teams",
      "team count",
      "how many teams exist",
      "total departments configured",
      "how many teams do we have",
      "total number of departments",
      "how many teams are set up"
    ],
    "description": "Count of configured teams (setup_teams).",
    "dbt_metric_ref": "total_teams",
    "unit": "count",
    "category": "config",
    "owner": "ccaas",
    "sensitivity": "low",
    "direction": "neutral",
    "threshold_good": None,
    "threshold_warning": None,
    "threshold_bad": None,
    "threshold_note": "Configuration count, no good/bad direction.",
    "groupable_by": [
      "team__status"
    ]
  },
  {
    "id": "metric_average_speed_of_answer",
    "doc_type": "metric",
    "metric_id": "average_speed_of_answer",
    "canonical_name": "Average Speed of Answer (ASA)",
    "synonyms": [
      "ASA",
      "average wait time",
      "queue wait time",
      "time to assign",
      "avg wait time",
      "how long do customers wait",
      "time to pick up",
      "average time to assign an agent",
      "queue hold time",
      "average pickup time",
      "how long does it take to answer a call",
      "average time before someone picks up",
      "how quickly are we answering customers",
      "typical wait before pickup"
    ],
    "description": "PROXY: average seconds between a conversation entering the queue (queued_at) and being assigned to an agent (assigned_at). No exit_reason column exists in ccass, so this includes all assigned waits without separating abandoned/missed exits.",
    "dbt_metric_ref": "average_speed_of_answer",
    "tenant_filter_key": "conversation__organization_id",
    "unit": "seconds",
    "category": "speed",
    "owner": "ccaas",
    "sensitivity": "medium",
    "direction": "lower_is_better",
    "threshold_good": 20,
    "threshold_warning": 45,
    "threshold_bad": 90,
    "threshold_note": "good <= 20s, warning 20-45s, bad >= 90s. Tenant-adjustable.",
    "groupable_by": [
      "conversation__channel",
      "conversation__created_at",
      "queue__queue_name",
      "agent__agent_name"
    ]
  },
  {
    "id": "metric_average_first_response_time",
    "doc_type": "metric",
    "metric_id": "average_first_response_time",
    "canonical_name": "Average First Response Time",
    "synonyms": [
      "FRT",
      "time to first reply",
      "first response time",
      "avg reply time",
      "how fast do we respond first",
      "time until first reply",
      "average time to first response",
      "initial response speed",
      "how quickly do we reply for the first time",
      "average time to send the first reply",
      "how fast is our first response",
      "typical time until initial reply"
    ],
    "description": "Average seconds between conversation creation and the first response sent (bot or human).",
    "dbt_metric_ref": "average_first_response_time",
    "tenant_filter_key": "conversation__organization_id",
    "unit": "seconds",
    "category": "speed",
    "owner": "ccaas",
    "sensitivity": "medium",
    "direction": "lower_is_better",
    "threshold_good": 30,
    "threshold_warning": 60,
    "threshold_bad": 120,
    "threshold_note": "good <= 30s, warning 30-60s, bad >= 120s. Tenant-adjustable.",
    "groupable_by": [
      "conversation__channel",
      "conversation__created_at",
      "queue__queue_name",
      "agent__agent_name"
    ]
  },
  {
    "id": "metric_average_handle_time",
    "doc_type": "metric",
    "metric_id": "average_handle_time",
    "canonical_name": "Average Handle Time (AHT)",
    "synonyms": [
      "AHT",
      "average call duration",
      "average conversation duration",
      "avg handling duration",
      "how long do agents spend per conversation",
      "average time per call",
      "average resolution duration per agent",
      "talk time average",
      "average conversation length",
      "how long does an agent spend on average per conversation",
      "typical conversation length",
      "average time to handle a contact",
      "how long do conversations usually take"
    ],
    "description": "Canonical AHT: average seconds per human agent leg, from accepted_at to ended_at on conversation_assignments. CAVEAT: excludes wrap time - no wrap_seconds column exists anywhere in ccass.",
    "dbt_metric_ref": "average_handle_time",
    "unit": "seconds",
    "category": "efficiency",
    "owner": "ccaas",
    "sensitivity": "medium",
    "direction": "lower_is_better",
    "threshold_good": 300,
    "threshold_warning": 600,
    "threshold_bad": 900,
    "threshold_note": "good <= 5min, warning 5-10min, bad >= 15min. Excludes wrap time - tenant-adjustable.",
    "groupable_by": [
      "conversation_assignments__offered_at",
      "queue__queue_name",
      "agent__agent_name"
    ]
  },
  {
    "id": "metric_human_agent_occupancy_rate_capacity",
    "doc_type": "metric",
    "metric_id": "human_agent_occupancy_rate_capacity",
    "canonical_name": "Human Agent Occupancy Rate (capacity-based)",
    "synonyms": [
      "agent utilization snapshot",
      "current occupancy",
      "capacity usage",
      "agent utilization right now",
      "current agent load",
      "live occupancy percentage",
      "how busy are agents right now",
      "real-time capacity usage",
      "how busy are agents right now based on capacity",
      "current utilization snapshot",
      "real-time agent busy percentage"
    ],
    "description": "PROXY: real-time snapshot of active_count / max_concurrency from agent_capacity. Point-in-time, not a time-window average.",
    "dbt_metric_ref": "human_agent_occupancy_rate_capacity",
    "unit": "percent",
    "category": "workforce",
    "owner": "ccaas",
    "sensitivity": "medium",
    "direction": "higher_is_better_up_to_a_point",
    "threshold_good": 0.85,
    "threshold_warning": 0.95,
    "threshold_bad": 1,
    "threshold_note": "good ~70-85%, warning 85-95% (burnout risk), bad >=100% (over capacity). Too low also signals overstaffing - read alongside volume.",
    "groupable_by": [
      "agent_capacity__channel",
      "agent_capacity__updated_at",
      "agent__agent_name"
    ]
  },
  {
    "id": "metric_human_agent_occupancy_rate_presence",
    "doc_type": "metric",
    "metric_id": "human_agent_occupancy_rate_presence",
    "canonical_name": "Human Agent Occupancy Rate (presence-based)",
    "synonyms": [
      "time-based occupancy",
      "agent busy time ratio",
      "agent busy percentage over time",
      "occupancy over a period",
      "time-based agent utilization",
      "how much of their shift are agents busy",
      "how much of their shift are agents actually busy",
      "occupancy over the whole period",
      "busy time as a percent of total presence time"
    ],
    "description": "PROXY: (busy + after_contact_work seconds) / (all non-offline seconds), from agent_presence_history. Time-window based, unlike the capacity-based version.",
    "dbt_metric_ref": "human_agent_occupancy_rate_presence",
    "unit": "percent",
    "category": "workforce",
    "owner": "ccaas",
    "sensitivity": "medium",
    "direction": "higher_is_better_up_to_a_point",
    "threshold_good": 0.75,
    "threshold_warning": 0.85,
    "threshold_bad": 0.95,
    "threshold_note": "good ~60-75%, warning 75-85% (burnout risk), bad >=95%. Sustained near-100% signals agent burnout risk, not efficiency.",
    "groupable_by": [
      "agent_presence_history__started_at",
      "agent_presence_history__new_state",
      "agent__agent_name"
    ]
  },
  {
    "id": "metric_missed_contact_rate",
    "doc_type": "metric",
    "metric_id": "missed_contact_rate",
    "canonical_name": "Missed Contact Rate",
    "synonyms": [
      "missed calls rate",
      "rejected assignment rate",
      "unanswered rate",
      "dropped contacts rate",
      "unaccepted assignment rate",
      "missed assignment percentage",
      "how many contacts go unanswered",
      "abandonment-like rate",
      "how many contacts get missed",
      "percent of assignments that go unanswered",
      "how often do we drop incoming contacts",
      "share of contacts nobody picked up"
    ],
    "description": "PROXY: proportion of assignment attempts that were rejected or expired rather than accepted, out of all assignment attempts.",
    "dbt_metric_ref": "missed_contact_rate",
    "unit": "percent",
    "category": "resolution",
    "owner": "ccaas",
    "sensitivity": "medium",
    "direction": "lower_is_better",
    "threshold_good": 0.05,
    "threshold_warning": 0.15,
    "threshold_bad": 0.25,
    "threshold_note": "good <= 5%, warning 5-15%, bad >= 25%.",
    "groupable_by": [
      "conversation_assignments__offered_at",
      "queue__queue_name",
      "agent__agent_name"
    ]
  },
  {
    "id": "metric_tool_success_rate",
    "doc_type": "metric",
    "metric_id": "tool_success_rate",
    "canonical_name": "Tool Execution Success Rate",
    "synonyms": [
      "copilot tool success",
      "AI tool call success rate",
      "AI tool call success",
      "copilot execution success rate",
      "how reliable are the AI tools",
      "skill execution success percentage",
      "how often do AI tool calls succeed",
      "reliability of copilot tool executions",
      "what percent of tool runs succeed",
      "how dependable are the AI skills"
    ],
    "description": "PROXY over copilot_skill_executions.status. Proportion of terminal tool/skill executions (succeeded/failed/cancelled) that succeeded. Confirm execution_status distinct values in prod before trusting this.",
    "dbt_metric_ref": "tool_success_rate",
    "unit": "percent",
    "category": "ai_performance",
    "owner": "ccaas",
    "sensitivity": "medium",
    "direction": "higher_is_better",
    "threshold_good": 0.95,
    "threshold_warning": 0.85,
    "threshold_bad": 0.7,
    "threshold_note": "good >= 95%, warning 85-95%, bad <= 70%.",
    "groupable_by": [
      "copilot_skill_executions__tool_key",
      "copilot_skill_executions__created_at"
    ]
  },
  {
    "id": "metric_agent_assist_adoption_rate",
    "doc_type": "metric",
    "metric_id": "agent_assist_adoption_rate",
    "canonical_name": "Agent Assist Adoption Rate",
    "synonyms": [
      "copilot adoption rate",
      "suggestion acceptance rate",
      "AI suggestion usage rate",
      "how often agents use copilot suggestions",
      "suggestion uptake rate",
      "copilot usage percentage",
      "how often do agents accept AI suggestions",
      "copilot suggestion usage percentage",
      "how much are agents relying on AI assist"
    ],
    "description": "PROXY: (accepted + modified) suggestions / all suggestions, from copilot_turns. Disposition inferred from the `accepted` boolean plus a text diff between suggestion_text and final_text.",
    "dbt_metric_ref": "agent_assist_adoption_rate",
    "unit": "percent",
    "category": "ai_performance",
    "owner": "ccaas",
    "sensitivity": "medium",
    "direction": "higher_is_better",
    "threshold_good": 0.7,
    "threshold_warning": 0.5,
    "threshold_bad": 0.3,
    "threshold_note": "good >= 70%, warning 50-70%, bad <= 30%.",
    "groupable_by": [
      "copilot_turns__skill_key",
      "copilot_turns__created_at"
    ]
  },
  {
    "id": "metric_agent_assist_modification_rate",
    "doc_type": "metric",
    "metric_id": "agent_assist_modification_rate",
    "canonical_name": "Agent Assist Modification Rate",
    "synonyms": [
      "suggestion edit rate",
      "copilot rewrite rate",
      "suggestion edit percentage",
      "how often agents change AI suggestions",
      "copilot suggestion tweak rate",
      "how often do agents edit the AI's suggestion",
      "percent of suggestions that get changed before use",
      "how much do agents rewrite copilot output"
    ],
    "description": "PROXY: modified suggestions / (accepted + modified) suggestions, from copilot_turns. High values suggest suggestions are useful as a starting point but not fully trusted verbatim.",
    "dbt_metric_ref": "agent_assist_modification_rate",
    "unit": "percent",
    "category": "ai_performance",
    "owner": "ccaas",
    "sensitivity": "medium",
    "direction": "context_dependent",
    "threshold_good": None,
    "threshold_warning": None,
    "threshold_bad": None,
    "threshold_note": "Not strictly higher/lower-is-better: very low can mean agents accept suggestions blindly (risk), very high can mean suggestions are low quality. Read alongside agent_assist_adoption_rate.",
    "groupable_by": [
      "copilot_turns__skill_key",
      "copilot_turns__created_at"
    ]
  }
]

dimensions = [
  {
    "id": "dim_channel",
    "doc_type": "dimension",
    "dimension_id": "conversation__channel",
    "canonical_name": "Channel",
    "synonyms": [
      "contact channel",
      "communication channel",
      "channel type",
      "which channel",
      "by channel",
      "source channel",
      "medium",
      "what channel did it come through",
      "broken down by channel",
      "channel split"
    ],
    "description": "Omnichannel type of the conversation: webchat, email, whatsapp, instagram, facebook, voice.",
    "applies_to_metrics": [
      "total_conversations",
      "average_speed_of_answer",
      "average_first_response_time",
      "ai_containment_rate",
      "ai_handover_rate",
      "handover_rate"
    ]
  },
  {
    "id": "dim_conversation_status",
    "doc_type": "dimension",
    "dimension_id": "conversation__status",
    "canonical_name": "Conversation Status",
    "synonyms": [
      "contact status",
      "status of conversation",
      "by status",
      "current state of chat",
      "what state is the conversation in",
      "open or closed status",
      "status breakdown"
    ],
    "description": "Current status of the conversation (e.g. open, bot_active). Confirm full distinct value list before use.",
    "applies_to_metrics": [
      "total_conversations",
      "open_conversations"
    ]
  },
  {
    "id": "dim_lifecycle_state",
    "doc_type": "dimension",
    "dimension_id": "conversation__lifecycle_state",
    "canonical_name": "Lifecycle State",
    "synonyms": [
      "bot vs human state",
      "bot or human",
      "current handler",
      "who's handling it now",
      "is it with the bot or a human",
      "handled by bot or agent",
      "current owner of the conversation"
    ],
    "description": "Whether the conversation is currently being handled by bot or human.",
    "applies_to_metrics": [
      "total_conversations",
      "ai_containment_rate"
    ]
  },
  {
    "id": "dim_sla_status",
    "doc_type": "dimension",
    "dimension_id": "conversation__sla_status",
    "canonical_name": "SLA Status",
    "synonyms": [
      "SLA state",
      "by SLA status",
      "SLA flag",
      "did it breach or meet SLA",
      "SLA outcome",
      "SLA pass or fail status"
    ],
    "description": "SLA state label on the conversation row.",
    "applies_to_metrics": [
      "total_conversations"
    ]
  },
  {
    "id": "dim_disposition_code",
    "doc_type": "dimension",
    "dimension_id": "conversation__disposition_code",
    "canonical_name": "Disposition Code",
    "synonyms": [
      "wrap-up code",
      "close reason code",
      "resolution code",
      "closing code",
      "by disposition code",
      "reason code for closing",
      "wrap up code breakdown",
      "closure code"
    ],
    "description": "Code applied when a conversation is resolved or closed.",
    "applies_to_metrics": [
      "total_conversations",
      "resolved_dispositions"
    ]
  },
  {
    "id": "dim_disposition_label",
    "doc_type": "dimension",
    "dimension_id": "disposition__label",
    "canonical_name": "Disposition Label",
    "synonyms": [
      "wrap-up reason name",
      "close reason name",
      "resolution reason",
      "closing reason",
      "by disposition",
      "reason for closing the conversation",
      "why was it closed",
      "close reason breakdown"
    ],
    "description": "Human-readable label for a disposition code (looked up via the dispositions catalog).",
    "applies_to_metrics": [
      "resolved_dispositions"
    ]
  },
  {
    "id": "dim_had_handoff",
    "doc_type": "dimension",
    "dimension_id": "conversation__had_handoff",
    "canonical_name": "Had AI-to-Human Handoff",
    "synonyms": [
      "escalated to human",
      "by handoff flag",
      "was it escalated",
      "did a human get involved",
      "handed off to an agent or not",
      "escalation flag"
    ],
    "description": "Boolean flag: True if conversations.handoff_reason is set.",
    "applies_to_metrics": [
      "ai_handover_rate"
    ]
  },
  {
    "id": "dim_is_ai_only_completed",
    "doc_type": "dimension",
    "dimension_id": "conversation__is_ai_only_completed",
    "canonical_name": "AI-Only Completed",
    "synonyms": [
      "fully bot resolved",
      "fully automated flag",
      "bot-only resolved flag",
      "handled entirely by the bot",
      "no human involved flag",
      "fully automated resolution flag"
    ],
    "description": "Boolean flag: True if the conversation closed with lifecycle_state='bot' and no handoff.",
    "applies_to_metrics": [
      "ai_containment_rate"
    ]
  },
  {
    "id": "dim_queue_name",
    "doc_type": "dimension",
    "dimension_id": "queue__queue_name",
    "canonical_name": "Queue Name",
    "synonyms": [
      "queue",
      "by queue",
      "which queue",
      "queue breakdown",
      "per queue",
      "broken down by queue",
      "split by queue",
      "queue-level breakdown"
    ],
    "description": "Display name of the routing queue a conversation/agent belongs to.",
    "applies_to_metrics": [
      "total_conversations",
      "average_speed_of_answer",
      "average_handle_time",
      "sla_breach_rate",
      "handover_rate",
      "missed_contact_rate"
    ]
  },
  {
    "id": "dim_agent_name",
    "doc_type": "dimension",
    "dimension_id": "agent__agent_name",
    "canonical_name": "Agent Name",
    "synonyms": [
      "agent",
      "rep name",
      "employee name",
      "by agent",
      "which agent",
      "per agent",
      "agent breakdown",
      "by rep",
      "broken down by agent",
      "individual agent breakdown",
      "split per rep"
    ],
    "description": "Display name of the operational CCaaS agent handling the conversation.",
    "applies_to_metrics": [
      "total_conversations",
      "average_handle_time",
      "average_speed_of_answer",
      "missed_contact_rate",
      "human_agent_occupancy_rate_capacity",
      "human_agent_occupancy_rate_presence",
      "resolved_dispositions"
    ]
  },
  {
    "id": "dim_user_name",
    "doc_type": "dimension",
    "dimension_id": "user__user_name",
    "canonical_name": "User Name",
    "synonyms": [
      "user name",
      "agent user name",
      "employee name",
      "by user",
      "by user name",
      "staff name",
      "user",
      "assigned user",
      "per user",
      "username"
    ],
    "description": "The full display name of the CCaaS user/employee.",
    "applies_to_metrics": [
      "total_agents_setup",
      "active_agents_setup",
      "total_queue_agent_assignments"
    ]
  },
  {
    "id": "dim_team_name",
    "doc_type": "dimension",
    "dimension_id": "team__team_name",
    "canonical_name": "Team Name",
    "synonyms": [
      "team",
      "by team",
      "which team",
      "per team",
      "team breakdown",
      "broken down by team",
      "split by department",
      "team-level breakdown"
    ],
    "description": "Display name of the team a queue or setup user belongs to.",
    "applies_to_metrics": [
      "total_queues_configured",
      "total_agents_setup",
      "active_agents_setup"
    ]
  },
  {
    "id": "dim_assignment_state",
    "doc_type": "dimension",
    "dimension_id": "conversation_assignments__state",
    "canonical_name": "Assignment State",
    "synonyms": [
      "offer state",
      "by assignment state",
      "assignment status",
      "status of the assignment offer",
      "was the assignment accepted",
      "assignment outcome"
    ],
    "description": "Offer/accept/reject/end lifecycle state of an assignment (offered, accepted, rejected, expired, ended).",
    "applies_to_metrics": [
      "missed_contact_rate",
      "average_handle_time"
    ]
  },
  {
    "id": "dim_transfer_state",
    "doc_type": "dimension",
    "dimension_id": "conversation_transfers__state",
    "canonical_name": "Transfer State",
    "synonyms": [
      "by transfer status",
      "transfer stage",
      "stage of the transfer",
      "transfer outcome",
      "status of the handoff"
    ],
    "description": "Lifecycle state of a transfer request (requested, offered, accepted, completed, cancelled).",
    "applies_to_metrics": [
      "total_transfers",
      "handover_rate"
    ]
  },
  {
    "id": "dim_suggestion_disposition",
    "doc_type": "dimension",
    "dimension_id": "copilot_turns__suggestion_disposition",
    "canonical_name": "Suggestion Disposition",
    "synonyms": [
      "copilot suggestion outcome",
      "by suggestion outcome",
      "suggestion status",
      "what happened to the AI suggestion",
      "suggestion outcome breakdown",
      "accepted edited or ignored"
    ],
    "description": "PROXY: inferred outcome of an agent-assist suggestion - accepted, modified, rejected, or pending.",
    "applies_to_metrics": [
      "agent_assist_adoption_rate",
      "agent_assist_modification_rate"
    ]
  },
  {
    "id": "dim_tool_key",
    "doc_type": "dimension",
    "dimension_id": "copilot_skill_executions__tool_key",
    "canonical_name": "Tool Key",
    "synonyms": [
      "copilot tool name",
      "by tool",
      "which tool",
      "tool name breakdown",
      "broken down by tool",
      "which AI tool was used",
      "tool-level breakdown"
    ],
    "description": "Identifier of the specific tool/skill invoked by the copilot.",
    "applies_to_metrics": [
      "tool_success_rate"
    ]
  },
  {
    "id": "dim_execution_status",
    "doc_type": "dimension",
    "dimension_id": "copilot_skill_executions__execution_status",
    "canonical_name": "Execution Status",
    "synonyms": [
      "by execution status",
      "tool run status"
    ],
    "description": "Status of a tool/skill execution - expected started/succeeded/failed/cancelled. Confirm actual distinct values in prod.",
    "applies_to_metrics": [
      "tool_success_rate"
    ]
  },
  {
    "id": "dim_presence_state",
    "doc_type": "dimension",
    "dimension_id": "agent_presence_history__new_state",
    "canonical_name": "Presence State",
    "synonyms": [
      "agent status",
      "availability state",
      "by presence state",
      "agent availability status",
      "what was the agent doing",
      "agent's presence status",
      "ready busy or offline"
    ],
    "description": "Agent presence state - ready, busy, after_contact_work, offline, etc.",
    "applies_to_metrics": [
      "human_agent_occupancy_rate_presence"
    ]
  },
  {
    "id": "dim_priority",
    "doc_type": "dimension",
    "dimension_id": "conversation__priority",
    "canonical_name": "Priority",
    "synonyms": [
      "by priority",
      "priority level",
      "urgency level",
      "how urgent was it",
      "priority tier",
      "priority breakdown"
    ],
    "description": "Priority level assigned to a conversation.",
    "applies_to_metrics": [
      "open_conversations"
    ]
  }
]

bundles = [
  {
    "id": "bundle_queue_health",
    "doc_type": "bundle",
    "bundle_id": "queue_health",
    "canonical_name": "Queue Health / Service Level",
    "synonyms": [
      "is the queue healthy",
      "service level overview",
      "wait time overview",
      "queue performance overview",
      "how is the queue doing",
      "service level health check",
      "are we keeping up with volume",
      "queue performance check",
      "are customers waiting too long",
      "queue SLA snapshot"
    ],
    "description": "Answers 'how well is a queue keeping up with incoming contact volume'.",
    "metric_refs": [
      "average_speed_of_answer",
      "average_first_response_time",
      "sla_breach_rate",
      "missed_contact_rate",
      "open_conversations"
    ],
    "relationship": "average_speed_of_answer and average_first_response_time are inversely proportional to queue health - lower values mean the queue is keeping up. sla_breach_rate and missed_contact_rate are also inversely proportional - both rise when the queue is under-resourced or overloaded, and their rise is often driven by the same root cause as high ASA. open_conversations acts as a leading indicator: a climbing open_conversations count combined with rising ASA signals the queue is falling behind and the other three metrics are likely to worsen next."
  },
  {
    "id": "bundle_ai_effectiveness",
    "doc_type": "bundle",
    "bundle_id": "ai_effectiveness",
    "canonical_name": "AI / Bot Effectiveness",
    "synonyms": [
      "how is the AI doing",
      "bot performance overview",
      "is the AI helping",
      "bot health overview",
      "AI performance summary",
      "chatbot effectiveness overview",
      "copilot performance summary",
      "how much is the bot resolving",
      "AI vs human resolution overview",
      "copilot and bot performance check"
    ],
    "description": "Answers 'how effectively is the AI/bot layer resolving contacts and assisting agents'.",
    "metric_refs": [
      "ai_containment_rate",
      "ai_handover_rate",
      "tool_success_rate",
      "agent_assist_adoption_rate",
      "agent_assist_modification_rate"
    ],
    "relationship": "ai_containment_rate is directly proportional to AI effectiveness - higher means more conversations resolved by the bot alone. ai_handover_rate moves inversely to ai_containment_rate by construction (they are near-complements) - a rise in one implies a fall in the other. tool_success_rate is directly proportional - if the bot's tool calls keep failing, containment will drop and handovers will rise, so a falling tool_success_rate is often a leading indicator of a worsening ai_containment_rate. agent_assist_adoption_rate is directly proportional to AI value delivered to human agents (higher = agents find suggestions useful), while agent_assist_modification_rate is context-dependent - moderate values are healthy (agents personalize good suggestions), but a very high modification_rate alongside a high adoption_rate suggests the suggestions are only a rough starting point, not high quality on their own."
  },
  {
    "id": "bundle_agent_productivity",
    "doc_type": "bundle",
    "bundle_id": "agent_productivity",
    "canonical_name": "Agent Productivity / Workload",
    "synonyms": [
      "how are agents performing",
      "agent workload overview",
      "is an agent overloaded",
      "agent performance overview",
      "workforce workload summary",
      "is the team overloaded",
      "staffing efficiency overview",
      "are agents overworked",
      "team capacity check",
      "agent utilization overview"
    ],
    "description": "Answers 'how efficiently and sustainably are human agents handling their workload', at the agent or team level.",
    "metric_refs": [
      "average_handle_time",
      "human_agent_occupancy_rate_capacity",
      "human_agent_occupancy_rate_presence",
      "missed_contact_rate",
      "open_agent_tasks"
    ],
    "relationship": "average_handle_time is inversely proportional to raw throughput per agent - lower AHT means an agent can handle more contacts in the same time, but extremely low AHT can also mean rushed, lower-quality handling, so it should be read alongside disposition/resolution quality, not optimized in isolation. human_agent_occupancy_rate (both bases) is proportional to utilization only up to a healthy point (~70-85%) - beyond the warning threshold it becomes inversely related to sustainable performance because sustained near-100% occupancy is a burnout signal, which historically correlates with rising AHT and missed_contact_rate over time. missed_contact_rate is inversely proportional to agent responsiveness - a high value alongside high occupancy usually means agents are too saturated to accept new assignments. open_agent_tasks is inversely proportional to agent bandwidth - a rising backlog alongside high occupancy confirms the agent/team is overloaded rather than simply busy."
  },
  {
    "id": "bundle_handoff_and_escalation",
    "doc_type": "bundle",
    "bundle_id": "handoff_and_escalation",
    "canonical_name": "Handoff and Escalation Overview",
    "synonyms": [
      "escalation overview",
      "how often do conversations get transferred or escalated",
      "transfer and escalation summary",
      "routing quality overview",
      "why are conversations being escalated",
      "how smooth is our routing",
      "escalation and transfer diagnostics",
      "why do handoffs happen"
    ],
    "description": "Answers 'how often and why control is passing between bot/queues/agents' - useful for diagnosing routing or containment problems.",
    "metric_refs": [
      "ai_handover_rate",
      "handover_rate",
      "total_transfers",
      "ai_containment_rate"
    ],
    "relationship": "ai_handover_rate and handover_rate are both inversely proportional to a smooth, well-routed experience, but they measure different failure modes - ai_handover_rate rising points at bot/containment quality, while handover_rate (queue/agent transfers) rising points at routing/skill-matching quality. total_transfers is the raw volume behind handover_rate, useful for absolute-scale context alongside the rate. ai_containment_rate moves inversely to ai_handover_rate by construction - use it as the direct positive-framing counterpart when reporting 'how much is being resolved without escalation'."
  },
  {
    "id": "bundle_contact_volume_overview",
    "doc_type": "bundle",
    "bundle_id": "contact_volume_overview",
    "canonical_name": "Contact Volume Overview",
    "synonyms": [
      "how busy are we",
      "traffic overview",
      "volume trends",
      "overall traffic summary",
      "how much volume are we getting",
      "contact center activity summary",
      "general traffic snapshot",
      "how much are we handling overall",
      "baseline volume check"
    ],
    "description": "Answers general 'how much contact center activity is happening' questions - baseline context for any deeper analysis.",
    "metric_refs": [
      "total_conversations",
      "unique_contacts_handled",
      "open_conversations"
    ],
    "relationship": "total_conversations and unique_contacts_handled are both neutral volume indicators with no inherent good/bad direction - they should be compared period-over-period or against agent headcount, not read as good/bad on their own. The ratio of total_conversations to unique_contacts_handled is directly proportional to repeat-contact pressure - a rising ratio means more conversations per unique customer, which often signals unresolved issues resurfacing (worth cross-checking against resolved_dispositions). open_conversations is inversely proportional to how well current volume is being cleared - a rising trend relative to total_conversations signals backlog build-up."
  },
  {
    "id": "bundle_sla_and_resolution",
    "doc_type": "bundle",
    "bundle_id": "sla_and_resolution",
    "canonical_name": "SLA and Resolution Quality",
    "synonyms": [
      "are we meeting SLA",
      "resolution quality overview",
      "are we hitting SLAs",
      "resolution and SLA summary",
      "service quality overview",
      "are we closing things out properly",
      "SLA and closure health check",
      "response and resolution overview"
    ],
    "description": "Answers 'are conversations being resolved on time and properly closed out'.",
    "metric_refs": [
      "sla_breach_rate",
      "breached_sla_count",
      "resolved_dispositions",
      "average_first_response_time"
    ],
    "relationship": "sla_breach_rate and breached_sla_count are inversely proportional to SLA performance - both should trend down for improvement, and breached_sla_count gives absolute scale behind the rate. average_first_response_time is directly proportional to SLA breach risk since most first-response SLA breaches originate from slow initial response - a rising FRT is often a leading indicator of a rising sla_breach_rate before the breach is even recorded. resolved_dispositions is directly proportional to proper close-out discipline - a low ratio of resolved_dispositions to total_conversations alongside a high sla_breach_rate suggests conversations are timing out unresolved rather than being actively closed."
  }
]
