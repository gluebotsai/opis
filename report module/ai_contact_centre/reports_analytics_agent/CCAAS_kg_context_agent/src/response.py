import json
import re
import time
from dataclasses import dataclass
from typing import Callable, Optional
from pydantic import BaseModel

@dataclass
class ActivityEvent:
    step_id: str
    status: str
    title: str
    description: str


from src.memory import SessionManager
from src.prompt import system_prompt
from src.tools import (
    TOOLS,
    search_business_concepts,
    org_db_name,
    build_tool_handlers,
    compute_period_params,
)
from src.summarizer import maybe_compact_context
from src.task_payload import compose_requirement, format_domain_packet

MAX_GLOBAL_TIME = 22.0
MAX_TOOL_RESULT_ROWS = 5
MAX_SCHEMA_SEARCH_HITS = 4

session_manager = SessionManager()


class ChatRequest(BaseModel):
    sessionID: str
    query: str = ""
    organization_id: str
    user_id: str = "default_user"
    understanding: str = ""
    goal: str = ""
    time: str = ""
    scope: str = ""
    slice: list[str] = []
    answer_type: str = ""
    path: str = ""
    sql_facts: str = ""
    period_start: str = ""
    period_end: str = ""
    compare_start: str = ""
    compare_end: str = ""


def _period_params(request: ChatRequest, current_date: str) -> dict[str, str]:
    fallback = compute_period_params(current_date)
    out = dict(fallback)
    for key in ("period_start", "period_end", "compare_start", "compare_end"):
        val = str(getattr(request, key, "") or "").strip()
        if val:
            out[key] = val
    return out


# ---------------------------------------------------------------------------
# Fix 1: Rule-based query planner — zero LLM cost (~0ms vs ~7s)
# ---------------------------------------------------------------------------
def get_query_plan(query: str) -> dict:
    """Classify query complexity using keywords. No LLM call required."""
    q = query.lower()

    # Reconciliation: totals vs component breakdown questions
    if any(w in q for w in ["differ", "mismatch", "sum of", "total number", "reconcil",
                              "add up", "doesn't match", "not equal"]):
        return {"type": "reconciliation", "max_queries": 2, "timeout_per_query_sec": 7}

    # Simple single-metric questions
    if any(w in q for w in ["average", "how many", "what is the", "total count",
                              "percentage", "rate of"]):
        return {"type": "metric", "max_queries": 2, "timeout_per_query_sec": 6}

    # Default: diagnostic (why/root-cause questions)
    return {"type": "diagnostic", "max_queries": 3, "timeout_per_query_sec": 7}


# ---------------------------------------------------------------------------
# Fix 2: Relaxed content validator — only rejects actual tool-call syntax
# ---------------------------------------------------------------------------
def _is_valid_content(content) -> bool:
    if not content:
        return False
    stripped = content.strip()
    if not stripped:
        return False
    # Reject only if content literally starts with a tool-call token
    if stripped.startswith("<|tool_call>"):
        return False
    # Reject bare hallucinated tool calls at start of text
    if re.match(r"^call:\w+\s*\{", stripped):
        return False
    # Reject if content is only the word "thought"
    if stripped.lower() == "thought":
        return False
    return True


# ---------------------------------------------------------------------------
# Fix 3: Python-level evidence extractor — last resort before hardcoded string
# ---------------------------------------------------------------------------
def _kg_rows_from_memory(memory) -> list[dict]:
    rows: list[dict] = []
    for m in memory.memory:
        if m.get("role") != "tool" or m.get("name") != "knowledge_graph":
            continue
        try:
            payload = json.loads(m.get("content") or "{}")
        except (json.JSONDecodeError, TypeError):
            continue
        if payload.get("error"):
            continue
        data = payload.get("data")
        if isinstance(data, list):
            rows.extend([r for r in data if isinstance(r, dict)])
    return rows


