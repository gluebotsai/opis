"""Compose a deterministic ontology slice from named modules or a catalog preset.

Usage:
    from ontology.slice import fetch_ontology_slice

    pack = fetch_ontology_slice(modules=["identity", "interaction", "ticket"])
    # or
    pack = fetch_ontology_slice(preset="cc.ai_support")

    # Keep this in the agent system prompt on every turn (compact by default):
    context = pack.as_prompt()                 # mode="compact"
    debug = pack.as_prompt(mode="verbose")     # full dump for admin/debug
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise ImportError("PyYAML is required: pip install pyyaml") from exc

ONTOLOGY_DIR = Path(__file__).resolve().parent
PROJECT_DIR = ONTOLOGY_DIR.parent
CATALOG_PATH = ONTOLOGY_DIR / "catalog.yml"
PRESETS_DIR = ONTOLOGY_DIR / "presets"
METRICS_MODULE_PREFIX = "metrics_"
METRIC_POLICIES_PATH = ONTOLOGY_DIR / "metric_policies.yml"
AGENTS_PATH = ONTOLOGY_DIR / "agents.yml"
TAXONOMY_PATH = ONTOLOGY_DIR / "taxonomy.yml"
INDUSTRY_DIR = ONTOLOGY_DIR / "industry"
TENANTS_DIR = PROJECT_DIR / "tenants"
MAX_ALIAS_LINES = 24


def _load_yaml(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a YAML mapping")
    return data


def _as_id(item: Any) -> str | None:
    if isinstance(item, str):
        return item
    if isinstance(item, dict) and item.get("id"):
        return str(item["id"])
    return None


def _dedupe(items: Iterable[Any]) -> list[Any]:
    seen: set[str] = set()
    out: list[Any] = []
    for item in items:
        key = None
        if isinstance(item, dict):
            key = item.get("id") or (
                f"{item.get('from')}|{item.get('type')}|{item.get('to')}"
                if item.get("type")
                else None
            )
        elif isinstance(item, str):
            key = item
        else:
            key = repr(item)
        if key in seen:
            continue
        seen.add(str(key))
        out.append(item)
    return out


_METRIC_POLICIES: dict[str, Any] | None = None


def _metric_policies() -> dict[str, Any]:
    global _METRIC_POLICIES
    if _METRIC_POLICIES is None:
        if METRIC_POLICIES_PATH.exists():
            data = _load_yaml(METRIC_POLICIES_PATH)
            _METRIC_POLICIES = data.get("metrics") or {}
        else:
            _METRIC_POLICIES = {}
    return _METRIC_POLICIES


def clear_ontology_cache() -> None:
    """Drop in-memory catalog and metric-policies caches (reload from disk on next fetch)."""
    global _CATALOG, _METRIC_POLICIES, _AGENT_VISIBLE_CACHE
    _CATALOG = None
    _METRIC_POLICIES = None
    _AGENT_VISIBLE_CACHE = None
    try:
        from ontology.graph_nodes import clear_graph_nodes_cache

        clear_graph_nodes_cache()
    except ImportError:
        pass
    try:
        from ontology.ticketing_product import clear_ticketing_product_cache

        clear_ticketing_product_cache()
    except ImportError:
        pass
    try:
        from ontology.webtracking_product import clear_webtracking_product_cache

        clear_webtracking_product_cache()
    except ImportError:
        pass


def _is_data_rule(rule: str) -> bool:
    """Keep ontology data rules; drop routing/delegation/KPI operational lines."""
    text = (rule or "").strip().lower()
    if not text:
        return False
    skip_markers = (
        "route to",
        "delegate",
        "remount",
        "semantic",
        "sql",
        "kpi",
        "analytics",
        "executor",
        "domain",
        "never ",
        "only —",
        "do not file",
        "do not collect",
        "do not publish",
        "do not create",
        "do not assign",
        "do not mutate",
        "do not invent counts",
        "skill ",
        "notify ",
        "inbox ",
        "macro crud",
        "kb crud",
        "team/queue",
        "catalog crud",
        "org settings",
        "draft ",
        "search ",
        "recommend ",
        "classify/",
        "escalate at-risk",
        "read-only",
        "read/list",
        "list/show",
        "how-many",
        "_metric",
        "time.grain",
        "metricflow",
    )
    return not any(marker in text for marker in skip_markers)


# KG-only / abstract types — never in product agent compact prompts.
KG_ONLY_CLASS_IDS = frozenset({
    "Party", "Person", "WorkItem", "Event", "Location", "Identity",
    "ContactProfile", "ContactDraft", "ContactSkill", "Consent", "Preference",
    "Channel", "TicketPriorityDef", "TicketStatusDef", "OrganizationDirectory",
    "KbCategory", "TicketDraft", "WorkforceAgent", "User", "Employee",
    "ProactiveRecommendation", "AsgaDecision",
})
KG_ONLY_GRAPH_LABELS = frozenset({
    "User", "Employee", "ConfigurationHub", "SupportHub", "ServiceOperationsHub",
    "CustomerIntelligenceHub", "MarketingHub", "DigitalPresenceHub",
    "OfferingCatalog", "SalesProfile", "SupportProfile", "QueueDefinition",
    "KnowledgeDocument", "CaseAuditLog", "ProactiveEventLog",
})
IDENTITY_PRESETS = frozenset({"identity", "tk.admin", "tk.catalog_administration_domain"})

PRODUCT_SITUATION_CLASSES: dict[str, frozenset[str]] = {
    "ticketing": frozenset({
        "Ticket", "Contact", "Agent", "Queue", "Team", "Note", "SLA",
        "ContactAccount", "Macro", "KnowledgeArticle", "Conversation",
        "Suggestion", "Approval", "HubRequest", "DispatchAction", "Spoke",
        "Skill", "Strategy", "Anomaly", "PerformanceReport",
    }),
    "contact_centre": frozenset({
        "Conversation", "Contact", "Agent", "Queue", "Team", "Task", "SLA",
        "KnowledgeArticle", "Callback", "Disposition", "AgentPresence",
        "MonitoringSnapshot", "HubRequest", "DispatchAction", "Spoke",
    }),
    "crm": frozenset({
        "Deal", "Contact", "Account", "Agent", "Quote", "Meeting", "Organization",
    }),
}

STAFF_SCOPE_RULES = [
    "Admin staff role: org-wide ticket access unless the user asks for a personal slice.",
    "Agent staff role: default tickets where assigned_to = me.",
    "Resolver staff role: default tickets where resolved_by = me or assigned_to = me.",
    "Reassign L1 (assigned_to) and L2 (resolved_by) separately — never swap.",
]

_AGENT_VISIBLE_CACHE: dict[str, bool] | None = None


def _agent_visible_by_entity() -> dict[str, bool]:
    global _AGENT_VISIBLE_CACHE
    if _AGENT_VISIBLE_CACHE is not None:
        return _AGENT_VISIBLE_CACHE
    path = ONTOLOGY_DIR / "definitions" / "entities.yml"
    out: dict[str, bool] = {}
    if path.exists():
        data = _load_yaml(path)
        for eid, spec in (data.get("entities") or {}).items():
            if isinstance(spec, dict) and "agent_visible" in spec:
                out[str(eid)] = bool(spec["agent_visible"])
    _AGENT_VISIBLE_CACHE = out
    return out


def _is_identity_preset(preset: str | None, agent: str | None) -> bool:
    pid = (preset or "").strip()
    aid = (agent or "").strip()
    return pid in IDENTITY_PRESETS or aid in IDENTITY_PRESETS


def _situation_class_allowlist(product: str | None, preset: str | None) -> frozenset[str] | None:
    if not product:
        return None
    if (preset or "").endswith(".super"):
        return PRODUCT_SITUATION_CLASSES.get(product)
    return None


def _filter_situation_classes(
    class_ids: set[str],
    product: str | None,
    preset: str | None,
    agent: str | None,
) -> set[str]:
    allow = _situation_class_allowlist(product, preset)
    if allow is None:
        return class_ids
    if _is_identity_preset(preset, agent):
        return class_ids
    return {cid for cid in class_ids if cid in allow and cid not in KG_ONLY_CLASS_IDS}


def _filter_graph_labels(labels: set[str], preset: str | None, agent: str | None) -> set[str]:
    if _is_identity_preset(preset, agent):
        return labels
    return {lbl for lbl in labels if lbl not in KG_ONLY_GRAPH_LABELS}


def _format_threshold(th: dict[str, Any]) -> str:
    parts: list[str] = []
    if th.get("warn") is not None:
        parts.append(f"warn {th['warn']}")
    if th.get("critical") is not None:
        parts.append(f"critical {th['critical']}")
    if th.get("warn_percent") is not None:
        parts.append(f"warn {th['warn_percent']}%")
    if th.get("critical_percent") is not None:
        parts.append(f"critical {th['critical_percent']}%")
    if th.get("warn_lt") is not None:
        parts.append(f"warn below {th['warn_lt']}")
    if th.get("critical_lt") is not None:
        parts.append(f"critical below {th['critical_lt']}")
    return ", ".join(parts)


def _format_metric_lines(
    metric_ids: list[str],
    org_overlays: dict[str, Any] | None = None,
) -> list[str]:
    policies = _metric_policies()
    overlays = org_overlays or {}
    lines: list[str] = []
    for mid in metric_ids:
        pol = policies.get(mid) or {}
        org = overlays.get(mid) or {}
        label = pol.get("label")
        on = pol.get("on") or org.get("on")
        dims = pol.get("dims") or pol.get("group_by") or []
        when = pol.get("when", "")
        not_for = pol.get("not_for", "")

        head = f"- {mid}"
        if label and label != mid:
            head += f" ({label})"
        if on:
            head += f" on {on}"
        if dims:
            head += f"  group_by/filter: {', '.join(str(d) for d in dims)}"
        lines.append(head)
        detail_parts: list[str] = []
        if when:
            detail_parts.append(f"when: {when}")
        if not_for:
            detail_parts.append(f"not: {not_for}")
        if detail_parts:
            lines.append(f"  {'  |  '.join(detail_parts)}")
    return lines


def _format_alias_lines(
    synonyms: dict[str, str],
    *,
    max_lines: int = MAX_ALIAS_LINES,
) -> list[str]:
    """Spoken words -> wt:* (type aliases only, not metric synonyms)."""
    by_target: dict[str, list[str]] = {}
    for word, target in synonyms.items():
        if not word or not target:
            continue
        t = str(target).strip()
        if not t.startswith("wt:"):
            continue
        by_target.setdefault(t, []).append(str(word).strip())
    lines: list[str] = []
    for target in sorted(by_target):
        words = sorted(set(by_target[target]))
        if not words:
            continue
        lines.append(f"- {', '.join(words)} -> {target}")
        if len(lines) >= max_lines:
            lines.append("- … (more aliases in tenant config)")
            break
    return lines


def _short_def(text: str, max_words: int = 12) -> str:
    words = (text or "").strip().split()
    if len(words) <= max_words:
        return " ".join(words)
    return " ".join(words[:max_words]).rstrip(".,;:") + "…"


def _action_key(action_id: str) -> str:
    aid = action_id or ""
    if aid.startswith("wt:action."):
        return aid[len("wt:action.") :]
    return aid


def _action_allowed(action_id: str, allow: list[str]) -> bool:
    if not allow:
        return True
    aid = action_id or ""
    short = _action_key(aid)
    return aid in allow or short in allow or f"wt:action.{short}" in allow


def _metrics_mode(spec: dict[str, Any], preset_id: str | None) -> str:
    """none | headlines | full — how context metrics appear in compact prompt."""
    mode = spec.get("metrics_mode")
    if mode in ("none", "headlines", "full"):
        return str(mode)
    if preset_id and preset_id.endswith(".reporting_mas"):
        return "full"
    return "headlines"


def _preset_belongs_to_product(preset_id: str, product: str) -> bool:
    prefixes = {
        "contact_centre": ("cc.",),
        "ticketing": ("tk.",),
        "crm": ("crm.",),
        "campaign": ("camp.",),
        "cdp": ("cdp.",),
        "webtracking": ("webtracking.",),
    }
    pfx = prefixes.get(product, ())
    if any(preset_id.startswith(p) for p in pfx):
        return True
    if product == "ticketing" and preset_id.endswith("_domain"):
        return True
    if product == "crm" and preset_id in {
        "crm-agent",
        "enrich-lead",
        "score-lead",
        "assign-sales",
        "meeting-brief-email",
        "analyze-transcript",
        "audit-forecast",
    }:
        return True
    return False


def _is_reporting_preset(preset_id: str) -> bool:
    return (
        preset_id.endswith(".reporting")
        or preset_id.endswith(".reporting_mas")
        or preset_id.endswith(".reports")
        or preset_id == "cdp.profile"
        or preset_id
        in (
            "tk.analytics_audit_query_executor",
            "tk.insights_analytics_executor",
        )
    )


def _format_specialist_catalog(entries: list[dict[str, Any]]) -> list[str]:
    lines: list[str] = []
    for entry in entries:
        pid = entry.get("preset", "")
        label = entry.get("agent") or pid
        lines.append(f"- {pid} — {label}")
        runtime = entry.get("runtime") or []
        if runtime:
            lines.append(f"  runtime: {', '.join(runtime)}")
        actions = entry.get("actions") or []
        if actions:
            lines.append(f"  actions: {', '.join(str(a) for a in actions)}")
    return lines


def _class_allowed(class_id: str, allow: list[str] | None) -> bool:
    if not allow:
        return True
    return class_id in allow


@dataclass
class OntologySlice:
    """Compiled ontology pack for one agent — inject as_prompt() every turn."""

    modules: list[str]
    resolved_modules: list[str]
    preset: str | None = None
    agent: str | None = None
    ontology_id: str = "cc"
    version: str = "2026.09.1"
    classes: list[dict[str, Any]] = field(default_factory=list)
    relations: list[dict[str, Any]] = field(default_factory=list)
    actions: list[dict[str, Any]] = field(default_factory=list)
    metric_ids: list[str] = field(default_factory=list)
    taxonomy: dict[str, Any] = field(default_factory=dict)
    labels: dict[str, str] = field(default_factory=dict)
    synonyms: dict[str, str] = field(default_factory=dict)
    industry_pack: str | None = None
    org_metric_overlays: dict[str, Any] = field(default_factory=dict)
    usecases: dict[str, str] = field(default_factory=dict)
    prompt_spec: dict[str, Any] = field(default_factory=dict)
    specialist_catalog: list[dict[str, Any]] = field(default_factory=list)
    context: Any = None  # semantic.context.ResolvedContext when packed
    product: str | None = None
    hub_products: list[str] = field(default_factory=list)

    def class_ids(self) -> list[str]:
        return [c["id"] for c in self.classes if isinstance(c, dict) and c.get("id")]

    def action_ids(self) -> list[str]:
        return [a["id"] for a in self.actions if isinstance(a, dict) and a.get("id")]

    def to_dict(self) -> dict[str, Any]:
        return {
            "ontology": self.ontology_id,
            "version": self.version,
            "preset": self.preset,
            "agent": self.agent,
            "modules": self.modules,
            "resolved_modules": self.resolved_modules,
            "classes": self.classes,
            "relations": self.relations,
            "actions": self.actions,
            "metric_ids": self.metric_ids,
            "taxonomy": self.taxonomy,
            "labels": self.labels,
            "synonyms": self.synonyms,
            "industry_pack": self.industry_pack,
            "org_metric_overlays": self.org_metric_overlays,
            "usecases": self.usecases,
            "prompt_spec": self.prompt_spec,
        }

    def _is_ticketing_product(self) -> bool:
        raw = (self.product or "").strip()
        if not raw:
            return False
        try:
            return normalize_product_id(raw) == "ticketing"
        except ValueError:
            return False

    def _ticketing_ontology_doc(self) -> dict[str, Any]:
        from ontology.ticketing_product import (
            filter_ticketing_ontology,
            resolve_entity_allowlist,
        )

        spec = self.prompt_spec or {}
        full = bool(spec.get("full_ontology")) or (self.preset or "").endswith(
            ".super"
        )
        allow = None if full else resolve_entity_allowlist(spec)
        if not full and not allow:
            raise ValueError(
                f"Ticketing agent '{self.agent or self.preset}' must declare "
                "prompt.entities (or legacy prompt.classes) unless full_ontology is true."
            )
        tax_allow = list(spec.get("taxonomy") or []) or None
        return filter_ticketing_ontology(
            full=full,
            entity_allowlist=allow,
            taxonomy_allowlist=tax_allow if not full else None,
        )

    def _is_webtracking_product(self) -> bool:
        raw = (self.product or "").strip()
        if not raw:
            return False
        try:
            return normalize_product_id(raw) == "webtracking"
        except ValueError:
            return False

    def _webtracking_ontology_doc(self) -> dict[str, Any]:
        from ontology.webtracking_product import (
            filter_webtracking_ontology,
            resolve_entity_allowlist,
        )

        spec = self.prompt_spec or {}
        full = bool(spec.get("full_ontology"))
        allow = None if full else resolve_entity_allowlist(spec)
        if not full and not allow:
            raise ValueError(
                f"Webtracking agent '{self.agent or self.preset}' must declare "
                "prompt.entities (or legacy prompt.classes) unless full_ontology is true."
            )
        tax_allow = list(spec.get("taxonomy") or []) or None
        return filter_webtracking_ontology(
            full=full,
            entity_allowlist=allow,
            taxonomy_allowlist=tax_allow if not full else None,
        )

    def to_public_dict(self) -> dict[str, Any]:
        """API-safe slice without wt:* ids in classes, actions, or labels."""
        if self._is_ticketing_product():
            doc = self._ticketing_ontology_doc()
            return {
                "ontology": public_ontology_id(self.ontology_id),
                "version": self.version,
                "preset": self.preset,
                "agent": self.agent,
                "modules": self.modules,
                "resolved_modules": self.resolved_modules,
                "product_ontology": doc,
                "metric_ids": list(self.metric_ids),
                "industry_pack": self.industry_pack,
                "usecases": self.usecases,
            }

        if self._is_webtracking_product():
            doc = self._webtracking_ontology_doc()
            return {
                "ontology": public_ontology_id(self.ontology_id),
                "version": self.version,
                "preset": self.preset,
                "agent": self.agent,
                "modules": self.modules,
                "resolved_modules": self.resolved_modules,
                "product_ontology": doc,
                "metric_ids": list(self.metric_ids),
                "industry_pack": self.industry_pack,
                "usecases": self.usecases,
            }

        from ontology.graph_nodes import GraphIndex

        gi = GraphIndex.get()
        public_classes: list[dict[str, Any]] = []
        for cls in self.classes:
            if not isinstance(cls, dict):
                continue
            cid = str(cls.get("id") or "")
            label = gi.label_for_class(cid) or cid.removeprefix("wt:")
            row = _publicize_value(
                {k: v for k, v in cls.items() if k != "id"}, gi
            )
            row["label"] = label
            if "definition" in row and isinstance(row["definition"], str):
                row["definition"] = row["definition"].replace("wt:", "")
            public_classes.append(row)
        public_actions: list[dict[str, Any]] = []
        for act in self.actions:
            if not isinstance(act, dict):
                continue
            aid = str(act.get("id") or "")
            short = _action_key(aid)
            row = _publicize_value(
                {k: v for k, v in act.items() if k != "id"}, gi
            )
            row["name"] = short
            if "operates_on" in row:
                row["operates_on"] = [
                    gi.label_for_class(str(x)) or str(x).removeprefix("wt:")
                    for x in (row.get("operates_on") or [])
                ]
            if "requires" in row:
                row["requires"] = list(row.get("requires") or [])
            public_actions.append(row)
        public_relations: list[dict[str, Any]] = []
        for rel in self.relations:
            if not isinstance(rel, dict):
                continue
            public_relations.append(
                {
                    "from": gi.label_for_class(str(rel.get("from") or ""))
                    or str(rel.get("from") or "").removeprefix("wt:"),
                    "type": rel.get("type"),
                    "to": gi.label_for_class(str(rel.get("to") or ""))
                    or str(rel.get("to") or "").removeprefix("wt:"),
                }
            )
        public_labels = {
            gi.label_for_class(str(k)) or str(k).removeprefix("wt:"): v
            for k, v in (self.labels or {}).items()
        }
        public_synonyms: dict[str, str] = {}
        for word, target in (self.synonyms or {}).items():
            label = gi.resolve_synonym_target(str(target))
            if label:
                public_synonyms[str(word)] = label
        public_taxonomy = _publicize_value(dict(self.taxonomy), gi)
        for axis, spec_t in list(public_taxonomy.items()):
            if isinstance(spec_t, dict) and "classified_classes" in spec_t:
                spec_t["classified_classes"] = [
                    gi.label_for_class(str(c)) or str(c).removeprefix("wt:")
                    for c in (spec_t.get("classified_classes") or [])
                ]

        return {
            "ontology": public_ontology_id(self.ontology_id),
            "version": self.version,
            "preset": self.preset,
            "agent": self.agent,
            "modules": self.modules,
            "resolved_modules": self.resolved_modules,
            "classes": public_classes,
            "relations": public_relations,
            "actions": public_actions,
            "metric_ids": list(self.metric_ids),
            "taxonomy": public_taxonomy,
            "labels": public_labels,
            "synonyms": public_synonyms,
            "industry_pack": self.industry_pack,
            "usecases": self.usecases,
        }

    def _view(self, mode: str) -> tuple[
        list[dict[str, Any]],
        list[dict[str, Any]],
        list[dict[str, Any]],
        list[str],
        dict[str, Any],
        dict[str, str],
    ]:
        spec = self.prompt_spec or {}
        compact = mode != "verbose"
        full_ontology = bool(spec.get("full_ontology"))
        class_allow = list(spec.get("classes") or []) if not full_ontology else []
        action_allow = list(spec.get("actions") or [])
        tax_allow = list(spec.get("taxonomy") or [])
        if not tax_allow and not full_ontology:
            tax_allow = []
        metric_allow = list(spec.get("metrics") or [])
        both_ends = bool(spec.get("relations_only_if_both_ends_in_classes", compact))
        metrics_mode = _metrics_mode(spec, self.preset)

        classes: list[dict[str, Any]] = []
        for cls in self.classes:
            cid = cls.get("id") or ""
            if class_allow:
                if cid not in class_allow:
                    continue
            elif compact and cls.get("prompt") is False:
                continue
            classes.append(cls)
        class_ids = {c.get("id") for c in classes}

        relations = []
        for rel in self.relations:
            if both_ends and (
                rel.get("from") not in class_ids or rel.get("to") not in class_ids
            ):
                continue
            relations.append(rel)

        actions = [
            a
            for a in self.actions
            if _action_allowed(str(a.get("id") or ""), action_allow)
        ]

        if metric_allow:
            metrics = [m for m in self.metric_ids if m in metric_allow]
        elif spec.get("metrics") is not None:
            metrics = []
        else:
            metrics = list(self.metric_ids)

        if tax_allow:
            taxonomy = {k: v for k, v in self.taxonomy.items() if k in tax_allow}
        elif full_ontology and not compact:
            taxonomy = dict(self.taxonomy)
        elif compact:
            taxonomy = {}
        else:
            taxonomy = dict(self.taxonomy)

        if self.context is not None:
            visible = set(self.context.visible_metric_ids or [])
            headlines = list(getattr(self.context, "headline_metric_ids", None) or [])
            if metrics_mode == "none":
                metrics = []
            elif metrics_mode == "full" and compact:
                metrics = sorted(visible)
            elif metrics_mode == "headlines" and compact and headlines:
                metrics = headlines
            elif visible:
                metrics = [m for m in metrics if m in visible]
            ctx_tax = getattr(self.context, "taxonomy", None) or {}
            if ctx_tax:
                taxonomy = dict(ctx_tax)
        elif metrics_mode == "none":
            metrics = []

        labels = {
            k: v for k, v in self.labels.items() if not class_ids or k in class_ids
        }
        return classes, relations, actions, metrics, taxonomy, labels

    def _ontology_name(self) -> str:
        spec = self.prompt_spec or {}
        if self.preset == HUB_PRESET_ID or self.agent == HUB_PRESET_ID:
            if self.hub_products:
                return "hub_" + "_".join(sorted(self.hub_products))
            return "hub"
        product = self.product or ""
        if spec.get("full_ontology") or (self.preset or "").endswith(".super"):
            return f"{product}_super" if product else "super"
        agent_key = (self.agent or self.preset or "agent").replace(".", "_")
        return f"{product}_{agent_key}" if product else agent_key

    def _definition_for_label(
        self,
        label: str,
        classes: list[dict[str, Any]],
        gi: Any,
    ) -> str:
        graph_def = gi.definition_for_label(label)
        if graph_def:
            return graph_def.split("\n")[0].strip()
        for cls in classes:
            cid = str(cls.get("id") or "")
            if gi.label_for_class(cid) == label:
                return (cls.get("definition") or "").strip().split("\n")[0]
        return ""

    def _synonyms_for_labels(
        self,
        labels: set[str],
        gi: Any,
    ) -> dict[str, list[str]]:
        by_label: dict[str, list[str]] = {}
        for word, target in (self.synonyms or {}).items():
            label = gi.resolve_synonym_target(str(target))
            if not label or label not in labels:
                continue
            by_label.setdefault(label, []).append(str(word).strip())
        for wt_id, display in (self.labels or {}).items():
            label = gi.resolve_synonym_target(str(wt_id))
            if not label or label not in labels:
                continue
            if display and display != label:
                by_label.setdefault(label, []).append(str(display))
        return {
            label: sorted(set(words))
            for label, words in sorted(by_label.items())
            if words
        }

    def _compact_labels_scope(
        self,
        classes: list[dict[str, Any]],
        gi: Any,
    ) -> set[str]:
        spec = self.prompt_spec or {}
        is_hub = self.preset == HUB_PRESET_ID or self.agent == HUB_PRESET_ID
        if is_hub and self.hub_products:
            return _filter_graph_labels(
                gi.labels_for_products(self.hub_products),
                self.preset,
                self.agent,
            )
        class_ids = {str(c.get("id") or "") for c in classes if c.get("id")}
        class_ids = _filter_situation_classes(
            class_ids, self.product, self.preset, self.agent
        )
        if spec.get("classes"):
            class_ids = {cid for cid in class_ids if cid in set(spec["classes"])}
        scoped = gi.labels_for_classes(class_ids)
        if not scoped and self.product and not spec.get("classes"):
            scoped = gi.labels_for_product(self.product)
        return _filter_graph_labels(scoped, self.preset, self.agent)

    def _compact_yaml_prompt(self) -> str:
        from ontology.graph_nodes import GraphIndex

        gi = GraphIndex.get()
        classes, relations, _actions, _metrics, taxonomy, _labels = self._view(
            "compact"
        )
        spec = self.prompt_spec or {}
        full_definitions = bool(spec.get("full_definitions"))
        label_scope = self._compact_labels_scope(classes, gi)

        entities: dict[str, dict[str, str]] = {}
        for label in sorted(label_scope):
            node = gi.node_for_label(label)
            if not node:
                continue
            defn = self._definition_for_label(label, classes, gi)
            if not defn:
                continue
            if not full_definitions:
                defn = _short_def(defn)
            entities[label] = {
                "definition": defn,
                "identifier": str(node.get("identifier") or ""),
            }

        rel_edges = gi.edges_for_labels(label_scope)
        relation_lines = [gi.format_relation(edge) for edge in rel_edges]
        for rel in relations:
            fr = gi.label_for_class(str(rel.get("from") or ""))
            to = gi.label_for_class(str(rel.get("to") or ""))
            rtype = str(rel.get("type") or "")
            if fr and to and fr in label_scope and to in label_scope and rtype:
                line = f"{fr} - {rtype} -> {to}"
                if line not in relation_lines:
                    relation_lines.append(line)

        synonyms = self._synonyms_for_labels(label_scope, gi)
        tax_out: dict[str, list[str]] = {}
        for axis, spec_t in (taxonomy or {}).items():
            terms = spec_t.get("terms") if isinstance(spec_t, dict) else spec_t
            if isinstance(terms, list):
                tax_out[str(axis)] = [str(t) for t in terms]

        business_rules = [
            rule
            for rule in (spec.get("rules") or [])
            if _is_data_rule(str(rule))
        ]
        tax_axes = set(tax_out)
        if "staff.role" in tax_axes or "ticket.assignee_role" in tax_axes:
            for rule in STAFF_SCOPE_RULES:
                if rule not in business_rules:
                    business_rules.append(rule)

        entity_labels = set(entities)
        scoped_relations: list[str] = []
        for line in relation_lines:
            if " -> " not in line:
                continue
            left, to_lbl = line.split(" -> ", 1)
            from_lbl = left.split(" - ", 1)[0].strip()
            if from_lbl in entity_labels and to_lbl.strip() in entity_labels:
                scoped_relations.append(line)
        relation_lines = scoped_relations
        doc: dict[str, Any] = {
            "ontology": {
                "name": self._ontology_name(),
                "entities": entities,
                "relations": relation_lines,
                "synonyms": synonyms,
                "taxonomy": tax_out,
                "business_rules": business_rules,
            }
        }
        if self.industry_pack and self.industry_pack != "generic":
            doc["ontology"]["industry_pack"] = self.industry_pack
        return yaml.dump(doc, sort_keys=False, default_flow_style=False, allow_unicode=True)

    def as_prompt(self, mode: str = "compact") -> str:
        """Block to append under the agent Context section.

        compact (default): data-only YAML (entities, relations, synonyms, taxonomy).
        verbose: full legal slice for debug/admin.
        """
        if mode not in {"compact", "verbose"}:
            raise ValueError("mode must be 'compact' or 'verbose'")
        if mode == "compact":
            if self._is_ticketing_product():
                # Product YAML owns guardrails; do not append prompt_spec.rules.
                from ontology.ticketing_product import dump_ticketing_prompt

                return dump_ticketing_prompt(self._ticketing_ontology_doc())
            if self._is_webtracking_product():
                # Product YAML owns guardrails; do not append prompt_spec.rules.
                from ontology.webtracking_product import dump_webtracking_prompt

                return dump_webtracking_prompt(self._webtracking_ontology_doc())
            return self._compact_yaml_prompt()
        compact = False
        classes, relations, actions, metrics, taxonomy, labels = self._view(mode)
        spec = self.prompt_spec or {}
        full_definitions = bool(spec.get("full_definitions"))

        lines = [
            "Ontology (this agent — use only these types and actions)",
            f"version: {self.version}  modules: {', '.join(self.resolved_modules)}",
        ]
        if self.agent:
            lines.append(f"agent: {self.agent}")
        if labels:
            alias = ", ".join(f"{k} shown as {v}" for k, v in labels.items())
            lines.append(f"labels: {alias}")
        if self.industry_pack:
            lines.append(f"industry_pack: {self.industry_pack}")

        alias_lines = _format_alias_lines(self.synonyms)
        if alias_lines and compact:
            lines.append("")
            lines.append("Aliases (spoken words map to type ids)")
            lines.extend(alias_lines)

        if spec.get("include_module_index") and self.usecases:
            lines.append("")
            lines.append("Modules")
            for mod in self.resolved_modules:
                usecase = (self.usecases.get(mod) or "").strip().split("\n")[0]
                if usecase:
                    lines.append(f"- {mod}: {_short_def(usecase, max_words=20)}")
                else:
                    lines.append(f"- {mod}")

        if spec.get("include_specialist_catalog") and self.specialist_catalog:
            lines.append("")
            lines.append("Specialists (delegate only — do not execute their writes)")
            lines.extend(_format_specialist_catalog(self.specialist_catalog))

        lines.append("")
        lines.append("Types")
        for cls in classes:
            cid = cls.get("id", "")
            full_def = (cls.get("definition") or "").strip().split("\n")[0]
            defn = full_def if full_definitions else _short_def(full_def)
            if compact:
                lines.append(f"- {cid}: {defn}" if defn else f"- {cid}")
            else:
                ext = f" extends {cls['extends']}" if cls.get("extends") else ""
                props = cls.get("properties") or []
                prop_s = f"  props: {', '.join(props)}" if props else ""
                full = (cls.get("definition") or "").strip().split("\n")[0]
                lines.append(f"- {cid}{ext}: {full}{prop_s}")

        if relations:
            lines.append("")
            lines.append("Relations")
            for rel in relations:
                lines.append(
                    f"- {rel.get('from')} --{rel.get('type')}--> {rel.get('to')}"
                )

        if actions:
            lines.append("")
            lines.append("Actions (only these; honor requires)")
            for act in actions:
                req = act.get("requires") or []
                req_s = f" requires: {', '.join(req)}" if req else ""
                if compact and not full_definitions:
                    lines.append(f"- {act.get('id')}{req_s}")
                elif compact and full_definitions:
                    defn = (act.get("definition") or "").strip().split("\n")[0]
                    extra = f" — {defn}" if defn else ""
                    lines.append(f"- {act.get('id')}{req_s}{extra}")
                else:
                    on = act.get("operates_on") or []
                    on_s = f" on {', '.join(on)}" if on else ""
                    defn = (act.get("definition") or "").strip().split("\n")[0]
                    extra = f" — {defn}" if defn else ""
                    lines.append(f"- {act.get('id')}{on_s}{req_s}{extra}")

        if metrics:
            lines.append("")
            lines.append("Metrics (ask_semantic; ids only; do not invent SQL)")
            lines.extend(_format_metric_lines(metrics, self.org_metric_overlays))

        if taxonomy:
            lines.append("")
            lines.append("Taxonomy (use these term ids)")
            for axis, spec_t in taxonomy.items():
                terms = spec_t.get("terms") if isinstance(spec_t, dict) else spec_t
                if isinstance(terms, list):
                    lines.append(f"- {axis}: {', '.join(str(t) for t in terms)}")

        route = spec.get("route_table") or []
        if route and compact:
            lines.append("")
            lines.append("Route")
            for row in route:
                lines.append(f"- {row}")

        lines.append("")
        rules = list(spec.get("rules") or [])
        if compact and rules:
            lines.append("Rules")
            for rule in rules:
                lines.append(f"- {rule}")
        else:
            lines.append(
                "Rules: do not invent types, relations, or metrics outside this slice. "
                "Do not invent instance facts; load them via tools / semantic binds."
            )
            if not compact:
                for rule in rules:
                    lines.append(f"- {rule}")
        return "\n".join(lines)


HUB_PRESET_ID = "hub.orchestrator"
PUBLIC_ONTOLOGY_ID = "worktual-ontology"


def public_ontology_id(raw: str | None = None) -> str:
    """Friendly ontology id for API surfaces (no wt: prefix)."""
    oid = str(raw or "").strip()
    if oid.startswith("wt:"):
        return PUBLIC_ONTOLOGY_ID
    return oid or PUBLIC_ONTOLOGY_ID


def _publicize_value(value: Any, gi: Any) -> Any:
    """Replace wt:* references with graph labels in API-facing structures."""
    if isinstance(value, str):
        text = value.strip()
        if text.startswith("wt:"):
            return gi.label_for_class(text) or text.removeprefix("wt:")
        return value
    if isinstance(value, list):
        return [_publicize_value(item, gi) for item in value]
    if isinstance(value, dict):
        return {str(k): _publicize_value(v, gi) for k, v in value.items()}
    return value


def _merge_prompt_lists(base: dict[str, Any], extra: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key in ("classes", "actions", "metrics", "taxonomy", "rules", "route_table"):
        if key not in extra:
            continue
        merged = list(out.get(key) or [])
        for item in extra.get(key) or []:
            if item not in merged:
                merged.append(item)
        out[key] = merged
    for key, val in extra.items():
        if key not in out and key not in ("hub_modules",):
            out[key] = val
    return out


def _product_aliases(catalog: dict[str, Any]) -> dict[str, str]:
    hub_ent = catalog.get("hub_entitlements") or {}
    return dict(hub_ent.get("product_aliases") or {})


def normalize_product_id(raw: str, catalog: dict[str, Any] | None = None) -> str:
    """Single spoke origin SKU → canonical catalog product id."""
    catalog = catalog or get_catalog().catalog
    pid = str(raw).strip()
    if not pid:
        raise ValueError("product must be a non-empty string.")
    return _product_aliases(catalog).get(pid, pid)


def _known_product_ids(catalog: dict[str, Any]) -> set[str]:
    hub_ent = catalog.get("hub_entitlements") or {}
    known = set((hub_ent.get("products") or {}).keys())
    known.update((catalog.get("products") or {}).keys())
    known.update({"cdp", "hub", "webtracking"})
    return known


def normalize_hub_products(
    products: Iterable[str],
    catalog: dict[str, Any] | None = None,
) -> list[str]:
    """Map Hub request product ids to catalog hub_entitlements keys."""
    catalog = catalog or get_catalog().catalog
    hub_ent = catalog.get("hub_entitlements") or {}
    known = set((hub_ent.get("products") or {}).keys())
    skip = {"hub", "cdp"}
    normalized: list[str] = []
    for raw in products:
        pid = normalize_product_id(str(raw), catalog)
        if pid in skip:
            continue
        if pid not in known:
            raise ValueError(
                f"Unknown product '{raw}'. Known: {', '.join(sorted(known))}"
            )
        if pid not in normalized:
            normalized.append(pid)
    if not normalized:
        raise ValueError("products must list at least one entitled product.")
    return normalized


def _is_hub_fetch(preset_id: str | None, agent_id: str | None) -> bool:
    return preset_id == HUB_PRESET_ID or agent_id == HUB_PRESET_ID


def _load_presets(root: Path) -> dict[str, dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    presets_dir = root / "presets"
    if presets_dir.is_dir():
        for path in sorted(presets_dir.glob("*.yml")):
            data = _load_yaml(path)
            block = data.get("presets") or data
            if isinstance(block, dict):
                merged.update(block)
    catalog = _load_yaml(root / "catalog.yml")
    legacy = catalog.get("presets") or {}
    if isinstance(legacy, dict):
        merged.update(legacy)
    return merged


class OntologyCatalog:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or ONTOLOGY_DIR
        self.catalog = _load_yaml(self.root / "catalog.yml")
        self._taxonomy = _load_yaml(self.root / "taxonomy.yml")
        self._module_index: dict[str, dict[str, Any]] = self.catalog.get("modules") or {}
        self._presets: dict[str, dict[str, Any]] = _load_presets(self.root)
        agents_path = self.root / "agents.yml"
        self._agents: dict[str, dict[str, Any]] = (
            _load_yaml(agents_path).get("agents") or {} if agents_path.exists() else {}
        )

    def list_modules(self) -> list[str]:
        return list(self._module_index.keys())

    def list_presets(self) -> list[str]:
        return list(self._presets.keys())

    def list_agents(self) -> list[str]:
        return list(self._agents.keys())

    def product_module_spine(self, product: str) -> list[str]:
        """Canonical module list for a product (from catalog.products)."""
        canonical = normalize_product_id(product, self.catalog)
        spec = (self.catalog.get("products") or {}).get(canonical) or {}
        return [
            m
            for m in (spec.get("modules") or [])
            if not str(m).startswith(METRICS_MODULE_PREFIX)
        ]

    def build_specialist_catalog(
        self, preset_id: str, product: str
    ) -> list[dict[str, Any]]:
        """L2/L3 specialist presets in the same product (for Super routing context)."""
        canonical = normalize_product_id(product, self.catalog)
        entries: list[dict[str, Any]] = []
        for pid, spec in sorted(self._presets.items()):
            if pid == preset_id:
                continue
            if not _preset_belongs_to_product(pid, canonical):
                continue
            if _is_reporting_preset(pid):
                continue
            level = str(spec.get("level") or "")
            if level not in ("L2", "L3"):
                continue
            prompt = spec.get("prompt") or {}
            runtime = sorted(
                aid
                for aid, cfg in self._agents.items()
                if str(cfg.get("preset") or "") == pid
            )
            entries.append(
                {
                    "preset": pid,
                    "agent": spec.get("agent") or pid,
                    "actions": list(prompt.get("actions") or []),
                    "runtime": runtime,
                }
            )
        return entries

    def agent_owned_product(self, agent_id: str | None) -> str | None:
        if not agent_id:
            return None
        cfg = self._agents.get(agent_id) or {}
        return str(cfg["owned_product"]) if cfg.get("owned_product") else None

    def preset_owned_product(self, preset_id: str | None) -> str | None:
        if not preset_id:
            return None
        if preset_id == HUB_PRESET_ID:
            return "hub"
        products = self.catalog.get("products") or {}
        for pid, meta in products.items():
            prefix = meta.get("preset_prefix")
            if prefix and preset_id.startswith(str(prefix)):
                return pid
        return None

    def validate_spoke_product(
        self,
        product: str,
        *,
        agent_id: str | None = None,
        preset_id: str | None = None,
        modules_only: bool = False,
    ) -> str:
        """Return canonical product id; raise if unknown or mismatched with agent."""
        canonical = normalize_product_id(product, self.catalog)
        known = _known_product_ids(self.catalog)
        if canonical not in known or canonical == "hub":
            raise ValueError(
                f"Unknown spoke product '{product}'. "
                f"Use one of: {', '.join(sorted(p for p in known if p != 'hub'))}"
            )
        if modules_only:
            return canonical
        expected = self.agent_owned_product(agent_id)
        if not expected and preset_id:
            expected = self.preset_owned_product(preset_id)
        if expected and expected != "hub" and canonical != expected:
            raise ValueError(
                f"Product '{product}' does not match agent/preset "
                f"(expected '{expected}')."
            )
        return canonical

    def hub_entitlement_plan(
        self, products: Iterable[str]
    ) -> tuple[list[str], dict[str, Any]]:
        """Modules + prompt allowlist for Hub from entitled products only."""
        hub_ent = self.catalog.get("hub_entitlements") or {}
        entitled = normalize_hub_products(products, self.catalog)
        requested: list[str] = list(hub_ent.get("spine_modules") or [])
        prompt_spec = dict(hub_ent.get("base_prompt") or {})
        product_defs = hub_ent.get("products") or {}
        for pid in entitled:
            spec = product_defs.get(pid) or {}
            for mod in spec.get("hub_modules") or []:
                if mod not in requested:
                    requested.append(mod)
            prompt_spec = _merge_prompt_lists(prompt_spec, dict(spec.get("prompt") or {}))
        return requested, prompt_spec

    def _clip_modules_for_entitlements(
        self,
        resolved: list[str],
        *,
        tenant: str,
        product: str,
    ) -> list[str]:
        """Drop add-on modules when org lacks required SKU or feature."""
        org_id = _organization_id_from_tenant(tenant)
        if org_id is None:
            return resolved
        try:
            from semantic.entitlements import load_tenant_entitlements

            ent = load_tenant_entitlements(org_id)
        except Exception:
            return resolved
        product_norm = normalize_product_id(product)
        kept: list[str] = []
        for name in resolved:
            meta = self._module_index.get(name) or {}
            req_sku = meta.get("requires_sku")
            req_feat = meta.get("requires_feature")
            if req_sku and not ent.has_sku(str(req_sku)):
                continue
            if req_feat:
                feats = set(ent.features_for_product(product_norm))
                if str(req_feat) not in feats:
                    continue
            kept.append(name)
        return kept

    def resolve_modules(
        self,
        modules: Iterable[str] | None = None,
        *,
        include_core: bool = True,
    ) -> list[str]:
        selected = [m.strip() for m in (modules or []) if m and str(m).strip()]
        unknown = [m for m in selected if m not in self._module_index]
        if unknown:
            known = ", ".join(self.list_modules())
            raise ValueError(f"Unknown module(s): {unknown}. Known: {known}")

        resolved: list[str] = []

        def add(name: str) -> None:
            if name in resolved:
                return
            meta = self._module_index[name]
            for dep in meta.get("depends_on") or []:
                add(dep)
            resolved.append(name)

        if include_core:
            for name, meta in self._module_index.items():
                if meta.get("always"):
                    add(name)

        for name in selected:
            add(name)

        return resolved

    def _load_module(self, name: str) -> dict[str, Any]:
        meta = self._module_index[name]
        rel = meta.get("file") or f"modules/{name}.yml"
        return _load_yaml(self.root / rel)

    def _industry_pack(self, industry_pack: str | None) -> dict[str, Any]:
        pack = industry_pack or "generic"
        path = self.root / "industry" / f"{pack}.yml"
        if not path.exists():
            return {}
        return _load_yaml(path)

    def _taxonomy_for(
        self,
        classes: list[dict[str, Any]],
        industry_pack: str | None = None,
    ) -> dict[str, Any]:
        axes: set[str] = set()
        for cls in classes:
            for axis in cls.get("classified_by") or []:
                axes.add(axis)
        trees = self._taxonomy.get("taxonomies") or {}
        out: dict[str, Any] = {
            axis: dict(trees[axis]) for axis in sorted(axes) if axis in trees
        }
        adds = self._industry_pack(industry_pack).get("taxonomy_adds") or {}
        for axis, extra in adds.items():
            extra_terms = [str(t) for t in (extra or [])]
            if axis not in trees:
                continue
            base = dict(out.get(axis) or trees[axis])
            terms = [str(t) for t in (base.get("terms") or [])]
            for term in extra_terms:
                if term not in terms:
                    terms.append(term)
            base["terms"] = terms
            if axis in out or axis in axes:
                out[axis] = base
        return out

    def _apply_industry(
        self,
        classes: list[dict[str, Any]],
        relations: list[dict[str, Any]],
        actions: list[dict[str, Any]],
        industry_pack: str | None,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
        data = self._industry_pack(industry_pack)
        classes = list(classes) + list(data.get("adds") or [])
        relations = list(relations) + list(data.get("relations") or [])
        actions = list(actions) + list(data.get("actions") or [])
        extends = data.get("extends") or {}
        applied: list[dict[str, Any]] = []
        for cls in classes:
            cid = cls.get("id")
            extra = extends.get(cid) if cid else None
            if not extra:
                applied.append(cls)
                continue
            merged = dict(cls)
            props = list(merged.get("properties") or [])
            for prop in extra.get("additional_properties") or []:
                if prop not in props:
                    props.append(prop)
            merged["properties"] = props
            applied.append(merged)
        return applied, relations, actions

    def _labels(self, industry_pack: str | None) -> dict[str, str]:
        data = self._industry_pack(industry_pack)
        labels = data.get("labels") or {}
        return {str(k): str(v) for k, v in labels.items()}

    def _load_tenant(self, tenant_id: str | None) -> dict[str, Any]:
        if not tenant_id:
            return {}
        path = TENANTS_DIR / tenant_id / "semantic.yaml"
        if not path.exists():
            return {}
        return _load_yaml(path)

    def fetch(
        self,
        modules: Iterable[str] | None = None,
        *,
        preset: str | None = None,
        agent: str | None = None,
        product: str | None = None,
        products: Iterable[str] | None = None,
        include_core: bool = True,
        industry_pack: str | None = "generic",
        tenant: str | None = None,
    ) -> OntologySlice:
        tenant_cfg = self._load_tenant(tenant)
        if tenant_cfg.get("industryPack"):
            industry_pack = str(tenant_cfg["industryPack"])
        extra = list(tenant_cfg.get("extra_modules") or [])

        agent_id = agent
        agent_cfg: dict[str, Any] = {}
        if agent_id:
            if agent_id not in self._agents:
                known = ", ".join(self.list_agents())
                raise ValueError(f"Unknown agent '{agent_id}'. Known: {known}")
            agent_cfg = self._agents[agent_id]
            if not preset and agent_cfg.get("preset"):
                preset = str(agent_cfg["preset"])
            if not modules and agent_cfg.get("modules"):
                modules = [
                    m
                    for m in agent_cfg["modules"]
                    if not str(m).startswith(METRICS_MODULE_PREFIX)
                ]

        is_hub = _is_hub_fetch(preset, agent_id)
        if is_hub:
            if not products:
                raise ValueError(
                    "Hub requires products: non-empty list of active purchased SKUs."
                )
        elif product:
            modules_only = bool(modules) and not agent_id and not preset
            self.validate_spoke_product(
                product,
                agent_id=agent_id,
                preset_id=preset,
                modules_only=modules_only,
            )

        hub_products_mode = is_hub
        requested = [
            m
            for m in (list(modules or []) + extra)
            if not str(m).startswith(METRICS_MODULE_PREFIX)
        ]
        agent_label = None
        preset_id = None
        prompt_spec: dict[str, Any] = {}
        if preset:
            if preset not in self._presets:
                known = ", ".join(self.list_presets())
                raise ValueError(f"Unknown preset '{preset}'. Known: {known}")
            spec = self._presets[preset]
            agent_label = spec.get("agent")
            preset_id = preset
            if hub_products_mode:
                requested, prompt_spec = self.hub_entitlement_plan(products or [])
            else:
                requested = [
                    m
                    for m in list(spec.get("modules") or []) + requested
                    if not str(m).startswith(METRICS_MODULE_PREFIX)
                ]
                prompt_spec = dict(spec.get("prompt") or {})
        elif hub_products_mode:
            requested, prompt_spec = self.hub_entitlement_plan(products or [])
            preset_id = HUB_PRESET_ID
            agent_label = (self._presets.get(HUB_PRESET_ID) or {}).get("agent")
        if agent_cfg.get("prompt") and not hub_products_mode:
            prompt_spec = {**prompt_spec, **dict(agent_cfg["prompt"])}
        if agent_id and not agent_label:
            agent_label = agent_id

        resolved = self.resolve_modules(requested, include_core=include_core)
        if tenant and product and not is_hub:
            resolved = self._clip_modules_for_entitlements(
                resolved, tenant=tenant, product=product
            )

        classes: list[dict[str, Any]] = []
        relations: list[dict[str, Any]] = []
        actions: list[dict[str, Any]] = []
        metric_ids: list[str] = []
        usecases: dict[str, str] = {}
        labels: dict[str, str] = {}

        for name in resolved:
            data = self._load_module(name)
            meta = self._module_index[name]
            usecase = (data.get("usecase") or meta.get("usecase") or "").strip()
            if usecase:
                usecases[name] = usecase
            classes.extend(data.get("classes") or [])
            relations.extend(data.get("relations") or [])
            actions.extend(data.get("actions") or [])
            if not str(name).startswith(METRICS_MODULE_PREFIX):
                metric_ids.extend(data.get("metric_ids") or [])
            for k, v in (data.get("labels") or {}).items():
                labels[str(k)] = str(v)

        classes, relations, actions = self._apply_industry(
            classes, relations, actions, industry_pack
        )
        labels.update(self._labels(industry_pack))
        for k, v in (tenant_cfg.get("labels") or {}).items():
            labels[str(k)] = str(v)

        industry_data = self._industry_pack(industry_pack)
        for mid in industry_data.get("metric_ids") or []:
            try:
                from semantic.lookup import is_certified

                if is_certified(str(mid)):
                    metric_ids.append(str(mid))
            except ImportError:
                pass

        synonyms: dict[str, str] = {}
        for k, v in (tenant_cfg.get("synonyms") or {}).items():
            synonyms[str(k)] = str(v)

        org_metric_overlays: dict[str, Any] = {}
        if tenant:
            from semantic.tenant_overlay import extra_metric_defs, threshold_overlays

            org_metric_overlays = {
                **threshold_overlays(tenant),
                **extra_metric_defs(tenant),
            }

        specialist_catalog: list[dict[str, Any]] = []
        if prompt_spec.get("include_specialist_catalog") and preset_id and product:
            specialist_catalog = self.build_specialist_catalog(
                preset_id, str(product)
            )

        spoke_product = None
        hub_product_list: list[str] = []
        if is_hub:
            hub_product_list = list(
                normalize_hub_products(list(products or []), self.catalog)
            )
        elif product:
            spoke_product = normalize_product_id(str(product), self.catalog)

        meta = self.catalog.get("ontology") or {}
        classes = _dedupe(classes)
        relations = _dedupe(relations)
        actions = _dedupe(actions)

        taxonomy = self._taxonomy_for(classes, industry_pack)
        trees = self._taxonomy.get("taxonomies") or {}
        for axis in prompt_spec.get("taxonomy") or []:
            axis_s = str(axis)
            if axis_s in trees and axis_s not in taxonomy:
                taxonomy[axis_s] = dict(trees[axis_s])

        return OntologySlice(
            modules=list(requested),
            resolved_modules=resolved,
            preset=preset_id,
            agent=agent_label,
            ontology_id=str(meta.get("id") or "cc"),
            version=str(meta.get("version") or "2026.09.2"),
            classes=classes,
            relations=relations,
            actions=actions,
            metric_ids=_dedupe(metric_ids),
            taxonomy=taxonomy,
            labels=labels,
            synonyms=synonyms,
            industry_pack=industry_pack,
            org_metric_overlays=org_metric_overlays,
            usecases=usecases,
            prompt_spec=prompt_spec,
            specialist_catalog=specialist_catalog,
            product=spoke_product,
            hub_products=hub_product_list,
        )


_CATALOG: OntologyCatalog | None = None


def get_catalog(root: Path | None = None) -> OntologyCatalog:
    global _CATALOG
    if root is not None:
        return OntologyCatalog(root)
    if _CATALOG is None:
        _CATALOG = OntologyCatalog()
    return _CATALOG


def _organization_id_from_tenant(tenant: str | None) -> int | None:
    if not tenant:
        return None
    tid = str(tenant).strip()
    if tid.startswith("org") and tid[3:].isdigit():
        return int(tid[3:])
    return None


def fetch_ontology_slice(
    modules: Iterable[str] | None = None,
    *,
    preset: str | None = None,
    agent: str | None = None,
    product: str | None = None,
    products: Iterable[str] | None = None,
    include_core: bool = True,
    industry_pack: str | None = "generic",
    tenant: str | None = None,
    user_id: int | None = None,
    root: Path | None = None,
) -> OntologySlice:
    """Fetch the ontology slice for an agent and keep pack.as_prompt() in context.

    Parameters
    ----------
    modules:
        Module ids from catalog.yml (e.g. identity, ticket, queue).
        ``core`` is always added unless include_core=False.
        Dependencies are expanded (queue also pulls workforce).
    preset:
        Catalog preset id (e.g. cc.ai_support). Merged with ``modules`` if both set.
    agent:
        Agent id from agents.yml (e.g. crm.deals, camp.reports). Resolves modules
        and optional preset without maintaining one preset per agent.
    industry_pack:
        Label overlay from industry/*.yml (overridden by tenant.industryPack).
    tenant:
        Folder name under tenants/ — ``org`` + ``organization_id`` (e.g. org1000).
        Loads semantic.yaml for industryPack, extra_modules, and label overrides.
    products:
        Hub only (required). Active purchased SKUs — exact list, no auto-expansion.
        CRM does not include campaign.
    product:
        Spokes only (required). Origin SKU string (e.g. ccaas, crm, ticketing).
        Aliases: ccaas → contact_centre.
    """
    if not modules and not preset and not agent:
        raise ValueError("Pass agent=..., modules=[...], and/or preset='cc.ai_support'")
    pack = get_catalog(root).fetch(
        modules,
        preset=preset,
        agent=agent,
        product=product,
        products=products,
        include_core=include_core,
        industry_pack=industry_pack,
        tenant=tenant,
    )
    org_id = _organization_id_from_tenant(tenant)
    if org_id is not None and product and user_id is not None:
        from semantic.agent_grants import grant_candidates
        from semantic.context import resolve_context

        _, _, _, _legacy_candidates, tax, _ = pack._view("compact")
        granted = grant_candidates(agent or preset, product)
        candidates = list(granted) if granted is not None else _legacy_candidates
        pack.context = resolve_context(
            organization_id=org_id,
            user_id=user_id,
            agent=agent or preset,
            product=product,
            candidate_metric_ids=candidates,
            taxonomy=tax,
        )
        spec = dict(pack.prompt_spec or {})
        mode = _metrics_mode(spec, pack.preset)
        if mode == "headlines":
            headlines = list(pack.context.headline_metric_ids or [])
            if headlines:
                spec["metrics"] = headlines
        elif mode == "full":
            spec["metrics"] = list(pack.context.visible_metric_ids or [])
        pack.prompt_spec = spec
    return pack


def list_modules(root: Path | None = None) -> list[str]:
    return get_catalog(root).list_modules()


def list_presets(root: Path | None = None) -> list[str]:
    return get_catalog(root).list_presets()


def list_agents(root: Path | None = None) -> list[str]:
    return get_catalog(root).list_agents()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Compile an ontology slice for an agent")
    parser.add_argument(
        "-m",
        "--module",
        action="append",
        dest="modules",
        default=[],
        help="Module id (repeatable). Example: -m identity -m ticket",
    )
    parser.add_argument("-p", "--preset", help="Catalog preset, e.g. cc.ai_support")
    parser.add_argument("-a", "--agent", help="Agent id from agents.yml, e.g. crm.deals")
    parser.add_argument(
        "--industry",
        default="generic",
        help="Industry label pack (default generic; tenant overrides)",
    )
    parser.add_argument(
        "--tenant",
        help="Tenant id under tenants/, e.g. org1000 (org + organization_id)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print structured JSON instead of prompt text",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print full legal slice (debug). Default is compact prompt.",
    )
    args = parser.parse_args(argv)
    pack = fetch_ontology_slice(
        modules=args.modules or None,
        preset=args.preset,
        agent=args.agent,
        industry_pack=args.industry,
        tenant=args.tenant,
    )
    if args.json:
        import json

        print(json.dumps(pack.to_dict(), indent=2))
    else:
        print(pack.as_prompt(mode="verbose" if args.verbose else "compact"))


if __name__ == "__main__":
    main()
