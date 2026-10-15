"""Two LLM calls: Super+Domain, then Executor."""

from __future__ import annotations

import json
import logging

from app.mas.models import RouteDecision, SemanticPlan
from app.mas.prompts import executor_system, super_domain_system
from app.services.context_layer import OntologySlice
from app.services.llm_service import LLMServiceError, llm_service

logger = logging.getLogger(__name__)


async def run_super_domain(
    *,
    message: str,
    history: list[dict[str, str]],
    dashboard_period: str | None,
    ontology_prompt: str,
) -> RouteDecision:
    system = super_domain_system(
        dashboard_period=dashboard_period,
        ontology_prompt=ontology_prompt or "(no ontology slice text)",
    )
    user_blob = _user_blob(message, history)
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_blob},
    ]
    try:
        raw = await llm_service.complete_json(messages, max_tokens=800, temperature=0.2)
        return RouteDecision.model_validate(raw)
    except LLMServiceError:
        raise
    except Exception as exc:
        logger.warning("Route JSON parse failed: %s", exc)
        return RouteDecision(
            action="clarify",
            clarify_question="Could you rephrase your analytics question?",
        )


async def run_executor(
    *,
    message: str,
    objective: str,
    domain: str,
    slice_data: OntologySlice,
) -> SemanticPlan:
    system = executor_system(slice_data=slice_data, domain=domain, objective=objective)
    messages = [
        {"role": "system", "content": system},
        {
            "role": "user",
            "content": json.dumps(
                {"user_message": message, "domain_objective": objective},
                ensure_ascii=False,
            ),
        },
    ]
    try:
        raw = await llm_service.complete_json(messages, max_tokens=1200, temperature=0.1)
        return SemanticPlan.model_validate(raw)
    except LLMServiceError:
        raise
    except Exception as exc:
        logger.warning("Executor JSON parse failed: %s", exc)
        return SemanticPlan(
            error="clarify",
            clarify_question="Which metric should I use — visitors, sessions, page views, or bounce rate?",
        )


def _user_blob(message: str, history: list[dict[str, str]]) -> str:
    recent = history[-8:]
    return json.dumps({"history": recent, "user_message": message}, ensure_ascii=False)
