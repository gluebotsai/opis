"""Chat media URL helpers — rebuild public absolutize (never localhost)."""

from __future__ import annotations

from unittest.mock import patch

import pytest


def test_chat_store_media_url_prefers_rebuild_absolute() -> None:
    from app.agents.image.media_upload import chat_store_media_url

    class _S:
        campaign_api_base = "http://127.0.0.1:3001/api"
        campaign_api_public_base = "https://rebuild-campaign-api.worktual.com"
        cors_origin = ""

    with patch.dict(
        "os.environ",
        {"MEDIA_ALLOW_LOCAL_PUBLISH": "false", "NODE_ENV": "production"},
        clear=False,
    ):
        with patch("app.agents.image.media_upload.get_settings", return_value=_S()):
            assert (
                chat_store_media_url(
                    "https://rebuild-campaign-api.worktual.com/api/media/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
                )
                == "https://rebuild-campaign-api.worktual.com/api/media/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
            )
            assert (
                chat_store_media_url("/api/media/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")
                == "https://rebuild-campaign-api.worktual.com/api/media/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
            )


def test_absolutize_prefers_rebuild_public_not_localhost() -> None:
    from app.agents.image.media_upload import absolutize_media_url

    class _S:
        campaign_api_base = "http://127.0.0.1:3001/api"
        campaign_api_public_base = "https://rebuild-campaign-api.worktual.com"
        cors_origin = ""

    mid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    with patch.dict(
        "os.environ",
        {"MEDIA_ALLOW_LOCAL_PUBLISH": "false", "NODE_ENV": "production"},
        clear=False,
    ):
        with patch("app.agents.image.media_upload.get_settings", return_value=_S()):
            out = absolutize_media_url(
                f"https://rebuild-campaign-api.worktual.com/api/media/{mid}"
            )
            assert out == f"https://rebuild-campaign-api.worktual.com/api/media/{mid}"
            rel = absolutize_media_url(f"/api/media/{mid}")
            assert rel == f"https://rebuild-campaign-api.worktual.com/api/media/{mid}"
            loopback = absolutize_media_url(f"http://127.0.0.1:3001/api/media/{mid}")
            assert loopback == f"https://rebuild-campaign-api.worktual.com/api/media/{mid}"
            lan = absolutize_media_url(f"http://192.168.13.91:3001/api/media/{mid}")
            assert lan == f"https://rebuild-campaign-api.worktual.com/api/media/{mid}"


def test_upload_api_base_prefers_rebuild_public() -> None:
    """Upload POST goes to rebuild, not localhost — URLs stay public."""
    from app.agents.image.media_upload import _upload_api_base, _upload_api_bases

    class _S:
        campaign_api_base = "http://127.0.0.1:3001/api"
        campaign_api_public_base = "https://rebuild-campaign-api.worktual.com"
        cors_origin = ""

    with patch.dict(
        "os.environ",
        {"MEDIA_ALLOW_LOCAL_PUBLISH": "false", "NODE_ENV": "production"},
        clear=False,
    ):
        with patch("app.agents.image.media_upload.get_settings", return_value=_S()):
            assert _upload_api_base() == "https://rebuild-campaign-api.worktual.com/api"
            bases = _upload_api_bases()
            assert bases[0] == "https://rebuild-campaign-api.worktual.com/api"
            assert bases == ["https://rebuild-campaign-api.worktual.com/api"]


def test_upload_api_bases_local_dev_without_public() -> None:
    from app.agents.image.media_upload import _upload_api_bases

    class _S:
        campaign_api_base = "http://127.0.0.1:3001/api"
        campaign_api_public_base = ""
        cors_origin = ""

    with patch("app.agents.image.media_upload.get_settings", return_value=_S()):
        bases = _upload_api_bases()
        assert "http://127.0.0.1:3001/api" in bases


