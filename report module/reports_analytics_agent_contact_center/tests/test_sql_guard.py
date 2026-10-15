import pytest
from reports_analytics_agent_contact_center.sql_executor.core.sql_guard import guard_sql, GuardError


def test_guard_sql_admin_basic():
    res = guard_sql(
        "SELECT id, channel, status FROM rpt.conversations LIMIT 10",
        role="admin",
        organization_id=1000,
        user_id=1005,
        queue_ids=[401],
    )
    assert "rpt_conversations" in res.sql
    assert "LIMIT 10" in res.sql


def test_guard_sql_rejects_physical_table():
    with pytest.raises(GuardError):
        guard_sql(
            "SELECT * FROM ccass.conversations",
            role="admin",
            organization_id=1000,
            user_id=1005,
            queue_ids=[],
        )


def test_guard_sql_rejects_drop():
    with pytest.raises(GuardError):
        guard_sql(
            "DROP TABLE ccass.conversations",
            role="admin",
            organization_id=1000,
            user_id=1005,
            queue_ids=[],
        )


def test_guard_sql_rejects_dangerous_function():
    with pytest.raises(GuardError):
        guard_sql(
            "SELECT pg_sleep(5)",
            role="admin",
            organization_id=1000,
            user_id=1005,
            queue_ids=[],
        )
