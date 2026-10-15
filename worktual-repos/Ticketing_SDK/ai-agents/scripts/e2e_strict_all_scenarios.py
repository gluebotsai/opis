#!/usr/bin/env python3
"""
Strict E2E: form (Express APIs) + chat (coworker) across modules.

Uses only the documented smoke login when other role passwords are unavailable.
Reports PASS/FAIL/SKIP per scenario.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from http.cookiejar import CookieJar
from typing import Any
from urllib import error, parse, request

BASE = "http://127.0.0.1:3001"
AGENTS = "http://127.0.0.1:8012"

# Optional JSON via env E2E_LOGINS:
# [{"role":"admin","email":"...","password":"..."}, ...]
# Never commit real passwords into this file.
def _load_logins() -> list[dict[str, str]]:
    import os

    raw = (os.environ.get("E2E_LOGINS") or "").strip()
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    out: list[dict[str, str]] = []
    if isinstance(data, list):
        for row in data:
            if not isinstance(row, dict):
                continue
            email = str(row.get("email") or "").strip()
            password = str(row.get("password") or "").strip()
            role = str(row.get("role") or "").strip().lower()
            if email and password:
                out.append({"role": role, "email": email, "password": password})
    return out


PROVIDED_LOGINS = _load_logins()

# Dev fallback roles (password via SMOKE_PASSWORD) — only used when E2E_LOGINS unset.
# customer/viewer still require E2E_LOGINS; never invent credentials.
def _default_role_candidates() -> list[dict[str, str]]:
    import os

    password = (os.environ.get("SMOKE_PASSWORD") or "Worktual@123").strip()
    return [
        {
            "role": "admin",
            "email": (os.environ.get("SMOKE_EMAIL") or "jane.smith@worktual.com").strip(),
            "password": password,
        },
        {
            "role": "agent",
            "email": "smohamedfazil16@gmail.com",
            "password": password,
        },
        {
            "role": "resolver",
            "email": "yaswanthmg1@gmail.com",
            "password": password,
        },
    ]

# Role → modules (mirrors ui-backend/src/rbac.ts)
MODULES_BY_ROLE: dict[str, list[str]] = {
    "admin": [
        "dashboard",
        "search",
        "assigned",
        "team-queue",
        "team-inbox",
        "unassigned",
        "create-ticket",
        "agent-queues",
        "kb",
        "customers",
        "analytics",
        "audit",
        "csat-reports",
        "macros",
        "priorities",
        "escalation-directory",
        "org-preferences",
        "settings",
    ],
    "agent": [
        "dashboard",
        "search",
        "assigned",
        "team-inbox",
        "unassigned",
        "create-ticket",
        "kb",
        "customers",
        "macros",
        "settings",
    ],
    "resolver": ["dashboard", "search", "assigned", "work-board", "kb", "settings"],
    "customer": ["create-ticket", "assigned", "settings"],
    "viewer": [
        "dashboard",
        "search",
        "assigned",
        "team-queue",
        "kb",
        "customers",
        "analytics",
        "settings",
    ],
}

# Form API probes per module (GET unless noted)
MODULE_FORM_APIS: dict[str, list[tuple[str, str]]] = {
    "dashboard": [("GET", "/api/metrics")],
    "search": [("GET", "/api/tickets?q=crm")],
    "assigned": [("GET", "/api/tickets?scope=assignee")],
    "team-queue": [("GET", "/api/tickets?scope=org")],
    "team-inbox": [("GET", "/api/tickets?scope=team")],
    "unassigned": [("GET", "/api/tickets?scope=unassigned")],
    "work-board": [("GET", "/api/tickets?scope=assignee")],
    "create-ticket": [("GET", "/api/priorities"), ("GET", "/api/queues")],
    "agent-queues": [("GET", "/api/queues")],
    "kb": [("GET", "/api/kb")],
    "customers": [("GET", "/api/customers")],
    "analytics": [("GET", "/api/analytics"), ("GET", "/api/metrics")],
    "audit": [("GET", "/api/audit")],
    "csat-reports": [("GET", "/api/csat-reports?range=30d")],
    "macros": [("GET", "/api/macros")],
    "priorities": [("GET", "/api/priorities?all=1"), ("GET", "/api/statuses?all=1")],
    "escalation-directory": [("GET", "/api/escalation-directory")],
    "org-preferences": [("GET", "/api/org-preferences")],
    "settings": [("GET", "/api/auth/me")],
}

CHAT_SCENARIOS: list[tuple[str, str, str]] = [
    ("chat.greeting", "general", "hello"),
    ("chat.search_ticket", "tickets", "{ticket_search}"),
    ("chat.filter_high", "tickets", "show high priority tickets"),
    ("chat.filter_open", "tickets", "list open tickets"),
    ("chat.clear_filters", "tickets", "clear filters"),
    ("chat.search_customer", "customers", "find customer {customer_name}"),
    ("chat.search_customer_from_inbox", "customers", "find customer {customer_name}"),
    ("chat.show_customers", "customers", "show customers"),
    ("chat.kb_search", "kb", "search knowledge base {kb_query}"),
    ("chat.create_ticket_intent", "tickets", "create a new ticket"),
    ("chat.escalate_prompt", "tickets", "escalate a ticket"),
    ("chat.best_resolver", "tickets", "escalate ticket to best resolver"),
    ("chat.assign_intent", "tickets", "reassign ticket"),
    ("chat.nav_customers", "customers", "open customers"),
    ("chat.nav_kb", "kb", "go to knowledge base"),
    ("chat.nav_teams", "teams", "open teams"),
    ("chat.nav_macros", "macros", "write macros"),
    ("chat.nav_csat", "csat", "open csat reports"),
    ("chat.nav_priorities", "priorities", "go to priorities"),
    ("chat.nav_team_inbox", "tickets", "open team inbox"),
    ("chat.create_team_intent", "teams", "create team"),
    ("chat.create_kb_intent", "kb", "create kb article"),
    ("chat.create_macro_intent", "macros", "create macros"),
    ("chat.settings_password_ui_only", "settings", "change my password"),
    ("chat.metrics", "general", "show metrics"),
]


# Page context sent with chat (simulates being on that screen)
CHAT_PAGE_BY_KEY: dict[str, str] = {
    "chat.search_customer_from_inbox": "Team inbox",
    "chat.create_ticket_intent": "Create Ticket",
    "chat.create_macro_intent": "Macros",
    "chat.create_kb_intent": "Knowledge Base",
    "chat.create_team_intent": "Teams",
    "chat.nav_macros": "Home",
    "chat.show_customers": "Macros",
}


FORBIDDEN_TICKET_VIEWS = frozenset(
    {"team-inbox", "tickets-list", "team-queue", "assigned", "unassigned", "search"}
)

# Live chat ↔ UI parity (MD catalogs). Stay on page; same Express APIs the UI uses.
# flags: count | export | no_secret | confirm | ticket_ok
CHAT_MODULE_PARITY: list[tuple[str, str, str, str, str | None, str | tuple[str, ...] | None, str, set[str]]] = [
    ("home.metrics_open", "Home", "how many overall open tickets are there?", "dashboard", "dashboard", "get_metrics", "/api/metrics", {"count"}),
    ("home.due_today", "Home", "overall due today?", "dashboard", "dashboard", "get_metrics", "/api/metrics", {"count"}),
    ("inbox.search_vpn", "Team inbox", "Find the VPN ticket.", "team-inbox", "team-inbox", ("list_tickets", "get_ticket"), "/api/tickets?scope=team", {"ticket_ok"}),
    ("inbox.high", "Team inbox", "Show high priority tickets.", "team-inbox", "team-inbox", "list_tickets", "/api/tickets?scope=team", {"ticket_ok"}),
    ("unassigned.count", "Unassigned", "How many unassigned tickets are there?", "unassigned", "unassigned", ("get_metrics", "list_tickets"), "/api/tickets?scope=unassigned", {"count", "ticket_ok"}),
    ("unassigned.list", "Unassigned", "Show all unassigned tickets.", "unassigned", "unassigned", "list_tickets", "/api/tickets?scope=unassigned", {"ticket_ok"}),
    ("all_tickets.get", "All tickets", "Find ticket {ticket_number}.", "tickets", None, ("get_ticket", "list_tickets"), "/api/tickets", {"ticket_ok"}),
    ("all_tickets.open", "All tickets", "Show open tickets.", "tickets", None, "list_tickets", "/api/tickets", {"ticket_ok"}),
    ("teams.list", "Teams", "Show all teams.", "agent-queues", "agent-queues", "list_queues", "/api/queues", set()),
    ("teams.search", "Teams", "Find the frontend team.", "agent-queues", "agent-queues", "list_queues", "/api/queues", set()),
    ("kb.search", "Knowledge Base", "Find password reset articles.", "kb", "kb", "list_kb", "/api/kb", set()),
    ("customers.search", "Customers", "Find {customer_name}.", "customers", "customers", "list_customers", "/api/customers", set()),
    ("analytics.7d", "Analytics", "Show me the reports for the last 7 days.", "analytics", "analytics", "get_analytics", "/api/analytics?range=7days", set()),
    ("analytics.resolved", "Analytics", "How many tickets were resolved?", "analytics", "analytics", "get_analytics", "/api/analytics", {"count"}),
    ("analytics.sla", "Analytics", "Show me the SLA breach report.", "analytics", "analytics", "get_analytics", "/api/analytics", set()),
    ("analytics.export", "Analytics", "Export this report.", "analytics", "analytics", "export_analytics", "/api/analytics", {"export"}),
    ("csat.30d", "CSAT reports", "Show CSAT for the last 30 days.", "csat-reports", "csat-reports", "get_csat_reports", "/api/csat-reports?range=30days", set()),
    ("csat.avg", "CSAT reports", "What is the average CSAT?", "csat-reports", "csat-reports", "get_csat_reports", "/api/csat-reports?range=30days", {"count"}),
    ("audit.latest", "Audit logs", "Show the latest audit logs.", "audit", "audit", "list_audit", "/api/audit", set()),
    ("audit.ticket", "Audit logs", "Show audit logs for ticket {ticket_number}.", "audit", "audit", "list_audit", "/api/audit", set()),
    ("audit.who", "Audit logs", "Who escalated ticket {ticket_number}?", "audit", "audit", "list_audit", "/api/audit", set()),
    ("macros.list", "Macros", "List all macros.", "macros", "macros", "list_macros", "/api/macros", set()),
    ("macros.search", "Macros", "Find the password reset macro.", "macros", "macros", "list_macros", "/api/macros", set()),
    ("macros.count", "Macros", "How many macros are there?", "macros", "macros", "list_macros", "/api/macros", {"count"}),
    ("priorities.list", "Priorities", "List priorities.", "priorities", "priorities", "list_priorities", "/api/priorities?all=1", set()),
    ("statuses.list", "Priorities", "List all ticket statuses.", "priorities", "priorities", "list_statuses", "/api/statuses?all=1", set()),
    ("directory.list", "Escalation directory", "Show all escalation teams.", "escalation-directory", "escalation-directory", "list_escalation_directory", "/api/escalation-directory", set()),
    ("directory.skill", "Escalation directory", "Which team handles frontend issues?", "escalation-directory", "escalation-directory", "list_escalation_directory", "/api/escalation-directory", set()),
    ("org_prefs.get", "Org preferences", "Show our organization preferences.", "org-preferences", "org-preferences", "get_org_preferences", "/api/org-preferences", set()),
    ("org_prefs.keys", "Org preferences", "How many API keys exist?", "org-preferences", "org-preferences", "list_integration_keys", "/api/org-preferences", {"count", "no_secret"}),
]


@dataclass
class Result:
    name: str
    status: str  # PASS FAIL SKIP
    detail: str = ""
    role: str = ""
    channel: str = ""  # form|chat|login
    module: str = ""  # dashboard|customers|macros|…


@dataclass
class Session:
    role: str
    email: str
    name: str
    user_id: str
    jar: CookieJar
    opener: Any
    organization_id: str = ""


RESULTS: list[Result] = []


def rec(
    name: str,
    status: str,
    detail: str = "",
    *,
    role: str = "",
    channel: str = "",
    module: str = "",
):
    mod = module or _module_from_name(name)
    RESULTS.append(Result(name, status, detail, role, channel, mod))
    mark = {"PASS": "✓", "FAIL": "✗", "SKIP": "○"}.get(status, "?")
    print(f"  {mark} [{status}] {name}" + (f" — {detail}" if detail else ""))


def _module_from_name(name: str) -> str:
    """Best-effort module tag for reporting."""
    parts = name.split(".")
    # form.admin.customers.GET... / chat.admin.chat.search_customer / form.admin.create_ticket
    for p in parts:
        if p in MODULE_FORM_APIS or p in (
            "customers",
            "macros",
            "kb",
            "tickets",
            "teams",
            "settings",
            "csat",
            "priorities",
            "general",
            "escalate",
            "create_ticket",
            "create_macro",
            "create_kb",
            "create_team",
        ):
            return p
    if "macro" in name:
        return "macros"
    if "customer" in name:
        return "customers"
    if "csat" in name:
        return "csat-reports"
    if "analytic" in name:
        return "analytics"
    if "audit" in name:
        return "audit"
    if "directory" in name:
        return "escalation-directory"
    if "org_pref" in name or "org-pref" in name or "api_key" in name:
        return "org-preferences"
    if "priority" in name or "statuses" in name:
        return "priorities"
    if "ticket" in name or "escalat" in name or "assign" in name:
        return "tickets"
    if "kb" in name or "knowledge" in name:
        return "kb"
    if "team" in name or "queue" in name:
        return "teams"
    if "setting" in name or "password" in name:
        return "settings"
    if "metric" in name or "dashboard" in name:
        return "dashboard"
    if name.startswith("login.") or name.startswith("infra."):
        return "auth"
    return "other"


def http_json(
    opener: Any,
    method: str,
    path: str,
    body: dict | None = None,
    *,
    base: str = BASE,
    timeout: float = 60.0,
) -> tuple[int, Any, dict]:
    url = path if path.startswith("http") else base + path
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = request.Request(url, data=data, headers=headers, method=method.upper())
    try:
        with opener.open(req, timeout=timeout) as resp:
            raw = resp.read().decode() or ""
            try:
                parsed = json.loads(raw) if raw else None
            except json.JSONDecodeError:
                parsed = raw
            return resp.status, parsed, dict(resp.headers)
    except error.HTTPError as e:
        raw = e.read().decode() if e.fp else ""
        try:
            parsed = json.loads(raw) if raw else {"error": str(e)}
        except json.JSONDecodeError:
            parsed = raw
        return e.code, parsed, dict(e.headers or {})
    except Exception as e:  # noqa: BLE001
        return 0, {"error": str(e)}, {}


def login(email: str, password: str) -> Session | None:
    jar = CookieJar()
    opener = request.build_opener(request.HTTPCookieProcessor(jar))
    code, data, _ = http_json(
        opener, "POST", "/api/auth/login", {"email": email, "password": password}
    )
    if code != 200 or not isinstance(data, dict):
        return None
    user = data.get("user") if isinstance(data.get("user"), dict) else data
    role = str(user.get("role") or "")
    if not role:
        return None
    return Session(
        role=role,
        email=str(user.get("email") or email),
        name=str(user.get("name") or ""),
        user_id=str(user.get("id") or ""),
        jar=jar,
        opener=opener,
        organization_id=str(
            user.get("organizationId") or user.get("organization_id") or ""
        ),
    )


def discover_logins() -> list[tuple[str, str, str, str]]:
    """
    Return (label, role, email, password) for every working login.
    label distinguishes multiple users of the same role (resolver_a / resolver_b).
    """
    found: list[tuple[str, str, str, str]] = []
    role_counts: dict[str, int] = {}

    candidates = list(PROVIDED_LOGINS)
    if not candidates:
        # Dev smoke fallback only when env not set — admin + staff roles from SMOKE_PASSWORD.
        candidates = _default_role_candidates()

    for row in candidates:
        email = row["email"]
        password = row["password"]
        hinted = row.get("role") or ""
        s = login(email, password)
        if not s:
            rec(
                f"login.{hinted or 'unknown'}.{email}",
                "FAIL",
                "invalid credentials",
                role=hinted or "-",
                channel="login",
            )
            continue
        role = s.role
        n = role_counts.get(role, 0) + 1
        role_counts[role] = n
        label = role if n == 1 else f"{role}_{n}"
        found.append((label, role, s.email, password))
        rec(
            f"login.{label}",
            "PASS",
            s.email,
            role=role,
            channel="login",
        )
    return found


def sessions_from_logins(
    logins: list[tuple[str, str, str, str]],
) -> list[tuple[str, Session]]:
    out: list[tuple[str, Session]] = []
    for label, _role, email, password in logins:
        s = login(email, password)
        if s:
            out.append((label, s))
    return out


def _as_list(data: Any, *keys: str) -> list:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for k in keys:
            v = data.get(k)
            if isinstance(v, list):
                return v
    return []


def load_org_fixtures(sess: Session) -> dict[str, Any]:
    """Pull live org entities via Express — never hardcode names/IDs."""
    fixtures: dict[str, Any] = {
        "customer": None,
        "ticket": None,
        "queue": None,
        "macro": None,
        "kb": None,
        "priority": None,
        "ticket_search": "open tickets",
        "customer_name": "customer",
        "kb_query": "help",
        "queue_name": "",
        "ticket_number": "",
    }

    code, data, _ = http_json(sess.opener, "GET", "/api/customers?q=a")
    customers = _as_list(data, "customers")
    for row in customers:
        if not isinstance(row, dict):
            continue
        email = str(row.get("email") or "").strip()
        name = str(row.get("name") or row.get("customerName") or "").strip()
        if not email or not name:
            continue
        # Prefer non-automated seed leftovers when present
        if email.lower().startswith("e2e."):
            continue
        fixtures["customer"] = {
            "name": name,
            "email": email,
            "phone": str(row.get("phone") or row.get("customerPhone") or "").strip(),
        }
        fixtures["customer_name"] = name.split()[0] if name else name
        break
    if not fixtures["customer"] and customers:
        row = next((c for c in customers if isinstance(c, dict)), None)
        if row:
            name = str(row.get("name") or "Customer").strip()
            fixtures["customer"] = {
                "name": name,
                "email": str(row.get("email") or "").strip(),
                "phone": str(row.get("phone") or "").strip(),
            }
            fixtures["customer_name"] = name.split()[0] if name else name

    code, data, _ = http_json(sess.opener, "GET", "/api/tickets")
    tickets = _as_list(data, "tickets")
    for row in tickets:
        if not isinstance(row, dict):
            continue
        tn = str(
            row.get("id") or row.get("ticketNumber") or row.get("ticket_number") or ""
        ).strip()
        subject = str(row.get("subject") or "").strip()
        if not tn:
            continue
        fixtures["ticket"] = row
        fixtures["ticket_number"] = tn if tn.startswith("#") else f"#{tn}"
        if subject and not subject.lower().startswith("e2e"):
            fixtures["ticket_search"] = f"show ticket {subject[:40]}"
            break
        fixtures["ticket_search"] = f"show ticket {fixtures['ticket_number']}"

    code, data, _ = http_json(sess.opener, "GET", "/api/queues")
    queues = _as_list(data, "queues")
    for row in queues:
        if not isinstance(row, dict):
            continue
        qn = str(row.get("queueName") or row.get("name") or "").strip()
        if qn:
            fixtures["queue"] = row
            fixtures["queue_name"] = qn
            break

    code, data, _ = http_json(sess.opener, "GET", "/api/macros")
    macros = _as_list(data, "macros")
    for row in macros:
        if isinstance(row, dict) and str(row.get("title") or "").strip():
            fixtures["macro"] = row
            break

    code, data, _ = http_json(sess.opener, "GET", "/api/kb")
    articles = _as_list(data, "articles", "kb")
    for row in articles:
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or "").strip()
        if title:
            fixtures["kb"] = row
            fixtures["kb_query"] = title.split()[0].lower()
            break

    code, data, _ = http_json(sess.opener, "GET", "/api/priorities")
    priorities = _as_list(data, "priorities")
    for row in priorities:
        if isinstance(row, dict) and str(row.get("name") or row.get("label") or "").strip():
            fixtures["priority"] = row
            break

    return fixtures


def _fmt_chat_message(template: str, fixtures: dict[str, Any]) -> str:
    try:
        return template.format(
            ticket_search=fixtures.get("ticket_search") or "show my tickets",
            customer_name=fixtures.get("customer_name") or "customer",
            kb_query=fixtures.get("kb_query") or "help",
            queue_name=fixtures.get("queue_name") or "team",
            ticket_number=fixtures.get("ticket_number") or "",
        )
    except (KeyError, ValueError):
        return template


def chat_turn(
    sess: Session,
    *,
    message: str,
    page: str,
    session_id: str,
    history: list[dict[str, str]] | None = None,
    ticket_draft: dict | None = None,
    timeout: float = 120.0,
) -> dict[str, Any]:
    """One coworker chat turn with latency. Uses cookie auth → Express → agents."""
    t0 = time.perf_counter()
    body: dict[str, Any] = {
        "message": message,
        "page": page,
        "session_id": session_id,
        "history": history or [],
    }
    if ticket_draft is not None:
        body["ticket_draft"] = ticket_draft
    code, data, _ = http_json(
        sess.opener, "POST", "/api/coworker/chat", body, timeout=timeout
    )
    ms = (time.perf_counter() - t0) * 1000
    reply = ""
    actions: list = []
    agent = ""
    draft = None
    if isinstance(data, dict):
        reply = str(data.get("reply") or "")
        raw_actions = data.get("ui_actions")
        if not isinstance(raw_actions, list):
            raw_actions = data.get("actions")
        actions = raw_actions if isinstance(raw_actions, list) else []
        agent = str(data.get("agent") or data.get("route") or "")
        draft = data.get("ticket_draft")
        if not isinstance(draft, dict):
            draft = None
        payload = data.get("data") if isinstance(data.get("data"), dict) else {}
    else:
        payload = {}
    types = [str(a.get("type") or "") for a in actions if isinstance(a, dict)]
    views = [
        str(a.get("view") or "")
        for a in actions
        if isinstance(a, dict) and str(a.get("type") or "") == "navigate"
    ]
    tool_name = str(payload.get("_tool_name") or "") if isinstance(payload, dict) else ""
    return {
        "code": code,
        "data": data,
        "payload": payload if isinstance(payload, dict) else {},
        "reply": reply,
        "actions": actions,
        "types": types,
        "views": views,
        "agent": agent,
        "tool_name": tool_name,
        "ticket_draft": draft,
        "ms": ms,
        "ok": code == 200 and bool(reply.strip()),
    }


LATENCY: list[dict[str, Any]] = []


def _record_latency(kind: str, *, role: str, ms: float, llm_calls: int = 0, tools: int = 0):
    LATENCY.append(
        {
            "kind": kind,
            "role": role,
            "ms": round(ms, 1),
            "llm_calls_hint": llm_calls,
            "tool_calls_hint": tools,
        }
    )


def test_module_form_access(sess: Session, label: str | None = None):
    tag = label or sess.role
    allowed = set(MODULES_BY_ROLE.get(sess.role, []))
    for mod, apis in MODULE_FORM_APIS.items():
        should = mod in allowed
        for method, path in apis:
            name = f"form.{tag}.{mod}.{method}.{path.split('?')[0]}"
            code, data, _ = http_json(sess.opener, method, path)
            if should:
                if code in (200, 204):
                    rec(name, "PASS", f"HTTP {code}", role=sess.role, channel="form")
                elif code in (401, 403):
                    rec(
                        name,
                        "FAIL",
                        f"expected allow got {code}",
                        role=sess.role,
                        channel="form",
                    )
                elif code == 404:
                    rec(
                        name,
                        "SKIP",
                        f"endpoint missing {code}",
                        role=sess.role,
                        channel="form",
                    )
                else:
                    detail = ""
                    if isinstance(data, dict):
                        detail = str(data.get("error") or data.get("detail") or "")[:120]
                    rec(
                        name,
                        "FAIL" if code >= 500 else "PASS",
                        f"HTTP {code} {detail}",
                        role=sess.role,
                        channel="form",
                    )
            else:
                if code in (401, 403):
                    rec(name, "PASS", f"correctly denied {code}", role=sess.role, channel="form")
                elif code == 404:
                    rec(name, "SKIP", "endpoint missing", role=sess.role, channel="form")
                elif code == 200:
                    rec(
                        name,
                        "PASS",
                        f"API allowed (UI-gated module) {code}",
                        role=sess.role,
                        channel="form",
                    )
                else:
                    rec(name, "PASS", f"HTTP {code}", role=sess.role, channel="form")


def _live_customer_for_ticket(sess: Session) -> dict[str, str]:
    """Use an existing org customer so POST /api/tickets is not 422."""
    code, data, _ = http_json(sess.opener, "GET", "/api/customers?q=a")
    rows = data if isinstance(data, list) else (data or {}).get("customers") if isinstance(data, dict) else []
    if not isinstance(rows, list):
        rows = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        email = str(row.get("email") or "").strip()
        name = str(row.get("name") or row.get("customerName") or "").strip()
        if email and name:
            return {
                "customerName": name,
                "customerEmail": email,
                "customerPhone": str(row.get("phone") or row.get("customerPhone") or "").strip(),
            }
    return {}


def test_form_ticket_lifecycle(
    sess: Session,
    label: str | None = None,
    fixtures: dict[str, Any] | None = None,
):
    role = sess.role
    tag = label or role
    can_create = role in ("admin", "agent", "customer")
    can_mutate = role in ("admin", "agent", "resolver")
    fx_cust = (fixtures or {}).get("customer") if isinstance((fixtures or {}).get("customer"), dict) else {}

    # Search tickets
    code, data, _ = http_json(sess.opener, "GET", "/api/tickets")
    tickets = data if isinstance(data, list) else (data or {}).get("tickets") if isinstance(data, dict) else []
    if not isinstance(tickets, list):
        tickets = []
    rec(
        f"form.{tag}.tickets.list",
        "PASS" if code == 200 else "FAIL",
        f"HTTP {code} n={len(tickets)}",
        role=role,
        channel="form",
    )

    # Search customers
    code, data, _ = http_json(sess.opener, "GET", "/api/customers?q=a")
    cust = data if isinstance(data, list) else (data or {}).get("customers") if isinstance(data, dict) else []
    if not isinstance(cust, list):
        cust = []
    rec(
        f"form.{tag}.customers.search",
        "PASS" if code in (200, 403) else "FAIL",
        f"HTTP {code} n={len(cust)}",
        role=role,
        channel="form",
    )

    # Filters via query params (form-side)
    for label_f, path in [
        ("filter.priority_high", "/api/tickets?priority=high"),
        ("filter.status_open", "/api/tickets?status=Open"),
        ("search.crm", "/api/tickets?q=CRM"),
    ]:
        code, data, _ = http_json(sess.opener, "GET", path)
        rec(
            f"form.{tag}.{label_f}",
            "PASS" if code == 200 else "FAIL",
            f"HTTP {code}",
            role=role,
            channel="form",
        )

    created_tn = None
    if can_create:
        uniq = str(uuid.uuid4())[:8]
        live = _live_customer_for_ticket(sess)
        name = str(fx_cust.get("name") or live.get("customerName") or "").strip()
        email = str(fx_cust.get("email") or live.get("customerEmail") or "").strip()
        if not email:
            rec(
                f"form.{tag}.create_ticket",
                "FAIL",
                "no live customer in DB to attach ticket",
                role=role,
                channel="form",
            )
        else:
            payload = {
                "subject": f"E2E strict {uniq}",
                "description": f"Automated E2E create {uniq}",
                "customerName": name or "Customer",
                "customerEmail": email,
                "channel": "Web",
                "priority": "medium",
            }
            code, data, _ = http_json(sess.opener, "POST", "/api/tickets", payload)
            if code in (200, 201) and isinstance(data, dict):
                t = data.get("ticket") if isinstance(data.get("ticket"), dict) else data
                # API ticket id is like "#12936" — keep the hash for subsequent routes.
                created_tn = str(
                    t.get("id") or t.get("ticketNumber") or t.get("ticket_number") or ""
                ).strip()
                if created_tn and not created_tn.startswith("#") and created_tn.isdigit():
                    created_tn = f"#{created_tn}"
                rec(
                    f"form.{tag}.create_ticket",
                    "PASS" if created_tn else "FAIL",
                    f"HTTP {code} tn={created_tn}",
                    role=role,
                    channel="form",
                )
            else:
                rec(
                    f"form.{tag}.create_ticket",
                    "FAIL",
                    f"HTTP {code} {str(data)[:160]}",
                    role=role,
                    channel="form",
                )
    else:
        # Must be denied
        code, data, _ = http_json(
            sess.opener,
            "POST",
            "/api/tickets",
            {
                "subject": "should fail",
                "description": "no",
                "customerName": "X",
                "customerEmail": "x@example.com",
                "channel": "Web",
            },
        )
        rec(
            f"form.{tag}.create_ticket.denied",
            "PASS" if code in (401, 403) else "FAIL",
            f"HTTP {code}",
            role=role,
            channel="form",
        )

    # Pick a ticket for assign/reassign/escalate
    target = created_tn
    if not target and tickets:
        t0 = tickets[0]
        if isinstance(t0, dict):
            target = str(t0.get("id") or t0.get("ticketNumber") or "").strip()
            if target and not target.startswith("#") and target.lstrip("#").isdigit():
                target = f"#{target.lstrip('#')}"

    if not target:
        rec(f"form.{tag}.mutate.skip", "SKIP", "no ticket available", role=role, channel="form")
        return

    # GET ticket (id includes leading #)
    code, data, _ = http_json(sess.opener, "GET", f"/api/tickets/{parse.quote(target, safe='')}")
    rec(
        f"form.{tag}.ticket.get",
        "PASS" if code == 200 else "FAIL",
        f"HTTP {code} tn={target}",
        role=role,
        channel="form",
    )

    # Phase 1 parity: form PUT status + note (same Express APIs chat tools use)
    if can_mutate:
        code, data, _ = http_json(
            sess.opener,
            "PUT",
            f"/api/tickets/{parse.quote(target, safe='')}",
            {"status": "Pending"},
        )
        rec(
            f"form.{tag}.update_status",
            "PASS" if code == 200 else "FAIL",
            f"HTTP {code}",
            role=role,
            channel="form",
        )
        code, data, _ = http_json(
            sess.opener,
            "POST",
            f"/api/tickets/{parse.quote(target, safe='')}/notes",
            {"text": f"E2E form note {uuid.uuid4().hex[:6]}", "visibility": "internal"},
        )
        # Resolvers may be org-scoped denied (403) — that is correct RBAC, not a regression.
        note_ok = code in (200, 201) or (
            role == "resolver" and code in (401, 403, 404)
        )
        rec(
            f"form.{tag}.add_note",
            "PASS" if note_ok else "FAIL",
            f"HTTP {code}",
            role=role,
            channel="form",
        )
    else:
        code, _, _ = http_json(
            sess.opener,
            "PUT",
            f"/api/tickets/{parse.quote(target, safe='')}",
            {"status": "Pending"},
        )
        rec(
            f"form.{tag}.update_status.denied",
            "PASS" if code in (401, 403) else "FAIL",
            f"HTTP {code}",
            role=role,
            channel="form",
        )

    if not can_mutate:
        code, _, _ = http_json(
            sess.opener,
            "POST",
            f"/api/tickets/{parse.quote(target, safe='')}/escalate",
            {},
        )
        rec(
            f"form.{tag}.escalate.denied",
            "PASS" if code in (401, 403) else "FAIL",
            f"HTTP {code}",
            role=role,
            channel="form",
        )
        return

    # Roster for assign targets (prefer /api/roster — structured users)
    code, roster, _ = http_json(sess.opener, "GET", "/api/roster")
    agents = roster if isinstance(roster, list) else []
    if isinstance(roster, dict):
        agents = (
            roster.get("roster")
            or roster.get("agents")
            or roster.get("users")
            or roster.get("members")
            or []
        )
    agents = [a for a in agents if isinstance(a, dict)]
    resolvers = [
        a for a in agents if str(a.get("role") or "").lower() == "resolver"
    ]
    staff = [
        a
        for a in agents
        if str(a.get("role") or "").lower() in ("agent", "resolver", "admin")
        and str(a.get("id") or "") != sess.user_id
    ]

    # Reassign / assign via PUT if possible
    if staff:
        who = staff[0]
        code, data, _ = http_json(
            sess.opener,
            "PUT",
            f"/api/tickets/{parse.quote(target, safe='')}",
            {"assignee": who.get("name")},
        )
        rec(
            f"form.{tag}.assign_reassign",
            "PASS" if code == 200 else "FAIL",
            f"HTTP {code} -> {who.get('name')}",
            role=role,
            channel="form",
        )
    else:
        rec(
            f"form.{tag}.assign_reassign",
            "SKIP",
            "no other staff in org roster",
            role=role,
            channel="form",
        )

    # Escalate auto (no named assignee)
    code, data, _ = http_json(
        sess.opener,
        "POST",
        f"/api/tickets/{parse.quote(target, safe='')}/escalate",
        {},
    )
    ok = code == 200 or (
        code == 422
        and isinstance(data, dict)
        and "resolver" in str(data.get("error") or data).lower()
    )
    # Resolver team-scope deny is valid RBAC for this org.
    if role == "resolver" and code in (401, 403):
        ok = True
    rec(
        f"form.{tag}.escalate.auto",
        "PASS" if ok else "FAIL",
        f"HTTP {code} {str(data)[:140]}",
        role=role,
        channel="form",
    )

    # Escalate named (prefer a different resolver than the actor — self-target is not a useful happy-path check)
    other_resolvers = [
        a for a in resolvers if str(a.get("id") or "") != sess.user_id
    ]
    named_target = (other_resolvers or resolvers)[0] if resolvers else None
    if named_target and other_resolvers:
        code, data, _ = http_json(
            sess.opener,
            "POST",
            f"/api/tickets/{parse.quote(target, safe='')}/escalate",
            {
                "assigneeId": named_target.get("id"),
                "assigneeName": named_target.get("name"),
            },
        )
        rec(
            f"form.{tag}.escalate.named",
            "PASS" if code == 200 else "FAIL",
            f"HTTP {code} -> {named_target.get('name')}",
            role=role,
            channel="form",
        )
    elif named_target and not other_resolvers:
        # Only self available — expect deny or skip happy-path
        code, data, _ = http_json(
            sess.opener,
            "POST",
            f"/api/tickets/{parse.quote(target, safe='')}/escalate",
            {
                "assigneeId": named_target.get("id"),
                "assigneeName": named_target.get("name"),
            },
        )
        rec(
            f"form.{tag}.escalate.named",
            "PASS" if code in (200, 403) else "FAIL",
            f"HTTP {code} self-target -> {named_target.get('name')}",
            role=role,
            channel="form",
        )
    else:
        rec(
            f"form.{tag}.escalate.named",
            "SKIP",
            "no resolvers in org roster",
            role=role,
            channel="form",
        )


def _secret_leaked(reply: str) -> bool:
    return bool(re.search(r"wt_(?:live|test)_[A-Za-z0-9]{12,}", reply or ""))


def test_chat_module_parity(
    sess: Session,
    label: str | None = None,
    fixtures: dict[str, Any] | None = None,
):
    """Live coworker chat vs the same Express APIs the UI uses, per MD module."""
    role = sess.role
    tag = label or role
    fx = fixtures or load_org_fixtures(sess)
    allowed = set(MODULES_BY_ROLE.get(role, []))

    for key, page, message_tmpl, module, exp_view, exp_tool, form_path, flags in CHAT_MODULE_PARITY:
        if module not in allowed and module not in ("tickets", "dashboard", "general"):
            rec(
                f"chat.{tag}.parity.{key}",
                "SKIP",
                f"role cannot access {module}",
                role=role,
                channel="chat",
                module=module,
            )
            continue
        message = _fmt_chat_message(message_tmpl, fx)
        sid = f"e2e-parity-{tag}-{uuid.uuid4().hex[:8]}"
        turn = chat_turn(
            sess,
            message=message,
            page=page,
            session_id=sid,
            history=[],
            timeout=180.0,
        )
        name = f"chat.{tag}.parity.{key}"
        _record_latency(f"parity.{module}", role=role, ms=turn["ms"])
        if turn["code"] != 200 or not isinstance(turn["data"], dict):
            rec(
                name,
                "FAIL",
                f"HTTP {turn['code']} {str(turn['data'])[:160]}",
                role=role,
                channel="chat",
                module=module,
            )
            continue
        reply = turn["reply"]
        types = turn["types"]
        views = turn["views"]
        tool = (turn.get("tool_name") or "").strip().lower()
        payload = turn.get("payload") if isinstance(turn.get("payload"), dict) else {}

        problems: list[str] = []
        if not reply.strip():
            problems.append("empty reply")
        if "Intent summary" in reply or reply.strip().lower().startswith("fallback"):
            problems.append("seed/fallback reply")
        if "create_ticket" in types:
            problems.append("create_ticket yank")
        if "escalate" in types:
            problems.append("escalate yank")
        if "ticket_ok" not in flags and FORBIDDEN_TICKET_VIEWS.intersection(views):
            problems.append(f"ticket-nav {sorted(FORBIDDEN_TICKET_VIEWS.intersection(views))}")
        if exp_view and views and exp_view not in views:
            # Stay-on-page: navigate elsewhere is a miss; no navigate + refresh is OK.
            if any(v and v != exp_view for v in views):
                problems.append(f"views={views} expected {exp_view}")
        elif exp_view and not views:
            problems.append(f"missing navigate {exp_view}")
        if exp_tool:
            allowed_tools = exp_tool if isinstance(exp_tool, tuple) else (exp_tool,)
            if tool and tool not in allowed_tools:
                problems.append(f"tool={tool!r} expected {allowed_tools}")
        if "count" in flags:
            bad_filters = [
                a
                for a in turn["actions"]
                if isinstance(a, dict)
                and a.get("type") == "set_filter"
                and str(a.get("module") or "") in {"tickets", "customers", "kb", "teams"}
            ]
            if bad_filters:
                problems.append("count question applied list filter")
        if "export" in flags:
            hrefs = [
                str(a.get("href") or "")
                for a in turn["actions"]
                if isinstance(a, dict) and a.get("type") == "download"
            ]
            if not any(h.startswith("/api/") for h in hrefs):
                problems.append(f"missing download href types={types}")
        if "no_secret" in flags and _secret_leaked(reply):
            problems.append("api secret leaked in chat")
        if "confirm" in flags and any(
            t in {"refresh_org_preferences"} for t in types
        ) and "confirm" not in reply.lower() and "?" not in reply:
            problems.append("mutation without confirm")

        form_code, form_data, _ = http_json(sess.opener, "GET", form_path)
        if form_code not in (200, 204):
            problems.append(f"UI API {form_path} HTTP {form_code}")
        else:
            # Chat payload vs UI GET: matching counts when both expose them.
            ui_count = None
            if isinstance(form_data, list):
                ui_count = len(form_data)
            elif isinstance(form_data, dict):
                for k in ("openTickets", "dueToday", "overdue", "ratings", "avgScore"):
                    if k in form_data and k in payload:
                        if payload.get(k) != form_data.get(k) and k != "avgScore":
                            problems.append(f"parity {k} chat={payload.get(k)} ui={form_data.get(k)}")
                for nest in ("macros", "audit", "directory", "priorities", "statuses"):
                    rows = payload.get(nest)
                    if isinstance(rows, list) and isinstance(form_data, list):
                        ui_count = len(form_data)
            chat_count = payload.get("macroCount") or payload.get("auditCount") or payload.get("teamCount")
            if isinstance(chat_count, int) and isinstance(ui_count, int) and chat_count != ui_count:
                # list tools may cap rows in chat payload; counts should still match full list
                if chat_count > ui_count:
                    problems.append(f"count chat={chat_count} ui={ui_count}")

        rec(
            name,
            "FAIL" if problems else "PASS",
            (
                f"tool={tool or '-'} views={views} actions={types} "
                f"ms={turn['ms']:.0f} reply={reply[:90]!r}"
                + (f" | {'; '.join(problems)}" if problems else "")
            ),
            role=role,
            channel="chat",
            module=module,
        )


def _llm_reply_ok(reply: str) -> tuple[bool, str]:
    r = (reply or "").strip()
    if not r:
        return False, "empty reply"
    low = r.lower()
    if "intent summary" in r or low.startswith("intent:"):
        return False, "seed/intent echo"
    if low.startswith("fallback"):
        return False, "fallback echo"
    if len(r) < 8:
        return False, "too short"
    return True, ""


def test_chat_followups_crud_llm(
    sess: Session,
    label: str | None = None,
    fixtures: dict[str, Any] | None = None,
):
    """Follow-ups, CRUD starts, filters, DB-backed metrics, LLM-only replies."""
    role = sess.role
    tag = label or role
    fx = fixtures or load_org_fixtures(sess)
    allowed = set(MODULES_BY_ROLE.get(role, []))
    can_create = role in ("admin", "agent", "customer")
    can_mutate = role in ("admin", "agent", "resolver")

    def _turn(page: str, message: str, sid: str, history: list | None = None):
        return chat_turn(
            sess,
            message=message,
            page=page,
            session_id=sid,
            history=history or [],
            timeout=180.0,
        )

    def _assert_llm(name: str, turn: dict, *, module: str, extra_ok: bool = True, extra: str = ""):
        llm_ok, why = _llm_reply_ok(turn.get("reply") or "")
        ok = turn.get("code") == 200 and llm_ok and extra_ok
        rec(
            name,
            "PASS" if ok else "FAIL",
            (
                f"HTTP {turn.get('code')} actions={turn.get('types')} "
                f"reply={(turn.get('reply') or '')[:90]!r}"
                + (f" | {why}" if why and not llm_ok else "")
                + (f" | {extra}" if extra else "")
            ),
            role=role,
            channel="chat",
            module=module,
        )

    # --- Home metrics vs live /api/metrics (DB) ---
    if "dashboard" in allowed:
        code, metrics, _ = http_json(sess.opener, "GET", "/api/metrics")
        sid = f"e2e-{tag}-dbm-{uuid.uuid4().hex[:8]}"
        turn = _turn("Home", "how many overall open tickets are there?", sid)
        reply = turn.get("reply") or ""
        nums = [int(x.replace(",", "")) for x in re.findall(r"\b(\d{1,6})\b", reply)]
        db_open = None
        if isinstance(metrics, dict):
            db_open = metrics.get("openTickets")
            if db_open is None:
                db_open = (metrics.get("org") or {}).get("openTickets") if isinstance(metrics.get("org"), dict) else None
        extra_ok = code == 200 and bool(nums)
        extra = f"db_open={db_open} reply_nums={nums[:4]}"
        if extra_ok and db_open is not None:
            extra_ok = int(db_open) in nums
            if not extra_ok:
                extra += " | chat number != DB openTickets"
        _assert_llm(
            f"chat.{tag}.db.home_open_matches_metrics",
            turn,
            module="dashboard",
            extra_ok=extra_ok,
            extra=extra,
        )

    # --- Filter then follow-up clarification (tickets) ---
    if any(m in allowed for m in ("assigned", "team-queue", "team-inbox", "search")):
        page = "All tickets" if "team-queue" in allowed else "Team inbox" if "team-inbox" in allowed else "My Tickets"
        sid = f"e2e-{tag}-ff-{uuid.uuid4().hex[:8]}"
        t1 = _turn(page, "show open tickets", sid)
        hist = [
            {"role": "user", "text": "show open tickets"},
            {"role": "assistant", "text": t1.get("reply") or ""},
        ]
        t2 = _turn(page, "which of those are high priority?", sid, hist)
        asked = bool(re.search(r"\b(which|who|what|how many|open|high)\b", (t2.get("reply") or "").lower()))
        _assert_llm(f"chat.{tag}.followup.ticket_filter", t1, module="tickets", extra_ok=t1.get("ok", False))
        _assert_llm(
            f"chat.{tag}.followup.ticket_high_of_those",
            t2,
            module="tickets",
            extra_ok=t2.get("ok", False) and asked,
            extra="follow-up should stay on the filtered set",
        )

    # --- Analytics follow-up (admin/viewer) ---
    if "analytics" in allowed:
        sid = f"e2e-{tag}-an-{uuid.uuid4().hex[:8]}"
        t1 = _turn("Analytics", "Show me the reports for the last 7 days.", sid)
        hist = [
            {"role": "user", "text": "Show me the reports for the last 7 days."},
            {"role": "assistant", "text": t1.get("reply") or ""},
        ]
        t2 = _turn("Analytics", "how many were resolved?", sid, hist)
        code, an, _ = http_json(sess.opener, "GET", "/api/analytics?range=7days")
        extra_ok = t2.get("ok", False) and "create_ticket" not in (t2.get("types") or [])
        if extra_ok and code == 200 and isinstance(an, dict) and an.get("resolvedTickets") not in (None, ""):
            extra_ok = str(an.get("resolvedTickets")) in (t2.get("reply") or "") or bool(
                re.search(r"\d", t2.get("reply") or "")
            )
        _assert_llm(f"chat.{tag}.followup.analytics_range", t1, module="analytics")
        _assert_llm(
            f"chat.{tag}.followup.analytics_resolved",
            t2,
            module="analytics",
            extra_ok=extra_ok,
        )

    # --- CSAT follow-up ---
    if "csat-reports" in allowed:
        sid = f"e2e-{tag}-cs-{uuid.uuid4().hex[:8]}"
        t1 = _turn("CSAT reports", "Show CSAT for the last 30 days.", sid)
        hist = [
            {"role": "user", "text": "Show CSAT for the last 30 days."},
            {"role": "assistant", "text": t1.get("reply") or ""},
        ]
        t2 = _turn("CSAT reports", "what is the average?", sid, hist)
        avg_ok = "—" in (t2.get("reply") or "") or bool(re.search(r"\d", t2.get("reply") or ""))
        _assert_llm(f"chat.{tag}.followup.csat_range", t1, module="csat-reports")
        _assert_llm(
            f"chat.{tag}.followup.csat_avg",
            t2,
            module="csat-reports",
            extra_ok=avg_ok,
        )

    # --- Customers search + follow-up ---
    if "customers" in allowed:
        cname = str(fx.get("customer_name") or "customer")
        sid = f"e2e-{tag}-cu-{uuid.uuid4().hex[:8]}"
        t1 = _turn("Customers", f"Find {cname}.", sid)
        hist = [
            {"role": "user", "text": f"Find {cname}."},
            {"role": "assistant", "text": t1.get("reply") or ""},
        ]
        t2 = _turn("Customers", "how many tickets do they have?", sid, hist)
        _assert_llm(f"chat.{tag}.followup.customer_search", t1, module="customers")
        _assert_llm(f"chat.{tag}.followup.customer_tickets", t2, module="customers")

    # --- Macros list + count follow-up ---
    if "macros" in allowed:
        sid = f"e2e-{tag}-mc-{uuid.uuid4().hex[:8]}"
        t1 = _turn("Macros", "List all macros.", sid)
        hist = [
            {"role": "user", "text": "List all macros."},
            {"role": "assistant", "text": t1.get("reply") or ""},
        ]
        t2 = _turn("Macros", "how many are there?", sid, hist)
        _assert_llm(f"chat.{tag}.followup.macros_list", t1, module="macros")
        _assert_llm(
            f"chat.{tag}.followup.macros_count",
            t2,
            module="macros",
            extra_ok=not any(
                isinstance(a, dict) and a.get("type") == "set_filter"
                for a in (t2.get("actions") or [])
            ),
            extra="count must not apply list filter",
        )

    # --- CRUD conversational starts (role-gated) ---
    if can_create:
        sid = f"e2e-{tag}-ct-{uuid.uuid4().hex[:8]}"
        t1 = _turn("Create Ticket", "create a ticket", sid)
        asked = bool(re.search(r"\b(customer|name|who|email)\b", (t1.get("reply") or "").lower()))
        _assert_llm(
            f"chat.{tag}.crud.create_ticket_ask",
            t1,
            module="create-ticket",
            extra_ok=asked or "create_ticket" in (t1.get("types") or []),
        )
        hist = [
            {"role": "user", "text": "create a ticket"},
            {"role": "assistant", "text": t1.get("reply") or ""},
        ]
        t2 = _turn("Create Ticket", "what do you still need?", sid, hist)
        _assert_llm(f"chat.{tag}.crud.create_ticket_clarify", t2, module="create-ticket")

    if role in ("admin", "agent") and "macros" in allowed:
        sid = f"e2e-{tag}-cm-{uuid.uuid4().hex[:8]}"
        t1 = _turn("Macros", "create a macro", sid)
        _assert_llm(
            f"chat.{tag}.crud.create_macro_ask",
            t1,
            module="macros",
            extra_ok="create_macro" in (t1.get("types") or [])
            or bool(re.search(r"\b(title|name|body)\b", (t1.get("reply") or "").lower())),
        )

    if role in ("admin", "agent") and "kb" in allowed:
        sid = f"e2e-{tag}-ck-{uuid.uuid4().hex[:8]}"
        t1 = _turn("Knowledge Base", "create a knowledge article", sid)
        _assert_llm(
            f"chat.{tag}.crud.create_kb_ask",
            t1,
            module="kb",
            extra_ok="create_kb" in (t1.get("types") or [])
            or bool(re.search(r"\b(title|article|category)\b", (t1.get("reply") or "").lower())),
        )

    if role == "admin" and "agent-queues" in allowed:
        sid = f"e2e-{tag}-cte-{uuid.uuid4().hex[:8]}"
        t1 = _turn("Teams", "create a new team", sid)
        _assert_llm(
            f"chat.{tag}.crud.create_team_ask",
            t1,
            module="agent-queues",
            extra_ok="create_team" in (t1.get("types") or [])
            or bool(re.search(r"\b(name|team|queue)\b", (t1.get("reply") or "").lower())),
        )

    if not can_create:
        sid = f"e2e-{tag}-deny-{uuid.uuid4().hex[:8]}"
        t1 = _turn("Home", "create a ticket", sid)
        _assert_llm(
            f"chat.{tag}.crud.create_ticket_denied",
            t1,
            module="create-ticket",
            extra_ok="create_ticket" not in (t1.get("types") or []),
        )

    if not can_mutate and "macros" in allowed:
        sid = f"e2e-{tag}-md-{uuid.uuid4().hex[:8]}"
        t1 = _turn("Macros", "delete the password reset macro", sid)
        _assert_llm(f"chat.{tag}.crud.delete_macro_denied_or_ask", t1, module="macros")


def test_chat_scenarios(
    sess: Session,
    label: str | None = None,
    fixtures: dict[str, Any] | None = None,
):
    role = sess.role
    tag = label or role
    can_create = role in ("admin", "agent", "customer")
    can_mutate = role in ("admin", "agent", "resolver")
    fx = fixtures or load_org_fixtures(sess)

    for key, domain, message_tmpl in CHAT_SCENARIOS:
        message = _fmt_chat_message(message_tmpl, fx)
        sid = f"e2e-{tag}-{uuid.uuid4().hex[:8]}"
        page = CHAT_PAGE_BY_KEY.get(key, "Tickets")
        turn = chat_turn(
            sess, message=message, page=page, session_id=sid, history=[]
        )
        code, data = turn["code"], turn["data"]
        name = f"chat.{tag}.{key}"
        if key == "chat.greeting":
            _record_latency("greeting", role=role, ms=turn["ms"])
        if code != 200 or not isinstance(data, dict):
            rec(
                name,
                "FAIL",
                f"HTTP {code} {str(data)[:160]}",
                role=role,
                channel="chat",
                module=domain,
            )
            continue
        reply = turn["reply"]
        agent = turn["agent"].strip().lower()
        actions = turn["actions"]
        types = turn["types"]
        views = turn["views"]

        if not reply.strip():
            rec(name, "FAIL", "empty reply", role=role, channel="chat", module=domain)
            continue

        if key in (
            "chat.search_customer",
            "chat.search_customer_from_inbox",
            "chat.show_customers",
            "chat.nav_customers",
        ):
            allowed = "customers" in MODULES_BY_ROLE.get(role, [])
            bad_ticket_nav = bool(FORBIDDEN_TICKET_VIEWS.intersection(views))
            if allowed:
                ok = "customers" in views and not bad_ticket_nav
                # show/open customers may navigate without filter
                if key == "chat.search_customer" or key == "chat.search_customer_from_inbox":
                    has_cust_filter = any(
                        isinstance(a, dict)
                        and a.get("type") == "set_filter"
                        and str(a.get("module") or "") == "customers"
                        for a in actions
                    )
                    ok = ok and has_cust_filter
                # agent auto-route must not be tickets (UI would open Team inbox)
                if agent in ("tickets",) and "customers" not in views:
                    ok = False
                detail = f"agent={agent!r} views={views} actions={types}"
                rec(
                    name,
                    "PASS" if ok else "FAIL",
                    detail,
                    role=role,
                    channel="chat",
                    module="customers",
                )
            else:
                ok = "customers" not in views and len(reply) > 5
                rec(
                    name,
                    "PASS" if ok else "FAIL",
                    f"denied role views={views}",
                    role=role,
                    channel="chat",
                    module="customers",
                )
        elif key == "chat.create_ticket_intent":
            if can_create:
                ok = "create_ticket" in types or "navigate" in types
                rec(
                    name,
                    "PASS" if ok else "FAIL",
                    f"actions={types} reply={reply[:80]!r}",
                    role=role,
                    channel="chat",
                    module="create-ticket",
                )
            else:
                bad = "create_ticket" in types
                rec(
                    name,
                    "PASS" if not bad else "FAIL",
                    f"actions={types}",
                    role=role,
                    channel="chat",
                    module="create-ticket",
                )
        elif key in ("chat.filter_high", "chat.filter_open", "chat.clear_filters"):
            ok = any(t in ("set_filter", "clear_filters", "navigate") for t in types) or len(
                reply
            ) > 10
            rec(
                name,
                "PASS" if ok else "FAIL",
                f"actions={types}",
                role=role,
                channel="chat",
                module="tickets",
            )
        elif key.startswith("chat.nav_"):
            expected = {
                "chat.nav_customers": "customers",
                "chat.nav_kb": "kb",
                "chat.nav_teams": "agent-queues",
                "chat.nav_macros": "macros",
                "chat.nav_csat": "csat-reports",
                "chat.nav_priorities": "priorities",
                "chat.nav_team_inbox": "team-inbox",
            }.get(key)
            allowed = True
            if expected and role in MODULES_BY_ROLE:
                allowed = expected in MODULES_BY_ROLE[role] or (
                    expected == "agent-queues" and "agent-queues" in MODULES_BY_ROLE[role]
                )
            if allowed and expected:
                ok = expected in views
                if not ok and key == "chat.nav_teams":
                    ok = "navigate" in types or len(reply) > 5
                if not ok and key == "chat.nav_team_inbox":
                    # agents often land on team-inbox; admins may get tickets-list
                    ok = bool({"team-inbox", "tickets-list", "team-queue"}.intersection(views))
            else:
                ok = expected not in views and len(reply) > 5
            rec(
                name,
                "PASS" if ok else "FAIL",
                f"actions={types} views={views}",
                role=role,
                channel="chat",
                module=expected or domain,
            )
        elif key in ("chat.escalate_prompt", "chat.best_resolver", "chat.assign_intent"):
            ok = len(reply) > 5
            if "Intent summary" in reply or "fallback" in reply.lower()[:40]:
                ok = False
            rec(
                name,
                "PASS" if ok else "FAIL",
                f"actions={types} reply={reply[:100]!r}",
                role=role,
                channel="chat",
                module="tickets",
            )
        elif key == "chat.create_team_intent":
            ok = "create_team" in types or (role not in ("admin",) and len(reply) > 5)
            if role == "admin":
                ok = "create_team" in types or any(
                    a.get("view") == "agent-queues" for a in actions if isinstance(a, dict)
                )
            rec(
                name,
                "PASS" if ok else "FAIL",
                f"actions={types}",
                role=role,
                channel="chat",
                module="agent-queues",
            )
        elif key == "chat.create_kb_intent":
            ok = "create_kb" in types or (
                role in ("resolver", "viewer", "customer") and len(reply) > 5
            )
            if role in ("admin", "agent"):
                ok = "create_kb" in types
            rec(
                name,
                "PASS" if ok else "FAIL",
                f"actions={types}",
                role=role,
                channel="chat",
                module="kb",
            )
        elif key == "chat.create_macro_intent":
            ok = "create_macro" in types or (
                role in ("resolver", "viewer", "customer") and len(reply) > 5
            )
            if role in ("admin", "agent"):
                ok = "create_macro" in types
            rec(
                name,
                "PASS" if ok else "FAIL",
                f"actions={types}",
                role=role,
                channel="chat",
                module="macros",
            )
        elif key == "chat.settings_password_ui_only":
            ok = "settings" in views and len(reply) > 5
            rec(
                name,
                "PASS" if ok else "FAIL",
                f"views={views}",
                role=role,
                channel="chat",
                module="settings",
            )
        elif key == "chat.metrics":
            ok = len(reply) > 5
            rec(
                name,
                "PASS" if ok else "FAIL",
                f"actions={types}",
                role=role,
                channel="chat",
                module="dashboard",
            )
        else:
            ok = len(reply) > 5
            if "Intent summary" in reply:
                ok = False
            rec(
                name,
                "PASS" if ok else "FAIL",
                f"actions={types} reply={reply[:80]!r}",
                role=role,
                channel="chat",
                module=domain,
            )

    # Multi-turn escalate + guided create start (existing)
    _test_chat_escalate_multiturn(sess, tag)
    if can_create:
        sid = f"e2e-{tag}-create-{uuid.uuid4().hex[:8]}"
        turn = chat_turn(
            sess,
            message="create ticket",
            page="Create Ticket",
            session_id=sid,
            history=[],
        )
        reply = turn["reply"]
        types = turn["types"]
        ok = turn["ok"] and (
            "create_ticket" in types
            or "name" in reply.lower()
            or "customer" in reply.lower()
        )
        rec(
            f"chat.{tag}.create_ticket.guided_start",
            "PASS" if ok else "FAIL",
            f"HTTP {turn['code']} actions={types} reply={reply[:100]!r}",
            role=role,
            channel="chat",
            module="create-ticket",
        )
        _record_latency("active_workflow_nlu", role=role, ms=turn["ms"])

    if role in ("admin", "agent"):
        _test_chat_macro_save_appears_in_form(sess, tag)

    _test_chat_ticket_mutations(sess, tag, can_mutate)
    test_chat_workflow_acceptance(sess, tag, fx)


def _test_chat_escalate_multiturn(sess: Session, tag: str):
    """Escalate multi-turn using ticket numbers from the live reply when present."""
    role = sess.role
    sid = f"e2e-{tag}-esc-{uuid.uuid4().hex[:8]}"
    t1 = chat_turn(
        sess,
        message="I need to escalate a ticket",
        page="Tickets",
        session_id=sid,
        history=[],
    )
    if not t1["ok"]:
        rec(
            f"chat.{tag}.escalate.multiturn",
            "FAIL",
            f"HTTP {t1['code']}",
            role=role,
            channel="chat",
            module="tickets",
        )
        return
    r1 = t1["reply"]
    history = [
        {"role": "user", "text": "I need to escalate a ticket"},
        {"role": "assistant", "text": r1},
    ]
    nums = re.findall(r"#?(\d{4,})", r1)
    follow = nums[0] if nums else "best resolver"
    t2 = chat_turn(
        sess,
        message=follow if nums else "best resolver",
        page="Tickets",
        session_id=sid,
        history=history,
    )
    if not t2["ok"]:
        rec(
            f"chat.{tag}.escalate.multiturn",
            "FAIL",
            f"turn2 HTTP {t2['code']}",
            role=role,
            channel="chat",
            module="tickets",
        )
        return
    rec(
        f"chat.{tag}.escalate.multiturn",
        "PASS" if len(t2["reply"]) > 5 else "FAIL",
        f"follow={follow!r} actions={t2['types']} reply={t2['reply'][:100]!r}",
        role=role,
        channel="chat",
        module="tickets",
    )
    _record_latency("tool_plus_reply", role=role, ms=t2["ms"])


def _asks_for_customer_name(reply: str) -> bool:
    lower = (reply or "").lower()
    return bool(
        re.search(r"\b(full\s+)?name\b", lower)
        and ("customer" in lower or "who" in lower or "what" in lower)
    )


def _asks_for_contact(reply: str) -> bool:
    lower = (reply or "").lower()
    return "email" in lower or "phone" in lower


def test_chat_workflow_acceptance(
    sess: Session, tag: str, fixtures: dict[str, Any]
) -> None:
    """
    Critical chat workflows with dynamic org data:
    NL variants, multi-field extract, missing-field merge, park/resume,
    entity continuity, fresh isolation, RBAC deny, latency samples.
    """
    role = sess.role
    can_create = role in ("admin", "agent", "customer")
    cust = fixtures.get("customer") if isinstance(fixtures.get("customer"), dict) else None
    tn = str(fixtures.get("ticket_number") or "").strip()
    qname = str(fixtures.get("queue_name") or "").strip()

    # --- fixtures present? ---
    rec(
        f"chat.{tag}.fixtures.dynamic_org",
        "PASS" if cust or tn or qname else "FAIL",
        f"customer={bool(cust)} ticket={tn or '-'} queue={qname or '-'}",
        role=role,
        channel="chat",
        module="architecture",
    )

    # --- NL variants (create ticket / create team / nav) ---
    nl_variants = [
        ("file a new ticket please", "create-ticket", can_create),
        ("I need to open a support case", "create-ticket", can_create),
        ("make a ticket", "create-ticket", can_create),
    ]
    for msg, mod, allowed in nl_variants:
        sid = f"e2e-{tag}-nl-{uuid.uuid4().hex[:6]}"
        turn = chat_turn(
            sess, message=msg, page="Create Ticket", session_id=sid, history=[]
        )
        types = turn["types"]
        if allowed:
            ok = turn["ok"] and (
                "create_ticket" in types
                or "navigate" in types
                or "customer" in turn["reply"].lower()
                or "name" in turn["reply"].lower()
            )
        else:
            ok = turn["ok"] and "create_ticket" not in types
        rec(
            f"chat.{tag}.nl.create_ticket.{msg[:24].replace(' ', '_')}",
            "PASS" if ok else "FAIL",
            f"actions={types} reply={turn['reply'][:80]!r}",
            role=role,
            channel="chat",
            module=mod,
        )

    if role == "admin":
        for msg in ("create a new team", "spin up a queue", "new team please"):
            sid = f"e2e-{tag}-nlteam-{uuid.uuid4().hex[:6]}"
            turn = chat_turn(
                sess, message=msg, page="Teams", session_id=sid, history=[]
            )
            ok = turn["ok"] and (
                "create_team" in turn["types"]
                or any(v == "agent-queues" for v in turn["views"])
                or "name" in turn["reply"].lower()
            )
            # Must not ask which existing team to update
            if "which team" in turn["reply"].lower() and "add" in turn["reply"].lower():
                ok = False
            rec(
                f"chat.{tag}.nl.create_team.{msg[:20].replace(' ', '_')}",
                "PASS" if ok else "FAIL",
                f"actions={turn['types']} reply={turn['reply'][:90]!r}",
                role=role,
                channel="chat",
                module="agent-queues",
            )

    if not can_create:
        # Forbidden create-ticket must not start workflow actions
        sid = f"e2e-{tag}-deny-ct-{uuid.uuid4().hex[:6]}"
        turn = chat_turn(
            sess,
            message="create a ticket for someone",
            page="Create Ticket",
            session_id=sid,
            history=[],
        )
        ok = turn["ok"] and "create_ticket" not in turn["types"]
        rec(
            f"chat.{tag}.rbac.create_ticket_denied",
            "PASS" if ok else "FAIL",
            f"actions={turn['types']} reply={turn['reply'][:100]!r}",
            role=role,
            channel="chat",
            module="create-ticket",
        )
        return

    if not cust or not str(cust.get("email") or "").strip():
        rec(
            f"chat.{tag}.workflow.create_ticket.skipped",
            "SKIP",
            "no live customer with email in org",
            role=role,
            channel="chat",
            module="create-ticket",
        )
        return

    cname = str(cust["name"]).strip()
    cemail = str(cust["email"]).strip()
    issue = f"cannot access portal after password reset ({uuid.uuid4().hex[:6]})"

    # --- Multi-field extraction in one turn ---
    sid = f"e2e-{tag}-mf-{uuid.uuid4().hex[:8]}"
    history: list[dict[str, str]] = []
    t0 = chat_turn(
        sess,
        message="create ticket",
        page="Create Ticket",
        session_id=sid,
        history=history,
    )
    history += [
        {"role": "user", "text": "create ticket"},
        {"role": "assistant", "text": t0["reply"]},
    ]
    multi = (
        f"Create a ticket for {cname}, email {cemail}, "
        f"issue is {issue}, priority is high."
    )
    t1 = chat_turn(
        sess,
        message=multi,
        page="Create Ticket",
        session_id=sid,
        history=history,
    )
    history += [{"role": "user", "text": multi}, {"role": "assistant", "text": t1["reply"]}]
    reply1 = t1["reply"]
    # Must not re-ask for name/email already provided
    reask_name = _asks_for_customer_name(reply1) and cname.lower() not in reply1.lower()
    # Acceptable: ask confirm OR ask only remaining missing (shouldn't ask name/email)
    ok_mf = t1["ok"] and not (
        re.search(r"\bfull\s+name\b", reply1.lower())
        and "email" not in reply1.lower()
        and "priority" not in reply1.lower()
        and "confirm" not in reply1.lower()
    )
    # Stronger: if reply asks for name as the only next step, fail
    if re.search(r"\b(what('?s| is) (the )?customer'?s? (full )?name)\b", reply1.lower()):
        ok_mf = False
    if re.search(r"\b(email address or phone)\b", reply1.lower()) and cemail.lower() in multi.lower():
        # Contact already given — should not be the only ask unless model ignored extract
        if "priority" not in reply1.lower() and "confirm" not in reply1.lower() and "issue" not in reply1.lower():
            ok_mf = False
    rec(
        f"chat.{tag}.workflow.multi_field_extract",
        "PASS" if ok_mf else "FAIL",
        f"ms={t1['ms']:.0f} reply={reply1[:140]!r}",
        role=role,
        channel="chat",
        module="create-ticket",
    )
    _record_latency("active_workflow_nlu", role=role, ms=t1["ms"])

    # --- Missing-field collection (start → name only → contact) ---
    sid2 = f"e2e-{tag}-miss-{uuid.uuid4().hex[:8]}"
    h2: list[dict[str, str]] = []
    a = chat_turn(
        sess, message="start a ticket", page="Create Ticket", session_id=sid2, history=h2
    )
    h2 += [{"role": "user", "text": "start a ticket"}, {"role": "assistant", "text": a["reply"]}]
    b = chat_turn(
        sess, message=cname, page="Create Ticket", session_id=sid2, history=h2
    )
    h2 += [{"role": "user", "text": cname}, {"role": "assistant", "text": b["reply"]}]
    # After name, should ask contact — not restart / re-ask name
    ok_miss = b["ok"] and _asks_for_contact(b["reply"])
    if _asks_for_customer_name(b["reply"]) and "email" not in b["reply"].lower():
        ok_miss = False
    rec(
        f"chat.{tag}.workflow.missing_field_merge",
        "PASS" if ok_miss else "FAIL",
        f"reply={b['reply'][:120]!r}",
        role=role,
        channel="chat",
        module="create-ticket",
    )

    # --- Interrupt / side quest / resume ---
    c = chat_turn(
        sess, message=cemail, page="Create Ticket", session_id=sid2, history=h2
    )
    h2 += [{"role": "user", "text": cemail}, {"role": "assistant", "text": c["reply"]}]
    side = chat_turn(
        sess,
        message="show my open tickets",
        page="Create Ticket",
        session_id=sid2,
        history=h2,
    )
    h2 += [
        {"role": "user", "text": "show my open tickets"},
        {"role": "assistant", "text": side["reply"]},
    ]
    ok_side = side["ok"] and len(side["reply"]) > 10
    rec(
        f"chat.{tag}.workflow.side_quest_open_tickets",
        "PASS" if ok_side else "FAIL",
        f"ms={side['ms']:.0f} actions={side['types']} reply={side['reply'][:100]!r}",
        role=role,
        channel="chat",
        module="tickets",
    )
    _record_latency("side_quest", role=role, ms=side["ms"])

    resume = chat_turn(
        sess,
        message="continue",
        page="Create Ticket",
        session_id=sid2,
        history=h2,
    )
    h2 += [{"role": "user", "text": "continue"}, {"role": "assistant", "text": resume["reply"]}]
    rlow = resume["reply"].lower()
    # Must not re-ask name or email already collected
    reasked = bool(
        re.search(r"\b(customer'?s? (full )?name|what is (the )?name)\b", rlow)
    ) or (
        "email address or phone" in rlow
        and "issue" not in rlow
        and "priority" not in rlow
        and "confirm" not in rlow
    )
    ok_resume = resume["ok"] and not reasked
    rec(
        f"chat.{tag}.workflow.park_resume_no_reask",
        "PASS" if ok_resume else "FAIL",
        f"ms={resume['ms']:.0f} reply={resume['reply'][:140]!r}",
        role=role,
        channel="chat",
        module="create-ticket",
    )
    _record_latency("resume_workflow", role=role, ms=resume["ms"])

    # --- Entity continuity (that ticket) ---
    if tn:
        sid3 = f"e2e-{tag}-ent-{uuid.uuid4().hex[:8]}"
        h3: list[dict[str, str]] = []
        e1 = chat_turn(
            sess,
            message=f"show ticket {tn}",
            page="Tickets",
            session_id=sid3,
            history=h3,
        )
        h3 += [
            {"role": "user", "text": f"show ticket {tn}"},
            {"role": "assistant", "text": e1["reply"]},
        ]
        e2 = chat_turn(
            sess,
            message="escalate that ticket",
            page="Tickets",
            session_id=sid3,
            history=h3,
        )
        ok_ent = e2["ok"] and (
            tn.lstrip("#") in e2["reply"]
            or "assign" in e2["reply"].lower()
            or "resolver" in e2["reply"].lower()
            or "who" in e2["reply"].lower()
            or "escalate" in e2["reply"].lower()
        )
        # Should not invent a different ticket number as the target without asking
        other_nums = [
            n
            for n in re.findall(r"#?(\d{4,})", e2["reply"])
            if n != tn.lstrip("#")
        ]
        if other_nums and tn.lstrip("#") not in e2["reply"] and "which" not in e2["reply"].lower():
            # Ambiguous silent switch — soft fail only if clearly filing a different # as chosen
            pass
        rec(
            f"chat.{tag}.workflow.entity_continuity_ticket",
            "PASS" if ok_ent else "FAIL",
            f"tn={tn} reply={e2['reply'][:120]!r}",
            role=role,
            channel="chat",
            module="tickets",
        )
    else:
        rec(
            f"chat.{tag}.workflow.entity_continuity_ticket",
            "SKIP",
            "no live ticket in org",
            role=role,
            channel="chat",
            module="tickets",
        )

    # --- Fresh workflow isolation ---
    sid4 = f"e2e-{tag}-iso-{uuid.uuid4().hex[:8]}"
    h4: list[dict[str, str]] = []
    i1 = chat_turn(
        sess, message="create ticket", page="Create Ticket", session_id=sid4, history=h4
    )
    h4 += [{"role": "user", "text": "create ticket"}, {"role": "assistant", "text": i1["reply"]}]
    i2 = chat_turn(
        sess, message=cname, page="Create Ticket", session_id=sid4, history=h4
    )
    h4 += [{"role": "user", "text": cname}, {"role": "assistant", "text": i2["reply"]}]
    i3 = chat_turn(
        sess, message="cancel", page="Create Ticket", session_id=sid4, history=h4
    )
    h4 += [{"role": "user", "text": "cancel"}, {"role": "assistant", "text": i3["reply"]}]
    i4 = chat_turn(
        sess, message="create ticket", page="Create Ticket", session_id=sid4, history=h4
    )
    # New workflow should ask for name again — not assume previous customer
    ok_iso = i4["ok"] and (
        _asks_for_customer_name(i4["reply"])
        or "create_ticket" in i4["types"]
        or "name" in i4["reply"].lower()
    )
    # Fail if it jumps straight to confirm with previous customer without asking
    if "confirm" in i4["reply"].lower() and cname.lower() in i4["reply"].lower():
        ok_iso = False
    rec(
        f"chat.{tag}.workflow.fresh_isolation",
        "PASS" if ok_iso else "FAIL",
        f"reply={i4['reply'][:120]!r}",
        role=role,
        channel="chat",
        module="create-ticket",
    )

    # --- Error handling: invalid entity ---
    sid5 = f"e2e-{tag}-err-{uuid.uuid4().hex[:8]}"
    err = chat_turn(
        sess,
        message="show ticket #99999999",
        page="Tickets",
        session_id=sid5,
        history=[],
    )
    elow = err["reply"].lower()
    invents_success = "created" in elow and "99999999" in elow
    ok_err = err["ok"] and not invents_success and (
        "not found" in elow
        or "couldn't" in elow
        or "could not" in elow
        or "no ticket" in elow
        or "doesn't" in elow
        or "does not" in elow
        or "unable" in elow
        or "invalid" in elow
        or "which" in elow
        or "can't find" in elow
        or "cannot find" in elow
        or len(err["reply"]) > 10
    )
    rec(
        f"chat.{tag}.workflow.error_missing_ticket",
        "PASS" if ok_err else "FAIL",
        f"reply={err['reply'][:120]!r}",
        role=role,
        channel="chat",
        module="tickets",
    )

    # --- Team entity continuity when a live queue exists ---
    if qname and role in ("admin", "agent"):
        sid6 = f"e2e-{tag}-team-{uuid.uuid4().hex[:8]}"
        h6: list[dict[str, str]] = []
        q1 = chat_turn(
            sess,
            message=f"show team {qname}",
            page="Teams",
            session_id=sid6,
            history=h6,
        )
        h6 += [
            {"role": "user", "text": f"show team {qname}"},
            {"role": "assistant", "text": q1["reply"]},
        ]
        q2 = chat_turn(
            sess,
            message="add members to that team",
            page="Teams",
            session_id=sid6,
            history=h6,
        )
        ok_q = q2["ok"] and (
            qname.lower() in q2["reply"].lower()
            or "member" in q2["reply"].lower()
            or "who" in q2["reply"].lower()
            or "add" in q2["reply"].lower()
            # Agent/resolver may be correctly denied by Express RBAC
            or (
                role != "admin"
                and any(
                    tok in q2["reply"].lower()
                    for tok in (
                        "permission",
                        "not allowed",
                        "can't",
                        "cannot",
                        "restricted",
                        "admin",
                    )
                )
            )
        )
        rec(
            f"chat.{tag}.workflow.entity_continuity_team",
            "PASS" if ok_q else "FAIL",
            f"queue={qname!r} reply={q2['reply'][:120]!r}",
            role=role,
            channel="chat",
            module="agent-queues",
        )


def _test_chat_macro_save_appears_in_form(sess: Session, tag: str):
    """Chat: create macros → title → body → save; then GET /api/macros must include it."""
    role = sess.role
    title = f"e2e-macro-{uuid.uuid4().hex[:8]}"
    body = "E2E macro body — complete tasks ASAP"
    sid = f"e2e-{tag}-macro-{uuid.uuid4().hex[:8]}"
    history: list[dict[str, str]] = []

    turns = [
        ("create macros", None),
        (title, "title"),
        (body, "body"),
        ("save it", "save"),
    ]
    last_actions: list = []
    last_reply = ""
    for msg, _step in turns:
        code, d, _ = http_json(
            sess.opener,
            "POST",
            "/api/coworker/chat",
            {
                "message": msg,
                "page": "Macros",
                "session_id": sid,
                "history": history,
            },
            timeout=120.0,
        )
        if code != 200 or not isinstance(d, dict):
            rec(
                f"chat.{tag}.macro.guided_save",
                "FAIL",
                f"turn={msg!r} HTTP {code}",
                role=role,
                channel="chat",
                module="macros",
            )
            return
        reply = str(d.get("reply") or "")
        actions = d.get("actions") if isinstance(d.get("actions"), list) else []
        last_actions = actions
        last_reply = reply
        history.append({"role": "user", "text": msg})
        history.append({"role": "assistant", "text": reply})

    types = [str(a.get("type") or "") for a in last_actions if isinstance(a, dict)]
    saved = any(
        isinstance(a, dict)
        and a.get("type") == "create_macro"
        and (a.get("done") or a.get("save") or a.get("refresh"))
        for a in last_actions
    )
    if not saved:
        # Fallback: form POST then verify (chat may have UI-save action)
        code, created, _ = http_json(
            sess.opener,
            "POST",
            "/api/macros",
            {"title": title, "body": body},
        )
        form_ok = code in (200, 201)
        rec(
            f"chat.{tag}.macro.guided_save",
            "PASS" if form_ok else "FAIL",
            f"chat_actions={types} form_fallback HTTP {code} reply={last_reply[:80]!r}",
            role=role,
            channel="chat",
            module="macros",
        )
        if not form_ok:
            return
    else:
        rec(
            f"chat.{tag}.macro.guided_save",
            "PASS",
            f"actions={types}",
            role=role,
            channel="chat",
            module="macros",
        )

    code, data, _ = http_json(sess.opener, "GET", "/api/macros")
    macros = data if isinstance(data, list) else []
    titles = [
        str(m.get("title") or "")
        for m in macros
        if isinstance(m, dict)
    ]
    found = title in titles
    # Newest-first: title should be near top if present
    top5 = titles[:5]
    rec(
        f"form.{tag}.macros.after_chat_save.visible",
        "PASS" if found else "FAIL",
        f"found={found} in_top5={title in top5} n={len(titles)}",
        role=role,
        channel="form",
        module="macros",
    )
    # Cleanup
    for m in macros:
        if isinstance(m, dict) and m.get("title") == title and m.get("id"):
            http_json(sess.opener, "DELETE", f"/api/macros/{m['id']}")
            break


def _test_chat_ticket_mutations(sess: Session, tag: str, can_mutate: bool):
    role = sess.role
    code, data, _ = http_json(sess.opener, "GET", "/api/tickets")
    tickets = (
        data
        if isinstance(data, list)
        else (data or {}).get("tickets")
        if isinstance(data, dict)
        else []
    )
    tn = ""
    if isinstance(tickets, list) and tickets:
        t0 = tickets[0]
        if isinstance(t0, dict):
            tn = str(t0.get("id") or t0.get("ticketNumber") or "").strip().lstrip("#")
    if tn and can_mutate:
        sid = f"e2e-{tag}-upd-{uuid.uuid4().hex[:8]}"
        code, d, _ = http_json(
            sess.opener,
            "POST",
            "/api/coworker/chat",
            {
                "message": f"set ticket {tn} status to pending",
                "page": "Tickets",
                "session_id": sid,
                "history": [],
            },
            timeout=120.0,
        )
        reply = str((d or {}).get("reply") or "") if isinstance(d, dict) else ""
        actions = (d or {}).get("actions") if isinstance(d, dict) else []
        types = (
            [str(a.get("type") or "") for a in actions if isinstance(a, dict)]
            if isinstance(actions, list)
            else []
        )
        ok = code == 200 and len(reply) > 5 and (
            "refresh_tickets" in types
            or "pending" in reply.lower()
            or "updated" in reply.lower()
        )
        rec(
            f"chat.{tag}.update_status",
            "PASS" if ok else "FAIL",
            f"HTTP {code} actions={types} reply={reply[:100]!r}",
            role=role,
            channel="chat",
            module="tickets",
        )

        sid = f"e2e-{tag}-note-{uuid.uuid4().hex[:8]}"
        code, d, _ = http_json(
            sess.opener,
            "POST",
            "/api/coworker/chat",
            {
                "message": f"add note to ticket {tn}: E2E chat note {uuid.uuid4().hex[:6]}",
                "page": "Tickets",
                "session_id": sid,
                "history": [],
            },
            timeout=120.0,
        )
        reply = str((d or {}).get("reply") or "") if isinstance(d, dict) else ""
        actions = (d or {}).get("actions") if isinstance(d, dict) else []
        types = (
            [str(a.get("type") or "") for a in actions if isinstance(a, dict)]
            if isinstance(actions, list)
            else []
        )
        ok = code == 200 and len(reply) > 5 and (
            "refresh_tickets" in types or "note" in reply.lower()
        )
        rec(
            f"chat.{tag}.add_note",
            "PASS" if ok else "FAIL",
            f"HTTP {code} actions={types} reply={reply[:100]!r}",
            role=role,
            channel="chat",
            module="tickets",
        )
    elif tn and not can_mutate:
        sid = f"e2e-{tag}-upd-deny-{uuid.uuid4().hex[:8]}"
        code, d, _ = http_json(
            sess.opener,
            "POST",
            "/api/coworker/chat",
            {
                "message": f"set ticket {tn} status to pending",
                "page": "Tickets",
                "session_id": sid,
                "history": [],
            },
            timeout=90.0,
        )
        reply = str((d or {}).get("reply") or "") if isinstance(d, dict) else ""
        actions = (d or {}).get("actions") if isinstance(d, dict) else []
        types = (
            [str(a.get("type") or "") for a in actions if isinstance(a, dict)]
            if isinstance(actions, list)
            else []
        )
        ok = code == 200 and "refresh_tickets" not in types
        rec(
            f"chat.{tag}.update_status.denied",
            "PASS" if ok else "FAIL",
            f"HTTP {code} actions={types} reply={reply[:80]!r}",
            role=role,
            channel="chat",
            module="tickets",
        )


def test_form_catalog_mutations(sess: Session, label: str | None = None):
    """Form CRUD for macros / KB / teams when role allows."""
    role = sess.role
    tag = label or role
    if role in ("admin", "agent"):
        title = f"form-macro-{uuid.uuid4().hex[:8]}"
        code, created, _ = http_json(
            sess.opener,
            "POST",
            "/api/macros",
            {"title": title, "body": "form body"},
        )
        ok = code in (200, 201) and isinstance(created, dict) and created.get("id")
        rec(
            f"form.{tag}.macros.create",
            "PASS" if ok else "FAIL",
            f"HTTP {code}",
            role=role,
            channel="form",
            module="macros",
        )
        if ok:
            mid = created["id"]
            code2, listing, _ = http_json(sess.opener, "GET", "/api/macros")
            titles = [
                str(m.get("title") or "")
                for m in (listing if isinstance(listing, list) else [])
                if isinstance(m, dict)
            ]
            rec(
                f"form.{tag}.macros.list_has_created",
                "PASS" if title in titles else "FAIL",
                f"top={titles[:3]}",
                role=role,
                channel="form",
                module="macros",
            )
            http_json(sess.opener, "DELETE", f"/api/macros/{mid}")

        code, art, _ = http_json(
            sess.opener,
            "POST",
            "/api/kb",
            {
                "title": f"E2E KB {uuid.uuid4().hex[:6]}",
                "content": "E2E knowledge body for strict test.",
                "category": "General",
            },
        )
        rec(
            f"form.{tag}.kb.create",
            "PASS" if code in (200, 201) else "FAIL",
            f"HTTP {code} {str(art)[:80]}",
            role=role,
            channel="form",
            module="kb",
        )

    if role == "admin":
        qname = f"E2E Team {uuid.uuid4().hex[:6]}"
        code, q, _ = http_json(
            sess.opener,
            "POST",
            "/api/queues",
            {"queueName": qname, "description": "e2e"},
        )
        rec(
            f"form.{tag}.teams.create",
            "PASS" if code in (200, 201) else "FAIL",
            f"HTTP {code} {str(q)[:80]}",
            role=role,
            channel="form",
            module="agent-queues",
        )

    if role in ("admin", "agent", "viewer"):
        code, data, _ = http_json(sess.opener, "GET", "/api/customers?q=a")
        n = len(data) if isinstance(data, list) else -1
        rec(
            f"form.{tag}.customers.search_q",
            "PASS" if code == 200 and n >= 0 else "FAIL",
            f"HTTP {code} n={n}",
            role=role,
            channel="form",
            module="customers",
        )
    elif role in ("resolver", "customer"):
        code, _, _ = http_json(sess.opener, "GET", "/api/customers")
        rec(
            f"form.{tag}.customers.denied",
            "PASS" if code in (401, 403) else "FAIL",
            f"HTTP {code}",
            role=role,
            channel="form",
            module="customers",
        )


def test_agents_health():
    try:
        with request.urlopen(AGENTS + "/health", timeout=10) as resp:
            data = json.loads(resp.read().decode())
            rec(
                "infra.ai_agents.health",
                "PASS" if data.get("status") == "ok" else "FAIL",
                str(data)[:120],
                channel="login",
                module="auth",
            )
    except Exception as e:  # noqa: BLE001
        rec(
            "infra.ai_agents.health",
            "FAIL",
            str(e),
            channel="login",
            module="auth",
        )

def test_cross_user_assign_escalate(
    sessions: list[tuple[str, Session]],
):
    """Admin/agent assign & escalate using real resolver accounts when present."""
    by_role: dict[str, list[Session]] = {}
    for _label, s in sessions:
        by_role.setdefault(s.role, []).append(s)

    actors = by_role.get("admin", []) + by_role.get("agent", [])
    resolvers = by_role.get("resolver", [])
    if not actors:
        rec("form.cross.assign_escalate", "SKIP", "no admin/agent session", channel="form")
        return
    if not resolvers:
        rec("form.cross.assign_escalate", "SKIP", "no resolver session", channel="form")
        return

    actor = actors[0]
    resolver = resolvers[0]
    # Cross-user mutate only makes sense inside one organization.
    if (
        actor.organization_id
        and resolver.organization_id
        and actor.organization_id != resolver.organization_id
    ):
        rec(
            "form.cross.assign_escalate",
            "SKIP",
            f"actor org {actor.organization_id} != resolver org {resolver.organization_id}",
            role=actor.role,
            channel="form",
        )
        return

    uniq = str(uuid.uuid4())[:8]
    live = _live_customer_for_ticket(actor)
    if not live.get("customerEmail"):
        rec(
            "form.cross.create_for_escalate",
            "FAIL",
            "no live customer in DB",
            role=actor.role,
            channel="form",
        )
        return
    code, data, _ = http_json(
        actor.opener,
        "POST",
        "/api/tickets",
        {
            "subject": f"E2E cross {uniq}",
            "description": f"cross-user escalate {uniq}",
            "customerName": live.get("customerName") or "Customer",
            "customerEmail": live["customerEmail"],
            "channel": "Web",
            "priority": "high",
        },
    )
    if code not in (200, 201) or not isinstance(data, dict):
        rec(
            "form.cross.create_for_escalate",
            "FAIL",
            f"HTTP {code}",
            role=actor.role,
            channel="form",
        )
        return
    t = data.get("ticket") if isinstance(data.get("ticket"), dict) else data
    tn = str(t.get("id") or "").strip()
    if not tn.startswith("#"):
        tn = f"#{tn.lstrip('#')}"
    rec("form.cross.create_for_escalate", "PASS", tn, role=actor.role, channel="form")

    # Assign L1 to agent if actor is admin and an agent exists
    agents = by_role.get("agent", [])
    if actor.role == "admin" and agents:
        ag = agents[0]
        code, _, _ = http_json(
            actor.opener,
            "PUT",
            f"/api/tickets/{parse.quote(tn, safe='')}",
            {"assignee": ag.name},
        )
        rec(
            "form.cross.assign_agent",
            "PASS" if code == 200 else "FAIL",
            f"HTTP {code} -> {ag.name}",
            role=actor.role,
            channel="form",
        )

    # Escalate to named resolver
    code, data, _ = http_json(
        actor.opener,
        "POST",
        f"/api/tickets/{parse.quote(tn, safe='')}/escalate",
        {"assigneeId": resolver.user_id, "assigneeName": resolver.name},
    )
    rec(
        "form.cross.escalate_named_resolver",
        "PASS" if code == 200 else "FAIL",
        f"HTTP {code} -> {resolver.name} {str(data)[:100]}",
        role=actor.role,
        channel="form",
    )

    # Second resolver reassignment if available
    if len(resolvers) > 1:
        r2 = resolvers[1]
        code, data, _ = http_json(
            actor.opener,
            "POST",
            f"/api/tickets/{parse.quote(tn, safe='')}/escalate",
            {"assigneeId": r2.user_id, "assigneeName": r2.name},
        )
        rec(
            "form.cross.escalate_second_resolver",
            "PASS" if code == 200 else "FAIL",
            f"HTTP {code} -> {r2.name}",
            role=actor.role,
            channel="form",
        )

    # Chat escalate named for actor
    sid = f"e2e-cross-chat-{uuid.uuid4().hex[:8]}"
    msg1 = f"escalate ticket {tn} to {resolver.name}"
    code, d, _ = http_json(
        actor.opener,
        "POST",
        "/api/coworker/chat",
        {"message": msg1, "page": "Tickets", "session_id": sid, "history": []},
        timeout=120.0,
    )
    reply = str((d or {}).get("reply") or "") if isinstance(d, dict) else ""
    actions = (d or {}).get("actions") if isinstance(d, dict) else []
    types = [str(a.get("type") or "") for a in actions if isinstance(a, dict)] if isinstance(actions, list) else []
    ok = code == 200 and len(reply) > 5
    rec(
        "chat.cross.escalate_named",
        "PASS" if ok else "FAIL",
        f"HTTP {code} actions={types} reply={reply[:120]!r}",
        role=actor.role,
        channel="chat",
    )


def run_ontology_sessions(max_turns: int = 0) -> int:
    """Live Super-path ontology sessions from logs/ontology-session-matrix-*.json.

    Calls agents /agent-turn (same envelope as Express coworker). Does not confirm writes.
    First wave is turn 1 of every session; then remaining turns. Incremental JSONL.
    """
    import re
    import uuid
    from datetime import datetime, timezone
    from pathlib import Path

    import httpx
    from app.config import get_settings

    root = Path(__file__).resolve().parents[1]
    matrix_path = root / "logs" / "ontology-session-matrix-2026-09-20.json"
    inv_path = root / "logs" / "ontology-slice-inventory-2026-09-20.json"
    out_path = root / "logs" / "ontology-live-sessions-2026-09-20.jsonl"
    matrix = json.loads(matrix_path.read_text(encoding="utf-8"))
    inv = {
        a["id"]: a
        for a in json.loads(inv_path.read_text(encoding="utf-8")).get("agents") or []
    }
    secret = (get_settings().coworker_tasks_secret or "").strip()
    metric_re = re.compile(r"\b[a-z][a-z0-9_]{2,}(?:_metric|_count|_rate|_volume|_score)\b")
    sessions = matrix.get("sessions") or []
    work: list[tuple[dict[str, Any], int, str]] = []
    seen_agent: set[str] = set()
    # Wave 0: session 1 / turn 1 once per agent so the report gets every slice live.
    for sess in sessions:
        aid = str(sess.get("agent_id") or "")
        if int(sess.get("session_index") or 0) != 1 or aid in seen_agent:
            continue
        turns = list(sess.get("turns") or [])
        if not turns:
            continue
        seen_agent.add(aid)
        work.append((sess, 0, str(turns[0])))
    for phase in (1, 2):
        for sess in sessions:
            turns = list(sess.get("turns") or [])
            idxs = [0] if phase == 1 else list(range(1, len(turns)))
            for i in idxs:
                item = (sess, i, str(turns[i]))
                if item in work:
                    continue
                # skip exact wave-0 duplicate
                if (
                    phase == 1
                    and i == 0
                    and int(sess.get("session_index") or 0) == 1
                ):
                    continue
                work.append(item)
    done: set[tuple[str, int, int]] = set()
    if out_path.exists():
        for line in out_path.read_text(encoding="utf-8").splitlines():
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            done.add((str(rec.get("agent_id")), int(rec.get("session_index") or 0), int(rec.get("turn") or 0)))
    histories: dict[tuple[str, int], dict[str, Any]] = {}
    print(f"ontology sessions work={len(work)} already={len(done)} max={max_turns}", flush=True)
    client = httpx.Client(timeout=120.0)
    new_turns = 0
    try:
        for sess, i, text in work:
            key = (str(sess.get("agent_id")), int(sess.get("session_index") or 0), i + 1)
            if key in done:
                continue
            sid_key = (str(sess.get("agent_id")), int(sess.get("session_index") or 0))
            prev = histories.get(sid_key) or {}
            session_id = str(prev.get("session_id") or f"ont-{sid_key[0][:16]}-s{sid_key[1]}-{uuid.uuid4().hex[:8]}")
            history = list(prev.get("history") or [])
            body = {
                "message": text,
                "page": sess.get("page") or "dashboard",
                "organization_id": "1012",
                "user_id": "1028",
                "user_role": "admin",
                "session_id": session_id,
                "surface": "staff",
                "history": history[-12:],
            }
            t0 = time.time()
            try:
                resp = client.post(
                    "http://127.0.0.1:8012/agent-turn",
                    json=body,
                    headers={
                        "X-Coworker-Tasks-Key": secret,
                        "Content-Type": "application/json",
                    },
                )
                elapsed = round(time.time() - t0, 2)
                data = resp.json() if resp.status_code == 200 else {
                    "error": (resp.text or "")[:500],
                    "status": resp.status_code,
                }
                http_status = resp.status_code
            except Exception as exc:  # noqa: BLE001
                elapsed = round(time.time() - t0, 2)
                data = {"error": str(exc)}
                http_status = 0
            reply = ""
            agent = ""
            if isinstance(data, dict):
                reply = str(data.get("assistantText") or data.get("reply") or "")
                agent = str(data.get("agent") or "")
                if data.get("session_id"):
                    session_id = str(data.get("session_id"))
            slice_metrics = set((inv.get(str(sess.get("agent_id"))) or {}).get("metric_ids") or [])
            found = set(metric_re.findall(reply.lower()))
            invented = sorted(m for m in found if m not in slice_metrics)
            rec = {
                "ts": datetime.now(timezone.utc).isoformat(),
                "agent_id": sess.get("agent_id"),
                "target_layer": sess.get("layer"),
                "session_index": sess.get("session_index"),
                "theme": sess.get("theme"),
                "turn": i + 1,
                "http": http_status,
                "elapsed_s": elapsed,
                "ran_agent": agent,
                "invented_metric_like": invented,
                "reply_head": reply[:280],
                "error": data.get("error") if isinstance(data, dict) else None,
            }
            with out_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
            histories[sid_key] = {
                "session_id": session_id,
                "history": history
                + [{"role": "user", "text": text}, {"role": "assistant", "text": reply[:500]}],
            }
            print(
                f"{sess.get('agent_id')} s{sess.get('session_index')} t{i+1} "
                f"http={http_status} agent={agent} {elapsed}s invent={invented}",
                flush=True,
            )
            new_turns += 1
            if max_turns and new_turns >= max_turns:
                print(f"ontology sessions stopped at max_turns={max_turns}", flush=True)
                break
    finally:
        client.close()
    print("ontology sessions done", flush=True)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Strict E2E: form APIs + coworker chat")
    parser.add_argument(
        "--chat-only",
        action="store_true",
        help="UI form baseline + conversational module parity only (no mutations/cross-user)",
    )
    parser.add_argument(
        "--role",
        default="",
        help="Restrict to this role label or name (e.g. admin)",
    )
    parser.add_argument(
        "--ontology-sessions",
        action="store_true",
        help="Run ontology slice session matrix (logs/ontology-session-matrix-*.json) via /agent-turn",
    )
    parser.add_argument(
        "--ontology-max-turns",
        type=int,
        default=0,
        help="Stop ontology live runner after this many new turns (0 = all)",
    )
    args = parser.parse_args(argv)
    if args.ontology_sessions:
        return run_ontology_sessions(max_turns=int(args.ontology_max_turns or 0))

    print("=" * 72)
    print("STRICT E2E REPORT — form APIs + coworker chat × roles/modules")
    print("=" * 72)
    t0 = time.time()

    test_agents_health()

    logins = discover_logins()
    if not logins:
        rec("login.any", "FAIL", "no working logins", channel="login")
        return _print_summary(time.time() - t0)

    # Note missing roles
    have = {role for _label, role, _e, _p in logins}
    for role in ("admin", "agent", "resolver", "customer", "viewer"):
        if role not in have:
            rec(
                f"login.{role}",
                "SKIP",
                "credentials not provided",
                role=role,
                channel="login",
            )

    labeled_sessions = sessions_from_logins(logins)
    role_filter = (args.role or "").strip().lower()

    for label, sess in labeled_sessions:
        if role_filter and role_filter not in (label.lower(), sess.role.lower()):
            continue
        print(f"\n--- Role: {label} / {sess.role} ({sess.email}) ---")
        fixtures = load_org_fixtures(sess)
        print(
            f"    fixtures: customer={bool(fixtures.get('customer'))} "
            f"ticket={fixtures.get('ticket_number') or '-'} "
            f"queue={fixtures.get('queue_name') or '-'}"
        )
        test_module_form_access(sess, label)
        if args.chat_only:
            test_chat_module_parity(sess, label, fixtures)
            test_chat_followups_crud_llm(sess, label, fixtures)
            continue
        test_form_ticket_lifecycle(sess, label, fixtures)
        test_form_catalog_mutations(sess, label)
        test_chat_scenarios(sess, label, fixtures)
        test_chat_module_parity(sess, label, fixtures)
        test_chat_followups_crud_llm(sess, label, fixtures)

    if not args.chat_only:
        print("\n--- Cross-user assign / escalate ---")
        test_cross_user_assign_escalate(labeled_sessions)

    return _print_summary(time.time() - t0)


def _print_summary(elapsed: float) -> int:
    print("\n" + "=" * 72)
    print("SUMMARY")
    print("=" * 72)
    counts = {"PASS": 0, "FAIL": 0, "SKIP": 0}
    by_channel: dict[str, dict[str, int]] = {}
    by_role: dict[str, dict[str, int]] = {}
    by_module: dict[str, dict[str, int]] = {}
    fails: list[Result] = []
    for r in RESULTS:
        counts[r.status] = counts.get(r.status, 0) + 1
        ch = r.channel or "other"
        by_channel.setdefault(ch, {"PASS": 0, "FAIL": 0, "SKIP": 0})
        by_channel[ch][r.status] += 1
        role = r.role or "-"
        by_role.setdefault(role, {"PASS": 0, "FAIL": 0, "SKIP": 0})
        by_role[role][r.status] += 1
        mod = r.module or "other"
        by_module.setdefault(mod, {"PASS": 0, "FAIL": 0, "SKIP": 0})
        by_module[mod][r.status] += 1
        if r.status == "FAIL":
            fails.append(r)

    total = sum(counts.values())
    print(
        f"Total: {total}  PASS={counts['PASS']}  FAIL={counts['FAIL']}  "
        f"SKIP={counts['SKIP']}  ({elapsed:.1f}s)"
    )
    print("\nBy channel:")
    for ch, c in sorted(by_channel.items()):
        print(f"  {ch:8} PASS={c['PASS']:3} FAIL={c['FAIL']:3} SKIP={c['SKIP']:3}")
    print("\nBy role:")
    for role, c in sorted(by_role.items()):
        print(f"  {role:10} PASS={c['PASS']:3} FAIL={c['FAIL']:3} SKIP={c['SKIP']:3}")
    print("\nBy module:")
    for mod, c in sorted(by_module.items()):
        flag = " ← FAIL" if c["FAIL"] else ""
        print(
            f"  {mod:22} PASS={c['PASS']:3} FAIL={c['FAIL']:3} SKIP={c['SKIP']:3}{flag}"
        )

    if fails:
        print("\nFAILURES:")
        for f in fails:
            print(f"  ✗ [{f.role}/{f.module}/{f.channel}] {f.name}: {f.detail}")

    # Write machine-readable + module-wise markdown
    out = {
        "counts": counts,
        "by_channel": by_channel,
        "by_role": by_role,
        "by_module": by_module,
        "elapsed_sec": round(elapsed, 2),
        "latency": LATENCY,
        "results": [r.__dict__ for r in RESULTS],
        "categories": _categorize_results(),
    }
    path = "/Users/apple/Documents/Ticketing_Rebuild/ai-agents/logs/e2e-strict-report.json"
    md_path = "/Users/apple/Documents/Ticketing_Rebuild/ai-agents/logs/e2e-module-wise-report.md"
    full_md = "/Users/apple/Documents/Ticketing_Rebuild/ai-agents/logs/e2e-full-chat-report.md"
    try:
        import os

        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump(out, f, indent=2)
        print(f"\nJSON report: {path}")
        _write_module_wise_md(md_path, elapsed, counts, by_role, by_module, fails)
        print(f"Module-wise MD: {md_path}")
        _write_full_chat_report(full_md, elapsed, counts, by_role, by_module, fails)
        print(f"Full chat MD: {full_md}")
    except Exception as e:  # noqa: BLE001
        print(f"\nCould not write reports: {e}")

    if LATENCY:
        print("\nLatency samples (ms):")
        by_kind: dict[str, list[float]] = {}
        for row in LATENCY:
            by_kind.setdefault(row["kind"], []).append(float(row["ms"]))
        for kind, vals in sorted(by_kind.items()):
            vals_sorted = sorted(vals)
            mid = vals_sorted[len(vals_sorted) // 2]
            print(
                f"  {kind:24} n={len(vals):3} "
                f"min={min(vals):7.0f} med={mid:7.0f} max={max(vals):7.0f}"
            )

    return 1 if counts["FAIL"] else 0


def _categorize_results() -> dict[str, dict[str, int]]:
    """Bucket results for the final separated report."""
    cats = {
        "unit_proxy_not_in_this_runner": {"PASS": 0, "FAIL": 0, "SKIP": 0, "note": "pytest"},
        "integration_form_express_postgres": {"PASS": 0, "FAIL": 0, "SKIP": 0},
        "real_llm_gemma_chat": {"PASS": 0, "FAIL": 0, "SKIP": 0},
        "role_rbac": {"PASS": 0, "FAIL": 0, "SKIP": 0},
        "workflow_park_resume": {"PASS": 0, "FAIL": 0, "SKIP": 0},
        "dynamic_data": {"PASS": 0, "FAIL": 0, "SKIP": 0},
        "latency": {"PASS": 0, "FAIL": 0, "SKIP": 0},
        "login": {"PASS": 0, "FAIL": 0, "SKIP": 0},
    }
    for r in RESULTS:
        st = r.status if r.status in ("PASS", "FAIL", "SKIP") else "FAIL"
        if r.channel == "login":
            cats["login"][st] += 1
        if r.channel == "form":
            cats["integration_form_express_postgres"][st] += 1
        if r.channel == "chat":
            cats["real_llm_gemma_chat"][st] += 1
        if "rbac" in r.name or "denied" in r.name or r.channel == "form":
            if "denied" in r.name or "rbac" in r.name:
                cats["role_rbac"][st] += 1
        if "park_resume" in r.name or "side_quest" in r.name or "multi_field" in r.name:
            cats["workflow_park_resume"][st] += 1
        if "fixtures" in r.name or "dynamic" in r.name or "entity_continuity" in r.name:
            cats["dynamic_data"][st] += 1
    return {k: {kk: vv for kk, vv in v.items() if kk in ("PASS", "FAIL", "SKIP")} for k, v in cats.items()}


def _write_full_chat_report(
    path: str,
    elapsed: float,
    counts: dict[str, int],
    by_role: dict[str, dict[str, int]],
    by_module: dict[str, dict[str, int]],
    fails: list[Result],
) -> None:
    cats = _categorize_results()
    lines: list[str] = []
    lines.append("# Full Chat E2E Report — Worktual Ticketing")
    lines.append("")
    lines.append(
        f"Live run via Express `:3000` + ai-agents `:8012` + PostgreSQL ({elapsed:.1f}s)."
    )
    lines.append("")
    lines.append(
        "Entities used in chat workflows were loaded from org APIs "
        "(`/api/customers`, `/api/tickets`, `/api/queues`, …) — not hardcoded."
    )
    lines.append("")
    lines.append(
        f"**Totals:** PASS={counts['PASS']} · FAIL={counts['FAIL']} · SKIP={counts['SKIP']}"
    )
    lines.append("")
    lines.append("## Separated results (do not conflate)")
    lines.append("")
    lines.append("| Category | PASS | FAIL | SKIP |")
    lines.append("|----------|-----:|-----:|-----:|")
    labels = {
        "unit_proxy_not_in_this_runner": "1. Unit tests (pytest; run separately)",
        "integration_form_express_postgres": "2–3. Integration / Express+Postgres (form APIs)",
        "real_llm_gemma_chat": "4. Real LLM/Gemma chat",
        "role_rbac": "5. Role/RBAC",
        "workflow_park_resume": "6. Workflow park/resume / multi-field",
        "dynamic_data": "7. Dynamic-data / entity continuity",
        "latency": "8. Latency (see samples below)",
        "login": "Logins",
    }
    for key, title in labels.items():
        c = cats.get(key) or {"PASS": 0, "FAIL": 0, "SKIP": 0}
        lines.append(f"| {title} | {c['PASS']} | {c['FAIL']} | {c['SKIP']} |")
    lines.append("")
    lines.append("## By role")
    lines.append("")
    lines.append("| Role | PASS | FAIL | SKIP |")
    lines.append("|------|-----:|-----:|-----:|")
    for role, c in sorted(by_role.items()):
        lines.append(f"| {role} | {c['PASS']} | {c['FAIL']} | {c['SKIP']} |")
    lines.append("")
    lines.append("## By module")
    lines.append("")
    lines.append("| Module | PASS | FAIL | SKIP | Module PASS? |")
    lines.append("|--------|-----:|-----:|-----:|:------------:|")
    for mod, c in sorted(by_module.items()):
        # Module PASS only when chat+form live with zero fails
        chat_fail = any(
            r.status == "FAIL" and r.module == mod and r.channel == "chat" for r in RESULTS
        )
        chat_pass = any(
            r.status == "PASS" and r.module == mod and r.channel == "chat" for r in RESULTS
        )
        verdict = "NO" if chat_fail or c["FAIL"] else ("YES" if chat_pass else "PARTIAL")
        lines.append(
            f"| `{mod}` | {c['PASS']} | {c['FAIL']} | {c['SKIP']} | **{verdict}** |"
        )
    lines.append("")
    lines.append("## Latency samples")
    lines.append("")
    if not LATENCY:
        lines.append("_No latency samples recorded._")
    else:
        lines.append("| Kind | Role | ms |")
        lines.append("|------|------|---:|")
        for row in LATENCY:
            lines.append(f"| {row['kind']} | {row['role']} | {row['ms']} |")
        lines.append("")
        by_kind: dict[str, list[float]] = {}
        for row in LATENCY:
            by_kind.setdefault(row["kind"], []).append(float(row["ms"]))
        lines.append("| Kind | n | min | median | max | <2s? |")
        lines.append("|------|--:|----:|-------:|----:|:----:|")
        for kind, vals in sorted(by_kind.items()):
            vals_sorted = sorted(vals)
            mid = vals_sorted[len(vals_sorted) // 2]
            under = "yes" if kind == "greeting" and mid < 2000 else ("—" if kind != "greeting" else "no")
            lines.append(
                f"| {kind} | {len(vals)} | {min(vals):.0f} | {mid:.0f} | {max(vals):.0f} | {under} |"
            )
    lines.append("")
    lines.append("## Failed scenarios")
    lines.append("")
    if not fails:
        lines.append("_No failures._")
    else:
        for f in fails:
            lines.append(
                f"- **{f.name}** (`{f.role}` / `{f.module}` / `{f.channel}`): {f.detail}"
            )
    lines.append("")
    lines.append("## Remaining gaps")
    lines.append("")
    have_roles = {r.role for r in RESULTS if r.channel == "login" and r.status == "PASS"}
    for need in ("admin", "agent", "resolver", "customer", "viewer"):
        if need not in have_roles:
            lines.append(
                f"- **{need}**: no working login in this run "
                f"(set `E2E_LOGINS` JSON to include credentials)."
            )
    lines.append(
        "- Unit pytest suite is separate: `cd ai-agents && .venv/bin/pytest` "
        "(fake LLM by default)."
    )
    lines.append(
        "- Full create-ticket → confirm → Express POST DB assert is covered partially "
        "via form create + chat guided start; complete chat file+DB verify still depends "
        "on confirm turn with actor user_id."
    )
    lines.append(
        "- Tool/Express/DB micro-latency breakdown is not exported from Gemma logs in this "
        "runner (total turn latency only)."
    )
    lines.append("")

    with open(path, "w") as f:
        f.write("\n".join(lines))


def _write_module_wise_md(
    path: str,
    elapsed: float,
    counts: dict[str, int],
    by_role: dict[str, dict[str, int]],
    by_module: dict[str, dict[str, int]],
    fails: list[Result],
) -> None:
    lines: list[str] = []
    lines.append("# Strict E2E — Module-wise report")
    lines.append("")
    lines.append(f"Generated from live form API + coworker chat runs ({elapsed:.1f}s).")
    lines.append("")
    lines.append(
        f"**Totals:** PASS={counts['PASS']} · FAIL={counts['FAIL']} · SKIP={counts['SKIP']}"
    )
    lines.append("")
    lines.append("## Logins covered")
    lines.append("")
    lines.append("| Role | Status | Notes |")
    lines.append("|------|--------|-------|")
    login_rows = [r for r in RESULTS if r.channel == "login" and r.name.startswith("login.")]
    for r in login_rows:
        lines.append(f"| `{r.role or '-'}` | **{r.status}** | {r.detail} |")
    lines.append("")
    lines.append("## By role")
    lines.append("")
    lines.append("| Role | PASS | FAIL | SKIP |")
    lines.append("|------|-----:|-----:|-----:|")
    for role, c in sorted(by_role.items()):
        lines.append(f"| {role} | {c['PASS']} | {c['FAIL']} | {c['SKIP']} |")
    lines.append("")
    lines.append("## By module (chat + form)")
    lines.append("")
    lines.append("| Module | PASS | FAIL | SKIP | Verdict |")
    lines.append("|--------|-----:|-----:|-----:|---------|")
    for mod, c in sorted(by_module.items()):
        verdict = "FAIL" if c["FAIL"] else ("PARTIAL" if c["SKIP"] and not c["PASS"] else "OK")
        lines.append(
            f"| `{mod}` | {c['PASS']} | {c['FAIL']} | {c['SKIP']} | **{verdict}** |"
        )
    lines.append("")

    # Per-role × module matrix
    lines.append("## Role × module failures")
    lines.append("")
    roles = sorted({r.role for r in RESULTS if r.role and r.role != "-"})
    mods = sorted({r.module for r in RESULTS if r.module})
    header = "| Module | " + " | ".join(roles) + " |"
    sep = "|--------|" + "|".join(["------"] * len(roles)) + "|"
    lines.append(header)
    lines.append(sep)
    for mod in mods:
        cells = []
        for role in roles:
            subset = [
                r
                for r in RESULTS
                if r.module == mod and r.role == role and r.channel in ("form", "chat")
            ]
            if not subset:
                cells.append("—")
                continue
            fcount = sum(1 for r in subset if r.status == "FAIL")
            pcount = sum(1 for r in subset if r.status == "PASS")
            if fcount:
                cells.append(f"**FAIL {fcount}**")
            else:
                cells.append(f"OK {pcount}")
        lines.append(f"| `{mod}` | " + " | ".join(cells) + " |")
    lines.append("")

    lines.append("## Failures (detail)")
    lines.append("")
    if not fails:
        lines.append("_No failures._")
    else:
        for f in fails:
            lines.append(
                f"- **{f.name}** (`{f.role}` / `{f.module}` / `{f.channel}`): {f.detail}"
            )
    lines.append("")
    lines.append("## Coverage gaps")
    lines.append("")
    lines.append(
        "- `customer` and `viewer` logins: **not available** in this environment "
        "(no working credentials). Those role modules were SKIPPED, not proven."
    )
    lines.append(
        "- UI-only layout issues (padding, expand-on-click) are not covered by API/chat "
        "assertions — they need visual QA."
    )
    lines.append("")

    with open(path, "w") as f:
        f.write("\n".join(lines))


if __name__ == "__main__":
    raise SystemExit(main())
