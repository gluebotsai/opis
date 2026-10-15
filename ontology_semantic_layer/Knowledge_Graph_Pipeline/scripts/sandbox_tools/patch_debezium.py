import json

with open("docker/connectors/postgres-source.json", "r") as f:
    config = json.load(f)

current_list = config["config"]["table.include.list"].split(",")

new_tables = [
    "cdp.source_systems",
    "cdp.identity_links",
    "cdp.customer_events",
    "cdp.customer_sessions",
    "cdp.customer_interactions",
    "cdp.journey_states",
    "cdp.customer_journey",
    "cdp.gold_customer_metrics",
    "cdp.customer_metrics",
    "cdp.gold_campaign_lookup",
    "cdp.persona_definitions",
    "cdp.customer_persona_assignments",
    "cdp.persona_snapshots",
    "cdp.episodic_memory",
    "cdp.semantic_memory",
    "cdp.procedural_memory",
    "cdp.activation_tasks",
    "cdp.anomaly_rules",
    "cdp.anomaly_alerts",
    "cdp.anomaly_threshold_state",
    "cdp.agentic_model"
]

for t in new_tables:
    if t not in current_list:
        current_list.append(t)

# Keep it alphabetically sorted for neatness
current_list.sort()

config["config"]["table.include.list"] = ",".join(current_list)

with open("docker/connectors/postgres-source.json", "w") as f:
    json.dump(config, f, indent=2)

