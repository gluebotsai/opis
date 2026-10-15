from neo4j import GraphDatabase

uri = "bolt://10.180.0.126:7687"
user = "neo4j"
password = "Neo4j@789"
driver = GraphDatabase.driver(uri, auth=(user, password))

rels_to_delete = [
    "HAS_TICKET",
    "HAS_VISITOR",
    "HAS_AUDIT_EVENT",
    "HAS_WORKFLOW_EVENT",
    "HAS_WORKFLOW_SESSION",
    "FOR_TENANT"
]

with driver.session(database="org1000") as session:
    for rel in rels_to_delete:
        res = session.run(f"MATCH (n)-[r:{rel}]-(m:Tenant) RETURN count(r) as count")
        count = res.single()['count']
        if count > 0:
            print(f"Deleting {count} {rel} edges...")
            session.run(f"MATCH (n)-[r:{rel}]-(m:Tenant) CALL {{ WITH r DELETE r }} IN TRANSACTIONS OF 10000 ROWS")
        else:
            print(f"No {rel} edges found.")
            
print("Cleanup complete.")
