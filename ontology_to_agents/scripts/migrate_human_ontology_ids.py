#!/usr/bin/env python3
"""Strip wt:* prefixes from ontology YAML modules/slices and apply id renames."""

from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    yaml = None  # type: ignore

ROOT = Path(__file__).resolve().parent.parent
ONTOLOGY = ROOT / "ontology"
SQL_AGENT = ROOT / "sql_agent"
SEMANTIC = ROOT / "semantic"

# wt:id -> plain id (order matters for compound replacements)
ID_MAP = [
    ("wt:action.", "action."),
    ("wt:TicketNote", "Note"),
    ("wt:TicketDraft", "TicketDraft"),
    ("wt:Ticket", "Ticket"),
    ("wt:Interaction", "Conversation"),
    ("wt:Customer", "Contact"),
    ("wt:Contact", "Contact"),
    ("wt:Employee", "Agent"),
    ("wt:Person", "Person"),
    ("wt:Organization", "Organization"),
    ("wt:Party", "Party"),
    ("wt:WorkItem", "WorkItem"),
    ("wt:SLA", "SLA"),
    ("wt:Queue", "Queue"),
    ("wt:Team", "Team"),
    ("wt:Channel", "Channel"),
    ("wt:Consent", "Consent"),
    ("wt:Preference", "Preference"),
    ("wt:Identity", "Identity"),
    ("wt:Event", "Event"),
    ("wt:Location", "Location"),
    ("wt:Deal", "Deal"),
    ("wt:Offering", "Offering"),
    ("wt:Campaign", "Campaign"),
    ("wt:Segment", "Segment"),
    ("wt:KnowledgeArticle", "KnowledgeArticle"),
    ("wt:Macro", "Macro"),
    ("wt:Approval", "Approval"),
    ("wt:ClinicalObservation", "ClinicalObservation"),
    ("wt:MedicalCondition", "MedicalCondition"),
    ("wt:Vehicle", "Vehicle"),
    ("wt:WorkforceAgent", "Agent"),
    ("wt:MessageDelivery", "Message"),
    ("wt:PerformanceReport", "PerformanceReport"),
]

WT_RE = re.compile(r"\bwt:[A-Za-z0-9_.]+\b")


def _replace_ids(text: str) -> str:
    for old, new in ID_MAP:
        text = text.replace(old, new)
    # Fallback: strip any remaining wt: prefix
    text = WT_RE.sub(lambda m: m.group(0).removeprefix("wt:"), text)
    return text


def migrate_file(path: Path, dry_run: bool = False) -> bool:
    original = path.read_text(encoding="utf-8")
    updated = _replace_ids(original)
    if updated == original:
        return False
    if not dry_run:
        path.write_text(updated, encoding="utf-8")
    return True


def main(argv: list[str] | None = None) -> int:
    dry_run = "--dry-run" in (argv or sys.argv[1:])
    changed = 0
    roots = [ONTOLOGY, SQL_AGENT / "catalog", SEMANTIC / "catalog"]
    for base in roots:
        if not base.exists():
            continue
        for pattern in ("**/*.yml", "**/*.yaml"):
            for path in base.glob(pattern):
                if "definitions/entities.yml" in str(path):
                    continue
                if migrate_file(path, dry_run=dry_run):
                    changed += 1
                    print(f"{'would update' if dry_run else 'updated'}: {path.relative_to(ROOT)}")
    print(f"{'would change' if dry_run else 'changed'} {changed} files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
