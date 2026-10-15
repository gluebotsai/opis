"""A2A spoke file logs: Hub instruction vs CRM action. Never write secrets."""

from __future__ import annotations

import json
from typing import Any, Mapping
from urllib.parse import parse_qs

from app.agent_log import a2a_http_trace, a2a_trace, begin_trace

_REDACT_KEYS = {
    "client_secret",
    "refresh_token",
    "access_token",
    "password",
    "authorization",
    "mcpexecutiontoken",
    "mcp_execution_token",
    "mcpExecutionToken",
}
_KEEP_TOKENISH = {
    "skillversion",
    "token_type",
    "tokentype",
    "tokenurl",
    "refreshurl",
    "expires_in",
    "refresh_expires_in",
    "token_kind",
}

# Large / noisy Hub blobs — keep a short marker instead of dumping them.
_BRIEF_KEYS = {
    "context_pack",
    "contextpack",
    "product_catalog",
    "productcatalog",
    "transcript_window",
    "transcriptwindow",
    "messages",
    "prior_context",
    "priorcontext",
    "catalog",
}

_ACTIVITY_RESULT_KEYS = (
    "ok",
    "score",
    "fitScore",
    "intentScore",
    "band",
    "grade",
    "source",
    "reason",
    "rationale",
    "status",
    "decision",
    "assistantText",
    "speech",
    "nextAction",
    "summary",
    "persisted",
    "jobId",
    "contactId",
    "cdpId",
    "activityId",
    "type",
    "total",
)


def _key_name(key: Any) -> str:
    return str(key).replace("-", "_")


def _is_secret(key: Any) -> bool:
    raw = _key_name(key)
    lowered = raw.lower()
    if lowered in {k.lower() for k in _REDACT_KEYS}:
        return True
    if lowered in _KEEP_TOKENISH:
        return False
    if lowered.endswith("_secret"):
        return True
    if lowered.endswith("_token") or lowered == "token":
        return True
    return False


def _brief_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {"_keys": list(value.keys())[:24], "_size": len(value)}
    if isinstance(value, list):
        return {"_len": len(value)}
    if isinstance(value, str):
        text = value.strip()
        return text if len(text) <= 200 else text[:199] + "…"
    return value


def redact(value: Any, *, brief: bool = True, list_cap: int | None = 24) -> Any:
    if isinstance(value, Mapping):
        out: dict[str, Any] = {}
        for key, item in value.items():
            if _is_secret(key):
                out[str(key)] = "[redacted]"
            elif brief and str(key).replace("-", "").lower() in _BRIEF_KEYS:
                out[str(key)] = _brief_value(item)
            else:
                out[str(key)] = redact(item, brief=brief, list_cap=list_cap)
        return out
    if isinstance(value, list):
        items = value if list_cap is None else value[:list_cap]
        return [redact(item, brief=brief, list_cap=list_cap) for item in items]
    return value


def hub_instruction(payload: Mapping[str, Any] | None) -> dict[str, Any]:
    """Compact Hub fields for every A2A line, plus full given instruction."""
    data = dict(payload or {})
    instruction = redact(data)
    return {
        "skillId": data.get("skillId") or data.get("skill_id"),
        "organizationId": data.get("organizationId") or data.get("organization_id"),
        "cdpId": data.get("cdpId") or data.get("cdp_id") or data.get("contactId"),
        "source": data.get("source"),
        "text": data.get("text")
        or data.get("query")
        or data.get("task")
        or (
            data["instruction"].get("description")
            if isinstance(data.get("instruction"), dict)
            else data.get("instruction")
            if isinstance(data.get("instruction"), str)
            else None
        )
        or data.get("description"),
        "dealId": data.get("dealId") or data.get("deal_id"),
        "companyId": data.get("companyId") or data.get("company_id"),
        "invoiceId": data.get("invoiceId") or data.get("invoice_id"),
        "instruction": instruction,
    }


