#!/usr/bin/env python3
"""Write certified KPI SQL files from kpis.yml ids."""
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parent
SQL = ROOT / "sql"
kpis = yaml.safe_load((ROOT / "kpis.yml").read_text())["kpis"]

RAN = "campaigns.status IN ('live','completed','cancelled')"

def write(name: str, body: str) -> None:
    (SQL / f"{name}.sql").write_text(body.strip() + "\n")

CAMPAIGN_FROM = """
FROM (
{{base_campaign}}
) campaigns
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{ppc_exclude_sql}}
  AND {{filters_sql}}
"""

# Planned channel lives on campaign_channels. Join only when grouping by channel
# ({{channel_join}}). COUNT DISTINCT so multi-channel campaigns are not inflated.
CAMPAIGN_COUNT_FROM = """
FROM (
{{base_campaign}}
) campaigns
{{channel_join}}
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{ppc_exclude_sql}}
  AND {{filters_sql}}
"""

RECIP = """
FROM campaign.campaign_send_recipients r
JOIN campaign.campaign_send_batches b ON b.id = r.batch_id
JOIN (
{{base_campaign}}
) campaigns ON campaigns.id = r.campaign_id
WHERE r.organization_id = {{org_id}}
  AND campaigns.branch_id = {{branch_id}}
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
"""

OUT = """CASE
  WHEN lower(coalesce(r.status,'')) IN ('failed','cancelled') THEN 'failed'
  WHEN lower(coalesce(r.status,'')) = 'skipped' THEN 'skipped'
  WHEN lower(coalesce(r.status,'')) IN ('stub','stub_sent') THEN 'stub'
  WHEN lower(coalesce(r.provider_message_id,'')) LIKE 'stub-%'
    OR lower(coalesce(r.provider_message_id,'')) LIKE 'stub://%' THEN 'stub'
  WHEN lower(coalesce(r.status,'')) IN ('bounced','hard_bounce','soft_bounce') THEN 'bounce'
  WHEN lower(coalesce(r.skip_fail_reason,'')) LIKE '%bounce%' THEN 'bounce'
  WHEN lower(coalesce(r.status,'')) IN ('sent','delivered') THEN 'sent'
  ELSE 'pending'
END"""

DELIV = f"(({OUT}) = 'sent')"

write("campaigns_ran", f"""
SELECT
    {{{{dimension_select}}}}
    COUNT(DISTINCT campaigns.id)::bigint AS campaigns_ran
{CAMPAIGN_COUNT_FROM}
  AND {RAN}
{{{{group_by_sql}}}}
{{{{limit_sql}}}}
""")

write("campaigns_total", f"""
SELECT
    {{{{dimension_select}}}}
    COUNT(DISTINCT campaigns.id)::bigint AS campaigns_total
{CAMPAIGN_COUNT_FROM}
{{{{group_by_sql}}}}
{{{{limit_sql}}}}
""")

write("campaigns_sent", f"""
SELECT
    {{{{dimension_select}}}}
    COUNT(DISTINCT campaigns.id)::bigint AS campaigns_sent
{CAMPAIGN_COUNT_FROM}
  AND {RAN}
  AND EXISTS (
    SELECT 1 FROM campaign.campaign_send_recipients r
    JOIN campaign.campaign_send_batches b ON b.id = r.batch_id
    WHERE r.campaign_id = campaigns.id AND r.organization_id = {{{{org_id}}}}
      AND {DELIV}
  )
{{{{group_by_sql}}}}
{{{{limit_sql}}}}
""")

write("campaigns_failed", f"""
SELECT
    {{{{dimension_select}}}}
    COUNT(DISTINCT campaigns.id)::bigint AS campaigns_failed
{CAMPAIGN_COUNT_FROM}
  AND {RAN}
  AND EXISTS (
    SELECT 1 FROM campaign.campaign_send_recipients r
    WHERE r.campaign_id = campaigns.id AND r.organization_id = {{{{org_id}}}}
      AND {OUT} = 'failed'
  )
{{{{group_by_sql}}}}
{{{{limit_sql}}}}
""")

write("email_open_rate", f"""
SELECT
    {{{{dimension_select}}}}
    CASE WHEN COUNT(*) FILTER (WHERE {DELIV} AND b.channel = 'email') = 0 THEN NULL
    ELSE LEAST(1.0, COUNT(*) FILTER (WHERE {DELIV} AND b.channel = 'email' AND r.opened_at IS NOT NULL)::numeric
         / COUNT(*) FILTER (WHERE {DELIV} AND b.channel = 'email')) END AS email_open_rate
{RECIP}
{{{{group_by_sql}}}}
{{{{limit_sql}}}}
""")

