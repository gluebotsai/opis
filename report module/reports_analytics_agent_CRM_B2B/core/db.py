# origin: ticketing_v2/core/db.py
import os
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()

def get_db_connection():
    """Establishes connection to the PostgreSQL analytical database."""
    conn = psycopg2.connect(
        dbname=os.getenv("PG_DATABASE", "worktual_bigint"),
        user=os.getenv("PG_USER", "nlp"),
        password=os.getenv("PG_PASSWORD", "nLpTeam@561"),
        host=os.getenv("PG_HOST", "10.180.0.126"),
        port=os.getenv("PG_PORT", "5432"),
        cursor_factory=RealDictCursor,
        connect_timeout=10
    )
    conn.set_session(readonly=True, autocommit=True)
    return conn
