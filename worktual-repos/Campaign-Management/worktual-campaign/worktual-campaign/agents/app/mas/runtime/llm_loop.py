"""Shared LLM helpers for Super / Domain MAS runners."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.config import get_settings
from app.llm import CREATE_CHAT_MAX_TOKENS, OpenAILLM
from app.mas.catalog import (
    executors_for_domain,
    normalize_domain,
    normalize_executor,
)
from app.mas.runtime.load_agent_md import agent_md_to_system_prompt, package_agent_md
from app.mas.runtime.creation_context import creation_pipeline_context
from app.mas.runtime.tools_schemas import (
    DOMAIN_EXECUTOR_HINTS,
    INVOKE_EXECUTOR_TOOL,
    REQUEST_DOMAIN_HANDOFF_TOOL,
)
from app.runtime.agent import run_tool_loop


CREATION_NO_BARE_SUCCESS = (
    "Never invent that a template was created, saved, or is visible in View. "
    "Those claims are only valid AFTER invoke_executor returns this turn "
    "(campaign_content or email_html_compose). Prior assistant "
    "'New email template created' messages are stale — do not repeat them "
    "without a new tool call. Create / regenerate / another template / "
    "proceed with a new template THIS turn → invoke_executor campaign_content "
    "(skill campaign_templates, user_confirmed=true) or email_html_compose "
    "when only email needs generating. Plain-text replies are ONLY clarifying "
    "questions (e.g. which channels) — never generate success."
)

_STALE_TEMPLATE_SUCCESS_MARKERS = (
    "template created",
    "templates created",
    "here's what's ready",
    "here is what's ready",
    "template is ready",
    "templates are ready",
    "visible in view",
    "new email template created",
)


def looks_like_stale_template_success(text: str) -> bool:
    """True when assistant text claims generate already succeeded (not a clarifying question)."""
    t = " ".join(str(text or "").split()).lower()
    if not t:
        return False
    return any(marker in t for marker in _STALE_TEMPLATE_SUCCESS_MARKERS)


def creation_force_tool_query(query: str) -> str:
    """Retry user text when Creation skipped invoke_executor (LLM instruction, not intent parse)."""
    q = str(query or "").strip() or "(empty)"
    return (
        f"{q}\n\n---\n"
        "SYSTEM: You skipped invoke_executor. Call it now. "
        "Do not write that a template was created. "
        "If this user turn is generate/regenerate/new template, "
        "executor_id=campaign_content skill_id=campaign_templates "
        "skill_action=continue user_confirmed=true "
        "(email_html_compose is OK when only email). "
        "Otherwise pick the matching executor (brief_validation, "
        "campaign_audience, launch_scheduling)."
    )


def mas_llm() -> OpenAILLM:
    s = get_settings()
    return OpenAILLM(
        api_key=s.llm_api_key,
        model_name=s.llm_model,
        base_url=s.llm_base_url,
    )


def system_from_package(package_dir, *, runtime_context: str = "") -> str:
    meta = package_agent_md(package_dir)
    sections = meta.get("sections") or {}
    if meta.get("missing"):
        return runtime_context or "You are a Worktual Campaign MAS agent."
    return agent_md_to_system_prompt(sections, runtime_context=runtime_context)


async def run_single_tool_routing_loop(
    *,
    system_prompt: str,
    user_text: str,
    tools: list,
    allowed_tool_names: frozenset[str],
    max_rounds: int = 2,
    prior_turns: list[dict[str, Any]] | None = None,
    allow_direct_reply: bool = False,
) -> dict[str, Any]:
    """
    Short LLM loop that expects exactly one routing tool call.
    When allow_direct_reply=True, plain-text assistant content (no tool) is accepted.
    Returns {ok, tool_name, tool_args, content, timed_out}.
    """
    llm = mas_llm()
    history = [
        m
        for m in (prior_turns or [])
        if isinstance(m, dict)
        and m.get("role") in ("user", "assistant")
        and str(m.get("content") or "").strip()
    ]
    messages: list[dict] = [
        {"role": "system", "content": system_prompt},
        *history,
        {"role": "user", "content": user_text or "(empty)"},
    ]
    captured: dict[str, Any] = {"tool_name": None, "tool_args": {}}

    async def dispatch(name: str, args: dict[str, Any]) -> dict[str, Any]:
        if name not in allowed_tool_names:
            return {"ok": False, "error": f"Tool {name} not allowed for this agent."}
        captured["tool_name"] = name
        captured["tool_args"] = dict(args or {})
        return {"ok": True, "status": "accepted", "args": captured["tool_args"]}

    def filter_calls(tool_calls: list) -> list:
        out = []
        for call in tool_calls or []:
            name = str((call.get("function") or {}).get("name") or "")
            if name in allowed_tool_names:
                out.append(call)
                break
        return out

    def break_after(
        round_calls: list[tuple[str, dict[str, Any]]],
        content: str,
    ) -> str | None:
        if round_calls:
            return content or "."
        if allow_direct_reply and str(content or "").strip():
            return content
        return None

    loop = await run_tool_loop(
        llm,
        messages,
        tools,
        dispatch=dispatch,
        max_rounds=max_rounds,
        empty_content_retries=1,
        filter_tool_calls=filter_calls,
        break_after_tools=break_after,
        # Direct replies (ideas, clarify) were truncating mid-sentence when Qwen
        # thinking burned CHAT_MAX_TOKENS=384 — use create budget + no thinking.
        max_tokens=CREATE_CHAT_MAX_TOKENS if allow_direct_reply else 512,
        disable_thinking=True,
    )
    content = str(loop.content or "").strip()
    if captured["tool_name"]:
        return {
            "ok": True,
            "tool_name": captured["tool_name"],
            "tool_args": captured["tool_args"],
            "content": loop.content,
            "timed_out": loop.timed_out,
            "used_tools": loop.used_tools,
        }
    if allow_direct_reply and content:
        return {
            "ok": True,
            "tool_name": None,
            "tool_args": {},
            "content": content,
            "timed_out": loop.timed_out,
            "used_tools": loop.used_tools,
        }
    return {
        "ok": False,
        "tool_name": captured["tool_name"],
        "tool_args": captured["tool_args"],
        "content": loop.content,
        "timed_out": loop.timed_out,
        "used_tools": loop.used_tools,
    }


async def llm_pick_executor(
    *,
    domain_id: str,
    package_dir: Path,
    query: str,
    default_executor: str,
) -> str:
    """LLM invoke_executor restricted to this domain's executor allowlist."""
    allowed = frozenset(executors_for_domain(domain_id))
    if not allowed:
        return default_executor
    hints = DOMAIN_EXECUTOR_HINTS.get(domain_id, "")
    runtime = (
        f"You are the {domain_id} Domain Agent. Pick exactly one executor.\n"
        f"Allowed executors:\n{hints}\n"
        f"Default if unsure: {default_executor}."
    )
    system = system_from_package(package_dir, runtime_context=runtime)
    tool = {
        "type": "function",
        "function": {
            **INVOKE_EXECUTOR_TOOL["function"],
            "parameters": {
                **INVOKE_EXECUTOR_TOOL["function"]["parameters"],
                "properties": {
                    **INVOKE_EXECUTOR_TOOL["function"]["parameters"]["properties"],
                    "executor_id": {
                        "type": "string",
                        "enum": sorted(allowed),
                    },
                },
            },
        },
    }
    routed = await run_single_tool_routing_loop(
        system_prompt=system,
        user_text=query,
        tools=[tool],
        allowed_tool_names=frozenset({"invoke_executor"}),
        max_rounds=2,
    )
    if not routed.get("ok"):
        return default_executor
    eid = str((routed.get("tool_args") or {}).get("executor_id") or "").strip().lower()
    return eid if eid in allowed else default_executor


