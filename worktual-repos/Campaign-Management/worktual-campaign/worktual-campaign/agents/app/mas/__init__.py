"""Multi-Agent System (MAS) — Super → Domain → Executor → tools.

Production default: MAS_ENABLED_DOMAINS=all.
Set empty for legacy-only rollback. Skills deferred.
"""

from __future__ import annotations

from app.mas.runtime.flags import is_domain_enabled, parse_enabled_domains
from app.mas.runtime.invoke import mas_invoke

__all__ = [
    "is_domain_enabled",
    "mas_invoke",
    "parse_enabled_domains",
]
