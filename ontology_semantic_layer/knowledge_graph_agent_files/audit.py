# ==============================================================================
# audit.py — Structured Audit Logging for Knowledge Graph Agent
# ==============================================================================

import os
import json
import time
import uuid
import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any
from threading import Lock

from .models import AuditRecord

_FILE_LOCK = Lock()
_PKG_ROOT = Path(__file__).resolve().parent


class AuditLogger:
    def __init__(
        self,
        enabled: bool = True,
        sink: str = "file",
        file_path: Optional[str] = None,
        log_pii: bool = False,
    ):
        self.enabled = enabled
        self.sink = sink
        if file_path:
            p = Path(file_path)
            self.file_path = p if p.is_absolute() else _PKG_ROOT.parent / p
        else:
            self.file_path = _PKG_ROOT.parent / "logs" / "audit.jsonl"
        self.log_pii = log_pii

        if self.enabled and self.sink == "file":
            self.file_path.parent.mkdir(parents=True, exist_ok=True)

    def log(self, record: AuditRecord) -> None:
        if not self.enabled:
            return

        if self.sink == "file":
            with _FILE_LOCK:
                try:
                    with open(self.file_path, "a", encoding="utf-8") as f:
                        f.write(record.to_json() + "\n")
                except Exception as e:
                    print(f"[AuditLogger Error] Failed writing audit line: {e}")
        elif self.sink == "stdout":
            print(f"[AUDIT] {record.to_json()}")


_GLOBAL_AUDIT_LOGGER: Optional[AuditLogger] = None


def get_audit_logger() -> AuditLogger:
    global _GLOBAL_AUDIT_LOGGER
    if _GLOBAL_AUDIT_LOGGER is None:
        try:
            from .config import get_config
            cfg = get_config()
            _GLOBAL_AUDIT_LOGGER = AuditLogger(
                enabled=cfg.audit.enabled,
                sink=cfg.audit.sink,
                file_path=cfg.audit.file_path,
                log_pii=cfg.audit.log_pii,
            )
        except Exception:
            _GLOBAL_AUDIT_LOGGER = AuditLogger(
                enabled=os.getenv("AUDIT_LOG_ENABLED", "true").lower() in ("true", "1", "yes"),
                sink=os.getenv("AUDIT_LOG_SINK", "file"),
                file_path=os.getenv("AUDIT_LOG_PATH", "logs/audit.jsonl"),
            )
    return _GLOBAL_AUDIT_LOGGER


def record_audit_event(
    request_id: Optional[str] = None,
    org_id: str = "unknown",
    user_id: str = "anonymous",
    role: str = "employee",
    question: str = "",
    intent: Optional[str] = None,
    cypher_run: Optional[List[str]] = None,
    params: Optional[List[Dict[str, Any]]] = None,
    row_count: int = 0,
    latency_seconds: float = 0.0,
    model_name: Optional[str] = None,
    status: str = "ok",
    error_message: Optional[str] = None,
) -> AuditRecord:
    """Convenience helper to construct and write an audit log line."""
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    req_id = request_id or f"req-{uuid.uuid4().hex[:12]}"

    if not model_name:
        try:
            from .config import get_config
            model_name = get_config().llm.model_name
        except Exception:
            model_name = os.getenv("LLM_MODEL_NAME", "worktual-gemma")

    # Sanitize params if log_pii is false (do not log sensitive parameters)
    clean_params = None
    if params:
        clean_params = []
        for p in params:
            if isinstance(p, dict):
                clean_params.append({k: str(v)[:60] for k, v in p.items()})
            else:
                clean_params.append({"value": str(p)[:60]})

    record = AuditRecord(
        request_id=req_id,
        timestamp=now_iso,
        org_id=org_id,
        user_id=user_id,
        role=role,
        question=question,
        intent=intent,
        cypher_run=cypher_run or [],
        params=clean_params or [],
        row_count=row_count,
        latency_seconds=round(latency_seconds, 3),
        model_name=model_name,
        status=status,
        error_message=error_message,
    )

    logger = get_audit_logger()
    logger.log(record)
    return record
