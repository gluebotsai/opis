import yaml
import os
from dotenv import load_dotenv
load_dotenv()

with open("config/connections.yaml") as f:
    sys_cfg = yaml.safe_load(f)

db_cfg = sys_cfg["postgres"]
db_cfg = {k: os.path.expandvars(v) for k, v in db_cfg.items()}

import psycopg2
conn = psycopg2.connect(
    host=db_cfg["host"], port=db_cfg["port"],
    user=db_cfg["user"], password=db_cfg["password"],
    dbname=db_cfg["dbname"]
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
