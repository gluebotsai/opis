import re
with open("src/cypher_builder.py", "r") as f:
    c = f.read()

old = """    if getattr(m, 'conditional_labels', None):
        lines.append("CALL apoc.create.addLabels(n, coalesce(e.dynamic_labels, [])) YIELD node")
        lines.append("WITH n, e")"""

new = """    if getattr(m, 'conditional_labels', None):
        lines.append("CALL apoc.do.when(e.dynamic_labels IS NOT NULL AND size(e.dynamic_labels) > 0,")
        lines.append("  'CALL apoc.create.addLabels(n, e.dynamic_labels) YIELD node RETURN node',")
        lines.append("  'RETURN n AS node',")
        lines.append("  {n: n, e: e}")
        lines.append(") YIELD value AS _v3")
        lines.append("WITH n, e")"""

c = c.replace(old, new)
with open("src/cypher_builder.py", "w") as f:
    f.write(c)
