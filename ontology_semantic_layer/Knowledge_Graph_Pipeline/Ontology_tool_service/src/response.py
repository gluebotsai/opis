# -------------------------------Dependencies----------------------------------
import json
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


_STEP_META = {
    "understand": {
        "title": "Understanding your question",
        "description": "Reading your question and recent context…",
    },
    "concepts": {
        "title": "Finding relevant metrics",
        "description": lambda enriched: (
            f"Searching concepts: {enriched[:72]}…" if enriched else "Searching business definitions…"
        ),
    },
    "analysis": {
        "title": "Analyzing & calculating",
        "description": lambda enriched: (
            f"Running analysis for: {enriched[:72]}…" if enriched else "Querying the knowledge graph…"
        ),
    },
    "response": {
        "title": "Preparing results",
        "description": "Writing your answer…",
    },
}

# ----------------------------------Local imports------------------------------
from src.llm import OpenAILLM
from src.memory import SessionManager
from src.prompt import system_prompt
from src.tools import TOOLS, TOOL_HANDLERS, search_business_concepts, org_db_name, build_tool_handlers, compute_period_params
from src.summarizer import maybe_compact_context


def _parse_fn_args(fn_args: str | dict) -> dict:
    if isinstance(fn_args, dict):
        return fn_args
    try:
        return json.loads(fn_args)
    except Exception:
        return {}


def _summarize_cypher(cypher: str, max_len: int = 64) -> str:
    one_line = " ".join(cypher.split())
    if len(one_line) <= max_len:
        return one_line
    return one_line[: max_len - 1] + "…"


def _build_status_message(fn_name: str, fn_args: str | dict) -> tuple[str, str]:
    """Return (phase, label) for SSE status events."""
    args = _parse_fn_args(fn_args)
    query = args.get("query", "")
    cypher = args.get("cypher_query") or args.get("cypher") or ""

    if fn_name == "knowledge_graph":
        if cypher:
            return "fetching", f"Fetching: {_summarize_cypher(cypher)}"
        return "fetching", "Fetching the numbers…"
    if fn_name == "search_schema":
        if query:
            short = query[:60] + "…" if len(query) > 60 else query
            return "concepts", f"Looking up: {short}"
        return "concepts", "Checking business definitions…"
    if fn_name == "search_business_concepts":
        if query:
            return "concepts", f"Searching concepts: {query[:60]}"
        return "concepts", "Searching business concepts…"

    label_map = {
        "sql_query": "Translating to SQL…",
        "mcp_sql": "Running database query…",
        "retrieve_context": "Fetching context…",
        "retrieve_schema": "Fetching schema details…",
    }
    label = label_map.get(fn_name, f"Running {fn_name.replace('_', ' ')}…")
    return "tool", label

MAX_TOOL_RESULT_ROWS = 20
MAX_SCHEMA_SEARCH_HITS = 8


def _compact_tool_response(fn_name: str, tool_response: dict) -> dict:
    """Keep tool payloads small so later LLM rounds stay fast."""
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

# ---------------------------------Agent limits (anti-researcher)--------------------------------
MAX_TOOL_ROUNDS = 3
MAX_CYPHER_CALLS = 3
MAX_FINAL_ANSWER_RETRIES = 5

_RECALL_PATTERNS = (
    "previous answer",
    "you mentioned",
    "you said",
    "earlier you",
    "last answer",
    "what queue did you",
    "what numbers did you",
    "recall what",
    "remember what",
    "from your last",
)


def _is_recall_question(query: str) -> bool:
    q = query.lower()
    return any(p in q for p in _RECALL_PATTERNS)


def _has_prior_assistant_reply(memory) -> bool:
    return any(
        m.get("role") == "assistant" and m.get("content")
        for m in memory.memory[1:]
    )


def _fallback_from_tool_results(memory) -> str | None:
    """Build a minimal answer from the last successful knowledge_graph tool result."""
    for m in reversed(memory.memory):
        if m.get("role") != "tool" or m.get("name") != "knowledge_graph":
            continue
        try:
            payload = json.loads(m.get("content") or "{}")
        except (json.JSONDecodeError, TypeError):
            continue
        if payload.get("error"):
            continue
        rows = payload.get("data")
        if not isinstance(rows, list):
            continue
        if not rows:
            return "No data was found in the database for this query."
        lines = ["Summary from retrieved data:"]
        for row in rows[:5]:
            if not isinstance(row, dict):
                continue
            parts = [f"{k}={v}" for k, v in row.items()]
            lines.append("- " + ", ".join(parts))
        return "\n".join(lines)
    return None


