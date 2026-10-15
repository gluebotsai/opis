"""Cypher Query Guardrail for CRM B2B Knowledge Graph.

Enforces strict read-only queries, caps result limits (100), normalizes case-insensitive
categorical comparisons, prevents unauthorized credential access, and blocks domain leakages.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Optional

from .access import can_view_all_records
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

SENSITIVE_CREDENTIAL_PATTERNS = (
    r"\bpassword\b",
    r"\bsecret\b",
    r"\bapi_key_hash\b",
    r"\btoken_hash\b",
    r"\bclient_secret\b",
    r"\baccess_token\b",
    r"\brefresh_token\b",
)

# Guard against querying non-CRM / non-Sales spoke entities (Support, Ticketing, CCaaS, WebTracking)
# Per user directive: CRM nodes have the Sales label; never query other spoke nodes/labels
FORBIDDEN_TICKETING_PATTERNS = (
    r"\bTicket\b",
    r"\bTicketSLA\b",
    r"\bTicketAuditTrail\b",
    r"\bTicketHistory\b",
    r"\bUrgentTicket\b",
    r"\bResolvedTicket\b",
    r"\bOpenTicket\b",
    r"\bOverdueTicket\b",
    r"\bReopenedTicket\b",
    r"\bBugReport\b",
    r"\bSupportCompany\b",
    r"\bSupportQueue\b",
    r"\bSupportSLA\b",
    r"\bSupportStaff\b",
    r"\bSupportAgent\b",
    r"\bContactCentre\b",
    r"\bContactCentreAgent\b",
    r"\bContactCentreQueue\b",
    r"\bContactCentreSLA\b",
    r"\bContactCentreStaff\b",
    r"\bPageViewEvent\b",
    r"\bFormEvent\b",
    r"\bOnlineEvent\b",
)

# Standard categorical and enum fields in CRM B2B that must match case-insensitively
CASE_INSENSITIVE_FIELDS = (
    "stage",
    "status",
    "approval_status",
    "lead_status",
    "channel_role",
    "type",
    "lost_reason",
    "billing_type",
    "payment_method",
    "task_status",
    "forecast_category",
)

MAX_CYPHER_LIMIT = 100


def normalize_cypher_case_insensitivity(cypher: str) -> str:
    """Normalize string comparisons on CRM categorical fields to be case-insensitive."""
    result = cypher

    # Normalize common spaced multi-word enum literals to standard snake_case enums
    for wrong_pattern, proper_enum in [
        (r"(['\"])closed\s+won(['\"])", r"\1closed_won\2"),
        (r"(['\"])closed\s+lost(['\"])", r"\1closed_lost\2"),
        (r"(['\"])in\s+progress(['\"])", r"\1in_progress\2"),
        (r"(['\"])on\s+hold(['\"])", r"\1on_hold\2"),
    ]:
        result = re.sub(wrong_pattern, proper_enum, result, flags=re.IGNORECASE)

    # Normalize hallucinated deal labels to standard Deal label
    result = re.sub(r":WonDeal\b", ":Deal", result, flags=re.IGNORECASE)
    result = re.sub(r":LostDeal\b", ":Deal", result, flags=re.IGNORECASE)
    result = re.sub(r":OpenDeal\b", ":Deal", result, flags=re.IGNORECASE)

    # Normalize Product:Sales (Product is a shared master entity and does not have :Sales)
    result = re.sub(r":Product:Sales\b|:Sales:Product\b", ":Product", result, flags=re.IGNORECASE)

    # Normalize fake relationship edges to verified property joins
    result = re.sub(
        r'\(([a-zA-Z_][a-zA-Z0-9_]*):Account\)<-?\[:(?:HAS_ACCOUNT|WORKS_AT|HAS)\]-?\(([a-zA-Z_][a-zA-Z0-9_]*):Deal\)',
        r'(\1:Account), (\2:Deal) WHERE \2.company_id = \1.id',
        result,
        flags=re.IGNORECASE,
    )
    result = re.sub(
        r'\(([a-zA-Z_][a-zA-Z0-9_]*):Deal\)-?\[:(?:HAS_ACCOUNT|WORKS_AT|HAS)\]->?\(([a-zA-Z_][a-zA-Z0-9_]*):Account\)',
        r'(\1:Deal), (\2:Account) WHERE \1.company_id = \2.id',
        result,
        flags=re.IGNORECASE,
    )
    result = re.sub(
        r'\(([a-zA-Z_][a-zA-Z0-9_]*):Invoice\)-?\[:(?:HAS_ACCOUNT|FOR_ACCOUNT)\]->?\(([a-zA-Z_][a-zA-Z0-9_]*):Account\)',
        r'(\1:Invoice), (\2:Account) WHERE \1.company_id = \2.id',
        result,
        flags=re.IGNORECASE,
    )

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

        # Pattern 3: prop <> 'Value' or prop != 'Value'
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


def strip_redundant_org_id_filters(cypher: str) -> str:
    """Strip redundant organization_id filters since databases are tenant-isolated."""
    result = cypher
    val_pat = r"(?:[$][a-zA-Z_][a-zA-Z0-9_]*|\d+|['\"][^'\"]*['\"])"
    # Pattern 1: WHERE ...org_id = ... AND -> WHERE
    result = re.sub(
        r"\bWHERE\s+[a-zA-Z_][a-zA-Z0-9_]*\.organization_id\s*=\s*" + val_pat + r"\s+AND\b",
        "WHERE ",
        result,
        flags=re.IGNORECASE,
    )
    # Pattern 2: AND ...org_id = ... -> ''
    result = re.sub(
        r"\bAND\s+[a-zA-Z_][a-zA-Z0-9_]*\.organization_id\s*=\s*" + val_pat,
        "",
        result,
        flags=re.IGNORECASE,
    )
    # Pattern 3: Standalone WHERE ...org_id = ... -> ''
    result = re.sub(
        r"\bWHERE\s+[a-zA-Z_][a-zA-Z0-9_]*\.organization_id\s*=\s*" + val_pat,
        "",
        result,
        flags=re.IGNORECASE,
    )
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

    # Sensitive credentials check
    for pattern in SENSITIVE_CREDENTIAL_PATTERNS:
        if re.search(pattern, query, re.IGNORECASE):
            raise CypherSecurityViolation(
                "Access to passwords, secrets, API tokens, or hash columns is strictly forbidden."
            )

    # Domain Fencing: Block any traversal into ticketing entities
    for pattern in FORBIDDEN_TICKETING_PATTERNS:
        if re.search(pattern, query, re.IGNORECASE):
            match = re.search(pattern, query, re.IGNORECASE).group(0)
            raise CypherSecurityViolation(
                f"CRM B2B queries are restricted from querying ticketing entities ('{match}'). "
                "Tickets are part of the Service product and are not stored in the CRM B2B tables."
            )

    # Enforce LIMIT cap
    limit_match = re.search(r"\bLIMIT\s+(\d+)\b", query, re.IGNORECASE)
    if limit_match:
        val = int(limit_match.group(1))
        if val > MAX_CYPHER_LIMIT:
            query = re.sub(r"\bLIMIT\s+\d+\b", f"LIMIT {MAX_CYPHER_LIMIT}", query, flags=re.IGNORECASE)
    else:
        query = f"{query}\nLIMIT {MAX_CYPHER_LIMIT}"

    # Strip redundant organization_id filters (database-level tenant separation)
    query = strip_redundant_org_id_filters(query)

    # Normalize categorical comparisons to be case-insensitive
    query = normalize_cypher_case_insensitivity(query)

    return GuardedCypher(cypher=query, params=params or {})
