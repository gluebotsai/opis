"""Domain turn: plan, SQL, free SQL on a metric miss, HTML brief. No UI. No graph."""

from __future__ import annotations

import json
import re
from typing import Any, Callable

from .context import load_skill
from .facts import assemble_facts
from .grounding import apply_grounding
from .llm import call_llm as default_call_llm
from .sql.executor import execute_sql_task

CallLLM = Callable[[list[dict[str, str]], float, int], str]

DOMAIN_PROMPT = "domain/agent.md"
BRIEF_SKILL = "skills/cc-user-brief/SKILL.md"

_HIDE = re.compile(
    r"kpi_not_found|certified kpi|not in the .{0,40}catalog|warehouse metric|"
    r"available kpi|pick one metric",
    re.IGNORECASE,
)
_MISSING_MEASURE = re.compile(
    r"kpi_not_found|kpi is not in the certified|no card|not in contact center reports",
    re.IGNORECASE,
)
_CARD = re.compile(r"^card:\s*(none|kpi|bar|table)(?:\s+r\d+)?\s*$", re.IGNORECASE)


def extract_json(text: str) -> dict[str, Any]:
    clean = (text or "").strip()
    if "{" in clean and "}" in clean:
        clean = clean[clean.find("{") : clean.rfind("}") + 1]
    try:
        parsed = json.loads(clean)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def validate_plan(plan: dict[str, Any]) -> str | None:
    if str(plan.get("kind") or "") == "chat":
        return None
    tasks = plan.get("tasks") or []
    if str(plan.get("ask_user") or "").strip() and not tasks:
        return None
    if not isinstance(tasks, list) or not tasks:
        return "plan must contain tasks"
    if len(tasks) > 2:
        return "plan may have at most two tasks"
    for task in tasks:
        if not isinstance(task, dict):
            return "each task must be an object"
        task.pop("kpi", None)
        task.pop("kpi_id", None)
        task.pop("sql", None)
        task.pop("cypher", None)
        executor = str(task.get("executor") or "sql").strip().lower()
        if executor != "sql":
            return "executor must be sql. The graph executor is not connected."
        task["executor"] = executor
        if not str(task.get("goal") or "").strip():
            return "each task needs a goal in plain language"
    return None


def public_facts(text: str) -> str:
    lines = [line for line in (text or "").splitlines() if line.strip() and not _HIDE.search(line)]
    body = "\n".join(lines).strip()
    return body or "RESULT: 0 rows"


def split_brief(text: str) -> tuple[str, str]:
    raw = (text or "").strip()
    if "```" in raw:
        raw = raw.replace("```html", "").replace("```", "").strip()
    lines = raw.splitlines()
    card = "card: none"
    while lines and not lines[-1].strip():
        lines.pop()
    if lines and _CARD.match(lines[-1].strip()):
        card = lines[-1].strip()
        lines = lines[:-1]
    html = "\n".join(lines).strip()
    return html, card


def html_from_facts(facts: str) -> str:
    """Last-resort HTML that only repeats figures already in facts."""
    items: list[str] = []
    for line in public_facts(facts).splitlines():
        if line.startswith("row ") or line.startswith("row_count"):
            items.append(line.split(":", 1)[-1].strip())
    facts_text = public_facts(facts)
    if "UNAVAILABLE" in facts_text:
        reason = ""
        for line in facts_text.splitlines():
            if line.startswith("reason:"):
                reason = line.split(":", 1)[-1].strip()
                break
        body = reason or "That measure is not in Contact Center reports."
        return (
            "<p><strong>That measure is not available</strong></p>"
            f"<p>{body}</p>"
            "<p>Would you like conversation volume, a rate we do report, or a list of conversations?</p>"
        )
    if not items:
        return (
            "<p><strong>Nothing matched that question</strong></p>"
            "<p>No rows came back for this window and scope.</p>"
            "<p>Want the same question for the last 7 days?</p>"
        )
    lis = "".join(f"<li>{item}</li>" for item in items[:8])
    return (
        "<p><strong>What came back</strong></p>"
        f"<ul>{lis}</ul>"
        "<p>Want this broken down another way?</p>"
    )


def _prefix(result_id: str, facts: str) -> str:
    body = public_facts(facts)
    return f"result_id: {result_id}\n{body}"


