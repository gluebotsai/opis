from neo4j import GraphDatabase
uri = "bolt://10.180.0.126:7687"
user = "neo4j"
password = "Neo4j@789"
driver = GraphDatabase.driver(uri, auth=(user, password))
with driver.session(database="org1000") as session:
    res = session.run("MATCH (c:InsightCollection) RETURN c.cdp_id, count(c)")
    for r in res:
        print("InsightCollection cdp_id type:", type(r['c.cdp_id']), "value:", r['c.cdp_id'], "count:", r['count(c)'])
