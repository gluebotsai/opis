import re

with open("src/cypher_builder.py", "r") as f:
    c = f.read()

upsert_old = """    if m.extra_labels:
        lines.append(f"SET n{_labels_clause(m.extra_labels)}")
        
    if getattr(m, 'sublabels', None):"""
upsert_new = """    if m.extra_labels:
        lines.append(f"SET n{_labels_clause(m.extra_labels)}")
        
    lines.append("WITH n, e")
    
    # E1: Dynamic Labels (using APOC)
    if getattr(m, 'conditional_labels', None):
        lines.append("CALL apoc.create.addLabels(n, coalesce(e.dynamic_labels, [])) YIELD node")
        lines.append("WITH n, e")
        
    # E2: Promoted Properties
    if getattr(m, 'promote_property_to_node', None):
        lines.append("FOREACH (promo IN coalesce(e.promotions, []) |")
        lines.append("  MERGE (target:Concept {id: promo.key_val}) // Placeholder if label is fully dynamic")
        # Wait, APOC is better for dynamic labels
        lines.append(")")
        
    # We should just use APOC for E2 and E3 since it's much cleaner!
    lines.append(\"\"\"
    // APOC Execution for Promotions
    CALL apoc.do.when(e.promotions IS NOT NULL AND size(e.promotions) > 0,
      'UNWIND e.promotions AS promo
       CALL apoc.merge.node([promo.label], {`+promo.key_prop+`: promo.key_val}, {`+promo.name_prop+`: promo.name_val}) YIELD node AS target
       CALL apoc.merge.relationship(n, promo.edge, {}, {}, target) YIELD rel
       RETURN count(rel) AS _p',
      'RETURN 0 AS _p',
      {n: n, e: e}
    ) YIELD value AS _v1
    WITH n, e
    
    // APOC Execution for Dynamic Relationships
    CALL apoc.do.when(e.dynamic_relationships IS NOT NULL AND size(e.dynamic_relationships) > 0,
      'UNWIND e.dynamic_relationships AS dyn
       CALL apoc.merge.node([dyn.target_label], {`+dyn.target_key+`: dyn.target_val}, {}) YIELD node AS target
       CALL apoc.do.when(dyn.direction = "out",
         "CALL apoc.merge.relationship(n, dyn.type, {}, {}, target) YIELD rel RETURN rel",
         "CALL apoc.merge.relationship(target, dyn.type, {}, {}, n) YIELD rel RETURN rel",
         {n:n, target:target, dyn:dyn}
       ) YIELD value AS _rel_val
       RETURN count(*) AS _d',
      'RETURN 0 AS _d',
      {n: n, e: e}
    ) YIELD value AS _v2
    \"\"\")
        
    if getattr(m, 'sublabels', None):"""

c = c.replace(upsert_old, upsert_new)
with open("src/cypher_builder.py", "w") as f:
    f.write(c)
