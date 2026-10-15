"""Headless partner client. Same routes as @worktual/ticketing for sessions, turns, tasks, proposals, and usage."""

from __future__ import annotations

import json
import re
import urllib.parse
from typing import Any, Callable

from .errors import TicketingApiError
from .http import HttpClient, TicketingConfig, compact, normalize_base_url
from .http import Transport, resolve_locale
from .mapping import CARD_TASKS, INSIGHT_TASKS, to_card, to_insight, to_result
from .models import (
    HelpWidget,
    HelpWidgetCreated,
    HelpWidgetEmbed,
    InboxItem,
    InboxList,
    PortalLogin,
    PortalOtpRequest,
    ProposalDecision,
    ProposalList,
    SdkActor,
    SdkProposal,
    SdkSession,
    StaffLogin,
    UsageEvent,
    UsageEventList,
    UsageFeature,
    UsageLogin,
    UsageLoginList,
    UsageQuota,
    UsageSkill,
    UsageSummary,
)

_PROPOSAL_ID = re.compile(r"^(approval|recommendation):\d+$")


def _session(payload: dict[str, Any]) -> SdkSession:
    actor = payload.get("actor") if isinstance(payload.get("actor"), dict) else {}
    return SdkSession(
        session_token=str(payload.get("sessionToken") or ""),
        session_id=str(payload.get("sessionId") or ""),
        expires_at=str(payload.get("expiresAt") or ""),
        organization_id=str(payload.get("organizationId") or ""),
        locale=str(payload["locale"]) if payload.get("locale") is not None else None,
        actor=SdkActor(
            id=str(actor.get("id") or ""),
            name=str(actor.get("name") or ""),
            email=str(actor.get("email") or ""),
            role=str(actor.get("role") or ""),
        ),
    )


def _quota(raw: Any) -> UsageQuota:
    row = raw if isinstance(raw, dict) else {}
    return UsageQuota(
        rate_per_minute=int(row.get("ratePerMinute") or 0),
        concurrent=int(row.get("concurrent") or 0),
    )


def _optional(row: dict[str, Any], key: str) -> str | None:
    value = row.get(key)
    return str(value) if value is not None else None


def _event(item: dict[str, Any], tenant_id: str) -> UsageEvent:
    return UsageEvent(
        id=str(item.get("id") or ""),
        partner_id=_optional(item, "partnerId"),
        tenant_id=str(item.get("tenantId") or tenant_id),
        actor_id=_optional(item, "actorId"),
        session_id=_optional(item, "sessionId"),
        surface=str(item.get("surface") or "headless"),
        component=_optional(item, "component"),
        feature=str(item.get("feature") or ""),
        skill=_optional(item, "skill"),
        executor=_optional(item, "executor"),
        locale=_optional(item, "locale"),
        agent_turns=int(item.get("agentTurns") or 0),
        confirm_required=bool(item.get("confirmRequired")),
        ok=bool(item.get("ok", True)),
        created_at=str(item.get("createdAt") or ""),
    )


def _usage(payload: dict[str, Any]) -> UsageSummary:
    features: list[UsageFeature] = []
    raw = payload.get("byFeature")
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict) and isinstance(item.get("feature"), str):
                features.append(UsageFeature(feature=item["feature"], count=int(item.get("count") or 0)))
    skills: list[UsageSkill] = []
    raw_skills = payload.get("bySkill")
    if isinstance(raw_skills, list):
        for item in raw_skills:
            if isinstance(item, dict) and isinstance(item.get("skill"), str) and item["skill"].strip():
                skills.append(UsageSkill(skill=item["skill"], count=int(item.get("count") or 0)))
    return UsageSummary(
        from_at=str(payload.get("from") or ""),
        to=str(payload.get("to") or ""),
        organization_id=str(payload.get("organizationId") or ""),
        logins=int(payload.get("logins") or 0),
        session_ends=int(payload.get("sessionEnds") or 0),
        turns=int(payload.get("turns") or 0),
        streams=int(payload.get("streams") or 0),
        confirms=int(payload.get("confirms") or 0),
        rejects=int(payload.get("rejects") or 0),
        quota_exceeded=int(payload.get("quotaExceeded") or 0),
        by_feature=features,
        by_skill=skills,
        quota=_quota(payload.get("quota")),
    )


