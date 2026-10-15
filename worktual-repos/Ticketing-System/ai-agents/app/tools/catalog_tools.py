"""Catalog domain tools (queues, KB, customers, metrics, org prefs).

Express path by default; MCP when tools_transport=mcp. Tickets/macros stay in
ticket_*/macro_write.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from app.contracts import tool_err, tool_ok
from app.tools.express_client import express_request
from app.tools.transport import invoke_tool


def catalog_row_id_usable(raw: Any) -> str:
    """Numeric catalog row id from list_* tools. Empty for labels or invented placeholders."""
    text = str(raw or "").strip()
    if entity_ref_invented(text):
        return ""
    if text.isdigit() and 1 <= len(text) <= 18:
        return text
    return ""


def entity_ref_invented(raw: Any) -> bool:
    """True when a tool id is a model-invented token, not a DB key."""
    text = str(raw or "").strip()
    if not text:
        return False
    low = text.lower().replace("-", "_")
    if "placeholder" in low:
        return True
    if low.startswith(("fake_", "dummy_", "example_", "todo_", "sample_")):
        return True
    return low in {"tbd", "n/a", "na", "null", "undefined", "unknown", "none"}


# ---- Queues / teams ----


def create_queue(
    *,
    name: str,
    description: str = "",
    member_ids: list[str] | None = None,
    members: list[str] | None = None,
) -> dict[str, Any]:
    """Create via POST /api/queues (same as AgentQueuesView)."""
    n = (name or "").strip()
    if not n:
        return tool_err("BAD_INPUT", "queue name is required")
    member_names = [str(x).strip() for x in (members or []) if str(x).strip()]
    member_id_list = [str(x).strip() for x in (member_ids or []) if str(x).strip()]
    if not member_names and not member_id_list:
        return tool_err(
            "BAD_INPUT",
            "At least one team member is required. List available staff and ask "
            "the user to pick names — do not create an empty team.",
        )
    body: dict[str, Any] = {
        "queueName": n,
        "description": (description or "").strip(),
    }
    if member_id_list:
        body["memberIds"] = member_id_list
    if member_names:
        body["members"] = member_names
    args: dict[str, Any] = {
        "name": n,
        "description": (description or "").strip(),
    }
    if member_id_list:
        args["member_ids"] = member_id_list
    if member_names:
        args["members"] = member_names

    def _express() -> dict[str, Any]:
        return express_request("POST", "/api/queues", json_body=body)

    return invoke_tool("create_queue", args, express_call=_express)


def update_queue(
    queue_id: str,
    *,
    name: str | None = None,
    description: str | None = None,
    member_ids: list[str] | None = None,
    members: list[str] | None = None,
    add_members: bool = False,
) -> dict[str, Any]:
    qid = catalog_row_id_usable(queue_id)
    if not qid:
        return tool_err(
            "BAD_INPUT",
            "queue id must be the numeric id from list_queues. "
            "Do not invent placeholders.",
        )
    body: dict[str, Any] = {}
    if name is not None:
        body["queueName"] = name
    if description is not None:
        body["description"] = description
    if member_ids is not None:
        body["memberIds"] = [str(x) for x in member_ids]
    if members is not None:
        body["members"] = [str(x).strip() for x in members if str(x).strip()]
    # Append flag applies to either memberIds or members (add-to-team vs replace roster).
    if add_members and (member_ids is not None or members is not None):
        body["addMembers"] = True
    if not body:
        return tool_err("BAD_INPUT", "no fields to update")
    args: dict[str, Any] = {"queue_id": qid}
    if name is not None:
        args["name"] = name
    if description is not None:
        args["description"] = description
    if member_ids is not None:
        args["member_ids"] = [str(x) for x in member_ids]
    if members is not None:
        args["members"] = [str(x).strip() for x in members if str(x).strip()]
    if add_members and (member_ids is not None or members is not None):
        args["add_members"] = True

    def _express() -> dict[str, Any]:
        return express_request(
            "PATCH",
            f"/api/queues/{quote(qid, safe='')}",
            json_body=body,
        )

    return invoke_tool("update_queue", args, express_call=_express)


def delete_queue(queue_id: str) -> dict[str, Any]:
    qid = catalog_row_id_usable(queue_id)
    if not qid:
        return tool_err(
            "BAD_INPUT",
            "queue id must be the numeric id from list_queues. "
            "Do not invent placeholders.",
        )

    def _express() -> dict[str, Any]:
        return express_request("DELETE", f"/api/queues/{quote(qid, safe='')}")

    return invoke_tool("delete_queue", {"queue_id": qid}, express_call=_express)


# ---- Knowledge base ----


def create_kb_article(
    *,
    title: str,
    content: str,
    category: str,
    author: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    """Create via POST /api/kb (same as KnowledgeBaseView)."""
    t = (title or "").strip()
    c = (content or "").strip()
    cat = (category or "").strip()
    if not t or not c or not cat:
        return tool_err("BAD_INPUT", "title, content, and category are required")
    body: dict[str, Any] = {"title": t, "content": c, "category": cat}
    if author:
        body["author"] = author
    st = str(status or "").strip().lower()
    if st == "draft":
        body["status"] = "Draft"
    elif st == "published":
        body["status"] = "Published"
    args = dict(body)

    def _express() -> dict[str, Any]:
        return express_request("POST", "/api/kb", json_body=body)

    return invoke_tool("create_kb_article", args, express_call=_express)


def get_kb(article_id: str) -> dict[str, Any]:
    aid = catalog_row_id_usable(article_id)
    if not aid:
        return tool_err(
            "BAD_INPUT",
            "article id must be the numeric id from list_kb. "
            "Do not invent placeholders.",
        )

    def _express() -> dict[str, Any]:
        from app.tools.express_client import get_tool_actor

        actor = get_tool_actor()
        role = (actor.user_role or "") if actor else ""
        if role.startswith("portal"):
            return express_request(
                "GET",
                f"/api/internal/portal/kb/{quote(aid, safe='')}",
            )
        return express_request("GET", f"/api/kb/{quote(aid, safe='')}")

    return invoke_tool("get_kb", {"article_id": aid}, express_call=_express)


def update_kb_article(
    article_id: str,
    *,
    title: str | None = None,
    content: str | None = None,
    category: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    aid = catalog_row_id_usable(article_id)
    if not aid:
        return tool_err(
            "BAD_INPUT",
            "article id must be the numeric id from list_kb. "
            "Do not invent placeholders.",
        )
    body: dict[str, Any] = {}
    if title is not None:
        body["title"] = title
    if content is not None:
        body["content"] = content
    if category is not None:
        body["category"] = category
    if status is not None:
        body["status"] = status
    if not body:
        return tool_err("BAD_INPUT", "no fields to update")

    def _express() -> dict[str, Any]:
        return express_request(
            "PATCH", f"/api/kb/{quote(aid, safe='')}", json_body=body
        )

    return invoke_tool(
        "update_kb_article", {"article_id": aid, **body}, express_call=_express
    )


def publish_kb_article(article_id: str) -> dict[str, Any]:
    return update_kb_article(article_id, status="Published")


# ---- Reads (customers = list/search parity only; no create) ----


def list_queues(*, query: str | None = None) -> dict[str, Any]:
    params: dict[str, Any] = {}
    if query:
        params["q"] = str(query).strip()

    def _express() -> dict[str, Any]:
        return express_request("GET", "/api/queues", params=params or None)

    return invoke_tool("list_queues", params, express_call=_express)


def list_agents() -> dict[str, Any]:
    """Active assignable staff via GET /api/agents (same roster the Teams form uses)."""

    def _express() -> dict[str, Any]:
        return express_request("GET", "/api/agents")

    return invoke_tool("list_agents", {}, express_call=_express)


def resolve_ticket_person(
    *,
    response: str | None = None,
    ticket_number: str | None = None,
    target_role: str | None = None,
    user_query: str | None = None,
    proceed: int = 0,
) -> dict[str, Any]:
    """Fetch live org agents/resolvers for reassign/escalate (AGENT_TRANSFER-style).

    Read-only: returns person_data from the DB (skills + open workload when available).
    When ticket_number is set, also suggests an optimal agent/resolver via skill match.
    Interpretation of short/misspelled names belongs to the specialist LLM
    against this roster; confirm before calling update_ticket / escalate_ticket.
    """
    role = str(target_role or "").strip().lower()
    if role in {"", "any", "all"}:
        role = ""
    if role and role not in {"agent", "resolver", "admin"}:
        role = ""
    query = str(user_query or "").strip()
    tn = str(ticket_number or "").strip()
    msg = str(response or "").strip()
    proceed_flag = 1 if int(proceed or 0) == 1 else 0
    args: dict[str, Any] = {
        "response": msg,
        "ticket_number": tn,
        "target_role": role,
        "user_query": query,
        "proceed": proceed_flag,
    }

    def _express() -> dict[str, Any]:
        listed = express_request("GET", "/api/agents")
        if not listed.get("success"):
            return listed
        payload = listed.get("payload")
        rows: list[Any]
        if isinstance(payload, list):
            rows = payload
        elif isinstance(payload, dict):
            rows = (
                payload.get("data")
                or payload.get("agents")
                or payload.get("items")
                or payload.get("rows")
                or []
            )
        else:
            rows = []

        # Live open workload from Ticketing DB (assignee + resolver columns).
        workload_agent: dict[str, int] = {}
        workload_resolver: dict[str, int] = {}
        org = ""
        try:
            from app.tools.express_client import get_tool_actor
            from app.tasks.assign import (
                open_workload_by_assignee,
                open_workload_by_resolver,
            )

            actor = get_tool_actor()
            org = str((actor.organization_id if actor else "") or "").strip()
            if org:
                workload_agent = open_workload_by_assignee(org)
                workload_resolver = open_workload_by_resolver(org)
        except Exception:  # noqa: BLE001
            pass

        person_data: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or "").strip()
            if not name:
                continue
            r = str(row.get("role") or "").strip().lower()
            if role and r and r != role and not (role == "agent" and r == "admin"):
                continue
            skills_raw = row.get("skills")
            skills: list[str] = []
            if isinstance(skills_raw, list):
                skills = [str(s).strip() for s in skills_raw if str(s).strip()]
            elif isinstance(skills_raw, str) and skills_raw.strip():
                skills = [s.strip() for s in skills_raw.split(",") if s.strip()]
            open_count = 0
            if r == "resolver":
                open_count = int(workload_resolver.get(name, 0) or 0)
            else:
                open_count = int(workload_agent.get(name, 0) or 0)
            person_data.append(
                {
                    "person_name": name,
                    "person_id": str(row.get("id") or "").strip(),
                    "email": str(row.get("email") or "").strip(),
                    "role": r or str(row.get("role") or "").strip(),
                    "skills": skills,
                    "open_workload": open_count,
                    "agent_status": "Active",
                }
            )
        person_data.sort(key=lambda p: str(p.get("person_name") or "").lower())

        suggested: dict[str, Any] | None = None
        ticket_subject = ""
        ticket_description = ""
        ticket_queue = ""
        if tn and org:
            try:
                from app.tools.ticket_read import get_ticket
                from app.tasks.assign import skill_pick_agent_and_resolver

                got = get_ticket(tn)
                row_t: dict[str, Any] | None = None
                if isinstance(got, dict) and got.get("success"):
                    pl = got.get("payload")
                    if isinstance(pl, dict):
                        data = pl.get("data") if isinstance(pl.get("data"), dict) else pl
                        if isinstance(data, dict):
                            row_t = data
                        elif isinstance(pl.get("data"), list) and pl["data"]:
                            row_t = pl["data"][0] if isinstance(pl["data"][0], dict) else None
                if row_t:
                    ticket_subject = str(row_t.get("subject") or "").strip()
                    ticket_description = str(
                        row_t.get("description") or row_t.get("issue") or ""
                    ).strip()
                    ticket_queue = str(row_t.get("queue") or row_t.get("team") or "").strip()
                pick = skill_pick_agent_and_resolver(
                    org_id=org,
                    skill_hint=query or ticket_subject or ticket_description,
                    queue=ticket_queue,
                    ticket_subject=ticket_subject,
                    ticket_description=ticket_description,
                    use_llm=False,
                )
                want_role = role or "agent"
                if want_role == "resolver":
                    s_name = str(pick.get("resolver") or pick.get("resolver_name") or "").strip()
                    s_id = str(pick.get("resolver_id") or "").strip()
                    rationale = str(pick.get("rationale") or "").strip()
                else:
                    s_name = str(pick.get("agent") or pick.get("agent_name") or "").strip()
                    s_id = str(pick.get("agent_id") or "").strip()
                    rationale = str(pick.get("rationale") or "").strip()
                if s_name:
                    match = next(
                        (
                            p
                            for p in person_data
                            if str(p.get("person_name") or "").lower() == s_name.lower()
                        ),
                        None,
                    )
                    suggested = {
                        "person_name": s_name,
                        "person_id": s_id or (match or {}).get("person_id") or "",
                        "role": want_role,
                        "rationale": rationale
                        or "ITRA best skill/workload match from the live roster.",
                        "skills": list((match or {}).get("skills") or []),
                        "open_workload": int((match or {}).get("open_workload") or 0),
                        "via": "itra",
                    }
            except Exception:  # noqa: BLE001
                suggested = None

        if not person_data:
            return tool_ok(
                {
                    "response": msg or "No agents are available currently.",
                    "person_data": [],
                    "suggested_person": None,
                    "proceed": 0,
                    "ticket_number": tn or None,
                    "target_role": role or None,
                    "user_query": query or None,
                }
            )
        lead = ""
        if suggested and suggested.get("person_name"):
            lead = (
                f"Suggested: {suggested['person_name']} "
                f"({suggested.get('rationale') or 'best match'}). "
            )
        return tool_ok(
            {
                "response": msg
                or (
                    f"{lead}"
                    "Live assignable staff loaded with skills and open workload. "
                    "Show the full selectable list; resolve short or misspelled "
                    "names only against person_data; ask Did you mean <name>? "
                    "when uncertain; never invent people."
                ),
                "person_data": person_data,
                "suggested_person": suggested,
                "proceed": proceed_flag if person_data else 0,
                "ticket_number": tn or None,
                "target_role": role or None,
                "user_query": query or None,
            }
        )

    return invoke_tool("resolve_ticket_person", args, express_call=_express)


def list_kb(
    *,
    query: str | None = None,
    category: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    params: dict[str, Any] = {}
    if query:
        params["q"] = str(query).strip()
    if category:
        params["category"] = str(category).strip()
    if status:
        params["status"] = str(status).strip()

    def _express() -> dict[str, Any]:
        from app.tools.express_client import get_tool_actor

        actor = get_tool_actor()
        role = (actor.user_role or "") if actor else ""
        if role.startswith("portal"):
            portal_params = dict(params or {})
            portal_params.setdefault("limit", 50)
            return express_request(
                "GET",
                "/api/internal/portal/kb",
                params=portal_params or None,
            )
        return express_request("GET", "/api/kb", params=params or None)

    return invoke_tool("list_kb", params, express_call=_express)


def list_kb_categories() -> dict[str, Any]:
    """Distinct categories from live KB articles (plus common defaults)."""
    listed = list_kb()
    if not listed.get("success"):
        return listed
    payload = listed.get("payload")
    rows: list[Any]
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        rows = (
            payload.get("data")
            or payload.get("articles")
            or payload.get("items")
            or payload.get("rows")
            or []
        )
    else:
        rows = []
    cats: list[str] = []
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = str(row.get("category") or "").strip()
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        cats.append(name)
    for default in ("General", "Billing", "Troubleshooting", "Accounts"):
        if default.lower() not in seen:
            cats.append(default)
            seen.add(default.lower())
    cats.sort(key=lambda s: s.lower())
    return invoke_tool(
        "list_kb_categories",
        {},
        express_call=lambda: tool_ok({"categories": cats, "count": len(cats)}),
    )


def manage_kb_category(*, name: str, mode: str = "add") -> dict[str, Any]:
    """Add a category label for filters (persists when an article uses it)."""
    mode_l = str(mode or "add").strip().lower()
    if mode_l in {"list", "list_categories"}:
        return list_kb_categories()
    label = str(name or "").strip()
    if not label:
        return tool_err("BAD_INPUT", "category name is required")
    if len(label) > 64:
        return tool_err("BAD_INPUT", "category name is too long")
    return invoke_tool(
        "manage_kb_category",
        {"name": label, "mode": "add"},
        express_call=lambda: tool_ok(
            {
                "category": label,
                "added": True,
                "ui_action": "add_kb_category",
                "note": "Category will appear in KB filters; create an article with it to store it in the database.",
            }
        ),
    )


def export_kb(*, fmt: str = "json", category: str | None = None) -> dict[str, Any]:
    """Export KB articles for download (UI builds the file from the payload)."""
    format_l = str(fmt or "json").strip().lower()
    if format_l not in {"json", "csv"}:
        format_l = "json"
    listed = list_kb(category=category)
    if not listed.get("success"):
        return listed
    payload = listed.get("payload")
    rows: list[Any]
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        rows = (
            payload.get("data")
            or payload.get("articles")
            or payload.get("items")
            or payload.get("rows")
            or []
        )
    else:
        rows = []
    articles: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        articles.append(
            {
                "id": str(row.get("id") or "").strip(),
                "title": str(row.get("title") or "").strip(),
                "content": str(row.get("content") or row.get("body") or "").strip(),
                "category": str(row.get("category") or "").strip(),
                "status": str(row.get("status") or "").strip(),
                "author": str(row.get("author") or row.get("authorName") or "").strip(),
                "views": int(row.get("views") or 0),
            }
        )
    return invoke_tool(
        "export_kb",
        {"format": format_l, "category": category},
        express_call=lambda: tool_ok(
            {
                "format": format_l,
                "count": len(articles),
                "articles": articles,
                "download": True,
                "ui_action": "export_kb",
                "filename": f"worktual-kb.{format_l}",
            }
        ),
    )


def import_kb_articles(*, articles_json: str) -> dict[str, Any]:
    """Import articles from a JSON array: [{title, content, category, status?}]."""
    import json

    raw = str(articles_json or "").strip()
    if not raw:
        return tool_err("BAD_INPUT", "articles_json is required")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return tool_err("BAD_INPUT", "articles_json must be valid JSON")
    if not isinstance(parsed, list) or not parsed:
        return tool_err("BAD_INPUT", "articles_json must be a non-empty JSON array")
    created = 0
    errors: list[str] = []
    for i, item in enumerate(parsed[:50]):
        if not isinstance(item, dict):
            errors.append(f"row {i + 1}: not an object")
            continue
        title = str(item.get("title") or "").strip()
        content = str(item.get("content") or item.get("body") or "").strip()
        category = str(item.get("category") or "General").strip() or "General"
        status = str(item.get("status") or "").strip() or None
        hit = create_kb_article(
            title=title,
            content=content,
            category=category,
            status=status,
        )
        if hit.get("success"):
            created += 1
        else:
            errors.append(
                f"row {i + 1}: {hit.get('message') or hit.get('error_code') or 'failed'}"
            )
    return invoke_tool(
        "import_kb_articles",
        {"count": len(parsed)},
        express_call=lambda: tool_ok(
            {
                "created": created,
                "failed": len(errors),
                "errors": errors[:12],
                "ui_action": "refresh_kb",
            }
        ),
    )


def portal_list_tickets() -> dict[str, Any]:
    def _express() -> dict[str, Any]:
        return express_request("GET", "/api/internal/portal/tickets")

    return invoke_tool("portal_list_tickets", {}, express_call=_express)


def portal_create_ticket(
    issue: str = "",
    subject: str = "",
    description: str = "",
    *,
    force_create: bool = False,
    _idempotency_key: str = "",
) -> dict[str, Any]:
    """Create a portal ticket; Express intake owns the single DSSA pass."""
    from app.contracts import tool_ok

    body = {
        "issue": issue or description,
        "subject": subject,
        "description": description or issue,
        "forceCreate": bool(force_create),
        "idempotencyKey": str(_idempotency_key or "").strip() or None,
    }

    def _express() -> dict[str, Any]:
        return express_request("POST", "/api/internal/portal/tickets", json_body=body)

    result = invoke_tool("portal_create_ticket", body, express_call=_express)
    # Surface Express DSSA 409 as a structured deflection for the specialist.
    if (
        isinstance(result, dict)
        and not result.get("success")
        and isinstance(result.get("payload"), dict)
        and result["payload"].get("deflected")
    ):
        reply = str(result["payload"].get("reply") or result.get("message") or "").strip()
        return tool_err(
            "DSSA_DEFLECTED",
            reply or "A knowledge-base article may resolve this issue.",
            payload=result["payload"],
        )
    return result


def create_customer(
    *,
    name: str,
    email: str = "",
    phone: str = "",
    account_name: str = "",
    _idempotency_key: str = "",
) -> dict[str, Any]:
    """Create via POST /api/customers (same as CustomersView). Admin only at Express."""
    n = (name or "").strip()
    if not n:
        return tool_err("BAD_INPUT", "customer name is required")
    em = (email or "").strip()
    ph = (phone or "").strip()
    if not em and not ph:
        return tool_err("BAD_INPUT", "email or phone is required")
    body: dict[str, Any] = {"name": n}
    if em:
        body["email"] = em
    if ph:
        body["phone"] = ph
    acc = (account_name or "").strip()
    if acc:
        body["accountName"] = acc
    idempotency_key = str(_idempotency_key or "").strip()

    def _express() -> dict[str, Any]:
        return express_request(
            "POST",
            "/api/customers",
            json_body=body,
            extra_headers=(
                {"X-Idempotency-Key": idempotency_key} if idempotency_key else None
            ),
        )

    return invoke_tool("create_customer", body, express_call=_express)


def list_customers(
    *,
    query: str | None = None,
    exact_email: str | None = None,
    exact_phone: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    params: dict[str, Any] = {}
    if query:
        params["q"] = str(query).strip()
    if exact_email:
        params["exactEmail"] = str(exact_email).strip()
    if exact_phone:
        params["exactPhone"] = str(exact_phone).strip()
    if status:
        params["status"] = str(status).strip()

    def _express() -> dict[str, Any]:
        return express_request("GET", "/api/customers", params=params or None)

    return invoke_tool("list_customers", params, express_call=_express)


def get_customer_360(*, email: str) -> dict[str, Any]:
    em = (email or "").strip()
    if not em:
        return tool_err("BAD_INPUT", "email is required")

    def _express() -> dict[str, Any]:
        return express_request("GET", "/api/customers/360", params={"email": em})

    return invoke_tool("get_customer_360", {"email": em}, express_call=_express)


def import_customers(*, csv_text: str) -> dict[str, Any]:
    raw = (csv_text or "").strip()
    if not raw:
        return tool_err("BAD_INPUT", "csv text is required")

    def _express() -> dict[str, Any]:
        return express_request(
            "POST", "/api/customers/import", json_body={"csv": raw}
        )

    return invoke_tool("import_customers", {"csv": raw[:200]}, express_call=_express)


def list_macros(*, query: str | None = None) -> dict[str, Any]:
    params: dict[str, Any] = {}
    q = str(query or "").strip()
    if q:
        params["q"] = q[:200]

    def _express() -> dict[str, Any]:
        return express_request("GET", "/api/macros", params=params or None)

    return invoke_tool("list_macros", params, express_call=_express)


def list_priorities(*, include_inactive: bool = False) -> dict[str, Any]:
    q = "?all=1" if include_inactive else ""

    def _express() -> dict[str, Any]:
        return express_request("GET", f"/api/priorities{q}")

    return invoke_tool(
        "list_priorities",
        {"include_inactive": include_inactive} if include_inactive else {},
        express_call=_express,
    )


def create_priority(*, display_name: str, resolution_hours: float) -> dict[str, Any]:
    """Create via POST /api/priorities (same as PrioritiesView)."""
    from app.workflow_schemas import normalize_catalog_resolution_hours

    name = (display_name or "").strip()
    try:
        hours = normalize_catalog_resolution_hours(resolution_hours)
    except ValueError:
        return tool_err("BAD_INPUT", "resolutionHours must be > 0")
    if not name:
        return tool_err("BAD_INPUT", "display name is required")

    def _express() -> dict[str, Any]:
        return express_request(
            "POST",
            "/api/priorities",
            json_body={"displayName": name, "resolutionHours": hours},
        )

    return invoke_tool(
        "create_priority",
        {"display_name": name, "resolution_hours": hours},
        express_call=_express,
    )


def update_priority(
    priority_id: str,
    *,
    display_name: str | None = None,
    resolution_hours: float | None = None,
    active: bool | None = None,
) -> dict[str, Any]:
    pid = catalog_row_id_usable(priority_id)
    if not pid:
        return tool_err(
            "BAD_INPUT",
            "priority id must be the numeric id from list_priorities. "
            "Do not invent placeholders.",
        )
    body: dict[str, Any] = {}
    if display_name is not None:
        body["displayName"] = str(display_name).strip()
    if resolution_hours is not None:
        body["resolutionHours"] = float(resolution_hours)
    if active is not None:
        body["active"] = bool(active)
    if not body:
        return tool_err("BAD_INPUT", "no priority fields to update")

    def _express() -> dict[str, Any]:
        return express_request(
            "PATCH",
            f"/api/priorities/{quote(pid, safe='')}",
            json_body=body,
        )

    return invoke_tool(
        "update_priority",
        {"priority_id": pid, **body},
        express_call=_express,
    )


def delete_priority(priority_id: str) -> dict[str, Any]:
    pid = catalog_row_id_usable(priority_id)
    if not pid:
        return tool_err(
            "BAD_INPUT",
            "priority id must be the numeric id from list_priorities. "
            "Do not invent placeholders.",
        )

    def _express() -> dict[str, Any]:
        return express_request("DELETE", f"/api/priorities/{quote(pid, safe='')}")

    return invoke_tool(
        "delete_priority",
        {"priority_id": pid},
        express_call=_express,
    )


def list_statuses(*, include_inactive: bool = False) -> dict[str, Any]:
    q = "?all=1" if include_inactive else ""

    def _express() -> dict[str, Any]:
        return express_request("GET", f"/api/statuses{q}")

    return invoke_tool(
        "list_statuses",
        {"include_inactive": include_inactive} if include_inactive else {},
        express_call=_express,
    )


def create_status(*, display_name: str) -> dict[str, Any]:
    """Create via POST /api/statuses (same as PrioritiesView statuses tab)."""
    name = (display_name or "").strip()
    if not name:
        return tool_err("BAD_INPUT", "display name is required")

    def _express() -> dict[str, Any]:
        return express_request(
            "POST",
            "/api/statuses",
            json_body={"displayName": name},
        )

    return invoke_tool(
        "create_status",
        {"display_name": name},
        express_call=_express,
    )


def update_status(
    status_id: str,
    *,
    display_name: str | None = None,
    active: bool | None = None,
) -> dict[str, Any]:
    sid = catalog_row_id_usable(status_id)
    if not sid:
        return tool_err(
            "BAD_INPUT",
            "status id must be the numeric id from list_statuses. "
            "Do not invent placeholders.",
        )
    body: dict[str, Any] = {}
    if display_name is not None:
        body["displayName"] = str(display_name).strip()
    if active is not None:
        body["active"] = bool(active)
    if not body:
        return tool_err("BAD_INPUT", "no status fields to update")

    def _express() -> dict[str, Any]:
        return express_request(
            "PATCH",
            f"/api/statuses/{quote(sid, safe='')}",
            json_body=body,
        )

    return invoke_tool(
        "update_status",
        {"status_id": sid, **body},
        express_call=_express,
    )


def delete_status(status_id: str) -> dict[str, Any]:
    sid = catalog_row_id_usable(status_id)
    if not sid:
        return tool_err(
            "BAD_INPUT",
            "status id must be the numeric id from list_statuses. "
            "Do not invent placeholders.",
        )

    def _express() -> dict[str, Any]:
        return express_request("DELETE", f"/api/statuses/{quote(sid, safe='')}")

    return invoke_tool("delete_status", {"status_id": sid}, express_call=_express)


def get_metrics(*, scope: str | None = None) -> dict[str, Any]:
    params: dict[str, Any] = {}
    raw_scope = str(scope or "").strip().lower()
    if raw_scope in {"org", "self", "assignee", "mine"}:
        params["scope"] = "self" if raw_scope in {"assignee", "mine"} else raw_scope

    def _express() -> dict[str, Any]:
        return express_request("GET", "/api/metrics", params=params or None)

    return invoke_tool("get_metrics", params, express_call=_express)


def get_csat_reports(*, chart_range: str | None = None) -> dict[str, Any]:
    params: dict[str, Any] = {}
    allowed = {"7days", "30days", "90days"}
    rng = str(chart_range or "").strip()
    if rng in allowed:
        params["range"] = rng

    def _express() -> dict[str, Any]:
        return express_request("GET", "/api/csat-reports", params=params or None)

    return invoke_tool("get_csat_reports", params, express_call=_express)


def export_analytics(*, chart_range: str | None = None) -> dict[str, Any]:
    allowed = {"24hours", "7days", "30days"}
    rng = str(chart_range or "7days").strip()
    if rng not in allowed:
        rng = "7days"
    href = f"/api/analytics/export?range={rng}"
    return invoke_tool(
        "export_analytics",
        {"range": rng},
        express_call=lambda: tool_ok(
            {
                "href": href,
                "range": rng,
                "download": True,
                "note": "Use the Analytics Export control; CSV is not dumped in chat.",
            }
        ),
    )


def list_audit(
    *,
    limit: int | None = None,
    action: str | None = None,
    actor: str | None = None,
    ticket: str | None = None,
    chart_range: str | None = None,
) -> dict[str, Any]:
    params: dict[str, Any] = {}
    if limit is not None:
        try:
            n = int(limit)
            if 1 <= n <= 500:
                params["limit"] = n
        except (TypeError, ValueError):
            pass
    if action:
        params["action"] = str(action).strip()[:128]
    if actor:
        params["actor"] = str(actor).strip()[:128]
    if ticket:
        params["ticket"] = str(ticket).strip()[:64]
    rng = str(chart_range or "").strip()
    if rng:
        params["range"] = rng

    def _express() -> dict[str, Any]:
        return express_request("GET", "/api/audit", params=params or None)

    return invoke_tool("list_audit", params, express_call=_express)


def list_escalation_directory(
    *,
    query: str | None = None,
    skill: str | None = None,
) -> dict[str, Any]:
    params: dict[str, Any] = {}
    if query:
        params["q"] = str(query).strip()[:200]
    if skill:
        params["skill"] = str(skill).strip()[:128]

    def _express() -> dict[str, Any]:
        return express_request(
            "GET", "/api/escalation-directory", params=params or None
        )

    return invoke_tool("list_escalation_directory", params, express_call=_express)


def list_widgets() -> dict[str, Any]:
    def _express() -> dict[str, Any]:
        return express_request("GET", "/api/integration/widgets")

    return invoke_tool("list_widgets", {}, express_call=_express)


def create_widget(
    *,
    name: str,
    allowed_origins: list[str] | str | None = None,
    button_label: str | None = None,
) -> dict[str, Any]:
    n = (name or "").strip()
    if not n:
        return tool_err("BAD_INPUT", "widget name is required")
    body: dict[str, Any] = {"name": n}
    if button_label:
        body["buttonLabel"] = str(button_label).strip()
    origins: list[str] = []
    if isinstance(allowed_origins, str):
        origins = [p.strip() for p in allowed_origins.split(",") if p.strip()]
    elif isinstance(allowed_origins, list):
        origins = [str(x).strip() for x in allowed_origins if str(x).strip()]
    if origins:
        body["allowedOrigins"] = origins

    def _express() -> dict[str, Any]:
        return express_request("POST", "/api/integration/widgets", json_body=body)

    return invoke_tool("create_widget", {"name": n, **body}, express_call=_express)


def update_widget(
    *,
    widget_id: str,
    name: str | None = None,
    allowed_origins: list[str] | str | None = None,
    button_label: str | None = None,
    enabled: bool | None = None,
) -> dict[str, Any]:
    wid = str(widget_id or "").strip()
    if not wid:
        return tool_err("BAD_INPUT", "widget_id is required")
    body: dict[str, Any] = {}
    if name is not None:
        body["name"] = str(name).strip()
    if button_label is not None:
        body["buttonLabel"] = str(button_label).strip()
    if enabled is not None:
        body["enabled"] = bool(enabled)
    if allowed_origins is not None:
        if isinstance(allowed_origins, str):
            origins = [part.strip() for part in allowed_origins.split(",") if part.strip()]
        else:
            origins = [str(item).strip() for item in allowed_origins if str(item).strip()]
        body["allowedOrigins"] = origins
    if not body:
        return tool_err("BAD_INPUT", "no widget fields to update")

    def _express() -> dict[str, Any]:
        return express_request(
            "PATCH",
            f"/api/integration/widgets/{quote(wid, safe='')}",
            json_body=body,
        )

    return invoke_tool(
        "update_widget",
        {"widget_id": wid, **body},
        express_call=_express,
    )


def list_integration_keys() -> dict[str, Any]:
    """Metadata only — never return plaintext secrets."""

    def _express() -> dict[str, Any]:
        result = express_request("GET", "/api/integration/keys")
        if not result.get("success"):
            return result
        payload = result.get("payload")
        rows = []
        if isinstance(payload, dict):
            rows = payload.get("keys") or payload.get("data") or []
        elif isinstance(payload, list):
            rows = payload
        masked = []
        for row in rows if isinstance(rows, list) else []:
            if not isinstance(row, dict):
                continue
            prefix = str(row.get("keyPrefix") or row.get("prefix") or "").strip()
            masked.append(
                {
                    "id": row.get("id"),
                    "name": row.get("name"),
                    "createdAt": row.get("createdAt"),
                    "lastUsedAt": row.get("lastUsedAt"),
                    "revokedAt": row.get("revokedAt"),
                    "keyPrefix": (prefix[:16] + "…") if len(prefix) > 16 else prefix,
                }
            )
        return {
            "success": True,
            "payload": {"keys": masked, "count": len(masked)},
        }

    return invoke_tool("list_integration_keys", {}, express_call=_express)


def create_integration_key(*, name: str) -> dict[str, Any]:
    label = str(name or "").strip()
    if not label:
        return tool_err("BAD_INPUT", "integration key name is required")

    def _express() -> dict[str, Any]:
        return express_request(
            "POST",
            "/api/integration/keys",
            json_body={"name": label},
        )

    return invoke_tool(
        "create_integration_key",
        {"name": label},
        express_call=_express,
    )


def revoke_integration_key(*, key_id: str) -> dict[str, Any]:
    kid = str(key_id or "").strip()
    if not kid:
        return tool_err("BAD_INPUT", "key_id is required")

    def _express() -> dict[str, Any]:
        return express_request(
            "DELETE",
            f"/api/integration/keys/{quote(kid, safe='')}",
        )

    return invoke_tool(
        "revoke_integration_key",
        {"key_id": kid},
        express_call=_express,
    )


def list_automation_rules() -> dict[str, Any]:
    def _express() -> dict[str, Any]:
        return express_request("GET", "/api/automation/rules")

    return invoke_tool("list_automation_rules", {}, express_call=_express)


def create_automation_rule(
    *,
    name: str,
    event: str,
    conditions: dict[str, Any] | None = None,
    actions: dict[str, Any] | None = None,
    priority: int | None = None,
    enabled: bool | None = None,
) -> dict[str, Any]:
    label = str(name or "").strip()
    event_name = str(event or "").strip()
    if not label or event_name not in {"ticket.created", "ticket.updated"}:
        return tool_err(
            "BAD_INPUT",
            "name and event (ticket.created or ticket.updated) are required",
        )
    body: dict[str, Any] = {
        "name": label,
        "event": event_name,
        "conditions": dict(conditions or {}),
        "actions": dict(actions or {}),
    }
    if priority is not None:
        body["priority"] = int(priority)
    if enabled is not None:
        body["enabled"] = bool(enabled)

    def _express() -> dict[str, Any]:
        return express_request("POST", "/api/automation/rules", json_body=body)

    return invoke_tool("create_automation_rule", body, express_call=_express)


def update_automation_rule(
    *,
    rule_id: str,
    name: str | None = None,
    event: str | None = None,
    conditions: dict[str, Any] | None = None,
    actions: dict[str, Any] | None = None,
    priority: int | None = None,
    enabled: bool | None = None,
) -> dict[str, Any]:
    rid = str(rule_id or "").strip()
    if not rid:
        return tool_err("BAD_INPUT", "rule_id is required")
    if event is not None and str(event) not in {"ticket.created", "ticket.updated"}:
        return tool_err("BAD_INPUT", "event must be ticket.created or ticket.updated")
    body: dict[str, Any] = {}
    for key, value in {
        "name": name,
        "event": event,
        "conditions": conditions,
        "actions": actions,
        "priority": priority,
        "enabled": enabled,
    }.items():
        if value is not None:
            body[key] = value
    if not body:
        return tool_err("BAD_INPUT", "no automation rule fields to update")

    def _express() -> dict[str, Any]:
        return express_request(
            "PATCH",
            f"/api/automation/rules/{quote(rid, safe='')}",
            json_body=body,
        )

    return invoke_tool(
        "update_automation_rule",
        {"rule_id": rid, **body},
        express_call=_express,
    )


def delete_automation_rule(*, rule_id: str) -> dict[str, Any]:
    rid = str(rule_id or "").strip()
    if not rid:
        return tool_err("BAD_INPUT", "rule_id is required")

    def _express() -> dict[str, Any]:
        return express_request(
            "DELETE",
            f"/api/automation/rules/{quote(rid, safe='')}",
        )

    return invoke_tool(
        "delete_automation_rule",
        {"rule_id": rid},
        express_call=_express,
    )


def get_analytics(*, chart_range: str | None = None) -> dict[str, Any]:
    params: dict[str, Any] = {}
    allowed = {"24hours", "7days", "30days"}
    if chart_range and str(chart_range).strip() in allowed:
        params["range"] = str(chart_range).strip()

    def _express() -> dict[str, Any]:
        return express_request("GET", "/api/analytics", params=params or None)

    return invoke_tool("get_analytics", params, express_call=_express)


def ask_semantic_layer(
    *,
    query: str,
    organization_id: str | None = None,
) -> dict[str, Any]:
    """NL *metric values* via semantic gateway. Scopes by organization_id; never narrative why."""
    from app.config import get_settings
    from app.tools.express_client import get_tool_actor
    import httpx

    q = str(query or "").strip()
    if not q:
        return tool_err("BAD_INPUT", "query is required")

    actor = get_tool_actor()
    org = str(organization_id or (actor.organization_id if actor else "") or "").strip()
    if not org:
        return tool_err("UNAUTHORIZED", "organization_id is required for semantic metrics")

    settings = get_settings()
    base = (settings.semantic_layer_url or "").strip().rstrip("/")
    if not base:
        return tool_err("CONFIG", "SEMANTIC_LAYER_URL is not configured")

    # Scope from logged-in org (tool actor / explicit arg) — never a static env override.
    product = (settings.semantic_layer_product or "ticketing").strip() or "ticketing"
    timeout = float(settings.semantic_layer_timeout or 30.0)
    body = {
        "query": q[:2000],
        "organization_id": org,
        "product": product,
    }

    def _call() -> dict[str, Any]:
        try:
            with httpx.Client(timeout=timeout) as client:
                resp = client.post(f"{base}/ask", json=body)
            if resp.status_code >= 400:
                code = "HTTP_ERROR"
                if resp.status_code in {401, 403}:
                    code = "FORBIDDEN"
                elif resp.status_code in {400, 422}:
                    code = "VALIDATION_ERROR"
                elif resp.status_code == 404:
                    code = "NOT_FOUND"
                return tool_err(
                    code,
                    "Metric lookup is temporarily unavailable",
                    payload={"status_code": resp.status_code},
                    http_status=resp.status_code,
                    retryable=resp.status_code >= 500,
                )
            data = resp.json()
            return tool_ok(data if isinstance(data, (dict, list)) else {"result": data})
        except Exception as exc:
            return tool_err("TRANSPORT", f"semantic layer unavailable: {exc}")

    return invoke_tool("ask_semantic_layer", {"query": q, "organization_id": org}, express_call=_call)


def _emit_tool_progress(event: dict[str, Any]) -> None:
    """Push user-facing ontology *status* labels to the agent-turn stream.

    Only ``kind=status`` events belong on this pipe. Activity/block/text_delta
    stay internal (trail + final answer) so answer fragments never appear in
    the chat thinking chip.
    """
    kind = str((event or {}).get("kind") or "").strip().lower()
    if kind and kind != "status":
        return
    try:
        from app.runtime.progress import emit_progress

        emit_progress(event)
    except Exception:  # noqa: BLE001
        pass


def _user_facing_status_label(phase: str, label: str) -> str | None:
    """Keep only short human status labels for the thinking chip.

    Ontology also emits ``status`` lines that embed Cypher (``Fetching: MATCH…``);
    those stay off the UI. Activity / block / tool_call are never passed here.
    """
    text = str(label or "").strip()
    if not text:
        return None
    upper = text.upper()
    # Query dumps masquerading as status — do not show in chat.
    if (
        "MATCH " in upper
        or "RETURN " in upper
        or text.startswith("Query ·")
        or text.startswith("Fetching:")
        or " AS DIMENSI" in upper
    ):
        phase_l = str(phase or "").strip().lower()
        if phase_l == "fetching":
            return "Fetching analytics…"
        if phase_l == "querying":
            return "Writing the analytics query…"
        return None
    return text


def _strip_html(text: str) -> str:
    import re

    plain = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", text or "")
    plain = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", plain)
    plain = re.sub(r"(?s)<[^>]+>", " ", plain)
    plain = re.sub(r"\s+", " ", plain).strip()
    return plain


def consume_ontology_sse(
    raw_lines: list[str],
    *,
    emit: bool = False,
) -> dict[str, Any]:
    """Parse ontology SSE lines into answer + trail (tests + stream consumer)."""
    import json

    event_name = "message"
    data_buf: list[str] = []
    answer_parts: list[str] = []
    trail: list[str] = []
    elapsed: float | None = None
    turn_id = ""

    def _flush() -> None:
        nonlocal event_name, data_buf, answer_parts, trail, elapsed, turn_id
        if not data_buf:
            event_name = "message"
            return
        raw = "\n".join(data_buf).strip()
        data_buf = []
        name = event_name or "message"
        event_name = "message"
        try:
            payload = json.loads(raw) if raw.startswith("{") else {"text": raw}
        except Exception:  # noqa: BLE001
            payload = {"text": raw}
        if not isinstance(payload, dict):
            payload = {"value": payload}

        if name == "status":
            raw_label = str(payload.get("label") or "").strip()
            phase = str(payload.get("phase") or "").strip()
            if raw_label:
                trail.append(raw_label)
            label = _user_facing_status_label(phase, raw_label)
            if emit and label:
                _emit_tool_progress(
                    {
                        "source": "ontology",
                        "kind": "status",
                        "phase": phase,
                        "label": label,
                    }
                )
        elif name == "activity":
            title = str(payload.get("title") or "").strip()
            desc = str(payload.get("description") or "").strip()
            status = str(payload.get("status") or "").strip()
            label = title or desc
            # Internal trail only — do not stream activity to the UI.
            if label and status != "completed":
                trail.append(label)
        elif name == "block":
            label = str(payload.get("label") or "").strip()
            summary = str(payload.get("summary") or "").strip()
            status = str(payload.get("status") or "").strip()
            # Block summaries are answer-like; keep off the progress stream.
            if status == "success" and (summary or label):
                trail.append(summary or label)
        elif name == "tool_call":
            # Never stream tool_call / Cypher to the UI.
            pass
        elif name == "text_delta":
            delta = str(payload.get("delta") or "").strip()
            if not delta:
                # Prefer incremental delta; fall back to content only if first chunk
                content = str(payload.get("content") or "")
                if content and not answer_parts:
                    delta = content
            if delta:
                answer_parts.append(delta)
        elif name == "done":
            try:
                elapsed = float(payload.get("elapsed_seconds"))
            except Exception:  # noqa: BLE001
                elapsed = None
            turn_id = str(payload.get("turnId") or payload.get("turn_id") or "").strip()

    for line in raw_lines:
        if line is None:
            continue
        s = str(line).rstrip("\r\n")
        if s.startswith("event:"):
            event_name = s[6:].strip() or "message"
            continue
        if s.startswith("data:"):
            data_buf.append(s[5:].lstrip())
            continue
        if s == "":
            _flush()
    _flush()

    answer_html = "".join(answer_parts).strip()
    answer = _strip_html(answer_html) or answer_html
    if len(trail) > 24:
        trail = trail[-24:]
    return {
        "answer": answer,
        "answer_html": answer_html[:8000] if answer_html else "",
        "trail": trail,
        "elapsed_seconds": elapsed,
        "turn_id": turn_id,
    }


def ask_ontology(
    *,
    query: str,
    organization_id: str | None = None,
    session_id: str | None = None,
) -> dict[str, Any]:
    """Narrative why / drivers via ontology knowledge-graph SSE. Not for KPI numbers."""
    from app.config import get_settings
    from app.tools.express_client import get_tool_actor
    import httpx
    import json

    q = str(query or "").strip()
    if not q:
        return tool_err("BAD_INPUT", "query is required")

    actor = get_tool_actor()
    org = str(organization_id or (actor.organization_id if actor else "") or "").strip()
    if not org:
        return tool_err("UNAUTHORIZED", "organization_id is required for ontology chat")

    settings = get_settings()
    base = (settings.ontology_chat_url or "").strip().rstrip("/")
    if not base:
        return tool_err("CONFIG", "ONTOLOGY_CHAT_URL is not configured")

    # Scope from logged-in org (tool actor / explicit arg) — never a static env override.
    timeout = float(settings.ontology_chat_timeout or 90.0)
    sid = str(session_id or "").strip()
    body = {
        "sessionID": sid,
        "query": q[:4000],
        "organization_id": org,
    }
    url = f"{base}/chat/stream"

    def _call() -> dict[str, Any]:
        try:
            _emit_tool_progress(
                {
                    "source": "ontology",
                    "kind": "status",
                    "phase": "start",
                    "label": "Asking the knowledge graph…",
                }
            )
            event_name = "message"
            data_buf: list[str] = []
            answer_parts: list[str] = []
            trail: list[str] = []
            elapsed: float | None = None
            turn_id = ""

            def _flush_event() -> None:
                nonlocal event_name, data_buf, answer_parts, trail, elapsed, turn_id
                if not data_buf:
                    event_name = "message"
                    return
                raw = "\n".join(data_buf).strip()
                data_buf = []
                name = event_name or "message"
                event_name = "message"
                try:
                    payload = json.loads(raw) if raw.startswith("{") else {}
                except Exception:  # noqa: BLE001
                    payload = {}
                if not isinstance(payload, dict):
                    return
                if name == "status":
                    phase = str(payload.get("phase") or "")
                    raw_label = str(payload.get("label") or "").strip()
                    if raw_label:
                        trail.append(raw_label)
                    label = _user_facing_status_label(phase, raw_label)
                    if label:
                        _emit_tool_progress(
                            {
                                "source": "ontology",
                                "kind": "status",
                                "phase": phase,
                                "label": label,
                            }
                        )
                elif name == "activity":
                    title = str(payload.get("title") or "").strip()
                    status = str(payload.get("status") or "").strip()
                    # Internal trail only — status labels alone go to the UI.
                    if title and status != "completed":
                        trail.append(title)
                elif name == "block":
                    label = str(
                        payload.get("label") or payload.get("summary") or ""
                    ).strip()
                    status = str(payload.get("status") or "").strip()
                    summary = str(payload.get("summary") or "").strip()
                    # Do not stream block/summary — those are answer fragments.
                    if status == "success" and (summary or label):
                        trail.append(summary or label)
                elif name == "tool_call":
                    # Never stream tool_call / Cypher to the UI.
                    pass
                elif name == "text_delta":
                    delta = str(payload.get("delta") or "").strip()
                    if not delta and not answer_parts:
                        delta = str(payload.get("content") or "")
                    if delta:
                        answer_parts.append(delta)
                elif name == "done":
                    try:
                        elapsed = float(payload.get("elapsed_seconds"))
                    except Exception:  # noqa: BLE001
                        elapsed = None
                    turn_id = str(
                        payload.get("turnId") or payload.get("turn_id") or ""
                    ).strip()

            with httpx.Client(timeout=httpx.Timeout(timeout, connect=10.0)) as client:
                with client.stream(
                    "POST",
                    url,
                    json=body,
                    headers={
                        "Accept": "text/event-stream",
                        "Content-Type": "application/json",
                    },
                ) as resp:
                    if resp.status_code >= 400:
                        code = "HTTP_ERROR"
                        if resp.status_code in {401, 403}:
                            code = "FORBIDDEN"
                        elif resp.status_code in {400, 422}:
                            code = "VALIDATION_ERROR"
                        elif resp.status_code == 404:
                            code = "NOT_FOUND"
                        return tool_err(
                            code,
                            "Root-cause analysis is temporarily unavailable",
                            payload={"status_code": resp.status_code},
                            http_status=resp.status_code,
                            retryable=resp.status_code >= 500,
                        )
                    for line in resp.iter_lines():
                        s = (line if isinstance(line, str) else str(line)).rstrip("\r\n")
                        if s.startswith("event:"):
                            event_name = s[6:].strip() or "message"
                        elif s.startswith("data:"):
                            data_buf.append(s[5:].lstrip())
                        elif s == "":
                            _flush_event()
                    _flush_event()

            answer_html = "".join(answer_parts).strip()
            answer = _strip_html(answer_html) or answer_html
            if len(trail) > 24:
                trail = trail[-24:]
            if not answer:
                return tool_err(
                    "EMPTY",
                    "ontology chat returned no answer",
                    payload={"trail": trail},
                )
            return tool_ok(
                {
                    "answer": answer,
                    "trail": trail,
                    "elapsed_seconds": elapsed,
                    "turn_id": turn_id,
                    "note": (
                        "Narrative explanation only. Do not treat this as an exact KPI; "
                        "use ask_semantic_layer for metric values."
                    ),
                }
            )
        except Exception as exc:
            return tool_err("TRANSPORT", f"ontology chat unavailable: {exc}")

    return invoke_tool(
        "ask_ontology",
        {"query": q, "organization_id": org, "session_id": sid},
        express_call=_call,
    )


def _hub_reply_text(hub_response: Any) -> str:
    """Extract a phraseable string from Hub JSON-RPC / task payloads."""
    if hub_response is None:
        return ""
    if isinstance(hub_response, str):
        return hub_response.strip()
    if not isinstance(hub_response, dict):
        return str(hub_response).strip()
    for key in ("assistantText", "reply", "message", "result", "summary", "text"):
        val = hub_response.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    # A2A-style artifacts / parts
    result = hub_response.get("result")
    if isinstance(result, dict):
        nested = _hub_reply_text(result)
        if nested:
            return nested
    status = hub_response.get("status") or hub_response.get("state")
    if status:
        return f"Hub status: {status}"
    err = hub_response.get("error")
    if isinstance(err, dict):
        return str(err.get("message") or err).strip()
    if isinstance(err, str) and err.strip():
        return err.strip()
    return ""


def ask_hub(
    *,
    query: str,
    cdp_id: str | None = None,
    organization_id: str | None = None,
    channel: str | None = None,
) -> dict[str, Any]:
    """Send a Ticketing leftover query to Hub A2A (remainder). Requires cdp_id."""
    from app.tools.express_client import get_tool_actor
    from app.tools.hub_a2a_client import send_remainder

    q = str(query or "").strip()
    if not q:
        return tool_err("BAD_INPUT", "query is required")

    cdp = str(cdp_id or "").strip()
    if not cdp:
        return tool_err(
            "BAD_INPUT",
            "cdp_id is required to call Hub — focus a customer/contact first.",
            payload={"code": "NO_CDP"},
        )

    actor = get_tool_actor()
    if actor and str(actor.user_id or "").startswith("hub:"):
        return tool_err(
            "NOT_ALLOWED",
            "Hub-originated tasks cannot escalate back to Hub.",
            payload={"code": "HUB_NO_BOUNCE"},
        )
    org = str(
        organization_id or (actor.organization_id if actor else "") or ""
    ).strip()
    if not org:
        return tool_err("UNAUTHORIZED", "organization_id is required for Hub")

    ch = str(channel or "chat").strip().lower()
    if ch not in ("chat", "email"):
        ch = "chat"

    def _call() -> dict[str, Any]:
        try:
            out = send_remainder(
                cdp_id=cdp,
                query=q,
                organization_id=org,
                channel=ch,
            )
            hub_response = out.get("hub_response")
            reply = _hub_reply_text(hub_response)
            return tool_ok(
                {
                    "reply": reply,
                    "hub_response": hub_response,
                    "remainder": out.get("remainder"),
                    "message_id": out.get("message_id"),
                    "note": (
                        "Cross-product Hub remainder. Phrase the Hub reply for the "
                        "user; do not invent CRM/CCaaS facts beyond this payload."
                    ),
                }
            )
        except ValueError as exc:
            return tool_err("BAD_INPUT", str(exc))
        except Exception as exc:  # noqa: BLE001
            return tool_err("TRANSPORT", f"Hub A2A unavailable: {exc}")

    return invoke_tool(
        "ask_hub",
        {
            "query": q,
            "cdp_id": cdp,
            "organization_id": org,
            "channel": ch,
        },
        express_call=_call,
    )


def get_triage_stats() -> dict[str, Any]:
    def _express() -> dict[str, Any]:
        return express_request("GET", "/api/agent/triage-stats")

    return invoke_tool("get_triage_stats", {}, express_call=_express)


def get_dashboard_chart(*, chart_range: str = "7days") -> dict[str, Any]:
    allowed = {"24hours", "7days", "30days"}
    rng = str(chart_range or "7days").strip()
    if rng not in allowed:
        rng = "7days"

    def _express() -> dict[str, Any]:
        return express_request("GET", "/api/dashboard/chart", params={"range": rng})

    return invoke_tool(
        "get_dashboard_chart", {"range": rng}, express_call=_express
    )


def list_activities() -> dict[str, Any]:
    def _express() -> dict[str, Any]:
        return express_request("GET", "/api/activities")

    return invoke_tool("list_activities", {}, express_call=_express)


# ---- Org prefs + notifications (non-secret) ----


def get_org_preferences() -> dict[str, Any]:
    def _express() -> dict[str, Any]:
        return express_request("GET", "/api/org-preferences")

    return invoke_tool("get_org_preferences", {}, express_call=_express)


def update_org_preferences(
    *,
    ticket_prefix: str | None = None,
    portal_label: str | None = None,
    display_timezone: str | None = None,
    portal_auth_mode: str | None = None,
    business_type: str | None = None,
) -> dict[str, Any]:
    """PUT non-secret org prefs (admin). Secrets stay UI-only."""
    body: dict[str, Any] = {}
    if ticket_prefix is not None:
        body["ticketPrefix"] = ticket_prefix
    if portal_label is not None:
        body["portalLabel"] = portal_label
    if display_timezone is not None:
        body["displayTimezone"] = display_timezone
    if portal_auth_mode is not None:
        mode = str(portal_auth_mode).strip().lower()
        body["portalAuthMode"] = "password" if mode == "password" else "otp"
    if business_type is not None:
        kind = str(business_type).strip().lower()
        body["businessType"] = "b2b" if kind == "b2b" else "b2c"
    if not body:
        return tool_err("BAD_INPUT", "no preference fields to update")
    args: dict[str, Any] = {}
    if ticket_prefix is not None:
        args["ticket_prefix"] = ticket_prefix
    if portal_label is not None:
        args["portal_label"] = portal_label
    if display_timezone is not None:
        args["display_timezone"] = display_timezone
    if portal_auth_mode is not None:
        args["portal_auth_mode"] = body["portalAuthMode"]
    if business_type is not None:
        args["business_type"] = body["businessType"]

    def _express() -> dict[str, Any]:
        return express_request("PUT", "/api/org-preferences", json_body=body)

    return invoke_tool("update_org_preferences", args, express_call=_express)


def get_user_preferences() -> dict[str, Any]:
    """Load the actor's soft/hard preference scratchpad (Postgres)."""
    from app.contracts import tool_ok
    from app.memory.durable_store import load_user_preferences
    from app.tools.express_client import get_tool_actor

    actor = get_tool_actor()
    org = str((actor.organization_id if actor else "") or "").strip()
    user = str((actor.user_id if actor else "") or "").strip()
    if not org:
        return tool_err("UNAUTHORIZED", "organization_id is required")
    try:
        prefs = load_user_preferences(org, user)
    except Exception as exc:  # noqa: BLE001
        return tool_err("MEMORY_ERROR", f"could not load preferences: {exc}")
    return tool_ok(prefs)


