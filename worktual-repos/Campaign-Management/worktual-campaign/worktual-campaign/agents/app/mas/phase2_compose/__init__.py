"""Phase 2 email compose domain (adopted). Prompts unchanged.

Enable with PHASE2_EMAIL_COMPOSE_ENABLED=true. Flag off → existing director path.
"""

from app.mas.phase2_compose.domain import TemplateDomain

__all__ = ["TemplateDomain"]
