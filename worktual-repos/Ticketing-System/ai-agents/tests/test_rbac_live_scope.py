"""RBAC data scope + frontend/backend module declaration parity."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.rbac import MODULES_BY_ROLE, can_access_module, ticket_data_scope

_REPO_ROOT = Path(__file__).resolve().parents[2]
_RBAC_TS = _REPO_ROOT / "ui-frontend" / "src" / "rbac.ts"
_APP_TSX = _REPO_ROOT / "ui-frontend" / "src" / "App.tsx"

# Views that use wrapSplit() and must have VIEW_CHAT_MODULE entries.
_WRAP_SPLIT_VIEWS = frozenset(
    {
        "assigned",
        "team-queue",
        "team-inbox",
        "unassigned",
        "search",
        "work-board",
        "customers",
        "analytics",
        "audit",
        "csat-reports",
        "escalation-directory",
        "org-preferences",
        "approvals",
    }
)

_VALID_CHAT_MODULES = frozenset(
    {"general", "tickets", "teams", "kb", "customers", "macros", "admin"}
)


def _parse_ts_modules_by_role() -> dict[str, frozenset[str]]:
    text = _RBAC_TS.read_text(encoding="utf-8")
    start = text.index("const MODULES_BY_ROLE")
    end = text.index("const SETTINGS_BY_ROLE")
    section = text[start:end]
    out: dict[str, frozenset[str]] = {}
    for role, body in re.findall(r"(\w+):\s*\[(.*?)\]", section, flags=re.DOTALL):
        mods = frozenset(re.findall(r'"([^"]+)"', body))
        if mods:
            out[role] = mods
    return out


def _parse_view_chat_module() -> dict[str, dict[str, str]]:
    text = _APP_TSX.read_text(encoding="utf-8")
    start = text.index("const VIEW_CHAT_MODULE")
    end = text.index("function listScopeForView")
    section = text[start:end]
    out: dict[str, dict[str, str]] = {}
    pattern = re.compile(
        r"(?:'([^']+)'|(\w+)):\s*\{\s*module:\s*'([^']+)',\s*surface:\s*'([^']+)'\s*\}"
    )
    for m in pattern.finditer(section):
        view = m.group(1) or m.group(2)
        out[view] = {"module": m.group(3), "surface": m.group(4)}
    return out


def test_ticket_data_scope_by_role():
    assert ticket_data_scope("admin") == "org"
    assert ticket_data_scope("viewer") == "org"
    assert ticket_data_scope("agent") == "assignee"
    assert ticket_data_scope("resolver") == "assignee"
    assert ticket_data_scope("customer") == "requester"


def test_module_gates_match_ui():
    assert can_access_module("resolver", "kb")
    assert can_access_module("resolver", "assigned")
    assert not can_access_module("resolver", "customers")
    assert not can_access_module("resolver", "agent-queues")
    assert not can_access_module("resolver", "analytics")
    assert can_access_module("agent", "customers")
    assert can_access_module("agent", "macros")
    assert not can_access_module("agent", "agent-queues")
    assert not can_access_module("agent", "analytics")
    assert can_access_module("admin", "customers")
    assert can_access_module("admin", "priorities")
    assert can_access_module("admin", "macros")
    assert can_access_module("admin", "approvals")
    assert not can_access_module("agent", "approvals")
    assert not can_access_module("resolver", "macros")


def test_python_rbac_matches_frontend_rbac_ts():
    """Prevent ui-frontend/src/rbac.ts and ai-agents/app/rbac.py from drifting."""
    assert _RBAC_TS.is_file(), f"missing {_RBAC_TS}"
    ts_roles = _parse_ts_modules_by_role()
    assert ts_roles, "could not parse MODULES_BY_ROLE from rbac.ts"
    py_roles = {role: frozenset(mods) for role, mods in MODULES_BY_ROLE.items()}
    assert set(ts_roles) == set(py_roles), (
        f"role keys differ: ts={sorted(ts_roles)} py={sorted(py_roles)}"
    )
    for role in sorted(py_roles):
        assert ts_roles[role] == py_roles[role], (
            f"module mismatch for role={role}: "
            f"ts-only={sorted(ts_roles[role] - py_roles[role])} "
            f"py-only={sorted(py_roles[role] - ts_roles[role])}"
        )


def test_wrap_split_views_have_chat_module_map():
    """Every wrapSplit view must declare module/surface for scoped specialist tools."""
    assert _APP_TSX.is_file(), f"missing {_APP_TSX}"
    view_map = _parse_view_chat_module()
    missing = sorted(_WRAP_SPLIT_VIEWS - set(view_map))
    assert not missing, f"VIEW_CHAT_MODULE missing entries for: {missing}"
    for view in _WRAP_SPLIT_VIEWS:
        entry = view_map[view]
        assert entry["module"] in _VALID_CHAT_MODULES, view
        assert entry["surface"].strip(), view


@pytest.mark.parametrize(
    "forbidden",
    [
        "What is the customer's full name",
        "Happy to help file this",
    ],
)
def test_no_hardcoded_user_chat_bubbles_in_agent_app(forbidden: str):
    """Product rule: user-visible chat must come from LLM, not canned wizard strings."""
    app_root = Path(__file__).resolve().parents[1] / "app"
    hits: list[str] = []
    for path in app_root.rglob("*.py"):
        if path.name.startswith("test_"):
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if forbidden in text:
            hits.append(str(path.relative_to(app_root.parent)))
    assert not hits, f"forbidden static bubble {forbidden!r} in: {hits}"
