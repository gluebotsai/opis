from __future__ import annotations

import json

from neo4j.time import Date, DateTime, Duration, Time

from app.agents.reports_b2b.kg_executor.core.kg_client import json_safe


def test_neo4j_temporal_values_become_json_text() -> None:
    closed = DateTime(2026, 10, 6, 12, 30, 0)
    paid = Date(2026, 10, 6)
    started = Time(9, 15, 0)
    span = Duration(months=0, days=2, seconds=90)

    safe = json_safe(
        {
            "closed_at": closed,
            "deals": [{"paid_on": paid, "started_at": started, "cycle": span}],
            "amount": 6000,
            "owner": "Hansa Solanki",
            "open": True,
        }
    )

    assert safe["closed_at"] == closed.iso_format()
    assert safe["deals"][0]["paid_on"] == paid.iso_format()
    assert safe["deals"][0]["started_at"] == started.iso_format()
    assert safe["deals"][0]["cycle"] == str(span)
    assert safe["amount"] == 6000
    assert safe["owner"] == "Hansa Solanki"
    assert safe["open"] is True
    json.dumps(safe)
