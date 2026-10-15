"""LLM client for custom_lola_worktual."""

import json
from functools import lru_cache
from typing import Any

from openai import OpenAI

from app.config import get_settings
from app.llm.thinking_filter import no_thinking_options


def build_worktual_llm_extra_body(*, reasoning_effort: str | None = "low") -> dict[str, Any]:
    """OpenAI-compatible extras for gpt-oss-120b on the Worktual Lola endpoint."""
    body: dict[str, Any] = {
        **no_thinking_options(),
        "top_k": 65,
        "repetition_penalty": 1.0,
    }
    effort = (reasoning_effort or "").strip().lower()
    if effort:
        body["reasoning_effort"] = effort
    return body


class WorktualLolaLLM:
    def __init__(
        self,
        *,
        api_key: str = "DUMMY",
        model_name: str,
        base_url: str,
        temperature: float = 0.1,
        max_tokens: int = 8192,
        reasoning_effort: str = "low",
    ) -> None:
        self.client = OpenAI(api_key=api_key or "DUMMY", base_url=base_url)
        self.model_name = model_name
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.reasoning_effort = reasoning_effort

    def run(self, messages: list[dict], tools: list[dict]) -> dict:
        try:
            kwargs: dict = {
                "model": self.model_name,
                "messages": messages,
                "max_tokens": self.max_tokens,
                "temperature": self.temperature,
                "presence_penalty": 0.0,
                "stream": False,
                "extra_body": build_worktual_llm_extra_body(
                    reasoning_effort=self.reasoning_effort,
                ),
                "reasoning_effort":"low",
            }
            if tools:
                kwargs["tools"] = tools
            resp = self.client.chat.completions.create(**kwargs).model_dump()
            message = resp["choices"][0]["message"]
            return {
                "content": message.get("content"),
                "tool_calls": message.get("tool_calls"),
                "reasoning": message.get("reasoning"),
            }
        except Exception as exc:
            return {"content": None, "tool_calls": None, "reasoning": None, "error": str(exc)}


@lru_cache
def get_worktual_llm() -> WorktualLolaLLM:
    settings = get_settings()
    base_url = (
        settings.custom_lola_worktual_llm_base_url
        or settings.sentiment_llm_base_url
    )
    model = (
        settings.custom_lola_worktual_llm_model
        or settings.sentiment_llm_model
    )
    api_key = (
        settings.custom_lola_worktual_llm_api_key
        or settings.sentiment_llm_api_key
        or "DUMMY"
    )
    return WorktualLolaLLM(
        api_key=api_key,
        model_name=model,
        base_url=base_url,
        max_tokens=settings.custom_lola_worktual_llm_max_tokens,
        reasoning_effort=settings.custom_lola_worktual_llm_reasoning_effort,
    )


def compose_contact_enrichment_reply(
    *,
    customer_message: str,
    draft_reply: str,
    tool_result: dict[str, Any],
) -> str:
    """Let Gemma ground the customer reply in the enrichment result."""
    response = get_worktual_llm().run(
        messages=[
            {
                "role": "system",
                "content": (
                    "You are Lola, Worktual's customer assistant. Rewrite the draft "
                    "so it answers the customer. Mention a contact field only when it "
                    "is in appliedFields. If appliedFields is empty, do not say you "
                    "saved, changed, or failed to change their name, email, or phone. "
                    "If a skipped field reason is identity_owned_by_other_contact, say "
                    "that value already belongs to another contact and was not changed. "
                    "If they asked whether you remember them, answer that from the draft. "
                    "If the tool failed, do not claim anything was saved. Never expose "
                    "JSON, internal IDs, tool names, or field implementation details. "
                    "Return concise plain text only, without HTML or markdown."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Customer message:\n{customer_message}\n\n"
                    f"Draft reply:\n{draft_reply}\n\n"
                    "Contact enrichment result:\n"
                    f"{json.dumps(tool_result, default=str)}"
                ),
            },
        ],
        tools=[],
    )
    content = response.get("content") if isinstance(response, dict) else None
    return str(content).strip() if content else draft_reply
