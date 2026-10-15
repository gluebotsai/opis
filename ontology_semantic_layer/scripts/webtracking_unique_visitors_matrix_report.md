# Amendment 2 — unique_visitors matrix report (read-only)

Template already: `uniqExact(visitor_id)` on `webtracking_marts.mart_web_sessions`.
Policy dims already include `device`, `city`, `region`.

## sessions grain vs visitors mart (all matrix pairs)

| org | site | period | sessions_uv | visitors_uv | delta% |
|-----|------|--------|-------------|-------------|--------|
| 1003 | 1001 | today/week/month/overall | 1/40/95/121 | same | 0 |
| 1012 | 1011 | today/week/month/overall | 6/7/7/7 | same | 0 |
| 1 | 1001 | today/week/month/overall | 0/0/1/1 | same | 0 |

Flags (>2%): **none**. No tenant worsened vs visitors mart; overall (1003,1001)=**121** (report CH 122 was org-unscoped site total including org 1).

## Cost (largest pair 1003/1001, 266 sessions)

- overall uniqExact: ~1050 ms wall
- calendar month: ~1050 ms wall
- Budget OK for current matrix size (tiny).

## Device filter smoke

- (1003,1001) unique_visitors + device=mobile → 9, sql_template
- (1012,1011) unique_visitors + device=mobile → 4, sql_template

No template change shipped in this commit (already correct).
