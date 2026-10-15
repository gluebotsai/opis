"""LLM: cluster historical proposal PDFs into distinct Format+Content styles."""

from __future__ import annotations

import json
import logging
from typing import Any

from app.agents.llm_result import extract_json, sectioned_system_prompt
from app.llm import generate_proposal_ai_text as generate_ai_text, is_ai_configured

logger = logging.getLogger(__name__)

SYSTEM = sectioned_system_prompt(
    role=(
        "You cluster historical B2B proposal PDFs into distinct visual and "
        "writing styles for an organization playbook."
    ),
    goal=(
        "Group proposals that share the same Format (cover, fonts, table chrome) "
        "and Content outline (section order, pricing shape). Do not mix a "
        "consultative two-product proposal with a telecom full-catalog pack."
    ),
    instructions=(
        "- Use ONLY proposalItemId values from the input list.\n"
        "- One cluster if every PDF looks and is structured the same.\n"
        "- Separate clusters when cover style, pricing shape, or section outline differ.\n"
        "- Name clusters by style (consultative, tiered, banner) — never a customer name.\n"
        "- tags should be reusable match tokens (ccaas, crm, telecom, consultative)."
    ),
    context="Proposal style cards are in the user message.",
    output=(
        'Return ONLY JSON: {"clusters":[{"name":"...","tags":["..."],'
        '"proposalItemIds":["..."]}]}'
    ),
    guardrails="Never invent proposal ids. Never copy customer names into cluster names.",
)


def _style_key(item: dict[str, Any]) -> str:
    cover = str(item.get("coverStyle") or "banner").strip().lower()
    pricing = str(item.get("pricingShape") or "line_items").strip().lower()
    return f"{cover}|{pricing}"


def _heuristic_clusters(proposals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in proposals:
        item_id = str(item.get("itemId") or item.get("proposalItemId") or "").strip()
        if not item_id:
            continue
        grouped.setdefault(_style_key(item), []).append(item)
    clusters: list[dict[str, Any]] = []
    for key, items in grouped.items():
        cover, pricing = (key.split("|") + ["line_items"])[:2]
        label = "Consultative" if cover == "left" else "Centered" if cover == "centered" else "Standard"
        if "tier" in pricing:
            label = f"{label} tiered"
        clusters.append(
            {
                "name": f"{label} proposal pattern",
                "tags": [cover, pricing],
                "proposalItemIds": [
                    str(i.get("itemId") or i.get("proposalItemId")) for i in items
                ],
            }
        )
    if not clusters and proposals:
        clusters.append(
            {
                "name": "Learned proposal pattern",
                "tags": ["general"],
                "proposalItemIds": [
                    str(i.get("itemId") or i.get("proposalItemId"))
                    for i in proposals
                    if i.get("itemId") or i.get("proposalItemId")
                ],
            }
        )
    return clusters


def _normalize(
    clusters: list[dict[str, Any]], proposal_ids: list[str]
) -> list[dict[str, Any]]:
    known = set(proposal_ids)
    assigned: set[str] = set()
    out: list[dict[str, Any]] = []
    for cluster in clusters:
        if not isinstance(cluster, dict):
            continue
        ids: list[str] = []
        for raw in cluster.get("proposalItemIds") or []:
            item_id = str(raw).strip()
            if item_id in known and item_id not in assigned:
                assigned.add(item_id)
                ids.append(item_id)
        if not ids:
            continue
        tags = [
            str(t)[:80]
            for t in (cluster.get("tags") or [])
            if isinstance(t, str) and t.strip()
        ]
        out.append(
            {
                "name": str(cluster.get("name") or "Learned proposal pattern")[:120],
                "tags": tags[:12],
                "proposalItemIds": ids,
            }
        )
    leftover = [item_id for item_id in proposal_ids if item_id not in assigned]
    if leftover:
        if out:
            out[0]["proposalItemIds"].extend(leftover)
        else:
            out.append(
                {
                    "name": "Learned proposal pattern",
                    "tags": ["general"],
                    "proposalItemIds": leftover,
                }
            )
    return out


async def run(body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body or {}
    proposals = body.get("proposals") if isinstance(body.get("proposals"), list) else []
    proposal_ids = [
        str(item.get("itemId") or item.get("proposalItemId") or "").strip()
        for item in proposals
        if isinstance(item, dict)
    ]
    proposal_ids = [item_id for item_id in proposal_ids if item_id]
    fallback = _normalize(_heuristic_clusters(proposals), proposal_ids)

    if len(proposal_ids) <= 1:
        return {
            "ok": True,
            "status": "ok",
            "clusters": fallback,
            "source": "heuristic",
            "reason": "single_proposal",
        }

    if not is_ai_configured():
        return {
            "ok": True,
            "status": "ok",
            "clusters": fallback,
            "source": "heuristic",
            "reason": "llm_not_configured",
        }

    user = (
        "Cluster these historical proposals by Format + Content style:\n"
        f"{json.dumps(proposals, ensure_ascii=False)[:20_000]}"
    )
    try:
        text = await generate_ai_text(
            system=SYSTEM,
            user=user,
            max_tokens=1200,
            timeout_ms=90_000,
        )
        payload = extract_json(text or "") or {}
        raw = payload.get("clusters") if isinstance(payload.get("clusters"), list) else []
        clusters = _normalize(
            [c for c in raw if isinstance(c, dict)],
            proposal_ids,
        )
        if not clusters:
            clusters = fallback
        return {
            "ok": True,
            "status": "ok",
            "clusters": clusters,
            "source": "ai",
        }
    except Exception as exc:  # noqa: BLE001
        logger.exception("proposal-playbook-cluster LLM failed")
        return {
            "ok": True,
            "status": "ok",
            "clusters": fallback,
            "source": "heuristic",
            "reason": f"llm_error:{exc}",
        }