def _numbers_in_rows(rows: list[dict]) -> set[str]:
    found: set[str] = set()
    for row in rows:
        for val in row.values():
            if isinstance(val, bool):
                continue
            if isinstance(val, (int, float)):
                found.add(str(val))
                found.add(str(int(val)) if float(val) == int(val) else str(round(float(val), 2)))
            elif isinstance(val, str):
                for tok in re.findall(r"-?\d+(?:\.\d+)?", val):
                    found.add(tok)
    return found


def _build_reasoning(
    request: ChatRequest,
    requirement: str,
    rows: list[dict],
    thought: str | None,
) -> dict:
    nums = _numbers_in_rows(rows)
    digest = ""
    if thought:
        digest = " ".join(str(thought).split())[:240]
    return {
        "aligned_to_task": "yes" if (request.goal or request.query) else "no",
        "checked": "knowledge_graph rows" if rows else "none",
        "not_checked": "interval agent readiness unless present in rows",
        "observed": rows[:8],
        "derived": [],
        "hypothesis": "none" if rows else "insufficient graph rows",
        "conflict_with_sql": "none" if not request.sql_facts else "prefer sql_facts for official rates",
        "thought_digest": digest,
        "row_numbers": sorted(nums),
    }


def _attach_packet(res: dict, request: ChatRequest, requirement: str, memory, time_echo: str) -> dict:
    rows = _kg_rows_from_memory(memory)
    thought = res.get("reasoning") or res.get("reasoning_content")
    reasoning = _build_reasoning(request, requirement, rows, thought)
    packet = format_domain_packet(request, rows, reasoning, time_echo, res.get("content"))
    out = dict(res or {})
    out["content"] = packet
    out["reasoning"] = reasoning
    out["rows"] = rows
    out["trace_thought"] = thought
    out["tool_calls"] = None
    return out


def _fallback_from_tool_results(memory) -> str | None:
    """Build a minimal Domain packet from the last successful knowledge_graph result."""
    rows = _kg_rows_from_memory(memory)
    if not rows:
        return None
    lines = ["store: kg", f"row_count: {len(rows)}"]
    for i, row in enumerate(rows[:8], 1):
        cells = "; ".join(f"{k}={v}" for k, v in row.items())
        lines.append(f"row {i}: kind=observed; {cells}")
    lines.append("reasoning:")
    lines.append("- aligned_to_task: yes")
    lines.append("- observed: rows above")
    lines.append("- derived: none")
    lines.append("- hypothesis: none")
    lines.append("- conflict_with_sql: none")
    return "\n".join(lines)


def _parse_fn_args(fn_args: str | dict) -> dict:
    if isinstance(fn_args, dict):
        return fn_args
    try:
        return json.loads(fn_args)
    except Exception:
        return {}


def _compact_tool_response(fn_name: str, tool_response: dict) -> dict:
    if fn_name == "knowledge_graph":
        data = tool_response.get("data")
        if isinstance(data, list) and len(data) > MAX_TOOL_RESULT_ROWS:
            return {
                **tool_response,
                "data": data[:MAX_TOOL_RESULT_ROWS],
                "truncated": True,
                "total_count": len(data),
            }
    if fn_name == "search_schema":
        hits = tool_response.get("hits")
        if isinstance(hits, list) and len(hits) > MAX_SCHEMA_SEARCH_HITS:
            return {
                **tool_response,
                "hits": hits[:MAX_SCHEMA_SEARCH_HITS],
                "truncated": True,
                "total_hits": tool_response.get("total_hits", len(hits)),
            }
    return tool_response


