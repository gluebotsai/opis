"""Trusted tenant and period. Set by the runtime, never by the model."""

from __future__ import annotations

from dataclasses import dataclass

from sql_agent.compile import default_period
from sql_agent.warehouse import get_warehouse_settings


@dataclass(frozen=True)
class QueryContext:
    organization_id: str
    period_start: str
    period_end: str
    surface: str = "dashboard"

    @classmethod
    def resolve(
        cls,
        period_start: str | None = None,
        period_end: str | None = None,
        *,
        surface: str = "dashboard",
    ) -> "QueryContext":
        start, end = period_start, period_end
        if not start or not end:
            start, end = default_period()
        org = get_warehouse_settings().organization_id
        return cls(
            organization_id=org,
            period_start=start,
            period_end=end,
            surface=surface,
        )

    @property
    def period_label(self) -> str:
        return f"{self.period_start[:10]} to {self.period_end[:10]}"
