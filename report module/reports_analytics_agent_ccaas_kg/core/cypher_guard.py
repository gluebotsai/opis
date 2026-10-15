"""Cypher Query Guardrail for CCaaS Neo4j.

Enforces strict read-only graph queries, caps query limits, and guards against
mutating operations or unauthorized sensitive property traversal.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Optional

from .access import can_access_sensitive_pii
from .models import AgentContext

FORBIDDEN_CYPHER_KEYWORDS = (
    r"\bCREATE\b",
    r"\bMERGE\b",
    r"\bDETACH\b",
    r"\bDELETE\b",
    r"\bSET\b",
    r"\bREMOVE\b",
    r"\bDROP\b",
    r"\bALTER\b",
    r"\bCALL\s+dbms\b",
    r"\bCALL\s+apoc\b",
    r"\bLOAD\s+CSV\b",
)

ADMIN_SENSITIVE_PATTERNS = (
    r"\bAccessRole\b",
    r"\bPermission\b",
    r"\bAccessPolicy\b",
    r"\bTenant\b",
    r"\bpassword\b",
    r"\bsecret\b",
    r"\bsalary\b",
    r"\bssn\b",
    r"\bcredit_card\b",
)

# Guard against graph traversal into ticketing domain
FORBIDDEN_TICKETING_PATTERNS = (
    r"\bTicket\b",
    r"\bTicketSLA\b",
    r"\bTicketAuditTrail\b",
    r"\bProactiveHistory\b",
    r"\bProactiveDecision\b",
    r"\bProactiveEvent\b",
    r"\bProactiveRecommendation\b",
    r"\bInboundEmail\b",
    r"\bSupportNotification\b",
    r"\bTicketNotification\b",
    r"\bHAS_TICKET_AUDIT_TRAIL\b",
    r"\bHAS_PROACTIVE_HISTORY\b",
    r"\bHAS_RESOLVER\b",
)

# Standard categorical and status fields that must match case-insensitively
CASE_INSENSITIVE_FIELDS = (
    "status",
    "channel",
    "priority",
    "category",
    "end_actor",
    "end_reason",
    "sla_status",
    "device_type",
    "event_name",
    "event_category",
    "source_name",
    "platform",
    "visitor_state",
    "queue_name",
    "sentiment",
    "role",
    "user_type",
)

MAX_CYPHER_LIMIT = 100


def normalize_cypher_case_insensitivity(cypher: str) -> str:
    """Normalize string comparisons on categorical fields to be case-insensitive (lower/upper/title/camel)."""
    result = cypher
    for field in CASE_INSENSITIVE_FIELDS:
        # Pattern 1: prop IN ['Val1', 'val2'] or toLower(prop) IN ['Val1', 'val2']
        in_pattern = re.compile(
            r"(?:toLower\(\s*([a-zA-Z_][a-zA-Z0-9_]*\." + field + r")\s*\)|(\b[a-zA-Z_][a-zA-Z0-9_]*\." + field + r"))\s+IN\s+\[(.*?)\]",
            re.IGNORECASE | re.DOTALL,
        )

        def replace_in(match):
            prop = match.group(1) or match.group(2)
            raw_list = match.group(3)
            lowered_list = re.sub(r"(['\"][^'\"]*['\"])", lambda m: m.group(1).lower(), raw_list)
            return f"toLower({prop}) IN [{lowered_list}]"

        result = in_pattern.sub(replace_in, result)

        # Pattern 2: prop = 'Value' or toLower(prop) = 'Value'
        eq_pattern = re.compile(
            r"(?:toLower\(\s*([a-zA-Z_][a-zA-Z0-9_]*\." + field + r")\s*\)|(\b[a-zA-Z_][a-zA-Z0-9_]*\." + field + r"))\s*=\s*(?P<val>['\"][^'\"]+['\"])",
            re.IGNORECASE,
        )

        def replace_eq(match):
            prop = match.group(1) or match.group(2)
            val = match.group("val").lower()
            return f"toLower({prop}) = {val}"

        result = eq_pattern.sub(replace_eq, result)

        # Pattern 2b: 'Value' = prop or 'Value' = toLower(prop)
        req_pattern = re.compile(
            r"(?P<val>['\"][^'\"]+['\"])\s*=\s*(?:toLower\(\s*([a-zA-Z_][a-zA-Z0-9_]*\." + field + r")\s*\)|(\b[a-zA-Z_][a-zA-Z0-9_]*\." + field + r"))",
            re.IGNORECASE,
        )

        def replace_req(match):
            val = match.group("val").lower()
            prop = match.group(2) or match.group(3)
            return f"{val} = toLower({prop})"

        result = req_pattern.sub(replace_req, result)

        # Pattern 3: prop <> 'Value' or prop != 'Value' or toLower(prop) <> 'Value'
        neq_pattern = re.compile(
            r"(?:toLower\(\s*([a-zA-Z_][a-zA-Z0-9_]*\." + field + r")\s*\)|(\b[a-zA-Z_][a-zA-Z0-9_]*\." + field + r"))\s*(?:<>|!=)\s*(?P<val>['\"][^'\"]+['\"])",
            re.IGNORECASE,
        )

        def replace_neq(match):
            prop = match.group(1) or match.group(2)
            val = match.group("val").lower()
            return f"toLower({prop}) <> {val}"

        result = neq_pattern.sub(replace_neq, result)

        # Pattern 4: CONTAINS, STARTS WITH, ENDS WITH
        str_pattern = re.compile(
            r"(?:toLower\(\s*([a-zA-Z_][a-zA-Z0-9_]*\." + field + r")\s*\)|(\b[a-zA-Z_][a-zA-Z0-9_]*\." + field + r"))\s+(CONTAINS|STARTS\s+WITH|ENDS\s+WITH)\s*(?P<val>['\"][^'\"]+['\"])",
            re.IGNORECASE,
        )

        def replace_str(match):
            prop = match.group(1) or match.group(2)
            op = re.sub(r"\s+", " ", match.group(3).upper())
            val = match.group("val").lower()
            return f"toLower({prop}) {op} {val}"

        result = str_pattern.sub(replace_str, result)

    return result


class CypherSecurityViolation(Exception):
    """Mutating or unauthorized Cypher operation detected."""
    pass


@dataclass
class GuardedCypher:
    """Safe, validated Cypher query ready for execution."""
    cypher: str
    params: dict[str, Any]


def validate_and_guard_cypher(
    raw_cypher: str,
    params: Optional[dict[str, Any]] = None,
    context: Optional[AgentContext] = None,
) -> GuardedCypher:
    """Ensure Cypher query contains no write clauses, enforces limit caps, and respects privacy rules."""
    query = raw_cypher.strip().rstrip(";")
    if not query:
        raise CypherSecurityViolation("Empty Cypher query.")

    # Check for multiple statements
    if ";" in query:
        raise CypherSecurityViolation("Multiple Cypher statements are not allowed.")

    # Check forbidden mutating patterns (case-insensitive)
    for pattern in FORBIDDEN_CYPHER_KEYWORDS:
        if re.search(pattern, query, re.IGNORECASE):
            match = re.search(pattern, query, re.IGNORECASE).group(0)
            raise CypherSecurityViolation(
                f"Forbidden Cypher clause detected: '{match}'. Only read-only MATCH and RETURN queries are allowed."
            )

    # Must contain MATCH or RETURN
    if not re.search(r"\b(MATCH|RETURN)\b", query, re.IGNORECASE):
        raise CypherSecurityViolation("Cypher query must contain a valid MATCH or RETURN clause.")

    # Privacy & Admin Fencing: Block sensitive administrative labels/props if role is not authorized
    if context and not can_access_sensitive_pii(context.role):
        for pattern in ADMIN_SENSITIVE_PATTERNS:
            if re.search(pattern, query, re.IGNORECASE):
                raise CypherSecurityViolation(
                    f"Role '{context.role}' is not authorized to query sensitive administrative entities in knowledge graph."
                )

    # Domain Fencing: Block any traversal into ticketing entities
    for pattern in FORBIDDEN_TICKETING_PATTERNS:
        if re.search(pattern, query, re.IGNORECASE):
            match = re.search(pattern, query, re.IGNORECASE).group(0)
            raise CypherSecurityViolation(
                f"Contact Center (CCaaS) queries are restricted from querying ticketing entities ('{match}'). "
                "The CCaaS Agent is strictly scoped to contact center interactions (Conversation), queues, staff routing, outcomes, operating hours, and customer contact history."
            )

    # Enforce LIMIT cap
    limit_match = re.search(r"\bLIMIT\s+(\d+)\b", query, re.IGNORECASE)
    if limit_match:
        val = int(limit_match.group(1))
        if val > MAX_CYPHER_LIMIT:
            query = re.sub(r"\bLIMIT\s+\d+\b", f"LIMIT {MAX_CYPHER_LIMIT}", query, flags=re.IGNORECASE)
    else:
        query = f"{query}\nLIMIT {MAX_CYPHER_LIMIT}"

    # Normalize categorical comparisons to be case-insensitive (lower/upper/title/camel)
    query = normalize_cypher_case_insensitivity(query)

    return GuardedCypher(cypher=query, params=params or {})
