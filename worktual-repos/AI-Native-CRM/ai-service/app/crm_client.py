from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


class CrmClient:
    def __init__(self, organization_id: str | None = None) -> None:
        self.settings = get_settings()
        self.organization_id = organization_id
        self.base = self.settings.crm_api_base_url.rstrip("/")

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        secret = self.settings.internal_secret
        if secret:
            headers["x-internal-secret"] = secret
        if self.organization_id:
            headers["x-organization-id"] = self.organization_id
        return headers

    async def _get(
        self,
        path: str,
        params: dict[str, Any] | None = None,
        *,
        allow_404: bool = False,
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.get(
                f"{self.base}{path}",
                headers=self._headers(),
                params=params,
            )
            if allow_404 and res.status_code == 404:
                return {}
            res.raise_for_status()
            data = res.json()
            return data if isinstance(data, dict) else {}

    async def _post(
        self,
        path: str,
        payload: dict[str, Any],
        *,
        allow_404: bool = False,
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=60.0) as client:
            res = await client.post(
                f"{self.base}{path}",
                headers=self._headers(),
                json=payload,
            )
            if allow_404 and res.status_code == 404:
                return {"status": "skipped", "reason": "not_found"}
            res.raise_for_status()
            data = res.json()
            return data if isinstance(data, dict) else {}

    # ── Enrichment ──────────────────────────────────────────────
    async def get_enrichment_context(self, contact_id: str) -> dict[str, Any]:
        return await self._get(f"/api/internal/enrichment/{contact_id}")

    async def persist_enrichment(
        self, contact_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._post(f"/api/internal/enrichment/{contact_id}", payload)

    async def post_agent_step(
        self,
        module_path: str,
        entity_id: str | None,
        *,
        agent: str,
        step: str,
        label: str,
        status: str,
        detail: dict[str, Any] | None = None,
        error_reason: str | None = None,
        contact_id: str | None = None,
        company_id: str | None = None,
        job_id: str | None = None,
    ) -> None:
        """
        Curated "what is the agent doing" trace for the live UI timeline.
        Best-effort only — never raises, never blocks/fails the agent run.
        `detail` must stay small and curated (no raw HTML/prompt/tool dumps).

        `module_path` is the internal route segment for this agent (e.g.
        "enrichment", "scoring", "auto-reply" — matches `CRM_API_BASE_URL
        /api/internal/{module_path}/{entity_id}/steps`). `entity_id` is
        `None` for agents with no natural per-call URL entity (e.g.
        sales_assignment, which may target a company only) — the route is
        then the flat `/api/internal/{module_path}/steps`. `contact_id` lets
        activity-keyed agents (auto-reply, meeting agents) still show up on
        a contact's trace even though `entity_id` is the activity id.
        `job_id` is the ephemeral run id job-less agents generate at the
        start of `run()`; job-backed agents leave it `None` and the backend
        resolves the real job row itself.
        """
        path = (
            f"/api/internal/{module_path}/{entity_id}/steps"
            if entity_id
            else f"/api/internal/{module_path}/steps"
        )
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                res = await client.post(
                    f"{self.base}{path}",
                    headers=self._headers(),
                    json={
                        "agent": agent,
                        "step": step,
                        "label": label,
                        "status": status,
                        "detail": detail,
                        "errorReason": error_reason,
                        "contactId": contact_id,
                        "companyId": company_id,
                        "jobId": job_id,
                    },
                )
                if res.status_code >= 400:
                    logger.warning(
                        "post_agent_step %s %s%s: %s",
                        res.status_code,
                        module_path,
                        path,
                        (res.text or "")[:240],
                    )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "post_agent_step failed (%s%s): %s",
                module_path,
                path,
                exc,
            )

    # ── Scoring ─────────────────────────────────────────────────
    async def get_scoring_context(self, contact_id: str) -> dict[str, Any]:
        return await self._get(f"/api/internal/scoring/{contact_id}")

    # ── Summary ─────────────────────────────────────────────────
    async def get_summary_context(self, contact_id: str) -> dict[str, Any]:
        return await self._get(f"/api/internal/summary/{contact_id}")

    async def persist_summary(
        self, contact_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._post(f"/api/internal/summary/{contact_id}", payload)

    # ── Nurture ─────────────────────────────────────────────────
    async def get_nurture_context(self, contact_id: str) -> dict[str, Any]:
        return await self._get(f"/api/internal/nurture/{contact_id}")

    async def persist_nurture(
        self, contact_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._post(f"/api/internal/nurture/{contact_id}", payload)

    # ── Hub A2A outbound (compose → send) ───────────────────────
    async def send_hub_outbound_email(
        self, contact_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._post(
            f"/api/internal/hub-outbound-email/{contact_id}", payload
        )

    async def resolve_hub_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Fill missing Hub typed fields from CRM/CDP (best-effort)."""
        data = await self._post("/api/internal/hub-resolve/resolve", payload)
        if not isinstance(data, dict):
            return {"resolved": {}, "sources": {}}
        resolved = data.get("resolved")
        sources = data.get("sources")
        return {
            "resolved": resolved if isinstance(resolved, dict) else {},
            "sources": sources if isinstance(sources, dict) else {},
        }

    # ── Lifecycle ───────────────────────────────────────────────
    async def get_lifecycle_context(self, contact_id: str) -> dict[str, Any]:
        return await self._get(
            f"/api/internal/lifecycle/{contact_id}",
            allow_404=True,
        )

    async def persist_lifecycle(
        self, contact_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._post(f"/api/internal/lifecycle/{contact_id}", payload)

    # ── Inbound email auto-reply ────────────────────────────────
    async def get_auto_reply_context(self, activity_id: str) -> dict[str, Any]:
        return await self._get(
            f"/api/internal/auto-reply/{activity_id}",
            allow_404=True,
        )

    async def persist_auto_reply(
        self, activity_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._post(
            f"/api/internal/auto-reply/{activity_id}",
            payload,
            allow_404=True,
        )

    # ── Meeting brief (owner email) ─────────────────────────────
    async def get_meeting_brief_context(self, activity_id: str) -> dict[str, Any]:
        return await self._get(
            f"/api/internal/meeting-brief/{activity_id}",
            allow_404=True,
        )

    # ── Pipeline forecast auditor ────────────────────────────────
    async def get_forecast_context(self, deal_id: str) -> dict[str, Any]:
        return await self._get(f"/api/internal/forecast/{deal_id}")

    async def persist_forecast(
        self, deal_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._post(f"/api/internal/forecast/{deal_id}", payload)

    # ── Invoice escalation ──────────────────────────────────────
    async def get_invoice_escalation_context(self, invoice_id: str) -> dict[str, Any]:
        return await self._get(f"/api/internal/invoice-escalation/{invoice_id}")

    async def persist_invoice_escalation(
        self, invoice_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._post(
            f"/api/internal/invoice-escalation/{invoice_id}", payload
        )

    # ── Company Collection Risk ──────────────────────────────────
    async def get_collection_risk_context(self, company_id: str) -> dict[str, Any]:
        return await self._get(f"/api/internal/company-collection-risk/{company_id}")

    async def persist_collection_risk(
        self, company_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._post(
            f"/api/internal/company-collection-risk/{company_id}", payload
        )

    # ── Revenue Gap Forecast ─────────────────────────────────────
    async def get_revenue_gap_context(self, organization_id: str) -> dict[str, Any]:
        return await self._get(f"/api/internal/revenue-gap-forecast/{organization_id}")

    async def persist_revenue_gap(
        self, organization_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._post(
            f"/api/internal/revenue-gap-forecast/{organization_id}", payload
        )

    # ── Invoice Dunning ───────────────────────────────────────────
    async def get_invoice_dunning_context(self, invoice_id: str) -> dict[str, Any]:
        return await self._get(f"/api/internal/invoice-dunning/{invoice_id}")

    async def persist_invoice_dunning(
        self, invoice_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._post(f"/api/internal/invoice-dunning/{invoice_id}", payload)

    # ── Expansion & Revenue Matcher ──────────────────────────────
    async def get_expansion_context(self, company_id: str) -> dict[str, Any]:
        return await self._get(f"/api/internal/expansion-matcher/{company_id}")

    async def persist_expansion(
        self, company_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._post(
            f"/api/internal/expansion-matcher/{company_id}", payload
        )

    # ── Sales assignment ────────────────────────────────────────
    async def get_assignment_candidates(
        self,
        *,
        business_type: str | None = None,
        country: str | None = None,
        city: str | None = None,
        contact_id: str | None = None,
        company_id: str | None = None,
        location_id: str | None = None,
        estimated_amount: float | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {}
        if business_type:
            params["businessType"] = business_type
        if country:
            params["country"] = country
        if city:
            params["city"] = city
        if contact_id:
            params["contactId"] = contact_id
        if company_id:
            params["companyId"] = company_id
        if location_id:
            params["locationId"] = location_id
        if estimated_amount is not None:
            params["estimatedAmount"] = estimated_amount
        return await self._get("/api/internal/assignment/candidates", params)

    async def research_seo_keywords(
        self,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=90.0) as client:
            res = await client.post(
                f"{self.base}/api/internal/seo/keyword-research",
                headers=self._headers(),
                json=payload,
            )
            res.raise_for_status()
            data = res.json()
            return data if isinstance(data, dict) else {}

    async def publish_seo_social_post(
        self,
        organization_id: str,
        post_id: str,
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=45.0) as client:
            res = await client.post(
                f"{self.base}/api/internal/seo/publish-post",
                headers=self._headers(),
                json={"organizationId": organization_id, "postId": post_id},
            )
            res.raise_for_status()
            data = res.json()
            return data if isinstance(data, dict) else {}
