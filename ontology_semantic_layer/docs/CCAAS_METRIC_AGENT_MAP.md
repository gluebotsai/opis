 CCaaS metric → agent workflow map

Total certified metrics: **58**

| metric | mart | source table | specialists | channel_scoped |
|--------|------|--------------|-------------|----------------|
| `active_agents` | `mart_agents` | `ccass.agents` | cc.presence, cc.wfm | no |
| `active_agents_setup` | `mart_setup_users` | `accounts.setup_users` | cc.presence, cc.wfm | no |
| `agent_assist_accepted_or_modified` | `mart_copilot_turns` | `ccass.copilot_turns` | cc.agent_assist | no |
| `agent_assist_adoption_rate` | `mart_copilot_turns` | `ccass.copilot_turns` | cc.agent_assist | no |
| `agent_assist_modification_rate` | `mart_copilot_turns` | `ccass.copilot_turns` | cc.agent_assist | no |
| `agent_assist_modified` | `mart_copilot_turns` | `ccass.copilot_turns` | cc.agent_assist | no |
| `agent_assist_suggestions_total` | `mart_copilot_turns` | `ccass.copilot_turns` | cc.agent_assist | no |
| `agents_assigned_callback` | `mart_agent_tasks` | `ccass.agent_tasks` | cc.followup, cc.presence | no |
| `ai_containment_rate` | `` | `?` | reporting only | no |
| `ai_handover_rate` | `mart_conversations` | `ccass.conversations` | reporting only | yes |
| `ai_only_completed_conversations` | `mart_conversations` | `ccass.conversations` | reporting only | yes |
| `average_first_response_time` | `mart_conversations` | `ccass.conversations` | cc.performance | yes |
| `average_handle_time` | `` | `?` | cc.performance | no |
| `average_speed_of_answer` | `mart_conversations` | `ccass.conversations` | cc.performance | yes |
| `breached_sla_count` | `mart_conversation_sla_state` | `ccass.conversation_sla_state` | cc.anomaly, cc.performance | yes |
| `call_volume` | `mart_conversations` | `ccass.conversations` | cc.omnichannel | yes |
| `callback_tasks` | `mart_agent_tasks` | `ccass.agent_tasks` | cc.followup, cc.presence | no |
| `chat_volume` | `mart_conversations` | `ccass.conversations` | cc.omnichannel | yes |
| `completed_leg_count` | `mart_conversation_assignments` | `ccass.conversation_assignments` | cc.performance | yes |
| `email_volume` | `mart_conversations` | `ccass.conversations` | cc.omnichannel | yes |
| `facebook_volume` | `mart_conversations` | `ccass.conversations` | cc.omnichannel | yes |
| `follow_up_tasks` | `mart_agent_tasks` | `ccass.agent_tasks` | cc.followup, cc.presence | no |
| `handled_volume` | `mart_conversations` | `ccass.conversations` | cc.interaction_ops, cc.omnichannel, cc.performance, cc.wfm | yes |
| `handling_or_wrap_seconds` | `mart_agent_presence_history` | `ccass.agent_presence_history` | cc.presence, cc.wfm | no |
| `handoff_conversations` | `mart_conversations` | `ccass.conversations` | reporting only | yes |
| `handover_rate` | `mart_conversation_transfers` | `ccass.conversation_transfers` | reporting only | no |
| `human_agent_occupancy_rate_capacity` | `mart_agent_capacity` | `ccass.agent_capacity` | cc.presence, cc.wfm | no |
| `human_agent_occupancy_rate_presence` | `mart_agent_presence_history` | `ccass.agent_presence_history` | cc.presence, cc.wfm | no |
| `human_handle_seconds_sum` | `mart_conversation_assignments` | `ccass.conversation_assignments` | cc.performance, cc.presence, cc.wfm | yes |
| `instagram_volume` | `mart_conversations` | `ccass.conversations` | cc.omnichannel | yes |
| `logged_in_eligible_seconds` | `mart_agent_presence_history` | `ccass.agent_presence_history` | cc.presence, cc.wfm | no |
| `missed_assignments` | `mart_conversation_assignments` | `ccass.conversation_assignments` | cc.anomaly, cc.recovery | yes |
| `missed_contact_rate` | `mart_conversation_assignments` | `ccass.conversation_assignments` | cc.anomaly, cc.recovery | yes |
| `open_agent_tasks` | `mart_agent_tasks` | `ccass.agent_tasks` | cc.followup, cc.presence | no |
| `open_conversations` | `` | `?` | cc.interaction_ops, cc.performance, cc.wfm | no |
| `resolution_rate` | `mart_conversations` | `ccass.conversations` | cc.closure | yes |
| `resolved_conversations_count` | `mart_conversations` | `ccass.conversations` | cc.closure | yes |
| `resolved_dispositions` | `mart_conversation_dispositions` | `ccass.conversation_dispositions` | cc.closure | no |
| `sla_breach_rate` | `mart_conversation_sla_state` | `ccass.conversation_sla_state` | cc.anomaly, cc.performance | yes |
| `social_media_volume` | `mart_conversations` | `ccass.conversations` | cc.omnichannel | yes |
| `suggestion_tasks` | `mart_agent_tasks` | `ccass.agent_tasks` | cc.followup, cc.presence | no |
| `tool_executions_succeeded` | `mart_copilot_skill_executions` | `ccass.copilot_skill_executions` | cc.agent_assist | no |
| `tool_executions_total` | `mart_copilot_skill_executions` | `ccass.copilot_skill_executions` | cc.agent_assist | no |
| `tool_success_rate` | `mart_copilot_skill_executions` | `ccass.copilot_skill_executions` | cc.agent_assist | no |
| `total_active_agent_count` | `mart_agent_capacity` | `ccass.agent_capacity` | cc.presence, cc.wfm | no |
| `total_agent_capacity` | `mart_agent_capacity` | `ccass.agent_capacity` | cc.presence, cc.wfm | no |
| `total_agents` | `mart_agents` | `ccass.agents` | cc.presence, cc.wfm | no |
| `total_agents_setup` | `mart_setup_users` | `accounts.setup_users` | cc.presence, cc.wfm | no |
| `total_assignments` | `mart_conversation_assignments` | `ccass.conversation_assignments` | reporting only | yes |
| `total_conversations` | `` | `?` | cc.interaction_ops, cc.performance, cc.wfm | no |
| `total_queue_agent_assignments` | `mart_setup_ccaas_queue_agents` | `accounts.setup_ccaas_queue_agents` | cc.queue, cc.wfm | no |
| `total_queues_configured` | `mart_setup_ccaas_queues` | `accounts.setup_ccaas_queues` | cc.queue, cc.wfm | no |
| `total_sla_states` | `mart_conversation_sla_state` | `ccass.conversation_sla_state` | cc.anomaly, cc.performance | yes |
| `total_teams` | `mart_setup_teams` | `accounts.setup_teams` | cc.queue, cc.wfm | no |
| `total_transfers` | `mart_conversation_transfers` | `ccass.conversation_transfers` | cc.interaction_ops | no |
| `unique_contacts_handled` | `mart_conversations` | `ccass.conversations` | cc.omnichannel | yes |
| `webchat_volume` | `mart_conversations` | `ccass.conversations` | cc.omnichannel | yes |
| `whatsapp_volume` | `mart_conversations` | `ccass.conversations` | cc.omnichannel | yes |

## Reporting agent

`cc.reporting` and `cc.reporting_mas` grant **all metrics** (`metrics: *`).

## Headlines (LLM prompt only)

See `ontology/metric_ownership.yml` → `headline_metrics.cc.reporting`.
