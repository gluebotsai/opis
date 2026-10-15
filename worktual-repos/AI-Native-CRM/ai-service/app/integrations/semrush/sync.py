"""Semrush MCP sync — list projects via execute_report, then cache toolkit reports."""

from __future__ import annotations

import json
import logging
import re
from typing import Any
from urllib.parse import urlparse

from app.integrations.semrush.client import SemrushMcpClient, SemrushMcpError
from app.integrations.semrush.config import SemrushConfig, config_from_connection_payload

log = logging.getLogger(__name__)

DEFAULT_MARKET = "in"

_API_UNITS_MARKERS = (
    "does not have enough api units",
    "additional api units are required",
    "semrush.com/mcp-access",
)


def _api_units_message(payload: Any) -> str | None:
    """Return a user-facing message when Semrush reports insufficient MCP API units."""
    text = ""
    if isinstance(payload, str):
        text = payload
    elif isinstance(payload, dict):
        for key in ("data", "message", "error", "text"):
            val = payload.get(key)
            if isinstance(val, str) and val.strip():
                text = val
                break
        if not text:
            text = json.dumps(payload)
    else:
        text = str(payload or "")
    lower = text.lower()
    if any(m in lower for m in _API_UNITS_MARKERS):
        return (
            "Semrush MCP needs more API units to refresh SEO data. "
            "Visit https://www.semrush.com/mcp-access to top up, then try again."
        )
    return None


# Live Semrush ingest/list only — never used for query-path analysis.
_INGEST_TOOLS = ("projects",)

# Allowed analysis snapshots (query path + cache writes). No other Semrush tools.
_ANALYSIS_TOOLS = (
    "keyword_research",
    "organic_research",
    "competitors_research",
    "position_tracking",
    "audience_research",
    "site_audit",
    "backlinks_research",
    "traffic_overview",
    "paid_search_research",
    "domain_overview",
)

_TOOLKIT_TOOLS = _INGEST_TOOLS + _ANALYSIS_TOOLS
_TOOLKIT_ALLOWED = {x.lower() for x in _TOOLKIT_TOOLS}

# Persist only the first Semrush project; cap each report to the top 5 rows.
_FIRST_PROJECT_ONLY = True
_TOP_N = 5

# Prefer these reports when syncing per project / domain.
_PREFERRED_REPORTS: dict[str, tuple[str, ...]] = {
    "projects": ("list_projects", "get_project"),
    "domain_overview": ("overview", "domain_overview", "domains_overview"),
    "competitors_research": ("competitors", "organic_competitors", "competitors_organic"),
    "keyword_research": ("phrase_related", "related", "keyword_overview", "overview"),
    "organic_research": ("organic", "organic_positions", "positions"),
    "backlinks_research": ("backlinks", "backlinks_overview", "overview"),
    "site_audit": ("campaigns", "list", "overview"),
    "position_tracking": ("campaigns", "overview"),
    "traffic_overview": ("overview",),
    "audience_research": ("overview",),
    "paid_search_research": ("overview", "paid"),
}

# TLD → Semrush database code (best-effort when project has no market).
_TLD_MARKET: dict[str, str] = {
    "in": "in",
    "ae": "ae",
    "uk": "uk",
    "co.uk": "uk",
    "us": "us",
    "com": "us",
    "au": "au",
    "ca": "ca",
    "de": "de",
    "fr": "fr",
    "sg": "sg",
}


def _normalize_domain(raw: str | None) -> str | None:
    if not raw or not str(raw).strip():
        return None
    text = str(raw).strip().lower()
    if "://" in text:
        host = urlparse(text).hostname
        return host.lstrip("www.") if host else None
    text = re.sub(r"^www\.", "", text)
    text = text.split("/")[0].split("?")[0]
    return text or None


def _market_from_domain(domain: str | None) -> str | None:
    if not domain:
        return None
    host = domain.lower().lstrip("www.")
    for tld, market in sorted(_TLD_MARKET.items(), key=lambda x: -len(x[0])):
        if host.endswith("." + tld) or host == tld:
            return market
    return None


