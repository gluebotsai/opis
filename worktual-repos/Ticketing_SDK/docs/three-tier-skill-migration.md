# Three-tier harness and Skills

Build chat as **Super → Domain → Executor**. Put each business procedure in a **Skill**. The Executor loads that Skill and calls its tools. Super routes. Domain picks the Skill. The API writes the database.

A Skill is a procedure file plus a tool allowlist. It is not an agent and not a router.

## One turn

1. The client sends the user utterance and trusted actor context: organization, user, role, surface.
2. Super calls exactly one control.
3. Domain calls `delegate_to_executor` once.
4. The Executor loads that Skill, collects fields, and calls tools.
5. Code checks schema, role, and tenant. The API writes. The database is the source of truth. The Executor replies from the tool result.

```text
utterance
  → Super: continue | route | resume | refuse
  → Domain: delegate_to_executor(executor, task, skill)
  → Executor: Skill body + allowlisted tools
  → schema / RBAC / tenant
  → API → database
  → tool result → Executor reply
```

| Layer | Does | Does not |
|---|---|---|
| Super | Continue the pinned task, route to a Domain, resume a parked task, or refuse | Collect fields, confirm writes, call business tools, own Skills |
| Domain | Pick Executor + task id + Skill in one call | Call business tools, collect slots, answer the user with a finished write |
| Executor | Load the Skill, patch the draft, call tools, reply from the tool result | Route to a Domain, widen its tool allowlist |
| Tool code | Types, confirm gates, role headers | Decide what the user meant |
| API | RBAC, validation, mutations | Let the model write SQL |
| Database | Source of truth for existing rows | Accept invented ids |

## Remove before you add layers

Take these off the request path:

- Keyword, regex, or phrase tables that choose an agent, a tool, a field, or consent.
- One agent that both routes and writes.
- A graph whose edges are intent labels.
- Fixed chat sentences returned as the assistant bubble. The Executor model writes the reply. A static string may be a hint inside the prompt.
- Any path where the model writes the database.

Keep schema checks, role checks, tenant checks, payload limits, and confirm gates in code. They run after the model selects a tool.

## Folders

```text
agents/definitions/
  product_super_agent/agent.md
  orders_domain/agent.md
  order_creation_executor/agent.md
skills/
  order-create/SKILL.md
app/contracts/execution.py
app/skills/catalog.py
app/tasks/compile.py
app/mcp/delegate.py
app/mcp/authorization.py
app/runtime/turn.py
```

One agent is one `agent.md`. One Skill is one directory `skills/<name>/SKILL.md`. The directory name equals the `name` in the file.

## Contracts

```python
from typing import Any, Literal
from pydantic import BaseModel, Field, model_validator

AgentLayer = Literal["super", "domain", "executor"]
ApprovalMode = Literal[
    "none",
    "interactive_semantic",
    "channel_dependent",
]
TaskStatus = Literal[
    "pending",
    "collecting",
    "awaiting_confirmation",
    "executing",
    "completed",
    "cancelled",
    "refused",
    "failed",
    "parked",
]

class AgentDefinition(BaseModel):
    id: str
    version: str = "1.0.0"
    layer: AgentLayer
    description: str = ""
    prompt_path: str
    prompt: str
    skills: list[str] = Field(default_factory=list)
    mcp_servers: list[str] = Field(default_factory=list)
    handoff_targets: list[str] = Field(default_factory=list)
    local_controls: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def layer_boundary(self) -> "AgentDefinition":
        if self.layer in {"super", "domain"} and self.mcp_servers:
            raise ValueError(f"{self.layer} agents cannot declare business MCP servers")
        if self.layer == "super" and self.skills:
            raise ValueError("super agents cannot declare business Skills")
        return self


class SkillDependency(BaseModel):
    name: str
    version: str = "1.0.0"


class SkillDefinition(BaseModel):
    name: str
    version: str = "1.0.0"
    description: str
    path: str
    content_digest: str
    domain: str
    eligible_executors: list[str]
    task_ids: list[str]
    schema_ref: str | None = None
    approval_policy: ApprovalMode = "none"
    dependencies: list[SkillDependency] = Field(default_factory=list)
    allowed_tools: list[str]
    local_controls: list[str]
    output_contract: str = "executor-result-v1"
    active: bool = True
    body: str | None = None  # filled only when this Skill is selected


class TaskDefinition(BaseModel):
    id: str
    version: str = "1.0.0"
    domain: str
    executor: str
    skill_name: str
    schema_ref: str | None = None
    tool_names: list[str]
    required: list[str] = Field(default_factory=list)
    optional: list[str] = Field(default_factory=list)
    approval_mode: ApprovalMode = "none"
    active: bool = True


class TaskState(BaseModel):
    task_id: str
    domain: str
    executor: str
    skill_name: str
    skill_version: str
    skill_digest: str
    status: TaskStatus = "pending"
    collected: dict[str, Any] = Field(default_factory=dict)


class DomainInstruction(BaseModel):
    executor_id: str
    task_id: str
    skill_name: str
    objective: str
    supplied_fields: dict[str, Any] = Field(default_factory=dict)
```

