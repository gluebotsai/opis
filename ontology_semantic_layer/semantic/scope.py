"""Row scope: ticketing uses ticketing.agents.id; other products use accounts.setup_users."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

try:
    import psycopg2
except ImportError:  # pragma: no cover
    psycopg2 = None  # type: ignore[assignment]

from semantic.lookup import get_metric_policy
from semantic.ticketing_scope import (
    is_ticketing_product,
    wants_personal_scope,
    uses_resolver_or_assignee,
)

PRODUCT_ACCESS_IDS = {
    "ccaas": "contact-center",
    "contact_centre": "contact-center",
    "aiccaas": "contact-center",
    "crm": "crm",
    "ticketing": "ticketing",
    "campaign": "campaign",
    "webtracking": "web-tracking",
    "cdp": "cdp",
    "hub": "hub",
}

# Metrics that share an id across products but scope differently.
_PRODUCT_SCOPE_ENTITY: dict[tuple[str, str], str] = {
    ("ccaas", "sla_breach_rate"): "",  # org-only — SLA state has no agent grain
    ("ticketing", "sla_breach_rate"): "ticket__assignee",
    ("ccaas", "missed_contact_rate"): "assignment__agent",
    ("ccaas", "average_handle_time"): "assignment__agent",
    ("ccaas", "total_conversations"): "conversation__agent",
}

_ORG_TICKETING_ROLES = frozenset({"admin", "viewer"})


def _load_dotenv() -> None:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip("'").strip('"')
        os.environ.setdefault(key, val)


@dataclass
class UserScope:
    user_id: str
    organization_id: str
    role: str = "agent"
    role_name: str | None = None
    team_id: str | None = None
    product_id: str | None = None
    visible_user_ids: list[str] = field(default_factory=list)
    my_queue_ids: list[str] = field(default_factory=list)
    identity: str = "accounts"  # ticketing → ticketing_agents


def _pg_conn():
    if psycopg2 is None:
        return None
    _load_dotenv()
    host = os.environ.get("pg_host") or os.environ.get("PG_HOST")
    if not host:
        return None
    from semantic.pg_pool import checkout_connection

    return checkout_connection()


def _manager_role_names() -> set[str]:
    raw = os.environ.get(
        "SCOPE_MANAGER_ROLES",
        "admin,manager,admin/manager,supervisor,team_lead",
    )
    return {r.strip().lower() for r in raw.split(",") if r.strip()}


def _access_product_id(product: str | None) -> str | None:
    if not product:
        return None
    return PRODUCT_ACCESS_IDS.get(product.strip().lower(), product.strip().lower())


def _lookup_ticketing_agent_scope(
    organization_id: int,
    user_id: int,
    *,
    product_id: str | None,
) -> UserScope:
    """Resolve scope from ticketing.agents — userId is agents.id, not setup_users.id."""
    uid = str(user_id)
    org = str(organization_id)
    scope = UserScope(
        user_id=uid,
        organization_id=org,
        visible_user_ids=[],
        product_id=product_id,
        identity="ticketing_agents",
    )

    conn = _pg_conn()
    if conn is None:
        scope.visible_user_ids = []
        return scope

    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, lower(role), status
                FROM ticketing.agents
                WHERE organization_id = %s AND id = %s
                LIMIT 1
                """,
                (organization_id, user_id),
            )
            row = cur.fetchone()
            if not row:
                # Fail closed — unknown agent id for this org.
                scope.visible_user_ids = []
                scope.role = "unknown"
                return scope

            _, role_raw, status = row
            if status and str(status).lower() not in ("active", "enabled", "1", "true"):
                scope.visible_user_ids = []
                scope.role = "inactive"
                return scope

            role = str(role_raw or "agent").strip().lower()
            scope.role = role
            scope.role_name = role
            cur.execute(
                """
                SELECT queue_id::text
                FROM ticketing.agent_queue_members
                WHERE organization_id = %s AND user_id = %s
                """,
                (organization_id, user_id),
            )
            scope.my_queue_ids = [str(row[0]) for row in cur.fetchall()]
            return scope
    except Exception:
        scope.visible_user_ids = []
        return scope
    finally:
        if conn is not None:
            from semantic.pg_pool import release_connection

            release_connection(conn)