def _proposal(row: dict[str, Any]) -> SdkProposal:
    return SdkProposal(
        id=str(row.get("id") or ""),
        kind=str(row.get("kind") or ""),
        status=str(row.get("status") or ""),
        agent_id=str(row.get("agentId") or ""),
        summary=str(row.get("summary") or ""),
        ticket_number=str(row["ticketNumber"]) if row.get("ticketNumber") is not None else None,
        draft=str(row["draft"]) if row.get("draft") is not None else None,
        tool_name=str(row["toolName"]) if row.get("toolName") is not None else None,
        created_at=str(row["createdAt"]) if row.get("createdAt") is not None else None,
    )


def _actor_body(actor: dict[str, Any]) -> dict[str, str]:
    body: dict[str, str] = {}
    if actor.get("id"):
        body["id"] = str(actor["id"])
    if actor.get("email"):
        body["email"] = str(actor["email"])
    return body


def _focused(focused_entity: dict[str, Any] | None, ticket: str | None) -> dict[str, Any] | None:
    if focused_entity is not None:
        return focused_entity
    number = str(ticket or "").strip()
    if not number:
        return None
    return {"type": "ticket", "id": number, "ticketNumber": number}


def parse_sse(text: str, on_progress: Callable[[dict[str, Any]], None] | None = None) -> dict[str, Any]:
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None
    for block in re.split(r"\r?\n\r?\n", text):
        if not block.strip():
            continue
        event = "message"
        data_lines: list[str] = []
        for line in block.splitlines():
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                data_lines.append(line[5:].strip())
        if not data_lines:
            continue
        raw = "\n".join(data_lines)
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            data = raw
        record = data if isinstance(data, dict) else {}
        if event == "progress" and on_progress is not None:
            on_progress(record)
        if event == "result":
            result = record
        if event == "error":
            nested = record.get("payload") if isinstance(record.get("payload"), dict) else record
            status = record.get("status") if isinstance(record.get("status"), int) else None
            error = {**nested, "status": status}
    if error is not None:
        status = error.get("status") if isinstance(error.get("status"), int) else 502
        raise TicketingApiError(
            str(error.get("detail") or error.get("error") or "Co-worker stream failed"),
            status,
            error,
        )
    if result is None:
        raise TicketingApiError("Co-worker stream ended without a result", 502, None)
    return result


def _token_payload(payload: Any, label: str) -> tuple[str, dict[str, Any]]:
    row = payload if isinstance(payload, dict) else {}
    token = str(row.get("token") or row.get("sessionToken") or "").strip()
    if not token:
        raise TicketingApiError(f"{label} did not return a token", 502, payload)
    return token, row


class AuthResource:
    def __init__(self, http: HttpClient) -> None:
        self._http = http
        self.portal = PortalAuth(http)

    def login(self, *, email: str, password: str, force: bool = False) -> StaffLogin:
        body: dict[str, Any] = {"email": email, "password": password}
        if force:
            body["force"] = True
        payload = self._http.request(method="POST", path="/api/auth/login", auth="none", body=body)
        token, row = _token_payload(payload, "Staff login")
        user = row.get("user") if isinstance(row.get("user"), dict) else {}
        return StaffLogin(session_token=token, user=user)

    def create_session(
        self,
        *,
        actor: dict[str, Any],
        tenant_id: str | None = None,
        locale: str | None = None,
    ) -> SdkSession:
        resolved = resolve_locale(locale, self._http.config.locale)
        payload = self._http.request(
            method="POST",
            path="/api/sdk/sessions",
            auth="partnerKey",
            body=compact({"tenantId": tenant_id, "actor": _actor_body(actor), "locale": resolved}),
        )
        return _session(payload if isinstance(payload, dict) else {})

    def end_session(self, session_token: str | None = None) -> dict[str, Any]:
        payload = self._http.request(
            method="POST",
            path="/api/sdk/sessions/end",
            auth="accessToken",
            access_token=session_token,
        )
        return payload if isinstance(payload, dict) else {"ok": True}

    def refresh_session(self, session_token: str | None = None) -> SdkSession:
        payload = self._http.request(
            method="POST",
            path="/api/sdk/sessions/refresh",
            auth="accessToken",
            access_token=session_token,
        )
        return _session(payload if isinstance(payload, dict) else {})


