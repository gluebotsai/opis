#!/usr/bin/env python3
"""Emit a Campaign-style ontology markdown for Contact Center tables."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = ROOT / "packages/db-cc/prisma/schema.prisma"
OUT = ROOT / "docs/ccaas/CONTACT_CENTER_DB_ONTOLOGY.md"

SCALARS = {"String", "Int", "BigInt", "Boolean", "DateTime", "Json", "Decimal", "Float", "Bytes"}

ACCOUNTS_TABLES = {
    "organizations",
    "organization_locations",
    "setup_users",
    "setup_teams",
    "setup_roles",
    "setup_user_product_access",
    "setup_user_invite_tokens",
    "setup_channel_configs",
    "setup_webchat_configs",
    "setup_email_configs",
    "setup_social_configs",
    "setup_crm_channel_agents",
    "setup_ccaas_queues",
    "setup_ccaas_queue_agents",
    "setup_ccaas_queue_prompt_slots",
    "setup_queue_routing_profiles",
    "setup_business_hours",
    "setup_business_hour_shifts",
    "setup_holiday_calendars",
    "setup_holidays",
    "setup_knowledge_documents",
    "setup_knowledge_org_profiles",
    "routing_profile_types",
    "setup_organization_routing_profiles",
    "setup_organization_recording_settings",
    "setup_voice_dids",
    "setup_voice_prompt_profiles",
    "setup_app_connections",
}

PURPOSE = {
    "organizations": "Tenant company. Every Contact Center row is isolated by this id.",
    "organization_locations": "Branch / office addresses under the tenant. Users can point at a location id.",
    "setup_users": "People who log in: agents, supervisors, admins. Source of agent identity before publish.",
    "setup_teams": "Teams that own queues and group users.",
    "setup_roles": "Named permission sets (view/create/edit/delete/export/approve) per product.",
    "setup_user_product_access": "Which user has which role on which product (for example contact center).",
    "setup_user_invite_tokens": "One-time invite links so a new user can set a password.",
    "setup_channel_configs": "Parent channel row: web chat, email, social, or voice. Child configs hang off this id.",
    "setup_webchat_configs": "Web chat widget: greeting, title, and which setup queue it routes to.",
    "setup_email_configs": "Mailbox connection for a channel (SMTP/IMAP or OAuth). Secrets stay encrypted.",
    "setup_social_configs": "WhatsApp, Instagram, and Facebook connector settings for a channel.",
    "setup_crm_channel_agents": "Which setup users are allowed on a CRM channel config.",
    "setup_ccaas_queues": "Queue authored in My Account. Published into ccass.queues for live routing.",
    "setup_ccaas_queue_agents": "Which users sit on a setup queue, and which channels they handle.",
    "setup_ccaas_queue_prompt_slots": "Voice prompt slots on a setup queue (greeting, hold, connecting audio).",
    "setup_queue_routing_profiles": "Intents, keywords, and example phrases used to classify work onto a setup queue.",
    "setup_business_hours": "Open/close profile and timezone. Queues, teams, and users can follow one.",
    "setup_business_hour_shifts": "Per-day shift windows inside a business-hours profile.",
    "setup_holiday_calendars": "Named holiday calendar for a country, attached to business hours.",
    "setup_holidays": "One holiday date on a calendar.",
    "setup_knowledge_documents": "Files uploaded for bot and copilot knowledge retrieval.",
    "setup_knowledge_org_profiles": "Org-level knowledge profile (product and business JSON) for RAG.",
    "routing_profile_types": "Lookup of org routing styles: long wait, sticky, skill.",
    "setup_organization_routing_profiles": "The one routing style this organization uses, plus long-wait seconds when that style is selected.",
    "setup_organization_recording_settings": "Whether voice calls are recorded, inbound/outbound, consent prompt, and whether agents may listen.",
    "setup_voice_dids": "Phone numbers (DIDs) and where they route: a setup queue or a user.",
    "setup_voice_prompt_profiles": "Named voice prompt (IVR slots) played on a DID or as a recording consent notice.",
    "setup_app_connections": "External app connection configured in setup (OAuth-style integration metadata).",
    "agents": "Live agent identity published from setup_users. Routing and workspace use this id, not the login user id.",
    "agent_presence": "Current presence of one agent (ready, busy, not ready, and so on). Routing reads this.",
    "agent_presence_history": "Append-only log of presence changes for attendance and audit.",
    "presence_reason_codes": "Org catalog of break/training/not-ready reason codes.",
    "agent_capacity": "How many conversations an agent may hold on one channel, and how many are active or reserved.",
    "agent_skills": "Skills an agent has, with proficiency.",
    "skills": "Skill catalog for skill-based routing.",
    "agent_missed_contacts": "A contact the agent did not take (timeout, reject, no agent). Drives the missed inbox and callbacks.",
    "missed_contact_reasons": "Lookup of missed-contact reason codes and labels.",
    "agent_not_ready_escalations": "Supervisor alert after an agent stays not-ready past the reminder policy.",
    "onboarding_dashboard_codes": "Short-lived hashed code that sends a new user from set-password into the Contact Center dashboard.",
    "queues": "Live queue snapshot published from setup_ccaas_queues. Conversations are offered from here.",
    "queue_members": "Which agents belong to a live queue, and their per-channel concurrency.",
    "queue_skills": "Skills a queue requires or prefers.",
    "queue_routing_profiles": "Published classifier metadata (intents, keywords) for a live queue.",
    "routing_policies": "How a queue offers work: strategy, timeout, overflow queue, after-contact work, email SLAs.",
    "routing_cursors": "Round-robin pointer so the next offer does not always start at the same agent.",
    "routing_attempts": "One routing decision for a conversation: which queue and agent, and the outcome.",
    "proactive_callback_attempts": "Record that co-worker already tried to auto-create a callback for a missed contact.",
    "conversations": "One customer session on one channel: bot, queue, agent, SLA clocks, and link to the CDP contact.",
    "conversation_messages": "Every inbound and outbound message on a conversation.",
    "conversation_message_attachments": "Files attached to a conversation message.",
    "conversation_participants": "Who is on the conversation (customer, visitor, agent) by an identity string.",
    "conversation_assignments": "Offer to an agent: ringing, accepted, rejected, expired, or ended.",
    "conversation_transfers": "Move a conversation to another queue or agent.",
    "transfer_action_operations": "Idempotent voice/ACD transfer command (consult, complete, cancel) and its result.",
    "conversation_dispositions": "Wrap-up code applied to a conversation, with optional note and resolution.",
    "dispositions": "Org catalog of wrap-up codes.",
    "conversation_notes": "Internal work note an agent writes on a conversation.",
    "conversation_memory": "Rolling summary and extracted facts the bot keeps for this conversation.",
    "conversation_sla_state": "First-response and resolution due times, warnings, and breach for one conversation.",
    "sla_policies": "SLA thresholds (seconds) the org defines. Conversation SLA state points at one of these.",
    "conversation_sentiment_turns": "Customer and agent sentiment scored for one message.",
    "webchat_sessions": "Browser session for a web chat conversation (page URL, visitor, connection).",
    "message_receipts": "Sent, delivered, and read timestamps for a message.",
    "message_delivery_attempts": "One try to deliver an outbound message to a provider.",
    "nlp_conversations": "Bot runtime session tied 1:1 to a conversation, including which skill version ran.",
    "nlp_turns": "One bot turn: customer text, reply, intent, sentiment, and whether handoff was recommended.",
    "nlp_skills": "Skill registered for the bot or copilot (key, name, draft/published state).",
    "nlp_skill_versions": "Immutable version of a skill: prompt, schemas, and policies.",
    "nlp_skill_bindings": "Which skill version is active for a channel, surface, or role.",
    "nlp_skill_tools": "Tools a skill version is allowed to call.",
    "nlp_skill_activation_history": "Audit of skill publish/activate actions.",
    "copilot_sessions": "An agent's co-worker chat session (not the customer conversation).",
    "copilot_turns": "One co-worker prompt and reply, optionally tied to a customer conversation.",
    "copilot_memory": "Durable co-worker memory for a user or a conversation.",
    "copilot_skill_executions": "One tool/skill call the co-worker made, with latency and status.",
    "channel_automation_policies": "Per channel config: bot on/off, confidence, default queue, and what to do when no agent is free.",
    "email_mailbox_policies": "Per mailbox: bot, shadow mode, default queue, and close-after-hours.",
    "email_provider_events": "Inbound Gmail/Graph event ids so the same webhook is not processed twice.",
    "email_delivery_outbox": "Outbound email waiting to be sent, with retries.",
    "whatsapp_channel_policies": "WhatsApp-specific bot, default queue, and inactivity close.",
    "agent_tasks": "Agent inbox: callbacks, follow-ups, escalations, and co-worker suggestions.",
    "workspace_common_notes": "Shared notes on the workspace, not tied to one conversation.",
    "scheduled_reports": "A saved schedule that emails a performance PDF/CSV.",
    "scheduled_report_runs": "One execution of a scheduled report, including file path and status.",
    "internal_chat_rooms": "Team chat room: a group or a direct message. Not a customer conversation.",
    "internal_chat_room_members": "Who is in a team-chat room, their role, and how far they have read.",
    "internal_chat_dm_pairs": "Ensures two users share at most one direct-message room.",
    "internal_chat_messages": "One team-chat message (text, voice, or attachment bundle).",
    "internal_chat_message_attachments": "File on a team-chat message.",
    "dashboard_analytics_incidents": "Detected operational incident (SLA, backlog, and similar) shown on the admin dashboard.",
    "dashboard_analytics_forecast_runs": "One volume-forecast run for the dashboard (baseline plus optional model adjustment).",
    "dashboard_analytics_workforce_plans": "Suggested staffing plan produced from a forecast.",
    "audit_log": "Sensitive action audit (who changed what, before/after JSON).",
    "schema_migrations": "Ledger of SQL files already applied to the ccass schema.",
    "call_cdr": "Voice call detail record written by telephony. Contact Center reads it for the recordings list. Not modeled in Prisma.",
    "customer_profile": "The contact Contact Center shows in the workspace. Keyed by cdp_id. Email and phone live in identity_keys, not as columns here.",
    "identity_keys": "One email, phone, WhatsApp number, or social id that belongs to a contact. Used to match inbound messages to a person.",
    "contact_identities": "Older channel-identity table (email, phone, webchat visitor, WhatsApp). Prefer identity_keys for new resolution.",
    "interactions": "One customer-centric copy of a conversation, for contacts history. Operational truth stays in ccass.conversations.",
    "interaction_events": "Timeline events on an interaction (message, handoff, resolve).",
    "orders": "Commerce orders Contact Center shows on the customer panel. Owned by CDP, not by routing.",
    "order_items": "Line items on a CDP order.",
}

ENUMS = {
    ("conversations", "status"): "bot_active, queued, assigned, active, resolved, closed",
    ("conversations", "lifecycle_state"): "bot, waiting, offered, connected, wrap_up, ended",
    ("conversations", "channel"): "webchat, email, whatsapp, instagram, facebook, voice",
    ("conversations", "direction"): "inbound, outbound",
    ("conversations", "sla_status"): "not_started, on_track, warning, breached, met, stopped",
    ("agent_presence", "presence_state"): "offline, ready, not_ready, break, away, busy, after_contact_work",
    ("agent_presence", "status"): "offline, ready, not_ready, break, away, busy, after_contact_work (legacy copy of presence_state)",
    ("agent_presence", "source"): "system, agent, supervisor",
    ("agent_presence_history", "source"): "agent, system, supervisor",
    ("agent_tasks", "status"): "open, completed, dismissed",
    ("agent_tasks", "task_type"): "follow_up, callback, escalation, suggestion",
    ("agent_tasks", "source"): "self, admin, coworker, system",
    ("agent_tasks", "priority"): "low, normal, high, critical",
    ("agent_missed_contacts", "reason"): "offer_timeout, manual_reject, no_agent_available, routing_exhausted, handoff_failure",
    ("conversation_assignments", "state"): "offered, accepted, rejected, expired, ended",
    ("conversation_transfers", "state"): "requested, offered, accepted, completed, cancelled",
    ("transfer_action_operations", "action"): "1 consult, 2 complete, 3 cancel, 4 merge, 5 hangup, 6 reject (smallint codes)",
    ("transfer_action_operations", "state"): "pending, acknowledged, failed, timed_out",
    ("channel_automation_policies", "channel"): "webchat, email, whatsapp, social (later migrations also allow instagram, facebook)",
    ("channel_automation_policies", "automation_mode"): "auto_send, draft_only, disabled",
    ("channel_automation_policies", "no_agent_behavior"): "queue_and_notify, bot_continue, close_with_message",
    ("channel_automation_policies", "status"): "active, inactive",
    ("message_receipts", "status"): "sent, delivered, read",
    ("conversation_message_attachments", "status"): "pending, available, blocked, expired",
    ("conversation_messages", "direction"): "inbound, outbound",
    ("conversation_messages", "sender_type"): "customer, agent, bot, system",
    ("conversation_messages", "visibility"): "customer, internal, system",
    ("routing_policies", "strategy"): "skill_round_robin, longest_idle, round_robin (application keys; default skill_round_robin)",
    ("queue_skills", "requirement_type"): "required, preferred",
    ("queue_members", "call_type"): "inbound, outbound, both",
    ("internal_chat_rooms", "room_type"): "group, dm",
    ("internal_chat_room_members", "role"): "admin, member",
    ("internal_chat_messages", "message_type"): "text, voice, attachment_bundle",
    ("dashboard_analytics_incidents", "status"): "candidate, active, cooling, resolved",
    ("dashboard_analytics_incidents", "severity"): "low, medium, high, critical",
    ("setup_ccaas_queue_prompt_slots", "slot_id"): "connecting_audio, queue_greeting, queue_audio, hold_audio",
    ("setup_ccaas_queue_prompt_slots", "source"): "none, tts, upload",
    ("setup_ccaas_queue_prompt_slots", "status"): "pending, ready, failed",
    ("setup_channel_configs", "channel_type"): "web_chat, email, social, voice",
    ("setup_channel_configs", "status"): "pending, active, inactive",
    ("identity_keys", "key_type"): "email, email_secondary, phone, phone_secondary, webchat_visitor, whatsapp_phone, instagram_user, facebook_user",
    ("contact_identities", "identity_type"): "email, phone, webchat_visitor, whatsapp_phone",
    ("routing_profile_types", "code"): "long_wait, sticky, skill",
    ("routing_profile_types", "id"): "1 long_wait, 2 sticky, 3 skill",
    ("email_delivery_outbox", "status"): "pending, sending, sent, failed",
    ("scheduled_reports", "schedule"): "daily, weekly, monthly",
    ("scheduled_reports", "period"): "yesterday, last_7_days, last_30_days",
    ("scheduled_reports", "send_mode"): "custom_time",
    ("scheduled_report_runs", "status"): "pending, running, succeeded, failed",
    ("nlp_skills", "state"): "draft, published, archived",
    ("nlp_skill_versions", "state"): "draft, published, archived",
}

LOGICAL = {
    "organization_id": "accounts.organizations.id",
    "setup_user_id": "accounts.setup_users.id",
    "assigned_user_id": "accounts.setup_users.id",
    "author_user_id": "accounts.setup_users.id",
    "created_by_user_id": "accounts.setup_users.id",
    "assigned_by_user_id": "accounts.setup_users.id",
    "requested_by_user_id": "accounts.setup_users.id",
    "uploaded_by": "accounts.setup_users.id",
    "user_id": "accounts.setup_users.id",
    "owner_user_id": "accounts.setup_users.id",
    "target_user_id": "accounts.setup_users.id",
    "actor_user_id": "accounts.setup_users.id",
    "from_user_id": "accounts.setup_users.id",
    "sender_user_id": "accounts.setup_users.id",
    "applied_by_user_id": "accounts.setup_users.id",
    "team_id": "accounts.setup_teams.id",
    "business_hours_id": "accounts.setup_business_hours.id",
    "holiday_calendar_id": "accounts.setup_holiday_calendars.id",
    "channel_config_id": "accounts.setup_channel_configs.id",
    "setup_queue_id": "accounts.setup_ccaas_queues.id",
    "contact_id": "cdp.customer_profile.cdp_id",
    "cdp_id": "cdp.customer_profile.cdp_id",
    "location_id": "accounts.organization_locations.id",
    "mailbox_connection_id": "accounts.mail_oauth_connections.id",
    "connection_id": "accounts.mail_oauth_connections.id",
    "oauth_connection_id": "accounts.mail_oauth_connections.id",
    "consent_prompt_id": "accounts.setup_voice_prompt_profiles.id",
    "prompt_profile_id": "accounts.setup_voice_prompt_profiles.id",
    "routing_queue_id": "accounts.setup_ccaas_queues.id",
    "routing_user_id": "accounts.setup_users.id",
    "role_id": "accounts.setup_roles.id",
    "product_id": "platform product id (string), not inventory.products",
}

WHY = {
    "id": "Primary key.",
    "organization_id": "Tenant. Every query must filter this.",
    "created_at": "When the row was created (UTC).",
    "updated_at": "When the row last changed (UTC).",
    "status": "Lifecycle or on/off state for this row.",
    "name": "Name shown in the UI.",
    "description": "Longer explanation.",
    "version": "Optimistic lock. Writers increment it so two updates do not overwrite each other.",
    "metadata": "Extra JSON the product can extend without a migration.",
    "channel": "Which channel this row is about.",
    "contact_id": "The customer. Text equal to cdp.customer_profile.cdp_id (no cross-schema foreign key).",
    "conversation_id": "The customer session this row belongs to.",
    "agent_id": "The live agent.",
    "queue_id": "The queue.",
    "body": "The text the user reads.",
    "subject": "Email or conversation subject.",
    "priority": "Higher means more urgent where the product sorts by it.",
    "notes": "Free-text note.",
    "title": "Short title.",
    "summary": "Short summary for lists and co-worker context.",
    "source": "Who or what created the row.",
    "reason": "Why this state happened.",
    "reason_code": "Code from the presence or missed-contact catalog.",
    "is_active": "Inactive rows stay in the database but drop out of pickers.",
    "external_thread_id": "Session id unique per org and channel. A new session gets a new id.",
    "provider_thread_id": "Provider thread (email chain, WhatsApp thread) that can span sessions.",
    "previous_conversation_id": "Earlier closed conversation in the same customer journey.",
    "visitor_id": "Channel identity before a contact is resolved (visitor id, email, psid).",
    "bot_active": "True while the bot still owns the conversation.",
    "nlp_enabled": "Whether NLP may run on this conversation.",
    "live_agent_enabled": "Whether the bot may hand off to a person.",
    "handoff_reason": "Why the bot sent the conversation to a queue.",
    "lifecycle_state": "Normalized state used by voice and the workspace.",
    "direction": "Customer started it (inbound) or the agent did (outbound).",
    "sla_status": "Whether the SLA clock is on track, warning, or breached.",
    "assigned_agent_id": "Agent who currently owns the conversation.",
    "assigned_user_id": "Login user for that agent (accounts.setup_users).",
    "channel_config_id": "Which setup channel (widget, mailbox, or social app) this uses.",
    "disposition_code": "Wrap-up code stored on the conversation after resolve.",
    "resolution_code": "Resolution code stored with wrap-up.",
    "resolution_summary": "Short text of how it was resolved.",
    "first_response_due_at": "SLA deadline for the first agent reply.",
    "resolution_due_at": "SLA deadline to resolve.",
    "first_response_at": "When the first response actually happened.",
    "first_agent_response_at": "When a human agent first replied (bot replies do not count).",
    "queued_at": "When it entered a queue.",
    "assigned_at": "When an agent accepted it.",
    "resolved_at": "When it was resolved.",
    "closed_at": "When it was closed.",
    "ended_at": "When the session ended.",
    "end_reason": "Why it ended.",
    "end_actor": "Who ended it (customer, agent, system, bot).",
    "presence_state": "What routing should treat the agent as right now.",
    "heartbeat_at": "Last heartbeat. A stale heartbeat means the agent is gone.",
    "lease_expires_at": "When the presence lease expires if heartbeats stop.",
    "max_concurrency": "How many conversations this agent may hold on this channel.",
    "active_count": "Conversations currently connected.",
    "reserved_count": "Offers ringing that are not accepted yet.",
    "offer_timeout_seconds": "How long an offer rings before it is a miss.",
    "overflow_queue_id": "Queue to try after this queue cannot place the contact.",
    "after_contact_work_seconds": "Wrap-up time after the contact ends.",
    "strategy": "How the queue picks the next agent.",
    "proficiency": "How strong the agent is at this skill (integer).",
    "requirement_type": "Whether the queue must have this skill or only prefers it.",
    "min_proficiency": "Minimum proficiency to be eligible.",
    "weight": "How much this skill matters when scoring agents.",
    "cursor_index": "Round-robin position.",
    "last_agent_id": "Last agent the cursor offered.",
    "attempt_number": "Which try this is for the same conversation.",
    "outcome": "What the attempt or routing decision did.",
    "candidate_scores": "JSON scores of agents considered.",
    "skip_reasons": "JSON reasons agents were skipped.",
    "state": "Workflow state of this offer, transfer, or operation.",
    "expires_at": "When an unanswered offer expires.",
    "offered_at": "When the offer was shown.",
    "accepted_at": "When it was accepted.",
    "rejected_at": "When it was rejected.",
    "expired_at": "When the offer timed out.",
    "sender_type": "Who sent the message.",
    "visibility": "Whether the customer can see the message.",
    "delivery_state": "Provider delivery state of the message.",
    "external_id": "Provider message id, used so retries do not insert twice.",
    "message_type": "text, or a richer type such as voice or attachment.",
    "reply_to_message_id": "Message this one replies to.",
    "storage_key": "Object-storage path of the file.",
    "file_name": "Original file name.",
    "content_type": "MIME type.",
    "byte_size": "File size in bytes.",
    "checksum_sha256": "Hash so the same file can be detected.",
    "rolling_summary": "Short memory the bot keeps as the chat grows.",
    "extracted_facts": "JSON facts pulled from the conversation.",
    "intent": "What the customer was trying to do on this turn.",
    "sentiment": "Detected sentiment label.",
    "confidence": "Model confidence, 0 to 1.",
    "handoff_recommended": "True when the bot thinks a person should take over.",
    "skill_key": "Stable skill id string.",
    "tool_key": "Stable tool id string.",
    "prompt_template": "Prompt text for this skill version.",
    "task_type": "What kind of inbox item this is.",
    "due_at": "When the agent should do the task.",
    "completed_at": "When the task was finished.",
    "dismissed_at": "When the agent dismissed it without completing it.",
    "customer_name": "Name captured at the time of the miss, so the inbox still shows it if the profile changes.",
    "missed_at": "When the contact was missed.",
    "acknowledged_at": "When someone acknowledged the miss.",
    "recording_enabled": "Master switch for voice recording.",
    "inbound_enabled": "Record inbound calls when recording is on.",
    "outbound_enabled": "Record outbound calls when recording is on.",
    "consent_notice_enabled": "Play a prompt before recording.",
    "agent_access_enabled": "Whether agents may open recordings.",
    "routing_type_id": "1 long wait, 2 sticky, 3 skill.",
    "long_wait_seconds": "Wait threshold used only when routing type is long wait.",
    "room_type": "Group room or direct message.",
    "last_read_at": "How far this member has read. Unread count is messages after this.",
    "cdp_id": "Contact key. Same value stored as contact_id on conversations and tasks.",
    "key_type": "What kind of identity this row is.",
    "key_value": "The email, phone, or social id, normalized.",
    "custom_fields": "JSON bag for fields that are not first-class columns (including omni-channel summary).",
    "domain_id": "Tenant id on telephony rows. Same number as accounts.organizations.id.",
    "recording_url": "Playable URL of the call recording.",
    "is_inbound": "True when the customer called in.",
    "customer_number": "Caller or callee phone number on the CDR.",
    "agent_ext": "Agent extension. Joined to setup_users.ext for the agent name.",
    "recording_duration": "Recording length.",
    "session_start_time": "When the voice session started.",
}

SAMPLES = {
    "id": "1001",
    "organization_id": "1000",
    "cdp_id": "9000000000000000123",
    "contact_id": "9000000000000000123",
    "setup_user_id": "1005",
    "assigned_user_id": "1005",
    "created_by_user_id": "1005",
    "author_user_id": "1005",
    "user_id": "1005",
    "agent_id": "301",
    "queue_id": "401",
    "conversation_id": "9001",
    "team_id": "21",
    "channel": "webchat",
    "channel_type": "web_chat",
    "status": "active",
    "name": "Billing",
    "first_name": "Priya",
    "last_name": "Sharma",
    "work_email": "priya.sharma@example.com",
    "email": "priya.sharma@example.com",
    "display_name": "Priya Sharma",
    "company_name": "Acme Retail",
    "presence_state": "ready",
    "lifecycle_state": "connected",
    "task_type": "callback",
    "room_type": "dm",
    "message_type": "text",
    "key_type": "email",
    "key_value": "priya.sharma@example.com",
    "strategy": "skill_round_robin",
    "code": "resolved",
    "label": "Resolved",
}


def parse_models(text: str) -> dict[str, dict]:
    models: dict[str, dict] = {}
    chunks = re.split(r"\n(?=model )", text)
    for chunk in chunks:
        header = re.match(r"model (\w+) \{", chunk)
        if not header:
            continue
        name = header.group(1)
        schema_m = re.search(r'@@schema\("(\w+)"\)', chunk)
        if not schema_m:
            continue
        fields = []
        fks = {}  # column -> (model, ref_col)
        uniques = []
        for raw in chunk.splitlines():
            line = raw.strip()
            if not line or line.startswith("//") or line.startswith("///") or line.startswith("@@") or line.startswith("model "):
                continue
            if line.startswith("}"):
                continue
            m = re.match(r"(\w+)\s+(\w+)(\[\])?(\?)?(?:\s+(.*))?$", line)
            if not m:
                continue
            fname, ftype, is_array, optional, rest = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5) or ""
            if ftype not in SCALARS:
                rel = re.search(r"fields:\s*\[([^\]]+)\]\s*,\s*references:\s*\[([^\]]+)\]", rest)
                if rel:
                    cols = [c.strip() for c in rel.group(1).split(",")]
                    refs = [c.strip() for c in rel.group(2).split(",")]
                    if len(cols) == 1 and len(refs) == 1:
                        fks[cols[0]] = (ftype, refs[0])
                continue
            db = ""
            db_m = re.search(r"@db\.(\w+)(?:\(([^)]*)\))?", rest)
            if db_m:
                db = db_m.group(1) + (f"({db_m.group(2)})" if db_m.group(2) else "")
            default = extract_default(rest)
            fields.append(
                {
                    "name": fname,
                    "type": ftype,
                    "array": bool(is_array),
                    "optional": bool(optional),
                    "db": db,
                    "default": default,
                    "pk": "@id" in rest,
                    "unique": "@unique" in rest,
                }
            )
        models[name] = {"schema": schema_m.group(1), "fields": fields, "fks": fks}
    return models


def extract_default(rest: str) -> str | None:
    token = "@default("
    i = rest.find(token)
    if i < 0:
        return None
    i += len(token)
    depth = 1
    j = i
    while j < len(rest) and depth:
        if rest[j] == "(":
            depth += 1
        elif rest[j] == ")":
            depth -= 1
        j += 1
    raw = rest[i : j - 1].strip().strip('"')
    if raw.startswith("autoincrement") or raw.startswith("uuid") or raw.startswith("dbgenerated"):
        return None
    if raw.startswith("now"):
        return "now()"
    return raw[:48]


def pg_type(field: dict) -> str:
    t = field["type"]
    db = field["db"]
    if t == "BigInt":
        base = "bigint"
    elif t == "Int":
        base = "integer"
    elif t == "Boolean":
        base = "boolean"
    elif t == "Json":
        base = "jsonb"
    elif t == "DateTime":
        if db.startswith("Timestamptz"):
            base = "timestamptz"
        elif db.startswith("Date"):
            base = "date"
        elif db.startswith("Time"):
            base = "time"
        else:
            base = "timestamptz"
    elif t == "Decimal":
        base = f"numeric({db.split('(',1)[1]}" if "(" in db else "numeric"
    elif t == "String":
        if db.startswith("VarChar"):
            base = "varchar" + db[len("VarChar") :]
        elif db.startswith("Char"):
            base = "char" + db[len("Char") :]
        elif db.startswith("Text"):
            base = "text"
        else:
            base = "text"
    else:
        base = t.lower()
    if field["array"]:
        base += "[]"
    return base


def why_for(table: str, col: str, fk: str | None) -> str:
    key = f"{table}.{col}"
    if col in WHY and table not in {"organizations"} or col in WHY:
        text = WHY.get(col, "")
    else:
        text = ""
    if fk:
        extra = f"Declared FK → `{fk}`."
        return f"{text} {extra}".strip() if text else extra
    logical = LOGICAL.get(col)
    if logical and col not in {"id"}:
        extra = f"Logical ref → `{logical}` (no Postgres FK)."
        if text:
            return f"{text} {extra}"
        return extra
    if text:
        return text
    return col.replace("_", " ").capitalize() + "."


def sample_for(field: dict) -> str:
    name = field["name"]
    if name in SAMPLES:
        return SAMPLES[name]
    if field["type"] == "Boolean":
        return "true" if field["default"] in {None, "true"} else "false"
    if field["type"] == "DateTime":
        return "2026-09-20T10:00:00Z"
    if field["type"] == "Json":
        return "{}"
    if field["type"] in {"Int", "BigInt"}:
        return field["default"] or "1"
    if field["default"] and field["default"] not in {"now()", "autoincrement()", "uuid()"}:
        return field["default"][:40]
    if name.endswith("_at"):
        return "2026-09-20T10:00:00Z"
    return "…"


def render_table(schema: str, name: str, model: dict) -> str:
    fields = model["fields"]
    pk = [f["name"] for f in fields if f["pk"]] or ["id"]
    fk_bits = []
    for col, (target, ref) in model["fks"].items():
        fk_bits.append(f"`{col}` → `{schema if target in model else ''}`.")
    # resolve target schema later via passed map — filled by caller using model fks already as model name
    lines = [f"## `{schema}.{name}`", ""]
    lines.append(f"**Purpose:** {PURPOSE.get(name, 'Contact Center table.')}")
    lines.append("")
    key_line = f"**Keys:** PK `{', '.join(pk)}`."
    declared = []
    for col, (target, ref) in model["fks"].items():
        declared.append(f"`{col}` → `{target}.{ref}`")
    if declared:
        key_line += " Declared FK " + "; ".join(declared) + "."
    logical_cols = []
    for f in fields:
        if f["name"] in model["fks"]:
            continue
        if f["name"] in LOGICAL:
            logical_cols.append(f"`{f['name']}` → `{LOGICAL[f['name']]}`")
    if logical_cols:
        key_line += " Logical " + "; ".join(logical_cols[:8]) + "."
    lines.append(key_line)
    lines.append("")
    lines.append("| Column | Type | Required | Values | Why it exists |")
    lines.append("|--------|------|----------|--------|----------------|")
    sample_bits = []
    for f in fields:
        fk = None
        if f["name"] in model["fks"]:
            target, ref = model["fks"][f["name"]]
            fk = f"{target}.{ref}"
        enum = ENUMS.get((name, f["name"]), "")
        if not enum and f["type"] == "Boolean":
            enum = "`true`, `false`"
        req = "no" if f["optional"] else "yes"
        default = ""
        if f["default"] and f["default"] not in {"autoincrement()"}:
            default = f" default `{f['default'][:48]}`"
        why = why_for(name, f["name"], fk).replace("|", "/")
        lines.append(
            f"| `{f['name']}` | {pg_type(f)} | {req}{default} | {enum} | {why} |"
        )
        value = sample_for(f)
        interesting = f["name"] in {
            "id", "organization_id", "cdp_id", "name", "status", "channel",
            "contact_id", "conversation_id", "agent_id", "queue_id",
            "presence_state", "task_type", "key_type", "key_value", "code",
            "display_name", "first_name",
        }
        if value != "…" and (interesting or len(sample_bits) < 6) and len(sample_bits) < 8:
            sample_bits.append(f"{f['name']}={value}")
    lines.append("")
    lines.append("**Example row:** `" + ", ".join(sample_bits) + "`")
    lines.append("")
    lines.append("---")
    lines.append("")
    return "\n".join(lines)


def manual_cdp() -> str:
    return """
