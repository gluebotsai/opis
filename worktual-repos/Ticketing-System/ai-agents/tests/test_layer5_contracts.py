"""
Layer 5 — Contract tests: tool response, Response Formatter, registry allowlists.
"""

from __future__ import annotations

import pytest

from app.contracts import (
    SCHEMA_VERSION,
    TOOL_ERROR_CODES,
    format_chat_response,
    tool_err,
    tool_ok,
)
from app.tools.registry import (
    TOOL_ALLOWLIST,
    assert_tool_allowed,
    tools_for_agent,
    tools_for_module,
)


REQUIRED_TOOL_KEYS_OK = {"success", "payload"}
REQUIRED_TOOL_KEYS_ERR = {"success", "error_code", "message"}
REQUIRED_CHAT_KEYS = {
    "schema_version",
    "reply",
    "ui_actions",
    "data",
    "agent",
    "request_id",
}


@pytest.mark.contract
class TestToolResponseContract:
    def test_tool_ok_keys(self):
        out = tool_ok({"id": "1"})
        assert set(out.keys()) >= REQUIRED_TOOL_KEYS_OK
        assert out["success"] is True
        assert "error_code" not in out

    def test_tool_err_codes(self):
        for code in (
            "FORBIDDEN",
            "BAD_INPUT",
            "NO_ACTOR",
            "UNAUTHORIZED",
            "FORBIDDEN_PATH",
            "RETRYABLE",
            "TIMEOUT",
        ):
            err = tool_err(code, "msg", http_status=403 if "FORBID" in code else None)
            assert set(err.keys()) >= REQUIRED_TOOL_KEYS_ERR
            assert err["success"] is False
            assert err["error_code"] in TOOL_ERROR_CODES


@pytest.mark.contract
class TestResponseFormatterContract:
    def test_envelope_shape(self):
        out = format_chat_response(
            reply="Hello",
            agent="teams",
            ui_actions=[{"type": "navigate", "view": "agent-queues"}],
            data={"count": 0},
            request_id="r1",
        )
        assert set(out.keys()) == REQUIRED_CHAT_KEYS
        assert out["schema_version"] == SCHEMA_VERSION
        assert out["agent"] == "teams"
        assert isinstance(out["ui_actions"], list)
        assert isinstance(out["data"], dict)

    def test_defaults(self):
        out = format_chat_response(reply="", agent="")
        assert out["reply"] == ""
        assert out["agent"] == "general"
        assert out["ui_actions"] == []
        assert out["request_id"]


@pytest.mark.contract
class TestToolRegistryContract:
    def test_known_agents(self):
        for agent in ("tickets", "teams", "kb", "customers", "general"):
            assert agent in TOOL_ALLOWLIST
            assert len(tools_for_agent(agent)) > 0

    def test_teams_mutate_tools_present(self):
        allowed = tools_for_agent("teams")
        for name in ("create_queue", "update_queue", "delete_queue", "list_queues"):
            assert name in allowed

    def test_tickets_cannot_delete_queue(self):
        with pytest.raises(PermissionError):
            assert_tool_allowed("tickets", "delete_queue")

    def test_express_paths_are_hidden_from_registry(self):
        # Registry is tool names only — never raw HTTP verbs/paths
        for tools in TOOL_ALLOWLIST.values():
            for name in tools:
                assert not name.startswith("/")
                assert "POST" not in name.upper() or name == name  # noop clarity
                assert "/" not in name

    def test_tools_for_module_is_subset_of_agent(self):
        for (mod, surf), names in (
            (("tickets", "list"), tools_for_module("tickets", "list")),
            (("tickets", "create"), tools_for_module("tickets", "create")),
            (("teams", "create"), tools_for_module("teams", "create")),
            (("admin", "analytics"), tools_for_module("admin", "analytics")),
            (("portal", "home"), tools_for_module("portal", "home")),
        ):
            agent = "kb" if mod == "portal" else ("admin" if mod == "admin" else mod)
            allowed = tools_for_agent(agent)
            assert names
            assert names <= allowed

    def test_module_surface_intersects_bind_tools(self):
        from app.tools.bound import langchain_tools_for_agent

        listed = {t.name for t in langchain_tools_for_agent("tickets", module="tickets", surface="list")}
        created = {t.name for t in langchain_tools_for_agent("tickets", module="tickets", surface="create")}
        assert "list_tickets" in listed
        assert "create_ticket" not in listed
        assert "create_ticket" in created
        assert "list_tickets" not in created
        # Side-quest specialist (teams while on tickets page) keeps full allowlist.
        teams = {t.name for t in langchain_tools_for_agent("teams", module="tickets", surface="list")}
        assert "create_queue" in teams
        names = tools_for_module("admin", "analytics")
        assert "create_ticket" not in names
        assert "get_analytics" in names
        assert "export_analytics" in names

    def test_admin_list_and_priorities_include_catalog_mutate(self):
        """Delete/update stay on admin list+priorities; analytics stays metrics-only."""
        admin_list = tools_for_module("admin", "list")
        admin_pri = tools_for_module("admin", "priorities")
        analytics = tools_for_module("admin", "analytics")
        for surf_tools in (admin_list, admin_pri):
            assert "delete_priority" in surf_tools
            assert "update_priority" in surf_tools
            assert "delete_status" in surf_tools
            assert "update_status" in surf_tools
            assert "create_priority" in surf_tools
            assert surf_tools <= tools_for_agent("admin")
        assert "delete_priority" not in analytics
        assert "update_priority" not in analytics
        assert "get_analytics" in analytics


