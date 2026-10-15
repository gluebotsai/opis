import json
import logging
import sqlite3
import time
from pathlib import Path
from typing import Any, Dict, List

import clickhouse_connect
from confluent_kafka import Producer

log = logging.getLogger(__name__)

class WatermarkStore:
    def __init__(self, db_path: str):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS watermarks (
                    table_name TEXT PRIMARY KEY,
                    last_updated_at TEXT,
                    last_event_date TEXT,
                    last_polled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    rows_sent_last_cycle INTEGER DEFAULT 0
                )
            """)

    def get(self, table: str) -> dict:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT * FROM watermarks WHERE table_name = ?", (table,)
            ).fetchone()
            
            if row:
                return dict(row)
            return {
                "table_name": table,
                "last_updated_at": "1970-01-01 00:00:00",
                "last_event_date": "1970-01-01",
                "last_polled_at": None,
                "rows_sent_last_cycle": 0
            }

    def advance(self, table: str, last_updated_at: str = None, last_event_date: str = None, rows_sent: int = 0):
        with sqlite3.connect(self.db_path) as conn:
            if last_updated_at:
                conn.execute("""
                    INSERT INTO watermarks (table_name, last_updated_at, rows_sent_last_cycle, last_polled_at)
                    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(table_name) DO UPDATE SET 
                        last_updated_at = excluded.last_updated_at,
                        rows_sent_last_cycle = excluded.rows_sent_last_cycle,
                        last_polled_at = CURRENT_TIMESTAMP
                """, (table, last_updated_at, rows_sent))
            elif last_event_date:
                conn.execute("""
                    INSERT INTO watermarks (table_name, last_event_date, rows_sent_last_cycle, last_polled_at)
                    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(table_name) DO UPDATE SET 
                        last_event_date = excluded.last_event_date,
                        rows_sent_last_cycle = excluded.rows_sent_last_cycle,
                        last_polled_at = CURRENT_TIMESTAMP
                """, (table, last_event_date, rows_sent))


class ClickHousePoller:
    def __init__(self, config: dict, ch_client, producer: Producer, wm: WatermarkStore, core_loader):
        self.config = config
        self.ch = ch_client
        self.producer = producer
        self.wm = wm
        self.loader = core_loader

        # Build column strings for AggregatingMergeTree tables from core.yaml
        self.agg_cols = {}
        for t in self.config.get("tables", []):
            if t["kind"] == "aggregating":
                m = self.loader.get_mapping(t["source_db"], t["name"])
                if m:
                    # Construct sumMerge(col) AS col for everything except dimensions
                    cols = []
                    for prop in m.properties:
                        name = prop.name
                        if name in ["website_id", "event_date", "organization_id"]:
                            cols.append(name)
                        else:
                            # Assume sumMerge for all metrics. In a real system, this might
                            # need a custom mapping, but this fits the planned spec.
                            cols.append(f"sumMerge({name}) AS {name}")
                    self.agg_cols[t["name"]] = ", ".join(cols)
                else:
                    self.agg_cols[t["name"]] = "*" # Fallback

    def run_forever(self):
        log.info("ClickHouse poller starting...")
        batch_size = self.config.get("batch_size", 500)
        
        while True:
            for table_cfg in self.config.get("tables", []):
                table = table_cfg["name"]
                db = table_cfg["source_db"]
                kind = table_cfg["kind"]
                interval = table_cfg["interval_seconds"]
                topic = f"cdcpoll.{db}.{table}"

                try:
                    rows = self._fetch(db, table, kind, batch_size)
                    
                    if not rows:
                        time.sleep(1) # Prevent tight spinning on empty tables
                        continue

                    # Send to Kafka
                    for row in rows:
                        # Serialize datetime objects
                        for k, v in row.items():
                            if hasattr(v, "isoformat"):
                                row[k] = v.isoformat()
                                
                        payload = {
                            "op": "u", # Poller always emits upserts
                            "after": row,
                            "source": {"db": db, "table": table, "snapshot": "false"}
                        }
                        self.producer.produce(topic, json.dumps(payload))
                    
                    self.producer.flush()

                    # Advance watermark
                    if kind == "replacing" and "updated_at" in rows[-1]:
                        self.wm.advance(table, last_updated_at=rows[-1]["updated_at"], rows_sent=len(rows))
                    elif kind == "aggregating" and "event_date" in rows[-1]:
                        self.wm.advance(table, last_event_date=rows[-1]["event_date"], rows_sent=len(rows))

                    log.info(f"Polled {len(rows)} rows from {db}.{table} -> {topic}")

                    # Backpressure: if we got a full batch, we are lagging. Do NOT sleep.
                    if len(rows) < batch_size:
                        time.sleep(interval)
                        
                except Exception as e:
                    log.error(f"Error polling {db}.{table}: {e}", exc_info=True)
                    time.sleep(interval)

    def _fetch(self, db: str, table: str, kind: str, batch_size: int) -> List[Dict[str, Any]]:
        wm = self.wm.get(table)
        
        if kind == "replacing":
            last_updated = wm["last_updated_at"]
            if last_updated == "1970-01-01 00:00:00":
                # Bootstrap: look back 7 days on first run
                last_updated = "now() - INTERVAL 7 DAY"
            else:
                last_updated = f"'{last_updated}'"
                
            query = f"""
                SELECT *
                FROM {db}.{table} FINAL
                WHERE updated_at > {last_updated}
                ORDER BY updated_at ASC
                LIMIT {batch_size}
            """
            
        elif kind == "aggregating":
            last_date = wm["last_event_date"]
            if last_date == "1970-01-01":
                # Bootstrap: look back 2 days
                last_date = "now() - INTERVAL 2 DAY"
            else:
                # Always look back at least 2 days for late arriving data
                last_date = f"GREATEST('{last_date}'::Date - 2, now() - INTERVAL 2 DAY)"
                
            cols = self.agg_cols.get(table, "*")
            query = f"""
                SELECT {cols}
                FROM {db}.{table}
                WHERE event_date >= {last_date}
                GROUP BY website_id, event_date
                LIMIT {batch_size}
            """
        else:
            return []

        result = self.ch.query(query)
        
        # Convert to list of dicts
        rows = []
        if result.result_rows:
            columns = result.column_names
            for row in result.result_rows:
                rows.append(dict(zip(columns, row)))
                
        return rows
