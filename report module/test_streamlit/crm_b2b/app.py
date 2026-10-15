"""B2B CRM test chat. Identity only; the pack answers.

Run from the workspace root:

    streamlit run test_streamlit/crm_b2b/app.py
"""

from __future__ import annotations

import datetime
import json
import sys
import importlib.util
from pathlib import Path

import streamlit as st

APP_DIR = Path(__file__).resolve().parent
ROOT = APP_DIR.parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

_spec = importlib.util.spec_from_file_location("crm_b2b_turn", APP_DIR / "turn.py")
_turn = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(_turn)
LLM_MODEL = _turn.LLM_MODEL
run_turn = _turn.run_turn

st.set_page_config(page_title="B2B CRM gate", page_icon="💼", layout="wide")

ROLES = ["admin", "sales_manager", "sales_rep", "presales", "finance", "marketing", "viewer"]

with st.sidebar:
    st.header("Identity")
    org_id = st.number_input("Organization ID", value=1003, step=1)
    user_id = st.number_input("User ID", value=1017, step=1)
    role = st.selectbox("Role", ROLES, index=1)
    st.caption(f"{role} · org {int(org_id)} · user {int(user_id)}")
    st.caption(f"Model {LLM_MODEL}")
    if st.button("Clear chat", use_container_width=True):
        st.session_state.messages = []
        st.rerun()

st.title("B2B CRM")
st.caption("Org, user, and role go in. Domain plans; SQL runs warehouse KPIs; KG walks the commercial graph.")

if "messages" not in st.session_state:
    st.session_state.messages = []


def _safe_markdown(text: str) -> None:
    """Dollar amounts must not be parsed as KaTeX on rerun."""
    st.markdown((text or "").replace("$", r"\$"))


def _label(name: str) -> str:
    return str(name).replace("_", " ").strip().capitalize()


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


def _render_answer(answer: str, trace: dict, rows: list) -> None:
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
            if task_result.get("status") == "held":
                st.warning(task_result.get("error"))
                st.json(task)
                continue
            st.markdown(
                f"Tool `{task_result.get('tool') or '—'}` · "
                f"status `{task_result.get('status')}` · "
                f"time `{task_result.get('time_echo', '')}` · "
                f"time_status `{task_result.get('time_status', '')}`"
            )
            if task_result.get("requested_kpi"):
                catalog = task_result.get("kpi_id")
                if catalog and catalog != task_result["requested_kpi"]:
                    st.markdown(
                        f"KPI id from executor: `{task_result['requested_kpi']}` · catalog id: `{catalog}`"
                    )
                else:
                    st.markdown(f"KPI id from executor: `{task_result['requested_kpi']}`")
            if task_result.get("requested_dimension"):
                st.markdown(f"Dimension from executor: `{task_result['requested_dimension']}`")
            if task_result.get("repaired"):
                st.info("One REPAIR retry was sent back to the SQL executor.")
            for attempt in task_result.get("attempts") or []:
                st.markdown("**SQL executor reply**")
                st.code(attempt.get("raw") or "", language="json")
            if task_result.get("error"):
                st.error(f"{task_result.get('error_type', 'error')}: {task_result['error']}")
            if task_result.get("repair_error"):
                st.error(task_result["repair_error"])
            sql = task_result.get("sql") or ""
            if sql:
                st.markdown("**Guarded SQL**")
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
        _render_answer(result["answer"], result.get("trace") or {}, result.get("rows") or [])
        log_dir = APP_DIR / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d_%H%M%S")
        (log_dir / f"turn_{stamp}.json").write_text(
            json.dumps({"question": question, "answer": result["answer"], "trace": result.get("trace")}, default=str, indent=2)
        )
    st.session_state.messages.append(
        {
            "role": "assistant",
            "content": result["answer"],
            "trace": result.get("trace") or {},
            "rows": result.get("rows") or [],
        }
    )
