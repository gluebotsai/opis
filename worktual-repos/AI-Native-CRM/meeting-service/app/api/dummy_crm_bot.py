from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.services.dummy_crm_bot import reply

router = APIRouter(prefix="/internal/crm-bot", tags=["dummy-crm-bot"])


@router.post("/v1/assist/ask")
def dummy_assist_ask(payload: dict[str, Any], db: Session = Depends(get_db)) -> dict:
    return reply(payload, db)
