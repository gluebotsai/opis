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
cur = conn.cursor()
cur.execute("SELECT * FROM cdp.customer_events ORDER BY occurred_at DESC LIMIT 1;")
row = cur.fetchone()
cols = [desc[0] for desc in cur.description]
if row:
    print(dict(zip(cols, row)))
else:
    print("Table is empty!")
