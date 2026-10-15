import os
import json
from pathlib import Path
import meilisearch
from neo4j import GraphDatabase

ROOT = Path(__file__).resolve().parent.parent

NEO4J_URI = os.getenv("NEO4J_URI", "neo4j://10.180.0.126:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "Neo4j@789")

MEILI_URL = os.getenv("MEILISEARCH_URL", "http://82.113.92.44:7700")
MEILI_KEY = os.getenv("MEILISEARCH_API_KEY", "Worktual-123")
MEILI_INDEX = os.getenv("MEILISEARCH_INDEX", "kg_ccaas")

def run():
    print("Connecting to Neo4j...")
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    
    labels = []
    rels = []
    properties = set()
    node_props = {}
    
    with driver.session(database="org1012") as session:
        # Get labels
        labels = session.run("CALL db.labels()").value()
        
        # Get rels
        rels = session.run("CALL db.relationshipTypes()").value()
        
        # Get node properties
        res = session.run("CALL db.schema.nodeTypeProperties() YIELD nodeType, propertyName RETURN nodeType, propertyName")
        for r in res:
            nt = r["nodeType"]
            prop = r["propertyName"]
            properties.add(prop)
            if nt not in node_props:
                node_props[nt] = []
            node_props[nt].append(prop)
            
    print(f"Extracted {len(labels)} labels, {len(rels)} relationships.")
    
    # Write schema_registry.json
    registry = {
        "labels": labels,
        "relationships": rels,
        "properties": list(properties)
    }
    
    out_dir = ROOT / "ontology"
    out_dir.mkdir(exist_ok=True)
    with open(out_dir / "schema_registry.json", "w") as f:
        json.dump(registry, f, indent=2)
    print("Wrote schema_registry.json")
    
    # Sync to Meilisearch
    print("Connecting to Meilisearch...")
    client = meilisearch.Client(MEILI_URL, MEILI_KEY)
    index = client.index(MEILI_INDEX)
    
    documents = []
    for i, label in enumerate(labels):
        # We can create a rich search document for each label
        props_for_label = []
        for nt, plist in node_props.items():
            if f":`{label}`" in nt or f":{label}" in nt:
                props_for_label.extend(plist)
                
        doc = {
            "id": f"label_{i}",
            "type": "Node Label",
            "name": label,
            "description": f"Graph node label: {label}",
            "properties": list(set(props_for_label)),
            "query_template": f"MATCH (n:{label}) RETURN count(n)"
        }
        documents.append(doc)
        
    for i, rel in enumerate(rels):
        doc = {
            "id": f"rel_{i}",
            "type": "Relationship Type",
            "name": rel,
            "description": f"Graph edge relationship: {rel}",
            "properties": [],
            "query_template": f"MATCH ()-[r:{rel}]->() RETURN count(r)"
        }
        documents.append(doc)
        
    task = index.add_documents(documents)
    print(f"Sent {len(documents)} schema entities to Meilisearch index {MEILI_INDEX}.")

if __name__ == "__main__":
    run()