def _ensure_final_answer(memory, system_prompt: str, res: dict) -> dict:
    """Retry empty LLM replies and fall back to tool evidence so memory stays usable."""
    if res.get("content"):
        return res

    for _ in range(MAX_FINAL_ANSWER_RETRIES):
        maybe_compact_context(memory, system_prompt)
        message = memory.get_session_messages()
        res = LLM.run(messages=message, tools=[], enable_thinking=False)
        if res.get("content"):
            return res

    fallback = _fallback_from_tool_results(memory)
    if fallback:
        return {**res, "content": fallback, "tool_calls": None}
    return {**res, "content": "I apologize, but I wasn't able to construct a valid query to find that data.", "tool_calls": None}


def _save_assistant_reply(memory, content: str | None) -> None:
    if content:
        memory.add_session_messages({"role": "assistant", "content": content})


# ---------------------------------Global variables--------------------------------
session_manager = SessionManager()
LLM = OpenAILLM()

current_date = time.strftime("%Y-%m-%d", time.localtime())
current_time = time.strftime("%H:%M:%S", time.localtime())

import uuid
from pydantic import BaseModel, Field

class ChatRequest(BaseModel):
    sessionID: str = Field(default_factory=lambda: str(uuid.uuid4()))
    query: str
    organization_id : str

