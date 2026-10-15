import psycopg2
import os
from dotenv import load_dotenv
load_dotenv()

conn = psycopg2.connect(
    host=os.getenv('PG_HOST'),
    port=os.getenv('PG_PORT'),
    dbname=os.getenv('PG_DATABASE'),
    user=os.getenv('PG_USER'),
    password=os.getenv('PG_PASSWORD')
)
cur = conn.cursor()
cur.execute("""
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'accounts' AND table_name = 'organizations';
""")
for row in cur.fetchall():
    if row[0] == 'id': print(row)
