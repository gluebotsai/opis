"""Tool sets for Booxoo Discovery and Support agents."""

from app.agents.custom_booxoo_assist.knowledge import product_knowledge_tool
from app.agents.custom_booxoo_bot.tools.contact_enrich import contact_enrich_tool
from app.agents.custom_booxoo_bot.tools.handoff import handoff_tools
from app.agents.custom_booxoo_bot.tools.identity import identity_tools
from app.agents.custom_booxoo_bot.tools.knowledge import business_knowledge_tool
from app.agents.custom_booxoo_bot.tools.orders import order_tools
from app.agents.custom_booxoo_bot.tools.router import route_tool
from app.agents.custom_booxoo_bot.tools.ticketing import ticketing_tools
from app.agents.custom_booxoo_bot.tools.troubleshooting import troubleshooting_tool


def _chat_verification_tools() -> list:
    named = {tool.tool_schema["function"]["name"]: tool for tool in identity_tools()}
    return [named["send_otp"], named["verify_otp"]]


def build_email_tools(agent: str) -> list:
    shared = [route_tool(), contact_enrich_tool()]
    if agent == "discovery":
        return shared + [
            business_knowledge_tool(),
            identity_tools()[0],
            *handoff_tools(),
        ]
    if agent == "support":
        return shared + [
            troubleshooting_tool(),
            business_knowledge_tool(),
            identity_tools()[0],
            *order_tools(email_mode=True),
            *ticketing_tools(email_mode=True),
            *handoff_tools(),
        ]
    raise ValueError(f"unknown email agent tool set: {agent}")


def build_tools(agent: str) -> list:
    shared = [route_tool(), contact_enrich_tool()]
    if agent == "discovery":
        return shared + [
            business_knowledge_tool(),
            product_knowledge_tool(),
            *handoff_tools(),
        ]
    if agent == "support":
        return shared + [
            troubleshooting_tool(),
            business_knowledge_tool(),
            product_knowledge_tool(),
            *_chat_verification_tools(),
            *order_tools(),
            *ticketing_tools(),
            *handoff_tools(),
        ]
    raise ValueError(f"unknown agent tool set: {agent}")