def _as_list(payload: Any) -> list[Any]:
    if payload is None:
        return []
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in (
            "projects",
            "data",
            "items",
            "results",
            "rows",
            "result",
            "records",
        ):
            val = payload.get(key)
            if isinstance(val, list):
                return val
            if isinstance(val, dict):
                nested = _as_list(val)
                if nested and nested != [val]:
                    return nested
    return [payload]


def _report_names(payload: Any) -> list[str]:
    names: list[str] = []
    if not isinstance(payload, dict):
        return names
    reports = payload.get("reports")
    if isinstance(reports, list):
        for item in reports:
            if isinstance(item, dict) and item.get("name"):
                names.append(str(item["name"]))
            elif isinstance(item, str):
                names.append(item)
    return names


def _pick_report(tool_name: str, available: list[str]) -> str | None:
    preferred = _PREFERRED_REPORTS.get(tool_name.lower(), ())
    lower_map = {a.lower(): a for a in available}
    for pref in preferred:
        if pref.lower() in lower_map:
            return lower_map[pref.lower()]
    return available[0] if available else None


def _extract_projects(payload: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in _as_list(payload):
        if not isinstance(item, dict):
            continue
        # Skip report-catalog shapes
        if "reports" in item and "usage" in item:
            continue
        external_id = str(
            item.get("id")
            or item.get("project_id")
            or item.get("projectId")
            or item.get("uuid")
            or ""
        ).strip()
        domain = _normalize_domain(
            item.get("domain_unicode")
            or item.get("domain_ascii")
            or item.get("domain")
            or item.get("url")
            or item.get("website")
            or item.get("target")
            or item.get("host")
            or item.get("project_domain")
        )
        market = (
            item.get("database")
            or item.get("db")
            or item.get("market")
            or item.get("locale")
            or item.get("country")
            or _market_from_domain(domain)
        )
        market_s = str(market).strip().lower() if market else None
        if not external_id and domain:
            external_id = domain
        if not external_id:
            continue
        out.append(
            {
                "externalProjectId": external_id,
                "domain": domain,
                "market": market_s or None,
                "raw": item,
            }
        )
    return out


def _schema_param_names(schema: Any) -> set[str]:
    if not isinstance(schema, dict):
        return set()
    params = schema.get("parameters") or schema.get("params") or {}
    if not isinstance(params, dict):
        return set()
    return {str(k) for k in params.keys()}


def _build_report_params(
    schema: Any,
    *,
    market: str,
    domain: str,
    project_id: str,
) -> dict[str, Any]:
    """Fill execute_report params from schema + project context."""
    names = _schema_param_names(schema)
    params: dict[str, Any] = {}

    pid_val: Any = project_id
    if project_id and project_id.isdigit():
        pid_val = int(project_id)

    def take(key: str, value: Any) -> None:
        if value is None or value == "":
            return
        if names and key not in names:
            return
        params[key] = value

    # Domain / target family
    if domain:
        take("target", domain)
        take("domain", domain)
        take("url", f"https://{domain}")
        stem = domain.split(".")[0]
        take("phrase", stem)
        take("targets", [domain])

    if market:
        take("database", market)
        take("db", market)

    if project_id and not str(project_id).startswith("adhoc:"):
        take("project_id", pid_val)
        take("projectId", pid_val)
        take("id", pid_val)

    take("target_type", "root_domain")
    take("target_types", ["root_domain"])
    take("limit", _TOP_N)
    take("display_limit", _TOP_N)
    take("displayLimit", _TOP_N)
    take("count", _TOP_N)
    take("page_size", _TOP_N)
    take("pageSize", _TOP_N)
    take("top", _TOP_N)
    take("offset", 0)

    # No schema: send a sensible default bag so execute_report can accept what it needs.
    if not names:
        if domain:
            params.setdefault("target", domain)
            params.setdefault("domain", domain)
            params.setdefault("url", f"https://{domain}")
            params.setdefault("phrase", domain.split(".")[0])
            params.setdefault("targets", [domain])
        if market:
            params.setdefault("database", market)
            params.setdefault("db", market)
        if project_id and not str(project_id).startswith("adhoc:"):
            params.setdefault("project_id", pid_val)
            params.setdefault("projectId", pid_val)
            params.setdefault("id", pid_val)
        params.setdefault("target_type", "root_domain")
        params.setdefault("target_types", ["root_domain"])
        params.setdefault("limit", _TOP_N)
        params.setdefault("offset", 0)

    return params


def _limit_top_n(value: Any, n: int = _TOP_N) -> Any:
    """Keep only the first n items of every list (keywords, competitors, etc.)."""
    skip_keys = {"reports", "catalog", "schema", "parameters", "params"}
    if isinstance(value, list):
        return [_limit_top_n(item, n) for item in value[:n]]
    if isinstance(value, dict):
        return {
            k: (v if k in skip_keys else _limit_top_n(v, n))
            for k, v in value.items()
        }
    return value


def _execute_report(
    client: SemrushMcpClient,
    report: str,
    *,
    params: dict[str, Any] | None = None,
) -> Any:
    """
    Semrush MCP expects: execute_report(report=..., params={...}).
    Some builds accept `parameters` or flat keys; try several shapes.
    """
    params = params or {}
    shapes: list[dict[str, Any]] = [
        {"report": report, "params": params},
        {"report": report, "params": json.dumps(params)},
        {"report": report, "parameters": params},
        {"report": report, **params},
    ]
    last_err: Exception | None = None
    for args in shapes:
        try:
            return client.call_tool("execute_report", args)
        except SemrushMcpError as exc:
            last_err = exc
            msg = str(exc).lower()
            # unknown report → no point trying other nests
            if "unknown report" in msg:
                break
            continue
    if last_err:
        raise last_err
    return None


def _sync_toolkit(
    client: SemrushMcpClient,
    tool_name: str,
    *,
    project: dict[str, Any] | None = None,
) -> tuple[Any | None, str | None]:
    """Return (payload, error) for one toolkit tool."""
    try:
        catalog = client.call_tool(tool_name, {})
    except Exception as exc:
        return None, str(exc)

    reports = _report_names(catalog)
    if not reports:
        # Tool returned data directly
        return catalog, None

    report = _pick_report(tool_name, reports)
    if not report:
        return catalog, None

    market = DEFAULT_MARKET
    domain = ""
    pid = ""
    if project:
        market = (project.get("market") or DEFAULT_MARKET).lower()
        domain = project.get("domain") or ""
        pid = str(project.get("externalProjectId") or "")

    schema: Any = None
    try:
        schema = client.call_tool("get_report_schema", {"report": report})
    except Exception:
        schema = None

    params = _build_report_params(
        schema,
        market=market,
        domain=domain,
        project_id=pid,
    )

    # Org-level / catalog-only tools: list_projects needs no domain params
    if tool_name == "projects" and report in ("list_projects",):
        params = {}

    try:
        data = _execute_report(client, report, params=params)
        units = _api_units_message(data)
        if units:
            return {
                "toolkit": tool_name,
                "report": report,
                "params": params,
                "catalog": catalog,
                "data": data,
            }, units
        return {
            "toolkit": tool_name,
            "report": report,
            "params": params,
            "catalog": catalog,
            "data": data,
        }, None
    except Exception as exc:
        units = _api_units_message(str(exc))
        return {
            "toolkit": tool_name,
            "report": report,
            "params": params,
            "catalog": catalog,
            "data": None,
        }, units or str(exc)


def run_semrush_sync(
    connection: dict[str, Any],
    *,
    ad_hoc_domain: str | None = None,
) -> dict[str, Any]:
    """
    Call Semrush remote MCP: list projects, cache the first project only,
    and persist the top 5 rows of each allowed toolkit report.
    """
    _ = ad_hoc_domain  # Chat must not inject another website; weekly/bootstrap only.
    try:
        config: SemrushConfig = config_from_connection_payload(connection)
    except Exception as exc:
        return {
            "ok": False,
            "error": f"Invalid Semrush connection configuration ({exc})",
            "projects": [],
            "snapshots": [],
            "tokens": None,
        }

    if not config.access_token or not config.refresh_token or not config.client_id:
        return {
            "ok": False,
            "error": "Semrush credentials are incomplete. Please reconnect Semrush in Accounts.",
            "projects": [],
            "snapshots": [],
            "tokens": None,
        }

    # Default MCP URL when Accounts row has null mcp_url
    if not config.mcp_url:
        config.mcp_url = "https://mcp.semrush.com/v2/mcp"

    client = SemrushMcpClient(config)
    try:
        client.initialize()
        tools = client.list_tools()
    except SemrushMcpError as exc:
        return {
            "ok": False,
            "error": f"We couldn’t reach Semrush right now ({exc.message}). Please try again later.",
            "projects": [],
            "snapshots": [],
            "tokens": _token_payload(client),
            "mcpError": True,
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": f"We couldn’t reach Semrush right now ({type(exc).__name__}). Please try again later.",
            "projects": [],
            "snapshots": [],
            "tokens": None,
            "mcpError": True,
        }

    tool_names = [t.get("name") for t in tools if t.get("name")]
    _meta_tools = {"get_report_schema", "execute_report"}
    # Intersection only — never cache Semrush tools outside the allowlist.
    toolkit_names = [
        n
        for n in tool_names
        if n and n.lower() not in _meta_tools and n.lower() in _TOOLKIT_ALLOWED
    ]
    if not toolkit_names:
        toolkit_names = list(_TOOLKIT_TOOLS)

    projects: list[dict[str, Any]] = []
    snapshots: list[dict[str, Any]] = []
    api_units_error: str | None = None

    # Resolve project list via projects toolkit → list_projects report
    payload, err = _sync_toolkit(client, "projects")
    if err and _api_units_message(err):
        api_units_error = err
    if isinstance(payload, dict):
        units = _api_units_message(payload.get("data"))
        if units:
            api_units_error = units
    snapshots.append(
        {
            "externalProjectId": "_org_",
            "toolName": "projects",
            "payload": _limit_top_n(payload),
            "error": err,
        }
    )
    if isinstance(payload, dict) and not api_units_error:
        projects.extend(_extract_projects(payload.get("data")))
        if not projects:
            projects.extend(_extract_projects(payload))

    # de-dupe, then keep only the first Semrush project
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for p in projects:
        eid = p["externalProjectId"]
        if eid in seen:
            continue
        seen.add(eid)
        if not p.get("market"):
            p["market"] = _market_from_domain(p.get("domain")) or DEFAULT_MARKET
        deduped.append(p)
    projects = deduped[:1] if _FIRST_PROJECT_ONLY else deduped

    if api_units_error and not projects:
        return {
            "ok": False,
            "error": api_units_error,
            "toolNames": tool_names,
            "projects": [],
            "snapshots": snapshots,
            "tokens": _token_payload(client),
            "mcpUrl": client.config.mcp_url,
            "mcpError": True,
            "apiUnitsRequired": True,
        }

    targets = projects or [
        {
            "externalProjectId": "_org_",
            "domain": None,
            "market": DEFAULT_MARKET,
            "raw": {"source": "org_fallback"},
        }
    ]

    for project in targets:
        eid = project["externalProjectId"]
        for tool_name in toolkit_names:
            if not tool_name or tool_name.lower() not in _TOOLKIT_ALLOWED:
                continue
            if tool_name == "projects" and eid == "_org_":
                continue  # already stored
            if tool_name == "projects" and eid != "_org_":
                continue
            payload, err = _sync_toolkit(client, tool_name, project=project)
            if err and _api_units_message(err) and not api_units_error:
                api_units_error = err
            snapshots.append(
                {
                    "externalProjectId": eid,
                    "toolName": tool_name,
                    "payload": _limit_top_n(payload),
                    "error": err,
                }
            )

    return {
        "ok": True,
        "error": api_units_error,
        "toolNames": tool_names,
        "projects": [p for p in projects if p["externalProjectId"] != "_org_"],
        "snapshots": snapshots,
        "tokens": _token_payload(client),
        "mcpUrl": client.config.mcp_url,
        "apiUnitsRequired": bool(api_units_error),
    }


def _token_payload(client: SemrushMcpClient) -> dict[str, Any]:
    return {
        "accessToken": client.config.access_token,
        "refreshToken": client.config.refresh_token,
        "mcpUrl": client.config.mcp_url,
    }
