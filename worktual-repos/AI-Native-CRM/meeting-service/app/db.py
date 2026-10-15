from __future__ import annotations

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.config import ensure_dirs, settings

ensure_dirs()

connect_args = {}
if settings.database_url.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    future=True,
    connect_args=connect_args,
)

if settings.database_url.startswith("sqlite"):

    @event.listens_for(engine, "connect")
    def _sqlite_on(dbapi_con, _):
        cur = dbapi_con.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, class_=Session, future=True)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