class PortalAuth:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def request_otp(self, *, slug: str, identifier: str) -> PortalOtpRequest:
        payload = self._http.request(
            method="POST",
            path=f"/api/public/support/{urllib.parse.quote(slug, safe='')}/otp/request",
            auth="none",
            body={"identifier": identifier},
        )
        row = payload if isinstance(payload, dict) else {}
        return PortalOtpRequest(
            ok=bool(row.get("ok", True)),
            channel=str(row["channel"]) if row.get("channel") is not None else None,
            masked=str(row["masked"]) if row.get("masked") is not None else None,
        )

    def verify_otp(self, *, slug: str, identifier: str, code: str) -> PortalLogin:
        payload = self._http.request(
            method="POST",
            path=f"/api/public/support/{urllib.parse.quote(slug, safe='')}/otp/verify",
            auth="none",
            body={"identifier": identifier, "code": code},
        )
        token, row = _token_payload(payload, "Portal verification")
        customer = row.get("customer") if isinstance(row.get("customer"), dict) else {}
        return PortalLogin(session_token=token, customer=customer)

    def login(self, *, slug: str, email: str, password: str) -> PortalLogin:
        payload = self._http.request(
            method="POST",
            path=f"/api/public/support/{urllib.parse.quote(slug, safe='')}/login",
            auth="none",
            body={"email": email, "password": password},
        )
        token, row = _token_payload(payload, "Portal login")
        customer = row.get("customer") if isinstance(row.get("customer"), dict) else {}
        return PortalLogin(session_token=token, customer=customer)


class UsageResource:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def summary(
        self,
        *,
        from_: str | None = None,
        to: str | None = None,
        tenant_id: str | None = None,
    ) -> UsageSummary:
        payload = self._http.request(
            method="GET",
            path="/api/sdk/usage/summary",
            auth="partnerKey",
            query={"from": from_, "to": to, "tenantId": tenant_id},
        )
        return _usage(payload if isinstance(payload, dict) else {})

    def logins(
        self,
        *,
        from_: str | None = None,
        to: str | None = None,
        tenant_id: str | None = None,
    ) -> UsageLoginList:
        payload = self._http.request(
            method="GET",
            path="/api/sdk/usage/logins",
            auth="partnerKey",
            query={"from": from_, "to": to, "tenantId": tenant_id},
        )
        row = payload if isinstance(payload, dict) else {}
        items: list[UsageLogin] = []
        raw = row.get("logins")
        if isinstance(raw, list):
            for item in raw:
                if not isinstance(item, dict):
                    continue
                items.append(
                    UsageLogin(
                        id=str(item.get("id") or ""),
                        actor_id=str(item["actorId"]) if item.get("actorId") is not None else None,
                        session_id=str(item["sessionId"]) if item.get("sessionId") is not None else None,
                        locale=str(item["locale"]) if item.get("locale") is not None else None,
                        created_at=str(item.get("createdAt") or ""),
                    )
                )
        return UsageLoginList(organization_id=str(row.get("organizationId") or ""), logins=items)

    def events(
        self,
        *,
        from_: str | None = None,
        to: str | None = None,
        tenant_id: str | None = None,
        limit: int | None = None,
    ) -> UsageEventList:
        payload = self._http.request(
            method="GET",
            path="/api/sdk/usage/events",
            auth="partnerKey",
            query={"from": from_, "to": to, "tenantId": tenant_id, "limit": limit},
        )
        row = payload if isinstance(payload, dict) else {}
        organization_id = str(row.get("organizationId") or "")
        items: list[UsageEvent] = []
        raw = row.get("events")
        if isinstance(raw, list):
            for item in raw:
                if isinstance(item, dict):
                    items.append(_event(item, organization_id))
        return UsageEventList(organization_id=organization_id, events=items)


