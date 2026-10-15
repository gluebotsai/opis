"""Shape co-worker JSON the same way the TypeScript client does.

Numbers and ticket rows come from the tool payload. An unavailable Context Layer
answer replaces the model text so a guessed count is not returned.
"""

from __future__ import annotations

import re
from typing import Any

from .error_text import error_text, stable_code
from .errors import TicketingApiError
from .models import (
    AiInsightResult,
    AiMetricValue,
    AiTaskArticle,
    AiTaskResult,
    AiTaskTicket,
    AiToolProposal,
    AiTurnResult,
)

UNAVAILABLE = "This answer is temporarily unavailable."
_CONFIG_URL = re.compile(r"CONTEXT_LAYER_URL|ONTOLOGY_CHAT_URL")

CARD_TASKS: dict[str, dict[str, Any]] = {
    "ticket.summarize": {
        "feature": "ai.tasks.summarize",
        "needs_ticket": True,
        "message": "Summarize this ticket.",
    },
    "ticket.classify": {
        "feature": "ai.tasks.classify",
        "needs_ticket": True,
        "message": "Classify and prioritize this ticket.",
    },
    "ticket.draftReply": {
        "feature": "ai.tasks.draftReply",
        "needs_ticket": True,
        "message": "Draft a customer reply for this ticket. Do not send it.",
    },
    "ticket.similar": {
        "feature": "ai.tasks.similar",
        "needs_ticket": True,
        "message": "Find similar tickets. Recommend only. Do not merge or update.",
    },
    "ticket.kb": {
        "feature": "ai.tasks.recommendKb",
        "needs_ticket": True,
        "message": "Recommend published knowledge articles for this ticket. Do not change the ticket.",
    },
    "intake.deflect": {
        "feature": "ai.tasks.deflect",
        "needs_ticket": False,
        "message": "",
    },
    "ticket.create": {
        "feature": "ai.tasks.createTicket",
        "needs_ticket": False,
        "message": "",
    },
    "ticket.assign": {
        "feature": "ai.tasks.assign",
        "needs_ticket": True,
        "message": "Choose the best assignee for this ticket. Confirm if it already has an owner.",
    },
    "ticket.resolveSuggest": {
        "feature": "ai.tasks.resolveSuggest",
        "needs_ticket": True,
        "message": "Suggest resolve or reopen for this ticket. Do not change status until confirmed.",
    },
    "ticket.quality": {
        "feature": "ai.tasks.qualityCheck",
        "needs_ticket": True,
        "message": "Review resolution quality for this ticket.",
    },
    "sla.advise": {
        "feature": "ai.tasks.slaAdvise",
        "needs_ticket": True,
        "message": "Explain SLA risk for this ticket. Escalate only with confirmation.",
    },
    "ticket.workload": {
        "feature": "ai.tasks.workload",
        "needs_ticket": False,
        "message": "Review open workload and recommend a balance. Do not reassign.",
    },
}

INSIGHT_TASKS = {
    "analytics.ask": "ai.tasks.askMetrics",
    "analytics.why": "ai.tasks.askWhy",
    "ticket.list": "ai.tasks.listTickets",
}


def as_record(value: Any) -> dict[str, Any] | None:
    if isinstance(value, dict):
        return value
    return None


def _js_truthy(value: Any) -> bool:
    if value is None or value is False:
        return False
    if isinstance(value, str):
        return value != ""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value != 0
    return True


def _js_or(*values: Any) -> Any:
    for value in values:
        if _js_truthy(value):
            return value
    return None


def _text(value: Any) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value).strip()
    return ""


def _first_text(row: dict[str, Any], *keys: str) -> str:
    for key in keys:
        text = _text(row.get(key))
        if text:
            return text
    return ""


def _optional_str(value: Any) -> str | None:
    if value is None:
        return None
    return str(value)


def proposals_from(raw: Any) -> list[AiToolProposal]:
    if not isinstance(raw, list):
        return []
    out: list[AiToolProposal] = []
    for item in raw:
        row = as_record(item)
        if not row:
            continue
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        args = as_record(row.get("args"))
        risk = row.get("risk")
        auto = row.get("auto")
        out.append(
            AiToolProposal(
                name=name,
                args=args,
                risk=risk if isinstance(risk, str) else None,
                auto=auto if isinstance(auto, bool) else None,
            )
        )
    return out


def turn_status(proposals: list[AiToolProposal]) -> str:
    if any(proposal.auto is False or proposal.risk == "high" for proposal in proposals):
        return "confirmation_required"
    if any(proposal.auto is True for proposal in proposals):
        return "applied"
    return "answered"


