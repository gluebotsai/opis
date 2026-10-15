import re

with open("src/config_loader.py", "r") as f:
    c = f.read()

# Add new dataclass fields to TableMapping
tm_old = """    custom_dynamic: bool = False
    extra_labels: list[str] = field(default_factory=list)
    sublabels: dict = field(default_factory=dict)
    relationships: list[RelationshipSpec] = field(default_factory=list)"""
tm_new = """    custom_dynamic: bool = False
    extra_labels: list = field(default_factory=list)
    conditional_labels: list = field(default_factory=list)
    promote_property_to_node: dict = field(default_factory=dict)
    derive_hierarchy: list = field(default_factory=list)
    sublabels: dict = field(default_factory=dict)
    relationships: list = field(default_factory=list)
    conditional_relationships: list = field(default_factory=list)"""
c = c.replace(tm_old, tm_new)

# Update merge_overlay to parse them
mo_old = """        for lbl in ext.get("extra_labels") or []:
            if lbl not in m.extra_labels:
                m.extra_labels.append(str(lbl))
        for p in ext.get("custom_properties") or []:"""
mo_new = """        for lbl in ext.get("extra_labels") or []:
            if isinstance(lbl, dict):
                m.conditional_labels.append(lbl)
            elif lbl not in m.extra_labels:
                m.extra_labels.append(str(lbl))
                
        # Parse E2: promotions and hierarchy
        if "promote_property_to_node" in ext:
            m.promote_property_to_node.update(ext["promote_property_to_node"])
        if "derive_hierarchy" in ext:
            m.derive_hierarchy.extend(ext["derive_hierarchy"])
        if "conditional_relationships" in ext:
            m.conditional_relationships.extend(ext["conditional_relationships"])
            
        for p in ext.get("custom_properties") or []:"""
c = c.replace(mo_old, mo_new)

with open("src/config_loader.py", "w") as f:
    f.write(c)
