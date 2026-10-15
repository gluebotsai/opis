# CDC Pipeline — Operations & Setup Guide

This guide explains how to operate the CDC pipeline, especially how to handle graph schema changes, backfills, and database state.

---

## 1. Initial Setup

1. **Verify `.env`**
   Ensure your `.env` is configured with Postgres, Kafka, and Neo4j credentials.
2. **Start Infrastructure**
   Start Kafka and Kafka Connect using Docker.
3. **Register Debezium Connector**
   ```bash
   bash scripts/register_connector.sh
   ```
   *Note: When a connector is registered for the first time, Debezium automatically takes an `initial` snapshot of the entire PostgreSQL database and pushes every existing row into Kafka.*
4. **Provision the Graph Database**
   This sets up the required indexes and constraints in Neo4j for all organizations.
   ```bash
   python main.py provision --all
   ```
5. **Extract Website Configurations (Web Tracking)**
   Web tracking requires Website nodes to be extracted from the subscription configurations. This should be run on a cron schedule, but must be run once initially.
   ```bash
   python scripts/extract_websites.py
   ```
6. **Start the Consumer Pipeline**
   ```bash
   python main.py run
   ```
   The pipeline will read Debezium's snapshot from offset 0, build the graph, and then seamlessly transition into streaming live updates.

---

## 2. Managing Schema Changes (`core.yaml`)

When you update `config/mappings/core.yaml` (e.g., adding new collection nodes, cutting off supernodes, or changing relationship directions), the pipeline **only applies these changes to new events**. It does not automatically migrate existing nodes in Neo4j.

Depending on the size of the change, you have two options for applying it to existing data:

### Option A: The "Nuke and Replay" (Recommended for massive changes)
If you made fundamental changes to the graph (like removing dozens of edges) and your graph is small enough to rebuild quickly, it is safest to wipe Neo4j and let Kafka rebuild it from scratch.

1. **Stop the pipeline** (`Ctrl+C` on `python main.py run`).
2. **Wipe the Neo4j database:**
   In Neo4j Browser, run:
   ```cypher
   MATCH (n)
   CALL { WITH n DETACH DELETE n } IN TRANSACTIONS OF 10000 ROWS;
   ```
3. **Update the Kafka Consumer Group:**
   In `config/connections.yaml`, change the `group_id` (e.g., from `cdc-neo4j-sink-neo4j-c` to `cdc-neo4j-sink-neo4j-d`).
   *Why? This tricks the pipeline into thinking it has never read the Kafka topics before. Since Kafka retains a history of all Debezium events, changing the group ID forces the pipeline to start reading from `offset 0`.*
4. **Re-provision constraints:**
   ```bash
   python main.py provision --all
   ```
5. **Re-run the pipeline:**
   ```bash
   python main.py run
   ```
   The pipeline will rapidly replay the entire database history into Neo4j using your *new* `core.yaml` mapping rules.

### Option B: Surgical Cypher Migration (Recommended for small additions)
If you just added one new collection node or removed one bad relationship, and you don't want to drop the whole database, use Cypher to fix existing data.

1. **Delete removed relationships manually:**
   ```cypher
   CALL { MATCH (n:Tenant)<-[r:HAS_INTERACTION]-() DELETE r } IN TRANSACTIONS OF 10000 ROWS;
   ```
2. **Backfill new nodes manually:**
   If you added a new `InsightCollection` node to `core.yaml`, the pipeline will create it for *new* contacts, but existing contacts need it manually added:
   ```cypher
   CALL {
     MATCH (c:Contact)
     WHERE NOT (c)-[:HAS_INSIGHTS]->()
     MERGE (ic:InsightCollection {cdp_id: c.cdp_id})
     MERGE (c)-[:HAS_INSIGHTS]->(ic)
   } IN TRANSACTIONS OF 1000 ROWS;
   ```

---

## 3. How Backfills Work

The pipeline features a standalone backfill script (`python main.py backfill --org <id>`).

**When to use it:**
- When you onboard a brand new organization (tenant) into Neo4j and need to pull their historical data from Postgres without wiping the whole graph.
- When you add a completely new table to `postgres-source.json` and need to pull its history.

**How it works:**
The `backfill.py` script bypasses Kafka entirely. It connects directly to PostgreSQL, runs `SELECT * FROM <table> WHERE tenant_id = <org_id>`, and pushes the rows directly through the Python router into Neo4j.

**Important Warning on Standalone Backfills:**
The `backfill.py` script currently expects every table to have a `tenant_id` or `organization_id` column. If a Postgres table is a child table without a tenant ID column (e.g. `accounts.setup_business_hour_shifts`), `backfill.py` will crash.
For full database rebuilds involving all tables, always use the **Kafka Replay (Option A)** method above, as Debezium reads all tables perfectly without needing a `tenant_id` column.

---

## 4. Log Management

Logs are stored in the `logs/` directory.
- `main.py` is configured to rotate `pipeline.log` automatically every night at midnight.
- It only retains the last 2 days of logs to prevent disk space exhaustion.
- The pipeline logs the full JSON payload of incoming Debezium events by default. To reduce log spam, start the pipeline with:
  ```bash
  python main.py run --log-level WARNING
  ```

---

## 5. Running the Pipeline in the Background (Production)

To keep `python main.py run` running continuously after you disconnect from the terminal, use one of the following methods:

### Method A: `nohup` (The Quick & Easy Way)
Use this to simply detatch the process right now.
```bash
nohup python main.py run > pipeline.log 2>&1 &
```
* **View logs:** `tail -f pipeline.log`
* **Stop pipeline:** `pkill -f "python main.py run"`

### Method B: `tmux` (The Interactive Way)
Use this if you want to visually check the live console output later.
1. Create a session: `tmux new -s cdc_pipeline`
2. Start the pipeline: `python main.py run`
3. **Detach** and leave it running: Press `Ctrl + B`, then press `D`.
* **Reattach later:** `tmux attach -t cdc_pipeline`

### Method C: `systemd` (The Robust Server Way)
Best for production servers. It will automatically restart the pipeline if it crashes or if the server reboots.

1. **Create service file:**
   ```bash
   sudo nano /etc/systemd/system/cdc-pipeline.service
   ```
2. **Add this configuration (update paths as needed):**
   ```ini
   [Unit]
   Description=CDC Graph Pipeline Daemon
   After=network.target

   [Service]
   Type=simple
   User=vectone
   WorkingDirectory=/home/vectone/Desktop/cdc-pipeline
   # Path to your virtual environment's python:
   ExecStart=/home/vectone/miniconda3/envs/myenv/bin/python main.py run
   Restart=always
   RestartSec=5

   [Install]
   WantedBy=multi-user.target
   ```
3. **Enable and start it:**
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable cdc-pipeline
   sudo systemctl start cdc-pipeline
   ```
* **View logs:** `journalctl -u cdc-pipeline -f`