write("click_rate", f"""
SELECT
    {{{{dimension_select}}}}
    CASE WHEN COUNT(*) FILTER (WHERE {DELIV} AND b.channel IN ('email','push','web')) = 0 THEN NULL
    ELSE LEAST(1.0, COUNT(*) FILTER (WHERE {DELIV} AND b.channel IN ('email','push','web') AND r.clicked_at IS NOT NULL)::numeric
         / COUNT(*) FILTER (WHERE {DELIV} AND b.channel IN ('email','push','web'))) END AS click_rate
{RECIP}
{{{{group_by_sql}}}}
{{{{limit_sql}}}}
""")

write("delivered_by_channel", f"""
SELECT
    {{{{dimension_select}}}}
    COUNT(*) FILTER (WHERE {DELIV})::bigint AS messages_delivered
{RECIP}
  AND {DELIV}
{{{{group_by_sql}}}}
{{{{limit_sql}}}}
""")

write("delivery_trend", f"""
SELECT
    {{{{dimension_select}}}}
    COUNT(*) FILTER (WHERE {DELIV})::bigint AS messages_delivered,
    COUNT(*) FILTER (WHERE {DELIV} AND b.channel = 'email' AND r.opened_at IS NOT NULL)::bigint AS unique_opens,
    COUNT(*) FILTER (WHERE {DELIV} AND b.channel IN ('email','push','web') AND r.clicked_at IS NOT NULL)::bigint AS unique_clicks
{RECIP}
{{{{group_by_sql}}}}
{{{{limit_sql}}}}
""")

write("monitor_preview", f"""
SELECT
    {{{{dimension_select}}}}
    campaigns.name AS campaign_name,
    campaigns.audience_count AS targeted,
    COUNT(*) FILTER (WHERE {DELIV})::bigint AS delivered,
    COUNT(*) FILTER (WHERE {DELIV} AND r.opened_at IS NOT NULL)::bigint AS opened,
    COUNT(*) FILTER (WHERE {DELIV} AND r.clicked_at IS NOT NULL)::bigint AS clicked
{RECIP}
  AND {RAN}
{{{{group_by_sql}}}}
{{{{limit_sql}}}}
""")

# monitor_preview group by needs campaigns.name always - if dimension_select empty still select name.
# If group_by empty this returns one mixed row - fix template to always group by campaign id when no dim.

write("monitor_preview", f"""
SELECT
    {{{{dimension_select}}}}
    campaigns.id AS campaign_id,
    MAX(campaigns.name) AS campaign_name,
    MAX(campaigns.audience_count) AS targeted,
    COUNT(*) FILTER (WHERE {DELIV})::bigint AS delivered,
    COUNT(*) FILTER (WHERE {DELIV} AND r.opened_at IS NOT NULL)::bigint AS opened,
    COUNT(*) FILTER (WHERE {DELIV} AND r.clicked_at IS NOT NULL)::bigint AS clicked
{RECIP}
  AND campaigns.status IN ('live','completed','cancelled')
GROUP BY campaigns.id{{{{group_by_tail}}}}
{{{{limit_sql}}}}
""")

def volume(name, pred):
    write(name, f"""
SELECT
    {{{{dimension_select}}}}
    COUNT(*)::bigint AS {name}
{RECIP}
  AND {pred}
{{{{group_by_sql}}}}
{{{{limit_sql}}}}
""")

volume("messages_sent", f"{OUT} = 'sent'")
volume("messages_failed", f"{OUT} = 'failed'")
volume("messages_bounced", f"{OUT} = 'bounce'")
volume("messages_delivered", DELIV)
volume("stub_sends", f"{OUT} = 'stub'")
volume("pending_recipients", f"{OUT} = 'pending'")
volume("unique_opens", f"{DELIV} AND b.channel = 'email' AND r.opened_at IS NOT NULL")
volume("unique_clicks", f"{DELIV} AND b.channel IN ('email','push','web') AND r.clicked_at IS NOT NULL")
volume("contacts_never_opened", f"{DELIV} AND b.channel = 'email' AND r.opened_at IS NULL")

write("total_opens", f"""
SELECT
    {{{{dimension_select}}}}
    COALESCE(SUM(r.open_count),0)::bigint AS total_opens
{RECIP}
{{{{group_by_sql}}}}
{{{{limit_sql}}}}
""")

write("total_clicks", f"""
SELECT
    {{{{dimension_select}}}}
    COALESCE(SUM(r.click_count),0)::bigint AS total_clicks
{RECIP}
{{{{group_by_sql}}}}
{{{{limit_sql}}}}
""")

