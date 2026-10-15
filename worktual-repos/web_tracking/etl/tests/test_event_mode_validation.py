import pytest

from ingest.validation import PayloadValidationError, validate_event_v3


def _base_event(**overrides):
    event = {
        "eventId": "evt_test_001",
        "name": "cdp_integration_test",
        "ts": 1730000000000,
        "pid": "pg_test",
        "props": {"source": "test"},
    }
    event.update(overrides)
    return event


def test_custom_event_with_event_mode_accepted():
    sanitized = validate_event_v3(_base_event(event_mode="custom"))
    assert sanitized["event_mode"] == "custom"
    assert sanitized["name"] == "cdp_integration_test"


def test_custom_event_without_event_mode_accepted():
    sanitized = validate_event_v3(_base_event())
    assert "event_mode" not in sanitized


def test_builtin_event_rejects_event_mode():
    with pytest.raises(PayloadValidationError, match="not allowed on built-in"):
        validate_event_v3(_base_event(name="page_view", event_mode="custom"))


def test_invalid_event_mode_value_rejected():
    with pytest.raises(PayloadValidationError, match="must be 'custom'"):
        validate_event_v3(_base_event(event_mode="builtin"))


def test_builtin_auto_events_do_not_allow_event_mode():
    for name in ("outbound_link", "file_download", "site_search"):
        with pytest.raises(PayloadValidationError, match="not allowed on built-in"):
            validate_event_v3(_base_event(name=name, event_mode="custom"))
