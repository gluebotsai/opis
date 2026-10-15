#!/usr/bin/env python3
"""Traceback: webtracking product ontology (ontoYMLs/webtracking.yml) + metrics."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import yaml

from ontology.slice import clear_ontology_cache, fetch_ontology_slice, get_catalog
from ontology.webtracking_product import (
    WEBTRACKING_ONTOLOGY_PATH,
    entity_names,
    load_webtracking_product_ontology,
)

EXPECTED_ENTITIES = 18
EXPECTED_RELATIONS = 34
EXPECTED_BUSINESS_RULES = 25
INSIGHTS_ENTITIES = {
    "Tenant",
    "Website",
    "Visitor",
    "Session",
    "Page",
    "PageView",
    "TrafficSource",
    "Campaign",
    "Conversion",
    "PerformanceMeasure",
    "Error",
}
NEW_RULE_MARKER = "Every answer is about one website only"
FULL_PRESETS = {"webtracking.analytics"}
INSIGHTS_PRESET = "webtracking.insights"
PRODUCT_AGENTS = {"webtracking.analytics", "webtracking.insights"}


def _parse_prompt(prompt: str) -> dict:
    data = yaml.safe_load(prompt) or {}
    return data.get("ontology") or data


def _relation_endpoints(line: str) -> tuple[str, str] | None:
    text = str(line or "").strip()
    if " - " not in text or " -> " not in text:
        return None
    left, rest = text.split(" - ", 1)
    _verb, right = rest.split(" -> ", 1)
    return left.strip(), right.strip()


def validate_file() -> list[str]:
    errors: list[str] = []
    raw = WEBTRACKING_ONTOLOGY_PATH.read_text(encoding="utf-8")
    if "wt:" in raw:
        errors.append("webtracking.yml contains wt:")
    ont = load_webtracking_product_ontology()
    ents = ont.get("entities") or {}
    rels = list(ont.get("relations") or [])
    rules = list(ont.get("business_rules") or [])
    taxonomy = ont.get("taxonomy") or {}
    if len(ents) != EXPECTED_ENTITIES:
        errors.append(f"entity count {len(ents)} != {EXPECTED_ENTITIES}")
    if len(rels) != EXPECTED_RELATIONS:
        errors.append(f"relation count {len(rels)} != {EXPECTED_RELATIONS}")
    if not rules:
        errors.append("ontology.business_rules is empty or missing")
    elif len(rules) != EXPECTED_BUSINESS_RULES:
        errors.append(
            f"business_rules count {len(rules)} != {EXPECTED_BUSINESS_RULES}"
        )
    if isinstance(taxonomy, dict) and "business_rules" in taxonomy:
        errors.append("taxonomy must not contain nested business_rules")
    known = set(ents)
    for line in rels:
        ends = _relation_endpoints(str(line))
        if not ends:
            errors.append(f"unparseable relation: {line}")
            continue
        left, right = ends
        if left not in known or right not in known:
            errors.append(f"relation endpoint outside entities: {line}")
    return errors


def _webtracking_agents() -> list[tuple[str, str]]:
    cat = get_catalog()
    out: list[tuple[str, str]] = []
    for agent_id, cfg in (cat._agents or {}).items():
        if str(cfg.get("owned_product") or "") != "webtracking":
            continue
        preset = str(cfg.get("preset") or "")
        out.append((agent_id, preset))
    return sorted(out)


def validate_business_rules_prompts() -> list[str]:
    errors: list[str] = []
    samples = [
        ("webtracking.analytics", True),
        ("webtracking.insights", False),
    ]
    clear_ontology_cache()
    for agent_id, _is_full in samples:
        pack = fetch_ontology_slice(
            agent=agent_id,
            product="webtracking",
            tenant="org1000",
            user_id=1001,
        )
        prompt = pack.as_prompt()
        ont = _parse_prompt(prompt)
        rules = list(ont.get("business_rules") or [])
        if len(rules) != EXPECTED_BUSINESS_RULES:
            errors.append(
                f"{agent_id}: business_rules count {len(rules)} "
                f"!= {EXPECTED_BUSINESS_RULES}"
            )
        joined = "\n".join(str(r) for r in rules)
        if NEW_RULE_MARKER not in joined and NEW_RULE_MARKER not in prompt:
            errors.append(f"{agent_id}: missing website-only rule marker in prompt")
        if "business_rules:" not in prompt:
            errors.append(f"{agent_id}: prompt missing business_rules block")
        if "wt:" in prompt:
            errors.append(f"{agent_id}: wt: leaked into product prompt")
        if "metrics" in ont:
            errors.append(f"{agent_id}: ontology prompt contains metrics key")
    return errors


def validate_agents() -> tuple[list[str], list[str]]:
    errors: list[str] = []
    lines: list[str] = []
    known = entity_names()
    clear_ontology_cache()

    header = (
        f"{'agent':<32} {'ents':>4} {'rels':>4} {'wt':>3} "
        f"{'outside':>7} {'metrics':>7} status"
    )
    lines.append(header)
    lines.append("-" * len(header))

    for agent_id, preset in _webtracking_agents():
        try:
            pack = fetch_ontology_slice(
                agent=agent_id,
                product="webtracking",
                tenant="org1000",
                user_id=1001,
            )
            prompt = pack.as_prompt()
            ont = _parse_prompt(prompt)
            ents = set((ont.get("entities") or {}).keys())
            rels = list(ont.get("relations") or [])
            wt = "wt:" in prompt
            outside = sorted(ents - known)
            metric_n = 0
            if pack.context is not None:
                metric_n = len(pack.context.visible_metric_ids or [])
            elif pack.metric_ids:
                metric_n = len(pack.metric_ids)

            ok = True
            row_errs: list[str] = []
            if wt:
                ok = False
                row_errs.append("wt:")
            if outside:
                ok = False
                row_errs.append(f"outside={outside}")

            for line in rels:
                ends = _relation_endpoints(str(line))
                if ends and (ends[0] not in ents or ends[1] not in ents):
                    ok = False
                    row_errs.append(f"rel {line}")

            is_full = preset in FULL_PRESETS or bool(
                (pack.prompt_spec or {}).get("full_ontology")
            )
            if is_full:
                if len(ents) != EXPECTED_ENTITIES:
                    ok = False
                    row_errs.append(f"full ents {len(ents)}")
                if len(rels) != EXPECTED_RELATIONS:
                    ok = False
                    row_errs.append(f"full rels {len(rels)}")
            elif preset == INSIGHTS_PRESET:
                if ents != INSIGHTS_ENTITIES:
                    ok = False
                    row_errs.append(
                        f"insights ents {sorted(ents)} != {sorted(INSIGHTS_ENTITIES)}"
                    )
                if len(ents) >= EXPECTED_ENTITIES:
                    ok = False
                    row_errs.append("insights not subset")
            else:
                if len(ents) >= EXPECTED_ENTITIES:
                    ok = False
                    row_errs.append("specialist not subset")

            status = "OK" if ok else "FAIL"
            lines.append(
                f"{agent_id:<32} {len(ents):>4} {len(rels):>4} "
                f"{'Y' if wt else 'n':>3} {len(outside):>7} {metric_n:>7} {status}"
            )
            for err in row_errs:
                errors.append(f"{agent_id}: {err}")
        except Exception as exc:
            lines.append(
                f"{agent_id:<32} {'?':>4} {'?':>4} {'?':>3} {'?':>7} {'?':>7} FAIL"
            )
            errors.append(f"{agent_id}: {exc}")

    return errors, lines


def validate_metrics_sample() -> list[str]:
    errors: list[str] = []
    from semantic.agent_grants import grant_candidates
    from semantic.ownership import clear_ownership_cache

    clear_ownership_cache()
    analytics_grants = grant_candidates("webtracking.analytics", "webtracking") or []
    insights_grants = grant_candidates("webtracking.insights", "webtracking") or []
    if len(analytics_grants) < 50:
        errors.append(
            f"webtracking.analytics: expected full catalog grants "
            f"(got {len(analytics_grants)})"
        )
    if insights_grants:
        errors.append(
            f"webtracking.insights: expected empty grants "
            f"(got {len(insights_grants)})"
        )

    samples = [
        ("webtracking.analytics", "full"),
        ("webtracking.insights", "none"),
    ]
    for agent_id, mode in samples:
        pack = fetch_ontology_slice(
            agent=agent_id,
            product="webtracking",
            tenant="org1000",
            user_id=1001,
        )
        prompt = pack.as_prompt()
        ont = _parse_prompt(prompt)
        if "metrics" in ont:
            errors.append(f"{agent_id}: ontology prompt contains metrics key")

        expected_mode = (pack.prompt_spec or {}).get("metrics_mode") or mode
        if expected_mode != mode:
            errors.append(
                f"{agent_id}: metrics_mode {expected_mode!r} != {mode!r}"
            )
        if expected_mode == "none":
            if "metrics:" in prompt and any(
                m in prompt for m in ("bounce_rate", "unique_visitors")
            ):
                errors.append(f"{agent_id}: KPI text leaked into ontology prompt")
    return errors


def main() -> int:
    failed = 0
    print("=== A. File integrity ===")
    file_errs = validate_file()
    if file_errs:
        failed += len(file_errs)
        for e in file_errs:
            print(f"  FAIL  {e}")
    else:
        print(
            f"  OK    {EXPECTED_ENTITIES} entities, {EXPECTED_RELATIONS} relations, "
            f"{EXPECTED_BUSINESS_RULES} business_rules"
        )

    print("\n=== A2. Business rules in prompts ===")
    rule_errs = validate_business_rules_prompts()
    if rule_errs:
        failed += len(rule_errs)
        for e in rule_errs:
            print(f"  FAIL  {e}")
    else:
        print("  OK    analytics + insights emit product business_rules")

    print("\n=== B/C. Agent matrix ===")
    agent_errs, matrix = validate_agents()
    for line in matrix:
        print(line)
    if agent_errs:
        failed += len(agent_errs)
        for e in agent_errs[:20]:
            print(f"  FAIL  {e}")

    print("\n=== D. Metrics sample ===")
    metric_errs = validate_metrics_sample()
    if metric_errs:
        failed += len(metric_errs)
        for e in metric_errs:
            print(f"  FAIL  {e}")
    else:
        print("  OK    metrics modes / grants look consistent")

    print(f"\n{failed} webtracking product ontology validation failures")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