# Schema `cdp` (tables Contact Center reads and writes)

CDP is a shared customer store. Contact Center does **not** migrate the full CDP warehouse (campaigns, gold metrics, partitioned events). These are the tables the workspace, identity resolution, projections, and customer panel use.

IDs on `customer_profile.cdp_id` and `identity_keys.cdp_id` are **text**. `conversations.contact_id` stores that same text. There is **no** Postgres foreign key across schemas.

---

## `cdp.customer_profile`

**Purpose:** The contact shown in the workspace: name, company, location, and a JSON bag for extra fields. Email and phone are not columns here; they are `identity_keys`.

**Keys:** PK `cdp_id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `cdp_id` | text | yes | | Contact id. Stored on conversations and tasks as `contact_id`. |
| `organization_id` | bigint | yes | | Tenant. |
| `first_name` | text | no | | Given name. |
| `last_name` | text | no | | Family name. |
| `gender` | text | no | | Profile field. |
| `date_of_birth` | date | no | | Profile field. |
| `company` | text | no | | Company name. |
| `city` | text | no | | City. |
| `region` | text | no | | Region or state. |
| `country` | text | no | | Country. |
| `language` | text | no | | Preferred language. |
| `timezone` | text | no | | IANA timezone. |
| `contact_type` | varchar | no | | Optional classification added by Contact Center. |
| `blocked` | boolean | no | `true`, `false` | When true, voice to this contact should be blocked. |
| `custom_fields` | jsonb | no | | Extra attributes, including the omni-channel summary. |
| `acquisition_channel` | text | no | | How the contact was acquired. |
| `first_seen_at` | timestamptz | no | | First time we saw them. |
| `last_seen_at` | timestamptz | no | | Last activity. |
| `created_at` | timestamptz | no | | Created. |
| `updated_at` | timestamptz | no | | Last change. |

**Example row:** `cdp_id=9000000000000000123, organization_id=1000, first_name=Priya, last_name=Sharma, company=Acme Retail, city=Bengaluru, country=India, contact_type=customer`

---

## `cdp.identity_keys`

**Purpose:** One reachable identity for a contact. Inbound email, phone, WhatsApp, and social ids are matched here to find `cdp_id`.

**Keys:** PK `identity_id`. Logical `cdp_id` → `cdp.customer_profile.cdp_id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `identity_id` | text | yes | | Primary key. |
| `cdp_id` | text | yes | | Which contact owns this identity. |
| `organization_id` | bigint | yes | | Tenant. |
| `key_type` | text | yes | `email`, `email_secondary`, `phone`, `phone_secondary`, `webchat_visitor`, `whatsapp_phone`, `instagram_user`, `facebook_user` | Kind of identity. |
| `key_value` | text | yes | | Normalized value (lowercase email, phone digits as stored). |
| `source_system` | text | no | | Where it was learned (webchat, whatsapp, agent). |
| `confidence_score` | numeric | no | | How sure the match is, when set. |
| `verified` | boolean | no | `true`, `false` | Whether it was verified. |
| `created_at` | timestamptz | no | | Created. |

