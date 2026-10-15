"""Suppress private reasoning from OpenAI-compatible model responses."""

import re
from typing import Any

_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)
_THINK_OPEN = re.compile(r"<think>", re.IGNORECASE)


def no_thinking_options() -> dict[str, Any]:
    return {
        "enable_thinking": False,
        "chat_template_kwargs": {"enable_thinking": False},
        "thinking": {"type": "disabled"},
        "thinking_budget": 0,
    }


def gemma_thinking_options(*, enable: bool = False) -> dict[str, Any]:
    """worktual-gemma only supports a boolean enable_thinking flag."""
    return {"enable_thinking": enable}


def low_thinking_options() -> dict[str, Any]:
    """Enable GLM-style thinking at low effort (zai-org/GLM-4.5 / worktual-glm)."""
    return {
        "enable_thinking": True,
        "chat_template_kwargs": {"enable_thinking": True},
        "thinking": {"type": "enabled"},
        "reasoning_effort": "low",
    }


def thinking_profile_for_model(model: str) -> str:
    lowered = model.lower()
    if "gemma" in lowered:
        return "gemma"
    if "minimax" in lowered:
        return "minimax"
    return "glm"


def thinking_options(mode: str | None = "low", *, profile: str = "") -> dict[str, Any]:
    # Gemma and MiniMax only accept a boolean enable_thinking flag.
    # GLM extra_body keys (reasoning_effort, thinking.type) make the
    # Worktual gateway serve worktual-glm even when model is minimax.
    normalized_profile = (profile or "").strip().lower()
    if not normalized_profile or normalized_profile == "minimax":
        # MiniMax / unknown: omit GLM extras so the gateway honors `model`.
        return {}
    if normalized_profile == "gemma":
        normalized = (mode or "off").strip().lower()
        return gemma_thinking_options(
            enable=normalized not in {"off", "disabled", "none", "false", "0"},
        )
    normalized = (mode or "off").strip().lower()
    if normalized in {"off", "disabled", "none", "false", "0"}:
        return no_thinking_options()
    if normalized in {"low", "medium", "high"}:
        body = low_thinking_options()
        body["reasoning_effort"] = normalized
        return body
    return low_thinking_options()


def strip_thinking(text: str, *, trim: bool = True) -> str:
    if not text:
        return ""
    visible = _THINK_BLOCK.sub("", text)
    close_index = visible.casefold().find("</think>")
    if close_index >= 0:
        visible = visible[close_index + len("</think>") :]
    open_match = _THINK_OPEN.search(visible)
    if open_match:
        visible = visible[: open_match.start()]
    return visible.strip() if trim else visible


class ThinkingFilter:
    _OPEN = "<think>"
    _CLOSE = "</think>"
    _MAX_IMPLICIT_BUFFER = 1500
    _VISIBLE_MARKERS = ("\n<p", "\n<ul>", "\n<ol>", "\n<div", "\n<span", "\n<strong>")

    def __init__(self) -> None:
        self.buffer = ""
        self.inside_thinking = False
        self.released_text = False

    def feed(self, text: str) -> str:
        self.buffer += text
        visible: list[str] = []
        while self.buffer:
            lowered = self.buffer.casefold()
            if self.inside_thinking:
                close_index = lowered.find(self._CLOSE)
                visible_index = min(
                    (
                        index
                        for marker in self._VISIBLE_MARKERS
                        if (index := lowered.find(marker)) >= 0
                    ),
                    default=-1,
                )
                if visible_index >= 0 and (
                    close_index < 0 or visible_index < close_index
                ):
                    self.buffer = self.buffer[visible_index + 1 :]
                    self.inside_thinking = False
                    self.released_text = True
                    continue
                if close_index < 0:
                    self.buffer = self.buffer[-(len(self._CLOSE) - 1) :]
                    break
                self.buffer = self.buffer[close_index + len(self._CLOSE) :]
                self.inside_thinking = False
                continue

            open_index = lowered.find(self._OPEN)
            close_index = lowered.find(self._CLOSE)
            if open_index >= 0 and (close_index < 0 or open_index < close_index):
                visible.append(self.buffer[:open_index])
                self.buffer = self.buffer[open_index + len(self._OPEN) :]
                self.inside_thinking = True
                continue
            if close_index >= 0:
                visible.clear()
                self.buffer = self.buffer[close_index + len(self._CLOSE) :]
                self.released_text = True
                continue
            if not self.released_text:
                has_visible_markup = any(
                    marker.strip() in lowered for marker in self._VISIBLE_MARKERS
                )
                if len(self.buffer) < self._MAX_IMPLICIT_BUFFER and not has_visible_markup:
                    break
            safe_length = max(0, len(self.buffer) - len(self._OPEN) + 1)
            chunk = self.buffer[:safe_length]
            visible.append(chunk)
            self.buffer = self.buffer[safe_length:]
            if chunk:
                self.released_text = True
            break
        return "".join(visible)

    def flush(self) -> str:
        visible = "" if self.inside_thinking else strip_thinking(self.buffer, trim=False)
        self.buffer = ""
        self.inside_thinking = False
        return visible

    def finish(self) -> str:
        return self.flush()


ThinkingStreamFilter = ThinkingFilter
no_thinking_extra_body = no_thinking_options
strip_thinking_text = strip_thinking
