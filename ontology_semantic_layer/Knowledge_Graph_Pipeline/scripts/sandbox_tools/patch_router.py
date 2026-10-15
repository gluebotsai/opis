with open("src/router.py", "r") as f:
    content = f.read()

import re

# Add the failsafe function at the top level
failsafe_func = """
def _sanitize_for_neo4j(v: Any) -> Any:
    \"\"\"Failsafe for complex types: Neo4j cannot store Maps/Dicts or complex arrays.\"\"\"
    if isinstance(v, dict) or (isinstance(v, list) and any(isinstance(x, (dict, list)) for x in v)):
        import json
        try:
            # default=str acts as a safety net for non-serializable objects like UUIDs/Datetimes
            return json.dumps(v, default=str)
        except Exception:
            # Ultimate failsafe: force convert to a raw string if JSON parsing completely fails
            return str(v)
    return v

"""

content = content.replace("class Router:", failsafe_func + "class Router:")

# Replace the inline json.dumps inside _node_props
old_code_props = """            # Neo4j cannot store Maps/Dicts or Arrays of Dicts.
            if isinstance(v, dict):
                import json
                v = json.dumps(v)
            elif isinstance(v, list) and any(isinstance(x, (dict, list)) for x in v):
                import json
                v = json.dumps(v)"""

content = content.replace(old_code_props, "            v = _sanitize_for_neo4j(v)")

old_code_custom = """        for k, v in custom.items():
            if isinstance(v, dict):
                import json
                v = json.dumps(v)
            elif isinstance(v, list) and any(isinstance(x, (dict, list)) for x in v):
                import json
                v = json.dumps(v)
            props[k] = v"""

new_code_custom = """        for k, v in custom.items():
            props[k] = _sanitize_for_neo4j(v)"""

content = content.replace(old_code_custom, new_code_custom)

with open("src/router.py", "w") as f:
    f.write(content)
