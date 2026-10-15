# Relational-to-Graph CDC Pipeline Architecture

This repository houses a real-time, multi-tenant Change Data Capture (CDC) pipeline that dynamically transforms relational data from PostgreSQL into a highly structured Knowledge Graph in Neo4j. 

This pipeline is **configuration-driven**, meaning the translation from relational rows to graph nodes and edges is governed by a declarative YAML ontology rather than hardcoded scripts.

---

## 🚀 V2 Migration & Current Progress Tracker
*This section tracks the ongoing migration to the V2 Ontology and Engine architecture.*

**✅ Completed Milestones:**
* **Tenant Resolution Engine:** Solved routing for junction tables missing `organization_id` by implementing a Control Plane caching index (`routing.tenant_index`) that recursively climbs FK relationships to discover the correct tenant.
* **Orphan / Parking Mechanism:** Built a resilience layer into `tenant_resolver.py` and the Kafka consumer to "park" child rows that arrive via CDC *before* their parent row, automatically sweeping and reparenting them once the parent arrives.
* **Pipeline Stability & Healing:** Hardened `backfill.py` to gracefully skip missing Postgres tables and properly route `global` scoped tables. Bumped Kafka's `max.poll.interval.ms` to 30m to survive massive data spikes. Patched `coercion.py` to stringify unexpected JSON lists in dynamic fields instead of quarantining them.
* **V2 Ontology Mapping:** Drafted and implemented `core.yaml` introducing L1 features (Hubs, Collections, Merged Labels).
* **Config Engine Upgrades:** Refactored `config_loader.py` to parse nested `from/to` structures for junction tables, and correctly route `hubs:` and `collections:` blocks.
* **Automated Provisioning:** `provision.py` successfully establishes Neo4j Enterprise isolated databases per tenant (e.g., `org1000`) and safely generates structural Domain Hub nodes with correctly typed keys.
* **Out-of-Order Stream Resilience:** Upgraded `cypher_builder.py` to use `MERGE` statements for relationship endpoints. This solved a major distributed systems bug where Debezium snapshotted relationship tables before node tables, causing edges to be silently dropped.
* **Dynamic Reconciliation:** Rebuilt `scripts/reconcile.py` to accurately filter by tenant (`organization_id`), group metrics by Merged Labels to eliminate arithmetic noise, and verify collection edge types.
* **Quarantine Pipeline:** Local DLQ established in `quarantine/` capturing unprocessable events in JSONL format with exact reasons.

**⏳ Up Next (Pending):**
* **Neo4j FGAC Sync Engine:** Build `scripts/fgac_sync.py` to dynamically map Postgres `accounts.setup_roles` to Neo4j Enterprise namespaced roles.
* **Web Tracking Ontology:** Execute the planned `extract_websites.py` script to map web tracking instances to the main catalog.
* **Pairwise Connectivity Validation:** CI script to ensure any two nodes of the same domain can reach each other via same-domain or `common` nodes.
* **ClickHouse Integration:** Implement the planned CDC sink for high-volume timeseries data.

---

## 🏗️ System Architecture & Data Flow

The pipeline operates in a strictly unidirectional, event-driven flow:

1. **PostgreSQL (The Source of Truth)**
   * Multi-tenant relational database where upstream applications write data.
   * Emits row-level `INSERT`, `UPDATE`, and `DELETE` operations to the Write-Ahead Log (WAL).

2. **Debezium (The Extractor)**
   * Connects to PostgreSQL via logical replication.
   * Translates the WAL entries into structured JSON change events.
   * Ensures every row change is captured with low latency and without polling the database.

3. **Apache Kafka (The Buffer)**
   * Acts as the highly available, distributed message broker.
   * Receives Debezium events and organizes them into topics per Postgres table (e.g., `cdc.public.customers`).
   * Guarantees strict ordering of events within a partition (crucial for maintaining database state consistency).

4. **Python CDC Router (The Engine)**
   * The core application of this repository. It runs continuously as a Kafka consumer.
   * **Transforms** the flat JSON payload into rich graph structures based on the YAML ontology.
   * **Routes** the payload to the correct physical Neo4j database based on the tenant/organization ID.
   * **Synthesizes** complex Cypher queries on the fly (`MERGE`, `SET`, `DELETE`).

5. **Neo4j Enterprise (The Destination)**
   * Multi-database graph environment. Each tenant gets a fully isolated database (e.g., `org1000`, `org1001`).
   * Secured by Fine-Grained Access Control (FGAC) to control read/traverse permissions at the node/edge level.

