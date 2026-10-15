from neo4j import GraphDatabase
uri = "bolt://10.180.0.126:7687"
user = "neo4j"
password = "Neo4j@789"
driver = GraphDatabase.driver(uri, auth=(user, password))
with driver.session(database="org1000") as session:
    res = session.run("MATCH (c:Contact {cdp_id: '31'}) RETURN c.cdp_id")
    records = list(res)
    print("Found contact with cdp_id '31' (string):", len(records))

    res2 = session.run("MATCH (c:Contact {cdp_id: 31}) RETURN c.cdp_id")
    records2 = list(res2)
    print("Found contact with cdp_id 31 (int):", len(records2))