def test_absolutize_email_media_stays_rebuild_absolute() -> None:
    from app.agents.image.media_upload import absolutize_media_url, chat_store_media_url

    mid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    rebuild = f"https://rebuild-campaign-api.worktual.com/api/media/{mid}"
    class _S:
        campaign_api_base = "http://127.0.0.1:3001/api"
        campaign_api_public_base = "https://rebuild-campaign-api.worktual.com"
        cors_origin = ""

    with patch.dict("os.environ", {"MEDIA_ALLOW_LOCAL_PUBLISH": "true"}, clear=False):
        with patch("app.agents.image.media_upload.get_settings", return_value=_S()):
            assert absolutize_media_url(rebuild) == rebuild
            lan = f"http://192.168.13.91:3001/api/media/{mid}"
            assert chat_store_media_url(lan) == rebuild
            assert chat_store_media_url(f"/api/media/{mid}") == rebuild


def test_upload_api_bases_lan_fallback_when_local_publish() -> None:
    from app.agents.image.media_upload import _upload_api_bases

    class _S:
        campaign_api_base = "http://192.168.13.91:3001/api"
        campaign_api_public_base = "https://rebuild-campaign-api.worktual.com"
        cors_origin = ""

    with patch.dict(
        "os.environ",
        {"MEDIA_ALLOW_LOCAL_PUBLISH": "true", "NODE_ENV": "development"},
        clear=False,
    ):
        with patch("app.agents.image.media_upload.get_settings", return_value=_S()):
            bases = _upload_api_bases()
            assert bases[0] == "https://rebuild-campaign-api.worktual.com/api"
            assert "http://192.168.13.91:3001/api" in bases


def test_lan_local_publish_uses_lan_public_base() -> None:
    from app.agents.image.media_upload import _public_base, _upload_api_base

    class _S:
        campaign_api_base = "http://192.168.13.91:3001/api"
        campaign_api_public_base = "http://192.168.13.91:3001"
        cors_origin = ""

    with patch.dict(
        "os.environ",
        {"MEDIA_ALLOW_LOCAL_PUBLISH": "true"},
        clear=False,
    ):
        with patch("app.agents.image.media_upload.get_settings", return_value=_S()):
            assert _public_base() == "http://192.168.13.91:3001"
            assert _upload_api_base() == "http://192.168.13.91:3001/api"


def test_media_get_candidates_includes_lan_and_rebuild() -> None:
    from app.agents.image.media_upload import media_get_candidates, media_id_from_url

    mid = "6b3e577d-2c06-4080-ba81-0a68d988e2b8"
    rebuild = f"https://rebuild-campaign-api.worktual.com/api/media/{mid}"

    class _S:
        campaign_api_base = "http://192.168.13.91:3001/api"
        campaign_api_public_base = "https://rebuild-campaign-api.worktual.com"
        cors_origin = ""

    with patch("app.agents.image.media_upload.get_settings", return_value=_S()):
        assert media_id_from_url(rebuild) == mid
        cands = media_get_candidates(rebuild)
        assert rebuild in cands
        assert f"http://192.168.13.91:3001/api/media/{mid}" in cands
        assert f"http://127.0.0.1:3001/api/media/{mid}" in cands


