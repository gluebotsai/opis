"""
Sales Assignment Agent.

Prompt source of truth: agents/sales-assignment/agent.md.
The model chooses the owner. Code only checks that the id is one of the
sales-rep candidates and stores the reason. If the model is down or returns
nothing usable, this run fails so the caller can retry. It does not pick
an owner with local rules.
"""

from __future__ import annotations

import json
import logging
from typing import Any, TypedDict, Optional
from uuid import uuid4

from app.agents.agent_md import agent_md_path, load_agent_md
from app.agents.native_pipeline import run_steps
from app.agents.llm_result import (
    generate_json_with_retries,
    sectioned_system_prompt,
)
from app.agents.step_trace import traced_step
from app.crm_client import CrmClient

logger = logging.getLogger(__name__)

ASSIGNMENT_MODULE_PATH = "assignment"
ASSIGNMENT_AGENT = "sales_assignment"
SALES_READY_SCORE = 40

_SECTIONS = load_agent_md(agent_md_path(__file__, "sales-assignment"))

ASSIGN_SYSTEM = sectioned_system_prompt(
    role=_SECTIONS["role"],
    goal=_SECTIONS["goal"],
    instructions=_SECTIONS["instructions"],
    context=_SECTIONS.get("context", ""),
    output=_SECTIONS["output"],
    guardrails=_SECTIONS["guardrails"],
)


class AssignState(TypedDict, total=False):
    organization_id: Optional[str]
    job_id: str
    business_type: Optional[str]
    country: Optional[str]
    city: Optional[str]
    contact_id: Optional[str]
    company_id: Optional[str]
    location_id: Optional[str]
    estimated_amount: Optional[float]
    candidates: list[dict[str, Any]]
    relationship: dict[str, Any]
    lead: dict[str, Any]
    owner: Optional[dict[str, Any]]
    status: str
    source: str
    reason: Optional[str]


def _display_name(row: dict[str, Any]) -> str:
    name = (row.get("displayName") or row.get("display_name") or "").strip()
    if name:
        return name
    email = row.get("email") or ""
    local = email.split("@")[0].replace(".", " ").replace("_", " ").replace("-", " ")
    return local or email


def _sales_rep(row: dict[str, Any]) -> bool:
    role = str(row.get("role") or "").strip().lower().replace(" ", "_")
    return role in {"sales_rep", "sales", "rep"}


async def load_candidates(state: AssignState) -> AssignState:
    client = CrmClient(state.get("organization_id"))
    data = await client.get_assignment_candidates(
        business_type=state.get("business_type"),
        country=state.get("country"),
        city=state.get("city"),
        contact_id=state.get("contact_id"),
        company_id=state.get("company_id"),
        location_id=state.get("location_id"),
        estimated_amount=state.get("estimated_amount"),
    )
    return {
        **state,
        "candidates": data.get("candidates") or [],
        "relationship": data.get("relationship") or {},
        "lead": data.get("lead") or {},
    }


def _lead_score(lead: dict[str, Any] | None) -> float | None:
    raw = (lead or {}).get("score")
    if raw is None or raw == "":
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _must_assign(lead: dict[str, Any] | None) -> bool:
    score = _lead_score(lead)
    return score is not None and score >= SALES_READY_SCORE


def _is_model_failure(reason: str | None) -> bool:
    if not reason:
        return True
    if reason in {"llm_no_owner", "llm_no_candidates"}:
        return False
    return reason.startswith("llm_")


async def resolve(state: AssignState) -> AssignState:
    owner, llm_reason = await assign_via_llm(state)
    if owner:
        return {
            **state,
            "owner": owner,
            "status": "assigned",
            "source": "ai",
            "reason": owner.get("reason"),
        }
    if _is_model_failure(llm_reason):
        logger.warning("assign-sales LLM failed reason=%s", llm_reason)
        return {
            **state,
            "owner": None,
            "status": "failed",
            "source": "ai",
            "reason": llm_reason or "llm_failed",
        }
    return {
        **state,
        "owner": None,
        "status": "unassigned",
        "source": "ai",
        "reason": llm_reason or "llm_no_owner",
    }