## agent.md sections

Every manifest uses the same headings. The loader splits on `## ` and reads bullet lists under `skills`, `allowed MCP servers`, `local controls`, and `handoff targets`.

Required headings:

- runtime metadata (`version`, `layer`, `execution_mode: llm`)
- role
- goal
- instructions
- context
- skills
- guardrails
- input/output contract
- allowed MCP servers
- local controls
- handoff targets
- memory policy

### Super — `agents/definitions/product_super_agent/agent.md`

```markdown
# product_super_agent

## runtime metadata
- version: 1.0.0
- layer: super
- execution_mode: llm

## role
Routing agent. Each turn, call exactly one control.

## goal
Route, continue, resume, or refuse.

## instructions
Use the meaning of the utterance. Read role only from trusted actor context.

Call exactly one control:
1. They mean a listed parked task → resume_task with that task_id. Do not ask again for fields already stored.
2. Their role cannot perform that operation → refuse_capability.
3. A collecting pin is open and this utterance answers its missing field, corrects an unsaved draft value, confirms the recap, or asks for more rows of the same list → continue_active_task.
4. Otherwise → route_to_domain with the Domain that owns the work, and park the current pin when the Skill would change.

Do not collect fields. Do not confirm writes. Do not call business tools. Do not invent ids or names.

## context
The API and the database are the authority for existing rows.

## skills
- none

## guardrails
- Never claim a write succeeded.
- Never answer a business question that belongs to an Executor.

## input/output contract
### input
Trusted actor, live TaskState, parked tasks, recent turns.
### output
One of resume_task, refuse_capability, continue_active_task, route_to_domain.

## allowed MCP servers
- none

## local controls
- continue_active_task
- route_to_domain
- resume_task
- refuse_capability

## handoff targets
- orders_domain

## memory policy
### working
Routing only. Field values belong to the Executor draft.
### short-term
Recent turns so continue versus new route stays coherent.
```

Super tool schemas:

```json
{
  "route_to_domain": {
    "required": ["domain_id", "query"],
    "properties": {
      "domain_id": { "enum": ["orders_domain"] },
      "query": { "type": "string" }
    }
  },
  "continue_active_task": {
    "required": ["task_id"],
    "properties": { "task_id": { "type": "string" } }
  },
  "resume_task": {
    "required": ["task_id"],
    "properties": { "task_id": { "type": "string" } }
  },
  "refuse_capability": {
    "required": ["reason"],
    "properties": {
      "reason": {
        "enum": ["forbidden", "unsupported_operation", "unsupported_product"]
      }
    }
  }
}
```

`route_to_domain.domain_id` is the Super handoff list. Add a Domain there when you add its manifest.

### Domain — `agents/definitions/orders_domain/agent.md`

