"""Campaign pack test chat. Sidebar identity only.

Run from the workspace root:

    streamlit run test_streamlit/campaign/app.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st

APP_DIR = Path(__file__).resolve().parent
ROOT = APP_DIR.parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

from turn import LLM_MODEL, run_turn

st.set_page_config(page_title="Campaign reports", layout="wide")

with st.sidebar:
    st.header("Identity")
    st.caption("UTC reporting. Org, branch, user, and role are required.")
    org_raw = st.text_input("Organization ID", value="")
    branch_raw = st.text_input("Branch ID", value="")
    user_raw = st.text_input("User ID", value="")
    role_choice = st.selectbox("Role", ["", "admin", "operator"], index=0)
    role = role_choice or None
    st.caption(f"Model {LLM_MODEL}")
    st.caption("Turn logs: test_streamlit/campaign/logs/")
    if st.button("Clear chat", use_container_width=True):
        st.session_state.messages = []
        st.rerun()

st.title("Campaign reports")
st.caption("Domain plans the need. SQL picks a certified metric or writes list SQL. Python binds org, role, and UTC time.")

identity_ok = False
org_id = user_id = branch_id = None
parse_error = ""
if org_raw.strip() and user_raw.strip() and branch_raw.strip() and role:
    try:
        org_id = int(org_raw.strip())
        user_id = int(user_raw.strip())
        branch_id = int(branch_raw.strip())
        if org_id <= 0 or user_id <= 0 or branch_id <= 0:
            raise ValueError("ids must be positive")
        identity_ok = True
    except ValueError:
        parse_error = "Organization, branch, and user IDs must be positive integers."

if parse_error:
    st.sidebar.error(parse_error)
elif identity_ok:
    st.sidebar.caption(f"{role} · org {org_id} · branch {branch_id} · user {user_id} · UTC")
else:
    st.sidebar.warning("Enter organization id, branch id, user id, and role before asking.")

if "messages" not in st.session_state:
    st.session_state.messages = []


def _render_trace(facts: str, trace: dict, log_path: str = "") -> None:
    if log_path:
        st.caption(f"Log file: `{log_path}`")
    identity = trace.get("identity") or {}
    if identity:
        st.caption(
            f"{identity.get('role')} · org {identity.get('organization_id')} · "
            f"branch {identity.get('branch_id')} · user {identity.get('user_id')} · "
            f"{identity.get('scope_label') or ''}"
        )
    if trace.get("supervisor_overridden"):
        st.info(trace["supervisor_overridden"])
    with st.expander("Supervisor", expanded=False):
        st.json(trace.get("supervisor") or {})
        if trace.get("supervisor_raw"):
            st.code(trace["supervisor_raw"], language="json")
    with st.expander("Domain plan", expanded=True):
        st.json(trace.get("plan") or {})
        if trace.get("loop_errors"):
            st.error(trace["loop_errors"])
    for i, task in enumerate(trace.get("task_results") or [], start=1):
        status = task.get("status") or "?"
        with st.expander(f"Task {i} · {status} · {task.get('kpi_id') or task.get('path') or 'sql'}", expanded=True):
            st.json({k: task.get(k) for k in ("task", "status", "error_type", "error", "kpi_id", "row_count", "time_echo", "path")})
            if task.get("sql"):
                st.code(task["sql"], language="sql")
            rows = task.get("rows") or []
            if rows:
                st.dataframe(rows, use_container_width=True)
            if task.get("error"):
                st.error(f"{task.get('error_type')}: {task.get('error')}")
    with st.expander("Facts / briefing", expanded=False):
        st.text(facts or "")
        if trace.get("briefing_raw"):
            st.markdown("**Raw briefing**")
            st.write(trace["briefing_raw"])
        st.write("grounded", trace.get("grounded"))


for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        st.markdown(msg["content"])
        if msg["role"] == "assistant":
            _render_trace(msg.get("facts") or "", msg.get("trace") or {}, msg.get("log_path") or "")

prompt = st.chat_input("Ask about campaigns, delivery, contacts, or events")
if prompt and not identity_ok:
    st.warning("Set identity in the sidebar first.")
elif prompt and identity_ok:
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)
    with st.chat_message("assistant"):
        with st.spinner("Running campaign reports…"):
            out = run_turn(
                question=prompt,
                organization_id=org_id,
                user_id=user_id,
                branch_id=branch_id,
                role=role,
            )
        answer = out.get("answer") or "No answer."
        st.markdown(answer)
        facts = out.get("facts") or ""
        trace = out.get("trace") or {}
        log_path = out.get("log_path") or ""
        _render_trace(facts, trace, log_path)
    st.session_state.messages.append(
        {
            "role": "assistant",
            "content": answer,
            "facts": facts,
            "trace": trace,
            "log_path": log_path,
        }
    )
