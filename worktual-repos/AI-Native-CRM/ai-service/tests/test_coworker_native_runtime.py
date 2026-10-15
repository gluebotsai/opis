from __future__ import annotations

from app.agents.coworker_native import (
    DOMAIN_AGENTS,
    _domain_for,
    build_native_registry,
    native_enabled_for,
)
from app.api.routes import CrmAgentRequest
from app.config import get_settings


def test_repair_instruction_stays_on_the_opening_system_message():
    from app.agents.coworker_native import _with_leading_system

    out = _with_leading_system(
        [
            {"role": "system", "content": "You are the contact specialist."},
            {"role": "user", "content": "make this more friendly"},
        ],
        "Call compose_customer_email, then propose_save_email_draft.",
    )
    assert [m["role"] for m in out] == ["system", "user"]
    assert out[0]["content"].startswith("You are the contact specialist.")
    assert "propose_save_email_draft" in out[0]["content"]


def test_to_argument_keeps_only_real_addresses():
    from app.mcp.dispatch import email_address_list

    assert email_address_list(
        ["a.antonydavidselvam@worktual.com", "in to address add yaswanth345@gmail.com"]
    ) == ["a.antonydavidselvam@worktual.com", "yaswanth345@gmail.com"]
    assert email_address_list("in to address add yaswanth345@gmail.com") == [
        "yaswanth345@gmail.com"
    ]
    from app.agents.coworker_native import ensure_email_draft_save_proposal

    proposals: list[dict] = []
    ensure_email_draft_save_proposal(
        proposals,
        [
            {
                "name": "compose_customer_email",
                "result": {
                    "ok": True,
                    "data": {
                        "subject": "A warmer note",
                        "body": "Hi Ashi, sorry about the delay.",
                        "to": "a@worktual.com, b@worktual.com",
                        "contactId": "c1",
                    },
                },
            }
        ],
        {"draftId": "draft-1", "to": "a@worktual.com", "subject": "Apology"},
    )
    assert proposals[0]["name"] == "propose_save_email_draft"
    assert proposals[0]["args"]["draftId"] == "draft-1"
    assert proposals[0]["args"]["subject"] == "A warmer note"
    assert proposals[0]["args"]["to"] == ["a@worktual.com", "b@worktual.com"]
    ensure_email_draft_save_proposal(proposals, [], {"draftId": "draft-1"})
    assert len(proposals) == 1


def test_email_repair_asks_the_model_to_choose_the_tool():
    from app.agents.coworker_native import open_email_tool_instruction

    text = open_email_tool_instruction(
        {
            "draftId": "draft-1",
            "to": "a.antonydavidselvam@worktual.com, yaswanth345@gmail.com",
            "subject": "Feedback on Worktual",
            "body": "Hi Ashi, the original note.",
            "contactId": "c1",
        }
    )
    assert "Feedback on Worktual" in text
    assert "Hi Ashi, the original note." in text
    assert "propose_send_email" in text
    assert "currentSubject" in text
    assert "currentBody" in text
    assert "propose_save_email_draft" in text


def test_one_send_per_turn():
    from app.agents.coworker_native import keep_one_email_send

    proposals = [
        {"name": "propose_send_email", "args": {"subject": "Feedback"}},
        {"name": "propose_send_email", "args": {"subject": "Feedback"}},
        {"name": "propose_save_email_draft", "args": {"subject": "Other"}},
    ]
    keep_one_email_send(proposals)
    assert [item["name"] for item in proposals] == [
        "propose_send_email",
        "propose_save_email_draft",
    ]


def test_clarification_discards_pending_action_proposals():
    from app.agents.coworker_native import discard_proposals_when_clarifying

    proposals = [
        {
            "name": "propose_update_contact",
            "args": {"contactId": "c1", "leadSource": "email", "auto": True},
        },
        {"name": "navigate", "args": {"href": "/contact"}},
    ]
    discard_proposals_when_clarifying(
        proposals,
        [
            {
                "name": "ask_clarification",
                "result": {
                    "ok": True,
                    "kind": "clarify",
                    "assistantText": "What source should I use?",
                },
            }
        ],
    )
    assert proposals == []


def test_failed_clarification_does_not_discard_actions():
    from app.agents.coworker_native import discard_proposals_when_clarifying

    proposals = [{"name": "propose_update_contact", "args": {"contactId": "c1"}}]
    discard_proposals_when_clarifying(
        proposals,
        [
            {
                "name": "ask_clarification",
                "result": {"ok": False, "kind": "error"},
            }
        ],
    )
    assert [item["name"] for item in proposals] == ["propose_update_contact"]


