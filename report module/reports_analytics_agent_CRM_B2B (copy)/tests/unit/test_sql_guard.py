import pytest
from reports_analytics_agent_CRM_B2B.core.sql_guard import validate_sql, enforce_sql_guard
from reports_analytics_agent_CRM_B2B.core.errors import GuardRejectionError

def test_valid_select():
    sql = "SELECT id, title, amount FROM rpt.deals WHERE organization_id = :tenant_id;"
    is_valid, reason = validate_sql(sql)
    assert is_valid, f"Expected valid query, got {reason}"

def test_valid_with_cte():
    sql = """
    WITH summary AS (
        SELECT stage, COUNT(*) AS cnt FROM rpt.deals WHERE organization_id = :tenant_id GROUP BY stage
    )
    SELECT * FROM summary;
    """
    is_valid, reason = validate_sql(sql)
    assert is_valid, f"Expected valid query, got {reason}"

def test_reject_insert():
    sql = "INSERT INTO rpt.deals (title) VALUES ('Hacked');"
    is_valid, reason = validate_sql(sql)
    assert not is_valid
    assert "Prohibited SQL keyword" in reason or "Only SELECT" in reason

def test_reject_drop():
    sql = "DROP TABLE crm.deals;"
    is_valid, reason = validate_sql(sql)
    assert not is_valid

def test_reject_multiple_statements():
    sql = "SELECT * FROM rpt.deals; SELECT * FROM rpt.contacts;"
    is_valid, reason = validate_sql(sql)
    assert not is_valid
    assert "Multiple SQL statements" in reason

def test_reject_system_catalog():
    sql = "SELECT * FROM pg_catalog.pg_tables;"
    is_valid, reason = validate_sql(sql)
    assert not is_valid
    assert "Prohibited" in reason or "system catalog" in reason
