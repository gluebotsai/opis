"""Sample tester UI: ask the SQL agent and inspect logs + warehouse data."""

from __future__ import annotations

import argparse
import json
import mimetypes
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from sql_agent.agent import ping_minimax
from sql_agent.context import QueryContext
from sql_agent.history import history_messages
from sql_agent.orchestrator import SqlOrchestrator
from sql_agent.tools import SqlAgentTools
from sql_agent.webapi import (
    MAX_QUESTION_CHARS,
    resolve_period,
    setup_payload,
    turn_payload,
)

EXPERIMENT_ROOT = Path(__file__).resolve().parents[2]
UI_ROOT = EXPERIMENT_ROOT / "ui"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765


def _json_bytes(payload: Any) -> bytes:
    return json.dumps(payload, default=str).encode("utf-8")


class SqlAgentUiHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/setup":
            self._send_json(setup_payload())
            return
        if path == "/api/ping":
            self._send_json(ping_minimax())
            return
        self._send_static(path)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path != "/api/ask":
            self.send_error(404, "Not found")
            return
        try:
            length = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            self._send_json({"error": "Invalid content length."}, status=400)
            return
        raw = self.rfile.read(max(0, min(length, 32_000)))
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self._send_json({"error": "Body must be JSON."}, status=400)
            return
        if not isinstance(body, dict):
            self._send_json({"error": "Body must be a JSON object."}, status=400)
            return
        question = str(body.get("question") or "").strip()
        if not question:
            self._send_json({"error": "Question is required."}, status=400)
            return
        if len(question) > MAX_QUESTION_CHARS:
            self._send_json({"error": "Question is too long."}, status=400)
            return
        history = history_messages(body.get("history"))
        period_start, period_end = resolve_period(
            kind=str(body.get("period") or ""),
            period_start=body.get("period_start"),
            period_end=body.get("period_end"),
        )
        ctx = QueryContext.resolve(period_start, period_end)
        tools = SqlAgentTools(live=True, ctx=ctx)
        orchestrator = SqlOrchestrator(tools=tools)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        try:
            turn = orchestrator.run(
                question,
                period_start=ctx.period_start,
                period_end=ctx.period_end,
                history=history,
                on_event=lambda event: self._sse("log", event.as_dict()),
            )
            self._sse("result", turn_payload(question, tools.ctx, turn, tools))
        except BrokenPipeError:
            return
        except Exception as error:
            self._sse(
                "error",
                {"error": str(error).split("\n")[0] or "The SQL agent failed."},
            )

    def _sse(self, event: str, payload: Any) -> None:
        data = json.dumps(payload, default=str)
        frame = f"event: {event}\ndata: {data}\n\n".encode("utf-8")
        self.wfile.write(frame)
        self.wfile.flush()

    def _send_json(self, payload: Any, status: int = 200) -> None:
        body = _json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_static(self, request_path: str) -> None:
        relative = "index.html" if request_path in {"/", "/index.html"} else request_path.lstrip("/")
        if not relative or ".." in Path(relative).parts:
            self.send_error(400, "Bad path")
            return
        path = (UI_ROOT / relative).resolve()
        if not str(path).startswith(str(UI_ROOT.resolve())) or not path.is_file():
            self.send_error(404, "Not found")
            return
        mime, _ = mimetypes.guess_type(path.name)
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)


def serve(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> None:
    if not (UI_ROOT / "index.html").is_file():
        raise SystemExit(f"UI files missing under {UI_ROOT}")
    server = ThreadingHTTPServer((host, port), SqlAgentUiHandler)
    url = f"http://{host}:{port}"
    print(f"SQL agent tester  {url}", flush=True)
    print("  Ask a question, then watch logs and warehouse data on the right.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.", flush=True)
    finally:
        server.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Worktual SQL agent sample tester UI.")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()
    serve(host=args.host, port=args.port)


if __name__ == "__main__":
    main()
