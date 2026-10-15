from neo4j import GraphDatabase

driver = GraphDatabase.driver("bolt://10.180.0.126:7687", auth=("neo4j", "Neo4j@789"))
with driver.session(database="org1000") as session:
    res1 = session.run("MATCH (n:ProactiveHistory) RETURN count(n) as count").single()
    res2 = session.run("MATCH (n:Ticket)-[r:HAS_PROACTIVE_HISTORY]->(m:ProactiveHistory) RETURN count(r) as count").single()
    res3 = session.run("MATCH (m:ProactiveHistory)-[r:CONTAINS]->(p:ProactiveApproval) RETURN count(r) as count").single()
    
    print(f"ProactiveHistory nodes: {res1['count']}")
    print(f"HAS_PROACTIVE_HISTORY edges (Ticket->Hub): {res2['count']}")
    print(f"CONTAINS edges (Hub->Approval): {res3['count']}")
