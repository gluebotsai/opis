"""Deterministic routing policy for Hub remote-agent delegation."""

HUB_DELEGATION_ROUTING_POLICY = """
Contact Centre A2A supervisor may delegate to Intelligent Hub only when ALL are true:
1. The request is CCaaS-originated (source is not "hub" and execution profile is not hub-delegated).
2. hopCount is below the configured delegation hop budget.
3. The leftover query is outside Contact Centre-owned skills (CRM, campaigns, CVM, cross-product planning).
4. Hub is called with spoke label "CCaaS", metadata.source="ccaas", and no Hub skillId.
Never delegate Hub-originated work back to Hub (no ping-pong).
""".strip()
