# Fastify API / scheduler / worker. Same image, different compose command.
FROM node:20-bookworm

WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/package-lock.json ./backend/
COPY prisma ./prisma

RUN npm ci && npm ci --prefix backend

COPY backend ./backend

# Dummy URL for `prisma generate` only — runtime URL comes from compose env.
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=crm"
RUN node backend/scripts/generate-prisma.mjs \
  && cd backend && npx playwright install --with-deps chromium

ENV NODE_ENV=production
WORKDIR /app/backend

# Override in compose: scheduler.ts / worker.ts. API must disable in-process cron + worker.
ENV CRON_SCHEDULER_ENABLED=false
ENV AI_WORKER_ENABLED=false

EXPOSE 4000
CMD ["npx", "tsx", "--tsconfig", "tsconfig.json", "src/index.ts"]