class AiResource:
    def __init__(self, http: HttpClient) -> None:
        self._http = http
        self.tasks = TaskResource(self)
        self.proposals = ProposalResource(http)

    def _prepare(
        self,
        *,
        message: str | None,
        locale: str | None,
        session_id: str | None,
        module: str | None,
        page: str | None,
        history: list[dict[str, Any]] | None,
        focused_ticket_id: str | None,
        focused_entity: dict[str, Any] | None,
        ticket_draft: dict[str, Any] | None,
        session_memory: dict[str, Any] | None,
        confirm_tool: dict[str, Any] | None,
        sdk_task: str | None,
        debug: bool = False,
    ) -> tuple[str, dict[str, Any]]:
        resolved = resolve_locale(locale, self._http.config.locale)
        ticket = str(focused_ticket_id).strip() if focused_ticket_id is not None else ""
        body = compact(
            {
                "message": message,
                "locale": resolved,
                "session_id": session_id,
                "module": module,
                "page": page,
                "history": history,
                "focused_entity": _focused(focused_entity, focused_ticket_id),
                "entity_id": ticket or None,
                "ticket_draft": ticket_draft,
                "session_memory": session_memory,
                "confirm_tool": confirm_tool,
                "sdk_task": sdk_task,
                "debug": True if debug else None,
            }
        )
        return resolved, body

    def turn(
        self,
        *,
        message: str | None = None,
        locale: str | None = None,
        session_token: str | None = None,
        session_id: str | None = None,
        module: str | None = None,
        page: str | None = None,
        history: list[dict[str, Any]] | None = None,
        focused_ticket_id: str | None = None,
        focused_entity: dict[str, Any] | None = None,
        ticket_draft: dict[str, Any] | None = None,
        session_memory: dict[str, Any] | None = None,
        confirm_tool: dict[str, Any] | None = None,
        sdk_task: str | None = None,
        debug: bool = False,
        feature: str = "ai.turn",
    ):
        resolved, body = self._prepare(
            message=message,
            locale=locale,
            session_id=session_id,
            module=module,
            page=page,
            history=history,
            focused_ticket_id=focused_ticket_id,
            focused_entity=focused_entity,
            ticket_draft=ticket_draft,
            session_memory=session_memory,
            confirm_tool=confirm_tool,
            sdk_task=sdk_task,
            debug=debug,
        )
        payload = self._http.request(
            method="POST",
            path="/api/coworker/agent-turn",
            auth="accessToken",
            access_token=session_token,
            headers={"X-Worktual-Sdk-Feature": feature},
            body=body,
        )
        return to_result(payload if isinstance(payload, dict) else {}, resolved)

    def stream(
        self,
        *,
        message: str | None = None,
        locale: str | None = None,
        session_token: str | None = None,
        session_id: str | None = None,
        module: str | None = None,
        page: str | None = None,
        history: list[dict[str, Any]] | None = None,
        focused_ticket_id: str | None = None,
        focused_entity: dict[str, Any] | None = None,
        ticket_draft: dict[str, Any] | None = None,
        session_memory: dict[str, Any] | None = None,
        confirm_tool: dict[str, Any] | None = None,
        sdk_task: str | None = None,
        debug: bool = False,
        on_progress: Callable[[dict[str, Any]], None] | None = None,
    ):
        feature = "ai.tasks.createTicket" if sdk_task == "ticket.create" else "ai.stream"
        resolved, body = self._prepare(
            message=message,
            locale=locale,
            session_id=session_id,
            module=module,
            page=page,
            history=history,
            focused_ticket_id=focused_ticket_id,
            focused_entity=focused_entity,
            ticket_draft=ticket_draft,
            session_memory=session_memory,
            confirm_tool=confirm_tool,
            sdk_task=sdk_task,
            debug=debug,
        )
        text = self._http.request_text(
            method="POST",
            path="/api/coworker/agent-turn/stream",
            auth="accessToken",
            access_token=session_token,
            headers={"X-Worktual-Sdk-Feature": feature},
            body=body,
        )
        return to_result(parse_sse(text, on_progress), resolved)

    def confirm(
        self,
        *,
        confirm_tool: dict[str, Any],
        message: str | None = None,
        locale: str | None = None,
        session_token: str | None = None,
        session_id: str | None = None,
        focused_ticket_id: str | None = None,
        session_memory: dict[str, Any] | None = None,
    ):
        return self.turn(
            message=message or "confirm",
            locale=locale,
            session_token=session_token,
            session_id=session_id,
            focused_ticket_id=focused_ticket_id,
            session_memory=session_memory,
            confirm_tool=confirm_tool,
            feature="ai.confirm",
        )

    def reject(
        self,
        *,
        message: str | None = None,
        locale: str | None = None,
        session_token: str | None = None,
        session_id: str | None = None,
        focused_ticket_id: str | None = None,
        session_memory: dict[str, Any] | None = None,
    ):
        return self.turn(
            message=message or "Do not apply the pending action.",
            locale=locale,
            session_token=session_token,
            session_id=session_id,
            focused_ticket_id=focused_ticket_id,
            session_memory=session_memory,
            confirm_tool=None,
            feature="ai.reject",
        )