def run_turn(
    *,
    question: str,
    organization_id: int,
    user_id: int,
    role: str,
    dsn: str,
    queue_ids: list[int] | None = None,
    time_phrase: str | None = None,
    recent_turns: list[dict[str, str]] | None = None,
    call_llm: CallLLM | None = None,
    sql_runner: Callable[..., dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """One reports turn. Streamlit and the spoke both call this."""
    llm = call_llm or default_call_llm
    sql_run = sql_runner or execute_sql_task
    queue_ids = list(queue_ids or [])
    identity = {
        "organization_id": organization_id,
        "user_id": user_id,
        "role": role,
        "queue_ids": queue_ids,
        "time_phrase": time_phrase or "",
        "timezone": "UTC",
    }
    trace: dict[str, Any] = {"identity": identity, "question": question}
    domain = load_skill(DOMAIN_PROMPT)

    plan_user: dict[str, Any] = {"mode": "plan", "identity": identity, "question": question}
    if recent_turns:
        plan_user["recent_turns"] = recent_turns[-4:]
    try:
        plan = extract_json(llm([
            {"role": "system", "content": domain},
            {"role": "user", "content": json.dumps(plan_user)},
        ], 0.5, 1200))
    except Exception as exc:
        html = f"<p><strong>The planner could not run</strong></p><p>{exc}</p>"
        trace["error"] = str(exc)
        return {"answer": html, "card": "card: none", "trace": trace, "facts": "", "grounded": True}
    verr = validate_plan(plan)
    if verr:
        plan_user["replan"] = verr
        plan = extract_json(llm([
            {"role": "system", "content": domain},
            {"role": "user", "content": json.dumps(plan_user)},
        ], 0.5, 1200))
        verr = validate_plan(plan)
    trace["plan"] = plan
    if verr:
        html = (
            "<p><strong>I need one clearer question</strong></p>"
            "<p>Ask for a count, a rate, a list, or why a queue or conversation looks this way.</p>"
            "<p>Which of those do you want?</p>"
        )
        return {"answer": html, "card": "card: none", "trace": trace, "facts": "", "grounded": True}

    if str(plan.get("kind") or "") == "chat" or (
        str(plan.get("ask_user") or "").strip() and not (plan.get("tasks") or [])
    ):
        reply = str(plan.get("reply") or plan.get("ask_user") or "").strip()
        html, card = split_brief(reply)
        if "<p" not in html.lower():
            html = f"<p>{html or 'Ask about contact center performance.'}</p>"
            card = "card: none"
        return {"answer": html, "card": card, "trace": trace, "facts": "", "grounded": True}

    for task in plan.get("tasks") or []:
        if isinstance(task, dict) and not str(task.get("time") or "").strip():
            task["time"] = (time_phrase or "all time").strip() or "all time"

    blocks: list[str] = []
    sql_index = 0
    ran_free = False

    for task in plan.get("tasks") or []:
        result = sql_run(
            task,
            organization_id=organization_id,
            user_id=user_id,
            role=role,
            dsn=dsn,
            queue_ids=queue_ids,
            call_llm=llm,
        )
        if result.get("status") == "clarify":
            question_text = str(result.get("question") or "Which reading should I use?")
            html = f"<p><strong>One check before I answer</strong></p><p>{question_text}</p>"
            trace["clarify"] = question_text
            return {"answer": html, "card": "card: none", "trace": trace, "facts": "", "grounded": True}

        path = str(task.get("path") or "certified_metric")
        if result.get("status") == "unavailable" or result.get("unavailable"):
            # Graph is not connected. When it is, try a related KG task here before briefing unavailable.
            trace["unavailable"] = True
        elif (
            path == "certified_metric"
            and result.get("status") == "error"
            and result.get("error_type") != "DENY"
            and not ran_free
        ):
            err = str(result.get("error") or "")
            if _MISSING_MEASURE.search(err):
                result = {
                    "status": "unavailable",
                    "unavailable": True,
                    "reason": "That measure is not in Contact Center reports.",
                    "certified": False,
                    "rows": [],
                }
                trace["unavailable"] = True
            else:
                free_task = dict(task)
                free_task["path"] = "free_sql"
                free_task["executor"] = "sql"
                result = sql_run(
                    free_task,
                    organization_id=organization_id,
                    user_id=user_id,
                    role=role,
                    dsn=dsn,
                    queue_ids=queue_ids,
                    call_llm=llm,
                )
                ran_free = True
                trace["free_sql_fallback"] = True

        sql_index += 1
        result_id = f"r{sql_index}"
        facts = result.get("facts") or assemble_facts(
            result,
            task_goal=str(task.get("goal") or ""),
            kpi_id=result.get("kpi_id"),
            answer_type=str(task.get("answer_type") or ""),
            time_echo=result.get("time_echo") or "",
        )
        blocks.append(_prefix(result_id, facts))
        trace.setdefault("sql", []).append(
            {
                "result_id": result_id,
                "status": result.get("status"),
                "error_type": result.get("error_type"),
                "certified": result.get("certified"),
                "kpi_id": result.get("kpi_id"),
                "row_count": len(result.get("rows") or []),
            }
        )

    facts = "\n\n".join(blocks)
    trace["facts"] = facts
    brief_raw = llm(
        [
            {"role": "system", "content": domain + "\n\n" + load_skill(BRIEF_SKILL)},
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "mode": "brief",
                        "identity": identity,
                        "question": question,
                        "plan": plan,
                        "facts": facts,
                    }
                ),
            },
        ],
        0.5,
        4096,
    )

    def _regen(_prev: str, ungrounded: list[str]) -> str:
        return llm(
            [
                {"role": "system", "content": domain + "\n\n" + load_skill(BRIEF_SKILL)},
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "mode": "brief",
                            "identity": identity,
                            "question": question,
                            "facts": facts,
                            "ungrounded": ungrounded,
                            "instruction": "Rewrite the HTML using only numbers present in facts.",
                        }
                    ),
                },
            ],
            0.5,
            4096,
        )

    html_try, card_try = split_brief(brief_raw)
    grounded = apply_grounding(html_try, facts, regenerate_fn=_regen)
    if grounded.get("fallback") == "facts_only":
        answer = html_from_facts(facts)
        card = "card: none"
    elif grounded.get("attempts") == 1:
        answer, card = html_try, card_try
    else:
        answer, card = split_brief(str(grounded.get("answer") or ""))
        if not answer:
            answer = html_from_facts(facts)
            card = "card: none"
    trace["grounded"] = bool(grounded.get("grounded")) or grounded.get("fallback") == "facts_only"
    trace["card"] = card
    return {
        "answer": answer,
        "card": card,
        "trace": trace,
        "facts": facts,
        "grounded": trace["grounded"],
    }