def update_user_preference(
    *,
    key: str,
    value: Any = None,
    kind: str = "soft",
) -> dict[str, Any]:
    """Upsert one user preference key (soft → prompt; hard → verification gate)."""
    from app.contracts import tool_ok
    from app.memory.durable_store import upsert_user_preferences
    from app.tools.express_client import get_tool_actor

    actor = get_tool_actor()
    org = str((actor.organization_id if actor else "") or "").strip()
    user = str((actor.user_id if actor else "") or "").strip()
    if not org:
        return tool_err("UNAUTHORIZED", "organization_id is required")
    pref_key = str(key or "").strip()
    pref_kind = str(kind or "soft").strip().lower()
    if not pref_key:
        return tool_err("BAD_INPUT", "key is required")
    if pref_kind not in {"soft", "hard"}:
        return tool_err("BAD_INPUT", "kind must be soft or hard")
    patch = {pref_key: value}
    try:
        prefs = upsert_user_preferences(
            org,
            user,
            soft=patch if pref_kind == "soft" else None,
            hard=patch if pref_kind == "hard" else None,
        )
    except Exception as exc:  # noqa: BLE001
        return tool_err("MEMORY_ERROR", f"could not update preference: {exc}")
    return tool_ok({"kind": pref_kind, "key": pref_key, "preferences": prefs})


