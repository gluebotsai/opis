import pytest

from app.agents.queue_select import (
    match_queue_key,
    parse_queue_profiles,
    select_queue_key,
    select_queue_with_llm,
    skills_for_queue_key,
)

PROFILES = [
    {"key": "1001", "name": "Support", "skills": ["support"], "intents": ["general_inquiry"]},
    {"key": "1002", "name": "Billing", "skills": ["billing", "payments"], "intents": ["billing"]},
    {"key": "1003", "name": "Sales", "skills": ["sales"], "intents": ["sales"]},
]


def test_select_queue_matches_intent_or_skill() -> None:
    context = {"queue_profiles": PROFILES}
    assert (
        select_queue_key(context, candidate_skills=["billing"], intent="explicit_live_agent")
        == "1002"
    )
    assert select_queue_key(context, candidate_skills=["support_bot"], intent="sales") == "1003"


def test_select_queue_falls_back_to_first_profile() -> None:
    context = {"queue_profiles": PROFILES}
    assert (
        select_queue_key(context, candidate_skills=["support_bot"], intent="explicit_live_agent")
        == "1001"
    )
    assert select_queue_key({}, candidate_skills=["billing"]) is None


def test_match_queue_key_accepts_id_or_exact_name() -> None:
    profiles = parse_queue_profiles(PROFILES)
    assert match_queue_key(profiles, "1002") == "1002"
    assert match_queue_key(profiles, "Billing") == "1002"
    assert match_queue_key(profiles, "unknown") is None
    assert skills_for_queue_key(profiles, "1002") == ["billing", "payments"]


class FakeLLM:
    def __init__(self, payload: dict[str, object] | Exception) -> None:
        self.payload = payload
        self.calls = 0

    async def json(self, _messages: list[dict[str, object]]) -> dict[str, object]:
        self.calls += 1
        if isinstance(self.payload, Exception):
            raise self.payload
        return self.payload


@pytest.mark.asyncio
async def test_llm_queue_pick_uses_exact_name() -> None:
    key, skills = await select_queue_with_llm(
        FakeLLM({"queue_name": "Billing"}),
        PROFILES,
        "I was charged twice",
    )
    assert key == "1002"
    assert skills == ["billing", "payments"]


@pytest.mark.asyncio
async def test_llm_queue_pick_falls_back_to_first_on_garbage() -> None:
    key, skills = await select_queue_with_llm(
        FakeLLM({"queue_name": "Made Up Queue"}),
        PROFILES,
        "hello",
    )
    assert key == "1001"
    assert skills == ["support"]


@pytest.mark.asyncio
async def test_llm_queue_pick_falls_back_to_first_on_error() -> None:
    key, _skills = await select_queue_with_llm(
        FakeLLM(RuntimeError("llm down")),
        PROFILES,
        "hello",
    )
    assert key == "1001"


@pytest.mark.asyncio
async def test_llm_queue_pick_without_profiles_returns_none() -> None:
    key, skills = await select_queue_with_llm(FakeLLM({"queue_name": "Billing"}), [], "hello")
    assert key is None
    assert skills == []
