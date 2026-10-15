"""Upload generated image bytes to campaign media API."""

from __future__ import annotations

import asyncio
import base64
import http.client
import json
import logging
import os
import re
from typing import Any
from urllib.parse import urlparse

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

DEFAULT_REBUILD_MEDIA_ORIGIN = "https://rebuild-campaign-api.worktual.com"


def _media_allow_local_publish() -> bool:
    raw = os.environ.get("MEDIA_ALLOW_LOCAL_PUBLISH", "").strip().lower()
    if raw in ("0", "false", "no"):
        return False
    if raw in ("1", "true", "yes"):
        return True
    return os.environ.get("NODE_ENV", "development").strip().lower() != "production"


def _is_loopback_or_lan_host(host: str) -> bool:
    h = str(host or "").strip().lower()
    if not h:
        return False
    if h in {"localhost", "127.0.0.1", "0.0.0.0", "::1"}:
        return True
    if h.startswith("192.168.") or h.startswith("10."):
        return True
    if h.startswith("172."):
        try:
            second = int(h.split(".")[1])
            return 16 <= second <= 31
        except (IndexError, ValueError):
            return False
    return False


def _public_base() -> str:
    """Rebuild / public API origin for email + cross-device media (LAN when dev flag set)."""
    settings = get_settings()
    allow_lan = _media_allow_local_publish()
    pub = str(settings.campaign_api_public_base or "").strip().rstrip("/")
    if pub:
        for part in pub.split(","):
            origin = part.strip().rstrip("/")
            if not (origin.startswith("http://") or origin.startswith("https://")):
                continue
            try:
                from urllib.parse import urlparse

                host = urlparse(origin).hostname or ""
            except Exception:  # noqa: BLE001
                host = ""
            if _is_loopback_or_lan_host(host) and not allow_lan:
                continue
            return _origin(origin)

    base = str(settings.campaign_api_base or "").strip().rstrip("/")
    if base.endswith("/api"):
        api_host = base[: -len("/api")]
        if api_host:
            try:
                from urllib.parse import urlparse

                host = urlparse(api_host).hostname or ""
            except Exception:  # noqa: BLE001
                host = ""
            if allow_lan or not _is_loopback_or_lan_host(host):
                return api_host

    return "https://rebuild-campaign-api.worktual.com"


def _origin(url: str) -> str:
    raw = str(url or "").strip().rstrip("/")
    if raw.endswith("/api"):
        return raw[: -len("/api")]
    return raw


def _upload_api_base() -> str:
    """
    Where to POST /media/upload.

    Prefer CAMPAIGN_API_PUBLIC_BASE (rebuild) so bytes land on the public media
    host and returned URLs are rebuild-absolute — never localhost/LAN.
    Fall back to CAMPAIGN_API_BASE only when no public origin is configured.
    """
    pub = _public_base()
    pub_api = pub if pub.endswith("/api") else f"{pub}/api"
    try:
        host = urlparse(pub_api).hostname or ""
    except Exception:  # noqa: BLE001
        host = ""
    if pub_api and (not _is_loopback_or_lan_host(host) or _media_allow_local_publish()):
        return pub_api

    settings = get_settings()
    local = str(settings.campaign_api_base or "").strip().rstrip("/")
    if local:
        return local
    return "https://rebuild-campaign-api.worktual.com/api"


def _upload_api_bases() -> list[str]:
    """Upload hosts: rebuild first; LAN campaign API next when local publish is on."""
    primary = _upload_api_base()
    pub = _public_base()
    pub_api = pub if pub.endswith("/api") else f"{pub}/api"
    settings = get_settings()
    local = str(settings.campaign_api_base or "").strip().rstrip("/")
    public_base_cfg = str(settings.campaign_api_public_base or "").strip()
    allow_internal = os.environ.get(
        "CAMPAIGN_MEDIA_UPLOAD_ALLOW_INTERNAL", ""
    ).strip().lower() in ("1", "true", "yes")

    out: list[str] = []
    for base in (primary, pub_api):
        b = str(base or "").strip().rstrip("/")
        if not b or b in out:
            continue
        try:
            host = urlparse(b).hostname or ""
        except Exception:  # noqa: BLE001
            host = ""
        # Never burn 60s on hung localhost when rebuild is configured as primary.
        if (
            _is_loopback_or_lan_host(host)
            and pub_api
            and pub_api != b
            and not _media_allow_local_publish()
        ):
            continue
        out.append(b)

    # With a public base configured, internal docker/LAN upload often 503s on forward —
    # skip unless explicitly allowed (local dev without public URL).
    if local:
        loc = local.rstrip("/")
        if loc and loc not in out:
            try:
                loc_host = urlparse(loc).hostname or ""
            except Exception:  # noqa: BLE001
                loc_host = ""
            if public_base_cfg and _is_loopback_or_lan_host(loc_host):
                if allow_internal or _media_allow_local_publish():
                    out.append(loc)
            else:
                out.append(loc)
    return out or ["https://rebuild-campaign-api.worktual.com/api"]