def verify_hard_preferences(
    *,
    tool_name: str,
    arguments: dict[str, Any] | None = None,
    channel: str | None = None,
) -> dict[str, Any]:
    """Deterministic hard-preference check for a proposed action."""
    from app.contracts import tool_ok
    from app.memory.durable_store import verify_hard_preference_action
    from app.tools.express_client import get_tool_actor

    actor = get_tool_actor()
    org = str((actor.organization_id if actor else "") or "").strip()
    user = str((actor.user_id if actor else "") or "").strip()
    if not org:
        return tool_err("UNAUTHORIZED", "organization_id is required")
    result = verify_hard_preference_action(
        organization_id=org,
        user_id=user,
        tool_name=tool_name,
        arguments=arguments if isinstance(arguments, dict) else {},
        channel=channel,
    )
    return tool_ok(result)


def store_long_term_memory(
    *,
    content: str,
    kind: str = "fact",
    conversation_id: str | None = None,
) -> dict[str, Any]:
    """Persist a durable cross-session memory fact for the actor."""
    from app.contracts import tool_ok
    from app.memory.durable_store import store_long_term_memory as _store
    from app.tools.express_client import get_tool_actor

    actor = get_tool_actor()
    org = str((actor.organization_id if actor else "") or "").strip()
    user = str((actor.user_id if actor else "") or "").strip()
    if not org:
        return tool_err("UNAUTHORIZED", "organization_id is required")
    text = str(content or "").strip()
    if not text:
        return tool_err("BAD_INPUT", "content is required")
    try:
        item_id = _store(
            organization_id=org,
            user_id=user,
            conversation_id=conversation_id,
            item={"content": text, "kind": kind or "fact"},
        )
    except Exception as exc:  # noqa: BLE001
        return tool_err("MEMORY_ERROR", f"could not store memory: {exc}")
    return tool_ok({"id": item_id, "content": text, "kind": kind or "fact"})


