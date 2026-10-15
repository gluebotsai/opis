"""
extract_websites.py

This script extracts website configurations from accounts.active_products
and upserts them into Neo4j as (:Website) nodes linked to (:WebTrackingCatalog).

Requirements:
- Reads config JSON column: config.visitorAllowanceBySlot -> {slot_id: {"url": ...}}
- Upserts nodes using Neo4j driver into the correct tenant databases (e.g. org1000)
"""

import os
import sys
import json
import logging
import argparse
import urllib.parse
from typing import Dict, Any, List, Tuple

try:
    import psycopg2
except ImportError:
    try:
        import psycopg as psycopg2
    except ImportError:
        psycopg2 = None

from neo4j import GraphDatabase
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("extract_websites")

CYPHER_UPSERT_WEBSITE = """
MERGE (w:Website {website_id: $website_id, organization_id: $org_id})
SET w.url = $url, w.updated_at = datetime()
WITH w
MERGE (c:WebTrackingCatalog {organization_id: $org_id})
MERGE (c)<-[:BELONGS_TO]-(w)
"""

def get_postgres_dsn() -> str:
    dsn = os.getenv("POSTGRES_DSN")
    if dsn: return dsn
    pg_host = os.getenv("PG_HOST")
    if pg_host:
        pg_port = os.getenv("PG_PORT", "5432")
        pg_user = urllib.parse.quote_plus(os.getenv("PG_USER", "postgres"))
        pg_pass = urllib.parse.quote_plus(os.getenv("PG_PASSWORD", "postgres"))
        pg_db = urllib.parse.quote_plus(os.getenv("PG_DATABASE", "postgres"))
        return f"postgresql://{pg_user}:{pg_pass}@{pg_host}:{pg_port}/{pg_db}"
    return "postgres://postgres:postgres@localhost:5432/postgres"

def get_neo4j_driver():
    uri = os.getenv("NEO4J_URI", "bolt://localhost:7687")
    user = os.getenv("NEO4J_USER", "neo4j")
    password = os.getenv("NEO4J_PASSWORD", "India@321")
    return GraphDatabase.driver(uri, auth=(user, password))

def fetch_web_tracking_configs(pg_conn) -> List[Tuple[Any, Dict[str, Any]]]:
    cursor = pg_conn.cursor()
    query = """
    SELECT organization_id, config
    FROM accounts.active_products
    WHERE product_id = 'web-tracking'
    """
    logger.info("Executing safe direct query on active_products...")
    cursor.execute(query)
    rows = cursor.fetchall()
    
    logger.info("Found %d active product record(s) for 'web-tracking'.", len(rows))
    results = []
    for row in rows:
        org_id = row[0]
        config_raw = row[1]
        if isinstance(config_raw, str):
            try:
                config = json.loads(config_raw)
            except json.JSONDecodeError as exc:
                logger.warning("Failed to parse config JSON for org_id %s: %s", org_id, exc)
                config = {}
        elif isinstance(config_raw, dict):
            config = config_raw
        else:
            config = {}
        results.append((org_id, config))
    cursor.close()
    return results

def extract_websites(records: List[Tuple[Any, Dict[str, Any]]]) -> List[Dict[str, Any]]:
    websites = []
    for org_id, config in records:
        if not org_id: continue
        try:
            norm_org_id = int(org_id)
        except (ValueError, TypeError):
            norm_org_id = org_id

        slots = config.get("visitorAllowanceBySlot", {})
        if not isinstance(slots, dict): continue

        for slot_id, slot_val in slots.items():
            try:
                website_id = int(slot_id)
            except (ValueError, TypeError):
                website_id = slot_id

            url = None
            if isinstance(slot_val, dict): url = slot_val.get("url")
            elif isinstance(slot_val, str): url = slot_val

            if not url: continue

            websites.append({
                "website_id": website_id,
                "organization_id": norm_org_id,
                "url": url
            })
    return websites

def sync_websites_to_neo4j(driver, websites: List[Dict[str, Any]], dry_run: bool = False) -> int:
    if not websites:
        logger.info("No website entries to sync.")
        return 0

    if dry_run:
        logger.info("[DRY-RUN] Would upsert %d website(s) into Neo4j:", len(websites))
        for site in websites:
            logger.info("  db=org%s, org_id=%s, website_id=%s, url=%s", site["organization_id"], site["organization_id"], site["website_id"], site["url"])
        return len(websites)

    synced_count = 0
    # Group websites by organization ID to manage database sessions efficiently
    websites_by_org = {}
    for site in websites:
        org_id = site["organization_id"]
        if org_id not in websites_by_org:
            websites_by_org[org_id] = []
        websites_by_org[org_id].append(site)

    for org_id, sites in websites_by_org.items():
        db_name = f"org{org_id}"
        logger.info("Writing %d websites to database '%s'...", len(sites), db_name)
        
        try:
            with driver.session(database=db_name) as session:
                for site in sites:
                    session.run(
                        CYPHER_UPSERT_WEBSITE,
                        website_id=site["website_id"],
                        org_id=site["organization_id"],
                        url=site["url"]
                    )
                    synced_count += 1
                    logger.info(
                        "Upserted Website {website_id: %s, org_id: %s, url: %s} into %s",
                        site["website_id"], site["organization_id"], site["url"], db_name
                    )
        except Exception as e:
            logger.error("Failed to write to database %s: %s", db_name, e)

    return synced_count

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if psycopg2 is None: sys.exit(1)

    dsn = get_postgres_dsn()
    pg_conn = psycopg2.connect(dsn)
    neo4j_driver = get_neo4j_driver()

    try:
        records = fetch_web_tracking_configs(pg_conn)
        websites = extract_websites(records)
        synced = sync_websites_to_neo4j(neo4j_driver, websites, dry_run=args.dry_run)
        logger.info("Successfully processed %d website(s).", synced)
    finally:
        pg_conn.close()
        neo4j_driver.close()

if __name__ == "__main__":
    main()
