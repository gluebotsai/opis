"""Contact Center reports lab. Renders Domain HTML. Not part of the MAS pack.

Run from the workspace root:

    streamlit run test_streamlit/contact_center_v2/app.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).resolve().parents[2]
APP_DIR = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

from reports_analytics_agent_contact_center_v2 import run_turn
from logs import save_turn_log

st.set_page_config(page_title="Contact Center reports", layout="wide")


def _queue_ids(raw: str) -> list[int]:
    ids: list[int] = []
    for part in raw.replace(";", ",").split(","):
        part = part.strip()
        if not part:
            continue
        ids.append(int(part))
    return ids


with st.sidebar:
    st.header("Identity")
    st.caption("These values are the session. The model does not invent them.")
    org_raw = st.text_input("Organization ID", value="1012")
    user_raw = st.text_input("User ID", value="")
    role = st.selectbox("Role", ["admin", "agent"], index=0)
    queues_raw = st.text_input("Queue IDs", value="", help="Optional. Comma-separated. Required for queue scope.")
    time_phrase = st.text_input("Period if the question has none", value="")
    st.caption("UTC. Logs: test_streamlit/contact_center_v2/logs/")
    if st.button("Clear chat", use_container_width=True):
        st.session_state.messages = []
        st.rerun()

identity_ok = False
org_id = user_id = None
queue_ids: list[int] = []
parse_error = ""
try:
    if org_raw.strip() and user_raw.strip():
        org_id = int(org_raw.strip())
        user_id = int(user_raw.strip())
        queue_ids = _queue_ids(queues_raw)
        if org_id <= 0 or user_id <= 0 or any(q <= 0 for q in queue_ids):
            raise ValueError("ids must be positive")
        identity_ok = True
except ValueError:
    parse_error = "Organization, user, and queue IDs must be positive integers."

if parse_error:
    st.sidebar.error(parse_error)
elif not identity_ok:
    st.sidebar.warning("Enter organization id and user id before asking.")
else:
    st.sidebar.caption(f"{role} · org {org_id} · user {user_id} · UTC")

st.title("Contact Center reports")
st.caption("Domain plans. SQL fetches the figure. If a certified metric cannot, free SQL still answers.")

if "messages" not in st.session_state:
    st.session_state.messages = []


def _show(answer: str, card: str, facts: str, trace: dict) -> None:
    st.markdown(answer or "", unsafe_allow_html=True)
    with st.expander("Plan and facts", expanded=False):
        st.caption(card or "card: none")
        st.json(trace.get("plan") or {})
        st.text(facts or "")


for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        if msg["role"] == "assistant":
            _show(msg["content"], msg.get("card") or "", msg.get("facts") or "", msg.get("trace") or {})
        else:
            st.markdown(msg["content"])

prompt = st.chat_input("Ask about handled volume, SLA, queues, or why a contact was missed")
if prompt and not identity_ok:
    st.warning("Set organization id and user id in the sidebar first.")
elif prompt and identity_ok:
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)
    with st.chat_message("assistant"):
        identity = {
            "organization_id": org_id,
            "user_id": user_id,
            "role": role,
            "queue_ids": queue_ids,
            "time_phrase": time_phrase.strip(),
        }
        llm_meta = {
            "base": os.environ.get("SQL_AGENT_LLM_URL") or os.environ.get("LLM_BASE_URL") or "",
            "model": os.environ.get("SQL_AGENT_LLM_MODEL") or os.environ.get("LLM_MODEL_NAME") or "",
        }
        error = None
        with st.spinner("Running contact center reports…"):
            try:
                recent = []
                for msg in st.session_state.messages[-5:-1]:
                    recent.append(
                        {
                            "role": msg.get("role") or "user",
                            "content": str(msg.get("content") or "")[:400],
                        }
                    )
                out = run_turn(
                    question=prompt,
                    organization_id=org_id,
                    user_id=user_id,
                    role=role,
                    dsn=os.environ.get("DATABASE_URL") or os.environ.get("PG_DSN") or "",
                    queue_ids=queue_ids,
                    time_phrase=time_phrase.strip() or None,
                    recent_turns=recent or None,
                )
            except Exception as exc:
                error = str(exc)
                out = {"answer": f"<p>{error}</p>", "card": "card: none", "facts": "", "trace": {}}
        log_path = save_turn_log(
            question=prompt,
            identity=identity,
            llm=llm_meta,
            result=out,
            error=error,
        )
        answer = out.get("answer") or ""
        card = out.get("card") or "card: none"
        facts = out.get("facts") or ""
        trace = out.get("trace") or {}
        st.caption(f"Log: {log_path}")
        _show(answer, card, facts, trace)
    st.session_state.messages.append(
        {
            "role": "assistant",
            "content": answer,
            "card": card,
            "facts": facts,
            "trace": trace,
            "log_path": str(log_path),
        }
    )
