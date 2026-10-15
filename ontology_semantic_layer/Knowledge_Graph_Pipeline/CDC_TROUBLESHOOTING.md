# CDC Pipeline Troubleshooting Guide

## Scenario: Debezium Connector Fails to Create or Run

### Symptoms

1. **Connector creation fails** with HTTP 400 and validation errors mentioning `$` characters in config values.
2. **Connector exists but task is FAILED** with error: `PSQLException: connection attempt failed`.
3. **UNKNOWN_TOPIC_OR_PART** errors in Connect logs, followed by connector task failure.
4. Connect container unreachable from host, or container hostnames unreachable from Connect.

### Root Causes & Fixes

#### 1. Connector creation fails — `${ENV_VAR}` placeholders rejected

**Cause:** The Connect REST API does **not** expand `${ENV_VAR}` placeholders in the JSON config. It validates the raw JSON and fails if it sees literal `$` characters in property values.

**Fix:** Always post the connector config with **actual values substituted inline** (not placeholders). Example:

```bash
curl -X POST http://localhost:8083/connectors \
  -H "Content-Type: application/json" \
  -d '{
    "name": "cdc-postgres-source",
    "config": {
      "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
      "database.hostname": "192.168.11.156",
      "database.port": "5656",
      "database.user": "nlp",
      "database.password": "iamgroot",
      "database.dbname": "combinedDB",
      ...
    }
  }'
```

#### 2. Connector task fails — cannot reach PostgreSQL

**Cause:** Connect container uses `network_mode: host`, which breaks Docker DNS. Container hostnames (like `kafka`) become unreachable from Connect.

**Fix:**
```yaml
# docker/docker-compose.yml — REMOVE from connect service:
# network_mode: host
```

#### 3. Kafka produces UNKNOWN_TOPIC_OR_PART then connector fails

**Cause:** Kafka's `KAFKA_ADVERTISED_LISTENERS` advertised `localhost:9092`, but `localhost` resolves to the broker container itself (not the host). Connect couldn't produce to `cdc.*` topics.

**Fix:** Update Kafka to advertise the Docker bridge gateway:
```yaml
KAFKA_ADVERTISED_LISTENERS: INTERNAL://kafka:29092, EXTERNAL://172.17.0.1:9092
```

Verify the gateway IP:
```bash
docker network inspect bridge | grep Gateway
# Expected: "Gateway": "172.17.0.1"
```

### Scenario: Graph Validation & Ontology Errors

#### 1. "relationship uses target_key but label is keyed on..."
**Cause:** A relationship in `core.yaml` is trying to draw an edge using a property (e.g., `source_name`) that does not match the target node's primary key (e.g., `source_id`).
**Fix:** You cannot use `target_key` with `create_target: true` for non-primary keys. Convert the relationship to use a soft lookup via `match_fields` instead:
```yaml
# Broken:
- {type: FROM_SOURCE, target_label: SourceSystem, target_key: source_name, create_target: true}
# Fixed:
- {type: FROM_SOURCE, target_label: SourceSystem, match_fields: {source_name: source_name}}
```

#### 2. Neo4j write performance is severely degraded (Supernode Problem)
**Cause:** Too many child nodes are pointing directly to a single central node (like a `Tenant`), creating a "supernode" with tens of thousands of relationships. Neo4j locks nodes when drawing edges, leading to massive write contention.
**Fix:** Route relationships through intermediate Domain Hub Catalogs (e.g., `CampaignCatalog`, `WebTrackingCatalog`).
```cypher
# Instead of: (Tenant)<-[:HAS_CAMPAIGN]-(Campaign)
# Do this: (Tenant)-[:HAS_CAMPAIGNS]->(CampaignCatalog)<-[:BELONGS_TO]-(Campaign)
```

### Verification Commands

```bash
# 1. Check all containers are up
docker compose -f docker/docker-compose.yml ps

# 2. Check connector status
curl http://localhost:8083/connectors/cdc-postgres-source/status

# 3. Check Kafka topics created
docker exec cdc-pipeline-kafka-1 kafka-topics --list --bootstrap-server localhost:9092

# 4. Check Connect logs
docker compose -f docker/docker-compose.yml logs connect

# 5. Check Kafka logs
docker compose -f docker/docker-compose.yml logs kafka
```

### Key Values Reference

| Setting | Value |
|---------|-------|
| PostgreSQL host | `192.168.11.156` |
| PostgreSQL port | `5656` |
| PostgreSQL user | `nlp` |
| PostgreSQL password | `iamgroot` |
| PostgreSQL dbname | `combinedDB` |
| Kafka bootstrap | `172.17.0.1:9092` |
| Connector name | `cdc-postgres-source` |
| Topic prefix | `cdc` |
| Docker bridge gateway | `172.17.0.1` |
| Connect REST API | `http://localhost:8083/` |

### Restart Sequence

```bash
cd docker
docker compose down
docker compose up -d

# Wait for containers to stabilize
sleep 10

# Verify
curl http://localhost:8083/connectors
docker exec cdc-pipeline-kafka-1 kafka-topics --list --bootstrap-server localhost:9092
```
