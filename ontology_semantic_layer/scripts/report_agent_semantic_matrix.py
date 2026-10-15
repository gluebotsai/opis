#!/usr/bin/env python3
"""Print CCaaS + Ticketing agent → metrics → dimensions matrix."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    import yaml
except ImportError:
    print("PyYAML required")
    sys.exit(1)

from semantic.lookup import get_metric_policy, is_certified
from semantic.sql.metric_template_registry import get_template


def _dims_for(metrics: list[str], product: str) -> list[str]:
    seen: set[str] = set()
    for mid in metrics:
        pol = get_metric_policy(mid, product=product)
        for d in pol.get("dims") or pol.get("group_by") or []:
            seen.add(str(d))
    return sorted(seen)


def main() -> int:
    cat = yaml.safe_load((ROOT / "ontology/catalog.yml").read_text()) or {}
    presets = cat.get("presets") or {}
    for prefix, label in (("cc.", "CCaaS"), ("tk.", "Ticketing")):
        print(f"\n{'=' * 60}\n{label}\n{'=' * 60}")
        for agent_id in sorted(k for k in presets if k.startswith(prefix)):
            val = presets[agent_id]
            metrics = (val.get("prompt") or {}).get("metrics") or []
            product = "ccaas" if prefix == "cc." else "ticketing"
            dims = _dims_for(metrics, product) if metrics else []
            tpl = sum(1 for m in metrics if get_template(product, m))
            print(f"\n{agent_id}")
            print(f"  usecase: {(val.get('usecase') or '')[:72]}")
            print(f"  metrics ({len(metrics)}): {metrics or '—'}")
            print(f"  dimensions: {dims or '—'}")
            if metrics:
                print(f"  sql_templates: {tpl}/{len(metrics)}")
                uncert = [m for m in metrics if not is_certified(m)]
                if uncert:
                    print(f"  UNCERTIFIED: {uncert}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