```markdown
# orders_domain

## runtime metadata
- version: 1.0.0
- layer: domain
- execution_mode: llm

## role
Plan one Executor, one task, and one Skill for this hop.

## goal
Call delegate_to_executor once. Do not collect fields.

## instructions
File a new order → delegate_to_executor with:
- executor_id: order_creation_executor
- task_id: order.create
- skill_name: order-create
Put facts already stated in the conversation into supplied_fields.
Put the hop objective in objective.

If this utterance belongs to another Domain, call return_to_super with action=park.

## context
The API and the database are the authority for existing rows.

## skills
- order-create

## guardrails
- Never call verify_customer, create_order, or list_orders.
- Never tell the user the order is saved.

## input/output contract
### input
Super query, trusted actor, live TaskState.
### output
delegate_to_executor, return_to_super, or refuse_capability.

## allowed MCP servers
- none

## local controls
- delegate_to_executor
- return_to_super
- refuse_capability

## handoff targets
- order_creation_executor

## memory policy
### working
Delegated executor, task id, and skill name. Draft fields belong to the Executor.
### short-term
Recent turns for this plan.
```

`delegate_to_executor` schema. Build the enums at startup from manifests, not from a handwritten list in the model prompt.

```python
def delegate_to_executor_tool(domain_id: str) -> dict:
    executors = executors_for_domain(domain_id)  # handoff targets that are Executors
    skills = sorted({
        skill.name
        for executor in executors
        for skill in skills_for_executor(executor)
        if skill.active
    })
    return {
        "name": "delegate_to_executor",
        "description": (
            "Select the registered Executor, task id, and Skill that own this operation. "
            "The triple must match the task registry."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "executor_id": {"type": "string", "enum": executors},
                "task_id": {"type": "string"},
                "skill_name": {"type": "string", "enum": skills},
                "objective": {"type": "string"},
                "supplied_fields": {"type": "object"},
            },
            "required": ["executor_id", "task_id", "skill_name", "objective"],
        },
    }
```

Accept the call only when a `TaskDefinition` exists with that `id`, `domain`, `executor`, and `skill_name`.

### Executor — `agents/definitions/order_creation_executor/agent.md`

```markdown
# order_creation_executor

## runtime metadata
- version: 1.0.0
- layer: executor
- execution_mode: llm

## role
Run the selected Skill. Collect required fields. Call only allowlisted tools.

## goal
Keep the draft accurate. Reply only from this turn's tool result.

## instructions
- Ask one missing field at a time.
- Every field change goes through patch_order_draft.
- Judge consent from this utterance and the recap, then call the write tool with confirmed=true.
- Quote ids and names only from this turn's tool result.
- A how-to or a different job mid-draft → return_to_super with action=park.

## context
The selected Skill body is appended at runtime. Follow that procedure.

## skills
- order-create

## guardrails
- Never invent tenant, actor, customer, or order ids.
- Never claim a write succeeded unless the tool result says success and includes the id you quote.

## input/output contract
### input
Domain instruction, Skill body, draft, trusted actor.
### output
A tool call or a short reply grounded in the tool result.

## allowed MCP servers
- product

## local controls
- return_to_super
- patch_order_draft

## handoff targets
- none

## memory policy
### working
order_draft and the open slot. Clear or restore with TaskState.
### short-term
Recent turns for this Skill.
```

The Executor's business tools are the MCP tools named on its Skills. Local controls (`patch_order_draft`, `return_to_super`) stay on the Executor. A Skill may use a local control only when the Executor already lists it.

## Skill file — `skills/order-create/SKILL.md`

```markdown
---
name: order-create
description: Collect customer and line items, confirm, and create one order.
license: Proprietary
compatibility: Three-layer harness with the product MCP server
metadata:
  version: "1.0.0"
  domain: "orders_domain"
  executors: "order_creation_executor"
  task-ids: "order.create"
  schema-ref: "create_order"
  approval-policy: "channel_dependent"
  dependencies: ""
  local-controls: "patch_order_draft"
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: verify_customer list_orders create_order
---

# Purpose

Create one order for a known customer after the required fields are on the draft and the user agrees.

# When to use

Task `order.create`, Skill `order-create`, Executor `order_creation_executor`.

# Required information

1. customerName
2. contact (email or phone)
3. Directory verification via verify_customer
4. lines (what they are ordering)
5. Consent after a recap → create_order with confirmed=true

# Procedure

1. Read the live draft. Ask the first missing field. Call patch_order_draft with the value they just gave.
2. After name and contact are on the draft, call verify_customer. On a miss, stop. Do not create a customer in this Skill.
3. When lines are complete, call list_orders for that customer. If a listed row is the same open order, do not create another. Tell them that order id from the tool result.
4. Recap name, contact, and lines. Ask whether to place the order.
5. When this utterance means they agree, call create_order with confirmed=true before you reply. Quote the order id only from that tool result.

# Working memory rules

- customerDirectoryStatus=verified means contact is done.
- A contact change clears verification. Verify again before create.

# Validation requirements

- Never invent tenant, customer, or tool-result data.
- Call the write tool at most once this turn.
- Stay inside the Skill allowlist.
```

