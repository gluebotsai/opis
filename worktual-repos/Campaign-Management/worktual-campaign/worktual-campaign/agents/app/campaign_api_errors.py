"""Parse Campaign API error bodies from httpx responses."""

from __future__ import annotations

import httpx


def campaign_api_error_message(exc: BaseException) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        res = exc.response
        try:
            body = res.json() if res.content else {}
        except Exception:  # noqa: BLE001
            body = {}
        if isinstance(body, dict):
            msg = str(body.get("message") or "").strip()
            if msg:
                return msg
            data = body.get("data")
            if isinstance(data, dict):
                msg = str(data.get("message") or "").strip()
                if msg:
                    return msg
        text = (res.text or "").strip()
        if text and len(text) < 500:
            return text
    return str(exc)
