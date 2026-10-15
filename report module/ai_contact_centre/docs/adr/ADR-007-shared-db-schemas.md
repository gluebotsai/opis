# ADR-007: One PostgreSQL database, multiple schemas

**Status:** Accepted

Single `worktual_db` with `platform`, `cc`, and optional channel schemas. Each service owns its schema; no cross-schema queries in application code.
