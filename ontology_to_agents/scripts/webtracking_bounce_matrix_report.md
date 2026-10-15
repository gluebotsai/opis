# Amendment 7 — bounce_rate matrix (after started_at ← session_started_at)

Qualifying threshold: ≥30 sessions in window. WEBTRACKING_MONTH_ROLLING=1 for month.

| org | site | period | n | mart% | raw% | delta_pp | status |
|-----|------|--------|---|-------|------|----------|--------|
| 1 | 1001 | week/month/overall | 0–1 | — | — | — | skip_low_n |
| 1003 | 1001 | week | 54 | 48.1481 | 48.1481 | 0.0000 | PASS |
| 1003 | 1001 | month | 256 | 42.5781 | 42.5781 | 0.0000 | PASS |
| 1003 | 1001 | overall | 266 | 42.5781 | 42.5781 | 0.0000 | PASS |
| 1012 | 1011 | week/month/overall | 17 | ~17.65 | ~16.67 | ~0.98 | skip_low_n |

Fix: `mart_web_sessions.started_at = coalesce(v_session_bounce.session_started_at, dim.started_at)` so period filters match dashboard bounce grain.
