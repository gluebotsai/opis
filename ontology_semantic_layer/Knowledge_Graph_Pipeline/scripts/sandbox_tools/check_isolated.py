from neo4j import GraphDatabase

uri = "bolt://10.180.0.126:7687"
user = "neo4j"
password = "Neo4j@789"
driver = GraphDatabase.driver(uri, auth=(user, password))

labels_to_check = [
    "LeadScoringJob", 
    "LeadEnrichmentJob", 
    "LeadSummary", 
    "ProactiveApproval",
    "OutboundEmail"
]

with driver.session(database="org1000") as session:
    for label in labels_to_check:
        print(f"\n--- Checking {label} ---")
        
        # Get one isolated node
        res = session.run(f"MATCH (n:{label}) WHERE NOT (n)--() RETURN n LIMIT 1")
        record = res.single()
        if not record:
            print("No isolated nodes found.")
            continue
            
        node = record['n']
        print(f"Isolated Node Properties: {dict(node)}")
        
        # Check contact_id if it exists
        if 'contact_id' in node:
            c_id = node['contact_id']
            # Does this Contact exist in Neo4j?
            c_res = session.run("MATCH (c:Contact {cdp_id: $cid}) RETURN c.cdp_id", cid=c_id)
            c_exists = c_res.single() is not None
            print(f"Target Contact (cdp_id={c_id}) exists in Neo4j? {c_exists}")
            
        if 'organization_id' in node:
            o_id = node['organization_id']
            # Does this Tenant exist in Neo4j?
            o_res = session.run("MATCH (t:Tenant {id: $oid}) RETURN t.id", oid=o_id)
            o_exists = o_res.single() is not None
            print(f"Target Tenant (id={o_id}) exists in Neo4j? {o_exists}")
            
        if 'cdp_id' in node:
            c_id = node['cdp_id']
            c_res = session.run("MATCH (c:Contact {cdp_id: $cid}) RETURN c.cdp_id", cid=c_id)
            c_exists = c_res.single() is not None
            print(f"Target Contact (cdp_id={c_id}) exists in Neo4j? {c_exists}")
