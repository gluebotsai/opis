"""Compatibility shim — prefer `app.agents.create_campaign.tool_functions`."""

from app.agents.create_campaign.tool_functions import (  # noqa: F401
    dispatch_tool,
    handle_confirm_create_templates,
    handle_confirm_launch,
    handle_create_templates,
    handle_filter_contacts,
    handle_get_launch_status,
    handle_open_hub_destination,
    handle_plan_dynamic_fields,
    handle_preview_dynamic_send,
    handle_recommend_audience,
    handle_recommend_send_time,
    handle_regenerate_templates,
    handle_set_campaign_details,
    handle_set_channels,
    handle_set_channels_and_schedule,
    handle_set_email_ab,
    handle_set_launch_plan,
)