**Example row:** `identity_id=ik-1, cdp_id=9000000000000000123, organization_id=1000, key_type=email, key_value=priya.sharma@example.com, verified=false`

---

## `cdp.contact_identities`

**Purpose:** Earlier identity map (email, phone, webchat visitor, WhatsApp). Still present in some databases. New matching uses `identity_keys`.

**Keys:** PK `id`. Logical `contact_id` → contact / `customer_profile.cdp_id`. Logical `organization_id` → `accounts.organizations.id`. Unique (`organization_id`, `identity_type`, `identity_value`).

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | uuid | yes | | Primary key. |
| `organization_id` | uuid or bigint | yes | | Tenant. Older DDL used uuid; live type follows the database. |
| `contact_id` | uuid or text | yes | | Contact this identity belongs to. |
| `identity_type` | varchar(32) | yes | `email`, `phone`, `webchat_visitor`, `whatsapp_phone` | Kind. |
| `identity_value` | varchar(320) | yes | | The address, number, or visitor id. |
| `source_channel` | varchar(32) | no | | Channel that first saw it. |
| `first_seen_at` | timestamptz | yes | | First seen. |
| `last_seen_at` | timestamptz | yes | | Last seen. |
| `created_at` / `updated_at` | timestamptz | yes | | Audit. |

