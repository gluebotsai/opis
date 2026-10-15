"""Welcome Lead Agent — compose a first-touch email from the assigned sales owner."""

from __future__ import annotations

import logging
from typing import Any, TypedDict, Optional
from uuid import uuid4

from app.agents.native_pipeline import run_steps
from app.agents.llm_result import generate_json_with_retries, sectioned_system_prompt
from app.agents.step_trace import traced_step

logger = logging.getLogger(__name__)

WELCOME_MODULE_PATH = "assignment"
WELCOME_AGENT = "sales_assignment"

COMPOSE_SYSTEM = sectioned_system_prompt(
    role="You write a warm first-touch welcome email from a sales rep to a new lead.",
    goal="Introduce the assigned owner as the lead's point of contact after CRM assignment.",
    instructions=(
        "- Write TO the lead (external audience), FROM the owner named in context.\n"
        "- Plain text body, 2–4 short paragraphs, no markdown or HTML.\n"
        "- Mention you are their point of contact and offer a brief next step (reply or short call).\n"
        "- Reference company or role only when provided — never invent facts.\n"
        "- Sign off with the owner's name."
    ),
    context="Lead and owner facts are in the user message.",
    output='Return ONLY JSON: {"subject":"...","body":"..."}',
    guardrails=(
        "Never promise pricing, discounts, or meetings not in context. "
        "Keep professional and concise."
    ),
)


class WelcomeState(TypedDict, total=False):
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


def _heuristic_welcome(ctx: dict[str, Any]) -> dict[str, str]:
    first = (ctx.get("contactFirstName") or ctx.get("contactName") or "there").strip()
    owner = (ctx.get("ownerName") or "your Worktual contact").strip()
    company = (ctx.get("companyName") or "").strip()
    company_line = f" at {company}" if company else ""
    subject = f"Great to connect — {owner} from Worktual"
    body = "\n".join(
        [
            f"Hi {first},",
            "",
            f"I'm {owner}, and I'll be your point of contact{company_line} at Worktual.",
            "Thanks for your interest — I'd love to learn more about what you're looking for "
            "and how we can help.",
            "",
            "Feel free to reply to this email or let me know a good time for a quick call.",
            "",
            "Best regards,",
            owner,
            "",
            "(Composed with offline fallback — LLM unavailable.)",
        ]
    )
    return {"subject": subject[:180], "body": body}


async def normalize(state: WelcomeState) -> WelcomeState:
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
                f"Owner name: {ctx.get('ownerName') or '—'}",
                f"Owner email: {ctx.get('ownerEmail') or '—'}",
                f"Lead name: {ctx.get('contactName') or '—'}",
                f"Lead first name: {ctx.get('contactFirstName') or '—'}",
                f"Lead email: {ctx.get('contactEmail') or '—'}",
                f"Title: {ctx.get('contactTitle') or '—'}",
                f"Company: {ctx.get('companyName') or '—'}",
                f"Industry: {ctx.get('industry') or '—'}",
                f"Lead source: {ctx.get('leadSource') or '—'}",
                f"Score: {ctx.get('leadScore') or '—'} ({ctx.get('leadBand') or '—'})",
                f"Next best action hint: {ctx.get('nextBestAction') or '—'}",
            ]
        ),
        max_tokens=1200,
        repair_hint="Convert into ONLY JSON with subject and body strings.",
        validate=_validate,
    )


async def compose(state: WelcomeState) -> WelcomeState:
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
        "welcome-lead LLM compose failed contact=%s reason=%s",
        state.get("contact_id"),
        llm_reason,
    )
    fallback = _heuristic_welcome(ctx)
    return {
        **state,
        "subject": fallback["subject"],
        "body": fallback["body"],
        "status": "ok",
        "source": "heuristic",
        "reason": llm_reason or "llm_compose_failed",
    }


def _detail_normalize(_before: WelcomeState, after: WelcomeState) -> dict[str, Any] | None:
    ctx = after.get("context") or {}
    return {
        "ownerUserId": ctx.get("ownerUserId"),
        "leadScore": ctx.get("leadScore"),
    }


def _detail_compose(_before: WelcomeState, after: WelcomeState) -> dict[str, Any] | None:
    return {
        "emailComposed": bool(after.get("subject") and after.get("body")),
        "source": after.get("source"),
    }


_PIPELINE_STEPS = (
    traced_step(
        WELCOME_MODULE_PATH,
        WELCOME_AGENT,
        "load_context",
        "Loading assignment welcome context",
        _detail_normalize,
        id_field="contact_id",
        job_id_field="job_id",
    )(normalize),
    traced_step(
        WELCOME_MODULE_PATH,
        WELCOME_AGENT,
        "compose_welcome",
        "Composing welcome email from assigned owner",
        _detail_compose,
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
