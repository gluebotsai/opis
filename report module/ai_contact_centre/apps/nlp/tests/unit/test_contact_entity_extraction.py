import pytest

from app.schemas.bot import ContactEntities
from app.services.contact_entity_extraction import extract_contact_entities_llm


class SanthoshLLM:
    model = "test-model"

    async def json(self, messages: list[dict[str, str]]) -> dict[str, object]:
        text = str(messages[-1]["content"])
        assert "Santhosh" in text or "santhosh@example.com" in text
        return {
            "contact_entities": {
                "email": "santhosh@example.com",
                "phone": None,
                "first_name": "Santhosh",
                "last_name": None,
                "company": None,
                "city": None,
                "country": None,
            }
        }


class LastNameLLM:
    model = "test-model"
    calls = 0

    async def json(self, messages: list[dict[str, str]]) -> dict[str, object]:
        self.calls += 1
        text = str(messages[-1]["content"])
        assert "sivakumar" in text.lower()
        assert "Bharathi" in text
        return {
            "contact_entities": {
                "email": None,
                "phone": None,
                "first_name": None,
                "last_name": "Sivakumar",
                "company": None,
                "city": None,
                "country": None,
            }
        }

    async def complete(self, messages: list[dict[str, str]], tools=None):
        raise AssertionError("complete should not be used when json succeeds")


class ExplicitSplitLLM:
    model = "test-model"

    async def json(self, messages: list[dict[str, str]]) -> dict[str, object]:
        return {
            "contact_entities": {
                "email": None,
                "phone": None,
                "first_name": "Bharathi",
                "last_name": "S",
                "company": None,
                "city": None,
                "country": None,
            }
        }


@pytest.mark.asyncio
async def test_extract_last_name_only_from_message() -> None:
    llm = LastNameLLM()
    entities = await extract_contact_entities_llm(
        llm,
        "my last name is sivakumar",
        transcript=[
            {"role": "user", "content": "Hi, I'm Bharathi"},
            {"role": "assistant", "content": "Hello Bharathi, how can I help?"},
        ],
        channel="whatsapp",
    )
    assert entities.first_name is None
    assert entities.last_name == "Sivakumar"
    assert llm.calls == 1


@pytest.mark.asyncio
async def test_extract_explicit_first_and_last_name_split() -> None:
    entities = await extract_contact_entities_llm(
        ExplicitSplitLLM(),
        "Bharathi is first name and S is last name",
        channel="whatsapp",
    )
    assert entities.first_name == "Bharathi"
    assert entities.last_name == "S"


@pytest.mark.asyncio
async def test_extract_santhosh_contact_entities_from_bot_message() -> None:
    entities = await extract_contact_entities_llm(
        SanthoshLLM(),
        "Hi, I'm Santhosh and my email is santhosh@example.com",
        channel="webchat",
    )
    assert entities == ContactEntities(
        email="santhosh@example.com",
        phone=None,
        first_name="Santhosh",
        last_name=None,
        display_name=None,
        company=None,
        city=None,
        country=None,
    )
