from neo4j import GraphDatabase
uri = "bolt://10.180.0.126:7687"
user = "neo4j"
password = "Neo4j@789"
driver = GraphDatabase.driver(uri, auth=(user, password))
with driver.session(database="org1000") as session:
    res1 = session.run("MATCH (c:Contact) RETURN c.cdp_id LIMIT 1")
    for r in res1:
        print("Contact cdp_id type:", type(r['c.cdp_id']), "value:", r['c.cdp_id'])
    res2 = session.run("MATCH (i:Insight) RETURN i.cdp_id LIMIT 1")
    for r in res2:
        print("Insight cdp_id type:", type(r['i.cdp_id']), "value:", r['i.cdp_id'])
