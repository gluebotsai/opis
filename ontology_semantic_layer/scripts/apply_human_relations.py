#!/usr/bin/env python3
"""Apply human-readable relation verbs and Employee→User renames across ontology surfaces."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CORE = ROOT / "Knowledge_Graph_Pipeline" / "config" / "mappings" / "core.yaml"
MODULES = ROOT / "ontology" / "modules"
SLICES = ROOT / "ontology" / "slices"

# Module/slice relation rewrites (SCREAMING → snake_case verbs)
MODULE_REL_MAP = {
    "FOR_CUSTOMER": "raised_by",
    "FOR_ACCOUNT": "belongs_to",
    "ASSIGNED_L1": "assigned_to",
    "ASSIGNED_TO": "assigned_to",
    "RESOLVER_L2": "resolved_by",
    "RESOLVED_BY": "resolved_by",
    "HAS_SLA": "has_sla",
    "HAS_NOTE": "has_note",
    "HAS_CONSENT": "has_consent",
    "HAS_PREFERENCE": "has_preference",
    "BELONGS_TO": "belongs_to",
    "WORKS_FOR": "works_for",
    "IDENTIFIES": "identifies",
    "RESOLVES_TO": "resolves_to",
    "HAS_SKILL": "has_skill",
    "OWNED_BY": "owned_by",
    "OWNED_BY_TEAM": "owned_by_team",
    "IN_CATEGORY": "in_category",
    "CLASSIFIED_BY": "classified_by",
    "RELATED_TO": "related_to",
    "HAS_MEMBER": "has_member",
    "HAS_PRESENCE": "has_presence",
    "INCLUDES": "includes",
    "OF": "of",
    "ABOUT": "about",
    "HANDLED_BY": "handled_by",
    "STAFFED_BY": "staffed_by",
    "TRIGGERS": "triggers",
    "ROUTES_TO": "routes_to",
    "TARGETS": "targets",
    "HAS": "has",
}

# Core.yaml business + hub relation type renames
CORE_REL_MAP = {
    "HAS_EMPLOYEE": "has_user",
    "ROLE_OF": "role_of",
    "ABOUT_EMPLOYEE": "about_user",
    "FOR_CUSTOMER": "raised_by",
    "RAISED_BY": "raised_by",
    "ASSIGNED_TO": "assigned_to",
    "RESOLVED_BY": "resolved_by",
    "WRITTEN_BY": "written_by",
    "CREATED_BY": "created_by",
    "OWNED_BY": "owned_by",
    "APPLIED_BY": "applied_by",
    "UPLOADED_BY": "uploaded_by",
    "APPROVED_BY": "approved_by",
    "REVIEWED_BY": "reviewed_by",
    "DECIDED_BY": "decided_by",
    "HOSTED_BY": "hosted_by",
    "MEMBER_OF": "member_of",
    "HOLDS_ROLE": "holds_role",
    "IN_QUEUE": "in_queue",
    "FROM_QUEUE": "from_queue",
    "STAFFED_BY": "staffed_by",
    "HAS_NOTE": "has_note",
    "HAS_SLA": "has_sla",
    "HAS_SUPPORT_QUEUE": "has_support_queue",
    "HAS_SUPPORT_ACCOUNT": "has_support_account",
    "HAS_TEAM": "has_team",
    "HAS_ACCESS_ROLE": "has_access_role",
    "HAS_OPERATING_SCHEDULE": "has_operating_schedule",
    "HAS_SHIFT": "has_shift",
    "HAS_HOLIDAY_SCHEDULE": "has_holiday_schedule",
    "HAS_NON_WORKING_DAY": "has_non_working_day",
    "HAS_CHANNEL_ACCOUNT": "has_channel_account",
    "HAS_VOICE_NUMBER": "has_voice_number",
    "HAS_VOICE_PROMPT_PROFILE": "has_voice_prompt_profile",
    "HAS_QUEUE_DEFINITION": "has_queue_definition",
    "HAS_KNOWLEDGE_DOCUMENT": "has_knowledge_document",
    "HAS_EXTRACTED_PROFILE": "has_extracted_profile",
    "HAS_IDENTITY": "has_identity",
    "HAS_JOURNEY_POSITION": "has_journey_position",
    "HAS_SCORECARD": "has_scorecard",
    "HAS_VALUE_SUMMARY": "has_value_summary",
    "HAS_METRIC": "has_metric",
    "HAS_SEGMENT": "has_segment",
    "HAS_PERSONA_DEFINITION": "has_persona_definition",
    "HAS_ENGAGEMENT_RULE": "has_engagement_rule",
    "HAS_SIGNAL": "has_signal",
    "HAS_PREDICTIVE_MODEL": "has_predictive_model",
    "HAS_DATA_SOURCE": "has_data_source",
    "HAS_TRACKED_SITE": "has_tracked_site",
    "HAS_SKILL_DEFINITION": "has_skill_definition",
    "HAS_CAPACITY": "has_capacity",
    "HAS_AVAILABILITY": "has_availability",
    "HAS_PRESENCE_REASON": "has_presence_reason",
    "HAS_SERVICE_QUEUE": "has_service_queue",
    "HAS_ROUTING_PROFILE": "has_routing_profile",
    "HAS_DISTRIBUTION_POLICY": "has_distribution_policy",
    "HAS_AUTOMATION_POLICY": "has_automation_policy",
    "HAS_SERVICE_LEVEL_POLICY": "has_service_level_policy",
    "HAS_OUTCOME_CODE": "has_outcome_code",
    "HAS_PORTAL_SETTINGS": "has_portal_settings",
    "FOLLOWS_SCHEDULE": "follows_schedule",
    "GRANTS_ACCESS_TO": "grants_access_to",
    "OPERATES_ON": "operates_on",
    "USES_PROMPTS": "uses_prompts",
    "OWNED_BY_TEAM": "owned_by_team",
    "PROJECTION_OF": "projection_of",
    "REQUIRES_SKILL": "requires_skill",
    "OVERFLOWS_TO": "overflows_to",
    "POLICY_FOR": "policy_for",
    "DEFAULT_QUEUE": "default_queue",
    "IN_SESSION": "in_session",
    "ON_SITE": "on_site",
    "IN_SEGMENT": "in_segment",
    "MATCHES_PERSONA": "matches_persona",
    "EVIDENCE_FOR": "evidence_for",
    "SAME_PERSON_AS": "same_person_as",
    "PURCHASED": "purchased",
    "OBSERVES": "observes",
    "HAS_SKILL": "has_skill",
    "HAS_CAPACITY_PROFILE": "has_capacity_profile",
    "AWAITING": "awaiting",
    "ROUTES_TO": "routes_to",
    "HAS_CONSENT": "has_consent",
    "HAS_PREFERENCE": "has_preference",
    "RELATED_TO": "related_to",
    "HAS_AUDIT_LOG": "has_audit_log",
    "HAS_MACRO": "has_macro",
    "HAS_KB_ARTICLE": "has_kb_article",
    "HAS_AUTOMATION_RULE": "has_automation_rule",
    "HAS_NOTIFICATION": "has_notification",
    "HAS_SUGGESTION": "has_suggestion",
    "HAS_APPROVAL": "has_approval",
    "THREADS_TO": "threads_to",
    "GOVERNED_BY": "has_sla",
    "PRIMARY_CONTACT": "primary_contact",
    "SALES_VIEW_OF": "sales_view_of",
    "HAS_SUPPORT_PORTAL": "has_support_portal",
}


def _replace_rel_types(text: str, rel_map: dict[str, str]) -> str:
    for old, new in sorted(rel_map.items(), key=lambda x: -len(x[0])):
        text = text.replace(f"type: {old}", f"type: {new}")
        text = text.replace(f"type: {old},", f"type: {new},")
        # slice relation lines: "Ticket FOR_CUSTOMER Contact"
        text = re.sub(rf"\b{old}\b", new, text)
    return text


def _employee_to_user(text: str) -> str:
    text = text.replace("label: Employee", "label: User")
    text = text.replace("{label: Employee", "{label: User")
    text = text.replace("to: Employee", "to: User")
    text = text.replace("from: Employee", "from: User")
    text = text.replace("Employee:", "User:")
    text = re.sub(r"\bEmployee\b", "User", text)
    # Restore postgres column references that should stay
    text = text.replace("employee_id", "employee_id")  # no-op safeguard
    return text


def apply_core() -> None:
    text = CORE.read_text(encoding="utf-8")
    text = _employee_to_user(text)
    text = _replace_rel_types(text, CORE_REL_MAP)
    CORE.write_text(text, encoding="utf-8")
    print(f"Updated {CORE}")


def apply_modules_and_slices() -> None:
    for base in (MODULES, SLICES):
        for fp in sorted(base.glob("*.yml")):
            text = fp.read_text(encoding="utf-8")
            text = _replace_rel_types(text, MODULE_REL_MAP)
            # WorkforceAgent → Agent in slice relation lines only
            text = re.sub(r"\bWorkforceAgent\b", "Agent", text)
            text = re.sub(r"\bProactiveRecommendation\b", "Suggestion", text)
            text = re.sub(r"\bAsgaDecision\b", "Approval", text)
            fp.write_text(text, encoding="utf-8")
            print(f"Updated {fp.relative_to(ROOT)}")


def main() -> int:
    apply_core()
    apply_modules_and_slices()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
