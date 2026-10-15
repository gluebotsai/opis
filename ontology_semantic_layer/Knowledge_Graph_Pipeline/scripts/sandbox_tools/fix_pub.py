import sys
from main import _load
import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--config', default='config')
parser.add_argument('--env-file', default='.env')
args = parser.parse_args([])
loader = _load(args)
pg = loader.section('postgres')
import psycopg2
conn = psycopg2.connect(
    host=pg["host"], port=pg["port"],
    user=pg["user"], password=pg["password"],
    dbname=pg["database"]
)
conn.autocommit = True
cur = conn.cursor()

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
    try:
        cur.execute(f"ALTER PUBLICATION dbz_publication ADD TABLE {t};")
        print(f"Added {t} to dbz_publication")
    except Exception as e:
        print(f"Skipped {t}: {e}")

