"""Discovery and Support agents for custom_booxoo_bot."""

from __future__ import annotations

import json
from pathlib import Path

from app.agents.custom_booxoo_bot.llm import BooxooLLM, get_booxoo_llm
from app.agents.custom_booxoo_bot.memory import Memory
from app.agents.custom_booxoo_bot.prompt_overlay import apply_channel_overlay
from app.agents.custom_booxoo_bot.tools.registry import build_email_tools, build_tools
from app.logging import get_logger

logger = get_logger("nlp.custom_booxoo_bot.multi_agent")

_ROUTING = (
    "\n\nWhen you need another specialist, call route_to_agent by itself. "
    "Do not call it together with other tools. Do not tell the user you are routing. "
)


def _load_prompt(name: str) -> str:
    path = Path(__file__).resolve().parent / "prompts" / name
    return path.read_text(encoding="utf-8")


RECENT_USER_TURNS = 10


def summary_of_conversation(messages: list[dict], llm: BooxooLLM) -> dict:
    lines = []
    for message in messages:
        role = message.get("role")
        if role == "tool":
            continue
        if role == "assistant" and message.get("tool_calls"):
            continue
        content = message.get("content")
        if not content or not isinstance(content, str):
            continue
        if role in ("user", "assistant"):
            lines.append(f"{role}: {content}")
    if not lines:
        return {"role": "assistant", "content": "No prior conversation context available."}
    prompt = (
        "Summarize this support chat in under 80 words. Keep the user's name, "
        "email, phone, product interest, and the support problem they already stated. "
        "A verification code or a choice of email or SMS is not the problem. English only."
    )
    response = llm.run(
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": "\n".join(lines)},
        ],
        tools=[],
    )
    content = (response or {}).get("content") or "Summary unavailable."
    return {"role": "assistant", "content": content}


def trim_session_history(messages: list[dict], llm: BooxooLLM) -> list[dict] | None:
    """Summarize talk older than the last 10 customer turns. Keep that window intact."""
    user_indexes = [index for index, message in enumerate(messages) if message.get("role") == "user"]
    if len(user_indexes) <= RECENT_USER_TURNS:
        return None
    cut = user_indexes[-RECENT_USER_TURNS]
    summary = summary_of_conversation(messages[:cut], llm)
    return [summary, *messages[cut:]]


