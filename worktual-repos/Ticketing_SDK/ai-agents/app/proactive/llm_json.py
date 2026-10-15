"""Shared LLM JSON helper for proactive agents (Gemma via existing client)."""

from __future__ import annotations

from typing import Any

from app.tasks.triage import extract_json_object, parse_confidence


def run_agent_llm(
    agent_id: str,
    system: str,
    user: str,
    *,
    organization_id: str | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Return a JSON object from the LLM, or {} on failure."""
    try:
        from app.llm import get_llm
        from app.prompts.builder import context_layer_call_prompt_block
        from app.tools.catalog_tools import ontology_slice_prompt_block
        from app.tools.express_client import get_tool_actor

        actor = get_tool_actor()
        org = str(
            organization_id or (actor.organization_id if actor else "") or ""
        ).strip()
        uid = str(user_id or (actor.user_id if actor else "") or "").strip()
        from app.tools.registry import context_layer_runtime_id

        runtime_id = context_layer_runtime_id(str(agent_id or "").strip())
        if runtime_id:
            block = ontology_slice_prompt_block(
                organization_id=org,
                user_id=uid,
                agent=runtime_id,
            )
            if block:
                system = system + block
            system = system + context_layer_call_prompt_block(runtime_id)

        llm = get_llm()
        msg = llm.invoke(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ]
        )
        text = getattr(msg, "content", None) or str(msg)
        obj = extract_json_object(str(text) if text is not None else "")
        return obj or {}
    except Exception:
        return {}


def confidence_of(obj: dict[str, Any], default: float = 0.4) -> float:
    parsed = parse_confidence(obj.get("confidence"))
    return default if parsed is None else parsed


_GENERIC_SUMMARIES = frozenset(
    {
        "",
        "ok",
        "none",
        "n/a",
        "no action",
        "checked",
        "workload recommendation",
        "analytics summary",
        "updated routing heuristic config",
        "knowledge suggestions",
        "possible similar tickets",
        "possible self-service match",
        "no analytics yet — the database has no kpi rows for this range.",
    }
)


def is_needful_summary(text: str) -> bool:
    s = " ".join((text or "").strip().lower().split())
    if not s or s in _GENERIC_SUMMARIES:
        return False
    return len(s) >= 12


def flag_true(obj: dict[str, Any], *keys: str) -> bool:
    for key in keys:
        val = obj.get(key)
        if val is True or str(val).strip().lower() in {"1", "true", "yes"}:
            return True
    return False
