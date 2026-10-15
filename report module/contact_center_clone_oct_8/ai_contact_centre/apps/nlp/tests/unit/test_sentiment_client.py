from app.llm.sentiment_client import build_sentiment_llm_client
from app.llm.thinking_filter import (
    gemma_thinking_options,
    thinking_options,
    thinking_profile_for_model,
)


def test_sentiment_client_disables_thinking_mode() -> None:
    llm = build_sentiment_llm_client()
    assert llm.provider.config.thinking_mode == "off"
    assert llm.provider.config.thinking_profile == "gemma"


def test_sentiment_client_uses_gemma_enable_thinking_only() -> None:
    llm = build_sentiment_llm_client()
    extra_body = llm.provider._arguments(
        [{"role": "user", "content": "hello"}],
        None,
        stream=False,
    )["extra_body"]
    assert extra_body == {"enable_thinking": False}


def test_gemma_thinking_options_are_boolean_only() -> None:
    assert gemma_thinking_options(enable=False) == {"enable_thinking": False}
    assert gemma_thinking_options(enable=True) == {"enable_thinking": True}


def test_thinking_options_gemma_profile() -> None:
    assert thinking_options("off", profile="gemma") == {"enable_thinking": False}
    assert thinking_options("low", profile="gemma") == {"enable_thinking": True}
    assert thinking_options("true", profile="gemma") == {"enable_thinking": True}


def test_thinking_profile_follows_model_name() -> None:
    assert thinking_profile_for_model("worktual-gemma") == "gemma"
    assert thinking_profile_for_model("worktual-minimax") == "minimax"
    assert thinking_profile_for_model("worktual-glm") == "glm"


def test_thinking_options_minimax_profile_sends_no_extra_body() -> None:
    assert thinking_options("true", profile="minimax") == {}
    assert thinking_options("off", profile="minimax") == {}
    assert thinking_options("true", profile="") == {}


def test_minimax_provider_omits_extra_body() -> None:
    from app.llm.providers import OpenAICompatibleProvider, ProviderConfig

    provider = OpenAICompatibleProvider(
        ProviderConfig(
            name="together",
            api_key="test",
            base_url="http://example.invalid/v1",
            model="worktual-minimax",
            thinking_mode="true",
            thinking_profile="minimax",
        )
    )
    arguments = provider._arguments(
        [{"role": "user", "content": "hello"}],
        None,
        stream=False,
    )
    assert arguments["model"] == "worktual-minimax"
    assert "extra_body" not in arguments
    assert "reasoning_effort" not in arguments


def test_thinking_options_glm_profile_keeps_reasoning_effort() -> None:
    assert thinking_options("low", profile="glm")["reasoning_effort"] == "low"
    assert thinking_options("off", profile="glm")["enable_thinking"] is False