class Agent:
    def __init__(
        self,
        name: str,
        system: str,
        tools: list,
        llm: BooxooLLM,
        handoff_instruction: str,
        max_tool_rounds: int = 5,
    ):
        self.name = name
        self.base_prompt = system
        self.system = [{"role": "system", "content": system}]
        self.tools = tools
        self.tools_schema = [tool.tool_schema for tool in self.tools]
        self.tools_mapping = {tool.tool_schema["function"]["name"]: tool for tool in self.tools}
        self.llm = llm
        self.handoff_instruction = handoff_instruction
        self.max_tool_rounds = max_tool_rounds

    def update_system(self, content: str) -> None:
        self.system = [{"role": "system", "content": content}]

    def hide_verification_tools(self) -> None:
        hidden = {"send_otp", "verify_otp"}
        if not any(name in self.tools_mapping for name in hidden):
            return
        self.tools = [
            tool for tool in self.tools if tool.tool_schema["function"]["name"] not in hidden
        ]
        self.tools_schema = [tool.tool_schema for tool in self.tools]
        self.tools_mapping = {tool.tool_schema["function"]["name"]: tool for tool in self.tools}

    def run(self, query: str | None, ctx) -> dict:
        log = logger
        memory: Memory = ctx.session.memory
        if getattr(ctx.session, "authenticated", False):
            self.hide_verification_tools()
        if query:
            memory.add_session_messages({"role": "user", "content": query})

        trimmed = trim_session_history(memory.get_session_messages(), self.llm)
        if trimmed is not None:
            memory.memory = trimmed
            log.info("session summarized conversation_id=%s", ctx.request.conversation_id)

        messages = self._messages(memory, ctx)
        llm_response = self._complete(messages)

        if not llm_response.get("tool_calls"):
            return self._final_text(memory, llm_response, ctx.session)

        if llm_response["tool_calls"][0]["function"]["name"] == "route_to_agent":
            memory.add_session_messages(
                {
                    "role": "tool",
                    "name": "route_to_agent",
                    "content": json.dumps({"status": "success", "message": "routed successfully"}),
                }
            )
            return {
                "response_type": "routing_response",
                "from": self.name,
                "response": llm_response,
            }

        for _ in range(self.max_tool_rounds):
            terminal = self._run_tool_calls(llm_response, memory, ctx)
            if terminal is not None:
                return {
                    "response_type": "terminal_response",
                    "from": self.name,
                    "result": terminal,
                    "handoff_recommended": bool(terminal.get("handoff_recommended")),
                }
            messages = self._messages(memory, ctx)
            llm_response = self._complete(messages)
            if llm_response.get("content") and not llm_response.get("tool_calls"):
                return self._final_text(memory, llm_response, ctx.session)
            if (
                llm_response.get("tool_calls")
                and llm_response["tool_calls"][0]["function"]["name"] == "route_to_agent"
            ):
                return {
                    "response_type": "routing_response",
                    "from": self.name,
                    "response": llm_response,
                }
        return {
            "response_type": "general_response",
            "from": self.name,
            "text": "We're having a little trouble right now. Please try again shortly.",
        }

    def _messages(self, memory: Memory, ctx) -> list[dict]:
        messages = list(self.system)
        extras: list[str] = []
        trusted_context = str(getattr(ctx, "trusted_context", "") or "").strip()
        if trusted_context:
            extras.append(trusted_context)
        enrichment = getattr(ctx, "contact_enrichment_result", None)
        if isinstance(enrichment, dict):
            extras.append(
                "Trusted contact enrichment result for this turn: "
                f"{json.dumps(enrichment, default=str)}. "
                "Acknowledge only appliedFields. If requiresConfirmation is non-empty, "
                "ask whether those exact values should replace the saved values. "
                "Do not claim a skipped or pending field was saved."
            )
        if extras:
            addition = "\n\n".join(extras)
            if messages and messages[0].get("role") == "system":
                messages[0] = {
                    "role": "system",
                    "content": f"{messages[0].get('content') or ''}\n\n{addition}",
                }
            else:
                messages.insert(0, {"role": "system", "content": addition})
        return messages + memory.get_session_messages(30)

    def _run_tool_calls(self, llm_response: dict, memory: Memory, ctx) -> dict | None:
        terminal = None
        for tool_call in llm_response["tool_calls"]:
            name = tool_call["function"]["name"]
            raw_args = tool_call["function"].get("arguments") or "{}"
            try:
                args = json.loads(raw_args)
            except json.JSONDecodeError:
                args = {}
            if not isinstance(args, dict):
                args = {}
            memory.add_session_messages({"role": "assistant", "tool_calls": [tool_call]})
            tool = self.tools_mapping.get(name)
            if tool is None:
                tool_response = {"ok": False, "error": f"Unknown tool {name}"}
            else:
                tool_response = tool.run(ctx, **args)
            logger.info(
                "tool_call name=%s conversation_id=%s",
                name,
                ctx.request.conversation_id,
            )
            memory.add_session_messages(
                {
                    "role": "tool",
                    "name": name,
                    "tool_call_id": tool_call.get("id"),
                    "content": json.dumps(tool_response, default=str),
                }
            )
            if getattr(ctx.session, "authenticated", False):
                self.hide_verification_tools()
            if isinstance(tool_response, dict) and tool_response.get("end_turn"):
                terminal = tool_response
                break
        return terminal

    def _complete(self, messages: list[dict]) -> dict:
        response = self.llm.run(messages=messages, tools=self.tools_schema)
        if response.get("error"):
            raise RuntimeError(str(response["error"]))
        return response

    def _final_text(self, memory: Memory, llm_response: dict, session) -> dict:
        text = llm_response.get("content") or ""
        memory.add_session_messages({"role": "assistant", "content": text})
        if text.strip():
            session.assistant_replied = True
        return {"response_type": "general_response", "from": self.name, "text": text}


