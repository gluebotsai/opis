# ADR-001: Monorepo + independent deployables

**Status:** Accepted

Each service in `apps/` builds to its own Docker image and deploys independently. Shared code lives in `packages/`.
