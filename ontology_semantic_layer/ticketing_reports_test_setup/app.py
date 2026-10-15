"""Dummy Streamlit chat for ticketing reports SQL + KG executors."""

from __future__ import annotations

import streamlit as st

from env_config import database_url, llm_settings, load_env, neo4j_settings
from identity import identity_from_form
from llm import apply_llm_runtime
from orchestrator import run_turn
from session_log import append_message, append_record, new_session_id

load_env()

st.set_page_config(page_title="Ticketing reports", layout="wide")
st.markdown(
    """
    <style>
    [data-testid="stSidebar"], [data-testid="stSidebarCollapsedControl"] { display: none; }
    </style>
    """,
    unsafe_allow_html=True,
)

if "messages" not in st.session_state:
    st.session_state.messages = []
if "previous_frame" not in st.session_state:
    st.session_state.previous_frame = None
if "session_id" not in st.session_state:
    st.session_state.session_id = new_session_id()

pg = database_url()
neo4j = neo4j_settings()
llm = llm_settings()
apply_llm_runtime(llm["url"], llm["model"], float(llm["timeout"]))

left, mid, right = st.columns([1.1, 2.4, 1.3], gap="large")

with left:
    st.subheader("Payload")
    organization_id = st.number_input("org_id", min_value=1, value=1012, step=1)
    user_id = st.number_input("user_id", min_value=1, value=1, step=1)
    role = st.selectbox("role", ["admin", "agent", "resolver"])
    if st.button("Clear session"):
        st.session_state.messages = []
        st.session_state.previous_frame = None
        st.session_state.session_id = new_session_id()
        st.rerun()

with mid:
    st.subheader("Chat")
    for msg in st.session_state.messages:
        with st.chat_message(msg["role"]):
            st.markdown(msg["content"])

with right:
    st.subheader("Session messages")
    if not st.session_state.messages:
        st.caption("No messages yet.")
    for msg in st.session_state.messages:
        st.markdown(f"**{msg['role']}**")
        st.write(msg["content"])

question = st.chat_input("Ask a ticketing report question")
if question:
    st.session_state.messages.append({"role": "user", "content": question})
    append_message(st.session_state.session_id, "user", question)
    identity = identity_from_form(
        organization_id=int(organization_id),
        user_id=int(user_id),
        role=role,
        my_queue_ids="",
    )
    try:
        result = run_turn(
            identity,
            conversation=list(st.session_state.messages),
            database_url=pg,
            neo4j_uri=neo4j["uri"],
            neo4j_user=neo4j["user"],
            neo4j_password=neo4j["password"],
            previous_frame=st.session_state.previous_frame,
            llm_timeout=float(llm["timeout"]),
        )
        st.session_state.previous_frame = result.get("previous_frame")
        answer = result.get("answer") or ""
        for tool in result.get("tools") or []:
            append_record(st.session_state.session_id, {"event": "tool", **tool})
    except Exception as exc:
        answer = f"I hit a problem: {exc}"
    st.session_state.messages.append({"role": "assistant", "content": answer})
    append_message(st.session_state.session_id, "assistant", answer)
    st.rerun()
