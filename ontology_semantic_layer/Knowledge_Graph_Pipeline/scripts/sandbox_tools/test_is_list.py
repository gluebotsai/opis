import sys
sys.path.append('.')
from src.config_loader import ConfigLoader
from src.cypher_builder import build_node_upsert

cl = ConfigLoader('config')
# Just hack a relationship to test
t = cl.core_tables['accounts.setup_teams']
t.relationships.append(type('Rel', (), {
    'direction': 'out',
    'type': 'HAS_MEMBER',
    'target_label': 'User',
    'target_key': 'id',
    'from_column': 'member_ids',
    'payload_key': 'rel_member_ids',
    'is_list': True,
    'coerce_to_int': True,
    'create_target': False
}))
q = build_node_upsert(t, cl.connections.get('cypher', {}).get('subquery_syntax', 'scoped'))
print(q)
