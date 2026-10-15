#!/usr/bin/env python3
"""Apply human-readable Neo4j label renames to Knowledge_Graph_Pipeline/config/mappings/core.yaml."""

from __future__ import annotations

import re
import sys
from pathlib import Path

CORE = Path(__file__).resolve().parent.parent / "Knowledge_Graph_Pipeline" / "config" / "mappings" / "core.yaml"

# Old graph label -> new (longer names first to avoid partial replacements)
LABEL_MAP = [
    ("SupportCase", "Ticket"),
    ("SupportAccount", "ContactAccount"),
    ("SupportQueue", "Queue"),
    ("CaseNote", "Note"),
    ("CannedReply", "Macro"),
    ("EmailThreadRef", "InboundEmail"),
    ("EmailDispatchRecord", "OutboundEmail"),
    ("WorkflowRule", "AutomationRule"),
    ("ProactiveSuggestion", "Suggestion"),
    ("ActionApproval", "Approval"),
    ("ServiceLevelPolicy", "SLA"),
    ("StaffRole", "Agent"),
    ("Opportunity", "Deal"),
    ("WebVisitor", "Visitor"),
    ("BehaviourEvent", "Event"),
    ("MessageDelivery", "Message"),
    ("WorkTask", "Task"),
    ("AudienceSegment", "Segment"),
    ("TrackedSite", "Website"),
    ("ServiceQueue", "Queue"),
    ("CaseStatus", "TicketStatusConfig"),
    ("SupportSignal", "ProactiveEvent"),
    ("ProactiveDecision", "ProactiveDecision"),
    ("AssistantSession", "ChatSession"),
    ("AssistantWorkflowEvent", "ChatWorkflowEvent"),
    ("AuditRecord", "AuditLog"),
    ("SupportSnapshot", "SupportSnapshot"),
    ("RoutingWeightModel", "RoutingWeightModel"),
]

DERIVED_BLOCK = """  ticketing.tickets.customer_cdp_id:
    lookup:
      table: ticketing.contact_profile
      match_local: customer_id
      match_remote: id
      select: cdp_id
"""

CONTACT_PROFILE_REPLACEMENT = """  ticketing.contact_profile:
    product: ticketing
    mode: lookup_source
    access: {domain: ticketing, module: support, sensitivity: L1}
    key: id
    properties: [id, organization_id, cdp_id, account_id, external_id, status,
                 total_tickets, password_set_at, last_portal_login_at,
                 created_at, updated_at]
    note: "Bridge table only. Populates lookup cache; portal fields attach to Contact via reconcile."
"""


def apply(text: str) -> str:
    for old, new in LABEL_MAP:
        text = text.replace(old, new)
    text = re.sub(r"\n\s*agent_id:\s*wt:[^\n]+\n", "\n", text)
    if "ticketing.tickets.customer_cdp_id:" not in text:
        text = text.replace(
            "derived:\n  campaign.campaign_send_recipients.delivery_channel:",
            f"derived:\n{DERIVED_BLOCK}  campaign.campaign_send_recipients.delivery_channel:",
        )
    # Demote contact_profile node
    text = re.sub(
        r"  ticketing\.contact_profile:\n(?:    .*\n)+?(?=\n  ticketing\.)",
        CONTACT_PROFILE_REPLACEMENT + "\n",
        text,
        count=1,
    )
    # Ticket RAISED_BY Contact via cdp_id
    text = text.replace(
        "- {type: RAISED_BY, to: SupportProfile, to_key: id, from_column: customer_id}",
        "- {type: FOR_CUSTOMER, to: Contact, to_key: cdp_id, from_column: customer_cdp_id}",
    )
    # Remove ticket_statuses graph node block
    text = re.sub(
        r"\n  ticketing\.ticket_statuses:\n(?:    .*\n)+?(?=\n  ticketing\.)",
        "\n  # ticketing.ticket_statuses: excluded — status is property + taxonomy (see definitions/entities.yml)\n",
        text,
        count=1,
    )
    # Trim infra tables from graph
    for trim_table in (
        "ticketing.dashboard_metrics",
        "ticketing.proactive_routing_weights",
        "ticketing.proactive_outbox",
        "ticketing.proactive_audit",
    ):
        text = re.sub(
            rf"\n  {re.escape(trim_table)}:\n(?:    .*\n)+?(?=\n  [a-z])",
            f"\n  # {trim_table}: excluded from graph (definitions/entities.yml)\n",
            text,
            count=1,
        )
    # node_ownership cleanup
    text = text.replace(
        "SupportProfile: {owner: ticketing.contact_profile, key: id}\n",
        "",
    )
    text = re.sub(r",\s*SupportProfile", "", text)
    text = re.sub(r"SupportProfile,\s*", "", text)
    text = text.replace(
        "TicketStatusConfig: {owner: ticketing.ticket_statuses, key: id}\n",
        "",
    )
    text = text.replace("SupportCase:", "Ticket:")
    text = text.replace("SupportAccount:", "ContactAccount:")
    text = text.replace("SupportQueue:", "Queue:")
    return text


def main() -> int:
    dry = "--dry-run" in sys.argv
    original = CORE.read_text(encoding="utf-8")
    updated = apply(original)
    if updated == original:
        print("no changes")
        return 0
    if dry:
        print(updated[:4000])
        print("... [truncated dry-run output]")
    else:
        CORE.write_text(updated, encoding="utf-8")
        print(f"updated {CORE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
