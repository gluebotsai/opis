from __future__ import annotations

import os

os.environ["TESTING"] = "true"
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["REDIS_URL"] = ""
os.environ["ENABLE_TEST_UI"] = "false"
os.environ["VEXA_API_KEY"] = ""

import uuid

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.constants import utcnow
from app.db import get_db
from app.main import app
from app.models import Base, Meeting
from app.services.llm import reset_circuit
from app.services.live_bus import _local
from app.services.rate_limit import _hits

SECRET = "test-secret-must-be-at-least-32b"
WEBHOOK = "whsec-test"


@pytest.fixture
def client(monkeypatch):
    settings.testing = True
    settings.crm_service_jwt_secret = SECRET
    settings.webhook_secret = WEBHOOK
    settings.consent_required = True
    settings.notetaker_provider = "vexa"
    settings.live_tips_enabled = False
    settings.max_concurrent_meetings = 10
    settings.max_concurrent_per_org = 10
    settings.max_queued_meetings = 1000
    settings.max_queued_per_org = 100
    settings.vexa_recording_enabled = False
    settings.extract_max_attempts = 1
    settings.crm_completed_webhook_url = ""
    settings.redis_url = ""
    settings.enable_test_ui = False
    settings.crm_bot_base_url = ""
    settings.crm_bot_api_key = ""
    settings.crm_bot_openai_base_url = ""
    settings.crm_bot_openai_api_key = ""
    settings.crm_bot_openai_model = "worktual-gemma"
    settings.google_addon_client_id = ""
    settings.google_addon_cloud_project_number = ""
    settings.crm_users_base_url = ""
    settings.crm_users_api_key = ""
    settings.crm_assist_dummy_org_id = "org-a"
    settings.assist_session_ttl_sec = 3600
    reset_circuit()
    _hits.clear()
    _local.clear()

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    testing_session = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS uq_meetings_inflight_native
                ON meetings (org_id, platform, native_meeting_id)
                WHERE status NOT IN ('completed', 'completed_partial', 'failed')
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS uq_meetings_org_idempotency_nn
                ON meetings (org_id, idempotency_key)
                WHERE idempotency_key IS NOT NULL
                """
            )
        )

    def override_db():
        db = testing_session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_db
    monkeypatch.setattr("app.api.live.SessionLocal", testing_session)
    monkeypatch.setattr("app.services.vexa.create_bot", lambda **kwargs: {"id": "vexa-1"})
    monkeypatch.setattr("app.services.vexa.stop_bot", lambda *a, **k: None)
    monkeypatch.setattr("app.services.vexa.running_keys", lambda: set())
    with TestClient(app) as c:
        c.extra = {"Session": testing_session}
        yield c
    app.dependency_overrides.clear()


def auth_header(org: str = "org-a", scopes: list[str] | None = None) -> dict[str, str]:
    token = jwt.encode(
        {
            "organization_id": org,
            "sub": "user-1",
            "scopes": scopes if scopes is not None else ["meetings:write"],
        },
        SECRET,
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {token}"}


def token_str(org: str = "org-a") -> str:
    return jwt.encode(
        {"organization_id": org, "sub": "user-1", "scopes": ["meetings:write"]},
        SECRET,
        algorithm="HS256",
    )


def insert_meeting(session_factory, **kwargs) -> Meeting:
    db = session_factory()
    defaults = dict(
        id=str(uuid.uuid4()),
        org_id="org-a",
        entity_type="contact",
        entity_id="C-1",
        meeting_url="https://meet.google.com/abc-defg-hij",
        platform="google_meet",
        native_meeting_id="abc-defg-hij",
        bot_name="Worktual Notetaker",
        status="active",
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    defaults.update(kwargs)
    m = Meeting(**defaults)
    db.add(m)
    db.commit()
    db.refresh(m)
    db.expunge(m)
    db.close()
    return m
