"""Regression: live PCM WebSocket must be mounted on the FastAPI app (Path B STT)."""

from pathlib import Path

def _walk_routes(routes, prefix: str = "") -> list[str]:
    paths: list[str] = []
    for route in routes:
        sub = getattr(route, "routes", None)
        if sub is not None:
            mount = getattr(route, "path", "") or ""
            paths.extend(_walk_routes(sub, prefix + mount))
            continue
        path = prefix + (getattr(route, "path", "") or "")
        if path:
            paths.append(path)
    return paths


def test_main_py_includes_live_pcm_router():
    main_py = Path(__file__).resolve().parents[1] / "app" / "main.py"
    text = main_py.read_text(encoding="utf-8")
    assert "app.include_router(live_pcm_router)" in text


def test_live_pcm_websocket_routes_registered():
    from app.main import app

    paths = _walk_routes(app.routes)
    ws_paths = [p for p in paths if "live-pcm" in p]
    assert any("/v1/live-pcm/join/" in p for p in ws_paths), ws_paths
    assert any("/v1/meetings/" in p and "live-pcm" in p for p in ws_paths), ws_paths
