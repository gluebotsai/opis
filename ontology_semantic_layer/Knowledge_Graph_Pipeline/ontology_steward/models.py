"""Shared datatypes for the Ontology Steward MAS."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class ProposalDecision(str, Enum):
    REUSE = "reuse"
    NEW_TERM = "new_term"
    NEW_CLASS = "new_class"
    REJECT = "reject"
    NO_OP = "no_op"


class ApplyGate(str, Enum):
    AUTO = "auto"
    HUMAN = "human"


@dataclass
class FieldSignal:
    """One unmapped or candidate JSON key / column."""

    field: str
    table: str
    org: str
    sample_values: list[Any] = field(default_factory=list)
    source: str = "custom_json"  # custom_json | drift_column


@dataclass
class Understanding:
    industry: str
    industry_pack: str
    value_shape: str  # enum | measurement | coded_condition | sku | category_path | identity | junk
    taxonomy_route: str  # from taxonomy_router.yml
    notes: str = ""


@dataclass
class Proposal:
    field: str
    table: str
    org: str
    industry: str
    decision: ProposalDecision
    class_id: str | None = None
    graph_label: str | None = None
    term_id: str | None = None
    google_product_category: str | None = None
    shopify_category_gid: str | None = None
    shopify_attributes: list[dict[str, str]] = field(default_factory=list)
    relation: dict[str, str] | None = None
    cdc: dict[str, Any] = field(default_factory=dict)
    confidence: float = 0.0
    gate: ApplyGate = ApplyGate.HUMAN
    rationale: str = ""
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "field": self.field,
            "table": self.table,
            "org": self.org,
            "industry": self.industry,
            "decision": self.decision.value,
            "class_id": self.class_id,
            "graph_label": self.graph_label,
            "term_id": self.term_id,
            "google_product_category": self.google_product_category,
            "shopify_category_gid": self.shopify_category_gid,
            "shopify_attributes": self.shopify_attributes,
            "relation": self.relation,
            "cdc": self.cdc,
            "confidence": self.confidence,
            "gate": self.gate.value,
            "rationale": self.rationale,
            "errors": self.errors,
        }


@dataclass
class StewardContext:
    """Shared runtime context for all agents."""

    repo_root: str
    pipeline_root: str
    semantic_root: str
    org: str
    database: str = ""
    industry: str = ""
    industry_pack: str = ""
    dry_run: bool = False
    transcripts: list[dict[str, Any]] = field(default_factory=list)

    def log(self, agent: str, event: str, **payload: Any) -> None:
        self.transcripts.append({"agent": agent, "event": event, **payload})