def _internal_service_key_headers() -> dict[str, str]:
    key = (
        os.environ.get("INTERNAL_SERVICE_KEY", "").strip()
        or os.environ.get("CAMPAIGN_INTERNAL_SERVICE_KEY", "").strip()
    )
    if not key:
        try:
            key = str(get_settings().internal_service_key or "").strip()
        except Exception:  # noqa: BLE001
            key = ""
    if not key:
        return {}
    return {"X-Internal-Service-Key": key}


def _media_public_direct_origin() -> str:
    """LAN → rebuild backend IP (bypasses nginx). Same as MEDIA_PUBLIC_DIRECT_ORIGIN."""
    raw = os.environ.get("MEDIA_PUBLIC_DIRECT_ORIGIN", "").strip().rstrip("/")
    if raw:
        return raw
    try:
        return str(
            getattr(get_settings(), "media_public_direct_origin", "") or ""
        ).strip().rstrip("/")
    except Exception:  # noqa: BLE001
        return ""


def _media_public_host_header() -> str:
    from_env = os.environ.get("MEDIA_PUBLIC_HOST_HEADER", "").strip()
    if from_env:
        return from_env
    try:
        from_settings = str(
            getattr(get_settings(), "media_public_host_header", "") or ""
        ).strip()
        if from_settings:
            return from_settings
    except Exception:  # noqa: BLE001
        pass
    try:
        host = urlparse(_public_base()).hostname or ""
    except Exception:  # noqa: BLE001
        host = ""
    return host.strip() or "rebuild-campaign-api.worktual.com"


def _parse_media_upload_body(body: dict | list | None) -> tuple[str, str]:
    data = body.get("data") if isinstance(body, dict) else {}
    if not isinstance(data, dict):
        data = body if isinstance(body, dict) else {}
    rel = str(data.get("url") or "").strip()
    media_id = str(data.get("media_id") or "").strip() or media_id_from_url(rel)
    return rel, media_id


def _configured_non_lan_public_origin() -> str:
    """Explicit public API host (rebuild) when set — used for template/email storage."""
    settings = get_settings()
    pub = str(settings.campaign_api_public_base or "").strip()
    for part in pub.split(","):
        origin = _origin(part.strip().rstrip("/"))
        if not origin.lower().startswith(("http://", "https://")):
            continue
        try:
            host = (urlparse(origin).hostname or "").lower()
        except Exception:  # noqa: BLE001
            host = ""
        if host and not _is_loopback_or_lan_host(host):
            return origin
    return ""


def _template_media_origin() -> str:
    """Origin for persisted template heroes (rebuild when configured, else default rebuild)."""
    configured = _configured_non_lan_public_origin()
    if configured:
        return configured
    origin = _origin(_public_base())
    try:
        host = (urlparse(origin).hostname or "").lower()
    except Exception:  # noqa: BLE001
        host = ""
    if host and not _is_loopback_or_lan_host(host):
        return origin
    return DEFAULT_REBUILD_MEDIA_ORIGIN