write("ctor", f"""
SELECT
    {{{{dimension_select}}}}
    CASE WHEN COUNT(*) FILTER (WHERE {DELIV} AND b.channel = 'email' AND r.opened_at IS NOT NULL) = 0 THEN NULL
    ELSE LEAST(1.0, COUNT(*) FILTER (WHERE {DELIV} AND b.channel = 'email' AND r.clicked_at IS NOT NULL)::numeric
         / COUNT(*) FILTER (WHERE {DELIV} AND b.channel = 'email' AND r.opened_at IS NOT NULL)) END AS ctor
{RECIP}
  AND b.channel = 'email'
{{{{group_by_sql}}}}
{{{{limit_sql}}}}
""")

write("ab_variant_performance", f"""
SELECT
    {{{{dimension_select}}}}
    r.ab_variant,
    CASE WHEN COUNT(*) FILTER (WHERE {DELIV}) = 0 THEN NULL
    ELSE COUNT(*) FILTER (WHERE {DELIV} AND r.opened_at IS NOT NULL)::numeric / COUNT(*) FILTER (WHERE {DELIV}) END AS open_rate,
    CASE WHEN COUNT(*) FILTER (WHERE {DELIV}) = 0 THEN NULL
    ELSE COUNT(*) FILTER (WHERE {DELIV} AND r.clicked_at IS NOT NULL)::numeric / COUNT(*) FILTER (WHERE {DELIV}) END AS click_rate
{RECIP}
  AND b.channel = 'email'
GROUP BY r.ab_variant{{{{group_by_tail}}}}
{{{{limit_sql}}}}
""")

write("audience_selected", f"""
SELECT
    {{{{dimension_select}}}}
    COALESCE(SUM(campaigns.audience_count),0)::bigint AS audience_selected
{CAMPAIGN_FROM}
{{{{group_by_sql}}}}
{{{{limit_sql}}}}
""")

write("audience_missed", f"""
SELECT
    {{{{dimension_select}}}}
    COUNT(*)::bigint AS audience_missed
FROM campaign.campaign_audience a
JOIN (
{{{{base_campaign}}}}
) campaigns ON campaigns.id = a.campaign_id
WHERE {{{{scope_sql}}}}
  AND {{{{time_sql}}}}
  AND NOT EXISTS (
    SELECT 1 FROM campaign.campaign_send_recipients r
    WHERE r.campaign_id = a.campaign_id AND r.contact_id = a.contact_id
      AND r.organization_id = {{{{org_id}}}}
      AND {OUT} = 'sent'
  )
{{{{group_by_sql}}}}
{{{{limit_sql}}}}
""")

write("event_opens", """
SELECT
    {{dimension_select}}
    COALESCE(SUM(open_count),0)::bigint AS event_opens
FROM campaign.campaign_opportunity_events
WHERE organization_id = {{org_id}}
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
""")

write("event_submissions", """
SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS event_submissions
FROM campaign.campaign_form_submissions
WHERE organization_id = {{org_id}}
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
""")

write("event_conversion", """
SELECT
    {{dimension_select}}
    CASE WHEN COALESCE(SUM(open_count),0) = 0 THEN NULL
    ELSE SUM(submission_count)::numeric / SUM(open_count) END AS event_conversion
FROM campaign.campaign_opportunity_events
WHERE organization_id = {{org_id}}
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
""")

ppc_num = {
    "ppc_impressions": "impressions",
    "ppc_clicks": "clicks",
    "ppc_spend": "spend",
    "ppc_conversions": "conversions",
}
for kid, key in ppc_num.items():
    write(kid, f"""
SELECT
    {{{{dimension_select}}}}
    COALESCE(SUM(NULLIF(launch_plan#>>'{{channel_run,{key}}}','')::numeric),0) AS {kid}
{CAMPAIGN_FROM}
{{{{group_by_sql}}}}
{{{{limit_sql}}}}
""")

write("ppc_ctr", """
SELECT
    {{dimension_select}}
    CASE WHEN COALESCE(SUM(NULLIF(launch_plan#>>'{channel_run,impressions}','')::numeric),0) = 0 THEN NULL
    ELSE SUM(NULLIF(launch_plan#>>'{channel_run,clicks}','')::numeric)
         / SUM(NULLIF(launch_plan#>>'{channel_run,impressions}','')::numeric) END AS ppc_ctr
""" + CAMPAIGN_FROM + """
{{group_by_sql}}
{{limit_sql}}
""")

