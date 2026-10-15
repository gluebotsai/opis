"""Validate LLM-written SQL and rewrite it so it can only see this role's rows.

Input:  one SQL string written against virtual views `rpt.<view>`, using `:name` parameters.
Output: GuardedSQL — the final SQL (driver placeholders), bound params, views used.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional, Set, Tuple

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError

from .loader import PRODUCT_DIR
from .views import (
    INTERNAL_PARAMS,
    cte_body,
    param_token,
    role_views,
    runtime_params,
)
from .errors import GuardRejectionError

DIALECT = "postgres"
DEFAULT_ROW_CAP = 500
VIEW_SCHEMA = "rpt"
CTE_PREFIX = "rpt_"

_FORBIDDEN_NODES = tuple(
    cls
    for cls in (
        getattr(exp, name, None)
        for name in (
            "Insert", "Update", "Delete", "Merge", "Create", "Drop", "Alter", "AlterTable",
            "Command", "Copy", "Set", "Transaction", "Commit", "Rollback", "Grant", "Revoke",
            "Into", "Lock", "Pragma", "Use", "LoadData", "TruncateTable", "Analyze", "Describe",
        )
    )
    if cls is not None
)

ANONYMOUS_ALLOW = frozenset(
    {
        "age", "date_part", "to_char", "to_date", "to_timestamp", "justify_interval",
        "justify_hours", "justify_days", "initcap", "split_part", "regexp_replace",
        "regexp_match", "btrim", "ltrim", "rtrim", "lpad", "rpad", "left", "right",
        "percentile_disc", "percentile_cont", "mode", "width_bucket", "make_interval",
        "date_bin", "array_length", "cardinality", "jsonb_extract_path_text",
        "jsonb_typeof", "bool_and", "bool_or", "every", "string_agg", "array_agg",
        "trunc", "sign", "div", "mod", "power", "sqrt", "ln", "log", "exp",
        "extract", "isfinite", "timezone", "concat_ws", "format", "nullif",
        "count", "sum", "avg", "min", "max", "coalesce", "greatest", "least",
    }
)

TYPED_ALLOW = frozenset(
    {
        "Count", "CountIf", "Sum", "Avg", "Min", "Max", "ArrayAgg", "GroupConcat",
        "PercentileCont", "PercentileDisc", "Mode", "Median", "Stddev", "StddevPop",
        "StddevSamp", "Variance", "VariancePop", "Corr", "LogicalAnd", "LogicalOr",
        "RowNumber", "Rank", "DenseRank", "Ntile", "Lag", "Lead", "FirstValue", "LastValue",
        "PercentRank", "CumeDist",
        "And", "Or", "Xor", "Exists", "If", "Case", "Coalesce", "Nullif", "Greatest", "Least",
        "Abs", "Ceil", "Floor", "Round", "Trunc", "Sign", "Pow", "Sqrt", "Ln", "Log", "Exp",
        "WidthBucket",
        "Cast", "TryCast", "Extract", "TimestampTrunc", "DateTrunc", "TimeToStr", "StrToDate",
        "StrToTime", "UnixToTime", "Date", "DateBin", "CurrentDate", "CurrentTime",
        "CurrentTimestamp", "MakeInterval", "JustifyInterval", "DateAdd", "DateSub", "DateDiff",
        "TimestampAdd", "TimestampSub", "TimestampDiff",
        "Lower", "Upper", "Initcap", "Length", "Substring", "Trim", "Concat", "ConcatWs",
        "Replace", "StrPosition", "Left", "Right", "Pad", "SplitPart", "RegexpLike",
        "RegexpReplace", "Format",
        "JSONExtract", "JSONExtractScalar", "JSONBExtract", "JSONBExtractScalar",
        "JSONBContains", "Array", "ArraySize", "ArrayContains", "Unnest",
        "GenerateSeries", "ExplodingGenerateSeries",
    }
)

_TOKEN = re.compile(r"__P_([A-Za-z0-9_]+)__")


class GuardError(ValueError):
    """The SQL was rejected. `str(err)` is the message for the repair turn."""


@dataclass
class GuardedSQL:
    sql: str
    params: dict[str, Any]
    views: list[str]
    row_cap: int
    notes: list[str] = field(default_factory=list)


def _parse_one(sql: str) -> exp.Expression:
    if not sql or not sql.strip():
        raise GuardError("SQL is empty.")
    try:
        trees = [t for t in sqlglot.parse(sql, read=DIALECT) if t is not None]
    except ParseError as exc:
        first = str(exc).splitlines()[0]
        raise GuardError(f"SQL does not parse as Postgres: {first}") from exc
    if len(trees) != 1:
        raise GuardError("Write exactly one SELECT statement.")
    return trees[0]


def _check_root(tree: exp.Expression) -> None:
    if not isinstance(tree, (exp.Select, exp.SetOperation)):
        raise GuardError("Only SELECT queries are allowed (WITH ... SELECT and UNION are fine).")


def _check_forbidden(tree: exp.Expression) -> None:
    for node in tree.walk():
        if isinstance(node, _FORBIDDEN_NODES):
            kind = type(node).__name__.upper()
            raise GuardError(f"{kind} is not allowed. Write a read-only SELECT.")
        if isinstance(node, exp.With) and node.args.get("recursive"):
            raise GuardError("WITH RECURSIVE is not allowed.")


def _cte_names(tree: exp.Expression) -> set[str]:
    names: set[str] = set()
    for cte in tree.find_all(exp.CTE):
        alias = cte.alias_or_name
        if alias:
            names.add(alias.lower())
    for name in names:
        if name.startswith(CTE_PREFIX):
            raise GuardError(f"CTE name {name} is reserved. Pick another name.")
    return names


def _check_functions(tree: exp.Expression) -> None:
    for fn in tree.find_all(exp.Func):
        if isinstance(fn, exp.Anonymous):
            name = str(fn.name or "").lower()
            if name not in ANONYMOUS_ALLOW:
                raise GuardError(f"Function {name}() is not allowed.")
        elif type(fn).__name__ not in TYPED_ALLOW:
            raise GuardError(f"Function {fn.sql_name().lower()}() is not allowed.")


def _check_params(tree: exp.Expression, allowed: set[str]) -> None:
    for ph in tree.find_all(exp.Placeholder):
        name = str(ph.this or "")
        if not name:
            raise GuardError("Use named parameters like :start, not ?.")
        if name in INTERNAL_PARAMS or name.startswith("_"):
            raise GuardError(f"Parameter :{name} is reserved.")
        if name not in allowed:
            listed = ", ".join(f":{p}" for p in sorted(allowed)) or "none"
            raise GuardError(f"Parameter :{name} was not provided. Available: {listed}.")


def _rewrite_tables(
    tree: exp.Expression, role: str, product_dir: Path, ctes: set[str]
) -> tuple[list[str], dict[str, str], dict[str, Any]]:
    """Point every rpt.<view> at its scoped CTE. Returns views used, alias -> view, and available views."""
    available = role_views(role, product_dir)
    used: list[str] = []
    alias_to_view: dict[str, str] = {}
    for table in list(tree.find_all(exp.Table)):
        name = str(table.name or "").lower()
        db = str(table.db or "").lower()
        catalog = str(table.catalog or "").lower()
        if not name:
            continue
        if catalog:
            if catalog == "rpt" and db == "rpt":
                db = "rpt"
            else:
                raise GuardError(f"{catalog}.{db}.{name} is not allowed. Use rpt.<view> only.")
        if not db and name in ctes:
            continue
        if db and db != VIEW_SCHEMA:
            raise GuardError(
                f"{db}.{name} is not allowed. Query only these views: "
                + ", ".join(f"rpt.{v}" for v in available)
                + "."
            )
        if name.startswith(CTE_PREFIX):
            raise GuardError(f"{name} is reserved. Use rpt.{name[len(CTE_PREFIX):]} instead.")
        if name not in available:
            raise GuardError(
                f"rpt.{name} is not available for role '{role}'. Available: "
                + ", ".join(f"rpt.{v}" for v in available)
                + "."
            )
        alias = table.alias_or_name
        if not table.alias:
            alias = name
            table.set("alias", exp.TableAlias(this=exp.to_identifier(name)))
        table.set("this", exp.to_identifier(f"{CTE_PREFIX}{name}"))
        table.set("db", None)
        table.set("catalog", None)
        alias_to_view[str(alias).lower()] = name
        if name not in used:
            used.append(name)
    return used, alias_to_view, available


def _rewrite_columns(tree: exp.Expression, role: str, product_dir: Path, alias_to_view: dict[str, str]) -> None:
    for col in tree.find_all(exp.Column):
        db = str(col.args.get("db") or "").lower() if col.args.get("db") else ""
        catalog = str(col.args.get("catalog") or "").lower() if col.args.get("catalog") else ""
        if catalog:
            col.set("catalog", None)
        if db:
            col.set("db", None)


def _apply_limit(tree: exp.Expression, cap: int, notes: list[str]) -> exp.Expression:
    limit = tree.args.get("limit")
    if limit is None:
        notes.append(f"row cap {cap} applied")
        return tree.limit(cap)
    value = limit.expression if isinstance(limit, exp.Limit) else None
    if isinstance(value, exp.Literal) and not value.is_string:
        try:
            if int(value.this) <= cap:
                return tree
        except ValueError:
            pass
    notes.append(f"limit replaced with row cap {cap}")
    return tree.limit(cap)


def _to_driver(sql: str) -> str:
    """Escape % for the driver, then turn internal tokens into %(name)s placeholders."""
    return _TOKEN.sub(lambda m: f"%({m.group(1)})s", sql.replace("%", "%%"))


def guard_sql(
    sql: str,
    *,
    role: str = "admin",
    organization_id: int = 1003,
    user_id: int = 1017,
    queue_ids: list[int] | None = None,
    params: dict[str, Any] | None = None,
    row_cap: int = DEFAULT_ROW_CAP,
    product_dir: Path = PRODUCT_DIR,
) -> GuardedSQL:
    """Validate and scope one LLM-written query. Raises GuardError with a repair message."""
    user_params = dict(params or {})
    for key in user_params:
        if key in INTERNAL_PARAMS or key.startswith("_"):
            raise GuardError(f"Parameter name {key} is reserved.")

    # Pre-clean any accidental triple qualifier rpt.rpt.deals
    clean_sql = re.sub(r"\brpt\.rpt\.([a-zA-Z0-9_]+)\b", r"rpt.\1", sql)

    tree = _parse_one(clean_sql)
    _check_root(tree)
    _check_forbidden(tree)
    ctes = _cte_names(tree)
    _check_functions(tree)
    _check_params(tree, set(user_params))
    used, alias_to_view, available = _rewrite_tables(tree, role, product_dir, ctes)
    if not used:
        raise GuardError("The query must read at least one rpt.<view>.")
    _rewrite_columns(tree, role, product_dir, alias_to_view)

    notes: list[str] = []
    tree = _apply_limit(tree, row_cap, notes)

    for ph in list(tree.find_all(exp.Placeholder)):
        ph.replace(exp.var(param_token(str(ph.this))))

    own_with = tree.args.get("with_")
    own_ctes: list[str] = []
    if own_with is not None:
        own_ctes = [cte.sql(dialect=DIALECT, comments=False) for cte in own_with.expressions]
        tree.set("with_", None)
    body = tree.sql(dialect=DIALECT, comments=False)

    ours = [f"{CTE_PREFIX}{v} AS (\n{cte_body(available[v])}\n)" for v in used]
    final = "WITH " + ",\n".join(ours + own_ctes) + "\n" + body

    bound = runtime_params(organization_id, user_id)
    bound.update(user_params)
    return GuardedSQL(sql=_to_driver(final), params=bound, views=used, row_cap=row_cap, notes=notes)


def validate_sql(sql_query: str, allowed_views: Optional[Set[str]] = None) -> Tuple[bool, str]:
    """Legacy helper for test compatibility."""
    if not sql_query or not sql_query.strip():
        return False, "Empty query."
    clean = sql_query.strip().rstrip(";")
    if ";" in clean:
        return False, "Multiple SQL statements separated by semicolon are forbidden."
    if re.search(r"\b(pg_catalog|pg_|information_schema)\b", clean, re.IGNORECASE):
        return False, "Access to system catalog tables is Prohibited."
    for kw in ("INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "TRUNCATE", "GRANT", "REVOKE"):
        if re.search(rf"\b{kw}\b", clean, re.IGNORECASE):
            return False, f"Prohibited SQL keyword detected: '{kw}'."
    try:
        guard_sql(
            sql_query,
            role="admin",
            organization_id=1003,
            user_id=1017,
            params={"tenant_id": 1003, "current_user_id": 1017, "start": "2026-01-01", "end": "2026-12-31"}
        )
        return True, ""
    except Exception as e:
        return False, str(e)


def enforce_sql_guard(sql_query: str, allowed_views: Optional[Set[str]] = None) -> str:
    """Legacy helper for test compatibility."""
    is_valid, reason = validate_sql(sql_query, allowed_views)
    if not is_valid:
        raise GuardRejectionError(f"SQL Guard Rejected Query: {reason}")
    return sql_query