Frontmatter rules:

| Key | Rule |
|---|---|
| `name` | Matches the directory. Pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$` |
| `description` | Required. At most 1024 characters |
| `metadata.domain` | A Domain agent id |
| `metadata.executors` | Comma-separated Executor ids. A task Skill lists one |
| `metadata.task-ids` | Comma-separated task ids. Each id is unique across all Skills |
| `metadata.schema-ref` | Workflow schema id for required and optional fields |
| `metadata.dependencies` | `other-skill@1.0.0`, comma-separated, or empty |
| `metadata.local-controls` | Comma-separated. Each one is already on the Executor |
| `metadata.status` | `active` or omit. Anything else is inactive |
| `allowed-tools` | Space-separated tool names. Subset of that Executor's tools |
| Body | At most 500 lines in the whole file |

Workflow schema keyed by `schema-ref`:

```python
SCHEMAS = {
    "create_order": {
        "required": ["customerName", "contact", "lines"],
        "optional": ["note"],
    }
}
```

The write tool checks this schema before the API call. Missing required fields return `missing: [...]`. The Executor patches those fields. The model does not invent them.

## Catalog

Implement this module. It is the whole discovery and validation step.

```python
import hashlib
import re
from functools import lru_cache
from pathlib import Path

SKILLS_ROOT = Path(__file__).resolve().parent.parent / "skills"
NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def parse_frontmatter(text: str) -> tuple[dict, str]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise ValueError("SKILL.md must begin with YAML frontmatter")
    close = next(i for i, line in enumerate(lines[1:], 1) if line.strip() == "---")
    data: dict = {}
    current = None
    for line in lines[1:close]:
        if not line.strip():
            continue
        if line.startswith((" ", "\t")):
            key, _, value = line.strip().partition(":")
            current[key.strip()] = value.strip().strip("'\"")
            continue
        key, sep, value = line.partition(":")
        if not sep:
            raise ValueError(f"invalid frontmatter line: {line}")
        if not value.strip():
            current = {}
            data[key.strip()] = current
        else:
            data[key.strip()] = value.strip().strip("'\"")
            current = None
    body = "\n".join(lines[close + 1 :]).strip()
    return data, body


def parse_skill(path: Path, *, include_body: bool) -> SkillDefinition:
    text = path.read_text(encoding="utf-8")
    if len(text.splitlines()) > 500:
        raise ValueError(f"SKILL.md exceeds 500 lines: {path.parent.name}")
    header, body = parse_frontmatter(text)
    name = str(header.get("name") or "").strip()
    description = str(header.get("description") or "").strip()
    if not NAME_RE.fullmatch(name) or name != path.parent.name:
        raise ValueError(f"Skill name must match directory: {path}")
    if not description or len(description) > 1024:
        raise ValueError(f"Skill description missing or too long: {name}")
    metadata = header.get("metadata") or {}
    allowed = str(header.get("allowed-tools") or "").split()
    deps = []
    for item in str(metadata.get("dependencies") or "").split(","):
        item = item.strip()
        if not item:
            continue
        dep_name, sep, version = item.partition("@")
        deps.append(SkillDependency(name=dep_name, version=version if sep else "1.0.0"))
    return SkillDefinition(
        name=name,
        version=str(metadata.get("version") or "1.0.0"),
        description=description,
        path=str(path),
        content_digest=hashlib.sha256(text.encode()).hexdigest(),
        domain=str(metadata.get("domain") or ""),
        eligible_executors=[x.strip() for x in str(metadata.get("executors") or "").split(",") if x.strip()],
        task_ids=[x.strip() for x in str(metadata.get("task-ids") or "").split(",") if x.strip()],
        schema_ref=str(metadata.get("schema-ref") or "") or None,
        approval_policy=str(metadata.get("approval-policy") or "none"),
        dependencies=deps,
        allowed_tools=allowed,
        local_controls=[x.strip() for x in str(metadata.get("local-controls") or "").split(",") if x.strip()],
        active=str(metadata.get("status") or "active").strip().lower() == "active",
        body=body if include_body else None,
    )


