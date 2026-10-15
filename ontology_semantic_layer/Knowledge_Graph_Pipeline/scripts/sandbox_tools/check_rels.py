import yaml
with open("config/mappings/core.yaml") as f:
    data = yaml.safe_load(f)

labels = ["KnowledgeArticle", "TicketAgent", "CampaignIdea", "CampaignAlert", 
          "ProductOffer", "Addon", "PriceBook", "ProductEntitlement", 
          "EmailSuppression", "PushEndpoint"]

for table, spec in data.get("tables", {}).items():
    if spec.get("mode") == "node":
        label = spec.get("label")
        if label in labels:
            rels = spec.get("relationships") or []
            print(f"\nNode: {label} (Table: {table})")
            for r in rels:
                if not r.get("target_label") == "Tenant":
                    print(f"  -> {r.get('type')} -> {r.get('target_label')}")
                else:
                    print(f"  [Severed Tenant Edge: {r.get('type')}]")