def _lookup_accounts_scope(
    organization_id: int,
    user_id: int,
    *,
    product_id: str | None,
) -> UserScope:
    """Non-ticketing products: userId is accounts.setup_users.id."""
    uid = str(user_id)
    org = str(organization_id)
    scope = UserScope(user_id=uid, organization_id=org, visible_user_ids=[uid])
    scope.product_id = product_id
    scope.identity = "accounts"

    conn = _pg_conn()
    if conn is None:
        return scope

    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT u.id, u.team_id, r.name
                FROM accounts.setup_users u
                LEFT JOIN accounts.setup_user_product_access p
                  ON p.user_id = u.id AND p.organization_id = u.organization_id
                LEFT JOIN accounts.setup_roles r
                  ON r.id = p.role_id AND r.organization_id = u.organization_id
                WHERE u.id = %s AND u.organization_id = %s
                  AND (%s IS NULL OR p.product_id = %s)
                ORDER BY p.created_at DESC NULLS LAST
                LIMIT 1
                """,
                (user_id, organization_id, product_id, product_id),
            )
            row = cur.fetchone()
            if not row:
                return scope

            _, team_id, role_name = row
            scope.team_id = str(team_id) if team_id is not None else None
            if role_name:
                scope.role_name = str(role_name)
                scope.role = str(role_name).lower()

            if scope.role in _manager_role_names():
                if scope.team_id:
                    cur.execute(
                        """
                        SELECT id::text
                        FROM accounts.setup_users
                        WHERE organization_id = %s AND team_id = %s
                        """,
                        (organization_id, team_id),
                    )
                    team_ids = [r[0] for r in cur.fetchall()]
                    if team_ids:
                        scope.visible_user_ids = sorted(set(team_ids) | {uid})
                else:
                    cur.execute(
                        """
                        SELECT DISTINCT u.id::text
                        FROM accounts.setup_users u
                        JOIN accounts.setup_user_product_access p
                          ON p.user_id = u.id AND p.organization_id = u.organization_id
                        WHERE u.organization_id = %s
                          AND (%s IS NULL OR p.product_id = %s)
                        """,
                        (organization_id, product_id, product_id),
                    )
                    org_ids = [r[0] for r in cur.fetchall()]
                    if org_ids:
                        scope.visible_user_ids = sorted(set(org_ids))
            return scope
    except Exception:
        return scope
    finally:
        if conn is not None:
            from semantic.pg_pool import release_connection

            release_connection(conn)


def lookup_user_scope(
    organization_id: int,
    user_id: int,
    *,
    product: str | None = None,
) -> UserScope:
    """Resolve caller scope. Ticketing: agents.id; other products: setup_users.id."""
    product_id = _access_product_id(product)
    if is_ticketing_product(product):
        return _lookup_ticketing_agent_scope(
            organization_id, user_id, product_id=product_id
        )
    return _lookup_accounts_scope(organization_id, user_id, product_id=product_id)


def apply_ticketing_visible_ids(
    scope: UserScope,
    *,
    data_scope: str | None = None,
    filters: list[dict[str, Any]] | None = None,
) -> UserScope:
    """Set visible_user_ids for ticketing based on role default or explicit dataScope."""
    if scope.identity != "ticketing_agents":
        return scope
    from semantic.ticketing_scope import visible_ids_for_ticketing

    scope.visible_user_ids = visible_ids_for_ticketing(
        scope.user_id,
        scope.role,
        data_scope=data_scope,
        filters=filters,
    )
    return scope


def _entity_base_from_policy(policy: dict[str, Any]) -> str:
    on = str(policy.get("on") or "").strip()
    if on.startswith("wt:"):
        return on.split(":", 1)[1].lower()
    return "deal"


def _scope_entity_for_metric(
    policy: dict[str, Any],
    *,
    metric_id: str,
    product: str | None,
) -> str | None:
    """Return MetricFlow entity path (e.g. ticket__assignee) or None for org-only."""
    prod = (product or "").strip().lower()
    override = _PRODUCT_SCOPE_ENTITY.get((prod, metric_id))
    if override is not None:
        return override or None

    explicit = policy.get("scope_entity")
    if explicit:
        return str(explicit).strip()

    metric_scope = (policy.get("scope") or "org").lower()
    if metric_scope == "org":
        return None

    base = _entity_base_from_policy(policy)
    if metric_scope in ("owner", "owner_or_team"):
        return f"{base}__owner"
    if metric_scope == "created_by":
        return "ticket__created_by"
    if metric_scope == "assignee_or_team":
        if base == "ticket":
            return "ticket__assignee"
        if base in ("interaction", "conversation"):
            return "conversation__agent"
    return None


def row_scope_filter_clauses(
    scope: UserScope,
    *,
    metric_id: str,
    product: str | None = None,
    data_scope: str | None = None,
    filters: list[dict[str, Any]] | None = None,
) -> list[str]:
    """Return MetricFlow where fragments for row-level scope (may be empty for org scope)."""
    policy = get_metric_policy(metric_id, product=product)
    metric_scope = (policy.get("scope") or "org").lower()
    from semantic.ticketing_scope import _CREATED_BY_METRICS, effective_sql_scope

    if is_ticketing_product(product) and (metric_id or "") in _CREATED_BY_METRICS:
        quoted = f"'{scope.user_id}'"
        return [f"{{{{ Entity('ticket__created_by') }}}} IN ({quoted})"]
    if metric_scope == "org":
        return []

    prod = (product or "").strip().lower()
    if is_ticketing_product(prod):
        sql_mode, _dual = effective_sql_scope(
            scope.role,
            metric_id,
            product=prod,
            data_scope=data_scope,
            filters=filters,
            user_id=scope.user_id,
        )
        if sql_mode == "created_by" or (metric_id or "") in _CREATED_BY_METRICS:
            quoted = f"'{scope.user_id}'"
            return [f"{{{{ Entity('ticket__created_by') }}}} IN ({quoted})"]
        personal = wants_personal_scope(
            scope.role,
            data_scope=data_scope,
            filters=filters,
            user_id=scope.user_id,
        )
        if not personal or sql_mode != "assignee":
            return []
        # MF ticket model: assignee entity = agents.id.
        entity_path = _scope_entity_for_metric(
            policy, metric_id=metric_id, product=product
        )
        if not entity_path:
            return []
        quoted = f"'{scope.user_id}'"
        return [f"{{{{ Entity('{entity_path}') }}}} IN ({quoted})"]

    entity_path = _scope_entity_for_metric(policy, metric_id=metric_id, product=product)
    if not entity_path:
        return []

    ids = scope.visible_user_ids or [scope.user_id]
    quoted = ", ".join(f"'{x}'" for x in ids)
    return [f"{{{{ Entity('{entity_path}') }}}} IN ({quoted})"]


def owner_filter_clauses(
    scope: UserScope,
    *,
    metric_id: str,
    product: str | None = None,
    data_scope: str | None = None,
    filters: list[dict[str, Any]] | None = None,
) -> list[str]:
    """Backward-compatible alias for row_scope_filter_clauses."""
    return row_scope_filter_clauses(
        scope,
        metric_id=metric_id,
        product=product,
        data_scope=data_scope,
        filters=filters,
    )


def scope_summary(scope: UserScope) -> dict[str, Any]:
    return {
        "userId": scope.user_id,
        "role": scope.role,
        "roleName": scope.role_name,
        "teamId": scope.team_id,
        "productId": scope.product_id,
        "visibleUserIds": scope.visible_user_ids,
        "myQueueIds": scope.my_queue_ids,
        "identity": scope.identity,
    }