def search_long_term_memory(
    *,
    query: str,
    limit: int = 5,
) -> dict[str, Any]:
    """Search tenant/user-scoped long-term memory; do not dump full history."""
    from app.contracts import tool_ok
    from app.memory.durable_store import search_long_term_memory as _search
    from app.tools.express_client import get_tool_actor

    actor = get_tool_actor()
    org = str((actor.organization_id if actor else "") or "").strip()
    user = str((actor.user_id if actor else "") or "").strip()
    if not org:
        return tool_err("UNAUTHORIZED", "organization_id is required")
    try:
        hits = _search(
            organization_id=org,
            user_id=user,
            query=query,
            limit=limit,
        )
    except Exception as exc:  # noqa: BLE001
        return tool_err("MEMORY_ERROR", f"could not search memory: {exc}")
    return tool_ok({"items": hits, "count": len(hits)})


def list_notifications() -> dict[str, Any]:
    def _express() -> dict[str, Any]:
        return express_request("GET", "/api/notifications")

    return invoke_tool("list_notifications", {}, express_call=_express)


def mark_all_notifications_read() -> dict[str, Any]:
    def _express() -> dict[str, Any]:
        return express_request("POST", "/api/notifications/read-all")

    return invoke_tool("mark_all_notifications_read", {}, express_call=_express)


