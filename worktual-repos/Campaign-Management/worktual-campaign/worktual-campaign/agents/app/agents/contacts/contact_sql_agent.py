"""Read-only SQL agent for contact view — schema-grounded SELECT with retry loop."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from typing import Any

from app.config import get_settings
from app.llm import (
    CHAT_LLM_TIMEOUT_S,
    CHAT_MAX_TOKENS,
    CHAT_REASONING_EFFORT,
    OpenAILLM,
)

_log = logging.getLogger(__name__)

_MAX_ATTEMPTS = 3
_MAX_ROWS = 500
# Max rows sent to the Audience "Found contacts" panel (full count still in matched_count).
QUERY_PANEL_MAX = 100

_ORG_MAP_RE = re.compile(r"^00000000-0000-4000-a000-([0-9]{12})$", re.I)

_FORBIDDEN_SQL = re.compile(
    r"\b("
    r"insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|"
    r"execute|call|merge|replace|into|attach|detach|pragma|vacuum|analyze"
    r")\b",
    re.I,
)

_CONTACT_FROM = """
FROM cdp.customer_profile p
LEFT JOIN LATERAL (
  SELECT ik.key_value
  FROM cdp.identity_keys ik
  WHERE ik.cdp_id::text = p.cdp_id::text
    AND ik.organization_id::text = p.organization_id::text
    AND lower(ik.key_type) IN ('email', 'primary_email')
  ORDER BY ik.verified DESC, ik.created_at DESC
  LIMIT 1
) email_k ON true
LEFT JOIN LATERAL (
  SELECT ik.key_value
  FROM cdp.identity_keys ik
  WHERE ik.cdp_id::text = p.cdp_id::text
    AND ik.organization_id::text = p.organization_id::text
    AND lower(ik.key_type) IN ('phone', 'primary_phone', 'mobile')
  ORDER BY ik.verified DESC, ik.created_at DESC
  LIMIT 1
) phone_k ON true
""".strip()

_CONTACT_SELECT = """
  p.cdp_id AS id,
  p.first_name,
  p.last_name,
  email_k.key_value AS email,
  phone_k.key_value AS phone,
  p.company AS company_name,
  p.city,
  p.created_at,
  coalesce(p.custom_fields, '{}'::jsonb) AS custom_fields
""".strip()

_NOT_DELETED = (
    "coalesce((p.custom_fields->>'campaign_deleted')::boolean, false) = false"
)

_SCHEMA_DOC = f"""
Tables (read-only):
- cdp.customer_profile AS p
  - cdp_id (API id), organization_id, first_name, last_name, company, city,
    created_at, custom_fields (jsonb: age, job_title, segment, score, …)
- cdp.identity_keys AS ik (via lateral joins email_k, phone_k)
  - email: key_type IN ('email','primary_email')
  - phone: key_type IN ('phone','primary_phone','mobile')

Standard FROM (use exactly):
{_CONTACT_FROM}

Standard SELECT columns (use these aliases):
{_CONTACT_SELECT}

Required WHERE (always include):
- p.organization_id::text = $1
- {_NOT_DELETED}

Common custom_fields keys (jsonb — use ILIKE for text when user wording may vary):
- IndustryType, industry, industry_type — company vertical / sector
- Gender, gender
- country, state, address, postCode, post_code
- job_title, title, role, Department, department
- segment, customer_segment, product_interest, Language, company_size, company_type
- age, score (numeric compare when appropriate)

Rules:
- PostgreSQL SELECT only. One statement. No comments with semicolons tricks.
- LIMIT <= {_MAX_ROWS}
- custom_fields text: p.custom_fields->>'field_name' or ILIKE on ->>'key'
- custom_fields numeric age: (p.custom_fields->>'age')::numeric
- city / company: use ILIKE on p.city and p.company when matching free text
- has email: email_k.key_value IS NOT NULL AND length(trim(email_k.key_value)) > 0
- has phone: phone_k.key_value IS NOT NULL AND length(trim(phone_k.key_value)) > 0
- app push token: often on contact detail only — if no push column on profile, use
  custom_fields keys like app_push_token, push_token, fcm_token when present
- Combine filters with AND when the user asks for multiple criteria
""".strip()

_EXAMPLE_HAS_EMAIL = """
SELECT p.cdp_id AS id, p.first_name, p.last_name,
  email_k.key_value AS email, phone_k.key_value AS phone,
  p.company AS company_name, p.city, p.created_at,
  coalesce(p.custom_fields, '{}'::jsonb) AS custom_fields