def test_prompt_keeps_client_email_draft_when_working_memory_omits_it():
    from app.agents.coworker_native import session_memory_for_prompt

    merged = session_memory_for_prompt(
        {
            "sessionMemory": {
                "slots": {
                    "emailDraft": {
                        "draftId": "draft-1",
                        "subject": "Apology",
                        "body": "Hello",
                        "to": "a@worktual.com",
                        "status": "draft",
                    }
                }
            }
        },
        {"activeAgent": "contact-agent", "slots": {}},
    )
    assert merged["slots"]["emailDraft"]["draftId"] == "draft-1"
    assert merged["activeAgent"] == "contact-agent"


def test_reports_handoff_reads_flat_authoritative_memory():
    from app.agents.coworker_native import reports_context_for_handoff

    browser = {
        "slots": {
            "reportsContext": {
                "objectLock": "contacts",
                "timePhrase": "last month",
            }
        }
    }
    redis_memory = {
        "slots": {
            "reportsContext": {
                "objectLock": "deals",
                "timePhrase": "this month",
                "lastKpiId": "total_pipeline",
            }
        }
    }
    assert reports_context_for_handoff(redis_memory, browser) == {
        "objectLock": "deals",
        "timePhrase": "this month",
        "lastKpiId": "total_pipeline",
    }


def test_reports_mcp_handoff_preserves_signed_page_scope():
    from app.agents.coworker_native import mcp_scope_for_handoff

    assert mcp_scope_for_handoff(
        {"module": "dashboard", "surface": "list"},
        fallback_module="reports",
        fallback_surface="detail",
    ) == ("dashboard", "list")
    assert mcp_scope_for_handoff(
        {"module": "sales", "surface": "detail"},
        fallback_module="reports",
        fallback_surface="list",
    ) == ("sales", "detail")


def test_all_required_domain_specialists_are_registered():
    registry = build_native_registry({"module": "contact", "surface": "list"})
    names = {spec.name for spec in registry.specs()}
    assert names == set(DOMAIN_AGENTS.values())
    assert {
        "contact-agent",
        "company-agent",
        "deal-agent",
        "proposal-agent",
        "product-agent",
        "link-agent",
        "reports-analytics-agent",
        "seo-content-generator",
    } <= names


def test_company_create_tools_include_draft_patch():
    from app.agents.coworker_native import _allowed_tools

    names = set(_allowed_tools("company"))
    assert "patch_company_draft" in names
    assert "propose_create_company" in names


def test_marketing_tools_include_seo():
    from app.agents.coworker_native import _allowed_tools

    names = set(_allowed_tools("marketing"))
    assert "seo_list_projects" in names
    assert "seo_get_snapshots" in names
    assert "seo_save_generated_content" in names
    assert "seo_research_keywords" in names
    assert "seo_report_progress" in names


def test_seo_package_saved_requires_successful_save():
    from app.agents.coworker_native import _seo_terminal_ok
    from app.orchestrator.tool_loop import ToolLoopResult

    empty = ToolLoopResult(
        content="saved", messages=(), rounds=1, calls=0, tool_results=()
    )
    assert _seo_terminal_ok(empty) is False
    failed = ToolLoopResult(
        content="",
        messages=(),
        rounds=1,
        calls=1,
        tool_results=(
            {
                "name": "seo_save_generated_content",
                "result": {"ok": False, "error": "body.blog.markdown is required"},
            },
        ),
    )
    assert _seo_terminal_ok(failed) is False
    ok = ToolLoopResult(
        content="",
        messages=(),
        rounds=1,
        calls=1,
        tool_results=(
            {"name": "seo_save_generated_content", "result": {"ok": True}},
        ),
    )
    assert _seo_terminal_ok(ok) is True
    researched = ToolLoopResult(
        content="",
        messages=(),
        rounds=1,
        calls=1,
        tool_results=(
            {"name": "seo_research_keywords", "result": {"ok": True}},
        ),
    )
    assert _seo_terminal_ok(researched) is True


def test_seo_save_nudge_skips_short_social_apology():
    from app.agents.coworker_native import _should_nudge_seo_save
    from app.orchestrator.tool_loop import ToolLoopResult

    apology = ToolLoopResult(
        content=(
            "I'm sorry, I'm having a bit of trouble accessing the keyword "
            "research tool right now."
        ),
        messages=(),
        rounds=1,
        calls=0,
        tool_results=(),
    )
    assert _should_nudge_seo_save(apology) is False
    drafted = ToolLoopResult(
        content=("A modern CRM " + "helps enterprise sales teams. " * 40),
        messages=(),
        rounds=1,
        calls=0,
        tool_results=(),
    )
    assert len(drafted.content) >= 400
    assert _should_nudge_seo_save(drafted) is True
    saved = ToolLoopResult(
        content=drafted.content,
        messages=(),
        rounds=1,
        calls=1,
        tool_results=(
            {"name": "seo_save_generated_content", "result": {"ok": True}},
        ),
    )
    assert _should_nudge_seo_save(saved) is False


def test_content_generator_prompt_saves_in_one_round():
    from pathlib import Path

    text = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "agents"
        / "seo-content-generator"
        / "agent.md"
    ).read_text(encoding="utf-8")
    assert "seo_research_keywords" in text
    assert "seo_repurpose_social" in text
    assert "contentId" in text
    assert "Never invent" in text or "never invent" in text


