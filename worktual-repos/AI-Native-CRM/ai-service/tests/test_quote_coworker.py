"""Quote detail coworker — section rewrite heuristics."""

import asyncio
from unittest.mock import AsyncMock, patch

from app.agents.quote_coworker_agent import handle


def _run(messages, ctx=None, catalog=None, *, native_result=None):
    state = {
        "messages": messages,
        "context": ctx or {"entityId": "q1", "pathname": "/sales/quotes/q1"},
        "catalog": catalog
        or {
            "openQuote": {
                "id": "q1",
                "dealId": "deal1",
                "number": "QUO-0007",
            },
        },
    }
    with (
        patch("app.llm.is_ai_configured", return_value=True),
        patch(
            "app.agents.crm_tools.run_native_agent_turn",
            new_callable=AsyncMock,
            return_value=native_result,
        ),
    ):
        out = asyncio.run(handle(state))
    return out["result"]


def test_enhance_payment_terms_rewrite():
    r = _run(
        [{"role": "user", "text": "enhance the payment terms section"}],
        native_result={"ok": True, "_unhandled": True},
    )
    assert r["ok"]
    props = r.get("toolProposals") or []
    rewrite = next(p for p in props if p["name"] == "propose_rewrite_quote_section")
    assert rewrite["args"]["sectionKey"] == "payment_terms"
    assert rewrite["args"]["quoteId"] == "q1"
