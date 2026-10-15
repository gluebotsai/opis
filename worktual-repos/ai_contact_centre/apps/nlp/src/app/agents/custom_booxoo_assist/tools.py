"""Passive Booxoo assist tools taken from the customer bot.

The customer draft can look up an email or phone the customer gives, confirm a Booxoo customer or lead, send OTP, and then check status, create, or resolve. The model chooses the tool. Profile, recent-order, and ticket lists are still loaded in the prompt when the caller is already known.
"""

from __future__ import annotations

from app.agents.custom_booxoo_assist.knowledge import product_knowledge_tool
from app.agents.custom_booxoo_assist.resolve import resolve_ticket_tool
from app.agents.custom_booxoo_bot.tools.identity import identity_tools
from app.agents.custom_booxoo_bot.tools.knowledge import business_knowledge_tool
from app.agents.custom_booxoo_bot.tools.orders import order_tools
from app.agents.custom_booxoo_bot.tools.ticketing import ticketing_tools
from app.agents.custom_booxoo_bot.tools.troubleshooting import troubleshooting_tool


def build_assist_tools(audience: str = "customer") -> list:
    identity = {tool.tool_schema["function"]["name"]: tool for tool in identity_tools()}
    orders = {tool.tool_schema["function"]["name"]: tool for tool in order_tools()}
    ticketing = {tool.tool_schema["function"]["name"]: tool for tool in ticketing_tools()}
    tools = [
        troubleshooting_tool(),
        business_knowledge_tool(),
        product_knowledge_tool(),
        orders["lookup_customer_details"],
        identity["send_otp"],
        identity["verify_otp"],
        orders["get_order_by_id"],
        orders["select_order_product"],
        ticketing["verify_ticketing_customer"],
        ticketing["get_ticket_status"],
        resolve_ticket_tool(),
    ]
    if audience == "agent":
        from app.agents.custom_booxoo_assist.confirm import create_booxoo_ticket_tool

        tools.append(create_booxoo_ticket_tool())
    return tools
