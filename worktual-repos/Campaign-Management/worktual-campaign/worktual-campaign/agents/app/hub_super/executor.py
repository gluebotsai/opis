"""Sequential DAG executor — one skill at a time, shared context."""

from __future__ import annotations

import time
from typing import Any

from app.hub_super.registry import get_runner
from app.hub_super.schemas import step_result


async def run_sequential(
    *,
    pipeline: list[str],
    token: str,
    organization_id: str,
    intent: str,
    payload: dict[str, Any],
    allow_partial: bool = False,
) -> dict[str, Any]:
    """
    Run skills in order. Prior outputs land in prior[skill_id] for later steps.
    No parallel execution.
    """
    prior: dict[str, Any] = {}
    steps: list[dict[str, Any]] = []
    warnings: list[str] = []

    for skill_id in pipeline:
        runner = get_runner(skill_id)
        if runner is None:
            steps.append(
                step_result(
                    skill_id,
                    status="failed",
                    error=f"No runner registered for skill {skill_id}",
                )
            )
            return {
                "ok": False,
                "status": "failed",
                "step_results": steps,
                "prior": prior,
                "warnings": warnings,
                "errors": [
                    {"code": "MISSING_RUNNER", "skill": skill_id},
                ],
            }

        ctx = {
            "token": token,
            "organization_id": organization_id,
            "intent": intent,
            "payload": payload,
            "prior": prior,
        }
        started = time.perf_counter()
        try:
            out = await runner(ctx)
        except Exception as exc:  # noqa: BLE001
            latency = int((time.perf_counter() - started) * 1000)
            steps.append(
                step_result(
                    skill_id,
                    status="failed",
                    error=str(exc),
                    latency_ms=latency,
                )
            )
            return {
                "ok": False,
                "status": "failed",
                "step_results": steps,
                "prior": prior,
                "warnings": warnings,
                "errors": [{"code": "SKILL_EXCEPTION", "skill": skill_id, "message": str(exc)}],
            }

        latency = int((time.perf_counter() - started) * 1000)
        ok = bool(out.get("ok"))
        status = str(out.get("status") or ("ok" if ok else "failed"))
        warn = out.get("warnings") if isinstance(out.get("warnings"), list) else []
        warnings.extend(str(w) for w in warn if str(w).strip())

        steps.append(
            step_result(
                skill_id,
                status=status if ok else "failed",
                data={k: v for k, v in out.items() if k not in {"raw"}},
                error=None if ok else str(out.get("error") or "step failed"),
                warnings=[str(w) for w in warn if str(w).strip()],
                latency_ms=latency,
            )
        )
        prior[skill_id] = out

        if not ok:
            if allow_partial:
                warnings.append(f"{skill_id} failed; continuing (allow_partial)")
                continue
            return {
                "ok": False,
                "status": "failed",
                "step_results": steps,
                "prior": prior,
                "warnings": warnings,
                "errors": [
                    {
                        "code": "STEP_FAILED",
                        "skill": skill_id,
                        "message": str(out.get("error") or "step failed"),
                    }
                ],
            }

    return {
        "ok": True,
        "status": "completed",
        "step_results": steps,
        "prior": prior,
        "warnings": warnings,
        "errors": [],
    }