@lru_cache
def discover_skills() -> dict[str, SkillDefinition]:
    skills = {}
    for path in sorted(SKILLS_ROOT.glob("*/SKILL.md")):
        skill = parse_skill(path, include_body=False)
        if skill.name in skills:
            raise ValueError(f"duplicate Skill name: {skill.name}")
        skills[skill.name] = skill
    validate_skills(skills)
    return skills


def validate_skills(skills: dict[str, SkillDefinition]) -> None:
    agents = load_agent_definitions()
    for skill in skills.values():
        domain = agents.get(skill.domain)
        if not domain or domain.layer != "domain":
            raise ValueError(f"{skill.name} has unknown Domain: {skill.domain}")
        for executor_id in skill.eligible_executors:
            executor = agents.get(executor_id)
            if not executor or executor.layer != "executor":
                raise ValueError(f"{skill.name} has unknown Executor: {executor_id}")
            if skill.name not in executor.skills:
                raise ValueError(f"{executor_id} does not declare Skill {skill.name}")
            extra_controls = set(skill.local_controls) - set(executor.local_controls)
            if extra_controls:
                raise ValueError(f"{skill.name} uses controls absent from {executor_id}: {sorted(extra_controls)}")
            if skill.active:
                extra_tools = set(skill.allowed_tools) - set(tools_for_executor(executor_id))
                if extra_tools:
                    raise ValueError(f"{skill.name} exceeds {executor_id} tools: {sorted(extra_tools)}")
        unknown_deps = {d.name for d in skill.dependencies if d.name not in skills}
        if unknown_deps:
            raise ValueError(f"{skill.name} has unknown dependencies: {sorted(unknown_deps)}")
    # Reject dependency cycles with a depth-first visit set.
    visiting, visited = set(), set()

    def visit(name: str) -> None:
        if name in visiting:
            raise ValueError(f"Skill dependency cycle at {name}")
        if name in visited:
            return
        visiting.add(name)
        for dep in skills[name].dependencies:
            visit(dep.name)
        visiting.remove(name)
        visited.add(name)

    for name in skills:
        visit(name)


@lru_cache
def load_skill_definition(name: str) -> SkillDefinition:
    metadata = discover_skills().get(name)
    if not metadata:
        raise ValueError(f"unknown Skill: {name}")
    loaded = parse_skill(Path(metadata.path), include_body=True)
    if loaded.content_digest != metadata.content_digest:
        discover_skills.cache_clear()
        raise ValueError(f"Skill changed after discovery: {name}")
    return loaded


def skills_for_executor(executor_id: str) -> list[SkillDefinition]:
    return sorted(
        (s for s in discover_skills().values() if executor_id in s.eligible_executors and s.active),
        key=lambda s: s.name,
    )


def tools_for_skill(skill_id: str, executor_id: str) -> frozenset[str]:
    skill = discover_skills().get(skill_id)
    if not skill or not skill.active or executor_id not in skill.eligible_executors:
        return frozenset()
    return frozenset(set(skill.allowed_tools) & set(tools_for_executor(executor_id)))
```

`tools_for_executor(executor_id)` is your registry: the MCP tool names that Executor is allowed to call. A Skill cannot add a name that is absent there.

Startup calls `discover_skills()` and `compile_tasks()`. A validation error stops the process.

## Task compilation

```python
def compile_tasks() -> dict[str, TaskDefinition]:
    tasks: dict[str, TaskDefinition] = {}
    for skill in discover_skills().values():
        if len(skill.eligible_executors) != 1:
            raise ValueError(f"task Skill must have one Executor: {skill.name}")
        schema = SCHEMAS.get(skill.schema_ref or "", {})
        for task_id in skill.task_ids:
            if task_id in tasks:
                raise ValueError(f"duplicate task id: {task_id}")
            tasks[task_id] = TaskDefinition(
                id=task_id,
                version=skill.version,
                domain=skill.domain,
                executor=skill.eligible_executors[0],
                skill_name=skill.name,
                schema_ref=skill.schema_ref,
                tool_names=list(skill.allowed_tools),
                required=list(schema.get("required") or []),
                optional=list(schema.get("optional") or []),
                approval_mode=skill.approval_policy,
                active=skill.active,
            )
    return tasks