@pytest.mark.contract
class TestAgentTurnAdapter:
    def _map(self, actions, data=None, **kwargs):
        from app.agent_turn import chat_result_to_agent_turn

        return chat_result_to_agent_turn(
            {
                "reply": "Let's continue.",
                "agent": "tickets",
                "session_id": "s1",
                "actions": actions,
                "request_id": "r1",
                "data": data or {},
            },
            **kwargs,
        )

    def test_envelope_keys(self):
        out = self._map([])
        for key in (
            "assistantText",
            "toolProposals",
            "patch",
            "sessionMemoryPatch",
            "uiRefresh",
        ):
            assert key in out
        assert out["assistantText"] == "Let's continue."
        assert out["reply"] == "Let's continue."
        assert out["ui_actions"] == []
        assert "workflow_decision" not in out
        assert "intent" not in out

    def test_create_ticket_maps_to_workspace_and_patch(self):
        out = self._map(
            [
                {"type": "navigate", "view": "create-ticket"},
                {
                    "type": "create_ticket",
                    "step": "contact",
                    "customerName": "Jane Doe",
                    "customerEmail": "jane@acme.com",
                },
            ],
            data={
                "workflow": "create_ticket",
                "step": "contact",
                "ticket_draft": {
                    "awaiting": "contact",
                    "customerName": "Jane Doe",
                    "customerEmail": "jane@acme.com",
                },
            },
        )
        names = [p["name"] for p in out["toolProposals"]]
        assert "set_workspace" in names
        assert "patch_ticket_draft" in names
        assert out["patch"]["customerName"] == "Jane Doe"
        assert out["sessionMemoryPatch"]["pendingIntent"] == "create_ticket"
        assert out["sessionMemoryPatch"]["pendingAsk"] in {"issue", "contact", "customerEmail"}
        assert "propose_create_ticket" not in names

    def test_create_ticket_confirm_does_not_emit_propose(self):
        out = self._map(
            [
                {
                    "type": "create_ticket",
                    "step": "confirm",
                    "customerName": "Jane Doe",
                    "customerEmail": "jane@acme.com",
                    "issue": "VPN down",
                }
            ]
        )
        names = [p["name"] for p in out["toolProposals"]]
        assert "propose_create_ticket" not in names
        assert "patch_ticket_draft" in names

    def test_create_ticket_done_refreshes(self):
        out = self._map(
            [
                {"type": "navigate", "view": "tickets-list"},
                {"type": "refresh_tickets"},
                {"type": "create_ticket", "done": True, "ticketNumber": "12504"},
            ]
        )
        assert out["uiRefresh"]["lists"] == ["tickets"]
        assert not any(p["name"] == "propose_create_ticket" for p in out["toolProposals"])

    def test_create_team_patch(self):
        out = self._map(
            [
                {"type": "navigate", "view": "agent-queues"},
                {
                    "type": "create_team",
                    "step": "description",
                    "name": "NLP",
                    "description": "Language models",
                },
            ],
            data={"workflow": "create_team", "team_draft": {"name": "NLP", "awaiting": "description"}},
        )
        names = [p["name"] for p in out["toolProposals"]]
        assert "patch_team_draft" in names
        assert out["patch"]["name"] == "NLP"

    def test_create_team_members_list_does_not_crash_envelope(self):
        out = self._map(
            [
                {"type": "navigate", "view": "agent-queues"},
                {
                    "type": "create_team",
                    "step": "members",
                    "name": "Cyber security team",
                    "description": "protects digital assets",
                    "members": ["Mohamed Fazil"],
                    "availableMembers": ["Mohamed Fazil", "raghu ram"],
                },
            ],
            data={
                "workflow": "create_team",
                "step": "create_members",
                "team_draft": {
                    "awaiting": "create_members",
                    "name": "Cyber security team",
                    "description": "protects digital assets",
                    "members": ["Mohamed Fazil"],
                    "available_members": ["Mohamed Fazil", "raghu ram"],
                },
            },
        )
        assert out["assistantText"] == "Let's continue."
        assert out["patch"]["name"] == "Cyber security team"
        assert out["patch"]["members"] == ["Mohamed Fazil"]

    def test_refresh_and_filters(self):
        out = self._map(
            [
                {"type": "navigate", "view": "assigned"},
                {"type": "set_filter", "module": "tickets", "query": "", "status": "Open"},
                {"type": "refresh_tickets"},
            ]
        )
        names = [p["name"] for p in out["toolProposals"]]
        assert "set_filter" in names
        assert "set_workspace" in names
        assert out["uiRefresh"]["lists"] == ["tickets"]

    def test_create_kb_macro_customer_priority(self):
        out = self._map(
            [
                {"type": "create_kb", "step": "title", "title": "VPN"},
                {"type": "create_macro", "step": "body", "title": "Hi", "body": "Hello"},
                {"type": "create_customer", "step": "contact", "name": "Ada"},
                {"type": "create_priority", "step": "hours", "displayName": "P1"},
            ]
        )
        names = {p["name"] for p in out["toolProposals"]}
        assert "patch_kb_draft" in names
        assert "patch_macro_draft" in names
        assert "patch_customer_draft" in names
        assert "patch_priority_draft" in names

    def test_escalate_and_delete_use_guided_semantic_confirmation(self):
        out = self._map(
            [
                {"type": "escalate", "ticket_number": "12504", "assignee": "Sam"},
                {"type": "delete_team", "name": "NLP"},
            ]
        )
        by_name = {p["name"]: p for p in out["toolProposals"]}
        assert "propose_escalate" not in by_name
        assert "patch_escalate_draft" in by_name
        assert "propose_delete_team" not in by_name

    def test_portal_strips_staff_workspace(self):
        out = self._map(
            [
                {"type": "navigate", "view": "create-ticket"},
                {"type": "create_ticket", "step": "issue", "issue": "VPN down"},
            ],
            channel_surface="portal",
            module="portal",
            page_surface="home",
        )
        names = [p["name"] for p in out["toolProposals"]]
        assert "set_workspace" not in names
        assert "navigate" not in names
        assert "patch_ticket_draft" in names

    def test_admin_analytics_no_create_workspace(self):
        out = self._map(
            [{"type": "navigate", "view": "analytics"}, {"type": "refresh_analytics"}],
            module="admin",
            page_surface="analytics",
        )
        ws = [p for p in out["toolProposals"] if p["name"] == "set_workspace"]
        assert ws
        assert ws[0]["args"]["surface"] == "list"
        assert out["uiRefresh"]["lists"] == ["analytics"]

    def test_agent_turn_module_does_not_import_proactive(self):
        import inspect

        import app.agent_turn as mod

        src = inspect.getsource(mod)
        assert "proactive" not in src
        assert "run_chat" in src


