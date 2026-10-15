# Knowledge Graph Pipeline: Architecture & Upgrades (A to Z)

This document serves as a comprehensive, end-to-end guide detailing how your Knowledge Graph pipeline operates, the massive architectural upgrades we have implemented, and the exact roadmap for our upcoming model migration.

---

## 1. System Overview (How Data Flows)
The pipeline is a real-time Change Data Capture (CDC) system designed to keep your Neo4j Knowledge Graph perfectly synchronized with your PostgreSQL control plane.

1. **Debezium (The Source):** Monitors PostgreSQL for any row-level changes (`INSERT`, `UPDATE`, `DELETE`) and instantly publishes them to Kafka topics (e.g., `cdc.ticketing.tickets`).
2. **Python Consumer (The Engine):** Subscribes to 300+ Kafka topics. It reads the raw JSON payloads and hands them to the Router.
3. **Router (The Brains):** Validates the schema, resolves the correct tenant/organization (e.g., `org1012`), and translates relational data into Graph concepts (Nodes and Relationships). It assigns a globally unique `collapse_key` to every event.
4. **Writer (The Muscle):** Buffers the routed events. If multiple events hit the same row (e.g., an `INSERT` followed instantly by an `UPDATE`), it uses the `collapse_key` to deduplicate them. It then groups them and executes highly optimized `UNWIND` Cypher queries to write to Neo4j.

---

## 2. Recent Upgrades: Sub-Second Latency & Stability
We identified that the pipeline was suffering from severe latency (minutes behind real-time) and occasionally dropping data during connection hiccups. We entirely rebuilt the bottlenecks:

### A. Zero-Latency Asynchronous Embeddings
* **The Problem:** The pipeline was generating text vectors (`SentenceTransformers`) on the CPU synchronously. A batch of 4,000 products would freeze the pipeline for ~150 seconds.
* **The Fix:** We built `AsyncEmbedder`. The main pipeline now writes raw text to Neo4j in milliseconds. The text is then pushed to a background thread which safely generates the AI embeddings and updates Neo4j seconds later. The main pipeline **never blocks**.

### B. True Real-Time Batching
* **The Fix:** We lowered the `flush_interval_seconds` from 2.0s down to `0.5s`, and reduced the Kafka poll sizes. This forces the pipeline to act like a flowing river rather than a dam, ensuring Neo4j is updated in under a second.

### C. The Real-Time DLQ (Dead Letter Queue)
* **The Problem:** If Neo4j or Postgres temporarily dropped a connection, the CDC event was dumped into a local `.jsonl` file and effectively lost until manually recovered.
* **The Fix:** We created the `routing.quarantined_events` table in PostgreSQL. Failed events are instantly written here. A dedicated background microservice (`run-dlq`) wakes up every 10 seconds, sweeps this table, and automatically retries the failed events using **exponential backoff**.

### D. "Ghost Node" Prevention (Auto-Cleanup)
* **The Problem:** If an `INSERT` failed and went to the DLQ, but the user subsequently deleted the row in Postgres, the DLQ would eventually retry the `INSERT` and accidentally resurrect a "ghost" node in Neo4j.
* **The Fix:** We wired the main Writer to the DLQ. Whenever *any* event (especially a `DELETE`) successfully writes to Neo4j, it instantly fires a background query to delete any stale, queued retries for that exact row in the DLQ. Additionally, if a `DELETE` event fails, the DLQ instantly discards it.

---

## 3. Upcoming Phase: Qwen3 Embedding Migration
We are currently preparing to swap your AI embedding model from `sentence-transformers/all-MiniLM-L6-v2` to `Qwen/Qwen3-Embedding-0.6B`. 

Because AI models have different "latent spaces" (MiniLM uses 384 dimensions, Qwen3 uses 1024 dimensions), we cannot just swap the code. We must execute a careful, 3-step migration:

### Step 1: Schema Teardown
Neo4j Vector Indexes are strictly bound to a dimension size (384). We will write a script to sweep through all 15 active organizations and run `DROP VECTOR INDEX` on all existing indexes.

### Step 2: Schema Rebuild & Model Swap
We will update `.env` to point to `Qwen/Qwen3-Embedding-0.6B`. We will then trigger the native provisioner (`python main.py provision --all`). It will read the new 1024-dimension requirement and rebuild all the Vector Indexes instantly.

### Step 3: Historical Data Re-Embedding
All historical nodes in Neo4j currently possess useless 384-dimensional vectors. We will write a heavy-duty `migrate_embeddings.py` script. It will run in the background, pull every single node out of Neo4j, pass its text through the new Qwen model, and save the 1024-dimensional vectors back into the graph. 

*(During Step 3, the pipeline will continue processing real-time CDC updates safely).*
