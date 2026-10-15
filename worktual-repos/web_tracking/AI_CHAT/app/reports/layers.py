"""LLM calls: Domain plan, semantic executor, Domain synthesis."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from app.mas.prompts import metrics_catalog_json
from app.reports.catalog import kpi_index_lines
from app.reports.models import DomainPlan, SemanticToolCall
from app.services.context_layer import OntologySlice
from app.services.llm_service import LLMServiceError, llm_service

logger = logging.getLogger(__name__)

_REPORTS = Path(__file__).resolve().parents[2] / "reports"


def _read_agent(rel: str) -> str:
    return (_REPORTS / rel).read_text(encoding="utf-8").strip()


async def run_domain_plan(
    *,
    standalone: str,
    objective: str,
    domain: str,
    dashboard_period: str | None,
    slice_data: OntologySlice,
    replan_message: str | None = None,
) -> DomainPlan:
    system = (
        f"{_read_agent('domain/agent.md')}\n\n"
        f"Super domain hint: {domain}\n"
        f"Super objective: {objective}\n"
        f"Dashboard period pill: {dashboard_period or 'none'}\n\n"
        f"Certified KPI index:\n{kpi_index_lines()}\n\n"
        f"Ontology slice metrics:\n{metrics_catalog_json(slice_data)}"
    )
    user_parts = [{"standalone_question": standalone, "objective": objective}]
    if replan_message:
        user_parts.append({"REPLAN_REQUEST": replan_message})
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(user_parts, ensure_ascii=False)},
    ]
    try:
        raw = await llm_service.complete_json(messages, max_tokens=1400, temperature=0.2)
        return DomainPlan.model_validate(raw)
    except LLMServiceError:
        raise
    except Exception as exc:
        logger.warning("Domain plan parse failed: %s", exc)
        return DomainPlan(
            tasks=[],
            clarify_question="Could you rephrase your analytics question?",
        )


async def run_semantic_executor_tool(
    *,
    task_goal: str,
    task: dict,
    slice_data: OntologySlice,
) -> SemanticToolCall:
    system = (
        f"{_read_agent('semantic_executor/agent.md')}\n\n"
        f"Certified KPI index:\n{kpi_index_lines()}\n\n"
        f"Metric catalog:\n{metrics_catalog_json(slice_data)}"
    )
    messages = [
        {"role": "system", "content": system},
        {
            "role": "user",
            "content": json.dumps({"task": task, "goal": task_goal}, ensure_ascii=False),
        },
    ]
    try:
        raw = await llm_service.complete_json(messages, max_tokens=900, temperature=0.1)
        return SemanticToolCall.model_validate(raw)
    except Exception as exc:
        logger.warning("Semantic executor parse failed: %s", exc)
        return SemanticToolCall(
            tool="run_semantic",
            error_type="REPLAN",
            error=f"executor_json_failed: {exc}",
        )


async def run_domain_synthesis(
    *,
    standalone: str,
    depth: str,
    combined_facts: str,
    draft_answer: str,
) -> str:
    system = _read_agent("domain/agent.md")
    messages = [
        {"role": "system", "content": system + "\n\nSynthesize the final user answer from facts only."},
        {
            "role": "user",
            "content": json.dumps(
                {
                    "question": standalone,
                    "depth": depth,
                    "facts": combined_facts,
                    "draft_answer": draft_answer,
                },
                ensure_ascii=False,
            ),
        },
    ]
    try:
        raw = await llm_service.complete_json(messages, max_tokens=700, temperature=0.25)
        text = raw.get("answer") or raw.get("synthesis") or raw.get("reply")
        if text:
            return str(text).strip()
    except Exception:
        logger.exception("Domain synthesis failed")
    return draft_answer
