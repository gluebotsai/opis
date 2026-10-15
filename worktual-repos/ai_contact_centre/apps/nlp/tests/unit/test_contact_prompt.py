"""Contact-agent prompt and surface-rule regression tests."""

from app.agents.prompt_loader import load_agent_document
from app.prompts.contact import CONTACT_AGENT_PROMPT
from app.prompts.coworker import build_coworker_system_prompt, build_surface_rules
from app.skills.registry import get_skill_registry


def normalized(text: str) -> str:
    return " ".join(text.split())


def test_contact_prompt_loads_one_skill_and_does_not_claim_save() -> None:
    prompt = normalized(CONTACT_AGENT_PROMPT)
    assert "Load exactly one allowed skill once" in prompt
    assert "Staging is not a save" in prompt
    assert "Never claim a contact was created or updated" in prompt


def test_contact_create_skill_preserves_draft_state_and_prevents_repeat_questions() -> None:
    skill = get_skill_registry().get_skill("contact-create")
    assert skill is not None
    body = normalized(str(skill.get("body") or ""))
    rules = normalized(" ".join(str(item) for item in skill.get("rules") or []))
    workflow = normalized(" ".join(str(item) for item in skill.get("workflow") or []))
    combined = f"{body} {rules} {workflow}"
    assert "skippedFields" in combined
    assert "Never discard earlier values" in combined or "never restart from empty" in combined.casefold()
    assert "name@domain.tld" in combined
    assert "7-15 digits" in combined or "7 to 15 digits" in combined
    assert "create_contact" in combined
    assert "city" in combined.casefold()
    assert "country" in combined.casefold()
    assert "internal agent" in combined.casefold()
    assert "nextfield=null until country" in combined.casefold() or (
        "nextfield=null" in combined.casefold() and "country is answered or skipped" in combined.casefold()
    )


def test_contact_agent_md_does_not_require_identity_every_turn() -> None:
    document = load_agent_document("contact", fallback_prompt="")
    assert "contact-create" in document.allowed_skills
    assert "contact-identity-resolution" in document.allowed_skills
    assert "contact-identity-resolution" not in document.required_skills


def test_contacts_list_surface_advances_from_latest_draft() -> None:
    rules = normalized(build_surface_rules("contacts-list"))
    assert "latest staged draft" in rules
    assert "ask city, then country" in rules
    assert "Never ask again for a field already collected or skipped" in rules
    assert "sameNameMatches" in rules
    assert "Sanju Ravi" in rules
    assert "call get_contact so the right panel" in rules


def test_contacts_detail_surface_does_not_run_create_collection() -> None:
    rules = normalized(build_surface_rules("contacts-detail"))
    assert "change only fields explicitly requested" in rules
    assert "do not re-ask for existing profile values" in rules
    assert "call update_contact in the same turn" in rules
    assert "Staging is not a save" in rules
    assert "not your identity" in rules
    assert "earlier turn is history" in rules
    assert "nextField=null" in rules
    assert "Do not set nextField to a value they already gave" in rules
    assert "Providing a new field value is not confirmation" in rules
    assert "Never list_contacts to find the open record" in rules


def test_coworker_prompt_does_not_treat_selected_contact_as_identity() -> None:
    prompt = normalized(
        build_coworker_system_prompt(
            role="admin",
            surface="contacts-detail",
            path="/admin/contacts",
            record_label="Sanju Ravi",
            surface_rules=build_surface_rules("contacts-detail"),
        )
    )
    assert "not your identity" in prompt
    assert "Sanju Ravi" in prompt
    assert "never as the selected contact" in prompt
    assert "I'm your {record name}" in prompt


def test_coworker_prompt_includes_today_for_relative_periods() -> None:
    from datetime import date

    prompt = build_coworker_system_prompt(role="admin", surface="dashboard", path="/admin/dashboard")
    today = date.today().isoformat()
    assert f"Today is {today}." in prompt
    assert "pass those start and end arguments" in prompt
    assert "Omit range." in prompt
    assert "Do not assume another year." in prompt
    assert "Never ask the user to switch to 7 or 30 days." in prompt


def test_coworker_prompt_never_offers_live_agent_connect() -> None:
    prompt = normalized(
        build_coworker_system_prompt(
            role="agent",
            surface="other",
            path="/agent/call-history",
        )
    )
    assert "Never offer to connect the user or a customer to a live agent" in prompt
    inbox = normalized(build_surface_rules("inbox"))
    assert "Do not copy a live-agent connect offer from the tool message" in inbox
    assert "Never suggest connecting the customer to a live agent" in inbox
