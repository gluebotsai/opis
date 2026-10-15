"""Fetch org1000 slices with required product / products origin fields."""

from ontology.slice import fetch_ontology_slice

SAMPLES = [
    ("agent+product", "cc.ai_support", {"product": "ccaas"}),
    ("agent+product", "tk.tickets", {"product": "ticketing"}),
    ("agent+product", "crm.deals", {"product": "crm"}),
    ("agent+products", "hub.orchestrator", {"products": ["ccaas", "crm"]}),
]

if __name__ == "__main__":
    for kind, name, origin in SAMPLES:
        pack = fetch_ontology_slice(agent=name, tenant="org1000", **origin)
        print("=" * 72)
        print(f"{kind}={name}  {origin}  modules={pack.resolved_modules}")
        print(pack.as_prompt())
        print()
