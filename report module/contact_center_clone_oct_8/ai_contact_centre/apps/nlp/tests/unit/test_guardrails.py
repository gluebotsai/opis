from app.llm.thinking_filter import ThinkingFilter, strip_thinking
from app.runtime.guardrails import redact_customer_pii


def test_thinking_filter_handles_split_tags() -> None:
    stream_filter = ThinkingFilter()
    visible = [
        stream_filter.feed("<thi"),
        stream_filter.feed("nk>private reasoning"),
        stream_filter.feed("</th"),
        stream_filter.feed("ink>Visible answer"),
        stream_filter.flush(),
    ]
    assert "".join(visible) == "Visible answer"


def test_strip_thinking_removes_reasoning() -> None:
    assert strip_thinking("<think>secret</think>Hello") == "Hello"


def test_pii_redaction_retains_entities_separately() -> None:
    result = redact_customer_pii("Email me at user@example.com or +919876543210")
    assert "[CUSTOMER_EMAIL]" in result.text
    assert "[CUSTOMER_PHONE]" in result.text
    assert result.email == "user@example.com"
    assert result.phone == "+919876543210"
