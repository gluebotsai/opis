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
cur.execute("SELECT pubname FROM pg_publication;")
pubs = cur.fetchall()
print("Publications:", pubs)
for pub in pubs:
    pubname = pub[0]
    cur.execute(f"SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname = %s", (pubname,))
    tables = cur.fetchall()
    print(f"Publication {pubname} has {len(tables)} tables.")
    if ('cdp', 'customer_events') in tables:
        print(f"  --> FOUND cdp.customer_events in {pubname}")
    else:
        print(f"  --> MISSING cdp.customer_events in {pubname}")
