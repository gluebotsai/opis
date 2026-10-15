"""B2B CRM chat for this copy pack (optimized Domain / SQL / KG loop).

From the workspace root:

    /home/vectone/miniconda3/envs/myenv/bin/streamlit run \\
      "reports_analytics_agent_CRM_B2B (copy)/app.py"
"""

from __future__ import annotations

import datetime
import json
import sys
from pathlib import Path

import streamlit as st

PACK = Path(__file__).resolve().parent
if str(PACK) not in sys.path:
    sys.path.insert(0, str(PACK))

from core.turn import LLM_MODEL, run_turn  # noqa: E402

st.set_page_config(page_title="B2B CRM (copy)", page_icon="💼", layout="wide")

ROLES = ["admin", "sales_manager", "sales_rep", "presales", "finance", "marketing", "viewer"]

with st.sidebar:
    st.header("Identity")
    org_id = st.number_input("Organization ID", value=1003, step=1)
    user_id = st.number_input("User ID", value=1017, step=1)
    role = st.selectbox("Role", ROLES, index=1)
    st.caption(f"{role} · org {int(org_id)} · user {int(user_id)}")
    st.caption(f"Model {LLM_MODEL} · copy pack")
    if st.button("Clear chat", use_container_width=True):
        st.session_state.messages = []
        st.rerun()

st.title("B2B CRM (copy)")
st.caption("This UI uses the copy pack turn loop (understanding, catalog cards, goal review, KG D/P/R).")

if "messages" not in st.session_state:
    st.session_state.messages = []


def _safe_markdown(text: str) -> None:
    st.markdown((text or "").replace("$", r"\$"))


def _context_line(trace: dict) -> str:
    identity = trace.get("identity") or {}
    parts: list[str] = []
    if identity.get("role"):
        parts.append(
            f"{identity['role']} · org {identity.get('organization_id')} · user {identity.get('user_id')}"
        )
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


def _render_answer(answer: str, trace: dict) -> None:
    tasks = [task for task in (trace.get("tasks") or []) if isinstance(task, dict)]
    held = [task for task in tasks if task.get("status") == "held"]
    failed = [task for task in tasks if task.get("error") and task.get("status") != "ok"]

    if trace.get("domain_error") and not tasks:
        st.error(trace["domain_error"])
    for task in held:
        st.warning(task.get("error") or "KG executor is on hold.")
    for task in failed:
        st.error(f"{task.get('error_type') or 'error'}: {task.get('error')}")

    if answer:
        _safe_markdown(answer)
    context = _context_line(trace)
    if context:
        st.caption(context)
    if trace.get("grounded") is False:
        st.caption("The briefing used a figure that was not in the result, so the pack replaced it with the facts.")

    with st.expander("Domain plan", expanded=False):
        if trace.get("understanding"):
            st.json(trace["understanding"])
        if trace.get("goal_review"):
            st.markdown("**Goal review**")
            st.json(trace["goal_review"])
        if trace.get("domain_raw"):
            st.code(trace["domain_raw"], language="json")
        if trace.get("plan"):
            st.json(trace["plan"])
    for index, task_result in enumerate(trace.get("tasks") or [], start=1):
        if not isinstance(task_result, dict):
            continue
        task = task_result.get("task") or {}
        title = f"Task {index} · {task.get('executor', 'sql')} · {task.get('id', '')}"
        with st.expander(title, expanded=False):
            st.markdown(
                f"Tool `{task_result.get('tool') or '—'}` · "
                f"status `{task_result.get('status')}` · "
                f"time `{task_result.get('time_echo', '')}`"
            )
            if task_result.get("sql"):
                st.code(task_result["sql"], language="sql")
            if task_result.get("kg_notes"):
                st.markdown("**KG notes**")
                _safe_markdown(task_result["kg_notes"])
            rows = task_result.get("rows") or []
            if rows:
                st.dataframe(rows, width="stretch")
            if task_result.get("error"):
                st.error(f"{task_result.get('error_type', 'error')}: {task_result['error']}")
    if trace.get("facts"):
        with st.expander("Facts passed to Domain synthesis", expanded=False):
            st.code(trace["facts"])


for message in st.session_state.messages:
    with st.chat_message(message["role"]):
        if message.get("trace"):
            _render_answer(message["content"], message["trace"])
        else:
            _safe_markdown(message["content"])

if question := st.chat_input("Ask about pipeline, deals, invoices, or a list"):
    st.session_state.messages.append({"role": "user", "content": question})
    with st.chat_message("user"):
        _safe_markdown(question)
    with st.chat_message("assistant"):
        with st.spinner("Domain, then SQL or KG…"):
            result = run_turn(
                question,
                organization_id=int(org_id),
                user_id=int(user_id),
                role=role,
            )
        _render_answer(result["answer"], result.get("trace") or {})
        log_dir = PACK / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d_%H%M%S")
        (log_dir / f"turn_{stamp}.json").write_text(
            json.dumps(
                {"question": question, "answer": result["answer"], "trace": result.get("trace")},
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