write("ppc_cpc", """
SELECT
    {{dimension_select}}
    CASE WHEN COALESCE(SUM(NULLIF(launch_plan#>>'{channel_run,clicks}','')::numeric),0) = 0 THEN NULL
    ELSE SUM(NULLIF(launch_plan#>>'{channel_run,spend}','')::numeric)
         / SUM(NULLIF(launch_plan#>>'{channel_run,clicks}','')::numeric) END AS ppc_cpc
""" + CAMPAIGN_FROM + """
{{group_by_sql}}
{{limit_sql}}
""")

write("ppc_cpa", """
SELECT
    {{dimension_select}}
    CASE WHEN COALESCE(SUM(NULLIF(launch_plan#>>'{channel_run,conversions}','')::numeric),0) = 0 THEN NULL
    ELSE SUM(NULLIF(launch_plan#>>'{channel_run,spend}','')::numeric)
         / SUM(NULLIF(launch_plan#>>'{channel_run,conversions}','')::numeric) END AS ppc_cpa
""" + CAMPAIGN_FROM + """
{{group_by_sql}}
{{limit_sql}}
""")

write("cdp_contact_count", """
SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS cdp_contact_count
FROM cdp.customer_profile
WHERE organization_id = {{org_id}}
  AND coalesce(custom_fields->>'campaign_deleted','') <> 'true'
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
""")

write("cdp_contacts_blocked", """
SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS cdp_contacts_blocked
FROM cdp.customer_profile
WHERE organization_id = {{org_id}}
  AND blocked = true
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
""")

write("contact_unsubscribed", """
SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS contact_unsubscribed
FROM campaign.campaign_contact_engagement
WHERE organization_id = {{org_id}}
  AND email_unsubscribed = true
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
""")

write("unsubscribes", """
SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS unsubscribes
FROM campaign.campaign_contact_engagement
WHERE organization_id = {{org_id}}
  AND email_unsubscribed = true
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
""")

write("contact_lifetime_opens", """
SELECT
    {{dimension_select}}
    COALESCE(SUM(email_open_count),0)::bigint AS contact_lifetime_opens
FROM campaign.campaign_contact_engagement
WHERE organization_id = {{org_id}}
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
""")

write("contact_lifetime_clicks", """
SELECT
    {{dimension_select}}
    COALESCE(SUM(email_click_count),0)::bigint AS contact_lifetime_clicks
FROM campaign.campaign_contact_engagement
WHERE organization_id = {{org_id}}
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
""")

write("contact_delivery_rates", f"""
SELECT
    {{{{dimension_select}}}}
    r.contact_id,
    COUNT(*) FILTER (WHERE {DELIV})::bigint AS delivered,
    CASE WHEN COUNT(*) FILTER (WHERE {DELIV} AND b.channel = 'email') = 0 THEN NULL
    ELSE COUNT(*) FILTER (WHERE {DELIV} AND b.channel = 'email' AND r.opened_at IS NOT NULL)::numeric
         / COUNT(*) FILTER (WHERE {DELIV} AND b.channel = 'email') END AS open_rate,
    CASE WHEN COUNT(*) FILTER (WHERE {DELIV} AND b.channel IN ('email','push','web')) = 0 THEN NULL
    ELSE COUNT(*) FILTER (WHERE {DELIV} AND b.channel IN ('email','push','web') AND r.clicked_at IS NOT NULL)::numeric
         / COUNT(*) FILTER (WHERE {DELIV} AND b.channel IN ('email','push','web')) END AS click_rate
{RECIP}
GROUP BY r.contact_id{{{{group_by_tail}}}}
{{{{limit_sql}}}}
""")

write("contact_campaigns_received", f"""
SELECT
    {{{{dimension_select}}}}
    r.contact_id,
    COUNT(DISTINCT r.campaign_id)::bigint AS contact_campaigns_received
{RECIP}
  AND {OUT} = 'sent'
GROUP BY r.contact_id{{{{group_by_tail}}}}
{{{{limit_sql}}}}
""")

write("contacts_engaged", f"""
SELECT
    {{{{dimension_select}}}}
    COUNT(DISTINCT r.contact_id)::bigint AS contacts_engaged
{RECIP}
  AND (r.opened_at IS NOT NULL OR r.clicked_at IS NOT NULL)
{{{{group_by_sql}}}}
{{{{limit_sql}}}}
""")

write("contact_push_reachability", """
SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS contact_push_reachability
FROM campaign.push_endpoints
WHERE organization_id = {{org_id}}
  AND active = true
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
""")

write("website_visitor_count", """
SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS website_visitor_count
FROM campaign.website_contacts
WHERE organization_id = {{org_id}}
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
""")

