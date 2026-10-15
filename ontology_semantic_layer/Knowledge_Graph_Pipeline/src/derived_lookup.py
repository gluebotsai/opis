"""In-memory FK lookup cache for derived columns declared in core.yaml derived:."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class LookupSpec:
    table: str
    match_local: str
    match_remote: str
    select: str


class DerivedLookupCache:
    """Maps (lookup_table, match_remote_value) -> select_value from CDC rows."""

    def __init__(self) -> None:
        self._forward: dict[tuple[str, Any], Any] = {}
        self._reverse: dict[tuple[str, Any], Any] = {}

    def ingest(self, table: str, row: dict[str, Any], spec: LookupSpec) -> None:
        remote = row.get(spec.match_remote)
        selected = row.get(spec.select)
        if remote is None:
            return
        key = (spec.table, remote)
        if selected is not None:
            self._forward[key] = selected
            self._reverse[(spec.table, selected)] = remote

    def evict(self, table: str, row: dict[str, Any], spec: LookupSpec) -> None:
        remote = row.get(spec.match_remote)
        if remote is None:
            return
        key = (spec.table, remote)
        selected = self._forward.pop(key, None)
        if selected is not None:
            self._reverse.pop((spec.table, selected), None)

    def resolve(self, spec: LookupSpec, local_value: Any) -> Any | None:
        if local_value is None:
            return None
        return self._forward.get((spec.table, local_value))


def parse_lookup_spec(raw: dict[str, Any]) -> LookupSpec | None:
    lookup = raw.get("lookup")
    if not isinstance(lookup, dict):
        return None
    required = ("table", "match_local", "match_remote", "select")
    if not all(lookup.get(k) for k in required):
        return None
    return LookupSpec(
        table=str(lookup["table"]),
        match_local=str(lookup["match_local"]),
        match_remote=str(lookup["match_remote"]),
        select=str(lookup["select"]),
    )
