"""query_analytics falls back to campaign_sql when semantic is down/misses."""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, patch

from app.agents.reports.tools.handlers import handle_query_analytics


def test_query_analytics_campaign_sql_fallback() -> None:
    usable = [
        {
            "ok": True,
            "metric_id": "open_rate",
            "rows": [{"open_rate": 0.1, "opens": 10, "delivered": 100}],
        }
    ]

    async def _run() -> dict[str, Any]:
        with (
            patch(
                "app.agents.reports.tools.handlers.semantic_layer_configured",
                return_value=False,
            ),
            patch(
                "app.agents.reports.tools.handlers.get_or_create_session",
                new=AsyncMock(return_value={"session_id": "s1", "module": "reports"}),
            ),
            patch(
                "app.agents.reports.tools.handlers.resolve_organization_id",
                new=AsyncMock(return_value="1000"),
            ),
            patch(
                "app.agents.reports.tools.handlers.ask_campaign_analytics",
                new=AsyncMock(
                    return_value={
                        "ok": True,
                        "usable": usable,
                        "results": usable,
                        "plan": {"source": "campaign_sql", "metrics": ["open_rate"]},
                        "source": "campaign_sql",
                    }
                ),
            ),
        ):
            return await handle_query_analytics(
                "s1", "tok", {"question": "what is our open rate?"}
            )

    out = asyncio.run(_run())
    assert out["ok"] is True
    assert out["source"] == "campaign_sql"
    assert out["analytics"]["visual"]["kind"] == "kpi"
    assert out["analytics"]["audit"]["source"] == "campaign_sql"
