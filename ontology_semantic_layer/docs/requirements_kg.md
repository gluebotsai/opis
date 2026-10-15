# Knowledge Graph Pipeline: Lessons, Precautions & Data Adjustments

This document serves as a comprehensive log of the data modeling precautions, pipeline adjustments, and engineering issues we encountered and resolved throughout the development of the CDC Knowledge Graph Pipeline. 

## 1. Data Modeling & Ontology Adjustments

### The `channel` vs `channel_config` CCaaS Mapping
* **The Issue:** Initially, there was ambiguity around how to correctly identify interaction channels in CCaaS tables. The pipeline was attempting to use or rely on `channel_config`, which was not consistently populated or correctly structured for our needs.
* **The Adjustment:** We shifted to relying purely on the `channel` column directly within the CCaaS tables themselves to update node labels and properties, avoiding the unreliable `channel_config` joins.

### Exclusive Label Switching (H2 Integrity)
* **The Issue:** When a ticket or entity changes state (e.g., from `Open` to `Resolved`), the graph would sometimes retain both labels (e.g., a node being both `OpenCase` and `ResolvedCase`) because Neo4j `SET` does not automatically remove old labels.
* **The Adjustment:** We implemented the "Exclusive-group clear-then-set" logic in the Cypher Builder. The pipeline now explicitly issues `REMOVE` for all mutually exclusive labels in a group before `SET`ting the new correct one based on the incoming CDC payload.

### Handling `lookup_source` and `view` Modes
* **The Issue:** The V2 Core Ontology introduced new modes (`lookup_source` and `view`) for derived/synthetic data (like `ticketing.contact_profile`). The Cypher Builder was crashing because it was attempting to generate standard `MERGE` statements for these read-only views.
* **The Adjustment:** Added a bypass in `build_all()` to immediately return empty Cypher (`{}`) if `mode in ("lookup_source", "view")`, preventing crashes and ensuring the pipeline only writes actual physical events.

### `tenant_id` vs `organization_id`
* **The Issue:** The backfiller and `tenant_resolver` assumed a strict standard of `tenant_id`. However, many tables (like `cdp.customer_recommendations`) use `organization_id`. 
* **The Adjustment:** Ensured the `TenantResolver` correctly identifies `organization_id` (`TENANT_COL = "organization_id"`) and maps the tenant context accurately, preventing events from being incorrectly quarantined during backfill.

## 2. PostgreSQL & Debezium Quirks

### Partitioned Tables
* **The Issue:** Debezium streams events from the *child partition* tables (e.g., `cdc.cdp.customer_events_2026_09`), but our ontology only defines the parent table (`cdp.customer_events`). The pipeline couldn't find mappings for the child tables.
* **The Adjustment:** We built `resolve_table()` in `router.py`. At boot, the router queries `pg_inherits` in PostgreSQL to build a map of every child partition to its parent. When an event arrives from a child, it automatically maps it to the parent ontology. For backfilling, we query the parent table directly so Postgres natively scans all partitions.

### The "Missing Kafka Topic" Spam (REQTMOUT)
* **The Issue:** Debezium *does not create* a Kafka topic for a table until the very first row is written to it. Because the pipeline subscribed to 178 ontology tables, `librdkafka` would aggressively search for the ~40 empty topics, resulting in continuous 60-second fetch timeouts (`REQTMOUT`) flooding the logs.
* **The Adjustment:** We wrote `_ensure_topics()` in `consumer.py` using `AdminClient` to automatically provision missing Kafka topics at boot, silencing the log spam and stabilizing the consumer group.

### Stale Event Overwrites (Version Guards)
* **The Issue:** In a distributed CDC system (or during a backfill), an older event might arrive at the graph after a newer event has already updated the node (e.g., `status: "Open"` overwriting `status: "Overdue"` in `org1012`).
* **The Adjustment:** We implemented version guards (Reference Integrity Step 5) using `_source_version` (timestamp) to ensure Cypher statements only apply if the incoming payload is strictly newer than what is already in the graph.

## 3. Pipeline Stability & Engine Fixes

### The "Sweep Parked Failed" Disconnections
* **The Issue:** The `TenantResolver` maintains a PostgreSQL connection to resolve missing tenant IDs (Foreign Key lookups). If no lookups occurred for a while, the database/router would drop the idle TCP connection, causing the pipeline to throw `Sweep parked failed: the connection is closed`.
* **The Adjustment:** Refactored `TenantResolver` to use `@property source_conn` and `control_conn`. If a socket is dead, the pipeline now silently catches the error and automatically rebuilds the connection via `pg_factory` without crashing.

### Preventing Phantom Nodes
* **The Issue:** When a child event arrived with an edge to a parent node that didn't exist yet, standard Cypher `MERGE` would create a "phantom" parent node with only an ID, causing data pollution.
* **The Adjustment:** Implemented `resolve_target()` with `default_on_missing: skip`. If a non-owner tries to create an edge to a missing node, the pipeline skips the relationship rather than creating a ghost node.

### The `cdp.customer_recommendations` Backfill Crash
* **The Issue:** Backfilling `customer_recommendations` completely crashed. The router usually uses `updated_at` or `created_at` for the event timestamp. This table only had `generated_at`. The fallback logic tried to call `time.time()`, but `import time` was missing in `router.py`, triggering a `NameError`.
* **The Adjustment:** Added `import time` globally to `router.py` across all workspaces to ensure the fallback timestamp mechanism executes flawlessly.

### Neo4j Idle Connection Drops
* **The Issue:** Logs showed `Failed to read from defunct connection`.
* **The Adjustment:** Educated the team that this is a harmless side-effect of Neo4j 5.x drivers automatically pruning idle TCP connections. The driver's built-in retry logic instantly establishes a new connection and replays the transaction. No code change was needed, but it was an important operational precaution to understand.