FROM cdp.customer_profile p
LEFT JOIN LATERAL (
  SELECT ik.key_value FROM cdp.identity_keys ik
  WHERE ik.cdp_id::text = p.cdp_id::text AND ik.organization_id::text = p.organization_id::text
    AND lower(ik.key_type) IN ('email','primary_email')
  ORDER BY ik.verified DESC, ik.created_at DESC LIMIT 1
) email_k ON true
LEFT JOIN LATERAL (
  SELECT ik.key_value FROM cdp.identity_keys ik
  WHERE ik.cdp_id::text = p.cdp_id::text AND ik.organization_id::text = p.organization_id::text
    AND lower(ik.key_type) IN ('phone','primary_phone','mobile')
  ORDER BY ik.verified DESC, ik.created_at DESC LIMIT 1
) phone_k ON true
WHERE p.organization_id::text = $1
  AND coalesce((p.custom_fields->>'campaign_deleted')::boolean, false) = false
  AND email_k.key_value IS NOT NULL AND length(trim(email_k.key_value)) > 0
ORDER BY lower(coalesce(p.first_name,'')), lower(coalesce(p.last_name,''))
LIMIT 500
""".strip()

_SYSTEM = f"""You are the Contact View SQL agent for Worktual CRM.
The user wants to VIEW/FILTER/LIST contacts. Write exactly one PostgreSQL SELECT.

{_SCHEMA_DOC}

Example (contacts with email):
{_EXAMPLE_HAS_EMAIL}

Call SUBMIT_CONTACT_SQL with the full SELECT query when ready.
If a prior attempt failed, read the error and failed SQL, then fix and resubmit.
Never mutate data. Never omit organization_id = $1 or the NOT_DELETED filter.
"""

_SUBMIT_SQL_TOOL = {
    "type": "function",
    "function": {
        "name": "SUBMIT_CONTACT_SQL",
        "description": "Submit the read-only SELECT query for contact view.",
        "parameters": {
            "type": "object",
            "properties": {
                "sql": {
                    "type": "string",
                    "description": "Full PostgreSQL SELECT (single statement).",
                },
                "reason": {
                    "type": "string",
                    "description": "Brief note on how this matches the user request.",
                },
            },
            "required": ["sql"],
        },
    },
}


def account_org_param(organization_id: str) -> str:
    """Match backend accountOrgParam — map legacy UUID org ids to bigint strings."""
    raw = str(organization_id or "").strip()
    m = _ORG_MAP_RE.match(raw)
    if m:
        return str(int(m.group(1)))
    return raw


def _llm() -> OpenAILLM:
    s = get_settings()
    return OpenAILLM(api_key=s.llm_api_key, model_name=s.llm_model, base_url=s.llm_base_url)


def _parse_tool_args(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass
    return {}


def _strip_sql_comments(sql: str) -> str:
    out = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    out = re.sub(r"--[^\n]*", " ", out)
    return out.strip()


def validate_readonly_sql(sql: str) -> tuple[bool, str]:
    """Return (ok, error_reason)."""
    cleaned = _strip_sql_comments(str(sql or "").strip())
    if not cleaned:
        return False, "Empty SQL"
    if ";" in cleaned.rstrip(";"):
        return False, "Multiple SQL statements are not allowed"
    cleaned = cleaned.rstrip(";").strip()
    if not re.match(r"^select\b", cleaned, re.I):
        return False, "Only SELECT queries are allowed"
    if _FORBIDDEN_SQL.search(cleaned):
        return False, "Forbidden SQL keyword detected"
    if "customer_profile" not in cleaned.lower():
        return False, "Query must read from cdp.customer_profile"
    if not re.search(r"organization_id\s*::?\s*text\s*=\s*\$1", cleaned, re.I):
        return False, "Query must include p.organization_id::text = $1"
    if _NOT_DELETED not in cleaned and "campaign_deleted" not in cleaned.lower():
        return False, "Query must exclude soft-deleted contacts (campaign_deleted filter)"
    limit_m = re.search(r"\blimit\s+(\d+)", cleaned, re.I)
    if limit_m and int(limit_m.group(1)) > _MAX_ROWS:
        return False, f"LIMIT must be <= {_MAX_ROWS}"
    if not limit_m:
        return False, f"Query must include LIMIT <= {_MAX_ROWS}"
    return True, ""


def _normalize_dsn(url: str) -> str:
    from urllib.parse import urlparse, urlunparse

    raw = (url or "").strip()
    if not raw:
        return ""
    parsed = urlparse(raw)
    scheme = parsed.scheme.replace("postgresql+asyncpg", "postgresql").replace(
        "postgres://", "postgresql://"
    )
    if "+" in scheme:
        scheme = scheme.split("+", 1)[0]
    return urlunparse(parsed._replace(scheme=scheme, query="", fragment=""))


async def _execute_sql(sql: str, org_id: str) -> list[dict[str, Any]]:
    import asyncpg  # type: ignore

    dsn = _normalize_dsn(get_settings().account_database_url)
    if not dsn:
        raise RuntimeError("ACCOUNT_DATABASE_URL is not configured")
    conn = await asyncpg.connect(dsn, timeout=15)
    try:
        rows = await conn.fetch(sql, account_org_param(org_id))
        out: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            cf = item.get("custom_fields")
            if isinstance(cf, str):
                try:
                    item["custom_fields"] = json.loads(cf)
                except json.JSONDecodeError:
                    item["custom_fields"] = {}
            elif cf is None:
                item["custom_fields"] = {}
            created = item.get("created_at")
            if created is not None and hasattr(created, "isoformat"):
                item["created_at"] = created.isoformat()
            out.append(item)
        return out
    finally:
        await conn.close()


async def _generate_sql(
    *,
    user_request: str,
    memory: dict[str, Any],
    failures: list[dict[str, str]],
) -> tuple[str, str]:
    """LLM → SUBMIT_CONTACT_SQL. Returns (sql, reason)."""
    context = {
        "user_request": user_request,
        "memory": memory,
        "prior_failures": failures,
    }
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": _SYSTEM},
        {
            "role": "user",
            "content": (
                "Write the SELECT for this contact view request.\n"
                + json.dumps(context, ensure_ascii=False, indent=2, default=str)
            ),
        },
    ]
    llm = _llm()
    result = await asyncio.wait_for(
        asyncio.to_thread(
            llm.run,
            messages,
            [_SUBMIT_SQL_TOOL],
            CHAT_REASONING_EFFORT,
            min(CHAT_MAX_TOKENS, 768),
            0.1,
        ),
        timeout=CHAT_LLM_TIMEOUT_S,
    )
    tool_calls = (result or {}).get("tool_calls") or []
    if not tool_calls:
        content = str((result or {}).get("content") or "").strip()
        raise ValueError(content or "Model did not submit SQL")
    fn = (tool_calls[0] or {}).get("function") or {}
    args = _parse_tool_args(fn.get("arguments"))
    sql = str(args.get("sql") or "").strip()
    reason = str(args.get("reason") or "").strip()
    if not sql:
        raise ValueError("SUBMIT_CONTACT_SQL missing sql")
    return sql, reason


async def run_contact_sql_query(
    *,
    user_request: str,
    org_id: str,
    memory: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Generate and run a read-only contact SELECT (max 3 attempts on failure).
    Returns {ok, rows, count, sql, attempts, message}.
    """
    text = str(user_request or "").strip()
    if not text:
        return {"ok": False, "error": "user_request required"}
    oid = str(org_id or "").strip()
    if not oid:
        return {"ok": False, "error": "organization_id required"}

    mem = memory if isinstance(memory, dict) else {}
    failures: list[dict[str, str]] = []
    last_sql = ""
    last_reason = ""

    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            sql, reason = await _generate_sql(
                user_request=text,
                memory=mem,
                failures=failures,
            )
            last_sql = sql
            last_reason = reason
        except Exception as exc:  # noqa: BLE001
            failures.append(
                {"attempt": str(attempt), "sql": last_sql, "error": f"LLM: {exc}"}
            )
            continue

        ok, why = validate_readonly_sql(sql)
        if not ok:
            failures.append({"attempt": str(attempt), "sql": sql, "error": why})
            continue

        exec_sql = _strip_sql_comments(sql).rstrip(";").strip()
        try:
            rows = await _execute_sql(exec_sql, oid)
            if len(rows) > _MAX_ROWS:
                rows = rows[:_MAX_ROWS]
            return {
                "ok": True,
                "rows": rows,
                "count": len(rows),
                "sql": exec_sql,
                "reason": last_reason,
                "attempts": attempt,
                "message": f"Query returned {len(rows)} contact(s).",
            }
        except Exception as exc:  # noqa: BLE001
            failures.append(
                {"attempt": str(attempt), "sql": exec_sql, "error": str(exc)}
            )
            _log.warning(
                "contact_sql attempt %s failed: %s", attempt, exc, exc_info=True
            )

    return {
        "ok": False,
        "error": "Could not run a valid contact query after 3 attempts.",
        "attempts": failures,
        "last_sql": last_sql,
    }


