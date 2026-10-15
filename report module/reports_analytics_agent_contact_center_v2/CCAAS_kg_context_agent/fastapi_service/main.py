import asyncio
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Optional

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.response import Generate_response, ChatRequest, ActivityEvent

import os
from dotenv import load_dotenv

env_path = Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

import os
from urllib.parse import quote_plus

_PACK = Path(__file__).resolve().parents[2]
_REPO = _PACK.parent
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

from reports_analytics_agent_contact_center_v2.core.access import AccessDenied
from reports_analytics_agent_contact_center_v2.core.kg.role import lookup_cc_role


def _postgres_dsn() -> str:
    dsn = (os.getenv("DATABASE_URL") or os.getenv("PG_DSN") or "").strip()
    if dsn:
        return dsn
    host = (os.getenv("pg_host") or "").strip()
    if not host:
        return ""
    user = quote_plus(os.getenv("pg_user") or "")
    password = quote_plus(os.getenv("pg_password") or "")
    port = os.getenv("pg_port") or "5432"
    dbname = os.getenv("pg_database") or ""
    return f"postgresql://{user}:{password}@{host}:{port}/{dbname}"


def get_user_role(organization_id: str, user_id: str) -> str:
    return lookup_cc_role(_postgres_dsn(), int(organization_id), int(user_id))

from src.prompt import system_prompt as SYSTEM_PROMPT
from src.tools import build_tool_handlers
from src.sse_events import (
    SSE_HEADERS,
    sse_status,
    sse_tool_call,
    sse_block,
    sse_text_delta,
    sse_done,
    sse_error,
    sse_activity,
    tool_block_label,
    tool_result_summary,
    parse_tool_args,
)

_SENTINEL = object()


def noop_tool_callback(fn_name, fn_args):
    pass


class ChatResponse(BaseModel):
    answer: str
    sessionID: str
    organization_id: str
    tool_calls: list[dict]
    error: Optional[str] = None
    elapsed_seconds: float
    reasoning: Optional[dict] = None


@dataclass
class SSEState:
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    result: dict = field(default_factory=dict)
    error: Optional[str] = None


async def _stream_text_chunks(content: str, chunk_size: int = 48, delay: float = 0.012):
    """Yield text_delta frames in small chunks for a typing effect."""
    if not content:
        return
    for i in range(0, len(content), chunk_size):
        yield sse_text_delta(content[i : i + chunk_size])
        await asyncio.sleep(delay)


async def generate_sse(request: ChatRequest, role: str, wrapped_handlers: dict, start_time: float):
    loop = asyncio.get_running_loop()
    state = SSEState()
    turn_id = str(uuid.uuid4())

    def enqueue(frame: str):
        loop.call_soon_threadsafe(state.queue.put_nowait, frame)

    def finish():
        loop.call_soon_threadsafe(state.queue.put_nowait, _SENTINEL)

    def status_callback(phase: str, label: str):
        enqueue(sse_status(phase, label))

    def activity_callback(event: ActivityEvent):
        enqueue(
            sse_activity(
                event.step_id,
                event.status,
                event.title,
                event.description,
            )
        )

    def tool_callback(fn_name, fn_args):
        args = parse_tool_args(fn_args)
        call_id = f"call_{uuid.uuid4().hex[:12]}"
        enqueue(sse_tool_call(fn_name, args, call_id))
        enqueue(
            sse_block(
                fn_name,
                "running",
                tool_block_label(fn_name, fn_args),
            )
        )

    def tool_result_callback(fn_name, fn_args, tool_response: dict):
        label = tool_block_label(fn_name, fn_args)
        summary = tool_result_summary(fn_name, tool_response)
        status = "error" if tool_response.get("error") else "success"
        enqueue(sse_block(fn_name, status, label, summary))

    def run():
        try:
            from src.llm import LOWLLM
            result = Generate_response(
                request,
                role=role,
                llm=LOWLLM(),
                system_prompt=SYSTEM_PROMPT,
                on_tool_call=tool_callback,
                tool_handlers=wrapped_handlers,
                on_status=status_callback,
                on_activity=activity_callback,
                on_tool_result=tool_result_callback,
            )
            state.result = result if result else {}
        except Exception as e:
            import traceback
            traceback.print_exc(file=sys.stderr)
            state.error = str(e)
        finally:
            finish()

    worker = loop.run_in_executor(None, run)

    # Instant feedback before the worker thread starts.
    yield sse_status("understanding", "Understanding your question…")

    while True:
        try:
            frame = await asyncio.wait_for(state.queue.get(), timeout=0.4)
        except asyncio.TimeoutError:
            if worker.done() and state.queue.empty():
                break
            continue

        if frame is _SENTINEL:
            break
        yield frame

    while not state.queue.empty():
        item = state.queue.get_nowait()
        if item is not _SENTINEL:
            yield item

    await worker

    elapsed = round(time.time() - start_time, 3)

    if state.error:
        yield sse_error(state.error)
        yield sse_done(elapsed, turn_id)
        return

    content = state.result.get("content") or ""
    yield sse_status("writing", "Writing my reply…")
    async for frame in _stream_text_chunks(content):
        yield frame
    yield sse_done(elapsed, turn_id)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(title="KG Agent API", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    start = time.time()
    from src.llm import LOWLLM
    try:
        role = get_user_role(request.organization_id, request.user_id)
    except AccessDenied as exc:
        elapsed = round(time.time() - start, 3)
        return ChatResponse(
            answer="",
            sessionID=request.sessionID,
            organization_id=request.organization_id,
            tool_calls=[],
            error=str(exc),
            elapsed_seconds=elapsed,
        )
    wrapped_handlers = build_tool_handlers(request.organization_id, request.user_id)
    try:
        print(f"\n[{time.strftime('%H:%M:%S')}] [QUERY - {role}] {request.query}")
        result = await asyncio.to_thread(
            Generate_response,
            request,
            role=role,
            llm=LOWLLM(),
            system_prompt=SYSTEM_PROMPT,
            on_tool_call=noop_tool_callback,
            tool_handlers=wrapped_handlers,
        )
        elapsed = round(time.time() - start, 3)
        answer = result.get("content") or ""
        print(f"[{time.strftime('%H:%M:%S')}] [RESPONSE - {elapsed}s] {answer}...\n")
        return ChatResponse(
            answer=answer,
            sessionID=request.sessionID,
            organization_id=request.organization_id,
            tool_calls=result.get("tool_calls") or [],
            error=result.get("error"),
            elapsed_seconds=elapsed,
            reasoning=result.get("reasoning"),
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        elapsed = round(time.time() - start, 3)
        return ChatResponse(
            answer="I encountered an internal error while analyzing your request and could not complete the query. Please try asking in a different way or narrowing the scope of your question.",
            sessionID=request.sessionID,
            organization_id=request.organization_id,
            tool_calls=[],
            error=f"Error code: 500 - {str(e)}",
            elapsed_seconds=elapsed,
        )


@app.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    start = time.time()
    try:
        role = get_user_role(request.organization_id, request.user_id)
    except AccessDenied as exc:
        async def denied():
            yield sse_error(str(exc))
            yield sse_done()

        return StreamingResponse(
            denied(),
            media_type="text/event-stream",
            headers=SSE_HEADERS,
        )
    wrapped_handlers = build_tool_handlers(request.organization_id, request.user_id)
    return StreamingResponse(
        generate_sse(request, role, wrapped_handlers, start),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )
