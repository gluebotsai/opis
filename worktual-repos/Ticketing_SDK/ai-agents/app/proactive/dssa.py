"""DSSA — Deflection & Self-Service before ticket create (any inbound channel)."""

from __future__ import annotations

from typing import Any

from app.proactive.contract import AgentSpec, Proposal
from app.proactive.llm_json import confidence_of, run_agent_llm

SPEC = AgentSpec(
    agent_id="dssa",
    trigger=("inbound.message",),
    inputs_required=("organization_id", "text"),
    tools_used=frozenset({"search_kb", "list_kb", "get_kb"}),
    output_type="RECOMMENDATION",
    risk_level="low",
    confidence_threshold=0.75,
    audit_event="proactive.dssa",
    full_name="Deflection and Self-Service Agent",
)

_SELECT_SYSTEM = """You are the Deflection & Self-Service Agent (DSSA).

Decide whether published knowledge-base articles can help the customer resolve
their issue WITHOUT creating a support ticket yet.

Rules:
- Judge by meaning (LLM understanding), never by keyword or regex lists.
- Use ONLY the single retrieved article provided (Meilisearch top match).
- If that article is relevant to the issue, set deflect=true and return its
  article_id. The product will walk the customer through steps automatically —
  do NOT require them to ask for a search first.
- If the customer already said self-service failed, wants a human, or explicitly
  wants a ticket filed now, set deflect=false.
- If the customer is thanking you, saying they will try the article themselves,
  or that they are sorted / no longer need help, set deflect=false (do not
  regenerate guidance).
- Pure greetings with no issue → deflect=false.

Return JSON only:
{"deflect": boolean, "article_ids": [string], "confidence": number, "reason": string}
"""

_GUIDE_SYSTEM = """You are the Deflection & Self-Service Agent (DSSA).

Write an INTERACTIVE customer-facing troubleshooting reply using ONLY the selected
knowledge-base article content below.

Requirements:
- Do NOT ask permission to search the knowledge base — guidance starts now.
- Do NOT dump the full article or paste long unbroken text.
- Walk the customer through troubleshooting interactively:
  • Open with brief empathy + the article title.
  • Give ONLY the first 1–2 concrete steps from the article (numbered).
  • Ask them to try those steps and tell you what happened (worked / still stuck /
    different error). You will continue with later steps on the next turn.
- Never invent steps that are not in the article body.
- Never invent ticket numbers.
- Invite filing a ticket only if the article has no usable steps.

Return JSON only:
{"reply": string, "confidence": number, "steps": [string], "opening_step_count": number}
"""

_KB_FOLLOWUP_SYSTEM = """You are continuing interactive KB troubleshooting on the support portal.

The customer already received partial article-based help. Read their latest message by
meaning (LLM understanding — never keyword/regex lists). Decide one intent and write
ONE natural reply.

intents:
- resolved — they thank you, the steps worked, or they no longer need help.
  Reply warmly; do NOT repeat steps; do NOT push a ticket.
- need_ticket — they still need help after trying, or clearly want a ticket filed.
  Reply briefly that you will file using the issue already collected.
  Do NOT dump article content again.
- continue — they affirmed they will try / asked for the next steps / said it did
  not work yet and need the next troubleshooting step.
  From the remaining article steps (and prior guidance), give the NEXT 1–2 steps only.
  Ask again whether that helped. Do NOT restart from step 1. Do NOT paste the full article.
- followup — they ask a clarifying question about the prior guidance.
  Answer briefly from the article context; then offer the next step if useful.

Return JSON only:
{"intent": "resolved"|"need_ticket"|"continue"|"followup", "reply": string, "confidence": number}
"""


def _payload_rows(result: dict[str, Any]) -> list[dict[str, Any]]:
    payload = result.get("payload") if isinstance(result, dict) else None
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    if isinstance(payload, dict):
        for key in ("articles", "items", "kb", "data", "article"):
            rows = payload.get(key)
            if isinstance(rows, list):
                return [r for r in rows if isinstance(r, dict)]
            if key == "article" and isinstance(rows, dict):
                return [rows]
    return []


def _portal_actor(organization_id: str):
    from app.tools.express_client import ToolActor

    return ToolActor(
        user_id="dssa-service",
        organization_id=str(organization_id).strip(),
        user_role="portal_guest",
        user_name="DSSA",
    )


