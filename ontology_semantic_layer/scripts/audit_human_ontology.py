#!/usr/bin/env python3
"""Two-pass audit for human-readable ontology (labels, relations, slice leaks).

Pass 1 (default): write baseline report, exit 0.
Pass 2 (--strict): fail if forbidden names remain on agent-facing surfaces.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    raise SystemExit("PyYAML required") from None

ROOT = Path(__file__).resolve().parent.parent
CORE = ROOT / "Knowledge_Graph_Pipeline" / "config" / "mappings" / "core.yaml"
ENTITIES = ROOT / "ontology" / "definitions" / "entities.yml"
GRAPH_NODES = ROOT / "ontology" / "graph_nodes.yml"
MODULES = ROOT / "ontology" / "modules"
SLICES = ROOT / "ontology" / "slices"
PRESETS = ROOT / "ontology" / "presets"
TAXONOMY = ROOT / "ontology" / "taxonomy.yml"

FORBIDDEN_LABELS = {
    "Employee",
    "SupportCase",
    "SupportProfile",
    "StaffRole",
    "Admin",
    "Resolver",
    "TicketStatusDef",
    "TicketPriorityDef",
}
FORBIDDEN_LABEL_PATTERNS = [re.compile(r"^wt:"), re.compile(r"Hub$"), re.compile(r"Log$")]
FORBIDDEN_RELATIONS = {
    "FOR_CUSTOMER",
    "ASSIGNED_L1",
    "RESOLVER_L2",
    "HAS_EMPLOYEE",
    "ROLE_OF",
}
SCREAMING_REL = re.compile(r"^[A-Z][A-Z0-9_]*$")
FORBIDDEN_SLICE_TYPES = {"Party", "WorkItem", "User", "Employee", "WorkforceAgent"}
FORBIDDEN_TAXONOMY = {"contractor", "system"}

PRESETS_TO_CHECK = ("tk.super", "cc.super", "crm.super")
TICKETING_ROLE_PRESETS = (
    "tk.triage_routing_domain",
    "tk.resolution_lifecycle_domain",
    "tk.ticket_lifecycle_executor",
    "tk.intelligent_assignment_executor",
)


def _load_yaml(path: Path) -> dict:
    if not path.exists():
        return {}
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def _grep_files(pattern: str, paths: list[Path]) -> list[str]:
    hits: list[str] = []
    rx = re.compile(pattern)
    for base in paths:
        if not base.exists():
            continue
        files = [base] if base.is_file() else list(base.rglob("*.yml"))
        for fp in files:
            try:
                text = fp.read_text(encoding="utf-8")
            except OSError:
                continue
            for i, line in enumerate(text.splitlines(), 1):
                if rx.search(line):
                    hits.append(f"{fp.relative_to(ROOT)}:{i}:{line.strip()[:120]}")
    return hits


def _core_labels() -> set[str]:
    tables = (_load_yaml(CORE).get("tables") or {})
    labels: set[str] = set()
    for spec in tables.values():
        if isinstance(spec, dict) and spec.get("label"):
            labels.add(str(spec["label"]))
    return labels


def _core_relations() -> set[str]:
    tables = (_load_yaml(CORE).get("tables") or {})
    types: set[str] = set()
    for spec in tables.values():
        if not isinstance(spec, dict):
            continue
        for rel in spec.get("relationships") or []:
            if isinstance(rel, dict) and rel.get("type"):
                types.add(str(rel["type"]))
        if spec.get("type"):
            types.add(str(spec["type"]))
    return types


def _module_relations() -> list[str]:
    lines: list[str] = []
    for fp in sorted(MODULES.glob("*.yml")):
        data = _load_yaml(fp)
        for rel in data.get("relations") or []:
            if isinstance(rel, dict):
                lines.append(f"{fp.name}:{rel.get('from')}|{rel.get('type')}|{rel.get('to')}")
            elif isinstance(rel, str):
                lines.append(f"{fp.name}:{rel}")
    return lines


def _slice_relation_lines() -> list[str]:
    lines: list[str] = []
    for fp in sorted(SLICES.glob("*.yml")):
        data = _load_yaml(fp)
        for rel in data.get("relations") or []:
            lines.append(f"{fp.name}:{rel}")
    return lines


def _compact_prompt_snippet(preset: str) -> str:
    sys.path.insert(0, str(ROOT))
    from ontology.slice import clear_ontology_cache, fetch_ontology_slice

    clear_ontology_cache()
    pack = fetch_ontology_slice(preset=preset)
    return pack.as_prompt(mode="compact")


def _taxonomy_axes() -> dict:
    return (_load_yaml(TAXONOMY).get("taxonomies") or {})


def _preset_has_taxonomy(preset_id: str, axis: str) -> bool:
    presets = (_load_yaml(PRESETS / "ticketing.yml").get("presets") or {})
    spec = presets.get(preset_id) or {}
    tax = (spec.get("prompt") or {}).get("taxonomy") or []
    return axis in tax


def run_audit(strict: bool) -> dict:
    report: dict = {
        "core_labels": sorted(_core_labels()),
        "core_relations_sample": sorted(_core_relations())[:40],
        "core_relation_count": len(_core_relations()),
        "employee_in_core": _grep_files(r"\bEmployee\b", [CORE]),
        "forbidden_relations_in_modules": [],
        "forbidden_relations_in_slices": [],
        "slice_leaks": {},
        "taxonomy": {},
        "people_gaps": {},
        "violations": [],
    }

    for rel_line in _module_relations():
        for bad in FORBIDDEN_RELATIONS:
            if f"|{bad}|" in rel_line or rel_line.endswith(f"|{bad}") or f" {bad} " in rel_line:
                report["forbidden_relations_in_modules"].append(rel_line)

    for rel_line in _slice_relation_lines():
        for bad in FORBIDDEN_RELATIONS:
            if bad in rel_line:
                report["forbidden_relations_in_slices"].append(rel_line)
        m = re.search(r" - ([A-Z_]+) ->", rel_line.split(":", 1)[-1])
        if m and SCREAMING_REL.match(m.group(1)):
            report["forbidden_relations_in_slices"].append(rel_line)

    tax = _taxonomy_axes()
    report["taxonomy"] = {
        "has_user_kind": "user.kind" in tax,
        "user_kind_terms": list((tax.get("user.kind") or {}).get("terms") or []),
        "has_staff_role": "staff.role" in tax,
        "staff_role_terms": list((tax.get("staff.role") or {}).get("terms") or []),
    }

    missing_assignee = [
        p for p in TICKETING_ROLE_PRESETS if not _preset_has_taxonomy(p, "ticket.assignee_role")
    ]
    missing_staff = [
        p for p in TICKETING_ROLE_PRESETS if not _preset_has_taxonomy(p, "staff.role")
    ]
    report["people_gaps"] = {
        "missing_ticket_assignee_role_presets": missing_assignee,
        "missing_staff_role_presets": missing_staff,
        "employee_graph_label": "Employee" in report["core_labels"],
        "user_graph_label": "User" in report["core_labels"],
    }

    for preset in PRESETS_TO_CHECK:
        try:
            prompt = _compact_prompt_snippet(preset)
        except Exception as exc:  # pragma: no cover
            report["slice_leaks"][preset] = f"error: {exc}"
            continue
        leaks = []
        # Entity keys in compact YAML: "  Ticket:" under entities:
        entity_block = re.search(r"entities:\n((?:  \w+:\n(?:    .+\n)+)+)", prompt)
        entity_names = set()
        if entity_block:
            entity_names = set(re.findall(r"^  (\w+):", entity_block.group(1), re.M))
        for label in FORBIDDEN_SLICE_TYPES:
            if label in entity_names:
                leaks.append(label)
        for pat in FORBIDDEN_LABEL_PATTERNS:
            if pat.search(prompt):
                leaks.append(pat.pattern)
        report["slice_leaks"][preset] = leaks

    if strict:
        v = report["violations"]
        if "Employee" in report["core_labels"]:
            v.append("core.yaml still uses Employee graph label")
        if not report["taxonomy"]["has_user_kind"]:
            v.append("taxonomy.yml missing user.kind")
        if report["taxonomy"]["user_kind_terms"] != ["employee"]:
            v.append(f"user.kind terms must be [employee] only: {report['taxonomy']['user_kind_terms']}")
        forbidden_terms = set(report["taxonomy"]["user_kind_terms"]) & FORBIDDEN_TAXONOMY
        if forbidden_terms:
            v.append(f"forbidden taxonomy terms: {sorted(forbidden_terms)}")
        if not report["taxonomy"]["has_staff_role"]:
            v.append("taxonomy.yml missing staff.role")
        v.extend(f"module relation: {x}" for x in report["forbidden_relations_in_modules"])
        v.extend(f"slice relation: {x}" for x in report["forbidden_relations_in_slices"])
        for preset, leaks in report["slice_leaks"].items():
            if leaks:
                v.append(f"{preset} compact prompt leaks: {leaks}")

    return report


def _write_markdown(report: dict, path: Path) -> None:
    lines = [
        "# Human ontology audit",
        "",
        f"- Core labels count: {len(report['core_labels'])}",
        f"- Employee in core: {bool(report['employee_in_core'])}",
        f"- User in core labels: {'User' in report['core_labels']}",
        f"- user.kind: {report['taxonomy'].get('user_kind_terms')}",
        f"- staff.role: {report['taxonomy'].get('staff_role_terms')}",
        "",
        "## People gaps",
        json.dumps(report["people_gaps"], indent=2),
        "",
        "## Slice leaks",
        json.dumps(report["slice_leaks"], indent=2),
        "",
        "## Forbidden module relations",
        *report["forbidden_relations_in_modules"][:30],
        "",
        "## Forbidden slice relations",
        *report["forbidden_relations_in_slices"][:30],
    ]
    if report.get("violations"):
        lines.extend(["", "## Violations (strict)", *report["violations"]])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--strict", action="store_true", help="Pass 2: fail on violations")
    parser.add_argument(
        "--out-json",
        default="",
        help="JSON output path (default: baseline or report json)",
    )
    args = parser.parse_args()

    report = run_audit(strict=args.strict)
    out_json = Path(args.out_json) if args.out_json else (
        ROOT / "scripts" / (
            "human_ontology_audit_report.json"
            if args.strict
            else "human_ontology_audit_baseline.json"
        )
    )
    out_md = out_json.with_suffix(".md")
    out_json.write_text(json.dumps(report, indent=2), encoding="utf-8")
    _write_markdown(report, out_md)
    print(f"Wrote {out_json}")
    print(f"Wrote {out_md}")

    if args.strict and report.get("violations"):
        print(f"FAIL: {len(report['violations'])} violations", file=sys.stderr)
        for v in report["violations"][:20]:
            print(f"  - {v}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
