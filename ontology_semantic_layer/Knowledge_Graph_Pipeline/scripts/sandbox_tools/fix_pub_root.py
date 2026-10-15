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
try:
    cur.execute("ALTER PUBLICATION dbz_publication SET (publish_via_partition_root = true);")
    print("Successfully set publish_via_partition_root = true")
except Exception as e:
    print("Failed to set publish_via_partition_root:", e)
