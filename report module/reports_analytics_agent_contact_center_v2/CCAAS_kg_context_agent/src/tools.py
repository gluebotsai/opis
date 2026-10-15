# ===============================tools.py=========================================

import datetime
import calendar
import re
import json
import os
from pathlib import Path
import meilisearch
from neo4j import GraphDatabase

# ------------------------------------------Configurations------------------------------------------
ROOT = Path(__file__).resolve().parent.parent

NEO4J_URI = os.getenv("NEO4J_URI", "neo4j://10.180.0.126:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "Neo4j@789")

MEILI_URL = os.getenv("MEILISEARCH_URL", "http://82.113.92.44:7700")
MEILI_KEY = os.getenv("MEILISEARCH_API_KEY", "Worktual-123")
MEILI_INDEX = os.getenv("MEILISEARCH_INDEX", "kg_ccaas")

CONFIG = {
    "knowledge_graph": {
        "uri": NEO4J_URI,
        "user": NEO4J_USER,
        "password": NEO4J_PASSWORD,
    },
    "meilisearch": {
        "url": MEILI_URL,
        "api_key": MEILI_KEY,
        "index_name": MEILI_INDEX,
    }
}


def _normalize_org_key(organization_id: str) -> str:
    """Normalize API organization_id to org1000-style key (no underscore)."""
    oid = str(organization_id).strip()
    if oid.startswith("org_"):
        return f"org{oid[4:]}"
    if oid.startswith("org"):
        return oid
    return f"org{oid}"


def org_db_name(organization_id: str) -> str:
    """Map API organization_id to Neo4j database name, e.g. '1012' -> 'org1012'."""
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
    "closed_at",
    "queued_at",
    "first_agent_response_at",
    "first_response_due_at",
    "resolution_due_at",
    "missed_at",
    "offered_at",
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
    query = re.sub(rf"\bWHERE\s+{org_predicate}\s+AND\s+", "WHERE ", cypher_query, flags=re.IGNORECASE)
    query = re.sub(rf"\s+AND\s+{org_predicate}\b", "", query, flags=re.IGNORECASE)
    query = re.sub(rf"\bWHERE\s+{org_predicate}\s*(?=(?:RETURN|WITH|ORDER|LIMIT|$))", "", query, flags=re.IGNORECASE)
    return query


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
                kg_cfg.get("uri"),
                kg_cfg.get("user"),
                kg_cfg.get("password")
            )
        return cls._instance

    @classmethod
    def close(cls):
        if cls._instance:
            cls._instance.driver.close()
            cls._instance = None

    def execute_cypher(self, query: str, params: dict = None, db_name: str = None, timeout: float = 7.0):
        session = self.driver.session(database=db_name) if db_name else self.driver.session()
        try:
            result = session.run(query, params, timeout=timeout)
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

_SCHEMA_REGISTRY_PATH = ROOT / "ontology" / "schema_registry.json"
_DEFAULT_AUTO_LIMIT = 50


def _load_schema_registry() -> tuple[set[str], set[str], set[str]]:
    if _SCHEMA_REGISTRY_PATH.exists():
        try:
            data = json.loads(_SCHEMA_REGISTRY_PATH.read_text(encoding="utf-8"))
            return (
                set(data.get("labels", [])),
                set(data.get("relationships", [])),
                set(data.get("properties", [])),
            )
        except Exception:
            pass
    return set(), set(), set()


VALID_LABELS, VALID_RELATIONSHIPS, VALID_PROPERTIES = _load_schema_registry()


def _ensure_limit(cypher_query: str, default_limit: int = _DEFAULT_AUTO_LIMIT) -> tuple[str, bool]:
    has_limit = bool(re.search(r"\bLIMIT\b", cypher_query, flags=re.IGNORECASE))
    if not has_limit:
        return f"{cypher_query.rstrip().rstrip(';')} LIMIT {default_limit}", True
    return cypher_query, False