def _customer_missing(value: Any, depth: int = 0) -> bool:
    if depth > 5 or not isinstance(value, (dict, list)):
        return False
    if isinstance(value, list):
        return any(_customer_missing(item, depth + 1) for item in value)
    if value.get("customer_not_found") is True or value.get("customerNotFound") is True:
        return True
    for key in ("ticket_draft", "ticketDraft", "draft", "collected", "durable", "lastToolOutcome", "last_tool_outcome"):
        if key in value and _customer_missing(value.get(key), depth + 1):
            return True
    return False


def _turn_code(payload: dict[str, Any], data: dict[str, Any] | None, patch: dict[str, Any] | None) -> str | None:
    refusal = as_record((data or {}).get("refusal")) or {}
    return (
        stable_code(payload.get("code"))
        or stable_code((data or {}).get("code"))
        or stable_code(refusal.get("code"))
        or ("customer_not_found" if _customer_missing(data) or _customer_missing(patch) else None)
    )


def _trace(payload: dict[str, Any]) -> dict[str, Any] | None:
    direct = as_record(payload.get("trace"))
    nested = as_record((as_record(payload.get("data")) or {}).get("trace"))
    raw = direct or nested
    if not raw:
        return None
    agents = [str(item).strip() for item in raw.get("agents") or [] if str(item).strip()] if isinstance(raw.get("agents"), list) else []
    routes: list[dict[str, str]] = []
    if isinstance(raw.get("routes"), list):
        for item in raw["routes"]:
            row = as_record(item)
            if not row:
                continue
            dst = str(row.get("to") or "").strip()
            if not dst:
                continue
            routes.append({"from": str(row.get("from") or "").strip(), "to": dst})
    if not agents and not routes:
        return None
    return {"agents": agents, "routes": routes}


def to_result(payload: dict[str, Any], locale: str) -> AiTurnResult:
    tool_proposals = proposals_from(payload.get("toolProposals"))
    ui_raw = payload.get("ui_actions")
    ui_actions = [item for item in ui_raw if isinstance(item, dict)] if isinstance(ui_raw, list) else []
    patch = as_record(payload.get("sessionMemoryPatch")) or {}
    last = as_record(patch.get("lastToolOutcome")) or as_record(patch.get("last_tool_outcome"))
    base = as_record(payload.get("data")) or {}
    data = {**base, "lastToolOutcome": last} if last else as_record(payload.get("data"))
    code = _turn_code(payload, data, patch)
    catalog = error_text(code, locale) if code else None
    reply = catalog or str(payload.get("assistantText") or payload.get("reply") or "").strip()
    if not reply:
        raise TicketingApiError(
            str(payload.get("detail") or payload.get("error") or "Empty co-worker reply"),
            502,
            payload,
        )
    session_id = payload.get("session_id")
    request_id = payload.get("request_id")
    return AiTurnResult(
        reply=reply,
        status=turn_status(tool_proposals),
        agent=str(payload.get("agent") or "general"),
        ui_actions=ui_actions,
        tool_proposals=tool_proposals,
        locale=locale,
        session_id=str(session_id) if session_id is not None else None,
        request_id=str(request_id) if request_id is not None else None,
        data=data,
        code=code,
        trace=_trace(payload),
    )


def _articles(data: dict[str, Any] | None) -> list[AiTaskArticle]:
    raw = (data or {}).get("articles")
    if not isinstance(raw, list):
        return []
    out: list[AiTaskArticle] = []
    for item in raw:
        row = as_record(item)
        if not row:
            continue
        title = _first_text(row, "title", "name")
        if not title:
            continue
        out.append(AiTaskArticle(title=title, id=_optional_str(row.get("id")) if row.get("id") is not None else None, url=_optional_str(row.get("url")) if row.get("url") is not None else None))
    return out


def _tickets(data: dict[str, Any] | None) -> list[AiTaskTicket]:
    source = data or {}
    raw = _js_or(source.get("tickets"), source.get("similarTickets"), source.get("similar"))
    if not isinstance(raw, list):
        return []
    out: list[AiTaskTicket] = []
    for item in raw:
        row = as_record(item)
        if not row:
            continue
        number = _first_text(row, "ticketNumber", "ticket_number", "number", "id")
        if not number:
            continue
        subject = row.get("subject")
        out.append(AiTaskTicket(ticket_number=number, subject=str(subject) if subject is not None else None))
    return out


