"""Load environment files for Python services."""

from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent.parent
AI_CHAT_ROOT = REPO_ROOT / "AI_CHAT"
_ENV_LOADED = False
_AI_CHAT_ENV_LOADED = False


def load_project_env() -> Path:
    """Load `.env` from the repository root. Safe to call multiple times."""
    global _ENV_LOADED
    env_path = REPO_ROOT / ".env"
    if not _ENV_LOADED:
        if env_path.exists():
            load_dotenv(env_path)
        _ENV_LOADED = True
    return REPO_ROOT


def load_ai_chat_env() -> Path:
    """Load AI chat env: `AI_CHAT/.env` first, then root `.env` for missing keys."""
    global _AI_CHAT_ENV_LOADED
    service_env = AI_CHAT_ROOT / ".env"
    root_env = REPO_ROOT / ".env"
    if not _AI_CHAT_ENV_LOADED:
        if service_env.exists():
            load_dotenv(service_env)
            if root_env.exists():
                load_dotenv(root_env, override=False)
        elif root_env.exists():
            load_dotenv(root_env)
        _AI_CHAT_ENV_LOADED = True
    return AI_CHAT_ROOT if service_env.exists() else REPO_ROOT


def env_int(name: str, default: int) -> int:
    import os

    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return int(raw)


def env_str(name: str, default: str) -> str:
    import os

    return os.environ.get(name, default)
