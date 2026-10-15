"""Write each Contact Center Streamlit turn to test_streamlit/contact_center_v2/logs/."""

from __future__ import annotations

import datetime as dt
import json
import uuid
from pathlib import Path
from typing import Any

LOGS_DIR = Path(__file__).resolve().parent / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)


def save_turn_log(
    *,
    question: str,
    identity: dict[str, Any],
    llm: dict[str, Any],
    result: dict[str, Any],
    error: str | None = None,
) -> Path:
    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    turn_id = uuid.uuid4().hex[:8]
    trace = result.get("trace") or {}
    payload = {
        "turn_id": turn_id,
        "timestamp": dt.datetime.now(dt.timezone.utc).isoformat(),
        "question": question,
        "identity": identity,
        "llm": llm,
        "answer": result.get("answer"),
        "card": result.get("card"),
        "facts": result.get("facts"),
        "trace": trace,
        "error": error,
    }
    path = LOGS_DIR / f"turn_{stamp}_{turn_id}.json"
    path.write_text(json.dumps(payload, indent=2, default=str))
    md_path = LOGS_DIR / f"turn_{stamp}_{turn_id}.md"
    plan = trace.get("plan") or {}
    md = [
        f"# Contact Center turn `{turn_id}`",
        f"- question: {question}",
        f"- identity: {identity}",
        f"- llm: {llm.get('base')} / {llm.get('model')}",
        "",
        "## Answer",
        str(payload.get("answer") or ""),
        "",
        f"card: {payload.get('card') or 'card: none'}",
        "",
        "## Understanding and tasks",
        str(plan.get("understanding") or ""),
        "",
        "```json",
        json.dumps(plan.get("tasks"), indent=2, default=str),
        "```",
        "",
        "## SQL",
        "```json",
        json.dumps(trace.get("sql"), indent=2, default=str),
        "```",
        "",
        "## Facts",
        "```",
        str(payload.get("facts") or ""),
        "```",
        "",
        "## Error",
        str(error or ""),
        "",
    ]
    md_path.write_text("\n".join(md))
    return md_path
