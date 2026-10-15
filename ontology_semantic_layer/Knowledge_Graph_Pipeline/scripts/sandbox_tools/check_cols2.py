import psycopg2
import os

try:
    conn = psycopg2.connect(
        host="10.180.0.126",
        port=5432,
        dbname="worktual_bigint",
        user="debezium",
        password="Debezium@789"
    )
    cur = conn.cursor()
    cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='crm' AND table_name LIKE 'lead_%_jobs'")
    for t in cur.fetchall():
        print(f"\nTable: {t[0]}")
        cur.execute(f"SELECT column_name FROM information_schema.columns WHERE table_schema='crm' AND table_name='{t[0]}'")
        for row in cur.fetchall():
            print("  ", row[0])
except Exception as e:
    print("Error:", e)