def agent_activity(artifact: Mapping[str, Any] | None) -> dict[str, Any]:
    """What the CRM agent finished — status + compact result for the A2A log."""
    data = dict(artifact or {})
    activity: dict[str, Any] = {
        "status": data.get("status"),
        "skillId": data.get("skillId") or data.get("skill_id"),
        "agent": data.get("agent") or data.get("agent_name"),
        "error": data.get("error"),
        "missingFields": data.get("missingFields") or data.get("missing_fields"),
    }
    result = data.get("result")
    if isinstance(result, Mapping):
        nested = result.get("data") if isinstance(result.get("data"), Mapping) else {}
        merged: dict[str, Any] = {**dict(nested), **dict(result)}
        summary: dict[str, Any] = {}
        for key in _ACTIVITY_RESULT_KEYS:
            if key in merged and merged[key] not in (None, "", [], {}):
                summary[key] = merged[key]
        # Keep a few extra scalar/list fields Hub may care about.
        for key, value in merged.items():
            if key in summary or key in {"patch", "contactDraftPatch", "context", "data"}:
                continue
            if isinstance(value, (str, int, float, bool)) or value is None:
                if value not in (None, ""):
                    summary[key] = value
            elif isinstance(value, list) and value and len(summary) < 20:
                summary[key] = value[:8]
            if len(summary) >= 24:
                break
        if summary:
            activity["result"] = summary
    elif result is not None:
        activity["result"] = result
    if data.get("hubRemainder") is not None:
        activity["hubRemainder"] = True
    return redact({k: v for k, v in activity.items() if v not in (None, "", [], {})})


def crm_instruction(payload: Mapping[str, Any] | None) -> dict[str, Any]:
    """What CRM posted to Hub (remainder). Same compact shape as hub_instruction."""
    data = dict(payload or {})
    event = data.get("recent_event") if isinstance(data.get("recent_event"), dict) else {}
    merged = {
        **data,
        "source": data.get("source") or "crm",
        "cdpId": data.get("cdp_id") or data.get("cdpId") or data.get("contactId"),
        "organizationId": data.get("organization_id") or data.get("organizationId"),
        "text": event.get("query") or data.get("text") or data.get("query"),
    }
    return hub_instruction(merged)


