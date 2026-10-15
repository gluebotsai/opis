"""Dedicated InsightsAgent — narrates compact aggregated snapshots only."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from app.insights.schemas import InsightsNarrativeResponse
from app.services.context_layer import AGENT_INSIGHTS, ContextLayerError, context_layer
from app.services.llm_service import LLMServiceError, llm_service

logger = logging.getLogger(__name__)

PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "insights_synthesis.txt"


class InsightsAgent:
    async def generate(
        self,
        snapshot: dict,
        website_id: int,
        period: str,
        *,
        organization_id: int | None = None,
        user_id: int | None = None,
    ) -> dict:
        system_prompt = PROMPT_PATH.read_text(encoding="utf-8")
        if organization_id is not None and user_id is not None:
            try:
                slice_data = context_layer.fetch_ontology_slice(
                    organization_id=organization_id,
                    user_id=user_id,
                    agent=AGENT_INSIGHTS,
                )
                if slice_data.prompt:
                    system_prompt = f"{system_prompt}\n\n{slice_data.prompt}"
            except ContextLayerError:
                logger.exception("Insights ontology slice failed — narrating with local prompt only")

        compact = {
            "website_id": website_id,
            "period": period,
            "comparison": snapshot.get("comparison", []),
            "primary_anomaly": snapshot.get("primary_anomaly"),
            "top_movers": snapshot.get("top_movers", [])[:5],
            "daily_rollups": snapshot.get("daily_rollups", [])[-14:],
            "weekly_rollups": snapshot.get("weekly_rollups", [])[-8:],
            "monthly_rollups": snapshot.get("monthly_rollups", [])[-6:],
            "forecasts": snapshot.get("forecasts", {}),
        }

        messages = [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": (
                    "Analyze this aggregated web tracking snapshot and return insights JSON only:\n"
                    f"{json.dumps(compact, default=str)}"
                ),
            },
        ]

        try:
            raw = await llm_service.complete_json(messages)
            validated = InsightsNarrativeResponse.model_validate(raw)
            return validated.model_dump()
        except (LLMServiceError, Exception) as exc:
            logger.exception("InsightsAgent LLM failed: %s", exc)
            raise


insights_agent = InsightsAgent()