def Generate_response(
    request: ChatRequest,
    role: str = "operator",
    llm=None,
    system_prompt=system_prompt,
    tool_handlers=None,
    on_tool_call: Optional[Callable] = None,
    on_tool_result: Optional[Callable] = None,
    on_status: Optional[Callable] = None,
    on_activity: Optional[Callable] = None,
):
    """
    CCaaS Knowledge Graph Context Agent Orchestrator.
    Executes semantic concept retrieval, prompt injection, tool calling, and response synthesis.
    """
    if llm is None:
        raise ValueError("An LLM client/runner must be passed to Generate_response.")

    start_time = time.time()

    current_date = time.strftime("%Y-%m-%d", time.localtime())
    current_time = time.strftime("%H:%M:%S", time.localtime())

    session_key = f"{request.organization_id}:{request.sessionID}"
    if not session_manager.is_session_present(session_key):
        memory = session_manager.create_memory(session_key, system_prompt)
    else:
        memory = session_manager.get_memory(session_key)

    requirement = compose_requirement(request)
    memory.add_session_messages({"role": "user", "content": requirement})

    # 0. Query Planning — rule-based, zero LLM cost
    plan = get_query_plan(requirement)
    max_tool_rounds = plan.get("max_queries", 3)
    timeout_per_query = plan.get("timeout_per_query_sec", 7.0)

    # 1. Semantic Business Concept Search
    search_result = search_business_concepts(query=requirement, limit=4)
    hits = search_result.get("hits", []) if isinstance(search_result, dict) else []

    if hits:
        result_lines = []
        for hit in hits:
            card_type = hit.get("type", "concept")
            name = hit.get("name", "")
            desc = hit.get("description", "")
            lines = [f"[{card_type}] {name}: {desc}"]
            if hit.get("pattern"):
                lines.append(f"  Pattern: {hit['pattern']}")
            if hit.get("business_rules"):
                lines.append("  Rules: " + "; ".join(hit["business_rules"][:3]))
            if hit.get("base_entities"):
                lines.append("  Entities: " + ", ".join(hit["base_entities"]))
            if hit.get("cypher_template"):
                lines.append(f"  Cypher: {hit['cypher_template']}")
            if hit.get("diagnostic_template"):
                lines.append(f"  Diagnostic: {hit['diagnostic_template']}")
            result_lines.append("\n".join(lines))
        business_rules_and_definitions = "\n\n".join(result_lines)
    else:
        business_rules_and_definitions = "No specific concept cards matched."

    # 2. Dynamic System Prompt Injection
    neo4j_database = org_db_name(request.organization_id)
    periods = _period_params(request, current_date)
    time_echo = str(request.time or "").strip() or (
        f"{periods['period_start']} to {periods['period_end']}"
    )

    # role mapping to data_scope
    data_scope = "org" if role.lower() == "admin" else "mine"

    injected_prompt = (
        system_prompt.replace("<current_date>", current_date)
        .replace("<current_time>", current_time)
        .replace("<organization_id>", request.organization_id)
        .replace("<neo4j_database>", neo4j_database)
        .replace("<data_scope>", data_scope)
        .replace("<user_id>", request.user_id)
        .replace("<period_start>", periods["period_start"])
        .replace("<period_end>", periods["period_end"])
        .replace("<compare_start>", periods["compare_start"])
        .replace("<compare_end>", periods["compare_end"])
        .replace("<domain_requirement>", requirement or "(none)")
        .replace("<sql_facts>", (request.sql_facts or "").strip() or "(none)")
        .replace("<injected_business_rules_and_definitions>", business_rules_and_definitions)
    )
    memory.inject_prompt(system_prompt=injected_prompt)

    # 3. Execution Loop
    maybe_compact_context(memory, injected_prompt, llm_runner=getattr(llm, "run", None))
    messages = memory.get_session_messages()
    
    # Pre-inject a system message to strongly enforce tool usage
    messages.append({
        "role": "system",
        "content": "CRITICAL: Do NOT answer Domain from pre-training. You MUST call a tool (like knowledge_graph) to fetch graph evidence first. Do NOT write a user-facing essay."
    })
    
    # Try to force tool selection via the API
    try:
        res = llm.run(messages=messages, tools=TOOLS, tool_choice="required")
    except Exception:
        # Fallback if server doesn't support tool_choice="required"
        res = llm.run(messages=messages, tools=TOOLS)

    if _is_valid_content(res.get("content")) and not res.get("tool_calls"):
        # Model STILL answered directly without tools. Force it again.
        memory.add_session_messages({"role": "assistant", "content": res["content"]})
        memory.add_session_messages({
            "role": "user", 
            "content": "You did not run any tools to fetch the data. Please call `knowledge_graph` or `search_schema` now to get the empirical evidence before answering."
        })
        messages = memory.get_session_messages()
        try:
            res = llm.run(messages=messages, tools=TOOLS, tool_choice="required")
        except Exception:
            res = llm.run(messages=messages, tools=TOOLS)
            
        if _is_valid_content(res.get("content")) and not res.get("tool_calls"):
            return _attach_packet(res, request, requirement, memory, time_echo)

    _handlers = build_tool_handlers(
        request.organization_id,
        request.user_id,
        current_date,
        period_params=periods,
    )
    if tool_handlers:
        _handlers.update(tool_handlers)

    for round_num in range(max_tool_rounds):
        if time.time() - start_time > 27.5:
            if on_status:
                on_status("writing", "Timeout reached")
            break

        tool_calls = res.get("tool_calls") or []
        if not tool_calls:
            break

        for tool_call in tool_calls:
            memory.add_session_messages({"role": "assistant", "tool_calls": [tool_call]})
            fn_name = tool_call["function"]["name"]
            fn_args = _parse_fn_args(tool_call["function"]["arguments"])

            if fn_name == "knowledge_graph":
                fn_args["timeout_seconds"] = timeout_per_query

            if on_tool_call:
                on_tool_call(fn_name, fn_args)

            handler = _handlers.get(fn_name)
            if not handler:
                tool_output = {"error": f"Tool '{fn_name}' not recognized."}
            else:
                try:
                    tool_output = handler(**fn_args)
                except Exception as exc:
                    tool_output = {"error": str(exc)}

            compact_output = _compact_tool_response(fn_name, tool_output)
            if on_tool_result:
                on_tool_result(fn_name, fn_args, compact_output)

            json_output = json.dumps(compact_output, default=str)
            if len(json_output) > 4000:
                json_output = json_output[:4000] + "... [TRUNCATED. Please aggregate with count(), sum(), avg().]"

            memory.add_session_messages({
                "role": "tool",
                "tool_call_id": tool_call["id"],
                "name": fn_name,
                "content": json_output,
            })

        messages = memory.get_session_messages()
        res = llm.run(messages=messages, tools=TOOLS)
        if _is_valid_content(res.get("content")):
            memory.add_session_messages({"role": "assistant", "content": res["content"]})
            return _attach_packet(res, request, requirement, memory, time_echo)

    # Fix 4: Fallback uses emitter_llm (thinking=False) so content is never wiped
    if not _is_valid_content(res.get("content")) or \
       (time.time() - start_time > 27.5):
        try:
            from src.llm import emitter_llm
            fallback_llm = emitter_llm()
        except Exception:
            fallback_llm = llm

        fallback_msg = (
            "STOP. Do not call any more tools. Write the Domain packet now.\n\n"
            "Based ONLY on the tool results already in this conversation, fill store/kg rows "
            "and the reasoning card. If the data is insufficient, say RESULT: 0 rows and classify. "
            "Do NOT start with 'thought'. Do not write a user-facing essay."
        )
        memory.add_session_messages({"role": "user", "content": fallback_msg})
        messages = memory.get_session_messages()
        res = fallback_llm.run(messages=messages, tools=None)

        if _is_valid_content(res.get("content")):
            memory.add_session_messages({"role": "assistant", "content": res["content"]})
            return _attach_packet(res, request, requirement, memory, time_echo)

    evidence = _fallback_from_tool_results(memory)
    if evidence:
        res = {**res, "content": evidence, "tool_calls": None}
        memory.add_session_messages({"role": "assistant", "content": evidence})
        return _attach_packet(res, request, requirement, memory, time_echo)

    res["content"] = (
        "store: kg\nRESULT: 0 rows\nreasoning:\n- aligned_to_task: no\n"
        "- observed: none\n- derived: none\n- hypothesis: none\n- conflict_with_sql: none"
    )
    return _attach_packet(res, request, requirement, memory, time_echo)