def _hit_from_search_payload(result: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(result, dict) or not result.get("success"):
        return None
    payload = result.get("payload")
    hit = None
    if isinstance(payload, dict):
        hit = payload.get("hit")
        if hit is None and isinstance(payload.get("data"), dict):
            hit = payload["data"].get("hit")
    if not isinstance(hit, dict):
        return None
    aid = str(hit.get("article_id") or hit.get("articleId") or hit.get("id") or "").strip()
    title = str(hit.get("title") or "").strip()
    text = str(hit.get("text") or hit.get("content") or hit.get("body") or "").strip()
    steps = hit.get("steps") if isinstance(hit.get("steps"), list) else []
    symptoms = hit.get("symptoms") if isinstance(hit.get("symptoms"), list) else []
    if not title and not text and not steps:
        return None
    return {
        "id": aid,
        "title": title or "Untitled",
        "category": str(hit.get("category") or ""),
        "content": text[:4000],
        "symptoms": [str(s).strip() for s in symptoms if str(s).strip()],
        "steps": [str(s).strip() for s in steps if str(s).strip()],
    }


def load_published_kb_for_llm(
    *,
    organization_id: str,
    query: str = "",
    limit: int = 1,
) -> list[dict[str, Any]]:
    """One Meilisearch assist hit for the LLM. Never dump the published catalog."""
    del limit
    org = str(organization_id or "").strip()
    q = str(query or "").strip()
    if not org or not q:
        return []
    try:
        from app.tools.catalog_tools import search_kb
        from app.tools.express_client import tool_actor_scope

        with tool_actor_scope(_portal_actor(org)):
            result = search_kb(query=q)
    except Exception:
        return []
    hit = _hit_from_search_payload(result if isinstance(result, dict) else None)
    return [hit] if hit else []


def _fetch_article_bodies(
    organization_id: str,
    article_ids: list[str],
    catalog: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Prefer full article bodies for step-by-step guidance."""
    by_id = {str(a.get("id") or ""): a for a in catalog}
    selected: list[dict[str, Any]] = []
    try:
        from app.tools.catalog_tools import get_kb
        from app.tools.express_client import tool_actor_scope

        with tool_actor_scope(_portal_actor(organization_id)):
            for aid in article_ids[:3]:
                aid_s = str(aid or "").strip()
                if not aid_s:
                    continue
                try:
                    got = get_kb(aid_s)
                except Exception:
                    got = None
                rows = _payload_rows(got) if isinstance(got, dict) and got.get("success") else []
                row = rows[0] if rows else None
                if isinstance(row, dict) and (row.get("content") or row.get("body") or row.get("title")):
                    selected.append(
                        {
                            "id": aid_s,
                            "title": str(row.get("title") or by_id.get(aid_s, {}).get("title") or "Untitled"),
                            "category": str(row.get("category") or ""),
                            "content": str(row.get("content") or row.get("body") or "")[:4000],
                        }
                    )
                    continue
                if aid_s in by_id:
                    selected.append(by_id[aid_s])
    except Exception:
        for aid in article_ids[:3]:
            aid_s = str(aid or "").strip()
            if aid_s in by_id:
                selected.append(by_id[aid_s])
    if not selected:
        # Fall back to top catalog entries if LLM ids were weak
        selected = catalog[:2]
    return selected


def evaluate_deflection(
    text: str,
    *,
    organization_id: str,
    channel: str | None = None,
    subject: str | None = None,
    history: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """
    LLM-only deflection: pick relevant KB, then write step-by-step guidance.

    Returns:
      deflect, reply, confidence, articles, llm
    """
    message = str(text or "").strip()
    org = str(organization_id or "").strip()
    if not message or not org:
        return {"deflect": False, "reply": "", "confidence": 0.0, "articles": []}

    articles = load_published_kb_for_llm(organization_id=org, query=message)
    if not articles:
        return {"deflect": False, "reply": "", "confidence": 0.0, "articles": []}

    history_lines: list[str] = []
    for item in history or []:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip().lower()
        line = str(item.get("text") or item.get("content") or "").strip()
        if role in {"user", "assistant"} and line:
            history_lines.append(f"{role}: {line}")
    history_block = "\n".join(history_lines[-12:]) if history_lines else "(none)"

    select_blob = (
        f"channel={channel or 'unknown'}\n"
        f"subject={subject or ''}\n"
        f"conversation_history:\n{history_block}\n\n"
        f"latest_customer_message:\n{message}\n\n"
        f"retrieved_kb_article:\n{articles[0]}"
    )
    select_obj = run_agent_llm("dssa", _SELECT_SYSTEM, select_blob)
    conf = confidence_of(select_obj, 0.3)
    deflect = bool(select_obj.get("deflect"))
    if not deflect:
        return {
            "deflect": False,
            "reply": "",
            "confidence": conf,
            "articles": articles,
            "llm": select_obj,
        }

    raw_ids = select_obj.get("article_ids")
    article_ids = (
        [str(x).strip() for x in raw_ids if str(x).strip()]
        if isinstance(raw_ids, list)
        else []
    )
    if not article_ids:
        article_ids = [str(a.get("id") or "") for a in articles[:1] if a.get("id")]

    chosen = [a for a in articles if str(a.get("id") or "") in set(article_ids)][:1]
    if not chosen:
        chosen = articles[:1]
    guide_blob = (
        f"customer_message:\n{message}\n\n"
        f"selected_articles:\n{chosen}\n\n"
        "Write the step-by-step self-service reply now."
    )
    guide_obj = run_agent_llm("dssa", _GUIDE_SYSTEM, guide_blob)
    reply = str(guide_obj.get("reply") or "").strip()
    conf = max(conf, confidence_of(guide_obj, conf))
    raw_steps = guide_obj.get("steps")
    steps = (
        [str(s).strip() for s in raw_steps if str(s).strip()]
        if isinstance(raw_steps, list)
        else []
    )
    if not steps:
        hit_steps = chosen[0].get("steps") if chosen else None
        if isinstance(hit_steps, list):
            steps = [str(s).strip() for s in hit_steps if str(s).strip()]
    opening = int(guide_obj.get("opening_step_count") or 0) or (
        min(2, len(steps)) if steps else 0
    )
    if not reply:
        return {
            "deflect": False,
            "reply": "",
            "confidence": conf,
            "articles": articles,
            "llm": {"select": select_obj, "guide": guide_obj},
        }
    return {
        "deflect": True,
        "reply": reply,
        "confidence": conf,
        "articles": articles,
        "chosen_articles": chosen,
        "steps": steps,
        "steps_shown": opening,
        "llm": {"select": select_obj, "guide": guide_obj},
        "article_ids": [str(a.get("id") or "") for a in chosen if a.get("id")],
    }


def classify_kb_followup(
    text: str,
    *,
    issue: str | None = None,
    prior_guidance: str | None = None,
    article_content: str | None = None,
    steps_remaining: list[str] | None = None,
) -> dict[str, Any]:
    """LLM-only: after KB guidance, classify resolved / need_ticket / continue / followup."""
    message = str(text or "").strip()
    if not message:
        return {"intent": "followup", "reply": "", "confidence": 0.0}
    remaining = [str(s).strip() for s in (steps_remaining or []) if str(s).strip()]
    blob = (
        f"issue_on_draft:\n{issue or '(none)'}\n\n"
        f"prior_guidance_summary:\n{prior_guidance or '(KB guidance was already shown)'}\n\n"
        f"article_excerpts:\n{article_content or '(see prior guidance)'}\n\n"
        f"remaining_steps_not_yet_shown:\n{remaining or '(none listed — invent none)'}\n\n"
        f"latest_customer_message:\n{message}\n"
    )
    obj = run_agent_llm("dssa", _KB_FOLLOWUP_SYSTEM, blob)
    intent = str(obj.get("intent") or "").strip().lower()
    if intent not in {"resolved", "need_ticket", "continue", "followup"}:
        intent = "followup"
    return {
        "intent": intent,
        "reply": str(obj.get("reply") or "").strip(),
        "confidence": confidence_of(obj, 0.5),
        "llm": obj,
    }


def propose(event: dict[str, Any]) -> Proposal | None:
    payload = event.get("payload") or {}
    text = str(payload.get("text") or payload.get("body") or "").strip()
    org = str(event.get("organization_id") or "")
    if not text or not org:
        return None

    history = payload.get("history") if isinstance(payload.get("history"), list) else None
    decision = evaluate_deflection(
        text,
        organization_id=org,
        channel=str(payload.get("channel") or "").strip() or None,
        subject=str(payload.get("subject") or "").strip() or None,
        history=history,
    )
    if not decision.get("deflect"):
        return None
    reply = str(decision.get("reply") or "").strip()
    if not reply:
        return None
    conf = float(decision.get("confidence") or 0.0)
    return Proposal(
        agent_id="dssa",
        organization_id=org,
        event_id=event.get("id") or event.get("event_id"),
        event_type=event.get("event_type"),
        output_type="RECOMMENDATION",
        risk_level="low",
        confidence=conf,
        tool_name=None,
        tool_args={},
        summary=reply,
        payload={
            "hits": decision.get("chosen_articles") or decision.get("articles") or [],
            "deflect": True,
            "llm": decision.get("llm") or {},
            "article_ids": decision.get("article_ids") or [],
        },
    )