class AgentRouter:
    def __init__(self, agents: list[Agent], session) -> None:
        self.agents = {agent.name: agent for agent in agents}
        self.current_agent = agents[0]
        self.session = session
        handoff = {agent.name: agent.handoff_instruction for agent in agents}
        self.routing_instruction = _ROUTING + f"Available agents: {handoff}"
        self.refresh_prompts(session.channel or "webchat")

    def refresh_prompts(self, channel: str) -> None:
        for agent in self.agents.values():
            agent.update_system(
                apply_channel_overlay(agent.base_prompt, channel) + self.routing_instruction
            )
        self.session.channel = channel

    def execute(self, user_input: str | None, ctx) -> dict:
        ctx.session.active_agent = self.current_agent.name
        response = self.current_agent.run(user_input, ctx)
        if response.get("response_type") != "routing_response":
            return response
        tool_call = response["response"]["tool_calls"][0]
        raw_args = tool_call["function"].get("arguments") or "{}"
        try:
            args = json.loads(raw_args)
        except json.JSONDecodeError:
            args = {}
        if not isinstance(args, dict):
            args = {}
        target = args.get("agent_name")
        if target == response["from"] or target not in self.agents:
            note = (
                f"You are already {target}. Answer this turn yourself."
                if target == response["from"]
                else "That specialist is not available. Answer with your own tools."
            )
            ctx.session.memory.add_session_messages({"role": "assistant", "content": note})
            return self.current_agent.run(None, ctx)
        self.current_agent = self.agents[target]
        ctx.session.active_agent = target
        ctx.agent_name = target
        response = self.current_agent.run(None, ctx)
        if response.get("response_type") == "general_response" and not response.get("text"):
            ctx.session.memory.add_session_messages(
                {"role": "assistant", "content": "Reply to the user in English on this turn without another route."}
            )
            response = self.current_agent.run(None, ctx)
        return response


def build_router(session, llm: BooxooLLM | None = None) -> AgentRouter:
    llm = llm or get_booxoo_llm()
    discovery = Agent(
        name="DiscoveryAgent",
        system=_load_prompt("discovery.md"),
        tools=build_tools("discovery"),
        llm=llm,
        handoff_instruction=(
            "Answers shopping and company questions from business and product knowledge. "
            "Does not verify identity or open tickets."
        ),
    )
    support = Agent(
        name="SupportAgent",
        system=_load_prompt("support.md"),
        tools=build_tools("support"),
        llm=llm,
        handoff_instruction=(
            "Handles returns and tickets. Verifies the customer once per session, then continues the request they already made. "
            "Asks for an order only when an order already exists. A failed payment has no order id. "
            "Connects a live agent only when the customer explicitly asks for a person."
        ),
    )
    router = AgentRouter([discovery, support], session)
    session.router = router
    return router


def build_email_router(session, llm: BooxooLLM | None = None) -> AgentRouter:
    llm = llm or get_booxoo_llm()
    discovery = Agent(
        name="DiscoveryAgent",
        system=_load_prompt("email_discovery.md"),
        tools=build_email_tools("discovery"),
        llm=llm,
        handoff_instruction=(
            "Answers shopping and company questions from Booxoo business knowledge in an email. "
            "Does not verify identity or open tickets."
        ),
    )
    support = Agent(
        name="SupportAgent",
        system=_load_prompt("email_support.md"),
        tools=build_email_tools("support"),
        llm=llm,
        handoff_instruction=(
            "Handles email support. The sender address is the customer. Does not use OTP. "
            "Asks for every missing detail in one email. Asks for an order only when the issue is about an order."
        ),
        max_tool_rounds=8,
    )
    router = AgentRouter([discovery, support], session)
    session.router = router
    session.channel = "email"
    router.refresh_prompts("email")
    return router
