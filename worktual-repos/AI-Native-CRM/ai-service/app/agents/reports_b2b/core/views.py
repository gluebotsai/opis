"""Virtual `rpt.*` views -> scoped CTE text for B2B CRM roles.

The LLM only ever writes `rpt.<view>`. For every view a query uses, sql_guard asks this
module for a CTE body:

    SELECT <exposed columns, masked for the role> FROM (<source>) src WHERE <role scope>

All runtime values are bound parameters. This module emits parameter tokens (`__P_<name>__`)
that sql_guard turns into driver placeholders (%(_org_id)s, %(_user_id)s).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

PRODUCT_DIR = Path(__file__).resolve().parent.parent / "product"

P_ORG = "_org_id"
P_USER = "_user_id"
INTERNAL_PARAMS = frozenset({P_ORG, P_USER})

_MACRO = re.compile(r"\{(org_id|user_id|user_channel_companies)\}")


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
def _load(product_dir: str) -> tuple[dict[str, ViewSpec], dict[str, dict[str, RoleView]]]:
    root = Path(product_dir)
    schema = _read(root / "schema.yml")
    access = _read(root / "access.yml")

    views: dict[str, ViewSpec] = {}
    for name, doc in (schema.get("views") or {}).items():
        if "{org_id}" not in doc.get("source", "") and name != "products":
            raise ViewConfigError(f"view {name}: source must filter the tenant with {{org_id}}")
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
    return views, roles


def load_views(product_dir: Path = PRODUCT_DIR) -> dict[str, ViewSpec]:
    return _load(str(product_dir))[0]


def role_views(role: str, product_dir: Path = PRODUCT_DIR) -> dict[str, RoleView]:
    roles = _load(str(product_dir))[1]
    if role not in roles:
        raise ViewConfigError(f"no views configured for role {role}")
    return roles[role]


def _expand_macro(match: re.Match[str]) -> str:
    name = match.group(1)
    if name == "org_id":
        return param_token(P_ORG)
    if name == "user_id":
        return param_token(P_USER)
    if name == "user_channel_companies":
        return (
            f"SELECT c_sub.id FROM crm.companies c_sub "
            f"WHERE c_sub.organization_id = {param_token(P_ORG)} "
            f"AND (c_sub.owner_user_id = {param_token(P_USER)} "
            f"OR c_sub.parent_company_id IN ("
            f"  SELECT c_p.id FROM crm.companies c_p "
            f"  WHERE c_p.organization_id = {param_token(P_ORG)} "
            f"    AND c_p.owner_user_id = {param_token(P_USER)} "
            f"    AND c_p.channel_role IN ('franchise', 'owned_store', 'brand_hq')"
            f"))"
        )
    raise ViewConfigError(f"unknown macro {{{name}}}")


def interpolate(text: str) -> str:
    """Replace {org_id}, {user_id}, {user_channel_companies} with parameter tokens."""
    return _MACRO.sub(_expand_macro, text)


def runtime_params(organization_id: int, user_id: int) -> dict[str, Any]:
    """Map internal parameter names to caller-supplied values."""
    return {
        P_ORG: int(organization_id),
        P_USER: int(user_id) if user_id else 0,
    }


def cte_body(rv: RoleView, *, scope_override: str | None = None) -> str:
    """Build the SQL string for a single role-scoped CTE."""
    source_sql = interpolate(rv.view.source)
    scope_sql = interpolate(scope_override if scope_override else rv.scope)

    projections: list[str] = []
    for col in rv.exposed:
        if col in rv.mask:
            projections.append(f"{rv.mask[col]} AS {col}")
        else:
            projections.append(f"src.{col}")

    cols_str = ", ".join(projections) if projections else "*"
    return f"SELECT {cols_str} FROM (\n{source_sql}\n) src WHERE {scope_sql}"
