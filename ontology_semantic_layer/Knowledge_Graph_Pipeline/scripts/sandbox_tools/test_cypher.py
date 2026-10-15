import sys
sys.path.append('.')
from src.config_loader import ConfigLoader
from src.cypher_builder import build_upsert_query

cl = ConfigLoader('config')
t = cl.mappings['cdp.ai_insights']
q = build_upsert_query(t, cl.connections)
print(q)
