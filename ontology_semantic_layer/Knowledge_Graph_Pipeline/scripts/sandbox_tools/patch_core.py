with open("config/mappings/core.yaml", "r") as f:
    c = f.read()

c = c.replace(
    """    # ETL: synthesize id = "{organization_id}:{model_name}"
    properties: [id, organization_id, products, model_name, job_id, model_id,""",
    """    synthesize_key: "{organization_id}:{model_name}"
    properties: [id, organization_id, products, model_name, job_id, model_id,"""
)

c = c.replace(
    """    # ETL: synthesize id = "{organization_id}:{cdp_id}:{journey_name}"
    properties: [id, cdp_id, organization_id, journey_name, current_stage, entered_at, updated_at]""",
    """    synthesize_key: "{organization_id}:{cdp_id}:{journey_name}"
    properties: [id, cdp_id, organization_id, journey_name, current_stage, entered_at, updated_at]"""
)

c = c.replace(
    """    # ETL: synthesize id = "{cdp_id}:{metric_date}"
    properties: [id, metric_date, cdp_id, organization_id, session_count,""",
    """    synthesize_key: "{cdp_id}:{metric_date}"
    properties: [id, metric_date, cdp_id, organization_id, session_count,"""
)

c = c.replace(
    """    # ETL: synthesize id = "{organization_id}:{metric_key}"
    properties: [id, organization_id, metric_key, metric_label, metric_value, updated_at]""",
    """    synthesize_key: "{organization_id}:{metric_key}"
    properties: [id, organization_id, metric_key, metric_label, metric_value, updated_at]"""
)

c = c.replace(
    """    # ETL: synthesize id = "{organization_id}:{rule_id}"
    properties: [id, organization_id, rule_id, dynamic_threshold, method,""",
    """    synthesize_key: "{organization_id}:{rule_id}"
    properties: [id, organization_id, rule_id, dynamic_threshold, method,"""
)

# Fix ccass.channel_automation_policies NUMERIC issue
c = c.replace(
    """live_agent_enabled, automation_mode, confidence_threshold,""",
    """live_agent_enabled, automation_mode, {name: confidence_threshold, type: decimal, scale: 2},"""
)

# Fix ccass.conversation_memory JSON array issue
c = c.replace(
    """  ccass.conversation_memory:
    mode: node
    label: ConversationSummary
    key: id
    custom_field: extracted_facts
    custom_dynamic: true
    properties: [id, organization_id, conversation_id, rolling_summary,
                 latest_summarized_message_id, model_name, token_estimate,
                 version, updated_at]""",
    """  ccass.conversation_memory:
    mode: node
    label: ConversationSummary
    key: id
    properties: [id, organization_id, conversation_id, rolling_summary,
                 latest_summarized_message_id, model_name, token_estimate,
                 version, updated_at, extracted_facts]"""
)

with open("config/mappings/core.yaml", "w") as f:
    f.write(c)

