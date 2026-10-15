from app.mcp.agent_presence import annotate_presence_agents, project_agent_presence


def test_not_ready_is_logged_in_online() -> None:
    view = project_agent_presence({"name": "Bharathi s", "presence": "not_ready"})
    assert view["presenceLabel"] == "Not Ready"
    assert view["loggedIn"] is True
    assert view["session"] == "online"


def test_offline_is_logged_out() -> None:
    view = project_agent_presence({"name": "Test Agent", "presence": "offline"})
    assert view["presenceLabel"] == "Offline"
    assert view["loggedIn"] is False
    assert view["session"] == "offline"


def test_trusted_logged_in_overrides_stale_offline_presence() -> None:
    view = project_agent_presence(
        {"name": "Bharathi s", "presence": "offline", "loggedIn": True}
    )
    assert view["loggedIn"] is True
    assert view["session"] == "online"


def test_annotate_presence_agents_adds_summary() -> None:
    agents, summary = annotate_presence_agents(
        [
            {"name": "Bharathi s", "presence": "not_ready", "agentStatus": "active"},
            {"name": "Test Agent", "presence": "offline"},
        ]
    )
    assert agents[0]["session"] == "online"
    assert agents[0]["presenceLabel"] == "Not Ready"
    assert summary[1]["session"] == "offline"
    assert [row["name"] for row in summary if row["session"] == "offline"] == ["Test Agent"]