def clear_notifications() -> dict[str, Any]:
    def _express() -> dict[str, Any]:
        return express_request("DELETE", "/api/notifications")

    return invoke_tool("clear_notifications", {}, express_call=_express)


def send_staff_notification(
    *,
    user_id: str,
    title: str,
    message: str,
    kind: str = "update",
    ticket_uuid: str | None = None,
    customer_name: str | None = None,
) -> dict[str, Any]:
    uid = (user_id or "").strip()
    if not uid or not (title or "").strip() or not (message or "").strip():
        return tool_err("BAD_INPUT", "user_id, title, and message are required")
    body: dict[str, Any] = {
        "userId": uid,
        "title": title.strip(),
        "message": message.strip(),
        "kind": kind or "update",
    }
    if ticket_uuid:
        body["ticketUuid"] = str(ticket_uuid)
    if customer_name:
        body["customerName"] = str(customer_name)

    def _express() -> dict[str, Any]:
        return express_request("POST", "/api/notifications/send", json_body=body)

    return invoke_tool("send_staff_notification", body, express_call=_express)


def list_ticket_recommendations(*, ticket_number: str | None = None) -> dict[str, Any]:
    params: dict[str, Any] = {}
    if ticket_number:
        params["ticketNumber"] = str(ticket_number).strip()

    def _express() -> dict[str, Any]:
        return express_request(
            "GET", "/api/proactive/recommendations", params=params or None
        )

    return invoke_tool("list_ticket_recommendations", params, express_call=_express)


def mark_notification_read(notification_id: str) -> dict[str, Any]:
    nid = (notification_id or "").strip()
    if not nid:
        return tool_err("BAD_INPUT", "notification id is required")

    def _express() -> dict[str, Any]:
        return express_request(
            "PATCH",
            f"/api/notifications/{quote(nid, safe='')}/read",
        )

    return invoke_tool(
        "mark_notification_read",
        {"notification_id": nid},
        express_call=_express,
    )
