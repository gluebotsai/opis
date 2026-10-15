# Campaign API — Fastify + Prisma (npm workspace: backend)
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/

RUN npm ci --workspace=backend --include-workspace-root

COPY backend ./backend

RUN npm run build --workspace=backend

FROM node:20-alpine AS production
WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY backend/package.json backend/

# Production deps + Prisma CLI for optional migrate-on-start
RUN npm ci --workspace=backend --omit=dev --include-workspace-root \
  && npm install --workspace=backend --no-save prisma@6.19.3

COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/prisma ./backend/prisma
# Ensure seed JSON is present even if an older build skipped the cp step
COPY backend/src/dao/data ./backend/dist/dao/data
COPY backend/docker-entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh \
  && npm exec --workspace=backend prisma generate

WORKDIR /app/backend

EXPOSE 3001

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/index.js"]
