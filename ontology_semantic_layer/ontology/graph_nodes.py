"""Graph node index derived from KG pipeline table catalog (core.yaml tables:)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise ImportError("PyYAML is required: pip install pyyaml") from exc

ONTOLOGY_DIR = Path(__file__).resolve().parent
GRAPH_NODES_PATH = ONTOLOGY_DIR / "graph_nodes.yml"


def _load_yaml(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a YAML mapping")
    return data


@lru_cache(maxsize=1)
def load_graph_index() -> dict[str, Any]:
    if not GRAPH_NODES_PATH.exists():
        raise FileNotFoundError(f"Missing graph node map: {GRAPH_NODES_PATH}")
    return _load_yaml(GRAPH_NODES_PATH)


def clear_graph_nodes_cache() -> None:
    load_graph_index.cache_clear()


class GraphIndex:
    """Lookup graph labels, identifiers, and edges for compact ontology prompts."""

    def __init__(self, data: dict[str, Any] | None = None) -> None:
        raw = data if data is not None else load_graph_index()
        self._nodes: dict[str, dict[str, Any]] = dict(raw.get("nodes") or {})
        self._edges: list[dict[str, str]] = list(raw.get("edges") or [])
        self._class_aliases: dict[str, str] = dict(raw.get("class_aliases") or {})
        self._definitions: dict[str, str] = {
            str(k): str(v) for k, v in (raw.get("definitions") or {}).items()
        }
        self._label_to_node: dict[str, dict[str, Any]] = {}
        self._class_to_label: dict[str, str] = {}
        for key, node in self._nodes.items():
            label = str(node.get("label") or key)
            self._label_to_node[label] = node
            if key.startswith("wt:"):
                self._class_to_label[key] = label
            agent_id = node.get("agent_id")
            if agent_id:
                self._class_to_label[str(agent_id)] = label
        for class_id, label in self._class_aliases.items():
            self._class_to_label.setdefault(class_id, label)

    @classmethod
    def get(cls) -> GraphIndex:
        return cls()

    def label_for_class(self, class_id: str) -> str | None:
        if not class_id:
            return None
        if class_id in self._class_to_label:
            return self._class_to_label[class_id]
        if class_id.startswith("wt:"):
            short = class_id[3:]
            for cid, label in self._class_to_label.items():
                if cid.startswith("wt:") and cid[3:] == short:
                    return label
        return None

    def node_for_label(self, label: str) -> dict[str, Any] | None:
        return self._label_to_node.get(label)

    def definition_for_label(self, label: str) -> str:
        return (self._definitions.get(label) or "").strip()

    def resolve_synonym_target(self, target: str) -> str | None:
        """Map spoken synonym target (graph label or legacy wt: id) to graph label."""
        raw = str(target or "").strip()
        if not raw:
            return None
        if raw in self._label_to_node:
            return raw
        mapped = self.label_for_class(raw)
        if mapped and mapped in self._label_to_node:
            return mapped
        return None

    def labels_for_product(self, product: str) -> set[str]:
        labels: set[str] = set()
        for node in self._nodes.values():
            node_product = str(node.get("product") or "")
            readable = list(node.get("readable_by") or [])
            if node_product == product or product in readable:
                labels.add(str(node.get("label")))
        return labels

    def labels_for_products(self, products: Iterable[str]) -> set[str]:
        labels: set[str] = set()
        for product in products:
            labels.update(self.labels_for_product(str(product)))
        return labels

    def labels_for_classes(self, class_ids: set[str]) -> set[str]:
        labels: set[str] = set()
        for class_id in class_ids:
            label = self.label_for_class(class_id)
            if label:
                labels.add(label)
        return labels

    def edges_for_labels(self, labels: set[str]) -> list[dict[str, str]]:
        out: list[dict[str, str]] = []
        for edge in self._edges:
            fr = str(edge.get("from") or "")
            to = str(edge.get("to") or "")
            if fr in labels and to in labels:
                out.append(
                    {
                        "from": fr,
                        "type": str(edge.get("type") or ""),
                        "to": to,
                    }
                )
        return out

    def format_relation(self, edge: dict[str, str]) -> str:
        return f"{edge['from']} - {edge['type']} -> {edge['to']}"
