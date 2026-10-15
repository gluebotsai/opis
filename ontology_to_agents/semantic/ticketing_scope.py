"""Ticketing row scope — userId is ticketing.agents.id (not accounts.setup_users.id)."""

from __future__ import annotations

from typing import Any, Literal

from semantic.lookup import get_metric_policy

TicketingDataScope = Literal["org", "mine"]
ScopeMode = Literal["org", "assignee", "team", "created_by"]

_ORG_ROLES = frozenset({"admin", "viewer"})
_AGENT_ROLE = "agent"
_RESOLVER_ROLE = "resolver"
_CREATED_BY_METRICS = frozenset({"tickets_created_by_me"})


def is_ticketing_product(product: str | None) -> bool:
    return (product or "").strip().lower() in ("ticketing",)


def wants_personal_scope(
    role: str,
    *,
    data_scope: TicketingDataScope | str | None = None,
    filters: list[dict[str, Any]] | None = None,
    user_id: str | None = None,
) -> bool:
    """True when ticket row filters should restrict to the caller's agents.id."""
    if data_scope:
        ds = str(data_scope).strip().lower()
        if ds in ("mine", "personal", "assignee", "created_by"):
            return True
        if ds in ("org", "organization", "overall"):
            return False

    uid = str(user_id or "")
    for flt in filters or []:
        dim = str(flt.get("dimension") or flt.get("column") or "").strip().lower()
        if dim not in ("assignee_id", "assignee", "created_by_id", "created_by"):
            continue
        op = str(flt.get("op") or "eq").lower()
        vals = flt.get("values") or []
        if not vals and flt.get("value") is not None:
            vals = [flt["value"]]
        if op in ("eq", "=", "in") and any(str(v) == uid for v in vals):
            return True

    role_l = (role or "agent").strip().lower()
    if role_l in _ORG_ROLES:
        return False
    return True


def uses_resolver_or_assignee(role: str, *, personal: bool) -> bool:
    """Resolver (and admin/viewer personal) match assignee_id OR resolver_id."""
    if not personal:
        return False
    role_l = (role or "").strip().lower()
    return role_l == _RESOLVER_ROLE or role_l in _ORG_ROLES


def effective_sql_scope(
    role: str,
    metric_id: str,
    *,
    product: str,
    data_scope: TicketingDataScope | str | None = None,
    filters: list[dict[str, Any]] | None = None,
    user_id: str | None = None,
) -> tuple[ScopeMode, bool]:
    """Return (sql scope mode, dual_assignee_resolver_predicate)."""
    if (metric_id or "") in _CREATED_BY_METRICS:
        return "created_by", False
    pol = get_metric_policy(metric_id, product=product)
    pol_scope = (pol.get("scope") or "org").lower()
    ds = str(data_scope or "").strip().lower()
    if ds in ("created_by",) or pol_scope == "created_by":
        return "created_by", False
    explicit_mine = ds in ("mine", "personal", "assignee")
    explicit_org = ds in ("org", "organization", "overall")

    # Caller override wins over metric policy (except created_by metrics above).
    if explicit_org:
        return "org", False
    if explicit_mine:
        dual = uses_resolver_or_assignee(role, personal=True)
        return "assignee", dual

    # Org-certified KPIs stay org-wide unless overridden above.
    if pol_scope == "org":
        return "org", False

    personal = wants_personal_scope(
        role,
        data_scope=None,
        filters=filters,
        user_id=user_id,
    )
    if not personal:
        return "org", False
    dual = uses_resolver_or_assignee(role, personal=True)
    return "assignee", dual


def ticketing_row_scope_clause(
    *,
    scope_mode: ScopeMode | str,
    visible_user_ids: list[str],
    row_scope_column: str | None,
    role: str,
    dual_assignee_resolver: bool = False,
    my_queue_ids: list[str] | None = None,
    table_alias: str = "",
) -> tuple[str, list[object]]:
    """Parameterized SQL fragment for ticket person / team filters."""
    prefix = f"{table_alias}." if table_alias else ""
    mode = (scope_mode or "org").strip().lower()
    if mode == "created_by":
        if not visible_user_ids:
            return "FALSE", []
        placeholders = ", ".join("%s" for _ in visible_user_ids)
        params: list[object] = [str(x) for x in visible_user_ids]
        return f"{prefix}created_by_id IN ({placeholders})", params
    if mode == "team" and my_queue_ids:
        placeholders = ", ".join("%s" for _ in my_queue_ids)
        params: list[object] = [str(x) for x in my_queue_ids]
        me_placeholders = ", ".join("%s" for _ in visible_user_ids) if visible_user_ids else None
        team_part = f"{prefix}queue_id IN ({placeholders})"
        if me_placeholders and visible_user_ids:
            if dual_assignee_resolver:
                person_part = (
                    f"({prefix}{row_scope_column} IN ({me_placeholders}) "
                    f"OR {prefix}resolver_id IN ({me_placeholders}))"
                )
            else:
                person_part = f"{prefix}{row_scope_column} IN ({me_placeholders})"
            return f"({team_part} OR {person_part})", params + list(visible_user_ids) * (
                2 if dual_assignee_resolver else 1
            )
        return team_part, params

    if mode != "assignee" or not visible_user_ids or not row_scope_column:
        return "", []
    placeholders = ", ".join("%s" for _ in visible_user_ids)
    params = [str(x) for x in visible_user_ids]
    col = f"{prefix}{row_scope_column}" if prefix else row_scope_column
    if dual_assignee_resolver:
        resolver_col = f"{prefix}resolver_id" if prefix else "resolver_id"
        return (
            f"({col} IN ({placeholders}) OR {resolver_col} IN ({placeholders}))",
            params + params,
        )
    return f"{col} IN ({placeholders})", params