**Example row:** `identity_type=phone, identity_value=+919800000000, source_channel=whatsapp, contact_id=9000000000000000123`

---

## `cdp.interactions`

**Purpose:** One row per conversation, copied for the customer timeline. Do not route from this table. `ccass.conversations` is the live source.

**Keys:** PK `id`. Unique (`organization_id`, `conversation_id`). Logical `conversation_id` → `ccass.conversations.id`. Logical `contact_id` → `cdp.customer_profile.cdp_id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | Primary key. |
| `organization_id` | bigint | yes | | Tenant. |
| `conversation_id` | bigint | yes | | Source conversation. |
| `contact_id` | text | no | | Contact, when resolved. |
| `profile_id` | bigint | no | | Optional profile pointer kept from the conversation. |
| `visitor_id` | varchar | no | | Channel visitor id. |
| `channel` | varchar | yes | same as conversations.channel | Channel. |
| `queue_id` | bigint | no | | Queue at projection time. |
| `agent_id` | bigint | no | | Agent at projection time. |
| `status` | varchar | yes | same as conversations.status | Status copy. |
| `started_at` | timestamptz | yes | | When the conversation started. |
| `ended_at` | timestamptz | no | | When it ended. |
| `outcome` | varchar | no | | Resolution or end reason. |
| `summary` | text | no | | Rolling summary if one exists. |
| `disposition_code` | varchar | no | | Wrap-up code. |
| `topics` | jsonb | no | | Topic tags, when set. |
| `sentiment` | varchar | no | | Sentiment, when set. |
| `sla_result` | varchar | no | | SLA result, when set. |
| `last_activity_at` | timestamptz | yes | | Last projection update. |
| `created_at` / `updated_at` | timestamptz | yes | | Audit. |

**Example row:** `id=77, organization_id=1000, conversation_id=9001, contact_id=9000000000000000123, channel=webchat, status=active`

---

## `cdp.interaction_events`

**Purpose:** Timeline under an interaction: a message, handoff, or resolve. Used when rebuilding contact history.

**Keys:** PK `id`. Declared FK `interaction_id` → `cdp.interactions.id` (CASCADE) in the Contact Center migration.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | Primary key. |
| `organization_id` | bigint | yes | | Tenant. |
| `interaction_id` | bigint | yes | | Parent interaction. |
| `conversation_id` | bigint | yes | | Source conversation. |
| `message_id` | bigint | no | | Source message, when the event is a message. |
| `event_type` | varchar | yes | message, handoff, resolve, transfer, and similar | What happened. |
| `metadata` | jsonb | yes | | Extra payload. |
| `occurred_at` | timestamptz | yes | | When it happened. |

**Example row:** `interaction_id=77, conversation_id=9001, event_type=handoff, occurred_at=2026-09-20T10:05:00Z`

---

## `cdp.orders`

**Purpose:** Orders shown on the customer panel. Contact Center only reads them.

**Keys:** PK `order_id`. Logical `cdp_id` → `cdp.customer_profile.cdp_id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `order_id` | bigint | yes | | Primary key. |
| `cdp_id` | text | no | | Contact who placed it. Also check `custom_fields.proposed_cdp_id`. |
| `organization_id` | bigint | yes | | Tenant. |
| `order_number` | text | no | | Human order number. |
| `status` | text | no | | Order status. |
| `payment_status` | text | no | | Payment status. |
| `fulfillment_status` | text | no | | Fulfillment status. |
| `total_amount` | numeric | no | | Total. |
| `currency` | text | no | | Currency code. |
| `custom_fields` | jsonb | no | | Address, tracking, courier, and links. |
| `created_at` | timestamptz | no | | When the order was placed. |

