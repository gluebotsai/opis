"""RBAC mirror tests for dashboard-centric analytics nav."""

from __future__ import annotations

from app.mcp.rbac import modules_for_access


def test_reports_nav_marketing_only():
    admin = modules_for_access("b2b", "admin")
    marketing = modules_for_access("b2b", "marketing")
    assert "dashboard" in admin
    assert "reports" not in admin
    assert "reports" in marketing
