import re

with open("src/router.py", "r") as f:
    c = f.read()

# Helper to evaluate conditions
helper = """
def _evaluate_when(when_clause: dict, row: dict) -> bool:
    if not when_clause:
        return True
    for k, expected in when_clause.items():
        val = row.get(k)
        if isinstance(expected, list):
            if val not in expected: return False
        elif expected == "not_null":
            if val is None: return False
        elif expected == "is_null":
            if val is not None: return False
    return True

"""
c = c.replace("class Router:", helper + "class Router:")

# Update _build
build_old = """            if out_op == "delete":
                return {"key": key, "ts": ts}, ("n", key), None, "delete"
            event = {"key": key, "props": self._node_props(row, m), "ts": ts}
            for rel in m.relationships:"""
build_new = """            if out_op == "delete":
                return {"key": key, "ts": ts}, ("n", key), None, "delete"
                
            event = {"key": key, "props": self._node_props(row, m), "ts": ts}
            
            # E1: Conditional Labels
            dyn_labels = []
            for cl in getattr(m, 'conditional_labels', []):
                if _evaluate_when(cl.get("when", {}), row):
                    dyn_labels.append(cl["label"])
            if dyn_labels:
                event["dynamic_labels"] = dyn_labels
                
            # E2: Promote property to node
            promotions = []
            for p_col, p_spec in getattr(m, 'promote_property_to_node', {}).items():
                p_val = row.get(p_col)
                if p_val:
                    promotions.append({
                        "label": p_spec["label"],
                        "key_prop": p_spec.get("key", "id"),
                        "key_val": str(p_val),
                        "name_prop": "name",
                        "name_val": str(row.get(p_spec.get("name_from"))) if p_spec.get("name_from") else str(p_val),
                        "edge": p_spec["edge"]
                    })
            if promotions:
                event["promotions"] = promotions
                
            # E3: Conditional Relationships
            dyn_rels = []
            for cr in getattr(m, 'conditional_relationships', []):
                if _evaluate_when(cr.get("when", {}), row):
                    target_val = row.get(cr["from_column"])
                    if target_val:
                        if cr.get("coerce_to_string"): target_val = str(target_val)
                        dyn_rels.append({
                            "type": cr["type"],
                            "direction": cr.get("direction", "out"),
                            "target_label": cr["target_label"],
                            "target_key": cr["target_key"],
                            "target_val": target_val
                        })
            if dyn_rels:
                event["dynamic_relationships"] = dyn_rels
                
            for rel in m.relationships:"""
c = c.replace(build_old, build_new)

with open("src/router.py", "w") as f:
    f.write(c)
