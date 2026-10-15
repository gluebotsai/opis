import json

def sanitize_for_neo4j(val):
    if isinstance(val, dict):
        return json.dumps(val)
    if isinstance(val, list):
        # Neo4j supports arrays of primitives, but not arrays of dicts/arrays
        if any(isinstance(x, (dict, list)) for x in val):
            return json.dumps(val)
    return val

print(sanitize_for_neo4j({'score': 82}))
print(sanitize_for_neo4j([1, 2, 3]))
print(sanitize_for_neo4j([{'a': 1}]))
