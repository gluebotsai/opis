"""Owner Change Notify Agent — compose a POC handoff email from the new sales owner."""

from __future__ import annotations

import logging
from typing import Any, TypedDict, Optional
from uuid import uuid4

from app.agents.native_pipeline import run_steps
from app.agents.llm_result import generate_json_with_retries, sectioned_system_prompt
from app.agents.step_trace import traced_step

logger = logging.getLogger(__name__)

MODULE_PATH = "assignment"
AGENT_NAME = "owner_change_notify"

COMPOSE_SYSTEM = sectioned_system_prompt(
    role="You write a brief, professional email when a customer's sales point of contact changes.",
    goal=(
        "Notify the customer that their point of contact at the vendor has changed "
        "and introduce the new owner as their go-forward contact."
    ),
    instructions=(
        "- Write TO the customer (external audience), FROM the new owner named in context.\n"
        "- Plain text body, 2–3 short paragraphs, no markdown or HTML.\n"
        "- Clearly state their point of contact has changed and name the new rep.\n"
        "- If a previous owner name is provided, acknowledge the handoff professionally "
        "(do not criticize the previous rep).\n"
        "- Offer a brief next step (reply or schedule a call).\n"
        "- Sign off with the new owner's name."
    ),
    context="Customer and owner facts are in the user message.",
    output='Return ONLY JSON: {"subject":"...","body":"..."}',
    guardrails=(
        "Never invent facts. Keep warm and professional. "
        "Do not mention internal CRM or admin reassignment."
    ),
)


class OwnerChangeState(TypedDict, total=False):
    contact_id: str
    organization_id: Optional[str]
    owner_user_id: Optional[str]
    job_id: str
    packed_context: Optional[dict[str, Any]]
    context: dict[str, Any]
    subject: Optional[str]
    body: Optional[str]
    status: str
    source: str
    reason: Optional[str]


def _heuristic_notify(ctx: dict[str, Any]) -> dict[str, str]:
    first = (ctx.get("contactFirstName") or ctx.get("contactName") or "there").strip()
    owner = (ctx.get("ownerName") or "your Worktual contact").strip()
    previous = (ctx.get("previousOwnerName") or "").strip()
    company = (ctx.get("companyName") or "").strip()
    company_line = f" at {company}" if company else ""
    subject = f"Your Worktual point of contact — {owner}"
    handoff = (
        f"Your point of contact{company_line} at Worktual has changed."
        if not previous
        else (
            f"I'm reaching out because your point of contact{company_line} at Worktual "
            f"has changed — I'll be taking over from {previous}."
        )
    )
    body = "\n".join(
        [
            f"Hi {first},",
            "",
            handoff,
            f"I'm {owner}, and I'll be your main contact going forward.",
            "Please feel free to reply to this email or share a good time for a quick call.",
            "",
            "Best regards,",
            owner,
            "",
            "(Composed with offline fallback — LLM unavailable.)",
        ]
    )
    return {"subject": subject[:180], "body": body}


async def normalize(state: OwnerChangeState) -> OwnerChangeState:
    packed = state.get("packed_context")
    if isinstance(packed, dict) and packed:
        return {**state, "context": packed, "status": "loaded"}
    return {
        **state,
        "status": "failed",
        "reason": "missing_context",
        "context": {},
    }


async def compose_via_llm(ctx: dict[str, Any]) -> tuple[dict[str, str] | None, str | None]:
    def _validate(parsed: dict[str, Any]) -> dict[str, str] | None:
        if not parsed.get("subject") or not parsed.get("body"):
            return None
        return {
            "subject": str(parsed["subject"])[:180],
            "body": str(parsed["body"]),
        }

    return await generate_json_with_retries(
        system=COMPOSE_SYSTEM,
        user="\n".join(
            [
                f"New owner name: {ctx.get('ownerName') or '—'}",
                f"New owner email: {ctx.get('ownerEmail') or '—'}",
                f"Previous owner name: {ctx.get('previousOwnerName') or '—'}",
                f"Customer name: {ctx.get('contactName') or '—'}",
                f"Customer first name: {ctx.get('contactFirstName') or '—'}",
                f"Customer email: {ctx.get('contactEmail') or '—'}",
                f"Company: {ctx.get('companyName') or '—'}",
            ]
        ),
        max_tokens=1000,
        repair_hint="Convert into ONLY JSON with subject and body strings.",
        validate=_validate,
    )


async def compose(state: OwnerChangeState) -> OwnerChangeState:
    ctx = state.get("context") or {}
    email, llm_reason = await compose_via_llm(ctx)
    if email:
        return {
            **state,
            "subject": email["subject"],
            "body": email["body"],
            "status": "ok",
            "source": "ai",
            "reason": None,
        }
    logger.warning(
        "owner-change-notify LLM compose failed contact=%s reason=%s",
        state.get("contact_id"),
        llm_reason,
    )
    fallback = _heuristic_notify(ctx)
    return {
        **state,
        "subject": fallback["subject"],
        "body": fallback["body"],
        "status": "ok",
        "source": "heuristic",
        "reason": llm_reason or "llm_compose_failed",
    }


_PIPELINE_STEPS = (
    traced_step(
        MODULE_PATH,
        AGENT_NAME,
        "load_context",
        "Loading owner change notify context",
        None,
        id_field="contact_id",
        job_id_field="job_id",
    )(normalize),
    traced_step(
        MODULE_PATH,
        AGENT_NAME,
        "compose_notify",
        "Composing point-of-contact change email",
        None,
        id_field="contact_id",
        job_id_field="job_id",
    )(compose),
)


async def run(
    contact_id: str,
    organization_id: str | None = None,
    owner_user_id: str | None = None,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    result = await run_steps(
        {
            "contact_id": contact_id,
            "organization_id": organization_id,
            "owner_user_id": owner_user_id,
            "job_id": str(uuid4()),
            "packed_context": context,
            "status": "running",
        },
        _PIPELINE_STEPS,
    )
    return {
        "ok": result.get("status") == "ok" and bool(result.get("subject")),
        "subject": result.get("subject"),
        "body": result.get("body"),
        "source": result.get("source"),
        "reason": result.get("reason"),
    }
