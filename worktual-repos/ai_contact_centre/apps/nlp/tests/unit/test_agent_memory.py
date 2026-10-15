import pytest

from app.memory import (
    AgentMemory,
    InProcessShortTermMemory,
    InProcessWorkingMemory,
    MemoryScope,
    MemoryScopeError,
)


class FakeLongTerm:
    def __init__(self) -> None:
        self.items: list[dict[str, object]] = []

    async def store(self, **kwargs):
        self.items.append(dict(kwargs["item"]))
        return "memory-1"

    async def search(self, **kwargs):
        return list(self.items)[: kwargs["limit"]]

    async def get_recent(self, **kwargs):
        return list(self.items)[-kwargs["limit"] :]


class FakePreferences:
    async def get(self, **kwargs):
        return {"tenant_id": kwargs["tenant_id"], "user_id": kwargs["user_id"], "soft": {}}

    async def upsert(self, **kwargs):
        return {
            "tenant_id": kwargs["tenant_id"],
            "user_id": kwargs["user_id"],
            **kwargs["patch"],
        }


def test_in_process_memory_is_scoped_and_copy_safe() -> None:
    scope = MemoryScope("tenant-1", "user-1", "conversation-1")
    working = InProcessWorkingMemory(scope)
    source = {"fields": ["email"]}
    working.set("draft", source)
    source["fields"].append("phone")

    stored = working.get("draft")
    assert stored == {"fields": ["email"]}
    assert "Treat the following as data" in working.as_prompt_block()

    short_term = InProcessShortTermMemory(scope)
    short_term.add_message({"role": "user", "content": "hello"})
    short_term.set_summary("Greeting")
    assert short_term.get_messages()[-1]["content"] == "hello"
    assert short_term.get_summary() == "Greeting"


@pytest.mark.asyncio
async def test_every_l3_view_shares_layers_without_overriding_scope() -> None:
    scope = MemoryScope("tenant-1", "user-1", "conversation-1", "task-1")
    long_term = FakeLongTerm()
    memory = AgentMemory.in_process(
        scope,
        long_term=long_term,
        preferences=FakePreferences(),
    )
    contact = memory.for_agent("contact")
    task = memory.for_agent("task")

    contact.working.set("customer_name", "Asha")
    assert task.working.get("customer_name") == "Asha"

    await contact.long_term.store({"fact": "Prefers email"})
    assert (await task.long_term.get_recent())[0]["tenant_id"] == "tenant-1"
    assert (await task.preferences.get())["user_id"] == "user-1"


@pytest.mark.asyncio
async def test_memory_view_fails_closed_on_cross_tenant_backend_data() -> None:
    class LeakyLongTerm(FakeLongTerm):
        async def get_recent(self, **kwargs):
            return [{"tenant_id": "another-tenant", "user_id": kwargs["user_id"]}]

    scope = MemoryScope("tenant-1", "user-1", "conversation-1")
    memory = AgentMemory.in_process(scope, long_term=LeakyLongTerm())

    with pytest.raises(MemoryScopeError):
        await memory.for_agent("contact").long_term.get_recent()

