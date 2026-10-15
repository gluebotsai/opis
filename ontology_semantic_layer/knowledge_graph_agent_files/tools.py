# ==============================================================================
# tools.py — Knowledge Graph Execution, Validation & Ontology Tools
# ==============================================================================

import os
import datetime
import calendar
import re
import json
from pathlib import Path
from typing import Optional, Any, Dict, List, Tuple
from dotenv import load_dotenv

load_dotenv()

import meilisearch
from neo4j import GraphDatabase

from .config import validate_org_id, get_config


def _normalize_neo4j_uri(uri: str | None) -> str:
    """Ensure Neo4j Bolt port 7687 is used if user provided HTTP port 7474 in .env."""
    if not uri:
        return ""
    uri_clean = str(uri).strip().strip('"').strip("'")
    return uri_clean.replace(":7474", ":7687")


def _normalize_org_key(organization_id: str) -> str:
    """Normalize API organization_id to org1000-style key (no underscore)."""
    oid = str(organization_id).strip()
    if oid.startswith("org_"):
        return f"org{oid[4:]}"
    if oid.startswith("org"):
        return oid
    return f"org{oid}"


def org_db_name(organization_id: str) -> str:
    """Map API organization_id to Neo4j database name, validating against allowlist."""
    try:
        valid_key = validate_org_id(organization_id)
        prefix = get_config().neo4j.database_prefix
    except Exception:
        valid_key = _normalize_org_key(organization_id)
        prefix = os.getenv("NEO4J_DATABASE_PREFIX", "org")
    if not valid_key.startswith(prefix):
        return f"{prefix}{valid_key}"
    return valid_key


def compute_period_params(reference_date: str | datetime.date | None = None) -> dict[str, str]:
    """Standard week-over-week UTC date params for Neo4j ZONED DATETIME comparisons."""
    if reference_date is None:
        ref = datetime.date.today()
    elif isinstance(reference_date, str):
        ref = datetime.date.fromisoformat(reference_date[:10])
    else:
        ref = reference_date

    week_start = ref - datetime.timedelta(days=ref.weekday())
    week_end = week_start + datetime.timedelta(days=7)
    compare_start = week_start - datetime.timedelta(days=7)
    compare_end = week_start

    def to_zoned_dt(d: datetime.date) -> str:
        return f"{d.isoformat()}T00:00:00Z"

    return {
        "period_start": to_zoned_dt(week_start),
        "period_end": to_zoned_dt(week_end),
        "compare_start": to_zoned_dt(compare_start),
        "compare_end": to_zoned_dt(compare_end),
    }


_ZONED_DATETIME_PROPS = (
    "created_at",
    "updated_at",
    "ended_at",
    "resolved_at",
    "assigned_at",
    "breached_at",
    "requested_at",
    "issue_date",
    "closed_at",
    "queued_at",
    "confirmed_at",
    "converted_at",
    "due_at",
    "decided_at",
    "dismissed_at",
    "paid_at",
    "first_agent_response_at",
    "first_response_due_at",
)

_DATE_PARAMS = (
    "period_start",
    "period_end",
    "compare_start",
    "compare_end",
    "start_date",
    "end_date",
    "start",
    "end",
    "date_start",
    "date_end",
    "from_date",
    "to_date",
)

_DATETIME_PROP_PATTERN = "|".join(_ZONED_DATETIME_PROPS)
_LITERAL_DATETIME_RE = re.compile(
    r"datetime\(\s*['\"](\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z?)['\"]\s*\)",
    re.IGNORECASE,
)
_RAW_STRING_DATETIME_RE = re.compile(
    rf"([\w.]+\.(?:{_DATETIME_PROP_PATTERN})\s*(?:>=|>|<=|<|=)\s*)"
    r"['\"](\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?)?)(?:Z)?['\"]",
    re.IGNORECASE,
)


def _wrap_date_param_comparisons(cypher_query: str) -> str:
    """Ensure ZONED DATETIME properties compare via datetime($param), not raw strings."""
    for param in _DATE_PARAMS:
        cypher_query = re.sub(
            rf"([\w.]+\.(?:{_DATETIME_PROP_PATTERN})\s*(?:>=|>|<=|<|=)\s*)"
            rf"(?!datetime\()\${param}\b",
            rf"\1datetime(${param})",
            cypher_query,
            flags=re.IGNORECASE,
        )
    return cypher_query


