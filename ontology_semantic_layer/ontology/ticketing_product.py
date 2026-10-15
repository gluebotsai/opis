"""Ticketing product ontology from ontoYMLs/ticketing.yml.

Sole source of ontology prompt content for product=ticketing.
"""

from __future__ import annotations

import logging
from copy import deepcopy
from functools import lru_cache
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise ImportError("PyYAML is required: pip install pyyaml") from exc

logger = logging.getLogger(__name__)

PROJECT_DIR = Path(__file__).resolve().parents[1]
TICKETING_ONTOLOGY_PATH = PROJECT_DIR / "ontoYMLs" / "ticketing.yml"

# Legacy preset class ids → product entity names in ticketing.yml
LEGACY_ENTITY_MAP: dict[str, str] = {
    "Contact": "Customer",
    "wt:Contact": "Customer",
    "wt:Customer": "Customer",
    "CustomerProfile": "Customer",
    "Account": "Company",
    "ContactAccount": "Company",
    "wt:Account": "Company",
    "Agent": "Staff",
    "wt:Agent": "Staff",
    "wt:Employee": "Staff",
    "User": "Staff",
    "Employee": "Staff",
    "Team": "Queue",
    "wt:Team": "Queue",
    "TicketNote": "Note",
    "CaseNote": "Note",
    "wt:TicketNote": "Note",
    "Suggestion": "Recommendation",
    "ProactiveRecommendation": "Recommendation",
    "AuditLog": "AuditEvent",
    "CaseAuditLog": "AuditEvent",
    "Conversation": "AssistantSession",
    "ChatSession": "AssistantSession",
    "Organization": "Tenant",
    "wt:Organization": "Tenant",
    "InboundEmail": "Email",
    "OutboundEmail": "Email",
    "KbCategory": "KnowledgeArticle",
    "TicketDraft": "Ticket",
    "TicketPriorityDef": "Ticket",
    "TicketStatusDef": "Ticket",
    "PerformanceReport": "Ticket",
    "Anomaly": "AuditEvent",
    "HubRequest": "Tenant",
    "DispatchAction": "Tenant",
    "Strategy": "Tenant",
    "Spoke": "Tenant",
    "wt:Ticket": "Ticket",
    "wt:SLA": "SLA",
    "wt:Macro": "Macro",
    "wt:KnowledgeArticle": "KnowledgeArticle",
    "wt:Queue": "Queue",
}


def clear_ticketing_product_cache() -> None:
    load_ticketing_product_ontology.cache_clear()


def _lift_nested_business_rules(ontology: dict[str, Any]) -> None:
    """Self-heal if business_rules were indented under taxonomy: by mistake."""
    taxonomy = ontology.get("taxonomy")
    nested = None
    if isinstance(taxonomy, dict) and "business_rules" in taxonomy:
        nested = taxonomy.pop("business_rules")
    rules = ontology.get("business_rules")
    if isinstance(rules, list) and rules:
        return
    if isinstance(nested, list) and nested:
        ontology["business_rules"] = list(nested)
        logger.warning(
            "ticketing ontology: lifted business_rules out of taxonomy "
            "(fix indentation in %s)",
            TICKETING_ONTOLOGY_PATH,
        )


@lru_cache(maxsize=1)
def load_ticketing_product_ontology() -> dict[str, Any]:
    if not TICKETING_ONTOLOGY_PATH.is_file():
        raise FileNotFoundError(f"Missing ticketing ontology: {TICKETING_ONTOLOGY_PATH}")
    with TICKETING_ONTOLOGY_PATH.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    if not isinstance(data, dict) or "ontology" not in data:
        raise ValueError(f"{TICKETING_ONTOLOGY_PATH} must contain an ontology: mapping")
    ontology = data["ontology"]
    if not isinstance(ontology, dict):
        raise ValueError("ontology: must be a mapping")
    _lift_nested_business_rules(ontology)
    return ontology


def entity_names() -> set[str]:
    return set((load_ticketing_product_ontology().get("entities") or {}).keys())


def normalize_entity_name(name: str) -> str | None:
    raw = str(name or "").strip()
    if not raw:
        return None
    if raw.startswith("wt:"):
        mapped = LEGACY_ENTITY_MAP.get(raw) or LEGACY_ENTITY_MAP.get(raw[3:])
        if mapped:
            return mapped if mapped in entity_names() else None
        short = raw[3:]
        return short if short in entity_names() else None
    if raw in entity_names():
        return raw
    mapped = LEGACY_ENTITY_MAP.get(raw)
    if mapped and mapped in entity_names():
        return mapped
    return None