def stamp_template_media_url(url: str) -> str:
    """Rebuild-absolute /api/media/{uuid} for campaign media (not arbitrary CDN URLs)."""
    raw = str(url or "").strip()
    if not raw:
        return ""
    mid = media_id_from_url(raw)
    if mid:
        return f"{_template_media_origin()}/api/media/{mid}"
    if raw.startswith("/api/media/"):
        rel_mid = media_id_from_url(raw)
        if rel_mid:
            return f"{_template_media_origin()}/api/media/{rel_mid}"
        return raw
    if raw.lower().startswith(("http://", "https://")):
        try:
            parsed = urlparse(raw)
            path = parsed.path or ""
            host = (parsed.hostname or "").lower()
            if path.startswith("/api/media/") and _is_loopback_or_lan_host(host):
                lan_mid = media_id_from_url(raw)
                if lan_mid:
                    return f"{_template_media_origin()}/api/media/{lan_mid}"
        except Exception:  # noqa: BLE001
            pass
    return raw


def _stamp_public_media_url(rel: str, media_id: str) -> str:
    """Prefer rebuild-absolute /api/media/{id} so email clients can fetch bytes."""
    mid = str(media_id or "").strip() or media_id_from_url(rel)
    if mid:
        return f"{_template_media_origin()}/api/media/{mid}"
    if rel.lower().startswith(("http://", "https://")):
        return stamp_template_media_url(rel)
    path = rel if rel.startswith("/") else f"/{rel}"
    return f"{_template_media_origin()}{path}"


def _upload_via_direct_origin_sync(data_url: str, token: str = "") -> dict[str, str] | None:
    """POST /api/media/upload to the public backend IP with the rebuild Host header."""
    direct = _media_public_direct_origin()
    if not direct or not data_url:
        return None
    try:
        parsed = urlparse(direct)
    except Exception:  # noqa: BLE001
        return None
    hostname = (parsed.hostname or "").strip()
    if not hostname:
        return None
    scheme = (parsed.scheme or "http").lower()
    port = parsed.port or (443 if scheme == "https" else 80)
    host_header = _media_public_host_header()
    payload = json.dumps({"data_url": data_url}).encode("utf-8")
    headers = {
        "Host": host_header,
        "Content-Type": "application/json",
        "Content-Length": str(len(payload)),
        "Connection": "close",
    }
    auth = str(token or "").strip()
    headers.update(_internal_service_key_headers())
    if auth:
        headers["Authorization"] = (
            auth if auth.lower().startswith("bearer ") else f"Bearer {auth}"
        )
    path = "/api/media/upload"
    conn: http.client.HTTPConnection | http.client.HTTPSConnection | None = None
    try:
        if scheme == "https":
            conn = http.client.HTTPSConnection(hostname, port, timeout=60)
        else:
            conn = http.client.HTTPConnection(hostname, port, timeout=60)
        conn.request("POST", path, body=payload, headers=headers)
        resp = conn.getresponse()
        text = resp.read().decode("utf-8", errors="replace")
        status = int(resp.status or 0)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "media direct-origin upload failed origin=%s host=%s err=%s",
            direct,
            host_header,
            exc,
        )
        return None
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass
    if status >= 400:
        logger.warning(
            "media direct-origin upload http=%s origin=%s host=%s body=%s",
            status,
            direct,
            host_header,
            (text or "").strip().replace("\n", " ")[:180],
        )
        return None
    try:
        parsed_body = json.loads(text) if text else {}
    except json.JSONDecodeError:
        logger.warning("media direct-origin upload non-json origin=%s", direct)
        return None
    if not isinstance(parsed_body, dict):
        return None
    rel, media_id = _parse_media_upload_body(parsed_body)
    if not rel and not media_id:
        return None
    public_url = _stamp_public_media_url(rel, media_id)
    logger.info(
        "media direct-origin upload ok origin=%s host=%s media_id=%s",
        direct,
        host_header,
        media_id[:36],
    )
    return {"url": public_url, "media_id": media_id, "path": rel}


async def upload_via_direct_origin(
    data_url: str,
    *,
    token: str = "",
) -> dict[str, str] | None:
    if not _media_public_direct_origin():
        return None
    return await asyncio.to_thread(_upload_via_direct_origin_sync, data_url, token)


