"""Structured logger for Multi-Agent conversational turns, tool calls, and guards.

Saves each turn to:
  1. JSON Lines (.jsonl) for machine-readable parsing and analytics
  2. Markdown (.md) for instant human-readable inspection
"""

from __future__ import annotations

import datetime
import json
import uuid
from pathlib import Path
from typing import Any

LOGS_DIR = Path(__file__).resolve().parent / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)


class TurnLogger:
    def __init__(self, question: str, context: dict[str, Any]) -> None:
        self.turn_id = str(uuid.uuid4())[:8]
        self.timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
        self.question = question
        self.context = context
        self.events: list[dict[str, Any]] = []

    def log_message(
        self,
        *,
        role: str,
        agent: str,
        content: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Log a conversational role message (system, user, assistant)."""
        self.events.append({
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "type": "message",
            "role": role,
            "agent": agent,
            "content": content,
            "metadata": metadata or {},
        })

    def log_tool_call(
        self,
        *,
        agent: str,
        tool_name: str,
        arguments: dict[str, Any] | str,
        result: dict[str, Any] | None = None,
    ) -> None:
        """Log a structured tool call and optional output."""
        self.events.append({
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "type": "tool_call",
            "agent": agent,
            "tool_name": tool_name,
            "arguments": arguments,
            "result": result,
        })

    def log_guard(
        self,
        *,
        guard_type: str,
        input_query: str,
        output_query: str,
        params: dict[str, Any],
        notes: list[str] | None = None,
        error: str | None = None,
    ) -> None:
        """Log a SQL / Cypher Guard transformation or validation check."""
        self.events.append({
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "type": "guard",
            "guard_type": guard_type,
            "input_query": input_query,
            "output_query": output_query,
            "params": params,
            "notes": notes or [],
            "error": error,
        })

    def log_grounding(
        self,
        *,
        grounded: bool,
        ungrounded: list[str],
        answer_numbers: list[str],
        was_regenerated: bool = False,
    ) -> None:
        """Log the numerical grounding verification result."""
        self.events.append({
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "type": "grounding",
            "grounded": grounded,
            "ungrounded": ungrounded,
            "answer_numbers": answer_numbers,
            "was_regenerated": was_regenerated,
        })

    def save(self) -> Path:
        """Persist turn logs to JSONL and Markdown formats."""
        date_str = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        filename_base = f"turn_{date_str}_{self.turn_id}"

        # 1. JSON Lines
        json_path = LOGS_DIR / f"{filename_base}.json"
        data = {
            "turn_id": self.turn_id,
            "timestamp": self.timestamp,
            "question": self.question,
            "context": self.context,
            "events": self.events,
        }
        json_path.write_text(json.dumps(data, indent=2, default=str))

        # 2. Markdown report
        md_path = LOGS_DIR / f"{filename_base}.md"
        md_lines = [
            f"# Execution Trace: Turn `{self.turn_id}`",
            f"- **Timestamp**: {self.timestamp}",
            f"- **Question**: {self.question}",
            f"- **Context**: Role `{self.context.get('role')}`, Org `{self.context.get('org_id')}`, User `{self.context.get('user_id')}`",
            "",
            "---",
            "## Timeline of Events",
            "",
        ]

        for i, ev in enumerate(self.events, 1):
            etype = ev.get("type")
            agent = ev.get("agent", "unknown")
            ts = ev.get("timestamp", "").split("T")[-1][:8]

            if etype == "message":
                role = ev.get("role", "info").upper()
                md_lines.extend([
                    f"### {i}. [{ts}] `{agent}` - Role: **{role}**",
                    "```text",
                    ev.get("content", "").strip(),
                    "```",
                    "",
                ])
            elif etype == "tool_call":
                tool = ev.get("tool_name")
                md_lines.extend([
                    f"### {i}. [{ts}] `{agent}` -> Tool Call: `{tool}`",
                    "**Arguments:**",
                    "```json",
                    json.dumps(ev.get("arguments", {}), indent=2, default=str),
                    "```",
                    "",
                ])
                if ev.get("result"):
                    md_lines.extend([
                        "**Result Summary:**",
                        f"- Status: `{ev['result'].get('status')}`",
                        f"- Rows: `{len(ev['result'].get('rows') or [])}`",
                        "",
                    ])
            elif etype == "guard":
                gtype = ev.get("guard_type", "Guard")
                md_lines.extend([
                    f"### {i}. [{ts}] 🛡️ Guard: `{gtype}`",
                    "**Guarded Output:**",
                    f"```{gtype.lower()}",
                    ev.get("output_query", "").strip(),
                    "```",
                    f"- Bound Params: `{ev.get('params')}`",
                    f"- Notes: `{ev.get('notes')}`",
                    "",
                ])
            elif etype == "grounding":
                status = "✅ Grounded" if ev.get("grounded") else "⚠️ Hallucination Detected"
                md_lines.extend([
                    f"### {i}. [{ts}] 🔍 Grounding Check: {status}",
                    f"- Numbers in Answer: `{ev.get('answer_numbers')}`",
                    f"- Ungrounded: `{ev.get('ungrounded')}`",
                    f"- Regenerated: `{ev.get('was_regenerated')}`",
                    "",
                ])

        md_path.write_text("\n".join(md_lines))
        return json_path


def list_recent_logs(limit: int = 30) -> list[dict[str, Any]]:
    """List recent saved turn logs for inspection."""
    if not LOGS_DIR.exists():
        return []
    logs = []
    for p in sorted(LOGS_DIR.glob("turn_*.json"), key=lambda x: x.stat().st_mtime, reverse=True)[:limit]:
        try:
            doc = json.loads(p.read_text())
            logs.append({
                "path": str(p),
                "filename": p.name,
                "turn_id": doc.get("turn_id"),
                "timestamp": doc.get("timestamp"),
                "question": doc.get("question"),
                "role": doc.get("context", {}).get("role"),
                "events_count": len(doc.get("events", [])),
            })
        except Exception:
            continue
    return logs