@pytest.mark.asyncio
async def test_ensure_public_media_url_republishes_lan_when_rebuild_404() -> None:
    from app.agents.image.media_upload import ensure_public_media_url

    mid = "6b3e577d-2c06-4080-ba81-0a68d988e2b8"
    rebuild = f"https://rebuild-campaign-api.worktual.com/api/media/{mid}"
    published = f"https://rebuild-campaign-api.worktual.com/api/media/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"

    class _S:
        campaign_api_base = "http://192.168.13.91:3001/api"
        campaign_api_public_base = "https://rebuild-campaign-api.worktual.com"
        cors_origin = ""

    class _Resp:
        def __init__(self, status: int, content: bytes = b"", ctype: str = ""):
            self.status_code = status
            self.content = content
            self.headers = {"content-type": ctype} if ctype else {}

    class _Client:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, url: str):
            if "192.168.13.91" in url or "127.0.0.1" in url:
                return _Resp(200, b"\x89PNG fake-bytes", "image/png")
            return _Resp(404)

    async def _upload(image_bytes, token="", mime_type="image/png", upload_base=None):
        assert image_bytes.startswith(b"\x89PNG")
        return {"url": published, "media_id": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"}

    with (
        patch("app.agents.image.media_upload.get_settings", return_value=_S()),
        patch("app.agents.image.media_upload.httpx.AsyncClient", _Client),
        patch(
            "app.agents.image.media_upload.upload_image_bytes",
            new=_upload,
        ),
    ):
        url, err = await ensure_public_media_url(rebuild, token="t")
    assert err == ""
    assert url == published


@pytest.mark.asyncio
async def test_ensure_public_media_url_allows_lan_when_local_publish() -> None:
    from app.agents.image.media_upload import ensure_public_media_url

    mid = "6b3e577d-2c06-4080-ba81-0a68d988e2b8"
    rebuild = f"https://rebuild-campaign-api.worktual.com/api/media/{mid}"
    lan = f"http://192.168.13.91:3001/api/media/{mid}"

    class _S:
        campaign_api_base = "http://192.168.13.91:3001/api"
        campaign_api_public_base = "https://rebuild-campaign-api.worktual.com"
        cors_origin = ""
        media_public_direct_origin = ""
        media_public_host_header = ""

    class _Resp:
        def __init__(self, status: int, content: bytes = b"", ctype: str = ""):
            self.status_code = status
            self.content = content
            self.headers = {"content-type": ctype} if ctype else {}

    class _Client:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, url: str):
            if "192.168.13.91" in url or "127.0.0.1" in url:
                return _Resp(200, b"\x89PNG fake-bytes", "image/png")
            return _Resp(404)

    async def _upload(image_bytes, token="", mime_type="image/png", upload_base=None):
        return {"url": lan, "media_id": mid}

    with (
        patch.dict(
            "os.environ",
            {"MEDIA_ALLOW_LOCAL_PUBLISH": "true", "NODE_ENV": "development"},
            clear=False,
        ),
        patch("app.agents.image.media_upload.get_settings", return_value=_S()),
        patch("app.agents.image.media_upload.httpx.AsyncClient", _Client),
        patch("app.agents.image.media_upload.upload_image_bytes", new=_upload),
    ):
        url, err = await ensure_public_media_url(rebuild, token="t")
    assert err == ""
    assert url == rebuild


@pytest.mark.asyncio
async def test_ensure_public_media_url_keeps_lan_when_republish_fails() -> None:
    from app.agents.image.media_upload import ensure_public_media_url

    mid = "6b3e577d-2c06-4080-ba81-0a68d988e2b8"
    rebuild = f"https://rebuild-campaign-api.worktual.com/api/media/{mid}"
    lan = f"http://192.168.13.91:3001/api/media/{mid}"

    class _S:
        campaign_api_base = "http://192.168.13.91:3001/api"
        campaign_api_public_base = "https://rebuild-campaign-api.worktual.com"
        cors_origin = ""
        media_public_direct_origin = ""
        media_public_host_header = ""

    class _Resp:
        def __init__(self, status: int, content: bytes = b"", ctype: str = ""):
            self.status_code = status
            self.content = content
            self.headers = {"content-type": ctype} if ctype else {}

    class _Client:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, url: str):
            if "192.168.13.91" in url or "127.0.0.1" in url:
                return _Resp(200, b"\x89PNG fake-bytes", "image/png")
            return _Resp(404)

    async def _upload(image_bytes, token="", mime_type="image/png", upload_base=None):
        raise RuntimeError("public host down")

    with (
        patch.dict(
            "os.environ",
            {"MEDIA_ALLOW_LOCAL_PUBLISH": "true", "NODE_ENV": "development"},
            clear=False,
        ),
        patch("app.agents.image.media_upload.get_settings", return_value=_S()),
        patch("app.agents.image.media_upload.httpx.AsyncClient", _Client),
        patch("app.agents.image.media_upload.upload_image_bytes", new=_upload),
    ):
        url, err = await ensure_public_media_url(rebuild, token="t")
    assert err != ""
    assert url == ""