class TaskResource:
    def __init__(self, ai: AiResource) -> None:
        self._ai = ai

    def _run(self, task: str, *, ticket_number: str | None, message: str | None, locale: str | None, session_token: str | None, session_id: str | None, session_memory: dict[str, Any] | None):
        spec = CARD_TASKS[task]
        ticket = str(ticket_number or "").strip()
        if spec["needs_ticket"] and not ticket:
            raise TicketingApiError("ticketNumber is required", 400, None)
        provided = str(message or "").strip()
        if task == "intake.deflect" and not provided:
            raise TicketingApiError("message is required to deflect", 400, None)
        if task == "ticket.create" and not provided:
            raise TicketingApiError("message is required to create a ticket", 400, None)
        result = self._ai.turn(
            message=provided or spec["message"],
            locale=locale,
            session_token=session_token,
            session_id=session_id,
            focused_ticket_id=ticket or None,
            session_memory=session_memory,
            sdk_task=task,
            feature=spec["feature"],
        )
        return to_card(task, result)

    def _ask(self, task: str, *, message: str | None, locale: str | None, session_token: str | None, session_id: str | None, session_memory: dict[str, Any] | None):
        text = str(message or "").strip()
        if not text:
            raise TicketingApiError("message is required", 400, None)
        result = self._ai.turn(
            message=text,
            locale=locale,
            session_token=session_token,
            session_id=session_id,
            session_memory=session_memory,
            sdk_task=task,
            feature=INSIGHT_TASKS[task],
        )
        return to_insight(task, result)

    def summarize(self, *, ticket_number: str | None = None, message: str | None = None, locale: str | None = None, session_token: str | None = None, session_id: str | None = None, session_memory: dict[str, Any] | None = None):
        return self._run("ticket.summarize", ticket_number=ticket_number, message=message, locale=locale, session_token=session_token, session_id=session_id, session_memory=session_memory)

    def classify(self, *, ticket_number: str | None = None, message: str | None = None, locale: str | None = None, session_token: str | None = None, session_id: str | None = None, session_memory: dict[str, Any] | None = None):
        return self._run("ticket.classify", ticket_number=ticket_number, message=message, locale=locale, session_token=session_token, session_id=session_id, session_memory=session_memory)

    def draft_reply(self, *, ticket_number: str | None = None, message: str | None = None, locale: str | None = None, session_token: str | None = None, session_id: str | None = None, session_memory: dict[str, Any] | None = None):
        return self._run("ticket.draftReply", ticket_number=ticket_number, message=message, locale=locale, session_token=session_token, session_id=session_id, session_memory=session_memory)

    def similar(self, *, ticket_number: str | None = None, message: str | None = None, locale: str | None = None, session_token: str | None = None, session_id: str | None = None, session_memory: dict[str, Any] | None = None):
        return self._run("ticket.similar", ticket_number=ticket_number, message=message, locale=locale, session_token=session_token, session_id=session_id, session_memory=session_memory)

    def recommend_kb(self, *, ticket_number: str | None = None, message: str | None = None, locale: str | None = None, session_token: str | None = None, session_id: str | None = None, session_memory: dict[str, Any] | None = None):
        return self._run("ticket.kb", ticket_number=ticket_number, message=message, locale=locale, session_token=session_token, session_id=session_id, session_memory=session_memory)

    def deflect(self, *, message: str | None = None, locale: str | None = None, session_token: str | None = None, session_id: str | None = None, session_memory: dict[str, Any] | None = None, ticket_number: str | None = None):
        return self._run("intake.deflect", ticket_number=ticket_number, message=message, locale=locale, session_token=session_token, session_id=session_id, session_memory=session_memory)

    def create_ticket(self, *, message: str | None = None, locale: str | None = None, session_token: str | None = None, session_id: str | None = None, session_memory: dict[str, Any] | None = None, ticket_number: str | None = None):
        return self._run("ticket.create", ticket_number=ticket_number, message=message, locale=locale, session_token=session_token, session_id=session_id, session_memory=session_memory)

    def assign(self, *, ticket_number: str | None = None, message: str | None = None, locale: str | None = None, session_token: str | None = None, session_id: str | None = None, session_memory: dict[str, Any] | None = None):
        return self._run("ticket.assign", ticket_number=ticket_number, message=message, locale=locale, session_token=session_token, session_id=session_id, session_memory=session_memory)

    def resolve_suggest(self, *, ticket_number: str | None = None, message: str | None = None, locale: str | None = None, session_token: str | None = None, session_id: str | None = None, session_memory: dict[str, Any] | None = None):
        return self._run("ticket.resolveSuggest", ticket_number=ticket_number, message=message, locale=locale, session_token=session_token, session_id=session_id, session_memory=session_memory)

    def quality_check(self, *, ticket_number: str | None = None, message: str | None = None, locale: str | None = None, session_token: str | None = None, session_id: str | None = None, session_memory: dict[str, Any] | None = None):
        return self._run("ticket.quality", ticket_number=ticket_number, message=message, locale=locale, session_token=session_token, session_id=session_id, session_memory=session_memory)

    def sla_advise(self, *, ticket_number: str | None = None, message: str | None = None, locale: str | None = None, session_token: str | None = None, session_id: str | None = None, session_memory: dict[str, Any] | None = None):
        return self._run("sla.advise", ticket_number=ticket_number, message=message, locale=locale, session_token=session_token, session_id=session_id, session_memory=session_memory)

    def workload(self, *, message: str | None = None, locale: str | None = None, session_token: str | None = None, session_id: str | None = None, session_memory: dict[str, Any] | None = None, ticket_number: str | None = None):
        return self._run("ticket.workload", ticket_number=ticket_number, message=message, locale=locale, session_token=session_token, session_id=session_id, session_memory=session_memory)

    def ask_metrics(self, *, message: str | None = None, locale: str | None = None, session_token: str | None = None, session_id: str | None = None, session_memory: dict[str, Any] | None = None):
        return self._ask("analytics.ask", message=message, locale=locale, session_token=session_token, session_id=session_id, session_memory=session_memory)

    def ask_why(self, *, message: str | None = None, locale: str | None = None, session_token: str | None = None, session_id: str | None = None, session_memory: dict[str, Any] | None = None):
        return self._ask("analytics.why", message=message, locale=locale, session_token=session_token, session_id=session_id, session_memory=session_memory)

    def list_tickets(self, *, message: str | None = None, locale: str | None = None, session_token: str | None = None, session_id: str | None = None, session_memory: dict[str, Any] | None = None):
        return self._ask("ticket.list", message=message, locale=locale, session_token=session_token, session_id=session_id, session_memory=session_memory)