def _add_z_suffix_to_datetime_literals(cypher_query: str) -> str:
    """Neo4j ZONED DATETIME requires UTC suffix; fix agent hardcoded timezone-less literals."""

    def _fix_literal(match: re.Match) -> str:
        value, zone = match.group(1), match.group(2)
        if zone.upper() == "Z":
            return match.group(0)
        return f"datetime('{value}Z')"

    return _LITERAL_DATETIME_RE.sub(_fix_literal, cypher_query)


def _wrap_raw_string_datetime_comparisons(cypher_query: str) -> str:
    """Wrap raw ISO date string comparisons with datetime('...Z') for ZONED DATETIME."""

    def _fix_raw(match: re.Match) -> str:
        prefix, raw_val = match.group(1), match.group(2)
        iso = raw_val.replace(" ", "T")
        if "T" not in iso:
            iso = f"{iso}T00:00:00"
        return f"{prefix}datetime('{iso}Z')"

    return _RAW_STRING_DATETIME_RE.sub(_fix_raw, cypher_query)


def _inject_literal_date_params(cypher_query: str, params: dict) -> tuple[str, dict]:
    """Extract hardcoded datetime(...) literals into query parameters."""
    literal_pattern = re.compile(
        r"datetime\(\s*['\"]([^'\"]+)['\"]\s*\)",
        re.IGNORECASE,
    )
    new_params = dict(params)
    param_idx = 0

    def _replace_with_param(match: re.Match) -> str:
        nonlocal param_idx
        dt_val = match.group(1)
        if not dt_val.endswith("Z") and not re.search(r"[+-]\d{2}:?\d{2}$", dt_val):
            dt_val = dt_val + "Z"
        param_name = f"_injected_dt_{param_idx}"
        param_idx += 1
        new_params[param_name] = dt_val
        return f"datetime(${param_name})"

    new_query = literal_pattern.sub(_replace_with_param, cypher_query)
    return new_query, new_params


def normalize_cypher_datetimes(cypher_query: str, params: dict | None = None) -> str:
    """Pre-execution pipeline to fix temporal comparisons against ZONED DATETIME."""
    query = _add_z_suffix_to_datetime_literals(cypher_query)
    query = _wrap_raw_string_datetime_comparisons(query)
    query = _wrap_date_param_comparisons(query)
    return query


def _strip_org_filters_from_cypher(cypher_query: str) -> str:
    """Remove redundant tenant filters since database is already tenant-isolated."""
    query = re.sub(
        r"""(?:\w+\.)?(?:organization_id|org_id|tenant_id)\s*=\s*(?:\$\w+|['"][^'"]*['"])\s*(?:AND\s*|,\s*)?""",
        "",
        cypher_query,
        flags=re.IGNORECASE,
    )
    query = re.sub(
        r"""(?:AND\s+)(?:\w+\.)?(?:organization_id|org_id|tenant_id)\s*=\s*(?:\$\w+|['"][^'"]*['"])""",
        "",
        query,
        flags=re.IGNORECASE,
    )
    query = re.sub(r"""\bWHERE\s*(?:AND\s*)+""", "WHERE ", query, flags=re.IGNORECASE)
    query = re.sub(r"""\bWHERE\s*(RETURN|WITH|ORDER|LIMIT|\Z)""", r"\1", query, flags=re.IGNORECASE)
    query = re.sub(
        r"""(?:\w+\.)?(?:organization_id|org_id|tenant_id)\s*:\s*(?:\$\w+|['"][^'"]*['"])\s*,?\s*""",
        "",
        query,
        flags=re.IGNORECASE,
    )
    return query


def wrap_kg_handler(
    handler,
    organization_id: str,
    reference_date: str | None = None,
    access_scope: Optional[Any] = None,
):
    """Bind tenant Neo4j database; strip org filters; inject standard date params & access scope."""
    default_db = org_db_name(organization_id)
    period_params = compute_period_params(reference_date)

    def wrapped(cypher_query: str, params: dict = None, db_name: str = None, **kwargs):
        kwargs.pop("db_name", None)
        merged_params = dict(period_params)
        merged_params.update(params or {})
        merged_params.pop("org_id", None)
        merged_params.pop("organization_id", None)
        cypher_query = _strip_org_filters_from_cypher(cypher_query)
        cypher_query = normalize_cypher_datetimes(cypher_query, merged_params)
        return handler(
            cypher_query=cypher_query,
            params=merged_params,
            db_name=default_db,
            access_scope=access_scope,
            **kwargs,
        )

    return wrapped


