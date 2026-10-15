"""Load the YAML semantic catalog from disk."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

EXPERIMENT_ROOT = Path(__file__).resolve().parents[2]
CATALOG_ROOT = EXPERIMENT_ROOT / "catalog"


def _load_yaml(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        payload = yaml.safe_load(handle) or {}
    if not isinstance(payload, dict):
        raise ValueError(f"Expected mapping in {path}")
    return payload


@dataclass
class Column:
    name: str
    type: str
    description: str = ""
    values: list[str] = field(default_factory=list)
    aliases: list[str] = field(default_factory=list)
    fk: str | None = None
    pk: bool = False


@dataclass
class TableCard:
    name: str
    alias: str
    schema: str
    grain: str
    purpose: str
    aliases: list[str]
    time_columns: list[str]
    dashboard_time_expr: str | None
    pii: list[str]
    blocked_select: list[str]
    indexes: list[list[str]]
    columns: list[Column]
    sample_rows: list[dict[str, Any]]
    path: Path

    def column_names(self) -> list[str]:
        return [column.name for column in self.columns]

    def column_map(self) -> dict[str, Column]:
        return {column.name: column for column in self.columns}

    def search_text(self) -> str:
        parts = [
            self.name,
            self.purpose,
            self.grain,
            " ".join(self.aliases),
            " ".join(self.column_names()),
        ]
        for column in self.columns:
            parts.append(column.description)
            parts.extend(column.aliases)
            parts.extend(column.values)
        return " ".join(parts)


@dataclass
class Metric:
    id: str
    label: str
    description: str
    aliases: list[str]
    tables: list[str]
    join_path: list[str]
    sql: str
    time_column: str | None
    dashboard_time_expr: str | None
    dimensions: list[str]
    chart_hints: list[str]
    example_questions: list[str]
    caveats: list[str]
    formula: str | None = None
    unit: str | None = None
    grain: str | None = None

    def search_text(self) -> str:
        return " ".join(
            [
                self.id,
                self.label,
                self.description,
                " ".join(self.aliases),
                " ".join(self.example_questions),
                " ".join(self.tables),
            ]
        )


@dataclass
class GoldExample:
    id: str
    question: str
    aliases: list[str]
    tables: list[str]
    join_path: list[str]
    sql: str

    def search_text(self) -> str:
        return " ".join([self.id, self.question, " ".join(self.aliases), " ".join(self.tables)])


@dataclass
class JoinEdge:
    left: str
    right: str
    from_column: str
    to_column: str
    cardinality: str
    purpose: str


@dataclass
class Catalog:
    metrics: list[Metric]
    tables: dict[str, TableCard]
    table_index: list[dict[str, Any]]
    examples: list[GoldExample]
    edges: list[JoinEdge]
    glossary: dict[str, Any]
    dql_craft: dict[str, Any]
    short_names: dict[str, str]

    def table(self, name: str) -> TableCard:
        resolved = self.resolve_table(name)
        if resolved is None:
            raise KeyError(name)
        return self.tables[resolved]

    def resolve_table(self, name: str) -> str | None:
        folded = name.casefold().strip()
        if folded in {item.casefold() for item in self.tables}:
            for qualified in self.tables:
                if qualified.casefold() == folded:
                    return qualified
        return self.short_names.get(folded)

    def allowlisted_tables(self) -> set[str]:
        return set(self.tables)

    def all_column_names(self) -> list[str]:
        names: list[str] = []
        for table in self.tables.values():
            names.extend(table.column_names())
        return names


def load_catalog(root: Path | None = None) -> Catalog:
    catalog_root = root or CATALOG_ROOT
    metrics_payload = _load_yaml(catalog_root / "metrics.yaml")
    examples_payload = _load_yaml(catalog_root / "examples.yaml")
    joins_payload = _load_yaml(catalog_root / "joins.yaml")
    glossary = _load_yaml(catalog_root / "glossary.yaml")
    dql_craft = _load_yaml(catalog_root / "dql-craft.yaml")
    index_payload = _load_yaml(catalog_root / "tables" / "index.yaml")

    tables: dict[str, TableCard] = {}
    short_names: dict[str, str] = {}
    for path in sorted((catalog_root / "tables").glob("*.yaml")):
        if path.name == "index.yaml":
            continue
        payload = _load_yaml(path)
        columns = [
            Column(
                name=str(item["name"]),
                type=str(item.get("type") or "text"),
                description=str(item.get("description") or ""),
                values=[str(value) for value in item.get("values") or []],
                aliases=[str(alias) for alias in item.get("aliases") or []],
                fk=str(item["fk"]) if item.get("fk") else None,
                pk=bool(item.get("pk")),
            )
            for item in payload.get("columns") or []
            if isinstance(item, dict) and item.get("name")
        ]
        name = str(payload["name"])
        card = TableCard(
            name=name,
            alias=str(payload.get("alias") or name.split(".")[-1][:3]),
            schema=str(payload.get("schema") or name.split(".")[0]),
            grain=str(payload.get("grain") or ""),
            purpose=str(payload.get("purpose") or ""),
            aliases=[str(item) for item in payload.get("aliases") or []],
            time_columns=[str(item) for item in payload.get("time_columns") or []],
            dashboard_time_expr=payload.get("dashboard_time_expr"),
            pii=[str(item) for item in payload.get("pii") or []],
            blocked_select=[str(item) for item in payload.get("blocked_select") or []],
            indexes=[list(item) for item in payload.get("indexes") or []],
            columns=columns,
            sample_rows=[dict(row) for row in payload.get("sample_rows") or [] if isinstance(row, dict)],
            path=path,
        )
        tables[name] = card
        short_names[name.split(".")[-1].casefold()] = name
        short_names[name.casefold()] = name
        for alias in card.aliases:
            short_names.setdefault(alias.casefold(), name)

    metrics = [
        Metric(
            id=str(item["id"]),
            label=str(item.get("label") or item["id"]),
            description=str(item.get("description") or "").strip(),
            aliases=[str(alias) for alias in item.get("aliases") or []],
            tables=[str(table) for table in item.get("tables") or []],
            join_path=[str(table) for table in item.get("join_path") or []],
            sql=str(item.get("sql") or "").strip(),
            time_column=item.get("time_column"),
            dashboard_time_expr=item.get("dashboard_time_expr"),
            dimensions=[str(dim) for dim in item.get("dimensions") or []],
            chart_hints=[str(hint) for hint in item.get("chart_hints") or []],
            example_questions=[str(question) for question in item.get("example_questions") or []],
            caveats=[str(caveat) for caveat in item.get("caveats") or []],
            formula=item.get("formula"),
            unit=item.get("unit"),
            grain=item.get("grain"),
        )
        for item in metrics_payload.get("metrics") or []
        if isinstance(item, dict) and item.get("id")
    ]

    examples = [
        GoldExample(
            id=str(item["id"]),
            question=str(item.get("question") or ""),
            aliases=[str(alias) for alias in item.get("aliases") or []],
            tables=[str(table) for table in item.get("tables") or []],
            join_path=[str(table) for table in item.get("join_path") or []],
            sql=str(item.get("sql") or "").strip(),
        )
        for item in examples_payload.get("examples") or []
        if isinstance(item, dict) and item.get("id")
    ]

    edges = [
        JoinEdge(
            left=str(item["from"]),
            right=str(item["to"]),
            from_column=str(item["from_column"]),
            to_column=str(item["to_column"]),
            cardinality=str(item.get("cardinality") or ""),
            purpose=str(item.get("purpose") or ""),
        )
        for item in joins_payload.get("edges") or []
        if isinstance(item, dict)
    ]

    return Catalog(
        metrics=metrics,
        tables=tables,
        table_index=list(index_payload.get("tables") or []),
        examples=examples,
        edges=edges,
        glossary=glossary,
        dql_craft=dql_craft,
        short_names=short_names,
    )