def _part_data_list(parts: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not isinstance(parts, list):
        return out
    for part in parts:
        if not isinstance(part, dict):
            continue
        payload = part.get("data")
        if isinstance(payload, dict):
            out.append(payload)
        text = part.get("text")
        if text:
            out.append({"text": str(text)})
    return out


def crm_respond(result: Mapping[str, Any] | None, *, error: str | None = None) -> dict[str, Any]:
    """What CRM returned to Hub on the same JSON-RPC request (no secrets)."""
    return hub_reply(result, error=error)


def hub_reply(result: Mapping[str, Any] | None, *, error: str | None = None) -> dict[str, Any]:
    """What Hub returned for a CRM → Hub invoke (no secrets)."""
    data = dict(result or {})
    status = data.get("status") if isinstance(data.get("status"), dict) else {}
    state = str(status.get("state") or data.get("state") or "").strip() or None
    if not state and data.get("ok") is False:
        state = "failed"
    message = status.get("message") if isinstance(status.get("message"), dict) else {}
    missing: Any = None
    status_error: Any = None
    for blob in _part_data_list(message.get("parts")):
        if blob.get("missing_fields") and missing is None:
            missing = blob.get("missing_fields")
        if blob.get("error") and status_error is None:
            status_error = blob.get("error")
        if blob.get("text") and status_error is None:
            status_error = blob.get("text")
    rpc_error = data.get("error")
    artifacts: list[dict[str, Any]] = []
    speech = None
    for art in data.get("artifacts") or []:
        if not isinstance(art, dict):
            continue
        for blob in _part_data_list(art.get("parts")):
            dispatch_rows: list[dict[str, Any]] = []
            raw_dispatch = blob.get("dispatch")
            if isinstance(raw_dispatch, list):
                for item in raw_dispatch[:8]:
                    if not isinstance(item, dict):
                        continue
                    dispatch_rows.append(
                        {
                            "action_type": item.get("action_type") or item.get("actionType"),
                            "spoke_target": item.get("spoke_target") or item.get("spokeTarget"),
                            "status": item.get("status"),
                            "description": item.get("description"),
                        }
                    )
            reply = blob.get("suggestedAgentReply") or blob.get("summary")
            if reply and not speech:
                speech = str(reply)
            artifacts.append(
                {
                    "skillId": blob.get("skillId") or blob.get("skill_id"),
                    "status": blob.get("status"),
                    "customerId": blob.get("customerId") or blob.get("cdpId"),
                    "summary": blob.get("summary"),
                    "suggestedAgentReply": blob.get("suggestedAgentReply"),
                    "dispatch": dispatch_rows or None,
                }
            )
    err = error or status_error
    if isinstance(rpc_error, dict):
        err = err or rpc_error.get("message") or rpc_error
    elif rpc_error:
        err = err or rpc_error
    compact = {
        "taskId": data.get("id") or data.get("taskId") or data.get("task_id"),
        "contextId": data.get("contextId") or data.get("context_id"),
        "state": state,
        "error": err,
        "missingFields": missing,
        "speech": speech,
        "artifacts": artifacts or None,
    }
    return redact({k: v for k, v in compact.items() if v not in (None, "", [], {})})


def decode_body(raw: bytes | str | None, content_type: str | None = None) -> Any:
    if raw is None:
        return None
    if isinstance(raw, bytes):
        if not raw:
            return None
        text = raw.decode("utf-8", errors="replace")
    else:
        text = raw
    stripped = text.strip()
    if not stripped:
        return None
    ctype = (content_type or "").lower()
    if "application/x-www-form-urlencoded" in ctype:
        parsed = parse_qs(stripped, keep_blank_values=True)
        return {key: values[0] if len(values) == 1 else values for key, values in parsed.items()}
    if stripped[0] in "{[":
        try:
            return json.loads(stripped)
        except Exception:  # noqa: BLE001
            return stripped
    return stripped


def log_http_exchange(
    *,
    direction: str,
    method: str,
    url: str,
    status: int | None = None,
    request: Any = None,
    response: Any = None,
    client: str | None = None,
    ms: float | None = None,
    error: str | None = None,
) -> None:
    """One line in a2a-YYYY-MM-DD.log for a Hub↔CRM HTTP round-trip."""
    inbound = direction == "hub_to_crm"
    ok = error is None and status is not None and 200 <= int(status) < 400
    a2a_http_trace(
        step="http_in" if inbound else "http_out",
        ok=ok,
        direction=direction,
        method=method.upper(),
        url=url,
        status=status,
        client=client,
        ms=round(ms, 1) if isinstance(ms, (int, float)) else ms,
        request=redact(request, brief=False, list_cap=None) if request not in (None, "", b"") else None,
        response=redact(response, brief=False, list_cap=None) if response not in (None, "") else None,
        error=error,
        message=(
            f"{'Hub → CRM' if inbound else 'CRM → Hub'} {method.upper()} {url} → {status if status is not None else 'error'}"
        ),
    )


def log_a2a(
    *,
    step: str,
    ok: bool | None = None,
    hub: Mapping[str, Any] | None = None,
    crm: Mapping[str, Any] | None = None,
    **fields: Any,
) -> None:
    a2a_trace(
        step=step,
        ok=ok,
        hub=redact(dict(hub)) if hub else None,
        crm=redact(dict(crm)) if crm else None,
        **redact(fields),
    )


def start_a2a_trace(trace_id: str | None = None) -> str:
    return begin_trace(trace_id)
