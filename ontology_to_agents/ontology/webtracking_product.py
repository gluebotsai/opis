"""Webtracking product ontology from ontoYMLs/webtracking.yml.

Sole source of ontology prompt content for product=webtracking.
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
WEBTRACKING_ONTOLOGY_PATH = PROJECT_DIR / "ontoYMLs" / "webtracking.yml"


def clear_webtracking_product_cache() -> None:
    load_webtracking_product_ontology.cache_clear()


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
            "webtracking ontology: lifted business_rules out of taxonomy "
            "(fix indentation in %s)",
            WEBTRACKING_ONTOLOGY_PATH,
        )


@lru_cache(maxsize=1)
def load_webtracking_product_ontology() -> dict[str, Any]:
    if not WEBTRACKING_ONTOLOGY_PATH.is_file():
        raise FileNotFoundError(
            f"Missing webtracking ontology: {WEBTRACKING_ONTOLOGY_PATH}"
        )
    with WEBTRACKING_ONTOLOGY_PATH.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    if not isinstance(data, dict) or "ontology" not in data:
        raise ValueError(
            f"{WEBTRACKING_ONTOLOGY_PATH} must contain an ontology: mapping"
        )
    ontology = data["ontology"]
    if not isinstance(ontology, dict):
        raise ValueError("ontology: must be a mapping")
    _lift_nested_business_rules(ontology)
    return ontology


def entity_names() -> set[str]:
    return set((load_webtracking_product_ontology().get("entities") or {}).keys())


def normalize_entity_name(name: str) -> str | None:
    raw = str(name or "").strip()
    if not raw:
        return None
    if raw in entity_names():
        return raw
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
            "Webtracking preset entity allowlist references names outside "
            f"ontoYMLs/webtracking.yml: {unknown}. "
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


def filter_webtracking_ontology(
    *,
    full: bool,
    entity_allowlist: list[str] | None,
    taxonomy_allowlist: list[str] | None = None,
) -> dict[str, Any]:
    """Build ontology mapping for prompt: full file or filtered subset."""
    src = load_webtracking_product_ontology()
    if full or not entity_allowlist:
        return deepcopy(src)

    allowed = set(entity_allowlist)
    unknown = allowed - entity_names()
    if unknown:
        raise ValueError(
            f"Unknown webtracking entities in allowlist: {sorted(unknown)}"
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
            k: v for k, v in tax_src.items() if k in set(taxonomy_allowlist)
        }
    else:
        prefixes = {e.lower() for e in allowed}
        taxonomy = {}
        for axis, terms in tax_src.items():
            head = str(axis).split(".", 1)[0].lower()
            if head in prefixes or any(
                e.lower().startswith(head) or head.startswith(e.lower()[:4])
                for e in allowed
            ):
                taxonomy[axis] = terms
        # Explicit axes for common Insights entities
        if "Website" in allowed and "website.site_type" in tax_src:
            taxonomy["website.site_type"] = tax_src["website.site_type"]
        if "Session" in allowed and "session.device" in tax_src:
            taxonomy["session.device"] = tax_src["session.device"]
        if "Conversion" in allowed and "conversion.conversion_type" in tax_src:
            taxonomy["conversion.conversion_type"] = tax_src[
                "conversion.conversion_type"
            ]
        if "PerformanceMeasure" in allowed:
            for key in ("performance.metric_name", "performance.rating"):
                if key in tax_src:
                    taxonomy[key] = tax_src[key]
        if "Error" in allowed and "error.error_type" in tax_src:
            taxonomy["error.error_type"] = tax_src["error.error_type"]

    return {
        "name": src.get("name"),
        "purpose": src.get("purpose"),
        "entities": entities,
        "relations": relations,
        "synonyms": synonyms,
        "taxonomy": taxonomy,
        "business_rules": list(src.get("business_rules") or []),
    }


def dump_webtracking_prompt(ontology: dict[str, Any]) -> str:
    doc = {"ontology": ontology}
    return yaml.dump(
        doc,
        sort_keys=False,
        default_flow_style=False,
        allow_unicode=True,
    )
