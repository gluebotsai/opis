"""Jun30 reply path: LLM content is the user reply (no post-hoc pick/remint)."""

from __future__ import annotations

import inspect
import unittest

from app.agents.create_campaign import agent as create_agent
from app.agents.create_campaign.memory_note import (
    append_memory_note,
    note_from_templates,
)
from app.llm import LLM_UNAVAILABLE_REPLY


class CreateCampaignReplyTests(unittest.TestCase):
    def test_coordinator_doc_is_jun30_loop(self):
        doc = create_agent.run_coordinator.__doc__ or ""
        self.assertIn("tool_calls", doc)
        self.assertIn("user", doc.lower())

    def test_no_pick_final_reply_helper(self):
        self.assertFalse(hasattr(create_agent, "_pick_final_reply"))
        src = inspect.getsource(create_agent)
        self.assertNotIn("_pick_final_reply", src)


class TemplatesMemoryNoteTests(unittest.TestCase):
    def test_note_lists_selected_channels(self):
        self.assertEqual(
            note_from_templates(["email", "web", "push", "email"]),
            "Templates generated for email, web, push.",
        )

    def test_append_then_keep_fact_when_recap_fails(self):
        session = {
            "session_id": "s1",
            "llm_memory": [
                {"role": "user", "content": "go"},
                {"role": "assistant", "content": LLM_UNAVAILABLE_REPLY},
            ],
            "_templates_generated_note": note_from_templates(["email", "web"]),
        }
        append_memory_note(session, note_from_templates(["email", "web"]))
        create_agent._keep_templates_fact_in_llm_memory(
            session, LLM_UNAVAILABLE_REPLY
        )
        self.assertIn(
            "Templates generated for email, web.",
            session.get("chat_memory_note") or "",
        )
        self.assertEqual(
            session["llm_memory"][-1]["content"],
            "Templates generated for email, web.",
        )
        self.assertNotIn("_templates_generated_note", session)

    def test_successful_recap_only_drops_flag(self):
        session = {
            "llm_memory": [
                {"role": "assistant", "content": "<p>Templates are ready.</p>"},
            ],
            "_templates_generated_note": "Templates generated for email.",
        }
        create_agent._keep_templates_fact_in_llm_memory(
            session, "<p>Templates are ready.</p>"
        )
        self.assertEqual(
            session["llm_memory"][-1]["content"],
            "<p>Templates are ready.</p>",
        )
        self.assertNotIn("_templates_generated_note", session)


if __name__ == "__main__":
    unittest.main()
