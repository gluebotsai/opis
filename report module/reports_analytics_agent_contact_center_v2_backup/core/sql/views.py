"""Virtual rpt.* views → scoped CTE text for one role."""

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
P_QUEUE_IDS = "_queue_ids"
INTERNAL_PARAMS = frozenset({P_ORG, P_USER, P_QUEUE_IDS})

_MACRO = re.compile(r"\{(org_id|user_id|queue_ids)\}")
_RPT_REF = re.compile(r"\brpt\.([a-z_][a-z0-9_]*)\b")


def param_token(name: str) -> str:
    return f"__P_{name}__"


@dataclass(frozen=True)
class ViewSpec:
    name: str
    description: str
    grain: str
    object: str
    source: str
    columns: dict[str, dict[str, Any]]
    joins: tuple[tuple[str, str, str], ...] = ()


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
        joins = tuple(
            (
                str(j.get("to") or "").strip(),
                str(j.get("on") or "").strip(),
                str(j.get("why") or "").strip(),
            )
            for j in (doc.get("joins") or [])
            if isinstance(j, dict)
        )
        views[name] = ViewSpec(
            name=name,
            description=str(doc.get("description") or "").strip(),
            grain=str(doc.get("grain") or "").strip(),
            object=str(doc.get("object") or "").strip(),
            source=src.strip(),
            columns=dict(doc.get("columns") or {}),
            joins=joins,
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
                    raise ViewConfigError(
                        f"access.yml views.{role}.{view_name}: unknown column {col}"
                    )
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


def _expand(text: str) -> str:
    def sub(match: re.Match[str]) -> str:
        key = match.group(1)
        if key == "org_id":
            return param_token(P_ORG)
        if key == "user_id":
            return param_token(P_USER)
        if key == "queue_ids":
            return param_token(P_QUEUE_IDS)
        return match.group(0)

    return _MACRO.sub(sub, text)


def rewrite_rpt_refs(sql: str) -> str:
    return _RPT_REF.sub(lambda m: f"rpt_{m.group(1)}", sql)


def scope_dependencies(scope: str) -> list[str]:
    return list(dict.fromkeys(_RPT_REF.findall(scope)))


def _parseable_source(source: str) -> str:
    """sqlglot cannot parse {org_id} macros. Substitute literals for name extraction only."""

    def sub(match: re.Match[str]) -> str:
        if match.group(1) == "queue_ids":
            return "ARRAY[1]::bigint[]"
        return "1"

    return _MACRO.sub(sub, source)


def _outer_select(tree: Any) -> Any:
    from sqlglot import exp

    if isinstance(tree, exp.Select):
        return tree
    if isinstance(tree, exp.Union):
        return _outer_select(tree.this)
    this = tree.args.get("this") if hasattr(tree, "args") else None
    if this is not None:
        found = _outer_select(this)
        if found is not None:
            return found
    return tree.find(exp.Select) if hasattr(tree, "find") else None


def _source_output_names(source: str) -> set[str] | None:
    """Aliases on the outer source SELECT. None means parse failed — keep catalog columns."""
    import sqlglot
    from sqlglot import exp

    try:
        tree = sqlglot.parse_one(_parseable_source(source), dialect="postgres")
    except Exception:
        return None
    select = _outer_select(tree)
    if select is None:
        return None
    names: set[str] = set()
    for e in select.expressions:
        if isinstance(e, exp.Star) or (isinstance(e, exp.Column) and e.name == "*"):
            return None
        name = e.alias_or_name
        if name:
            names.add(str(name).lower())
    return names or None


def cte_body(
    view_name: str,
    role: str,
    product_dir: Path = PRODUCT_DIR,
    *,
    queue_ids: list[int] | None = None,
) -> str:
    rv = role_views(role, product_dir)[view_name]
    source = _expand(rv.view.source)
    emitted = _source_output_names(rv.view.source)
    cols = []
    for col in rv.exposed:
        if emitted is not None and col.lower() not in emitted:
            continue
        expr = rv.mask.get(col)
        cols.append(f"{_expand(expr)} AS {col}" if expr else f"src.{col}")
    if not cols:
        cols = ["src.*"]
    scope = rewrite_rpt_refs(_expand(rv.scope))
    if queue_ids and "queue_id" in rv.view.columns:
        scope = f"({scope}) AND src.queue_id = ANY({param_token(P_QUEUE_IDS)})"
    return f"SELECT {', '.join(cols)} FROM (\n{source}\n) src WHERE {scope}"


def runtime_params(
    organization_id: int,
    user_id: int,
    queue_ids: list[int] | None = None,
) -> dict[str, Any]:
    return {
        P_ORG: int(organization_id),
        P_USER: int(user_id),
        P_QUEUE_IDS: list(queue_ids or []),
    }


def view_cards_for_prompt(
    role: str,
    view_names: list[str] | None = None,
    product_dir: Path = PRODUCT_DIR,
    *,
    limit: int | None = None,
) -> str:
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
            f"  object: {rv.view.object or ''}",
            f"  meaning: {rv.view.description}",
            "  columns:",
        ]
        for col, meta in rv.view.columns.items():
            if col in rv.hide:
                continue
            meaning = (meta or {}).get("description") or ""
            groupable = (meta or {}).get("groupable", False)
            phrases = (meta or {}).get("user_phrases") or []
            not_same = (meta or {}).get("not_the_same_as") or []
            extra = ""
            if phrases:
                extra += f" user_words={phrases}"
            if not_same:
                extra += f" not_the_same_as={not_same}"
            lines.append(
                f"    - {col} ({(meta or {}).get('type', '')}; "
                f"{'groupable' if groupable else 'not groupable'}): {meaning}{extra}"
            )
        if rv.view.joins:
            lines.append("  joins:")
            for to, on, why in rv.view.joins:
                bit = f"    - {to} on {on}"
                if why:
                    bit += f" ({why})"
                lines.append(bit)
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


