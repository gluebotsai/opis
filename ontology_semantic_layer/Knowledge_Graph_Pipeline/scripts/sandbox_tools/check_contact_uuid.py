from neo4j import GraphDatabase
uri = "bolt://10.180.0.126:7687"
user = "neo4j"
password = "Neo4j@789"
driver = GraphDatabase.driver(uri, auth=(user, password))
with driver.session(database="org1000") as session:
    uuids = [
        "074a11ae-ca5e-465e-9212-164a1a031b0f",
        "e788bdfe-da75-40d7-9cf2-5bd9402ce391",
        "6966eb11-d797-44da-a939-a548b1359ac5"
    ]
    for u in uuids:
        res = session.run("MATCH (c:Contact {cdp_id: $uuid}) RETURN c.cdp_id", uuid=u)
        records = list(res)
        print(f"Found Contact for {u}: {len(records)}")