def test_publicize_html_media_urls_rewrites_lan_img_src() -> None:
    from app.agents.image.media_upload import publicize_html_media_urls

    mid = "ddfb2ae9-a8a1-42f7-886a-571963bb367b"
    lan = f'http://192.168.13.91:3001/api/media/{mid}'
    html = f'<img src="{lan}" alt="hero">'

    class _S:
        campaign_api_base = "http://192.168.13.91:3001/api"
        campaign_api_public_base = "https://rebuild-campaign-api.worktual.com"
        cors_origin = ""

    with patch("app.agents.image.media_upload.get_settings", return_value=_S()):
        out = publicize_html_media_urls(html)
    assert lan not in out
    assert f"https://rebuild-campaign-api.worktual.com/api/media/{mid}" in out


def test_direct_origin_upload_sends_rebuild_host_header() -> None:
    import json

    from app.agents.image.media_upload import _upload_via_direct_origin_sync

    mid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    captured: dict = {}

    class _Resp:
        status = 200

        def read(self):
            return json.dumps(
                {"data": {"url": f"/api/media/{mid}", "media_id": mid}}
            ).encode()

    class _Conn:
        def __init__(self, host, port, timeout=None):
            captured["host"] = host
            captured["port"] = port

        def request(self, method, path, body=None, headers=None):
            captured["method"] = method
            captured["path"] = path
            captured["headers"] = dict(headers or {})

        def getresponse(self):
            return _Resp()

        def close(self):
            return None

    class _S:
        campaign_api_base = "http://192.168.13.91:3001/api"
        campaign_api_public_base = "https://rebuild-campaign-api.worktual.com"
        cors_origin = ""
        media_public_direct_origin = ""
        media_public_host_header = ""

    with (
        patch.dict(
            "os.environ",
            {
                "MEDIA_PUBLIC_DIRECT_ORIGIN": "http://82.113.92.49:3001",
                "MEDIA_PUBLIC_HOST_HEADER": "rebuild-campaign-api.worktual.com",
            },
            clear=False,
        ),
        patch("app.agents.image.media_upload.get_settings", return_value=_S()),
        patch("http.client.HTTPConnection", _Conn),
    ):
        out = _upload_via_direct_origin_sync("data:image/png;base64,abcd", "tok")
    assert captured["host"] == "82.113.92.49"
    assert captured["port"] == 3001
    assert captured["path"] == "/api/media/upload"
    assert captured["headers"]["Host"] == "rebuild-campaign-api.worktual.com"
    assert captured["headers"]["Authorization"] == "Bearer tok"
    assert out is not None
    assert out["url"] == f"https://rebuild-campaign-api.worktual.com/api/media/{mid}"
    assert out["media_id"] == mid


@pytest.mark.asyncio
async def test_upload_image_bytes_prefers_direct_origin() -> None:
    from app.agents.image.media_upload import upload_image_bytes

    published = {
        "url": "https://rebuild-campaign-api.worktual.com/api/media/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        "media_id": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        "path": "/api/media/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    }

    async def _direct(data_url, token=""):
        assert data_url.startswith("data:image/png;base64,")
        assert token == "t"
        return published

    def _fail_client(*args, **kwargs):
        raise AssertionError("HTTPS upload must not run when direct origin succeeds")

    with (
        patch.dict(
            "os.environ",
            {"MEDIA_PUBLIC_DIRECT_ORIGIN": "http://82.113.92.49:3001"},
            clear=False,
        ),
        patch(
            "app.agents.image.media_upload.upload_via_direct_origin",
            new=_direct,
        ),
        patch("app.agents.image.media_upload.httpx.AsyncClient", _fail_client),
    ):
        out = await upload_image_bytes(b"\x89PNG", token="t")
    assert out == published