def absolutize_media_url(url: str) -> str:
    """Turn `/api/media/{id}` into a public-reachable URL (rebuild when public base is set)."""
    raw = str(url or "").strip()
    if not raw:
        return ""
    if media_id_from_url(raw) or raw.startswith("/api/media/"):
        stamped = stamp_template_media_url(raw)
        if stamped:
            return stamped
    public_origin = _origin(_public_base())

    if raw.lower().startswith(("http://", "https://")):
        try:
            parsed = urlparse(raw)
            path = parsed.path or ""
            if path.startswith("/api/media/") or path.startswith("/media/"):
                host = (parsed.hostname or "").lower()
                if _is_loopback_or_lan_host(host):
                    return stamp_template_media_url(raw)
                if host and not _is_loopback_or_lan_host(host):
                    if public_origin and host in public_origin.lower():
                        return f"{public_origin}{path}"
                    return raw
                if public_origin:
                    return f"{public_origin}{path}"
            return raw
        except Exception:  # noqa: BLE001
            return raw
    if raw.startswith("/api/media/") or raw.startswith("/media/"):
        return stamp_template_media_url(raw)
    return raw


def chat_store_media_url(url: str) -> str:
    """Store rebuild-absolute media URLs so chat + launch stay cross-device safe."""
    raw = str(url or "").strip()
    if not raw:
        return ""
    return stamp_template_media_url(raw)[:4096]


def publicize_html_media_urls(html: str) -> str:
    """Rewrite img src and CSS url() campaign media to rebuild-absolute URLs."""

    def _rewrite_quoted(url: str) -> str:
        t = str(url or "").strip()
        if not t or t.startswith("{{") or t.startswith("cid:"):
            return t
        if media_id_from_url(t) or (
            "/api/media/" in t and _is_loopback_or_lan_host((urlparse(t).hostname or "").lower())
            if t.lower().startswith(("http://", "https://"))
            else "/api/media/" in t
        ):
            stamped = stamp_template_media_url(t)
            if stamped != t or media_id_from_url(t):
                return stamped
        return t

    out = str(html or "")
    if not out:
        return out

    def _img_sub(m: re.Match[str]) -> str:
        prefix, q, url = m.group(1), m.group(2), m.group(3)
        return f"{prefix}{q}{_rewrite_quoted(url)}{q}"

    out = re.sub(
        r'(<img\b[^>]*?\bsrc\s*=\s*)(["\'])([^"\']+)\2',
        _img_sub,
        out,
        flags=re.IGNORECASE,
    )

    def _url_sub(m: re.Match[str]) -> str:
        q, url = m.group(1) or "", m.group(2)
        nxt = _rewrite_quoted(url.strip())
        return f"url({q}{nxt}{q})"

    out = re.sub(r"url\(\s*(['\"]?)([^)'\"]+)\1\s*\)", _url_sub, out, flags=re.IGNORECASE)
    return out


def publicize_template_image_fields(fields: dict[str, Any]) -> dict[str, Any]:
    """Stamp hero / section image URLs before DB persist (all channels)."""
    out: dict[str, Any] = dict(fields or {})
    for key in (
        "header_image",
        "image_url",
        "image",
        "header_media_url",
        "media_url",
        "headerImage",
        "hero_image",
        "heroImage",
    ):
        val = out.get(key)
        if isinstance(val, str) and val.strip():
            out[key] = stamp_template_media_url(val)
    sections = out.get("sections")
    if isinstance(sections, list):
        stamped_sections: list[Any] = []
        for row in sections:
            if not isinstance(row, dict):
                stamped_sections.append(row)
                continue
            item = dict(row)
            for key in ("url", "content"):
                val = item.get(key)
                if isinstance(val, str) and media_id_from_url(val):
                    item[key] = stamp_template_media_url(val)
            stamped_sections.append(item)
        out["sections"] = stamped_sections
    for key in ("compiled_html", "html"):
        val = out.get(key)
        if isinstance(val, str) and val.strip():
            out[key] = publicize_html_media_urls(val)
    return out


_MEDIA_UUID_RE = re.compile(
    r"([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})",
    re.I,
)


def media_id_from_url(url: str) -> str:
    raw = str(url or "").strip()
    if not raw:
        return ""
    found = _MEDIA_UUID_RE.findall(raw)
    return found[-1] if found else ""