async def assign_via_llm(
    state: AssignState,
) -> tuple[dict[str, Any] | None, str | None]:
    candidates = state.get("candidates") or []
    sales_reps = [row for row in candidates if _sales_rep(row)]
    if not sales_reps:
        return None, "llm_no_candidates"

    id_set: set[str] = set()
    slim = []
    for row in sales_reps[:40]:
        uid = str(row.get("id") or row.get("userId") or "").strip()
        if not uid:
            continue
        id_set.add(uid)
        slim.append(
            {
                "userId": uid,
                "name": _display_name(row),
                "skills": row.get("skills") or [],
                "primaryLanguage": row.get("primaryLanguage"),
                "secondaryLanguage": row.get("secondaryLanguage"),
                "city": row.get("city"),
                "state": row.get("state"),
                "country": row.get("country"),
                "businessHours": row.get("businessHours"),
                "acceptingLeads": row.get("acceptingLeads"),
                "onPto": row.get("onPto"),
                "openDealCount": int(row.get("openDealCount") or 0),
                "maxOpenDeals": row.get("maxOpenDeals"),
            }
        )

    must_assign = _must_assign(state.get("lead"))
    require_owner = (
        "Lead score is 40 or higher. Return a userId copied from candidates. "
        "A partial match on relationship, skill, language, location, or workload "
        "is enough. Do not return null."
    )

    def validate(parsed: dict[str, Any]) -> dict[str, Any]:
        uid = parsed.get("userId")
        if uid is None or uid == "" or str(uid).strip().lower() == "null":
            if must_assign:
                raise ValueError("sales-ready lead requires a candidate userId")
            parsed["userId"] = None
        elif str(uid).strip() not in id_set:
            raise ValueError("userId is not a sales rep candidate")
        else:
            parsed["userId"] = str(uid).strip()
        ranked = parsed.get("rankedUserIds")
        clean_ranked: list[str] = []
        if isinstance(ranked, list):
            for item in ranked:
                item_id = str(item or "").strip()
                if item_id in id_set and item_id not in clean_ranked:
                    clean_ranked.append(item_id)
        chosen_id = parsed.get("userId")
        if isinstance(chosen_id, str):
            clean_ranked = [chosen_id, *[item for item in clean_ranked if item != chosen_id]]
        else:
            clean_ranked = []
        parsed["rankedUserIds"] = clean_ranked
        return parsed

    parsed, err = await generate_json_with_retries(
        system=ASSIGN_SYSTEM,
        user="\n".join(
            [
                "lead:",
                json.dumps(state.get("lead") or {}, default=str)[:2500],
                "relationship:",
                json.dumps(state.get("relationship") or {}, default=str)[:2500],
                "candidates:",
                json.dumps(slim, default=str)[:8000],
                *([require_owner] if must_assign else []),
            ]
        ),
        max_tokens=1200,
        timeout_ms=30_000,
        validate=validate,
    )
    if err or not parsed:
        if err == "llm_not_configured":
            return None, "llm_not_configured"
        return None, err or "llm_empty"
    uid = parsed.get("userId")
    if uid is None or uid == "" or str(uid).strip().lower() == "null":
        reason = str(parsed.get("reason") or "").strip() or "No sales rep fit this lead."
        return None, reason
    uid_s = str(uid).strip()
    chosen = next(
        (
            r
            for r in sales_reps
            if str(r.get("id") or r.get("userId") or "") == uid_s
        ),
        None,
    )
    if not chosen:
        return None, "llm_unknown_owner"
    ranked = [
        str(item).strip()
        for item in (parsed.get("rankedUserIds") or [])
        if str(item).strip()
    ]
    if uid_s not in ranked:
        ranked.insert(0, uid_s)
    return {
        "userId": uid_s,
        "role": "sales_rep",
        "name": _display_name(chosen),
        "matchedRegion": bool(parsed.get("matchedRegion")),
        "reason": str(parsed.get("reason") or "Assigned by the sales assignment agent")[:280],
        "rankedUserIds": ranked,
    }, None


def _detail_load_candidates(_before: AssignState, after: AssignState) -> dict[str, Any] | None:
    return {"candidateCount": len(after.get("candidates") or [])}


def _detail_resolve(_before: AssignState, after: AssignState) -> dict[str, Any] | None:
    owner = after.get("owner") or {}
    return {
        "ownerName": owner.get("name"),
        "source": after.get("source"),
        "status": after.get("status"),
    }


_PIPELINE_STEPS = (
    traced_step(
        ASSIGNMENT_MODULE_PATH,
        ASSIGNMENT_AGENT,
        "load_candidates",
        "Loading sales rep facts",
        _detail_load_candidates,
        id_field=None,
        job_id_field="job_id",
    )(load_candidates),
    traced_step(
        ASSIGNMENT_MODULE_PATH,
        ASSIGNMENT_AGENT,
        "resolve",
        "Choosing the sales rep",
        _detail_resolve,
        id_field=None,
        job_id_field="job_id",
    )(resolve),
)


async def _run_pipeline(state: dict[str, Any]) -> dict[str, Any]:
    return await run_steps(state, _PIPELINE_STEPS)


async def run(
    organization_id: str | None = None,
    business_type: str | None = None,
    country: str | None = None,
    city: str | None = None,
    contact_id: str | None = None,
    company_id: str | None = None,
    location_id: str | None = None,
    estimated_amount: float | None = None,
) -> dict[str, Any]:
    result = await _run_pipeline(
        {
            "organization_id": organization_id,
            "job_id": str(uuid4()),
            "business_type": business_type,
            "country": country,
            "city": city,
            "contact_id": contact_id,
            "company_id": company_id,
            "location_id": location_id,
            "estimated_amount": estimated_amount,
            "status": "running",
        }
    )
    return {
        "status": result.get("status") or "failed",
        "source": "ai",
        "reason": result.get("reason"),
        "owner": result.get("owner"),
    }
