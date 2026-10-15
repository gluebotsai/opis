"""Turn audit — one readable TURN block per chat."""

from __future__ import annotations

import logging
import unittest
from unittest.mock import patch

from app.mas.runtime.turn_audit_log import (
    AUDIT_MODULES,
    is_audited_module,
    log_turn_socket_error,
    run_with_turn_audit,
    turn_audit_scope,
    turn_audit_stage,
    turn_audit_tool_result,
)


class TurnAuditLogTests(unittest.IsolatedAsyncioTestCase):
    def test_audit_modules(self) -> None:
        self.assertEqual(
            AUDIT_MODULES,
            frozenset(
                {
                    "contacts",
                    "reports",
                    "create_campaign",
                    "template_edit",
                    "template_create",
                }
            ),
        )
        self.assertTrue(is_audited_module("create_campaign"))
        self.assertTrue(is_audited_module("template_edit"))
        self.assertFalse(is_audited_module("monitoring"))

    async def test_run_with_turn_audit_emits_request_and_response(self) -> None:
        records: list[str] = []

        def capture(msg: str, *args: object) -> None:
            if args:
                records.append(msg % args if "%" in msg else f"{msg} {args[0]}")
            else:
                records.append(msg)

        with patch.object(
            logging.getLogger("app.mas.runtime.turn_audit"),
            "info",
            side_effect=capture,
        ):

            async def runner() -> dict:
                turn_audit_tool_result(
                    tool_name="set_channels",
                    ok=True,
                    message="email",
                    duration_s=0.01,
                )
                return {"reply": "<p>Hello</p>", "used_tools": True, "mas": False}

            out = await run_with_turn_audit(
                module="create_campaign",
                session_id="sess-abc",
                user_text="launch email",
                chat_context="create",
                runner=runner,
            )
        self.assertEqual(out["reply"], "<p>Hello</p>")
        joined = "\n".join(records)
        self.assertIn("TURN  session=sess-abc", joined)
        self.assertIn("ASK", joined)
        self.assertIn("launch email", joined)
        self.assertIn("TOOLS", joined)
        self.assertIn("set_channels", joined)
        self.assertIn("CHAT TO USER", joined)
        self.assertIn("Hello", joined)
        self.assertIn("END TURN", joined)

    async def test_template_edit_audit_includes_skill_and_stage(self) -> None:
        records: list[str] = []

        def capture(msg: str, *args: object) -> None:
            if args:
                records.append(msg % args if "%" in msg else f"{msg} {args[0]}")
            else:
                records.append(msg)

        with patch.object(
            logging.getLogger("app.mas.runtime.turn_audit"),
            "info",
            side_effect=capture,
        ):

            async def runner() -> dict:
                turn_audit_stage("edit_skill_pick", mode="modify", skill_id="edit_copy")
                return {
                    "reply": "Updated subject.",
                    "used_tools": True,
                    "skill_id": "edit_copy",
                    "intent": "modify",
                }

            await run_with_turn_audit(
                module="template_edit",
                session_id="sess-edit",
                user_text="change subject",
                chat_context="edit",
                template_id="tpl-1",
                channel="email",
                runner=runner,
            )
        joined = "\n".join(records)
        self.assertIn("template_edit", joined)
        self.assertIn("edit_skill_pick", joined)
        self.assertIn("edit_copy", joined)
        self.assertIn("tpl-1", joined)
        self.assertIn("ASK", joined)
        self.assertIn("change subject", joined)
        self.assertIn("Updated subject.", joined)

    def test_stage_emits_without_active_scope(self) -> None:
        records: list[str] = []

        def capture(msg: str, *args: object) -> None:
            if args:
                records.append(msg % args if "%" in msg else f"{msg} {args[0]}")
            else:
                records.append(msg)

        with patch.object(
            logging.getLogger("app.mas.runtime.turn_audit"),
            "info",
            side_effect=capture,
        ):
            turn_audit_stage(
                "create_channel_failed",
                channel="email",
                error="boom",
                session_id="s-loose",
            )
        self.assertTrue(records)
        line = records[0]
        self.assertIn("TURN", line)
        self.assertIn("session=s-loose", line)
        self.assertIn("step=create_channel_failed", line)
        self.assertIn("error=boom", line)

    async def test_non_audited_module_passthrough(self) -> None:
        async def runner() -> dict:
            return {"reply": "x"}

        with turn_audit_scope(
            session_id="s1", module="monitoring", user_text="hi"
        ):
            out = await run_with_turn_audit(
                module="monitoring",
                session_id="s1",
                user_text="hi",
                chat_context="create",
                runner=runner,
            )
        self.assertEqual(out["reply"], "x")

    def test_socket_error_log(self) -> None:
        records: list[str] = []

        def capture(msg: str, *args: object) -> None:
            if args:
                records.append(msg % args if "%" in msg else f"{msg} {args[0]}")
            else:
                records.append(msg)

        with patch.object(
            logging.getLogger("app.mas.runtime.turn_audit"),
            "info",
            side_effect=capture,
        ):
            log_turn_socket_error(
                session_id="sess-1",
                module="template_edit",
                error="boom",
                chat_context="edit",
                template_id="t1",
            )
        self.assertTrue(records)
        joined = "\n".join(records)
        self.assertIn("TURN  session=sess-1", joined)
        self.assertIn("template_edit", joined)
        self.assertIn("t1", joined)
        self.assertIn("ERROR: boom", joined)


if __name__ == "__main__":
    unittest.main()
