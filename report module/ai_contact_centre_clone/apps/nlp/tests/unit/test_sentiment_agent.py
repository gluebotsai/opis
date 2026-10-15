from app.agents.sentiment_agent import _label_from_score, _normalize_axis


def test_label_from_score_bands() -> None:
    assert _label_from_score(90) == "very_positive"
    assert _label_from_score(70) == "positive"
    assert _label_from_score(50) == "neutral"
    assert _label_from_score(30) == "negative"
    assert _label_from_score(10) == "very_negative"


def test_normalize_axis_aligns_label_with_score() -> None:
    axis = _normalize_axis(
        {"label": "positive", "score": 25, "confidence": 0.9, "rationale": "Frustrated"},
        fallback_rationale="fallback",
    )
    assert axis.label == "negative"
    assert axis.score == 25
