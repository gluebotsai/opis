"""Shortest allowed join path over the certified join graph."""

from __future__ import annotations

from collections import defaultdict, deque
from typing import Any

from sql_agent.catalog import Catalog, JoinEdge, TableCard


def _neighbors(catalog: Catalog) -> dict[str, list[tuple[str, JoinEdge, bool]]]:
    graph: dict[str, list[tuple[str, JoinEdge, bool]]] = defaultdict(list)
    for edge in catalog.edges:
        graph[edge.left].append((edge.right, edge, False))
        graph[edge.right].append((edge.left, edge, True))
    return graph


def join_path(tables: list[str], catalog: Catalog) -> dict[str, Any]:
    resolved: list[str] = []
    for name in tables:
        qualified = catalog.resolve_table(name)
        if qualified is None:
            return {
                "ok": False,
                "error": f"Unknown table '{name}'",
                "tables": tables,
                "steps": [],
            }
        if qualified not in resolved:
            resolved.append(qualified)
    if len(resolved) <= 1:
        return {"ok": True, "tables": resolved, "steps": [], "sql_from": _from_clause(resolved, catalog, [])}

    graph = _neighbors(catalog)
    ordered: list[str] = [resolved[0]]
    steps: list[dict[str, Any]] = []
    for target in resolved[1:]:
        if target in ordered:
            continue
        found = _bfs_connect(ordered, target, graph)
        if found is None:
            return {
                "ok": False,
                "error": f"No certified join path to {target} from {ordered}",
                "tables": resolved,
                "steps": steps,
            }
        for hop in found:
            steps.append(hop)
            nxt = hop["to"]
            if nxt not in ordered:
                ordered.append(nxt)
    return {
        "ok": True,
        "tables": ordered,
        "steps": steps,
        "sql_from": _from_clause(ordered, catalog, steps),
    }


def _bfs_connect(
    sources: list[str],
    target: str,
    graph: dict[str, list[tuple[str, JoinEdge, bool]]],
) -> list[dict[str, Any]] | None:
    start_set = set(sources)
    queue: deque[str] = deque(sources)
    prev: dict[str, tuple[str, JoinEdge, bool]] = {}
    seen = set(sources)
    while queue:
        node = queue.popleft()
        if node == target and node not in start_set:
            break
        for nxt, edge, reversed_edge in graph.get(node, []):
            if nxt in seen:
                continue
            seen.add(nxt)
            prev[nxt] = (node, edge, reversed_edge)
            queue.append(nxt)
            if nxt == target:
                queue.clear()
                break
    if target not in prev and target not in start_set:
        return None
    hops: list[dict[str, Any]] = []
    cursor = target
    while cursor not in start_set:
        parent, edge, reversed_edge = prev[cursor]
        hops.append(_step(parent, cursor, edge, reversed_edge))
        cursor = parent
    hops.reverse()
    return hops


def _step(frm: str, to: str, edge: JoinEdge, reversed_edge: bool) -> dict[str, Any]:
    if reversed_edge:
        left_col, right_col = edge.to_column, edge.from_column
    else:
        left_col, right_col = edge.from_column, edge.to_column
        if edge.left != frm:
            left_col, right_col = edge.to_column, edge.from_column
    return {
        "from": frm,
        "to": to,
        "from_column": left_col,
        "to_column": right_col,
        "on": f"{frm}.{left_col} = {to}.{right_col}",
        "purpose": edge.purpose,
        "cardinality": edge.cardinality,
    }


def _from_clause(tables: list[str], catalog: Catalog, steps: list[dict[str, Any]]) -> str:
    if not tables:
        return ""
    used_aliases: dict[str, str] = {}

    def alias_for(name: str) -> str:
        if name in used_aliases:
            return used_aliases[name]
        card: TableCard = catalog.tables[name]
        alias = card.alias
        if alias in used_aliases.values():
            alias = name.split(".")[-1][:4]
        used_aliases[name] = alias
        return alias

    first = tables[0]
    lines = [f"FROM {first} {alias_for(first)}"]
    joined = {first}
    for step in steps:
        right = step["to"]
        if right in joined:
            continue
        left = step["from"]
        left_alias = alias_for(left)
        right_alias = alias_for(right)
        lines.append(
            f"JOIN {right} {right_alias} ON {left_alias}.{step['from_column']} = {right_alias}.{step['to_column']}"
        )
        joined.add(right)
    return "\n".join(lines)


def assert_sql_joins_allowed(sql: str, catalog: Catalog) -> list[str]:
    """Return violations if SQL joins two allowlisted tables with no graph edge."""
    mentioned = [
        name
        for name in catalog.tables
        if name.casefold() in sql.casefold()
    ]
    if len(mentioned) <= 1:
        return []
    allowed_pairs = set()
    for edge in catalog.edges:
        allowed_pairs.add(frozenset({edge.left, edge.right}))
    violations = []
    path = join_path(mentioned, catalog)
    if not path.get("ok"):
        violations.append(str(path.get("error")))
        return violations
    covered = {frozenset({step["from"], step["to"]}) for step in path.get("steps") or []}
    for i, left in enumerate(mentioned):
        for right in mentioned[i + 1 :]:
            pair = frozenset({left, right})
            if pair in allowed_pairs or pair in covered:
                continue
            # Multi-hop is allowed if join_path succeeded; skip non-adjacent pairs.
    return violations
