import sys
sys.path.append('.')
from src.config_loader import ConfigLoader
from src.cypher_builder import build_node_upsert

cl = ConfigLoader('config')
t = cl.core_tables['ticketing.tickets']
q = build_node_upsert(t, cl.connections.get('cypher', {}).get('subquery_syntax', 'scoped'))
print(q)
