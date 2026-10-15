import re

with open("src/config_loader.py", "r") as f:
    c = f.read()

# Update __init__
init_old = """    def __init__(self, config_dir: str | Path = "config"):
        self.config_dir = Path(config_dir)"""
init_new = """    def __init__(self, config_dir: str | Path = "config", overrides: dict = None, domain_overlay: str = None):
        self.config_dir = Path(config_dir)
        self.overrides = overrides or {}
        self.domain_overlay = Path(domain_overlay) if domain_overlay else None"""
c = c.replace(init_old, init_new)

# Update section()
section_old = """        try:
            raw = self.connections[name]
        except KeyError:
            return {}
        res = {k: os.path.expandvars(str(v)) for k, v in raw.items()}
        self._section_cache[name] = res
        return res"""
section_new = """        try:
            raw = self.connections.get(name, {})
        except KeyError:
            raw = {}
        res = {k: os.path.expandvars(str(v)) for k, v in raw.items()}
        if name in self.overrides:
            res.update(self.overrides[name])
        self._section_cache[name] = res
        return res"""
c = c.replace(section_old, section_new)

# Update effective()
eff_old = """    def effective(self, database: str) -> EffectiveMapping:
        \"\"\"Merged core+overlay mapping for one database.  Computed once, cached.\"\"\"
        if database in self._cache:
            return self._cache[database]
        path = self.overlay_path(database)
        overlay = load_yaml(path) if path.exists() else None
        eff = merge_overlay(self.core_tables, self.stub_labels, overlay, database, self.mappings_dir)
        self._cache[database] = eff
        return eff"""
eff_new = """    def effective(self, database: str) -> EffectiveMapping:
        \"\"\"Merged core+overlay mapping for one database.  Computed once, cached.\"\"\"
        if database in self._cache:
            return self._cache[database]
            
        # 1. Start with core
        tables = dict(self.core_tables)
        
        # 2. Apply Domain Overlay if specified
        if self.domain_overlay and self.domain_overlay.exists():
            from src.config_loader import load_yaml, merge_overlay
            domain_doc = load_yaml(self.domain_overlay)
            eff = merge_overlay(self.core_tables, self.stub_labels, domain_doc, database, self.mappings_dir)
            tables = eff.tables
            
        # 3. Apply Tenant Overlay if exists
        path = self.overlay_path(database)
        if path.exists():
            from src.config_loader import load_yaml, merge_overlay
            tenant_doc = load_yaml(path)
            # Re-merge on top of whatever we have so far
            eff = merge_overlay(tables, self.stub_labels, tenant_doc, database, self.mappings_dir)
        else:
            # Create a fake EffectiveMapping
            from dataclasses import dataclass
            from src.config_loader import EffectiveMapping
            eff = EffectiveMapping(tables, self.stub_labels)
            
        self._cache[database] = eff
        return eff"""
c = c.replace(eff_old, eff_new)

with open("src/config_loader.py", "w") as f:
    f.write(c)
