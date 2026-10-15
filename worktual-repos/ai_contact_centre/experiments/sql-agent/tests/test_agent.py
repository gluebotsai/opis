from sql_agent.agent import SqlDeveloperAgent
from sql_agent.minimax import strip_thinking
from sql_agent.tools import OPENAI_TOOLS, SqlAgentTools, parse_tool_arguments
from sql_agent.warehouse import enforce_org_scoped_conversations


def test_org_scope_rewrites_conversations():
    sql = enforce_org_scoped_conversations(
        "SELECT COUNT(*) AS n FROM ccass.conversations",
        "1000",
    )
    assert "__org_conversations" in sql
    assert "organization_id = '1000'::bigint" in sql
    assert "FROM ccass.conversations" in sql


def test_openai_tool_names():
    names = {item["function"]["name"] for item in OPENAI_TOOLS}
    assert names == {
        "search_catalog",
        "get_metric",
        "get_table_details",
        "get_join_path",
        "lock_period",
        "plan_query",
        "sql_analytics",
    }


def test_search_catalog_spelling(catalog):
    tools = SqlAgentTools(catalog)
    result = tools.dispatch("search_catalog", {"query": "average handel time"})
    ids = [item["id"] for item in result["metrics"]]
    assert "avg_handle_time" in ids
    assert result["expansion"]["glossary_hits"] or result["expansion"]["fuzzy_hits"]


def test_plan_query_is_compact(catalog):
    tools = SqlAgentTools(catalog)
    plan = tools.dispatch("plan_query", {"question": "average handel time"})
    assert plan["trust"] == "certified"
    assert plan["sql"]
    assert "execute_sql" not in (plan.get("execute") or {})
    assert plan["execute"]["ok"] is True


def test_sql_analytics_dry_run_and_dml_reject(catalog):
    tools = SqlAgentTools(catalog, live=False)
    metric = tools.get_metric("avg_handle_time")
    ok = tools.dispatch("sql_analytics", {"sql": metric["sql"]})
    assert ok["ok"] is True
    assert ok["dry_run"] is True
    assert ok["warehouse"] == "unavailable"
    denied = tools.dispatch("sql_analytics", {"sql": "DELETE FROM ccass.conversations"})
    assert denied["ok"] is False
    assert "DELETE" in denied["error"]


def test_parse_tool_arguments_fenced_json():
    parsed = parse_tool_arguments('```json\n{"query": "aht"}\n```')
    assert parsed == {"query": "aht"}
    bad = parse_tool_arguments("not json")
    assert "_parse_error" in bad


def test_strip_thinking_hides_private_reasoning():
    text = "<think>secret plan</think>\n<p>Handle time is a duration KPI.</p>"
    assert "secret" not in strip_thinking(text)
    assert "Handle time" in strip_thinking(text)


def test_agent_loop_uses_tools_then_replies(catalog):
    tools = SqlAgentTools(catalog)

    class Scripted:
        def __init__(self) -> None:
            self.calls = 0

        def complete(self, messages, tools=None):
            self.calls += 1
            if self.calls == 1:
                return {
                    "content": "",
                    "tool_calls": [
                        {
                            "id": "call_1",
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

    client = Scripted()
    turn = SqlDeveloperAgent(tools=tools, client=client).ask("average handel time")
    assert client.calls == 2
    assert turn.tool_trace[0]["name"] == "plan_query"
    assert turn.tool_trace[0]["trust"] == "certified"
    assert "dry run" in turn.reply.casefold()
    assert "SELECT" not in turn.reply
