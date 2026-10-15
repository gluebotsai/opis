# My Accounts Backend

Fastify API with native routes for all domains, mail/OAuth, SSE, and payment webhooks.

## Setup

```bash
cp .env.example .env
pnpm install
pnpm dev
```

- API: http://localhost:3002
- Production build: `pnpm build`
- Compiled API: `pnpm start`
- Source worker: `pnpm worker:source`
- Compiled worker: `pnpm worker`
- Migrations: `pnpm migrate` (also run on boot unless `SKIP_MIGRATE_ON_BOOT=true`)
- API smoke test: `pnpm smoke:api` (operational `.mjs` scripts execute through `tsx`)

All backend application code is TypeScript under `src/`. Operational smoke and
route-audit scripts remain under `scripts/`.
