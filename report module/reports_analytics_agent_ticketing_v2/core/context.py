"""Build small Domain / SQL indexes from the product catalog."""

from __future__ import annotations

from typing import Any

from .templates import load_dimensions
from .views import load_views


def access_index_lines(access: dict[str, Any], role: str) -> str:
    matrix = access.get("matrix") or {}
    role_meta = (access.get("roles") or {}).get(role) or {}
    lines = [
        f"product: ticketing",
        f"role: {role}",
        f"default_scope: {role_meta.get('default_scope') or '-'}",
        f"my_tickets_column: {role_meta.get('my_tickets_column') or '-'}",
        f"created_by_me_column: {role_meta.get('created_by_me_column') or 'deny'}",
    ]
    for level, grants in matrix.items():
        grant = grants.get(role, "deny")
        lines.append(f"scope {level}: {grant}")
    return "\n".join(lines)


def kpi_index_lines(kpis: dict[str, Any], *, allowed: set[str] | None = None) -> str:
    """Compact meaning cards for Domain. Not a dump of ids."""
    lines = []
    for kpi_id, card in kpis.items():
        if allowed is not None and kpi_id not in allowed:
            continue
        answers = str(card.get("answers") or card.get("label") or kpi_id).strip()
        not_ = str(card.get("not") or "").strip()
        dims = ",".join(card.get("allowed_dimensions") or card.get("group") or []) or "-"
        grain = str(card.get("grain") or "").strip()
        extra = f" | not: {not_}" if not_ else ""
        grain_s = f" | grain: {grain}" if grain else ""
        lines.append(f"{kpi_id} | answers: {answers}{extra} | group: {dims}{grain_s}")
    return "\n".join(lines)


def dimension_glossary_lines() -> str:
    spec = load_dimensions()
    lines = []
    for dim_id, card in (spec.get("dimensions") or {}).items():
        words = ", ".join(card.get("user_words") or [])
        confuse = card.get("do_not_confuse_with") or ""
        lines.append(
            f"{dim_id} | sql: {card.get('sql')} | means: {card.get('means')} "
            f"| say: [{words}] | not: {confuse}"
        )
    aliases = spec.get("aliases") or {}
    if aliases:
        mapped = ", ".join(f"{k}->{v}" for k, v in aliases.items())
        lines.append(f"aliases: {mapped}")
    return "\n".join(lines)


def rpt_column_book_lines(*, max_chars: int = 12000) -> str:
    views = load_views()
    chunks: list[str] = []
    used = 0
    for name, spec in views.items():
        head = f"rpt.{name}: {spec.description}"
        cols = []
        for col, meta in spec.columns.items():
            desc = ""
            if isinstance(meta, dict):
                desc = str(meta.get("description") or "").strip()
            cols.append(f"  {col}: {desc}" if desc else f"  {col}")
        block = head + "\n" + "\n".join(cols)
        if used + len(block) + 1 > max_chars:
            chunks.append("(column book truncated)")
            break
        chunks.append(block)
        used += len(block) + 1
    return "\n".join(chunks)


def kg_schema_brief(
    schema: dict[str, Any],
    *,
    edges: dict[str, Any] | None = None,
    max_chars: int = 8000,
) -> str:
    labels = schema.get("labels") or []
    rels = schema.get("relationships") or []
    by_label = schema.get("properties_by_label") or {}
    lines = [
        "labels: " + ", ".join(str(x) for x in labels),
        "relationships: " + ", ".join(str(x) for x in rels),
    ]
    pairs = (edges or {}).get("pairs") or []
    if pairs:
        triples = sorted(f"({a})-[:{rel}]->({b})" for a, rel, b in pairs)
        lines.append("triples:")
        lines.extend(f"  {row}" for row in triples)
    lines.append("properties_by_label:")
    for label, props in by_label.items():
        lines.append(f"  {label}: " + ", ".join(str(p) for p in props))
    return "\n".join(lines)[:max_chars]


def graph_index_lines(measures: dict[str, Any], concepts: list[Any] | None = None) -> str:
    lines = []
    for measure_id, card in measures.items():
        hops = ",".join(card.get("hops") or []) or "-"
        dims = ",".join(card.get("allowed_dimensions") or []) or "-"
        scopes = ",".join(card.get("allowed_scope_levels") or []) or "-"
        lines.append(
            f"{measure_id} | {card.get('family')} | hops: {hops} | group: {dims} | scopes: {scopes}"
        )
    for card in concepts or []:
        when = card.get("when") or ""
        paths = "; ".join(card.get("paths") or [])
        lines.append(f"concept {card.get('measure')} | {when} | {paths}")
    return "\n".join(lines)


def entity_index_lines(catalog: dict[str, Any]) -> str:
    groups = catalog.get("entity_groups") or {}
    dims = catalog.get("dimensions") or {}
    dim_names = ",".join(dims.keys())
    lines = []
    for name, members in groups.items():
        lines.append(f"{name} | {','.join(members)} | group: {dim_names}")
    compares = catalog.get("compare_fields") or {}
    if compares:
        lines.append("compare_filters (hours unless csat_score):")
        for name, spec in compares.items():
            aliases = ",".join(spec.get("aliases") or []) or "-"
            lines.append(f"  {name} | aliases: {aliases} | reading: < <= > >= = | mention: number only")
    rosters = catalog.get("rosters") or {}
    if rosters:
        lines.append("rosters (shape list, measure = roster id, path catalog; not ticket ranking):")
        for name, spec in rosters.items():
            aliases = ",".join(spec.get("aliases") or []) or "-"
            lines.append(f"  {name} | table {spec.get('table')} | aliases: {aliases}")
    return "\n".join(lines)
