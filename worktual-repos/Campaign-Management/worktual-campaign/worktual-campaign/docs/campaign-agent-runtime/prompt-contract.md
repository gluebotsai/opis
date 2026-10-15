# Prompt contract (mandatory)

Every interactive agent builds its system message with **six sections in this order**:

```text
Role
Goal
Instructions
Context
Output
Guardrails
```

Shared helper: `agents/app/prompt_sections.py` → `sectioned_system_prompt(...)`.

---

## Section definitions

### Role
Who the agent is (module-scoped). One short paragraph. No tool lists here.

### Goal
What success looks like for this turn / module (e.g. “help the user create and launch a campaign with accurate state”).

### Instructions
**Detailed, model-readable rules** for:

1. **When to call each tool** — triggers from meaning (not keyword lists alone).
2. **What to collect from the user** — required fields, optional fields, order flexibility.
3. **When to clarify** — ask ONE question if intent or a required field is ambiguous.
4. **Field mapping** — map free-text into tool arguments (e.g. “web push only” → `channels: ["web"]`).
5. **Out-of-order input** — accept whatever the user provided; update tools; then ask for the next missing piece.
6. **Cross-module routing** — when to call `ROUTE_TO_MODULE` / hub destinations.

Instructions are **stable prose** the model understands. Do not encode user-intent as Python regex.

### Context (dynamic — rebuilt every turn)
Inject live state only, for example:

- Session snapshot (meta, audience count, channels, templates, launch flags)
- Org filterable fields / available channels
- Audience segmentation counts
- Focus entity (contact, campaign, thread, form)
- Draft / missing_fields
- Open asks / pending confirmations

The model must prefer Context over guessing. Never invent counts that conflict with Context.

### Output
How to speak: length, plain text (no Markdown `**`), one question at a time, never name tools/LLM.

### Guardrails
Hard limits: no false launch/send claims, person name ≠ campaign title, no inventing CRM data, etc.

---

## Dynamic vs static

| Allowed | Forbidden |
|---------|-----------|
| Building Context from session each turn | Regex deciding which tool to run before LLM |
| Conditional **Instruction appendices** from state (e.g. “audience already set — do not re-ask who”) | Heuristic as primary agent answer when LLM is up |
| Tool handlers validating args / calling APIs | Inferring tool args in Python instead of LLM |
| Formatting tool `message` for chat | Showing internal `change_summary` / legacy tool names |

Offline only: if LLM unavailable → short unavailable reply (labeled heuristic if you add `source`).

---

## Builder pattern

```python
from app.prompt_sections import sectioned_system_prompt

def build_system_prompt(session: dict, org: dict | None = None) -> str:
    return sectioned_system_prompt(
        role="...",
        goal="...",
        instructions=INSTRUCTIONS,          # detailed tool/clarify/mapping prose
        context=build_context_block(session, org),  # dynamic JSON / bullets
        output="...",
        guardrails="...",
    )
```

Industry packs (B2B/B2C) may append short Instruction/Guardrail fragments after the base sections.
