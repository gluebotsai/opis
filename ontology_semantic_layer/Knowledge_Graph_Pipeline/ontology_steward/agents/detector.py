"""Detector — list unmapped JSON keys and drift columns."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable

from ontology_steward.models import FieldSignal, StewardContext
from ontology_steward.tools.registry_io import STEWARD_ROOT

# Tables with custom_dynamic JSONB in core (subset used by harness).
_CUSTOM_TABLES = {
    "cdp.customer_profile": ("custom_fields", "organization_id"),
    "crm.contact_profiles": ("custom_fields", "organization_id"),
}


class Detector:
    def __init__(self, loader, known_keys_fn=None):
        self.loader = loader
        self.known_keys_fn = known_keys_fn

    def known_keys(self, table: str, database: str) -> set[str]:
        if self.known_keys_fn:
            return self.known_keys_fn(table, database)
        m = self.loader.get_mapping(database, table)
        if not m:
            return set()
        known = {p.name for p in m.properties}
        if m.custom_field:
            known.add(m.custom_field)
        known.update(p.name for p in m.custom_properties)
        if m.custom_fields_whitelist:
            known.update(m.custom_fields_whitelist)
        return known

    def from_pg(
        self,
        ctx: StewardContext,
        conn_factory: Callable | None,
        tables: dict[str, tuple[str, str]] | None = None,
    ) -> list[FieldSignal]:
        signals: list[FieldSignal] = []
        database = ctx.database or f"org{ctx.org}"
        tables = tables or _CUSTOM_TABLES

        if conn_factory:
            from ontology_steward.tools.pg_samples import sample_jsonb_keys

            for table, (json_col, org_col) in tables.items():
                blob_keys = sample_jsonb_keys(conn_factory, table, json_col, org_col, ctx.org)
                known = self.known_keys(table, database)
                stop = set()
                m = self.loader.get_mapping(database, table)
                if m:
                    stop = set(m.custom_fields_blocklist) | set(m.stop_dynamic_keys)
                for key, samples in blob_keys.items():
                    if key in known or key in stop:
                        continue
                    if m and m.custom_fields_whitelist and key not in m.custom_fields_whitelist:
                        if not m.custom_dynamic:
                            continue
                    signals.append(
                        FieldSignal(field=key, table=table, org=ctx.org, sample_values=samples)
                    )

        ctx.log("detector", "scan_complete", count=len(signals))
        return signals

    def from_inbox_payload(self, payload: dict[str, Any]) -> list[FieldSignal]:
        return [
            FieldSignal(
                field=p["field"],
                table=p["table"],
                org=p.get("org", ""),
                sample_values=p.get("sample_values", []),
                source=p.get("source", "custom_json"),
            )
            for p in payload.get("signals", [])
        ]

    def write_inbox(self, signals: list[FieldSignal], org: str) -> Path:
        inbox = STEWARD_ROOT / "inbox"
        inbox.mkdir(parents=True, exist_ok=True)
        path = inbox / f"{org}.json"
        path.write_text(
            json.dumps(
                {
                    "org": org,
                    "signals": [
                        {
                            "field": s.field,
                            "table": s.table,
                            "org": s.org,
                            "sample_values": s.sample_values,
                            "source": s.source,
                        }
                        for s in signals
                    ],
                },
                indent=2,
                default=str,
            ),
            encoding="utf-8",
        )
        return path
