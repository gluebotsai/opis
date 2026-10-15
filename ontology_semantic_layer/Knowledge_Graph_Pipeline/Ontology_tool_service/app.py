import streamlit as st
import time
import json
import uuid
from datetime import datetime
from src.response import Generate_response, ChatRequest, _build_status_message, ActivityEvent
from src.tools import TOOL_HANDLERS

st.set_page_config(page_title="KG Agent Chat", page_icon="🤖", layout="wide")

if "history" not in st.session_state:
    st.session_state.history = []

if "exchanges" not in st.session_state:
    st.session_state.exchanges = []

if "activity_state" not in st.session_state:
    st.session_state.activity_state = {}

if "activity_feed" not in st.session_state:
    st.session_state.activity_feed = []

st.title("KG Agent Chat")

schema_toggle = True

if st.button("Clear Chat"):
    st.session_state.history = []
    st.session_state.exchanges = []
    st.rerun()

DEFAULT_SESSION = st.query_params.get("session", None) or str(uuid.uuid4())
session_id = DEFAULT_SESSION

st.markdown("""
<style>
    .chat-container { max-width: 800px; margin: 0 auto; }
    .activity-panel { border-left: 3px solid #4F46E5; padding-left: 16px; margin: 8px 0 24px 0; }
    .stage-label { font-size: 12px; font-weight: 600; color: #6B7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
    .stage-pending { color: #9CA3AF; }
    .stage-active { color: #4F46E5; }
    .stage-done { color: #10B981; }
    .meta-badge { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 12px; background: #F3F4F6; color: #6B7280; margin-right: 4px; }
    .tool-step { background: #F9FAFB; border-radius: 8px; padding: 8px 12px; margin: 4px 0; border: 1px solid #E5E7EB; }
    .search-step { background: #F0FDF4; border-radius: 8px; padding: 8px 12px; margin: 4px 0; border: 1px solid #BBF7D0; }
    .response-step { background: #EFF6FF; border-radius: 8px; padding: 8px 12px; margin: 4px 0; border: 1px solid #BFDBFE; }
    section[data-testid="stSidebar"] { background-color: #F9FAFB; }
    .st-expander { border: none !important; box-shadow: none !important; }
</style>
""", unsafe_allow_html=True)

def render_exchange(exchange, index):
    user_msg = exchange["user"]
    result = exchange.get("result")

    with st.chat_message("user"):
        st.markdown(user_msg)
        st.caption(f"Session: {exchange.get('session_id', session_id)}")

    activity_key = f"activity_{index}"
    panel_label = exchange.get("panel_label", "Backend Activity")

    if result and result.get("content"):
        with st.container():
            col1, col2 = st.columns([1, 12])
            with col1:
                st.markdown("")

            with col2:
                panel_state = exchange.get("panel_state", "collapsed")
                with st.expander(f"⚡ {panel_label}", expanded=(panel_state == "expanded")):
                    render_activity_panel(exchange)

        with st.chat_message("assistant"):
            st.markdown(result["content"])
            if exchange.get("tool_count", 0) > 0:
                st.caption(f"Used {exchange['tool_count']} tool(s) · {exchange.get('elapsed', 0):.1f}s elapsed")
    elif exchange.get("status") == "error":
        with st.expander(f"⚡ {panel_label} (error)", expanded=True):
            render_activity_panel(exchange)
        with st.chat_message("assistant"):
            st.error(f"Pipeline failed: {exchange.get('error', 'Unknown error')}")
    else:
        with st.expander(f"⚡ {panel_label}", expanded=True):
            render_activity_panel(exchange)


