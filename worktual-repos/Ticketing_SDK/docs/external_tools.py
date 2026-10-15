"""External tool calls only.

The caller sends an org API key (wt_live_…) and the business fields.
This module does not take a session, organization id, or actor id.
POST {MCP_BASE_URL}/invoke with Authorization: Bearer <key>.

MCP_BASE_URL defaults to http://127.0.0.1:8020.
Set EXTERNAL_API_KEY or pass api_key= to ExternalTools.

Queue, priority, and status writes are included. An external key is resolved
as an Active agent, so those six calls are rejected by the API (403).
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any


def _drop_empty(values: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in values.items():
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        if isinstance(value, (list, tuple)) and len(value) == 0:
            continue
        out[key] = value
    return out


class ExternalTools:
    def __init__(self, api_key: str | None = None, mcp_base_url: str | None = None) -> None:
        key = (api_key or os.environ.get("EXTERNAL_API_KEY") or "").strip()
        if not key.startswith("wt_live_"):
            raise ValueError("api_key must be an org key starting with wt_live_")
        self.api_key = key
        self.mcp_base_url = (
            mcp_base_url or os.environ.get("MCP_BASE_URL") or "http://127.0.0.1:8020"
        ).rstrip("/")

    def call(self, name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        """POST /invoke. Returns the JSON object from the MCP server."""
        body = json.dumps(
            {"name": name, "arguments": _drop_empty(arguments or {})}
        ).encode("utf-8")
        request = urllib.request.Request(
            f"{self.mcp_base_url}/invoke",
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                parsed = {"success": False, "message": raw, "error_code": "HTTP_ERROR"}
            if isinstance(parsed, dict):
                parsed.setdefault("success", False)
                parsed.setdefault("http_status", exc.code)
                return parsed
            return {"success": False, "message": raw, "http_status": exc.code}
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            return {"success": False, "message": raw}
        return parsed if isinstance(parsed, dict) else {"success": True, "payload": parsed}

    # --- lookups the writes need (same API key, no session argument) ---

    def list_agents(self) -> dict[str, Any]:
        """Staff ids for escalate_ticket and create_queue / update_queue."""
        return self.call("list_agents", {})

    def list_queues(self, query: str = "") -> dict[str, Any]:
        """Team ids for update_queue. Optional name search."""
        return self.call("list_queues", {"query": query})

    def list_kb(self, query: str = "", category: str = "", status: str = "") -> dict[str, Any]:
        """Article ids for update_kb_article and publish_kb_article."""
        return self.call("list_kb", {"query": query, "category": category, "status": status})

    def get_kb(self, article_id: str) -> dict[str, Any]:
        return self.call("get_kb", {"article_id": article_id})

    def list_priorities(self, include_inactive: bool = False) -> dict[str, Any]:
        """Priority ids for update_priority. External agent can read; update is admin."""
        return self.call("list_priorities", {"include_inactive": include_inactive})

    def list_statuses(self, include_inactive: bool = False) -> dict[str, Any]:
        """Status ids for update_status. External agent can read; update is admin."""
        return self.call("list_statuses", {"include_inactive": include_inactive})

    # --- the 14 tools ---

    def verify_ticket_customer(
        self,
        *,
        customer_email: str = "",
        customer_phone: str = "",
        customer_name: str = "",
        contact: str = "",
    ) -> dict[str, Any]:
        """Match a directory customer by email, phone, or a single contact string."""
        if not any(str(v).strip() for v in (customer_email, customer_phone, contact)):
            raise ValueError("pass customer_email, customer_phone, or contact")
        return self.call(
            "verify_ticket_customer",
            {
                "customerEmail": customer_email,
                "customerPhone": customer_phone,
                "customerName": customer_name,
                "contact": contact,
            },
        )

    def create_ticket(
        self,
        *,
        customer_name: str = "",
        customer_id: str = "",
        customer_email: str = "",
        customer_phone: str = "",
        description: str = "",
        subject: str = "",
    ) -> dict[str, Any]:
        """File a ticket. customer_id comes from verify_ticket_customer, not from the caller."""
        if not customer_name.strip() and not subject.strip():
            raise ValueError("customer_name or subject is required")
        if not any(str(v).strip() for v in (customer_id, customer_email, customer_phone)):
            raise ValueError("customer_id, customer_email, or customer_phone is required")
        return self.call(
            "create_ticket",
            {
                "customerName": customer_name,
                "customerId": customer_id,
                "customerEmail": customer_email,
                "customerPhone": customer_phone,
                "description": description,
                "subject": subject,
            },
        )

    def escalate_ticket(
        self,
        *,
        ticket_number: str,
        assignee_id: str = "",
        assignee: str = "",
        agent_id: str = "",
        agent: str = "",
        rationale: str = "",
    ) -> dict[str, Any]:
        """Escalate one ticket. assignee_id / agent_id come from list_agents."""
        if not str(ticket_number).strip():
            raise ValueError("ticket_number is required")
        return self.call(
            "escalate_ticket",
            {
                "ticket_number": ticket_number,
                "assignee_id": assignee_id,
                "assignee": assignee,
                "agent_id": agent_id,
                "agent": agent,
                "rationale": rationale,
            },
        )

    def add_ticket_note(
        self,
        *,
        ticket_number: str,
        text: str,
        visibility: str = "internal",
        send_customer_email: bool = False,
    ) -> dict[str, Any]:
        if not str(ticket_number).strip() or not str(text).strip():
            raise ValueError("ticket_number and text are required")
        return self.call(
            "add_ticket_note",
            {
                "ticket_number": ticket_number,
                "text": text,
                "visibility": visibility,
                "send_customer_email": send_customer_email,
            },
        )

    def create_queue(
        self,
        *,
        name: str,
        description: str,
        member_ids: list[str],
    ) -> dict[str, Any]:
        """Admin only. External API-key sessions are agents and receive 403."""
        ids = [str(item).strip() for item in member_ids if str(item).strip()]
        if not name.strip() or not description.strip() or not ids:
            raise ValueError("name, description, and member_ids are required")
        return self.call(
            "create_queue",
            {"name": name, "description": description, "member_ids": ids},
        )

    def update_queue(
        self,
        *,
        queue_id: str,
        name: str = "",
        description: str = "",
        member_ids: list[str] | None = None,
        add_members: bool = False,
    ) -> dict[str, Any]:
        """Admin only. queue_id comes from list_queues. External agent receives 403."""
        if not str(queue_id).strip():
            raise ValueError("queue_id is required")
        args: dict[str, Any] = {
            "queue_id": queue_id,
            "name": name,
            "description": description,
        }
        if member_ids is not None:
            args["member_ids"] = [str(item).strip() for item in member_ids if str(item).strip()]
            args["add_members"] = add_members
        if not any(k != "queue_id" and args.get(k) not in (None, "", False, []) for k in args):
            raise ValueError("pass name, description, or member_ids")
        return self.call("update_queue", args)

    def create_kb_article(self, *, title: str, content: str, category: str) -> dict[str, Any]:
        if len(title.strip()) < 2 or len(content.strip()) < 10 or not category.strip():
            raise ValueError("title (min 2), content (min 10), and category are required")
        return self.call(
            "create_kb_article",
            {"title": title, "content": content, "category": category},
        )

    def draft_kb_article(self, *, title: str, content: str, category: str) -> dict[str, Any]:
        if len(title.strip()) < 2 or len(content.strip()) < 10 or not category.strip():
            raise ValueError("title (min 2), content (min 10), and category are required")
        return self.call(
            "draft_kb_article",
            {"title": title, "content": content, "category": category},
        )

    def update_kb_article(
        self,
        *,
        article_id: str,
        title: str = "",
        content: str = "",
        category: str = "",
        status: str = "",
    ) -> dict[str, Any]:
        """article_id comes from list_kb or get_kb (id or KB- external id)."""
        if not str(article_id).strip():
            raise ValueError("article_id is required")
        args = _drop_empty(
            {
                "article_id": article_id,
                "title": title,
                "content": content,
                "category": category,
                "status": status,
            }
        )
        if list(args.keys()) == ["article_id"]:
            raise ValueError("pass title, content, category, or status")
        return self.call("update_kb_article", args)

    def publish_kb_article(self, *, article_id: str) -> dict[str, Any]:
        """article_id comes from list_kb or the create/draft response."""
        if not str(article_id).strip():
            raise ValueError("article_id is required")
        return self.call(
            "publish_kb_article",
            {"article_id": article_id, "status": "Published"},
        )

    def create_priority(self, *, display_name: str, resolution_hours: float) -> dict[str, Any]:
        """Admin only. External agent receives 403."""
        if not display_name.strip() or float(resolution_hours) <= 0:
            raise ValueError("display_name and resolution_hours > 0 are required")
        return self.call(
            "create_priority",
            {"display_name": display_name, "resolution_hours": float(resolution_hours)},
        )

    def update_priority(
        self,
        *,
        priority_id: str,
        display_name: str = "",
        resolution_hours: float | None = None,
        active: bool | None = None,
    ) -> dict[str, Any]:
        """Admin only. priority_id comes from list_priorities."""
        if not str(priority_id).strip():
            raise ValueError("priority_id is required")
        args: dict[str, Any] = {"priority_id": priority_id}
        if display_name.strip():
            args["displayName"] = display_name.strip()
        if resolution_hours is not None:
            args["resolutionHours"] = float(resolution_hours)
        if active is not None:
            args["active"] = bool(active)
        if len(args) == 1:
            raise ValueError("pass display_name, resolution_hours, or active")
        return self.call("update_priority", args)

    def create_status(self, *, display_name: str) -> dict[str, Any]:
        """Admin only. External agent receives 403."""
        if not display_name.strip():
            raise ValueError("display_name is required")
        return self.call("create_status", {"display_name": display_name})

    def update_status(
        self,
        *,
        status_id: str,
        display_name: str = "",
        active: bool | None = None,
    ) -> dict[str, Any]:
        """Admin only. status_id comes from list_statuses."""
        if not str(status_id).strip():
            raise ValueError("status_id is required")
        args: dict[str, Any] = {"status_id": status_id}
        if display_name.strip():
            args["displayName"] = display_name.strip()
        if active is not None:
            args["active"] = bool(active)
        if len(args) == 1:
            raise ValueError("pass display_name or active")
        return self.call("update_status", args)
