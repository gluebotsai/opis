#!/usr/bin/env python3
"""Generate mart SQL templates for a spoke product from MetricFlow semantic_layer YAML."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
ORG_WHERE = "organization_id = %s{{extra_where}}"

PRODUCTS: dict[str, dict[str, Any]] = {
    "crm": {
        "semantic_paths": [
            ROOT
            / "semantic/dbt/crm/default/dbt/models/semantic_layer/semantic_layer.yml"
        ],
        "template_yml": ROOT / "semantic/sql/metric_templates/crm.yml",
        "schema": "crm_marts",
        "dialect": "postgres",
        "hand_tuned": set(),
    },
    "campaign": {
        "semantic_paths": [
            ROOT
            / "semantic/dbt/campaign/default/dbt/models/semantic_layer/semantic_models.yml",
            ROOT
            / "semantic/dbt/campaign/default/dbt/models/semantic_layer/metrics.yml",
        ],
        "template_yml": ROOT / "semantic/sql/metric_templates/campaign.yml",
        "schema": "campaign_marts",
        "dialect": "postgres",
        "hand_tuned": set(),
    },
    "webtracking": {
        "semantic_paths": [
            ROOT
            / "semantic/dbt/webtracking/default/dbt/models/semantic_layer/semantic_layer.yml"
        ],
        "template_yml": ROOT / "semantic/sql/metric_templates/webtracking.yml",
        "schema": "webtracking_marts",
        "dialect": "clickhouse",
        "hand_tuned": set(),
    },
}

RATE_SUFFIXES = ("_rate", "_ratio", "_share")


def _normalize_ws(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip())


def _case_when_condition(expr: str) -> str | None:
    e = _normalize_ws(expr)
    if not e.lower().startswith("case when "):
        return None
    rest = e[10:]
    idx = rest.lower().find(" then ")
    if idx < 0:
        return None
    return rest[:idx].strip()


def measure_agg_sql(agg: str, expr: str, dialect: str) -> str:
    agg = agg.strip().lower()
    expr = _normalize_ws(expr)
    if dialect == "clickhouse":
        if agg == "count_distinct":
            return f"uniqExact({expr})"
        if agg == "sum":
            return f"sum({expr})"
        if agg == "average":
            return f"avg({expr})"
        if agg == "min":
            return f"min({expr})"
        if agg == "count":
            cond = _case_when_condition(expr)
            if cond:
                return f"countIf({cond})"
            return f"count({expr})"
        raise ValueError(f"unsupported agg {agg} for expr {expr}")
    if agg == "count_distinct":
        return f"COUNT(DISTINCT {expr})::bigint"
    if agg == "sum":
        return f"SUM({expr})"
    if agg == "average":
        return f"AVG({expr})::float"
    if agg == "min":
        return f"MIN({expr})::float"
    if agg == "count":
        cond = _case_when_condition(expr)
        if cond:
            return f"COUNT(*) FILTER (WHERE {cond})::bigint"
        return f"COUNT({expr})::bigint"
    raise ValueError(f"unsupported agg {agg} for expr {expr}")


def load_semantic(paths: list[Path], schema: str, dialect: str) -> tuple[dict[str, dict], dict[str, tuple[str, str, str]]]:
    metrics_by_name: dict[str, dict] = {}
    measure_info: dict[str, tuple[str, str, str]] = {}
    semantic_models: list[dict] = []

    for path in paths:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        for m in data.get("metrics") or []:
            metrics_by_name[str(m["name"])] = m
        semantic_models.extend(data.get("semantic_models") or [])

    for sm in semantic_models:
        mobj = re.search(r"ref\('([^']+)'\)", str(sm.get("model") or ""))
        if not mobj:
            continue
        mart_ref = mobj.group(1)
        table = mart_ref
        time_col = str((sm.get("defaults") or {}).get("agg_time_dimension") or "created_at")
        fq_table = f"{schema}.{table}"
        for measure in sm.get("measures") or []:
            name = str(measure["name"])
            measure_info[name] = (
                fq_table,
                time_col,
                measure_agg_sql(str(measure["agg"]), str(measure["expr"]), dialect),
            )
    return metrics_by_name, measure_info


def _simple_parts(
    metric_name: str,
    metrics_by_name: dict[str, dict],
    measure_info: dict[str, tuple[str, str, str]],
) -> tuple[str, str, str, str] | None:
    m = metrics_by_name.get(metric_name) or {}
    if str(m.get("type")) != "simple":
        return None
    measure = str((m.get("type_params") or {}).get("measure") or "")
    if measure not in measure_info:
        return None
    fq_table, time_col, agg_sql = measure_info[measure]
    table = fq_table.split(".", 1)[-1]
    return fq_table, table, time_col, agg_sql


def _scalar_subquery(agg_sql: str, fq_table: str) -> str:
    return f"(SELECT {agg_sql} FROM {fq_table} WHERE {ORG_WHERE})"


def _is_rate_metric(name: str) -> bool:
    return any(name.endswith(s) for s in RATE_SUFFIXES)


def metric_sql(
    metric_name: str,
    metrics_by_name: dict[str, dict],
    measure_info: dict[str, tuple[str, str, str]],
    dialect: str,
    visiting: set[str] | None = None,
) -> tuple[str, str, str, bool]:
    if visiting is None:
        visiting = set()
    if metric_name in visiting:
        raise ValueError(f"cycle: {metric_name}")
    visiting = set(visiting) | {metric_name}

    m = metrics_by_name[metric_name]
    mtype = str(m.get("type") or "simple")
    params = m.get("type_params") or {}
    default_zero = _is_rate_metric(metric_name)

    if mtype == "simple":
        parts = _simple_parts(metric_name, metrics_by_name, measure_info)
        if not parts:
            raise KeyError(metric_name)
        fq_table, table, time_col, agg_sql = parts
        if metric_name.endswith("_metric") or metric_name.endswith("_volume"):
            default_zero = True
        cast = ""
        if dialect == "postgres" and " AS " not in agg_sql.upper():
            pass
        sql = (
            f"SELECT {agg_sql} AS {metric_name}\n"
            f"FROM {fq_table}\n"
            f"WHERE {ORG_WHERE}"
        )
        return sql, table, time_col, default_zero

    if mtype == "ratio":
        num_name = str(params.get("numerator") or "")
        denom_name = str(params.get("denominator") or "")
        num_parts = _simple_parts(num_name, metrics_by_name, measure_info)
        denom_parts = _simple_parts(denom_name, metrics_by_name, measure_info)
        default_zero = True

        if num_parts and denom_parts:
            fq_num, num_table, num_time, num_agg = num_parts
            fq_denom, _, _, denom_agg = denom_parts
            table = num_table
            time_col = num_time
            if dialect == "clickhouse":
                num_expr = num_agg
                denom_expr = denom_agg
            else:
                num_expr = f"({num_agg})::float"
                denom_expr = f"({denom_agg})"
            if fq_num == fq_denom:
                sql = (
                    f"SELECT\n"
                    f"  {num_expr}\n"
                    f"  / nullIf({denom_expr}, 0) AS {metric_name}\n"
                    f"FROM {fq_num}\n"
                    f"WHERE {ORG_WHERE}"
                )
                return sql, table, time_col, default_zero
            sql = (
                f"SELECT\n"
                f"  {_scalar_subquery(num_agg, fq_num)}\n"
                f"  / nullIf({_scalar_subquery(denom_agg, fq_denom)}, 0)\n"
                f"  AS {metric_name}"
            )
            return sql, table, time_col, default_zero

        num_sql, num_table, num_time, _ = metric_sql(
            num_name, metrics_by_name, measure_info, dialect, visiting
        )
        denom_sql, _, _, _ = metric_sql(
            denom_name, metrics_by_name, measure_info, dialect, visiting
        )
        sql = (
            f"SELECT\n"
            f"  ({num_sql})::float\n"
            f"  / nullIf(({denom_sql}), 0) AS {metric_name}"
        )
        return sql, num_table, num_time, default_zero

    if mtype == "derived":
        expr = _normalize_ws(str(params.get("expr") or ""))
        dep_names = [str(x.get("name")) for x in params.get("metrics") or []]
        table = "mart_web_sessions"
        time_col = "started_at"
        for dep in sorted(dep_names, key=len, reverse=True):
            dep_parts = _simple_parts(dep, metrics_by_name, measure_info)
            if dep_parts:
                fq_table, dep_table, dep_time, agg_sql = dep_parts
                table = dep_table
                time_col = dep_time
                expr = re.sub(rf"\b{dep}\b", _scalar_subquery(agg_sql, fq_table), expr)
            else:
                dep_sql, dep_table, dep_time, _ = metric_sql(
                    dep, metrics_by_name, measure_info, dialect, visiting
                )
                table = dep_table
                time_col = dep_time
                inner = dep_sql.replace("SELECT ", "", 1).split(f" AS {dep}", 1)[0].strip()
                expr = re.sub(rf"\b{dep}\b", f"({_scalar_subquery(inner, '')})", expr)
        cast = "::float" if dialect == "postgres" else ""
        sql = f"SELECT ({expr}){cast} AS {metric_name}"
        return sql, table, time_col, True

    raise ValueError(f"unsupported type {mtype} for {metric_name}")


def build_templates(
    product: str,
    metrics_by_name: dict[str, dict],
    measure_info: dict[str, tuple[str, str, str]],
    dialect: str,
    preserve: dict[str, Any],
) -> dict[str, Any]:
    out: dict[str, Any] = dict(preserve)
    for metric_name in sorted(metrics_by_name):
        if metric_name in preserve:
            continue
        try:
            sql, table, time_col, default_zero = metric_sql(
                metric_name, metrics_by_name, measure_info, dialect
            )
        except (KeyError, ValueError):
            continue
        entry: dict[str, Any] = {
            "product": product,
            "result_column": metric_name,
            "time_column": time_col,
            "table": table,
            "sql": sql + "\n",
        }
        if dialect == "clickhouse":
            entry["engine"] = "clickhouse"
        if default_zero:
            entry["default_zero"] = True
        out[metric_name] = entry
    return out


def expand_product(product: str) -> int:
    cfg = PRODUCTS[product]
    paths = cfg["semantic_paths"]
    for p in paths:
        if not p.is_file():
            print(f"missing semantic file: {p}")
            return 1
    metrics_by_name, measure_info = load_semantic(
        paths, str(cfg["schema"]), str(cfg["dialect"])
    )
    template_path = Path(cfg["template_yml"])
    existing = {}
    if template_path.is_file():
        existing = yaml.safe_load(template_path.read_text(encoding="utf-8")) or {}
    preserve = {
        k: v
        for k, v in (existing.get("metrics") or {}).items()
        if k in cfg["hand_tuned"]
    }
    merged = build_templates(
        product,
        metrics_by_name,
        measure_info,
        str(cfg["dialect"]),
        preserve,
    )
    template_path.parent.mkdir(parents=True, exist_ok=True)
    template_path.write_text(
        yaml.dump({"metrics": merged}, sort_keys=False, default_flow_style=False),
        encoding="utf-8",
    )
    bad = [
        k
        for k, v in merged.items()
        if "{{extra_where}}" not in str(v.get("sql") or "")
        and "%s" in str(v.get("sql") or "")
    ]
    print(f"{product}: {len(merged)} templates ({len(merged) - len(preserve)} generated)")
    if bad:
        print("missing {{extra_where}}:", bad[:10])
        return 1
    missing = sorted(set(metrics_by_name) - set(merged))
    if missing:
        print(f"{product}: skipped {len(missing)} non-scalar/unsupported metrics")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "products",
        nargs="*",
        default=["crm", "campaign", "webtracking"],
        choices=list(PRODUCTS),
    )
    args = parser.parse_args()
    rc = 0
    for product in args.products:
        rc = max(rc, expand_product(product))
    return rc


if __name__ == "__main__":
    sys.exit(main())
