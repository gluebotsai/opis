# Memory interfaces

Use these shapes when wiring NLP agent memory. Adapt field names to existing NLP models if present, but keep the four-layer split.

## Working memory (in-process)

Current-task scratch state for slot filling.

```python
class WorkingMemory:
    def get(self, key: str) -> object | None: ...
    def set(self, key: str, value: object) -> None: ...
    def update(self, values: dict[str, object]) -> None: ...
    def clear(self) -> None: ...
    def as_prompt_block(self) -> str: ...
```

## Short-term memory (in-process session)

Current session transcript and optional running summary.

```python
class ShortTermMemory:
    def add_message(self, message: dict) -> None: ...
    def get_messages(self, limit: int | None = None) -> list[dict]: ...
    def set_summary(self, summary: str) -> None: ...
    def get_summary(self) -> str | None: ...
    def clear(self) -> None: ...
```

## Long-term memory (Postgres)

Cross-session interaction memory. Access through a service/tools — do not dump full history into the prompt.

```python
class LongTermMemory:
    async def store(self, *, tenant_id: str, user_id: str, conversation_id: str, item: dict) -> str: ...
    async def search(self, *, tenant_id: str, user_id: str, query: str, limit: int = 5) -> list[dict]: ...
    async def get_recent(self, *, tenant_id: str, user_id: str, limit: int = 10) -> list[dict]: ...
```

Store only durable facts/outcomes needed later. Include tenant isolation in every query.

## Preference scratchpad (LLM-written)

User-scoped preferences. The LLM reads/writes via tools.

```python
class PreferenceScratchpad:
    async def get(self, *, tenant_id: str, user_id: str) -> dict: ...
    async def upsert(self, *, tenant_id: str, user_id: str, patch: dict) -> dict: ...
```

### Soft vs hard preferences

| Kind | Example | Enforcement |
|---|---|---|
| Soft | Prefer concise answers; prefer Hindi | Inject into prompt |
| Hard | Do not call after 20:00 local; never SMS | Verification tool must block/allow |

Suggested MCP tools:

- `get_user_preferences`
- `update_user_preference` (key, value, kind=soft|hard)
- `verify_hard_preferences` (proposed_action) → allow | block | approval_required

## Prompt injection order for memory

1. Working memory block (active slots)
2. Short-term summary + recent messages
3. Retrieved long-term snippets
4. Soft preferences
5. Hard preference constraints (informational; tools enforce)