async def llm_pick_audience_executor(
    *,
    package_dir: Path,
    query: str,
    session: dict[str, Any] | None = None,
    module_hint: str = "",
) -> dict[str, Any]:
    """Audience Domain: invoke_executor with optional contact skill + skill_action."""
    from app.mas.runtime.context import build_mas_runtime_context, recent_routing_history
    from app.mas.skills.registry import SKILL_ACTIONS, get_skill_registry
    from app.mas.skills.state import CONTACTS_MODULE, SkillStateStore

    allowed = frozenset(executors_for_domain("audience"))
    if not allowed:
        return {"ok": False, "error": "No audience executors configured"}
    registry = get_skill_registry()
    contact_skills = registry.list_module(CONTACTS_MODULE)
    skill_ids = [s.skill_id for s in contact_skills]
    store = SkillStateStore()
    skill_state_block = ""
    if session:
        skill_state_block = store.summary_for_prompt(session, CONTACTS_MODULE)

    runtime = build_mas_runtime_context(session, module_hint=module_hint)
    runtime += (
        "\n\nWhen a real contact task is needed, call invoke_executor once. "
        "When executor_id is contact, set skill_id and skill_action. "
        "Read session facts and recent chat — keep active skill on continue; "
        "change skill only when the user clearly switches task or a skill finished.\n"
        "Create-start: if recent chat offered add/create and the user chooses that path "
        "in any natural wording (including short replies like wanting a new/another "
        "contact), invoke_executor contact + contact_creation + new_task. "
        "Never answer those with a Domain-only 'didn't catch that' reply.\n"
        f"Contact skill state:\n{skill_state_block or '(none)'}\n"
        "For audience_selection / audience_pull: omit skill_id and skill_action."
    )
    system = system_from_package(package_dir, runtime_context=runtime)
    invoke_tool = {
        "type": "function",
        "function": {
            **INVOKE_EXECUTOR_TOOL["function"],
            "parameters": {
                **INVOKE_EXECUTOR_TOOL["function"]["parameters"],
                "properties": {
                    **INVOKE_EXECUTOR_TOOL["function"]["parameters"]["properties"],
                    "executor_id": {
                        "type": "string",
                        "enum": sorted(allowed),
                    },
                    "skill_id": {
                        "type": "string",
                        "enum": skill_ids,
                        "description": (
                            "Required when executor_id=contact. "
                            "contact_creation | contact_update | contact_view."
                        ),
                    },
                    "skill_action": {
                        "type": "string",
                        "enum": sorted(SKILL_ACTIONS),
                        "description": "Required when executor_id=contact.",
                    },
                },
            },
        },
    }
    routed = await run_single_tool_routing_loop(
        system_prompt=system,
        user_text=query,
        tools=[invoke_tool],
        allowed_tool_names=frozenset({"invoke_executor"}),
        max_rounds=2,
        prior_turns=recent_routing_history(session) if session else None,
        allow_direct_reply=True,
    )
    if not routed.get("ok"):
        return {
            "ok": False,
            "error": "Audience Domain could not choose an action",
            "llm": routed,
        }
    if not routed.get("tool_name"):
        reply = str(routed.get("content") or "").strip()
        if reply:
            return {"ok": True, "direct_reply": reply, "llm": routed}
        return {
            "ok": False,
            "error": "Audience Domain returned empty reply",
            "llm": routed,
        }
    args = routed.get("tool_args") or {}
    eid = str(args.get("executor_id") or "").strip().lower()
    if eid not in allowed:
        return {
            "ok": False,
            "error": f"Invalid executor {eid!r} from Domain LLM",
            "llm": routed,
        }
    out: dict[str, Any] = {
        "ok": True,
        "executor_id": eid,
        "restated_query": str(args.get("restated_query") or query).strip(),
        "change_summary": str(args.get("change_summary") or ""),
        "llm": routed,
    }
    if args.get("user_confirmed") is not None:
        out["user_confirmed"] = bool(args.get("user_confirmed"))
    if eid == "contact":
        sid = str(args.get("skill_id") or "").strip().lower()
        action = str(args.get("skill_action") or "continue").strip().lower()
        if sid not in skill_ids:
            return {
                "ok": False,
                "error": f"contact executor requires skill_id; got {sid!r}",
                "llm": routed,
            }
        if action not in SKILL_ACTIONS:
            action = "continue"
        out["skill_id"] = sid
        out["skill_action"] = action
    return out


