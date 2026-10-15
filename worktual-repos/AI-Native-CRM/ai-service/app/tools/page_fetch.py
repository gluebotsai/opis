from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

import httpx

from app.config import get_settings


def is_private_host(hostname: str) -> bool:
    host = (hostname or "").strip().lower().rstrip(".")
    if not host:
        return True
    if host in {"localhost", "0.0.0.0"} or host.endswith(".local") or host.endswith(
        ".internal"
    ):
        return True
    try:
        ip = ipaddress.ip_address(host)
        return (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
        )
    except ValueError:
        pass
    try:
        infos = socket.getaddrinfo(host, None)
        for info in infos:
            ip = ipaddress.ip_address(info[4][0])
            if (
                ip.is_private
                or ip.is_loopback
                or ip.is_link_local
                or ip.is_reserved
                or ip.is_multicast
            ):
                return True
    except OSError:
        return True
    return False


async def safe_fetch_text(url: str) -> str | None:
    settings = get_settings()
    try:
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"}:
            return None
        if is_private_host(parsed.hostname or ""):
            return None
        async with httpx.AsyncClient(
            timeout=settings.fetch_timeout_seconds,
            follow_redirects=True,
            max_redirects=3,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
                ),
                "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            },
        ) as client:
            res = await client.get(url)
            if res.status_code >= 400:
                return None
            final_host = urlparse(str(res.url)).hostname or ""
            if is_private_host(final_host):
                return None
            content = res.content
            if len(content) > settings.max_html_bytes:
                return None
            return content.decode("utf-8", errors="replace")
    except Exception:
        return None
