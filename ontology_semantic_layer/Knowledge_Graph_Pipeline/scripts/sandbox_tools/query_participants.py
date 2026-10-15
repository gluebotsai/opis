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
cur.execute("SELECT column_name FROM information_schema.columns WHERE table_schema='ccass' AND table_name='conversation_participants'")
print([r[0] for r in cur.fetchall()])
