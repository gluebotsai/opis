"""Load Worktual MiniMax settings from the repo env files. Never print secrets."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

EXPERIMENT_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = EXPERIMENT_ROOT.parents[1]


def _load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def load_env() -> None:
    _load_env_file(REPO_ROOT / ".env")
    _load_env_file(REPO_ROOT / "apps" / "nlp" / ".env")


@dataclass(frozen=True)
class MiniMaxSettings:
    api_key: str
    base_url: str
    model: str
    temperature: float
    timeout_seconds: float
    max_tokens: int

    @property
    def host(self) -> str:
        return self.base_url.replace("https://", "").replace("http://", "").split("/")[0]


def get_minimax_settings() -> MiniMaxSettings:
    load_env()
    api_key = (
        os.environ.get("TOGETHER_API_KEY")
        or os.environ.get("CHAT_OPENAI_API_KEY")
        or "123"
    )
    base_url = (
        os.environ.get("TOGETHER_BASE_URL")
        or os.environ.get("CHAT_OPENAI_BASE_URL")
        or "http://81.17.61.148:8064/v1"
    )
    model = (
        os.environ.get("TOGETHER_MODEL")
        or os.environ.get("CHAT_OPENAI_MODEL")
        or "worktual-minimax"
    )
    temperature = float(os.environ.get("CHAT_OPENAI_TEMPERATURE") or "0.2")
    timeout_seconds = float(os.environ.get("CHAT_OPENAI_TIMEOUT_SECONDS") or "90")
    return MiniMaxSettings(
        api_key=api_key,
        base_url=base_url.rstrip("/"),
        model=model,
        temperature=temperature,
        timeout_seconds=timeout_seconds,
        max_tokens=4096,
    )
