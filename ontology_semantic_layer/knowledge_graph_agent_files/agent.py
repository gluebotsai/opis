# ==============================================================================
# agent.py — Core Knowledge Graph Reporting Agent Engine
# ==============================================================================

import os
import json
import time
import uuid
import asyncio
from typing import Callable, Optional, Dict, Any, List

from .models import (
    KnowledgeGraphRequest,
    KnowledgeGraphResponse,
    ChatRequest,
    ActivityEvent,
)
from .config import validate_org_id, get_config
from .audit import record_audit_event
from .llm import OpenAILLM
from .memory import SessionManager
from .prompt import system_prompt as DEFAULT_SYSTEM_PROMPT
from .tools import (
    TOOLS,
    TOOL_HANDLERS,
    search_business_concepts,
    org_db_name,
    build_tool_handlers,
    compute_period_params,
)
from .summarizer import maybe_compact_context

current_date = time.strftime("%Y-%m-%d", time.localtime())
current_time = time.strftime("%H:%M:%S", time.localtime())

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

MAX_TOOL_RESULT_ROWS = 20
MAX_SCHEMA_SEARCH_HITS = 8
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

session_manager = SessionManager()
LLM = OpenAILLM()


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

    return "tool", f"Running {fn_name.replace('_', ' ')}…"


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


def _is_recall_question(query: str) -> bool:
    q = query.lower()
    return any(p in q for p in _RECALL_PATTERNS)


def _has_prior_assistant_reply(memory) -> bool:
    return any(
        m.get("role") == "assistant" and m.get("content")
        for m in memory.memory[1:]
    )


def _fallback_from_tool_results(memory) -> str | None:
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
            return "<p>No matching data was found in the database for this query timeframe.</p>"
        all_zeros = True
        for row in rows:
            if isinstance(row, dict):
                for v in row.values():
                    if isinstance(v, (int, float)) and v > 0:
                        all_zeros = False
                        break
        if all_zeros:
            return (
                "<p>No conversation or SLA performance records were found in the database for the specified comparison period.</p>"
                "<p>When investigating SLA drops, common operational drivers include:</p>"
                "<ul>"
                "<li><b>Volume Surges:</b> Incoming conversation spikes exceeding team capacity.</li>"
                "<li><b>Staffing Constraints:</b> Coverage gaps during peak hours.</li>"
                "<li><b>Escalation Latency:</b> Complex queries requiring multi-tier transfers.</li>"
                "</ul>"
            )
        lines = ["<p><b>Summary from retrieved data:</b></p><ul>"]
        for row in rows[:5]:
            if not isinstance(row, dict):
                continue
            parts = [f"<b>{k}</b>: {v}" for k, v in row.items()]
            lines.append(f"<li>{', '.join(parts)}</li>")
        lines.append("</ul>")
        return "".join(lines)
    return None


def _ensure_final_answer(memory, prompt_text: str, res: dict) -> dict:
    if res.get("content"):
        return res

    for _ in range(MAX_FINAL_ANSWER_RETRIES):
        maybe_compact_context(memory, prompt_text)
        message = memory.get_session_messages()
        res = LLM.run(messages=message, tools=[], enable_thinking=True)
        if res.get("content"):
            return res

    fallback = _fallback_from_tool_results(memory)
    if fallback:
        return {**res, "content": fallback, "tool_calls": None}
    return {
        **res,
        "content": "I apologize, but I wasn't able to construct a valid query to find that data.",
        "tool_calls": None,
    }


def _save_assistant_reply(memory, content: str | None) -> None:
    if content:
        memory.add_session_messages({"role": "assistant", "content": content})


