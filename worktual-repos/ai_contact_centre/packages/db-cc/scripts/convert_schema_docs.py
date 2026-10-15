#!/usr/bin/env python3
"""Convert existing CCaaS schema markdown into accounts-style documentation."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CCAAS_DOCS = ROOT / "docs" / "ccaas"
OUT = CCAAS_DOCS / "CONTACT_CENTER_SCHEMA.md"

SCHEMA_FILES = [
    ("ccass", CCAAS_DOCS / "ccass-schema.md", "Operational contact-center runtime"),
    ("cdp", CCAAS_DOCS / "cdp-schema.md", "Customer projection and analytics"),
    (
        "accounts",
        CCAAS_DOCS / "accounts-schema.md",
        "Tenant setup published into ccass",
    ),
]

EXPAND_NAMES = {
    "id",
    "status",
    "state",
    "presence_state",
    "lifecycle_state",
    "metadata",
    "config",
    "custom_fields",
    "organization_id",
}


@dataclass
class Column:
    name: str
    data_type: str
    nullable: bool
    default: str
    description: str
    fk: str | None = None


@dataclass
class Table:
    schema: str
    name: str
    description: str
    pk: list[str] = field(default_factory=list)
    uniques: list[str] = field(default_factory=list)
    columns: list[Column] = field(default_factory=list)


def parse_fk(desc: str) -> str | None:
    match = re.search(r"FK → `([^`]+)`", desc)
    return match.group(1) if match else None


def parse_file(schema: str, path: Path) -> list[Table]:
    text = path.read_text(encoding="utf-8")
    chunks = re.split(r"\n## (?!Table Index)", text)
    tables: list[Table] = []
    for chunk in chunks[1:]:
        lines = chunk.strip().splitlines()
        if not lines:
            continue
        name = lines[0].strip()
        if name.lower() in {"table index", "contents"}:
            continue
        desc_match = re.search(r"\*\*Description:\*\*\s*(.+)", chunk)
        description = desc_match.group(1).strip() if desc_match else f"{schema} table used by the contact center."
        pk: list[str] = []
        pk_match = re.search(r"\*\*Primary key:\*\*\s*(.+)", chunk)
        if pk_match:
            pk = re.findall(r"`([^`]+)`", pk_match.group(1))
        uniques: list[str] = []
        unique_block = re.search(
            r"\*\*Unique constraints:\*\*\s*\n\n((?:- .+\n)+)",
            chunk,
        )
        if unique_block:
            uniques = [
                line[2:].strip().strip("`")
                for line in unique_block.group(1).splitlines()
                if line.startswith("- ")
            ]
        columns: list[Column] = []
        in_table = False
        for line in lines:
            if line.startswith("| Column |"):
                in_table = True
                continue
            if in_table and line.startswith("| ---"):
                continue
            if in_table and line.startswith("|"):
                cells = [c.strip() for c in line.strip("|").split("|")]
                if len(cells) < 5:
                    continue
                col_name = cells[0].strip("`")
                desc = cells[4]
                columns.append(
                    Column(
                        name=col_name,
                        data_type=cells[1],
                        nullable=cells[2].lower().startswith("y"),
                        default=cells[3].strip("`"),
                        description=desc,
                        fk=parse_fk(desc),
                    )
                )
            elif in_table and not line.startswith("|"):
                in_table = False
        tables.append(
            Table(
                schema=schema,
                name=name,
                description=description,
                pk=pk,
                uniques=uniques,
                columns=columns,
            )
        )
    return tables


def type_label(col: Column) -> str:
    null = "nullable" if col.nullable else "NOT NULL"
    return f"{col.data_type} {null}"


def constraint_label(table: Table, col: Column) -> str:
    parts: list[str] = []
    if col.name in table.pk:
        parts.append("PRIMARY KEY")
    if col.fk:
        parts.append(f"FOREIGN KEY → `{col.fk}`")
    for unique in table.uniques:
        cols = [c.strip() for c in unique.strip("()").split(",")]
        if col.name in cols:
            if len(cols) == 1:
                parts.append("UNIQUE")
            else:
                parts.append(f"UNIQUE with ({', '.join(f'`{c}`' for c in cols)})")
    parts.append("nullable" if col.nullable else "NOT NULL")
    if col.default:
        parts.append(f"default `{col.default}`")
    return "; ".join(parts)


def should_expand(table: Table, col: Column) -> bool:
    if col.name in table.pk or col.fk or col.name in EXPAND_NAMES:
        return True
    if col.data_type in {"jsonb", "json"}:
        return True
    if "status" in col.name or col.name.endswith("_state"):
        return True
    for unique in table.uniques:
        cols = [c.strip() for c in unique.strip("()").split(",")]
        if col.name in cols:
            return True
    return False


def purpose(table: Table, col: Column) -> str:
    if col.description:
        return col.description
    return f"{col.name.replace('_', ' ').capitalize()} for `{table.schema}.{table.name}`."


def table_description_block(table: Table) -> str:
    desc = table.description.rstrip(".")
    if desc:
        desc = desc[0].lower() + desc[1:]
    extra = (
        f"`{table.schema}.{table.name}` stores {desc}."
        f" The table supports live Contact Center operations in `{table.schema}`"
        f" and is used by cc-core, channel services, NLP, and the agent/admin UI."
        f" Other tables join it through the keys listed under Fields and Relationships."
    )
    return extra


def render_table(table: Table) -> str:
    lines = [
        f'<a id="{table.schema}-{table.name}"></a>',
        "",
        f"# Table: `{table.name}`",
        "",
        f"**Schema:** `{table.schema}`",
        "",
        "## Table Description",
        "",
        table_description_block(table),
        "",
        "## Fields",
        "",
        "| Column Name | Column Purpose | Data Type |",
        "| --- | --- | --- |",
    ]
    for col in table.columns:
        dtype = type_label(col)
        extra = ""
        if col.name in table.pk:
            extra = " PRIMARY KEY"
        elif col.fk:
            extra = f" FOREIGN KEY → `{col.fk}`"
        lines.append(
            f"| `{col.name}` | {purpose(table, col)} | `{dtype}{extra}` |"
        )
    lines.append("")

    for col in table.columns:
        if not should_expand(table, col):
            continue
        lines.extend(
            [
                f"### `{col.name}`",
                "",
                "**Column Purpose:**",
                purpose(table, col),
                "",
                f"**Data Type:** `{col.data_type}`",
                "",
                f"**Key / Constraint:** {constraint_label(table, col)}",
                "",
            ]
        )
    lines.append("---")
    lines.append("")
    return "\n".join(lines)


def collect_relationships(tables: list[Table]) -> list[tuple[Table, Column, str]]:
    rels: list[tuple[Table, Column, str]] = []
    for table in tables:
        for col in table.columns:
            if col.fk:
                rels.append((table, col, col.fk))
                continue
            # Logical references encoded in purpose text
            logical = None
            desc = col.description.lower()
            if col.name == "organization_id":
                logical = "accounts.organizations.id"
            elif col.name == "agent_id" and "ccass.agents" in desc:
                logical = "ccass.agents.id"
            elif col.name == "conversation_id" and "conversation" in desc:
                logical = "ccass.conversations.id"
            elif col.name == "queue_id" and "ccass.queues" in desc:
                logical = "ccass.queues.id"
            elif col.name == "contact_id" and "cdp" in desc:
                logical = "cdp.contacts.id"
            elif col.name == "setup_user_id":
                logical = "accounts.setup_users.id"
            elif col.name == "message_id" and "conversation_messages" in desc:
                logical = "ccass.conversation_messages.id"
            if logical:
                rels.append((table, col, logical))
    return rels


def main() -> None:
    all_tables: list[Table] = []
    by_schema: dict[str, list[Table]] = {}
    for schema, path, _intro in SCHEMA_FILES:
        tables = parse_file(schema, path)
        by_schema[schema] = tables
        all_tables.extend(tables)

    total_cols = sum(len(t.columns) for t in all_tables)
    rels = collect_relationships(all_tables)

    lines: list[str] = [
        "# Contact Center Schema Documentation",
        "",
        "## Overview",
        "",
        "This document provides detailed technical documentation for the PostgreSQL schemas used by **Worktual Contact Center (CCaaS)**.",
        "",
        "Contact Center data is split across three schemas in one database:",
        "",
        "| Schema | Responsibility | Typical writers | Typical readers |",
        "| --- | --- | --- | --- |",
        "| `accounts` (setup subset) | Slow-changing tenant configuration: orgs, users, channels, queues, business hours, knowledge | Admin / My Accounts setup | cc-core publish jobs, channel services |",
        "| `ccass` | Fast-changing operational runtime: conversations, routing, presence, NLP, workspace, delivery | cc-core, chat-service, social-service, NLP | Agent workspace, supervisor, routing, reports |",
        "| `cdp` | Customer projection for contacts UI, CRM, analytics, and co-worker | cc-core projection jobs | Contacts UI, reporting, NLP tools |",
        "",
        "`accounts` is the source of truth for **configuration**. `ccass` is the source of truth for **live operations**. `cdp` is a **derived customer view** — do not drive routing from CDP.",
        "",
        "```mermaid",
        "flowchart TB",
        '  subgraph accounts["accounts — configuration"]',
        "    ORG[organizations]",
        "    USERS[setup_users]",
        "    CH[setup_channel_configs]",
        "    SQ[setup_ccaas_queues]",
        "  end",
        '  subgraph ccass["ccass — operational runtime"]',
        "    AG[agents]",
        "    Q[queues]",
        "    CONV[conversations]",
        "    MSG[conversation_messages]",
        "    ROUTE[routing + presence]",
        "  end",
        '  subgraph cdp["cdp — customer projection"]',
        "    CONTACT[contacts]",
        "    CID[contact_identities]",
        "    INT[interactions]",
        "  end",
        "  SQ -.publish.-> Q",
        "  USERS -.setup_user_id.-> AG",
        "  CONV --> MSG",
        "  CONV -.contact_id.-> CONTACT",
        "  CONV -.project.-> INT",
        "```",
        "",
        "For each table, this file includes:",
        "",
        "- A detailed description of the table and its purpose",
        "- The business or application use case",
        "- Every column defined in the table",
        "- The purpose and usage of each column",
        "- The data type of each column",
        "- Primary key and foreign key information where applicable",
        "- Relationships between tables",
        "",
        f"**{len(all_tables)} tables**, **{total_cols} columns**, **{sum(1 for t in all_tables for c in t.columns if c.fk)} declared foreign keys** (plus logical UUID/bigint references enforced in application code).",
        "",
        "Regenerate from live PostgreSQL:",
        "",
        "```bash",
        "npx tsx packages/db-cc/scripts/generate-schema-docs.ts",
        "```",
        "",
        "## Contents",
        "",
    ]

    for schema, _path, intro in SCHEMA_FILES:
        tables = by_schema[schema]
        lines.append(f"### `{schema}` — {intro}")
        lines.append("")
        for table in tables:
            lines.append(f"- [`{table.schema}.{table.name}`](#{table.schema}-{table.name})")
        lines.append("")

    lines.append("---")
    lines.append("")

    for table in all_tables:
        lines.append(render_table(table))

    lines.extend(
        [
            "# Relationships",
            "",
            "The following section documents relationships used by Contact Center. Each row identifies the source table and field, the referenced table and field, and the purpose of the relationship. Some links are PostgreSQL foreign keys; others are logical application references (no cross-schema FK constraint).",
            "",
            "| Source Table | Source Field | Relationship | Referenced Table | Referenced Field | Relationship Purpose |",
            "| --- | --- | --- | --- | --- | --- |",
        ]
    )

    seen: set[tuple[str, str, str]] = set()
    for table, col, target in rels:
        schema_table, field = target.rsplit(".", 1) if target.count(".") >= 2 else (target, "id")
        if "." in schema_table:
            ref_schema, ref_table = schema_table.split(".", 1)
        else:
            ref_schema, ref_table = table.schema, schema_table
        key = (f"{table.schema}.{table.name}", col.name, target)
        if key in seen:
            continue
        seen.add(key)
        purpose_text = (
            col.description
            or f"Links `{table.schema}.{table.name}` to `{ref_schema}.{ref_table}`."
        )
        lines.append(
            f"| `{table.schema}.{table.name}` | `{col.name}` | Many-to-One | `{ref_schema}.{ref_table}` | `{field}` | {purpose_text} |"
        )

    lines.extend(
        [
            "",
            "## Relationship Details",
            "",
        ]
    )

    detail_count = 0
    for table, col, target in rels:
        if col.name not in table.pk and not col.fk and col.name not in {
            "organization_id",
            "conversation_id",
            "agent_id",
            "queue_id",
            "contact_id",
        }:
            continue
        schema_table, field = target.rsplit(".", 1) if target.count(".") >= 2 else (target, "id")
        lines.extend(
            [
                f"### `{table.schema}.{table.name}.{col.name}` → `{target}`",
                "",
                "**Relationship Type:** Many-to-One",
                "",
                "**Description:**",
                purpose(table, col),
                "",
                "**Source Field Purpose:**",
                f"`{col.name}` stores the identifier of the related record so Contact Center can join, filter, and authorize this row in tenant scope.",
                "",
                "**Referenced Field Purpose:**",
                f"`{target}` is the stable identifier of the related entity.",
                "",
            ]
        )
        detail_count += 1
        if detail_count >= 80:
            break

    lines.extend(
        [
            "# Contact Center Schema Relationship Summary",
            "",
            "These schemas keep configuration (`accounts`), live operations (`ccass`), and customer analytics (`cdp`) consistent. Primary and foreign key relationships (and the logical equivalents) must be considered when inserting, updating, or deleting records.",
            "",
            "| Table | Primary Key | Related Tables | Relationship |",
            "| --- | --- | --- | --- |",
        ]
    )

    related_map: dict[str, list[str]] = {}
    for table, col, target in rels:
        src = f"{table.schema}.{table.name}"
        related_map.setdefault(src, [])
        related_map[src].append(target.rsplit(".", 1)[0] if "." in target else target)

    for table in all_tables:
        src = f"{table.schema}.{table.name}"
        pk = ", ".join(f"`{c}`" for c in table.pk) or "—"
        related = sorted(set(related_map.get(src, [])))
        related_txt = ", ".join(f"`{r}`" for r in related[:8]) or "—"
        if len(related) > 8:
            related_txt += f", +{len(related) - 8} more"
        rel_kind = "Many-to-One" if related else "—"
        lines.append(f"| `{src}` | {pk} | {related_txt} | {rel_kind} |")

    lines.extend(
        [
            "",
            "# Notes",
            "",
            "- Tables in this file belong to `ccass`, `cdp`, or the Contact Center subset of `accounts`.",
            "- Fields use actual PostgreSQL data types from live introspection (or the last generated snapshot).",
            "- Primary keys, unique constraints, foreign keys, and nullable fields are identified where defined.",
            "- Cross-schema links are often logical (application-enforced) rather than PostgreSQL FK constraints.",
            "- Keep this documentation synchronized when tables, columns, constraints, or relationships change.",
            "",
        ]
    )

    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT} ({len(all_tables)} tables, {total_cols} columns)")


if __name__ == "__main__":
    main()