async def llm_pick_optimization_executor(
    *,
    package_dir: Path,
    query: str,
    session: dict[str, Any] | None = None,
    module_hint: str = "",
    task_spec: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Optimization Domain: invoke_executor + skill for monitoring/recovery/analytics."""
    from app.mas.runtime.context import build_mas_runtime_context, recent_routing_history
    from app.mas.skills.monitoring import MONITORING_MODULE
    from app.mas.skills.registry import SKILL_ACTIONS, get_skill_registry
    from app.mas.skills.reports import REPORTS_MODULE
    from app.mas.skills.state import SkillStateStore

    allowed = frozenset(executors_for_domain("optimization"))
    if not allowed:
        return {"ok": False, "error": "No optimization executors configured"}

    spec = dict(task_spec or {})
    hint = str(module_hint or spec.get("module") or "").strip().lower()
    if hint == "dashboard":
        hint = "reports"

    registry = get_skill_registry()
    monitoring_skills = registry.list_module(MONITORING_MODULE)
    reports_skills = registry.list_module(REPORTS_MODULE)
    reports_surface = hint in ("reports", "events_report")
    monitoring_surface = hint == "monitoring"

    if reports_surface:
        skill_pack = reports_skills
        skill_module_for_state = REPORTS_MODULE
    elif monitoring_surface:
        skill_pack = monitoring_skills
        skill_module_for_state = MONITORING_MODULE
    else:
        skill_pack = list(monitoring_skills) + list(reports_skills)
        skill_module_for_state = MONITORING_MODULE

    skill_ids = [s.skill_id for s in skill_pack]
    skill_hints = "\n".join(
        f"- {s.skill_id} (executor={s.executor_id}): {s.description}" for s in skill_pack
    )
    store = SkillStateStore()
    skill_state_block = ""
    if session:
        skill_state_block = store.summary_for_prompt(session, skill_module_for_state)
        if reports_surface:
            pass
        elif not monitoring_surface:
            mon = store.summary_for_prompt(session, MONITORING_MODULE)
            rep = store.summary_for_prompt(session, REPORTS_MODULE)
            skill_state_block = (
                f"monitoring:\n{mon or '(none)'}\nreports:\n{rep or '(none)'}"
            )

    hints = DOMAIN_EXECUTOR_HINTS.get("optimization", "")
    runtime = build_mas_runtime_context(session, module_hint=module_hint)
    if reports_surface:
        runtime += (
            "\n\nYou are the Optimization Domain Agent on the dashboard/reports surface.\n"
            "You MUST call invoke_executor — never answer in plain text on this surface.\n"
            "Pick executor_id=analytics and set skill_id + skill_action.\n"
            "Cross-module requests (create campaign, contacts, forms) are handled by the "
            "analytics executor via ROUTE_TO_MODULE — still invoke analytics, do not refuse.\n"
            "events_report module → prefer skill events_report; otherwise KPI/list/ontology skills.\n"
            "Read session facts — keep active skill on continue; switch only when the task changes.\n"
            f"Reports skill state:\n{skill_state_block or '(none)'}\n"
            f"Reports skills:\n{skill_hints or '(none)'}\n"
            f"Allowed executors:\n{hints}"
        )
    else:
        runtime += (
            "\n\nYou are the Optimization Domain Agent. Pick exactly one executor via invoke_executor.\n"
            "Use monitoring for lists/reports/audience; recovery for stop/resume or A/B winner; "
            "analytics for dashboard KPI/ontology/events surfaces.\n"
            "When executor_id is monitoring, recovery, or analytics, also set skill_id and skill_action.\n"
            "Read session facts and recent chat — keep active skill on continue; "
            "change skill only when the user clearly switches task or a skill finished.\n"
            f"Skill state:\n{skill_state_block or '(none)'}\n"
            f"Skills:\n{skill_hints or '(none)'}\n"
            "Monitoring map: monitor_list/report→monitoring; monitor_recovery/ab→recovery.\n"
            "Reports map: report_kpis/ontology/campaigns/events_report→analytics.\n"
            f"Allowed executors:\n{hints}"
        )
    system = system_from_package(package_dir, runtime_context=runtime)
    executor_enum = (
        ["analytics"]
        if reports_surface and "analytics" in allowed
        else sorted(allowed)
    )
    tool = {
        "type": "function",
        "function": {
            **INVOKE_EXECUTOR_TOOL["function"],
            "parameters": {
                **INVOKE_EXECUTOR_TOOL["function"]["parameters"],
                "properties": {
                    **INVOKE_EXECUTOR_TOOL["function"]["parameters"]["properties"],
                    "executor_id": {
                        "type": "string",
                        "enum": executor_enum,
                    },
                    "skill_id": {
                        "type": "string",
                        "enum": skill_ids,
                        "description": (
                            "Required for monitoring, recovery, and analytics executors."
                        ),
                    },
                    "skill_action": {
                        "type": "string",
                        "enum": sorted(SKILL_ACTIONS),
                        "description": (
                            "Required for monitoring, recovery, and analytics executors."
                        ),
                    },
                },
            },
        },
    }
    routed = await run_single_tool_routing_loop(
        system_prompt=system,
        user_text=query,
        tools=[tool],
        allowed_tool_names=frozenset({"invoke_executor"}),
        max_rounds=2,
        prior_turns=recent_routing_history(session) if session else None,
        allow_direct_reply=not reports_surface,
    )
    if reports_surface:
        default = "analytics"
        default_skill = "events_report" if hint == "events_report" else "report_kpis"
    else:
        default = "monitoring"
        default_skill = "monitor_list"
    if not routed.get("ok"):
        out_fail: dict[str, Any] = {
            "ok": True,
            "executor_id": default,
            "restated_query": query,
            "skill_id": default_skill,
            "skill_action": "continue",
            "llm": routed,
        }
        return out_fail
    if not routed.get("tool_name"):
        if reports_surface:
            return {
                "ok": True,
                "executor_id": default,
                "restated_query": query,
                "skill_id": default_skill,
                "skill_action": "continue",
                "llm": routed,
            }
        reply = str(routed.get("content") or "").strip()
        if reply:
            return {"ok": True, "direct_reply": reply, "llm": routed}
        return {
            "ok": False,
            "error": "Optimization Domain returned empty reply",
            "llm": routed,
        }
    args = routed.get("tool_args") or {}
    eid = str(args.get("executor_id") or "").strip().lower()
    if reports_surface:
        eid = "analytics"
    if eid not in allowed:
        return {
            "ok": False,
            "error": f"Invalid executor {eid!r} from Domain LLM",
            "llm": routed,
        }
    out: dict[str, Any] = {
        "ok": True,
        "executor_id": eid,
        "restated_query": str(args.get("restated_query") or query).strip(),
        "change_summary": str(args.get("change_summary") or ""),
        "llm": routed,
    }
    if args.get("user_confirmed") is not None:
        out["user_confirmed"] = bool(args.get("user_confirmed"))
    if eid in ("monitoring", "recovery", "analytics"):
        sid = str(args.get("skill_id") or "").strip().lower()
        action = str(args.get("skill_action") or "continue").strip().lower()
        pack = (
            reports_skills
            if eid == "analytics"
            else monitoring_skills
        )
        pack_ids = [s.skill_id for s in pack]
        if sid not in pack_ids:
            if eid == "analytics":
                sid = "events_report" if hint == "events_report" else "report_kpis"
            elif eid == "recovery":
                sid = "monitor_recovery"
            else:
                sid = "monitor_list"
        skill_spec = next((s for s in pack if s.skill_id == sid), None)
        if skill_spec and skill_spec.executor_id != eid:
            eid = skill_spec.executor_id
            out["executor_id"] = eid
        if action not in SKILL_ACTIONS:
            action = "continue"
        out["skill_id"] = sid
        out["skill_action"] = action
    return out


async def llm_pick_creation_action(
    *,
    package_dir: Path,
    query: str,
    default_executor: str = "brief_validation",
    session: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Creation Domain LLM: invoke_executor (+ skill) OR request_domain_handoff.
    Returns {kind: executor|needs_domain, ...}.
    """
    from app.mas.runtime.context import recent_routing_history
    from app.mas.skills.create_campaign import (
        CREATE_CAMPAIGN_MODULE,
        default_skill_for_executor,
    )
    from app.mas.skills.registry import SKILL_ACTIONS, get_skill_registry
    from app.mas.skills.state import SkillStateStore

    allowed = frozenset(executors_for_domain("creation"))
    hints = DOMAIN_EXECUTOR_HINTS.get("creation", "")
    registry = get_skill_registry()
    create_skills = registry.list_module(CREATE_CAMPAIGN_MODULE)
    # Exclude recommendation board from first-slice skill pack
    skill_ids = [s.skill_id for s in create_skills]
    skill_hints = "\n".join(
        f"- {s.skill_id} (executor={s.executor_id}): {s.description}" for s in create_skills
    )
    store = SkillStateStore()
    skill_state_block = ""
    if session:
        skill_state_block = store.summary_for_prompt(session, CREATE_CAMPAIGN_MODULE)

    runtime = (
        "You are the Creation Domain Agent.\n"
        "Follow creation/agent.md playbook: conversational gates for meta, channels, generate confirm, "
        "audience, launch. Read live_session_facts + chat memory.\n"
        "Choose exactly one tool:\n"
        "- invoke_executor for brief / audience / templates / recommendations / launch / knowledge inside Creation\n"
        "- request_domain_handoff for Content (template coach, WA approved), "
        "Image (standalone generate/refine/attach on existing templates), or "
        "Audience (CRM search/bulk outside this campaign) only when clearly not create-campaign work\n"
        "When executor_id is brief_validation, campaign_audience, campaign_content, or launch_scheduling, "
        "also set skill_id and skill_action. Keep active skill on continue; switch when the gate changes.\n"
        f"Create-campaign skill state:\n{skill_state_block or '(none)'}\n"
        f"Create-campaign skills:\n{skill_hints or '(none)'}\n"
        "Skill map: campaign_brief→brief_validation; campaign_audience→campaign_audience; "
        "campaign_templates→campaign_content; campaign_launch→launch_scheduling.\n"
        "For recommendation board (module recommendations) use executor recommendation and omit skill_id.\n"
        f"Creation executors:\n{hints}\n"
        "Do NOT invoke campaign_content unless user asked to generate templates this turn or confirmed yes.\n"
        "When create_campaign_state shows templates_ready=true and the user asks to launch/send/schedule, "
        "invoke_executor launch_scheduling with skill campaign_launch (NOT campaign_content).\n"
        "templates_ready=true does NOT skip generate/regenerate — invoke campaign_content or "
        "email_html_compose again; do not paste a prior success message.\n"
        f"{CREATION_NO_BARE_SUCCESS}\n"
        "After meta saved with empty channels → brief_validation / campaign_brief and ask channels.\n"
        "For combined template + hero image requests, use invoke_executor campaign_content — "
        "NOT request_domain_handoff to image until templates exist.\n"
        f"Default executor if the ask is normal create-campaign setup: {default_executor}."
    )
    if session:
        runtime = runtime + "\n\n" + creation_pipeline_context(session)
    system = system_from_package(package_dir, runtime_context=runtime)
    invoke_tool = {
        "type": "function",
        "function": {
            **INVOKE_EXECUTOR_TOOL["function"],
            "parameters": {
                **INVOKE_EXECUTOR_TOOL["function"]["parameters"],
                "properties": {
                    **INVOKE_EXECUTOR_TOOL["function"]["parameters"]["properties"],
                    "executor_id": {
                        "type": "string",
                        "enum": sorted(allowed),
                    },
                    "skill_id": {
                        "type": "string",
                        "enum": skill_ids,
                        "description": (
                            "Required when executor is brief_validation, campaign_audience, "
                            "campaign_content, or launch_scheduling."
                        ),
                    },
                    "skill_action": {
                        "type": "string",
                        "enum": sorted(SKILL_ACTIONS),
                        "description": (
                            "Required with skill_id for create-campaign stage executors."
                        ),
                    },
                },
            },
        },
    }
    handoff_tool = {
        "type": "function",
        "function": {
            **REQUEST_DOMAIN_HANDOFF_TOOL["function"],
            "parameters": {
                **REQUEST_DOMAIN_HANDOFF_TOOL["function"]["parameters"],
                "properties": {
                    **REQUEST_DOMAIN_HANDOFF_TOOL["function"]["parameters"]["properties"],
                    "domain_id": {
                        "type": "string",
                        "enum": ["audience", "content", "image"],
                    },
                },
            },
        },
    }
    routed = await run_single_tool_routing_loop(
        system_prompt=system,
        user_text=query,
        tools=[invoke_tool, handoff_tool],
        allowed_tool_names=frozenset({"invoke_executor", "request_domain_handoff"}),
        max_rounds=2,
        prior_turns=recent_routing_history(session) if session else None,
        allow_direct_reply=True,
    )
    if not routed.get("tool_name"):
        reply = str(routed.get("content") or "").strip()
        if reply and not looks_like_stale_template_success(reply):
            return {"kind": "direct_reply", "direct_reply": reply, "llm": routed}
        # Bare assistant text copies prior "template created" success. Force a tool
        # call (no chat history) so generate/regenerate actually runs Phase 2.
        routed = await run_single_tool_routing_loop(
            system_prompt=system,
            user_text=creation_force_tool_query(query),
            tools=[invoke_tool, handoff_tool],
            allowed_tool_names=frozenset({"invoke_executor", "request_domain_handoff"}),
            max_rounds=2,
            prior_turns=None,
            allow_direct_reply=False,
        )
    if not routed.get("ok") or not routed.get("tool_name"):
        sid = default_skill_for_executor(default_executor) or "campaign_brief"
        return {
            "kind": "executor",
            "executor_id": default_executor,
            "skill_id": sid,
            "skill_action": "continue",
            "llm": routed,
        }
    name = str(routed.get("tool_name") or "")
    args = dict(routed.get("tool_args") or {})
    if name == "request_domain_handoff":
        did = normalize_domain(args.get("domain_id"))
        if did in ("audience", "content", "image"):
            pref = normalize_executor(args.get("preferred_executor"))
            return {
                "kind": "needs_domain",
                "domain_id": did,
                "restated_query": str(args.get("restated_query") or query).strip(),
                "preferred_executor": pref,
                "change_summary": str(args.get("change_summary") or ""),
                "llm": routed,
            }
        sid = default_skill_for_executor(default_executor) or "campaign_brief"
        return {
            "kind": "executor",
            "executor_id": default_executor,
            "skill_id": sid,
            "skill_action": "continue",
            "llm": routed,
        }
    eid = str(args.get("executor_id") or "").strip().lower()
    if eid not in allowed:
        eid = default_executor
    out: dict[str, Any] = {
        "kind": "executor",
        "executor_id": eid,
        "restated_query": str(args.get("restated_query") or query).strip(),
        "llm": routed,
    }
    if args.get("user_confirmed") is not None:
        out["user_confirmed"] = bool(args.get("user_confirmed"))
    if eid in (
        "brief_validation",
        "campaign_audience",
        "campaign_content",
        "launch_scheduling",
    ):
        sid = str(args.get("skill_id") or "").strip().lower()
        action = str(args.get("skill_action") or "continue").strip().lower()
        if sid not in skill_ids:
            sid = default_skill_for_executor(eid) or "campaign_brief"
        skill_spec = next((s for s in create_skills if s.skill_id == sid), None)
        if skill_spec and skill_spec.executor_id != eid:
            eid = skill_spec.executor_id
            out["executor_id"] = eid
        if action not in SKILL_ACTIONS:
            action = "continue"
        out["skill_id"] = sid
        out["skill_action"] = action
    return out


def recommendation_run_pipeline_context(session: dict[str, Any] | None) -> str:
    """Factual block for recommendation-run Domain LLM routing."""
    base = creation_pipeline_context(session)
    if not isinstance(session, dict):
        return base
    rec_id = str(session.get("source_recommendation_id") or "").strip()
    why = str(session.get("recommendation_why") or "").strip()
    extra_lines = [
        "  recommendation_run: true",
        "  playbook: Recommendation Run domain — prefilled plan from selected card; "
        "edit vs run; do NOT cold-start meta.",
    ]
    if rec_id:
        extra_lines.append(f"  source_recommendation_id: {rec_id}")
    if why:
        extra_lines.append(f"  why_created: {why[:240]}")
    return base + "\n" + "\n".join(extra_lines)


async def llm_pick_recommendation_run_action(
    *,
    package_dir: Path,
    query: str,
    default_executor: str = "brief_validation",
    session: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Recommendation Run Domain LLM: invoke_executor (+ shared create skills) OR handoff."""
    from app.mas.runtime.context import recent_routing_history
    from app.mas.skills.create_campaign import (
        CREATE_CAMPAIGN_MODULE,
        default_skill_for_executor,
    )
    from app.mas.skills.registry import SKILL_ACTIONS, get_skill_registry
    from app.mas.skills.state import SkillStateStore

    allowed = frozenset(executors_for_domain("recommendation_run"))
    hints = DOMAIN_EXECUTOR_HINTS.get("recommendation_run", "")
    registry = get_skill_registry()
    create_skills = registry.list_module(CREATE_CAMPAIGN_MODULE)
    skill_ids = [s.skill_id for s in create_skills]
    skill_hints = "\n".join(
        f"- {s.skill_id} (executor={s.executor_id}): {s.description}" for s in create_skills
    )
    store = SkillStateStore()
    skill_state_block = ""
    if session:
        skill_state_block = store.summary_for_prompt(session, CREATE_CAMPAIGN_MODULE)

    runtime = (
        "You are the Recommendation Run Domain Agent.\n"
        "Follow recommendation_run/agent.md: user selected a recommendation card; panel is prefilled.\n"
        "Read live_session_facts (recommendation_run, why_created, source_recommendation_id) + chat memory.\n"
        "Choose exactly one tool:\n"
        "- invoke_executor for brief edits / audience / templates / launch inside this run\n"
        "- request_domain_handoff for Content (template coach, WA approved), "
        "Image (standalone generate/refine/attach), or Audience (CRM bulk outside this campaign)\n"
        "Always set skill_id and skill_action with invoke_executor. Keep active skill on continue; "
        "switch when the gate changes.\n"
        f"Create-campaign skill state (shared with create flow):\n{skill_state_block or '(none)'}\n"
        f"Create-campaign skills:\n{skill_hints or '(none)'}\n"
        "Skill map: campaign_brief→brief_validation; campaign_audience→campaign_audience; "
        "campaign_templates→campaign_content; campaign_launch→launch_scheduling.\n"
        "Do NOT use the recommendations board executor — that is not available here.\n"
        f"Recommendation run executors:\n{hints}\n"
        "Do NOT invoke campaign_content unless user asked to generate templates this turn or confirmed yes.\n"
        "When templates_ready=true and user asks launch/send/schedule → launch_scheduling / campaign_launch.\n"
        "Do not re-ask name/goal/objective when campaign_meta_complete unless user wants edits.\n"
        f"Default executor for plan tweaks: {default_executor}."
    )
    if session:
        runtime = runtime + "\n\n" + recommendation_run_pipeline_context(session)
    system = system_from_package(package_dir, runtime_context=runtime)
    invoke_tool = {
        "type": "function",
        "function": {
            **INVOKE_EXECUTOR_TOOL["function"],
            "parameters": {
                **INVOKE_EXECUTOR_TOOL["function"]["parameters"],
                "properties": {
                    **INVOKE_EXECUTOR_TOOL["function"]["parameters"]["properties"],
                    "executor_id": {
                        "type": "string",
                        "enum": sorted(allowed),
                    },
                    "skill_id": {
                        "type": "string",
                        "enum": skill_ids,
                        "description": (
                            "Required. campaign_brief | campaign_audience | "
                            "campaign_templates | campaign_launch."
                        ),
                    },
                    "skill_action": {
                        "type": "string",
                        "enum": sorted(SKILL_ACTIONS),
                        "description": "Required with skill_id.",
                    },
                },
            },
        },
    }
    handoff_tool = {
        "type": "function",
        "function": {
            **REQUEST_DOMAIN_HANDOFF_TOOL["function"],
            "parameters": {
                **REQUEST_DOMAIN_HANDOFF_TOOL["function"]["parameters"],
                "properties": {
                    **REQUEST_DOMAIN_HANDOFF_TOOL["function"]["parameters"]["properties"],
                    "domain_id": {
                        "type": "string",
                        "enum": ["audience", "content", "image"],
                    },
                },
            },
        },
    }
    routed = await run_single_tool_routing_loop(
        system_prompt=system,
        user_text=query,
        tools=[invoke_tool, handoff_tool],
        allowed_tool_names=frozenset({"invoke_executor", "request_domain_handoff"}),
        max_rounds=2,
        prior_turns=recent_routing_history(session) if session else None,
        allow_direct_reply=True,
    )
    if not routed.get("ok"):
        sid = default_skill_for_executor(default_executor) or "campaign_brief"
        return {
            "kind": "executor",
            "executor_id": default_executor,
            "skill_id": sid,
            "skill_action": "continue",
        }
    if not routed.get("tool_name"):
        reply = str(routed.get("content") or "").strip()
        if reply:
            return {"kind": "direct_reply", "direct_reply": reply, "llm": routed}
        sid = default_skill_for_executor(default_executor) or "campaign_brief"
        return {
            "kind": "executor",
            "executor_id": default_executor,
            "skill_id": sid,
            "skill_action": "continue",
            "llm": routed,
        }
    name = str(routed.get("tool_name") or "")
    args = dict(routed.get("tool_args") or {})
    if name == "request_domain_handoff":
        did = normalize_domain(args.get("domain_id"))
        if did in ("audience", "content", "image"):
            pref = normalize_executor(args.get("preferred_executor"))
            return {
                "kind": "needs_domain",
                "domain_id": did,
                "restated_query": str(args.get("restated_query") or query).strip(),
                "preferred_executor": pref,
                "change_summary": str(args.get("change_summary") or ""),
                "llm": routed,
            }
        sid = default_skill_for_executor(default_executor) or "campaign_brief"
        return {
            "kind": "executor",
            "executor_id": default_executor,
            "skill_id": sid,
            "skill_action": "continue",
            "llm": routed,
        }
    eid = str(args.get("executor_id") or "").strip().lower()
    if eid not in allowed:
        eid = default_executor
    out: dict[str, Any] = {
        "kind": "executor",
        "executor_id": eid,
        "restated_query": str(args.get("restated_query") or query).strip(),
        "llm": routed,
    }
    if args.get("user_confirmed") is not None:
        out["user_confirmed"] = bool(args.get("user_confirmed"))
    sid = str(args.get("skill_id") or "").strip().lower()
    action = str(args.get("skill_action") or "continue").strip().lower()
    if sid not in skill_ids:
        sid = default_skill_for_executor(eid) or "campaign_brief"
    skill_spec = next((s for s in create_skills if s.skill_id == sid), None)
    if skill_spec and skill_spec.executor_id != eid:
        eid = skill_spec.executor_id
        out["executor_id"] = eid
    if action not in SKILL_ACTIONS:
        action = "continue"
    out["skill_id"] = sid
    out["skill_action"] = action
    return out


def whatsapp_approved_run_pipeline_context(session: dict[str, Any] | None) -> str:
    """Factual block for approved WhatsApp run Domain LLM routing."""
    base = creation_pipeline_context(session)
    if not isinstance(session, dict):
        return base
    snap = session.get("whatsapp_template_snapshot")
    tpl_name = ""
    if isinstance(snap, dict):
        tpl_name = str(snap.get("name") or "").strip()
    extra_lines = [
        "  whatsapp_approved_run: true",
        "  templates_finalized: true (approved Meta template — send as-is, do not submit for approval)",
        "  playbook: campaign_audience (check_contacts) then launch_scheduling (launch_campaign)",
        "  now: send selected contacts immediately",
        "  future: store the time; a 30-minute check starts sending when that time is due or already passed",
    ]
    if tpl_name:
        extra_lines.append(f"  approved_template_name: {tpl_name[:120]}")
    return base + "\n" + "\n".join(extra_lines)


async def llm_pick_whatsapp_approved_run_action(
    *,
    package_dir: Path,
    query: str,
    default_executor: str = "campaign_audience",
    session: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """WhatsApp Approved Run Domain LLM: invoke_executor (+ skills) OR handoff."""
    from app.mas.runtime.context import recent_routing_history
    from app.mas.skills.create_campaign import (
        CREATE_CAMPAIGN_MODULE,
        default_skill_for_executor as create_default_skill,
    )
    from app.mas.skills.registry import SKILL_ACTIONS, get_skill_registry
    from app.mas.skills.state import SkillStateStore

    allowed = frozenset(executors_for_domain("whatsapp_approved_run"))
    hints = DOMAIN_EXECUTOR_HINTS.get("whatsapp_approved_run", "")
    registry = get_skill_registry()
    create_skills = [
        s
        for s in registry.list_module(CREATE_CAMPAIGN_MODULE)
        if s.skill_id in {"campaign_brief", "campaign_audience", "campaign_launch"}
        and s.executor_id in allowed
    ]
    skill_ids = [s.skill_id for s in create_skills]
    skill_hints = "\n".join(
        f"- {s.skill_id} (executor={s.executor_id}): {s.description}"
        for s in create_skills
    )
    store = SkillStateStore()
    skill_state_block = ""
    if session:
        skill_state_block = store.summary_for_prompt(session, CREATE_CAMPAIGN_MODULE)

    runtime = (
        "You are the WhatsApp Approved Run Domain Agent.\n"
        "Follow whatsapp_approved_run/agent.md.\n"
        "The template is already Meta-approved. Do not generate copy and do not submit for approval.\n"
        "Audience and launch use the same create-campaign executors and tools.\n"
        "Choose exactly one tool:\n"
        "- invoke_executor for brief / audience / launch inside this run\n"
        "- request_domain_handoff for Content (rejected fix) or Audience (CRM bulk outside this campaign)\n"
        "Always set skill_id and skill_action with invoke_executor.\n"
        "Skills: campaign_brief, campaign_audience, campaign_launch only.\n"
        "Named email, phone, or person → campaign_audience (check_contacts before create).\n"
        "If they also say launch but audience is not matched, still pick campaign_audience this turn.\n"
        "Explicit confirm to send now or at a future time, after audience is matched → launch_scheduling.\n"
        "Do not pick whatsapp_approved_send or campaign_content.\n"
        f"Skill state:\n{skill_state_block or '(none)'}\n"
        f"Skills:\n{skill_hints or '(none)'}\n"
        f"Executors:\n{hints}\n"
        f"Default executor: {default_executor}."
    )
    if session:
        runtime = runtime + "\n\n" + whatsapp_approved_run_pipeline_context(session)
    system = system_from_package(package_dir, runtime_context=runtime)
    invoke_tool = {
        "type": "function",
        "function": {
            **INVOKE_EXECUTOR_TOOL["function"],
            "parameters": {
                **INVOKE_EXECUTOR_TOOL["function"]["parameters"],
                "properties": {
                    **INVOKE_EXECUTOR_TOOL["function"]["parameters"]["properties"],
                    "executor_id": {
                        "type": "string",
                        "enum": sorted(allowed),
                    },
                    "skill_id": {
                        "type": "string",
                        "enum": skill_ids,
                        "description": (
                            "Required. campaign_brief | campaign_audience | campaign_launch."
                        ),
                    },
                    "skill_action": {
                        "type": "string",
                        "enum": sorted(SKILL_ACTIONS),
                        "description": "Required with skill_id.",
                    },
                },
            },
        },
    }
    handoff_tool = {
        "type": "function",
        "function": {
            **REQUEST_DOMAIN_HANDOFF_TOOL["function"],
            "parameters": {
                **REQUEST_DOMAIN_HANDOFF_TOOL["function"]["parameters"],
                "properties": {
                    **REQUEST_DOMAIN_HANDOFF_TOOL["function"]["parameters"]["properties"],
                    "domain_id": {
                        "type": "string",
                        "enum": ["audience", "content"],
                    },
                },
            },
        },
    }
    routed = await run_single_tool_routing_loop(
        system_prompt=system,
        user_text=query,
        tools=[invoke_tool, handoff_tool],
        allowed_tool_names=frozenset({"invoke_executor", "request_domain_handoff"}),
        max_rounds=2,
        prior_turns=recent_routing_history(session) if session else None,
        allow_direct_reply=True,
    )
    if not routed.get("ok"):
        sid = create_default_skill(default_executor) or "campaign_audience"
        return {
            "kind": "executor",
            "executor_id": default_executor,
            "skill_id": sid,
            "skill_action": "continue",
        }
    if not routed.get("tool_name"):
        reply = str(routed.get("content") or "").strip()
        if reply:
            return {"kind": "direct_reply", "direct_reply": reply, "llm": routed}
        sid = create_default_skill(default_executor) or "campaign_audience"
        return {
            "kind": "executor",
            "executor_id": default_executor,
            "skill_id": sid,
            "skill_action": "continue",
            "llm": routed,
        }
    name = str(routed.get("tool_name") or "")
    args = dict(routed.get("tool_args") or {})
    if name == "request_domain_handoff":
        did = normalize_domain(args.get("domain_id"))
        if did in ("audience", "content"):
            pref = normalize_executor(args.get("preferred_executor"))
            return {
                "kind": "needs_domain",
                "domain_id": did,
                "restated_query": str(args.get("restated_query") or query).strip(),
                "preferred_executor": pref,
                "change_summary": str(args.get("change_summary") or ""),
                "llm": routed,
            }
        sid = create_default_skill(default_executor) or "campaign_audience"
        return {
            "kind": "executor",
            "executor_id": default_executor,
            "skill_id": sid,
            "skill_action": "continue",
            "llm": routed,
        }
    eid = str(args.get("executor_id") or "").strip().lower()
    if eid not in allowed:
        eid = default_executor
    out: dict[str, Any] = {
        "kind": "executor",
        "executor_id": eid,
        "restated_query": str(args.get("restated_query") or query).strip(),
        "llm": routed,
    }
    if args.get("user_confirmed") is not None:
        out["user_confirmed"] = bool(args.get("user_confirmed"))
    sid = str(args.get("skill_id") or "").strip().lower()
    action = str(args.get("skill_action") or "continue").strip().lower()
    all_specs = create_skills
    if sid not in skill_ids:
        sid = create_default_skill(eid) or "campaign_audience"
    skill_spec = next((s for s in all_specs if s.skill_id == sid), None)
    if skill_spec and skill_spec.executor_id != eid:
        eid = skill_spec.executor_id
        out["executor_id"] = eid
    if action not in SKILL_ACTIONS:
        action = "continue"
    out["skill_id"] = sid
    out["skill_action"] = action
    return out


def library_run_pipeline_context(session: dict[str, Any] | None) -> str:
    """Factual block for library-run Domain LLM routing."""
    base = creation_pipeline_context(session)
    if not isinstance(session, dict):
        return base
    baseline = session.get("library_baseline")
    if not isinstance(baseline, dict):
        baseline = {}
    selected = baseline.get("channels_selected") or []
    missing = baseline.get("channels_missing") or []
    n_tpl = len(baseline.get("templates") or session.get("selected_library_templates") or [])
    extra_lines = [
        "  library_run: true",
        "  playbook: Library Run domain — creative baseline from Template Library; "
        "align intent/scope; mutate creatives only with clear direction.",
        f"  library_baseline_template_count: {n_tpl}",
        f"  library_channels_selected: {selected}",
        f"  library_channels_missing: {missing}",
    ]
    return base + "\n" + "\n".join(extra_lines)


async def llm_pick_library_run_action(
    *,
    package_dir: Path,
    query: str,
    default_executor: str = "brief_validation",
    session: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Library Run Domain LLM: invoke_executor (+ library_* skills) OR handoff."""
    from app.mas.runtime.context import recent_routing_history
    from app.mas.skills.library_run import (
        LIBRARY_RUN_MODULE,
        default_library_skill_for_executor,
    )
    from app.mas.skills.registry import SKILL_ACTIONS, get_skill_registry
    from app.mas.skills.state import SkillStateStore

    allowed = frozenset(executors_for_domain("library_run"))
    hints = DOMAIN_EXECUTOR_HINTS.get("library_run", "")
    registry = get_skill_registry()
    lib_skills = registry.list_module(LIBRARY_RUN_MODULE)
    skill_ids = [s.skill_id for s in lib_skills]
    skill_hints = "\n".join(
        f"- {s.skill_id} (executor={s.executor_id}): {s.description}" for s in lib_skills
    )
    store = SkillStateStore()
    skill_state_block = ""
    if session:
        skill_state_block = store.summary_for_prompt(session, LIBRARY_RUN_MODULE)

    runtime = (
        "You are the Library Run Domain Agent.\n"
        "Follow library_run/agent.md: user started from Template Library selection(s).\n"
        "Read live_session_facts (library_run, library_baseline) + chat memory.\n"
        "Choose exactly one tool:\n"
        "- invoke_executor for brief / audience / templates / launch inside this run\n"
        "- request_domain_handoff for Content, Image (standalone), or Audience (CRM bulk)\n"
        "Always set skill_id to a library_* skill and skill_action with invoke_executor.\n"
        f"Library-run skill state:\n{skill_state_block or '(none)'}\n"
        f"Library-run skills:\n{skill_hints or '(none)'}\n"
        "Skill map: library_brief→brief_validation; library_audience→campaign_audience; "
        "library_templates→campaign_content; library_launch→launch_scheduling.\n"
        "Never use create_campaign skill ids (campaign_brief, …).\n"
        f"Library run executors:\n{hints}\n"
        "Do NOT invoke campaign_content unless user asked to adopt/adapt/fill/generate "
        "this turn or confirmed yes.\n"
        "When templates_ready=true and user asks launch/send/schedule → "
        "launch_scheduling / library_launch.\n"
        f"Default executor for intent/scope: {default_executor}."
    )
    if session:
        runtime = runtime + "\n\n" + library_run_pipeline_context(session)
    system = system_from_package(package_dir, runtime_context=runtime)
    invoke_tool = {
        "type": "function",
        "function": {
            **INVOKE_EXECUTOR_TOOL["function"],
            "parameters": {
                **INVOKE_EXECUTOR_TOOL["function"]["parameters"],
                "properties": {
                    **INVOKE_EXECUTOR_TOOL["function"]["parameters"]["properties"],
                    "executor_id": {
                        "type": "string",
                        "enum": sorted(allowed),
                    },
                    "skill_id": {
                        "type": "string",
                        "enum": skill_ids,
                        "description": (
                            "Required. library_brief | library_audience | "
                            "library_templates | library_launch."
                        ),
                    },
                    "skill_action": {
                        "type": "string",
                        "enum": sorted(SKILL_ACTIONS),
                        "description": "Required with skill_id.",
                    },
                },
            },
        },
    }
    handoff_tool = {
        "type": "function",
        "function": {
            **REQUEST_DOMAIN_HANDOFF_TOOL["function"],
            "parameters": {
                **REQUEST_DOMAIN_HANDOFF_TOOL["function"]["parameters"],
                "properties": {
                    **REQUEST_DOMAIN_HANDOFF_TOOL["function"]["parameters"]["properties"],
                    "domain_id": {
                        "type": "string",
                        "enum": ["audience", "content", "image"],
                    },
                },
            },
        },
    }
    routed = await run_single_tool_routing_loop(
        system_prompt=system,
        user_text=query,
        tools=[invoke_tool, handoff_tool],
        allowed_tool_names=frozenset({"invoke_executor", "request_domain_handoff"}),
        max_rounds=2,
        prior_turns=recent_routing_history(session) if session else None,
        allow_direct_reply=True,
    )
    if not routed.get("ok"):
        sid = default_library_skill_for_executor(default_executor) or "library_brief"
        return {
            "kind": "executor",
            "executor_id": default_executor,
            "skill_id": sid,
            "skill_action": "continue",
        }
    if not routed.get("tool_name"):
        reply = str(routed.get("content") or "").strip()
        if reply:
            return {"kind": "direct_reply", "direct_reply": reply, "llm": routed}
        sid = default_library_skill_for_executor(default_executor) or "library_brief"
        return {
            "kind": "executor",
            "executor_id": default_executor,
            "skill_id": sid,
            "skill_action": "continue",
            "llm": routed,
        }
    name = str(routed.get("tool_name") or "")
    args = dict(routed.get("tool_args") or {})
    if name == "request_domain_handoff":
        did = normalize_domain(args.get("domain_id"))
        if did in ("audience", "content", "image"):
            pref = normalize_executor(args.get("preferred_executor"))
            return {
                "kind": "needs_domain",
                "domain_id": did,
                "restated_query": str(args.get("restated_query") or query).strip(),
                "preferred_executor": pref,
                "change_summary": str(args.get("change_summary") or ""),
                "llm": routed,
            }
        sid = default_library_skill_for_executor(default_executor) or "library_brief"
        return {
            "kind": "executor",
            "executor_id": default_executor,
            "skill_id": sid,
            "skill_action": "continue",
            "llm": routed,
        }
    eid = str(args.get("executor_id") or "").strip().lower()
    if eid not in allowed:
        eid = default_executor
    out: dict[str, Any] = {
        "kind": "executor",
        "executor_id": eid,
        "restated_query": str(args.get("restated_query") or query).strip(),
        "llm": routed,
    }
    if args.get("user_confirmed") is not None:
        out["user_confirmed"] = bool(args.get("user_confirmed"))
    sid = str(args.get("skill_id") or "").strip().lower()
    action = str(args.get("skill_action") or "continue").strip().lower()
    if sid not in skill_ids:
        sid = default_library_skill_for_executor(eid) or "library_brief"
    skill_spec = next((s for s in lib_skills if s.skill_id == sid), None)
    if skill_spec and skill_spec.executor_id != eid:
        eid = skill_spec.executor_id
        out["executor_id"] = eid
    if action not in SKILL_ACTIONS:
        action = "continue"
    out["skill_id"] = sid
    out["skill_action"] = action
    return out


async def llm_pick_content_executor(
    *,
    package_dir: Path,
    query: str,
    session: dict[str, Any] | None = None,
    module_hint: str = "",
    task_spec: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Content Domain: invoke_executor for channel / WA / coach executors."""
    from app.mas.runtime.context import build_mas_runtime_context

    allowed = frozenset(executors_for_domain("content"))
    if not allowed:
        return {"ok": False, "error": "No content executors configured"}

    spec = dict(task_spec or {})
    hint = str(module_hint or spec.get("module") or "").strip().lower()
    if hint == "whatsapp_approved":
        return {
            "ok": True,
            "executor_id": "whatsapp_approved_send",
            "restated_query": query,
            "change_summary": "module_hint=whatsapp_approved",
        }
    if hint == "whatsapp_rejected":
        return {
            "ok": True,
            "executor_id": "content_verification",
            "restated_query": query,
            "change_summary": "module_hint=whatsapp_rejected",
        }
    if hint == "template_coach":
        return {
            "ok": True,
            "executor_id": "template_coach",
            "restated_query": query,
            "change_summary": "module_hint=template_coach",
        }

    hints = DOMAIN_EXECUTOR_HINTS.get("content", "")
    runtime = build_mas_runtime_context(session, module_hint=module_hint)
    runtime += (
        "\n\nYou are the Content Domain Agent. Pick exactly one executor via invoke_executor.\n"
        "Use channel executors for template generation; whatsapp_approved_send for sending "
        "approved templates; content_verification for rejected WA fix; template_coach for "
        "manual edits. Route image requests to the Image domain via Super — not here.\n"
        f"Allowed executors:\n{hints}"
    )
    system = system_from_package(package_dir, runtime_context=runtime)
    tool = {
        "type": "function",
        "function": {
            **INVOKE_EXECUTOR_TOOL["function"],
            "parameters": {
                **INVOKE_EXECUTOR_TOOL["function"]["parameters"],
                "properties": {
                    **INVOKE_EXECUTOR_TOOL["function"]["parameters"]["properties"],
                    "executor_id": {
                        "type": "string",
                        "enum": sorted(allowed),
                    },
                },
            },
        },
    }
    routed = await run_single_tool_routing_loop(
        system_prompt=system,
        user_text=query,
        tools=[tool],
        allowed_tool_names=frozenset({"invoke_executor"}),
        max_rounds=2,
    )
    if not routed.get("ok"):
        return {
            "ok": True,
            "executor_id": "email_content",
            "restated_query": query,
            "llm": routed,
        }
    args = routed.get("tool_args") or {}
    eid = str(args.get("executor_id") or "").strip().lower()
    if eid not in allowed:
        return {
            "ok": False,
            "error": f"Invalid executor {eid!r} from Domain LLM",
            "llm": routed,
        }
    return {
        "ok": True,
        "executor_id": eid,
        "restated_query": str(args.get("restated_query") or query).strip(),
        "change_summary": str(args.get("change_summary") or ""),
        "llm": routed,
    }


async def llm_pick_forms_executor(
    *,
    package_dir: Path,
    query: str,
    session: dict[str, Any] | None = None,
    module_hint: str = "",
    task_spec: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Forms Domain: invoke_executor for theme / fields / design."""
    from app.mas.runtime.context import build_mas_runtime_context

    allowed = frozenset(executors_for_domain("forms"))
    if not allowed:
        return {"ok": False, "error": "No forms executors configured"}

    hints = DOMAIN_EXECUTOR_HINTS.get("forms", "")
    runtime = build_mas_runtime_context(session, module_hint=module_hint)
    runtime += (
        "\n\nYou are the Forms Domain Agent. Pick exactly one executor via invoke_executor.\n"
        "Use form_theme for colors/style; form_fields for field structure/copy; "
        "form_design for full redesign.\n"
        f"Allowed executors:\n{hints}"
    )
    system = system_from_package(package_dir, runtime_context=runtime)
    tool = {
        "type": "function",
        "function": {
            **INVOKE_EXECUTOR_TOOL["function"],
            "parameters": {
                **INVOKE_EXECUTOR_TOOL["function"]["parameters"],
                "properties": {
                    **INVOKE_EXECUTOR_TOOL["function"]["parameters"]["properties"],
                    "executor_id": {
                        "type": "string",
                        "enum": sorted(allowed),
                    },
                },
            },
        },
    }
    routed = await run_single_tool_routing_loop(
        system_prompt=system,
        user_text=query,
        tools=[tool],
        allowed_tool_names=frozenset({"invoke_executor"}),
        max_rounds=2,
    )
    if not routed.get("ok"):
        return {
            "ok": True,
            "executor_id": "form_theme",
            "restated_query": query,
            "llm": routed,
        }
    args = routed.get("tool_args") or {}
    eid = str(args.get("executor_id") or "").strip().lower()
    if eid not in allowed:
        return {
            "ok": False,
            "error": f"Invalid executor {eid!r} from Domain LLM",
            "llm": routed,
        }
    return {
        "ok": True,
        "executor_id": eid,
        "restated_query": str(args.get("restated_query") or query).strip(),
        "change_summary": str(args.get("change_summary") or ""),
        "llm": routed,
    }


async def llm_pick_image_executor(
    *,
    package_dir: Path,
    query: str,
    session: dict[str, Any] | None = None,
    module_hint: str = "",
    task_spec: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Image Domain: invoke_executor for generate / refine / attach."""
    from app.mas.runtime.context import build_mas_runtime_context

    allowed = frozenset(executors_for_domain("image"))
    if not allowed:
        return {"ok": False, "error": "No image executors configured"}

    hints = DOMAIN_EXECUTOR_HINTS.get("image", "")
    runtime = build_mas_runtime_context(session, module_hint=module_hint)
    runtime += (
        "\n\nYou are the Image Domain Agent. Pick exactly one executor via invoke_executor.\n"
        "Use image_generate for new assets (the executor asks what to generate if the "
        "idea is thin, enhances, then waits for confirm before Gemini); "
        "image_refine to edit the last image; "
        "image_attach when attaching one URL to one template; "
        "campaign_images for multi-channel plan/generate/attach (shared or per_channel).\n"
        "Do not invent a visual from campaign name to skip asking.\n"
        f"Allowed executors:\n{hints}"
    )
    system = system_from_package(package_dir, runtime_context=runtime)
    tool = {
        "type": "function",
        "function": {
            **INVOKE_EXECUTOR_TOOL["function"],
            "parameters": {
                **INVOKE_EXECUTOR_TOOL["function"]["parameters"],
                "properties": {
                    **INVOKE_EXECUTOR_TOOL["function"]["parameters"]["properties"],
                    "executor_id": {
                        "type": "string",
                        "enum": sorted(allowed),
                    },
                },
            },
        },
    }
    routed = await run_single_tool_routing_loop(
        system_prompt=system,
        user_text=query,
        tools=[tool],
        allowed_tool_names=frozenset({"invoke_executor"}),
        max_rounds=2,
    )
    if not routed.get("ok"):
        return {
            "ok": True,
            "executor_id": "image_generate",
            "restated_query": query,
            "llm": routed,
        }
    args = routed.get("tool_args") or {}
    eid = str(args.get("executor_id") or "").strip().lower()
    if eid not in allowed:
        return {
            "ok": False,
            "error": f"Invalid executor {eid!r} from Domain LLM",
            "llm": routed,
        }
    return {
        "ok": True,
        "executor_id": eid,
        "restated_query": str(args.get("restated_query") or query).strip(),
        "change_summary": str(args.get("change_summary") or ""),
        "llm": routed,
    }


__all__ = [
    "llm_pick_audience_executor",
    "llm_pick_content_executor",
    "llm_pick_creation_action",
    "llm_pick_recommendation_run_action",
    "llm_pick_whatsapp_approved_run_action",
    "llm_pick_library_run_action",
    "llm_pick_forms_executor",
    "llm_pick_image_executor",
    "llm_pick_optimization_executor",
    "llm_pick_executor",
    "mas_llm",
    "run_single_tool_routing_loop",
    "system_from_package",
]
