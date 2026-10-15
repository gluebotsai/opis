"""MAS runtime package."""

from __future__ import annotations

from app.mas.runtime.bindings import resolve_cron_binding, resolve_hub_binding
from app.mas.runtime.flags import is_domain_enabled, is_module_mas_enabled, parse_enabled_domains
from app.mas.runtime.handoffs import invoke_executor_result, route_to_domain_result
from app.mas.runtime.invoke import mas_invoke

__all__ = [
    "is_domain_enabled",
    "is_module_mas_enabled",
    "invoke_executor_result",
    "mas_invoke",
    "parse_enabled_domains",
    "resolve_cron_binding",
    "resolve_hub_binding",
    "route_to_domain_result",
]
