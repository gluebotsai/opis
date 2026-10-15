"""Virtual rpt.* views -> scoped CTE text for one role."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from ..loader import PRODUCT_DIR

P_ORG = "_org_id"
P_USER = "_user_id"
P_BRANCH = "_branch_id"
INTERNAL_PARAMS = frozenset({P_ORG, P_USER, P_BRANCH})

_MACRO = re.compile(r"\{(org_id|user_id|branch_id|visible_campaigns_where)\}")


def param_token(name: str) -> str:
    return f"__P_{name}__"


@dataclass(frozen=True)
class ViewSpec:
    name: str
    description: str
    grain: str
    source: str
    columns: dict[str, dict[str, Any]]


@dataclass(frozen=True)
class RoleView:
    view: ViewSpec
    scope: str
    mask: dict[str, str] = field(default_factory=dict)
    hide: frozenset[str] = frozenset()

    @property
    def exposed(self) -> list[str]:
        return [c for c in self.view.columns if c not in self.hide]


class ViewConfigError(ValueError):
    pass


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
        src = str(doc["source"])
        if "{org_id}" not in src:
            raise ViewConfigError(f"view {name}: source must filter the tenant with {{org_id}}")
        views[name] = ViewSpec(
            name=name,
            description=str(doc.get("description") or "").strip(),
            grain=str(doc.get("grain") or "").strip(),
            source=src.strip(),
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


def _expand(text: str, role: str, product_dir: Path, depth: int = 0) -> str:
    if depth > 4:
        raise ViewConfigError("macro expansion too deep")

    def sub(match: re.Match[str]) -> str:
        key = match.group(1)
        if key == "org_id":
            return param_token(P_ORG)
        if key == "user_id":
            return param_token(P_USER)
        if key == "branch_id":
            return param_token(P_BRANCH)
        campaigns = role_views(role, product_dir).get("campaigns")
        scope = campaigns.scope if campaigns else "FALSE"
        return _expand(
            f"organization_id = {{org_id}} AND branch_id = {{branch_id}} AND ({scope})",
            role,
            product_dir,
            depth + 1,
        )

    return _MACRO.sub(sub, text)


def cte_body(view_name: str, role: str, product_dir: Path = PRODUCT_DIR) -> str:
    rv = role_views(role, product_dir)[view_name]
    source = _expand(rv.view.source, role, product_dir)
    cols = []
    for col in rv.exposed:
        expr = rv.mask.get(col)
        cols.append(f"{_expand(expr, role, product_dir)} AS {col}" if expr else f"src.{col}")
    scope = _expand(rv.scope, role, product_dir)
    return f"SELECT {', '.join(cols)} FROM (\n{source}\n) src WHERE {scope}"


def runtime_params(
    organization_id: int,
    user_id: int,
    branch_id: int,
    queue_ids: list[int] | None = None,
) -> dict[str, Any]:
    return {
        P_ORG: int(organization_id),
        P_USER: int(user_id),
        P_BRANCH: int(branch_id),
    }


def view_cards_for_prompt(
    role: str,
    view_names: list[str] | None = None,
    product_dir: Path = PRODUCT_DIR,
    *,
    limit: int | None = None,
) -> str:
    """Meaning-rich view cards for Domain/SQL executor prompts."""
    available = role_views(role, product_dir)
    names = list(view_names or available.keys())
    if limit is not None:
        names = names[:limit]
    blocks: list[str] = []
    for name in names:
        rv = available.get(name)
        if rv is None:
            continue
        lines = [
            f"rpt.{name}",
            f"  grain: {rv.view.grain or 'unspecified'}",
            f"  meaning: {rv.view.description}",
            "  columns:",
        ]
        for col, meta in rv.view.columns.items():
            if col in rv.hide:
                continue
            meaning = (meta or {}).get("description") or ""
            groupable = (meta or {}).get("groupable", False)
            phrases = (meta or {}).get("user_phrases") or []
            phrase_s = f" user_words={phrases}" if phrases else ""
            lines.append(
                f"    - {col} ({(meta or {}).get('type', '')}; "
                f"{'groupable' if groupable else 'not groupable'}): {meaning}{phrase_s}"
            )
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def view_summary_for_prompt(role: str, product_dir: Path = PRODUCT_DIR) -> str:
    """Names + grain only for Domain plan. Full cards stay on the SQL executor."""
    available = role_views(role, product_dir)
    lines = ["available rpt views (name + grain):"]
    for name, rv in available.items():
        lines.append(f"  rpt.{name}: {rv.view.grain or 'unspecified'}")
    return "\n".join(lines)
