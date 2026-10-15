"""Domain runner registry."""

from __future__ import annotations

from typing import Any, Awaitable, Callable

Runner = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]

_RUNNERS: dict[str, Runner] = {}


def _ensure_wired() -> None:
    if "audience" not in _RUNNERS:
        from app.mas.domains.audience.runner import run_audience_domain

        _RUNNERS["audience"] = run_audience_domain
    if "optimization" not in _RUNNERS:
        from app.mas.domains.optimization.runner import run_optimization_domain

        _RUNNERS["optimization"] = run_optimization_domain
    if "creation" not in _RUNNERS:
        from app.mas.domains.creation.runner import run_creation_domain

        _RUNNERS["creation"] = run_creation_domain
    if "recommendation_run" not in _RUNNERS:
        from app.mas.domains.recommendation_run.runner import run_recommendation_run_domain

        _RUNNERS["recommendation_run"] = run_recommendation_run_domain
    if "library_run" not in _RUNNERS:
        from app.mas.domains.library_run.runner import run_library_run_domain

        _RUNNERS["library_run"] = run_library_run_domain
    if "whatsapp_approved_run" not in _RUNNERS:
        from app.mas.domains.whatsapp_approved_run.runner import (
            run_whatsapp_approved_run_domain,
        )

        _RUNNERS["whatsapp_approved_run"] = run_whatsapp_approved_run_domain
    if "content" not in _RUNNERS:
        from app.mas.domains.content.runner import run_content_domain

        _RUNNERS["content"] = run_content_domain
    if "forms" not in _RUNNERS:
        from app.mas.domains.forms.runner import run_forms_domain

        _RUNNERS["forms"] = run_forms_domain
    if "image" not in _RUNNERS:
        from app.mas.domains.image.runner import run_image_domain

        _RUNNERS["image"] = run_image_domain


def get_domain_runner(domain_id: str) -> Runner:
    _ensure_wired()
    did = str(domain_id or "").strip().lower()
    if did not in _RUNNERS:

        async def missing(ctx: dict[str, Any]) -> dict[str, Any]:
            return {
                "ok": False,
                "error": f"Unknown or unwired domain {did}",
                "action_status": "failed",
            }

        return missing
    return _RUNNERS[did]