def media_get_candidates(url: str) -> list[str]:
    """LAN + public hosts for the same /api/media/{id} (rebuild stamp can 404)."""
    raw = str(url or "").strip()
    mid = media_id_from_url(raw)
    out: list[str] = []
    seen: set[str] = set()

    def _add(candidate: str) -> None:
        c = str(candidate or "").strip()
        if not c or c in seen:
            return
        seen.add(c)
        out.append(c)

    _add(raw)
    if not mid:
        return out[:8]

    path = f"/api/media/{mid}"
    settings = get_settings()
    origins: list[str] = []
    try:
        parsed = urlparse(raw)
        if parsed.scheme and parsed.netloc:
            origins.append(f"{parsed.scheme}://{parsed.netloc}")
    except Exception:  # noqa: BLE001
        pass
    origins.append(_public_base())
    local = str(settings.campaign_api_base or "").strip().rstrip("/")
    if local.endswith("/api"):
        origins.append(local[: -len("/api")])
    elif local:
        origins.append(local)
    origins.extend(
        (
            "http://127.0.0.1:3001",
            "http://localhost:3001",
            "https://rebuild-campaign-api.worktual.com",
        )
    )
    for origin in origins:
        host = _origin(origin)
        if host:
            _add(f"{host}{path}")
    return out[:10]


async def ensure_public_media_url(
    url: str,
    *,
    token: str = "",
) -> tuple[str, str]:
    """Return (https_url, error). If rebuild 404s but LAN has bytes, republish."""
    target = str(url or "").strip()
    if not target.lower().startswith(("http://", "https://")):
        return "", "Need an https image URL."
    candidates = media_get_candidates(target)
    public_ok = ""
    lan_bytes = b""
    lan_ok_url = ""
    lan_mime = "image/png"
    last_status = ""
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            for cand in candidates:
                try:
                    resp = await client.get(cand)
                except Exception as exc:  # noqa: BLE001
                    last_status = f"{cand} unreachable"
                    logger.info("media probe failed url=%s err=%s", cand, exc)
                    continue
                if resp.status_code >= 400:
                    last_status = f"{cand} HTTP {resp.status_code}"
                    logger.info("media probe %s", last_status)
                    continue
                body = resp.content or b""
                host = ""
                try:
                    host = (urlparse(cand).hostname or "").lower()
                except Exception:  # noqa: BLE001
                    host = ""
                if _is_loopback_or_lan_host(host):
                    if body and not lan_bytes:
                        lan_bytes = body[: 3 * 1024 * 1024]
                        lan_ok_url = cand
                        ctype = str(resp.headers.get("content-type") or "")
                        if ctype.startswith("image/"):
                            lan_mime = ctype.split(";")[0].strip() or lan_mime
                    continue
                if body:
                    public_ok = cand
                    break
    except Exception as exc:  # noqa: BLE001
        logger.warning("media probe loop failed: %s", exc)
        return "", "Could not reach that image URL."

    if public_ok:
        return stamp_template_media_url(public_ok), ""

    if lan_bytes:
        logger.warning(
            "public media 404; republishing %s bytes from LAN last=%s",
            len(lan_bytes),
            last_status,
        )
        try:
            uploaded = await upload_image_bytes(
                lan_bytes, token=token, mime_type=lan_mime
            )
            published = str(uploaded.get("url") or "").strip()
        except Exception as exc:  # noqa: BLE001
            logger.warning("republish LAN media failed: %s", exc)
            if _media_allow_local_publish() and lan_ok_url:
                if _configured_non_lan_public_origin():
                    return (
                        "",
                        "That photo is on this machine but not on the public media host yet. "
                        "Try attaching it again in a moment.",
                    )
                logger.warning(
                    "using LAN media url after republish failure url=%s",
                    lan_ok_url[:160],
                )
                return lan_ok_url, ""
            return (
                "",
                "That photo is on this machine but not on the public media host yet. "
                "Try attaching it again in a moment.",
            )
        host = ""
        try:
            host = (urlparse(published).hostname or "").lower()
        except Exception:  # noqa: BLE001
            host = ""
        if published.lower().startswith(("http://", "https://")) and not _is_loopback_or_lan_host(
            host
        ):
            return published, ""
        if (
            published.lower().startswith(("http://", "https://"))
            and _is_loopback_or_lan_host(host)
            and _media_allow_local_publish()
        ):
            if _configured_non_lan_public_origin():
                stamped = stamp_template_media_url(published)
                if stamped and not _is_loopback_or_lan_host(
                    (urlparse(stamped).hostname or "").lower()
                ):
                    return stamped, ""
            logger.info("media local-publish accepted lan url=%s", published[:160])
            return stamp_template_media_url(published), ""
        if _media_allow_local_publish() and lan_ok_url:
            if _configured_non_lan_public_origin():
                return (
                    "",
                    "That photo is on this machine but not on the public media host yet. "
                    "Try attaching it again in a moment.",
                )
            logger.warning(
                "republish returned unreachable host; using LAN url=%s",
                lan_ok_url[:160],
            )
            return stamp_template_media_url(lan_ok_url), ""
        return (
            "",
            "That photo is on this machine but not on the public media host yet. "
            "Try attaching it again in a moment.",
        )

    return "", last_status or "Image URL returned HTTP 404."


