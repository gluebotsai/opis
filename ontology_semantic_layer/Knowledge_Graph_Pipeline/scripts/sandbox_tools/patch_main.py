import re

with open("main.py", "r") as f:
    c = f.read()

# Add args to the root parser
args_block = """    p = argparse.ArgumentParser(prog="cdc-pipeline", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--config", default="config", help="config directory (default: config)")
    p.add_argument("--log-level", default="INFO")
    
    # Overrides for testing
    p.add_argument("--neo4j-uri", help="Override Neo4j URI")
    p.add_argument("--neo4j-user", help="Override Neo4j User")
    p.add_argument("--neo4j-password", help="Override Neo4j Password")
    p.add_argument("--domain-overlay", help="Path to domain overlay to force apply (e.g. config/mappings/domains/ecommerce.yaml)")
"""
c = re.sub(r'    p = argparse.ArgumentParser[\s\S]*?p.add_argument\("--log-level", default="INFO"\)', args_block, c)

# Update _load
load_block = """def _load(args) -> ConfigLoader:
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass
    
    neo4j_overrides = {}
    if getattr(args, "neo4j_uri", None): neo4j_overrides["uri"] = args.neo4j_uri
    if getattr(args, "neo4j_user", None): neo4j_overrides["user"] = args.neo4j_user
    if getattr(args, "neo4j_password", None): neo4j_overrides["password"] = args.neo4j_password
    
    overrides = {"neo4j": neo4j_overrides} if neo4j_overrides else None
    
    domain_overlay = getattr(args, "domain_overlay", None)
    
    return ConfigLoader(args.config, overrides=overrides, domain_overlay=domain_overlay)
"""
c = re.sub(r'def _load\(args\) -> ConfigLoader:[\s\S]*?return ConfigLoader\(args\.config\)', load_block, c)

with open("main.py", "w") as f:
    f.write(c)
