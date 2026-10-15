from neo4j import GraphDatabase
uri = "bolt://10.180.0.126:7687"
user = "neo4j"
password = "Neo4j@789"
driver = GraphDatabase.driver(uri, auth=(user, password))
with driver.session(database="org1000") as session:
    uuid = "074a11ae-ca5e-465e-9212-164a1a031b0f"
    
    c = list(session.run("MATCH (c:Contact {cdp_id: $u}) RETURN c.cdp_id", u=uuid))
    print("Contact exists?", len(c))
    
    ic = list(session.run("MATCH (ic:InsightCollection {cdp_id: $u}) RETURN ic.cdp_id", u=uuid))
    print("InsightCollection exists?", len(ic))
    
    i = list(session.run("MATCH (i:Insight {cdp_id: $u}) RETURN i.insight_id", u=uuid))
    print("Insights exist?", len(i))
    
    rel1 = list(session.run("MATCH (c:Contact {cdp_id: $u})-[r]->(ic:InsightCollection) RETURN type(r)", u=uuid))
    print("Contact -> InsightCollection rels:", len(rel1))
    
    rel2 = list(session.run("MATCH (ic:InsightCollection {cdp_id: $u})-[r]->(i:Insight) RETURN type(r)", u=uuid))
    print("InsightCollection -> Insight rels:", len(rel2))
