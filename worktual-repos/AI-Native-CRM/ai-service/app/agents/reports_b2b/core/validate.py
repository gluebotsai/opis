# origin: ticketing_v2/core/validate.py
import sys
from app.agents.reports_b2b.core.loader import (
    load_schema, load_access, load_kpis, load_enums, load_sql_template
)
from app.agents.reports_b2b.core.templates import (
    dimension_column_idents,
    fill_slots,
    normalize_dimension,
    render_kpi_template,
    template_has_dimension_slots,
    template_rpt_views,
)
from app.agents.reports_b2b.core.sql_guard import validate_sql


def check_kpi_dimensions(kpis, views) -> list:
    """Catalog dims must map to SAFE_DIMENSIONS, live on the template's rpt views, and use slots."""
    from app.agents.reports_b2b.core.run_kpi import REFUSAL_KPIS

    errors = []
    for kpi_id, meta in kpis.items():
        is_refusal = (
            (meta.get("family") == "refusal")
            or (meta.get("aggregation") == "refusal")
            or (kpi_id in REFUSAL_KPIS)
            or (meta.get("status") == "unavailable")
        )
        if is_refusal:
            continue
        dims = [d for d in (meta.get("allowed_dimensions") or []) if d]
        date_col = str(meta.get("default_time_column") or "created_at")
        try:
            raw = load_sql_template(kpi_id)
        except FileNotFoundError as exc:
            errors.append(str(exc))
            continue
        if dims and not template_has_dimension_slots(raw):
            errors.append(
                f"KPI '{kpi_id}' lists allowed_dimensions {dims} but SQL has no "
                "dimension_select / group_by_sql / extra_group_sql slots"
            )
            continue
        view_names = template_rpt_views(raw)
        cols = set()
        for vn in view_names:
            spec = views.get(vn) or {}
            cols.update((spec.get("columns") or {}).keys())
        for dim in dims:
            mapped = normalize_dimension(dim, dims)
            if not mapped:
                errors.append(
                    f"KPI '{kpi_id}' allowed dimension '{dim}' is not in SAFE_DIMENSIONS"
                )
                continue
            needed = dimension_column_idents(mapped, date_col)
            missing = [c for c in needed if c not in cols]
            if missing:
                errors.append(
                    f"KPI '{kpi_id}' dimension '{dim}' needs column(s) {missing} "
                    f"on views {view_names}"
                )
            compiled = fill_slots(raw, dimension=mapped, date_column=date_col)
            is_valid, reason = validate_sql(compiled)
            if not is_valid:
                errors.append(
                    f"KPI '{kpi_id}' dimension '{dim}' failed AST validation: {reason}"
                )
    return errors


def run_validation():
    print("==================================================")
    print(" Validating B2B CRM Reports & Analytics Engine Pack")
    print("==================================================")

    schema = load_schema()
    views = schema.get("views", {})
    print(f"✓ Schema Loaded: {len(views)} virtual views defined.")

    access = load_access()
    roles = access.get("roles", {})
    print(f"✓ Access Matrix Loaded: {len(roles)} RBAC roles defined.")

    enums = load_enums()
    print(f"✓ Enums Loaded: {len(enums)} enum categories defined.")

    kpis = load_kpis()
    print(f"✓ KPI Registry Loaded: {len(kpis)} KPIs registered.")

    available_count = 0
    unavailable_count = 0
    partial_count = 0
    errors = []

    dummy_params = {
        "tenant_id": 42,
        "current_user_id": 101,
        "can_view_all": True,
        "as_of_ts": "2026-09-15 10:30:00",
        "start_date": "2026-09-01 00:00:00",
        "end_date": "2026-09-30 23:59:59"
    }

    from app.agents.reports_b2b.core.run_kpi import REFUSAL_KPIS

    for kpi_id, meta in kpis.items():
        is_refusal = (meta.get("family") == "refusal") or (meta.get("aggregation") == "refusal") or (kpi_id in REFUSAL_KPIS) or (meta.get("status") == "unavailable")
        if not is_refusal:
            available_count += 1
            try:
                rendered_sql = render_kpi_template(kpi_id, dummy_params)
                is_valid, reason = validate_sql(rendered_sql)
                if not is_valid:
                    errors.append(f"KPI '{kpi_id}' failed AST validation: {reason}")
            except Exception as e:
                errors.append(f"KPI '{kpi_id}' template error: {str(e)}")
        else:
            unavailable_count += 1
            refusal_reason = REFUSAL_KPIS.get(kpi_id) or meta.get("missing_input") or meta.get("definition", {}).get("numerator")
            if not refusal_reason:
                errors.append(f"Unavailable KPI '{kpi_id}' is missing refusal message.")

    dim_errors = check_kpi_dimensions(kpis, views)
    errors.extend(dim_errors)
    print(f"  - Available KPIs: {available_count}")
    print(f"  - Partial KPIs: {partial_count}")
    print(f"  - Unavailable KPIs (Refusal Handled): {unavailable_count}")
    print(f"  - Dimension contract checks: {len(dim_errors)} issue(s)")

    if errors:
        print("\n❌ VALIDATION ERRORS FOUND:")
        for err in errors:
            print(f"  - {err}")
        return False
    print("\n✅ ALL ASSETS & SQL TEMPLATES VALIDATED SUCCESSFULLY (100% GREEN)!")
    return True


if __name__ == "__main__":
    success = run_validation()
    sys.exit(0 if success else 1)
