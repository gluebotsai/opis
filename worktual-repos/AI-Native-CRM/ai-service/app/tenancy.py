from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TenantContext:
    organization_id: str | None = None
