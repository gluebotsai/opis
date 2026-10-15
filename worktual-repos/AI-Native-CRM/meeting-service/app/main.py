from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.assist import router as assist_router
from app.api.addons import router as addons_router
from app.api.dummy_crm_bot import router as dummy_crm_bot_router
from app.api.health import router as health_router
from app.api.live import router as live_router
from app.api.live_pcm import router as live_pcm_router
from app.api.meetings import router as meetings_router
from app.api.ui import router as ui_router
from app.api.vexa_webhook import router as webhook_router
from app.config import settings
from app.logging import setup_logging
from app.models import init_db
from app.services import vexa


@asynccontextmanager
async def lifespan(_app: FastAPI):
    setup_logging()
    init_db()
    if not settings.testing:
        vexa.register_webhook()
    yield


app = FastAPI(title="meeting-service", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health_router)
app.include_router(meetings_router)
app.include_router(assist_router)
app.include_router(dummy_crm_bot_router)
app.include_router(live_router)
app.include_router(live_pcm_router)
app.include_router(webhook_router)
app.include_router(ui_router)
app.include_router(addons_router)


@app.middleware("http")
async def meet_addon_frame_ancestors(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/addons/"):
        response.headers["Content-Security-Policy"] = (
            "frame-ancestors https://meet.google.com https://*.meet.google.com 'self'"
        )
        if "x-frame-options" in response.headers:
            del response.headers["x-frame-options"]
    return response
