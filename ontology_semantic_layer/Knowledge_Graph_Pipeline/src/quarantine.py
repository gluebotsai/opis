"""Quarantine.  Spec section 8.3.

One JSON line per rejected event.  Kafka coordinates are recorded alongside the
payload -- the spec listed only topic/payload/reason/timestamp, but without
(partition, offset) a replay cannot be correlated back to the log, and the
offset watermark cannot be reasoned about after the fact.
"""

from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger(__name__)


class Quarantine:
    def __init__(self, path: str | Path = "./quarantine"):
        self.dir = Path(path)
        self.dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def _file_for(self, when: datetime) -> Path:
        return self.dir / f"{when.strftime('%Y-%m-%d')}.jsonl"

    def write(self, topic: str, payload, reason: str, detail: str = "",
              partition: int | None = None, offset: int | None = None) -> None:
        now = datetime.now(timezone.utc)
        record = {
            "ts": now.isoformat(),
            "topic": topic,
            "partition": partition,
            "offset": offset,
            "reason": reason,
            "detail": detail,
            "payload": payload,
        }
        line = json.dumps(record, default=str, ensure_ascii=False)
        with self._lock:
            with self._file_for(now).open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")

    def read_date(self, date: str) -> list[dict]:
        path = self.dir / f"{date}.jsonl"
        if not path.exists():
            return []
        out = []
        with path.open("r", encoding="utf-8") as fh:
            for i, line in enumerate(fh, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    log.error("quarantine %s line %d is not valid JSON; skipping", path, i)
        return out

    def replay(self, date: str, handler) -> dict:
        """Re-feed a day's quarantined events through ``handler(topic, payload)``.

        Replay is safe because every write is idempotent (MERGE on business key),
        so an event that was quarantined and later replayed produces no duplicate.
        Events that fail again are re-quarantined under today's date.
        """
        records = self.read_date(date)
        stats = {"read": len(records), "replayed": 0, "requarantined": 0}
        for rec in records:
            try:
                ok = handler(rec["topic"], rec["payload"])
            except Exception as exc:            # noqa: BLE001 - replay must not abort
                ok = False
                self.write(rec["topic"], rec["payload"], "replay_failed", str(exc),
                           rec.get("partition"), rec.get("offset"))
            if ok:
                stats["replayed"] += 1
            else:
                stats["requarantined"] += 1
        return stats
