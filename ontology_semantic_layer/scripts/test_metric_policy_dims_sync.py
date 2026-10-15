#!/usr/bin/env python3
"""CI: policy dims match MetricFlow home-model categorical dims (minus SKIP/time)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.sync_metric_policy_dims import (  # noqa: E402
    BASE_SOURCE_PRIORITY,
    SEMANTIC_PATHS,
    _load_mf,
    build_index,
    compute_source_metric_dims,
    dims_for_metric,
)
from semantic.lookup import clear_policies_cache, get_allowed_dims  # noqa: E402


def test_policy_dims_match_mf_home_models() -> None:
    clear_policies_cache()
    source_dims = compute_source_metric_dims()

    # metric → preferred base source (same as sync)
    by_metric: dict[str, dict[str, list[str]]] = {}
    for source_id, bucket in source_dims.items():
        for mid, dims in bucket.items():
            by_metric.setdefault(mid, {})[source_id] = dims

    mismatches: list[str] = []
    checked = 0

    for mid, per_source in sorted(by_metric.items()):
        base_source = next(
            (s for s in BASE_SOURCE_PRIORITY if s in per_source),
            next(iter(per_source)),
        )
        expected = per_source[base_source]
        if not expected:
            # Campaign (and similar) models with only time dims — policy may retain
            # intentional allowlists; skip strict equality.
            continue

        product = {
            "aiccaas": "ccaas",
            "ticketing": "ticketing",
            "crm": "crm",
            "campaign": "campaign",
            "webtracking": "webtracking",
        }[base_source]
        actual = get_allowed_dims(mid, product=product)
        checked += 1
        if set(actual) != set(expected):
            missing = sorted(set(expected) - set(actual))
            extra = sorted(set(actual) - set(expected))
            mismatches.append(
                f"{mid} ({product}): missing={missing[:8]} extra={extra[:8]}"
            )

        # Overlay checks for shared metrics
        for source_id, dims in per_source.items():
            if source_id == base_source or not dims:
                continue
            overlay_product = {
                "aiccaas": "ccaas",
                "ticketing": "ticketing",
                "crm": "crm",
                "campaign": "campaign",
                "webtracking": "webtracking",
            }[source_id]
            o_actual = get_allowed_dims(mid, product=overlay_product)
            checked += 1
            if set(o_actual) != set(dims):
                mismatches.append(
                    f"{mid}.products.{overlay_product}: "
                    f"missing={sorted(set(dims) - set(o_actual))[:8]} "
                    f"extra={sorted(set(o_actual) - set(dims))[:8]}"
                )

    if mismatches:
        raise AssertionError(
            f"{len(mismatches)} policy/MF dim mismatches (checked {checked}):\n"
            + "\n".join(mismatches[:30])
        )
    print(f"PASS  metric_policy_dims_sync  checked={checked}")


def test_ticket_volume_includes_assignee_name() -> None:
    clear_policies_cache()
    dims = get_allowed_dims("ticket_volume", product="ticketing")
    assert "assignee_name" in dims, dims
    assert "priority" in dims
    assert "queue_name" in dims


def test_mf_indexes_load() -> None:
    for source_id, path in SEMANTIC_PATHS.items():
        assert path.is_file(), path
        data = _load_mf(source_id, path)
        models, m2m, metrics = build_index(data)
        assert models, f"{source_id} has no semantic models"
        assert metrics, f"{source_id} has no metrics"
        # Smoke: at least one metric resolves dims or is intentionally time-only
        sample = next(iter(metrics))
        _ = dims_for_metric(sample, models, m2m, metrics)


def main() -> int:
    test_mf_indexes_load()
    test_ticket_volume_includes_assignee_name()
    test_policy_dims_match_mf_home_models()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as exc:
        print(f"FAIL  {exc}")
        raise SystemExit(1)
