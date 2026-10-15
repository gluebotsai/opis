"""LAN CORS origin detection for agents Socket.IO."""

from __future__ import annotations

from app.cors_origins import build_cors_origins


def test_build_cors_includes_localhost():
    origins = build_cors_origins("")
    assert "http://127.0.0.1:5173" in origins
    assert "http://localhost:5173" in origins


def test_build_cors_merges_env_and_strips_slash():
    origins = build_cors_origins("https://rebuild-campaign.worktual.com/")
    assert "https://rebuild-campaign.worktual.com" in origins


def test_build_cors_reads_lan_fe_url_env(monkeypatch):
    monkeypatch.setenv("LAN_FE_URL", "http://192.168.13.91:5173")
    origins = build_cors_origins("")
    assert "http://192.168.13.91:5173" in origins
