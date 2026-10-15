"""Write each Campaign Streamlit turn to test_streamlit/campaign/logs/."""

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
    payload = {
        "turn_id": turn_id,
        "timestamp": dt.datetime.now(dt.timezone.utc).isoformat(),
        "question": question,
        "identity": identity,
        "llm": llm,
        "answer": result.get("answer"),
        "facts": result.get("facts"),
        "trace": result.get("trace") or {},
        "error": error,
    }
    path = LOGS_DIR / f"turn_{stamp}_{turn_id}.json"
    path.write_text(json.dumps(payload, indent=2, default=str))
    md_path = LOGS_DIR / f"turn_{stamp}_{turn_id}.md"
    trace = payload["trace"]
    md = [
        f"# Campaign turn `{turn_id}`",
        f"- question: {question}",
        f"- identity: {identity}",
        f"- llm: {llm.get('base')} / {llm.get('model')}",
        "",
        "## Answer",
        str(payload.get("answer") or ""),
        "",
        "## Facts",
        "```",
        str(payload.get("facts") or ""),
        "```",
        "",
        "## Supervisor",
        "```json",
        json.dumps(trace.get("supervisor"), indent=2, default=str),
        "```",
        "",
        "## Interpret",
        "```json",
        json.dumps(trace.get("interpret"), indent=2, default=str),
        "```",
        "",
        "## Retrieved KPIs",
        str(trace.get("retrieved_kpis")),
        "",
        "## Plan",
        "```json",
        json.dumps(trace.get("plan"), indent=2, default=str),
        "```",
        "",
        "## Tasks",
        "```json",
        json.dumps(trace.get("task_results"), indent=2, default=str),
        "```",
        "",
        "## Loop errors",
        "```json",
        json.dumps(trace.get("loop_errors"), indent=2, default=str),
        "```",
    ]
    if error:
        md.extend(["", "## Exception", error])
    md_path.write_text("\n".join(md))
    return path
