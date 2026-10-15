"""HTTP front door for Contact Center Domain. Calls run_turn only.

Identity and short-term memory live here. Domain is not changed.

Body: organization_id, user_id, query, session_id. Role is looked up from Postgres.

Run from the workspace root:

    uvicorn test_fastapi.contact_center_v2.main:app --host 0.0.0.0 --port 8502
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from loguru import logger
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from reports_analytics_agent_contact_center_v2 import run_turn
from reports_analytics_agent_contact_center_v2.core.access import AccessDenied
from reports_analytics_agent_contact_center_v2.core.kg.role import lookup_cc_role

app = FastAPI(title="Contact Center Domain API")

_SESSIONS: dict[str, dict[str, Any]] = {}
_LOG_DIR = Path(__file__).resolve().parent / "logs"
_LOG_FILE = _LOG_DIR / "domain_api.log"


def _setup_file_logger() -> None:
    _LOG_DIR.mkdir(parents=True, exist_ok=True)
    logger.remove()
    logger.add(
        _LOG_FILE,
        rotation="20 MB",
        retention="30 days",
        encoding="utf-8",
        enqueue=True,
        backtrace=True,
        diagnose=False,
        format="{time:YYYY-MM-DD HH:mm:ss} | {level:<7} | {message}",
    )


_setup_file_logger()


def _pretty(value: Any) -> str:
    if value is None:
        return "(none)"
    if isinstance(value, str):
        return value if value.strip() else "(empty)"
    return json.dumps(value, default=str, ensure_ascii=False, indent=2)


def _block(kind: str, lines: list[str]) -> str:
    bar = "=" * 72
    return "\n".join([bar, f"{kind}", bar, *lines, bar])


class TurnRequest(BaseModel):
    organization_id: int
    user_id: int
    query: str
    session_id: str


class TurnResponse(BaseModel):
    session_id: str
    answer: str
    card: str = "card: none"
    facts: str = ""
    trace: dict[str, Any] = Field(default_factory=dict)
    grounded: bool = False


def _dsn() -> str:
    return (os.environ.get("DATABASE_URL") or os.environ.get("PG_DSN") or "").strip()


def _session(session_id: str, organization_id: int, user_id: int) -> dict[str, Any]:
    key = session_id.strip()
    if not key:
        raise HTTPException(status_code=400, detail="session_id is required")
    state = _SESSIONS.get(key)
    if state:
        if state.get("organization_id") != organization_id or state.get("user_id") != user_id:
            raise HTTPException(
                status_code=400,
                detail="session_id is already bound to another organization or user",
            )
        return state

    dsn = _dsn()
    if not dsn:
        raise HTTPException(status_code=500, detail="DATABASE_URL is not set")
    try:
        role = lookup_cc_role(dsn, organization_id, user_id)
    except AccessDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    state = {
        "organization_id": organization_id,
        "user_id": user_id,
        "role": role,
        "recent": [],
    }
    _SESSIONS[key] = state
    return state


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/turn", response_model=TurnResponse)
async def turn(req: TurnRequest) -> TurnResponse:
    started = time.time()
    session_id = (req.session_id or "").strip()
    question = (req.query or "").strip()
    identity = (
        f"session_id: {session_id or '(missing)'}\n"
        f"organization_id: {req.organization_id}\n"
        f"user_id: {req.user_id}"
    )

    if req.organization_id <= 0 or req.user_id <= 0:
        logger.error(
            _block(
                "REJECT",
                [identity, "", "QUESTION", question or "(empty)", "", "ERROR", "organization_id and user_id must be positive"],
            )
        )
        raise HTTPException(status_code=400, detail="organization_id and user_id must be positive")
    if not question:
        logger.error(_block("REJECT", [identity, "", "QUESTION", "(empty)", "", "ERROR", "query is required"]))
        raise HTTPException(status_code=400, detail="query is required")

    try:
        state = _session(session_id, req.organization_id, req.user_id)
    except HTTPException as exc:
        logger.error(
            _block(
                "REJECT",
                [
                    identity,
                    f"http_status: {exc.status_code}",
                    "",
                    "QUESTION",
                    question,
                    "",
                    "ERROR",
                    str(exc.detail),
                ],
            )
        )
        raise

    recent = list(state["recent"][-4:])
    try:
        out = await asyncio.to_thread(
            run_turn,
            question=question,
            organization_id=state["organization_id"],
            user_id=state["user_id"],
            role=state["role"],
            dsn=_dsn(),
            recent_turns=recent or None,
        )
    except Exception:
        logger.exception(
            _block(
                "ERROR",
                [
                    identity,
                    f"role: {state['role']}",
                    f"elapsed_seconds: {round(time.time() - started, 3)}",
                    "",
                    "QUESTION",
                    question,
                    "",
                    "ERROR",
                    "run_turn raised; traceback follows this block",
                ],
            )
        )
        raise HTTPException(status_code=500, detail="Domain turn failed. See domain_api.log.") from None

    answer = str(out.get("answer") or "")
    state["recent"].append({"role": "user", "content": question[:400]})
    state["recent"].append({"role": "assistant", "content": answer[:400]})
    state["recent"] = state["recent"][-8:]
    trace = dict(out.get("trace") or {})
    elapsed = round(time.time() - started, 3)
    logger.info(
        _block(
            "TURN",
            [
                identity,
                f"role: {state['role']}",
                f"elapsed_seconds: {elapsed}",
                f"card: {out.get('card') or 'card: none'}",
                f"grounded: {bool(out.get('grounded'))}",
                "",
                "QUESTION",
                question,
                "",
                "ANSWER",
                answer or "(empty)",
                "",
                "FACTS",
                _pretty(out.get("facts") or ""),
                "",
                "PLAN",
                _pretty(trace.get("plan") or {}),
                "",
                "SQL",
                _pretty(trace.get("sql")),
                "",
                "KG",
                _pretty(trace.get("kg")),
            ],
        )
    )

    return TurnResponse(
        session_id=session_id,
        answer=answer,
        card=str(out.get("card") or "card: none"),
        facts=str(out.get("facts") or ""),
        trace=trace,
        grounded=bool(out.get("grounded")),
    )