# -------------------------------------Main-------------------------------------------------
def Generate_response(
    request: ChatRequest,
    system_prompt=system_prompt,
    on_tool_call=None,
    tool_handlers=None,
    on_status: Optional[Callable[[str, str], None]] = None,
    on_activity: Optional[Callable[[ActivityEvent], None]] = None,
    on_tool_result: Optional[Callable[[str, str | dict, dict], None]] = None,
):
    start = time.time()

    _last_activity: tuple | None = None

    def _emit_status(phase: str, label: str):
        if on_status:
            on_status(phase, label)

    def _emit_activity(step_id: str, status: str):
        nonlocal _last_activity
        if on_activity is None:
            return
        meta = _STEP_META[step_id]
        title = meta["title"]
        description = meta["description"](enriched_query) if callable(meta["description"]) else meta["description"]
        key = (step_id, status)
        if _last_activity == key:
            return
        _last_activity = key
        on_activity(ActivityEvent(step_id=step_id, status=status, title=title, description=description))

    print("-"*100)
    print(f"User Query - : {request.query}")
    session_key = f"{request.organization_id}:{request.sessionID}"
    # Always create a fresh memory to make this agent stateless,
    # relying on the larger parent agent to handle conversation history.
    memory = session_manager.create_memory(session_key, system_prompt)
    memory.add_session_messages(
        {"role":"user",
         "content" : request.query
        }
    )

    prior_user_msgs = [m for m in memory.memory[1:] if m.get("role") == "user"]
    recent_queries = [m["content"] for m in prior_user_msgs[-2:]]
    if request.query not in recent_queries:
        recent_queries.append(request.query)
    if not recent_queries:
        enriched_query = request.query
    enriched_query = " | ".join(recent_queries)

    _emit_activity("understand", "running")
    _emit_status("understanding", "Understanding your question…")

    _emit_activity("concepts", "running")
    search_result = search_business_concepts(query=enriched_query)
    hits = search_result.get("hits", []) if isinstance(search_result, dict) else []

    if hits:
        names = [h.get("name", "") for h in hits[:3] if h.get("name")]
        concept_label = "Found: " + ", ".join(names) if names else "Matched business concepts"
        _emit_status("concepts", concept_label)
    else:
        _emit_status("concepts", "Checking business definitions…")

    _emit_activity("understand", "completed")
    _emit_activity("concepts", "completed")
    _emit_activity("analysis", "running")
    _emit_status("planning", "Planning the analysis…")

    if hits:
        result_lines = []
        for hit in hits:
            card_type = hit.get("type", "concept")
            name = hit.get("name", "")
            desc = hit.get("description") or hit.get("definition", "")
            lines = [f"[{card_type}] {name}: {desc}"]
            mapping = hit.get("graph_mapping") or {}
            paths = mapping.get("relationship_paths") or hit.get("pattern")
            if paths:
                if isinstance(paths, str):
                    lines.append(f"  Path: {paths}")
                else:
                    lines.append("  Paths: " + "; ".join(paths))
            if hit.get("business_rules"):
                lines.append("  Rules: " + "; ".join(hit["business_rules"][:3]))
            if hit.get("disambiguation"):
                lines.append(f"  Note: {hit['disambiguation']}")
            if hit.get("cypher_template"):
                lines.append(f"  Cypher: {hit['cypher_template'][:300]}")
            if hit.get("diagnostic_template"):
                lines.append(f"  Diagnostic: {hit['diagnostic_template'][:300]}")
            result_lines.append("\n".join(lines))
        business_rules_and_definitions = "\n\n".join(result_lines)
    else:
        business_rules_and_definitions = "No relevant business concepts found."

    neo4j_database = org_db_name(request.organization_id)
    periods = compute_period_params(current_date)

    system_prompt = (
        system_prompt.replace("<current_date>", current_date)
        .replace("<current_time>", current_time)
        .replace("<organization_id>", request.organization_id)
        .replace("<neo4j_database>", neo4j_database)
        .replace("<period_start>", periods["period_start"])
        .replace("<period_end>", periods["period_end"])
        .replace("<compare_start>", periods["compare_start"])
        .replace("<compare_end>", periods["compare_end"])
        .replace("<injected_business_rules_and_definitions>", business_rules_and_definitions)
    )
    memory.inject_prompt(system_prompt=system_prompt)

    if _is_recall_question(request.query) and _has_prior_assistant_reply(memory):
        _emit_activity("understand", "completed")
        _emit_activity("concepts", "completed")
        _emit_activity("analysis", "completed")
        _emit_activity("response", "running")
        _emit_status("writing", "Answering from conversation history…")
        message = memory.get_session_messages()
        maybe_compact_context(memory, system_prompt)
        res = LLM.run(messages=message, tools=[], enable_thinking=False)
        if res.get("content"):
            _save_assistant_reply(memory, res["content"])
            end = time.time()
            print(res["content"])
            print(f"Given response to user in {end-start}")
            print("-"*100)
            _emit_activity("response", "completed")
            return res

    message=memory.get_session_messages()
    maybe_compact_context(memory, system_prompt)
    res=LLM.run(messages=message, tools=TOOLS, enable_thinking=True)
    # print("==="*10)
    # print(res)
    # print("==="*10)
    if not res.get("content"):
        last_status_msg = None
        cypher_call_count = 0
        _handlers = build_tool_handlers(request.organization_id, tool_handlers, current_date)

        for round_num in range(MAX_TOOL_ROUNDS):
            tool_calls = res.get("tool_calls") or []
            if not tool_calls:
                break

            assistant_msg = {"role": "assistant", "tool_calls": tool_calls}
            memory.add_session_messages(assistant_msg)

            for tool_call in tool_calls:
                fn_name = tool_call["function"]["name"]
                fn_args = tool_call["function"]["arguments"]

                phase, label = _build_status_message(fn_name, fn_args)
                if fn_name == "knowledge_graph":
                    _emit_status("querying", "Writing the analytics query…")
                _emit_status(phase, label)
                if on_tool_call:
                    on_tool_call(fn_name, fn_args)

                if fn_name == "knowledge_graph" and cypher_call_count >= MAX_CYPHER_CALLS:
                    tool_response = {
                        "error": (
                            f"Cypher limit ({MAX_CYPHER_CALLS}) reached. "
                            "Stop querying. Answer the user using evidence already collected."
                        )
                    }
                else:
                    if fn_name == "knowledge_graph":
                        cypher_call_count += 1
                    tool_response = _handlers[fn_name](**_parse_fn_args(fn_args))

                tool_response = _compact_tool_response(fn_name, tool_response)

                if on_tool_result:
                    on_tool_result(fn_name, fn_args, tool_response)

                memory.add_session_messages(
                    {
                        "role": "tool",
                        "name": fn_name,
                        "tool_call_id": tool_call["id"],
                        "content": json.dumps(tool_response, default=str),
                    }
                )

            message = memory.get_session_messages()
            maybe_compact_context(memory, system_prompt)

            is_last_round = round_num >= MAX_TOOL_ROUNDS - 1
            if is_last_round:
                res = LLM.run(messages=message, tools=[], enable_thinking=False)
            else:
                res = LLM.run(messages=message, tools=TOOLS, enable_thinking=True)

            if res.get("content"):
                _emit_activity("analysis", "completed")
                _emit_activity("response", "running")
                if last_status_msg != "writing":
                    _emit_status("writing", "Writing my reply…")
                    last_status_msg = "writing"
                memory.add_session_messages(
                    {
                        "role": "assistant",
                        "content": res["content"],
                    }
                )
                end = time.time()
                print(res["content"])
                print(f"Given response to user in {end-start}")
                print("-"*100)
                _emit_activity("response", "completed")
                return {**res, "tool_calls": None}

        if not res.get("content"):
            _emit_status("writing", "Writing my reply…")
            res = _ensure_final_answer(memory, system_prompt, res)
            _save_assistant_reply(memory, res.get("content"))
    else:
        _emit_activity("analysis", "completed")
        _emit_activity("response", "running")
        _emit_status("writing", "Writing my reply…")
        res = _ensure_final_answer(memory, system_prompt, res)
        _save_assistant_reply(memory, res.get("content"))
    end=time.time()
    print(res.get("content"))
    print(f"Given response to user in {end-start}")
    print("-"*100)
    _emit_activity("response", "completed")
    return {**res, "tool_calls": None if res.get("content") else res.get("tool_calls")}



