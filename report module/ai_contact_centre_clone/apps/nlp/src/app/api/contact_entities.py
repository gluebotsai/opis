"""Internal contact-entity extraction API."""

import uuid

from fastapi import APIRouter, Depends, Header

from app.api.auth import authenticate_internal
from app.llm.client import LLMClient, get_llm_client
from app.schemas.bot import (
    ContactEntityExtractionRequest,
    ContactEntityExtractionResponse,
)
from app.services.contact_entity_extraction import extract_contact_entities_llm


def create_contact_entities_router(api_v1_base: str) -> APIRouter:
    router = APIRouter(prefix=f"{api_v1_base}/contact-entities", tags=["Contact Entities"])

    @router.post("/extract", response_model=ContactEntityExtractionResponse)
    async def extract_contact_entities(
        request: ContactEntityExtractionRequest,
        x_tenant_id: str | None = Header(default=None),
        x_internal_service_key: str | None = Header(default=None),
        llm: LLMClient = Depends(get_llm_client),
    ) -> ContactEntityExtractionResponse:
        authenticate_internal(
            request.organization_id,
            x_tenant_id,
            x_internal_service_key,
            "contact-entities",
        )
        entities = await extract_contact_entities_llm(
            llm,
            request.message,
            channel=request.channel,
        )
        return ContactEntityExtractionResponse(
            contact_entities=entities,
            trace_id=str(uuid.uuid4()),
            model_name=llm.model,
        )

    return router
