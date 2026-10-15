"""One-call Semrush keyword research for Digital Marketing (never LLM-fake volumes)."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from typing import Any

from app.integrations.semrush.client import SemrushMcpClient, SemrushMcpError
from app.integrations.semrush.config import config_from_connection_payload
from app.integrations.semrush.sync import _api_units_message, _execute_report
from app.integrations.semrush_gateway import (
    SemrushGatewayError,
    gateway_country,
    is_semrush_gateway_configured,
    keyword_metrics_idempotency_key,
    semrush_gateway_call,
)

log = logging.getLogger(__name__)


def keyword_cache_key(
    organization_id: str,
    seed: str,
    location: str | None = None,
    language: str | None = None,
) -> str:
    seed_n = re.sub(r"\s+", " ", (seed or "").strip().lower())
    loc = (location or "us").strip().lower() or "us"
    lang = (language or "en").strip().lower() or "en"
    raw = f"{organization_id}|{seed_n}|{loc}|{lang}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def filter_keyword_rows(
    rows: list[dict[str, Any]],
    filters: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    filters = filters or {}
    intent = str(filters.get("intent") or "").strip().lower()
    search = str(filters.get("search") or "").strip().lower()
    min_volume = filters.get("minVolume")
    max_kd = filters.get("maxKd")
    out: list[dict[str, Any]] = []
    for row in rows:
        term = str(row.get("term") or "")
        if intent and str(row.get("intent") or "").lower() != intent:
            continue
        if search and search not in term.lower():
            continue
        volume = row.get("volume") or 0
        kd = row.get("kd") or 0
        if isinstance(min_volume, (int, float)) and volume < min_volume:
            continue
        if isinstance(max_kd, (int, float)) and kd > max_kd:
            continue
        out.append(row)
    return out


def _semrush_mcp_enabled() -> bool:
    raw = (os.environ.get("SEMRUSH_MCP_ENABLED") or "").strip().lower()
    return raw in ("true", "1", "on")


def _num(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        cleaned = value.replace(",", "").replace("%", "").strip()
        if not cleaned:
            return None
        try:
            return float(cleaned)
        except ValueError:
            return None
    return None


def _term(rec: dict[str, Any]) -> str:
    for key in (
        "Ph",
        "phrase",
        "keyword",
        "term",
        "Keyword",
        "Nq",
        "query",
        "name",
    ):
        val = rec.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def _intent(rec: dict[str, Any]) -> str | None:
    for key in ("Intent", "intent", "search_intent", "Keyword Intent"):
        val = rec.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
        if isinstance(val, list) and val:
            first = val[0]
            if isinstance(first, str):
                return first.strip()
            if isinstance(first, dict):
                label = first.get("label") or first.get("type")
                if isinstance(label, str) and label.strip():
                    return label.strip()
    return None


def normalize_keyword_rows(payload: Any) -> list[dict[str, Any]]:
    """Flatten Semrush MCP / report payloads into table rows. No invented metrics."""
    items: list[Any] = []

    def walk(node: Any, depth: int = 0) -> None:
        if depth > 8:
            return
        if isinstance(node, list):
            for item in node:
                walk(item, depth + 1)
            return
        if not isinstance(node, dict):
            return
        term = _term(node)
        if term:
            items.append(node)
            return
        for key in (
            "data",
            "rows",
            "keywords",
            "result",
            "results",
            "related",
            "items",
        ):
            if key in node:
                walk(node[key], depth + 1)

    walk(payload)
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for rec in items:
        if not isinstance(rec, dict):
            continue
        term = _term(rec)
        key = term.lower()
        if not term or key in seen:
            continue
        seen.add(key)
        volume = _num(
            rec.get("Nq")
            or rec.get("search_volume")
            or rec.get("searchVolume")
            or rec.get("volume")
            or rec.get("Sv")
        )
        kd = _num(
            rec.get("Kd")
            or rec.get("keyword_difficulty")
            or rec.get("keywordDifficulty")
            or rec.get("difficulty")
            or rec.get("kd")
        )
        cpc = _num(rec.get("Cp") or rec.get("cpc") or rec.get("CPC"))
        competition = (
            rec.get("Co")
            or rec.get("competition")
            or rec.get("Competition")
            or rec.get("competitive_density")
        )
        opportunity = _num(rec.get("opportunity") or rec.get("Opportunity"))
        if opportunity is None and volume is not None and kd is not None:
            opportunity = round(volume * max(0.0, 1.0 - kd / 100.0))
        rows.append(
            {
                "term": term,
                "intent": _intent(rec),
                "volume": int(volume) if volume is not None else None,
                "kd": round(kd, 1) if kd is not None else None,
                "cpc": round(cpc, 2) if cpc is not None else None,
                "competition": competition,
                "opportunity": int(opportunity) if opportunity is not None else None,
            }
        )
    return rows


def _tag_semrush_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    tagged: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        item["source"] = "semrush"
        tagged.append(item)
    return tagged


def research_keywords_via_gateway(
    *,
    organization_id: str,
    seed: str,
    location: str = "us",
) -> dict[str, Any]:
    """One keyword_metrics call (~20 units / 1 daily hit). Callers must cache."""
    phrase = re.sub(r"\s+", " ", (seed or "").strip())
    if not phrase:
        return {"ok": False, "rows": [], "error": "seed is required", "budgetSkipped": False}
    org = (organization_id or "").strip()
    if not org:
        return {
            "ok": False,
            "rows": [],
            "error": "organizationId is required",
            "budgetSkipped": False,
        }
    if not is_semrush_gateway_configured():
        return {
            "ok": False,
            "rows": [],
            "error": "SEMRUSH_GATEWAY_TOKEN is not configured",
            "budgetSkipped": False,
            "code": "GATEWAY_NOT_CONFIGURED",
        }
    country = gateway_country(location)
    try:
        payload = semrush_gateway_call(
            organization_id=org,
            tool_name="keyword_metrics",
            parameters={"keyword": phrase[:255], "country": country},
            idempotency_key=keyword_metrics_idempotency_key(org, phrase, country),
        )
        rows = _tag_semrush_rows(normalize_keyword_rows(payload))
        if not rows:
            rows = _tag_semrush_rows(normalize_keyword_rows({"data": [payload]}))
        if not rows:
            return {
                "ok": False,
                "rows": [],
                "error": "Semrush returned no keyword payload.",
                "budgetSkipped": False,
            }
        return {
            "ok": True,
            "rows": rows,
            "error": None,
            "budgetSkipped": False,
            "code": None,
        }
    except SemrushGatewayError as exc:
        quota = exc.code in {"DAILY_HIT_LIMIT", "MONTHLY_UNIT_LIMIT"}
        return {
            "ok": False,
            "rows": [],
            "error": f"{exc.code}: {exc}",
            "budgetSkipped": quota,
            "code": exc.code,
            "requestId": exc.request_id,
        }
    except Exception as exc:
        log.exception("Semrush gateway keyword_metrics failed")
        return {"ok": False, "rows": [], "error": str(exc), "budgetSkipped": False}


def research_keywords_live(
    connection: dict[str, Any] | None,
    *,
    seed: str,
    location: str = "us",
    language: str = "en",
    organization_id: str | None = None,
) -> dict[str, Any]:
    """Exactly one Semrush call for this seed. Prefer Worktual gateway. Callers must cache."""
    if is_semrush_gateway_configured() and (organization_id or "").strip():
        return research_keywords_via_gateway(
            organization_id=str(organization_id),
            seed=seed,
            location=location,
        )
    if not _semrush_mcp_enabled():
        return {
            "ok": False,
            "rows": [],
            "error": (
                "Semrush MCP is disconnected. Live Semrush calls are disabled until "
                "SEMRUSH_MCP_ENABLED is on with owner permission."
            ),
            "budgetSkipped": False,
        }
    phrase = re.sub(r"\s+", " ", (seed or "").strip())
    if not phrase:
        return {"ok": False, "rows": [], "error": "seed is required", "budgetSkipped": False}

    try:
        client = SemrushMcpClient(config_from_connection_payload(connection or {}))
        client.initialize()
        params = {
            "phrase": phrase,
            "keyword": phrase,
            "database": location or "us",
            "database_type": location or "us",
            "display_limit": 40,
            "limit": 40,
            "language": language or "en",
        }
        payload: Any = None
        last_error: str | None = None
        try:
            payload = client.call_tool("keyword_research", params)
        except SemrushMcpError as exc:
            last_error = str(exc)
            try:
                payload = _execute_report(
                    client,
                    "phrase_related",
                    params={"phrase": phrase, "database": location or "us"},
                )
                last_error = None
            except Exception as nested:
                last_error = str(nested)
        units = _api_units_message(payload) or (
            _api_units_message(last_error) if last_error else None
        )
        if units:
            return {
                "ok": False,
                "rows": [],
                "error": units,
                "budgetSkipped": True,
            }
        if payload is None:
            return {
                "ok": False,
                "rows": [],
                "error": last_error or "Semrush returned no keyword payload.",
                "budgetSkipped": False,
            }
        rows = _tag_semrush_rows(normalize_keyword_rows(payload))
        return {"ok": True, "rows": rows, "error": None, "budgetSkipped": False, "raw": payload}
    except SemrushMcpError as exc:
        units = _api_units_message(str(exc))
        return {
            "ok": False,
            "rows": [],
            "error": units or str(exc),
            "budgetSkipped": bool(units),
        }
    except Exception as exc:
        log.exception("Semrush keyword research failed")
        return {"ok": False, "rows": [], "error": str(exc), "budgetSkipped": False}


def dump_debug(payload: Any) -> str:
    try:
        return json.dumps(payload)[:400]
    except Exception:
        return str(payload)[:400]
