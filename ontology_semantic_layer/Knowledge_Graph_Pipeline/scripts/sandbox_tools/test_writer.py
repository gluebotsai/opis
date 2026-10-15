import sys
sys.path.append('.')
from src.config_loader import ConfigLoader
from src.writer import GraphWriter

cl = ConfigLoader('config')
w = GraphWriter(cl.connections, cl.mappings)

payload = {
    "cdp_id": "074a11ae-ca5e-465e-9212-164a1a031b0f",
    "organization_id": 1000
}
w.write("org1000", "cdp.customer_profile", payload, "upsert")
print("Wrote Contact!")

payload_insight = {
    "insight_id": "bedbe5eb-3e72-4cc6-bb16-6c851e0da131",
    "cdp_id": "074a11ae-ca5e-465e-9212-164a1a031b0f",
    "organization_id": 1000
}
w.write("org1000", "cdp.ai_insights", payload_insight, "upsert")
print("Wrote Insight!")