---

## 🧠 Core Engine Mechanics (How the Pipeline Thinks)

The pipeline does not hardcode table-to-node logic. It uses a V2 YAML ontology (`core.yaml`) layered with domain-specific overlays.

### 1. Declarative Ontology
* **Nodes (`mode: node`)**: A table maps to a primary Node label (e.g., `accounts.setup_users` maps to `Employee`).
* **Relationships (`mode: relationship_only`)**: Junction tables map to graph edges using nested `from:` and `to:` targets to precisely link nodes.
* **Properties (`mode: properties_on`)**: Append properties to existing nodes rather than creating new ones.
* **Hubs (`hubs:`)**: Defines high-level architectural domain backbones (e.g., `ConfigurationHub`, `MarketingHub`) that centralize data ownership per tenant.
* **Collections (`collections:`)**: Defines time-bucketed or structural fan-out rules to prevent supernodes on high-volume relationships.

### 2. Advanced Graph Transformations
* **Label Merging (`merges_into`)**: Distinct Postgres tables route to unify under a single Neo4j label (e.g., `setup_email_configs` and `setup_webchat_configs` merge into `ChannelAccount`), handling conflicting primary keys elegantly.
* **Dynamic Routing**: Adds conditional labels (`extra_labels`) or conditional relationships based on the payload data itself.
* **Derived Columns**: Evaluates inline rules at ingest-time to synthesize properties that don't explicitly exist in Postgres.

### 3. Structural Scaling Rules
To prevent graph performance degradation (like supernodes), the pipeline enforces structural rules during translation:
* **Hub Routing**: High-level domain data is rooted to Domain Hubs rather than tying everything directly to a central Tenant node.
* **LogPeriod Time-Bucketing**: High-volume telemetry or behavioral data are never attached directly to a User. The engine dynamically synthesizes `LogPeriod` time-buckets (e.g., `YYYY-MM`), creating a chain: `Customer -> BehaviourLog -> LogPeriod -> BehaviourEvent`.

### 4. Idempotency, Compaction & Stream Resilience
* **MERGE Operations:** All CDC events are translated into idempotent Neo4j `MERGE` statements.
* **Out-of-Order Resilience:** Because Debezium snapshots tables in parallel, junction tables (`relationship_only`) might arrive before their endpoint nodes. The pipeline seamlessly handles this by using `MERGE` to generate lightweight "stub" nodes for endpoints, ensuring edges are never dropped regardless of stream order.
* **Micro-batch Compaction:** Within a single micro-batch, operations on the same entity are compacted using a collapse key to avoid redundant writes.

---

## 🛠️ CLI & Operations

### 1. Provisioning the Graph Environment
Before running the pipeline, the graph databases, tenant nodes, and structural hubs must be provisioned.
```bash
python main.py provision --all
```
*Creates isolated databases for all known tenants, applies FGAC, and lays down the Hub infrastructure.*

### 2. Running the Consumer
Start the main Kafka consumer loop to process CDC events in real-time:
```bash
python main.py consume
```

### 3. Auditing & Reconciliation
Verify exact pipeline coverage, detect missing nodes/edges, and identify data drift for a specific tenant:
```bash
python scripts/reconcile.py --org 1000
```
*This tool dynamically reads `core.yaml`, queries PostgreSQL row counts filtered by `organization_id`, and matches them against Neo4j label counts, rolling up merged labels automatically.*

---

## 🤖 Context for AI & Future Enhancements

If you are an AI tasked with enhancing this architecture, look to the following areas for potential upgrades:

1. **Stateful Joins / Stream Enrichment**: Currently, the router is mostly stateless (it evaluates derived rules on single payloads). Enhancements could involve a stream-processing layer (like Flink or ksqlDB) to join tables *before* they hit the Python router.
2. **Dead Letter Queue (DLQ) Management**: The engine currently writes failed/unprocessable records directly to the local `quarantine/` directory as JSONL files. Enhancements could formalize a DLQ Kafka topic, replay mechanisms, and automated alerting.
3. **Throughput & Batching**: The Python consumer currently processes batches. Evaluate `asyncio`, connection pooling, or Neo4j APOC batch processing capabilities to maximize insert throughput under heavy CDC load.
4. **Data Contract Validation**: Introducing schema registry (e.g., Protobuf/Avro) between Debezium and the Router to strictly enforce the shape of incoming JSON payloads before they hit the Cypher builder.
