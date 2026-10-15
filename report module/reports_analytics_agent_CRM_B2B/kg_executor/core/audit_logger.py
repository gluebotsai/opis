"""Audit Logger for CRM B2B Knowledge Graph Agent query testing."""

from __future__ import annotations

import datetime
from pathlib import Path
from typing import Any

LOG_FILE_MD = Path(__file__).resolve().parent.parent / "query_audit.md"
LOG_FILE_RAW = Path(__file__).resolve().parent.parent / "query_audit.log"


def get_query_count() -> int:
    """Read the current count of logged queries from the markdown audit log."""
    if not LOG_FILE_MD.exists():
        return 0
    try:
        content = LOG_FILE_MD.read_text(encoding="utf-8")
        count = content.count("## Query #")
        return count
    except Exception:
        return 0


def log_query_interaction(
    user_query: str,
    output: Any,
    role: str = "admin",
    org_id: str | int = 1003,
) -> int:
    """Append a structured, human-readable record of the query execution."""
    current_count = get_query_count() + 1
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Initialize log header if file does not exist or is empty
    if not LOG_FILE_MD.exists() or LOG_FILE_MD.stat().st_size == 0:
        header = (
            "# CRM B2B Knowledge Graph Agent — Query Test Audit Log\n\n"
            f"**Log Initialized**: {now_str}  \n"
            f"**Database Tenant**: `org{org_id}`  \n"
            f"**Scope**: CRM B2B Commercial & Pipeline Knowledge Graph  \n\n"
            "---\n\n"
        )
        LOG_FILE_MD.write_text(header, encoding="utf-8")

    # Format Cypher queries used
    cypher_blocks = "\n\n".join(
        f"```cypher\n{q.strip()}\n```" for q in (output.cypher_used or [])
    )
    if not cypher_blocks:
        cypher_blocks = "_No Cypher query executed (e.g. unsupported, blocked, or validation error)._"

    # Build markdown entry
    entry_md = (
        f"## Query #{current_count} | {now_str}\n\n"
        f"**User Query**: `{user_query}`  \n"
        f"**Role**: `{role}` | **Org**: `{org_id}` | **Status**: `{output.status.upper()}` | **Attempts**: `{output.attempts_made}`\n\n"
        f"### Executed Cypher Query:\n"
        f"{cypher_blocks}\n\n"
        f"### Agent Response:\n"
        f"{output.markdown.strip()}\n\n"
        f"---\n\n"
    )

    with open(LOG_FILE_MD, "a", encoding="utf-8") as f:
        f.write(entry_md)

    # Also append raw log entry
    raw_entry = (
        f"[{now_str}] QUERY_NUM={current_count} STATUS={output.status} "
        f"QUERY={user_query}\n"
        f"CYPHER={output.cypher_used}\n"
        f"RESPONSE={output.markdown}\n"
        f"{'='*70}\n"
    )
    with open(LOG_FILE_RAW, "a", encoding="utf-8") as f:
        f.write(raw_entry)

    return current_count
