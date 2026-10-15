"""One-shot catalog bootstrap. Safe to re-run."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent
SQL = ROOT / "sql"

COL = "      {name}: {{ type: {typ}, description: \"{desc}\", groupable: {g}{extra} }}"


def col(name: str, typ: str, desc: str, groupable: bool = False, phrases: list[str] | None = None) -> str:
    extra = ""
    if phrases:
        extra = f", user_phrases: {phrases}"
    return COL.format(name=name, typ=typ, desc=desc.replace('"', "'"), g=str(groupable).lower(), extra=extra)


def view(name: str, grain: str, desc: str, source: str, columns: list[str]) -> str:
    cols = "\n".join(columns)
    return f"""  {name}:
    grain: "{grain}"
    description: "{desc}"
    source: |
{source}
    columns:
{cols}
"""


# sources must include {{org_id}}
views: dict[str, str] = {}

views["branches"] = view(
    "branches",
    "one Campaign workspace (not accounts.branches)",
    "Workspaces under a tenant. Campaigns are always org+branch scoped.",
    "      SELECT id, organization_id, name, is_default, created_at, updated_at\n"
    "      FROM campaign.branches WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Workspace id stored on campaigns as branch_id."),
        col("organization_id", "bigint", "Tenant."),
        col("name", "text", "Workspace label.", True, ["workspace", "branch name"]),
        col("is_default", "boolean", "Login default workspace.", True),
        col("created_at", "timestamp", "Insert time."),
        col("updated_at", "timestamp", "Last rename."),
    ],
)

views["organization_products"] = view(
    "organization_products",
    "one product entitlement per branch",
    "Whether this branch may use Campaign. Login requires product_code=campaign and status=active.",
    "      SELECT id, organization_id, branch_id, product_code::text AS product_code, status::text AS status,\n"
    "             starts_at, ends_at, created_at, updated_at\n"
    "      FROM campaign.organization_products WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Entitlement row id."),
        col("organization_id", "bigint", "Tenant."),
        col("branch_id", "bigint", "Workspace."),
        col("product_code", "text", "campaign or crm.", True, ["product"]),
        col("status", "text", "active or inactive.", True, ["status", "entitlement"]),
        col("starts_at", "timestamp", "Optional start."),
        col("ends_at", "timestamp", "Optional end."),
        col("created_at", "timestamp", "Created."),
        col("updated_at", "timestamp", "Updated."),
    ],
)

views["campaigns"] = view(
    "campaigns",
    "one saved marketing campaign",
    "Saved program: lifecycle, frozen audience size, launch calendar date (UTC filter on launch_local_date text).",
    "      SELECT id, organization_id, branch_id, name, description, status::text AS status,\n"
    "             starts_at, ends_at, source_channel::text AS source_channel, created_by_user_id,\n"
    "             created_at, updated_at, goal, objective, session_id, audience_summary, audience_count,\n"
    "             launch_plan, launch_local_date, launch_local_time, timezone\n"
    "      FROM campaign.campaigns WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Campaign id. Joins batches and audience."),
        col("organization_id", "bigint", "Tenant."),
        col("branch_id", "bigint", "Workspace."),
        col("name", "text", "Display name.", True, ["campaign", "name"]),
        col("description", "text", "Operator description."),
        col("status", "text", "draft/scheduled/live/completed/cancelled.", True, ["status", "stage", "lifecycle"]),
        col("starts_at", "timestamp", "Optional UTC window start. Not Dashboard period."),
        col("ends_at", "timestamp", "Optional UTC window end."),
        col("source_channel", "text", "standalone_campaign or crm_marketing.", True, ["source"]),
        col("created_by_user_id", "bigint", "Marketer who saved it.", True, ["created by", "owner"]),
        col("created_at", "timestamp", "Row insert. Not launch."),
        col("updated_at", "timestamp", "Last column change."),
        col("goal", "text", "Marketing goal text.", True),
        col("objective", "text", "Finer objective."),
        col("session_id", "bigint", "Draft session if saved from chat."),
        col("audience_summary", "text", "Human audience summary."),
        col("audience_count", "integer", "Frozen selected people count."),
        col("launch_plan", "jsonb", "Schedule, channels, A/B, optional PPC JSON."),
        col("launch_local_date", "text", "Launch calendar date YYYY-MM-DD. Dashboard period.", True, ["launch date", "day"]),
        col("launch_local_time", "text", "Launch clock HH:mm."),
        col("timezone", "text", "IANA zone stored on the row; reports still filter in UTC."),
    ],
)

views["campaign_channels"] = view(
    "campaign_channels",
    "one planned channel on a saved campaign",
    "Planned channel list, not send facts. Delivery uses batches.",
    "      SELECT id, campaign_id, organization_id, channel, template_id\n"
    "      FROM campaign.campaign_channels WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Planned channel row."),
        col("campaign_id", "bigint", "Parent campaign."),
        col("organization_id", "bigint", "Tenant."),
        col("channel", "text", "email/whatsapp/sms/push/web/ppc.", True, ["channel"]),
        col("template_id", "bigint", "Session creative id if bound."),
    ],
)

views["campaign_audience"] = view(
    "campaign_audience",
    "one frozen person on a saved campaign",
    "Selected people as campaign bigint contact_id. Names and emails are on rpt.audience_people.",
    "      SELECT campaign_id, contact_id, created_at\n"
    "      FROM campaign.campaign_audience a\n"
    "      JOIN campaign.campaigns c ON c.id = a.campaign_id AND c.organization_id = {org_id}",
    [
        col("campaign_id", "bigint", "Parent campaign.", True),
        col("contact_id", "bigint", "Campaign person id.", True, ["contact"]),
        col("created_at", "timestamp", "When frozen."),
    ],
)

views["audience_people"] = view(
    "audience_people",
    "one selected person with CDP name and email when the id maps",
    "List grain for who is on a campaign. Do not use this join for send volume KPIs.",
    "      SELECT a.campaign_id, a.contact_id, a.created_at, c.name AS campaign_name,\n"
    "             p.cdp_id, p.first_name, p.last_name, ik.key_value AS email\n"
    "      FROM campaign.campaign_audience a\n"
    "      JOIN campaign.campaigns c ON c.id = a.campaign_id AND c.organization_id = {org_id}\n"
    "      JOIN cdp.customer_profile p ON p.organization_id = {org_id}\n"
    "       AND regexp_replace(p.cdp_id, '^.*-', '') = a.contact_id::text\n"
    "      LEFT JOIN LATERAL (\n"
    "        SELECT k.key_value FROM cdp.identity_keys k\n"
    "        WHERE k.organization_id = {org_id} AND k.cdp_id = p.cdp_id\n"
    "          AND lower(k.key_type) IN ('email', 'primary_email')\n"
    "        ORDER BY k.verified DESC NULLS LAST, k.created_at DESC LIMIT 1\n"
    "      ) ik ON TRUE\n"
    "      UNION ALL\n"
    "      SELECT c.id, NULL::bigint, c.created_at, c.name, p.cdp_id, p.first_name, p.last_name, ik.key_value\n"
    "      FROM campaign.campaigns c\n"
    "      CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(c.launch_plan->'audience_cdp_ids', '[]'::jsonb)) AS x(cdp_id)\n"
    "      JOIN cdp.customer_profile p ON p.organization_id = {org_id} AND p.cdp_id = x.cdp_id\n"
    "      LEFT JOIN LATERAL (\n"
    "        SELECT k.key_value FROM cdp.identity_keys k\n"
    "        WHERE k.organization_id = {org_id} AND k.cdp_id = p.cdp_id\n"
    "          AND lower(k.key_type) IN ('email', 'primary_email')\n"
    "        ORDER BY k.verified DESC NULLS LAST, k.created_at DESC LIMIT 1\n"
    "      ) ik ON TRUE\n"
    "      WHERE c.organization_id = {org_id}\n"
    "        AND regexp_replace(x.cdp_id, '^.*-', '') !~ '^[0-9]+$'",
    [
        col("campaign_id", "bigint", "Parent campaign.", True),
        col("contact_id", "bigint", "Campaign bigint when the CDP tail is numeric.", True, ["contact"]),
        col("created_at", "timestamp", "When frozen."),
        col("campaign_name", "text", "Campaign display name.", True, ["campaign"]),
        col("cdp_id", "text", "CDP text person id."),
        col("first_name", "text", "Given name from CDP.", False, ["name"]),
        col("last_name", "text", "Family name from CDP."),
        col("email", "text", "Latest verified email identity.", False, ["email"]),
    ],
)

views["agent_sessions"] = view(
    "agent_sessions",
    "one create-campaign or module chat draft",
    "Drafts are always owned by created_by_user_id, including admins.",
    "      SELECT id, organization_id, branch_id, created_by_user_id, module, stage, created_at, updated_at\n"
    "      FROM campaign.campaign_agent_sessions WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Session id."),
        col("organization_id", "bigint", "Tenant."),
        col("branch_id", "bigint", "Workspace."),
        col("created_by_user_id", "bigint", "Owner of the draft."),
        col("module", "text", "SPA module id.", True),
        col("stage", "text", "intake/drafting/idle.", True, ["stage", "status"]),
        col("created_at", "timestamp", "Started."),
        col("updated_at", "timestamp", "Last write."),
    ],
)

views["audience_refs"] = view(
    "audience_refs",
    "one draft-session contact id before save",
    "Becomes campaign_audience at freeze.",
    "      SELECT session_id, contact_id\n"
    "      FROM campaign.campaign_audience_refs r\n"
    "      JOIN campaign.campaign_agent_sessions s ON s.id = r.session_id AND s.organization_id = {org_id}",
    [
        col("session_id", "bigint", "Draft session."),
        col("contact_id", "bigint", "Campaign bigint."),
    ],
)

views["session_temp_contacts"] = view(
    "session_temp_contacts",
    "one sheet-uploaded person on a draft",
    "Not CDP until promote. Not the launched audience.",
    "      SELECT id, session_id, organization_id, first_name, last_name, email, phone, company_name, city, created_at\n"
    "      FROM campaign.campaign_session_temp_contacts WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Sheet row id."),
        col("session_id", "bigint", "Draft."),
        col("organization_id", "bigint", "Tenant."),
        col("first_name", "text", "Given name."),
        col("last_name", "text", "Family name."),
        col("email", "text", "Sheet email."),
        col("phone", "text", "Sheet phone."),
        col("company_name", "text", "Sheet company.", True),
        col("city", "text", "Sheet city.", True),
        col("created_at", "timestamp", "Ingested."),
    ],
)

views["channel_templates"] = view(
    "channel_templates",
    "one session creative",
    "Structured fields JSON for a channel in a draft.",
    "      SELECT id, session_id, organization_id, branch_id, channel, launch_at, generation_batch_id, created_at, updated_at\n"
    "      FROM campaign.campaign_channel_templates WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Template id."),
        col("session_id", "bigint", "Draft."),
        col("organization_id", "bigint", "Tenant."),
        col("branch_id", "bigint", "Workspace."),
        col("channel", "text", "Channel this creative is for.", True),
        col("launch_at", "text", "Suggested launch string."),
        col("generation_batch_id", "bigint", "AI generate batch."),
        col("created_at", "timestamp", "Inserted."),
        col("updated_at", "timestamp", "Updated."),
    ],
)

views["template_messages"] = view(
    "template_messages",
    "one edit-space message on a template",
    "Chat/edit messages hanging off a session template.",
    "      SELECT id, template_id, t.organization_id AS organization_id, role, seq, kind, created_at\n"
    "      FROM campaign.campaign_template_messages m\n"
    "      JOIN campaign.campaign_channel_templates t ON t.id = m.template_id AND t.organization_id = {org_id}",
    [
        col("id", "bigint", "Message id."),
        col("template_id", "bigint", "Parent template."),
        col("organization_id", "bigint", "Tenant."),
        col("role", "text", "Speaker: user, assistant, or system.", True, ["speaker"]),
        col("seq", "integer", "Turn order within the template."),
        col("kind", "text", "text chat vs template payload update.", True),
        col("created_at", "timestamp", "Created."),
    ],
)

views["channel_sending_profiles"] = view(
    "channel_sending_profiles",
    "one channel setup row for the org/branch",
    "Can this workspace send on a channel yet. Admin configuration.",
    "      SELECT id, organization_id, branch_id, channel, status::text AS status, created_at, updated_at\n"
    "      FROM campaign.channel_sending_profiles WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Profile id."),
        col("organization_id", "bigint", "Tenant."),
        col("branch_id", "bigint", "Workspace."),
        col("channel", "text", "Channel.", True),
        col("status", "text", "not_started/in_progress/ready/blocked.", True, ["readiness"]),
        col("created_at", "timestamp", "Created."),
        col("updated_at", "timestamp", "Updated."),
    ],
)

views["organization_api_keys"] = view(
    "organization_api_keys",
    "one API key metadata row (secret stripped)",
    "Integration health listing only. No certified KPI. Never select secret material.",
    "      SELECT id, organization_id, purpose, key_prefix, active, last_used_at, created_at\n"
    "      FROM campaign.organization_api_keys WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Key id."),
        col("organization_id", "bigint", "Tenant."),
        col("purpose", "text", "Integration purpose, usually app_push.", True),
        col("key_prefix", "text", "Visible prefix only. Never the hash or secret."),
        col("active", "boolean", "Whether the key is active.", True),
        col("last_used_at", "timestamp", "Last use."),
        col("created_at", "timestamp", "Created."),
    ],
)

views["push_channel_settings"] = view(
    "push_channel_settings",
    "one org push settings row",
    "App push configuration readiness.",
    "      SELECT id, organization_id, channel, status, created_at, updated_at\n"
    "      FROM campaign.push_channel_settings WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Row id."),
        col("organization_id", "bigint", "Tenant."),
        col("channel", "text", "web_push or app_push.", True, ["push product"]),
        col("status", "text", "Setup status.", True),
        col("created_at", "timestamp", "Created."),
        col("updated_at", "timestamp", "Updated."),
    ],
)

views["email_org_profiles"] = view(
    "email_org_profiles",
    "one org email legal/profile row",
    "Sender org profile, not recipient opens.",
    "      SELECT id, organization_id, legal_name, city, country, created_at, updated_at\n"
    "      FROM campaign.email_org_profiles WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Row id."),
        col("organization_id", "bigint", "Tenant."),
        col("legal_name", "text", "Legal sender name in email footers."),
        col("city", "text", "Legal address city, not a recipient city.", True),
        col("country", "text", "Legal address country.", True),
        col("created_at", "timestamp", "Created."),
        col("updated_at", "timestamp", "Updated."),
    ],
)

views["email_senders"] = view(
    "email_senders",
    "one from-address",
    "ESP sender identity. Admin config.",
    "      SELECT id, organization_id, email, status, is_active, created_at, updated_at\n"
    "      FROM campaign.email_senders WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Sender id."),
        col("organization_id", "bigint", "Tenant."),
        col("email", "text", "From address."),
        col("status", "text", "Sender status.", True),
        col("is_active", "boolean", "Usable from-address.", True),
        col("created_at", "timestamp", "Created."),
        col("updated_at", "timestamp", "Updated."),
    ],
)

views["email_domains"] = view(
    "email_domains",
    "one sending domain",
    "SPF/DKIM/DMARC flags for admin health.",
    "      SELECT id, organization_id, domain, status, spf_ok, dkim_ok, dmarc_ok, created_at, updated_at\n"
    "      FROM campaign.email_domains WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Domain row."),
        col("organization_id", "bigint", "Tenant."),
        col("domain", "text", "Sending domain.", True),
        col("status", "text", "Domain status.", True),
        col("spf_ok", "boolean", "SPF ready.", True),
        col("dkim_ok", "boolean", "DKIM ready.", True),
        col("dmarc_ok", "boolean", "DMARC ready.", True),
        col("created_at", "timestamp", "Created."),
        col("updated_at", "timestamp", "Updated."),
    ],
)

views["email_return_paths"] = view(
    "email_return_paths",
    "one bounce return-path",
    "Return-path status for domain auth.",
    "      SELECT id, organization_id, status, created_at, updated_at\n"
    "      FROM campaign.email_return_paths WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Row id."),
        col("organization_id", "bigint", "Tenant."),
        col("status", "text", "Return-path status.", True),
        col("created_at", "timestamp", "Created."),
        col("updated_at", "timestamp", "Updated."),
    ],
)

views["email_sending_caps"] = view(
    "email_sending_caps",
    "one org email cap/health row",
    "Hourly/daily caps, warmup, health_status JSON.",
    "      SELECT id, organization_id, hourly_cap, daily_cap, warmup_stage, health_status, created_at, updated_at\n"
    "      FROM campaign.email_sending_caps WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Row id."),
        col("organization_id", "bigint", "Tenant."),
        col("hourly_cap", "integer", "Hourly cap."),
        col("daily_cap", "integer", "Daily cap."),
        col("warmup_stage", "text", "Warmup ladder.", True),
        col("health_status", "text", "Auto-pause health.", True),
        col("created_at", "timestamp", "Created."),
        col("updated_at", "timestamp", "Updated."),
    ],
)

views["email_suppressions"] = view(
    "email_suppressions",
    "one do-not-email address",
    "Unsubscribe/hard bounce/complaint list. Not Dashboard Failed.",
    "      SELECT id, organization_id, email, reason, created_at\n"
    "      FROM campaign.email_suppressions WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Row id."),
        col("organization_id", "bigint", "Tenant."),
        col("email", "text", "Suppressed address."),
        col("reason", "text", "unsubscribe/hard_bounce/complaint.", True, ["reason"]),
        col("created_at", "timestamp", "When added."),
    ],
)

views["send_batches"] = view(
    "send_batches",
    "one timed channel send slice",
    "Workers pick queued batches. Channel for all KPI group-bys lives here.",
    "      SELECT b.id, b.organization_id, b.campaign_id, b.seq, b.scheduled_for, b.status, b.size,\n"
    "             b.created_at, b.updated_at, b.channel, c.name AS campaign_name, c.launch_local_date,\n"
    "             c.created_by_user_id, c.branch_id, c.status AS campaign_status\n"
    "      FROM campaign.campaign_send_batches b\n"
    "      JOIN campaign.campaigns c ON c.id = b.campaign_id AND c.organization_id = {org_id}\n"
    "      WHERE b.organization_id = {org_id}",
    [
        col("id", "bigint", "Batch id."),
        col("organization_id", "bigint", "Tenant."),
        col("campaign_id", "bigint", "Parent campaign.", True),
        col("seq", "integer", "Slice number."),
        col("scheduled_for", "timestamp", "UTC send-eligible time."),
        col("status", "text", "queued/sending/sent/failed/cancelled.", True, ["batch status"]),
        col("size", "integer", "Planned recipient count."),
        col("created_at", "timestamp", "Inserted."),
        col("updated_at", "timestamp", "Last worker change."),
        col("channel", "text", "Agent-canonical channel.", True, ["channel"]),
        col("campaign_name", "text", "Campaign display name.", True, ["campaign"]),
        col("launch_local_date", "text", "Campaign launch date.", True, ["day"]),
        col("created_by_user_id", "bigint", "Campaign creator."),
        col("branch_id", "bigint", "Workspace."),
        col("campaign_status", "text", "Campaign lifecycle.", True, ["status", "stage"]),
    ],
)

OUTCOME = (
    "CASE WHEN lower(coalesce(r.status,'')) IN ('failed','cancelled') THEN 'failed' "
    "WHEN lower(coalesce(r.status,'')) = 'skipped' THEN 'skipped' "
    "WHEN lower(coalesce(r.status,'')) IN ('stub','stub_sent') THEN 'stub' "
    "WHEN lower(coalesce(r.provider_message_id,'')) LIKE 'stub-%' OR lower(coalesce(r.provider_message_id,'')) LIKE 'stub://%' THEN 'stub' "
    "WHEN lower(coalesce(r.status,'')) IN ('bounced','hard_bounce','soft_bounce') THEN 'bounce' "
    "WHEN lower(coalesce(r.skip_fail_reason,'')) LIKE '%bounce%' THEN 'bounce' "
    "WHEN lower(coalesce(r.status,'')) IN ('sent','delivered') THEN 'sent' "
    "ELSE 'pending' END"
)

views["send_recipients"] = view(
    "send_recipients",
    "one intended delivery (messaging fact table)",
    "Sent/failed/open/click/bounce/A/B facts. outcome is the shared delivery mapping. Do not join CDP.",
    "      SELECT r.id, r.organization_id, r.batch_id, r.campaign_id, r.contact_id, r.email, r.status,\n"
    "             r.skip_fail_reason, r.provider_message_id, r.created_at, r.updated_at, r.attempt_count,\n"
    "             r.destination, r.platform, r.ab_variant, r.opened_at, r.clicked_at, r.open_count, r.click_count,\n"
    f"             ({OUTCOME}) AS outcome,\n"
    "             b.channel, c.name AS campaign_name, c.launch_local_date, c.created_by_user_id, c.branch_id,\n"
    "             c.status::text AS campaign_status,\n"
    f"             (({OUTCOME}) = 'sent' AND ({OUTCOME}) <> 'bounce' AND ({OUTCOME}) <> 'stub') AS is_delivered,\n"
    f"             (({OUTCOME}) = 'stub') AS is_stub\n"
    "      FROM campaign.campaign_send_recipients r\n"
    "      JOIN campaign.campaign_send_batches b ON b.id = r.batch_id\n"
    "      JOIN campaign.campaigns c ON c.id = r.campaign_id AND c.organization_id = {org_id}\n"
    "      WHERE r.organization_id = {org_id}",
    [
        col("id", "bigint", "Recipient row."),
        col("organization_id", "bigint", "Tenant."),
        col("batch_id", "bigint", "Parent batch."),
        col("campaign_id", "bigint", "Campaign.", True),
        col("contact_id", "bigint", "Campaign bigint person.", True, ["contact"]),
        col("email", "text", "Address for email sends."),
        col("status", "text", "Raw provider/lifecycle status.", True),
        col("skip_fail_reason", "text", "Skip/fail/bounce text."),
        col("provider_message_id", "text", "Provider id; stub- means demo."),
        col("created_at", "timestamp", "Queued time."),
        col("updated_at", "timestamp", "Last status/open/click write."),
        col("attempt_count", "integer", "Send attempts."),
        col("destination", "text", "Push destination."),
        col("platform", "text", "ios/android/web.", True, ["platform"]),
        col("ab_variant", "text", "a/b/holdout/winner.", True, ["variant", "a/b"]),
        col("opened_at", "timestamp", "First unique open."),
        col("clicked_at", "timestamp", "First unique click."),
        col("open_count", "integer", "Repeat opens."),
        col("click_count", "integer", "Repeat clicks."),
        col("outcome", "text", "sent/failed/skipped/stub/pending/bounce.", True, ["outcome", "result", "status"]),
        col("channel", "text", "Batch channel.", True, ["channel"]),
        col("campaign_name", "text", "Campaign name.", True, ["campaign"]),
        col("launch_local_date", "text", "Launch date for Dashboard period.", True, ["day"]),
        col("created_by_user_id", "bigint", "Campaign creator."),
        col("branch_id", "bigint", "Workspace."),
        col("campaign_status", "text", "Campaign lifecycle.", True, ["stage"]),
        col("is_delivered", "boolean", "Sent, not bounce, not stub. Rate denominator.", True),
        col("is_stub", "boolean", "Demo delivery.", True),
    ],
)

views["push_endpoints"] = view(
    "push_endpoints",
    "one device or browser subscription",
    "Inventory of reachable push/web endpoints. auth_keys stripped.",
    "      SELECT id, organization_id, contact_id, channel, platform, label, active, created_at, updated_at\n"
    "      FROM campaign.push_endpoints WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Endpoint id."),
        col("organization_id", "bigint", "Tenant."),
        col("contact_id", "bigint", "Optional person.", True),
        col("channel", "text", "push or web.", True),
        col("platform", "text", "OS/browser.", True),
        col("label", "text", "Operator label."),
        col("active", "boolean", "Eligible to send.", True),
        col("created_at", "timestamp", "Created."),
        col("updated_at", "timestamp", "Updated."),
    ],
)

views["website_contacts"] = view(
    "website_contacts",
    "one site visitor / web-push person",
    "Anonymous or matched website people. Not CDP join.",
    "      SELECT id, organization_id, contact_id, subscribed, visit_count, first_seen_at, last_seen_at, created_at\n"
    "      FROM campaign.website_contacts WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Visitor row."),
        col("organization_id", "bigint", "Tenant."),
        col("contact_id", "bigint", "Matched Campaign person or null.", True),
        col("subscribed", "boolean", "Web-push opt-in.", True),
        col("visit_count", "integer", "Visit total."),
        col("first_seen_at", "timestamp", "First seen."),
        col("last_seen_at", "timestamp", "Last seen."),
        col("created_at", "timestamp", "Created."),
    ],
)

views["contact_engagement"] = view(
    "contact_engagement",
    "one org+contact email engagement rollup",
    "Lifetime email open/click and unsubscribe. Not Dashboard unique open rate.",
    "      SELECT id, organization_id, contact_id, email_unsubscribed, email_unsubscribed_at,\n"
    "             email_unsubscribe_reason, last_email_opened_at, last_email_clicked_at,\n"
    "             email_open_count, email_click_count, created_at, updated_at\n"
    "      FROM campaign.campaign_contact_engagement WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Row id."),
        col("organization_id", "bigint", "Tenant."),
        col("contact_id", "bigint", "Campaign person.", True, ["contact"]),
        col("email_unsubscribed", "boolean", "Org-level email opt-out.", True, ["unsub"]),
        col("email_unsubscribed_at", "timestamp", "When they unsubscribed."),
        col("email_unsubscribe_reason", "text", "Optional reason."),
        col("last_email_opened_at", "timestamp", "Most recent open."),
        col("last_email_clicked_at", "timestamp", "Most recent click."),
        col("email_open_count", "integer", "Lifetime opens."),
        col("email_click_count", "integer", "Lifetime clicks."),
        col("created_at", "timestamp", "Created."),
        col("updated_at", "timestamp", "Updated."),
    ],
)

views["regulated_templates"] = view(
    "regulated_templates",
    "one SMS DLT or WhatsApp Meta template",
    "Approval ops. channel_config_id is not exposed.",
    "      SELECT id, organization_id, channel, name, external_id, language, category, status::text AS status,\n"
    "             rejected_reason, submitted_at, last_status_checked_at, created_by_user_id, created_at, updated_at,\n"
    "             campaign_name, goal, objective, source_campaign_id\n"
    "      FROM campaign.regulated_channel_templates WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Template id."),
        col("organization_id", "bigint", "Tenant."),
        col("channel", "text", "sms or whatsapp.", True),
        col("name", "text", "Internal name."),
        col("external_id", "text", "DLT or Meta name."),
        col("language", "text", "Language.", True),
        col("category", "text", "Provider category.", True),
        col("status", "text", "draft/pending/approved/rejected/paused/disabled.", True, ["approval", "stage"]),
        col("rejected_reason", "text", "Provider rejection."),
        col("submitted_at", "timestamp", "Submitted."),
        col("last_status_checked_at", "timestamp", "Last poll."),
        col("created_by_user_id", "bigint", "Creator."),
        col("created_at", "timestamp", "Created."),
        col("updated_at", "timestamp", "Updated."),
        col("campaign_name", "text", "Copied campaign name."),
        col("goal", "text", "Copied goal."),
        col("objective", "text", "Copied objective."),
        col("source_campaign_id", "bigint", "Source campaign."),
    ],
)

views["library_templates"] = view(
    "library_templates",
    "one library catalog card",
    "Template library reuse, not send volume.",
    "      SELECT id, organization_id, source, name, primary_channel, approval_status, used_count,\n"
    "             created_by_user_id, created_at, updated_at\n"
    "      FROM campaign.campaign_library_templates WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Row id."),
        col("organization_id", "bigint", "Tenant."),
        col("source", "text", "system or user.", True),
        col("name", "text", "Card title."),
        col("primary_channel", "text", "Main channel.", True, ["channel"]),
        col("approval_status", "text", "Library gate.", True, ["status"]),
        col("used_count", "integer", "Reuse count not send volume."),
        col("created_by_user_id", "bigint", "Uploader."),
        col("created_at", "timestamp", "Created."),
        col("updated_at", "timestamp", "Updated."),
    ],
)
views["gallery_ideas"] = view(
    "gallery_ideas",
    "one gallery idea card",
    "Creative idea status, not engagement.",
    "      SELECT id, organization_id, idea_key, title, industry, pack_id, status, sort_order, created_at, updated_at FROM campaign.campaign_gallery_ideas WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Row id."),
        col("organization_id", "bigint", "Tenant."),
        col("idea_key", "text", "Stable idea id for regeneration."),
        col("title", "text", "Gallery card title."),
        col("industry", "text", "Industry on the card.", True),
        col("pack_id", "text", "Industry pack used to generate the idea.", True),
        col("status", "text", "active to show; other values hide.", True, ["status"]),
        col("sort_order", "integer", "Card order in the gallery."),
        col("created_at", "timestamp", "Created."),
        col("updated_at", "timestamp", "Updated."),
    ],
)
views["gallery_jobs"] = view(
    "gallery_jobs",
    "one gallery generation job",
    "Job pipeline health.",
    "      SELECT id, organization_id, job_type, status, error_message, started_at, finished_at, created_at, updated_at FROM campaign.campaign_gallery_jobs WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Row id."),
        col("organization_id", "bigint", "Tenant."),
        col("job_type", "text", "Kind of gallery job.", True),
        col("status", "text", "queued, running, done, failed.", True, ["status"]),
        col("error_message", "text", "Failure text when status=failed."),
        col("started_at", "timestamp", "When the worker started."),
        col("finished_at", "timestamp", "When the job finished or failed."),
        col("created_at", "timestamp", "Created."),
        col("updated_at", "timestamp", "Updated."),
    ],
)
views["image_gallery_assets"] = view(
    "image_gallery_assets",
    "one image asset",
    "Image gallery ops.",
    "      SELECT id, organization_id, media_id, short_description, source, channel, status, created_by_user_id, created_at, updated_at FROM campaign.campaign_image_gallery_assets WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Row id."),
        col("organization_id", "bigint", "Tenant."),
        col("media_id", "text", "Stable media handle used in templates."),
        col("short_description", "text", "Alt/summary for the asset."),
        col("source", "text", "ai_generated, uploaded, or imported.", True),
        col("channel", "text", "Intended reuse channel.", True),
        col("status", "text", "active vs archived.", True, ["status"]),
        col("created_by_user_id", "bigint", "Who added the asset."),
        col("created_at", "timestamp", "Created."),
        col("updated_at", "timestamp", "Updated."),
    ],
)

# SELECT * may expose extra columns not in columns list - sql_guard only exposes listed columns. Need real columns.

# Fix library/gallery with real columns from metrics doc - I'll patch after first write if SELECT * fails guard (exposed list is what matters; extra source cols are ok if not in columns).

views["sms_channel_settings"] = view(
    "sms_channel_settings",
    "one org SMS settings row",
    "SMS channel readiness.",
    "      SELECT id, organization_id, status, created_at, updated_at\n"
    "      FROM campaign.sms_channel_settings WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Row id."),
        col("organization_id", "bigint", "Tenant."),
        col("status", "text", "Setup status.", True),
        col("created_at", "timestamp", "Created."),
        col("updated_at", "timestamp", "Updated."),
    ],
)

views["tenant_industry_packs"] = view(
    "tenant_industry_packs",
    "one industry pack overlay",
    "Packaging, not send KPIs.",
    "      SELECT id, organization_id, pack_id, seed_industry_type, created_at, updated_at\n"
    "      FROM campaign.tenant_industry_packs WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Row id."),
        col("organization_id", "bigint", "Tenant."),
        col("pack_id", "text", "generic-b2b or generic-b2c family.", True),
        col("seed_industry_type", "text", "Industry type snapshot at seed time.", True),
        col("created_at", "timestamp", "Created."),
        col("updated_at", "timestamp", "Updated."),
    ],
)

views["recommendations"] = view(
    "recommendations",
    "one campaign recommendation card",
    "Suggested next campaigns, not performance.",
    "      SELECT id, organization_id, branch_id, created_by_user_id, public_id, status, title, created_at, updated_at\n"
    "      FROM campaign.campaign_recommendations WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Row id."),
        col("organization_id", "bigint", "Tenant."),
        col("branch_id", "bigint", "Workspace of the card."),
        col("created_by_user_id", "bigint", "Who created the card."),
        col("public_id", "text", "Frontend rec- id."),
        col("status", "text", "Board state: open, used, dismissed.", True, ["status"]),
        col("title", "text", "Card title."),
        col("created_at", "timestamp", "Created."),
        col("updated_at", "timestamp", "Updated."),
    ],
)

views["app_notifications"] = view(
    "app_notifications",
    "one in-app bell item",
    "Unread backlog. user_id null can be tenant-wide.",
    "      SELECT id, organization_id, user_id, kind, read_at, created_at\n"
    "      FROM campaign.app_notifications WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Notification id."),
        col("organization_id", "bigint", "Tenant."),
        col("user_id", "bigint", "Recipient user or null.", True),
        col("kind", "text", "Notification kind.", True),
        col("read_at", "timestamp", "Read time; null = unread."),
        col("created_at", "timestamp", "Created."),
    ],
)

views["opportunity_events"] = view(
    "opportunity_events",
    "one public form/event",
    "Org-wide for both roles. Opens and submissions.",
    "      SELECT id, organization_id, public_id, status, open_count, submission_count, created_at, updated_at\n"
    "      FROM campaign.campaign_opportunity_events WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Event id."),
        col("organization_id", "bigint", "Tenant."),
        col("public_id", "text", "Public slug id.", True, ["event"]),
        col("status", "text", "draft vs launched.", True, ["status", "stage"]),
        col("open_count", "integer", "Form opens."),
        col("submission_count", "integer", "Replies."),
        col("created_at", "timestamp", "Created."),
        col("updated_at", "timestamp", "Updated."),
    ],
)

views["form_submissions"] = view(
    "form_submissions",
    "one form reply",
    "Org-wide submissions. Join events via event_public_id.",
    "      SELECT id, organization_id, event_public_id, created_at\n"
    "      FROM campaign.campaign_form_submissions WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Submission id."),
        col("organization_id", "bigint", "Tenant."),
        col("event_public_id", "text", "Parent event.", True, ["event"]),
        col("created_at", "timestamp", "Submitted at."),
    ],
)

views["daily_report_emails"] = view(
    "daily_report_emails",
    "one daily KPI email delivery attempt",
    "Whether yesterday's email went out. Not in-app Dashboard scope.",
    "      SELECT id, organization_id, report_date, status, recipient_email, error_message, sent_at, created_at\n"
    "      FROM campaign.daily_report_email_deliveries WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Row id."),
        col("organization_id", "bigint", "Tenant."),
        col("report_date", "date", "Report day.", True),
        col("status", "text", "Send status.", True),
        col("recipient_email", "text", "Recipient."),
        col("error_message", "text", "Error if failed."),
        col("sent_at", "timestamp", "When sent."),
        col("created_at", "timestamp", "Created."),
    ],
)

views["customers"] = view(
    "customers",
    "one CDP person (org directory, not joined to sends)",
    "Audience directory. Soft-delete is custom_fields.campaign_deleted. No FK to contact_id.",
    "      SELECT cdp_id, first_name, last_name, gender, date_of_birth, company, city, region, country, language,\n"
    "             timezone, acquisition_channel, acquisition_date, first_referrer, first_seen_at, last_seen_at,\n"
    "             created_at, updated_at, organization_id, contact_type, primary_product, industry, blocked\n"
    "      FROM cdp.customer_profile\n"
    "      WHERE organization_id = {org_id}\n"
    "        AND coalesce(custom_fields->>'campaign_deleted','') <> 'true'",
    [
        col("cdp_id", "text", "Canonical CDP text id."),
        col("first_name", "text", "Given name."),
        col("last_name", "text", "Family name."),
        col("gender", "text", "Optional gender.", True),
        col("date_of_birth", "date", "Optional DOB."),
        col("company", "text", "Company.", True, ["company"]),
        col("city", "text", "City.", True, ["city"]),
        col("region", "text", "Region.", True),
        col("country", "text", "Country.", True, ["country"]),
        col("language", "text", "Language.", True),
        col("timezone", "text", "Person timezone."),
        col("acquisition_channel", "text", "How they entered CDP.", True, ["acquisition"]),
        col("acquisition_date", "date", "Acquire date."),
        col("first_referrer", "text", "First referrer."),
        col("first_seen_at", "timestamptz", "First activity."),
        col("last_seen_at", "timestamptz", "Last activity."),
        col("created_at", "timestamptz", "Profile created."),
        col("updated_at", "timestamptz", "Last profile change."),
        col("organization_id", "bigint", "Tenant."),
        col("contact_type", "text", "lead/customer/…", True),
        col("primary_product", "text", "Primary product."),
        col("industry", "text", "Industry.", True),
        col("blocked", "boolean", "CDP hard block.", True),
    ],
)

views["identity_keys"] = view(
    "identity_keys",
    "one email or phone identity on a CDP person",
    "Send-address lookup. Org-wide. Not joined automatically to send_recipients.",
    "      SELECT identity_id, cdp_id, key_type, key_value, source_system, confidence_score, verified,\n"
    "             created_at, organization_id\n"
    "      FROM cdp.identity_keys WHERE organization_id = {org_id}",
    [
        col("identity_id", "text", "Identity pk."),
        col("cdp_id", "text", "Parent profile."),
        col("key_type", "text", "email/primary_email/phone/…", True, ["key type"]),
        col("key_value", "text", "Normalized email or phone."),
        col("source_system", "text", "Writer system.", True),
        col("confidence_score", "numeric", "Optional confidence."),
        col("verified", "boolean", "Verified flag.", True, ["verified"]),
        col("created_at", "timestamptz", "Created."),
        col("organization_id", "bigint", "Tenant."),
    ],
)

views["organizations"] = view(
    "organizations",
    "one Accounts tenant",
    "Tenant record Campaign login uses.",
    "      SELECT id, name, created_at, updated_at FROM accounts.organizations WHERE id = {org_id}",
    [
        col("id", "bigint", "Tenant id."),
        col("name", "text", "Tenant name."),
        col("created_at", "timestamp", "Created."),
        col("updated_at", "timestamp", "Updated."),
    ],
)

views["setup_users"] = view(
    "setup_users",
    "one Accounts user in the tenant",
    "created_by_user_id points here. Safe columns only.",
    "      SELECT id, organization_id, email, name, status, created_at\n"
    "      FROM accounts.setup_users WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "User id."),
        col("organization_id", "bigint", "Tenant."),
        col("email", "text", "Login email."),
        col("name", "text", "Display name."),
        col("status", "text", "active/…", True),
        col("created_at", "timestamp", "Created."),
    ],
)

views["setup_roles"] = view(
    "setup_roles",
    "one Accounts role",
    "Campaign only cares if name is admin.",
    "      SELECT id, organization_id, name FROM accounts.setup_roles WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Role id."),
        col("organization_id", "bigint", "Tenant."),
        col("name", "text", "Role name.", True),
    ],
)

views["setup_user_product_access"] = view(
    "setup_user_product_access",
    "one user-product-role grant",
    "Campaign access is product_id=campaign.",
    "      SELECT id, user_id, product_id, role_id FROM accounts.setup_user_product_access u\n"
    "      JOIN accounts.setup_users s ON s.id = u.user_id AND s.organization_id = {org_id}",
    [
        col("id", "bigint", "Grant id."),
        col("user_id", "bigint", "User."),
        col("product_id", "text", "Product."),
        col("role_id", "bigint", "Role."),
    ],
)

views["setup_channel_configs"] = view(
    "setup_channel_configs",
    "one Accounts channel config",
    "Mailbox/channel setup. Admin.",
    "      SELECT id, organization_id, channel_type, name, status, created_at, updated_at\n"
    "      FROM accounts.setup_channel_configs WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Config id. Internal; do not treat as a send KPI."),
        col("organization_id", "bigint", "Tenant."),
        col("channel_type", "text", "Channel type.", True),
        col("name", "text", "Connection display name."),
        col("status", "text", "Connection state, not recipient status.", True),
        col("created_at", "timestamp", "Created."),
        col("updated_at", "timestamp", "Updated."),
    ],
)

views["setup_email_configs"] = view(
    "setup_email_configs",
    "one mailbox SMTP/OAuth config (secrets stripped)",
    "Test-send mailbox, not bulk ESP. Org is on setup_channel_configs.",
    "      SELECT e.id, c.organization_id, e.provider_type, e.sender_email, e.sender_name, e.domain,\n"
    "             e.domain_verification_status, e.created_at, e.updated_at\n"
    "      FROM accounts.setup_email_configs e\n"
    "      JOIN accounts.setup_channel_configs c ON c.id = e.channel_config_id\n"
    "      WHERE c.organization_id = {org_id}",
    [
        col("id", "bigint", "Row id."),
        col("organization_id", "bigint", "Tenant from parent channel config."),
        col("provider_type", "text", "Mailbox provider class.", True),
        col("sender_email", "text", "Connected-inbox From, not bulk ESP."),
        col("sender_name", "text", "Mailbox display name."),
        col("domain", "text", "Accounts mailbox domain."),
        col("domain_verification_status", "text", "Whether Accounts considers the domain verified.", True),
        col("created_at", "timestamp", "Created."),
        col("updated_at", "timestamp", "Updated."),
    ],
)

views["mail_oauth_connections"] = view(
    "mail_oauth_connections",
    "one mailbox OAuth connection (tokens stripped)",
    "needs_reauth and expiry only. Org is via email config → channel config.",
    "      SELECT o.id, c.organization_id, o.needs_reauth, o.expires_at, o.created_at, o.updated_at\n"
    "      FROM accounts.mail_oauth_connections o\n"
    "      JOIN accounts.setup_email_configs e ON e.oauth_connection_id = o.id\n"
    "      JOIN accounts.setup_channel_configs c ON c.id = e.channel_config_id\n"
    "      WHERE c.organization_id = {org_id}",
    [
        col("id", "bigint", "Row id."),
        col("organization_id", "bigint", "Tenant from parent channel config."),
        col("needs_reauth", "boolean", "Must reconnect.", True),
        col("expires_at", "timestamp", "Token expiry."),
        col("created_at", "timestamp", "Created."),
        col("updated_at", "timestamp", "Updated."),
    ],
)

views["a2a_spoke_clients"] = view(
    "a2a_spoke_clients",
    "one A2A client metadata (tokens stripped)",
    "Catalog only. No certified a2a_health KPI.",
    "      SELECT id, organization_id, a2a_server_name, client_id, access_expires_at, refresh_expires_at, skill_version, created_at, updated_at\n"
    "      FROM accounts.a2a_spoke_clients WHERE organization_id = {org_id}",
    [
        col("id", "bigint", "Client id."),
        col("organization_id", "bigint", "Tenant."),
        col("a2a_server_name", "text", "Spoke name."),
        col("client_id", "text", "Public A2A client id. No secrets."),
        col("access_expires_at", "timestamp", "When the access token expires."),
        col("refresh_expires_at", "timestamp", "When the refresh token expires."),
        col("skill_version", "text", "Optional skill catalog version."),
        col("created_at", "timestamp", "Created."),
        col("updated_at", "timestamp", "Updated."),
    ],
)

views["auth_sessions"] = view(
    "auth_sessions",
    "one login session for campaign product (secrets stripped)",
    "Ops count of sessions. No tokens.",
    "      SELECT id, organization_id, user_id, product_id, created_at, expires_at\n"
    "      FROM accounts.auth_sessions WHERE organization_id = {org_id} AND product_id = 'campaign'",
    [
        col("id", "bigint", "Session id."),
        col("organization_id", "bigint", "Tenant."),
        col("user_id", "bigint", "User."),
        col("product_id", "text", "Product."),
        col("created_at", "timestamp", "Created."),
        col("expires_at", "timestamp", "Expiry."),
    ],
)

schema_text = (
    "version: 1\n"
    "# Virtual reporting views. LLM writes rpt.<name> only.\n"
    "# grain and user_phrases exist so executors group by meaning, not physical names.\n\n"
    "views:\n\n"
    + "\n".join(views.values())
)
(ROOT / "schema.yml").write_text(schema_text)
print("wrote schema.yml", len(views), "views")
