"""Validate LLM-written SQL and rewrite it onto this role's scoped rpt.* CTEs."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError

from ..loader import PRODUCT_DIR
from .views import (
    INTERNAL_PARAMS,
    cte_body,
    param_token,
    role_views,
    runtime_params,
    scope_dependencies,
)

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
        "generate_series", "date_trunc", "now",
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
        "Anonymous",
    }
)

_TOKEN = re.compile(r"__P_([A-Za-z0-9_]+)__")


class GuardError(ValueError):
    """The SQL was rejected. str(err) is the message for the repair turn."""


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
) -> tuple[list[str], dict[str, str]]:
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
                f"rpt.{name} is not available for this user. Available: "
                + ", ".join(f"rpt.{v}" for v in available)
                + "."
            )
        alias = table.alias_or_name
        if not table.alias:
            alias = name
            table.set("alias", exp.TableAlias(this=exp.to_identifier(name)))
        table.set("this", exp.to_identifier(f"{CTE_PREFIX}{name}"))
        table.set("db", None)
        alias_to_view[str(alias).lower()] = name
        if name not in used:
            used.append(name)
    return used, alias_to_view


def _rewrite_columns(
    tree: exp.Expression, role: str, product_dir: Path, alias_to_view: dict[str, str]
) -> None:
    available = role_views(role, product_dir)
    select_aliases = {str(a.alias).lower() for a in tree.find_all(exp.Alias) if a.alias}
    col_to_views: dict[str, list[str]] = {}
    for view_name, rv in available.items():
        if view_name in alias_to_view.values():
            for col_name in rv.exposed:
                col_to_views.setdefault(col_name, []).append(view_name)

    for col in tree.find_all(exp.Column):
        db = str(col.args.get("db") or "").lower() if col.args.get("db") else ""
        table = str(col.table or "").lower()
        name = str(col.name or "").lower()
        if isinstance(col.this, exp.Star) or name == "*":
            continue
        if db:
            if db != VIEW_SCHEMA:
                raise GuardError(f"{db}.{table}.{name} is not allowed. Use rpt.<view> only.")
            col.set("db", None)
        if table and table in alias_to_view:
            view = alias_to_view[table]
            exposed = {c.lower() for c in available[view].exposed}
            if name not in exposed:
                raise GuardError(
                    f"Column {name} is not in rpt.{view}. Available: "
                    + ", ".join(sorted(available[view].exposed))
                    + "."
                )
        elif not table:
            if name in select_aliases:
                continue
            if len(alias_to_view) == 1:
                view = next(iter(alias_to_view.values()))
                exposed = {c.lower() for c in available[view].exposed}
                if name and name not in exposed:
                    raise GuardError(
                        f"Column '{name}' is not in rpt.{view}. Available: "
                        + ", ".join(sorted(available[view].exposed))
                        + "."
                    )


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
    return _TOKEN.sub(lambda m: f"%({m.group(1)})s", sql.replace("%", "%%"))


def _with_dependencies(used: list[str], role: str, product_dir: Path) -> list[str]:
    available = role_views(role, product_dir)
    ordered: list[str] = []

    def add(name: str) -> None:
        if name in ordered:
            return
        rv = available.get(name)
        if rv is None:
            return
        for dep in scope_dependencies(rv.scope):
            add(dep)
        ordered.append(name)

    for name in used:
        add(name)
    return ordered


def guard_sql(
    sql: str,
    *,
    role: str,
    organization_id: int,
    user_id: int,
    queue_ids: list[int] | None = None,
    params: dict[str, Any] | None = None,
    row_cap: int = DEFAULT_ROW_CAP,
    product_dir: Path = PRODUCT_DIR,
    apply_row_cap: bool = True,
) -> GuardedSQL:
    user_params = dict(params or {})
    for key in user_params:
        if key in INTERNAL_PARAMS or key.startswith("_"):
            raise GuardError(f"Parameter name {key} is reserved.")

    tree = _parse_one(sql)
    _check_root(tree)
    _check_forbidden(tree)
    ctes = _cte_names(tree)
    _check_functions(tree)
    _check_params(tree, set(user_params))
    used, alias_to_view = _rewrite_tables(tree, role, product_dir, ctes)
    if not used:
        raise GuardError("The query must read at least one rpt.<view>.")
    _rewrite_columns(tree, role, product_dir, alias_to_view)

    notes: list[str] = []
    if apply_row_cap:
        tree = _apply_limit(tree, row_cap, notes)

    for ph in list(tree.find_all(exp.Placeholder)):
        ph.replace(exp.var(param_token(str(ph.this))))

    own_with = tree.args.get("with_")
    own_ctes: list[str] = []
    if own_with is not None:
        own_ctes = [cte.sql(dialect=DIALECT, comments=False) for cte in own_with.expressions]
        tree.set("with_", None)
    body = tree.sql(dialect=DIALECT, comments=False)

    qids = list(queue_ids or [])
    ordered = _with_dependencies(used, role, product_dir)
    ours = [
        f"{CTE_PREFIX}{v} AS (\n{cte_body(v, role, product_dir, queue_ids=qids)}\n)"
        for v in ordered
    ]
    final = "WITH " + ",\n".join(ours + own_ctes) + "\n" + body

    bound = runtime_params(organization_id, user_id, qids)
    bound.update(user_params)
    return GuardedSQL(sql=_to_driver(final), params=bound, views=used, row_cap=row_cap, notes=notes)