def _gated(proposals: list[AiToolProposal]) -> AiToolProposal | None:
    for proposal in proposals:
        if proposal.auto is False or proposal.risk == "high":
            return proposal
    return None


def _deflected(result: AiTurnResult) -> bool:
    data = result.data or {}
    return bool(data.get("dssa_deflected") or data.get("deflected") or result.agent == "dssa")


def _task_status(task: str, result: AiTurnResult) -> str:
    if task in ("ticket.similar", "ticket.kb", "ticket.workload"):
        return "recommendation"
    if task == "ticket.quality":
        if result.status in ("confirmation_required", "applied"):
            return result.status
        return "recommendation"
    if task == "intake.deflect":
        if result.status == "confirmation_required":
            return "confirmation_required"
        return "deflected" if _deflected(result) else "answered"
    return result.status


def to_card(task: str, result: AiTurnResult) -> AiTaskResult:
    return AiTaskResult(
        reply=result.reply,
        status=_task_status(task, result),
        agent=result.agent,
        task=task,
        ui_actions=result.ui_actions,
        tool_proposals=result.tool_proposals,
        articles=_articles(result.data),
        tickets=_tickets(result.data),
        proposal=_gated(result.tool_proposals),
        deflected=task == "intake.deflect" and _deflected(result),
        locale=result.locale,
        session_id=result.session_id,
        request_id=result.request_id,
        data=result.data,
        draft=result.reply if task == "ticket.draftReply" else None,
        code=result.code,
    )


def _unavailable(result: AiTurnResult) -> bool:
    data = result.data or {}
    if data.get("code") == "temporarily_unavailable":
        return True
    last = as_record(data.get("lastToolOutcome")) or {}
    return bool(_CONFIG_URL.search(str(last.get("message") or "")))


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _metric_value(row: dict[str, Any]) -> AiMetricValue | None:
    value = None
    for key in ("value", "metric_value", "count"):
        if key in row and row[key] is not None:
            value = row[key]
            break
    if not isinstance(value, str) and not _is_number(value):
        return None
    ident = None
    for key in ("id", "metric", "metric_id"):
        if key in row and row[key] is not None:
            ident = str(row[key])
            break
    label = None
    for key in ("label", "name", "metric"):
        if key in row and row[key] is not None:
            label = str(row[key])
            break
    return AiMetricValue(value=value, id=ident, label=label)


def _is_ticket_row(row: dict[str, Any]) -> bool:
    return "ticketNumber" in row or "ticket_number" in row or "subject" in row


def insight_parts(result: AiTurnResult) -> tuple[list[AiMetricValue], list[dict[str, Any]], str | None]:
    data = result.data or {}
    last = as_record(data.get("lastToolOutcome")) or {}
    payload = as_record(last.get("payload")) or data
    nested = as_record(payload.get("data")) or {}
    metric_source = _js_or(payload.get("metrics"), nested.get("metrics"), payload.get("rows"), nested.get("rows"))
    metrics: list[AiMetricValue] = []
    rows: list[dict[str, Any]] = []
    if isinstance(metric_source, list):
        for item in metric_source:
            row = as_record(item)
            if not row:
                continue
            if _is_ticket_row(row):
                rows.append(row)
                continue
            metric = _metric_value(row)
            if metric:
                metrics.append(metric)
    if not rows:
        row_source = _js_or(payload.get("rows"), nested.get("rows"), payload.get("tickets"))
        if isinstance(row_source, list):
            for item in row_source:
                row = as_record(item)
                if row and _is_ticket_row(row):
                    rows.append(row)
    answer = payload.get("answer")
    why = answer if isinstance(answer, str) else None
    return metrics, rows, why


def to_insight(task: str, result: AiTurnResult) -> AiInsightResult:
    if _unavailable(result):
        return AiInsightResult(
            reply=result.reply or UNAVAILABLE,
            status="temporarily_unavailable",
            agent=result.agent,
            task=task,
            metrics=[],
            rows=[],
            ui_actions=result.ui_actions,
            tool_proposals=result.tool_proposals,
            locale=result.locale,
            session_id=result.session_id,
            request_id=result.request_id,
            data=result.data,
            code="temporarily_unavailable",
            why=None,
        )
    metrics, rows, why = insight_parts(result)
    return AiInsightResult(
        reply=result.reply,
        status="answered",
        agent=result.agent,
        task=task,
        metrics=metrics,
        rows=rows,
        ui_actions=result.ui_actions,
        tool_proposals=result.tool_proposals,
        locale=result.locale,
        session_id=result.session_id,
        request_id=result.request_id,
        data=result.data,
        why=why,
    )
