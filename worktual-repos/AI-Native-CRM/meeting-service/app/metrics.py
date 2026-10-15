from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram

JOIN_SUCCESS = Counter("meeting_join_success_total", "Bots successfully requested")
JOIN_FAIL = Counter("meeting_join_fail_total", "Bot spawn failures", ["error_code"])
RATE_LIMITED = Counter("meeting_rate_limited_total", "POST /meetings 429s")
WEBHOOKS = Counter("meeting_webhooks_total", "Vexa webhooks", ["event_type", "outcome"])
EXTRACT_FAIL = Counter("meeting_extract_fail_total", "Extract job failures")
EXTRACT_OK = Counter("meeting_extract_ok_total", "Extract job successes")
SEGMENTS = Counter("meeting_segments_total", "Confirmed segments persisted")
CONCURRENT = Gauge("meeting_concurrent_inflight", "Live bot slots in use")
QUEUED = Gauge("meeting_queued", "Meetings waiting for a bot slot")
ADMIT_LATENCY = Histogram("meeting_admit_latency_seconds", "Time from joining to active")
WHISPER_PREFLIGHT = Gauge("meeting_whisper_ready", "1 if whisper preflight ok")
VEXA_READY = Gauge("meeting_vexa_ready", "1 if vexa ping ok")
