"""Virtual `rpt.*` views -> scoped CTE text for Contact Center roles.

The LLM only ever writes `rpt.<view>`. For every view a query uses, sql_guard asks this
module for a CTE body:

    SELECT <exposed columns, masked for the role> FROM (<source>) src WHERE <role scope>
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from .loader import PRODUCT_DIR

# Internal parameters. Leading underscore = the LLM may never reference them.
P_ORG = "_org_id"
P_USER = "_user_id"
P_QUEUES = "_queue_ids"
P_USER_EXT = "_user_ext"
INTERNAL_PARAMS = frozenset({P_ORG, P_USER, P_QUEUES, P_USER_EXT})

_MACRO = re.compile(r"\{(org_id|user_id|queue_ids|user_ext|visible_conversations_where)\}")


def param_token(name: str) -> str:
    return f"__P_{name}__"


@dataclass(frozen=True)
class ViewSpec:
    name: str
    description: str
    source: str
    columns: dict[str, dict[str, Any]]


@dataclass(frozen=True)
class RoleView:
    """What one role gets for one view."""

    view: ViewSpec
    scope: str
    mask: dict[str, str] = field(default_factory=dict)
    hide: frozenset[str] = frozenset()

    @property
    def exposed(self) -> list[str]:
        return [c for c in self.view.columns if c not in self.hide]


class ViewConfigError(ValueError):
    """schema.yml / access.yml views section is inconsistent."""


def _read(path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text()) or {}
    if not isinstance(data, dict):
        raise ViewConfigError(f"{path.name} must be a mapping")
    return data


@lru_cache(maxsize=4)
def _load(product_dir: str) -> tuple[dict[str, ViewSpec], dict[str, dict[str, RoleView]], str]:
    root = Path(product_dir)
    schema = _read(root / "schema.yml")
    access = _read(root / "access.yml")
    base_conv_path = root / "sql" / "_base_conversation.sql"
    base_conv = base_conv_path.read_text() if base_conv_path.exists() else ""

    views: dict[str, ViewSpec] = {}
    for name, doc in (schema.get("views") or {}).items():
        views[name] = ViewSpec(
            name=name,
            description=str(doc.get("description") or "").strip(),
            source=str(doc["source"]).strip(),
            columns=dict(doc.get("columns") or {}),
        )

    roles: dict[str, dict[str, RoleView]] = {}
    for role, entries in (access.get("views") or {}).items():
        per_role: dict[str, RoleView] = {}
        for view_name, rule in (entries or {}).items():
            if view_name not in views:
                raise ViewConfigError(f"access.yml views.{role}.{view_name}: unknown view")
            spec = views[view_name]
            rule = rule or {}
            mask = dict(rule.get("mask") or {})
            hide = frozenset(rule.get("hide") or [])
            for col in list(mask) + list(hide):
                if col not in spec.columns:
                    raise ViewConfigError(f"access.yml views.{role}.{view_name}: unknown column {col}")
            if "scope" not in rule:
                raise ViewConfigError(f"access.yml views.{role}.{view_name}: scope is required")
            per_role[view_name] = RoleView(
                view=spec, scope=str(rule["scope"]).strip(), mask=mask, hide=hide
            )
        roles[role] = per_role
    return views, roles, base_conv


def load_views(product_dir: Path = PRODUCT_DIR) -> dict[str, ViewSpec]:
    return _load(str(product_dir))[0]


def role_views(role: str, product_dir: Path = PRODUCT_DIR) -> dict[str, RoleView]:
    roles = _load(str(product_dir))[1]
    if role not in roles:
        raise ViewConfigError(f"no views configured for role {role}")
    return roles[role]


def _expand(text: str, role: str, product_dir: Path, depth: int = 0) -> str:
    if depth > 3:
        raise ViewConfigError("macro expansion too deep")

    def sub(match: re.Match[str]) -> str:
        key = match.group(1)
        if key == "org_id":
            return param_token(P_ORG)
        if key == "user_id":
            return param_token(P_USER)
        if key == "user_ext":
            return param_token(P_USER_EXT)
        if key == "queue_ids":
            return f"CAST({param_token(P_QUEUES)} AS bigint[])"
        if key == "visible_conversations_where":
            convs = role_views(role, product_dir).get("conversations")
            scope = convs.scope if convs else "FALSE"
            return _expand(f"organization_id = {{org_id}} AND ({scope})", role, product_dir, depth + 1)
        return match.group(0)

    return _MACRO.sub(sub, text)


def cte_body(view_name: str, role: str, product_dir: Path = PRODUCT_DIR) -> str:
    """Scoped SELECT for one view and role. Raises KeyError if the role lacks the view."""
    _, _, base_conv = _load(str(product_dir))
    rv = role_views(role, product_dir)[view_name]
    source = rv.view.source
    if "{{base_conversation}}" in source:
        source = source.replace("{{base_conversation}}", base_conv.replace("{{org_id}}", "{org_id}"))
    source = _expand(source, role, product_dir)
    cols = []
    for col in rv.exposed:
        expr = rv.mask.get(col)
        cols.append(f"{_expand(expr, role, product_dir)} AS {col}" if expr else f"src.{col}")
    scope = _expand(rv.scope, role, product_dir)
    return f"SELECT {', '.join(cols)} FROM (\n{source}\n) src WHERE {scope}"


def runtime_params(organization_id: int, user_id: int, queue_ids: list[int], user_ext: str = "") -> dict[str, Any]:
    return {
        P_ORG: int(organization_id),
        P_USER: int(user_id),
        P_QUEUES: [int(q) for q in queue_ids],
        P_USER_EXT: str(user_ext),
    }
