"""
Layer 2 — Auth boundary (most important integration-style unit).

Graph/policy may allow routing to a mutate tool; Express RBAC still rejects.
Proves tools surface FORBIDDEN and never invent success.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from app.contracts import tool_err, tool_ok
from app.tools.catalog_tools import create_queue, delete_queue, update_queue
from app.tools.express_client import ToolActor, tool_actor_scope
from app.tools.ticket_read import list_tickets
from app.tools.ticket_write import create_ticket, escalate_ticket


@pytest.mark.auth_boundary
class TestAuthBoundaryExpressRejects:
    def test_delete_queue_forbidden_surfaces(self):
        actor = ToolActor(
            user_id="viewer-1",
            organization_id="org-1",
            user_role="viewer",
        )
        with tool_actor_scope(actor), patch(
            "app.tools.catalog_tools.express_request",
            return_value=tool_err(
                "FORBIDDEN", "Only admins can delete queues", http_status=403
            ),
        ) as mock_req:
            out = delete_queue("1901")
        assert out["success"] is False
        assert out["error_code"] == "FORBIDDEN"
        assert out.get("http_status") == 403
        mock_req.assert_called_once()

    def test_create_queue_forbidden_for_resolver(self):
        actor = ToolActor(
            user_id="r1",
            organization_id="org-1",
            user_role="resolver",
        )
        with tool_actor_scope(actor), patch(
            "app.tools.catalog_tools.express_request",
            return_value=tool_err("FORBIDDEN", "Admins only", http_status=403),
        ):
            out = create_queue(name="shadow-team")
        assert out["success"] is False
        assert out["error_code"] == "FORBIDDEN"

    def test_update_queue_members_forbidden(self):
        with patch(
            "app.tools.catalog_tools.express_request",
            return_value=tool_err("FORBIDDEN", "nope", http_status=403),
        ):
            out = update_queue("1901", members=["Deva"], add_members=True)
        assert out["success"] is False
        assert out["error_code"] == "FORBIDDEN"

    def test_escalate_forbidden_does_not_fake_success(self):
        with patch(
            "app.tools.ticket_write.express_request",
            return_value=tool_err(
                "FORBIDDEN", "You can reassign only to agents or resolvers.", http_status=403
            ),
        ):
            out = escalate_ticket(
                "12935",
                assignee_id="resolver-1",
                assignee="Resolver",
            )
        assert out["success"] is False
        assert out["error_code"] == "FORBIDDEN"
        assert out["success"] is False

    def test_create_ticket_forbidden_for_viewer(self):
        with patch(
            "app.tools.ticket_write.express_request",
            return_value=tool_err("FORBIDDEN", "cannot create", http_status=403),
        ):
            out = create_ticket(
                {"subject": "x", "description": "y", "customerName": "Z"}
            )
        assert out["success"] is False
        assert out["error_code"] == "FORBIDDEN"

    def test_list_ticket_express_scope_rejection_is_not_masked(self):
        actor = ToolActor(
            user_id="customer-1",
            organization_id="org-1",
            user_role="customer",
        )
        with tool_actor_scope(actor), patch(
            "app.tools.ticket_read.express_request",
            return_value=tool_err(
                "FORBIDDEN", "Requested ticket scope is not allowed", http_status=403
            ),
        ) as request:
            out = list_tickets(created_by="SELF", limit=25)
        request.assert_called_once()
        assert out["success"] is False
        assert out["error_code"] == "FORBIDDEN"
        assert out["http_status"] == 403

    def test_success_path_still_works_when_express_allows(self):
        with patch(
            "app.tools.catalog_tools.express_request",
            return_value=tool_ok({"id": "q9", "queueName": "ok"}),
        ):
            out = create_queue(name="ok")
        assert out["success"] is True
        assert out["payload"]["id"] == "q9"

    def test_langgraph_layer_rejects_viewer_create_proposal(self):
        from app.tools.registry import authorize_tool

        with pytest.raises(PermissionError):
            authorize_tool(
                agent="tickets",
                tool_name="create_ticket",
                operation="CREATE_TICKET",
                role="viewer",
                workflow="create_ticket",
            )

    def test_langgraph_layer_allows_list_but_express_still_decides_scope(self):
        from app.tools.registry import authorize_tool

        authorize_tool(
            agent="tickets",
            tool_name="list_tickets",
            operation="LIST_TICKETS",
            role="resolver",
            workflow=None,
        )


@pytest.mark.auth_boundary
class TestCatalogHandlerSurfacesForbidden:
    """Add-members path must keep draft and not invent success on FORBIDDEN."""

    def test_add_members_forbidden_keeps_draft(self):
        from app.tasks.catalog_commands import _apply_add_team_members

        with patch("app.tasks.catalog_commands._phrase", return_value="Could not add members"), patch(
            "app.tools.catalog_tools.update_queue",
            return_value=tool_err("FORBIDDEN", "Admins only", http_status=403),
        ):
            out = _apply_add_team_members(
                ["Deva"],
                org="org-1",
                role="admin",
                user_id="u1",
                user_name="A",
                page="Teams",
                user_text="Deva",
                team_name="nlp",
                qid="q1",
            )
        assert out["handled"] is True
        assert out.get("team_draft", {}).get("awaiting") == "members_names"
        actions = out.get("actions") or []
        assert not any(a.get("done") for a in actions if isinstance(a, dict))
        assert "Could not" in (out.get("reply") or "")


@pytest.mark.auth_boundary
class TestSpecialistToolValidation:
    def test_confirm_required_blocks_delete_without_armed_draft(self):
        from app.tools.registry import validate_specialist_tool

        blocked = validate_specialist_tool(
            agent="teams",
            tool_name="delete_queue",
            operation="DELETE_TEAM",
            role="admin",
            action="NORMAL_ROUTE",
        )
        assert blocked["success"] is False
        assert blocked["error_code"] == "CONFIRMATION_REQUIRED"

        still_blocked = validate_specialist_tool(
            agent="teams",
            tool_name="delete_queue",
            operation="DELETE_TEAM",
            role="admin",
            action="CONFIRM_WORKFLOW",
        )
        assert still_blocked["success"] is False
        assert still_blocked["error_code"] == "CONFIRMATION_REQUIRED"

    def test_wrong_specialist_returns_structured_error(self):
        from app.tools.registry import validate_specialist_tool

        out = validate_specialist_tool(
            agent="kb",
            tool_name="delete_queue",
            action="CONFIRM_WORKFLOW",
            role="admin",
        )
        assert out["success"] is False
        assert out["error_code"] == "TOOL_NOT_ALLOWED"

    def test_list_tool_does_not_require_confirm(self):
        from app.tools.registry import validate_specialist_tool

        out = validate_specialist_tool(
            agent="kb",
            tool_name="list_kb",
            operation="LIST_KB",
            role="agent",
            action="NORMAL_ROUTE",
        )
        assert out["success"] is True

    def test_unknown_tool_returns_structured_error(self):
        from app.tools.registry import validate_specialist_tool

        out = validate_specialist_tool(
            agent="tickets",
            tool_name="drop_all_tables",
            action="CONFIRM_WORKFLOW",
            role="admin",
        )
        assert out["success"] is False
        assert out["error_code"] == "TOOL_NOT_REGISTERED"

    def test_create_tools_blocked_until_confirm_step(self):
        from app.tools.registry import validate_specialist_tool

        for agent, tool, operation in (
            ("tickets", "create_ticket", "CREATE_TICKET"),
            ("kb", "create_kb_article", "CREATE_KB"),
            ("macros", "delete_macro", "DELETE_MACRO"),
        ):
            blocked = validate_specialist_tool(
                agent=agent,
                tool_name=tool,
                operation=operation,
                role="admin",
                action="NORMAL_ROUTE",
            )
            assert blocked["success"] is False, tool
            assert blocked["error_code"] == "CONFIRMATION_REQUIRED"

    def test_write_blocked_while_collecting_issue(self):
        from app.tools.registry import validate_specialist_tool

        blocked = validate_specialist_tool(
            agent="tickets",
            tool_name="create_ticket",
            operation="CREATE_TICKET",
            role="admin",
            action="CONTINUE_WORKFLOW",
            draft={
                "awaiting": "issue",
                "customerName": "Ada",
                "customerEmail": "ada@example.com",
            },
            draft_key="ticket_draft",
        )
        assert blocked["success"] is False
        assert blocked["error_code"] == "CONFIRMATION_REQUIRED"

    def test_write_allowed_when_awaiting_confirm_without_confirm_action(self):
        from app.tools.registry import validate_specialist_tool

        ok = validate_specialist_tool(
            agent="tickets",
            tool_name="create_ticket",
            operation="CREATE_TICKET",
            role="admin",
            action="CONTINUE_WORKFLOW",
            draft={
                "awaiting": "confirm",
                "customerName": "Ada",
                "customerEmail": "ada@example.com",
                "issue": "VPN will not connect",
                "subject": "VPN will not connect",
            },
            draft_key="ticket_draft",
        )
        assert ok["success"] is True

    def test_pending_delete_satisfies_confirm_gate(self):
        from app.tools.registry import validate_specialist_tool

        out = validate_specialist_tool(
            agent="teams",
            tool_name="delete_queue",
            operation="DELETE_TEAM",
            role="admin",
            action="NORMAL_ROUTE",
            last_query={"pending_delete": {"id": "q1"}},
        )
        assert out["success"] is True
