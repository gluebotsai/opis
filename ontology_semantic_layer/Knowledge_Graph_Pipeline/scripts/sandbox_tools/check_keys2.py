from neo4j import GraphDatabase
uri = "bolt://10.180.0.126:7687"
user = "neo4j"
password = "Neo4j@789"
driver = GraphDatabase.driver(uri, auth=(user, password))
with driver.session(database="org1000") as session:
    res = session.run("MATCH (i:Insight) RETURN i.id, i.cdp_id, i.organization_id LIMIT 5")
    for r in res:
        print("Insight id:", r['i.id'], "cdp_id:", r['i.cdp_id'])
