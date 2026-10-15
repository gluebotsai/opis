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
tables = [
    "cdp.agentic_model",
    "cdp.journey_states",
    "cdp.customer_metrics",
    "cdp.gold_campaign_lookup",
    "cdp.anomaly_threshold_state"
]
cur = conn.cursor()
for t in tables:
    schema, name = t.split(".")
    cur.execute("SELECT column_name FROM information_schema.columns WHERE table_schema=%s AND table_name=%s", (schema, name))
    cols = [r[0] for r in cur.fetchall()]
    print(f"{t}: {cols}")