def visible_ids_for_ticketing(
    user_id: str,
    role: str,
    *,
    data_scope: TicketingDataScope | str | None = None,
    filters: list[dict[str, Any]] | None = None,
) -> list[str]:
    """Org-default admin/viewer → empty; personal → [agents.id]."""
    if not wants_personal_scope(
        role, data_scope=data_scope, filters=filters, user_id=user_id
    ):
        return []
    return [str(user_id)]


def job_scope_fields(
    scope: Any,
    metric_id: str,
    *,
    product: str,
    data_scope: TicketingDataScope | str | None = None,
    filters: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build ExecutorJob scope fields for ticketing (or passthrough for other products)."""
    if not is_ticketing_product(product):
        from semantic.sql.agent_policy import metric_scope_mode

        mode = metric_scope_mode(metric_id, product)
        return {
            "scope": mode,
            "visible_user_ids": list(scope.visible_user_ids or [scope.user_id]),
            "caller_role": getattr(scope, "role", None),
            "scope_dual_assignee_resolver": False,
        }

    requested = str(data_scope or "").strip().lower() or None
    if (metric_id or "") in _CREATED_BY_METRICS or requested == "created_by":
        return {
            "scope": "created_by",
            "visible_user_ids": [str(scope.user_id)],
            "caller_role": scope.role,
            "scope_dual_assignee_resolver": False,
        }

    sql_mode, dual = effective_sql_scope(
        scope.role,
        metric_id,
        product=product,
        data_scope=data_scope,
        filters=filters,
        user_id=scope.user_id,
    )
    visible = visible_ids_for_ticketing(
        scope.user_id,
        scope.role,
        data_scope=data_scope,
        filters=filters,
    )
    if sql_mode in ("assignee", "created_by") and not visible:
        visible = [str(scope.user_id)]
    return {
        "scope": sql_mode,
        "visible_user_ids": visible,
        "caller_role": scope.role,
        "scope_dual_assignee_resolver": dual,
    }


def list_scope_fields(
    scope: Any,
    *,
    product: str,
    list_scope: str,
    personal_intent: bool = False,
) -> dict[str, Any]:
    """Scope fields for SQL list jobs (ticketing agents.id)."""
    if not is_ticketing_product(product):
        return {
            "scope": list_scope,
            "visible_user_ids": list(scope.visible_user_ids or [scope.user_id]),
            "caller_role": getattr(scope, "role", None),
            "scope_dual_assignee_resolver": False,
            "my_queue_ids": [],
        }
    role_l = (scope.role or "agent").strip().lower()
    my_queues = list(getattr(scope, "my_queue_ids", None) or [])

    if list_scope == "created_by":
        return {
            "scope": "created_by",
            "visible_user_ids": [str(scope.user_id)],
            "caller_role": scope.role,
            "scope_dual_assignee_resolver": False,
            "my_queue_ids": my_queues,
        }
    if list_scope == "team":
        visible = [str(scope.user_id)]
        dual = role_l == _RESOLVER_ROLE or (role_l in _ORG_ROLES and personal_intent)
        return {
            "scope": "team",
            "visible_user_ids": visible,
            "caller_role": scope.role,
            "scope_dual_assignee_resolver": dual,
            "my_queue_ids": my_queues,
        }
    if list_scope != "assignee":
        return {
            "scope": "org",
            "visible_user_ids": [],
            "caller_role": scope.role,
            "scope_dual_assignee_resolver": False,
            "my_queue_ids": my_queues,
        }
    visible = [str(scope.user_id)]
    dual = role_l == _RESOLVER_ROLE or (role_l in _ORG_ROLES and personal_intent)
    return {
        "scope": "assignee",
        "visible_user_ids": visible,
        "caller_role": scope.role,
        "scope_dual_assignee_resolver": dual,
        "my_queue_ids": my_queues,
    }
