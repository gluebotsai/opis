"""CCaaS Knowledge Graph Agent Core Package."""

from .models import AgentContext, Fact, QueryResult, SynthesisOutput
from .orchestrator import CCaaSKGAgent

__all__ = [
    "AgentContext",
    "Fact",
    "QueryResult",
    "SynthesisOutput",
    "CCaaSKGAgent",
]
