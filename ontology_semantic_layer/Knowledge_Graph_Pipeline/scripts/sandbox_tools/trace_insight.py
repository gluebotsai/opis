from neo4j import GraphDatabase
uri = "bolt://10.180.0.126:7687"
user = "neo4j"
password = "Neo4j@789"
driver = GraphDatabase.driver(uri, auth=(user, password))
with driver.session(database="org1000") as session:
    uuid = "074a11ae-ca5e-465e-9212-164a1a031b0f"
    print(f"Tracing {uuid}:")
    
    # 1. Check Contact -> InsightCollection
    res1 = session.run("MATCH (c:Contact {cdp_id: $u})-[r:HAS_INSIGHTS]->(ic:InsightCollection) RETURN ic.cdp_id", u=uuid)
    print("Contact HAS_INSIGHTS -> InsightCollection:", [r['ic.cdp_id'] for r in res1])
    
    # 2. Check InsightCollection -> Insight
    res2 = session.run("MATCH (ic:InsightCollection {cdp_id: $u})-[r:CONTAINS]->(i:Insight) RETURN i.insight_id", u=uuid)
    print("InsightCollection CONTAINS -> Insight:", [r['i.insight_id'] for r in res2])
    
    # 3. Check Insight nodes directly
    res3 = session.run("MATCH (i:Insight {cdp_id: $u}) RETURN i.insight_id, size((i)--()) as rels", u=uuid)
    for r in res3:
        print(f"Insight node {r['i.insight_id']} has {r['rels']} relationships.")