def render_activity_panel(exchange):
    result = exchange.get("result", {})

    col1, col2, col3 = st.columns(3)
    with col1:
        stage = exchange.get("stage", "done")
        labels = {"pending": "Pending", "searching": "Searching", "running": "Running", "done": "Done"}
        st.markdown(f"**Status:** `{labels.get(stage, stage)}`")
    with col2:
        st.markdown(f"**Elapsed:** `{exchange.get('elapsed', 0):.2f}s`")
    with col3:
        tc = exchange.get("tool_count", 0)
        sh = len(exchange.get("search_hits", []))
        st.markdown(f"**Tools:** `{tc}` &nbsp; **Search:** `{sh}`")

    if exchange.get("search_result") and schema_toggle:
        hits = exchange["search_result"].get("hits", []) if isinstance(exchange["search_result"], dict) else []
        if hits:
            with st.expander(f"🔍 Schema Context ({len(hits)} results)", expanded=False):
                for i, hit in enumerate(hits):
                    props = hit.get("properties", [])
                    prop_str = ", ".join([f"`{p}`" for p in props]) if props else "no properties"
                    st.markdown(f"**`{hit.get('name','')}`** `[{hit.get('type','')}]`  \n{hit.get('description','')[:200]}  \n*Properties: {prop_str}*")
                    if i < len(hits) - 1:
                        st.divider()

    if exchange.get("tool_calls"):
        with st.expander(f"🔧 Tool Calls ({len(exchange['tool_calls'])})", expanded=False):
            for tc in exchange["tool_calls"]:
                args = tc.get("args", {})
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except Exception:
                        pass
                st.markdown(f"**`{tc.get('name','')}`**")
                st.code(json.dumps(args, indent=2), language="json")
                st.divider()

    if result and result.get("content"):
        with st.expander("📝 Final Response", expanded=False):
            st.markdown(result["content"])


st.markdown('<div class="chat-container">', unsafe_allow_html=True)

for i, exchange in enumerate(st.session_state.exchanges):
    render_exchange(exchange, i)

st.markdown("</div>", unsafe_allow_html=True)

user_query = st.chat_input("Ask me anything about your knowledge graph...")

if user_query and user_query.strip():
    exchange_idx = len(st.session_state.exchanges)
    panel_label = f"Backend Activity — {datetime.now().strftime('%H:%M:%S')}"

    placeholder = st.empty()
    with placeholder.container():
        with st.chat_message("user"):
            st.markdown(user_query)
            st.caption(f"Session: {session_id}")

        with st.chat_message("assistant"):
            status_text = st.empty()

            def activity_callback(event):
                st.session_state.activity_feed.append(event)
                st.session_state.activity_state[event.step_id] = event.status

            def render_activity_feed():
                step_keys = ["understand", "analysis", "response"]
                _last_desc = {}
                for ev in st.session_state.activity_feed:
                    if ev.step_id in step_keys:
                        _last_desc[ev.step_id] = ev.description
                _defaults = {
                    "understand": "Analyzing request",
                    "analysis": "Validating relationships",
                    "response": "Preparing response",
                }
                cols = st.columns(3)
                for col, step_key in zip(cols, step_keys):
                    with col:
                        state = st.session_state.activity_state.get(step_key, "pending")
                        label = _last_desc.get(step_key) or _defaults.get(step_key, step_key)
                        if state == "completed":
                            st.markdown(f'<div class="stage-done">✓ {label}</div>', unsafe_allow_html=True)
                        elif state == "running":
                            st.markdown(f'<div class="stage-active">⟳ {label}</div>', unsafe_allow_html=True)
                        else:
                            st.markdown(f'<div class="stage-pending">○ {label}</div>', unsafe_allow_html=True)

            tool_calls = []

            def on_tool_call(fn_name, fn_args):
                args_clean = json.loads(fn_args) if isinstance(fn_args, str) else fn_args
                tool_calls.append({"name": fn_name, "args": args_clean})
                pass

            exchange = {
                "user": user_query,
                "session_id": session_id,
                "panel_label": panel_label,
                "panel_state": "expanded",
                "stage": "searching",
                "search_result": None,
                "tool_calls": tool_calls,
                "result": {},
            }
            st.session_state.exchanges.append(exchange)

    try:
        search_result = TOOL_HANDLERS["search_schema"](query=user_query)
        hits = search_result.get("hits", []) if isinstance(search_result, dict) else []
        exchange["search_result"] = search_result
        exchange["search_hits"] = hits
        exchange["stage"] = "running"

        request = ChatRequest(sessionID=session_id, query=user_query, organization_id="org1000")
        result = Generate_response(request, on_tool_call=on_tool_call, on_activity=activity_callback)
        exchange["result"] = result
        exchange["tool_calls"] = tool_calls
        exchange["tool_count"] = len(tool_calls)
        exchange["stage"] = "done"

        start_t = exchange.get("_start", time.time())
        exchange["elapsed"] = time.time() - start_t

        render_activity_feed()
        st.rerun()

    except Exception as e:
        exchange["status"] = "error"
        exchange["error"] = str(e)
        exchange["stage"] = "done"
        st.rerun()
