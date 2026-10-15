import os
from neo4j import GraphDatabase
from dotenv import load_dotenv

load_dotenv()

URI = os.getenv("NEO4J_URI", "bolt://10.180.0.126:7687")
USER = os.getenv("NEO4J_USER", "neo4j")
PASSWORD = os.getenv("NEO4J_PASSWORD", "password") # fallback if needed

driver = GraphDatabase.driver(URI, auth=(USER, PASSWORD))

query = """
// 1. Pick ANY ticket that has an embedding
MATCH (source:Ticket)
WHERE source._embedding IS NOT NULL
WITH source LIMIT 1

// 2. Find tickets similar to it
CALL db.index.vector.queryNodes('ticket__embedding_vector', 5, source._embedding) 
YIELD node AS similar_ticket, score
WHERE similar_ticket.id <> source.id

RETURN source.id AS source_id, 
       source.subject AS source_subject,
       similar_ticket.id AS match_id, 
       similar_ticket.subject AS match_subject, 
       score
ORDER BY score DESC
"""

try:
    with driver.session(database="org1012") as session:
        result = session.run(query)
        records = list(result)
        
        if not records:
            print("No similar tickets found or no tickets have embeddings yet.")
        else:
            print(f"Source Ticket: {records[0]['source_id']} - {records[0]['source_subject']}")
            print("-" * 60)
            print("Similar Tickets Found:")
            for r in records:
                print(f"Score: {r['score']:.4f} | ID: {r['match_id']} | Subject: {r['match_subject']}")
finally:
    driver.close()