```

There is no separate task registry file. The Skill frontmatter is the registry.

## Tool token

When the Executor hop starts, mint a token for this actor and this Skill:

```python
def issue_executor_token(*, actor, executor_id, task, skill) -> str:
    allowed = sorted(tools_for_skill(skill.name, executor_id))
    return sign({
        "organization_id": actor.organization_id,
        "actor_id": actor.user_id,
        "role": actor.user_role,
        "agent_id": executor_id,
        "task_id": task.id,
        "skill_name": skill.name,
        "skill_version": skill.version,
        "allowed_tools": allowed,
    })


def authorize(tool_name: str, *, executor_id: str, claims: dict) -> None:
    if claims.get("agent_id") != executor_id:
        raise PermissionError("token agent mismatch")
    allowed = set(tools_for_executor(executor_id))
    allowed &= set(claims.get("allowed_tools") or [])
    allowed &= set(tools_for_skill(claims["skill_name"], executor_id))
    task = compile_tasks().get(claims["task_id"])
    if (
        not task
        or task.executor != executor_id
        or task.skill_name != claims["skill_name"]
    ):
        raise PermissionError("token task/Skill mismatch")
    if tool_name not in allowed:
        raise PermissionError(f"{tool_name} is outside this Skill")
```

The model never sends organization id or user id. The token carries them. An unknown Skill, the wrong Executor, or an inactive Skill produces an empty allowlist, so every business tool call fails.

Write tools:

- Require `confirmed=true` only after the Executor has judged that this utterance agrees to the recap.
- For an existing row, require a numeric id that a list or get tool returned earlier in this task. Reject placeholders.

## Runtime

```python
def run_turn(query: str, actor, memory) -> str:
    pin = memory.current_task_state()
    super_call = llm_tool(
        agent="product_super_agent",
        tools=[continue_active_task, route_to_domain, resume_task, refuse_capability],
        context={"query": query, "pin": pin, "parked": memory.parked, "role": actor.user_role},
    )

    if super_call.name == "refuse_capability":
        return phrase_refusal(super_call.arguments["reason"])
    if super_call.name == "resume_task":
        memory.activate(super_call.arguments["task_id"])
        pin = memory.current_task_state()
        domain_id = pin.domain
    elif super_call.name == "continue_active_task":
        domain_id = pin.domain
    else:
        if pin and pin.status == "collecting":
            memory.park(pin)
        domain_id = super_call.arguments["domain_id"]

    domain_call = llm_tool(
        agent=domain_id,
        tools=[delegate_to_executor_tool(domain_id), return_to_super, refuse_capability],
        context={"query": query, "pin": memory.current_task_state()},
    )
    if domain_call.name != "delegate_to_executor":
        return run_turn(query, actor, memory)  # park path returns to Super once

    instruction = DomainInstruction(**domain_call.arguments)
    task = compile_tasks()[instruction.task_id]
    if (
        task.domain != domain_id
        or task.executor != instruction.executor_id
        or task.skill_name != instruction.skill_name
        or not task.active
    ):
        raise ValueError("delegation does not match the registered task")

    skill = load_skill_definition(task.skill_name)
    token = issue_executor_token(
        actor=actor, executor_id=task.executor, task=task, skill=skill
    )
    system = assemble_executor_prompt(
        executor_id=task.executor,
        skill=skill,
        actor=actor,
        memory=memory,
    )
    reply, tool_calls = llm_with_tools(
        system=system,
        tools=tool_schemas(token),
        query=query,
    )
    for call in tool_calls:
        if call.name in {"patch_order_draft", "return_to_super"}:
            apply_local_control(call, memory)
            continue
        authorize(call.name, executor_id=task.executor, claims=decode(token))
        result = api_call(call.name, call.arguments, actor=actor)
        memory.record_tool_result(result)
    memory.set_task_state(TaskState(
        task_id=task.id,
        domain=task.domain,
        executor=task.executor,
        skill_name=skill.name,
        skill_version=skill.version,
        skill_digest=skill.content_digest,
        status="collecting",
        collected=memory.draft,
    ))
    return reply
