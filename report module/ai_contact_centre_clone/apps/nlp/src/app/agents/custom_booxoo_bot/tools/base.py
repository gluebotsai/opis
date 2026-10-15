"""Tool wrapper for custom_booxoo_bot."""

from __future__ import annotations

import time

from app.logging import get_logger

logger = get_logger("nlp.custom_booxoo_bot.tools")


def _masked_destination(value) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if "@" in text:
        local, _, domain = text.partition("@")
        return f"{local[:2]}***@{domain}"
    digits = "".join(ch for ch in text if ch.isdigit())
    return f"***{digits[-4:]}" if digits else ""


class Tool:
    def __init__(self, tool_schema: dict, tool_function):
        self.tool_schema = tool_schema
        self.tool_function = tool_function

    def run(self, ctx, **kwargs):
        started = time.perf_counter()
        name = self.tool_schema["function"]["name"]
        try:
            result = self.tool_function(ctx, **kwargs)
            status = result.get("http_status") if isinstance(result, dict) else None
            logger.info(
                "tool name=%s latency_ms=%s http_status=%s ok=%s error=%s sent=%s "
                "channel=%s destination=%s applied_fields=%s requires_confirmation=%s "
                "organization_id=%s conversation_id=%s",
                name,
                int((time.perf_counter() - started) * 1000),
                status,
                result.get("ok") if isinstance(result, dict) else None,
                result.get("error") if isinstance(result, dict) else None,
                result.get("sent") if isinstance(result, dict) else None,
                result.get("channel") if isinstance(result, dict) else None,
                _masked_destination(result.get("destination")) if isinstance(result, dict) else "",
                result.get("appliedFields") if isinstance(result, dict) else None,
                result.get("requiresConfirmation") if isinstance(result, dict) else None,
                ctx.request.organization_id,
                ctx.request.conversation_id or "",
            )
            return result
        except Exception as exc:
            logger.exception(
                "tool name=%s failed organization_id=%s conversation_id=%s",
                name,
                ctx.request.organization_id,
                ctx.request.conversation_id or "",
            )
            return {"ok": False, "error": "tool_failed", "detail": str(exc)}
