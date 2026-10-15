# Worktual AI Contact Centre

Enterprise AI Contact Centre spoke — monorepo for admin/agent portals, cc-core, platform-service, channel microservices, and NLP.

## Docs

- [AI Contact Centre Plan](./docs/AI_CONTACT_CENTER_PLAN.md)
- [Contact Centre Understanding](./docs/CONTACT_CENTER_MY_UNDERSTANDING.md)
- [Design Guidelines](./docs/DESIGN_GUIDELINES.md)
- [Brand & Design System](./docs/brand/README.md) — naming, theme, layouts, screenshots
- [Build & run (local + QA)](./docs/deploy/build.md)

## Prerequisites

- Node.js 20+
- npm 10+
- Docker & Docker Compose (for local infra)
- Python 3.11+ and [uv](https://docs.astral.sh/uv/) (for NLP service)

## Quick start

```bash
# Install dependencies
npm install

# Start infrastructure (postgres, redis, kafka)
docker compose -f docker/docker-compose.yml up -d

# Copy env files (see docs/deploy/env-files.md) and generate Prisma clients
cp apps/web/.env.example apps/web/.env
npm run db:generate

# Run all services (or use per-service scripts)
npm run dev
```

## Apps

| App | Port | Description |
|-----|------|-------------|
| `web` | 5173 | Admin + Agent UI (React, Ant Design, Tailwind) |
| `cc-core` | 3000 | Conversations, queues, routing, Socket.IO |
| `platform-service` | 3001 | Platform config (org, users, teams) |
| `chat-service` | 3002 | Webchat, email, SMS |
| `call-service` | 3003 | Voice, voicebot |
| `social-service` | 3004 | WhatsApp, Instagram, Facebook |
| `nlp` | 8000 | LLM, summaries, intent (FastAPI) |

## Packages

| Package | Purpose |
|---------|---------|
| `@ai-contact-center/config` | Shared TypeScript config |
| `@ai-contact-center/shared-types` | Cross-service TypeScript types |
| `@ai-contact-center/event-contracts` | Zod event schemas |
| `@ai-contact-center/observability` | Pino logging, trace context |
| `@ai-contact-center/platform-client` | HTTP client for platform-service |
| `@ai-contact-center/db-cc` | Prisma — `cc` schema |
| `@ai-contact-center/db-platform` | Prisma — `platform` schema |