def _extract_pure_concepts(query: str) -> str:
    """Extract business ontology concepts and rules for super agent handoff."""
    try:
        concept_data = search_business_concepts(query, limit=3)
        hits = concept_data.get("hits", []) if isinstance(concept_data, dict) else []
        if not hits:
            return ""

        summaries = []
        for hit in hits:
            c_name = hit.get("name") or hit.get("concept") or ""
            b_rules = hit.get("business_rules") or []
            mapping = hit.get("graph_mapping") or {}
            paths = mapping.get("relationship_paths") or hit.get("pattern") or ""
            desc = hit.get("description") or ""

            parts = []
            if c_name:
                parts.append(f"Entity/Concept: {c_name}")
            if desc:
                parts.append(f"Definition: {desc[:140]}")
            if b_rules:
                parts.append(f"Business Rules: {'; '.join(str(r) for r in b_rules[:2])}")
            if paths:
                parts.append(f"Graph Path: {paths}")
            summaries.append(" | ".join(parts))

        return "\n".join(summaries)
    except Exception:
        return ""


# ------------------------------------------------------------------------------
# Synchronous Response Generator
# ------------------------------------------------------------------------------

def Generate_response(
    request: KnowledgeGraphRequest,
    system_prompt: str = DEFAULT_SYSTEM_PROMPT,
    on_tool_call: Optional[Callable[[str, str | dict], None]] = None,
    tool_handlers: Optional[dict] = None,
    on_status: Optional[Callable[[str, str], None]] = None,
    on_activity: Optional[Callable[[ActivityEvent], None]] = None,
    on_tool_result: Optional[Callable[[str, str | dict, dict], None]] = None,
) -> dict:
    start = time.time()
    cyphers_executed: list[str] = []
    params_executed: list[dict] = []
    total_result_rows: int = 0

    # 1. Validate organization allowlist
    try:
        validated_org = validate_org_id(request.org_id or request.organization_id)
        request.org_id = validated_org
        request.organization_id = validated_org
    except ValueError as val_err:
        err_msg = str(val_err)
        record_audit_event(
            request_id=request.get_session_id(),
            org_id=str(request.org_id or request.organization_id or "unknown"),
            user_id=request.get_user_id(),
            role=request.get_role(),
            question=request.query,
            latency_seconds=time.time() - start,
            status="denied" if "Unauthorized" in err_msg else "error",
            error_message=err_msg,
        )
        return {
            "status": "denied" if "Unauthorized" in err_msg else "error",
            "content": f"<p style='color: #ef4444;'><b>Access Denied:</b> {err_msg}</p>",
            "tool_calls": None,
            "error": err_msg,
        }

    # 2. Resolve & validate Role-Based Access Scope (RBAC)
    access_scope = request.resolve_access_scope()
    is_valid_scope, scope_err = request.validate_scope_requirements(access_scope)
    if not is_valid_scope:
        record_audit_event(
            request_id=request.get_session_id(),
            org_id=validated_org,
            user_id=request.get_user_id(),
            role=request.get_role(),
            question=request.query,
            latency_seconds=time.time() - start,
            status="denied",
            error_message=scope_err,
        )
        return {
            "status": "denied",
            "content": f"<p style='color: #ef4444;'><b>Access Denied:</b> {scope_err}</p>",
            "tool_calls": None,
            "error": scope_err,
        }
    
    def _finalize_response(result: dict) -> dict:
        elapsed = time.time() - start
        final_content = result.get("content")
        status = "ok" if final_content else "no_data"
        if result.get("error"):
            status = "error"

        try:
            record_audit_event(
                request_id=request.get_session_id(),
                org_id=validated_org,
                user_id=request.get_user_id(),
                role=request.get_role(),
                question=request.query,
                cypher_run=cyphers_executed,
                params=params_executed,
                row_count=total_result_rows,
                latency_seconds=elapsed,
                status=status,
                error_message=result.get("error"),
            )
        except Exception as e:
            print(f"[Audit Error] {e}")

        clean_res = {**result}
        if final_content:
            clean_res["tool_calls"] = None
        if request.debug:
            clean_res["debug"] = {
                "request_id": request.get_session_id(),
                "org_id": validated_org,
                "user_id": request.get_user_id(),
                "role": request.get_role(),
                "cyphers": cyphers_executed,
                "params": params_executed,
                "total_rows": total_result_rows,
                "elapsed_seconds": round(elapsed, 2),
            }
        clean_res["cyphers_executed"] = cyphers_executed
        clean_res["total_rows"] = total_result_rows
        clean_res["elapsed_seconds"] = elapsed
        return clean_res

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
        description = (
            meta["description"](enriched_query)
            if callable(meta["description"])
            else meta["description"]
        )
        key = (step_id, status)
        if _last_activity == key:
            return
        _last_activity = key
        on_activity(ActivityEvent(step_id=step_id, status=status, title=title, description=description))

    session_key = f"{request.organization_id}:{request.sessionID}"
    memory = session_manager.create_memory(session_key, system_prompt)
    memory.add_session_messages({"role": "user", "content": request.query})

    prior_user_msgs = [m for m in memory.memory[1:] if m.get("role") == "user"]
    recent_queries = [m["content"] for m in prior_user_msgs[-2:]]
    if request.query not in recent_queries:
        recent_queries.append(request.query)
    enriched_query = " | ".join(recent_queries) if recent_queries else request.query

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

    prompt_formatted = (
        system_prompt.replace("<current_date>", current_date)
        .replace("<current_time>", current_time)
        .replace("<organization_id>", request.organization_id)
        .replace("<neo4j_database>", neo4j_database)
        .replace("<period_start>", periods["period_start"])
        .replace("<period_end>", periods["period_end"])
        .replace("<compare_start>", periods["compare_start"])
        .replace("<compare_end>", periods["compare_end"])
        .replace("<injected_business_rules_and_definitions>", business_rules_and_definitions)
        .replace("<caller_role>", access_scope.role)
        .replace("<caller_access_level>", access_scope.level)
        .replace("<caller_user_id>", access_scope.user_id or "anonymous")
        .replace("<caller_team_ids>", json.dumps(access_scope.team_ids))
        .replace("<caller_queue_ids>", json.dumps(access_scope.queue_ids))
    )
    memory.inject_prompt(system_prompt=prompt_formatted)

    if _is_recall_question(request.query) and _has_prior_assistant_reply(memory):
        _emit_activity("understand", "completed")
        _emit_activity("concepts", "completed")
        _emit_activity("analysis", "completed")
        _emit_activity("response", "running")
        _emit_status("writing", "Answering from conversation history…")
        msg_list = memory.get_session_messages()
        maybe_compact_context(memory, prompt_formatted)
        res = LLM.run(messages=msg_list, tools=[], enable_thinking=True)
        if res.get("content"):
            _save_assistant_reply(memory, res["content"])
            _emit_activity("response", "completed")
            return _finalize_response(res)

    msg_list = memory.get_session_messages()
    maybe_compact_context(memory, prompt_formatted)
    res = LLM.run(messages=msg_list, tools=TOOLS, enable_thinking=True)

    if not res.get("content"):
        last_status_msg = None
        cypher_call_count = 0
        _handlers = build_tool_handlers(
            request.organization_id, tool_handlers, current_date, access_scope=access_scope
        )

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
                        _pargs = _parse_fn_args(fn_args)
                        _cq = _pargs.get("cypher_query") or _pargs.get("cypher")
                        if _cq:
                            cyphers_executed.append(_cq)
                        if _pargs.get("params"):
                            params_executed.append(_pargs["params"])
                    tool_response = _handlers[fn_name](**_parse_fn_args(fn_args))
                    if fn_name == "knowledge_graph" and isinstance(tool_response, dict):
                        _data = tool_response.get("data")
                        if isinstance(_data, list):
                            total_result_rows += len(_data)
                        if tool_response.get("scoped_query"):
                            cyphers_executed.append(tool_response["scoped_query"])

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

            msg_list = memory.get_session_messages()
            maybe_compact_context(memory, prompt_formatted)

            is_last_round = round_num >= MAX_TOOL_ROUNDS - 1
            if is_last_round:
                res = LLM.run(messages=msg_list, tools=[], enable_thinking=True)
            else:
                res = LLM.run(messages=msg_list, tools=TOOLS, enable_thinking=True)

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
                _emit_activity("response", "completed")
                return _finalize_response(res)

        if not res.get("content"):
            _emit_status("writing", "Writing my reply…")
            res = _ensure_final_answer(memory, prompt_formatted, res)
            _save_assistant_reply(memory, res.get("content"))
    else:
        _emit_activity("analysis", "completed")
        _emit_activity("response", "running")
        _emit_status("writing", "Writing my reply…")
        res = _ensure_final_answer(memory, prompt_formatted, res)
        _save_assistant_reply(memory, res.get("content"))

    _emit_activity("response", "completed")
    return _finalize_response(res)