write("web_push_subscribers", """
SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS web_push_subscribers
FROM campaign.website_contacts
WHERE organization_id = {{org_id}}
  AND subscribed = true
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
""")

write("identity_keys_count", """
SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS identity_keys_count
FROM cdp.identity_keys
WHERE organization_id = {{org_id}}
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
""")

write("bounce_rate", f"""
SELECT
    {{{{dimension_select}}}}
    CASE WHEN (COUNT(*) FILTER (WHERE {DELIV} AND b.channel = 'email')
         + COUNT(*) FILTER (WHERE {OUT} = 'bounce' AND b.channel = 'email')) = 0 THEN NULL
    ELSE COUNT(*) FILTER (WHERE {OUT} = 'bounce' AND b.channel = 'email')::numeric
         / (COUNT(*) FILTER (WHERE {DELIV} AND b.channel = 'email')
            + COUNT(*) FILTER (WHERE {OUT} = 'bounce' AND b.channel = 'email')) END AS bounce_rate
{RECIP}
  AND b.channel = 'email'
{{{{group_by_sql}}}}
{{{{limit_sql}}}}
""")

write("suppressions", """
SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS suppressions
FROM campaign.email_suppressions
WHERE organization_id = {{org_id}}
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
""")

write("email_cap_health", """
SELECT
    {{dimension_select}}
    hourly_cap,
    daily_cap,
    warmup_stage,
    health_status
FROM campaign.email_sending_caps
WHERE organization_id = {{org_id}}
{{limit_sql}}
""")

write("domain_auth", """
SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS domain_count,
    COUNT(*) FILTER (WHERE spf_ok AND dkim_ok AND dmarc_ok)::bigint AS fully_authenticated
FROM campaign.email_domains
WHERE organization_id = {{org_id}}
{{group_by_sql}}
{{limit_sql}}
""")

write("channel_readiness", """
SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS channel_readiness
FROM campaign.channel_sending_profiles
WHERE organization_id = {{org_id}}
{{group_by_sql}}
{{limit_sql}}
""")

write("mailbox_send_ready", """
SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS mailbox_rows,
    COUNT(*) FILTER (WHERE o.needs_reauth IS TRUE)::bigint AS needs_reauth
FROM accounts.setup_channel_configs c
JOIN accounts.setup_email_configs e ON e.channel_config_id = c.id
LEFT JOIN accounts.mail_oauth_connections o ON o.id = e.oauth_connection_id
WHERE c.organization_id = {{org_id}}
{{group_by_sql}}
{{limit_sql}}
""")

write("regulated_template_status", """
SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS regulated_template_status
FROM campaign.regulated_channel_templates
WHERE organization_id = {{org_id}}
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
""")

write("push_endpoint_inventory", """
SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS push_endpoint_inventory
FROM campaign.push_endpoints
WHERE organization_id = {{org_id}}
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
""")

write("gallery_ops", """
SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS gallery_ops
FROM campaign.campaign_gallery_jobs
WHERE organization_id = {{org_id}}
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
""")

write("library_ops", """
SELECT
    {{dimension_select}}
    COALESCE(SUM(used_count),0)::bigint AS library_ops
FROM campaign.campaign_library_templates
WHERE organization_id = {{org_id}}
{{group_by_sql}}
{{limit_sql}}
""")

write("daily_report_email_log", """
SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS daily_report_email_log
FROM campaign.daily_report_email_deliveries
WHERE organization_id = {{org_id}}
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
""")

write("notifications_unread", """
SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS notifications_unread
FROM campaign.app_notifications
WHERE organization_id = {{org_id}}
  AND read_at IS NULL
  AND (user_id IS NULL OR user_id = {{user_id}})
{{group_by_sql}}
{{limit_sql}}
""")

write("live_send_pressure", """
SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS live_send_pressure
FROM campaign.campaign_send_batches b
JOIN (
{{base_campaign}}
) campaigns ON campaigns.id = b.campaign_id
WHERE b.organization_id = {{org_id}}
  AND {{scope_sql}}
  AND b.status IN ('queued','sending')
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
""")

write("entitlement_health", """
SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS entitlement_health
FROM campaign.organization_products
WHERE organization_id = {{org_id}}
  AND branch_id = {{branch_id}}
  AND product_code = 'campaign'
{{group_by_sql}}
{{limit_sql}}
""")

missing = set(kpis) - {p.stem for p in SQL.glob("*.sql") if not p.stem.startswith("_")}
extra = {p.stem for p in SQL.glob("*.sql") if not p.stem.startswith("_")} - set(kpis)
print("wrote sql", len(kpis), "missing", sorted(missing), "extra", sorted(extra))