def build_tool_handlers(
    organization_id: str,
    overrides: dict | None = None,
    reference_date: str | None = None,
    access_scope: Optional[Any] = None,
) -> dict:
    """Return tool handlers with knowledge_graph bound to tenant Neo4j database and access scope."""
    handlers = dict(TOOL_HANDLERS)
    if overrides:
        handlers.update({k: v for k, v in overrides.items() if k != "knowledge_graph"})
    handlers["knowledge_graph"] = wrap_kg_handler(
        TOOL_HANDLERS["knowledge_graph"], organization_id, reference_date, access_scope=access_scope
    )
    return handlers


# ------------------------------------------------------------------------------
# Configuration Helpers
# ------------------------------------------------------------------------------

CONFIG = {
    "knowledge_graph": {
        "uri": _normalize_neo4j_uri(os.getenv("NEO4J_URI")),
        "user": os.getenv("NEO4J_USER", "neo4j"),
        "password": os.getenv("NEO4J_PASSWORD"),
    },
    "meilisearch": {
        "url": os.getenv("MEILISEARCH_URL", "http://127.0.0.1:7700"),
        "api_key": os.getenv("MEILISEARCH_API_KEY", ""),
    },
}


def _get_max_rows() -> int:
    try:
        return get_config().neo4j.max_rows
    except Exception:
        return int(os.getenv("NEO4J_MAX_ROWS", "50"))


def _get_read_timeout() -> float:
    try:
        return get_config().neo4j.read_timeout_seconds
    except Exception:
        return float(os.getenv("NEO4J_READ_TIMEOUT_SECONDS", "30.0"))


# ------------------------------------------------------------------------------
# Knowledge Graph Client
# ------------------------------------------------------------------------------

class KGClient:
    _instance = None

    def __init__(self, uri: str, user: str, password: str):
        if not uri:
            raise ValueError("NEO4J_URI configuration is missing or empty.")
        clean_uri = _normalize_neo4j_uri(uri)
        self.driver = GraphDatabase.driver(clean_uri, auth=(user, password))

    @classmethod
    def get_instance(cls, config: dict = None):
        if cls._instance is None:
            cfg = config.get("knowledge_graph", config) if config else CONFIG.get("knowledge_graph", {})
            uri = cfg.get("uri") or _normalize_neo4j_uri(os.getenv("NEO4J_URI"))
            user = cfg.get("user") or os.getenv("NEO4J_USER", "neo4j")
            pwd = cfg.get("password") or os.getenv("NEO4J_PASSWORD")
            cls._instance = cls(uri, user, pwd)
        return cls._instance

    @classmethod
    def close(cls):
        if cls._instance:
            cls._instance.driver.close()
            cls._instance = None

    def execute_cypher(self, query: str, params: dict = None, db_name: str = None, timeout: float | None = None):
        session = self.driver.session(database=db_name) if db_name else self.driver.session()
        read_timeout = timeout or _get_read_timeout()
        try:
            def _run_read_tx(tx):
                result = tx.run(query, params, timeout=read_timeout)
                records = [dict(r) for r in result]
                result.consume()
                return records
            return session.execute_read(_run_read_tx)
        finally:
            session.close()


# ------------------------------------------------------------------------------
# Cypher Query Validation & Schema Allowlist
# ------------------------------------------------------------------------------

DANGEROUS_CYPHER_PATTERNS = [
    r"\b(DELETE|DROP|DETACH|REMOVE|ALTER|TRUNCATE)\b",
    r"\bCREATE\s+(INDEX|CONSTRAINT)\b",
    r"\bDROP\s+(INDEX|CONSTRAINT)\b",
    r"\b(SET|REMOVE)\s+LABEL\b",
    r"\bLOAD\s+CSV\b",
    r"\bCALL\s+(dbms|apoc)\b",
]

_MUTATION_KEYWORD_RE = re.compile(
    r"\b(CREATE|MERGE|SET|DELETE|DETACH|REMOVE|DROP|ALTER|TRUNCATE)\b",
    re.IGNORECASE,
)

