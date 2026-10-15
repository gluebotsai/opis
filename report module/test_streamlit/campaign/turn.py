"""Pass-through turn for the Campaign V2 pack."""

from __future__ import annotations

import logging
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv

from logs import save_turn_log

ROOT = Path(__file__).resolve().parents[2]
PACK = ROOT / "reports_analytics_agent_campaign_v2"

for env_path in (ROOT / ".env", PACK / ".env"):
    if env_path.exists():
        load_dotenv(env_path)

from reports_analytics_agent_campaign_v2.core.pipeline import run_turn as pack_run_turn

LLM_BASE = os.getenv("SQL_AGENT_LLM_URL", os.getenv("LLM_BASE_URL", "http://127.0.0.1:8011/v1")).rstrip("/")
LLM_MODEL = os.getenv("SQL_AGENT_LLM_MODEL", os.getenv("LLM_MODEL_NAME", "worktual-gemma"))
DSN = os.getenv("DATABASE_URL", os.getenv("CAMPAIGN_DATABASE_URL", os.getenv("PG_DSN")))

log = logging.getLogger("campaign_streamlit")
if not log.handlers:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


def call_llm(messages: list[dict[str, str]], temperature: float = 0.1, max_tokens: int = 1200) -> str:
    log.info("LLM request model=%s temp=%s max_tokens=%s messages=%s", LLM_MODEL, temperature, max_tokens, len(messages))
    with httpx.Client(base_url=LLM_BASE, timeout=90.0) as client:
        resp = client.post(
            "/chat/completions",
            json={
                "model": LLM_MODEL,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            },
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"]
    log.info("LLM response chars=%s", len(content or ""))
    return content


def run_turn(
    *,
    question: str,
    organization_id: int,
    user_id: int,
    branch_id: int,
    role: str,
) -> dict:
    identity = {
        "organization_id": organization_id,
        "user_id": user_id,
        "branch_id": branch_id,
        "role": role,
    }
    llm_meta = {"base": LLM_BASE, "model": LLM_MODEL, "dsn_set": bool(DSN)}
    log.info("turn start %s q=%r", identity, question)
    if not DSN:
        out = {"answer": "DATABASE_URL is not set.", "facts": "", "trace": {"identity": identity}}
        path = save_turn_log(question=question, identity=identity, llm=llm_meta, result=out, error="DATABASE_URL missing")
        out["log_path"] = str(path)
        return out
    try:
        out = pack_run_turn(
            question=question,
            organization_id=organization_id,
            user_id=user_id,
            branch_id=branch_id,
            role=role,
            dsn=DSN,
            call_llm=call_llm,
        )
        path = save_turn_log(question=question, identity=identity, llm=llm_meta, result=out)
        out["log_path"] = str(path)
        log.info("turn ok log=%s answer_chars=%s", path, len(out.get("answer") or ""))
        return out
    except Exception as exc:
        log.exception("turn failed")
        out = {
            "answer": f"Turn failed: {exc}",
            "facts": "",
            "trace": {"identity": identity, "exception": str(exc)},
        }
        path = save_turn_log(
            question=question,
            identity=identity,
            llm=llm_meta,
            result=out,
            error=repr(exc),
        )
        out["log_path"] = str(path)
        return out
