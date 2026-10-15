from sql_agent.orchestrator import SqlOrchestrator
from sql_agent.status import StatusEvent
from sql_agent.tools import SqlAgentTools


class Scripted:
    def __init__(self) -> None:
        self.calls = 0

    def complete(self, messages, tools=None):
        self.calls += 1
        names = {item["function"]["name"] for item in (tools or [])}
        if "route_to_agent" in names:
            return {
                "content": "",
                "tool_calls": [
                    {
                        "id": "route_1",
                        "type": "function",
                        "function": {
                            "name": "route_to_agent",
                            "arguments": '{"agent_name":"sql_developer","query":"average handel time"}',
                        },
                    }
                ],
                "model": "worktual-minimax",
            }
        if self.calls == 2:
            return {
                "content": "",
                "tool_calls": [
                    {
                        "id": "plan_1",
                        "type": "function",
                        "function": {
                            "name": "plan_query",
                            "arguments": '{"question":"average handel time"}',
                        },
                    }
                ],
                "model": "worktual-minimax",
            }
        return {
            "content": "<p>Average handle time is a certified duration KPI. No live warehouse totals in this dry run.</p>",
            "tool_calls": None,
            "model": "worktual-minimax",
        }


def test_orchestrator_routes_then_specialist(catalog):
    events: list[StatusEvent] = []
    orch = SqlOrchestrator(tools=SqlAgentTools(catalog), client=Scripted())
    turn = orch.run("average handel time", on_event=events.append)
    assert turn.routed_to == "sql_developer"
    agents = [event.agent for event in events]
    assert agents[0] == "sql_supervisor"
    assert "sql_developer" in agents
    states = [(event.agent, event.state) for event in events]
    assert ("sql_supervisor", "routing") in states
    assert ("sql_developer", "tool") in states
    assert ("sql_developer", "done") in states
    assert "dry run" in turn.reply.casefold()
    assert turn.specialist is not None
    assert turn.specialist.tool_trace[0]["name"] == "plan_query"


def test_supervisor_can_answer_without_routing(catalog):
    class Direct:
        def complete(self, messages, tools=None):
            return {
                "content": "<p>I route analytics questions to the SQL developer specialist.</p>",
                "tool_calls": None,
                "model": "worktual-minimax",
            }

    orch = SqlOrchestrator(tools=SqlAgentTools(catalog), client=Direct())
    turn = orch.run("who are you")
    assert turn.routed_to is None
    assert turn.specialist is None
    assert "sql developer" in turn.reply.casefold()


def test_html_to_text_strips_tags():
    from sql_agent.cli import html_to_text

    text = html_to_text("<p><strong>AHT</strong> is a duration KPI.</p><ul><li>dry run</li></ul>")
    assert "AHT" in text
    assert "<" not in text
    assert "dry run" in text