_SCHEMA_REGISTRY_PATH = Path(__file__).resolve().parent / "ontology" / "schema_registry.json"
_DEFAULT_AUTO_LIMIT = 50

_FALLBACK_LABELS = {
    "Tenant", "Role", "Team", "User", "HolidayCalendar", "BusinessHours", "Channel",
    "Agent", "Skill", "Queue", "RoutingPolicy", "Disposition", "SLA", "ChannelAutomationPolicy",
    "Conversation", "ConversationSummary", "SLAInstance", "Attachment", "WorkNote",
    "ConversationParticipant", "Assignment", "Transfer", "RoutingAttempt", "WebchatSession",
    "Task", "SharedNote", "Contact", "ContactPoint", "CustomerScore", "Insight",
    "Recommendation", "Segment", "Order", "Offering", "Product",
}
_FALLBACK_RELATIONSHIPS = {
    "DEFINES_ROLE", "HAS_TEAM", "FOLLOWS_HOURS", "EMPLOYS", "MEMBER_OF",
    "HAS_HOLIDAY_CALENDAR", "HAS_BUSINESS_HOURS", "USES_HOLIDAY_CALENDAR", "SUPPORTS_CHANNEL",
    "HAS_AGENT", "IS_AGENT_FOR", "DEFINES_SKILL", "HAS_SKILL", "REQUIRES_SKILL",
    "HAS_QUEUE_OWNER", "OWNED_BY_TEAM", "OVERFLOWS_TO", "DEFINES_DISPOSITION", "RESULTED_IN",
    "DEFINES_SLA", "HAS_SLA", "BASED_ON", "HAS_AUTOMATION_POLICY", "DEFAULT_QUEUE",
    "HAS_CONVERSATION", "PARTICIPATED_IN", "IN_QUEUE", "THROUGH", "HANDLED_BY", "ASSIGNED_USER",
    "CONTINUES_FROM", "HAS_SUMMARY", "HAS_ATTACHMENT", "HAS_WORK_NOTE", "AUTHORED",
    "HAS_PARTICIPANT", "HAS_ASSIGNMENT", "OFFERED_TO", "FROM_QUEUE", "HAS_TRANSFER",
    "TRANSFERRED_TO", "HAS_ROUTING_ATTEMPT", "TARGETED_QUEUE", "OFFERED_AGENT",
    "HAS_WEBCHAT_SESSION", "HAS_TASK", "FROM_CONVERSATION", "FOR_CONTACT", "CREATED_BY",
    "HAS_SHARED_NOTE", "WROTE_SHARED_NOTE", "HAS_CONTACT", "HAS_CONTACT_POINT", "HAS_SCORES",
    "HAS_INSIGHT", "HAS_RECOMMENDATION", "DEFINES_SEGMENT", "BELONGS_TO_SEGMENT", "PLACED",
    "CONTAINS", "OFFERS", "HAS_ROUTING_POLICY",
}


def _load_schema_registry() -> tuple[set[str], set[str], set[str]]:
    if _SCHEMA_REGISTRY_PATH.exists():
        data = json.loads(_SCHEMA_REGISTRY_PATH.read_text(encoding="utf-8"))
        return set(data["labels"]), set(data["relationships"]), set(data["properties"])
    return _FALLBACK_LABELS, _FALLBACK_RELATIONSHIPS, set()


VALID_LABELS, VALID_RELATIONSHIPS, VALID_PROPERTIES = _load_schema_registry()

VALID_PROPERTIES.update({
    "id", "tenant_id", "organization_id", "created_at", "updated_at", "cdp_id",
    "stage", "amount", "title", "total", "issue_date", "paid_at", "closed_at",
    "lead_status", "lead_source", "domain", "segment_name", "outcome", "end_reason",
    "queued_at", "assigned_at", "resolved_at", "breached_at", "churn_score",
    "first_name", "last_name", "name", "status", "channel", "outcome",
    "volume", "count", "cnt", "delta", "rate", "pct", "total_count", "score",
    "average", "avg", "min", "max", "extracted_facts", "metric_key", "severity",
    "message", "holiday_names", "holiday_dates"
})


