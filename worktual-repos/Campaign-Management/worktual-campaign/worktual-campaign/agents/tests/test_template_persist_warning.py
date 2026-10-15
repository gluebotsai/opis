from app.agents.create_campaign.tool_functions import _user_persist_warning


def test_persist_warning_does_not_leak_http_status() -> None:
    note = _user_persist_warning(
        RuntimeError("Client error '500 Internal Server Error' for url")
    )
    assert "500" not in note
    assert "save" in note.lower()
