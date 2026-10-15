# Session Replay (rrweb)

Session replay records DOM structure and user interactions (not video), then replays them in the dashboard.

## Flow

```text
Browser SDK (recorder.js + rrweb UMD)
  → replay_chunk_v1 gzip batches
  → POST /v1/tracking/nfs-ingestions
  → raw_payloads → mv_fact_replay_chunks
  → fact_replay_chunks (30d TTL)
  → API /api/analytics/replay/*
  → Dashboard SessionReplayPlayer
```

## SDK

Replay starts after analytics consent (`setConsent({ analytics: true })`) when `trackReplay: true` (default).

```javascript
WorktualAnalytics.init({
  websiteId: 1001,
  websiteUrl: 'https://beta.worktual.co.uk/',
  organizationId: 1003,
  trackReplay: true,
});
```

## Local test

```bash
python run_backend.py --all    # ingest 7860, api 7861, dashboard 7862
python demo/serve.py           # demo 7870
```

1. Open http://localhost:7870 — interact 15+ seconds (mouse, scroll, clicks)
2. DevTools → Network → filter `nfs-ingestions` → confirm `replay_chunk_v1` payloads
3. Dashboard → Session replay → Watch

```bash
python scripts/verify_replay_setup.py
```

## DDL

```bash
python scripts/apply_clickhouse_ddl.py   # includes 07_replay_chunks.sql
python scripts/build_sdk.py
```

## Privacy

- Password inputs masked by default
- Add class `wt-no-replay` to exclude elements
- Add class `wt-mask` to mask text
