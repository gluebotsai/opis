"""Route hub intent → sequential skill pipeline (no parallel)."""

from __future__ import annotations

from typing import Any

from app.hub_super.skill_catalog import get_skill, pipeline_for_intent, skill_ids


def route_pipeline(request: dict[str, Any]) -> dict[str, Any]:
    """
    Resolve ordered skills for a hub task.

    Prefer explicit pipeline from hub; else map intent → catalog pipeline.
    Never asks for clarification — unknown intent returns failed plan.
    """
    explicit = request.get("pipeline")
    if isinstance(explicit, list) and explicit:
        unknown = [s for s in explicit if not get_skill(s)]
        if unknown:
            return {
                "ok": False,
                "pipeline": [],
                "errors": [
                    {
                        "code": "UNKNOWN_SKILL",
                        "message": f"Unknown skills: {', '.join(unknown)}",
                        "known": skill_ids(),
                    }
                ],
            }
        return {"ok": True, "pipeline": list(explicit), "source": "explicit"}

    intent = str(request.get("intent") or "").strip()
    mapped = pipeline_for_intent(intent)
    if mapped:
        return {"ok": True, "pipeline": mapped, "source": "intent", "intent": intent}

    return {
        "ok": False,
        "pipeline": [],
        "errors": [
            {
                "code": "UNKNOWN_INTENT",
                "message": (
                    f"No pipeline for intent={intent!r}. "
                    "Use a known intent or pass pipeline explicitly."
                ),
                "known_intents_sample": [
                    "on_demand_send",
                    "create_contact",
                    "campaign_report",
                    "stop_channel",
                    "create_contact_and_send",
                ],
            }
        ],
    }