**Example row:** `order_id=5001, organization_id=1000, cdp_id=9000000000000000123, order_number=WIPL-2026-0042, status=fulfilled, currency=INR, total_amount=2499.00`

---

## `cdp.order_items`

**Purpose:** Lines on an order (quantity and price) for the customer panel.

**Keys:** PK `order_item_id`. Logical `order_id` → `cdp.orders.order_id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `order_item_id` | bigint | yes | | Primary key. |
| `order_id` | bigint | yes | | Parent order. |
| `organization_id` | bigint | yes | | Tenant. |
| `quantity` | numeric | no | | How many. |
| `unit_price` | numeric | no | | Price each. |
| `custom_fields` | jsonb | no | | Product name and other line details. |

**Example row:** `order_item_id=1, order_id=5001, organization_id=1000, quantity=1, unit_price=2499.00`

---

# Telephony table used by recordings

## `ccass.call_cdr`

**Purpose:** Call detail record from the voice platform. The recordings page lists rows that have a playable `recording_url`. This table is **not** in the Contact Center Prisma schema; telephony owns the full column set. Below is what Contact Center reads.

**Keys:** PK `id`. Logical `domain_id` → `accounts.organizations.id` (telephony tenant column, not `organization_id`). Logical `queue_id` may match `ccass.queues.id` or `ccass.queues.setup_queue_id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | Recording id in the UI. |
| `domain_id` | bigint | yes | | Tenant. |
| `session_start_time` | timestamptz | no | | When the call session started. |
| `created_at` | timestamptz | no | | Row time, used if session start is empty. |
| `is_inbound` | boolean | no | `true`, `false` | Inbound vs outbound. |
| `customer_number` | text | no | | Phone number, matched to `cdp.identity_keys`. |
| `agent_ext` | text | no | | Extension, matched to `accounts.setup_users.ext`. |
| `queue_id` | bigint | no | | Queue id or setup queue id. |
| `recording_duration` | integer | no | | Length. |
| `recording_url` | text | no | | URL the player opens. |