def levenshtein_distance(a: str, b: str) -> int:
    if len(a) < len(b):
        return levenshtein_distance(b, a)
    if len(b) == 0:
        return len(a)
    prev_row = range(len(b) + 1)
    for i, ca in enumerate(a):
        curr_row = [i + 1]
        for j, cb in enumerate(b):
            cost = 0 if ca == cb else 1
            curr_row.append(min(curr_row[j] + 1, prev_row[j + 1] + 1, prev_row[j] + cost))
        prev_row = curr_row
    return prev_row[-1]


def find_similar(word: str, possibilities: set[str], cutoff: float = 0.6) -> list[str]:
    matches = []
    w_len = len(word)
    if w_len == 0:
        return []
    for p in possibilities:
        p_len = len(p)
        if abs(w_len - p_len) > 3:
            continue
        dist = levenshtein_distance(word.lower(), p.lower())
        max_l = max(w_len, p_len)
        sim = 1.0 - (dist / max_l)
        if sim >= cutoff:
            matches.append((sim, p))
    matches.sort(key=lambda x: x[0], reverse=True)
    return [m[1] for m in matches[:3]]


def _strip_quoted_strings(cypher: str) -> str:
    """Replace string literals with empty quotes so internal text is not treated as keywords."""
    return re.sub(r"'[^']*'|\"[^\"]*\"", "''", cypher)


def validate_properties(cypher_query: str) -> tuple[bool, str]:
    if not VALID_PROPERTIES:
        return True, "Valid"

    stripped = _strip_quoted_strings(cypher_query)
    matches = re.finditer(r"\b([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)\b", stripped)

    for m in matches:
        prop = m.group(2)
        if prop.isdigit():
            continue
        if prop in ("year", "month", "day", "hour", "minute", "second", "epochMillis"):
            continue

        if prop not in VALID_PROPERTIES:
            suggestions = find_similar(prop, VALID_PROPERTIES)
            hint = f" Did you mean: {', '.join(suggestions)}?" if suggestions else ""
            return False, f"Invalid property: '{prop}' does not exist in the schema.{hint}"

    return True, "Valid"


class CypherValidator:
    @staticmethod
    def validate(cypher_query: str, access_scope: Optional[Any] = None) -> tuple[bool, str]:
        stripped_for_keywords = _strip_quoted_strings(cypher_query)
        mutation_match = _MUTATION_KEYWORD_RE.search(stripped_for_keywords)
        if mutation_match:
            return False, f"Write/mutation operations ({mutation_match.group(1).upper()}) are strictly prohibited. The system is strictly read-only."

        for pattern in DANGEROUS_CYPHER_PATTERNS:
            match = re.search(pattern, stripped_for_keywords, re.IGNORECASE)
            if match:
                return False, f"Dangerous operation blocked: {match.group(0)}"

        query_for_labels = re.sub(r"\[[^\]]*\]", "", cypher_query)
        query_for_labels = _strip_quoted_strings(query_for_labels)
        label_pattern = r":(\w+)"
        labels = re.findall(label_pattern, query_for_labels)

        # RBAC Check: Hidden labels and properties for non-admin callers
        if access_scope and getattr(access_scope, "level", "self") != "org":
            try:
                from .config import get_config
                cfg = get_config()
                hidden_labels = set(cfg.access.hidden_for_non_admin.get("labels", []))
                hidden_props = set(cfg.access.hidden_for_non_admin.get("properties", []))
            except Exception:
                hidden_labels = {"Role", "Permission", "AccessRole", "StaffRole", "AccessPolicy", "Tenant"}
                hidden_props = {"password", "secret", "token", "api_key", "salary"}

            # Check hidden labels
            for label in labels:
                if label in hidden_labels:
                    return False, f"Access Denied: Role '{access_scope.role}' is not permitted to query sensitive label '{label}'."

            # Check hidden properties
            prop_matches = re.finditer(r"\b([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)\b", stripped_for_keywords)
            for m in prop_matches:
                p_name = m.group(2)
                if p_name in hidden_props:
                    return False, f"Access Denied: Role '{access_scope.role}' is not permitted to query sensitive property '{p_name}'."

        for label in labels:
            if label not in VALID_LABELS:
                return False, f"Invalid label: {label}. Valid labels: {', '.join(sorted(VALID_LABELS))}"

        rel_pattern = r"-\[.*?:`?(\w+)`?\]-|<-\[.*?:`?(\w+)`?\]"
        rels = re.findall(rel_pattern, cypher_query)
        for rel_tuple in rels:
            for rel in rel_tuple:
                if rel and rel not in VALID_RELATIONSHIPS:
                    return False, f"Invalid relationship type: {rel}. Valid relationships: {', '.join(sorted(VALID_RELATIONSHIPS))}"

        return True, "Valid"