def resolve_entity_allowlist(prompt_spec: dict[str, Any] | None) -> list[str] | None:
    """Return sorted allowlist from prompt.entities or legacy prompt.classes.

    None means full ontology (caller decides via full_ontology flag).
    """
    spec = prompt_spec or {}
    raw_list = list(spec.get("entities") or [])
    if not raw_list:
        raw_list = list(spec.get("classes") or [])
    if not raw_list:
        return None
    resolved: list[str] = []
    unknown: list[str] = []
    for item in raw_list:
        name = normalize_entity_name(str(item))
        if name is None:
            unknown.append(str(item))
            continue
        if name not in resolved:
            resolved.append(name)
    if unknown:
        raise ValueError(
            "Ticketing preset entity allowlist references names outside "
            f"ontoYMLs/ticketing.yml: {unknown}. "
            f"Known: {sorted(entity_names())}"
        )
    return sorted(resolved)


def _parse_relation(line: str) -> tuple[str, str, str] | None:
    text = str(line or "").strip()
    if " - " not in text or " -> " not in text:
        return None
    left, rest = text.split(" - ", 1)
    verb, right = rest.split(" -> ", 1)
    return left.strip(), verb.strip(), right.strip()


def filter_ticketing_ontology(
    *,
    full: bool,
    entity_allowlist: list[str] | None,
    taxonomy_allowlist: list[str] | None = None,
) -> dict[str, Any]:
    """Build ontology mapping for prompt: full file or filtered subset."""
    src = load_ticketing_product_ontology()
    if full or not entity_allowlist:
        return deepcopy(src)

    allowed = set(entity_allowlist)
    unknown = allowed - entity_names()
    if unknown:
        raise ValueError(
            f"Unknown ticketing entities in allowlist: {sorted(unknown)}"
        )

    entities = {
        k: deepcopy(v)
        for k, v in (src.get("entities") or {}).items()
        if k in allowed
    }
    relations: list[str] = []
    for line in src.get("relations") or []:
        parsed = _parse_relation(str(line))
        if not parsed:
            continue
        left, _verb, right = parsed
        if left in allowed and right in allowed:
            relations.append(str(line))

    synonyms = {
        k: list(v) if isinstance(v, list) else v
        for k, v in (src.get("synonyms") or {}).items()
        if k in allowed
    }

    tax_src = dict(src.get("taxonomy") or {})
    if taxonomy_allowlist:
        taxonomy = {
            k: v
            for k, v in tax_src.items()
            if k in set(taxonomy_allowlist)
        }
    else:
        # Keep axes whose first segment matches a scoped entity (lowercased).
        prefixes = {e.lower() for e in allowed}
        taxonomy = {}
        for axis, terms in tax_src.items():
            head = str(axis).split(".", 1)[0].lower()
            if head in prefixes or any(
                e.lower().startswith(head) or head.startswith(e.lower()[:4])
                for e in allowed
            ):
                taxonomy[axis] = terms
        # Always keep staff.role / ticket.* when Staff or Ticket present
        if "Staff" in allowed and "staff.role" in tax_src:
            taxonomy["staff.role"] = tax_src["staff.role"]
        if "Staff" in allowed and "staff.status" in tax_src:
            taxonomy["staff.status"] = tax_src["staff.status"]
        if "Ticket" in allowed:
            for key in (
                "ticket.status",
                "ticket.priority",
                "ticket.channel",
                "ticket.category",
            ):
                if key in tax_src:
                    taxonomy[key] = tax_src[key]

    out: dict[str, Any] = {
        "name": src.get("name"),
        "purpose": src.get("purpose"),
        "entities": entities,
        "relations": relations,
        "synonyms": synonyms,
        "taxonomy": taxonomy,
        # Product guardrails stay consistent for every agent
        "business_rules": list(src.get("business_rules") or []),
    }
    return out


def dump_ticketing_prompt(ontology: dict[str, Any]) -> str:
    doc = {"ontology": ontology}
    return yaml.dump(
        doc,
        sort_keys=False,
        default_flow_style=False,
        allow_unicode=True,
    )
