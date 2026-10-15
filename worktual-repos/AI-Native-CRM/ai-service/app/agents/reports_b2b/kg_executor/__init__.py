# kg_executor package — CRM B2B knowledge graph (separate from SQL core/product)

from app.agents.reports_b2b.kg_executor.core.orchestrator import CRMB2BKGAgent
from app.agents.reports_b2b.kg_executor.core.models import AgentContext

__all__ = ["CRMB2BKGAgent", "AgentContext"]