def _inject_scope_predicate(cypher: str, pred_template: str, target_labels: tuple[str, ...]) -> str:
    """Inject scope predicate into Cypher for the first matched target label variable."""
    if "scope_user_id" in cypher or "scope_team_ids" in cypher or "scope_queue_ids" in cypher:
        return cypher

    label_union = "|".join(target_labels)
    pattern = rf"\(([a-zA-Z0-9_]+)\s*:\s*(?:{label_union})\b"
    matches = list(re.finditer(pattern, cypher))
    if not matches:
        return cypher

    m = matches[0]
    var_name = m.group(1)
    predicate = pred_template.format(var=var_name)

    match_end = m.end()
    post = cypher[match_end:]
    where_match = re.search(r"\bWHERE\b", post, re.IGNORECASE)
    return_match = re.search(r"\b(RETURN|WITH|ORDER|LIMIT)\b", post, re.IGNORECASE)

    if where_match and (not return_match or where_match.start() < return_match.start()):
        pos = match_end + where_match.end()
        new_q = cypher[:pos] + f" ({predicate}) AND " + cypher[pos:]
    else:
        if return_match:
            pos = match_end + return_match.start()
            new_q = cypher[:pos] + f" WHERE {predicate} " + cypher[pos:]
        else:
            new_q = cypher + f" WHERE {predicate}"

    return re.sub(r"\s+", " ", new_q).strip()


def apply_cypher_scope(
    cypher_query: str,
    access_scope: Optional[Any],
    params: dict,
) -> tuple[str, dict]:
    """
    Enforces role-based data boundary by injecting scope predicates and binding
    scope parameters ($scope_user_id, $scope_team_ids, $scope_queue_ids).
    """
    if not access_scope or getattr(access_scope, "level", "self") == "org":
        return cypher_query, params

    scoped_params = dict(params or {})
    scoped_cypher = cypher_query
    target_labels = (
        "Ticket",
        "SupportCase",
        "OpenTicket",
        "ResolvedTicket",
        "OverdueTicket",
        "PendingTicket",
        "ReopenedTicket",
    )

    if access_scope.level == "self":
        uid = getattr(access_scope, "user_id", None) or "anonymous"
        scoped_params["scope_user_id"] = uid
        pred = "({var}.assigned_to = $scope_user_id OR {var}.agent_id = $scope_user_id OR {var}.created_by = $scope_user_id)"
        scoped_cypher = _inject_scope_predicate(scoped_cypher, pred, target_labels)

    elif access_scope.level == "team":
        team_ids = getattr(access_scope, "team_ids", []) or []
        queue_ids = getattr(access_scope, "queue_ids", []) or []
        scoped_params["scope_team_ids"] = team_ids
        scoped_params["scope_queue_ids"] = queue_ids

        conditions = []
        if queue_ids:
            conditions.append("{var}.queue_id IN $scope_queue_ids")
        if team_ids:
            conditions.append("{var}.team_id IN $scope_team_ids")
        if not conditions:
            conditions.append("false")

        pred = "(" + " OR ".join(conditions) + ")"
        scoped_cypher = _inject_scope_predicate(scoped_cypher, pred, target_labels)

    return scoped_cypher, scoped_params


def _ensure_limit(cypher_query: str, default_limit: int | None = None) -> tuple[str, bool]:
    limit_val = default_limit or _get_max_rows()
    match = re.search(r"\bLIMIT\s+(\d+)\b", cypher_query, re.IGNORECASE)
    if match:
        existing = int(match.group(1))
        if existing > limit_val:
            capped = re.sub(r"\bLIMIT\s+\d+\b", f"LIMIT {limit_val}", cypher_query, flags=re.IGNORECASE)
            return capped, True
        return cypher_query, False
    trimmed = cypher_query.rstrip().rstrip(";")
    return f"{trimmed} LIMIT {limit_val}", True


# ------------------------------------------------------------------------------
# Tool Functions
# ------------------------------------------------------------------------------

