# ===============================tools.py=========================================

# ------------------------------------------Imports------------------------------------------
import datetime
import calendar
import re
import json
from pathlib import Path
import meilisearch
from neo4j import GraphDatabase


def _normalize_org_key(organization_id: str) -> str:
    """Normalize API organization_id to org1000-style key (no underscore)."""
    oid = str(organization_id).strip()
    if oid.startswith("org_"):
        return f"org{oid[4:]}"
    if oid.startswith("org"):
        return oid
    return f"org{oid}"


def org_db_name(organization_id: str) -> str:
    """Map API organization_id to Neo4j database name, e.g. '1000' -> 'org1000'."""
    return _normalize_org_key(organization_id)


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

_DATE_PARAMS = ("period_start", "period_end", "compare_start", "compare_end")

_DATETIME_PROP_PATTERN = "|".join(_ZONED_DATETIME_PROPS)
_LITERAL_DATETIME_RE = re.compile(
    r"datetime\(\s*['\"](\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z?)['\"]\s*\)",
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


def normalize_cypher_datetimes(cypher_query: str, period_params: dict[str, str]) -> str:
    """Normalize all date comparisons for Neo4j ZONED DATETIME properties."""
    cypher_query = _add_z_suffix_to_datetime_literals(cypher_query)
    cypher_query = _wrap_date_param_comparisons(cypher_query)
    return cypher_query


def _strip_org_filters_from_cypher(cypher_query: str) -> str:
    """Remove organization_id filters — each tenant Neo4j database is already scoped."""
    org_predicate = (
        r"(?:\w+\.)?organization_id\s*=\s*"
        r"(?:\$org_id|\$organization_id|['\"][^'\"]+['\"])"
    )
    # WHERE org_predicate AND ...
    query = re.sub(
        rf"\bWHERE\s+{org_predicate}\s+AND\s+",
        "WHERE ",
        cypher_query,
        flags=re.IGNORECASE,
    )
    # ... AND org_predicate
    query = re.sub(
        rf"\s+AND\s+{org_predicate}\b",
        "",
        query,
        flags=re.IGNORECASE,
    )
    # Lone WHERE org_predicate (before RETURN/WITH/ORDER/LIMIT/end)
    query = re.sub(
        rf"\bWHERE\s+{org_predicate}\s*(?=(?:RETURN|WITH|ORDER|LIMIT|$))",
        "",
        query,
        flags=re.IGNORECASE,
    )
    return query


def wrap_kg_handler(handler, organization_id: str, reference_date: str | None = None):
    """Bind tenant Neo4j database; strip org filters; inject standard date params."""
    default_db = org_db_name(organization_id)
    period_params = compute_period_params(reference_date)

    def wrapped(cypher_query: str, params: dict = None, db_name: str = None, **kwargs):
        kwargs.pop("db_name", None)
        merged_params = dict(params or {})
        merged_params.pop("org_id", None)
        merged_params.pop("organization_id", None)
        merged_params.update(period_params)
        cypher_query = _strip_org_filters_from_cypher(cypher_query)
        cypher_query = normalize_cypher_datetimes(cypher_query, period_params)
        return handler(
            cypher_query=cypher_query,
            params=merged_params,
            db_name=default_db,
            **kwargs,
        )

    return wrapped


def build_tool_handlers(
    organization_id: str,
    overrides: dict | None = None,
    reference_date: str | None = None,
) -> dict:
    """Return tool handlers with knowledge_graph bound to the tenant Neo4j database."""
    handlers = dict(TOOL_HANDLERS)
    if overrides:
        handlers.update({k: v for k, v in overrides.items() if k != "knowledge_graph"})
    handlers["knowledge_graph"] = wrap_kg_handler(
        TOOL_HANDLERS["knowledge_graph"], organization_id, reference_date
    )
    return handlers

# ------------------------------------------Meilisearch client------------------------------------------

CONFIG = {
    # "knowledge_graph": {
    #     "uri": "neo4j://192.168.11.25:7688",
    #     "user": "neo4j",
    #     "password": "India@321", 
    #     "db_name": "org1000"
    # },
    "knowledge_graph": {
            "uri": "neo4j://10.180.0.126:7687",
            "user": "neo4j",
            "password": "Neo4j@789", 
            # "db_name": "org1000"
        },
    "meilisearch": {
        "url": "http://192.168.11.156:7701",
        "api_key": "iamgroot"
    }
}

# ------------------------------------------Knowledge Graph Client------------------------------------------
class KGClient:
    _instance = None
    
    def __init__(self, uri: str, user: str, password: str):
        self.driver = GraphDatabase.driver(uri, auth=(user, password))
    
    @classmethod
    def get_instance(cls, config: dict = None):
        if cls._instance is None and config:
            kg_cfg = config.get("knowledge_graph", config)
            cls._instance = cls(
                kg_cfg.get('uri'),
                kg_cfg.get('user'),
                kg_cfg.get('password')
            )
        return cls._instance
    
    @classmethod
    def close(cls):
        if cls._instance:
            cls._instance.driver.close()
            cls._instance = None
    
    def execute_cypher(self, query: str, params: dict = None, db_name: str = None):
        session = self.driver.session(database=db_name) if db_name else self.driver.session()
        try:
            result = session.run(query, params)
            records = [dict(r) for r in result]
            result.consume()
            return records
        finally:
            session.close()

# ------------------------------------------Cypher Query Validation------------------------------------------
DANGEROUS_KEYWORDS = [
    'DELETE', 'DROP', 'DETACH DELETE', 'REMOVE', 
    'ALTER', 'CREATE INDEX', 'DROP INDEX',
    'SET LABEL', 'REMOVE LABEL'
]

_SCHEMA_REGISTRY_PATH = Path(__file__).resolve().parent.parent / "ontology" / "schema_registry.json"
_DEFAULT_AUTO_LIMIT = 50

# Legacy fallback if schema_registry.json is missing (core-only subset)
_FALLBACK_LABELS = {
    'Tenant', 'Role', 'Team', 'User', 'HolidayCalendar', 'BusinessHours', 'Channel',
    'Agent', 'Skill', 'Queue', 'RoutingPolicy', 'Disposition', 'SLA', 'ChannelAutomationPolicy',
    'Conversation', 'ConversationSummary', 'SLAInstance', 'Attachment', 'WorkNote',
    'ConversationParticipant', 'Assignment', 'Transfer', 'RoutingAttempt', 'WebchatSession',
    'Task', 'SharedNote', 'Contact', 'ContactPoint', 'CustomerScore', 'Insight',
    'Recommendation', 'Segment', 'Order', 'Offering', 'Product',
}
_FALLBACK_RELATIONSHIPS = {
    'DEFINES_ROLE', 'HAS_TEAM', 'FOLLOWS_HOURS', 'EMPLOYS', 'MEMBER_OF',
    'HAS_HOLIDAY_CALENDAR', 'HAS_BUSINESS_HOURS', 'USES_HOLIDAY_CALENDAR', 'SUPPORTS_CHANNEL',
    'HAS_AGENT', 'IS_AGENT_FOR', 'DEFINES_SKILL', 'HAS_SKILL', 'REQUIRES_SKILL',
    'HAS_QUEUE_OWNER', 'OWNED_BY_TEAM', 'OVERFLOWS_TO', 'DEFINES_DISPOSITION', 'RESULTED_IN',
    'DEFINES_SLA', 'HAS_SLA', 'BASED_ON', 'HAS_AUTOMATION_POLICY', 'DEFAULT_QUEUE',
    'HAS_CONVERSATION', 'PARTICIPATED_IN', 'IN_QUEUE', 'THROUGH', 'HANDLED_BY', 'ASSIGNED_USER',
    'CONTINUES_FROM', 'HAS_SUMMARY', 'HAS_ATTACHMENT', 'HAS_WORK_NOTE', 'AUTHORED',
    'HAS_PARTICIPANT', 'HAS_ASSIGNMENT', 'OFFERED_TO', 'FROM_QUEUE', 'HAS_TRANSFER',
    'TRANSFERRED_TO', 'HAS_ROUTING_ATTEMPT', 'TARGETED_QUEUE', 'OFFERED_AGENT',
    'HAS_WEBCHAT_SESSION', 'HAS_TASK', 'FROM_CONVERSATION', 'FOR_CONTACT', 'CREATED_BY',
    'HAS_SHARED_NOTE', 'WROTE_SHARED_NOTE', 'HAS_CONTACT', 'HAS_CONTACT_POINT', 'HAS_SCORES',
    'HAS_INSIGHT', 'HAS_RECOMMENDATION', 'DEFINES_SEGMENT', 'BELONGS_TO_SEGMENT', 'PLACED',
    'CONTAINS', 'OFFERS', 'HAS_ROUTING_POLICY',
}


def _load_schema_registry() -> tuple[set[str], set[str], set[str]]:
    if _SCHEMA_REGISTRY_PATH.exists():
        data = json.loads(_SCHEMA_REGISTRY_PATH.read_text(encoding="utf-8"))
        return set(data["labels"]), set(data["relationships"]), set(data["properties"])
    return _FALLBACK_LABELS, _FALLBACK_RELATIONSHIPS, set()


VALID_LABELS, VALID_RELATIONSHIPS, VALID_PROPERTIES = _load_schema_registry()

# Extend property allowlist with common Cypher/date helpers referenced in queries
VALID_PROPERTIES.update({
    'id', 'tenant_id', 'organization_id', 'created_at', 'updated_at', 'cdp_id',
    'stage', 'amount', 'title', 'total', 'issue_date', 'paid_at', 'closed_at',
    'lead_status', 'lead_source', 'domain', 'segment_name', 'outcome', 'end_reason',
    'queued_at', 'assigned_at', 'resolved_at', 'breached_at', 'churn_score',
    'first_name', 'last_name', 'name', 'status', 'channel', 'outcome',
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
            insertions = prev_row[j + 1] + 1
            deletions = curr_row[j] + 1
            substitutions = prev_row[j] + (ca != cb)
            curr_row.append(min(insertions, deletions, substitutions))
        prev_row = curr_row
    return prev_row[-1]


def find_closest_property(invalid_prop: str) -> str | None:
    best_match = None
    best_distance = float('inf')
    for prop in VALID_PROPERTIES:
        dist = levenshtein_distance(invalid_prop, prop)
        if dist < best_distance:
            best_distance = dist
            best_match = prop
    return best_match if best_distance <= 2 else None


def validate_properties(cypher_query: str) -> tuple[bool, str]:
    prop_pattern = r'\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?==|>)'
    props = re.findall(prop_pattern, cypher_query)
    for prop in props:
        if prop not in VALID_PROPERTIES:
            closest = find_closest_property(prop)
            if closest:
                return False, (
                    f"Invalid property name: '{prop}'. "
                    f"Did you mean: '{closest}'?"
                )
            else:
                return False, (
                    f"Invalid property name: '{prop}'. "
                    f"No similar property found in schema. "
                    f"Valid properties are listed in core.yaml."
                )
    return True, ""


def _strip_quoted_strings(cypher_query: str) -> str:
    """Remove string literals so datetime(':00:00Z') is not parsed as a node label."""
    return re.sub(r"'(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\"", "''", cypher_query)


class CypherValidator:
    @staticmethod
    def validate(cypher_query: str) -> tuple[bool, str]:
        query_upper = cypher_query.upper()
        
        for keyword in DANGEROUS_KEYWORDS:
            if keyword in query_upper:
                return False, f"Dangerous operation blocked: {keyword}"

        # Strip relationship patterns so [:REL_TYPE] is not mistaken for node labels
        query_for_labels = re.sub(r"\[[^\]]*\]", "", cypher_query)
        query_for_labels = _strip_quoted_strings(query_for_labels)
        label_pattern = r":(\w+)"
        labels = re.findall(label_pattern, query_for_labels)
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


def _ensure_limit(cypher_query: str, default_limit: int = _DEFAULT_AUTO_LIMIT) -> tuple[str, bool]:
    if re.search(r"\bLIMIT\b", cypher_query, re.IGNORECASE):
        return cypher_query, False
    trimmed = cypher_query.rstrip().rstrip(";")
    return f"{trimmed} LIMIT {default_limit}", True


# ------------------------------------------Tool_Functions------------------------------------------
def execute_cypher(cypher_query: str, params: dict = None, db_name: str = None) -> dict:
    print("-" * 50)
    print("Executing Cypher")
    if not db_name:
        return {"error": "Neo4j database not specified. Pass organization_id in the API request."}
    print(f"Neo4j database: {db_name}")
    print("-" * 50)
    is_valid, message = validate_properties(cypher_query)
    if not is_valid:
        return {"error": message}

    is_valid, message = CypherValidator.validate(cypher_query)
    if not is_valid:
        return {"error": message}

    cypher_query, auto_limited = _ensure_limit(cypher_query)
    
    try:
        config = CONFIG.get('knowledge_graph', {})
        if not KGClient.get_instance(config):
            return {"error": "Knowledge Graph client not initialized. Check CONFIG."}
        
        if db_name is None:
            return {"error": "Neo4j database not specified."}

        result = KGClient.get_instance().execute_cypher(cypher_query, params, db_name)
        
        # Deduplicate records to save context window
        seen = set()
        unique_records = []
        for record in result:
            d = dict(record)
            # convert dict to string for hashability
            s = json.dumps(d, sort_keys=True, default=str)
            if s not in seen:
                seen.add(s)
                unique_records.append(d)

        response = {"data": unique_records, "database": db_name}
        if auto_limited:
            response["auto_limited"] = True
            response["limit_applied"] = _DEFAULT_AUTO_LIMIT
        return response
    except Exception as e:
        return {"error": str(e)}

# ------------------------------------------Tool_Schemas------------------------------------------
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

# ------------------------------------------Meilisearch Client------------------------------------------
MEILI_CLIENT = None

def get_meilisearch_client(config: dict = None):
    global MEILI_CLIENT
    if MEILI_CLIENT is None and config:
        url = config.get('url', 'http://192.168.11.156:7701')
        api_key = config.get('api_key', 'iamgroot')
        MEILI_CLIENT = meilisearch.Client(url, api_key)
    return MEILI_CLIENT

# ------------------------------------------Meilisearch query execution function------------------------------------------
def search_business_concepts(query: str, limit: int = 4) -> dict:
    print("-"*50)
    print("Searching Index")
    print("-"*50)
    try:
        config = CONFIG.get('meilisearch', {})
        client = get_meilisearch_client(config)
        if not client:
            return {"error": "Meilisearch client not initialized. Check CONFIG."}
        
        index = client.index('graph_onto')
        search_results = index.search(query, {
            'limit': limit,
            'hybrid': {
                'embedder': 'default',
                'semanticRatio': 0.5
            }
        })
        
        return {
            "query": query,
            "hits": search_results.get('hits', []),
            "total_hits": search_results.get('estimatedTotalHits', 0)
        }
    except Exception as e:
        return {"error": str(e)}

# ------------------------------------------Cypher query execution function------------------------------------------

# ------------------------------------------Tools------------------------------------------
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

# ------------------------------------------Tool_handlers------------------------------------------
TOOL_HANDLERS = {
    "knowledge_graph": execute_cypher,
    "search_schema": search_business_concepts,
}  
  