import psycopg2
conn = psycopg2.connect("dbname=cdc_pipeline user=vectone password=password host=localhost")
cur = conn.cursor()
cur.execute("SELECT column_name FROM information_schema.columns WHERE table_schema='cdp' AND table_name='agentic_model';")
print([r[0] for r in cur.fetchall()])
