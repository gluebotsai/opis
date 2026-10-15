from neo4j import GraphDatabase

uri = "bolt://10.180.0.126:7687"
user = "neo4j"
password = "Neo4j@789"
driver = GraphDatabase.driver(uri, auth=(user, password))

with driver.session(database="org1000") as session:
    t_str = session.run("MATCH (t:Ticket {id: '1000'}) RETURN t.id").single()
    t_int = session.run("MATCH (t:Ticket {id: 1000}) RETURN t.id").single()
    
    print(f"Ticket with String '1000' exists? {t_str is not None}")
    print(f"Ticket with Integer 1000 exists? {t_int is not None}")
