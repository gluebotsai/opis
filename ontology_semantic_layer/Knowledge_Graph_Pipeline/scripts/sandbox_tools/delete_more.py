from neo4j import GraphDatabase

driver = GraphDatabase.driver("bolt://10.180.0.126:7687", auth=("neo4j", "Neo4j@789"))
with driver.session(database="org1000") as session:
    rels_to_delete = ["DEFINES_DISPOSITION", "HAS_SENDING_PROFILE", "HAS_REPLY_TEMPLATE"]
    for rel in rels_to_delete:
        res = session.run(f"MATCH (n)-[r:{rel}]-(m:Tenant) RETURN count(r) as count").single()
        count = res['count']
        if count > 0:
            print(f"Deleting {count} {rel} edges...")
            session.run(f"MATCH (n)-[r:{rel}]-(m:Tenant) CALL (r) {{ DELETE r }} IN TRANSACTIONS OF 10000 ROWS")
        else:
            print(f"No {rel} edges found.")