@pytest.mark.contract
class TestHarnessAgentContracts:
    def test_canonical_agent_manifests_load_with_frozen_counts(self):
        from app.runtime.supervisor import canonical_agent_definitions

        definitions = canonical_agent_definitions()
        counts = {
            layer: sum(1 for item in definitions.values() if item.layer == layer)
            for layer in ("super", "domain", "executor")
        }
        assert counts == {"super": 1, "domain": 5, "executor": 25}
        assert definitions["ticketing_super_agent"].skills == []
        assert definitions["ticketing_super_agent"].mcp_servers == []
        assert (
            definitions["intelligent_assignment_executor"].execution_mode
            == "llm"
        )

    def test_domains_have_no_business_mcp_servers(self):
        from app.runtime.supervisor import canonical_agent_definitions

        definitions = canonical_agent_definitions()
        for definition in definitions.values():
            if definition.layer in {"super", "domain"}:
                assert definition.mcp_servers == []
            if definition.layer == "executor":
                assert definition.skills

    def test_typed_harness_task_state_round_trip(self):
        from app.contracts.execution import (
            ConfirmationEvidence,
            DomainInstruction,
            TaskState,
        )

        instruction = DomainInstruction(
            executor_id="ticket_creation_executor",
            task_id="ticket.create.interactive",
            skill_name="ticket-create",
            objective="Create a ticket",
        )
        state = TaskState(
            task_id=instruction.task_id,
            domain="intake_deflection_domain",
            executor=instruction.executor_id,
            skill_name=instruction.skill_name,
            status="awaiting_confirmation",
            confirmation=ConfirmationEvidence(
                confirmation_id="c1",
                task_version="1.0.0",
                skill_version="1.0.0",
                argument_hash="abc",
            ),
        )
        assert TaskState.model_validate(state.model_dump()) == state

    def test_all_executor_skills_are_discoverable_and_lazy(self):
        from app.runtime.supervisor import canonical_agent_definitions
        from app.skills.catalog import discover_skills, load_skill_definition

        definitions = canonical_agent_definitions()
        skills = discover_skills()
        assert len(skills) == 76
        assert all(skill.body is None for skill in skills.values())
        for definition in definitions.values():
            if definition.layer != "executor":
                continue
            assert set(definition.skills) <= set(skills)
        loaded = load_skill_definition("ticket-create")
        assert loaded.body
        assert "# Procedure" in loaded.body
        assert skills["ticket-create"].body is None

    def test_skill_tool_scope_is_fail_closed_and_narrowing(self):
        from app.skills.catalog import tools_for_skill
        from app.tools.registry import tools_for_agent

        assert tools_for_skill("does-not-exist", "ticket_creation_executor") == frozenset()
        assert tools_for_skill("ticket-create", "ticket_lifecycle_executor") == frozenset()
        scoped = tools_for_skill("ticket-create", "ticket_creation_executor")
        assert scoped
        assert scoped < tools_for_agent("ticket_creation_executor")
        assert scoped == {
            "verify_ticket_customer",
            "enrich_ticket",
            "create_ticket",
            "portal_create_ticket",
            "list_customers",
            "list_kb",
            "create_customer",
        }

    def test_newly_registered_skills_are_skill_scoped(self):
        from app.skills.catalog import discover_skills, tools_for_skill

        skills = discover_skills()
        assert skills["automation-rule-create"].active is True
        assert (
            tools_for_skill(
                "automation-rule-create", "automation_rule_crud_executor"
            )
            == {"create_automation_rule"}
        )

    def test_task_registry_binds_domain_executor_and_skill(self):
        from app.workflow_schemas import (
            harness_task_definitions,
            new_harness_task_state,
            task_definition_for,
        )

        tasks = harness_task_definitions()
        assert len(tasks) == 76
        create = task_definition_for("ticket.create.interactive")
        assert create is not None
        assert create.domain == "intake_deflection_domain"
        assert create.executor == "ticket_creation_executor"
        assert create.skill_name == "ticket-create"
        assert create.required == ["customerName", "contact", "issue"]
        assert create.input_schema["required"] == [
            "customerName",
            "contact",
            "issue",
        ]
        assert "create_ticket" in create.tool_names
        state = new_harness_task_state(
            "ticket.create.interactive",
            channel="staff_chat",
            collected={"customerName": "Jane Doe"},
            provenance={"customerName": "user"},
        )
        assert state.missing_fields == ["contact", "issue"]
        assert state.skill_digest
        assert state.idempotency_key

    def test_harness_memory_keeps_typed_skill_confirmation_and_preferences(self):
        from app.contracts.execution import ConfirmationEvidence
        from app.memory.session import SharedMemory
        from app.workflow_schemas import new_harness_task_state

        memory = SharedMemory(
            organization_id="1",
            user_id="u1",
            session_id="s1",
        )
        state = new_harness_task_state("ticket.create")
        state = state.model_copy(
            update={
                "status": "awaiting_confirmation",
                "confirmation": ConfirmationEvidence(
                    confirmation_id="c1",
                    task_version=state.task_version,
                    skill_version=state.skill_version,
                    argument_hash="abc",
                    requested_request_id="r1",
                ),
                "dependency_results": {"customer-verify": {"exists": True}},
            }
        )
        memory.set_task_state(state)
        memory.set_preference_memory(
            soft={"response_length": "brief"},
            hard={"channel_bans": ["sms"]},
        )
        restored = memory.current_task_state()
        assert restored == state
        prompt_context = memory.harness_prompt_context()
        assert prompt_context["working"]["skill_name"] == "ticket-create"
        assert prompt_context["preferences"]["soft"]["response_length"] == "brief"
        assert prompt_context["preferences"]["hard_constraints"]["channel_bans"] == [
            "sms"
        ]

    def test_unsupported_delete_tasks_are_absent(self):
        from app.workflow_schemas import task_definition_for

        assert task_definition_for("ticket.delete") is None
        assert task_definition_for("customer.delete") is None
        assert task_definition_for("knowledge.article.delete") is None

    def test_registered_mcp_parity_for_new_catalog_capabilities(self):
        from app.mcp.catalog import catalog_by_name
        from app.skills.catalog import discover_skills
        from app.tools.bound import native_tools_for_agent

        expected = {
            "update_widget",
            "create_integration_key",
            "revoke_integration_key",
            "clear_notifications",
            "list_automation_rules",
            "create_automation_rule",
            "update_automation_rule",
            "delete_automation_rule",
        }
        catalog = catalog_by_name()
        assert expected <= set(catalog)
        bound = {
            tool.name
            for executor in (
                "org_settings_integrations_executor",
                "notification_inbox_executor",
                "automation_rule_crud_executor",
            )
            for tool in native_tools_for_agent(executor)
        }
        assert expected <= bound
        skills = discover_skills()
        for skill_name in (
            "integration-widget-update",
            "integration-key-create",
            "integration-key-revoke",
            "notification-clear",
            "automation-rule-read",
            "automation-rule-create",
            "automation-rule-update",
            "automation-rule-delete",
        ):
            assert skills[skill_name].active

    def test_every_registered_tool_has_skill_or_local_control_coverage(self):
        import json
        from pathlib import Path

        from app.skills.catalog import discover_skills
        from app.tools.bound import registered_bound_tool_names
        from app.tools.registry import TOOL_META

        skills = discover_skills()
        covered = {
            tool
            for skill in skills.values()
            for tool in [*skill.allowed_tools, *skill.local_controls]
        }
        assert set(TOOL_META) == covered
        local_controls = {
            control for skill in skills.values() for control in skill.local_controls
        }
        shared_path = Path(__file__).parents[2] / "shared" / "ticketing_tool_catalog.json"
        shared_tools = {
            row["name"]
            for row in json.loads(shared_path.read_text())["tools"]
        }
        assert set(TOOL_META) - local_controls == shared_tools
        business_tools = {
            tool
            for skill in skills.values()
            if skill.active
            for tool in skill.allowed_tools
        }
        assert business_tools <= registered_bound_tool_names()

    def test_executor_manifests_use_canonical_local_controls(self):
        from app.prompts.builder import load_agent_definitions

        executors = [
            definition
            for definition in load_agent_definitions().values()
            if definition.layer == "executor"
        ]
        assert len(executors) == 25
        assert all("return_to_super" in item.local_controls for item in executors)
        assert all("patch_draft" not in item.local_controls for item in executors)
