"""Audit trace logging helpers."""

from cc_a2a.audit_log import _sanitize_arguments, log_a2a_trace, log_envelope_input


def test_sanitize_arguments_redacts_full_text_by_default() -> None:
    sanitized = _sanitize_arguments(
        {
            "visitorId": "visitor_1",
            "text": "You visited our product page — would you like to know more?",
        }
    )
    assert sanitized["visitorId"] == "visitor_1"
    assert "text" not in sanitized
    assert sanitized["textLength"] == len(
        "You visited our product page — would you like to know more?"
    )
    assert "textPreview" in sanitized


def test_log_envelope_input_emits_json(caplog) -> None:
    import logging

    caplog.set_level(logging.INFO, logger="a2a.trace")
    log_envelope_input(
        command_id="cmd-1",
        skill_id="cc.webchat.proactive-engagement.trigger",
        organization_id="1003",
        arguments={"visitorId": "visitor_1", "text": "Hello"},
        caller_subject="hub:worktual-hub-ccaas",
    )
    assert any("phase\": \"INPUT\"" in record.message for record in caplog.records)
    assert any("cmd-1" in record.message for record in caplog.records)


def test_log_a2a_trace_step() -> None:
    import logging
    from io import StringIO

    stream = StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(logging.Formatter("%(message)s"))
    trace_logger = logging.getLogger("a2a.trace")
    trace_logger.handlers.clear()
    trace_logger.addHandler(handler)
    trace_logger.setLevel(logging.INFO)

    log_a2a_trace("STEP", command_id="cmd-2", step="execute_skill", taskId="a2a_1")
    output = stream.getvalue()
    assert "phase" in output
    assert "execute_skill" in output