**Example row:** `id=88001, domain_id=1000, is_inbound=true, customer_number=+919800000000, agent_ext=1005, queue_id=401, recording_url=https://recordings.example/88001.wav`
"""


def main() -> None:
    models = parse_models(SCHEMA.read_text())
    # fix FK target schema in render by rewriting fks to schema.table
    for name, model in models.items():
        rewritten = {}
        for col, (target, ref) in model["fks"].items():
            tschema = models.get(target, {}).get("schema", "?")
            rewritten[col] = (f"{tschema}.{target}", ref)
        model["fks"] = rewritten

    ccass = [n for n, m in models.items() if m["schema"] == "ccass"]
    accounts = [n for n in ACCOUNTS_TABLES if n in models]

    order_ccass = [
        "agents", "agent_presence", "agent_presence_history", "presence_reason_codes",
        "agent_capacity", "skills", "agent_skills", "agent_missed_contacts", "missed_contact_reasons",
        "agent_not_ready_escalations", "onboarding_dashboard_codes",
        "queues", "queue_members", "queue_skills", "queue_routing_profiles", "routing_policies",
        "routing_cursors", "routing_attempts", "proactive_callback_attempts",
        "conversations", "conversation_messages", "conversation_message_attachments",
        "conversation_participants", "conversation_assignments", "conversation_transfers",
        "transfer_action_operations", "conversation_dispositions", "dispositions",
        "conversation_notes", "conversation_memory", "conversation_sla_state", "sla_policies",
        "conversation_sentiment_turns", "webchat_sessions", "message_receipts", "message_delivery_attempts",
        "nlp_skills", "nlp_skill_versions", "nlp_skill_bindings", "nlp_skill_tools",
        "nlp_skill_activation_history", "nlp_conversations", "nlp_turns",
        "copilot_sessions", "copilot_turns", "copilot_memory", "copilot_skill_executions",
        "channel_automation_policies", "email_mailbox_policies", "email_provider_events",
        "email_delivery_outbox", "whatsapp_channel_policies",
        "agent_tasks", "workspace_common_notes", "scheduled_reports", "scheduled_report_runs",
        "internal_chat_rooms", "internal_chat_room_members", "internal_chat_dm_pairs",
        "internal_chat_messages", "internal_chat_message_attachments",
        "dashboard_analytics_incidents", "dashboard_analytics_forecast_runs",
        "dashboard_analytics_workforce_plans", "audit_log", "schema_migrations",
    ]
    ccass_sorted = [n for n in order_ccass if n in ccass] + sorted(set(ccass) - set(order_ccass))

    order_accounts = [
        "organizations", "organization_locations", "setup_users", "setup_teams", "setup_roles",
        "setup_user_product_access", "setup_user_invite_tokens",
        "setup_business_hours", "setup_business_hour_shifts", "setup_holiday_calendars", "setup_holidays",
        "setup_channel_configs", "setup_webchat_configs", "setup_email_configs", "setup_social_configs",
        "setup_crm_channel_agents", "setup_ccaas_queues", "setup_ccaas_queue_agents",
        "setup_ccaas_queue_prompt_slots", "setup_queue_routing_profiles",
        "routing_profile_types", "setup_organization_routing_profiles",
        "setup_organization_recording_settings", "setup_voice_dids", "setup_voice_prompt_profiles",
        "setup_knowledge_documents", "setup_knowledge_org_profiles", "setup_app_connections",
    ]
    accounts_sorted = [n for n in order_accounts if n in accounts]

    intro = f"""# Contact Center product database — PostgreSQL tables, columns, entities

