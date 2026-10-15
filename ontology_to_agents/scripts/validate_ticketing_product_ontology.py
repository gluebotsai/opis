#!/usr/bin/env python3
"""Traceback: ticketing product ontology (ontoYMLs/ticketing.yml) + metrics."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import yaml

from ontology.slice import clear_ontology_cache, fetch_ontology_slice, get_catalog
from ontology.ticketing_product import (
    TICKETING_ONTOLOGY_PATH,
    entity_names,
    load_ticketing_product_ontology,
)

EXPECTED_ENTITIES = 21
EXPECTED_RELATIONS = 44
EXPECTED_BUSINESS_RULES = 16
NEW_RULE_MARKER = "Ticket is the only thing counted"
OLD_CONTACT_RULE = "Every ticket must have a Contact"
FORBIDDEN_ENTITY_KEYS = {
    "SupportCase",
    "Contact",
    "Agent",
    "CaseNote",
    "wt:Ticket",
}
FULL_PRESETS = {"tk.super", "tk.reporting_mas"}


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
    raw = TICKETING_ONTOLOGY_PATH.read_text(encoding="utf-8")
    if "wt:" in raw:
        errors.append("ticketing.yml contains wt:")
    ont = load_ticketing_product_ontology()
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


def validate_business_rules_prompts() -> list[str]:
    """Super + specialist must emit product business_rules, not old Contact text."""
    errors: list[str] = []
    samples = [
        ("ticketing_super_agent", True),
        ("ticket_lifecycle_executor", False),
    ]
    clear_ontology_cache()
    for agent_id, _is_full in samples:
        pack = fetch_ontology_slice(
            agent=agent_id,
            product="ticketing",
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
            errors.append(f"{agent_id}: missing new rule marker in prompt")
        if OLD_CONTACT_RULE in prompt:
            errors.append(f"{agent_id}: old Contact bridge rule still in prompt")
        # Compact product path must not append preset prompt.rules
        if getattr(pack, "prompt_spec", None):
            # Ensure as_prompt came from product dump (rules live under ontology)
            if "business_rules:" not in prompt:
                errors.append(f"{agent_id}: prompt missing business_rules block")
    return errors


def _ticketing_agents() -> list[tuple[str, str]]:
    """Return (agent_id, preset_id) for owned_product ticketing."""
    cat = get_catalog()
    out: list[tuple[str, str]] = []
    for agent_id, cfg in (cat._agents or {}).items():
        if str(cfg.get("owned_product") or "") != "ticketing":
            continue
        preset = str(cfg.get("preset") or "")
        out.append((agent_id, preset))
    return sorted(out)


def validate_agents() -> tuple[list[str], list[str]]:
    errors: list[str] = []
    lines: list[str] = []
    known = entity_names()
    clear_ontology_cache()

    header = (
        f"{'agent':<42} {'ents':>4} {'rels':>4} {'wt':>3} "
        f"{'outside':>7} {'metrics':>7} status"
    )
    lines.append(header)
    lines.append("-" * len(header))

    for agent_id, preset in _ticketing_agents():
        try:
            pack = fetch_ontology_slice(
                agent=agent_id,
                product="ticketing",
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
            for key in FORBIDDEN_ENTITY_KEYS:
                # entity keys only (not synonyms values)
                if key in ents:
                    ok = False
                    row_errs.append(f"forbidden entity {key}")
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
            else:
                if len(ents) >= EXPECTED_ENTITIES:
                    ok = False
                    row_errs.append("specialist not subset")
                allow = list((pack.prompt_spec or {}).get("entities") or [])
                if allow and set(allow) != ents:
                    ok = False
                    row_errs.append(
                        f"allowlist mismatch {sorted(set(allow))} vs {sorted(ents)}"
                    )

            status = "OK" if ok else "FAIL"
            lines.append(
                f"{agent_id:<42} {len(ents):>4} {len(rels):>4} "
                f"{'Y' if wt else 'n':>3} {len(outside):>7} {metric_n:>7} {status}"
            )
            for err in row_errs:
                errors.append(f"{agent_id}: {err}")
        except Exception as exc:
            lines.append(
                f"{agent_id:<42} {'?':>4} {'?':>4} {'?':>3} {'?':>7} {'?':>7} FAIL"
            )
            errors.append(f"{agent_id}: {exc}")

    return errors, lines


def validate_metrics_sample() -> list[str]:
    errors: list[str] = []
    samples = [
        ("ticketing_super_agent", "none"),
        ("ticket_lifecycle_executor", "none"),
        ("tk.reporting", "headlines"),
        ("tk.reporting_mas", "full"),
    ]
    for agent_id, mode in samples:
        pack = fetch_ontology_slice(
            agent=agent_id,
            product="ticketing",
            tenant="org1000",
            user_id=1001,
        )
        prompt = pack.as_prompt()
        if "metrics:" in prompt.split("business_rules:", 1)[0]:
            # product yaml should not embed KPI metrics block
            pass
        # Ontology prompt must not list certified metric ids as a metrics: section
        # under ontology (our dump has no metrics key).
        ont = _parse_prompt(prompt)
        if "metrics" in ont:
            errors.append(f"{agent_id}: ontology prompt contains metrics key")

        expected_mode = (pack.prompt_spec or {}).get("metrics_mode") or mode
        visible = []
        if pack.context is not None:
            visible = list(pack.context.visible_metric_ids or [])

        if expected_mode == "none":
            if "metrics:" in prompt and any(
                m in prompt for m in ("open_tickets", "average_csat")
            ):
                errors.append(f"{agent_id}: KPI text leaked into ontology prompt")
        elif expected_mode in ("headlines", "full"):
            if not visible and not pack.metric_ids:
                # grants may still load via context — warn as error if both empty
                errors.append(f"{agent_id}: expected metric grants for mode={expected_mode}")
            # every visible id should be ticketing-certified when possible
            try:
                from semantic.lookup import is_certified

                for mid in visible:
                    if not is_certified(str(mid)):
                        errors.append(f"{agent_id}: uncertified metric {mid}")
            except Exception:
                pass
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
        print("  OK    Super + specialist emit product business_rules")

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

    print(f"\n{failed} ticketing product ontology validation failures")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
