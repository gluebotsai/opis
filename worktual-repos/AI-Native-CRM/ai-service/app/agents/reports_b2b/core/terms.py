"""Apply one registry term onto a certified KPI. Does not read the question."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from app.agents.reports_b2b.core.loader import PRODUCT_DIR

_BARE_TIME = frozenset(
    {"", "all time", "all_time", "all-time", "recent", "none", "null", "overall"}
)

LEAD_KPI_IDS = frozenset(
    {
        "lead_count",
        "lead_status_mix",
        "unassigned_leads",
        "lead_source_conversion",
    }
)

LEAD_OWN_SCOPE = (
    "src.owner_user_id = {user_id} OR src.created_by_user_id = {user_id}"
)


@lru_cache(maxsize=4)
def _load(product_dir: str) -> dict[str, dict[str, Any]]:
    path = Path(product_dir) / "terms.yml"
    data = yaml.safe_load(path.read_text()) or {}
    terms = data.get("terms") if isinstance(data, dict) else {}
    if not isinstance(terms, dict):
        return {}
    return {str(key): dict(value) for key, value in terms.items() if isinstance(value, dict)}


def load_terms(product_dir: Path = PRODUCT_DIR) -> dict[str, dict[str, Any]]:
    return _load(str(product_dir))


def lead_scope_overrides(role_scope: str, kpi_id: str) -> dict[str, str] | None:
    """Own-scope roles count leads they own or created. Other contact queries stay put."""
    if kpi_id not in LEAD_KPI_IDS or role_scope != "own":
        return None
    return {"contacts": LEAD_OWN_SCOPE}


class TermBind:
    def __init__(self) -> None:
        self.kpi_id: str | None = None
        self.time_window: str | None = None
        self.polarity_sql: str | None = None
        self.status_filter: str | None = None
        self.limit: int | None = None
        self.order_by_sql: str | None = None
        self.answer_note: str | None = None
        self.stop: dict[str, Any] | None = None


def bind_term(
    term_id: str | None,
    *,
    kpi_id: str,
    time_window: str | None,
    aggregation: str,
    status_filter: str | None,
    row_limit: int | None,
    product_dir: Path = PRODUCT_DIR,
) -> TermBind:
    bound = TermBind()
    bound.kpi_id = kpi_id
    bound.time_window = time_window
    bound.status_filter = status_filter
    raw = str(term_id or "").strip().lower()
    if not raw:
        return bound

    spec = load_terms(product_dir).get(raw)
    if spec is None:
        return bound

    slot = str(spec.get("slot") or "none")
    if slot == "ask":
        bound.stop = _ask(str(spec.get("say") or "Which meaning did you want?"))
        return bound
    if slot == "ask_unless":
        allowed = {str(item) for item in (spec.get("kpis") or [])}
        if kpi_id not in allowed:
            bound.stop = _ask(str(spec.get("say") or "Which meaning did you want?"))
            return bound
    if slot == "reject_on":
        blocked = {str(item) for item in (spec.get("kpis") or [])}
        if kpi_id in blocked:
            bound.stop = _ask(str(spec.get("say") or "That metric does not match."))
            return bound
    if slot == "redirect":
        bound.kpi_id = str(spec.get("kpi") or kpi_id)
    if slot == "redirect_from":
        sources = {str(item) for item in (spec.get("from_kpis") or [])}
        if kpi_id in sources:
            bound.kpi_id = str(spec.get("kpi") or kpi_id)
        if spec.get("say"):
            bound.answer_note = str(spec["say"])
    if slot == "time":
        current = str(time_window or "").strip().lower()
        if current in _BARE_TIME:
            bound.time_window = str(spec.get("window") or "last 1 hour")
            bound.answer_note = str(spec.get("say") or "")
    if slot == "limit":
        number = row_limit if row_limit and row_limit > 0 else int(spec.get("limit") or 10)
        if aggregation not in {"ranking", "list"}:
            return bound
        bound.limit = number
        bound.order_by_sql = "\nORDER BY created_at DESC"
        say = str(spec.get("say") or "")
        bound.answer_note = say.replace("{n}", str(number))
    if slot == "polarity":
        only = str(spec.get("only_kpi") or "")
        if bound.kpi_id == only:
            bound.polarity_sql = str(spec.get("sql") or "stage_weight >= 0.75")
    if slot == "status":
        only = str(spec.get("only_kpi") or "")
        if (not only or bound.kpi_id == only) and not status_filter:
            bound.status_filter = str(spec.get("value") or "")
    return bound


def _ask(message: str) -> dict[str, Any]:
    return {
        "status": "error",
        "store": "sql",
        "error_type": "CLARIFY",
        "error": message,
        "rows": [],
    }
