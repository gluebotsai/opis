"""Runtime context blocks. YAML in, prompt text out. Never :org_id."""

from __future__ import annotations

import re
from typing import Any

from .examples import format_sql_examples, load_sql_examples, pick_sql_examples
from .loader import PACK_ROOT, PRODUCT_DIR, hitl_object, merge_effective
from .sql.views import (
    groupable_sample_columns,
    select_view_names,
    view_cards_for_prompt,
    view_index_for_prompt,
)

_TOKEN = re.compile(r"[a-z0-9_]+")
_STOP = frozenset(
    {
        "the",
        "a",
        "an",
        "of",
        "in",
        "for",
        "to",
        "and",
        "or",
        "how",
        "many",
        "are",
        "there",
        "is",
        "this",
        "that",
        "last",
        "past",
        "days",
        "week",
        "month",
        "year",
        "what",
        "was",
        "were",
        "with",
    }
)

SKILL_METRICS = "skills/contact_center-kpi-meaning/SKILL.md"
SKILL_VIEWS = "skills/contact_center-sql-views/SKILL.md"
EXECUTOR_PROMPT = "sql_executor/agent.md"


def load_skill(path: str) -> str:
    return (PACK_ROOT / path).read_text()


def _tokens(text: str) -> set[str]:
    raw = {t for t in _TOKEN.findall((text or "").lower()) if t not in _STOP and len(t) > 1}
    extra: set[str] = set()
    for tok in raw:
        extra.add(tok)
        if tok.endswith("s") and len(tok) > 3:
            extra.add(tok[:-1])
        else:
            extra.add(tok + "s")
    return extra


def _format_metric_card(kid: str, card: dict[str, Any]) -> str:
    unsupported = []
    for item in card.get("unsupported_filters") or []:
        if isinstance(item, dict) and item.get("name"):
            unsupported.append(item["name"])
        elif item:
            unsupported.append(item)
    return "\n".join(
        [
            f"id: {kid}",
            f"object: {hitl_object(kid)}",
            f"label: {card.get('label')}",
            f"when_to_use: {card.get('when_to_use')}",
            f"when_not: {card.get('when_not')}",
            f"not_confused_with: {card.get('not_confused_with')}",
            f"allowed_dimensions: {list(card.get('allowed_dimensions') or [])}",
            f"filters: {list((card.get('filters') or {}).keys())}",
            f"unsupported_filters: {unsupported[:12]}",
        ]
    )


def pick_metric_ids(goal: str, kpis: dict[str, Any], *, role: str, top_k: int = 8) -> list[str]:
    """Attach a few cards whose phrases overlap the task. Retrieval for size, not routing."""
    want = _tokens(goal)
    scored: list[tuple[int, str]] = []
    for kid, card in (kpis or {}).items():
        if card.get("admin_only") and role != "admin":
            continue
        phrases = [str(p).lower() for p in (card.get("user_phrases") or [])]
        hay = " ".join(
            [
                kid,
                str(card.get("label") or ""),
                str(card.get("when_to_use") or ""),
                str(card.get("family") or ""),
                " ".join(phrases),
            ]
        )
        score = len(want & _tokens(hay))
        goal_l = (goal or "").lower()
        if kid.replace("_", " ") in goal_l or kid in want:
            score += 4
        if any(p and p in goal_l for p in phrases):
            score += 4
        scored.append((score, kid))
    scored.sort(reverse=True)
    picked: list[str] = []
    for score, kid in scored:
        if len(picked) >= top_k:
            break
        if score == 0 and picked:
            continue
        picked.append(kid)
    if not picked:
        picked = [kid for _score, kid in scored[:top_k]]
    extra: list[str] = []
    for kid in list(picked):
        for neighbour in (kpis.get(kid) or {}).get("not_confused_with") or []:
            name = str(neighbour)
            if name in kpis and name not in picked and name not in extra:
                extra.append(name)
    return picked + extra[:4]


def metric_cards_for_role(
    role: str,
    organization_id: int | None = None,
    goal: str = "",
) -> str:
    catalog = merge_effective(organization_id)
    kpis = catalog["kpis"] or {}
    ids = pick_metric_ids(goal, kpis, role=role) if goal.strip() else list(kpis)[:8]
    blocks = [_format_metric_card(kid, kpis[kid]) for kid in ids if kid in kpis]
    return "\n\n".join(blocks)


def alias_brief_for_cards(
    role: str,
    organization_id: int | None = None,
    *,
    goal: str = "",
) -> str:
    catalog = merge_effective(organization_id)
    kpis = catalog["kpis"] or {}
    ids = pick_metric_ids(goal, kpis, role=role) if goal.strip() else [k for k, c in kpis.items() if not (c.get("admin_only") and role != "admin")]
    allowed: set[str] = set()
    for kid in ids:
        card = kpis.get(kid) or {}
        allowed.update(str(a) for a in (card.get("allowed_dimensions") or []) if a)
    aliases = (catalog.get("dimensions") or {}).get("aliases") or {}
    lines = ["slice aliases (user word -> dimension id):"]
    for raw, dim_id in aliases.items():
        if str(dim_id) in allowed:
            lines.append(f"  {raw} -> {dim_id}")
    return "\n".join(lines[:180])