**Audience:** people who need to understand what Contact Center stores in Postgres and how it relates to Accounts and CDP.

All of this data lives in **PostgreSQL**, typically database `worktual_bigint`.

| Schema | What it is | Who writes it |
|--------|------------|----------------|
| `accounts` | Tenant setup: org, users, teams, channels, queues, hours, voice DIDs, recording settings | My Account / admin setup |
| `ccass` | Live contact center: conversations, routing, presence, bot, co-worker, team chat | cc-core, chat, social, NLP |
| `cdp` | The customer: profile, identities, a projection of conversations, orders | Contact Center writes profiles and projections; commerce owns orders |

`accounts` is the source of truth for **configuration**. `ccass` is the source of truth for **live operations**. `cdp` is the **customer**. Do not route calls from CDP.

This document covers tables **Contact Center uses**. It does not list billing, reseller, partner, or quotation tables in `accounts`, and it does not list the full CDP analytics warehouse.

**Sources (September 2026):** `packages/db-cc/prisma/schema.prisma` for `accounts` and `ccass`. CDP and `ccass.call_cdr` come from the SQL Contact Center runs, because those tables are not Prisma models.

IDs are **bigint** unless noted. APIs usually return them as strings. `cdp.customer_profile.cdp_id` is **text**, and `ccass.conversations.contact_id` stores that same text.

