"""Catalog allowed_dimensions must match template slots and schema columns."""

from app.agents.reports_b2b.core.loader import load_kpis, load_schema
from app.agents.reports_b2b.core.validate import check_kpi_dimensions


def test_kpi_dimensions_match_schema_and_slots():
    kpis = load_kpis()
    views = (load_schema().get("views") or {})
    errors = check_kpi_dimensions(kpis, views)
    assert errors == [], "\n".join(errors)
