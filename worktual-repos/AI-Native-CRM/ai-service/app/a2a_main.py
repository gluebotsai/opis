"""Dedicated production ASGI entrypoint for the CRM A2A spoke.

Run separately from the agent API and MCP:

``uvicorn app.a2a_main:app --host 0.0.0.0 --port 8020``.
"""

from app.a2a.server import create_a2a_app

app = create_a2a_app()
