"""Ticketing pack test chat. Sidebar identity only; the pack answers.

Run from the workspace root:

    streamlit run test_streamlit/ticketing/app.py
"""

from __future__ import annotations

import datetime
import json
import sys
from pathlib import Path

import streamlit as st

APP_DIR = Path(__file__).resolve().parent
ROOT = APP_DIR.parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

from turn import LLM_MODEL, queues_for_identity, run_turn

st.set_page_config(page_title="Ticketing gate", page_icon="🎫", layout="wide")

with st.sidebar:
    st.header("Identity")
    st.caption("Required for every turn. These values are passed to the ticketing pack as-is. Nothing is filled from CRM, Contact Center, or a canned org/user.")
    org_raw = st.text_input("Organization ID", value="", placeholder="Type org id")
    user_raw = st.text_input("User ID", value="", placeholder="Type user id")
    role_choice = st.selectbox("Role", ["", "admin", "agent", "resolver"], index=0)
    role = role_choice or None
    queue_raw = st.text_input(
        "Queue IDs (optional)",
        value="",
        placeholder="Leave blank to load from this org and user",
        help="Comma-separated. Blank uses ticketing.agent_queues / agent_queue_members for the ids above. No fallback list.",
    )
    st.caption(f"Model {LLM_MODEL}")
    if st.button("Clear chat", use_container_width=True):
        st.session_state.messages = []
        st.rerun()

st.title("Ticketing")
st.caption("Org, user, and role come only from this sidebar. Domain plans; SQL and KG run in reports_analytics_agent_ticketing_v2.")

identity_ok = False
org_id = user_id = None
queue_ids: list[int] | None = None
parse_error = ""
if org_raw.strip() and user_raw.strip() and role:
    try:
        org_id = int(org_raw.strip())
        user_id = int(user_raw.strip())
        if org_id <= 0 or user_id <= 0:
            raise ValueError("ids must be positive")
        if queue_raw.strip():
            queue_ids = [int(part.strip()) for part in queue_raw.split(",") if part.strip()]
        else:
            queue_ids = queues_for_identity(organization_id=org_id, user_id=user_id, role=role)
        identity_ok = True
    except ValueError:
        parse_error = "Organization ID, user ID, and optional queue IDs must be integers."

if parse_error:
    st.sidebar.error(parse_error)
elif identity_ok:
    st.sidebar.caption(f"{role} · org {org_id} · user {user_id} · queues {queue_ids}")
else:
    st.sidebar.warning("Enter organization id, user id, and role before asking.")

if "messages" not in st.session_state:
    st.session_state.messages = []


def _context_line(trace: dict) -> str:
    identity = trace.get("identity") or {}
    parts: list[str] = []
    if identity.get("role"):
        parts.append(
            f"{identity['role']} · org {identity.get('organization_id')} · user {identity.get('user_id')}"
        )
        if identity.get("queue_ids") is not None:
            parts.append(f"queues {identity.get('queue_ids')}")
    for task in trace.get("tasks") or []:
        if not isinstance(task, dict):
            continue
        if task.get("time_echo"):
            parts.append(str(task["time_echo"]))
        requested = task.get("requested_kpi")
        catalog = task.get("kpi_id")
        if requested and catalog and requested != catalog:
            parts.append(f"KPI {requested} → {catalog}")
        elif requested or catalog:
            parts.append(f"KPI {requested or catalog}")
        elif task.get("tool"):
            parts.append(str(task["tool"]))
    return " · ".join(dict.fromkeys(parts))


def _render_answer(answer: str, trace: dict, rows: list) -> None:
    tasks = [task for task in (trace.get("tasks") or []) if isinstance(task, dict)]
    failed = [task for task in tasks if task.get("error") and task.get("status") != "ok"]

    if trace.get("domain_error") and not tasks:
        st.error(trace["domain_error"])
    for task in failed:
        st.error(f"{task.get('error_type') or 'error'}: {task.get('error')}")

    if answer:
        st.markdown(answer)
    context = _context_line(trace)
    if context:
        st.caption(context)
    if trace.get("grounded") is False:
        st.caption("The briefing used a figure that was not in the result, so the pack replaced it with the facts.")

    _render_trace(trace)


def _render_trace(trace: dict) -> None:
    plan = trace.get("plan") or {}
    with st.expander("Domain plan", expanded=False):
        if trace.get("domain_raw"):
            st.markdown("**Raw Domain reply**")
            st.code(trace["domain_raw"], language="json")
        if plan:
            st.json(plan)
        elif trace.get("domain_error"):
            st.error(trace["domain_error"])
    for index, task_result in enumerate(trace.get("tasks") or [], start=1):
        task = task_result.get("task") or {}
        title = f"Task {index} · {task.get('executor', 'sql')} · {task.get('id', '')}"
        with st.expander(title, expanded=False):
            st.markdown(
                f"Tool `{task_result.get('tool') or '—'}` · "
                f"status `{task_result.get('status')}` · "
                f"time `{task_result.get('time_echo', '')}`"
            )
            if task_result.get("requested_kpi"):
                st.markdown(f"KPI id from executor: `{task_result['requested_kpi']}`")
            if task_result.get("requested_dimension"):
                st.markdown(f"Dimension from executor: `{task_result['requested_dimension']}`")
            if task_result.get("repaired"):
                st.info("One REPAIR retry was sent back to the executor.")
            for attempt in task_result.get("attempts") or []:
                st.markdown("**Executor reply**")
                st.code(attempt.get("raw") or "", language="json")
            if task_result.get("error"):
                st.error(f"{task_result.get('error_type', 'error')}: {task_result['error']}")
            sql = task_result.get("sql") or task_result.get("cypher") or ""
            if sql:
                st.markdown("**Guarded query**")
                st.code(sql, language="sql")
            rows = task_result.get("rows") or []
            if rows:
                st.dataframe(rows, width="stretch")
            elif task_result.get("status") == "ok":
                st.caption("0 rows")
    if trace.get("facts"):
        with st.expander("Facts passed to Domain synthesis", expanded=False):
            st.code(trace["facts"])


for message in st.session_state.messages:
    with st.chat_message(message["role"]):
        if message.get("trace"):
            _render_answer(message["content"], message["trace"], message.get("rows") or [])
        else:
            st.markdown(message["content"])

prompt = st.chat_input(
    "Ask about tickets, queues, SLA, or a list",
    disabled=not identity_ok,
)
if prompt:
    if not identity_ok:
        st.warning("Set organization id, user id, and role in the sidebar first.")
    else:
        st.session_state.messages.append({"role": "user", "content": prompt})
        with st.chat_message("user"):
            st.markdown(prompt)
        with st.chat_message("assistant"):
            with st.spinner("Domain, then SQL or KG…"):
                result = run_turn(
                    prompt,
                    organization_id=int(org_id),
                    user_id=int(user_id),
                    role=str(role),
                    queue_ids=queue_ids,
                )
            _render_answer(result["answer"], result.get("trace") or {}, result.get("rows") or [])
            log_dir = APP_DIR / "logs"
            log_dir.mkdir(parents=True, exist_ok=True)
            stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d_%H%M%S")
            (log_dir / f"turn_{stamp}.json").write_text(
                json.dumps(
                    {"question": prompt, "answer": result["answer"], "trace": result.get("trace")},
                    default=str,
                    indent=2,
                )
            )
        st.session_state.messages.append(
            {
                "role": "assistant",
                "content": result["answer"],
                "trace": result.get("trace") or {},
                "rows": result.get("rows") or [],
            }
        )
