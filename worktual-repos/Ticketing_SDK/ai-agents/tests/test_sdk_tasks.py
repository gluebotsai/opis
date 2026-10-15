"""Named partner tasks pin a registered Skill and ignore unknown ids."""

from app.contracts.execution import RunRequest
from app.memory.session import SharedMemory
from app.sdk_tasks import sdk_named_task_instruction


def _request(sdk_task: str, **memory: object) -> RunRequest:
    return RunRequest(
        message="Summarize this ticket.",
        session_memory={"sdkTask": sdk_task, **memory},
    )


def test_summarize_pins_investigation_summary():
    memory = SharedMemory(organization_id="1", user_id="u", session_id="s")
    instruction = sdk_named_task_instruction(
        memory,
        _request(
            "ticket.summarize",
            harnessFields={"ticket_number": "#128"},
        ),
    )
    assert instruction is not None
    assert instruction.task_id == "ticket.investigation.summary"
    assert instruction.executor_id == "investigation_summary_executor"
    assert instruction.skill_name == "ticket-investigation-summary"
    assert instruction.supplied_fields["ticket_number"] == "#128"
    state = memory.current_task_state()
    assert state is not None
    assert state.collected["ticket_number"] == "#128"
    assert memory.durable["active_domain"] == "resolution_lifecycle_domain"


def test_canonical_harness_id_also_pins():
    memory = SharedMemory(organization_id="1", user_id="u", session_id="s")
    instruction = sdk_named_task_instruction(
        memory,
        _request("intake.self.service.deflection", harnessFields={"query": "reset vpn"}),
    )
    assert instruction is not None
    assert instruction.skill_name == "intake-self-service-deflection"


def test_metrics_pin_the_reporting_skill():
    memory = SharedMemory(organization_id="1", user_id="u", session_id="s")
    instruction = sdk_named_task_instruction(memory, _request("analytics.ask"))
    assert instruction is not None
    assert instruction.task_id == "analytics.query"
    assert instruction.executor_id == "analytics_audit_query_executor"
    assert instruction.skill_name == "analytics-query"


def test_context_layer_block_follows_the_configured_url(monkeypatch):
    from app.config import get_settings
    from app.sdk_tasks import sdk_context_block

    class Empty:
        context_layer_url = ""
        ontology_chat_url = ""

    class Ready:
        context_layer_url = "http://context.test"
        ontology_chat_url = "http://graph.test"

    monkeypatch.setattr("app.config.get_settings", lambda: Empty())
    assert sdk_context_block("analytics.query") == "temporarily_unavailable"
    assert sdk_context_block("analytics.root.cause") == "temporarily_unavailable"
    assert sdk_context_block("ticket.read.search") is None
    monkeypatch.setattr("app.config.get_settings", lambda: Ready())
    assert sdk_context_block("analytics.query") is None
    assert sdk_context_block("analytics.root.cause") is None
    get_settings.cache_clear()


def test_create_pins_ticket_create():
    memory = SharedMemory(organization_id="1", user_id="u", session_id="s")
    instruction = sdk_named_task_instruction(memory, _request("ticket.create"))
    assert instruction is not None
    assert instruction.task_id == "ticket.create"
    assert instruction.skill_name == "ticket-create"
    assert instruction.executor_id == "ticket_creation_executor"


def test_unknown_does_not_pin():
    memory = SharedMemory(organization_id="1", user_id="u", session_id="s")
    assert sdk_named_task_instruction(memory, _request("not-a-task")) is None
    assert memory.current_task_state() is None