async def run_contact_sql_query_via_filter_api(
    *,
    token: str,
    user_request: str,
    memory: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Fallback when DB URL missing — reuse audience filter LLM + /contacts/filter."""
    from app.agents.create_campaign.filtering import run_audience_agent

    plan = await run_audience_agent(
        token=token,
        user_text=user_request,
        prior_filters={},
    )
    filters = plan.get("filters") if isinstance(plan.get("filters"), dict) else {}
    if plan.get("intent") == "clarify" and not filters:
        msg = str(plan.get("needs_clarification") or plan.get("why") or "").strip()
        return {"ok": False, "error": msg or "Could not interpret contact filter request."}

    import httpx
    from app.config import get_settings

    base = get_settings().campaign_api_base.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(
                f"{base}/contacts/filter",
                headers={"Authorization": f"Bearer {token}"},
                json={"filters": filters},
            )
            res.raise_for_status()
            body = res.json()
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Filter API failed: {exc}"}

    sample = list(body.get("sample") or [])
    count = int(body.get("count") or len(sample))
    return {
        "ok": True,
        "rows": sample,
        "count": count,
        "source": "filter_api",
        "active_filters": filters,
        "message": f"Filter returned {count} contact(s).",
    }


__all__ = [
    "account_org_param",
    "run_contact_sql_query",
    "run_contact_sql_query_via_filter_api",
    "validate_readonly_sql",
]