# ------------------------------------------------------------------------------
# Async Super-Agent / Orchestrator Callable Entrypoint
# ------------------------------------------------------------------------------

async def run_knowledge_graph_agent(
    query: str,
    organization_id: Optional[str] = None,
    user_id: Optional[str] = None,
    role: Optional[str] = None,
    scope: Optional[Dict[str, Any]] = None,
    session_id: Optional[str] = None,
    debug: bool = False,
    timeout_seconds: float = 35.0,
) -> KnowledgeGraphResponse:
    """
    Primary programmatic entrypoint for super agents or orchestrators.
    Executes in-process with timeout protection and returns typed KnowledgeGraphResponse.
    """
    start_time = time.time()
    req = KnowledgeGraphRequest(
        query=query,
        organization_id=organization_id,
        user_id=user_id,
        role=role,
        scope=scope,
        session_id=session_id,
        debug=debug,
    )

    concepts_discovered = _extract_pure_concepts(query)
    tool_calls_executed = []
    cypher_queries_executed = []

    def on_tool_call(fn_name: str, fn_args: str | dict):
        tool_calls_executed.append({"name": fn_name, "args": fn_args})
        if fn_name == "knowledge_graph":
            args_dict = fn_args if isinstance(fn_args, dict) else {}
            if isinstance(fn_args, str):
                try:
                    args_dict = json.loads(fn_args)
                except Exception:
                    pass
            cq = args_dict.get("cypher_query") or args_dict.get("cypher")
            if cq:
                cypher_queries_executed.append(cq)

    try:
        raw_result = await asyncio.wait_for(
            asyncio.to_thread(
                Generate_response,
                req,
                system_prompt=DEFAULT_SYSTEM_PROMPT,
                on_tool_call=on_tool_call,
            ),
            timeout=timeout_seconds,
        )

        content = (raw_result.get("content") or "").strip()
        status = raw_result.get("status", "ok" if content else "no_data")
        error_msg = raw_result.get("error")

        return KnowledgeGraphResponse(
            status=status,
            answer=content,
            explanation="Processed successfully by Knowledge Graph Agent.",
            data={
                "type": "concept",
                "title": "Ontology Concept Relationship",
                "concepts_discovered": concepts_discovered,
                "session_id": req.get_session_id(),
                "organization_id": req.organization_id,
                "user_id": req.get_user_id(),
                "role": req.get_role(),
                "total_rows": raw_result.get("total_rows", 0),
            },
            tool_calls=tool_calls_executed,
            cypher_queries=cypher_queries_executed or raw_result.get("cyphers_executed", []),
            error=error_msg,
            debug=raw_result.get("debug"),
            latency_seconds=round(time.time() - start_time, 3),
        )
    except asyncio.TimeoutError:
        return KnowledgeGraphResponse(
            status="error",
            answer="",
            explanation=f"Knowledge Graph Agent timed out after {timeout_seconds}s.",
            error="Request timed out.",
            latency_seconds=round(time.time() - start_time, 3),
        )
    except Exception as exc:
        return KnowledgeGraphResponse(
            status="error",
            answer="",
            explanation=f"Knowledge Graph Agent encountered an exception: {exc}",
            error=str(exc),
            latency_seconds=round(time.time() - start_time, 3),
        )