class CypherValidator:
    @staticmethod
    def validate(cypher_query: str) -> tuple[bool, str]:
        query_upper = cypher_query.upper()
        for keyword in DANGEROUS_KEYWORDS:
            if keyword in query_upper:
                return False, f"Dangerous operation blocked: {keyword}"

        # Strip relationship patterns so [:REL_TYPE] is not mistaken for node labels
        query_for_labels = re.sub(r"\[[^\]]*\]", "", cypher_query)
        label_pattern = r":([A-Za-z_]\w*)"
        labels = re.findall(label_pattern, query_for_labels)
        for label in labels:
            if VALID_LABELS and label not in VALID_LABELS:
                return False, f"Invalid CCaaS label: {label}. Valid labels: {', '.join(sorted(VALID_LABELS)[:15])}..."

        rel_pattern = r"-\[.*?:`?(\w+)`?\]-|<-\[.*?:`?(\w+)`?\]"
        rels = re.findall(rel_pattern, cypher_query)
        for rel_tuple in rels:
            for rel in rel_tuple:
                if rel and VALID_RELATIONSHIPS and rel not in VALID_RELATIONSHIPS:
                    return False, f"Invalid CCaaS relationship type: {rel}"

        return True, "Valid"


# ------------------------------------------Product Scope Guard (CCaaS)------------------------------------------
_SCOPE_PATH = ROOT / "ontology" / "scope.json"
_SCOPE = json.loads(_SCOPE_PATH.read_text(encoding="utf-8")) if _SCOPE_PATH.exists() else {
    "excluded_products": ["Marketing", "Sales", "Support", "WebTracking"]
}
_SCOPE_EXCLUSION = "&".join(f"!{p}" for p in _SCOPE.get("excluded_products", ["Marketing", "Sales", "Support", "WebTracking"]))
_NODE_BODY_RE = re.compile(r"^\s*(?P<var>[A-Za-z_][A-Za-z0-9_]*)?\s*(?P<labels>:[^{}]*?)?\s*(?P<props>\{.*\})?\s*$", re.S)


def apply_product_scope(query: str) -> tuple[bool, str]:
    """
    Enforces product scope on every node pattern in Cypher query.
    Appends negation tags to block out-of-scope products (Marketing, Sales, Support, WebTracking).
    """
    if "CALL" in query.upper() and ("APOC." in query.upper() or "DB." in query.upper()):
        return False, "Procedure calls are not permitted."

    def _rewrite_node(match: re.Match) -> str:
        body = match.group(1)
        m = _NODE_BODY_RE.match(body)
        if not m:
            return match.group(0)

        var = m.group("var") or ""
        labels_part = m.group("labels") or ""
        props = m.group("props") or ""

        # Inject scope exclusions
        if labels_part:
            new_labels = f"{labels_part}&{_SCOPE_EXCLUSION}"
        else:
            new_labels = f":{_SCOPE_EXCLUSION}"

        parts = [p for p in [var + new_labels, props] if p]
        return f"({' '.join(parts)})"

    # Match simple node patterns (var:Label)
    scoped_query = re.sub(r"(?<![A-Za-z0-9_])\(([A-Za-z0-9_:\s&!{}'\"]+?)\)", _rewrite_node, query)
    return True, scoped_query


# ------------------------------------------Tool Handlers & Execution------------------------------------------
def execute_cypher(cypher_query: str, params: dict = None, db_name: str = None, timeout_seconds: float = 7.0) -> dict:
    if not db_name:
        return {"error": "Neo4j database not specified. Pass organization_id in request."}

    is_valid, msg = CypherValidator.validate(cypher_query)
    if not is_valid:
        return {"error": msg}

    in_scope, scoped_cypher = apply_product_scope(cypher_query)
    if not in_scope:
        return {"error": scoped_cypher}
    cypher_query = scoped_cypher

    cypher_query, auto_limited = _ensure_limit(cypher_query)

    try:
        config = CONFIG.get("knowledge_graph", {})
        client = KGClient.get_instance(config)
        if not client:
            return {"error": "Knowledge Graph client not initialized."}

        records = client.execute_cypher(cypher_query, params, db_name, timeout=timeout_seconds)
        response = {"data": records, "database": db_name}
        if auto_limited:
            response["auto_limited"] = True
            response["limit_applied"] = _DEFAULT_AUTO_LIMIT
        return response
    except Exception as e:
        return {"error": str(e)}


