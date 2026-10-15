from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone

import pytest

from app.orchestrator.contracts import AgentContext, AgentKind, AgentSpec, ExecutionEnvelope, ToolBudget
from app.orchestrator.errors import BudgetExceededError, ContractError
from app.orchestrator.tool_loop import BoundedToolLoop


def context(budget=None):
    return AgentContext(
        envelope=ExecutionEnvelope(
            runId="run-tools",
            traceId="trace-tools",
            organizationId="org-1",
            actorId="user-1",
            role="admin",
            businessType="b2b",
            deadline=datetime.now(timezone.utc) + timedelta(minutes=1),
            idempotencyKey="idem-tools",
            toolBudget=budget or ToolBudget(),
        )
    )


SPEC = AgentSpec(
    name="tool-agent",
    version="1",
    kind=AgentKind.COWORKER,
    execution="turn",
    allowedTools=["lookup", "mutate"],
)


def call(name, arguments, call_id="call-1"):
    return {
        "id": call_id,
        "type": "function",
        "function": {"name": name, "arguments": arguments},
    }


class Client:
    def __init__(self):
        self.calls = []
        self.active_mutations = 0
        self.max_active_mutations = 0

    async def list_tools(self, *, context=None):
        assert context["organizationId"] == "org-1"
        return [
            {
                "name": "lookup",
                "inputSchema": {"type": "object"},
                "annotations": {"readOnlyHint": True},
            },
            {"name": "mutate", "inputSchema": {"type": "object"}, "mutation": True},
        ]

    async def call_tool(self, name, arguments=None, *, context=None):
        self.calls.append((name, arguments))
        if name == "mutate":
            self.active_mutations += 1
            self.max_active_mutations = max(
                self.max_active_mutations, self.active_mutations
            )
            await asyncio.sleep(0)
            self.active_mutations -= 1
        return {"ok": True, "echo": arguments}


@pytest.mark.asyncio
async def test_tool_results_are_fed_back_to_llm_before_final_answer():
    llm_messages = []

    async def llm(**kwargs):
        llm_messages.append(list(kwargs["messages"]))
        if len(llm_messages) == 1:
            return {"content": "Checking.", "tool_calls": [call("lookup", {"id": "1"})]}
        tool_message = kwargs["messages"][-1]
        assert tool_message["role"] == "tool"
        assert '"echo": {"id": "1"}' in tool_message["content"]
        return {"content": "The LLM used the lookup result.", "tool_calls": []}

    result = await BoundedToolLoop(llm=llm).run(
        spec=SPEC,
        context=context(),
        messages=[{"role": "user", "content": "Look it up"}],
        client=Client(),
    )
    assert result.content == "The LLM used the lookup result."
    assert result.rounds == 2
    assert result.calls == 1
    follow_up = llm_messages[1]
    assistant = next(
        message
        for message in follow_up
        if message.get("role") == "assistant" and message.get("tool_calls")
    )
    arguments = assistant["tool_calls"][0]["function"]["arguments"]
    assert isinstance(arguments, str)
    assert json.loads(arguments) == {"id": "1"}


@pytest.mark.asyncio
async def test_exact_repeated_calls_stop_the_loop():
    async def llm(**kwargs):
        return {"content": "again", "tool_calls": [call("lookup", {"id": "same"})]}

    result = await BoundedToolLoop(llm=llm).run(
        spec=SPEC,
        context=context(ToolBudget(maxRepeatedCall=1)),
        messages=[],
        client=Client(),
    )
    assert result.calls == 1
    assert result.rounds == 2
    assert result.content == "again"


@pytest.mark.asyncio
async def test_last_round_with_tools_executes_then_stops():
    counter = 0

    async def llm(**kwargs):
        nonlocal counter
        counter += 1
        return {
            "content": f"round-{counter}",
            "tool_calls": [call("lookup", {"round": counter}, f"call-{counter}")],
        }

    result = await BoundedToolLoop(llm=llm).run(
        spec=SPEC,
        context=context(ToolBudget(maxRounds=2, maxCalls=10)),
        messages=[],
        client=Client(),
    )
    assert counter == 2
    assert result.rounds == 2
    assert result.calls == 2
    assert result.content == "round-2"


@pytest.mark.asyncio
async def test_call_budget_is_a_hard_bound():
    async def llm(**kwargs):
        return {
            "content": "",
            "tool_calls": [
                call("lookup", {"n": 1}, "c1"),
                call("lookup", {"n": 2}, "c2"),
                call("lookup", {"n": 3}, "c3"),
            ],
        }

    with pytest.raises(BudgetExceededError):
        await BoundedToolLoop(llm=llm).run(
            spec=SPEC,
            context=context(ToolBudget(maxRounds=6, maxCalls=2)),
            messages=[],
            client=Client(),
        )


@pytest.mark.asyncio
async def test_mutation_calls_are_serial_even_when_returned_together():
    responses = [
        {
            "content": "",
            "tool_calls": [
                call("mutate", {"n": 1}, "m1"),
                call("mutate", {"n": 2}, "m2"),
            ],
        },
        {"content": "Mutations completed.", "tool_calls": []},
    ]

    async def llm(**kwargs):
        return responses.pop(0)

    client = Client()
    await BoundedToolLoop(llm=llm).run(
        spec=SPEC, context=context(), messages=[], client=client
    )
    assert client.max_active_mutations == 1
    assert client.calls == [("mutate", {"n": 1}), ("mutate", {"n": 2})]


@pytest.mark.asyncio
async def test_independent_reads_may_run_in_parallel():
    active = 0
    max_active = 0

    class ReadClient(Client):
        async def call_tool(self, name, arguments=None, *, context=None):
            nonlocal active, max_active
            active += 1
            max_active = max(max_active, active)
            await asyncio.sleep(0.01)
            active -= 1
            return {"ok": True}

    responses = [
        {
            "content": "",
            "tool_calls": [
                call("lookup", {"n": 1}, "r1"),
                call("lookup", {"n": 2}, "r2"),
            ],
        },
        {"content": "Reads completed.", "tool_calls": []},
    ]

    async def llm(**kwargs):
        return responses.pop(0)

    await BoundedToolLoop(llm=llm).run(
        spec=SPEC, context=context(), messages=[], client=ReadClient()
    )
    assert max_active == 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response",
    [
        ["not", "an", "object"],
        {"content": "", "tool_calls": {"name": "lookup"}},
        {"content": "", "tool_calls": ["not-a-call"]},
    ],
)
async def test_malformed_llm_tool_output_fails_closed(response):
    async def llm(**_kwargs):
        return response

    with pytest.raises(ContractError):
        await BoundedToolLoop(llm=llm).run(
            spec=SPEC,
            context=context(),
            messages=[],
            client=Client(),
        )


def test_tool_call_context_keeps_open_entity():
    ctx = context()
    ctx = ctx.model_copy(
        update={
            "input": {
                "context": {
                    "module": "sales",
                    "surface": "detail",
                    "entityId": "deal_1",
                }
            }
        }
    )
    payload = BoundedToolLoop._tool_context(ctx)
    assert payload["entityId"] == "deal_1"
    assert payload["organizationId"] == "org-1"