class ProposalResource:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def list(
        self,
        *,
        ticket_number: str | None = None,
        status: str | None = None,
        session_token: str | None = None,
    ) -> ProposalList:
        payload = self._http.request(
            method="GET",
            path="/api/sdk/proposals",
            auth="accessToken",
            access_token=session_token,
            headers={"X-Worktual-Sdk-Feature": "ai.proposals.list"},
            query={"ticketNumber": ticket_number, "status": status},
        )
        items = payload.get("items") if isinstance(payload, dict) else None
        rows = [_proposal(item) for item in items if isinstance(item, dict)] if isinstance(items, list) else []
        return ProposalList(items=rows)

    def decide(
        self,
        *,
        id: str,
        decision: str,
        edits: dict[str, Any] | None = None,
        session_token: str | None = None,
    ) -> ProposalDecision:
        proposal_id = str(id or "").strip()
        if not _PROPOSAL_ID.fullmatch(proposal_id):
            raise TicketingApiError("Proposal id must look like approval:1 or recommendation:1", 400, None)
        if decision not in ("confirm", "reject"):
            raise TicketingApiError("decision must be confirm or reject", 400, None)
        feature = "ai.proposals.confirm" if decision == "confirm" else "ai.proposals.reject"
        payload = self._http.request(
            method="POST",
            path=f"/api/sdk/proposals/{urllib.parse.quote(proposal_id, safe='')}/decide",
            auth="accessToken",
            access_token=session_token,
            headers={"X-Worktual-Sdk-Feature": feature},
            body=compact({"decision": decision, "edits": edits}),
        )
        row = payload if isinstance(payload, dict) else {}
        return ProposalDecision(id=str(row.get("id") or proposal_id), ok=bool(row.get("ok")), status=str(row.get("status") or ""))


