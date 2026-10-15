import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn
from rtp_server import UDPRTPServer
from session_manager import VoicebotSessionManager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("voicebot.main")

session_manager = VoicebotSessionManager()

rtp_host = os.getenv("VOICEBOT_RTP_HOST", "0.0.0.0")
rtp_port = int(os.getenv("VOICEBOT_RTP_PORT", "5000"))
rtp_server = UDPRTPServer(host=rtp_host, port=rtp_port, session_manager=session_manager)

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Worktual Voicebot service...")
    rtp_server.start()
    yield
    logger.info("Stopping Worktual Voicebot service...")
    rtp_server.stop()

app = FastAPI(title="Worktual Voicebot Microservice", version="1.0.0", lifespan=lifespan)

class StartSessionRequest(BaseModel):
    callId: str
    callerNumber: str = ""
    ccaasNumber: str = ""

class StopSessionRequest(BaseModel):
    callId: str

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "voicebot-service",
        "rtp_port": rtp_port,
        "active_sessions": list(session_manager.sessions.keys())
    }

@app.post("/sessions/start")
def start_session(req: StartSessionRequest):
    if not req.callId:
        raise HTTPException(status_code=400, detail="callId is required")
    logger.info(f"HTTP POST /sessions/start callId={req.callId}")
    session_manager.start_session(
        call_id=req.callId,
        caller_number=req.callerNumber,
        ccaas_number=req.ccaasNumber
    )
    return {"success": True, "callId": req.callId, "status": "started"}

@app.post("/sessions/stop")
def stop_session(req: StopSessionRequest):
    if not req.callId:
        raise HTTPException(status_code=400, detail="callId is required")
    logger.info(f"HTTP POST /sessions/stop callId={req.callId}")
    session_manager.stop_session(req.callId)
    return {"success": True, "callId": req.callId, "status": "stopped"}

if __name__ == "__main__":
    http_port = int(os.getenv("VOICEBOT_HTTP_PORT", "5001"))
    logger.info(f"Starting Voicebot HTTP API server on port {http_port}...")
    uvicorn.run(app, host="0.0.0.0", port=http_port)