# ------------------------------------------Meilisearch Client & Search------------------------------------------
MEILI_CLIENT = None


def get_meilisearch_client():
    global MEILI_CLIENT
    if MEILI_CLIENT is None:
        cfg = CONFIG.get("meilisearch", {})
        MEILI_CLIENT = meilisearch.Client(cfg["url"], cfg["api_key"])
    return MEILI_CLIENT


def search_business_concepts(query: str, limit: int = 8) -> dict:
    try:
        client = get_meilisearch_client()
        cfg = CONFIG.get("meilisearch", {})
        
        # Search primary index
        primary_index_name = cfg.get("index_name", "kg_ccaas")
        primary_index = client.index(primary_index_name)
        primary_results = primary_index.search(query, {
            "limit": limit,
            "hybrid": {"embedder": "default", "semanticRatio": 0.5}
        })
        
        # Search CDP index to enrich with cross-domain knowledge
        cdp_index = client.index("kg_cdp")
        try:
            cdp_results = cdp_index.search(query, {
                "limit": max(2, limit // 3),
                "hybrid": {"embedder": "default", "semanticRatio": 0.5}
            })
            cdp_hits = cdp_results.get("hits", [])
        except Exception as cdp_e:
            print(f"Warning: CDP search failed - {cdp_e}")
            cdp_hits = []
            
        combined_hits = primary_results.get("hits", []) + cdp_hits
        
        return {
            "query": query,
            "hits": combined_hits[:limit],
            "total_hits": primary_results.get("estimatedTotalHits", 0) + len(cdp_hits)
        }
    except Exception as e:
        return {"error": str(e), "hits": []}

# ------------------------------------------Tool Schemas------------------------------------------
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "knowledge_graph",
            "description": (
                "Run a single aggregated Cypher query against the CCaaS knowledge graph. "
                "Always aggregate in the database (COUNT, AVG, SUM, GROUP BY). "
                "Always use datetime($period_start) / datetime($period_end) for time filtering. "
                "Segment handle times by channel. Limit rows returned."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "cypher_query": {
                        "type": "string",
                        "description": "The Cypher query to execute on the CCaaS knowledge graph."
                    },
                    "params": {
                        "type": "object",
                        "description": "Optional parameters for the query.",
                        "default": {}
                    }
                },
                "required": ["cypher_query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_schema",
            "description": (
                "Search CCaaS business concepts and schema definitions. "
                "Use when pre-fetched concepts lack the necessary metric definition or relationship path."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query to find CCaaS business concepts, node labels, or relationships."
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of results to return (default: 4)",
                        "default": 4
                    }
                },
                "required": ["query"]
            }
        }
    }
]

TOOL_HANDLERS = {
    "knowledge_graph": execute_cypher,
    "search_schema": search_business_concepts,
}


def wrap_kg_handler(
    handler,
    organization_id: str,
    user_id: str = "default",
    reference_date: str | None = None,
    period_params: dict | None = None,
):
    """Binds tenant database, strips org filters, injects date params."""
    default_db = org_db_name(organization_id)
    period_params = dict(period_params) if period_params else compute_period_params(reference_date)

    def wrapped(cypher_query: str, params: dict = None, db_name: str = None, **kwargs):
        merged_params = dict(params or {})
        merged_params.pop("org_id", None)
        merged_params.pop("organization_id", None)
        merged_params.update(period_params)
        merged_params["user_id"] = user_id

        cypher_query = _strip_org_filters_from_cypher(cypher_query)
        cypher_query = normalize_cypher_datetimes(cypher_query, period_params)

        return handler(
            cypher_query=cypher_query,
            params=merged_params,
            db_name=default_db,
            **kwargs
        )
    return wrapped


def build_tool_handlers(
    organization_id: str,
    user_id: str = "default",
    reference_date: str | None = None,
    period_params: dict | None = None,
) -> dict:
    handlers = dict(TOOL_HANDLERS)
    handlers["knowledge_graph"] = wrap_kg_handler(
        TOOL_HANDLERS["knowledge_graph"],
        organization_id,
        user_id,
        reference_date,
        period_params=period_params,
    )
    return handlers
