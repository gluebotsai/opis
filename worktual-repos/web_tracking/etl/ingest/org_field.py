"""Organization ID JSON field naming — canonical key: organization_id (snake_case)."""

from __future__ import annotations

from typing import Any

# Canonical key in raw_payloads.payload JSON and Kafka envelope payload
ORG_JSON_KEY = "organization_id"

# Legacy camelCase key still accepted on ingest
LEGACY_ORG_JSON_KEYS = ("organizationId",)


def read_organization_id(body: dict[str, Any]) -> int | None:
    for key in (ORG_JSON_KEY, *LEGACY_ORG_JSON_KEYS):
        if key not in body or body[key] is None:
            continue
        raw = body[key]
        if not isinstance(raw, int) or raw <= 0:
            raise ValueError(f"{key} must be a positive integer")
        return int(raw)
    return None


def set_organization_id(body: dict[str, Any], org_id: int) -> None:
    for key in (ORG_JSON_KEY, *LEGACY_ORG_JSON_KEYS):
        body.pop(key, None)
    body[ORG_JSON_KEY] = int(org_id)
