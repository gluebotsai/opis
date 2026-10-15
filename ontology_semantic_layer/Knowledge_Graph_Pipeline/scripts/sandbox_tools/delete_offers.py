from neo4j import GraphDatabase

driver = GraphDatabase.driver("bolt://10.180.0.126:7687", auth=("neo4j", "Neo4j@789"))
with driver.session(database="org1000") as session:
    res = session.run("MATCH (n:Product)-[r:OFFERS]-(m:Tenant) RETURN count(r) as count").single()
    count = res['count']
    if count > 0:
        print(f"Deleting {count} old OFFERS edges...")
        session.run("MATCH (n:Product)-[r:OFFERS]-(m:Tenant) CALL (r) { DELETE r } IN TRANSACTIONS OF 10000 ROWS")
    else:
        print("No old OFFERS edges found.")