async def upload_image_bytes(
    image_bytes: bytes,
    *,
    token: str = "",
    mime_type: str = "image/png",
    upload_base: str | None = None,
) -> dict[str, str]:
    """
    POST data_url to /api/media and return absolute URL + media_id.

    Tries MEDIA_PUBLIC_DIRECT_ORIGIN (rebuild Host header) first when set,
    then rebuild HTTPS, then campaign_api_base. When the successful host is
    LAN, keep that origin so local View can load the bytes.
    """
    if not image_bytes:
        raise RuntimeError("No image bytes to upload")
    from app.request_context import peek_request_token

    b64 = base64.b64encode(image_bytes).decode("ascii")
    data_url = f"data:{mime_type};base64,{b64}"
    headers: dict[str, str] = {"Content-Type": "application/json"}
    auth = str(token or peek_request_token() or "").strip()
    if auth:
        headers["Authorization"] = f"Bearer {auth}"

    if not upload_base:
        direct = await upload_via_direct_origin(data_url, token=auth)
        if direct and str(direct.get("url") or "").strip():
            return direct

    bases = (
        [str(upload_base).strip().rstrip("/")]
        if upload_base
        else _upload_api_bases()
    )
    last_err: Exception | None = None
    body: dict | list | None = None
    used_base = ""
    for base in bases:
        if not base:
            continue
        url = f"{base}/media/upload"
        req_headers = dict(headers)
        req_headers.update(_internal_service_key_headers())
        try:
            base_host = (urlparse(base).hostname or "").lower()
        except Exception:  # noqa: BLE001
            base_host = ""
        timeout = 20.0 if not _is_loopback_or_lan_host(base_host) else 30.0
        if _media_public_direct_origin() and not _is_loopback_or_lan_host(base_host):
            timeout = 8.0
        try:
            async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
                res = await client.post(
                    url, headers=req_headers, json={"data_url": data_url}
                )
                res.raise_for_status()
                body = res.json()
            used_base = base
            break
        except httpx.HTTPStatusError as exc:
            last_err = exc
            code = exc.response.status_code if exc.response is not None else "?"
            snippet = ""
            if exc.response is not None:
                snippet = (exc.response.text or "").strip().replace("\n", " ")[:180]
            logger.warning(
                "Media upload to %s failed http=%s body=%s",
                url,
                code,
                snippet or exc,
            )
            body = None
            continue
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            logger.warning("Media upload to %s failed: %s", url, exc)
            body = None
            continue
    if body is None:
        raise RuntimeError(
            f"Media upload failed for all hosts ({', '.join(bases)}): {last_err}"
        )

    rel, media_id = _parse_media_upload_body(body if isinstance(body, dict) else None)
    if not rel:
        raise RuntimeError("Media upload did not return url")
    public_url = _stamp_public_media_url(rel, media_id)
    if not public_url.lower().startswith(("http://", "https://")):
        raise RuntimeError(f"Media upload returned non-public URL: {public_url!r}")
    return {"url": public_url, "media_id": media_id, "path": rel}


def gallery_upload_api_base() -> str:
    """Campaign API base for gallery uploads (public host in production)."""
    return _upload_api_base()


__all__ = [
    "absolutize_media_url",
    "chat_store_media_url",
    "ensure_public_media_url",
    "gallery_upload_api_base",
    "media_get_candidates",
    "media_id_from_url",
    "publicize_html_media_urls",
    "publicize_template_image_fields",
    "stamp_template_media_url",
    "upload_image_bytes",
]