class InboxResource:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def list(self, session_token: str | None = None) -> InboxList:
        payload = self._http.request(
            method="GET",
            path="/api/notifications",
            auth="accessToken",
            access_token=session_token,
        )
        rows = payload if isinstance(payload, list) else []
        if isinstance(payload, dict) and isinstance(payload.get("items"), list):
            rows = payload["items"]
        items: list[InboxItem] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            item_id = str(row.get("id") or "").strip()
            if not item_id:
                continue
            ticket = row.get("ticketNumber") or row.get("ticketId") or row.get("ticket_number")
            items.append(
                InboxItem(
                    id=item_id,
                    title=str(row.get("title") or ""),
                    message=str(row.get("message") or ""),
                    read=bool(row.get("read") if row.get("read") is not None else row.get("is_read")),
                    ticket_number=str(ticket) if ticket is not None and str(ticket).strip() else None,
                    created_at=str(row["createdAt"]) if row.get("createdAt") is not None else None,
                    kind=str(row["kind"]) if row.get("kind") is not None else None,
                )
            )
        return InboxList(items=items)

    def mark_read(self, item_id: str, session_token: str | None = None) -> dict[str, Any]:
        payload = self._http.request(
            method="PATCH",
            path=f"/api/notifications/{urllib.parse.quote(str(item_id), safe='')}/read",
            auth="accessToken",
            access_token=session_token,
        )
        return payload if isinstance(payload, dict) else {"ok": True}

    def mark_all_read(self, session_token: str | None = None) -> dict[str, Any]:
        payload = self._http.request(
            method="POST",
            path="/api/notifications/read-all",
            auth="accessToken",
            access_token=session_token,
        )
        return payload if isinstance(payload, dict) else {"ok": True}