_TOKEN = re.compile(r"[a-z0-9_]+")
_NAME_COLS = frozenset(
    {
        "name",
        "display_name",
        "customer_name",
        "agent_name",
        "queue_name",
        "team_name",
        "subject",
        "body",
        "notes",
        "summary",
        "text",
    }
)


def view_index_for_prompt(role: str, product_dir: Path = PRODUCT_DIR) -> str:
    available = role_views(role, product_dir)
    lines = ["rpt views (name | object | grain):"]
    for name, rv in available.items():
        lines.append(f"  rpt.{name} | {rv.view.object or '-'} | {rv.view.grain or '-'}")
    return "\n".join(lines)


def select_view_names(
    role: str,
    goal: str,
    slice_words: list[str] | None = None,
    product_dir: Path = PRODUCT_DIR,
    *,
    cap: int = 6,
) -> list[str]:
    """Attach full column books for the views whose YAML object/phrases overlap the task.

    Token overlap against the catalog is retrieval for prompt size, not question routing.
    """
    available = role_views(role, product_dir)
    text = " ".join([goal or "", " ".join(slice_words or [])]).lower()
    tokens = set(_TOKEN.findall(text))
    scored: list[tuple[int, str]] = []
    for name, rv in available.items():
        hay = {name, (rv.view.object or "").lower()}
        hay.update(_TOKEN.findall((rv.view.description or "").lower()))
        hay.update(_TOKEN.findall((rv.view.object or "").lower()))
        for col, meta in rv.view.columns.items():
            hay.add(col.lower())
            for phrase in (meta or {}).get("user_phrases") or []:
                hay.update(_TOKEN.findall(str(phrase).lower()))
        scored.append((len(tokens & hay), name))
    scored.sort(key=lambda row: (-row[0], row[1]))
    picked = [name for score, name in scored if score > 0][:cap]
    for fallback in ("conversations", "agents", "queues", "messages"):
        if len(picked) >= min(3, cap):
            break
        if fallback in available and fallback not in picked:
            picked.append(fallback)
    if not picked and available:
        picked = list(available.keys())[:1]
    return picked


def groupable_sample_columns(role: str, view_name: str, product_dir: Path = PRODUCT_DIR) -> list[str]:
    rv = role_views(role, product_dir).get(view_name)
    if rv is None:
        return []
    names: list[str] = []
    for col, meta in rv.view.columns.items():
        if col in rv.hide or col.lower() in _NAME_COLS:
            continue
        if not (meta or {}).get("groupable"):
            continue
        typ = str((meta or {}).get("type") or "").lower()
        if typ in {"text", "boolean"} or typ.startswith("character"):
            names.append(col)
    return names