```

Prompt assembly for that Executor hop:

```python
def assemble_executor_prompt(*, executor_id, skill, actor, memory) -> str:
    executor = load_agent_definitions()[executor_id]
    dependencies = [
        {"name": dep.name, "instructions": load_skill_definition(dep.name).body}
        for dep in skill.dependencies
    ]
    return "\n\n".join([
        executor.prompt,
        "## Selected Skill\n" + (skill.body or ""),
        "## Skill dependencies\n" + json.dumps(dependencies),
        "## Trusted runtime context\n" + json.dumps({
            "actor_role": actor.user_role,
            "organization_id": actor.organization_id,
        }),
        memory.blocks(),  # working draft, short-term turns, long-term snippets, soft preferences
    ])
```

Super and Domain receive their own `agent.md` plus trusted context. They do not receive business tool schemas.

## Memory

| Store | Holds | Written by |
|---|---|---|
| Working draft | Fields and the open slot (`order_draft`) | `patch_*_draft` |
| TaskState | task id, domain, executor, skill name, version, digest, status, collected fields | Runtime at the end of the hop |
| Short-term | This session's turns | Runtime |
| Long-term | Past sessions, retrieved into the prompt | Memory service |
| Preferences | Soft tone in the prompt; hard rules checked by tools | Model via preference tools |

Status moves `collecting` → `awaiting_confirmation` → `executing` → `completed`. A different Skill sets the current state to `parked` and starts a new one. Resume loads the parked state and does not ask for fields already in `collected`.

After a successful write, clear the pin. The next utterance routes again.

List cursors live on durable state: offset, page size, `hasMore`, filters. More rows of the same list stay on that Skill and call the list tool with that offset. The next page still comes from the database.

## Add the next feature the same way

1. Write `agents/definitions/<name>_domain/agent.md` with `layer: domain`, handoff targets set to its Executors, and `delegate_to_executor` as a local control.
2. Write `agents/definitions/<name>_executor/agent.md` with `layer: executor`, the MCP server, and the local controls the Skill will use.
3. Write `skills/<skill-name>/SKILL.md` with `domain`, one `executors` id, one `task-ids` id, `allowed-tools`, and the procedure body.
4. Add the Skill name to that Executor's `## skills` and to that Domain's `## skills`.
5. Add the Domain id to Super's `## handoff targets` and one route sentence in Super's instructions.
6. Register the write and read tools on that Executor only.
7. Add the workflow schema under `schema-ref`.
8. Start the process. `discover_skills()` and `compile_tasks()` must succeed.
9. Walk one utterance through Super → Domain → Executor → tool result → reply.
10. Walk a second utterance that fills the open field. Super continues the same Skill.
11. Walk an utterance that changes the job. Super parks the draft and routes the other Domain. Resume keeps the filled fields.

## Process must fail startup when

- Super lists a Skill or a business MCP server.
- A Skill names a Domain or Executor that does not exist.
- An Executor's `## skills` list omits that Skill.
- A Skill tool is missing from the Executor registry.
- A Skill local control is missing from the Executor.
- Two Skills use the same task id.
- A task Skill names two Executors.
- Skill dependencies cycle.
- The Skill directory name differs from `name`.

## A tool call must fail when

- The tool name is outside the token allowlist.
- The token's Executor, task, or Skill does not match this hop.
- A write runs without `confirmed=true`.
- An update or delete uses an id that no list or get tool returned in this task.

## Done when

- Every utterance is classified by a Super tool call, delegated by a Domain tool call, and executed under one Skill.
- The Skill body enters the Executor prompt only after the delegation matches `compile_tasks()`.
- A write runs only when the Skill allowlist, the Executor registry, and the token all contain that tool.
- The reply quotes the tool result. An empty database produces an empty answer.
- Park and resume keep the same Skill and the same draft.
- The path that chooses Domain, Skill, field, or consent has no regex and no keyword table.
