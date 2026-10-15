import sys, uuid, datetime, json
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

event_id = str(uuid.uuid4())
cdp_id = 'CDP-webchat-org1003-visitor_9a8b3e13-1231-42e3-9eac-a9ff77a57001'
occurred_at = datetime.datetime.now(datetime.UTC).isoformat()
ingested_at = occurred_at

sql = """
INSERT INTO cdp.customer_events (
    event_id, cdp_id, event_name, event_category, source_name, source_event_id, channel,
    occurred_at, ingested_at, status, reference_id, properties_json, raw_payload_json,
    organization_id, custom_fields, tenant_id, idempotency_key
) VALUES (
    %s, %s, %s, %s, %s, %s, %s,
    %s, %s, %s, %s, %s, %s,
    %s, %s, %s, %s
)
"""
params = (
    event_id, cdp_id, 'test.event', 'test', 'test', 'test-123', 'test_channel',
    occurred_at, ingested_at, 'test', 'test-ref', json.dumps({}), json.dumps({}),
    1003, json.dumps({}), 'default', event_id
)

try:
    cur.execute(sql, params)
    print("Inserted dummy event:", event_id)
except Exception as e:
    print("Insert failed:", e)
