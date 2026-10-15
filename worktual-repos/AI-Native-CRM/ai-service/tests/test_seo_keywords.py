from app.integrations.semrush.keywords import (
    filter_keyword_rows,
    keyword_cache_key,
    normalize_keyword_rows,
)


def test_llm_estimate_rows_are_tagged_not_semrush():
    from app.integrations.seo.keyword_estimates import rows_from_llm_payload

    rows = rows_from_llm_payload(
        {
            "rows": [
                {"term": "chatbot software", "volume": 1200, "kd": 18},
                {"keyword": "ai helpdesk", "search_volume": 400},
                {"term": "conversational ai", "volume": 900},
            ]
        }
    )
    assert len(rows) >= 3
    assert all(r["source"] == "llm_estimate" for r in rows)
    assert rows[0]["term"] == "chatbot software"


def test_keyword_cache_key_is_stable_for_same_seed_locale():
    a = keyword_cache_key("1000", "Chat Bots", "US", "EN")
    b = keyword_cache_key("1000", "chat   bots", "us", "en")
    assert a == b
    assert a != keyword_cache_key("1000", "chat bots", "in", "en")


def test_filter_keyword_rows_slices_cached_json_only():
    rows = [
        {"term": "a", "intent": "informational", "volume": 100, "kd": 10},
        {"term": "b", "intent": "commercial", "volume": 20, "kd": 80},
    ]
    sliced = filter_keyword_rows(rows, {"intent": "commercial", "maxKd": 90})
    assert [r["term"] for r in sliced] == ["b"]
    assert filter_keyword_rows(rows, {"minVolume": 50})[0]["term"] == "a"


def test_normalize_keyword_rows_does_not_invent_terms():
    payload = {
        "data": [
            {"Ph": "conversational chatbot", "Nq": 2900, "Kd": 12, "Cp": 1.2},
            {"keyword": "ai chatbot", "search_volume": 800},
        ]
    }
    rows = normalize_keyword_rows(payload)
    assert rows[0]["term"] == "conversational chatbot"
    assert rows[0]["volume"] == 2900
    assert rows[0]["kd"] == 12
    assert normalize_keyword_rows({"hello": "world"}) == []


def test_normalize_gateway_keyword_metrics_shape():
    rows = normalize_keyword_rows(
        {
            "keyword": "seo tools",
            "country": "US",
            "search_volume": 60500,
            "cpc": "1245",
            "keyword_difficulty": 74,
            "intents": ["COMMERCIAL"],
            "competitive_density": 78,
        }
    )
    assert len(rows) == 1
    assert rows[0]["term"] == "seo tools"
    assert rows[0]["volume"] == 60500
    assert rows[0]["kd"] == 74
    assert rows[0]["cpc"] == 1245.0