def test_content_generator_tools_exclude_semrush():
    from app.agents.coworker_native import CONTENT_GENERATOR_TOOLS, _allowed_tools

    names = set(
        _allowed_tools("marketing", agent_name="seo-content-generator")
    )
    assert "seo_save_generated_content" in names
    assert "seo_research_keywords" in names
    assert "seo_repurpose_social" in names
    assert "seo_publish_post" in names
    assert "seo_report_progress" in names
    assert "seo_list_generated_content" in names
    assert "remember_memory" in names
    assert "seo_list_projects" not in names
    assert "seo_get_snapshots" not in names
    assert "seo_request_ad_hoc_sync" not in names
    assert names <= CONTENT_GENERATOR_TOOLS


def test_domain_changes_are_derived_from_surface_not_mutable_global_state():
    assert _domain_for({"module": "contact"}, {}) == "contact"
    assert _domain_for({"module": "reports"}, {}) == "reports"
    assert (
        _domain_for(
            {"module": "marketing", "pathname": "/marketing/seo"},
            {},
        )
        == "content"
    )
    assert (
        _domain_for(
            {"module": "marketing", "contentAgent": True},
            {},
        )
        == "content"
    )
    assert (
        _domain_for(
            {"module": "sales", "pathname": "/sales/proposals/p1"},
            {"openProposal": {"id": "p1"}},
        )
        == "proposal"
    )
    assert _domain_for({"module": "dashboard"}, {}) == "link"
    assert (
        _domain_for(
            {
                "module": "sales",
                "pathname": "/sales/deals/d1",
                "requirementPdfAttached": {"name": "MED Bites BRD.pdf"},
            },
            {},
        )
        == "sales"
    )
    assert (
        _domain_for(
            {"module": "contact", "userText": "show me the lead by status"},
            {},
        )
        == "contact"
    )
    assert (
        _domain_for(
            {"module": "dashboard", "userText": "What's our win rate this month?"},
            {},
        )
        == "link"
    )
    from app.agents.coworker_native import _eligible_specialist_names, DOMAIN_AGENTS

    contact_eligible = _eligible_specialist_names("contact")
    assert DOMAIN_AGENTS["reports"] in contact_eligible
    assert DOMAIN_AGENTS["contact"] in contact_eligible
    assert DOMAIN_AGENTS["link"] in contact_eligible
    assert _eligible_specialist_names("content") == {DOMAIN_AGENTS["content"]}
    dash_eligible = _eligible_specialist_names("link")
    assert DOMAIN_AGENTS["reports"] in dash_eligible
    assert DOMAIN_AGENTS["link"] in dash_eligible


def test_native_rollout_defaults_legacy_and_requires_allowlist(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "coworker_native_enabled", False)
    monkeypatch.setattr(settings, "coworker_native_allowlist", "*")
    assert native_enabled_for("org-1", "user-1", "native") is False

    monkeypatch.setattr(settings, "coworker_native_enabled", True)
    monkeypatch.setattr(settings, "coworker_native_allowlist", "org-2,org-1:user-2")
    assert native_enabled_for("org-1", "user-1", "native") is False
    assert native_enabled_for("org-2", "user-1", "native") is True
    assert native_enabled_for("org-1", "user-2", "native") is True
    assert native_enabled_for("org-2", "user-1", "legacy") is False


def test_proposal_heuristic_covers_informal_date_swap():
    from app.agents.coworker_native import _proposal_heuristic_hit

    hit = _proposal_heuristic_hit(
        page_context={
            "entityId": "prop1",
            "pathname": "/sales/proposals/prop1",
        },
        catalog={"openProposal": {"id": "prop1", "dealId": "deal1"}},
        messages=[{"role": "user", "text": "11 September 2026 change this to 17 nov"}],
        user_text="11 September 2026 change this to 17 nov",
    )
    assert hit is not None
    props = hit.get("toolProposals") or []
    patch = next(
        p for p in props if p.get("name") == "propose_patch_proposal_document_text"
    )
    rows = patch["args"]["textReplacements"]
    assert rows[0]["find"] == "11 September 2026"
    assert rows[0]["replace"] == "17 November 2026"


def test_crm_agent_request_keeps_legacy_fields_and_accepts_opt_in_mode():
    request = CrmAgentRequest.model_validate(
        {
            "intent": "agent_turn",
            "messages": [{"role": "user", "text": "pipeline by stage"}],
            "context": {"module": "reports", "surface": "list"},
            "sessionMemory": {"conversationId": "conv-1"},
            "organizationId": "org-1",
            "actingUserId": "user-1",
            "role": "sales_manager",
            "businessType": "b2b",
            "executionMode": "native",
        }
    )
    assert request.executionMode == "native"
    assert request.sessionMemory == {"conversationId": "conv-1"}
