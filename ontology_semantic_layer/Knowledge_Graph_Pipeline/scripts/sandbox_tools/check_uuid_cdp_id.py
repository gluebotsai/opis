from neo4j import GraphDatabase
uri = "bolt://10.180.0.126:7687"
user = "neo4j"
password = "Neo4j@789"
driver = GraphDatabase.driver(uri, auth=(user, password))
with driver.session(database="org1000") as session:
    res = session.run("MATCH (i:Insight {cdp_id: '074a11ae-ca5e-465e-9212-164a1a031b0f'}) RETURN i.insight_id, i.cdp_id")
    for r in res:
        print("Found Insight with this cdp_id:", r['i.insight_id'], r['i.cdp_id'])