```sql
SELECT * FROM ccass.conversations WHERE organization_id = 1000;
SELECT * FROM cdp.customer_profile WHERE organization_id = 1000;
```

---

## How to read this document

Each table has:

1. **Purpose** — why Contact Center has this table
2. **Keys** — primary key, declared foreign keys (Postgres `REFERENCES` inside the schema), and logical refs (same id, no Postgres FK)
3. **Columns** — type, required, allowed values when they are a fixed set, and why the column exists
4. **Example row** — one realistic row using the shared ids below

**Declared FK** means Postgres will enforce it. **Logical ref** means the application joins on that id, but the database will not cascade-delete across schemas.

---

## Shared example IDs

| Symbol | Example | Meaning |
|--------|---------|---------|
| `ORG_ID` | `1000` | `accounts.organizations.id` |
| `USER_ID` | `1005` | `accounts.setup_users.id` |
| `AGENT_ID` | `301` | `ccass.agents.id` |
| `QUEUE_ID` | `401` | `ccass.queues.id` |
| `SETUP_QUEUE_ID` | `55` | `accounts.setup_ccaas_queues.id` |
| `CONV_ID` | `9001` | `ccass.conversations.id` |
| `CONTACT_ID` | `9000000000000000123` | `cdp.customer_profile.cdp_id` |

---

# Core product entities

| Entity | What it is | Home |
|--------|------------|------|
| Organization | The company. All rows are isolated by this id. | `accounts.organizations` |
| User | A person who logs in. | `accounts.setup_users` |
| Role | What that user may do. | `accounts.setup_roles` + `setup_user_product_access` |
| Team | Group that owns queues. | `accounts.setup_teams` |
| Channel | Web chat, email, social, or voice configuration. | `accounts.setup_channel_configs` and child tables |
| Setup queue | Queue as authored by an admin. | `accounts.setup_ccaas_queues` |
| Queue | Published copy used for live routing. | `ccass.queues` |
| Agent | Published user used by routing. | `ccass.agents` |
| Presence | Whether the agent can take work right now. | `ccass.agent_presence` |
| Conversation | One customer session on one channel. | `ccass.conversations` |
| Message | One turn in that session. | `ccass.conversation_messages` |
| Assignment | An offer to an agent. | `ccass.conversation_assignments` |
| Contact | The person. | `cdp.customer_profile` |
| Identity | An email or phone for that person. | `cdp.identity_keys` |
| Interaction | Customer-timeline copy of a conversation. | `cdp.interactions` |
| Task | Callback or follow-up in the agent inbox. | `ccass.agent_tasks` |
| Team chat | Agent-to-agent chat, not the customer. | `ccass.internal_chat_*` |

### How the main rows connect

```text
Organization 1──* User 1──1 Agent
Organization 1──* Setup queue ──publish──* Queue
Setup queue 1──* Setup queue agent ──publish──* Queue member (Agent)
User *── HAS_ROLE ──* Role

Conversation *── channel config, queue, agent, user
Conversation *── contact_id ── Contact 1──* Identity key
Conversation 1──* Message, Assignment, Transfer, Disposition, Note
Conversation 1──1 SLA state, Webchat session, NLP session, Interaction

Channel config 1──1 Webchat or Email or Social config
Channel config 1──1 Channel automation policy ── default queue
```

Publish path:

```text
accounts.setup_ccaas_queues        →  ccass.queues.setup_queue_id
accounts.setup_ccaas_queue_agents  →  ccass.agents + ccass.queue_members
accounts.setup_users               →  ccass.agents.setup_user_id
```

---

# Schema `accounts` (setup Contact Center uses)

{len(accounts_sorted)} tables. Billing, leads, quotations, partners, and resellers are omitted.

---

"""
    parts = [intro]
    for name in accounts_sorted:
        parts.append(render_table("accounts", name, models[name]))
    parts.append(f"""
# Schema `ccass` (live Contact Center)

{len(ccass_sorted)} tables. This is the operational database.

---

""")
    for name in ccass_sorted:
        parts.append(render_table("ccass", name, models[name]))
    parts.append("""
## `ccass.agent_not_ready_escalations`

**Purpose:** Supervisor alert after an agent dismisses Not Ready reminders and stays unavailable. Written by Contact Center; not yet a Prisma model.

**Keys:** PK `id`. Logical `organization_id` → `accounts.organizations.id`. Logical `agent_id` → `ccass.agents.id`. Logical `setup_user_id` → `accounts.setup_users.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | Primary key. |
| `organization_id` | bigint | yes | | Tenant. |
| `agent_id` | bigint | yes | | Agent who stayed not ready. |
| `setup_user_id` | bigint | no | | Login user for that agent. |
| `agent_name` | text | yes | | Name at escalation time. |
| `escalated_at` | timestamptz | yes | | When the supervisor was notified. |
| `acknowledged_at` | timestamptz | no | | When a supervisor acknowledged it. |
| `metadata` | jsonb | yes | | Extra context. |

**Example row:** `id=12, organization_id=1000, agent_id=301, setup_user_id=1005, agent_name=Priya Sharma, escalated_at=2026-09-20T10:00:00Z, acknowledged_at=null`

---

""")
    parts.append(manual_cdp())
    parts.append("""
---

## What this file leaves out on purpose

- `accounts` billing, subscriptions, invoices, leads, quotations, partners, resellers
- CDP analytics warehouse: campaigns, gold metrics, partitioned `customer_events` / `customer_journey`
- High-volume fact tables are included when the product writes them (`conversation_messages`, `nlp_turns`) because the team asked for tables in use, not only the ontology graph

Column lists for `accounts` and `ccass` match Prisma. If a live database has an extra column from a SQL migration not yet pulled into Prisma, it will be missing here until the schema is regenerated.
""")
    OUT.write_text("".join(parts))
    print(f"wrote {OUT} accounts={len(accounts_sorted)} ccass={len(ccass_sorted)}")


if __name__ == "__main__":
    main()