def execute_cypher(
    cypher_query: str,
    params: dict = None,
    db_name: str = None,
    access_scope: Optional[Any] = None,
) -> dict:
    if not db_name:
        return {"error": "Neo4j database not specified. Pass organization_id in request."}

    is_valid, message = validate_properties(cypher_query)
    if not is_valid:
        return {"error": message}

    is_valid, message = CypherValidator.validate(cypher_query, access_scope=access_scope)
    if not is_valid:
        return {"error": message}

    cypher_query, params = apply_cypher_scope(cypher_query, access_scope=access_scope, params=params or {})
    cypher_query, auto_limited = _ensure_limit(cypher_query)

    try:
        config = CONFIG.get("knowledge_graph", {})
        client = KGClient.get_instance(config)
        if not client:
            return {"error": "Knowledge Graph client not initialized. Check CONFIG."}

        result = client.execute_cypher(cypher_query, params, db_name)

        seen = set()
        unique_records = []
        for record in result:
            d = dict(record)
            s = json.dumps(d, sort_keys=True, default=str)
            if s not in seen:
                seen.add(s)
                unique_records.append(d)

        response = {"data": unique_records, "database": db_name, "scoped_query": cypher_query}
        if auto_limited:
            response["auto_limited"] = True
            response["limit_applied"] = _DEFAULT_AUTO_LIMIT
        return response
    except Exception as e:
        return {"error": str(e)}


KG_TOOL_SCHEMA = {
    "type": "object",
    "properties": {
        "cypher_query": {
            "type": "string",
            "description": (
                "Cypher query for the knowledge graph. Temporal properties are Neo4j "
                "ZONED DATETIME (UTC). Always use $period_start, $period_end, "
                "$compare_start, $compare_end params with datetime($param) — "
                "never hardcode date literals like datetime('2026-08-23T00:00:00')."
            ),
        },
        "params": {
            "type": "object",
            "description": "Optional parameters for the Cypher query",
            "default": {}
        }
    },
    "required": ["cypher_query"]
}

BUSINESS_CONCEPTS_SCHEMA = {
    "type": "object",
    "properties": {
        "query": {
            "type": "string",
            "description": "The search query to find business concepts, node labels, or relationship types in the knowledge graph schema"
        },
        "limit": {
            "type": "integer",
            "description": "Maximum number of results to return (default: 10)",
            "default": 10
        }
    },
    "required": ["query"]
}

MEILI_CLIENT = None


def get_meilisearch_client(config: dict = None):
    global MEILI_CLIENT
    if MEILI_CLIENT is None:
        cfg = config or CONFIG.get("meilisearch", {})
        url = cfg.get("url") or os.getenv("MEILISEARCH_URL", "http://127.0.0.1:7700")
        api_key = cfg.get("api_key") or os.getenv("MEILISEARCH_API_KEY", "")
        MEILI_CLIENT = meilisearch.Client(url, api_key)
    return MEILI_CLIENT


def search_business_concepts(query: str, limit: int = 4) -> dict:
    try:
        config = CONFIG.get("meilisearch", {})
        client = get_meilisearch_client(config)
        if not client:
            return {"error": "Meilisearch client not initialized. Check CONFIG."}

        index = client.index("graph_onto")
        search_results = index.search(query, {
            "limit": limit,
            "hybrid": {
                "embedder": "default",
                "semanticRatio": 0.5
            }
        })

        return {
            "query": query,
            "hits": search_results.get("hits", []),
            "total_hits": search_results.get("estimatedTotalHits", 0)
        }
    except Exception as e:
        return {"error": str(e)}


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "knowledge_graph",
            "description": (
                "Run a single aggregated Cypher query against the knowledge graph. "
                "Prefer one query with GROUP BY, counts, and LIMIT. "
                "Use relationship paths from pre-fetched concepts. Max 3 calls per question."
            ),
            "parameters": KG_TOOL_SCHEMA
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_schema",
            "description": (
                "Search business concepts and schema definitions. "
                "ONLY use when pre-fetched concepts in the system prompt lack the metric, "
                "relationship path, or entity needed to answer. Do not use for general exploration."
            ),
            "parameters": BUSINESS_CONCEPTS_SCHEMA
        }
    }
]

TOOL_HANDLERS = {
    "knowledge_graph": execute_cypher,
    "search_schema": search_business_concepts,
}
