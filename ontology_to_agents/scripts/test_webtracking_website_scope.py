#!/usr/bin/env python3
"""Webtracking website_id / org predicate on every template."""

from __future__ import annotations

import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

TPL = ROOT / "semantic" / "sql" / "metric_templates" / "webtracking.yml"


def test_every_template_has_org_and_extra_where() -> None:
    data = yaml.safe_load(TPL.read_text(encoding="utf-8")) or {}
    metrics = data.get("metrics") or {}
    assert len(metrics) >= 80, len(metrics)
    missing_org = []
    missing_extra = []
    missing_pct = []
    for mid, spec in metrics.items():
        sql = spec.get("sql") or ""
        if "organization_id = %s" not in sql:
            missing_org.append(mid)
        if "{{extra_where" not in sql:
            missing_extra.append(mid)
        if mid.endswith("_rate") and "* 100" not in sql:
            missing_pct.append(mid)
    assert not missing_org, missing_org
    assert not missing_extra, missing_extra
    assert not missing_pct, missing_pct


if __name__ == "__main__":
    test_every_template_has_org_and_extra_where()
    print("OK: every webtracking template has organization_id and extra_where")