def _widget(row: dict[str, Any]) -> HelpWidget:
    origins = row.get("allowedOrigins")
    return HelpWidget(
        id=str(row.get("id") or ""),
        public_id=str(row.get("publicId") or ""),
        name=str(row.get("name") or ""),
        organization_id=str(row.get("organizationId") or ""),
        button_label=str(row.get("buttonLabel") or "Help"),
        enabled=bool(row.get("enabled", True)),
        allowed_origins=[str(item) for item in origins] if isinstance(origins, list) else [],
    )


def _widget_created(payload: dict[str, Any]) -> HelpWidgetCreated:
    widget = payload.get("widget") if isinstance(payload.get("widget"), dict) else {}
    embed = payload.get("embed") if isinstance(payload.get("embed"), dict) else {}
    return HelpWidgetCreated(
        widget=_widget(widget),
        embed=HelpWidgetEmbed(script=str(embed.get("script") or ""), iframe=str(embed.get("iframe") or "")),
    )


class WidgetResource:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def list(self, *, tenant_id: str | None = None) -> list[HelpWidget]:
        payload = self._http.request(
            method="GET",
            path="/api/sdk/widgets",
            auth="partnerKey",
            query={"tenantId": tenant_id},
        )
        raw = payload.get("widgets") if isinstance(payload, dict) else None
        if not isinstance(raw, list):
            return []
        return [_widget(item) for item in raw if isinstance(item, dict)]

    def create(
        self,
        *,
        name: str | None = None,
        button_label: str | None = None,
        allowed_origins: list[str] | None = None,
        tenant_id: str | None = None,
    ) -> HelpWidgetCreated:
        payload = self._http.request(
            method="POST",
            path="/api/sdk/widgets",
            auth="partnerKey",
            body=compact(
                {
                    "name": name,
                    "buttonLabel": button_label,
                    "allowedOrigins": allowed_origins,
                    "tenantId": tenant_id,
                }
            ),
        )
        return _widget_created(payload if isinstance(payload, dict) else {})

    def update(
        self,
        widget_id: str,
        *,
        name: str | None = None,
        button_label: str | None = None,
        allowed_origins: list[str] | None = None,
        enabled: bool | None = None,
        tenant_id: str | None = None,
    ) -> HelpWidgetCreated:
        payload = self._http.request(
            method="PATCH",
            path=f"/api/sdk/widgets/{urllib.parse.quote(widget_id)}",
            auth="partnerKey",
            body=compact(
                {
                    "name": name,
                    "buttonLabel": button_label,
                    "allowedOrigins": allowed_origins,
                    "enabled": enabled,
                    "tenantId": tenant_id,
                }
            ),
        )
        return _widget_created(payload if isinstance(payload, dict) else {})

    def get_public(self, public_id: str) -> dict[str, Any]:
        payload = self._http.request(
            method="GET",
            path=f"/api/public/widgets/{urllib.parse.quote(public_id)}",
            auth="none",
        )
        return payload if isinstance(payload, dict) else {}

    def submit_ticket(self, public_id: str, body: dict[str, Any]) -> dict[str, Any]:
        payload = self._http.request(
            method="POST",
            path=f"/api/public/widgets/{urllib.parse.quote(public_id)}/tickets",
            auth="none",
            body=body,
        )
        return payload if isinstance(payload, dict) else {}


class TicketingClient:
    def __init__(self, http: HttpClient) -> None:
        self.auth = AuthResource(http)
        self.usage = UsageResource(http)
        self.ai = AiResource(http)
        self.inbox = InboxResource(http)
        self.widgets = WidgetResource(http)


def create_ticketing_client(
    *,
    base_url: str,
    api_key: str = "",
    partner_api_key: str = "",
    access_token: str = "",
    locale: str = "en",
    surface: str = "",
    component: str = "",
    transport: Transport | None = None,
) -> TicketingClient:
    config = TicketingConfig(
        base_url=normalize_base_url(base_url),
        api_key=api_key,
        partner_api_key=partner_api_key,
        access_token=access_token,
        locale=locale or "en",
        surface=surface,
        component=component,
    )
    return TicketingClient(HttpClient(config, transport))