def alias_brief_for_objects(objects: list[str], organization_id: int | None = None) -> str:
    catalog = merge_effective(organization_id)
    aliases = (catalog.get("dimensions") or {}).get("aliases") or {}
    want = {str(o).lower() for o in objects if o}
    lines = ["slice aliases (user word -> dimension id):"]
    for raw, dim_id in aliases.items():
        obj = str(raw).split(".", 1)[0].lower()
        if obj in want:
            lines.append(f"  {raw} -> {dim_id}")
    return "\n".join(lines[:120])


def views_book_for_role(role: str, view_names: list[str] | None = None) -> str:
    return view_cards_for_prompt(role, view_names)


def sample_values_for_views(
    role: str,
    view_names: list[str],
    *,
    organization_id: int,
    user_id: int,
    dsn: str | None,
    cap_cols: int = 8,
) -> str:
    if not dsn or not view_names:
        return ""
    from . import db as pg
    from .sql.sql_guard import GuardError, guard_sql

    lines = ["sample values for this org (closed vocabularies):"]
    used = 0
    for view_name in view_names:
        if used >= cap_cols:
            break
        for col in groupable_sample_columns(role, view_name)[:4]:
            if used >= cap_cols:
                break
            sql = f"SELECT DISTINCT {col} AS value FROM rpt.{view_name} WHERE {col} IS NOT NULL LIMIT 16"
            try:
                guarded = guard_sql(
                    sql,
                    role=role,
                    organization_id=organization_id,
                    user_id=user_id,
                    params={},
                    row_cap=16,
                    apply_row_cap=True,
                )
                rows = pg.fetchall(dsn, guarded.sql, guarded.params, timeout_ms=4000)
            except (GuardError, Exception):
                continue
            values = [str(r.get("value")) for r in rows if r.get("value") not in (None, "")]
            if not values:
                continue
            lines.append(f"  rpt.{view_name}.{col}: {values[:16]}")
            used += 1
    if used == 0:
        return ""
    return "\n".join(lines)


def executor_user_payload(
    *,
    task: dict[str, Any],
    role: str,
    path: str,
    time_echo: str,
    start: str | None,
    end: str | None,
    organization_id: int | None = None,
    user_id: int | None = None,
    dsn: str | None = None,
    repair: str = "",
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "task": task,
        "path": path,
        "time_echo": time_echo,
    }
    if start and end:
        payload["start"] = start
        payload["end"] = end
    if repair:
        payload["repair"] = repair
        payload["instruction"] = "Fix the previous tool JSON using this error. Output one JSON object."
    goal = str(task.get("goal") or "")
    slice_words = task.get("slice") or []
    if isinstance(slice_words, str):
        slice_words = [slice_words] if slice_words.strip() else []
    if path == "certified_metric":
        payload["metric_cards"] = metric_cards_for_role(role, organization_id, goal=goal)
        payload["dimension_aliases"] = alias_brief_for_cards(role, organization_id, goal=goal)
        payload["skill"] = "contact_center-kpi-meaning"
    else:
        selected = select_view_names(role, goal, list(slice_words))
        payload["views_index"] = view_index_for_prompt(role)
        payload["views"] = views_book_for_role(role, selected)
        payload["selected_views"] = selected
        objects = []
        from .sql.views import role_views

        for name in selected:
            rv = role_views(role).get(name)
            if rv and rv.view.object:
                objects.append(rv.view.object)
        payload["dimension_aliases"] = alias_brief_for_objects(objects, organization_id)
        catalog = merge_effective(organization_id)
        ids = pick_metric_ids(goal, catalog.get("kpis") or {}, role=role, top_k=2)
        meanings: list[str] = []
        for kid in ids:
            card = (catalog.get("kpis") or {}).get(kid) or {}
            definition = card.get("definition") or {}
            meanings.append(
                f"{kid}: include {definition.get('includes') or ''}. "
                f"exclude {definition.get('excludes') or ''}. "
                f"when {card.get('when_to_use') or ''}. not {card.get('when_not') or ''}"
            )
        if meanings:
            payload["certified_meaning"] = "\n".join(meanings)
        examples = pick_sql_examples(goal, load_sql_examples(PRODUCT_DIR), top_k=3)
        formatted = format_sql_examples(examples)
        if formatted:
            payload["examples"] = formatted
        if organization_id is not None and user_id is not None:
            samples = sample_values_for_views(
                role,
                selected,
                organization_id=int(organization_id),
                user_id=int(user_id),
                dsn=dsn,
            )
            if samples:
                payload["sample_values"] = samples
        payload["skill"] = "contact_center-sql-views"
    return payload
